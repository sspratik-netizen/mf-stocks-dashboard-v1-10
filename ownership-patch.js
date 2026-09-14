// Adds a lightweight NSE shareholding-pattern endpoint without changing the large server.js.
// Data is quarterly ownership, not transaction-level buyer/seller data.
const express = require("express");

let capturedApp = null;
const originalUse = express.application.use;
express.application.use = function (...args) {
  capturedApp = this;
  return originalUse.apply(this, args);
};

const NSE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
  "Accept": "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern"
};

const cache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000;

async function nseCookies() {
  const r = await fetch("https://www.nseindia.com/", { headers: NSE_HEADERS, signal: AbortSignal.timeout(10000) });
  const raw = r.headers.get("set-cookie") || "";
  return raw.split(/,(?=[^;,]+=)/).map(x => x.split(";")[0].trim()).filter(Boolean).join("; ");
}

async function fetchOwnership(symbol) {
  const key = String(symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9&._-]{1,30}$/.test(key)) throw new Error("Invalid NSE symbol");
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;

  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const cookie = await nseCookies();
      const url = `https://www.nseindia.com/api/corporate-share-holdings-master?index=equities&symbol=${encodeURIComponent(key)}`;
      const r = await fetch(url, {
        headers: { ...NSE_HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
        signal: AbortSignal.timeout(15000)
      });
      if (!r.ok) throw new Error(`NSE ownership HTTP ${r.status}`);
      const json = await r.json();
      const rows = extractRows(json);
      const normalized = normalizeRows(rows);
      if (!normalized.length) throw new Error("NSE ownership categories unavailable");
      const result = { symbol: key, rows: normalized.slice(0, 8), source: "NSE Corporate Filings · Shareholding Pattern" };
      cache.set(key, { timestamp: Date.now(), data: result });
      return result;
    } catch (e) {
      lastError = e;
      if (attempt === 0) await new Promise(r => setTimeout(r, 700));
    }
  }
  throw lastError || new Error("NSE ownership unavailable");
}

function cleanKey(x) {
  return String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function num(x) {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  const s = String(x ?? "").replace(/,/g, "").replace(/%/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function findVal(obj, names) {
  const wanted = new Set(names.map(cleanKey));
  for (const [k, v] of Object.entries(obj || {})) if (wanted.has(cleanKey(k))) return v;
  return null;
}
function categoryText(obj) {
  return String(findVal(obj, ["category", "categoryName", "shareholderCategory", "subcategory", "name", "shareholderType"]) || "").trim();
}
function pctValue(obj) {
  const v = findVal(obj, ["shareholdingPercentage", "shareholdingPercent", "percentage", "percent", "shareHolding", "shareholding"]);
  return num(v);
}
function dateValue(obj) {
  return String(findVal(obj, ["asOnDate", "asOn", "date", "quarterEndDate", "reportDate"]) || "").trim();
}
function extractRows(node, out = [], depth = 0) {
  if (depth > 8 || node == null) return out;
  if (Array.isArray(node)) { for (const x of node) extractRows(x, out, depth + 1); return out; }
  if (typeof node !== "object") return out;
  const category = categoryText(node);
  const pct = pctValue(node);
  if (category && pct !== null) out.push({ category, pct, date: dateValue(node) });
  for (const v of Object.values(node)) if (v && typeof v === "object") extractRows(v, out, depth + 1);
  return out;
}

function normalizeRows(raw) {
  // Group by reporting date, then retain the latest four quarters.
  const dates = [...new Set(raw.map(x => x.date).filter(Boolean))].sort((a, b) => String(b).localeCompare(String(a)));
  const groups = dates.length ? dates.slice(0, 4) : [""];
  const out = [];
  for (const date of groups) {
    const source = raw.filter(x => x.date === date);
    const agg = { mf: 0, fii: 0, retail: 0, promoter: 0 };
    for (const r of source) {
      const c = r.category.toLowerCase();
      if (/mutual fund|mutual funds|\bmf\b|uti/.test(c)) agg.mf += r.pct;
      else if (/foreign portfolio|foreign institutional|\bfii\b|fpi/.test(c)) agg.fii += r.pct;
      else if (/individual|retail/.test(c)) agg.retail += r.pct;
      else if (/promoter/.test(c)) agg.promoter += r.pct;
    }
    out.push({ date: date || "Latest", mf: agg.mf || null, fii: agg.fii || null, retail: agg.retail || null, promoter: agg.promoter || null });
  }
  return out;
}

setImmediate(() => {
  if (!capturedApp) return;
  capturedApp.get("/api/stock-ownership/:symbol", async (req, res) => {
    try {
      res.json(await fetchOwnership(req.params.symbol));
    } catch (e) {
      res.status(502).json({ error: e.message || "Ownership data unavailable" });
    }
  });
});
