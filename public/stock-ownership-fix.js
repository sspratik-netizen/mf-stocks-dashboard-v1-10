// Keeps unavailable ownership values as — instead of coercing null to 0.
// Re-renders the ownership section after the original stock page has initialized.
(function () {
  window.ownershipNum = function (value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  window.ownershipPct = function (value) {
    const n = window.ownershipNum(value);
    return n === null ? "—" : n.toFixed(2) + "%";
  };
  window.ownershipChange = function (a, b) {
    const x = window.ownershipNum(a);
    const y = window.ownershipNum(b);
    return x === null || y === null ? null : x - y;
  };
  setTimeout(function () {
    if (typeof window.loadOwnership === "function") window.loadOwnership();
  }, 500);
})();
