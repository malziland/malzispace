'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { RateLimiter } = require('../lib/rateLimiter');

test('RateLimiter: allows up to max within a window', () => {
  let now = 0;
  const rl = new RateLimiter({ windowMs: 1000, max: 3, now: () => now });

  assert.equal(rl.consume('k').ok, true);
  assert.equal(rl.consume('k').ok, true);
  assert.equal(rl.consume('k').ok, true);

  const blocked = rl.consume('k');
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterMs > 0);
});

test('RateLimiter: resets after window', () => {
  let now = 0;
  const rl = new RateLimiter({ windowMs: 1000, max: 1, now: () => now });

  assert.equal(rl.consume('k').ok, true);
  assert.equal(rl.consume('k').ok, false);

  now = 1001;
  assert.equal(rl.consume('k').ok, true);
});

test('RateLimiter: cost consumes multiple tokens', () => {
  let now = 0;
  const rl = new RateLimiter({ windowMs: 1000, max: 5, now: () => now });

  assert.equal(rl.consume('k', 3).ok, true);
  assert.equal(rl.consume('k', 2).ok, true);
  assert.equal(rl.consume('k', 1).ok, false);
});

test('RateLimiter: invalid key throws and invalid cost defaults to one token', () => {
  const rl = new RateLimiter({ windowMs: 1000, max: 2, now: () => 0 });
  assert.throws(() => rl.consume(''), /non-empty string/);
  assert.equal(rl.consume('k', 0).ok, true);
  assert.equal(rl.consume('k', Number.NaN).ok, true);
  assert.equal(rl.consume('k', -1).ok, false);
});

test('RateLimiter: prunes expired and excess keys', () => {
  let now = 0;
  const rl = new RateLimiter({ windowMs: 10, max: 1, maxKeys: 2, now: () => now });

  for (let i = 0; i < 3; i += 1) {
    rl.consume(`k${i}`);
  }
  now = 11;
  rl.consume('fresh-a');
  rl.consume('fresh-b');
  rl.consume('fresh-c');
  rl._prune(now);

  assert.equal(rl.buckets.has('fresh-c'), true);
  assert.ok(rl.buckets.size <= 2);
});

test('RateLimiter: constructor validates required limits', () => {
  assert.throws(() => new RateLimiter({ windowMs: 0, max: 1 }), /invalid windowMs/);
  assert.throws(() => new RateLimiter({ windowMs: 1000, max: 0 }), /invalid max/);
});
