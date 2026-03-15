'use strict';

function estimatePayloadBytes(parts) {
  let total = 0;
  for (const part of parts || []) {
    if (part === null || part === undefined) continue;
    total += Buffer.byteLength(String(part), 'utf8');
  }
  return total;
}

function estimatePayloadBudgetCost(parts, opts = {}) {
  const unitBytes = Number.isFinite(Number(opts.unitBytes)) && Number(opts.unitBytes) > 0
    ? Math.floor(Number(opts.unitBytes))
    : 1024;
  const minCost = Number.isFinite(Number(opts.minCost)) && Number(opts.minCost) > 0
    ? Math.floor(Number(opts.minCost))
    : 1;
  const totalBytes = estimatePayloadBytes(parts);
  return Math.max(minCost, Math.ceil(totalBytes / unitBytes));
}

module.exports = {
  estimatePayloadBytes,
  estimatePayloadBudgetCost
};
