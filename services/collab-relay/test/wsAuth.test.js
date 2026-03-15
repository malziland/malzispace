'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createWsAuthSignature, verifyWsAuthQuery } = require('../lib/wsAuth');

test('verifyWsAuthQuery: accepts a valid room-scoped signature', () => {
  const room = 'abc12345';
  const exp = String(1_710_000_060_000);
  const nonce = 'nonce123456';
  const keyProof = 'proof-proof-proof-proof-proof-proof-proof-proof';
  const sig = createWsAuthSignature(room, exp, nonce, keyProof);
  const params = new URLSearchParams({ exp, nonce, sig });

  assert.equal(
    verifyWsAuthQuery(params, room, keyProof, { nowMs: 1_710_000_000_000 }),
    true
  );
});

test('verifyWsAuthQuery: rejects wrong room or expired token', () => {
  const room = 'abc12345';
  const exp = String(1_710_000_060_000);
  const nonce = 'nonce123456';
  const keyProof = 'proof-proof-proof-proof-proof-proof-proof-proof';
  const sig = createWsAuthSignature(room, exp, nonce, keyProof);

  assert.equal(
    verifyWsAuthQuery(new URLSearchParams({ exp, nonce, sig }), 'otherroom', keyProof, { nowMs: 1_710_000_000_000 }),
    false
  );
  assert.equal(
    verifyWsAuthQuery(new URLSearchParams({ exp, nonce, sig }), room, keyProof, { nowMs: 1_710_000_070_000 }),
    false
  );
});

test('verifyWsAuthQuery: rejects malformed or excessively future-dated auth params', () => {
  const room = 'abc12345';
  const exp = String(1_710_000_060_000);
  const nonce = 'nonce123456';
  const keyProof = 'proof-proof-proof-proof-proof-proof-proof-proof';
  const sig = createWsAuthSignature(room, exp, nonce, keyProof);

  assert.equal(
    verifyWsAuthQuery(new URLSearchParams({ exp: 'nope', nonce, sig }), room, keyProof, { nowMs: 1_710_000_000_000 }),
    false
  );
  assert.equal(
    verifyWsAuthQuery(new URLSearchParams({ exp: String(1_710_000_400_000), nonce, sig }), room, keyProof, { nowMs: 1_710_000_000_000 }),
    false
  );
  assert.equal(
    verifyWsAuthQuery(new URLSearchParams({ exp, nonce: 'bad', sig }), room, keyProof, { nowMs: 1_710_000_000_000 }),
    false
  );
  assert.equal(
    verifyWsAuthQuery(new URLSearchParams({ exp, nonce, sig: `${sig}a` }), room, keyProof, { nowMs: 1_710_000_000_000 }),
    false
  );
});
