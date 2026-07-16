/**
 * Unit tests for the E2E encryption module (ARCH-002).
 *
 * The browser module reads its key material from window.location.hash once
 * at import time, so each test key gets its own module instance via a
 * cache-busting query import after priming a minimal `window` global.
 * Node >= 20 provides WebCrypto, atob/btoa and TextEncoder natively.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

const MODULE_URL = new URL(
  '../../apps/web/public/assets/modules/services/crypto.js',
  import.meta.url
).href;

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

let instanceCounter = 0;

/** Import a fresh module instance bound to the given URL hash. */
async function loadCryptoWithHash(hash) {
  globalThis.window = {
    location: { hash },
    SPACE_ID: '', // keeps the module away from sessionStorage
  };
  const mod = await import(`${MODULE_URL}?instance=${instanceCounter++}`);
  delete globalThis.window;
  return mod;
}

const KEY_A = new Uint8Array(32).fill(7);
const KEY_B = new Uint8Array(32).fill(9);
const OWNER_SECRET = new Uint8Array(32).fill(42);

test('b64url round-trip incl. padding and URL-safe alphabet', async () => {
  const mod = await loadCryptoWithHash('');
  for (const len of [1, 2, 3, 31, 32, 33]) {
    const bytes = webcrypto.getRandomValues(new Uint8Array(len));
    const enc = mod.toB64(bytes);
    assert.match(enc, /^[A-Za-z0-9_-]+$/, 'no +, / or = in output');
    assert.deepEqual(mod.fromB64(enc), bytes);
  }
});

test('hash parsing: reader vs owner URLs, key length normalization', async () => {
  const reader = await loadCryptoWithHash(`#${b64url(KEY_A)}`);
  assert.deepEqual(reader.getKeyBytesFromHash(), KEY_A);
  assert.equal(reader.isOwnerFromHash(), false);
  assert.equal(reader.getOwnerSecretBytesFromHash(), null);

  const owner = await loadCryptoWithHash(`#${b64url(KEY_A)}.${b64url(OWNER_SECRET)}`);
  assert.deepEqual(owner.getKeyBytesFromHash(), KEY_A);
  assert.equal(owner.isOwnerFromHash(), true);
  assert.deepEqual(owner.getOwnerSecretBytesFromHash(), OWNER_SECRET);

  const tooShort = await loadCryptoWithHash(`#${b64url(new Uint8Array(16))}`);
  assert.equal(tooShort.getKeyBytesFromHash(), null, 'short keys are rejected');

  const overlong = await loadCryptoWithHash(`#${b64url(new Uint8Array(40).fill(1))}`);
  assert.equal(overlong.getKeyBytesFromHash().length, 32, 'overlong keys truncate to 32');

  const empty = await loadCryptoWithHash('');
  assert.equal(empty.getKeyBytesFromHash(), null);
  assert.equal(await empty.encryptContent('x'), null, 'no key -> no ciphertext');
});

test('key proofs are SHA-256 of the raw bytes and never the key itself', async () => {
  const mod = await loadCryptoWithHash(`#${b64url(KEY_A)}.${b64url(OWNER_SECRET)}`);
  const writeProof = await mod.getWriteKeyProof();
  const ownerProof = await mod.getOwnerKeyProof();

  const expectedWrite = b64url(new Uint8Array(await webcrypto.subtle.digest('SHA-256', KEY_A)));
  const expectedOwner = b64url(new Uint8Array(await webcrypto.subtle.digest('SHA-256', OWNER_SECRET)));
  assert.equal(writeProof, expectedWrite);
  assert.equal(ownerProof, expectedOwner);
  assert.notEqual(writeProof, b64url(KEY_A), 'proof must not leak the key');
  assert.notEqual(writeProof, ownerProof);
  assert.equal(await mod.getWriteKeyProof(), writeProof, 'cached result is stable');
});

