(() => {
  const path = location.pathname.replace(/\/$/, "") || "/";
  const guides = {
    "/": { title: "How to use Mutual Funds", intro: "Compare short- and long-term fund performance, category rank and the screening signal.", points: ["Use 30D to spot recent strength or correction; 180D/360D show whether the longer trend is intact.", "Category Rank compares funds within their category using the dashboard's longer-term performance ranking.", "Momentum means positive recent and longer-term performance. Attractive / Strong Accumulation identify corrections in higher-ranked funds.", "Use the signal as a shortlist, then check the fund's mandate, portfolio, risk and valuation before investing."], footer: "Signals are screening outputs, not personalized investment advice." },
    "/breadth": { title: "How to use Market Breadth", intro: "Breadth tells you whether a market move is supported by many constituents or only a small group.", points: ["RS55 > 0 counts stocks outperforming the selected index over 55 trading days.", "SMA20/50/100/200 counts stocks trading above each moving average. Higher breadth generally means broader participation.", "PCR is Put Open Interest ÷ Call Open Interest for the nearest Nifty 50 option expiry. Use it as context, not as a standalone signal.", "Look for confirmation: improving breadth plus a supportive trend is generally more useful than one isolated reading."], footer: "PCR uses NSE option-chain OI when available." },
    "/momentum-watch": { title: "How to use Momentum Watch", intro: "Find stocks that are shared across leading Small Cap or Mid Cap funds and examine allocation changes.", points: ["Funds shows how many selected funds currently hold the stock.", "Avg Allocation shows the average portfolio weight among funds that hold it.", "Δ Allocation shows whether tracked funds are increasing or reducing exposure versus the prior month.", "Correction and SMA status help separate recent weakness from a still-intact trend."], footer: "Holdings are disclosure-based and can lag the live market. This is a research screen, not a buy recommendation." },
    "/sector-strength": { title: "How to use Sector Strength", intro: "Compare sector momentum and breadth to identify areas with stronger or weaker participation.", points: ["1M, 3M and 6M show sector price momentum over different horizons.", "SMA breadth shows how many analysed stocks are above each moving average.", "Strength combines momentum and breadth; use Coverage to see how complete the underlying stock data is.", "A sector is more convincing when both momentum and breadth improve together."], footer: "Sector strength is a quantitative screening indicator, not a sector allocation recommendation." },
    "/opportunity-radar": { title: "How to use Opportunity Radar", intro: "A transparent screening score combines mutual-fund consensus, allocation flow, momentum, trend and correction.", points: ["MF Consensus shows how widely the stock appears across tracked funds.", "Allocation Δ highlights recent fund-manager buying or selling pressure.", "3M trend and SMA position help confirm whether the stock still has technical strength.", "Use High Opportunity and Watch as research buckets; always inspect the underlying stock and fund evidence."], footer: "The score is not a valuation model, price target or guaranteed return forecast." },
    "/ipo-market": { title: "How to use IPO Market", intro: "Compare recent mainboard IPOs by listing performance and current market price.", points: ["Return Since Listing compares the latest available market price with the IPO issue price.", "Annualized return is shown only after at least one full year of listing, avoiding misleading short-period CAGR values.", "Use the listing date and current data date to understand how long the stock has been trading.", "Open the stock chart for context; a strong listing return does not by itself indicate future performance."], footer: "SME IPOs are excluded from this screen." },
    "/patterns": { title: "How to use Chart Patterns", intro: "The scanner finds technical pattern candidates across the current Nifty 500 universe.", points: ["Recent contains formations that ended within the latest 30 trading sessions; Past contains older candidates in the scan window.", "Confidence measures how strongly the algorithmic conditions matched the pattern rules.", "Use the chart to inspect the actual price structure, trigger level and surrounding trend.", "Confirm volume, support/resistance and breakout or breakdown behaviour before treating a pattern as actionable."], footer: "Patterns are algorithmic candidates and may not match every human chartist's interpretation." },
    "/stock": { title: "How to use Stock Detail", intro: "Use this page to inspect a stock's price history, returns, moving averages and detected patterns.", points: ["Use the search box to find a Nifty 500 stock and load its historical price series.", "1M–5Y returns provide multiple time horizons; compare them rather than relying on one period.", "Technical Snapshot shows SMA20/50/200 and the 52-week range to provide trend context.", "Chart Patterns are screening outputs and should be verified on the actual chart."], footer: "Price and technical data are quantitative research aids, not investment advice." }
  };

  const guide = guides[path];
  if (!guide) return;

  const style = document.createElement("style");
  style.textContent = `
    .feature-help-link{position:fixed;right:10px;top:50%;transform:translateY(-50%);z-index:40;display:flex;align-items:center;gap:6px;padding:9px 11px;border:1px solid rgba(148,163,184,.28);border-radius:999px;background:rgba(20,30,50,.96);color:#dbeafe;text-decoration:none;font-size:12px;font-weight:800;box-shadow:0 8px 22px rgba(0,0,0,.18);white-space:nowrap}
    .feature-help-link:hover{background:rgba(30,45,70,.98);color:#fff}
    .feature-help-section{box-sizing:border-box;max-width:1100px;margin:48px auto 36px;padding:28px 30px;border:1px solid rgba(148,163,184,.24);border-radius:18px;background:linear-gradient(180deg,rgba(20,30,50,.98),rgba(13,20,36,.98));color:#e5e7eb;box-shadow:0 12px 34px rgba(0,0,0,.14);scroll-margin-top:24px}
    .feature-help-section .help-badge{display:inline-block;margin-bottom:10px;padding:4px 8px;border-radius:999px;background:rgba(59,130,246,.15);color:#93c5fd;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
    .feature-help-section h2{margin:0 0 8px;color:#fff;font-size:22px}.feature-help-section .help-intro{margin:0 0 18px;color:#b8c3d4;line-height:1.55;font-size:14px}.feature-help-section ul{margin:0;padding-left:20px}.feature-help-section li{margin:0 0 11px;color:#dbe3ee;font-size:14px;line-height:1.5}.feature-help-section .help-footer{border-top:1px solid rgba(148,163,184,.18);margin-top:18px;padding-top:14px;color:#9fb0c6;font-size:12px;line-height:1.5}
    @media (min-width:1100px){main.container{padding-right:0!important}}
    @media (max-width:700px){.feature-help-link{right:7px;padding:8px 10px;font-size:11px}.feature-help-section{margin:34px 12px 28px;padding:22px 18px;border-radius:14px}.feature-help-section h2{font-size:19px}.feature-help-section li{font-size:13px}}
  `;
  document.head.appendChild(style);

  const link = document.createElement("a");
  link.className = "feature-help-link";
  link.href = "#feature-help";
  link.innerHTML = "How to use ↓";
  link.title = "Jump to the How to use guide";
  document.body.appendChild(link);

  const section = document.createElement("section");
  section.id = "feature-help";
  section.className = "feature-help-section";
  section.innerHTML = `<div class="help-badge">Feature guide</div><h2>${guide.title}</h2><p class="help-intro">${guide.intro}</p><ul>${guide.points.map(x => `<li>${x}</li>`).join("")}</ul><div class="help-footer">${guide.footer}</div>`;

  const main = document.querySelector("main");
  if (main) main.appendChild(section);
  else document.body.appendChild(section);
})();
