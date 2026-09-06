const express = require("express");
const path = require("path");
const config = require("./config/categories");
const schemeOverrides = require("./config/schemeOverrides");
const indexConfig = require("./config/indices");
const nifty50Fallback = require("./config/nifty50");
const IPO_UNIVERSE = require("./config/ipoUniverse");

const BREADTH_SOURCES = {
  "NIFTY 50": { yahoo: "^NSEI", csv: "ind_nifty50list.csv", niftyIndex: "NIFTY 50" },
  "NIFTY NEXT 50": { yahoo: "^NSMIDCP", csv: "ind_niftynext50list.csv", niftyIndex: "NIFTY NEXT 50" },
  "NIFTY 100": { yahoo: "^CNX100", csv: "ind_nifty100list.csv", niftyIndex: "NIFTY 100" },
  "NIFTY 200": { yahoo: "^CNX200", csv: "ind_nifty200list.csv", niftyIndex: "NIFTY 200" },
  "NIFTY 500": { yahoo: "^CRSLDX", csv: "ind_nifty500list.csv", niftyIndex: "NIFTY 500" },
  "NIFTY MIDCAP 150": { yahoo: "NIFTYMIDCAP150.NS", csv: "ind_niftymidcap150list.csv", niftyIndex: "NIFTY MIDCAP 150" },
  "NIFTY SMALLCAP 250": { yahoo: "NISM250.NS", csv: "ind_niftysmallcap250list.csv", niftyIndex: "NIFTY SMALLCAP 250" },
  "NIFTY BANK": { yahoo: "^NSEBANK", csv: "ind_niftybanklist.csv", niftyIndex: "NIFTY BANK" },
  "NIFTY FINANCIAL SERVICES": { yahoo: "^CNXFINANCE", csv: "ind_niftyfinancelist.csv", niftyIndex: "NIFTY FINANCIAL SERVICES" },
  "NIFTY IT": { yahoo: "^CNXIT", csv: "ind_niftyitlist.csv", niftyIndex: "NIFTY IT" },
  "NIFTY PHARMA": { yahoo: "^CNXPHARMA", csv: "ind_niftypharmalist.csv", niftyIndex: "NIFTY PHARMA" }
};

const app = express();
const PORT = process.env.PORT || 3000;

const MFAPI_BASE = "https://api.mfapi.in";
const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const NSE_BASE = "https://www.nseindia.com";
const NIFTY_INDICES_BASE = "https://www.niftyindices.com/IndexConstituent";

const REQUEST_TIMEOUT_MS = 15000;
const DATA_CACHE_TTL_MS = 5 * 60 * 1000;
const SCHEME_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const BREADTH_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const WEEKLY_THRESHOLD = -5.0;
const MONTHLY_THRESHOLD = -10.0;

let dashboardCache = { timestamp: 0, data: null };
const schemeCache = new Map();
const breadthCache = new Map();
const patternPriceCache = new Map();
const stockDirectoryCache = { timestamp: 0, data: [] };
let patternScanCache = { timestamp: 0, data: null, key: "" };
const PATTERN_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PATTERN_HISTORY_DAYS = 430;
const PATTERN_RECENT_TRADING_DAYS = 30;

app.use(express.static(path.join(__dirname, "public")));

function parseDate(dateString) {
  const [dd, mm, yyyy] = dateString.split("-").map(Number);
  return new Date(Date.UTC(yyyy, mm - 1, dd));
}

function subtractDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() - days);
  return result;
}

function findNavOnOrBefore(data, targetDate) {
  for (const item of data) {
    if (parseDate(item.date) <= targetDate) {
      return { nav: Number(item.nav), date: item.date };
    }
  }
  return null;
}

function percentageChange(latest, previous) {
  if (!Number.isFinite(latest) || !Number.isFinite(previous) || previous === 0) {
    return null;
  }
  return ((latest - previous) / previous) * 100;
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(fund|plan|option|growth|direct|regular|fof|index)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenScore(query, schemeName) {
  const qTokens = normalize(query).split(" ").filter(Boolean);
  const s = normalize(schemeName);
  let score = 0;
  for (const token of qTokens) {
    if (s.includes(token)) score += token.length >= 4 ? 2 : 1;
  }
  return score;
}

function isDirectGrowth(name) {
  const n = String(name || "").toLowerCase();
  return n.includes("direct") && n.includes("growth");
}

async function fetchJson(url, userAgent = "MF-Breadth-Dashboard/1.4") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": userAgent,
        "Accept": "application/json,text/plain,*/*"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

const FUND_SEARCH_ALIASES = {
  "Bandhan Nifty 200 Momentum 30 Index Fund": ["Bandhan Nifty200 Momentum 30 Index Fund", "Bandhan Nifty 200 Momentum 30"],
  "Aditya Birla Sun Life Nifty 200 Momentum 30 Index Fund": ["Aditya Birla Sun Life Nifty200 Momentum 30 Index Fund", "Aditya Birla Sun Life Nifty 200 Momentum 30"],
  "Nippon India Nifty 200 Momentum 30 Index Fund": ["Nippon India Nifty200 Momentum 30 Index Fund", "Nippon India Nifty 200 Momentum 30"],
  "DSP Natural Resources & Energy": ["DSP Natural Resources and New Energy Fund", "DSP Natural Resources New Energy"],
  "Nippon India Power & Infrastructure Fund": ["Nippon India Power and Infrastructure Fund", "Nippon India Power Infrastructure"],
  "HDFC Mid-Cap Opportunities": ["HDFC Mid Cap Fund", "HDFC Mid-Cap Fund"],
  "Bharat Bond ETF FoF Apr 2033": ["BHARAT Bond ETF FOF - April 2033", "BHARAT Bond ETF FOF April 2033", "Bharat Bond ETF FOF April 2033"],
  "ICICI Prudential Corporate Bond Fund": ["ICICI Prudential Corporate Bond Fund Direct Growth", "ICICI Prudential Corporate Bond Fund - Direct Plan - Growth"],
  "Invesco India Smallcap Fund": ["Invesco India Smallcap Fund - Direct Plan - Growth", "Invesco India Small Cap Fund Direct Growth"],
  "Parag Parikh Dynamic Asset Allocation": ["Parag Parikh Dynamic Asset Allocation Fund - Direct Plan - Growth", "Parag Parikh Dynamic Asset Allocation Fund Direct Growth"]
};

async function resolveScheme(fundName) {
  const override = schemeOverrides[fundName];
  if (override) {
    return { code: String(override), schemeName: fundName, source: "explicit current-scheme mapping" };
  }

  const cached = schemeCache.get(fundName);
  if (cached && Date.now() - cached.timestamp < SCHEME_CACHE_TTL_MS) return cached.value;

  const queries = [fundName, ...(FUND_SEARCH_ALIASES[fundName] || [])];
  const all = [];
  // Do not stop at the first search result: MFAPI search order can return an
  // older or regular-plan scheme before the current Direct Growth plan.
  for (const q of queries) {
    try {
      const results = await fetchJson(`${MFAPI_BASE}/mf/search?q=${encodeURIComponent(q)}`);
      if (Array.isArray(results)) all.push(...results);
    } catch (_) {}
  }
  if (!all.length) throw new Error("Scheme search returned no results");

  const unique = [...new Map(all.filter(x => x?.schemeCode).map(x => [String(x.schemeCode), x])).values()];
  const directGrowth = unique.filter(x => isDirectGrowth(x.schemeName));
  const candidates = directGrowth.length ? directGrowth : unique;
  candidates.sort((a,b) => {
    const scoreA = tokenScore(fundName,a.schemeName) + (isDirectGrowth(a.schemeName) ? 100 : 0);
    const scoreB = tokenScore(fundName,b.schemeName) + (isDirectGrowth(b.schemeName) ? 100 : 0);
    return scoreB - scoreA;
  });
  const selected = candidates[0];
  if (!selected?.schemeCode) throw new Error("Could not resolve scheme code");

  const value = { code: String(selected.schemeCode), schemeName: selected.schemeName, source: "MFAPI search/alias" };
  schemeCache.set(fundName, { timestamp: Date.now(), value });
  return value;
}

function calculateSignal(row, categoryRows) {
  const valid = categoryRows.filter(
    x => x.status === "OK" &&
         x.change180d !== null &&
         x.change360d !== null
  );

  // Quality/momentum rank: long-term trend is deliberately weighted more than
  // the short-term correction, so a temporary fall can still produce an
  // attractive opportunity signal.
  valid.sort((a, b) => {
    const scoreA = 0.4 * (a.change180d ?? -999) + 0.6 * (a.change360d ?? -999);
    const scoreB = 0.4 * (b.change180d ?? -999) + 0.6 * (b.change360d ?? -999);
    return scoreB - scoreA;
  });

  const rank = valid.findIndex(x => x.fund === row.fund) + 1;
  const total = valid.length;

  const d30 = row.change30d;
  const d180 = row.change180d;
  const d360 = row.change360d;

  let signal = "NEUTRAL";
  let signalText = "Neutral";

  if (
    d30 !== null && d180 !== null && d360 !== null &&
    d30 <= -8 && d180 > 5 && d360 > 10 && rank > 0 && rank <= 2
  ) {
    signal = "STRONG_ACCUMULATION";
    signalText = "Strong Accumulation";
  } else if (
    d30 !== null && d180 !== null && d360 !== null &&
    d30 <= -5 && d180 > 0 && d360 > 0 && rank > 0 && rank <= 2
  ) {
    signal = "ATTRACTIVE";
    signalText = "Attractive";
  } else if (
    d30 !== null && d180 !== null && d360 !== null &&
    d30 <= -3 && d180 > 0 && d360 > 0
  ) {
    signal = "WATCH";
    signalText = "Watch";
  } else if (
    d30 !== null && d180 !== null && d360 !== null &&
    d30 > 0 && d180 > 5 && d360 > 10 && rank > 0 && rank <= 2
  ) {
    signal = "MOMENTUM";
    signalText = "Momentum";
  }

  // Opportunity score is a screening score, not a valuation score or investment advice.
  let opportunityScore = null;
  if (d30 !== null && d180 !== null && d360 !== null && rank > 0) {
    const correction = Math.max(0, Math.min(20, -d30 * 2));
    const trend = Math.max(0, Math.min(40, d180 * 1.5));
    const longTerm = Math.max(0, Math.min(30, d360 * 0.75));
    const rankPoints = total > 1 ? Math.max(0, 10 - ((rank - 1) * 10 / (total - 1))) : 10;
    opportunityScore = Math.round(
      Math.min(100, correction + trend + longTerm + rankPoints)
    );
  }

  return {
    categoryRank: rank > 0 ? rank : null,
    categoryTotal: total,
    signal,
    signalText,
    opportunityScore
  };
}

async function fetchFund(fundName, category) {
  try {
    const resolved = await resolveScheme(fundName);
    const json = await fetchJson(`${MFAPI_BASE}/mf/${resolved.code}`);

    if (!json?.data || !Array.isArray(json.data) || json.data.length === 0) {
      throw new Error("NAV data missing");
    }

    const latest = json.data[0];
    const latestNav = Number(latest.nav);
    const latestDate = parseDate(latest.date);
	// Prevent closed/legacy schemes from being shown as current.
	const ageDays = Math.floor(
		(Date.now() - latestDate.getTime()) / 86400000
	);

	if (ageDays > 10) {
		throw new Error(
			`Stale NAV data: latest NAV is ${latest.date}. ` +
			`The selected scheme may be a closed/legacy scheme.`
		);
	}
    if (!Number.isFinite(latestNav)) {
      throw new Error("Invalid latest NAV");
    }

    const periods = {
      change7d: 7,
      change30d: 30,
      change180d: 180,
      change360d: 360
    };

    const history = {};
    for (const [key, days] of Object.entries(periods)) {
      const target = subtractDays(latestDate, days);
      const point = findNavOnOrBefore(json.data, target);
      history[key] = point
        ? { nav: point.nav, date: point.date, change: percentageChange(latestNav, point.nav) }
        : null;
    }

    return {
      fund: fundName,
      category,
      status: "OK",
      schemeCode: resolved.code,
      mfapiSchemeName: resolved.schemeName,
      latestNav,
      latestDate: latest.date,
      change7d: history.change7d?.change ?? null,
      change30d: history.change30d?.change ?? null,
      change180d: history.change180d?.change ?? null,
      change360d: history.change360d?.change ?? null,
      referenceDates: {
        d7: history.change7d?.date ?? null,
        d30: history.change30d?.date ?? null,
        d180: history.change180d?.date ?? null,
        d360: history.change360d?.date ?? null
      }
    };
  } catch (error) {
    return {
      fund: fundName,
      category,
      status: "ERROR",
      error: error.name === "AbortError" ? "API request timed out" : error.message
    };
  }
}

async function runWithConcurrency(items, worker, concurrency = 5) {
  const results = new Array(items.length);
  let next = 0;

  async function runner() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, runner)
  );

  return results;
}

function flattenConfig() {
  return config.categories.flatMap(group =>
    group.funds.map(fund => ({
      name: fund,
      category: group.category
    }))
  );
}

async function getDashboardData(forceRefresh = false) {
  const now = Date.now();

  if (!forceRefresh && dashboardCache.data &&
      now - dashboardCache.timestamp < DATA_CACHE_TTL_MS) {
    return dashboardCache.data;
  }

  const items = flattenConfig();
  const results = await runWithConcurrency(
    items,
    item => fetchFund(item.name, item.category),
    5
  );

  const successful = results.filter(x => x.status === "OK");
  const failed = results.filter(x => x.status === "ERROR");

  // Calculate category rank/signals after all funds are available.
  const byCategory = new Map();
  for (const row of successful) {
    if (!byCategory.has(row.category)) byCategory.set(row.category, []);
    byCategory.get(row.category).push(row);
  }

  for (const row of successful) {
    Object.assign(row, calculateSignal(row, byCategory.get(row.category) || []));
  }

  successful.sort((a, b) => (a.change30d ?? 999) - (b.change30d ?? 999));

  const response = {
    updatedAt: new Date().toISOString(),
    plan: config.plan,
    totalFunds: items.length,
    categoryCount: config.categories.length,
    fundsPerCategory: Math.max(...config.categories.map(x => x.funds.length)),
    successfulCount: successful.length,
    failedCount: failed.length,
    categories: config.categories.map(x => x.category),
    results: successful,
    failed,
    thresholds: {
      weekly: WEEKLY_THRESHOLD,
      monthly: MONTHLY_THRESHOLD
    },
    signalRules: {
      strongAccumulation: "30D <= -8%, 180D > 5%, 360D > 10%, category rank <= 2",
      attractive: "30D <= -5%, 180D > 0%, 360D > 0%, category rank <= 2",
      watch: "30D <= -3%, 180D > 0%, 360D > 0%",
      momentum: "30D > 0%, 180D > 5%, 360D > 10%, category rank <= 2"
    }
  };

  dashboardCache = { timestamp: now, data: response };
  return response;
}

// -------------------- MARKET BREADTH --------------------


// Fetch current index constituents from the public NSE Indices CSV files.
// The previous v1.7 build referenced this function but accidentally omitted it,
// which caused: "fetchNseConstituents is not defined" on Breadth and Patterns.
const constituentCache = new Map();

function parseCsvLine(line) {
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      out.push(cur.trim()); cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function parseConstituentCsv(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(x => x.trim());
  if (lines.length < 2) throw new Error("Constituent CSV is empty");

  const headers = parseCsvLine(lines[0]).map(x => x.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  const findCol = (...names) => names.map(n => headers.indexOf(n)).find(i => i >= 0);
  const symbolCol = findCol("symbol", "tradingsymbol", "securitysymbol");
  const companyCol = findCol("companyname", "company", "nameofcompany");
  const industryCol = findCol("industry", "industryname");
  if (symbolCol == null) throw new Error("Constituent CSV has no Symbol column");

  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const symbol = String(symbolCol == null ? "" : (cols[symbolCol] || "")).trim().toUpperCase();
    if (!symbol || symbol === "SYMBOL") continue;
    const company = String(companyCol == null ? symbol : (cols[companyCol] || symbol)).trim();
    const industry = String(industryCol == null ? "" : (cols[industryCol] || "")).trim();
    rows.push([symbol, company, industry]);
  }
  const seen = new Set();
  return rows.filter(x => !seen.has(x[0]) && seen.add(x[0]));
}

async function fetchNseConstituents(indexName) {
  const key = String(indexName || "").trim().toUpperCase();
  const source = BREADTH_SOURCES[key];
  if (!source) throw new Error(`No constituent source configured for ${key}`);

  const cached = constituentCache.get(key);
  if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) return cached.data;

  const url = `${NIFTY_INDICES_BASE}/${source.csv}`;
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
          "Accept": "text/csv,text/plain,*/*",
          "Referer": "https://www.niftyindices.com/"
        }
      });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`Nifty Indices CSV HTTP ${response.status}`);
      const text = await response.text();
      const symbols = parseConstituentCsv(text);
      if (!symbols.length) throw new Error("Nifty Indices CSV returned no constituents");
      const data = { symbols, source: `NSE Indices public constituent CSV (${source.csv})` };
      constituentCache.set(key, { timestamp: Date.now(), data });
      return data;
    } catch (e) {
      lastError = e;
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Keep Nifty 50 usable if the external CSV is temporarily unavailable.
  if (key === "NIFTY 50" && Array.isArray(nifty50Fallback) && nifty50Fallback.length) {
    const symbols = nifty50Fallback.map(x => Array.isArray(x) ? x : [x, x, ""]);
    return { symbols, source: "Built-in Nifty 50 fallback" };
  }
  throw new Error(`Unable to fetch ${key} constituents: ${lastError?.message || "unknown error"}`);
}


