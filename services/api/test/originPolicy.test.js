'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOrigin, parseAllowedOrigins, isOriginAllowed } = require('../lib/originPolicy');

test('normalizeOrigin: accepts valid http(s) origins', () => {
  assert.equal(normalizeOrigin('https://malzi.space/path?q=1'), 'https://malzi.space');
  assert.equal(normalizeOrigin(' http://localhost:3000/foo '), 'http://localhost:3000');
});

test('normalizeOrigin: rejects invalid or unsupported origins', () => {
  assert.equal(normalizeOrigin(''), '');
  assert.equal(normalizeOrigin('not-an-origin'), '');
  assert.equal(normalizeOrigin('chrome-extension://abc'), '');
});

test('parseAllowedOrigins: merges defaults and env list', () => {
  const set = parseAllowedOrigins('https://example.com, https://foo.bar');
  assert.equal(set.has('https://malzi.space'), true);
  assert.equal(set.has('https://example.com'), true);
  assert.equal(set.has('https://foo.bar'), true);
});

test('isOriginAllowed: allows missing origin and known origins', () => {
  const set = parseAllowedOrigins('https://example.com');
  assert.equal(isOriginAllowed('', set), true);
  assert.equal(isOriginAllowed('https://example.com', set), true);
  assert.equal(isOriginAllowed('https://evil.example', set), false);
  assert.equal(isOriginAllowed('not-an-origin', set), false);
});

test('parseAllowedOrigins: ignores invalid entries and non-string input', () => {
  const set = parseAllowedOrigins('notaurl, https://good.example');
  assert.equal(set.has('https://good.example'), true);
  assert.equal(set.has('notaurl'), false);
  assert.equal(parseAllowedOrigins(null).has('https://malzi.space'), true);
});
