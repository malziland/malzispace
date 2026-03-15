'use strict';

const net = require('net');

function normalizeIp(input) {
  if (typeof input !== 'string') return '';
  let value = input.trim();
  if (!value) return '';
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  if (value.startsWith('::ffff:')) value = value.slice(7);
  const zoneIndex = value.indexOf('%');
  if (zoneIndex >= 0) value = value.slice(0, zoneIndex);
  if (!net.isIP(value)) return '';
  return value.toLowerCase();
}

function parseForwardedFor(rawHeader) {
  if (typeof rawHeader !== 'string' || !rawHeader.trim()) return [];
  return rawHeader
    .split(',')
    .map((part) => normalizeIp(part))
    .filter(Boolean);
}

function isPrivateIp(ip) {
  const value = normalizeIp(ip);
  if (!value) return false;
  if (net.isIPv4(value)) {
    if (value === '127.0.0.1') return true;
    if (value.startsWith('10.')) return true;
    if (value.startsWith('192.168.')) return true;
    if (value.startsWith('169.254.')) return true;
    const parts = value.split('.').map((v) => Number(v));
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return false;
  }
  return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:');
}

function getTrustedClientIp(req, options = {}) {
  const trustProxyHops = Number.isFinite(options.trustProxyHops)
    ? Math.max(0, Math.floor(options.trustProxyHops))
    : 0;
  const remote = normalizeIp(req && req.socket && req.socket.remoteAddress);
  const chain = parseForwardedFor(req && req.headers && req.headers['x-forwarded-for']);

  if (remote && !isPrivateIp(remote)) return remote;
  if (!trustProxyHops || !chain.length) return remote || 'unknown';

  const fullChain = chain.slice();
  if (remote) fullChain.push(remote);
  const candidateIndex = fullChain.length - trustProxyHops - 1;
  if (candidateIndex >= 0 && fullChain[candidateIndex]) return fullChain[candidateIndex];
  return chain[0] || remote || 'unknown';
}

module.exports = {
  normalizeIp,
  parseForwardedFor,
  isPrivateIp,
  getTrustedClientIp
};
