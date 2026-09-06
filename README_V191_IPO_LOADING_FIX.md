# v1.9.1 - IPO Market + Loading + Momentum Route Fix

- Added IPO Market page for a curated NSE mainboard IPO universe from the last three years.
- Shows listing date, listing price, current price, return since listing and annualized return.
- Current prices are fetched from Yahoo Finance daily history.
- Added a full-screen shared loading experience to the data pages.
- Fixed missing `/momentum-watch` page route that caused `Cannot GET /momentum-watch`.
- Added IPO Market navigation across the dashboard.

Run locally with `npm install` and `npm start`, then open `http://localhost:3000`.
