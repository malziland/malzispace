/* malzispace runtime config (no build step) */
(function () {
  'use strict';

  // Central place for runtime config + feature flags.
  // Safe to commit: Firebase web config is public.

  const existing = (window.MZ_CONFIG && typeof window.MZ_CONFIG === 'object') ? window.MZ_CONFIG : {};

  const firebase =
    existing.firebase ||
    {
      apiKey: 'AIzaSyBp1aHB6bfr28Fyos3Z6Y5HzWh7ki_DW0U',
      authDomain: 'malzispace.firebaseapp.com',
      projectId: 'malzispace',
      storageBucket: 'malzispace.firebasestorage.app',
      messagingSenderId: '457350771644',
      appId: '1:457350771644:web:1bfe76d93b81e9316ab1b9'
    };

  const defaultWsUrl = 'wss://malzispace-collab-457350771644.europe-west3.run.app';
  const collabWsUrl =
    existing.collabWsUrl ||
    (typeof window.MZ_COLLAB_WS_URL === 'string' && window.MZ_COLLAB_WS_URL) ||
    defaultWsUrl;

  window.MZ_CONFIG = Object.assign({}, existing, {
    firebase,
    collabWsUrl
  });

  // Global used by modules for WebSocket URL
  window.MZ_COLLAB_WS_URL = collabWsUrl;

  // Client feature flags (server still enforces App Check + expiry).
  const defaults = {
    enableCrdt: true,
    enableWs: true,
    enablePresence: true
  };

  const flags = Object.assign({}, defaults, (window.MZ_FLAGS && typeof window.MZ_FLAGS === 'object') ? window.MZ_FLAGS : {});
  try {
    const params = new URLSearchParams(window.location.search);
    for (const k of Object.keys(defaults)) {
      const v = params.get('ff_' + k);
      if (v === '0') flags[k] = false;
      if (v === '1') flags[k] = true;
    }
  } catch (e) {}

  window.MZ_FLAGS = flags;
})();
