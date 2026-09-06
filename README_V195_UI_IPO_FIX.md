# v1.9.5 Local Test Build

Changes in this build:

1. IPO Market table redesigned to fit all desktop columns without a horizontal scrollbar.
2. IPO Market no longer uses an internal fixed-height scrolling table area.
3. IPO table becomes card-style on mobile.
4. IPO quote lookup now tries configured Yahoo aliases, then NSE (.NS), then BSE (.BO) for the same security.
5. IPO current price uses the latest actual/raw exchange close rather than dividend-adjusted close.
6. Added INDGN -> INDEGENE Yahoo alias.
7. Applied a unified compact dark navigation/header layout across all pages, matching the supplied Mutual Fund Dashboard visual direction.
8. Unified page cards, filters, tables, spacing and mobile breakpoints.

Local start:

```bash
npm install
npm start
```

Open: http://localhost:3000
