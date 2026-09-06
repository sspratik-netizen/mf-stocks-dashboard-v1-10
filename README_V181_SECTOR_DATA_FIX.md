# v1.8.1 — Sector Analysis data-loading fix

## Root cause fixed
The Nifty 500 constituent CSV is commonly ordered as `Company Name, Industry, Symbol, Series, ISIN Code`. The sector module was reading the columns by position instead of using the header indexes, which could turn company names into symbols and symbols into industries. This caused sector selections such as Construction to have zero usable stocks.

## Fixes
- Parse Symbol / Company Name / Industry by detected CSV header columns.
- Add Screener URL fallback from consolidated company page to standalone company page.
- Add Referer header for Screener requests.
- Refresh button now actually bypasses the 6-hour sector cache.
- Existing missing-data behavior remains fail-safe; unavailable values are shown as `—`.

## Run
```bash
npm install
npm start
```
Open `http://localhost:3000/sectors` and click Refresh.
