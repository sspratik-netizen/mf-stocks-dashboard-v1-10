// Small startup wrapper that adds the Nifty option-chain PCR endpoint
// without changing the main dashboard server implementation.
const express = require("express");

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

const PCR_CACHE_TTL_MS = 5 * 60 * 1000;
let pcrCache = { timestamp: 0, data: null };

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchNseOptionChain() {
  const baseHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/option-chain?symbol=NIFTY",
    "Connection": "keep-alive"
  };

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const landing = await fetch("https://www.nseindia.com/", {
        headers: baseHeaders,
        signal: AbortSignal.timeout(10000)
      });
      const setCookie = landing.headers.get("set-cookie") || "";
      const cookie = setCookie
        .split(/,(?=[^;,]+=)/)
        .map(x => x.split(";")[0].trim())
        .filter(Boolean)
        .join("; ");

      await sleep(250);
      const response = await fetch("https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY", {
        headers: {
          ...baseHeaders,
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

dashboardApp.get("/api/nifty-pcr", async (req, res) => {
  try {
    if (Date.now() - pcrCache.timestamp < PCR_CACHE_TTL_MS && pcrCache.data) {
      return res.json(pcrCache.data);
    }

    const json = await fetchNseOptionChain();
    const data = calculateNiftyPCR(json);
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