// Shared Yahoo Finance historical-price loader used by Market Breadth and Pattern Scanner.
// v1.7.2: restored the missing function and added retry/backoff for Yahoo throttling.
const IPO_YAHOO_SYMBOL_ALIASES = {
  // Yahoo symbol aliases / historical continuity for IPO names.
  // Add only verified mappings; this avoids silently substituting another company.
  BSE: ["BSE.NS"],
  FEDERALBNK: ["FEDERALBNK.NS"],
  LTIM: ["LTIM.NS", "LTIM.NS"],
  LTM: ["LTM.NS", "LTIM.NS"],
  // IPO symbol aliases where the exchange/Yahoo ticker differs from the curated short code.
  INDGN: ["INDEGENE.NS", "INDEGENE.BO"]
};

const YAHOO_TICKER_ALIASES = {
  // NSE changed LTIMindtree's trading symbol from LTIM to LTM on 27-Feb-2026.
  // Yahoo keeps the older history under LTIM.NS, so breadth/pattern calculations
  // must stitch both symbols to obtain a continuous history.
  LTM: ["LTM.NS", "LTIM.NS"],
  // IPO symbol aliases where the exchange/Yahoo ticker differs from the curated short code.
  INDGN: ["INDEGENE.NS", "INDEGENE.BO"]
};


// Official Nifty Indices historical price-index loader.
// Yahoo does not publish every NSE index under a stable ticker (for example
// Nifty Financial Services and Nifty Smallcap 250 return 404). Breadth uses
// the official Nifty Indices historical CLOSE as its benchmark instead.
const NIFTY_INDEX_HISTORY_URL = "https://www.niftyindices.com/BackPage/getHistoricaldatatabletoString";
const NIFTY_INDEX_HISTORY_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "X-Requested-With": "XMLHttpRequest",
  "Referer": "https://www.niftyindices.com/reports/historical-data",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
  "Accept": "application/json,text/plain,*/*"
};

function formatNiftyDate(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${dd}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function parseNiftyHistoricalDate(value) {
  const m = String(value || "").trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (!m) return null;
  const months = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
  const month = months[m[2]];
  if (month == null) return null;
  return `${m[3]}-${String(month + 1).padStart(2,"0")}-${String(Number(m[1])).padStart(2,"0")}`;
}

async function fetchNiftyIndexHistory(indexName, days = 800) {
  const end = new Date();
  const start = new Date(end.getTime() - Math.max(300, Number(days) || 800) * 86400000);
  const cinfo = {
    name: indexName,
    startDate: formatNiftyDate(start),
    endDate: formatNiftyDate(end),
    indexName
  };
  const payload = { cinfo: JSON.stringify(cinfo).replace(/"/g, "'") };
  let lastError = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(NIFTY_INDEX_HISTORY_URL, {
        method: "POST",
        headers: NIFTY_INDEX_HISTORY_HEADERS,
        body: JSON.stringify(payload)
      });
      if (response.status === 429 || response.status === 403 || response.status === 503) {
        throw new Error(`Nifty Indices HTTP ${response.status}`);
      }
      if (!response.ok) throw new Error(`Nifty Indices HTTP ${response.status}`);
      const json = await response.json();
      let raw = json?.d ?? json;
      if (typeof raw === "string") {
        try { raw = JSON.parse(raw); } catch { /* some versions return already-parsed data */ }
      }
      if (!Array.isArray(raw) || !raw.length) {
        throw new Error(`No historical index data returned for ${indexName}`);
      }

      const rows = raw.map(r => ({
        date: parseNiftyHistoricalDate(r.HistoricalDate || r.Date || r.date),
        open: Number(r.OPEN ?? r.Open),
        high: Number(r.HIGH ?? r.High),
        low: Number(r.LOW ?? r.Low),
        close: Number(r.CLOSE ?? r.Close),
        rawClose: Number(r.CLOSE ?? r.Close),
        adjustedClose: Number(r.CLOSE ?? r.Close)
      })).filter(r => r.date && Number.isFinite(r.close) && r.close > 0)
        .sort((a,b) => a.date.localeCompare(b.date));

      if (rows.length < 100) throw new Error(`Only ${rows.length} valid historical rows for ${indexName}`);
      return rows;
    } catch (e) {
      lastError = e;
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw new Error(`${indexName}: ${lastError?.message || "Nifty index history unavailable"}`);
}

async function fetchYahooHistory(ticker, days = 800) {
  const symbol = String(ticker || "").trim().toUpperCase();
  if (!symbol) throw new Error("Empty Yahoo symbol");

  const end = Math.floor(Date.now() / 1000);
  const start = end - Math.max(30, Number(days) || 420) * 86400;
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  let lastError = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    const host = hosts[attempt % hosts.length];
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${start}&period2=${end}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
          "Accept": "application/json,text/plain,*/*"
        }
      });
      if (response.status === 429 || response.status === 503) {
        throw new Error(`Yahoo throttled request (${response.status})`);
      }
      if (!response.ok) throw new Error(`Yahoo HTTP ${response.status}`);
      const json = await response.json();
      const result = json?.chart?.result?.[0];
      if (!result) throw new Error(json?.chart?.error?.description || "No Yahoo chart result");

      const quote = result.indicators?.quote?.[0] || {};
      const adjusted = result.indicators?.adjclose?.[0]?.adjclose || [];
      const rows = [];
      for (let i = 0; i < (result.timestamp || []).length; i++) {
        const rawClose = Number(quote.close?.[i]);
        if (!Number.isFinite(rawClose) || rawClose <= 0) continue;
        const adjClose = Number(adjusted[i]);
        const close = Number.isFinite(adjClose) && adjClose > 0 ? adjClose : rawClose;
        rows.push({
          date: new Date(result.timestamp[i] * 1000).toISOString().slice(0, 10),
          open: Number(quote.open?.[i]),
          high: Number(quote.high?.[i]),
          low: Number(quote.low?.[i]),
          close,
          rawClose,
          adjustedClose: close,
          volume: Number(quote.volume?.[i])
        });
      }
      if (rows.length < 2) throw new Error("Insufficient Yahoo price history");
      return rows;
    } catch (e) {
      lastError = e;
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 700 * Math.pow(2, attempt)));
      }
    }
  }
  throw new Error(`${symbol}: ${lastError?.message || "Yahoo price history unavailable"}`);
}

function yahooSymbol(nseSymbol) {
  return `${nseSymbol}.NS`;
}

async function fetchYahooHistoryForNseSymbol(nseSymbol, days = 800) {
  const symbol = String(nseSymbol || "").trim().toUpperCase();
  const tickers = YAHOO_TICKER_ALIASES[symbol] || [yahooSymbol(symbol)];
  const merged = new Map();
  let lastError = null;
  for (const ticker of tickers) {
    try {
      const rows = await fetchYahooHistory(ticker, days);
      for (const row of rows) merged.set(row.date, row);
    } catch (e) {
      lastError = e;
    }
  }
  const rows = [...merged.values()].sort((a,b)=>a.date.localeCompare(b.date));
  if (rows.length < 2) throw new Error(`${symbol}: ${lastError?.message || "Yahoo price history unavailable"}`);
  return rows;
}

function dateToUnixSeconds(date) {
  return Math.floor(date.getTime() / 1000);
}

function mean(values) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function calculateSMA(values, period, index) {
  if (index < period - 1) return null;
  const window = values.slice(index - period + 1, index + 1);
  return mean(window);
}

function breadthClose(row) {
  // Technical breadth must use the actual closing price, not dividend-adjusted close.
  // SMA20/50/100/200 and RS55 are price-based calculations.
  return Number.isFinite(row?.rawClose) ? row.rawClose : row?.close;
}

const MAX_BREADTH_STALE_DAYS = 7;

function isFreshEnough(row, targetDate) {
  if (!row?.date || !targetDate) return false;
  const age = (Date.parse(targetDate) - Date.parse(row.date)) / 86400000;
  return Number.isFinite(age) && age >= 0 && age <= MAX_BREADTH_STALE_DAYS;
}

function calculateRS55(stockRows, benchmarkRows, date) {
  const stockIndex = stockRows.findIndex(x => x.date === date);
  const benchmarkIndex = benchmarkRows.findIndex(x => x.date === date);
  if (stockIndex < 55 || benchmarkIndex < 55) return null;

  const stockStart = breadthClose(stockRows[stockIndex - 55]);
  const stockEnd = breadthClose(stockRows[stockIndex]);
  const benchmarkStart = breadthClose(benchmarkRows[benchmarkIndex - 55]);
  const benchmarkEnd = breadthClose(benchmarkRows[benchmarkIndex]);
  if (![stockStart, benchmarkStart, stockEnd, benchmarkEnd].every(Number.isFinite)) return null;

  return (((stockEnd / stockStart) - 1) - ((benchmarkEnd / benchmarkStart) - 1)) * 100;
}

function latestRowOnOrBefore(rows, date) {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].date <= date) return { row: rows[i], index: i };
  }
  return null;
}

function smaAtDate(rows, date, period) {
  const hit = latestRowOnOrBefore(rows, date);
  if (!hit || !isFreshEnough(hit.row, date) || hit.index < period - 1) return null;
  const values = rows.slice(hit.index - period + 1, hit.index + 1).map(breadthClose);
  if (values.length !== period || !values.every(Number.isFinite)) return null;
  return mean(values);
}

function calculateRS55AtDate(stockRows, benchmarkRows, date) {
  const sEnd = latestRowOnOrBefore(stockRows, date);
  const bEnd = latestRowOnOrBefore(benchmarkRows, date);
  if (!sEnd || !bEnd || !isFreshEnough(sEnd.row, date) || !isFreshEnough(bEnd.row, date) || sEnd.index < 55 || bEnd.index < 55) return null;
  const stockStart = breadthClose(stockRows[sEnd.index - 55]);
  const stockEnd = breadthClose(sEnd.row);
  const benchmarkStart = breadthClose(benchmarkRows[bEnd.index - 55]);
  const benchmarkEnd = breadthClose(bEnd.row);
  if (![stockStart, benchmarkStart, stockEnd, benchmarkEnd].every(Number.isFinite)) return null;
  return (((stockEnd / stockStart) - 1) - ((benchmarkEnd / benchmarkStart) - 1)) * 100;
}

function computeBreadthForDate(stockResults, benchmarkSeries, date, includeDetails = false, requireExactDate = false) {
  const details = {
    rs55: { above: [], below: [], unavailable: [] },
    sma20: { above: [], below: [], unavailable: [] },
    sma50: { above: [], below: [], unavailable: [] },
    sma100: { above: [], below: [], unavailable: [] },
    sma200: { above: [], below: [], unavailable: [] }
  };
  const counts = { rs55: 0, sma20: 0, sma50: 0, sma100: 0, sma200: 0 };
  const denoms = { rs55: 0, sma20: 0, sma50: 0, sma100: 0, sma200: 0 };

  for (const stock of stockResults) {
    const hit = requireExactDate
      ? (() => {
          const index = stock.rows.findIndex(x => x.date === date);
          return index >= 0 ? { row: stock.rows[index], index } : null;
        })()
      : latestRowOnOrBefore(stock.rows, date);

    if (!hit || (!requireExactDate && !isFreshEnough(hit.row, date))) {
      if (includeDetails) {
        Object.values(details).forEach(d => d.unavailable.push({
          symbol: stock.symbol, company: stock.company, reason: requireExactDate
            ? `No closing price available on exact breadth date ${date}`
            : "No fresh price on or before date"
        }));
      }
      continue;
    }

    const close = breadthClose(hit.row);
    if (!Number.isFinite(close) || close <= 0) continue;
    const item = {
      symbol: stock.symbol,
      company: stock.company,
      priceDate: hit.row.date,
      close
    };

    const exactOrRecent = (rows, targetDate) => {
      if (!requireExactDate) return latestRowOnOrBefore(rows, targetDate);
      const idx = rows.findIndex(x => x.date === targetDate);
      return idx >= 0 ? { row: rows[idx], index: idx } : null;
    };

    const rs = (() => {
      const sEnd = exactOrRecent(stock.rows, date);
      const bEnd = exactOrRecent(benchmarkSeries, date);
      if (!sEnd || !bEnd || (!requireExactDate && (!isFreshEnough(sEnd.row, date) || !isFreshEnough(bEnd.row, date))) ||
          sEnd.index < 55 || bEnd.index < 55) return null;
      const vals = [
        breadthClose(stock.rows[sEnd.index - 55]),
        breadthClose(sEnd.row),
        breadthClose(benchmarkSeries[bEnd.index - 55]),
        breadthClose(bEnd.row)
      ];
      if (!vals.every(Number.isFinite)) return null;
      return (((vals[1] / vals[0]) - 1) - ((vals[3] / vals[2]) - 1)) * 100;
    })();

    const smaAtDateStrict = (rows, targetDate, period) => {
      const hit = exactOrRecent(rows, targetDate);
      if (!hit || (!requireExactDate && !isFreshEnough(hit.row, targetDate)) || hit.index < period - 1) return null;
      const values = rows.slice(hit.index - period + 1, hit.index + 1).map(breadthClose);
      return values.length === period && values.every(Number.isFinite) ? mean(values) : null;
    };

    const metrics = {
      rs55: rs,
      sma20: smaAtDateStrict(stock.rows, date, 20),
      sma50: smaAtDateStrict(stock.rows, date, 50),
      sma100: smaAtDateStrict(stock.rows, date, 100),
      sma200: smaAtDateStrict(stock.rows, date, 200)
    };

    for (const key of Object.keys(metrics)) {
      const value = metrics[key];
      if (!Number.isFinite(value)) {
        if (includeDetails) {
          const period = key === "rs55" ? "55" : key.replace("sma", "");
          details[key].unavailable.push({
            ...item,
            reason: key === "rs55" ? "Insufficient 55-trading-day history" : `Insufficient ${period}-trading-day history`
          });
        }
        continue;
      }

      denoms[key]++;
      if (key === "rs55") {
        // RS55 is stock return minus benchmark return. Recalculate the two
        // components for the audit tooltip so users can validate the result.
        const sEnd = exactOrRecent(stock.rows, date);
        const bEnd = exactOrRecent(benchmarkSeries, date);
        const stockStart = sEnd && sEnd.index >= 55 ? breadthClose(stock.rows[sEnd.index - 55]) : null;
        const stockEnd = sEnd ? breadthClose(sEnd.row) : null;
        const benchStart = bEnd && bEnd.index >= 55 ? breadthClose(benchmarkSeries[bEnd.index - 55]) : null;
        const benchEnd = bEnd ? breadthClose(bEnd.row) : null;
        const stockReturn = [stockStart, stockEnd].every(Number.isFinite) ? ((stockEnd / stockStart) - 1) * 100 : null;
        const benchmarkReturn = [benchStart, benchEnd].every(Number.isFinite) ? ((benchEnd / benchStart) - 1) * 100 : null;
        const auditItem = includeDetails ? {
          ...item,
          stockReturn,
          benchmarkReturn,
          rs55: value
        } : item;

        if (value > 0) {
          counts[key]++;
          if (includeDetails) details[key].above.push(auditItem);
        } else if (includeDetails) {
          details[key].below.push(auditItem);
        }
      } else {
        const auditItem = includeDetails ? {
          ...item,
          sma: value,
          difference: close - value,
          differencePct: ((close / value) - 1) * 100
        } : item;
        if (close > value) {
          counts[key]++;
          if (includeDetails) details[key].above.push(auditItem);
        } else if (includeDetails) {
          details[key].below.push(auditItem);
        }
      }
    }
  }

  if (!Object.values(denoms).some(x => x > 0)) return null;
  const pct = key => denoms[key] ? (counts[key] / denoms[key]) * 100 : null;
  return {
    date,
    total: stockResults.filter(s => requireExactDate
      ? s.rows.some(x => x.date === date)
      : latestRowOnOrBefore(s.rows, date)
    ).length,
    rs55: counts.rs55, sma20: counts.sma20, sma50: counts.sma50, sma100: counts.sma100, sma200: counts.sma200,
    rs55Denom: denoms.rs55, sma20Denom: denoms.sma20, sma50Denom: denoms.sma50, sma100Denom: denoms.sma100, sma200Denom: denoms.sma200,
    rs55Pct: pct("rs55"), sma20Pct: pct("sma20"), sma50Pct: pct("sma50"), sma100Pct: pct("sma100"), sma200Pct: pct("sma200"),
    ...(includeDetails ? {details} : {})
  };
}

