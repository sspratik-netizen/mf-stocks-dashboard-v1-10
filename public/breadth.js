const indexSelect = document.getElementById("indexSelect");
const displayMode = document.getElementById("displayMode");
const tableBody = document.querySelector("#breadthTable tbody");
const statusEl = document.getElementById("breadthStatus");
const refreshBtn = document.getElementById("breadthRefresh");
const pageTitle = document.getElementById("pageTitle");
const dateEl = document.getElementById("breadthDate");
const loadingOverlay = document.getElementById("breadthLoadingOverlay");

let breadthData = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function valueFor(row, key) {
  const pct = row[`${key}Pct`];
  const count = row[key];
  const denom = row[`${key}Denom`] ?? row.total;
  return displayMode.value === "count"
    ? `${count}/${denom}`
    : `${Number(pct).toFixed(0)}%`;
}

function heatClass(pct) {
  if (pct >= 80) return "breadth-strong";
  if (pct >= 60) return "breadth-good";
  if (pct >= 40) return "breadth-mid";
  if (pct >= 20) return "breadth-weak";
  return "breadth-bad";
}

let pinnedTooltip = null;

function tooltipCell(row, key, label) {
  const isLatest = breadthData.latest && row.date === breadthData.latest.date;
  const detail = row.details?.[key];
  const value = valueFor(row, key);
  if (!isLatest || !detail) {
    return `<td class="breadth-cell ${heatClass(row[`${key}Pct`])}">${value}<small>${label}</small></td>`;
  }

  const formatMoney = v => Number.isFinite(Number(v))
    ? `₹${Number(v).toLocaleString("en-IN", {maximumFractionDigits: 2})}`
    : "—";
  const formatPct = v => Number.isFinite(Number(v))
    ? `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(2)}%`
    : "—";

  const list = (arr, empty = "None") => arr.length
    ? arr.map(x => {
        if (key === "rs55") {
          return `<div class="breadth-audit-row">
            <div><b>${escapeHtml(x.symbol)}</b> <span>${escapeHtml(x.company)}</span></div>
            <div class="audit-values">Close ${formatMoney(x.close)} · Stock 55D ${formatPct(x.stockReturn)} · Index 55D ${formatPct(x.benchmarkReturn)} · RS55 ${formatPct(x.rs55)}</div>
          </div>`;
        }
        return `<div class="breadth-audit-row">
          <div><b>${escapeHtml(x.symbol)}</b> <span>${escapeHtml(x.company)}</span></div>
          <div class="audit-values">Close ${formatMoney(x.close)} · ${label.replace("Close > ", "")} ${formatMoney(x.sma)} · Difference ${formatMoney(x.difference)} (${formatPct(x.differencePct)})</div>
        </div>`;
      }).join("")
    : `<div class="breadth-none">${empty}</div>`;

  return `<td class="breadth-cell latest-hover ${heatClass(row[`${key}Pct`])}" data-tooltip-key="${key}">
    ${value}<small>${label} · hover / click to inspect</small>
    <div class="breadth-tooltip" aria-hidden="true">
      <div class="tooltip-title">${label}</div>
      <div class="tooltip-count">Above: ${detail.above.length} · Below: ${detail.below.length} · Valid: ${row[`${key}Denom`] ?? row.total} · Excluded: ${detail.unavailable?.length ?? 0}</div>
      <div class="tooltip-help">Latest date only. Click to pin. Scroll/select/copy stock names and audit values.</div>
      <div class="tooltip-section"><strong>Above</strong>${list(detail.above)}</div>
      <div class="tooltip-section"><strong>Below</strong>${list(detail.below)}</div>
      ${detail.unavailable?.length ? `<div class="tooltip-section"><strong>Excluded from this metric (${detail.unavailable.length})</strong>${detail.unavailable.map(x => `<div class="breadth-audit-row"><b>${escapeHtml(x.symbol)}</b> <span>${escapeHtml(x.company)}</span><div class="audit-values">${escapeHtml(x.reason || "Unavailable")}</div></div>`).join("")}</div>` : ""}
    </div>
  </td>`;
}

