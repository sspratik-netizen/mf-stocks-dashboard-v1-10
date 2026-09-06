# v1.7.9 — Market Breadth exact-date latest-row fix

## Important correction
For the latest Market Breadth row, a stock is included only when its closing-price date exactly matches the breadth/index date.

Example:
- Breadth date: 2026-08-25
- Stock close: 2026-08-25 -> included
- Stock close: 2026-08-24 -> excluded from the latest metric

The previous-day price is no longer silently substituted.

## SMA
SMA20/50/100/200 use the actual/raw closing prices and the trading-day history ending on the exact latest date.

## RS55
For the latest row, both the stock endpoint and benchmark endpoint must exist on the exact breadth date. The 55-trading-day start is taken from the same series' 55th prior trading observation.

## Historical rows
The existing historical behavior is retained: the stock may use the latest price on or before the historical date within the stale-data allowance. Historical rows still use the current constituent universe.

## Audit
Latest-row audit now explicitly shows excluded stocks and the reason when the exact date is missing.

Run:
```bash
npm install
npm start
```