async function getBreadthData(indexName, forceRefresh = false) {
  const cached = breadthCache.get(indexName);
  if (!forceRefresh && cached &&
      Date.now() - cached.timestamp < BREADTH_CACHE_TTL_MS) {
    return cached.data;
  }

  const constituentResult = await fetchNseConstituents(indexName);
  const constituents = constituentResult.symbols;

  const source = BREADTH_SOURCES[indexName];
  const benchmarkRows = await fetchNiftyIndexHistory(source.niftyIndex, 800);

  const stockResults = await runWithConcurrency(
    constituents,
    async ([symbol, company]) => {
      try {
        const rows = await fetchYahooHistoryForNseSymbol(symbol, 800);
        return { symbol, company, rows };
      } catch (error) {
        return { symbol, company, rows: [], error: error.message };
      }
    },
    6
  );

  const validStocks = stockResults.filter(x => x.rows.length > 0);

  // Last 30 trading sessions available in the benchmark history.
  const dates = benchmarkRows
    .map(x => x.date)
    .slice(-30);

  const daily = [];
  for (const date of dates) {
    const row = computeBreadthForDate(
      validStocks,
      benchmarkRows,
      date,
      date === dates[dates.length - 1],
      date === dates[dates.length - 1]
    );
    if (row) daily.push(row);
  }

  const latest = daily[daily.length - 1] || null;

  const response = {
    index: indexName,
    updatedAt: new Date().toISOString(),
    calculation: {
      rs55: "Stock 55-trading-day price return minus official Nifty benchmark 55-trading-day price return. RS55 > 0 = outperforming.",
      sma: "Percentage of valid constituents whose actual closing price is above the respective SMA. Dividend-adjusted close is not used.",
      history: "Last 30 available benchmark trading sessions using the current constituent list. Historical reconstitution-aware breadth requires archived constituent files.",
      staleDataRule: `For the latest breadth row, a constituent must have an exact closing-price date equal to the breadth date; previous-day prices are not substituted. Historical rows allow a price up to ${MAX_BREADTH_STALE_DAYS} calendar days old.`
    },
    constituentCount: constituents.length,
    constituentSource: constituentResult.source,
    benchmarkSymbol: source.niftyIndex,
    benchmarkSource: "Nifty Indices official historical price index data",
    benchmarkLatest: benchmarkRows.length ? { date: benchmarkRows.at(-1).date, close: breadthClose(benchmarkRows.at(-1)) } : null,
    priceDataLoaded: validStocks.length,
    priceDataFailed: stockResults.length - validStocks.length,
    latest,
    latestValidation: latest ? {
      date: latest.date,
      denominators: {
        rs55: latest.rs55Denom, sma20: latest.sma20Denom, sma50: latest.sma50Denom,
        sma100: latest.sma100Denom, sma200: latest.sma200Denom
      },
      note: "Latest row uses exact-date stock closes only. Each metric uses its own valid-data denominator; stocks missing the exact latest date are excluded rather than substituted with a previous-day close."
    } : null,
    daily,
    failedSymbols: stockResults
      .filter(x => x.rows.length === 0)
      .map(x => ({ symbol: x.symbol, company: x.company, error: x.error }))
  };

  breadthCache.set(indexName, {
    timestamp: Date.now(),
    data: response
  });

  return response;
}


// -------------------- CHART PATTERN SCANNER --------------------

