/* Space bootstrap (externalized for strict CSP) */
(function () {
  'use strict';

  function idFromPathname(pathname) {
    const path = String(pathname || '');
    const m =
      path.match(/\/space\/([a-z0-9]{6,24})\/?$/i) ||
      path.match(/\/s\/([a-z0-9]{6,24})\/?$/i);
    return m ? String(m[1] || '').toLowerCase() : '';
  }

  const params = new URLSearchParams(window.location.search);
  const queryId = String(params.get('id') || '').trim().toLowerCase();
  const pathId = idFromPathname(window.location.pathname);
  const id = queryId || pathId;
  const ok = /^[a-z0-9]{6,24}$/.test(id);
  if (!ok) {
    window.__MZ_INVALID_SPACE_ID__ = true;
    return;
  }

  if (!queryId) {
    try {
      const normalized = new URL(window.location.href);
      normalized.pathname = '/space.html';
      normalized.searchParams.set('id', id);
      window.history.replaceState(null, '', normalized.toString());
    } catch (e) {}
  }

  window.SPACE_ID = id;
})();
