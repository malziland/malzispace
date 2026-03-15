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
  const trimmed = input.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.origin;
  } catch (e) {
    return '';
  }
}

function parseAllowedOrigins(raw, defaults = DEFAULT_ALLOWED_ORIGINS) {
  const out = new Set();
  for (const origin of defaults) {
    const normalized = normalizeOrigin(origin);
    if (normalized) out.add(normalized);
  }
  if (typeof raw !== 'string' || !raw.trim()) return out;
  for (const token of raw.split(',')) {
    const normalized = normalizeOrigin(token);
    if (normalized) out.add(normalized);
  }
  return out;
}

function isOriginAllowed(rawOrigin, allowedOrigins) {
  if (!rawOrigin) return true; // non-browser / same-origin requests may omit Origin
  const normalized = normalizeOrigin(rawOrigin);
  if (!normalized) return false;
  return !!(allowedOrigins && allowedOrigins.has(normalized));
}

module.exports = {
  DEFAULT_ALLOWED_ORIGINS,
  normalizeOrigin,
  parseAllowedOrigins,
  isOriginAllowed
};