function linearRegression(points) {
  if (!points.length) return { slope: 0, intercept: 0, r2: 0 };
  const n = points.length;
  const sx = points.reduce((a, p) => a + p.x, 0);
  const sy = points.reduce((a, p) => a + p.y, 0);
  const sxx = points.reduce((a, p) => a + p.x * p.x, 0);
  const sxy = points.reduce((a, p) => a + p.x * p.y, 0);
  const syy = points.reduce((a, p) => a + p.y * p.y, 0);
  const den = n * sxx - sx * sx;
  if (!den) return { slope: 0, intercept: sy / n, r2: 0 };
  const slope = (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  const rDen = Math.sqrt(Math.max(0, (n * sxx - sx*sx) * (n * syy - sy*sy)));
  const r = rDen ? (n * sxy - sx * sy) / rDen : 0;
  return { slope, intercept, r2: r * r };
}

function pct(a, b) {
  return b ? ((a / b) - 1) * 100 : 0;
}

function localExtrema(closes, mode = "high", order = 3) {
  const out = [];
  for (let i = order; i < closes.length - order; i++) {
    let ok = true;
    for (let j = 1; j <= order; j++) {
      if (mode === "high") {
        if (closes[i] <= closes[i-j] || closes[i] < closes[i+j]) { ok = false; break; }
      } else {
        if (closes[i] >= closes[i-j] || closes[i] > closes[i+j]) { ok = false; break; }
      }
    }
    if (ok) out.push({ i, price: closes[i] });
  }
  return out;
}

function confidenceScore(values) {
  return Math.max(50, Math.min(98, Math.round(values.reduce((a,b)=>a+b,0) / values.length)));
}

function makePattern(type, direction, start, end, confidence, note, triggerPrice=null) {
  return {
    type, direction, startDate: start.date, endDate: end.date,
    confidence, note, triggerPrice,
    ageTradingDays: null
  };
}

function detectDoublePatterns(series, windowSize) {
  const c = series.slice(-windowSize);
  const closes = c.map(x => x.close);
  const highs = localExtrema(closes, "high", 3);
  const lows = localExtrema(closes, "low", 3);
  const found = [];

  // A classical double reversal needs a genuine trend before the first
  // extremum.  Use both total move and regression slope so a sideways series
  // is not treated as a trend.
  function priorTrend(startIndex, direction) {
    const lookback = 30;
    if (startIndex < lookback) return false;
    const before = closes.slice(startIndex - lookback, startIndex);
    if (before.length < lookback || before.some(v => !Number.isFinite(v) || v <= 0)) return false;
    const first = before[0], last = before[before.length - 1];
    const move = pct(last, first);
    const reg = linearRegression(before.map((v, i) => ({x:i, y:v})));
    const normalizedSlope = first ? (reg.slope * lookback / first) * 100 : 0;
    if (direction === "up") return move >= 8 && normalizedSlope >= 0.15 && reg.r2 >= 0.20;
    return move <= -8 && normalizedSlope <= -0.15 && reg.r2 >= 0.20;
  }

  // DOUBLE TOP: prior uptrend, first peak is the higher peak, then a
  // meaningful reaction, followed by a lower/equal second peak.
  for (let a=0; a<highs.length; a++) {
    for (let b=a+1; b<highs.length; b++) {
      const x=highs[a], y=highs[b];
      const sep=y.i-x.i;
      if (sep < 15 || sep > Math.min(65, windowSize-1)) continue;
      if (!priorTrend(x.i, "up")) continue;

      // For a proper double top the second peak must NOT make a new high.
      // Allow a small tolerance for data noise, but reject higher second tops.
      const secondVsFirst = pct(y.price, x.price);
      if (secondVsFirst > 0.5 || secondVsFirst < -6) continue;

      const between=closes.slice(x.i,y.i+1);
      const valley=Math.min(...between);
      const depth=pct((x.price+y.price)/2,valley);
      if (depth < 8) continue;

      const conf=confidenceScore([
        94-Math.min(40,Math.abs(secondVsFirst)*6),
        Math.min(98, 60+depth*4),
        sep>=20?90:78
      ]);
      if (conf >= 78) found.push({
        type:"Double Top", direction:"Bearish",
        startDate:c[x.i].date,endDate:c[y.i].date,confidence:conf,
        note:"Prior uptrend, higher first peak, then a lower/equal second peak separated by a meaningful correction.",
        triggerPrice:valley,
        patternMeta:{firstIndex:x.i,secondIndex:y.i,firstPrice:x.price,secondPrice:y.price}
      });
    }
  }

  // DOUBLE BOTTOM: prior downtrend, first low is the lower low, then a
  // meaningful rebound, followed by a HIGHER second low.  This explicitly
  // rejects the common false-positive where the second dot is lower.
  for (let a=0; a<lows.length; a++) {
    for (let b=a+1; b<lows.length; b++) {
      const x=lows[a], y=lows[b];
      const sep=y.i-x.i;
      if (sep < 15 || sep > Math.min(65, windowSize-1)) continue;
      if (!priorTrend(x.i, "down")) continue;

      // The second bottom must be higher than the first bottom.
      // Require at least +1% separation so tiny rounding noise is not enough.
      const secondVsFirst = pct(y.price, x.price);
      if (secondVsFirst < 1.0 || secondVsFirst > 10) continue;

      const between=closes.slice(x.i,y.i+1);
      const peak=Math.max(...between);
      const height=pct(peak,(x.price+y.price)/2);
      if (height < 8) continue;

      // Require some recovery after the second bottom; a flat second low is
      // not enough to call a reversal pattern.
      const afterSecond=closes.slice(y.i, Math.min(closes.length, y.i+8));
      if (afterSecond.length < 4) continue;
      const postMove=pct(afterSecond.at(-1), y.price);
      if (postMove < 1.5) continue;

      const conf=confidenceScore([
        90+Math.min(8,secondVsFirst*1.5),
        Math.min(98, 60+height*4),
        sep>=20?90:78,
        postMove>=3?92:80
      ]);
      if (conf >= 78) found.push({
        type:"Double Bottom", direction:"Bullish",
        startDate:c[x.i].date,endDate:c[y.i].date,confidence:conf,
        note:"Prior downtrend, lower first bottom, higher second bottom, meaningful rebound, and early recovery after the second low.",
        triggerPrice:peak,
        patternMeta:{firstIndex:x.i,secondIndex:y.i,firstPrice:x.price,secondPrice:y.price}
      });
    }
  }
  return found;
}

function detectHeadShoulders(series, inverse=false) {
  const c=series.slice(-140);
  const values=c.map(x=>x.close);
  const ext=localExtrema(values, inverse?"low":"high", 4);
  const found=[];
  for(let i=0;i<ext.length-2;i++){
    const a=ext[i], b=ext[i+1], d=ext[i+2];
    const sep1=b.i-a.i, sep2=d.i-b.i;
    if(sep1<8||sep2<8||sep1>45||sep2>45) continue;
    const shoulderAvg=(a.price+d.price)/2;
    const shoulderDiff=Math.abs(pct(a.price,d.price));
    const headAdv=inverse ? (shoulderAvg-b.price)/shoulderAvg*100 : (b.price-shoulderAvg)/shoulderAvg*100;
    if(shoulderDiff<=8 && headAdv>=4){
      const type=inverse?"Inverse Head & Shoulders":"Head & Shoulders";
      const dir=inverse?"Bullish":"Bearish";
      const conf=confidenceScore([90-shoulderDiff*5,60+headAdv*7,sep1>12?82:65,sep2>12?82:65]);
      found.push({
        type,direction:dir,startDate:c[a.i].date,endDate:c[d.i].date,
        confidence:conf,note:"Three-swing structure with a distinct central head and balanced shoulders.",
        triggerPrice:null
      });
    }
  }
  return found;
}

function detectTrendStructures(series) {
  const found = [];
  for (const n of [60, 90]) {
    if (series.length < n) continue;
    const c = series.slice(-n);
    const vals = c.map(x => x.close);
    if (vals.some(v => !Number.isFinite(v) || v <= 0)) continue;

    const highs = localExtrema(vals, "high", 4).slice(-7);
    const lows = localExtrema(vals, "low", 4).slice(-7);
    if (highs.length < 3 || lows.length < 3) continue;

    const hiReg = linearRegression(highs.map(p => ({x:p.i, y:p.price})));
    const loReg = linearRegression(lows.map(p => ({x:p.i, y:p.price})));
    if (hiReg.r2 < .45 || loReg.r2 < .45) continue;

    const avgPrice = mean(vals) || 1;
    // Normalize slopes so a ₹10 slope means roughly the same thing for a ₹100
    // stock and a ₹1,000 stock. This makes wedge tests much less permissive.
    const hiSlope = (hiReg.slope / avgPrice) * 100;
    const loSlope = (loReg.slope / avgPrice) * 100;
    const firstHi = hiReg.intercept + hiReg.slope * highs[0].i;
    const lastHi = hiReg.intercept + hiReg.slope * highs[highs.length-1].i;
    const firstLo = loReg.intercept + loReg.slope * lows[0].i;
    const lastLo = loReg.intercept + loReg.slope * lows[lows.length-1].i;
    if (![firstHi,lastHi,firstLo,lastLo].every(Number.isFinite)) continue;

    const hiPct = pct(lastHi, firstHi);
    const loPct = pct(lastLo, firstLo);
    const firstWidth = Math.abs(firstHi - firstLo);
    const lastWidth = Math.abs(lastHi - lastLo);
    if (firstWidth <= avgPrice * 0.04 || lastWidth >= firstWidth * 0.82) continue;

    const convergence = 1 - (lastWidth / firstWidth);
    const current = vals[vals.length - 1];
    const upperNow = hiReg.intercept + hiReg.slope * (n - 1);
    const lowerNow = loReg.intercept + loReg.slope * (n - 1);
    // Do not call a pattern when the current price is clearly outside its own
    // fitted boundaries; this catches many false wedges caused by old spikes.
    const boundaryTolerance = avgPrice * 0.06;
    if (current > upperNow + boundaryTolerance || current < lowerNow - boundaryTolerance) continue;

    // Wedge: both boundaries slope in the same direction, but the inner
    // boundary must move materially faster. A nearly parallel pair is a channel.
    const risingWedge = hiSlope > 0.035 && loSlope > hiSlope + 0.025;
    const fallingWedge = loSlope < -0.035 && hiSlope < loSlope - 0.025;
    const triangle = hiSlope < -0.02 && loSlope > 0.02;
    const parallel = Math.abs(hiSlope - loSlope) <= 0.025;

    const confBase = 60 + Math.min(25, convergence * 45);
    if (risingWedge) {
      found.push({type:"Rising Wedge",direction:"Bullish",startDate:c[0].date,endDate:c[c.length-1].date,
        confidence:confidenceScore([confBase, 60+hiReg.r2*35, 60+loReg.r2*35]),
        note:"Both boundaries rise, but the lower boundary rises materially faster and the range contracts.",triggerPrice:null});
    } else if (fallingWedge) {
      found.push({type:"Falling Wedge",direction:"Bearish",startDate:c[0].date,endDate:c[c.length-1].date,
        confidence:confidenceScore([confBase, 60+hiReg.r2*35, 60+loReg.r2*35]),
        note:"Both boundaries fall, but the upper boundary falls materially faster and the range contracts.",triggerPrice:null});
    } else if (triangle) {
      found.push({type:"Triangle",direction:"Neutral",startDate:c[0].date,endDate:c[c.length-1].date,
        confidence:confidenceScore([confBase, 60+hiReg.r2*35, 60+loReg.r2*35]),
        note:"Upper highs trend down while lower lows trend up, creating a converging triangle.",triggerPrice:null});
    } else if (parallel && hiSlope > 0.02 && loSlope > 0.02) {
      found.push({type:"Rising Channel",direction:"Bullish",startDate:c[0].date,endDate:c[c.length-1].date,
        confidence:confidenceScore([65+hiReg.r2*25,65+loReg.r2*25,80]),
        note:"Price moves between rising, relatively parallel boundaries; no wedge contraction is assumed.",triggerPrice:null});
    } else if (parallel && hiSlope < -0.02 && loSlope < -0.02) {
      found.push({type:"Falling Channel",direction:"Bearish",startDate:c[0].date,endDate:c[c.length-1].date,
        confidence:confidenceScore([65+hiReg.r2*25,65+loReg.r2*25,80]),
        note:"Price moves between falling, relatively parallel boundaries; no wedge contraction is assumed.",triggerPrice:null});
    }
  }
  return found;
}

function detectFlag(series) {
  if(series.length<80) return [];
  const c=series.slice(-80);
  const vals=c.map(x=>x.close);
  const baseStart=vals[0], baseEnd=vals[24];
  const priorMove=pct(baseEnd,baseStart);
  const cons=c.slice(35);
  const reg=linearRegression(cons.map((x,i)=>({x:i,y:x.close})));
  const consMove=pct(cons[cons.length-1].close,cons[0].close);
  const out=[];
  if(Math.abs(priorMove)>=12 && Math.abs(consMove)<=Math.abs(priorMove)*0.45 && reg.r2>.15){
    const bullish=priorMove>0;
    const opposite=bullish ? consMove<3 : consMove>-3;
    if(opposite){
      out.push({
        type:"Flag",direction:bullish?"Bullish continuation":"Bearish continuation",
        startDate:c[0].date,endDate:c[c.length-1].date,
        confidence:confidenceScore([70+Math.min(20,Math.abs(priorMove)),55+reg.r2*35,75]),
        note:"Sharp prior move followed by a compact counter-trend consolidation.",
        triggerPrice:null
      });
    }
  }
  return out;
}

function detectRounding(series) {
  const found=[];

  // Rounding formations are deliberately stricter than a simple min/max
  // test.  A valid bottom/top should have a broad, smooth curvature, a
  // central vertex, and opposite slopes on the left/right halves. This keeps
  // ordinary channels, V-shapes and noisy reversals out of the list.
  function smooth(values, period=5) {
    return values.map((_,i)=>{
      const a=Math.max(0,i-period+1), b=i+1;
      const part=values.slice(a,b);
      return part.reduce((x,y)=>x+y,0)/part.length;
    });
  }

  function quadraticFit(values) {
    const n=values.length;
    if(n<20) return null;
    const pts=values.map((y,i)=>{
      const x=(i/(n-1))*2-1;
      return {x,y};
    });
    const sx=pts.reduce((a,p)=>a+p.x,0), sx2=pts.reduce((a,p)=>a+p.x*p.x,0);
    const sx3=pts.reduce((a,p)=>a+p.x**3,0), sx4=pts.reduce((a,p)=>a+p.x**4,0);
    const sy=pts.reduce((a,p)=>a+p.y,0), sxy=pts.reduce((a,p)=>a+p.x*p.y,0);
    const sx2y=pts.reduce((a,p)=>a+p.x*p.x*p.y,0);
    const A=[[n,sx,sx2,sy],[sx,sx2,sx3,sxy],[sx2,sx3,sx4,sx2y]];
    for(let i=0;i<3;i++){
      let pivot=i;
      for(let r=i+1;r<3;r++) if(Math.abs(A[r][i])>Math.abs(A[pivot][i])) pivot=r;
      if(Math.abs(A[pivot][i])<1e-12) return null;
      [A[i],A[pivot]]=[A[pivot],A[i]];
      const div=A[i][i]; for(let j=i;j<4;j++) A[i][j]/=div;
      for(let r=0;r<3;r++) if(r!==i){const f=A[r][i];for(let j=i;j<4;j++)A[r][j]-=f*A[i][j];}
    }
    const [c,b,a]=[A[0][3],A[1][3],A[2][3]];
    const meanY=sy/n;
    const ssTot=pts.reduce((q,p)=>q+(p.y-meanY)**2,0);
    const ssRes=pts.reduce((q,p)=>q+(p.y-(a*p.x*p.x+b*p.x+c))**2,0);
    const r2=ssTot?1-ssRes/ssTot:0;
    const vertexX=a ? -b/(2*a) : 99;
    return {a,b,c,r2,vertexX};
  }

  for(const n of [100,140,180]){
    if(series.length<n) continue;
    const c=series.slice(-n);
    const raw=c.map(x=>x.close);
    if(raw.some(v=>!Number.isFinite(v)||v<=0)) continue;
    const vals=smooth(raw,5);
    const q=quadraticFit(vals);
    if(!q || q.r2<0.50 || Math.abs(q.vertexX)>0.40) continue;

    const mid=Math.round((n-1)*(q.vertexX+1)/2);
    const leftEnd=Math.max(10,Math.floor(n*0.28));
    const rightStart=Math.min(n-10,Math.ceil(n*0.72));
    const leftReg=linearRegression(vals.slice(0,leftEnd).map((v,i)=>({x:i,y:v})));
    const rightVals=vals.slice(rightStart);
    const rightReg=linearRegression(rightVals.map((v,i)=>({x:i,y:v})));
    const scale=(vals.reduce((a,b)=>a+b,0)/n)||1;
    const leftSlope=(leftReg.slope/scale)*100;
    const rightSlope=(rightReg.slope/scale)*100;
    const left=vals[0], vertex=vals[mid], right=vals.at(-1);
    const leftToVertex=pct(vertex,left);
    const rightToVertex=pct(right,vertex);
    const endpointSym=Math.abs(pct(right,left));

    // Require both sides to actually turn in opposite directions and the
    // center to be materially below/above BOTH endpoints. This rejects the
    // false examples where the curve is still trending the wrong way.
    if(q.a>0 && leftSlope < -0.035 && rightSlope > 0.035 &&
       leftToVertex <= -10 && rightToVertex >= 8 && endpointSym <= 18){
      const conf=confidenceScore([
        68+q.r2*30,
        70+Math.min(20,Math.abs(leftToVertex)),
        70+Math.min(20,rightToVertex),
        Math.abs(q.vertexX)<0.2?92:82
      ]);
      if(conf>=80) found.push({
        type:"Rounding Bottom",direction:"Bullish",startDate:c[0].date,endDate:c[c.length-1].date,
        confidence:conf,note:"Broad U-shaped decline and recovery: left side falls, a central trough forms, and the right side recovers.",triggerPrice:null,
        patternMeta:{vertexIndex:mid}
      });
    }

    if(q.a<0 && leftSlope > 0.035 && rightSlope < -0.035 &&
       leftToVertex >= 8 && rightToVertex <= -10 && endpointSym <= 18){
      const conf=confidenceScore([
        68+q.r2*30,
        70+Math.min(20,leftToVertex),
        70+Math.min(20,Math.abs(rightToVertex)),
        Math.abs(q.vertexX)<0.2?92:82
      ]);
      if(conf>=80) found.push({
        type:"Rounding Top",direction:"Bearish",startDate:c[0].date,endDate:c[c.length-1].date,
        confidence:conf,note:"Broad inverted U-shaped rise and decline: left side rises, a central peak forms, and the right side falls.",triggerPrice:null,
        patternMeta:{vertexIndex:mid}
      });
    }
  }
  return found;
}

function detectPatterns(series) {
  if(series.length<120) return [];
  let patterns=[];
  patterns.push(...detectDoublePatterns(series,100));
  patterns.push(...detectHeadShoulders(series,false));
  patterns.push(...detectHeadShoulders(series,true));
  patterns.push(...detectTrendStructures(series));
  patterns.push(...detectFlag(series));
  patterns.push(...detectRounding(series));

  // Keep the strongest recent instance per pattern type.
  const byType=new Map();
  for(const p of patterns){
    const old=byType.get(p.type);
    if(!old || p.confidence>old.confidence || p.endDate>old.endDate) byType.set(p.type,p);
  }
  return [...byType.values()].filter(p => p.confidence >= 78);
}

function tradingDayAge(series, date) {
  const idx=series.findIndex(x=>x.date===date);
  return idx<0 ? 999 : series.length-1-idx;
}


function findDateIndex(series, date) {
  return series.findIndex(x => x.date === date);
}

function lineFromRegression(reg, x0, x1) {
  return [
    { x: x0, y: reg.intercept + reg.slope * x0 },
    { x: x1, y: reg.intercept + reg.slope * x1 }
  ];
}

function buildPatternChart(series, pattern) {
  const endIndex = findDateIndex(series, pattern.endDate);
  const startIndex = findDateIndex(series, pattern.startDate);
  const anchorEnd = endIndex >= 0 ? endIndex : series.length - 1;
  const anchorStart = startIndex >= 0 ? startIndex : Math.max(0, anchorEnd - 120);

  // Give the viewer enough context around the formation while keeping the SVG fast.
  const left = Math.max(0, anchorStart - 25);
  const right = Math.min(series.length, anchorEnd + 18);
  const chartRows = series.slice(left, right);
  const localStart = Math.max(0, anchorStart - left);
  const localEnd = Math.min(chartRows.length - 1, anchorEnd - left);
  const closes = chartRows.map(x => x.close);
  const overlays = [];
  const markers = [];

  const addRegressionBoundaries = (lookback) => {
    const c = chartRows.slice(Math.max(0, chartRows.length - lookback));
    const highs = localExtrema(c.map(x => x.close), "high", 3).slice(-6);
    const lows = localExtrema(c.map(x => x.close), "low", 3).slice(-6);
    if (highs.length >= 3) {
      const hiReg = linearRegression(highs.map(p => ({x:p.i + chartRows.length - c.length, y:p.price})));
      overlays.push({kind:"line", role:"resistance", points:lineFromRegression(hiReg, Math.max(0, chartRows.length-lookback), chartRows.length-1)});
    }
    if (lows.length >= 3) {
      const loReg = linearRegression(lows.map(p => ({x:p.i + chartRows.length - c.length, y:p.price})));
      overlays.push({kind:"line", role:"support", points:lineFromRegression(loReg, Math.max(0, chartRows.length-lookback), chartRows.length-1)});
    }
  };

  if (["Triangle","Rising Wedge","Falling Wedge","Rising Channel","Falling Channel"].includes(pattern.type)) {
    addRegressionBoundaries(Math.min(120, chartRows.length));
  } else if (pattern.type === "Double Top" || pattern.type === "Double Bottom") {
    const ext = localExtrema(closes, pattern.type === "Double Top" ? "high" : "low", 3);
    const candidates = ext.filter(x => x.i >= Math.max(0, localStart-5) && x.i <= localEnd);
    // IMPORTANT: patternMeta.firstIndex/secondIndex are relative to the
    // detection window (series.slice(-windowSize)), not the full series.
    // Using those indices directly caused the marker dots to appear at the
    // wrong dates/prices in the chart. Always anchor the visual markers to
    // the actual detected dates in the full price series.
    let pair = [];
    if (pattern.startDate && pattern.endDate) {
      const firstGlobal = findDateIndex(series, pattern.startDate);
      const secondGlobal = findDateIndex(series, pattern.endDate);
      if (firstGlobal >= 0 && secondGlobal >= 0 && firstGlobal <= secondGlobal) {
        const firstLocal = firstGlobal - left;
        const secondLocal = secondGlobal - left;
        if (firstLocal >= 0 && firstLocal < chartRows.length &&
            secondLocal >= 0 && secondLocal < chartRows.length) {
          pair = [
            { i:firstLocal, price:chartRows[firstLocal].close },
            { i:secondLocal, price:chartRows[secondLocal].close }
          ];
        }
      }
    }
    if (pair.length !== 2) pair = candidates.slice(-2);
    pair.forEach((x, idx) => markers.push({x:x.i,y:x.price,label:idx===0?"1":"2"}));
    if (pair.length === 2 && pattern.triggerPrice) {
      overlays.push({kind:"hline", role:"trigger", y:pattern.triggerPrice, x0:pair[0].i, x1:Math.min(chartRows.length-1, localEnd+10)});
    }
  } else if (pattern.type === "Head & Shoulders" || pattern.type === "Inverse Head & Shoulders") {
    const mode = pattern.type === "Head & Shoulders" ? "high" : "low";
    const ext = localExtrema(closes, mode, 4).filter(x => x.i >= Math.max(0, localStart-8) && x.i <= localEnd);
    const points = ext.slice(-3);
    points.forEach((x, idx) => markers.push({x:x.i,y:x.price,label:idx===1?"Head":"Shoulder"}));
    if (points.length === 3) {
      const opposite = localExtrema(closes, mode === "high" ? "low" : "high", 3);
      const neck = opposite.filter(x => x.i > points[0].i && x.i < points[2].i).slice(-2);
      if (neck.length >= 2) {
        overlays.push({kind:"line", role:"neckline", points:neck.map(x=>({x:x.i,y:x.price}))});
      }
    }
  } else if (pattern.type === "Flag") {
    const c = chartRows.slice(Math.max(0, localStart), localEnd+1);
    const consStart = Math.min(c.length-1, Math.max(0, Math.floor(c.length*0.45)));
    const cons = c.slice(consStart);
    if (cons.length >= 8) {
      const highs = localExtrema(cons.map(x=>x.close), "high", 2);
      const lows = localExtrema(cons.map(x=>x.close), "low", 2);
      if (highs.length >= 2) {
        const r=linearRegression(highs.map(p=>({x:p.i+localStart+consStart,y:p.price})));
        overlays.push({kind:"line",role:"resistance",points:lineFromRegression(r,localStart+consStart,localEnd)});
      }
      if (lows.length >= 2) {
        const r=linearRegression(lows.map(p=>({x:p.i+localStart+consStart,y:p.price})));
        overlays.push({kind:"line",role:"support",points:lineFromRegression(r,localStart+consStart,localEnd)});
      }
    }
  } else if (pattern.type === "Rounding Top" || pattern.type === "Rounding Bottom") {
    const metaMid = Number.isFinite(pattern.patternMeta?.vertexIndex) ? pattern.patternMeta.vertexIndex : null;
    const mid = metaMid !== null ? Math.max(localStart, Math.min(localEnd, metaMid + localStart)) : Math.round((localStart + localEnd) / 2);
    markers.push({x:localStart,y:closes[localStart],label:"Start"});
    markers.push({x:mid,y:closes[mid],label:pattern.type === "Rounding Top" ? "Peak" : "Trough"});
    markers.push({x:localEnd,y:closes[localEnd],label:"End"});
    // Quadratic fit gives a visual guide to the rounded shape; the actual price line remains visible.
    const pts=[];
    for(let i=localStart;i<=localEnd;i+=Math.max(1,Math.floor((localEnd-localStart)/25))) pts.push({x:i,y:closes[i]});
    if(pts.length>=5){
      const x0=localStart, x1=localEnd;
      const y0=closes[localStart], ym=closes[mid], y1=closes[localEnd];
      const a = ((y1-y0) - 2*(ym-y0))/((x1-x0)*(x1-x0)/2 - (mid-x0)*(mid-x0));
      const b = ((ym-y0) - a*(mid-x0)*(mid-x0))/Math.max(1,(mid-x0));
      const curve=[];
      for(let i=localStart;i<=localEnd;i+=Math.max(1,Math.floor((localEnd-localStart)/35))) curve.push({x:i,y:y0 + b*(i-x0) + a*(i-x0)*(i-x0)});
      overlays.push({kind:"curve",role:"shape",points:curve});
    }
  }

  return {
    symbol: pattern.symbol,
    company: pattern.company,
    pattern: pattern.type,
    direction: pattern.direction,
    confidence: pattern.confidence,
    startDate: pattern.startDate,
    endDate: pattern.endDate,
    triggerPrice: pattern.triggerPrice,
    note: pattern.note,
    patternMeta: pattern.patternMeta || null,
    rows: chartRows,
    patternWindow: {start: localStart, end: localEnd},
    overlays,
    markers
  };
}

async function getPatternScan(forceRefresh=false) {
  const now=Date.now();
  if(!forceRefresh && patternScanCache.data &&
     now-patternScanCache.timestamp<PATTERN_CACHE_TTL_MS){
    return patternScanCache.data;
  }

  const constituentResult=await fetchNseConstituents("NIFTY 500");
  const constituents=constituentResult.symbols;

  const stockResults=await runWithConcurrency(
    constituents,
    async ([symbol,company])=>{
      try{
        const cached=patternPriceCache.get(symbol);
        let rows=cached?.rows;
        if(!rows || now-cached.timestamp>PATTERN_CACHE_TTL_MS){
          rows=await fetchYahooHistoryForNseSymbol(symbol, Math.max(800, PATTERN_HISTORY_DAYS));
          patternPriceCache.set(symbol,{timestamp:Date.now(),rows});
        }
        return {symbol,company,rows};
      }catch(error){
        return {symbol,company,rows:[],error:error.message};
      }
    },
    5
  );

  const all=[];
  for(const stock of stockResults){
    if(stock.rows.length<120) continue;
    const patterns=detectPatterns(stock.rows);
    const current=stock.rows[stock.rows.length-1];
    const oneYearAgo=stock.rows[Math.max(0,stock.rows.length-253)];
    const oneYearReturn=oneYearAgo ? pct(current.close,oneYearAgo.close) : null;

    for(const p of patterns){
      const age=tradingDayAge(stock.rows,p.endDate);
      all.push({
        ...p,
        symbol:stock.symbol,
        company:stock.company,
        currentPrice:Number.isFinite(current.rawClose) ? current.rawClose : current.close,
        oneYearReturn,
        ageTradingDays:age
      });
    }
  }

  all.sort((a,b)=>a.ageTradingDays-b.ageTradingDays || b.confidence-a.confidence);

  const response={
    updatedAt:new Date().toISOString(),
    index:"NIFTY 500",
    constituentCount:constituents.length,
    priceDataLoaded:stockResults.filter(x=>x.rows.length>0).length,
    priceDataFailed:stockResults.filter(x=>x.rows.length===0).length,
    patternCount:all.length,
    patterns:all,
    recentTradingDays:PATTERN_RECENT_TRADING_DAYS,
    methodology:"Heuristic technical-pattern screening over approximately one year of adjusted daily price data. Corporate actions such as splits/bonus issues are normalized where adjusted prices are available. Double Top/Bottom require a prior opposing trend and stronger reversal structure. Patterns remain candidates for review, not guaranteed textbook formations or investment recommendations.",
    failedSymbols:stockResults.filter(x=>x.rows.length===0).map(x=>({symbol:x.symbol,company:x.company,error:x.error}))
  };
  patternScanCache={timestamp:now,data:response,key:"NIFTY500"};
  return response;
}


app.get("/api/funds", async (req, res) => {
  try {
    res.json(await getDashboardData(req.query.refresh === "1"));
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Unable to load mutual fund data",
      details: error.message
    });
  }
});

