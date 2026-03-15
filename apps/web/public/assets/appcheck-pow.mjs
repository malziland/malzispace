/* global TextEncoder, crypto, URL, fetch, window */

const APP_CHECK_API_ROOT = 'https://firebaseappcheck.googleapis.com/v1';

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeNonce(input) {
  const value = String(input || '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : '';
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(String(input || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}

function hasLeadingHexZeros(hex, difficulty) {
  const safeDifficulty = Math.max(1, Math.floor(Number(difficulty) || 0));
  const value = String(hex || '').toLowerCase();
  return /^[0-9a-f]+$/.test(value) && value.startsWith('0'.repeat(safeDifficulty));
}

export async function solvePowChallenge(challenge, difficulty, options = {}) {
  const safeChallenge = String(challenge || '').trim();
  const safeDifficulty = Math.max(1, Math.floor(Number(difficulty) || 0));
  const maxAttempts = Math.max(1_000, Number(options.maxAttempts) || 200_000);
  if (!safeChallenge) throw new Error('missing_challenge');

  const prefix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const nonce = normalizeNonce(`${prefix}-${attempt.toString(36)}`);
    const hex = await sha256Hex(`${safeChallenge}:${nonce}`);
    if (hasLeadingHexZeros(hex, safeDifficulty)) {
      return { nonce, hash: hex, attempts: attempt + 1 };
    }
  }
  throw new Error('pow_not_found');
}

export async function exchangeDebugTokenForAppCheck(config, debugToken) {
  const firebase = config && config.firebase;
  const apiKey = String(firebase && firebase.apiKey || '').trim();
  const appId = String(firebase && firebase.appId || '').trim();
  const projectNumber = String(firebase && firebase.messagingSenderId || '').trim();
  const secret = String(debugToken || '').trim();
  if (!apiKey || !appId || !projectNumber || !secret) throw new Error('missing_debug_exchange_config');

  const appResource = `projects/${projectNumber}/apps/${appId}`;
  const url = new URL(`${APP_CHECK_API_ROOT}/${encodeURIComponent(appResource).replace(/%2F/g, '/')}:exchangeDebugToken`);
  url.searchParams.set('key', apiKey);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ debugToken: secret, limitedUse: false })
  });
  if (!res.ok) {
    throw new Error(`debug_exchange_failed:${res.status}`);
  }
  const json = await res.json().catch(() => ({}));
  const token = String((json && json.token) || '').trim();
  const ttlMillis = Number(json && json.ttlMillis);
  return {
    token,
    expireTimeMillis: Date.now() + (Number.isFinite(ttlMillis) && ttlMillis > 0 ? ttlMillis : 30 * 60 * 1000)
  };
}

export async function fetchCustomAppCheckToken(config) {
  const firebase = config && config.firebase;
  const appId = String(firebase && firebase.appId || '').trim();
  if (!appId) throw new Error('missing_app_id');

  const challengeUrl = new URL('/api/appcheck/challenge', window.location.origin);
  challengeUrl.searchParams.set('app_id', appId);
  const challengeRes = await fetch(challengeUrl.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });
  if (!challengeRes.ok) {
    throw new Error(`challenge_failed:${challengeRes.status}`);
  }
  const challengeJson = await challengeRes.json().catch(() => ({}));
  const challengeId = String((challengeJson && challengeJson.challenge_id) || '').trim();
  const challenge = String((challengeJson && challengeJson.challenge) || '').trim();
  const difficulty = Number(challengeJson && challengeJson.difficulty);
  if (!challengeId || !challenge || !Number.isFinite(difficulty)) {
    throw new Error('invalid_challenge_payload');
  }

  const solution = await solvePowChallenge(challenge, difficulty);
  const tokenRes = await fetch('/api/appcheck/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: appId,
      challenge_id: challengeId,
      nonce: solution.nonce
    })
  });
  if (!tokenRes.ok) {
    throw new Error(`custom_token_failed:${tokenRes.status}`);
  }
  const tokenJson = await tokenRes.json().catch(() => ({}));
  const token = String((tokenJson && tokenJson.token) || '').trim();
  const expireTimeMillis = Number(tokenJson && tokenJson.expireTimeMillis);
  if (!token || !Number.isFinite(expireTimeMillis) || expireTimeMillis <= 0) {
    throw new Error('invalid_custom_token_payload');
  }
  return { token, expireTimeMillis };
}
