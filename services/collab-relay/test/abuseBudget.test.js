'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  consumeWindowBudget,
  tryAcquireConcurrent,
  releaseConcurrent
} = require('../lib/abuseBudget');

test('consumeWindowBudget: allows usage until the limit and resets by window', () => {
  const bucket = {};

  assert.equal(consumeWindowBudget(bucket, 0, 1000, 10, 4).ok, true);
  assert.equal(consumeWindowBudget(bucket, 100, 1000, 10, 6).ok, true);
  assert.equal(consumeWindowBudget(bucket, 200, 1000, 10, 1).ok, false);

  assert.equal(consumeWindowBudget(bucket, 1200, 1000, 10, 5).ok, true);
});

test('consumeWindowBudget: defaults invalid cost to 1', () => {
  const bucket = {};
  assert.equal(consumeWindowBudget(bucket, 0, 1000, 2, 0).ok, true);
  assert.equal(consumeWindowBudget(bucket, 1, 1000, 2, -1).ok, true);
  assert.equal(consumeWindowBudget(bucket, 2, 1000, 2, 0).ok, false);
});

test('tryAcquireConcurrent/releaseConcurrent: tracks and releases counts', () => {
  const map = new Map();

  assert.equal(tryAcquireConcurrent(map, '1.2.3.4', 2), true);
  assert.equal(tryAcquireConcurrent(map, '1.2.3.4', 2), true);
  assert.equal(tryAcquireConcurrent(map, '1.2.3.4', 2), false);

  assert.equal(releaseConcurrent(map, '1.2.3.4'), 1);
  assert.equal(tryAcquireConcurrent(map, '1.2.3.4', 2), true);
  assert.equal(releaseConcurrent(map, '1.2.3.4'), 1);
  assert.equal(releaseConcurrent(map, '1.2.3.4'), 0);
  assert.equal(map.has('1.2.3.4'), false);
});

test('abuseBudget helpers: validate required inputs and tolerate empty release key', () => {
  assert.throws(() => consumeWindowBudget(null, 0, 1000, 1, 1), /bucket/);
  assert.throws(() => consumeWindowBudget({}, Number.NaN, 1000, 1, 1), /nowMs/);
  assert.throws(() => consumeWindowBudget({}, 0, 0, 1, 1), /windowMs/);
  assert.throws(() => consumeWindowBudget({}, 0, 1000, 0, 1), /limit/);
  assert.throws(() => tryAcquireConcurrent({}, 'ip', 1), /Map/);
  assert.throws(() => tryAcquireConcurrent(new Map(), '', 1), /non-empty string/);
  assert.throws(() => tryAcquireConcurrent(new Map(), 'ip', 0), /max/);
  assert.equal(releaseConcurrent(new Map(), ''), 0);
});