app.get("/api/breadth/indices", (req, res) => {
  res.json(indexConfig.indices);
});

app.get("/api/breadth", async (req, res) => {
  try {
    const indexName = String(req.query.index || indexConfig.default).toUpperCase();
    const known = indexConfig.indices.some(x => x.key === indexName);

    if (!known) {
      return res.status(400).json({ error: `Unknown index: ${indexName}` });
    }

    res.json(await getBreadthData(indexName, req.query.refresh === "1"));
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Unable to load market breadth",
      details: error.message
    });
  }
});



app.get("/api/pattern-chart", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "").trim().toUpperCase();
    const patternType = String(req.query.type || "").trim();
    if (!symbol || !patternType) {
      return res.status(400).json({error:"symbol and type are required"});
    }

    const scan = await getPatternScan(false);
    const pattern = scan.patterns.find(p => p.symbol === symbol && p.type === patternType);
    if (!pattern) {
      return res.status(404).json({error:"Pattern candidate not found in the current scan"});
    }

    const cached = patternPriceCache.get(symbol);
    let rows = cached?.rows;
    if (!rows || Date.now()-cached.timestamp>PATTERN_CACHE_TTL_MS) {
      rows = await fetchYahooHistoryForNseSymbol(symbol, Math.max(800, PATTERN_HISTORY_DAYS));
      patternPriceCache.set(symbol,{timestamp:Date.now(),rows});
    }

    res.json(buildPatternChart(rows, pattern));
  } catch (error) {
    console.error(error);
    res.status(500).json({error:"Unable to build pattern chart", details:error.message});
  }
});

app.get("/api/patterns", async (req,res)=>{
  try{
    const data=await getPatternScan(req.query.refresh==="1");
    const scope=String(req.query.scope||"recent").toLowerCase();
    const type=String(req.query.type||"ALL");
    let patterns=data.patterns.filter(p=>scope==="recent" ? p.ageTradingDays<=data.recentTradingDays : p.ageTradingDays>data.recentTradingDays);
    if(type!=="ALL") patterns=patterns.filter(p=>p.type===type);
    res.json({
      ...data,
      scope,
      type,
      patterns,
      patternTypes:[...new Set(data.patterns.map(p=>p.type))].sort()
    });
  }catch(error){
    console.error(error);
    res.status(500).json({error:"Unable to scan Nifty 500 chart patterns",details:error.message});
  }
});

app.get("/breadth", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "breadth.html"));
});

app.get("/patterns", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "patterns.html"));
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    service: "MF Dashboard v1.4",
    time: new Date().toISOString()
  });
});


// -------------------- STOCK DIRECTORY / INDIVIDUAL STOCK --------------------
async function getStockDirectory() {
  if (Date.now() - stockDirectoryCache.timestamp < 6 * 60 * 60 * 1000 && stockDirectoryCache.data.length) {
    return stockDirectoryCache.data;
  }
  let result;
  try { result = await fetchNseConstituents("NIFTY 500"); }
  catch (_) { result = { symbols: nifty50Fallback, source: "Built-in Nifty 50 fallback" }; }
  const data = result.symbols.map(x => ({
    symbol: x[0], company: x[1] || x[0], industry: x[2] || ""
  }));
  stockDirectoryCache.timestamp = Date.now();
  stockDirectoryCache.data = data;
  return data;
}

app.get("/api/stock-search", async (req,res) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    if (q.length < 1) return res.json([]);
    const directory = await getStockDirectory();
    const matches = directory.filter(x =>
      x.symbol.toLowerCase().includes(q) || x.company.toLowerCase().includes(q)
    ).slice(0, 12);
    res.json(matches);
  } catch (e) {
    res.status(500).json({error:e.message});
  }
});

// Individual stock page: maximum five years of daily history.
function stockTicker(symbol) {
  const x = String(symbol || "").trim().toUpperCase();
  return x.endsWith(".NS") ? x : `${x}.NS`;
}

async function getStockHistory(symbol) {
  const clean = String(symbol || "").trim().toUpperCase().replace(/\.NS$/,"" );
  const rows = await fetchYahooHistoryForNseSymbol(clean, 5 * 366);
  let company = clean, industry = "";
  try {
    const directory = await getStockDirectory();
    const item = directory.find(x => x.symbol.toUpperCase() === clean);
    if (item) { company = item.company || company; industry = item.industry || ""; }
  } catch (_) {}
  const current = rows.at(-1);
  return {symbol: clean, company, industry, rows, currency:"INR", exchange:"NSE", latestDate:current?.date};
}

function stockSma(a,n){return a.length<n?null:a.slice(-n).reduce((x,y)=>x+y,0)/n}
function stockStats(rows){
  const a=rows.map(x=>x.close), last=a.at(-1);
  const ago=n=>a[Math.max(0,a.length-1-n)];
  const ch=n=>{const v=ago(n);return v?((last-v)/v)*100:null};
  const hi=Math.max(...a.slice(-252)), lo=Math.min(...a.slice(-252));
  const s20=stockSma(a,20),s50=stockSma(a,50),s100=stockSma(a,100),s200=stockSma(a,200);
  const recent=a.slice(-63).filter(Number.isFinite);
  const recentHigh=recent.length?Math.max(...recent):null;
  return {latest:last,change1m:ch(21),change3m:ch(63),change6m:ch(126),change1y:ch(252),change3y:ch(756),change5y:ch(1260),sma20:s20,sma50:s50,sma100:s100,sma200:s200,high52:hi,low52:lo,recentHigh};
}

