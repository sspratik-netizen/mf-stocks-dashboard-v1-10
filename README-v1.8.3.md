# MF Dashboard v1.8.3

## New: Momentum Stock Watch

The new page is available at:

http://localhost:3000/momentum-watch

### Fund universe
- Top 5 Small Cap funds
- Top 5 Mid Cap funds
- Selection uses the existing Mutual Fund category ranking.
- Minimum consensus filter defaults to 2 funds.

### Stock fields
The final table is designed for:
- Funds Holding
- Average Allocation
- Delta Allocation (percentage points vs previous month)
- Funds increasing / unchanged / decreasing
- New funds / exits
- Correction from the previous ~63 trading-day high
- SMA Up: 20/50/100/200
- Watch/Monitor status

### Holdings provider
The Momentum Stock Watch now uses monthly portfolio-disclosure pages derived from AMC/AMFI data and parses:
- current % of NAV
- month-over-month allocation delta (percentage points)
- new/exited/increased/reduced status where disclosed

The stock consensus requires a stock to be held by at least 2 of the selected 10 funds. Stock prices are loaded from the dashboard's Yahoo/NSE price loader for correction and SMA20/50/100/200 calculations.

If a provider page is temporarily unavailable, that fund is shown under Holdings Data Status instead of creating synthetic holdings.

The existing Sector Analysis page/files are retained for compatibility, but the Sector Analysis tab has been removed from the main navigation.


### v1.8.4 UI updates
- Stock names now strip 12-character ISINs accidentally included by some portfolio source rows.
- Added `View 5Y chart` per stock, opening the existing individual stock page.
- Added restrained blue/slate visual accents, row hover, card accents and clearer stock links without making the dashboard overly colorful.


## v1.8.5 changes
- Full-page Momentum Stock Watch loading overlay.
- Small Cap / Mid Cap selector now shows only the selected category's Top 5 fund cards.
- SMA Up display is hierarchical: if price is above SMA20, only `20` is shown; otherwise longer SMAs are shown.
- Individual stock chart now overlays SMA20, SMA50, SMA100 and SMA200 with distinct colors.
- Market Breadth navigation now includes Chart Patterns.
- Replaced the three failing momentum holdings sources with current/fallback portfolio sources and expanded the holdings parser.
- Added a restrained dark-navy professional visual theme.
