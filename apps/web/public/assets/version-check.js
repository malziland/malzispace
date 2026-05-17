/**
 * Detect a new deployment while the page is already open and prompt the
 * user to reload. The build pipeline rewrites every asset filename with
 * a content hash, so a deploy changes the `app.<hash>.js` reference in
 * the page's HTML. We periodically (and on tab-visibility) re-fetch the
 * current document, extract that filename, and compare it to the one
 * the running tab booted with — if it differs, a fresh build is live.
 *
 * Note: page HTML is served with `Cache-Control: no-store`, so the
 * comparison fetch never reads a stale copy.
 */
(function () {
  'use strict';

  // bf-cache restoration brings a page back from memory in its previous DOM
  // and JS state — `Cache-Control: no-store` does not prevent this on
  // Chromium/WebKit. Force a fresh reload whenever the page is shown from
  // bf-cache so users never see a stale build after a deploy.
  window.addEventListener('pageshow', (event) => {
    if (event && event.persisted) {
      try { window.location.reload(); } catch (e) {}
    }
  });

  const POLL_MS = 60_000;
  const APP_ATTR = /<script[^>]+src="([^"]*assets\/modules\/app\.[a-f0-9]+\.js)"/i;

  function getRunningAppSrc() {
    const el = document.querySelector('script[type="module"][src*="modules/app."]');
    return el ? el.getAttribute('src') : '';
  }

  const runningSrc = getRunningAppSrc();
  if (!runningSrc) return;

  let bannerShown = false;
  let inFlight = false;
  const url = window.location.pathname + (window.location.search || '');

  function showUpdateBanner() {
    if (bannerShown) return;
    bannerShown = true;
    const wrap = document.createElement('div');
    wrap.id = 'mzUpdateBanner';
    wrap.setAttribute('role', 'status');
    wrap.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;background:#0f1620;border:1px solid rgba(56,189,248,.5);border-radius:10px;padding:10px 14px;font-size:.85rem;display:flex;align-items:center;gap:12px;box-shadow:0 6px 24px rgba(0,0,0,.4)';
    const text = document.createElement('span');
    text.textContent = 'Neue Version verfügbar.';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Neu laden';
    btn.style.cssText = 'background:#38bdf8;color:#0b0f14;border:0;padding:6px 12px;border-radius:8px;font:inherit;cursor:pointer;font-weight:600';
    btn.addEventListener('click', () => {
      try { window.location.reload(); } catch (e) {}
    });
    wrap.appendChild(text);
    wrap.appendChild(btn);
    document.body.appendChild(wrap);
  }

  async function check() {
    if (inFlight || bannerShown) return;
    inFlight = true;
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Accept': 'text/html' }
      });
      if (!res.ok) return;
      const text = await res.text();
      const match = text.match(APP_ATTR);
      if (!match) return;
      const latestSrc = match[1];
      // Server can return a relative URL like assets/modules/app.X.js, while
      // the in-DOM src might match exactly. Compare the asset filename only
      // to be resilient against leading slashes.
      const latestFile = latestSrc.split('/').pop();
      const runningFile = runningSrc.split('/').pop();
      if (latestFile && runningFile && latestFile !== runningFile) {
        showUpdateBanner();
      }
    } catch (e) {} finally {
      inFlight = false;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.setInterval(check, POLL_MS);
  // First check after a small delay so initial page load isn't slowed.
  setTimeout(check, 5_000);
})();
