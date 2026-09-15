// Adds quarterly NSE shareholding-pattern data to the stock details page.
// NSE shareholding filings use different XBRL dimension/member names across issuers.
// This parser accepts explicitMember and typedMember contexts and maps the member
// names to MF/FII/Retail/Promoter. This is ownership-pattern data, not transaction-level buyer/seller data.
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

async function fetchNseMaster(symbol) {
  const cookie = await nseCookies();
  const url = `https://www.nseindia.com/api/corporate-share-holdings-master?index=equities&symbol=${encodeURIComponent(symbol)}`;
  const r = await fetch(url, { headers: { ...NSE_HEADERS, ...(cookie ? { Cookie: cookie } : {}) }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`NSE ownership HTTP ${r.status}`);
  const json = await r.json();
  const rows = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
  return rows.filter(x => x && (x.date || x.xbrl));
}

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": NSE_HEADERS["User-Agent"],
      "Accept": "application/xml,text/xml,text/html,*/*",
      "Referer": "https://www.nseindia.com/"
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error(`XBRL HTTP ${r.status}`);
  return await r.text();
}

function cleanText(x) {
  return String(x || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}
function localName(tag) { return String(tag || "").replace(/^.*:/, ""); }
function normToken(x) { return String(x || "").replace(/[^a-z0-9]/gi, "").toLowerCase(); }

function categoryFromDimension(axis, member) {
  const text = `${normToken(axis)} ${normToken(member)}`;
  if (/mutualfund|mutualfunds|mutualfundsoruti|mutualfundoruti|uti/.test(text)) return "mf";
  if (/foreignportfolioinvestor|foreigninstitutionalinvestor|foreigninstitution|fpi|fii/.test(text)) return "fii";
  if (/individual|individualshuf|individualsandhuf|residentindividual|residentindividuals|nonresidentindividual|nonresidentindividuals|huf|retail/.test(text)) return "retail";
  if (/promoter|promotergroup|promoterandpromotergroup/.test(text)) return "promoter";
  return null;
}

function parseXbrl(xml) {
  // NSE issuers use both xbrldi:explicitMember and typedMember. Capture every
  // dimension/member in each context instead of assuming one fixed taxonomy shape.
  const contextMap = new Map();
  const contextRe = /<(?:[A-Za-z_][\\w.-]*:)?context\\b[^>]*\\bid=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?context>/gi;
  let cm;
  while ((cm = contextRe.exec(xml))) {
    const body = cm[2];
    const dims = [];
    const explicitRe = /<(?:[A-Za-z_][\\w.-]*:)?explicitMember\\b[^>]*\\bdimension=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?explicitMember>/gi;
    let em;
    while ((em = explicitRe.exec(body))) dims.push({ axis: localName(em[1]), member: cleanText(em[2]) });
    const typedRe = /<(?:[A-Za-z_][\\w.-]*:)?typedMember\\b[^>]*\\bdimension=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?typedMember>/gi;
    let tm;
    while ((tm = typedRe.exec(body))) {
      const inner = cleanText(tm[2].replace(/<[^>]+>/g, " "));
      dims.push({ axis: localName(tm[1]), member: inner });
    }
    contextMap.set(cm[1], dims);
  }

  const pctNames = [
    "ShareholdingAsAPercentageOfTotalNumberOfShares",
    "ShareholdingAsAPercentageOfTotalNoOfShares",
    "ShareholdingAsAPercentage",
    "ShareholdingPercentage"
  ];
  const rows = [];
  for (const name of pctNames) {
    const re = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${name}\\b[^>]*\\bcontextRef=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${name}>`, "gi");
    let m;
    while ((m = re.exec(xml))) {
      const pct = Number(String(m[2]).replace(/<[^>]+>/g, "").replace(/,/g, "").trim());
      if (!Number.isFinite(pct)) continue;
      const dims = contextMap.get(m[1]) || [];
      for (const d of dims) {
        const category = categoryFromDimension(d.axis, d.member);
        if (category) rows.push({ category, pct });
      }
    }
  }

  if (!rows.length) return null;
  const maxPct = Math.max(...rows.map(x => x.pct));
  if (maxPct <= 1.000001) rows.forEach(x => { x.pct *= 100; });
  return rows;
}

function normalizeDate(value) {
  const s = String(value || "").trim().toUpperCase();
  const m = s.match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/);
  return m ? `${m[1].padStart(2, "0")}-${m[2]}-${m[3]}` : (s || "Latest");
}

async function buildQuarter(masterRow) {
  const date = normalizeDate(masterRow.date);
  const out = {
    date,
    mf: null,
    fii: null,
    retail: null,
    promoter: Number.isFinite(Number(masterRow.pr_and_prgrp)) ? Number(masterRow.pr_and_prgrp) : null
  };
  const xbrl = String(masterRow.xbrl || "").trim();
  if (!xbrl) return out;
  try {
    const rows = parseXbrl(await fetchText(xbrl));
    if (!rows) return out;
    const sums = { mf: 0, fii: 0, retail: 0, promoter: 0 };
    const seen = { mf: false, fii: false, retail: false, promoter: false };
    for (const row of rows) { sums[row.category] += row.pct; seen[row.category] = true; }
    for (const k of Object.keys(seen)) if (seen[k]) out[k] = sums[k];
    return out;
  } catch (e) {
    console.warn(`NSE XBRL ownership ${date} unavailable:`, e.message);
    return out;
  }
}

async function fetchOwnership(symbol) {
  const key = String(symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9&._-]{1,30}$/.test(key)) throw new Error("Invalid NSE symbol");
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const master = await fetchNseMaster(key);
      const selected = master.filter(x => x.xbrl || x.date)
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 4);
      if (!selected.length) throw new Error("NSE ownership filings unavailable");
      const rows = await Promise.all(selected.map(buildQuarter));
      const result = { symbol: key, rows, source: "NSE Corporate Filings · Shareholding Pattern + linked XBRL" };
      cache.set(key, { timestamp: Date.now(), data: result });
      return result;
    } catch (e) {
      lastError = e;
      if (attempt === 0) await new Promise(r => setTimeout(r, 700));
    }
  }
  throw lastError || new Error("NSE ownership unavailable");
}

setImmediate(() => {
  if (!capturedApp) return;
  capturedApp.get("/api/stock-ownership/:symbol", async (req, res) => {
    try { res.json(await fetchOwnership(req.params.symbol)); }
    catch (e) { res.status(502).json({ error: e.message || "Ownership data unavailable" }); }
  });
});
