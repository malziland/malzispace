'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeIp, isPrivateIp, getTrustedClientIp, parseForwardedFor } = require('../lib/clientIp');

test('parseForwardedFor: keeps only valid ip entries', () => {
  assert.deepEqual(parseForwardedFor('1.2.3.4, nope, 2001:db8::1'), ['1.2.3.4', '2001:db8::1']);
});

test('getTrustedClientIp: returns client ip behind trusted private proxies', () => {
  const req = {
    headers: { 'x-forwarded-for': '198.51.100.20, 10.0.0.4' },
    socket: { remoteAddress: '10.0.0.5' }
  };
  assert.equal(getTrustedClientIp(req, { trustProxyHops: 2 }), '198.51.100.20');
});

test('getTrustedClientIp: ignores spoofed forwarded header for direct public connection', () => {
  const req = {
    headers: { 'x-forwarded-for': '198.51.100.20' },
    socket: { remoteAddress: '203.0.113.9' }
  };
  assert.equal(getTrustedClientIp(req, { trustProxyHops: 1 }), '203.0.113.9');
});

test('parseForwardedFor: returns empty array for blank or invalid values', () => {
  assert.deepEqual(parseForwardedFor(''), []);
  assert.deepEqual(parseForwardedFor('oops, nope'), []);
});

test('getTrustedClientIp: falls back to first forwarded ip when hop count exceeds chain', () => {
  const req = {
    headers: { 'x-forwarded-for': '198.51.100.21' },
    socket: { remoteAddress: '10.0.0.5' }
  };
  assert.equal(getTrustedClientIp(req, { trustProxyHops: 3 }), '198.51.100.21');
});

test('normalizeIp: normalizes ipv6 wrappers, mapped ipv4 and invalid input', () => {
  assert.equal(normalizeIp('[2001:db8::1]'), '2001:db8::1');
  assert.equal(normalizeIp('::ffff:192.168.0.7'), '192.168.0.7');
  assert.equal(normalizeIp('fe80::1%en0'), 'fe80::1');
  assert.equal(normalizeIp(undefined), '');
});

test('isPrivateIp: detects common private ranges and rejects public ip', () => {
  assert.equal(isPrivateIp('10.0.0.2'), true);
  assert.equal(isPrivateIp('172.20.0.1'), true);
  assert.equal(isPrivateIp('192.168.1.2'), true);
  assert.equal(isPrivateIp('100.64.0.10'), true);
  assert.equal(isPrivateIp('fe80::1'), true);
  assert.equal(isPrivateIp('2001:db8::1'), false);
  assert.equal(isPrivateIp('198.51.100.1'), false);
});
