'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeRoom } = require('../lib/room');

test('sanitizeRoom: accepts lowercase alnum within range', () => {
  assert.equal(sanitizeRoom('abc123'), 'abc123');
  assert.equal(sanitizeRoom(' DEFAULT '), 'default');
});

test('sanitizeRoom: rejects invalid values', () => {
  assert.equal(sanitizeRoom(''), null);
  assert.equal(sanitizeRoom('ab'), null); // too short
  assert.equal(sanitizeRoom('a'.repeat(49)), null); // too long
  assert.equal(sanitizeRoom('abc-123'), null); // invalid char
});