test('content encryption round-trips and uses a fresh nonce per call', async () => {
  const mod = await loadCryptoWithHash(`#${b64url(KEY_A)}`);
  const env1 = await mod.encryptContent('Servus 🌍 — Zeile 1\nZeile 2');
  const env2 = await mod.encryptContent('Servus 🌍 — Zeile 1\nZeile 2');
  assert.equal(env1.algo, 'aes-256-gcm');
  assert.equal(mod.fromB64(env1.nonce).length, 12, '12-byte GCM IV');
  assert.notEqual(env1.nonce, env2.nonce, 'nonces must differ between calls');
  assert.notEqual(env1.ciphertext, env2.ciphertext);

  const plain = await mod.decryptContent({
    content_enc: env1.ciphertext,
    content_nonce: env1.nonce,
  });
  assert.equal(plain, 'Servus 🌍 — Zeile 1\nZeile 2');
});

test('tampered ciphertext fails GCM authentication', async () => {
  const mod = await loadCryptoWithHash(`#${b64url(KEY_A)}`);
  const env = await mod.encryptContent('integrity matters');
  const cipherBytes = mod.fromB64(env.ciphertext);
  cipherBytes[0] ^= 0x01; // flip one bit
  await assert.rejects(
    mod.decryptContent({ content_enc: mod.toB64(cipherBytes), content_nonce: env.nonce }),
    'a single flipped bit must be rejected'
  );
});

test('ciphertext from key A cannot be decrypted with key B', async () => {
  const modA = await loadCryptoWithHash(`#${b64url(KEY_A)}`);
  const modB = await loadCryptoWithHash(`#${b64url(KEY_B)}`);
  const env = await modA.encryptContent('for A only');
  await assert.rejects(
    modB.decryptContent({ content_enc: env.ciphertext, content_nonce: env.nonce })
  );
});

test('byte-level encryption prepends the IV and round-trips', async () => {
  const mod = await loadCryptoWithHash(`#${b64url(KEY_A)}`);
  const payload = webcrypto.getRandomValues(new Uint8Array(257));
  const sealed = await mod.encryptBytes(payload);
  assert.ok(sealed.length >= 12 + payload.length + 16, 'IV + ciphertext + GCM tag');
  assert.deepEqual(await mod.decryptBytes(sealed), payload);
  assert.equal(await mod.decryptBytes(new Uint8Array(5)), null, 'too-short input is rejected');
});

test('title helpers: trim/limit on encrypt, graceful empty string on failure', async () => {
  const mod = await loadCryptoWithHash(`#${b64url(KEY_A)}`);
  assert.equal(await mod.encryptTitle('   '), null, 'blank titles are not encrypted');

  const long = 'T'.repeat(200);
  const env = await mod.encryptTitle(long);
  const roundTrip = await mod.decryptTitle({ title_enc: env.ciphertext, title_nonce: env.nonce });
  assert.equal(roundTrip.length, 80, 'titles are capped at 80 chars');

  assert.equal(await mod.decryptTitle({}), '', 'missing fields -> empty string');
  const broken = mod.fromB64(env.ciphertext);
  broken[3] ^= 0xff;
  assert.equal(
    await mod.decryptTitle({ title_enc: mod.toB64(broken), title_nonce: env.nonce }),
    '',
    'tampered titles decode to empty string, never throw'
  );
});

test('room-access HMAC signatures are deterministic and payload-bound', async () => {
  const mod = await loadCryptoWithHash(`#${b64url(KEY_A)}.${b64url(OWNER_SECRET)}`);
  const sig1 = await mod.signRoomAccess('room1', 1710000000, 'nonce1');
  const sig2 = await mod.signRoomAccess('room1', 1710000000, 'nonce1');
  assert.equal(sig1, sig2, 'same payload -> same signature');
  assert.notEqual(sig1, await mod.signRoomAccess('room2', 1710000000, 'nonce1'));
  assert.notEqual(sig1, await mod.signRoomAccess('room1', 1710000001, 'nonce1'));
  assert.notEqual(sig1, await mod.signRoomAccess('room1', 1710000000, 'nonce2'));
  const ownerSig = await mod.signRoomAccessAsOwner('room1', 1710000000, 'nonce1');
  assert.notEqual(ownerSig, sig1, 'owner signature uses the owner proof');
});
