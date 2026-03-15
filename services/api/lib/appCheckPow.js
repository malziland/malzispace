'use strict';

const crypto = require('crypto');

const NONCE_RE = /^[A-Za-z0-9_-]{1,128}$/;

function toBase64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function randomChallenge(bytes = 18) {
  const size = Math.max(12, Number(bytes) || 18);
  return toBase64Url(crypto.randomBytes(size));
}

function normalizeNonce(input) {
  const value = String(input || '').trim();
  return NONCE_RE.test(value) ? value : '';
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input || ''), 'utf8').digest('hex');
}

function hasLeadingHexZeros(hex, difficulty) {
  const safeDifficulty = Math.max(1, Math.floor(Number(difficulty) || 0));
  const value = String(hex || '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(value)) return false;
  return value.startsWith('0'.repeat(safeDifficulty));
}

function verifyPow(challenge, nonce, difficulty) {
  const safeNonce = normalizeNonce(nonce);
  const safeChallenge = String(challenge || '').trim();
  if (!safeChallenge || !safeNonce) return false;
  return hasLeadingHexZeros(sha256Hex(`${safeChallenge}:${safeNonce}`), difficulty);
}

module.exports = {
  NONCE_RE,
  randomChallenge,
  normalizeNonce,
  sha256Hex,
  hasLeadingHexZeros,
  verifyPow
};