app.get("/api/stock/:symbol", async (req,res)=>{
  try{
    const symbol=String(req.params.symbol||"").replace(/[^A-Za-z0-9_-]/g,"");
    if(!symbol) return res.status(400).json({error:"Invalid symbol"});
    const d=await getStockHistory(symbol);
    res.json({symbol:d.symbol,company:d.company,industry:d.industry,exchange:d.exchange,currency:d.currency,rows:d.rows,stats:stockStats(d.rows),updatedAt:new Date().toISOString()});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get("/stock", (req,res)=>res.sendFile(path.join(__dirname,"public","stock.html")));
app.get("/momentum-watch", (req,res)=>res.sendFile(path.join(__dirname,"public","momentum-watch.html")));


// -------------------- MOMENTUM STOCK WATCH --------------------
// Uses the top 5 Small Cap + top 5 Mid Cap funds already ranked by the dashboard.
// Portfolio source: monthly portfolio pages derived from AMC/AMFI disclosures.
// The parser keeps current allocation and the disclosed month-over-month allocation
// delta. No holding is invented when a source is unavailable.
const MOMENTUM_TOP_FUNDS_PER_CATEGORY = 10;
const MOMENTUM_MIN_FUNDS_HOLDING = 2;
const MOMENTUM_CORRECTION_DAYS = 63;
const MOMENTUM_HOLDINGS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// A failed public source must never be cached for a whole day.
const MOMENTUM_HOLDINGS_ERROR_CACHE_TTL_MS = 5 * 60 * 1000;
const MOMENTUM_SOURCE_ATTEMPTS = 2;
const momentumHoldingsCache = new Map();
const momentumStockStatsCache = new Map();
const sectorStrengthCache = { timestamp: 0, data: null };
const opportunityCache = { timestamp: 0, data: null };
const ADVANCED_CACHE_TTL_MS = 30 * 60 * 1000;

const MOMENTUM_CATEGORIES = ["Small Cap", "Mid Cap"];

const MOMENTUM_HOLDING_SOURCES = {
  // Keep one or more public portfolio sources for every configured fund.
  // Source failures are reported separately and are never silently treated as zero holdings.
  "Nippon India Small Cap": [
    "https://decryptmutualfunds.com/fund-houses/nippon-india/small-cap-fund"
  ],
  "HDFC Small Cap Fund": [
    "https://decryptmutualfunds.com/fund-houses/hdfc/small-cap-fund",
    "https://www.hdfcfund.com/explore/mutual-funds/hdfc-small-cap-fund/regular",
    "https://www.hdfcfund.com/statutory-disclosure/portfolio/monthly-portfolio"
  ],
  "SBI Small Cap Fund": [
    "https://mfiframes.mutualfundsindia.com/askmefund/factsheet.aspx?param=10509",
    "https://decryptmutualfunds.com/fund-houses/sbi/small-cap-fund",
    "https://www.financialexpress.com/mutual-funds/sbi-small-cap-fund-direct-plan-growth-INF200K01T51/"
  ],
  "Kotak Small Cap Fund": [
    "https://decryptmutualfunds.com/fund-houses/kotak-mahindra/small-cap-fund"
  ],
  "Tata Small Cap Fund": [
    "https://decryptmutualfunds.com/fund-houses/tata/small-cap-fund"
  ],
  "Quant Small Cap Fund": [
    "https://decryptmutualfunds.com/fund-houses/quant/small-cap-fund"
  ],
  "Invesco India Smallcap Fund": [
    "https://mfiframes.mutualfundsindia.com/askmefund/factsheet.aspx?param=38787",
    "https://www.invescomutualfund.com/our-funds/fund/equity/invesco-india-small-cap-fund/SCGP",
    "https://scripbook.com/scheme/sch-invesco-invesco-india-smallcap-fund/",
    "https://economictimes.indiatimes.com/invesco-india-smallcap-fund-direct-plan/fund-factsheet/schemeid-37843.cms"
  ],
  "HSBC Small Cap Fund": [
    "https://decryptmutualfunds.com/fund-houses/hsbc/small-cap-fund"
  ],
  "Bandhan Small Cap Fund": [
    "https://mfiframes.mutualfundsindia.com/askmefund/factsheet.aspx?param=41625",
    "https://scripbook.com/scheme/sch-bandhan-bandhan-small-cap-fund/",
    "https://cmsnew.bandhanmutual.com/category/scheme-portfolios/",
    "https://economictimes.indiatimes.com/bandhan-small-cap-fund-direct-plan/fund-factsheet/schemeid-40564.cms"
  ],
  "Edelweiss Small Cap Fund": [
    "https://decryptmutualfunds.com/fund-houses/edelweiss/small-cap-fund"
  ],
  "Kotak Midcap Fund": [
    "https://decryptmutualfunds.com/fund-houses/kotak-mahindra/midcap-fund"
  ],
  "Motilal Oswal Midcap Fund": [
    "https://decryptmutualfunds.com/fund-houses/motilal-oswal/midcap-fund"
  ],
  "Nippon India Growth Mid Cap Fund": [
    "https://decryptmutualfunds.com/fund-houses/nippon-india/growth-mid-cap-fund"
  ],
  "HDFC Mid-Cap Opportunities": [
    "https://decryptmutualfunds.com/fund-houses/hdfc/mid-cap-fund",
    "https://www.hdfcfund.com/explore/mutual-funds/hdfc-mid-cap-fund/regular",
    "https://www.hdfcfund.com/statutory-disclosure/portfolio/monthly-portfolio"
  ],
  "Edelweiss Mid Cap Fund": [
    "https://decryptmutualfunds.com/fund-houses/edelweiss/mid-cap-fund"
  ]
};

function getMomentumTopFunds(dashboardData) {
  const result = {};
  for (const category of MOMENTUM_CATEGORIES) {
    result[category] = (dashboardData.results || [])
      .filter(x => x.category === category && x.status === "OK" && x.categoryRank)
      .sort((a,b) => a.categoryRank - b.categoryRank)
      .slice(0, MOMENTUM_TOP_FUNDS_PER_CATEGORY)
      .map(x => ({
        fund: x.fund,
        rank: x.categoryRank,
        total: x.categoryTotal,
        change30d: x.change30d,
        change180d: x.change180d,
        change360d: x.change360d,
        latestDate: x.latestDate,
        schemeCode: x.schemeCode
      }));
  }
  return result;
}

function stripHtml(text) {
  return String(text || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function parsePct(text) {
  const m = String(text || "").replace(/,/g,"").match(/(-?\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

function parsePortfolioAsOfDate(html) {
  const text = stripHtml(html).replace(/\s+/g, " ");
  const patterns = [
    /(?:as\s*of|portfolio\s*date|month\s*ended|month\s*ending|valuation\s*date)[^\d]{0,30}(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/i,
    /(?:as\s*of|portfolio\s*date|month\s*ended|month\s*ending|valuation\s*date)[^\d]{0,30}(\d{1,2}[- ](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[- ,]+\d{4})/i,
    /(?:as\s*of|portfolio\s*date|month\s*ended|month\s*ending|valuation\s*date)[^\d]{0,30}((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})/i
  ];
  for (const re of patterns) {
    const m=text.match(re);
    if (!m) continue;
    const d=new Date(m[1]);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0,10);
    const parts=m[1].split(/[\/-]/);
    if (parts.length===3 && parts[2].length===4) {
      const [a,b,c]=parts.map(Number);
      const candidate = a>12 ? new Date(Date.UTC(c,b-1,a)) : new Date(Date.UTC(c,a-1,b));
      if (!Number.isNaN(candidate.getTime())) return candidate.toISOString().slice(0,10);
    }
  }
  // Fall back to the first explicit month/year date in the page when the source
  // uses a heading that the patterns above do not capture.
  const fallback=text.match(/\b(\d{1,2})[-\/]([A-Za-z]{3,9})[-\/]?(\d{4})\b/);
  if (fallback) {
    const d=new Date(`${fallback[1]} ${fallback[2]} ${fallback[3]}`);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0,10);
  }
  return null;
}

function parseMfiTopHoldings(html) {
  const tables = String(html || "").match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) || [];

  for (const table of tables) {
    const tableText = stripHtml(table).replace(/\s+/g, " ").trim();
    // Only parse an actual Top Holdings table. This prevents labels such as
    // "Reduced", "Increased" and "New" from unrelated dashboard tables from
    // being mistaken for stock names.
    if (!/company\s*name|security|stock/i.test(tableText) ||
        !/(asset\s*%|%\s*asset|%\s*to\s*nav|weight)/i.test(tableText)) {
      continue;
    }

    const rows = [];
    const trMatches = table.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
    for (const tr of trMatches) {
      const cells = [...tr.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map(m => stripHtml(m[1]).replace(/\s+/g, " ").trim());
      if (cells.length < 2) continue;

      const company = cells[0];
      if (!company || /^(company name|security|stock|scheme|fund name|total)$/i.test(company)) continue;

      // MFI uses input controls for Asset %, so the visible percentage can be
      // either in a cell or in an input value.
      const pctCell = cells.find(x => /\d+(?:\.\d+)?\s*%/.test(x));
      const inputPct = [...tr.matchAll(/(?:value|data-value)\s*=\s*["']?([0-9]+(?:\.[0-9]+)?)["']?/gi)]
        .map(m => Number(m[1])).find(Number.isFinite);
      const allocation = pctCell ? parsePct(pctCell) : inputPct;
      if (!Number.isFinite(allocation) || allocation <= 0 || allocation > 100) continue;
      if (/cash|treps|triparty repo|repo|receivable|payable|net current|treasury bill|accrued interest/i.test(company)) continue;

      rows.push({
        company,
        isin: null,
        allocation,
        previousAllocation: null,
        deltaAllocation: null,
        changeType: null,
        asOf: null,
        previousAsOf: null
      });
    }
    if (rows.length >= 3) return rows;
  }
  return [];
}

function parseHoldingRowsFromHtml(html, sourceUrl = "") {
  if (/mfiframes\.mutualfundsindia\.com/i.test(sourceUrl)) {
    const mfiRows = parseMfiTopHoldings(html);
    if (mfiRows.length >= 3) return mfiRows;
  }

  const rows = [];
  const portfolioAsOf = parsePortfolioAsOfDate(html);
  const trMatches = String(html || "").match(/<tr\b[\s\S]*?<\/tr>/gi) || [];

  for (const tr of trMatches) {
    const cells = [...tr.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(m => stripHtml(m[1]));
    if (cells.length < 2) continue;

    // Supported layouts:
    // Decrypt: Change | Security | Industry | Quantity | Δ Qty | % to NAV | Δ % | Market value
    // Simple/AMC/Scripbook: Security | Value | Weight
    const hasSecurity = cells.some(x => /(?:INE[A-Z0-9]{6,}|Ltd|Limited|Bank|Industries|Pharma|Power|Finance|Technologies|Systems|Services|Enterprises)/i.test(x));
    if (!hasSecurity) continue;

    const allocIndex = cells.findIndex(x => /-?\d+(?:\.\d+)?\s*%/.test(x));
    if (allocIndex < 1) continue;

    const allocation = parsePct(cells[allocIndex]);
    if (!Number.isFinite(allocation)) continue;

    const security = cells.length >= 5
      ? (cells[1] || "")
      : (cells.find((x,i) => i < allocIndex && /(?:INE[A-Z0-9]{6,}|Ltd|Limited|Bank|Industries|Pharma|Power|Finance|Technologies|Systems|Services|Enterprises)/i.test(x)) || cells[0] || "");
    const isinMatch = security.match(/\b(IN[A-Z0-9]{10})\b/i);
    const company = security.replace(/\bIN[A-Z0-9]{10}\b/gi, "").replace(/\s+/g, " ").trim();
    const change = String(cells[0] || "").toLowerCase();

    let delta = null;
    for (let j=allocIndex+1; j<cells.length; j++) {
      if (/[-+]?\d+(?:\.\d+)?\s*pp\b/i.test(cells[j])) {
        delta = parseFloat(cells[j].replace(/[^0-9+.-]/g,""));
        break;
      }
    }

    // For an exited row, current allocation is zero and the disclosed delta
    // represents the previous weight that disappeared.
    const currentAllocation = change.includes("exited") ? 0 : allocation;
    const previousAllocation =
      Number.isFinite(delta) ? Math.max(0, currentAllocation - delta) : null;

    // Ignore cash/TREPS/debt rows even when they have a percentage.
    if (/cash|treps|repo|receivable|payable|net current|treasury bill|accrued interest/i.test(company)) {
      continue;
    }

    if (!company || company.length < 2) continue;

    rows.push({
      company,
      isin: isinMatch ? isinMatch[1].toUpperCase() : null,
      allocation: currentAllocation,
      previousAllocation,
      deltaAllocation: delta,
      changeType: change,
      asOf: portfolioAsOf,
      previousAsOf: null
    });
  }
  return rows;
}

const MFDATA_BASE = "https://mfdata.in/api/v1";
const mfDataFamilyCache = new Map();

async function fetchMfDataJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "MF-Stocks-Dashboard/1.10.2",
        "Accept": "application/json"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMfDataHoldings(fundName) {
  let familyId = mfDataFamilyCache.get(fundName);
  let familyName = null;

  if (!familyId) {
    const search = await fetchMfDataJson(`${MFDATA_BASE}/search?q=${encodeURIComponent(fundName)}`);
    const matches = Array.isArray(search?.data) ? search.data : [];
    if (!matches.length) throw new Error("MFData search returned no matching scheme");

    const norm = x => normalize(String(x || "")).replace(/smallcap/g, "small cap").trim();
    const wanted = norm(fundName);
    matches.sort((a,b) => {
      const an = norm(a.scheme_name || a.name);
      const bn = norm(b.scheme_name || b.name);
      const as = an === wanted ? 10000 : tokenScore(fundName, a.scheme_name || a.name);
      const bs = bn === wanted ? 10000 : tokenScore(fundName, b.scheme_name || b.name);
      return bs - as;
    });

    let lastError = null;
    for (const match of matches.slice(0, 5)) {
      const code = match?.scheme_code ?? match?.amfi_code;
      if (!code) continue;
      try {
        const detail = await fetchMfDataJson(`${MFDATA_BASE}/schemes/${encodeURIComponent(code)}`);
        familyId = detail?.data?.family_id;
        familyName = detail?.data?.family_name || detail?.data?.scheme_name || match?.scheme_name || null;
        if (familyId) {
          mfDataFamilyCache.set(fundName, familyId);
          break;
        }
      } catch (e) { lastError = e; }
    }
    if (!familyId) throw new Error(`MFData family lookup failed${lastError ? ": " + lastError.message : ""}`);
  }

  const payload = await fetchMfDataJson(`${MFDATA_BASE}/families/${encodeURIComponent(familyId)}/holdings`);
  const data = payload?.data || {};
  const equity = Array.isArray(data.equity_holdings) ? data.equity_holdings
    : Array.isArray(data.equity) ? data.equity : [];

  const rows = equity.map(x => {
    const allocation = Number(x.weight_pct ?? x.weight ?? x.allocation);
    const delta = Number(x.change_mom ?? x.monthly_change);
    const previousAllocation = Number.isFinite(allocation) && Number.isFinite(delta)
      ? allocation - delta : null;
    return {
      company: x.stock_name || x.name || x.company || "",
      stock: x.symbol || x.ticker || "",
      allocation,
      previousAllocation,
      asOf: data.month || data.as_of || null
    };
  }).filter(x => x.company && Number.isFinite(x.allocation) && x.allocation > 0);

  if (!rows.length) throw new Error("MFData returned no equity holdings");
  return {
    fund: fundName,
    status: "OK",
    rows,
    source: `MFData family ${familyId}${familyName ? " · " + familyName : ""}`,
    asOf: data.month || data.as_of || null,
    asOfLabel: data.month ? `Portfolio as of ${data.month}` : "Latest portfolio from MFData"
  };
}

async function fetchMomentumFundHoldings(fund, forceRefresh=false) {
  const cached = momentumHoldingsCache.get(fund.fund);
  if (!forceRefresh && cached) {
    const ttl = cached.value?.status === "OK"
      ? MOMENTUM_HOLDINGS_CACHE_TTL_MS
      : MOMENTUM_HOLDINGS_ERROR_CACHE_TTL_MS;
    if (Date.now() - cached.timestamp < ttl) return cached.value;
  }

  const urls = MOMENTUM_HOLDING_SOURCES[fund.fund] || [];
  const errors = [];

  for (const url of urls) {
    for (let attempt = 1; attempt <= MOMENTUM_SOURCE_ATTEMPTS; attempt++) {
      let timer = null;
      try {
        const controller = new AbortController();
        timer = setTimeout(() => controller.abort(), 20000);
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-IN,en;q=0.9"
          }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const rows = parseHoldingRowsFromHtml(html, url);
        if (!rows.length) throw new Error("No equity holdings could be parsed from source");

        const value = {
          fund: fund.fund,
          status: "OK",
          rows,
          source: url,
          asOf: rows.find(r=>r.asOf)?.asOf || null,
          asOfLabel: rows.find(r=>r.asOf)?.asOf ? `Portfolio as of ${rows.find(r=>r.asOf).asOf}` : "Latest monthly portfolio available from source"
        };
        momentumHoldingsCache.set(fund.fund, {timestamp: Date.now(), value});
        return value;
      } catch (e) {
        errors.push(`${url} (attempt ${attempt}): ${e?.message || "unknown error"}`);
        if (attempt < MOMENTUM_SOURCE_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, 800 * attempt));
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }

  // Some AMC pages are JavaScript/PDF driven or block cloud IPs. Use the
  // structured MFData holdings API only as a fallback when all configured
  // sources fail, preserving the official/source-specific path as first choice.
  try {
    const value = await fetchMfDataHoldings(fund.fund);
    momentumHoldingsCache.set(fund.fund, {timestamp: Date.now(), value});
    return value;
  } catch (e) {
    errors.push(`MFData fallback: ${e?.message || "unknown error"}`);
  }

  const value = {
    fund: fund.fund,
    status: "ERROR",
    error: errors.length ? errors.join(" | ") : "No holdings source configured"
  };
  momentumHoldingsCache.set(fund.fund, {timestamp: Date.now(), value});
  return value;
}

function normalizeCompanyName(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\b(limited|ltd|india|pvt|private|company|co|inc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function companyMatchScore(a, b) {
  const aa = normalizeCompanyName(a).split(" ").filter(x => x.length >= 3);
  const bb = normalizeCompanyName(b).split(" ").filter(x => x.length >= 3);
  if (!aa.length || !bb.length) return 0;
  const bs = new Set(bb);
  let hits = 0;
  for (const x of aa) if (bs.has(x)) hits++;
  return hits / Math.max(aa.length, bb.length);
}

async function resolveHoldingSymbol(company, isin) {
  // First try exact company match against the cached Nifty 500 directory.
  const directory = await getStockDirectory();
  let best = null, bestScore = 0;
  for (const item of directory) {
    const score = companyMatchScore(company, item.company);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  // Avoid unsafe fuzzy mappings.
  return best && bestScore >= 0.60
    ? {symbol: best.symbol, company: best.company, industry: best.industry}
    : null;
}

async function getMomentumStockStats(symbol) {
  if (momentumStockStatsCache.has(symbol)) return momentumStockStatsCache.get(symbol);
  try {
    const d = await getStockHistory(symbol);
    const stats = stockStats(d.rows);
    momentumStockStatsCache.set(symbol, stats);
    return stats;
  } catch (_) {
    momentumStockStatsCache.set(symbol, null);
    return null;
  }
}

async function buildMomentumRows(holdingRecords, targetCategory = null, minimumHolding = MOMENTUM_MIN_FUNDS_HOLDING) {
  const byCompany = new Map();

  for (const rec of holdingRecords) {
    if (!Array.isArray(rec.rows)) continue;
    for (const h of rec.rows) {
      const key = h.isin || normalizeCompanyName(h.company);
      if (!key) continue;

      if (!byCompany.has(key)) {
        byCompany.set(key, {
          isin: h.isin,
          company: h.company,
          funds: new Map()
        });
      }

      // A portfolio parser can encounter the same security more than once
      // (for example, an AMC table + an alternate disclosure row). A fund
      // must count only once for consensus; keep the highest valid allocation.
      const group = byCompany.get(key);
      const existing = group.funds.get(rec.fund);
      const item = {
        fund: rec.fund,
        category: rec.category || "",
        allocation: Number.isFinite(h.allocation) ? h.allocation : 0,
        previousAllocation: Number.isFinite(h.previousAllocation) ? h.previousAllocation : null,
        changeType: h.changeType || "",
        asOf: h.asOf || rec.asOf || null
      };
      if (!existing || item.allocation > existing.allocation) group.funds.set(rec.fund, item);
    }
  }

  const candidates = [...byCompany.values()]
    .map(x => ({...x, funds:[...x.funds.values()], currentFunds:[...x.funds.values()].filter(f => f.allocation > 0.001)}))
    .filter(x => {
      if (!targetCategory) return x.currentFunds.length >= minimumHolding;
      return x.currentFunds.filter(f => f.category === targetCategory).length >= minimumHolding;
    });

  const resolved = await runWithConcurrency(candidates, async x => {
    const match = await resolveHoldingSymbol(x.company, x.isin);
    return {...x, match};
  }, 6);

  const output = [];
  for (const stock of resolved) {
    const resolvedMatch = stock.match || {
      symbol: stock.company,
      company: stock.company,
      industry: ""
    };

    const current = targetCategory
      ? stock.currentFunds.filter(x => x.category === targetCategory)
      : stock.currentFunds;
    if (targetCategory && current.length < minimumHolding) continue;
    const smallFunds = current.filter(x => x.category === "Small Cap");
    const midFunds = current.filter(x => x.category === "Mid Cap");
    const categories = [...new Set(current.map(x => x.category).filter(Boolean))];

    const avgAllocation = current.reduce((s,x)=>s+x.allocation,0) / current.length;
    const avgFor = arr => {
      if (!arr.length) return null;
      return arr.reduce((s,x)=>s+x.allocation,0) / arr.length;
    };
    const previousFor = arr => {
      const vals = arr.map(x=>x.previousAllocation).filter(Number.isFinite);
      return vals.length ? vals.reduce((s,x)=>s+x,0)/vals.length : null;
    };

    // Allocation change must include exits/sales. A fund that held the stock last
    // month but now has 0% allocation must contribute a negative change.
    // Otherwise removing a fund from the current-holder average can incorrectly
    // make the overall delta appear positive (green).
    const tracked = stock.funds.filter(x => !targetCategory || x.category === targetCategory);
    const prevValues = tracked.map(x=>x.previousAllocation).filter(Number.isFinite);
    const avgPrevious = prevValues.length ? prevValues.reduce((s,x)=>s+x,0)/prevValues.length : null;
    const deltaValues = tracked
      .filter(x => Number.isFinite(x.previousAllocation))
      .map(x => (Number(x.allocation)||0) - x.previousAllocation);
    const deltaAllocation = deltaValues.length ? deltaValues.reduce((s,x)=>s+x,0)/deltaValues.length : null;

    const fundsIncreasing = tracked.filter(x => Number.isFinite(x.previousAllocation) && x.allocation > x.previousAllocation + 0.01).length;
    const fundsDecreasing = tracked.filter(x => Number.isFinite(x.previousAllocation) && x.allocation < x.previousAllocation - 0.01).length;
    const fundsUnchanged = tracked.filter(x => Number.isFinite(x.previousAllocation) && Math.abs(x.allocation-x.previousAllocation)<=0.01).length;
    const newFunds = tracked.filter(x => x.changeType.includes("new") || (Number.isFinite(x.previousAllocation) && x.previousAllocation<=0.001 && x.allocation>0.001)).length;
    const fundsExited = tracked.filter(x => (Number(x.allocation)||0) <= 0.001 && Number.isFinite(x.previousAllocation) && x.previousAllocation > 0.001).length;
    const holdingsAsOf = tracked.map(x=>x.asOf).find(Boolean) || null;

    const stats = stock.match ? await getMomentumStockStats(stock.match.symbol) : null;
    const correction = stats?.recentHigh && stats?.latest
      ? ((stats.latest - stats.recentHigh) / stats.recentHigh) * 100 : null;

    // Show the shortest SMA that price is above. Longer SMAs are implied.
    // Example: above 50/100/200 => display only 50; above 20 => display only 20.
    let smaUp = "";
    if (stats?.latest > stats?.sma20) smaUp = "20";
    else if (stats?.latest > stats?.sma50) smaUp = "50";
    else if (stats?.latest > stats?.sma100) smaUp = "100";
    else if (stats?.latest > stats?.sma200) smaUp = "200";

    let status = "—";
    if (Number.isFinite(correction) && correction <= -10 && fundsIncreasing > 0) status = "WATCH";
    else if (Number.isFinite(correction) && correction <= -5 && fundsIncreasing >= fundsDecreasing) status = "MONITOR";

    output.push({
      stock: resolvedMatch.symbol,
      company: resolvedMatch.company || stock.company,
      category: targetCategory || (categories[0] || "Small Cap"),
      categories,
      fundsHolding: current.length,
      smallFundsHolding: smallFunds.length,
      midFundsHolding: midFunds.length,
      avgAllocation,
      smallAvgAllocation: avgFor(smallFunds),
      midAvgAllocation: avgFor(midFunds),
      previousAvgAllocation: avgPrevious,
      smallPreviousAvgAllocation: previousFor(smallFunds),
      midPreviousAvgAllocation: previousFor(midFunds),
      deltaAllocation,
      fundsIncreasing,
      fundsUnchanged,
      fundsDecreasing,
      newFunds,
      fundsExited,
      holdingsAsOf,
      correction,
      change1m: stats?.change1m ?? null,
      change3m: stats?.change3m ?? null,
      change6m: stats?.change6m ?? null,
      change1y: stats?.change1y ?? null,
      smaUp,
      status,
      funds: current.map(x => ({
        fund:x.fund, category:x.category, allocation:x.allocation,
        previousAllocation:x.previousAllocation, changeType:x.changeType, asOf:x.asOf
      })),
      trackedFunds: tracked.map(x => ({
        fund:x.fund, category:x.category, allocation:x.allocation,
        previousAllocation:x.previousAllocation, changeType:x.changeType, asOf:x.asOf
      }))
    });
  }

  return output.sort((a,b)=>(
    (a.status==="WATCH"?0:a.status==="MONITOR"?1:2) -
    (b.status==="WATCH"?0:b.status==="MONITOR"?1:2) ||
    b.fundsHolding-a.fundsHolding ||
    (b.avgAllocation||0)-(a.avgAllocation||0)
  ));
}

async function getMomentumWatchData(refresh=false) {
  if (!refresh && opportunityCache.timestamp && Date.now()-opportunityCache.timestamp < ADVANCED_CACHE_TTL_MS && opportunityCache.data?.momentum) return opportunityCache.data.momentum;
  const dashboard = await getDashboardData(false);
  const topFunds = getMomentumTopFunds(dashboard);
  const categoryFundList = [
    ...topFunds["Small Cap"].map(f => ({...f, category: "Small Cap"})),
    ...topFunds["Mid Cap"].map(f => ({...f, category: "Mid Cap"}))
  ];
  const records = await runWithConcurrency(categoryFundList, async fund => {
    // Refresh must retry source failures instead of reusing a stale failure cache.
    const r = await fetchMomentumFundHoldings(fund, refresh);
    return {...r, category: fund.category};
  }, 5);
  const available = records.filter(x => x.status === "OK");
  const smallRecords = available.filter(x => x.category === "Small Cap");
  const midRecords = available.filter(x => x.category === "Mid Cap");
  const [smallRows, midRows] = await Promise.all([
    buildMomentumRows(smallRecords, "Small Cap"),
    buildMomentumRows(midRecords, "Mid Cap")
  ]);
  const data={
    updatedAt:new Date().toISOString(), topFunds,
    minimumFundsHolding:MOMENTUM_MIN_FUNDS_HOLDING,
    correctionWindowTradingDays:MOMENTUM_CORRECTION_DAYS,
    rows:[...smallRows,...midRows],
    provider:"Monthly portfolio disclosures parsed from public portfolio pages",
    providerStatus:available.length?"OK":"NOT_CONFIGURED",
    providerCoverage:Object.fromEntries(MOMENTUM_CATEGORIES.map(category=>{
      const selected=(topFunds[category]||[]).length;
      const loaded=records.filter(x=>x.category===category&&x.status==="OK").length;
      return [category,{selected,loaded,failed:selected-loaded}];
    })),
    providerErrors:records.filter(x=>x.status!=="OK").map(x=>({fund:x.fund,category:x.category,error:x.error}))
  };
  opportunityCache.timestamp=Date.now();
  opportunityCache.data={...(opportunityCache.data||{}), momentum:data};
  return data;
}

app.get("/api/momentum-watch", async (req,res) => {
  try { res.json(await getMomentumWatchData(req.query.refresh === "1")); }
  catch (e) { console.error(e); res.status(500).json({error:"Unable to load Momentum Stock Watch",details:e.message}); }
});


// -------------------- IPO MARKET (LAST 3 YEARS) --------------------
// Listing price/date are maintained as a curated NSE mainboard IPO universe.
// Current market price is refreshed from Yahoo Finance daily data.
const IPO_CACHE_TTL_MS = 30 * 60 * 1000;
const ipoMarketCache = { timestamp: 0, data: null };
// Universe is maintained in config/ipoUniverse.js. No 30-stock cap is applied here.


const ipoYahooSearchCache = new Map();
const ipoPriceHistoryCache = new Map();
const IPO_TICKER_CACHE_TTL_MS = 15 * 60 * 1000;

async function searchYahooIpoTickers(ipo) {
  const key = `${String(ipo?.symbol || "").toUpperCase()}|${String(ipo?.company || "")}`;
  if (ipoYahooSearchCache.has(key)) return ipoYahooSearchCache.get(key);

  const queries = [ipo?.symbol, ipo?.company].filter(Boolean);
  const found = [];
  for (const q of queries) {
    try {
      const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
          "Accept": "application/json,text/plain,*/*"
        }
      });
      if (!response.ok) throw new Error(`Yahoo search HTTP ${response.status}`);
      const json = await response.json();
      for (const quote of (json?.quotes || [])) {
        const ticker = String(quote?.symbol || "").toUpperCase();
        const type = String(quote?.quoteType || "").toUpperCase();
        if (type === "EQUITY" && (ticker.endsWith(".NS") || ticker.endsWith(".BO"))) found.push(ticker);
      }
    } catch (_) {}
  }
  const out = [...new Set(found)];
  ipoYahooSearchCache.set(key, out);
  return out;
}

async function fetchIpoPriceHistory(ipo) {
  const symbol = String(ipo?.symbol || "").trim().toUpperCase();
  const configured = IPO_YAHOO_SYMBOL_ALIASES[symbol] || [];
  const candidates = [...new Set([
    ...configured,
    symbol ? `${symbol}.NS` : null,
    symbol ? `${symbol}.BO` : null
  ].filter(Boolean))];

  let lastError = null;
  const tryTicker = async ticker => {
    const cached = ipoPriceHistoryCache.get(ticker);
    if (cached && Date.now() - cached.timestamp < IPO_TICKER_CACHE_TTL_MS) return cached.rows;
    try {
      // The IPO screen already stores the issue price, so it only needs a
      // recent valid close. Avoid downloading five years for every IPO.
      const rows = await fetchYahooHistory(ticker, 45);
      if (rows.length >= 1) {
        ipoPriceHistoryCache.set(ticker, {timestamp: Date.now(), rows});
        return rows;
      }
    } catch (e) { lastError = e; }
    return null;
  };

  for (const ticker of candidates) {
    const rows = await tryTicker(ticker);
    if (rows) return rows;
  }

  const discovered = await searchYahooIpoTickers(ipo);
  for (const ticker of discovered) {
    if (candidates.includes(ticker)) continue;
    const rows = await tryTicker(ticker);
    if (rows) return rows;
  }

  throw new Error(`${symbol}: ${lastError?.message || "Yahoo current price unavailable on NSE/BSE"}`);
}

async function getIpoMarketData(refresh=false) {
  if (!refresh && ipoMarketCache.data && Date.now()-ipoMarketCache.timestamp < IPO_CACHE_TTL_MS) return ipoMarketCache.data;
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 3);
  const cutoffDate = cutoff.toISOString().slice(0,10);
  const universe = [...new Map(IPO_UNIVERSE.filter(x => x && x.symbol && x.listingDate && x.listingDate >= cutoffDate).map(x => [`${String(x.symbol).toUpperCase()}|${x.listingDate}`, x])).values()]
    .sort((a,b) => b.listingDate.localeCompare(a.listingDate));
  const rows = await runWithConcurrency(universe, async ipo => {
    try {
      const hist = await fetchIpoPriceHistory(ipo);
      const latest = hist.at(-1);
      const listingRow = hist.find(r=>r.date >= ipo.listingDate) || hist[0];
      const listingPrice = Number.isFinite(ipo.listingPrice) ? ipo.listingPrice : (listingRow?.rawClose ?? listingRow?.close ?? null);
      // Use the actual latest exchange close for the IPO screen rather than
      // dividend-adjusted history, so the displayed current price matches a quote.
      const currentPrice = latest?.rawClose ?? latest?.close ?? null;
      const change = Number.isFinite(listingPrice) && Number.isFinite(currentPrice) && listingPrice !== 0 ? (currentPrice-listingPrice)/listingPrice*100 : null;
      const years = (Date.now()-Date.parse(ipo.listingDate+'T00:00:00Z'))/(365.25*86400000);
      const annualized = Number.isFinite(change) && years>0 && listingPrice>0 && currentPrice>0 ? (Math.pow(currentPrice/listingPrice,1/years)-1)*100 : null;
      return {...ipo, currentPrice, currentDate:latest?.date||null, change, annualized, status:'OK'};
    } catch (e) { return {...ipo,currentPrice:null,currentDate:null,change:null,annualized:null,status:'UNAVAILABLE',error:e.message}; }
  }, 2);
  const data={updatedAt:new Date().toISOString(), startDate:'rolling 3-year window', source:'Configured NSE/BSE mainboard IPO universe (SME excluded) + Yahoo Finance current/daily prices', rows};
  ipoMarketCache.timestamp=Date.now(); ipoMarketCache.data=data; return data;
}

app.get('/api/ipo-market', async (req,res)=>{
  try { res.json(await getIpoMarketData(req.query.refresh==='1')); }
  catch(e){ console.error(e); res.status(500).json({error:'Unable to load IPO market',details:e.message}); }
});
app.get('/ipo-market',(req,res)=>res.sendFile(path.join(__dirname,'public','ipo-market.html')));

// -------------------- SECTOR ANALYSIS --------------------
// Prototype data provider: Screener's public company pages expose the quarterly
// shareholding and quarterly P&L tables in HTML. The parser below is deliberately
// conservative: if a value cannot be read, it is returned as null rather than
// inventing a number. Replace this provider later with a licensed fundamentals feed
// when the site is published commercially.
const sectorCache = new Map();
const SECTOR_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SCREENER_BASE = "https://www.screener.in/company";

function stripHtml(s) {
  return String(s || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&rsquo;|&lsquo;|&ndash;|&mdash;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlTables(html) {
  const out = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let m;
  while ((m = tableRe.exec(html))) {
    const table = m[0];
    const rows = [];
    const rowRe = /<tr[\s\S]*?<\/tr>/gi;
    let rm;
    while ((rm = rowRe.exec(table))) {
      const cells = [];
      const cellRe = /<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
      let cm;
      while ((cm = cellRe.exec(rm[0]))) cells.push(stripHtml(cm[1]));
      if (cells.length) rows.push(cells);
    }
    if (rows.length) out.push(rows);
  }
  return out;
}

function parsePctText(v) {
  if (v == null) return null;
  const m = String(v).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function parseCroreText(v) {
  if (v == null) return null;
  const t = String(v).replace(/,/g, "").replace(/\s/g, "");
  if (!t || t === "-" || t === "—") return null;
  const m = t.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function normalizedSectorName(name) {
  const n = String(name || "").trim();
  return n || "Unclassified";
}

function sectorUniverse() {
  // Current Nifty 500 constituent list; the third CSV column is the industry label.
  return fetchNseConstituents("NIFTY 500").then(x => x.symbols.map(r => ({
    symbol: r[0], company: r[1] || r[0], sector: normalizedSectorName(r[2])
  })));
}

async function fetchScreenerCompany(symbol) {
  const urls = [
    `${SCREENER_BASE}/${encodeURIComponent(symbol)}/consolidated/`,
    `${SCREENER_BASE}/${encodeURIComponent(symbol)}/`
  ];
  let response = null;
  let lastStatus = null;
  for (const url of urls) {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Referer": "https://www.screener.in/"
      }
    });
    lastStatus = r.status;
    if (r.ok) { response = r; break; }
  }
  if (!response) throw new Error(`Screener HTTP ${lastStatus || 'error'}`);
  const html = await response.text();
  const tables = htmlTables(html);

  const findRow = (label) => tables.flat().find(r => String(r[0] || "").toLowerCase().startsWith(label.toLowerCase()));
  const result = { symbol, shareholding: [], results: [] };

  // Identify quarterly result table by the presence of Sales and Net Profit rows.
  const qTable = tables.find(t => {
    const labels = t.map(r => String(r[0] || "").toLowerCase());
    return labels.some(x => x.startsWith("sales")) && labels.some(x => x.startsWith("net profit"));
  });
  if (qTable) {
    const salesRow = qTable.find(r => /^Sales\s*\+?$/i.test(r[0] || ""));
    const opRow = qTable.find(r => /^Operating Profit$/i.test(r[0] || ""));
    const interestRow = qTable.find(r => /^Interest$/i.test(r[0] || ""));
    const depRow = qTable.find(r => /^Depreciation$/i.test(r[0] || ""));
    const pbtRow = qTable.find(r => /^Profit before tax$/i.test(r[0] || ""));
    const patRow = qTable.find(r => /^Net Profit\s*\+?$/i.test(r[0] || ""));
    const header = qTable.find(r => r.some(x => /^(Jun|Sep|Dec|Mar)\s+\d{4}$/i.test(x)));
    const labels = header ? header.filter(x => /^(Jun|Sep|Dec|Mar)\s+\d{4}$/i.test(x)) : [];
    const colIndex = (label) => header ? header.indexOf(label) : -1;
    for (const label of labels) {
      const i = colIndex(label);
      const sales = salesRow ? parseCroreText(salesRow[i]) : null;
      const operatingProfit = opRow ? parseCroreText(opRow[i]) : null;
      const interest = interestRow ? parseCroreText(interestRow[i]) : null;
      const depreciation = depRow ? parseCroreText(depRow[i]) : null;
      const pbt = pbtRow ? parseCroreText(pbtRow[i]) : null;
      const pat = patRow ? parseCroreText(patRow[i]) : null;
      const ebitda = [pbt, interest, depreciation].every(Number.isFinite)
        ? pbt + interest + depreciation
        : (Number.isFinite(operatingProfit) ? operatingProfit : null);
      result.results.push({ label, sales, ebitda, pat, published: true });
    }
  }

  // Shareholding table: Screener publishes quarterly FIIs, DIIs, Public and Others.
  const shTable = tables.find(t => {
    const labels = t.map(r => String(r[0] || "").toLowerCase());
    return labels.some(x => x.startsWith("fiis")) && labels.some(x => x.startsWith("diis"));
  });
  if (shTable) {
    const find = (prefixes) => shTable.find(r => prefixes.some(p => String(r[0] || "").toLowerCase().startsWith(p)));
    const rows = {
      promoter: find(["promoters"]), fii: find(["fiis"]), dii: find(["diis"]),
      public: find(["public"]), others: find(["others"]), government: find(["government"])
    };
    const header = shTable.find(r => r.some(x => /^(Sep|Dec|Mar|Jun)\s+\d{4}$/i.test(x)));
    const labels = header ? header.filter(x => /^(Sep|Dec|Mar|Jun)\s+\d{4}$/i.test(x)) : [];
    const idx = x => header ? header.indexOf(x) : -1;
    for (const label of labels) {
      const i = idx(label);
      const promoter = rows.promoter ? parsePctText(rows.promoter[i]) : null;
      const fii = rows.fii ? parsePctText(rows.fii[i]) : null;
      const dii = rows.dii ? parsePctText(rows.dii[i]) : null;
      const publicPct = rows.public ? parsePctText(rows.public[i]) : null;
      // The requested four-way composition is Promoter + FII + DII + Others.
      // Use the residual bucket so the four displayed categories sum to ~100%.
      const others4 = [promoter, fii, dii].every(Number.isFinite)
        ? 100 - promoter - fii - dii
        : null;
      result.shareholding.push({ label, promoter, fii, dii, others: others4 });
    }
  }
  return result;
}

async function runSectorFetch(items, fn, concurrency = 4) {
  const out = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try { out[i] = await fn(items[i]); }
      catch (e) { out[i] = { symbol: items[i].symbol, error: e.message, shareholding: [], results: [] }; }
      await new Promise(r => setTimeout(r, 220));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, worker));
  return out;
}

function avg(values) {
  const v = values.filter(Number.isFinite);
  return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null;
}

function aggregateShareholding(records, sector) {
  const quarterMap = new Map();
  for (const rec of records) {
    for (const q of rec.shareholding || []) {
      if (!quarterMap.has(q.label)) quarterMap.set(q.label, []);
      quarterMap.get(q.label).push(q);
    }
  }
  const quarters = [...quarterMap.entries()]
    .sort((a,b)=>new Date(a[0])-new Date(b[0]))
    .slice(-10)
    .map(([label, rows]) => ({
      label,
      promoter: avg(rows.map(x=>x.promoter)), fii: avg(rows.map(x=>x.fii)),
      dii: avg(rows.map(x=>x.dii)), others: avg(rows.map(x=>x.others)), stocks: rows.length
    }));
  const latest = quarters.at(-1) || null;
  const sectors = latest ? [{
    name: sector, stockCount: latest.stocks, promoter: latest.promoter,
    fii: latest.fii, dii: latest.dii, others: latest.others
  }] : [];
  return { quarters, latest, sectors };
}

function growth(current, previous) {
  return Number.isFinite(current) && Number.isFinite(previous) && previous !== 0
    ? ((current / previous) - 1) * 100 : null;
}

function aggregateResults(records, period) {
  const valid = records.filter(x => (x.results || []).length);
  const map = new Map();
  for (const rec of valid) {
    const rows = rec.results || [];
    for (const q of rows) {
      if (!map.has(q.label)) map.set(q.label, []);
      map.get(q.label).push({ ...q, symbol: rec.symbol });
    }
  }
  let periods = [...map.entries()].sort((a,b)=>new Date(a[0])-new Date(b[0])).slice(-8);
  if (period === 'annual') {
    const annual = new Map();
    for (const [label, rows] of map.entries()) {
      const d = new Date(`01 ${label}`);
      const fy = d.getMonth() >= 3 ? d.getFullYear()+1 : d.getFullYear();
      if (!annual.has(fy)) annual.set(fy, []);
      annual.get(fy).push(...rows);
    }
    periods = [...annual.entries()].sort((a,b)=>a[0]-b[0]).slice(-5).map(([fy, rows])=>[
      `FY${String(fy).slice(-2)}`, rows
    ]);
  }
  const agg = periods.map(([label, rows]) => {
    const sales = rows.reduce((s,x)=>s+(Number.isFinite(x.sales)?x.sales:0),0);
    const ebitdaVals = rows.filter(x=>Number.isFinite(x.ebitda)).map(x=>x.ebitda);
    const pat = rows.reduce((s,x)=>s+(Number.isFinite(x.pat)?x.pat:0),0);
    return { label, sales, ebitda: ebitdaVals.length?ebitdaVals.reduce((a,b)=>a+b,0):null, pat, stocks:new Set(rows.map(x=>x.symbol)).size };
  });
  const prev = new Map();
  for (let i=0;i<agg.length;i++) prev.set(agg[i].label, agg[i]);
  for (let i=0;i<agg.length;i++) {
    const p = period==='annual' ? agg[i-1] : agg[Math.max(0,i-4)];
    agg[i].salesYoY = p ? growth(agg[i].sales,p.sales) : null;
    agg[i].ebitdaYoY = p && Number.isFinite(agg[i].ebitda) && Number.isFinite(p.ebitda) ? growth(agg[i].ebitda,p.ebitda) : null;
    agg[i].patYoY = p ? growth(agg[i].pat,p.pat) : null;
  }
  const latest = agg.at(-1) || {};
  return { periods: agg, latest };
}

// Sector-analysis performance controls.
// ALL sectors intentionally use a small sample so the dashboard remains responsive.
// A selected sector still loads its full constituent list.
const SECTOR_ALL_STOCKS_PER_SECTOR = 3;
const SECTOR_FETCH_CONCURRENCY = 6;

function sectorTargetsForLoad(universe, sector) {
  if (sector !== 'ALL') return universe.filter(x => x.sector === sector);
  const grouped = new Map();
  for (const x of universe) {
    if (!grouped.has(x.sector)) grouped.set(x.sector, []);
    if (grouped.get(x.sector).length < SECTOR_ALL_STOCKS_PER_SECTOR) grouped.get(x.sector).push(x);
  }
  return [...grouped.values()].flat();
}

async function getSectorShareholding(sector, refresh=false) {
  const key = `sh:${sector}`;
  const cached = sectorCache.get(key);
  if (!refresh && cached && Date.now()-cached.timestamp<SECTOR_CACHE_TTL_MS) return cached.data;
  const universe = await sectorUniverse();
  const targets = sectorTargetsForLoad(universe, sector);
  const records = await runSectorFetch(targets, x => fetchScreenerCompany(x.symbol), SECTOR_FETCH_CONCURRENCY);
  const grouped = new Map();
  for (let i=0;i<targets.length;i++) {
    const t=targets[i], rec=records[i];
    if (!grouped.has(t.sector)) grouped.set(t.sector, []);
    grouped.get(t.sector).push(rec);
  }
  const sectorRows=[];
  let selectedTrend=[];
  for (const [name,recs] of grouped.entries()) {
    const agg=aggregateShareholding(recs,name);
    const latest=agg.latest;
    if (latest) sectorRows.push({name,stockCount:latest.stocks,promoter:latest.promoter,fii:latest.fii,dii:latest.dii,others:latest.others,quarters:agg.quarters});
  }
  sectorRows.sort((a,b)=>(b.promoter??-1)-(a.promoter??-1));
  const selectedName = sector === 'ALL' ? (sectorRows[0]?.name || '—') : sector;
  const selectedRow = sectorRows.find(x=>x.name===selectedName) || sectorRows[0] || null;
  selectedTrend = selectedRow?.quarters || [];
  const topFii=[...sectorRows].sort((a,b)=>(b.fii??-1)-(a.fii??-1))[0];
  const topDii=[...sectorRows].sort((a,b)=>(b.dii??-1)-(a.dii??-1))[0];
  const data={
    updatedAt:new Date().toISOString(),
    source:'Screener public company pages; Nifty 500 universe from NSE/Nifty Indices',
    loadingMode: sector === 'ALL' ? `Sampled up to ${SECTOR_ALL_STOCKS_PER_SECTOR} stocks per sector for faster loading` : 'Full selected-sector constituent set',
    selected:{name:selectedRow?.name||'—',stockCount:selectedRow?.stockCount||0,quarter:selectedRow?.quarters?.at(-1)?.label||null,promoter:selectedRow?.promoter??null,fii:selectedRow?.fii??null,dii:selectedRow?.dii??null,others:selectedRow?.others??null,topFii:topFii?topFii.name:null,topDii:topDii?topDii.name:null},
    quarters:selectedTrend,
    sectors:sectorRows,
    failed:records.filter(x=>x.error).map(x=>({symbol:x.symbol,error:x.error}))
  };
  sectorCache.set(key,{timestamp:Date.now(),data}); return data;
}

async function getSectorResults(sector, period='quarterly', view='published', sort='salesYoY', refresh=false) {
  const key = `res:${sector}:${period}:${view}`;
  const cached=sectorCache.get(key);
  if(!refresh&&cached&&Date.now()-cached.timestamp<SECTOR_CACHE_TTL_MS)return cached.data;
  const universe=await sectorUniverse();
  const targets=sectorTargetsForLoad(universe,sector);
  const records=await runSectorFetch(targets,x=>fetchScreenerCompany(x.symbol),SECTOR_FETCH_CONCURRENCY);
  const grouped=new Map();
  for(let i=0;i<targets.length;i++){if(!grouped.has(targets[i].sector))grouped.set(targets[i].sector,[]);grouped.get(targets[i].sector).push(records[i]);}
  const sectorAgg=[];
  for(const [name,recs] of grouped.entries()){
    const usable=recs.filter(x=>(x.results||[]).length);
    if(!usable.length)continue;
    const ag=aggregateResults(usable.map(x=>({symbol:x.symbol,results:x.results})),period);
    const latest=ag.latest||{};
    sectorAgg.push({name,stockCount:latest.stocks||0,sales:latest.sales??null,salesYoY:latest.salesYoY??null,ebitda:latest.ebitda??null,ebitdaYoY:latest.ebitdaYoY??null,pat:latest.pat??null,patYoY:latest.patYoY??null,salesMargin:Number.isFinite(latest.sales)&&latest.sales?latest.pat/latest.sales*100:null,ebitdaMargin:Number.isFinite(latest.sales)&&latest.sales&&Number.isFinite(latest.ebitda)?latest.ebitda/latest.sales*100:null,patMargin:Number.isFinite(latest.sales)&&latest.sales?latest.pat/latest.sales*100:null,periods:ag.periods});
  }
  sectorAgg.sort((a,b)=>(b[sort]??-Infinity)-(a[sort]??-Infinity));
  const selectedName=sector==='ALL'?(sectorAgg[0]?.name||'—'):sector;
  const selected=sectorAgg.find(x=>x.name===selectedName)||sectorAgg[0]||null;
  const data={updatedAt:new Date().toISOString(),source:'Screener public company pages; Nifty 500 universe from NSE/Nifty Indices',
    loadingMode: sector === 'ALL' ? `Sampled up to ${SECTOR_ALL_STOCKS_PER_SECTOR} stocks per sector for faster loading` : 'Full selected-sector constituent set',selected:{name:selected?.name||'—',period:selected?.periods?.at(-1)?.label||null},viewLabel:view==='published'?'Stocks Published Results':'Entire Sector',summary:{stockCount:selected?.stockCount||0,salesYoY:selected?.salesYoY??null,ebitdaYoY:selected?.ebitdaYoY??null,patYoY:selected?.patYoY??null},periods:selected?.periods||[],stocks:sectorAgg.map(x=>({...x,symbol:x.name,published:true,company:`${x.stockCount} stocks`})),failed:records.filter(x=>x.error).map(x=>({symbol:x.symbol,error:x.error}))};
  sectorCache.set(key,{timestamp:Date.now(),data});return data;
}

app.get('/api/sectors', async (req,res)=>{try{const u=await sectorUniverse();const map=new Map();for(const x of u)map.set(x.sector,(map.get(x.sector)||0)+1);res.json({sectors:[...map.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([name,count])=>({name,count}))})}catch(e){res.status(500).json({error:'Unable to load sectors',details:e.message})}});
app.get('/api/sector/shareholding',async(req,res)=>{try{const sector=String(req.query.sector||'').trim();if(!sector)return res.status(400).json({error:'sector is required'});res.json(await getSectorShareholding(sector,req.query.refresh==='1'))}catch(e){console.error(e);res.status(500).json({error:'Unable to load sector shareholding',details:e.message})}});
app.get('/api/sector/results',async(req,res)=>{try{const sector=String(req.query.sector||'').trim();const period=String(req.query.period||'quarterly');const view=String(req.query.view||'published');const sort=String(req.query.sort||'salesYoY');if(!sector)return res.status(400).json({error:'sector is required'});res.json(await getSectorResults(sector,period,view,sort,req.query.refresh==='1'))}catch(e){console.error(e);res.status(500).json({error:'Unable to load sector results',details:e.message})}});
app.get('/sectors',(req,res)=>res.sendFile(path.join(__dirname,'public','sectors.html')));


// -------------------- SECTOR STRENGTH / OPPORTUNITY RADAR --------------------
function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
function returnPoints(v, low=-15, high=20){ return Number.isFinite(v) ? clamp((v-low)/(high-low)*100,0,100) : 50; }
async function getSectorStrengthData(refresh=false){
  if(!refresh && sectorStrengthCache.data && Date.now()-sectorStrengthCache.timestamp<ADVANCED_CACHE_TTL_MS) return sectorStrengthCache.data;
  const universe=await sectorUniverse();

  // Full-universe calculation: do not use a representative 8-stock sample.
  // Every stock returned by the Nifty 500 sector universe is attempted. Coverage is
  // shown honestly as analysed/total when a symbol has insufficient price history.
  const records=await runWithConcurrency(universe, async x=>{
    try {
      const d=await getStockHistory(x.symbol);
      const stats=stockStats(d.rows);
      return {ok:!!stats,symbol:x.symbol,company:x.company||x.symbol,sector:x.sector,stats};
    } catch(_) { return {ok:false,symbol:x.symbol,company:x.company||x.symbol,sector:x.sector}; }
  }, 12);

  const grouped=new Map();
  for(const x of records){ if(!grouped.has(x.sector)) grouped.set(x.sector,[]); grouped.get(x.sector).push(x); }
  const sectors=[];
  for(const [sector, stocks] of grouped.entries()){
    const valid=stocks.filter(x=>x.ok&&x.stats);
    if(!valid.length) continue;
    const avgMetric=k=>avg(valid.map(x=>x.stats[k]));
    const breadth=(period)=> {
      const above=valid.filter(x=>Number.isFinite(x.stats.latest)&&Number.isFinite(x.stats[`sma${period}`])&&x.stats.latest>x.stats[`sma${period}`]);
      const below=valid.filter(x=>Number.isFinite(x.stats.latest)&&Number.isFinite(x.stats[`sma${period}`])&&x.stats.latest<=x.stats[`sma${period}`]);
      return {
        above:above.length, below:below.length, total:above.length+below.length,
        pct:(above.length+below.length)?above.length/(above.length+below.length)*100:0,
        aboveNames:above.map(x=>({symbol:x.symbol,company:x.company})),
        belowNames:below.map(x=>({symbol:x.symbol,company:x.company}))
      };
    };
    const b20=breadth(20), b50=breadth(50), b100=breadth(100), b200=breadth(200);
    const one=avgMetric('change1m'), three=avgMetric('change3m'), six=avgMetric('change6m');
    const score=Math.round(returnPoints(one)*0.20 + returnPoints(three,-20,30)*0.25 + returnPoints(six,-25,40)*0.25 + b20.pct*0.15 + b50.pct*0.15);
    const strength=score>=75?'Strong':score>=60?'Improving':score>=40?'Neutral':'Weak';
    sectors.push({
      sector,stockCount:stocks.length,sampled:valid.length,unavailable:stocks.length-valid.length,
      change1m:one,change3m:three,change6m:six,
      breadth20:b20.pct,breadth50:b50.pct,breadth100:b100.pct,breadth200:b200.pct,
      breadth:{20:b20,50:b50,100:b100,200:b200},score,strength
    });
  }
  sectors.sort((a,b)=>b.score-a.score);
  const analysed=records.filter(x=>x.ok).length;
  const data={updatedAt:new Date().toISOString(), sampleSizePerSector:null, analysed, totalUniverse:universe.length,
    source:'Full Nifty 500 sector universe + Yahoo Finance daily prices', sectors};
  sectorStrengthCache.timestamp=Date.now(); sectorStrengthCache.data=data; return data;
}
app.get('/api/sector-strength', async (req,res)=>{
  try{res.json(await getSectorStrengthData(req.query.refresh==='1'));}
  catch(e){console.error(e);res.status(500).json({error:'Unable to calculate sector strength',details:e.message});}
});

app.get('/api/opportunity-radar', async (req,res)=>{
  try{
    const momentum=await getMomentumWatchData(req.query.refresh==='1');
    const directory=await getStockDirectory(); const dir=new Map(directory.map(x=>[x.symbol,x]));
    const rows=momentum.rows.map(r=>{
      const meta=dir.get(r.stock)||{};
      const mf=Math.min(25,(r.fundsHolding||0)*4 + (r.fundsIncreasing||0)*2);
      const trend=returnPoints(r.change3m,-15,25)*0.18 + returnPoints(r.change6m,-20,35)*0.12;
      const technical=(r.smaUp==='20'?20:r.smaUp==='50'?16:r.smaUp==='100'?10:r.smaUp==='200'?6:0);
      const flow=Math.min(15,Math.max(0,(r.deltaAllocation||0)*20 + (r.fundsIncreasing||0)*2));
      const correction=Number.isFinite(r.correction)?clamp((-r.correction-2)/18*10,0,10):0;
      const score=Math.round(clamp(mf+trend+technical+flow+correction,0,100));
      const bucket=score>=75?'High Opportunity':score>=55?'Watch':'Early / Low';
      const smaSignal = r.smaUp
        ? `Above SMA${r.smaUp} (shortest threshold; longer SMAs implied)`
        : 'Below SMA200';
      const sectorStatus = 'Sector data linked separately';
      return {...r,sector:meta.industry||'Unclassified',smaSignal,sectorStatus,opportunityScore:score,bucket};
    }).sort((a,b)=>b.opportunityScore-a.opportunityScore);
    res.json({updatedAt:new Date().toISOString(), source:'Momentum Watch holdings + stock price trend + Nifty 500 industry mapping', rows, topFunds:momentum.topFunds, providerStatus:momentum.providerStatus});
  }catch(e){console.error(e);res.status(500).json({error:'Unable to build Opportunity Radar',details:e.message});}
});

app.get('/sector-strength',(req,res)=>res.sendFile(path.join(__dirname,'public','sector-strength.html')));
app.get('/opportunity-radar',(req,res)=>res.sendFile(path.join(__dirname,'public','opportunity-radar.html')));

app.get('/health', (req, res) => res.json({ ok: true, service: 'mf-dashboard' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MF Dashboard running on 0.0.0.0:${PORT}`);
});
