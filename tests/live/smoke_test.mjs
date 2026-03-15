import crypto from 'node:crypto';

const BASE_URL = process.env.BASE_URL || 'https://malzispace.web.app';
const APP_CHECK_TOKEN = process.env.APP_CHECK_TOKEN || '';

if (!APP_CHECK_TOKEN) {
  console.error('Missing APP_CHECK_TOKEN. Example: APP_CHECK_TOKEN=... node tests/live/smoke_test.mjs');
  process.exit(0); // treated as "skipped" by verify_local.sh
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function b64url(u8) {
  const bin = Buffer.from(u8).toString('base64');
  return bin.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function deriveKeyProof(keyBytes) {
  const digest = await crypto.webcrypto.subtle.digest('SHA-256', keyBytes);
  return b64url(new Uint8Array(digest));
}

async function api(path, options = {}) {
  const headers = Object.assign(
    { 'X-Firebase-AppCheck': APP_CHECK_TOKEN },
    options.headers || {}
  );
  const res = await fetch(BASE_URL + path, Object.assign({}, options, { headers }));
  const json = await res.json().catch(() => ({ error: 'invalid_json' }));
  return { status: res.status, json };
}

async function encryptContent(text, key) {
  const iv = crypto.randomBytes(12);
  const data = new TextEncoder().encode(text || '');
  const buf = await crypto.webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return {
    algo: 'aes-256-gcm',
    nonce: b64url(iv),
    ciphertext: b64url(new Uint8Array(buf))
  };
}

async function encryptUpdate(updateU8, key) {
  const iv = crypto.randomBytes(12);
  const buf = await crypto.webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, updateU8);
  const cipher = new Uint8Array(buf);
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return b64url(out);
}

async function main() {
  const startedAt = Date.now();
  console.log('SMOKE: starting', { base: BASE_URL });

  const keyBytes = crypto.randomBytes(32);
  const keyProof = await deriveKeyProof(keyBytes);

  const create = await api('/api/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'smoke', key_proof: keyProof })
  });
  assert(create.status === 200, `create status=${create.status}`);
  assert(create.json && create.json.ok && create.json.id, `create response=${JSON.stringify(create.json)}`);
  const id = create.json.id;

  const load1 = await api(`/api/load?id=${encodeURIComponent(id)}`);
  assert(load1.status === 200, `load1 status=${load1.status}`);
  assert(!load1.json.error, `load1 error=${load1.json.error}`);
  assert(load1.json.zk === true, 'load1 expected zk=true');
  assert(Number.isFinite(load1.json.version), 'load1 missing version');

  const key = await crypto.webcrypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const content = `smoke ${new Date().toISOString()}`;
  const enc = await encryptContent(content, key);

  const save = await api('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      title: 'smoke',
      version: load1.json.version,
      zk: true,
      key_proof: keyProof,
      content_enc: enc.ciphertext,
      content_nonce: enc.nonce,
      content_algo: enc.algo
    })
  });
  assert(save.status === 200, `save status=${save.status}`);
  assert(save.json && save.json.ok, `save response=${JSON.stringify(save.json)}`);
  assert(Number.isFinite(save.json.version), 'save missing version');
  const version2 = save.json.version;

  const load2 = await api(`/api/load?id=${encodeURIComponent(id)}`);
  assert(load2.status === 200, `load2 status=${load2.status}`);
  assert(!load2.json.error, `load2 error=${load2.json.error}`);
  assert(load2.json.version === version2, `load2 version mismatch got=${load2.json.version} want=${version2}`);
  assert(load2.json.content_enc === enc.ciphertext, 'load2 content_enc mismatch');

  const presence = await api('/api/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, token: 'smoke', key_proof: keyProof })
  });
  assert(presence.status === 200, `presence status=${presence.status}`);
  assert(presence.json && presence.json.ok, `presence response=${JSON.stringify(presence.json)}`);
  assert(Number.isFinite(presence.json.count), 'presence missing count');

  const updateKey = await crypto.webcrypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const updatePlain = crypto.randomBytes(16);
  const updateEnc = await encryptUpdate(updatePlain, updateKey);

  const push = await api('/api/yjs/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      update_enc: updateEnc,
      update_nonce: 'v0',
      update_algo: 'aes-256-gcm',
      key_proof: keyProof,
      full: false
    })
  });
  assert(push.status === 200, `yjs push status=${push.status}`);
  assert(push.json && push.json.ok, `yjs push response=${JSON.stringify(push.json)}`);
  assert(Number.isFinite(push.json.ts), 'yjs push missing ts');

  const pull = await api(`/api/yjs/pull?id=${encodeURIComponent(id)}&since=0`);
  assert(pull.status === 200, `yjs pull status=${pull.status}`);
  assert(pull.json && Array.isArray(pull.json.updates), `yjs pull response=${JSON.stringify(pull.json)}`);
  assert(pull.json.updates.some((u) => u && u.update_enc === updateEnc), 'yjs pull missing pushed update');

  console.log('SMOKE: OK', { id, elapsed_ms: Date.now() - startedAt });
}

main().catch((err) => {
  console.error('SMOKE: FAILED', err && err.message ? err.message : err);
  process.exit(1);
});
