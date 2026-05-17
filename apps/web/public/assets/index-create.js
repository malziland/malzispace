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

  const lockCheckbox = document.getElementById('lockOnCreate');
  const lockHint = document.getElementById('lockOnCreateHint');
  if (lockCheckbox && lockHint) {
    const syncHint = () => { lockHint.hidden = !lockCheckbox.checked; };
    lockCheckbox.addEventListener('change', syncHint);
    syncHint();
  }

  const toB64Url = (u8) => {
    let bin = '';
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  async function deriveKeyProof(rawBytes) {
    const digest = await crypto.subtle.digest('SHA-256', rawBytes);
    return toB64Url(new Uint8Array(digest));
  }

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
      const key = toB64Url(raw);
      const keyProof = await deriveKeyProof(raw);

      // Optional owner secret: only generated when the "lock on create"
      // checkbox is ticked. The space is then created in read_only=true mode
      // and only the owner-URL can write or unlock it.
      let ownerSecretB64 = '';
      let ownerKeyProof = '';
      if (lockCheckbox && lockCheckbox.checked) {
        const ownerRaw = new Uint8Array(32);
        (window.crypto || crypto).getRandomValues(ownerRaw);
        ownerSecretB64 = toB64Url(ownerRaw);
        ownerKeyProof = await deriveKeyProof(ownerRaw);
      }

      // Wait for App Check initialization before requesting headers
      try { if (window.__MZ_APP_CHECK_READY__) await window.__MZ_APP_CHECK_READY__; } catch (e) {}

      const headers = { 'Content-Type': 'application/json' };
      try {
        if (typeof window.__MZ_getAppCheckHeaders__ === 'function') {
          Object.assign(headers, await window.__MZ_getAppCheckHeaders__());
        }
      } catch (e) {}

      let titlePayload = {};
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

      const createBody = Object.assign({}, titlePayload, { key_proof: keyProof });
      if (ownerKeyProof) createBody.owner_key_proof = ownerKeyProof;
      const createPromise = (async () => {
        const res = await fetch('/api/create', {
          method: 'POST',
          headers,
          body: JSON.stringify(createBody)
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
      target.hash = ownerSecretB64 ? `${key}.${ownerSecretB64}` : key;
      if (ownerSecretB64) {
        // One-shot flag picked up by the space page to show the owner-welcome
        // banner exactly once. SessionStorage scopes it to this tab.
        try { sessionStorage.setItem('mz_fresh_owner_' + String(json.id), '1'); } catch (e) {}
      }
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
