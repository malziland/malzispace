/* Landing page create flow (externalized for strict CSP) */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const form = $('#createForm');
  if (!form) return;
  const t = (key, vars) => {
    if (window.MZ_I18N && typeof window.MZ_I18N.t === 'function') {
      return window.MZ_I18N.t(key, vars);
    }
    return key;
  };

  const showSplash = () => {
    const el = document.getElementById('createSplash');
    if (!el) return null;
    el.classList.add('show');
    return el;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (window.__MZ_CREATING__) return;
    const honeypot = document.getElementById('mzWebsite');
    if (honeypot && honeypot.value) return; // Bot detected
    window.__MZ_CREATING__ = true;
    let redirecting = false;

    const splash = showSplash();
    const steps = [
      { t: t('landing.splash.step.auth'), d: 700 },
      { t: t('landing.splash.step.init'), d: 700 },
      { t: t('landing.splash.step.almost'), d: 700 },
      { t: t('landing.splash.step.great'), d: 700 },
      { t: t('landing.splash.step.parallel'), d: 1200 }
    ];
    const splashText = splash ? splash.querySelector('.splash-text') : null;
    const playSplash = async () => {
      if (!splashText) {
        await new Promise((r) => setTimeout(r, 4000));
        return;
      }
      for (const s of steps) {
        splashText.textContent = s.t;
        await new Promise((r) => setTimeout(r, s.d));
      }
    };

    const titleInput = $('#spaceTitle');
    const title = titleInput ? titleInput.value.trim() : '';
    const btn = $('#createForm .btn');
    if (btn) btn.disabled = true;

    try {
      // Generate E2E key first and derive write proof for the backend.
      const raw = new Uint8Array(32);
      (window.crypto || crypto).getRandomValues(raw);
      let bin = '';
      for (let i = 0; i < raw.length; i++) bin += String.fromCharCode(raw[i]);
      const key = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      const digest = await crypto.subtle.digest('SHA-256', raw);
      const proofU8 = new Uint8Array(digest);
      let proofBin = '';
      for (let i = 0; i < proofU8.length; i++) proofBin += String.fromCharCode(proofU8[i]);
      const keyProof = btoa(proofBin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      // Wait for App Check initialization before requesting headers
      try { if (window.__MZ_APP_CHECK_READY__) await window.__MZ_APP_CHECK_READY__; } catch (e) {}

      const headers = { 'Content-Type': 'application/json' };
      try {
        if (typeof window.__MZ_getAppCheckHeaders__ === 'function') {
          Object.assign(headers, await window.__MZ_getAppCheckHeaders__());
        }
      } catch (e) {}

      let titlePayload = { title: '' };
      if (title) {
        const cryptoKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(title.slice(0, 80));
        const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, encoded);
        const cipherU8 = new Uint8Array(cipherBuf);
        let ivBin = '', cBin = '';
        for (let i = 0; i < iv.length; i++) ivBin += String.fromCharCode(iv[i]);
        for (let i = 0; i < cipherU8.length; i++) cBin += String.fromCharCode(cipherU8[i]);
        titlePayload = {
          title_enc: btoa(cBin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
          title_nonce: btoa(ivBin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
          title_algo: 'aes-256-gcm'
        };
      }

      const createPromise = (async () => {
        const res = await fetch('/api/create', {
          method: 'POST',
          headers,
          body: JSON.stringify(Object.assign({}, titlePayload, { key_proof: keyProof }))
        });
        return res.json();
      })();
      const splashPromise = playSplash();

      const json = await createPromise;
      await splashPromise;
      if (!json || json.error || !json.id) {
        alert(t('landing.error.server', { error: ((json && json.error) ? json.error : 'server_error') }));
        return;
      }

      const target = new URL('/space.html', window.location.origin);
      target.searchParams.set('id', String(json.id));
      target.hash = key;
      redirecting = true;
      window.location.assign(target.toString());
    } catch (err) {
      alert(t('landing.error.network'));
    } finally {
      if (!redirecting) {
        window.__MZ_CREATING__ = false;
        if (btn) btn.disabled = false;
        if (splash) splash.classList.remove('show');
      }
    }
  });
})();
