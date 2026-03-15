'use strict';

const crypto = require('crypto');

const NONCE_RE = /^[A-Za-z0-9\-_]{8,128}$/;
const SIG_RE = /^[A-Za-z0-9\-_]{32,128}$/;

function toB64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createWsAuthSignature(room, exp, nonce, keyProof) {
  return toB64Url(
    crypto
      .createHmac('sha256', String(keyProof || ''))
      .update(`${room}.${exp}.${nonce}`)
      .digest()
  );
}

function safeEqualText(left, right) {
  try {
    const a = Buffer.from(String(left || ''), 'utf8');
    const b = Buffer.from(String(right || ''), 'utf8');
    if (!a.length || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

function verifyWsAuthQuery(searchParams, room, keyProof, options = {}) {
  if (!searchParams || !room || !keyProof) return false;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const maxFutureMs = Number.isFinite(options.maxFutureMs) ? options.maxFutureMs : 5 * 60 * 1000;
  const maxSkewMs = Number.isFinite(options.maxSkewMs) ? options.maxSkewMs : 5 * 1000;

  const expRaw = searchParams.get('exp') || '';
  const nonce = searchParams.get('nonce') || '';
  const sig = searchParams.get('sig') || '';
  const exp = Number(expRaw);

  if (!Number.isFinite(exp) || exp <= 0) return false;
  if (!NONCE_RE.test(nonce) || !SIG_RE.test(sig)) return false;
  if (exp < (nowMs - maxSkewMs)) return false;
  if (exp > (nowMs + maxFutureMs)) return false;

  const expected = createWsAuthSignature(room, expRaw, nonce, keyProof);
  return safeEqualText(sig, expected);
}

module.exports = {
  createWsAuthSignature,
  verifyWsAuthQuery
};
