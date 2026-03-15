/* malzispace App Check bootstrap (shared by index + space) */

// This file is loaded as a module:
//   <script type="module" src="assets/appcheck.js"></script>
//
// It populates:
// - window.__MZ_APP_CHECK_READY__ (Promise)
// - window.__MZ_APP_CHECK__ ({ getToken(), getHeaders() })
// - window.__MZ_getAppCheckHeaders__() (helper)

if (!window.__MZ_APP_CHECK_READY__) {
  window.__MZ_APP_CHECK_READY__ = (async () => {
    try {
      const cfg = window.MZ_CONFIG && window.MZ_CONFIG.firebase;
      const debugToken =
        typeof window.__MZ_APPCHECK_DEBUG_TOKEN__ === 'string' && window.__MZ_APPCHECK_DEBUG_TOKEN__.trim()
          ? window.__MZ_APPCHECK_DEBUG_TOKEN__.trim()
          : '';
      if (!cfg || !cfg.appId) return null;

      const { initializeApp } = await import('https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js');
      const { initializeAppCheck, CustomProvider, getToken } = await import('https://www.gstatic.com/firebasejs/12.8.0/firebase-app-check.js');
      const {
        fetchCustomAppCheckToken,
        exchangeDebugTokenForAppCheck
      } = await import('./appcheck-pow.mjs');

      const app = initializeApp(cfg);
      const provider = new CustomProvider({
        getToken: async () => {
          if (debugToken) {
            return exchangeDebugTokenForAppCheck(window.MZ_CONFIG, debugToken);
          }
          return fetchCustomAppCheckToken(window.MZ_CONFIG);
        }
      });
      const appCheck = initializeAppCheck(app, {
        provider,
        isTokenAutoRefreshEnabled: true
      });

      let cachedToken = null;
      let cachedAtMs = 0;

      async function getTokenCached(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && cachedToken && (now - cachedAtMs) < 30_000) {
          return cachedToken;
        }
        try {
          const res = await getToken(appCheck, forceRefresh);
          cachedToken = (res && res.token) ? res.token : null;
          cachedAtMs = now;
          return cachedToken;
        } catch (e) {
          return null;
        }
      }

      const api = {
        getToken: async () => {
          const tok = await getTokenCached(false);
          if (tok) return tok;
          return await getTokenCached(true);
        },
        getHeaders: async () => {
          const tok = await api.getToken();
          return tok ? { 'X-Firebase-AppCheck': tok } : {};
        }
      };

      window.__MZ_APP_CHECK__ = api;
      return api;
    } catch (e) {
      return null;
    }
  })();
}

window.__MZ_getAppCheckHeaders__ = async function __MZ_getAppCheckHeaders__() {
  try {
    if (!window.__MZ_APP_CHECK_READY__) return {};
    const api = await window.__MZ_APP_CHECK_READY__;
    if (api && typeof api.getHeaders === 'function') return await api.getHeaders();
  } catch (e) {}
  return {};
};
