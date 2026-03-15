import crypto from 'node:crypto';

const BASE_URL = process.env.BASE_URL || 'https://malzispace.web.app';
const APP_CHECK_TOKEN = process.env.APP_CHECK_TOKEN;

const USERS = Number(process.env.USERS || 20);
const DURATION_SEC = Number(process.env.DURATION_SEC || 600);
const SAVE_INTERVAL_MS = Number(process.env.SAVE_INTERVAL_MS || 1000);
const LOAD_INTERVAL_MS = Number(process.env.LOAD_INTERVAL_MS || 1000);

if (!APP_CHECK_TOKEN) {
  console.error('Missing APP_CHECK_TOKEN. Set it in the environment.');
  process.exit(1);
}

const enc = new TextEncoder();

function b64url(u8) {
  const bin = Buffer.from(u8).toString('base64');
  return bin.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function deriveKeyProof(keyBytes) {
  const digest = await crypto.webcrypto.subtle.digest('SHA-256', keyBytes);
  return b64url(new Uint8Array(digest));
}

async function encryptContent(text, key) {
  const iv = crypto.randomBytes(12);
  const data = enc.encode(text || '');
  const buf = await crypto.webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return {
    algo: 'aes-256-gcm',
    nonce: b64url(iv),
    ciphertext: b64url(new Uint8Array(buf))
  };
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
    body: JSON.stringify({ title: 'Load test', key_proof: keyProof })
  });
  if (res.json.error || !res.json.id) {
    throw new Error(`create failed: ${JSON.stringify(res.json)}`);
  }
  return res.json.id;
}

async function main() {
  console.log('Starting load test...');
  console.log(`Base: ${BASE_URL}`);
  console.log(`Users: ${USERS}, Duration: ${DURATION_SEC}s`);
  console.log(`Save interval: ${SAVE_INTERVAL_MS}ms, Load interval: ${LOAD_INTERVAL_MS}ms`);

  const keyBytes = crypto.randomBytes(32);
  const keyProof = await deriveKeyProof(keyBytes);
  const spaceId = await createSpace(keyProof);
  console.log(`Space created: ${spaceId}`);
  const key = await crypto.webcrypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const endAt = Date.now() + DURATION_SEC * 1000;
  const stats = Array.from({ length: USERS }, () => ({
    reads: 0,
    writes: 0,
    conflicts: 0,
    errors: 0,
    version: 0
  }));

  let totalReads = 0;
  let totalWrites = 0;
  let totalConflicts = 0;
  let totalErrors = 0;

  const tick = setInterval(() => {
    totalReads = stats.reduce((a, s) => a + s.reads, 0);
    totalWrites = stats.reduce((a, s) => a + s.writes, 0);
    totalConflicts = stats.reduce((a, s) => a + s.conflicts, 0);
    totalErrors = stats.reduce((a, s) => a + s.errors, 0);
    console.log(
      `[${new Date().toISOString()}] reads=${totalReads} writes=${totalWrites} conflicts=${totalConflicts} errors=${totalErrors}`
    );
  }, 10000);

  async function runUser(i) {
    const s = stats[i];
    let lastLoad = 0;
    let lastSave = 0;
    let counter = 0;

    while (Date.now() < endAt) {
      const now = Date.now();
      try {
        if (now - lastLoad >= LOAD_INTERVAL_MS) {
          lastLoad = now;
          const res = await api(`/api/load?id=${encodeURIComponent(spaceId)}`);
          if (res.json && !res.json.error) {
            s.reads += 1;
            if (Number.isFinite(res.json.version)) s.version = res.json.version;
          } else {
            s.errors += 1;
          }
        }

        if (now - lastSave >= SAVE_INTERVAL_MS) {
          lastSave = now;
          const content = `user=${i} msg=${counter++} ts=${now}`;
          const encContent = await encryptContent(content, key);
          const res = await api('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: spaceId,
              title: 'Load test',
              version: s.version,
              zk: true,
              key_proof: keyProof,
              content_enc: encContent.ciphertext,
              content_nonce: encContent.nonce,
              content_algo: encContent.algo
            })
          });
          if (res.json && !res.json.error) {
            s.writes += 1;
            if (res.json.conflict) s.conflicts += 1;
            if (Number.isFinite(res.json.version)) s.version = res.json.version;
          } else {
            s.errors += 1;
          }
        }
      } catch {
        s.errors += 1;
      }
      await sleep(50);
    }
  }

  await Promise.all(Array.from({ length: USERS }, (_, i) => runUser(i)));
  clearInterval(tick);

  totalReads = stats.reduce((a, s) => a + s.reads, 0);
  totalWrites = stats.reduce((a, s) => a + s.writes, 0);
  totalConflicts = stats.reduce((a, s) => a + s.conflicts, 0);
  totalErrors = stats.reduce((a, s) => a + s.errors, 0);

  console.log('--- SUMMARY ---');
  console.log(`reads=${totalReads} writes=${totalWrites} conflicts=${totalConflicts} errors=${totalErrors}`);
  console.log(`per-user avg writes=${(totalWrites / USERS).toFixed(1)} reads=${(totalReads / USERS).toFixed(1)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
