/**
 * @module services/crypto
 * AES-GCM E2E encryption: key derivation from URL hash,
 * key proof generation, content encryption/decryption.
 */
import ctx, { t } from '../core/context.js';

/** @type {string} Cached base64url-encoded SHA-256 key proof. */
let cachedKeyProof = '';

/** @type {Promise<string>|null} In-flight key proof derivation promise. */
let keyProofPromise = null;

/**
 * Decode a base64url-encoded string to a Uint8Array.
 * @param {string} b64url - The base64url string.
 * @returns {Uint8Array} The decoded bytes.
 */
export function fromB64(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const rem = b64.length % 4;
  const pad = rem === 2 ? '==' : rem === 3 ? '=' : '';
  const full = b64 + pad;
  const bin = atob(full);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Encode a Uint8Array as a base64url string (no padding).
 * @param {Uint8Array} u8 - The bytes to encode.
 * @returns {string} The base64url-encoded string.
 */
export function toB64(u8) {
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

/**
 * Extract the 32-byte AES key from the URL hash fragment.
 * @returns {Uint8Array|null} The 32-byte key, or null if absent/invalid.
 */
export function getKeyBytesFromHash() {
  const h = (window.location.hash || '').replace(/^#/, '');
  if (!h) return null;
  try {
    const bytes = fromB64(h);
    if (bytes.length < 32) return null;
    if (bytes.length > 32) return bytes.slice(0, 32);
    return bytes;
  } catch (e) { return null; }
}

/**
 * Derive the write-key proof (SHA-256 hash of the raw key bytes),
 * returned as a base64url string. Result is cached after first call.
 * @returns {Promise<string>} The base64url key proof, or empty string if no key.
 */
export async function getWriteKeyProof() {
  if (cachedKeyProof) return cachedKeyProof;
  if (keyProofPromise) return keyProofPromise;
  keyProofPromise = (async () => {
    const keyBytes = getKeyBytesFromHash();
    if (!keyBytes) return '';
    const digest = await crypto.subtle.digest('SHA-256', keyBytes);
    cachedKeyProof = toB64(new Uint8Array(digest));
    return cachedKeyProof;
  })();
  try {
    return await keyProofPromise;
  } finally {
    keyProofPromise = null;
  }
}

/**
 * Import the raw key bytes from the URL hash as an AES-GCM CryptoKey.
 * @returns {Promise<CryptoKey|null>} The imported key, or null if unavailable.
 */
export async function importKey() {
  const bytes = getKeyBytesFromHash();
  if (!bytes) return null;
  return await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt','decrypt']);
}

/**
 * Sign a room access payload using HMAC-SHA-256 with the key proof.
 * @param {string} room - The room/space identifier.
 * @param {number|string} exp - The expiration timestamp.
 * @param {string} nonce - A unique nonce for this request.
 * @returns {Promise<string>} The base64url-encoded HMAC signature, or empty string.
 */
export async function signRoomAccess(room, exp, nonce) {
  const keyProof = await getWriteKeyProof();
  if (!keyProof) return '';
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(keyProof),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const payload = new TextEncoder().encode(`${room}.${exp}.${nonce}`);
  const sig = await crypto.subtle.sign('HMAC', hmacKey, payload);
  return toB64(new Uint8Array(sig));
}

/**
 * Encrypt a Uint8Array using AES-GCM with a random 12-byte IV.
 * Returns the IV prepended to the ciphertext.
 * @param {Uint8Array} u8 - The plaintext bytes.
 * @returns {Promise<Uint8Array|null>} The IV+ciphertext, or null if no key.
 */
export async function encryptBytes(u8) {
  const key = await importKey();
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, u8);
  const cipher = new Uint8Array(buf);
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return out;
}

/**
 * Decrypt a Uint8Array (IV + ciphertext) using AES-GCM.
 * @param {Uint8Array} u8 - The IV+ciphertext bytes (at least 13 bytes).
 * @returns {Promise<Uint8Array|null>} The decrypted plaintext bytes, or null on failure.
 */
export async function decryptBytes(u8) {
  const key = await importKey();
  if (!key) return null;
  if (!u8 || u8.length < 13) return null;
  const iv = u8.slice(0, 12);
  const cipher = u8.slice(12);
  const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new Uint8Array(buf);
}

/**
 * Encrypt a plaintext string into a structured encryption envelope.
 * @param {string} plaintext - The text to encrypt.
 * @returns {Promise<{algo: string, nonce: string, ciphertext: string}|null>}
 *   The encryption result with base64url nonce and ciphertext, or null if no key.
 */
export async function encryptContent(plaintext) {
  const key = await importKey();
  if (!key) return null;
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(plaintext || '');
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const bytes = new Uint8Array(buf);
  return { algo: 'aes-256-gcm', nonce: toB64(iv), ciphertext: toB64(bytes) };
}

/**
 * Decrypt stored content from a document's content_enc/content_nonce fields.
 * @param {object} doc - An object with `content_enc` and `content_nonce` base64url strings.
 * @returns {Promise<string|null>} The decrypted plaintext, or null on failure.
 */
export async function decryptContent(doc) {
  const key = await importKey();
  if (!key) return null;
  const nonceB64 = doc.content_nonce || '';
  const cipherB64 = doc.content_enc || '';
  if (!nonceB64 || !cipherB64) return null;
  const iv = fromB64(nonceB64);
  const cipher = fromB64(cipherB64);
  const buf = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, cipher);
  return new TextDecoder().decode(new Uint8Array(buf));
}

/**
 * Encrypt a title string. Returns null for empty titles.
 * @param {string} plainTitle - The title to encrypt (max 80 chars).
 * @returns {Promise<{algo: string, nonce: string, ciphertext: string}|null>}
 */
export async function encryptTitle(plainTitle) {
  const trimmed = String(plainTitle || '').trim().slice(0, 80);
  if (!trimmed) return null;
  return encryptContent(trimmed);
}

/**
 * Decrypt a title from encrypted fields, with plaintext fallback for legacy spaces.
 * @param {object} doc - Object with optional title_enc, title_nonce, and title fields.
 * @returns {Promise<string>} The decrypted or plaintext title.
 */
export async function decryptTitle(doc) {
  if (!doc) return '';
  const nonceB64 = doc.title_nonce || '';
  const cipherB64 = doc.title_enc || '';
  if (nonceB64 && cipherB64) {
    const key = await importKey();
    if (!key) return doc.title || '';
    try {
      const iv = fromB64(nonceB64);
      const cipher = fromB64(cipherB64);
      const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
      return new TextDecoder().decode(new Uint8Array(buf));
    } catch (e) {
      return doc.title || '';
    }
  }
  return doc.title || '';
}

/**
 * Check that an encryption key is present. If missing and not in SIM_MODE,
 * shows an alert and disables the editor.
 * Uses a lazy dynamic import for `setEditorEditable` to avoid circular deps.
 * @returns {boolean} True if a key is available, false otherwise.
 */
export function requireKeyOrBlock() {
  if (ctx.SIM_MODE) return true;
  if (getKeyBytesFromHash()) return true;
  alert(t('dialog.missingKeyAlert'));
  // Lazy import to break circular dependency with selection.js
  import('./selection.js').then(({ setEditorEditable }) => {
    setEditorEditable(false);
  }).catch(() => {
    // Fallback: disable directly if dynamic import fails
    try {
      ctx.editor?.setAttribute('contenteditable', 'false');
    } catch (e) {}
  });
  return false;
}
