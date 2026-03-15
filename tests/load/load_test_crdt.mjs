import crypto from 'node:crypto';
import * as Y from 'yjs';

const BASE_URL = process.env.BASE_URL || 'https://malzispace.web.app';
const APP_CHECK_TOKEN = process.env.APP_CHECK_TOKEN;

const SPACES = Number(process.env.SPACES || 5);
const USERS_PER_SPACE = Number(process.env.USERS_PER_SPACE || 5);
const DURATION_SEC = Number(process.env.DURATION_SEC || 300);
const SAVE_INTERVAL_MS = Number(process.env.SAVE_INTERVAL_MS || 1000);
const PULL_INTERVAL_MS = Number(process.env.PULL_INTERVAL_MS || 1000);

if (!APP_CHECK_TOKEN) {
  console.error('Missing APP_CHECK_TOKEN. Set it in the environment.');
  process.exit(1);
}

function b64url(u8) {
  const bin = Buffer.from(u8).toString('base64');
  return bin.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function deriveKeyProof(keyBytes) {
  const digest = await crypto.webcrypto.subtle.digest('SHA-256', keyBytes);
  return b64url(new Uint8Array(digest));
}

function fromB64url(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 2 ? '==' : b64.length % 4 === 3 ? '=' : b64.length % 4 === 1 ? '===' : '';
  return new Uint8Array(Buffer.from(b64 + pad, 'base64'));
}

async function encryptUpdate(update, key) {
  const iv = crypto.randomBytes(12);
  const buf = await crypto.webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, update);
  const cipher = new Uint8Array(buf);
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return b64url(out);
}

async function decryptUpdate(updateEnc, key) {
  const bytes = fromB64url(updateEnc);
  if (bytes.length < 13) return null;
  const iv = bytes.slice(0, 12);
  const cipher = bytes.slice(12);
  const buf = await crypto.webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new Uint8Array(buf);
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

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function createSpace(keyProof) {
  const res = await api('/api/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'CRDT Load test', key_proof: keyProof })
  });
  if (res.json.error || !res.json.id) {
    throw new Error(`create failed: ${JSON.stringify(res.json)}`);
  }
  return res.json.id;
}

function randomText(len = 20) {
  const chars = 'abcdefghijklmnopqrstuvwxyz ';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out.trim() + ' ';
}

async function main() {
  console.log('Starting CRDT load test...');
  console.log(`Base: ${BASE_URL}`);
  console.log(`Spaces: ${SPACES}, Users/space: ${USERS_PER_SPACE}, Duration: ${DURATION_SEC}s`);
  console.log(`Save interval: ${SAVE_INTERVAL_MS}ms, Pull interval: ${PULL_INTERVAL_MS}ms`);

  const endAt = Date.now() + DURATION_SEC * 1000;

  const spaces = [];
  for (let i = 0; i < SPACES; i++) {
    const keyBytes = crypto.randomBytes(32);
    const keyProof = await deriveKeyProof(keyBytes);
    const id = await createSpace(keyProof);
    const key = await crypto.webcrypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    spaces.push({ id, key, keyProof });
  }
  console.log(`Spaces created: ${spaces.map(s => s.id).join(', ')}`);

  const stats = {
    reads: 0,
    writes: 0,
    errors: 0
  };

  const tick = setInterval(() => {
    console.log(
      `[${new Date().toISOString()}] reads=${stats.reads} writes=${stats.writes} errors=${stats.errors}`
    );
  }, 10000);

  async function runUser(space, idx) {
    const doc = new Y.Doc();
    const ytext = doc.getText('content');
    const queue = [];
    let lastPull = 0;
    let lastSave = 0;

    doc.on('update', (update, origin) => {
      if (origin === 'remote') return;
      queue.push(update);
    });

    async function flushQueue() {
      if (queue.length === 0) return;
      const update = queue.length === 1 ? queue[0] : Y.mergeUpdates(queue);
      queue.length = 0;
      const updateEnc = await encryptUpdate(update, space.key);
      const res = await api('/api/yjs/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: space.id,
          update_enc: updateEnc,
          update_nonce: 'v0',
          update_algo: 'aes-256-gcm',
          key_proof: space.keyProof
        })
      });
      if (res.json && !res.json.error) {
        stats.writes += 1;
      } else {
        stats.errors += 1;
      }
    }

    async function pullUpdates() {
      const res = await api(`/api/yjs/pull?id=${encodeURIComponent(space.id)}&since=${lastPull}`);
      if (!res.json || res.json.error) {
        stats.errors += 1;
        return;
      }
      if (res.json.full && res.json.full.update_enc) {
        const plain = await decryptUpdate(res.json.full.update_enc, space.key);
        if (plain) Y.applyUpdate(doc, plain, 'remote');
        if (res.json.full.ts) lastPull = Math.max(lastPull, res.json.full.ts);
      }
      if (Array.isArray(res.json.updates)) {
        for (const u of res.json.updates) {
          if (!u || !u.update_enc) continue;
          const plain = await decryptUpdate(u.update_enc, space.key);
          if (plain) Y.applyUpdate(doc, plain, 'remote');
          if (u.ts) lastPull = Math.max(lastPull, u.ts);
        }
      }
      stats.reads += 1;
    }

    while (Date.now() < endAt) {
      const now = Date.now();
      if (now - lastSave >= SAVE_INTERVAL_MS) {
        lastSave = now;
        ytext.insert(ytext.length, `u${idx}:${randomText(12)}`);
        await flushQueue();
      }
      if (now - lastPull >= PULL_INTERVAL_MS) {
        lastPull = now;
        await pullUpdates();
      }
      await sleep(50);
    }
  }

  const tasks = [];
  spaces.forEach((space, si) => {
    for (let u = 0; u < USERS_PER_SPACE; u++) {
      tasks.push(runUser(space, si * USERS_PER_SPACE + u));
    }
  });

  await Promise.all(tasks);
  clearInterval(tick);

  console.log('--- SUMMARY ---');
  console.log(`reads=${stats.reads} writes=${stats.writes} errors=${stats.errors}`);
  console.log(`per-user avg writes=${(stats.writes / (SPACES * USERS_PER_SPACE)).toFixed(1)} reads=${(stats.reads / (SPACES * USERS_PER_SPACE)).toFixed(1)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
