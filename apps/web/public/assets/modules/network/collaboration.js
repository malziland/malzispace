/**
 * @module network/collaboration
 * Network layer: REST API calls, WebSocket relay (encrypted),
 * Yjs CRDT synchronization, awareness/presence rendering,
 * and persistence (push/pull/autosave).
 */
import ctx, { t, now, isIdle, wait } from '../core/context.js';
import { hash32 } from '../core/dom-utils.js';
import {
  PRESENCE_TTL_MS,
  WS_AUTH_TTL_MS,
  LOAD_RETRY_DELAYS_MS,
  PERSIST_RETRY_BASE_MS,
  PERSIST_RETRY_MAX_MS,
} from '../core/constants.js';
import {
  fromB64,
  toB64,
  getKeyBytesFromHash,
  getWriteKeyProof,
  signRoomAccess,
  encryptBytes,
  decryptBytes,
  encryptContent,
  decryptContent,
  encryptTitle,
  decryptTitle,
  requireKeyOrBlock,
} from '../services/crypto.js';
import {
  getEditorStoredContent,
  getEditorSelectionOffsets,
  getTextNodeLength,
  saveEditorRange,
  resolveTextPosition,
  isEditorFocused,
} from '../services/selection.js';
import {
  setStatusText,
  setSyncWarning,
  clearSyncWarning,
  presenceText,
  showExpired,
  updateTitleVisibility,
  setEditorWithCursor,
  editorCursorIndex,
} from '../ui/status.js';

// ── Sim relay ───────────────────────────────────────────────────

function getSimRelay() {
  if (!ctx.SIM_MODE || typeof BroadcastChannel !== 'function') return null;
  if (!ctx.simRelay) ctx.simRelay = new BroadcastChannel(`mz-sim-relay-${ctx.SPACE_ID}`);
  return ctx.simRelay;
}

// ── App Check ───────────────────────────────────────────────────

async function getAppCheckHeaders() {
  if (ctx.SIM_MODE) return {};
  try {
    if (typeof window.__MZ_getAppCheckHeaders__ === 'function') {
      return await window.__MZ_getAppCheckHeaders__();
    }
  } catch (e) {}
  return {};
}

// ── API ─────────────────────────────────────────────────────────

/** Perform an API call (real or simulated). */
export async function api(path, opt = {}) {
  if (ctx.SIM_MODE) {
    const p = String(path || '');
    if (!window.__MZ_SIM_STATE__) {
      window.__MZ_SIM_STATE__ = {
        version: 1,
        title: t('space.simulator.title'),
        content: '<p>Alpha Beta Gamma</p>'
      };
    }
    const sim = window.__MZ_SIM_STATE__;
    if (p.startsWith('load')) {
      return { version: sim.version, zk: false, title: sim.title, content: sim.content };
    }
    if (p === 'save') {
      try {
        const body = JSON.parse(opt.body || '{}');
        if (typeof body.title === 'string') sim.title = body.title;
        if (typeof body.content === 'string') sim.content = body.content;
      } catch (e) {}
      sim.version += 1;
      return { version: sim.version };
    }
    if (p === 'title') {
      try {
        const body = JSON.parse(opt.body || '{}');
        if (typeof body.title === 'string') sim.title = body.title;
      } catch (e) {}
      return { ok: true };
    }
    if (p === 'presence') return { count: 1 };
    if (p === 'yjs/push') return { ok: true };
    if (p.startsWith('yjs/pull')) return { updates: [], fulls: [] };
    return { ok: true };
  }
  const headers = Object.assign({}, opt.headers || {}, await getAppCheckHeaders());
  const res = await fetch('/api/' + path, Object.assign({}, opt, { headers }));
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    if (!res.ok) return { error: 'server_error', status: res.status };
    throw e;
  }
}

// ── CRDT helpers ────────────────────────────────────────────────

function commonPrefixLen(a, b) {
  const left = typeof a === 'string' ? a : '';
  const right = typeof b === 'string' ? b : '';
  const limit = Math.min(left.length, right.length);
  let i = 0;
  while (i < limit && left.charCodeAt(i) === right.charCodeAt(i)) i += 1;
  return i;
}

