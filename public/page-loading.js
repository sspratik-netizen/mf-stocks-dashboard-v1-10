/* Unified loading overlay for every dashboard page. */
(function () {
  const TITLE = 'Loading market data...';
  const SUBTITLE = 'Backend calculation in progress';
  const NOTE = 'Fetching prices, analysing market signals and preparing your dashboard.';
  let overlay;

  function ensure() {
    overlay = document.getElementById('globalPageLoading');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'globalPageLoading';
    overlay.className = 'page-loading-overlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML = '<div class="page-loading-card">'
      + '<h2>' + TITLE + '</h2>'
      + '<p class="page-loading-subtitle">' + SUBTITLE + '</p>'
      + '<div class="page-loading-bar" aria-hidden="true"></div>'
      + '<p class="page-loading-note">' + NOTE + '</p>'
      + '</div>';
    document.body.prepend(overlay);
    return overlay;
  }

  function normalizeLocal(root) {
    (root || document).querySelectorAll('.loading-title,.mw-loading-title,.loading-card h2').forEach(function (el) {
      if (el.textContent !== TITLE) el.textContent = TITLE;
    });
  }

  ensure();
  normalizeLocal(document);
  window.showPageLoading = function () { ensure(); normalizeLocal(document); overlay.classList.remove('hidden'); };
  window.hidePageLoading = function () { ensure(); overlay.classList.add('hidden'); };
  window.addEventListener('dashboard-loaded', window.hidePageLoading);
  window.addEventListener('dashboard-loading', window.showPageLoading);
  window.addEventListener('error', function () { setTimeout(window.hidePageLoading, 300); });
  window.addEventListener('unhandledrejection', function () { setTimeout(window.hidePageLoading, 300); });
})();
