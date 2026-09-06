# v1.7.7 — Market Breadth latest-row audit for all indices

## What changed

Every Market Breadth index now gets the same latest-row audit popup for:
- RS55 > 0
- Close > SMA20
- Close > SMA50
- Close > SMA100
- Close > SMA200

For SMA metrics the latest-row popup shows, for every valid stock:
- Symbol / company
- Actual close used
- SMA value used
- Difference in rupees
- Difference percentage

For RS55 it shows:
- Symbol / company
- Actual close used
- Stock 55-trading-day return
- Benchmark/index 55-trading-day return
- RS55 difference

It also shows Above / Below / Excluded counts. The calculation remains based on the same valid data used for the percentage, so the popup can be used to audit every latest-row percentage.

## Indices

The change is generic and applies to all indices configured in `config/indices.js`, including Nifty 50, Next 50, 100, 200, 500, Midcap 150, Smallcap 250, Bank, Financial Services, IT and Pharma.

## Run

```bash
npm install
npm start
```
