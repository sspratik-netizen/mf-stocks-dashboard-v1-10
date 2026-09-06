
## v1.8.12 Chart Patterns UI
- Removed OK/NOK review controls from Nifty 500 Chart Patterns.
- Replaced them with a single **View 1Y Chart** action per candidate.
- Removed review filtering/state persistence from the pattern page.

# Mutual Fund Dashboard v1.7.6 — Market Breadth Data Fix

## What changed

### Market Breadth
- Benchmark index history now comes from the official Nifty Indices historical price-index endpoint instead of Yahoo index tickers.
- Fixes Yahoo 404 failures such as `NISM250.NS` and `^CNXFINANCE`.
- Breadth SMA20/50/100/200 now uses the stock's actual closing price (`Close`), not dividend-adjusted close.
- RS55 uses stock price return versus the official Nifty benchmark price return.
- A stock is excluded from a metric if its latest price is more than 7 calendar days old, preventing stale/suspended stocks from distorting breadth.
- Latest-row hover lists remain available for validation.
- Each metric keeps its own valid denominator.

## Important interpretation
The last 30 rows use the **current constituent list** applied to historical prices. This is not the same as historical reconstitution-aware breadth published by some providers. Exact historical breadth would require archived constituent lists for each date.

## Run
```bash
npm install
npm start
```
Then open:
`http://localhost:3000/breadth?index=NIFTY%20BANK`

## Data sources
- Constituents: NSE/Nifty Indices public constituent CSV.
- Index benchmark history: Nifty Indices official historical price-index data endpoint.
- Stock price history: Yahoo Finance chart endpoint (development/free stage).
