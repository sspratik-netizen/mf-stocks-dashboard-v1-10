# MF Dashboard v1.7.5 — Pattern marker alignment fix

Fixes Double Top / Double Bottom chart markers appearing at the wrong price/date.

## Root cause
Pattern detection runs on a trailing detection window, so `patternMeta.firstIndex` and `secondIndex` are relative to that window. The chart renderer was treating them as indexes into the full historical series.

## Fix
The chart renderer now anchors Double Top/Bottom markers using `pattern.startDate` and `pattern.endDate`, maps those dates into the displayed chart window, and uses the actual close price from that chart row for the marker Y coordinate.

This ensures the dots are exactly on the plotted price line.


## v1.8.8 Sticky table header fix
- Fixed breadth/table header positioning while page scrolling.
- Removed table-wrapper overflow that caused the sticky header to attach to the wrapper and appear below the first data row.
- Table headers now remain directly below the sticky dark page header across pages.
