# v1.9.2 Local Test Build

This build is prepared only for local testing. No GitHub changes are made from this build.

## Included improvements

### Sector Strength Dashboard
- Coverage now explicitly shows `sampled / total` instead of the unclear `8/17 sampled` wording.
- Added SMA20, SMA50, SMA100 and SMA200 breadth counts.
- Hover/click a sector name to inspect sampled stocks above and below SMA20.
- The tooltip clearly states that only the displayed representative sample was analysed.

### Opportunity Radar
- SMA wording is explicit: `Above SMA20`, `Above SMA50`, etc.
- Stocks with no moving average above price display `Below SMA200` instead of a blank.
- Sector information is kept visible with a smaller secondary status line.

### Momentum Stock Watch
- SMA cells now explicitly show `Below SMA200` when price is below all tracked SMAs.
- The existing shortest-SMA convention remains: if price is above SMA20, longer averages are implied.
- Correction sorting now keeps rows with unavailable correction data at the end instead of producing misleading ordering.
- Existing fund-by-fund details, flow counts and category filtering are retained.

### IPO Market
- Added an alias-aware Yahoo price-history path for symbols that require a verified alternate Yahoo ticker.
- Existing listing/current-price/date/chart handling is retained.
- No fake or guessed IPO universe has been added. The existing curated mainboard universe remains the source and should be expanded only from a verified IPO source.

### Mobile / usability
- Navigation becomes horizontally scrollable on mobile instead of squeezing all tabs.
- Headers and controls are more compact on mobile.
- Tables retain horizontal scrolling rather than compressing columns into unreadable widths.

## Validation performed
- `node --check server.js`
- `node --check public/momentum-watch.js`
- `node --check public/sector-strength.js`
- `node --check public/opportunity-radar.js`

## Local run

```bash
npm install
npm start
```

Then open:

http://localhost:3000

