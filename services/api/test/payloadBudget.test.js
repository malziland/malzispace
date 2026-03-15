'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { estimatePayloadBytes, estimatePayloadBudgetCost } = require('../lib/payloadBudget');

test('estimatePayloadBytes: sums utf-8 byte length of defined parts', () => {
  const bytes = estimatePayloadBytes(['abc', '', null, undefined, 'ä']);
  assert.equal(bytes, Buffer.byteLength('abc', 'utf8') + Buffer.byteLength('ä', 'utf8'));
});

test('estimatePayloadBudgetCost: returns at least 1 chunk', () => {
  assert.equal(estimatePayloadBudgetCost([]), 1);
  assert.equal(estimatePayloadBudgetCost(['']), 1);
});

test('estimatePayloadBudgetCost: rounds up by configured unit size', () => {
  assert.equal(estimatePayloadBudgetCost(['a'.repeat(1024)]), 1);
  assert.equal(estimatePayloadBudgetCost(['a'.repeat(1025)]), 2);
  assert.equal(estimatePayloadBudgetCost(['a'.repeat(10)], { unitBytes: 4 }), 3);
});