function commonSuffixLen(a, b, prefixLen) {
  const left = typeof a === 'string' ? a : '';
  const right = typeof b === 'string' ? b : '';
  let ai = left.length - 1;
  let bi = right.length - 1;
  let len = 0;
  while (ai >= prefixLen && bi >= prefixLen && left.charCodeAt(ai) === right.charCodeAt(bi)) {
    len += 1; ai -= 1; bi -= 1;
  }
  return len;
}

/** Synchronize the Yjs text type with the current editor HTML. */
export function syncYTextFromEditorHtml(nextStored) {
  if (!ctx.ytext) return;
  const currentStored = ctx.ytext.toString();
  const next = typeof nextStored === 'string' ? nextStored : '';
  if (next === currentStored) return;

  const prefix = commonPrefixLen(currentStored, next);
  const suffix = commonSuffixLen(currentStored, next, prefix);
  const deleteLen = Math.max(0, currentStored.length - prefix - suffix);
  const insertText = next.slice(prefix, Math.max(prefix, next.length - suffix));

  const applyDiff = () => {
    if (deleteLen > 0) ctx.ytext.delete(prefix, deleteLen);
    if (insertText) ctx.ytext.insert(prefix, insertText);
  };

  ctx.suppress = true;
  try {
    if (ctx.doc && typeof ctx.doc.transact === 'function') {
      ctx.doc.transact(applyDiff, 'local-editor');
    } else {
      applyDiff();
    }
  } finally {
    ctx.suppress = false;
  }
}

function getSeedClientId(spaceId) {
  const low = hash32('seed:' + String(spaceId || ''));
  return (1048575 * 4294967296) + low;
}

function buildSeedUpdate(Y, stored) {
  const next = typeof stored === 'string' ? stored : '';
  if (!next) return null;
  const seedDoc = new Y.Doc();
  try { seedDoc.clientID = getSeedClientId(ctx.SPACE_ID); } catch (e) {}
  seedDoc.getText('content').insert(0, next);
  return Y.encodeStateAsUpdate(seedDoc);
}

// ── Retry / load helpers ────────────────────────────────────────

function retryDelay(attempt, delays) {
  if (!Array.isArray(delays) || !delays.length) return 1000;
  const index = Math.max(0, Math.min(attempt, delays.length - 1));
  return delays[index];
}

function isRetryableLoadResult(res, err) {
  if (err) return true;
  if (!res || typeof res !== 'object') return true;
  const code = String(res.error || '');
  if (!code) return false;
  return code === 'server_error' || code === 'app_check_invalid' || code === 'app_check_required' || code === 'rate_limited';
}

// ── Awareness / cursors ─────────────────────────────────────────

function isValidPresenceToken(value) {
  return /^[a-z0-9]{6,64}$/.test(String(value || ''));
}

function generatePresenceToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomColor() {
  const colors = ['#ff6b6b','#ffba53','#4dd0e1','#81c784','#ba68c8','#f06292','#90caf9','#ffd54f'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function pruneAwarenessEntries(cutoffTs = Date.now()) {
  let changed = false;
  ctx.awareness.forEach((entry, id) => {
    const ts = Number(entry && entry.ts);
    if (!entry || entry.leave || !Number.isFinite(ts) || (cutoffTs - ts) > PRESENCE_TTL_MS) {
      ctx.awareness.delete(id);
      changed = true;
    }
  });
  return changed;
}

function ensureCursorLayer() {
  let layer = document.getElementById('collabCursors');
  if (!layer) {
    layer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    layer.id = 'collabCursors';
    layer.setAttribute('class', 'collab-cursor-layer');
    layer.setAttribute('aria-hidden', 'true');
    layer.setAttribute('preserveAspectRatio', 'none');
    const wrap = ctx.editor.closest('.editor-wrap') || ctx.editor.parentElement || document.body;
    wrap.classList.add('has-cursor-layer-host');
    wrap.appendChild(layer);
  }
  return layer;
}

function getCaretCoords(el, pos) {
  const style = getComputedStyle(el);
  const lineHeight = parseFloat(style.lineHeight) || 18;
  const padLeft = parseFloat(style.paddingLeft) || 0;
  const padTop = parseFloat(style.paddingTop) || 0;
  const host = el.getBoundingClientRect();
  const textLen = getTextNodeLength(el);
  const numericPos = Number.isFinite(pos) ? pos : 0;
  const safePos = Math.max(0, Math.min(numericPos, textLen));

  let rect = null;
  try {
    const target = resolveTextPosition(el, safePos);
    const range = document.createRange();
    range.setStart(target.node, target.offset);
    range.collapse(true);
    rect = range.getClientRects()[0] || range.getBoundingClientRect();
  } catch (e) {}

  if (!rect || (!rect.width && !rect.height)) {
    return { left: padLeft, top: padTop, height: lineHeight };
  }
  let left = rect.left - host.left;
  let top = rect.top - host.top;
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    return { left: padLeft, top: padTop, height: lineHeight };
  }
  const maxLeft = Math.max(padLeft, (el.clientWidth || 0) - 2);
  const maxTop = Math.max(padTop, (el.clientHeight || 0) - lineHeight);
  left = Math.max(padLeft, Math.min(left, maxLeft));
  top = Math.max(padTop, Math.min(top, maxTop));
  return { left, top, height: rect.height || lineHeight };
}

/** Render remote cursor overlays. */
export function renderAwareness() {
  pruneAwarenessEntries(Date.now());
  const layer = ensureCursorLayer();
  layer.replaceChildren();
  const others = Array.from(ctx.awareness.values());
  const layerRect = layer.getBoundingClientRect();
  const editorRect = ctx.editor.getBoundingClientRect();
  layer.setAttribute('viewBox', `0 0 ${Math.max(1, Math.round(layerRect.width || editorRect.width || 1))} ${Math.max(1, Math.round(layerRect.height || editorRect.height || 1))}`);
  const baseLeft = editorRect.left - layerRect.left;
  const baseTop = editorRect.top - layerRect.top;
  const total = others.length + 1;
  if (ctx.presence) ctx.presence.textContent = presenceText(total);

  others.forEach((u) => {
    if (!u || !u.cursor || !Number.isFinite(u.cursor.index)) return;
    const coords = getCaretCoords(ctx.editor, u.cursor.index);
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('transform', `translate(${Math.round(baseLeft + coords.left)}, ${Math.round(baseTop + coords.top)})`);
    const caret = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    caret.setAttribute('x', '0'); caret.setAttribute('y', '0');
    caret.setAttribute('width', '2');
    caret.setAttribute('height', String(Math.max(1, Math.round(coords.height || 1))));
    caret.setAttribute('rx', '1');
    caret.setAttribute('fill', u.color || '#ccc');
    const labelText = String(u.shortId || 'user');
    const labelWidth = Math.max(24, (labelText.length * 6) + 8);
    const labelRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    labelRect.setAttribute('x', '4'); labelRect.setAttribute('y', '-13');
    labelRect.setAttribute('width', String(labelWidth)); labelRect.setAttribute('height', '12');
    labelRect.setAttribute('rx', '4'); labelRect.setAttribute('fill', u.color || '#ccc');
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', '8'); label.setAttribute('y', '-4');
    label.setAttribute('fill', '#111'); label.setAttribute('font-size', '10');
    label.setAttribute('font-family', 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, Helvetica Neue, Arial');
    label.textContent = labelText;
    group.appendChild(caret); group.appendChild(labelRect); group.appendChild(label);
    layer.appendChild(group);
  });
}

// ── Presence ping ───────────────────────────────────────────────

export async function pingPresence() {
  if (!ctx.FF_ENABLE_PRESENCE) return;
  if (ctx.expiredShown) return;
  try {
    const keyProof = await getWriteKeyProof();
    const res = await api('presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ctx.SPACE_ID, token: ctx.state.token, key_proof: keyProof })
    });
    if (res && !res.error) {
      const c = res.count || 1;
      if (ctx.presence) ctx.presence.textContent = presenceText(c);
    }
  } catch (e) {}
  setTimeout(pingPresence, 10000);
}

// ── Save (encrypted snapshot) ───────────────────────────────────

export function queueSave() {
  if (ctx.expiredShown) return;
  ctx.localChangeSeq += 1;
  if (!ctx.dirtySince) ctx.dirtySince = now();
  clearTimeout(ctx.saveTimer);
  ctx.saveTimer = setTimeout(() => { saveNow().catch(() => {}); }, 700);
}

export function startAutosave() {
  clearInterval(ctx.autosaveTimer);
  ctx.autosaveTimer = setInterval(() => {
    if (ctx.dirtySince && (now() - ctx.dirtySince) >= 30000) {
      saveNow().catch(() => {});
    }
  }, 5000);
}

export async function saveNow() {
  if (!requireKeyOrBlock()) return;
  if (ctx.saveInFlightPromise) {
    ctx.saveQueuedAfterFlight = true;
    return ctx.saveInFlightPromise;
  }
  const seqAtStart = ctx.localChangeSeq;
  ctx.saveInFlightPromise = (async () => {
    try {
      const content = getEditorStoredContent();
      const title = ctx.titleView ? ctx.titleView.textContent.trim() : '';
      const enc = await encryptContent(content);
      if (!enc) { setStatusText(t('status.noKey'), 'danger'); return; }
      const titleEncResult = await encryptTitle(title);
      setStatusText(t('status.saving'));
      const keyProof = await getWriteKeyProof();
      const body = {
        id: ctx.SPACE_ID,
        version: ctx.state.version, zk: true, key_proof: keyProof,
        content_enc: enc.ciphertext, content_nonce: enc.nonce, content_algo: enc.algo
      };
      if (titleEncResult) {
        body.title_enc = titleEncResult.ciphertext;
        body.title_nonce = titleEncResult.nonce;
        body.title_algo = titleEncResult.algo;
      } else {
        body.title = '';
      }
      const res = await api('save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res || res.error) { setStatusText(t('status.error'), 'danger'); return; }
      ctx.state.version = res.version || ctx.state.version;
      ctx.lastTitle = title;
      if (ctx.localChangeSeq === seqAtStart) {
        ctx.dirtySince = 0;
        setStatusText(t('status.saved'));
        setTimeout(() => { setStatusText(t('status.connected')); }, 1200);
      } else {
        ctx.saveQueuedAfterFlight = true;
        if (!ctx.dirtySince) ctx.dirtySince = now();
        setStatusText(t('status.saving'));
      }
    } catch (e) {
      setStatusText(t('status.error'), 'danger');
    }
  })();
  try { await ctx.saveInFlightPromise; } finally {
    ctx.saveInFlightPromise = null;
    if (ctx.saveQueuedAfterFlight && !ctx.expiredShown && ctx.dirtySince) {
      ctx.saveQueuedAfterFlight = false;
      setTimeout(() => { saveNow().catch(() => {}); }, 0);
    }
  }
}

// ── WebSocket relay ─────────────────────────────────────────────

async function getWsUrl() {
  const room = encodeURIComponent(ctx.SPACE_ID);
  const rawUrl = window.MZ_COLLAB_WS_URL
    || ((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/collab?room=' + room);
  try {
    const u = new URL(rawUrl, window.location.origin);
    if (!u.searchParams.get('room')) u.searchParams.set('room', ctx.SPACE_ID);
    const exp = String(Date.now() + WS_AUTH_TTL_MS);
    const nonce = toB64(crypto.getRandomValues(new Uint8Array(12)));
    const sig = await signRoomAccess(ctx.SPACE_ID, exp, nonce);
    if (sig) { u.searchParams.set('exp', exp); u.searchParams.set('nonce', nonce); u.searchParams.set('sig', sig); }
    return u.toString();
  } catch (e) {
    const exp = String(Date.now() + WS_AUTH_TTL_MS);
    const nonce = toB64(crypto.getRandomValues(new Uint8Array(12)));
    const sig = await signRoomAccess(ctx.SPACE_ID, exp, nonce);
    let url = rawUrl.includes('room=') ? rawUrl : (rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'room=' + room);
    if (sig) url += `&exp=${encodeURIComponent(exp)}&nonce=${encodeURIComponent(nonce)}&sig=${encodeURIComponent(sig)}`;
    return url;
  }
}

async function handleRelayMessage(data) {
  try {
    if (!data || data.length < 2) return;
    const type = data[0];
    const payload = data.slice(1);
    const plain = await decryptBytes(payload);
    if (!plain) return;
    if (type === 0) {
      if (!ctx.doc) return;
      const Y = await getY();
      Y.applyUpdate(ctx.doc, plain, 'remote');
    } else if (type === 1) {
      const json = new TextDecoder().decode(plain);
      const msg = JSON.parse(json);
      if (msg && msg.id && msg.id !== ctx.state.token) {
        const prev = ctx.awareness.get(msg.id);
        if (msg.leave) {
          ctx.awareness.delete(msg.id);
        } else if (!prev || Number(msg.ts || 0) >= Number(prev.ts || 0)) {
          ctx.awareness.set(msg.id, msg);
        }
        pruneAwarenessEntries(Date.now());
        renderAwareness();
      }
    } else if (type === 2) {
      const json = new TextDecoder().decode(plain);
      const msg = JSON.parse(json);
      if (msg && typeof msg.title === 'string' && ctx.titleView) {
        if (msg.title !== ctx.titleView.textContent) {
          ctx.titleView.textContent = msg.title;
          ctx.lastTitle = msg.title;
          updateTitleVisibility();
        }
      }
    }
  } catch (e) {}
}

async function sendWs(type, payload) {
  if (!ctx.FF_ENABLE_WS) return;
  if (ctx.SIM_MODE) {
    const relay = getSimRelay();
    if (!relay) return;
    const enc = await encryptBytes(payload);
    if (!enc) return;
    const out = new Uint8Array(1 + enc.length);
    out[0] = type; out.set(enc, 1);
    relay.postMessage({ sender: ctx.state.token, data: out });
    return;
  }
  if (!ctx.wsReady || ctx.ws.readyState !== WebSocket.OPEN) return;
  const enc = await encryptBytes(payload);
  if (!enc) return;
  const out = new Uint8Array(1 + enc.length);
  out[0] = type; out.set(enc, 1);
  ctx.ws.send(out);
}

async function connectWs() {
  if (ctx.SIM_MODE) {
    const relay = getSimRelay();
    ctx.wsReady = !!relay;
    if (!relay) return;
    setStatusText(t('status.connected'));
    relay.onmessage = (evt) => {
      try {
        const msg = evt && evt.data ? evt.data : null;
        if (!msg || msg.sender === ctx.state.token || !msg.data) return;
        handleRelayMessage(new Uint8Array(msg.data)).catch(() => {});
      } catch (e) {}
    };
    try { ctx.scheduleAwarenessSend(); } catch (e) {}
    return;
  }
  if (!ctx.FF_ENABLE_WS) return;
  const url = await getWsUrl();
  ctx.ws = new WebSocket(url);
  ctx.ws.binaryType = 'arraybuffer';
  ctx.ws.onopen = () => {
    ctx.wsReady = true;
    setStatusText(t('status.connected'));
    try { ctx.scheduleAwarenessSend(); } catch (e) {}
  };
  ctx.ws.onclose = () => {
    ctx.wsReady = false;
    if (ctx.expiredShown) return;
    setStatusText(t('status.disconnected'));
    setTimeout(() => { connectWs().catch(() => {}); }, 1500);
  };
  ctx.ws.onerror = () => { ctx.wsReady = false; };
  ctx.ws.onmessage = (evt) => {
    handleRelayMessage(new Uint8Array(evt.data)).catch(() => {});
  };
}

// ── Yjs persistence ─────────────────────────────────────────────

function mergePersistUpdates(Y, updates) {
  if (!updates.length) return null;
  if (updates.length === 1) return updates[0];
  if (Y && typeof Y.mergeUpdates === 'function') return Y.mergeUpdates(updates);
  return updates[updates.length - 1];
}

function schedulePersistFlush(delayMs = 500) {
  if (!ctx.persistQueue.length || ctx.expiredShown) return;
  clearTimeout(ctx.persistTimer);
  ctx.persistTimer = setTimeout(() => {
    flushPersistQueue().catch(() => {});
  }, Math.max(0, delayMs));
}

async function flushPersistQueue() {
  if (ctx.persistInFlight || !ctx.persistQueue.length || ctx.expiredShown) return;
  ctx.persistTimer = null;
  ctx.persistInFlight = true;
  const Y = await getY();
  const pending = ctx.persistQueue.splice(0, ctx.persistQueue.length);
  const merged = mergePersistUpdates(Y, pending);
  try {
    await pushYjsUpdate(merged, false);
    ctx.persistRetryMs = PERSIST_RETRY_BASE_MS;
    clearSyncWarning();
  } catch (e) {
    ctx.persistQueue.unshift(merged);
    ctx.persistRetryMs = Math.min(ctx.persistRetryMs * 2, PERSIST_RETRY_MAX_MS);
    setSyncWarning(t('status.syncing'));
    schedulePersistFlush(ctx.persistRetryMs);
  } finally {
    ctx.persistInFlight = false;
    if (ctx.persistQueue.length && !ctx.persistTimer) {
      schedulePersistFlush(ctx.persistRetryMs);
    }
  }
}

async function pushYjsUpdate(update, full = false) {
  if (ctx.expiredShown) return;
  const enc = await encryptBytes(update);
  if (!enc) return;
  const keyProof = await getWriteKeyProof();
  const payload = {
    id: ctx.SPACE_ID,
    update_enc: toB64(enc), update_nonce: 'v0', update_algo: 'aes-256-gcm',
    key_proof: keyProof, full: !!full
  };
  const res = await api('yjs/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res || res.error) throw new Error((res && res.error) || 'push_failed');
}

async function pullYjsUpdates(sinceTs = 0) {
  if (ctx.expiredShown) return false;
  const res = await api('yjs/pull?id=' + encodeURIComponent(ctx.SPACE_ID) + '&since=' + sinceTs);
  if (!res) return false;
  if (res.error === 'not_found' || res.error === 'expired') { showExpired(); return false; }
  if (res.error) return false;
  const Y = await getY();
  let applied = false;
  const fullEntries = Array.isArray(res.fulls) && res.fulls.length ? res.fulls : (res.full ? [res.full] : []);
  for (const f of fullEntries) {
    if (!f || !f.update_enc) continue;
    if (Number.isFinite(f.ts) && ctx.lastPullTs && f.ts <= ctx.lastPullTs) continue;
    try {
      const fullBytes = fromB64(f.update_enc);
      const fullPlain = await decryptBytes(fullBytes);
      if (fullPlain) { Y.applyUpdate(ctx.doc, fullPlain, 'remote'); applied = true; }
      if (f.ts && f.ts > ctx.lastPullTs) ctx.lastPullTs = f.ts;
    } catch (e) {}
  }
  if (Array.isArray(res.updates)) {
    for (const u of res.updates) {
      if (!u || !u.update_enc) continue;
      try {
        const bytes = fromB64(u.update_enc);
        const plain = await decryptBytes(bytes);
        if (plain) { Y.applyUpdate(ctx.doc, plain, 'remote'); applied = true; }
        if (u.ts && u.ts > ctx.lastPullTs) ctx.lastPullTs = u.ts;
      } catch (e) {}
    }
  }
  return applied;
}

// ── Load ────────────────────────────────────────────────────────

async function fetchSpaceLoad(options = {}) {
  const retry = !!options.retry;
  if (ctx.loadInFlightPromise) return ctx.loadInFlightPromise;
  ctx.loadInFlightPromise = (async () => {
    let attempt = 0;
    while (!ctx.expiredShown) {
      let res = null; let err = null;
      try { res = await api('load?id=' + encodeURIComponent(ctx.SPACE_ID)); } catch (e) { err = e; }
      if (res && (res.error === 'not_found' || res.error === 'expired')) { showExpired(); return null; }
      if (res && !res.error) { if (!ctx.dirtySince) clearSyncWarning(); return res; }
      if (!retry || !isRetryableLoadResult(res, err)) return null;
      setSyncWarning(attempt === 0 ? t('status.connecting') : t('status.reconnecting'));
      await wait(retryDelay(attempt, LOAD_RETRY_DELAYS_MS));
      attempt += 1;
    }
    return null;
  })();
  try { return await ctx.loadInFlightPromise; } finally { ctx.loadInFlightPromise = null; }
}

/** Lazy-load the Yjs module. */
export async function getY() {
  if (ctx.YModule) return ctx.YModule;
  const mod = await import('/assets/yjs.bundle.js');
  ctx.YModule = mod;
  return mod;
}

async function legacyLoadAndRender(options = {}) {
  const res = await fetchSpaceLoad(options);
  if (!res) return null;
  if (res.error === 'not_found' || res.error === 'expired') { showExpired(); return null; }
  if (res.error) return null;
  let content = '';
  if (res.zk) {
    const plain = await decryptContent(res);
    if (typeof plain === 'string') content = plain;
  } else if (typeof res.content === 'string') {
    content = res.content;
  }
  if (ctx.titleView) {
    const decryptedTitle = await decryptTitle(res);
    ctx.titleView.textContent = decryptedTitle;
    ctx.lastTitle = decryptedTitle;
  }
  updateTitleVisibility();
  if (ctx.editor && typeof content === 'string') setEditorWithCursor(content);
  ctx.state.version = res.version || ctx.state.version;
  return res;
}

export function startLegacySync() {
  ctx.editor.addEventListener('input', () => {
    ctx.lastInputTs = now();
    const normalized = getEditorStoredContent();
    if (!normalized) ctx.editor.innerHTML = '';
    queueSave();
    renderAwareness();
    ctx.updateToolbarState();
  });
  clearInterval(ctx.pollTimer);
  ctx.pollTimer = setInterval(async () => {
    if (!isIdle()) return;
    await legacyLoadAndRender();
  }, 3000);
}

// ── Init ────────────────────────────────────────────────────────

/** Main application initialization: load content, start sync. */
export async function init() {
  if (window.__MZ_EXPIRED__) { showExpired(); ctx.markCollabReady('expired'); return; }
  ctx.lastKnownStoredForHistory = getEditorStoredContent();
  ctx.renderLineNumbers();
  if (ctx.SIM_MODE && ctx.status) {
    setStatusText(t('status.simulator'), 'info');
    if (ctx.presence) ctx.presence.textContent = presenceText(1);
  }
  if (!ctx.SPACE_ID_OK) {
    if (ctx.status) {
      setStatusText(window.__MZ_INVALID_SPACE_ID__ ? t('status.invalidLink') : t('status.localMode'), 'warning');
    }
    if (ctx.presence) ctx.presence.textContent = t('status.offline');
    ctx.editor.addEventListener('input', () => {
      const normalized = getEditorStoredContent();
      if (!normalized) ctx.editor.innerHTML = '';
      ctx.updateToolbarState();
    });
    ctx.renderLineNumbers();
    setTimeout(() => { if (ctx.editor) ctx.editor.focus(); }, 30);
    ctx.markCollabReady('local');
    return;
  }
  if (!requireKeyOrBlock()) { ctx.markCollabReady('blocked'); return; }

  const res = await legacyLoadAndRender({ retry: true });
  if (!res) { ctx.renderLineNumbers(); ctx.markCollabReady('error'); return; }

  ctx.state.version = res.version || 0;
  ctx.state.zk = true;

  if (!ctx.FF_ENABLE_CRDT) {
    startLegacySync();
    pingPresence();
    startAutosave();
    ctx.renderLineNumbers();
    setTimeout(() => { if (ctx.editor) ctx.editor.focus(); }, 50);
    if (ctx.SIM_MODE) setTimeout(ctx.runToolbarSelftest, 240);
    ctx.markCollabReady('ready');
    return;
  }

  try {
    const Y = await getY();
    ctx.doc = new Y.Doc();
    ctx.ytext = ctx.doc.getText('content');
    const initialStoredContent = getEditorStoredContent();
    ctx.crdtEnabled = true;

    ctx.ytext.observe((evt, transaction) => {
      if (ctx.suppress) return;
      if (transaction && (transaction.origin === 'local-editor' || transaction.origin === 'seed')) return;
      setEditorWithCursor(ctx.ytext.toString());
    });

    ctx.editor.addEventListener('input', () => {
      ctx.lastInputTs = now();
      const normalized = getEditorStoredContent();
      if (!normalized) ctx.editor.innerHTML = '';
      syncYTextFromEditorHtml(normalized);
      ctx.scheduleAwarenessSend();
      ctx.updateToolbarState();
    });

    ctx.doc.on('update', async (update, origin) => {
      if (origin === 'remote' || origin === 'seed') return;
      sendWs(0, update).catch(() => {});
      ctx.persistQueue.push(update);
      schedulePersistFlush(500);
    });

    async function publishAwareness(leave = false) {
      const msg = {
        id: ctx.state.token, shortId: ctx.state.shortId,
        color: ctx.state.color, ts: Date.now()
      };
      if (leave) { msg.leave = true; } else { msg.cursor = { index: editorCursorIndex() }; }
      const payload = new TextEncoder().encode(JSON.stringify(msg));
      await sendWs(1, payload);
    }

    ctx.scheduleAwarenessSend = function sendAwareness() {
      clearTimeout(ctx.awarenessTimer);
      ctx.awarenessTimer = setTimeout(async () => {
        try { await publishAwareness(false); } catch (e) {}
      }, 200);
    };
    const sendAwarenessLeave = () => { publishAwareness(true).catch(() => {}); };
    ctx.editor.addEventListener('keyup', ctx.scheduleAwarenessSend);
    ctx.editor.addEventListener('click', ctx.scheduleAwarenessSend);
    ctx.editor.addEventListener('mouseup', ctx.scheduleAwarenessSend);
    ctx.editor.addEventListener('scroll', () => { renderAwareness(); });
    window.addEventListener('pagehide', sendAwarenessLeave);
    window.addEventListener('beforeunload', sendAwarenessLeave);
    clearInterval(ctx.awarenessPruneTimer);
    ctx.awarenessPruneTimer = setInterval(() => {
      if (pruneAwarenessEntries(Date.now())) renderAwareness();
    }, 5000);
    ctx.scheduleAwarenessSend();
    renderAwareness();

    await connectWs();
    pingPresence();
    const pulledInitial = await pullYjsUpdates(0);
    if (!pulledInitial && !ctx.ytext.length) {
      const seed = buildSeedUpdate(Y, initialStoredContent);
      if (seed) {
        ctx.suppress = true;
        try { Y.applyUpdate(ctx.doc, seed, 'seed'); } finally { ctx.suppress = false; }
      }
    }
    clearInterval(ctx.pullTimer);
    ctx.pullTimer = setInterval(() => { pullYjsUpdates(ctx.lastPullTs).catch(() => {}); }, 30000);
    clearInterval(ctx.fullTimer);
    ctx.fullTimer = setInterval(async () => {
      const Y2 = await getY();
      const full = Y2.encodeStateAsUpdate(ctx.doc);
      pushYjsUpdate(full, true).catch(() => {});
    }, 60000);
    ctx.renderLineNumbers();
    setTimeout(() => { if (ctx.editor) ctx.editor.focus(); }, 50);
    if (ctx.SIM_MODE) setTimeout(ctx.runToolbarSelftest, 260);
    ctx.markCollabReady('ready');
  } catch (e) {
    console.error('Yjs init failed, falling back to legacy sync', e);
    startLegacySync();
    pingPresence();
    startAutosave();
    ctx.renderLineNumbers();
    setTimeout(() => { if (ctx.editor) ctx.editor.focus(); }, 50);
    if (ctx.SIM_MODE) setTimeout(ctx.runToolbarSelftest, 260);
    ctx.markCollabReady('ready');
  }
}

// ── Registration ────────────────────────────────────────────────

/** Register network functions on ctx. */
export function initCollaboration() {
  ctx.syncYTextFromEditorHtml = syncYTextFromEditorHtml;
  ctx.queueSave = queueSave;
  ctx.startAutosave = startAutosave;
  ctx.startLegacySync = startLegacySync;
  ctx.renderAwareness = renderAwareness;
  ctx.pingPresence = pingPresence;

  // Initialize presence token
  const tokenKey = 'ls_token_' + ctx.SPACE_ID;
  const tokenStorage = ctx.SIM_MODE ? sessionStorage : localStorage;
  try {
    const existing = tokenStorage.getItem(tokenKey);
    ctx.state.token = isValidPresenceToken(existing) ? existing : generatePresenceToken();
    if (ctx.state.token !== existing) tokenStorage.setItem(tokenKey, ctx.state.token);
  } catch (e) { ctx.state.token = generatePresenceToken(); }
  ctx.state.shortId = (ctx.state.token || '').slice(0, 4);
  ctx.state.color = randomColor();

  if (!ctx.FF_ENABLE_PRESENCE && ctx.presence) {
    ctx.presence.hidden = true;
  }
}
