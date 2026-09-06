# v1.8.0 — Sector Analysis

Added `/sectors` with two tabs:

- **Shareholding** — all current Nifty 500 industries/sectors, sorted by promoter holding descending; Promoter/FII/DII/Others composition; 10-quarter trend for the selected sector.
- **Results** — sector-level Sales/EBITDA/PAT trends, quarterly/annual views, YoY metrics, and Stocks Published Results / Entire Sector controls.

## Data provider for the free prototype

The prototype reads public Screener company pages for quarterly shareholding and financial-result tables, and uses the current Nifty 500 constituent/industry list from NSE/Nifty Indices. The parser is deliberately fail-safe: missing fields remain unavailable rather than being invented.

Before commercial/public deployment, replace the provider with a licensed fundamentals/shareholding feed and verify redistribution rights.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000/sectors`.
