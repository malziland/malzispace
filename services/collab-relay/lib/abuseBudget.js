'use strict';

function consumeWindowBudget(bucket, nowMs, windowMs, limit, cost = 1) {
  if (!bucket || typeof bucket !== 'object') throw new Error('bucket must be an object');
  if (!Number.isFinite(nowMs)) throw new Error('nowMs must be finite');
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error('windowMs must be > 0');
  if (!Number.isFinite(limit) || limit <= 0) throw new Error('limit must be > 0');
  if (!Number.isFinite(cost) || cost <= 0) cost = 1;

  if (!Number.isFinite(bucket.windowStartedAt) || (nowMs - bucket.windowStartedAt) >= windowMs) {
    bucket.windowStartedAt = nowMs;
    bucket.used = 0;
  }

  bucket.used = Number.isFinite(bucket.used) ? bucket.used + cost : cost;
  if (bucket.used > limit) {
    return {
      ok: false,
      retryAfterMs: Math.max(0, windowMs - (nowMs - bucket.windowStartedAt))
    };
  }
  return {
    ok: true,
    remaining: Math.max(0, limit - bucket.used)
  };
}

function tryAcquireConcurrent(map, key, max) {
  if (!(map instanceof Map)) throw new Error('map must be a Map');
  if (typeof key !== 'string' || key.length === 0) throw new Error('key must be a non-empty string');
  if (!Number.isFinite(max) || max <= 0) throw new Error('max must be > 0');
  const current = Number(map.get(key) || 0);
  if (current >= max) return false;
  map.set(key, current + 1);
  return true;
}

function releaseConcurrent(map, key) {
  if (!(map instanceof Map)) throw new Error('map must be a Map');
  if (typeof key !== 'string' || key.length === 0) return 0;
  const current = Number(map.get(key) || 0);
  if (current <= 1) {
    map.delete(key);
    return 0;
  }
  map.set(key, current - 1);
  return current - 1;
}

module.exports = {
  consumeWindowBudget,
  tryAcquireConcurrent,
  releaseConcurrent
};
