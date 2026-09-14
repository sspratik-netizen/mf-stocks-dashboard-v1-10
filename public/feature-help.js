(() => {
  const path = location.pathname.replace(/\/$/, "") || "/";
  const guides = {
    "/": {
      title: "How to use Mutual Funds",
      intro: "Compare fund performance, category rank and portfolio signals across multiple time horizons.",
      shows: "Mutual-fund performance and screening signals help you compare funds within their category.",
      read: [
        "30D highlights recent strength or correction; 180D/360D show the longer trend.",
        "Category Rank compares funds within their category using longer-term performance.",
        "Momentum means positive recent and longer-term performance; Attractive / Strong Accumulation flag selected corrections."
      ],
      look: [
        "Prefer signals supported by several time periods.",
        "Check fund mandate, portfolio, risk and valuation before investing."
      ],
      important: ["Signals are screening outputs, not personalized investment advice."]
    },
    "/breadth": {
      title: "How to use Market Breadth",
      intro: "See whether a market move is broad-based or being driven by only a small group of stocks.",
      shows: "Nifty 50 breadth counts how many constituents are outperforming or trading above key moving averages.",
      read: [
        "RS55 > 0 counts stocks outperforming the selected index over 55 trading days.",
        "Above SMA20/50/100/200 counts stocks trading above each moving average.",
        "PCR is Put Open Interest ÷ Call Open Interest for the Nifty 50 option expiry shown in the table."
      ],
      look: [
        "Higher breadth generally means broader market participation.",
        "Rising breadth alongside price strength is more useful than one isolated reading.",
        "PCR can provide sentiment context; compare it with breadth and price trend."
      ],
      important: ["PCR and breadth are research indicators, not standalone buy/sell signals."]
    },
    "/momentum-watch": {
      title: "How to use Momentum Stock Watch",
      intro: "Find stocks shared across leading Small Cap or Mid Cap funds and inspect allocation changes.",
      shows: "The table highlights stocks appearing across selected funds together with allocation and trend information.",
      read: [
        "Funds shows how many selected funds hold the stock.",
        "Avg Allocation shows the average portfolio weight among funds that hold it.",
        "Δ Allocation shows whether tracked funds increased or reduced exposure versus the prior month.",
        "SMA and Status help separate recent weakness from an intact longer-term trend."
      ],
      look: [
        "Higher fund count plus increasing allocation can indicate broader fund-manager interest.",
        "Check price trend and SMA status before drawing conclusions."
      ],
      important: ["Holdings are disclosure-based and can lag the live market. This is a research screen, not a buy recommendation."]
    },
    "/sector-strength": {
      title: "How to use Sector Strength",
      intro: "Compare sector momentum and breadth to identify areas with stronger or weaker participation.",
      shows: "Sector returns and moving-average breadth combine to show whether strength is broad or concentrated.",
      read: [
        "1M, 3M and 6M show sector price momentum over different horizons.",
        "SMA breadth shows how many analysed stocks are above each moving average.",
        "Strength combines momentum and breadth; Coverage shows how complete the underlying data is."
      ],
      look: [
        "A sector is more convincing when momentum and breadth improve together.",
        "Compare several time periods rather than relying on one strong return."
      ],
      important: ["Sector strength is a quantitative screening indicator, not a sector allocation recommendation."]
    },
    "/opportunity-radar": {
      title: "How to use Opportunity Radar",
      intro: "Use the transparent score to shortlist stocks using fund consensus, flow, momentum and trend.",
      shows: "The radar combines mutual-fund ownership, allocation changes, price momentum, trend and correction factors.",
      read: [
        "MF Consensus shows how widely the stock appears across tracked funds.",
        "Allocation Δ highlights recent fund-manager buying or selling pressure.",
        "3M trend and SMA position help confirm whether technical strength remains intact."
      ],
      look: [
        "Use High Opportunity and Watch as research buckets.",
        "Inspect the underlying fund and stock evidence before making a decision."
      ],
      important: ["The score is not a valuation model, price target or guaranteed return forecast."]
    },
    "/ipo-market": {
      title: "How to use IPO Market",
      intro: "Compare recent mainboard IPOs by listing performance and current market price.",
      shows: "The page compares IPO issue price, listing date, current price and return since listing.",
      read: [
        "Return Since Listing compares the latest available market price with the IPO issue price.",
        "Annualized return is shown only after at least one full year of listing.",
        "Listing date and data date show how long the stock has been trading."
      ],
      look: [
        "Compare returns with the time since listing.",
        "Open the stock chart to inspect the price trend rather than relying only on listing return."
      ],
      important: ["SME IPOs are excluded. A strong listing return does not by itself indicate future performance."]
    },
    "/patterns": {
      title: "How to use Chart Patterns",
      intro: "Use algorithmic pattern candidates as a starting point for deeper chart analysis.",
      shows: "The scanner finds technical pattern candidates across the current Nifty 500 universe.",
      read: [
        "Recent contains formations that ended within the latest 30 trading sessions; Past contains older candidates.",
        "Confidence indicates how strongly the algorithmic conditions matched the pattern rules.",
        "Use the chart to inspect the actual price structure and trigger level."
      ],
      look: [
        "Confirm volume, support/resistance and breakout or breakdown behaviour.",
        "Check the surrounding trend before treating a pattern as actionable."
      ],
      important: ["Patterns are algorithmic candidates and may not match every human chartist's interpretation."]
    },
    "/stock": {
      title: "How to use Stock Detail",
      intro: "Inspect a stock's price history, returns, moving averages and detected patterns.",
      shows: "The page provides multi-period returns, trend indicators, 52-week range and chart-pattern context.",
      read: [
        "Use the search box to find a Nifty 500 stock and load its historical price series.",
        "1M–5Y returns provide multiple time horizons; compare them rather than relying on one period.",
        "SMA20/50/200 and the 52-week range provide trend context.",
        "Chart Patterns are screening outputs and should be verified on the actual chart."
      ],
      look: [
        "Look for agreement between returns, moving averages and price structure.",
        "Use the chart to validate unusual moves or pattern signals."
      ],
      important: ["Price and technical data are quantitative research aids, not investment advice."]
    }
  };

  const guide = guides[path];
  if (!guide) return;

  const style = document.createElement("style");
  style.textContent = `
    .feature-help-link{position:fixed;right:18px;top:50%;transform:translateY(-50%);z-index:40;padding:10px 12px;border:1px solid rgba(148,163,184,.35);border-radius:999px;background:rgba(20,30,50,.96);color:#bfdbfe;font-size:12px;font-weight:800;box-shadow:0 8px 24px rgba(0,0,0,.18);cursor:pointer;white-space:nowrap}
    .feature-help-link:hover{background:#243554;color:#fff}
    .feature-help-section{box-sizing:border-box;margin:28px 0 10px;padding:28px;border:1px solid #dce5ef;border-radius:16px;background:#fff;box-shadow:0 8px 28px rgba(15,23,42,.06);scroll-margin-top:24px}
    .feature-help-section .help-heading{display:flex;align-items:center;gap:10px;margin:0 0 8px;color:#10264a;font-size:24px;font-weight:800}
    .feature-help-section .help-heading-icon{font-size:26px;line-height:1}
    .feature-help-section .help-intro{margin:0 0 20px;color:#526581;font-size:14px;line-height:1.55}
    .feature-help-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
    .feature-help-card{padding:18px;border-radius:10px;min-height:145px;box-sizing:border-box}
    .feature-help-card h4{margin:0 0 10px;font-size:16px;font-weight:800}
    .feature-help-card p,.feature-help-card li{font-size:13px;line-height:1.5;color:#334155}
    .feature-help-card p{margin:0}
    .feature-help-card ul{margin:0;padding-left:18px}.feature-help-card li{margin-bottom:7px}
    .feature-help-card.show{background:#eef7ff}.feature-help-card.show h4{color:#0874dc}
    .feature-help-card.read{background:#effbf4}.feature-help-card.read h4{color:#07833d}
    .feature-help-card.look{background:#fff9e9}.feature-help-card.look h4{color:#a56a00}
    .feature-help-card.important{background:#fff1f1}.feature-help-card.important h4{color:#d31f2f}
    .feature-help-note{margin-top:16px;padding-top:13px;border-top:1px solid #e5e7eb;color:#64748b;font-size:12px;line-height:1.45}
    @media (min-width:1100px){.feature-help-link{right:12px}.feature-help-section{width:100%}}
    @media (max-width:1099px){.feature-help-link{position:relative;right:auto;top:auto;transform:none;display:inline-block;margin:8px 0 4px}.feature-help-section{margin:22px 0 10px;padding:20px}.feature-help-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media (max-width:700px){.feature-help-section{padding:16px;border-radius:12px}.feature-help-section .help-heading{font-size:20px}.feature-help-grid{grid-template-columns:1fr}.feature-help-card{min-height:0;padding:15px}}
  `;
  document.head.appendChild(style);

  const section = document.createElement("section");
  section.id = "how-to-use";
  section.className = "feature-help-section";
  section.innerHTML = `
    <h2 class="help-heading"><span class="help-heading-icon">💡</span>${guide.title}</h2>
    <p class="help-intro">${guide.intro}</p>
    <div class="feature-help-grid">
      <div class="feature-help-card show"><h4>What this page shows</h4><p>${guide.shows}</p></div>
      <div class="feature-help-card read"><h4>How to read it</h4><ul>${guide.read.map(x => `<li>${x}</li>`).join("")}</ul></div>
      <div class="feature-help-card look"><h4>What to look for</h4><ul>${guide.look.map(x => `<li>${x}</li>`).join("")}</ul></div>
      <div class="feature-help-card important"><h4>Important</h4><ul>${guide.important.map(x => `<li>${x}</li>`).join("")}</ul></div>
    </div>
    <div class="feature-help-note">Use these indicators as research context and combine them with the underlying data before making decisions.</div>
  `;

  const main = document.querySelector("main.container") || document.querySelector("main.stock-page") || document.querySelector("main");
  if (!main) return;
  main.appendChild(section);

  const link = document.createElement("button");
  link.type = "button";
  link.className = "feature-help-link";
  link.textContent = "How to use ↓";
  link.addEventListener("click", () => section.scrollIntoView({ behavior: "smooth", block: "start" }));
  document.body.appendChild(link);
})();
