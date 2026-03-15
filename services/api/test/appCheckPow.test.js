'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  NONCE_RE,
  randomChallenge,
  normalizeNonce,
  sha256Hex,
  hasLeadingHexZeros,
  verifyPow
} = require('../lib/appCheckPow');

test('appCheckPow: randomChallenge returns base64url-looking token', () => {
  const challenge = randomChallenge(18);
  assert.match(challenge, /^[A-Za-z0-9_-]{16,}$/);
});

test('appCheckPow: normalizeNonce rejects invalid values', () => {
  assert.equal(normalizeNonce('nonce_123'), 'nonce_123');
  assert.equal(normalizeNonce(''), '');
  assert.equal(normalizeNonce('bad nonce'), '');
  assert.equal(normalizeNonce('x'.repeat(129)), '');
  assert.match('nonce_123', NONCE_RE);
});

test('appCheckPow: leading zero check is deterministic', () => {
  assert.equal(hasLeadingHexZeros('000abc', 3), true);
  assert.equal(hasLeadingHexZeros('00fabc', 3), false);
  assert.equal(sha256Hex('abc').length, 64);
});

test('appCheckPow: verifyPow accepts computed nonce and rejects wrong ones', () => {
  const challenge = 'unit-test-challenge';
  let nonce = '';
  for (let i = 0; i < 100000; i += 1) {
    const candidate = i.toString(36);
    if (verifyPow(challenge, candidate, 3)) {
      nonce = candidate;
      break;
    }
  }
  assert.ok(nonce, 'expected to find a valid nonce');
  assert.equal(verifyPow(challenge, nonce, 3), true);
  assert.equal(verifyPow(challenge, `${nonce}x`, 3), false);
  assert.equal(verifyPow('', nonce, 3), false);
});
