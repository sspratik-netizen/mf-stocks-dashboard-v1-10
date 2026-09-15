// Adds quarterly NSE shareholding-pattern data to the stock details page.
// NSE shareholding filings are quarterly. We use the summary rows from the
// linked XBRL/iXBRL filing and do not infer individual buyer/seller identity.
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
  const rows = Array.isArray(json) ? json : (Array.isArray(json && json.data) ? json.data : []);
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

function cleanText(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value) {
  return cleanText(String(value || "").replace(/<[^>]*>/g, " "));
}

function htmlRows(html) {
  const rows = [];
  const trRe = new RegExp("<tr[^>]*>([^]*?)</tr>", "gi");
  const cellRe = new RegExp("<t[dh][^>]*>([^]*?)</t[dh]>", "gi");
  let rm;
  while ((rm = trRe.exec(html))) {
    const cells = [];
    let cm;
    cellRe.lastIndex = 0;
    while ((cm = cellRe.exec(rm[1]))) cells.push(stripTags(cm[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function dateKey(value) {
  const s = String(value || "").trim().toUpperCase();
  const m = s.match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/);
  if (m) {
    const months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
    if (months[m[2]] !== undefined) return Date.UTC(Number(m[3]), months[m[2]], Number(m[1]));
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDate(value) {
  const s = String(value || "").trim().toUpperCase();
  const m = s.match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/);
  return m ? `${m[1].padStart(2, "0")}-${m[2]}-${m[3]}` : (s || "Latest");
}

function num(value) {
  const n = Number(String(value || "").replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function isSummaryRow(row) {
  return row.length >= 8 && /^[a-z]$/i.test(row[0] || "");
}

function categoryKey(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function parseSummary(html) {
  const rows = htmlRows(html);
  let mf = null;
  let fii = 0;
  let fiiSeen = false;
  let retail = 0;
  let retailSeen = false;

  for (const row of rows) {
    if (!isSummaryRow(row)) continue;
    const category = categoryKey(row[1]);
    const pct = num(row[7]);
    if (pct === null) continue;

    if (category === "mutualfunds" && mf === null) {
      mf = pct;
      continue;
    }

    if (category === "foreignportfolioinvestorcategoryi" || category === "foreignportfolioinvestorcategoryii" || category === "foreigninstitutionalinvestor") {
      fii += pct;
      fiiSeen = true;
      continue;
    }

    if (
      category.indexOf("residentindividual") >= 0 ||
      category.indexOf("nonresidentindividual") >= 0 ||
      category === "nri" ||
      category.indexOf("hinduundividedfamily") >= 0 ||
      category === "huf"
    ) {
      retail += pct;
      retailSeen = true;
    }
  }

  return {
    mf,
    fii: fiiSeen ? fii : null,
    retail: retailSeen ? retail : null
  };
}

async function buildQuarter(masterRow) {
  const out = {
    date: normalizeDate(masterRow.date),
    mf: null,
    fii: null,
    retail: null,
    promoter: num(masterRow.pr_and_prgrp)
  };

  const xbrl = String(masterRow.xbrl || "").trim();
  if (!xbrl) return out;

  try {
    const summary = parseSummary(await fetchText(xbrl));
    out.mf = summary.mf;
    out.fii = summary.fii;
    out.retail = summary.retail;
    return out;
  } catch (e) {
    console.warn(`NSE XBRL ownership ${out.date} unavailable:`, e.message);
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
        .sort((a, b) => dateKey(b.date) - dateKey(a.date))
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
