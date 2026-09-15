// Adds quarterly NSE shareholding-pattern data to the stock details page.
// The NSE master endpoint provides filing dates + XBRL links; MF/FII/retail
// categories are parsed from the linked XBRL. This is ownership-pattern data,
// not transaction-level buyer/seller data.
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
  const r = await fetch("https://www.nseindia.com/", {
    headers: NSE_HEADERS,
    signal: AbortSignal.timeout(10000)
  });
  const raw = r.headers.get("set-cookie") || "";
  return raw.split(/,(?=[^;,]+=)/).map(x => x.split(";")[0].trim()).filter(Boolean).join("; ");
}

async function fetchNseMaster(symbol) {
  const cookie = await nseCookies();
  const url = `https://www.nseindia.com/api/corporate-share-holdings-master?index=equities&symbol=${encodeURIComponent(symbol)}`;
  const r = await fetch(url, {
    headers: { ...NSE_HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
    signal: AbortSignal.timeout(15000)
  });
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
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function localName(tag) {
  return String(tag || "").replace(/^.*:/, "");
}

function categoryFromAxis(axis) {
  const a = String(axis || "");
  if (/MutualFundsOrUTI/i.test(a)) return "mf";
  if (/ForeignPortfolioInvestor|ForeignInstitutionalInvestor/i.test(a)) return "fii";
  if (/IndividualsOrHUF|NonResidentIndividuals|ForeignIndividuals/i.test(a)) return "retail";
  if (/Promoter/i.test(a)) return "promoter";
  return null;
}

function parseXbrl(xml) {
  // XBRL contexts join the shareholder facts through a typed-member.
  const contextMap = new Map();
  const contextRe = /<(?:[A-Za-z_][\w.-]*:)?context\b[^>]*\bid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?context>/gi;
  let cm;
  while ((cm = contextRe.exec(xml))) {
    const body = cm[2];
    const tm = body.match(/<(?:[A-Za-z_][\w.-]*:)?typedMember\b[^>]*\bdimension=["']([^"']+)["'][^>]*>[\s\S]*?<[^>]+>([^<]+)<\/[^>]+>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?typedMember>/i);
    if (!tm) continue;
    contextMap.set(cm[1], {
      axis: localName(tm[1]),
      member: cleanText(tm[2])
    });
  }

  const facts = new Map();
  const wanted = [
    "NameOfTheShareholder",
    "ShareholdingAsAPercentageOfTotalNumberOfShares"
  ];

  for (const name of wanted) {
    const re = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${name}\\b[^>]*\\bcontextRef=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${name}>`, "gi");
    let m;
    while ((m = re.exec(xml))) {
      const ctx = contextMap.get(m[1]);
      if (!ctx) continue;
      const key = `${ctx.axis}|${ctx.member}`;
      if (!facts.has(key)) facts.set(key, { axis: ctx.axis, member: ctx.member });
      facts.get(key)[name] = cleanText(m[2]);
    }
  }

  const rows = [];
  for (const f of facts.values()) {
    if (!f.NameOfTheShareholder || f.ShareholdingAsAPercentageOfTotalNumberOfShares == null) continue;
    const pct = Number(String(f.ShareholdingAsAPercentageOfTotalNumberOfShares).replace(/,/g, ""));
    const category = categoryFromAxis(f.axis);
    if (!category || !Number.isFinite(pct)) continue;
    rows.push({ category, pct });
  }

  if (!rows.length) return null;
  const maxPct = Math.max(...rows.map(x => x.pct));
  if (maxPct <= 1.000001) rows.forEach(x => { x.pct *= 100; });
  return rows;
}

function normalizeDate(value) {
  const s = String(value || "").trim().toUpperCase();
  const m = s.match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/);
  if (!m) return s || "Latest";
  return `${m[1].padStart(2, "0")}-${m[2]}-${m[3]}`;
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
    const xml = await fetchText(xbrl);
    const rows = parseXbrl(xml);
    if (!rows) return out;
    const sums = { mf: 0, fii: 0, retail: 0 };
    const seen = { mf: false, fii: false, retail: false };
    for (const row of rows) {
      sums[row.category] += row.pct;
      seen[row.category] = true;
    }
    out.mf = seen.mf ? sums.mf : null;
    out.fii = seen.fii ? sums.fii : null;
    out.retail = seen.retail ? sums.retail : null;
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
      const selected = master
        .filter(x => x.xbrl || x.date)
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
        .slice(0, 4);
      if (!selected.length) throw new Error("NSE ownership filings unavailable");

      const rows = await Promise.all(selected.map(buildQuarter));
      const result = {
        symbol: key,
        rows,
        source: "NSE Corporate Filings · Shareholding Pattern + linked XBRL"
      };
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
    try {
      res.json(await fetchOwnership(req.params.symbol));
    } catch (e) {
      res.status(502).json({ error: e.message || "Ownership data unavailable" });
    }
  });
});
