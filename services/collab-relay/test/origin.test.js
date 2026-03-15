'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOrigin, parseAllowedOrigins, isOriginAllowed } = require('../lib/origin');

test('normalizeOrigin: keeps only scheme + host', () => {
  assert.equal(normalizeOrigin('https://malzi.space/path?q=1'), 'https://malzi.space');
  assert.equal(normalizeOrigin('http://localhost:5000/foo'), 'http://localhost:5000');
});

test('normalizeOrigin: rejects invalid values', () => {
  assert.equal(normalizeOrigin(''), '');
  assert.equal(normalizeOrigin('not-an-origin'), '');
  assert.equal(normalizeOrigin('file:///tmp/a.html'), '');
});

test('parseAllowedOrigins: includes defaults and extra list', () => {
  const set = parseAllowedOrigins('https://example.com');
  assert.equal(set.has('https://malzi.space'), true);
  assert.equal(set.has('https://example.com'), true);
});

test('parseAllowedOrigins: ignores invalid tokens and preserves defaults', () => {
  const set = parseAllowedOrigins('notaurl, https://valid.example');
  assert.equal(set.has('https://valid.example'), true);
  assert.equal(set.has('notaurl'), false);
});

test('isOriginAllowed: enforces allowlist with optional host fallback', () => {
  const set = parseAllowedOrigins('https://example.com', []);
  assert.equal(isOriginAllowed('https://example.com', 'irrelevant', set, true), true);
  assert.equal(isOriginAllowed('https://evil.example', 'malzi.space', set, true), false);
  assert.equal(isOriginAllowed('', 'malzi.space', set, true), false);
  assert.equal(isOriginAllowed('', 'malzi.space', set, false), true);
  assert.equal(isOriginAllowed('https://malzi.space', 'malzi.space', set, true), false);
  assert.equal(isOriginAllowed('https://malzi.space', 'malzi.space', set, true, true), true);
});
