# IPO Market universe fix

## What changed

- Removed the hard-coded IPO universe from `server.js`.
- Added `config/ipoUniverse.js` so the IPO list is maintained independently.
- Removed the effective 30-row curated-page limitation.
- The API now applies a **rolling 3-year date window at runtime**.
- SME IPOs are intentionally excluded from the configured universe.
- IPOs remain visible even when Yahoo price history is unavailable; they are marked as `Price unavailable` instead of being silently dropped.
- The table header is sticky while scrolling.
- The column is now labelled **IPO Issue Price** because the previous values were mostly issue/allotment prices, not first-day listing-market prices.

## Maintaining the universe

Add new mainboard listings to `config/ipoUniverse.js` using:

```js
{ symbol: 'NSE_SYMBOL', company: 'Company Ltd.', listingDate: 'YYYY-MM-DD', listingPrice: 123 }
```

Do not add SME listings.

The server automatically excludes entries older than three years when the API runs.

## Local test

```bash
npm install
npm start
```

Then open:

`http://localhost:3000/ipo-market`
