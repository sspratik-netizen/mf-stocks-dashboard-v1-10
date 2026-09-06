let allFunds = [];
let currentAlertFilter = "ALL";

const tableBody = document.getElementById("fundTable");
const searchInput = document.getElementById("search");
const categorySelect = document.getElementById("category");
const sortSelect = document.getElementById("sort");
const alertsOnly = document.getElementById("alertsOnly");
const refreshBtn = document.getElementById("refreshBtn");
const statusEl = document.getElementById("status");

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function percentClass(value) {
  if (value === null || value === undefined) return "neutral";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function formatNavDate(dateString) {
  if (!dateString) return "";
  const [dd, mm, yyyy] = dateString.split("-");
  return `${dd}/${mm}/${yyyy}`;
}

function returnCell(value, refDate) {
  return `
    <div class="return ${percentClass(value)}">${formatPercent(value)}</div>
    <div class="ref-date">${formatNavDate(refDate)}</div>
  `;
}

function signalHtml(row) {
  const map = {
    STRONG_ACCUMULATION: ["signal strong", "Strong Accumulation"],
    ATTRACTIVE: ["signal attractive", "Attractive"],
    WATCH: ["signal watch", "Watch"],
    MOMENTUM: ["signal momentum", "Momentum"],
    NEUTRAL: ["signal neutral", "—"]
  };
  const [cls, label] = map[row.signal] || map.NEUTRAL;
  return `<span class="${cls}">${label}</span>${row.opportunityScore != null ? `<small class="score">Score ${row.opportunityScore}</small>` : ""}`;
}

function alertHtml(alert) {
  if (!alert) return `<span class="no-alert">—</span>`;

  return alert.split(" ").map(item => {
    const cls = item === "W" ? "weekly" : "monthly";
    return `<span class="badge ${cls}">${item}</span>`;
  }).join(" ");
}

function renderTable() {
  const search = searchInput.value.trim().toLowerCase();
  const category = categorySelect.value;
  const sort = sortSelect.value;

  let rows = allFunds.filter(row => {
    const matchesSearch = row.fund.toLowerCase().includes(search);
    const matchesCategory = category === "ALL" || row.category === category;
    const matchesAlerts = !alertsOnly.checked || (currentAlertFilter === "WEEKLY" ? String(row.alert||"").includes("W") : currentAlertFilter === "MONTHLY" ? String(row.alert||"").includes("M") : Boolean(row.alert));
    return matchesSearch && matchesCategory && matchesAlerts;
  });

  rows.sort((a,b) => {
    const [key,dir] = sort.split("-");
    if (key === "name") return dir === "desc" ? b.fund.localeCompare(a.fund) : a.fund.localeCompare(b.fund);
    const av = a[`change${key}d`], bv = b[`change${key}d`];
    const aa = Number.isFinite(av) ? av : (dir === "asc" ? Infinity : -Infinity);
    const bb = Number.isFinite(bv) ? bv : (dir === "asc" ? Infinity : -Infinity);
    return dir === "asc" ? aa-bb : bb-aa;
  });

  tableBody.innerHTML = rows.map(row => `
    <tr>
      <td class="fund-name">${escapeHtml(row.fund)}</td>
      <td><span class="category-pill">${escapeHtml(row.category)}</span></td>
      <td class="nav-cell">
        <strong>₹${row.latestNav.toFixed(2)}</strong>
        <small>${formatNavDate(row.latestDate)}</small>
      </td>
      <td>${returnCell(row.change7d, row.referenceDates?.d7)}</td>
      <td>${returnCell(row.change30d, row.referenceDates?.d30)}</td>
      <td>${returnCell(row.change180d, row.referenceDates?.d180)}</td>
      <td>${returnCell(row.change360d, row.referenceDates?.d360)}</td>
      <td class="rank-cell">${row.categoryRank ? `${row.categoryRank}/${row.categoryTotal}` : "—"}</td><td>${signalHtml(row)}</td><td class="alert-cell">${alertHtml(row.alert)}</td>
    </tr>
  `).join("");

  if (!rows.length) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="10" class="empty">No funds match the selected filters.</td>
      </tr>
    `;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function populateCategories() {
  const categories = [...new Set(allFunds.map(row => row.category))].sort();

  categorySelect.innerHTML =
    `<option value="ALL">All categories</option>` +
    categories.map(category =>
      `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`
    ).join("");
}

function updateSummary(data) {
  document.getElementById("totalFunds").textContent = data.totalFunds;

  const positive30d = data.results.filter(
    row => row.change30d !== null && row.change30d > 0
  ).length;

  const weeklyThreshold = data.thresholds?.weekly ?? -5;
  const monthlyThreshold = data.thresholds?.monthly ?? -10;

  const weekly = data.results.filter(
    row => row.change7d !== null && row.change7d <= weeklyThreshold
  ).length;

  const monthly = data.results.filter(
    row => row.change30d !== null && row.change30d <= monthlyThreshold
  ).length;

  document.getElementById("positive30d").textContent = positive30d;
  document.getElementById("weeklyAlerts").textContent = weekly;
  document.getElementById("monthlyAlerts").textContent = monthly;

  const updated = new Date(data.updatedAt);
  document.getElementById("updatedAt").textContent =
    `Updated: ${updated.toLocaleString()}`;

  document.getElementById("dataAge").textContent =
    `NAV data: ${data.results[0]?.latestDate || "—"}`;
}

function showErrors(failed) {
  const section = document.getElementById("errors");
  const list = document.getElementById("errorList");

  if (!failed || failed.length === 0) {
    section.classList.add("hidden");
    list.innerHTML = "";
    return;
  }

  section.classList.remove("hidden");
  list.innerHTML = failed.map(item => `
    <div class="error-item">
      <strong>${escapeHtml(item.fund)}</strong>
      <span>— ${escapeHtml(item.error)}</span>
    </div>
  `).join("");
}

async function loadData(forceRefresh = false) { window.showPageLoading?.("Loading Mutual Fund Dashboard…","Fetching latest NAV and fund performance data.");
  refreshBtn.disabled = true;
  statusEl.textContent = "Loading NAV data...";

  try {
    const url = forceRefresh ? "/api/funds?refresh=1" : "/api/funds";
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.error) throw new Error(data.error);

    allFunds = data.results;

    populateCategories();
    updateSummary(data);
    showErrors(data.failed);
    renderTable();

    statusEl.textContent =
      `Showing ${data.successfulCount} of ${data.totalFunds} funds`;
  } catch (error) {
    console.error(error);
    allFunds = [];
    tableBody.innerHTML = `
      <tr>
        <td colspan="10" class="empty">Unable to load data. Check the Node.js console.</td>
      </tr>
    `;
    document.getElementById("totalFunds").textContent = "—";
    document.getElementById("positive30d").textContent = "—";
    document.getElementById("weeklyAlerts").textContent = "—";
    document.getElementById("monthlyAlerts").textContent = "—";
    statusEl.textContent = `Error: ${error.message}`;
    tableBody.innerHTML = `
      <tr>
        <td colspan="10" class="empty">Unable to load data. Check the Node.js console.</td>
      </tr>
    `;
  } finally {
    refreshBtn.disabled = false;
    window.hidePageLoading?.(); window.dispatchEvent(new Event("dashboard-loaded"));
  }
}

searchInput.addEventListener("input", renderTable);
categorySelect.addEventListener("change", renderTable);
sortSelect.addEventListener("change", renderTable);
alertsOnly.addEventListener("change", () => { if(!alertsOnly.checked) currentAlertFilter="ALL"; renderTable(); });
refreshBtn.addEventListener("click", () => loadData(true));

loadData();


function filterByAlertType(type) {
  const alertsOnly = document.getElementById("alertsOnly");
  alertsOnly.checked = true;
  currentAlertFilter = type;
  renderTable();
}


document.getElementById("weeklyAlerts")?.addEventListener("click", () => {
  currentAlertFilter = "WEEKLY";
  document.getElementById("alertsOnly").checked = true;
  renderTable();
});
document.getElementById("monthlyAlerts")?.addEventListener("click", () => {
  currentAlertFilter = "MONTHLY";
  document.getElementById("alertsOnly").checked = true;
  renderTable();
});
