// Small startup wrapper that adds Nifty option-chain PCR endpoints
// without changing the main dashboard server implementation.
const express = require("express");
const AdmZip = require("adm-zip");

const originalListen = express.application.listen;
let dashboardApp = null;

express.application.listen = function (...args) {
  dashboardApp = this;
  return this;
};

require("./server.js");

if (!dashboardApp) {
  throw new Error("Dashboard Express app was not captured");
}

const PCR_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let pcrCache = { timestamp: 0, data: null };

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const nseHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
  "Accept": "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.nseindia.com/option-chain?symbol=NIFTY",
  "Connection": "keep-alive"
};

async function fetchNseCookies() {
  const landing = await fetch("https://www.nseindia.com/", {
    headers: nseHeaders,
    signal: AbortSignal.timeout(10000)
  });
  const setCookie = landing.headers.get("set-cookie") || "";
  return setCookie
    .split(/,(?=[^;,]+=)/)
    .map(x => x.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function fetchNseOptionChain() {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const cookie = await fetchNseCookies();
      await sleep(250);
      const response = await fetch("https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY", {
        headers: {
          ...nseHeaders,
          ...(cookie ? { Cookie: cookie } : {})
        },
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error(`NSE option-chain HTTP ${response.status}`);
      const json = await response.json();
      if (!json?.records?.data) throw new Error("NSE option-chain response missing data");
      return json;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await sleep(700);
    }
  }
  throw lastError || new Error("NSE option-chain unavailable");
}

function calculateNiftyPCR(json) {
  const expiries = json?.records?.expiryDates || [];
  const expiry = expiries[0];
  if (!expiry) throw new Error("No current Nifty option expiry available");

  let callOI = 0;
  let putOI = 0;
  let contracts = 0;

  for (const item of json.records.data || []) {
    if (item.expiryDate !== expiry) continue;
    const ce = Number(item.CE?.openInterest);
    const pe = Number(item.PE?.openInterest);
    if (Number.isFinite(ce)) callOI += ce;
    if (Number.isFinite(pe)) putOI += pe;
    if (item.CE || item.PE) contracts++;
  }

  if (!(callOI > 0) || !(putOI >= 0)) {
    throw new Error("Nifty option OI is unavailable");
  }

  return {
    date: new Date().toISOString().slice(0, 10),
    index: "NIFTY 50",
    expiry,
    callOI,
    putOI,
    pcr: putOI / callOI,
    asOf: json.records.timestamp || json.records.data?.[0]?.CE?.lastUpdateTime || new Date().toISOString(),
    contracts,
    source: "NSE Nifty option chain · nearest expiry · total Put OI / Call OI"
  };
}

function csvRows(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  const parseLine = line => {
    const out = [];
    let value = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { value += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === "," && !quoted) {
        out.push(value);
        value = "";
      } else {
        value += ch;
      }
    }
    out.push(value);
    return out;
  };

  const headers = parseLine(lines[0]).map(x => x.trim());
  return lines.slice(1).map(line => {
    const values = parseLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (values[i] ?? "").trim(); });
    return row;
  });
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function formatNseDate(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

async function fetchHistoricalPcrForDate(date, cookie) {
  const key = dateKey(date);
  const ymd = formatNseDate(date);
  const url = `https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_${ymd}_F_0000.csv.zip`;

  try {
    const response = await fetch(url, {
      headers: {
        ...nseHeaders,
        Referer: "https://www.nseindia.com/all-reports-derivatives",
        ...(cookie ? { Cookie: cookie } : {})
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    const csvEntry = entries.find(entry => entry.entryName.toLowerCase().endsWith(".csv"));
    if (!csvEntry) throw new Error("NSE F&O archive contains no CSV");

    const rows = csvRows(csvEntry.getData().toString("utf8"));
    const options = rows.filter(row =>
      row.TckrSymb === "NIFTY" &&
      (row.FinInstrmTp === "OPTIDX" || row.OptnTp === "CE" || row.OptnTp === "PE") &&
      (row.OptnTp === "CE" || row.OptnTp === "PE") &&
      row.XpryDt
    );

    if (!options.length) return null;

    // Pick the nearest expiry that was still live on that trading date.
    const expiryDates = [...new Set(options.map(row => row.XpryDt))]
      .filter(x => x >= key)
      .sort();
    if (!expiryDates.length) return null;
    const expiry = expiryDates[0];

    let callOI = 0;
    let putOI = 0;
    let callContracts = 0;
    let putContracts = 0;
    for (const row of options) {
      if (row.XpryDt !== expiry) continue;
      const oi = Number(row.OpnIntrst);
      if (!Number.isFinite(oi)) continue;
      if (row.OptnTp === "CE") { callOI += oi; callContracts++; }
      if (row.OptnTp === "PE") { putOI += oi; putContracts++; }
    }

    if (!(callOI > 0) || !(putOI >= 0)) return null;

    return {
      date: key,
      expiry,
      callOI,
      putOI,
      pcr: putOI / callOI,
      callContracts,
      putContracts,
      source: "NSE F&O UDiFF bhavcopy · NIFTY nearest live expiry · total Put OI / Call OI"
    };
  } catch (error) {
    console.warn(`Historical Nifty PCR ${key} unavailable:`, error.message);
    return null;
  }
}

async function fetchHistoricalNiftyPCR() {
  const cookie = await fetchNseCookies().catch(() => "");
  const results = [];
  const cursor = new Date();
  // Search back far enough to cover weekends and NSE holidays, collecting 30 actual files.
  for (let i = 0; i < 55 && results.length < 30; i++) {
    const date = new Date(cursor);
    date.setUTCDate(cursor.getUTCDate() - i);
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
    results.push({ date, key: dateKey(date) });
  }

  const output = [];
  const concurrency = 4;
  for (let i = 0; i < results.length; i += concurrency) {
    const batch = results.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(x => fetchHistoricalPcrForDate(x.date, cookie)));
    batchResults.filter(Boolean).forEach(x => output.push(x));
    if (output.length >= 30) break;
  }

  output.sort((a, b) => b.date.localeCompare(a.date));
  return output.slice(0, 30);
}

async function buildPcrPayload() {
  const [current, history] = await Promise.all([
    fetchNseOptionChain().then(calculateNiftyPCR),
    fetchHistoricalNiftyPCR()
  ]);

  // Replace today's archive value with the live option-chain value when both exist.
  const historical = history.filter(x => x.date !== current.date);
  historical.unshift({
    date: current.date,
    expiry: current.expiry,
    callOI: current.callOI,
    putOI: current.putOI,
    pcr: current.pcr,
    callContracts: current.contracts,
    putContracts: current.contracts,
    source: current.source
  });

  return {
    index: "NIFTY 50",
    latest: current,
    history: historical.slice(0, 30),
    source: "NSE live option chain + NSE F&O UDiFF historical bhavcopy"
  };
}

dashboardApp.get("/api/nifty-pcr", async (req, res) => {
  try {
    if (!req.query.refresh && Date.now() - pcrCache.timestamp < PCR_CACHE_TTL_MS && pcrCache.data) {
      return res.json(pcrCache.data);
    }

    const data = await buildPcrPayload();
    pcrCache = { timestamp: Date.now(), data };
    res.json(data);
  } catch (error) {
    console.error("Nifty PCR error:", error.message);
    res.status(503).json({
      error: "Nifty PCR temporarily unavailable",
      details: error.message
    });
  }
});

const port = process.env.PORT || 3000;
originalListen.call(dashboardApp, port, () => {
  console.log(`Dashboard listening on port ${port}`);
});
