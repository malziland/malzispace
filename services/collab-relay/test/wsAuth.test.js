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

test('verifyWsAuthQuery: respects sigParamName option for owner signatures', () => {
  const room = 'abc12345';
  const exp = String(1_710_000_060_000);
  const nonce = 'nonce123456';
  const ownerKeyProof = 'owner-owner-owner-owner-owner-owner-owner-owner';
  const ownerSig = createWsAuthSignature(room, exp, nonce, ownerKeyProof);
  // Reader sig over the same payload but with a different secret must not be
  // mistakenly accepted as an owner sig.
  const readerSig = createWsAuthSignature(room, exp, nonce, 'reader-reader-reader-reader-reader-reader-rdr');

  const ownerParams = new URLSearchParams({ exp, nonce, owner_sig: ownerSig });
  assert.equal(
    verifyWsAuthQuery(ownerParams, room, ownerKeyProof, { nowMs: 1_710_000_000_000, sigParamName: 'owner_sig' }),
    true
  );

  const mixed = new URLSearchParams({ exp, nonce, owner_sig: readerSig });
  assert.equal(
    verifyWsAuthQuery(mixed, room, ownerKeyProof, { nowMs: 1_710_000_000_000, sigParamName: 'owner_sig' }),
    false
  );

  // Missing owner_sig param with the default `sig` populated must still fail
  // when sigParamName is overridden.
  const wrongName = new URLSearchParams({ exp, nonce, sig: ownerSig });
  assert.equal(
    verifyWsAuthQuery(wrongName, room, ownerKeyProof, { nowMs: 1_710_000_000_000, sigParamName: 'owner_sig' }),
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
