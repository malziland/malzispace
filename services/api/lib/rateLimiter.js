'use strict';

// Simple in-memory fixed-window rate limiter.
// Note: This limits per function instance (not global across all instances).

class RateLimiter {
  /**
   * @param {object} opts
   * @param {number} opts.windowMs
   * @param {number} opts.max
   * @param {() => number} [opts.now]
   * @param {number} [opts.maxKeys]
   */
  constructor(opts) {
    const windowMs = Number(opts && opts.windowMs);
    const max = Number(opts && opts.max);
    if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error('RateLimiter: invalid windowMs');
    if (!Number.isFinite(max) || max <= 0) throw new Error('RateLimiter: invalid max');
    this.windowMs = windowMs;
    this.max = max;
    this.now = (opts && typeof opts.now === 'function') ? opts.now : () => Date.now();
    this.maxKeys = (opts && Number.isFinite(opts.maxKeys)) ? opts.maxKeys : 10000;

    /** @type {Map<string, {resetAt:number, count:number}>} */
    this.buckets = new Map();
    this._ops = 0;
  }

  _prune(nowMs) {
    // Cheap periodic cleanup to avoid unbounded memory growth.
    for (const [k, v] of this.buckets) {
      if (!v || v.resetAt <= nowMs) this.buckets.delete(k);
    }

    if (this.buckets.size <= this.maxKeys) return;
    // Drop oldest keys if we still exceed maxKeys.
    const over = this.buckets.size - this.maxKeys;
    for (let i = 0; i < over; i++) {
      const it = this.buckets.keys().next();
      if (it.done) break;
      this.buckets.delete(it.value);
    }
  }

  /**
   * Consume tokens from a key bucket.
   * @param {string} key
   * @param {number} [cost]
   * @returns {{ok:true, remaining:number, resetAt:number}|{ok:false, retryAfterMs:number, resetAt:number}}
   */
  consume(key, cost = 1) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('RateLimiter.consume: key must be a non-empty string');
    }
    cost = Number(cost);
    if (!Number.isFinite(cost) || cost <= 0) cost = 1;

    const nowMs = this.now();
    this._ops++;
    if ((this._ops % 250) === 0) this._prune(nowMs);

    let b = this.buckets.get(key);
    if (!b || b.resetAt <= nowMs) {
      b = { resetAt: nowMs + this.windowMs, count: 0 };
      this.buckets.set(key, b);
    }

    b.count += cost;

    if (b.count > this.max) {
      return { ok: false, retryAfterMs: Math.max(0, b.resetAt - nowMs), resetAt: b.resetAt };
    }
    return { ok: true, remaining: Math.max(0, this.max - b.count), resetAt: b.resetAt };
  }
}

module.exports = { RateLimiter };