function render() {
  if (!breadthData) return;

  pageTitle.textContent = `${breadthData.index.replace("NIFTY ", "Nifty ")} Breadth`;
  dateEl.textContent = breadthData.latest
    ? `Latest: ${formatDate(breadthData.latest.date)}`
    : "No data";

  tableBody.innerHTML = breadthData.daily.map(row => `
    <tr>
      <td class="breadth-date">${formatDate(row.date)}</td>
      ${tooltipCell(row, "rs55", "RS55 > 0")}
      ${tooltipCell(row, "sma20", "Close > SMA20")}
      ${tooltipCell(row, "sma50", "Close > SMA50")}
      ${tooltipCell(row, "sma100", "Close > SMA100")}
      ${tooltipCell(row, "sma200", "Close > SMA200")}
    </tr>
  `).join("");

  document.querySelectorAll(".latest-hover").forEach(cell => {
    const tip = cell.querySelector(".breadth-tooltip");
    const position = () => {
      if (!tip) return;
      const r = cell.getBoundingClientRect();
      const width = Math.min(440, window.innerWidth - 16);
      let left = r.left + r.width / 2 - width / 2;
      left = Math.max(8, Math.min(window.innerWidth - width - 8, left));
      let top = r.bottom + 8;
      const maxH = Math.min(520, window.innerHeight - 16);
      if (top + maxH > window.innerHeight) top = Math.max(8, r.top - maxH - 8);
      tip.style.width = `${width}px`; tip.style.maxHeight = `${maxH}px`; tip.style.left = `${left}px`; tip.style.top = `${top}px`;
    };
    cell.addEventListener("mouseenter", () => { if (!pinnedTooltip) { tip.classList.add("show"); position(); } });
    cell.addEventListener("mousemove", position);
    cell.addEventListener("mouseleave", () => { if (pinnedTooltip !== tip) tip.classList.remove("show"); });
    cell.addEventListener("click", e => {
      e.stopPropagation();
      if (pinnedTooltip && pinnedTooltip !== tip) pinnedTooltip.classList.remove("pinned","show");
      pinnedTooltip = pinnedTooltip === tip ? null : tip;
      if (pinnedTooltip) { tip.classList.add("show","pinned"); position(); }
      else tip.classList.remove("pinned","show");
    });
  });

  const bench = breadthData.benchmarkLatest?.close;
  statusEl.textContent =
    `${breadthData.daily.length} trading sessions · ${breadthData.priceDataLoaded}/${breadthData.constituentCount} constituents with price history · Latest constituents validated: ${breadthData.latest?.total || 0}/${breadthData.constituentCount} · ${bench ? `Index close ${Number(bench).toLocaleString("en-IN", {maximumFractionDigits:2})} · ` : ""}${breadthData.constituentSource || "source unavailable"}`;

  document.getElementById("breadthUpdated").textContent =
    `Updated: ${new Date(breadthData.updatedAt).toLocaleString()}`;

  const errors = breadthData.failedSymbols || [];
  const errorSection = document.getElementById("breadthErrors");
  const errorList = document.getElementById("breadthErrorList");
  if (!errors.length) errorSection.classList.add("hidden");
  else {
    errorSection.classList.remove("hidden");
    errorList.innerHTML = errors.map(x =>
      `<div class="error-item"><strong>${escapeHtml(x.symbol)}</strong> — ${escapeHtml(x.company)} — ${escapeHtml(x.error || "")}</div>`
    ).join("");
  }
}

async function loadIndices() {
  const response = await fetch("/api/breadth/indices");
  const indices = await response.json();

  indexSelect.innerHTML = indices.map(x =>
    `<option value="${escapeHtml(x.key)}">${escapeHtml(x.label)}</option>`
  ).join("");

  const params = new URLSearchParams(location.search);
  const requested = params.get("index");
  if (requested && indices.some(x => x.key === requested)) {
    indexSelect.value = requested;
  }
}

async function loadBreadth(forceRefresh = false) { window.showPageLoading?.("Loading Market Breadth…","Calculating breadth across the selected index.");
  refreshBtn.disabled = true;
  loadingOverlay?.classList.remove("hidden");
  tableBody.innerHTML = `
    <tr><td colspan="6" class="empty loading-row">Calculating breadth… please wait.</td></tr>
  `;
  statusEl.textContent = "Loading stock price history and calculating breadth...";

  try {
    const index = indexSelect.value;
    const url = forceRefresh
      ? `/api/breadth?index=${encodeURIComponent(index)}&refresh=1`
      : `/api/breadth?index=${encodeURIComponent(index)}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.details || data.error || "Unable to load breadth");
    }

    breadthData = data;
    render();
  } catch (error) {
    console.error(error);
    breadthData = null;
    tableBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty">Unable to load this index. ${escapeHtml(error.message)}</td>
      </tr>
    `;
    dateEl.textContent = "No data";
    statusEl.textContent = `Error: ${error.message}`;
  } finally {
    loadingOverlay?.classList.add("hidden");
    refreshBtn.disabled = false;
    window.hidePageLoading?.();
    window.dispatchEvent(new Event("dashboard-loaded"));
  }
}

indexSelect.addEventListener("change", () => {
  history.replaceState({}, "", `/breadth?index=${encodeURIComponent(indexSelect.value)}`);
  loadBreadth();
});
displayMode.addEventListener("change", render);
refreshBtn.addEventListener("click", () => loadBreadth(true));
document.addEventListener("click", () => {
  if (pinnedTooltip) { pinnedTooltip.classList.remove("pinned","show"); pinnedTooltip = null; }
});

(async function init() {
  try {
    await loadIndices();
    await loadBreadth();
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  }
})();
