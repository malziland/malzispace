// Standalone countdown module (doesn't rely on app.js)
(function(){
  // Guard: prevent multiple initializations on pages with repeated script includes
  if (window.__MZ_COUNTDOWN_ACTIVE) { return; }
  window.__MZ_COUNTDOWN_ACTIVE = true;

  function qs(sel){ return document.querySelector(sel); }
  function getParam(name){ const m = new URLSearchParams(location.search).get(name); return m || ''; }
  function getParamInt(name){
    const v = parseInt(getParam(name), 10);
    return Number.isFinite(v) ? v : 0;
  }
  function getSpaceId(){
    if (typeof window.SPACE_ID === 'string' && window.SPACE_ID) return window.SPACE_ID;
    const urlId = getParam('id'); if (urlId) return urlId;
    const el = qs('[data-space-id]'); if (el) return el.getAttribute('data-space-id');
    return '';
  }
  function fmtLeft(ms){
    if (ms < 0) ms = 0;
    const total = Math.floor(ms/1000);
    const h = Math.floor(total/3600);
    const m = Math.floor((total%3600)/60);
    const s = total%60;
    const pad = (n)=>String(n).padStart(2,'0');
    return (h>0?h:'0')+':'+pad(m)+':'+pad(s);
  }

  const id = getSpaceId();
  if (!id) return;

  const el = qs('[data-countdown]') || qs('#countdown') || qs('#ttl') || document.body;
  let expiresMs = 0;
  let baseLeftMs = 0;
  let startMs = 0;
  let skewMs = 0;
  let timer = null;
  let expiredShown = false;
  const demoMode = getParamInt('demo') === 1;

  function showExpired(){
    if (expiredShown) return;
    expiredShown = true;
    try{ window.__MZ_EXPIRED__ = true; }catch(e){}
    try{ if (typeof window.__MZ_onExpired__ === 'function') window.__MZ_onExpired__(); }catch(e){}
    const banner = document.getElementById('expiredNotice');
    if (banner) banner.hidden = false;
    const status = document.getElementById('status');
    if (status) {
      status.textContent = (window.MZ_I18N && typeof window.MZ_I18N.t === 'function') ? window.MZ_I18N.t('status.expired') : 'Abgelaufen';
      status.classList.remove('is-warning', 'is-info');
      status.classList.add('is-danger', 'pill--expired');
    }
    const title = document.getElementById('titleView');
    try{
      title?.setAttribute('contenteditable','false');
      if (title) title.textContent = '';
    }catch(e){}
    const ed = document.getElementById('editor');
    try {
      ed?.setAttribute('contenteditable','false');
      if ('disabled' in ed) ed.disabled = true;
      if (ed && 'value' in ed) ed.value = '';
      if (ed) ed.innerHTML = '';
    } catch(e){}
  }

  function tick(){
    if (!expiresMs && !baseLeftMs){ el.textContent = '—:—:—'; return; }
    const now = Date.now();
    const left = baseLeftMs > 0 ? (baseLeftMs - (now - startMs)) : (expiresMs - (now + skewMs));
    if (left <= 0){
      el.textContent = '00:00:00';
      showExpired();
      clearInterval(timer);
      return;
    }
    el.textContent = fmtLeft(left);
  }

  function bootstrap(){
    let attempt = 0;
    const maxAttempts = 6; // ~ up to ~63s total max backoff
    const baseDelay = 1000;

    async function tryFetch(){
      let headers = {};
      try{
        if (typeof window.__MZ_getAppCheckHeaders__ === 'function') {
          headers = await window.__MZ_getAppCheckHeaders__();
        }
      }catch(e){}
      fetch('/api/load?id='+encodeURIComponent(id), { headers })
        .then(r=>r.json())
        .then(res => {
          if (res && res.error) {
            if (res.error === 'not_found' || res.error === 'expired') {
              el.textContent = '00:00:00';
              showExpired();
              return;
            }
            attempt++;
            if (attempt >= maxAttempts) {
              el.textContent = '—:—:—';
              return;
            }
            const delay = Math.min(30000, baseDelay * Math.pow(2, attempt));
            setTimeout(tryFetch, delay);
            return;
          }
          const hasExpiresAt = res && Number.isFinite(res.expires_at) && res.expires_at > 0;
          const hasLegacyTtl = res && Number.isFinite(res.created_at) && Number.isFinite(res.ttl_seconds) && res.ttl_seconds > 0;
          if (!hasExpiresAt && !hasLegacyTtl){
            attempt++;
            el.textContent = '—:—:—';
            if (attempt >= maxAttempts) return;
            const delay = Math.min(30000, baseDelay * Math.pow(2, attempt));
            setTimeout(tryFetch, delay);
            return;
          }
          attempt = 0;
          const serverNowSec = (typeof res.server_now === 'number') ? res.server_now : null;
          const clientNow = Date.now();
          skewMs = serverNowSec ? (serverNowSec * 1000 - clientNow) : 0;
          const demoTtl = getParamInt('ttl');
          const demoExp = getParamInt('exp');
          if (demoMode && (demoTtl > 0 || demoExp > 0)){
            baseLeftMs = 0;
            if (demoExp > 0){
              // demo exp is absolute epoch (sec or ms)
              expiresMs = demoExp < 1e12 ? demoExp * 1000 : demoExp;
            } else {
              // Demo mode: keep consistent expiry per tab session
              const key = 'mz_demo_exp_' + id;
              const stored = parseInt(sessionStorage.getItem(key) || '0', 10);
              if (stored && Number.isFinite(stored)) {
                expiresMs = stored;
              } else {
                expiresMs = Date.now() + (demoTtl * 1000);
                sessionStorage.setItem(key, String(expiresMs));
              }
            }
          } else {
            if (demoMode) {
              try{ sessionStorage.removeItem('mz_demo_exp_' + id); }catch(e){}
            }
            // use server time to avoid client clock issues
            const nowSec = serverNowSec || Math.floor(clientNow/1000);
            const expiresSec = hasExpiresAt
              ? res.expires_at
              : (res.created_at + res.ttl_seconds);
            if (nowSec >= expiresSec){
              el.textContent = '00:00:00';
              showExpired();
              return;
            }
            const leftMs = (expiresSec - nowSec) * 1000;
            baseLeftMs = leftMs;
            startMs = clientNow;
            expiresMs = 0;
          }
          tick();
          clearInterval(timer);
          timer = setInterval(tick, 1000);
          // Re-sync occasionally in case server time/TTL changes
          setTimeout(()=>{ attempt = 0; tryFetch(); }, 60000);
        })
        .catch(err => {
          attempt++;
          if (attempt >= maxAttempts) {
            el.textContent = '—:—:—';
            return;
          }
          const delay = Math.min(30000, baseDelay * Math.pow(2, attempt));
          setTimeout(tryFetch, delay);
        });
    }
    tryFetch();
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
