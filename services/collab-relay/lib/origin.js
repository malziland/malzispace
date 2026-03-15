'use strict';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://malzi.space',
  'https://www.malzi.space',
  'https://malzispace.web.app',
  'https://malzispace.firebaseapp.com',
  'http://localhost:3000',
  'http://localhost:5000',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5000'
];

function normalizeOrigin(input) {
  if (typeof input !== 'string') return '';
  const v = input.trim();
  if (!v) return '';
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.origin;
  } catch (e) {
    return '';
  }
}

function parseAllowedOrigins(raw, defaults = DEFAULT_ALLOWED_ORIGINS) {
  const out = new Set();
  for (const d of defaults) {
    const n = normalizeOrigin(d);
    if (n) out.add(n);
  }
  if (typeof raw !== 'string' || !raw.trim()) return out;
  for (const token of raw.split(',')) {
    const n = normalizeOrigin(token);
    if (n) out.add(n);
  }
  return out;
}

function normalizeHost(input) {
  if (typeof input !== 'string') return '';
  return input.trim().toLowerCase();
}

function isOriginAllowed(rawOrigin, rawHost, allowedOrigins, requireOrigin = true, allowHostFallback = false) {
  const origin = normalizeOrigin(rawOrigin || '');
  if (!origin) return !requireOrigin;

  if (allowedOrigins && allowedOrigins.has(origin)) return true;

  if (!allowHostFallback) return false;

  // Optional fallback: allow same host as request host header.
  const host = normalizeHost(rawHost || '');
  if (!host) return false;
  if (origin === `https://${host}`) return true;
  if (origin === `http://${host}`) return true;
  return false;
}

module.exports = {
  DEFAULT_ALLOWED_ORIGINS,
  normalizeOrigin,
  parseAllowedOrigins,
  isOriginAllowed
};
