'use strict';

const crypto = require('crypto');
const express = require('express');
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const { RateLimiter } = require('./lib/rateLimiter');
const { getTrustedClientIp } = require('./lib/clientIp');
const { randomChallenge, normalizeNonce, verifyPow } = require('./lib/appCheckPow');
const { parseAllowedOrigins, isOriginAllowed, normalizeOrigin } = require('./lib/originPolicy');
const { estimatePayloadBudgetCost } = require('./lib/payloadBudget');

admin.initializeApp();

const db = admin.firestore();
const rtdb = admin.database();

const TTL_SECONDS = 24 * 60 * 60;
const ID_RE = /^[a-z0-9]{6,24}$/;
const ALG_RE = /^[a-z0-9][a-z0-9-]{0,40}$/i;
const B64URL_RE = /^[A-Za-z0-9\-_]+$/;
const PRESENCE_TOKEN_RE = /^[a-z0-9]{6,64}$/;
const KEY_PROOF_RE = /^[A-Za-z0-9\-_]{43,128}$/;

const ALLOWED_CONTENT_ALGOS = new Set(['aes-256-gcm']);
const ALLOWED_UPDATE_ALGOS = new Set(['aes-256-gcm']);

// Per-instance (best-effort) rate limiters. This is not a global quota, but it
// does protect against simple abuse and accidental tight loops.
const RL_PREVERIFY = new RateLimiter({ windowMs: 60_000, max: 3000 }); // 50 req/s per IP
const RL_APPCHECK_CHALLENGE = new RateLimiter({ windowMs: 60_000, max: 90 }); // 1.5 req/s per IP
const RL_APPCHECK_TOKEN = new RateLimiter({ windowMs: 60_000, max: 90 }); // 1.5 req/s per IP
const RL_CREATE = new RateLimiter({ windowMs: 60_000, max: 60 });      // 1 req/s per IP
const RL_LOAD_IP = new RateLimiter({ windowMs: 60_000, max: 900 });    // 15 req/s per IP across spaces
const RL_LOAD = new RateLimiter({ windowMs: 60_000, max: 2400 });      // 40 req/s per IP+space
const RL_SAVE_IP = new RateLimiter({ windowMs: 60_000, max: 240 });    // 4 req/s per IP across spaces
const RL_SAVE = new RateLimiter({ windowMs: 60_000, max: 1200 });      // 20 req/s per IP+space
const RL_SAVE_BYTES = new RateLimiter({ windowMs: 60_000, max: 2048 }); // 2 MiB/min per IP
const RL_TITLE_IP = new RateLimiter({ windowMs: 60_000, max: 180 });   // 3 req/s per IP across spaces
const RL_TITLE = new RateLimiter({ windowMs: 60_000, max: 600 });      // 10 req/s per IP+space
const RL_PRESENCE_IP = new RateLimiter({ windowMs: 60_000, max: 240 }); // 4 req/s per IP across spaces
const RL_PRESENCE = new RateLimiter({ windowMs: 60_000, max: 600 });   // 10 req/s per IP+space
const RL_YJS_PUSH_IP = new RateLimiter({ windowMs: 60_000, max: 480 }); // 8 req/s per IP across spaces
const RL_YJS_PUSH = new RateLimiter({ windowMs: 60_000, max: 1800 });  // 30 req/s per IP+space
const RL_YJS_PUSH_BYTES = new RateLimiter({ windowMs: 60_000, max: 4096 }); // 4 MiB/min per IP
const RL_YJS_PULL_IP = new RateLimiter({ windowMs: 60_000, max: 300 }); // 5 req/s per IP across spaces
const RL_YJS_PULL = new RateLimiter({ windowMs: 60_000, max: 600 });   // 10 req/s per IP+space
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.MZ_ALLOWED_ORIGINS);

function envInt(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : def;
}

function envIntAllowZero(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : def;
}

// RTDB size controls (best-effort). Note that all updates are encrypted (E2E),
// so pruning is coarse (by age / list length), not by CRDT semantics.
const YJS_PULL_LIMIT = envInt('MZ_YJS_PULL_LIMIT', 2000);
const YJS_FULLS_KEEP = envInt('MZ_YJS_FULLS_KEEP', 5);
const YJS_FULLS_RETURN = envInt('MZ_YJS_FULLS_RETURN', 3);
const YJS_UPDATES_TTL_SECONDS = envIntAllowZero('MZ_YJS_UPDATES_TTL_SECONDS', 2 * 60 * 60); // 0 disables pruning
const YJS_UPDATES_TTL_MS = YJS_UPDATES_TTL_SECONDS * 1000;
const YJS_PRUNE_BATCH = envInt('MZ_YJS_PRUNE_BATCH', 100);
const YJS_PRUNE_MAX_BATCHES = envInt('MZ_YJS_PRUNE_MAX_BATCHES', 10);
const TRUST_PROXY_HOPS = envIntAllowZero('MZ_TRUST_PROXY_HOPS', 1);
const DEFAULT_WEB_APP_ID = '1:457350771644:web:1bfe76d93b81e9316ab1b9';
const APP_CHECK_ALLOWED_APP_IDS = new Set(
  String(process.env.MZ_APPCHECK_ALLOWED_APP_IDS || DEFAULT_WEB_APP_ID)
    .split(',')
    .map((value) => String(value || '').trim())
    .filter(Boolean)
);
const APP_CHECK_CHALLENGE_TTL_MS = envInt('MZ_APPCHECK_CHALLENGE_TTL_MS', 2 * 60 * 1000);
const APP_CHECK_TOKEN_TTL_MS = Math.max(30 * 60 * 1000, Math.min(envInt('MZ_APPCHECK_TOKEN_TTL_MS', 30 * 60 * 1000), 7 * 24 * 60 * 60 * 1000));
const APP_CHECK_POW_DIFFICULTY = Math.max(2, Math.min(envInt('MZ_APPCHECK_POW_DIFFICULTY', 3), 6));
const APP_CHECK_CHALLENGE_COLLECTION = 'appcheckChallenges';

async function pruneRtdbListByKey(listRef, maxKeep) {
  if (!maxKeep || maxKeep <= 0) return { pruned: 0, ok: true };
  // Keep "maxKeep" newest items, delete everything older.
  const keepSnap = await listRef.orderByKey().limitToLast(maxKeep + 1).get();
  if (!keepSnap.exists()) return { pruned: 0, ok: true };
  if (keepSnap.numChildren() <= maxKeep) return { pruned: 0, ok: true };

  let cutoffKey = null;
  keepSnap.forEach((child) => {
    if (!cutoffKey) cutoffKey = child.key;
  });
  if (!cutoffKey) return { pruned: 0, ok: true };

  let pruned = 0;
  for (let i = 0; i < YJS_PRUNE_MAX_BATCHES; i++) {
    const oldSnap = await listRef.orderByKey().endAt(cutoffKey).limitToFirst(YJS_PRUNE_BATCH).get();
    if (!oldSnap.exists()) break;
    const updates = {};
    oldSnap.forEach((child) => {
      updates[child.key] = null;
    });
    const n = Object.keys(updates).length;
    if (n === 0) break;
    await listRef.update(updates);
    pruned += n;
    if (n < YJS_PRUNE_BATCH) break;
  }

  return { pruned, ok: true };
}

async function pruneYjsUpdatesByAge(uRef, nowMs) {
  if (!YJS_UPDATES_TTL_MS) return { pruned: 0, ok: true };
  const cutoffTs = nowMs - YJS_UPDATES_TTL_MS;
  let pruned = 0;

  for (let i = 0; i < YJS_PRUNE_MAX_BATCHES; i++) {
    const oldSnap = await uRef
      .orderByChild('ts')
      .endAt(cutoffTs)
      .limitToFirst(YJS_PRUNE_BATCH)
      .get();
    if (!oldSnap.exists()) break;
    const updates = {};
    oldSnap.forEach((child) => {
      updates[child.key] = null;
    });
    const n = Object.keys(updates).length;
    if (n === 0) break;
    await uRef.update(updates);
    pruned += n;
    if (n < YJS_PRUNE_BATCH) break;
  }

  return { pruned, ok: true };
}

function sendJson(res, code, payload) {
  res.status(code).json(payload);
}

function getClientIp(req) {
  return getTrustedClientIp(req, { trustProxyHops: TRUST_PROXY_HOPS });
}

function rateLimit(res, limiter, key, cost = 1) {
  try {
    const r = limiter.consume(key, cost);
    if (r.ok) return true;
    const retryAfterSec = Math.max(1, Math.ceil(r.retryAfterMs / 1000));
    res.set('Retry-After', String(retryAfterSec));
    sendJson(res, 429, { error: 'rate_limited', retry_after: retryAfterSec });
    return false;
  } catch (e) {
    // If limiter fails, do not take down the API.
    return true;
  }
}

function rateLimitMany(res, checks) {
  for (const check of checks || []) {
    if (!check || !check.limiter || !check.key) continue;
    if (!rateLimit(res, check.limiter, check.key, check.cost)) return false;
  }
  return true;
}

function generateId(length = 8) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return out;
}

function isExpiredData(data, nowMs) {
  if (!data || !data.expiresAt || !data.expiresAt.toMillis) return false;
  return data.expiresAt.toMillis() <= nowMs;
}

function safeEqualToken(a, b) {
  try {
    const av = Buffer.from(String(a || ''), 'utf8');
    const bv = Buffer.from(String(b || ''), 'utf8');
    if (av.length === 0 || bv.length === 0) return false;
    if (av.length !== bv.length) return false;
    return crypto.timingSafeEqual(av, bv);
  } catch (e) {
    return false;
  }
}

function hasStoredKeyProof(data) {
  return !!(data && typeof data.key_proof === 'string' && data.key_proof.length > 0);
}

function isWriteAuthorized(data, providedKeyProof) {
  if (!hasStoredKeyProof(data)) return false;
  if (!KEY_PROOF_RE.test(String(providedKeyProof || ''))) return false;
  return safeEqualToken(data.key_proof, String(providedKeyProof || ''));
}

async function loadSpaceDoc(id) {
  const snap = await db.collection('spaces').doc(id).get();
  if (!snap.exists) return null;
  return snap;
}

function isAllowedAppCheckAppId(appId) {
  const value = String(appId || '').trim();
  return value.length > 0 && APP_CHECK_ALLOWED_APP_IDS.has(value);
}

function getAppCheckChallengeRef(id) {
  return db.collection(APP_CHECK_CHALLENGE_COLLECTION).doc(id);
}

async function consumeAppCheckChallenge(id) {
  const ref = getAppCheckChallengeRef(id);
  let data = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      const err = new Error('challenge_not_found');
      err.code = 'challenge_not_found';
      throw err;
    }
    data = snap.data() || {};
    tx.delete(ref);
  });
  return data;
}

const app = express();
const router = express.Router();
app.use(express.json({ limit: '512kb' }));
app.disable('x-powered-by');
app.set('trust proxy', false);

app.use((req, res, next) => {
  const rawOrigin = req.header('Origin');
  const normalizedOrigin = normalizeOrigin(rawOrigin || '');

  // CORS is limited to known frontend origins. Requests without Origin are
  // still allowed to support same-origin and server-to-server calls.
  if (rawOrigin) {
    if (!normalizedOrigin || !isOriginAllowed(rawOrigin, ALLOWED_ORIGINS)) {
      return sendJson(res, 403, { error: 'origin_not_allowed' });
    }
    res.set('Access-Control-Allow-Origin', normalizedOrigin);
  }

  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-Firebase-AppCheck');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Cheap pre-verify limiter to reduce App Check verification load.
router.use((req, res, next) => {
  const ip = getClientIp(req);
  if (!rateLimit(res, RL_PREVERIFY, `pre:${ip}`)) return;
  next();
});

async function verifyAppCheck(req, res, next) {
  const token = req.header('X-Firebase-AppCheck');
  if (!token) return sendJson(res, 401, { error: 'app_check_required' });
  try {
    await admin.appCheck().verifyToken(token);
    return next();
  } catch (err) {
    console.error('app check failed', err);
    return sendJson(res, 401, { error: 'app_check_invalid' });
  }
}

router.get('/appcheck/challenge', async (req, res) => {
  try {
    const ip = getClientIp(req);
    if (!rateLimit(res, RL_APPCHECK_CHALLENGE, `appcheck_challenge:${ip}`)) return;

    const appId = String(req.query.app_id || '').trim();
    if (!isAllowedAppCheckAppId(appId)) return sendJson(res, 400, { error: 'invalid_app_id' });

    const challengeId = randomChallenge(18);
    const challenge = randomChallenge(24);
    const expiresAtMs = Date.now() + APP_CHECK_CHALLENGE_TTL_MS;

    await getAppCheckChallengeRef(challengeId).set({
      appId,
      challenge,
      difficulty: APP_CHECK_POW_DIFFICULTY,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromMillis(expiresAtMs)
    });

    return sendJson(res, 200, {
      challenge_id: challengeId,
      challenge,
      difficulty: APP_CHECK_POW_DIFFICULTY,
      expires_at_ms: expiresAtMs
    });
  } catch (err) {
    console.error('appcheck challenge error', err);
    return sendJson(res, 500, { error: 'server_error' });
  }
});

router.post('/appcheck/token', async (req, res) => {
  try {
    const ip = getClientIp(req);
    if (!rateLimit(res, RL_APPCHECK_TOKEN, `appcheck_token:${ip}`)) return;

    const appId = String(req.body && req.body.app_id || '').trim();
    const challengeId = String(req.body && req.body.challenge_id || '').trim();
    const nonce = normalizeNonce(req.body && req.body.nonce);
    if (!isAllowedAppCheckAppId(appId)) return sendJson(res, 400, { error: 'invalid_app_id' });
    if (!B64URL_RE.test(challengeId)) return sendJson(res, 400, { error: 'invalid_challenge_id' });
    if (!nonce) return sendJson(res, 400, { error: 'invalid_nonce' });

    let challengeData = null;
    try {
      challengeData = await consumeAppCheckChallenge(challengeId);
    } catch (err) {
      if (err && err.code === 'challenge_not_found') {
        return sendJson(res, 400, { error: 'challenge_not_found' });
      }
      throw err;
    }

    const expiresAtMs = challengeData && challengeData.expiresAt && challengeData.expiresAt.toMillis
      ? challengeData.expiresAt.toMillis()
      : 0;
    if (!challengeData || !challengeData.challenge || !challengeData.appId) {
      return sendJson(res, 400, { error: 'invalid_challenge' });
    }
    if (expiresAtMs <= Date.now()) return sendJson(res, 410, { error: 'challenge_expired' });
    if (!safeEqualToken(challengeData.appId, appId)) return sendJson(res, 400, { error: 'invalid_app_id' });
    if (!verifyPow(challengeData.challenge, nonce, challengeData.difficulty || APP_CHECK_POW_DIFFICULTY)) {
      return sendJson(res, 400, { error: 'invalid_pow' });
    }

    const issued = await admin.appCheck().createToken(appId, { ttlMillis: APP_CHECK_TOKEN_TTL_MS });
    return sendJson(res, 200, {
      token: issued.token,
      expireTimeMillis: Date.now() + issued.ttlMillis
    });
  } catch (err) {
    console.error('appcheck token error', err);
    return sendJson(res, 500, { error: 'server_error' });
  }
});

router.use(verifyAppCheck);

router.post('/create', async (req, res) => {
  try {
    const ip = getClientIp(req);
    if (!rateLimit(res, RL_CREATE, `create:${ip}`)) return;

    const body = req.body || {};
    if (body.website) return sendJson(res, 400, { error: 'invalid_request' }); // honeypot
    const titleEnc = String(body.title_enc || '');
    const titleNonce = String(body.title_nonce || '');
    const titleAlgo = String(body.title_algo || '');
    const titlePlain = String(body.title || '').trim().slice(0, 80);
    if (titleEnc) {
      if (titleEnc.length > 10_000) return sendJson(res, 413, { error: 'payload_too_large' });
      if (!B64URL_RE.test(titleEnc) || !B64URL_RE.test(titleNonce))
        return sendJson(res, 400, { error: 'invalid_payload_encoding' });
      if (!ALG_RE.test(titleAlgo) || !ALLOWED_CONTENT_ALGOS.has(titleAlgo))
        return sendJson(res, 400, { error: 'invalid_title_algo' });
    }
    const keyProof = String(body.key_proof || '').trim();
    if (!KEY_PROOF_RE.test(keyProof)) return sendJson(res, 400, { error: 'invalid_key_proof' });
    const now = Date.now();
    const expiresAt = admin.firestore.Timestamp.fromDate(new Date(now + TTL_SECONDS * 1000));

    for (let i = 0; i < 5; i++) {
      const id = generateId(8);
      const ref = db.collection('spaces').doc(id);
      try {
        await ref.create({
          id,
          title: titleEnc ? '' : titlePlain,
          title_enc: titleEnc || null,
          title_nonce: titleNonce || null,
          title_algo: titleAlgo || null,
          version: 0,
          zk: true,
          content_enc: null,
          content_nonce: null,
          content_algo: null,
          key_proof: keyProof,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          expiresAt
        });
        return sendJson(res, 200, { ok: true, id });
      } catch (err) {
        if (err && err.code === 6) continue; // ALREADY_EXISTS
        throw err;
      }
    }
    return sendJson(res, 500, { error: 'collision' });
  } catch (err) {
    console.error('create error', err);
    return sendJson(res, 500, { error: 'server_error' });
  }
});

router.get('/load', async (req, res) => {
  try {
    const id = String(req.query.id || '').trim();
    if (!ID_RE.test(id)) return sendJson(res, 400, { error: 'invalid_or_missing_id' });
    const ip = getClientIp(req);
    if (!rateLimitMany(res, [
      { limiter: RL_LOAD_IP, key: `load_ip:${ip}` },
      { limiter: RL_LOAD, key: `load:${ip}:${id}` }
    ])) return;

    const snap = await loadSpaceDoc(id);
    if (!snap) return sendJson(res, 404, { error: 'not_found' });

    const data = snap.data() || {};
    if (isExpiredData(data, Date.now())) return sendJson(res, 410, { error: 'expired' });
    if (!data.zk) return sendJson(res, 403, { error: 'e2e_required' });
    const createdAt = data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : Date.now();
    const updatedAt = data.updatedAt && data.updatedAt.toMillis ? data.updatedAt.toMillis() : createdAt;
    const expiresAt = data.expiresAt && data.expiresAt.toMillis
      ? data.expiresAt.toMillis()
      : (createdAt + TTL_SECONDS * 1000);
    const serverNow = Date.now();

    const out = {
      id,
      title: data.title || '',
      title_enc: data.title_enc || null,
      title_nonce: data.title_nonce || null,
      title_algo: data.title_algo || null,
      version: Number.isFinite(data.version) ? data.version : 0,
      created_at: Math.floor(createdAt / 1000),
      updated_at: Math.floor(updatedAt / 1000),
      expires_at: Math.floor(expiresAt / 1000),
      ttl_seconds: TTL_SECONDS,
      server_now: Math.floor(serverNow / 1000)
    };

    out.zk = true;
    out.content_enc = data.content_enc || null;
    out.content_nonce = data.content_nonce || null;
    out.content_algo = data.content_algo || null;
    if (data.content_tag) out.content_tag = data.content_tag;

    return sendJson(res, 200, out);
  } catch (err) {
    console.error('load error', err);
    return sendJson(res, 500, { error: 'server_error' });
  }
});

router.post('/save', async (req, res) => {
  try {
    const body = req.body || {};
    const id = String(body.id || '').trim();
    if (!ID_RE.test(id)) return sendJson(res, 400, { error: 'invalid_id' });
    const ip = getClientIp(req);

    const titleEnc = String(body.title_enc || '');
    const titleNonce = String(body.title_nonce || '');
    const titleAlgo = String(body.title_algo || '');
    const titlePlain = String(body.title || '').trim().slice(0, 80);
    if (titleEnc) {
      if (titleEnc.length > 10_000) return sendJson(res, 413, { error: 'payload_too_large' });
      if (!B64URL_RE.test(titleEnc) || !B64URL_RE.test(titleNonce))
        return sendJson(res, 400, { error: 'invalid_payload_encoding' });
      if (!ALG_RE.test(titleAlgo) || !ALLOWED_CONTENT_ALGOS.has(titleAlgo))
        return sendJson(res, 400, { error: 'invalid_title_algo' });
    }
    const clientVersion = Number.isFinite(body.version) ? Number(body.version) : 0;
    const keyProof = String(body.key_proof || '').trim();

    const isZkReq = !!body.zk;
    const encCipher = String(body.content_enc || '');
    const encNonce = String(body.content_nonce || '');
    const encAlgo = String(body.content_algo || '');
    const encTag = body.content_tag ? String(body.content_tag) : null;
    if (!isZkReq || !encCipher || !encNonce || !encAlgo) {
      return sendJson(res, 400, { error: 'e2e_required' });
    }
    if (!ALG_RE.test(encAlgo) || !ALLOWED_CONTENT_ALGOS.has(encAlgo)) {
      return sendJson(res, 400, { error: 'invalid_content_algo' });
    }
    if (encCipher.length > 450_000 || encNonce.length > 64) {
      return sendJson(res, 413, { error: 'payload_too_large' });
    }
    if (!B64URL_RE.test(encCipher) || !B64URL_RE.test(encNonce)) {
      return sendJson(res, 400, { error: 'invalid_payload_encoding' });
    }
    if (encTag) {
      // Tag is optional, but bound it to avoid storing unbounded junk.
      if (encTag.length > 128) return sendJson(res, 413, { error: 'payload_too_large' });
      if (!B64URL_RE.test(encTag)) return sendJson(res, 400, { error: 'invalid_payload_encoding' });
    }
    const payloadCost = estimatePayloadBudgetCost([titlePlain, titleEnc, titleNonce, titleAlgo, encCipher, encNonce, encAlgo, encTag]);
    if (!rateLimitMany(res, [
      { limiter: RL_SAVE_IP, key: `save_ip:${ip}` },
      { limiter: RL_SAVE, key: `save:${ip}:${id}` },
      { limiter: RL_SAVE_BYTES, key: `save_bytes:${ip}`, cost: payloadCost }
    ])) return;

    const result = await db.runTransaction(async (tx) => {
      const ref = db.collection('spaces').doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) return { error: 'not_found' };

      const data = snap.data() || {};
      if (isExpiredData(data, Date.now())) return { error: 'expired' };
      if (!data.zk) return { error: 'e2e_required' };
      if (!isWriteAuthorized(data, keyProof)) return { error: 'forbidden_no_key' };
      const serverVersion = Number.isFinite(data.version) ? data.version : 0;
      const newVersion = serverVersion + 1;

      const update = {
        title: titleEnc ? '' : titlePlain,
        title_enc: titleEnc || null,
        title_nonce: titleNonce || null,
        title_algo: titleAlgo || null,
        version: newVersion,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      update.zk = true;
      update.content_enc = encCipher;
      update.content_nonce = encNonce;
      update.content_algo = encAlgo;
      update.content_tag = encTag;
      update.content = admin.firestore.FieldValue.delete();

      tx.update(ref, update);

      return {
        ok: true,
        version: newVersion,
        conflict: clientVersion !== serverVersion
      };
    });

    if (result && result.error === 'not_found') return sendJson(res, 404, { error: 'not_found' });
    if (result && result.error === 'expired') return sendJson(res, 410, { error: 'expired' });
    if (result && result.error === 'e2e_required') return sendJson(res, 403, { error: 'e2e_required' });
    if (result && result.error === 'forbidden_no_key') return sendJson(res, 403, { error: 'forbidden_no_key' });
    return sendJson(res, 200, result);
  } catch (err) {
    console.error('save error', err);
    return sendJson(res, 500, { error: 'server_error' });
  }
});

router.post('/title', async (req, res) => {
  try {
    const body = req.body || {};
    const id = String(body.id || '').trim();
    if (!ID_RE.test(id)) return sendJson(res, 400, { error: 'invalid_id' });
    const ip = getClientIp(req);
    if (!rateLimitMany(res, [
      { limiter: RL_TITLE_IP, key: `title_ip:${ip}` },
      { limiter: RL_TITLE, key: `title:${ip}:${id}` }
    ])) return;

    const titleEnc = String(body.title_enc || '');
    const titleNonce = String(body.title_nonce || '');
    const titleAlgo = String(body.title_algo || '');
    const titlePlain = String(body.title || '').trim().slice(0, 80);
    if (titleEnc) {
      if (titleEnc.length > 10_000) return sendJson(res, 413, { error: 'payload_too_large' });
      if (!B64URL_RE.test(titleEnc) || !B64URL_RE.test(titleNonce))
        return sendJson(res, 400, { error: 'invalid_payload_encoding' });
      if (!ALG_RE.test(titleAlgo) || !ALLOWED_CONTENT_ALGOS.has(titleAlgo))
        return sendJson(res, 400, { error: 'invalid_title_algo' });
    }
    const keyProof = String(body.key_proof || '').trim();
    const ref = db.collection('spaces').doc(id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error('not_found'), { code: 'not_found' });
      const data = snap.data() || {};
      if (isExpiredData(data, Date.now())) throw Object.assign(new Error('expired'), { code: 'expired' });
      if (!isWriteAuthorized(data, keyProof)) throw Object.assign(new Error('forbidden_no_key'), { code: 'forbidden_no_key' });
      const serverVersion = Number.isFinite(data.version) ? data.version : 0;
      tx.update(ref, {
        title: titleEnc ? '' : titlePlain,
        title_enc: titleEnc || null,
        title_nonce: titleNonce || null,
        title_algo: titleAlgo || null,
        version: serverVersion + 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    if (err && err.code === 'not_found') return sendJson(res, 404, { error: 'not_found' });
    if (err && err.code === 'expired') return sendJson(res, 410, { error: 'expired' });
    if (err && err.code === 'forbidden_no_key') return sendJson(res, 403, { error: 'forbidden_no_key' });
    console.error('title error', err);
    return sendJson(res, 500, { error: 'server_error' });
  }
});

router.post('/yjs/push', async (req, res) => {
  try {
    const body = req.body || {};
    const id = String(body.id || '').trim();
    if (!ID_RE.test(id)) return sendJson(res, 400, { error: 'invalid_id' });
    const ip = getClientIp(req);
    const keyProof = String(body.key_proof || '').trim();

    const snap = await loadSpaceDoc(id);
    if (!snap) return sendJson(res, 404, { error: 'not_found' });
    const spaceData = snap.data() || {};
    if (isExpiredData(spaceData, Date.now())) return sendJson(res, 410, { error: 'expired' });
    if (!isWriteAuthorized(spaceData, keyProof)) return sendJson(res, 403, { error: 'forbidden_no_key' });
    const updateEnc = String(body.update_enc || '');
    const updateNonce = String(body.update_nonce || '');
    const updateAlgo = String(body.update_algo || '');
    const isFull = !!body.full;
    if (!updateEnc || !updateNonce || !updateAlgo) {
      return sendJson(res, 400, { error: 'invalid_update' });
    }
    if (!ALG_RE.test(updateAlgo) || !ALLOWED_UPDATE_ALGOS.has(updateAlgo)) {
      return sendJson(res, 400, { error: 'invalid_update_algo' });
    }
    if (updateEnc.length > 450_000 || updateNonce.length > 64) {
      return sendJson(res, 413, { error: 'payload_too_large' });
    }
    if (!B64URL_RE.test(updateEnc) || !B64URL_RE.test(updateNonce)) {
      return sendJson(res, 400, { error: 'invalid_payload_encoding' });
    }
    const payloadCost = estimatePayloadBudgetCost([updateEnc, updateNonce, updateAlgo]);
    if (!rateLimitMany(res, [
      { limiter: RL_YJS_PUSH_IP, key: `yjs_push_ip:${ip}` },
      { limiter: RL_YJS_PUSH, key: `yjs_push:${ip}:${id}` },
      { limiter: RL_YJS_PUSH_BYTES, key: `yjs_push_bytes:${ip}`, cost: payloadCost }
    ])) return;

    const ts = Date.now();
    const baseRef = rtdb.ref(`yjs/${id}`);
    const payload = {
      ts,
      update_enc: updateEnc,
      update_nonce: updateNonce,
      update_algo: updateAlgo
    };
    if (isFull) {
      await baseRef.child('full').set(payload);
      // Best-effort: keep a small history of full snapshots to reduce the risk
      // of a stale writer overwriting the only snapshot.
      try {
        await baseRef.child('fulls').push(payload);
        await pruneRtdbListByKey(baseRef.child('fulls'), YJS_FULLS_KEEP);
        await pruneYjsUpdatesByAge(baseRef.child('u'), ts);
      } catch (e) {}
    } else {
      await baseRef.child('u').push(payload);
      // Prune rarely on incremental pushes to limit background growth even when
      // full snapshots are not being written for some reason.
      if (Math.random() < 0.02) {
        try { await pruneYjsUpdatesByAge(baseRef.child('u'), ts); } catch (e) {}
      }
    }
    return sendJson(res, 200, { ok: true, ts });
  } catch (err) {
    console.error('yjs push error', err);
    return sendJson(res, 500, { error: 'server_error' });
  }
});

router.get('/yjs/pull', async (req, res) => {
  try {
    const id = String(req.query.id || '').trim();
    if (!ID_RE.test(id)) return sendJson(res, 400, { error: 'invalid_id' });
    const ip = getClientIp(req);
    if (!rateLimitMany(res, [
      { limiter: RL_YJS_PULL_IP, key: `yjs_pull_ip:${ip}` },
      { limiter: RL_YJS_PULL, key: `yjs_pull:${ip}:${id}` }
    ])) return;

    const snap = await loadSpaceDoc(id);
    if (!snap) return sendJson(res, 404, { error: 'not_found' });
    if (isExpiredData(snap.data() || {}, Date.now())) return sendJson(res, 410, { error: 'expired' });
    const since = Number(req.query.since || 0);
    const baseRef = rtdb.ref(`yjs/${id}`);
    const fullSnap = await baseRef.child('full').get();
    const fullSingle = fullSnap.exists() ? fullSnap.val() : null;

    const fulls = [];
    const fullsSnap = await baseRef.child('fulls').limitToLast(YJS_FULLS_RETURN).get();
    if (fullsSnap.exists()) {
      fullsSnap.forEach((child) => {
        const v = child.val();
        if (v && v.update_enc && v.update_nonce && v.update_algo) {
          fulls.push({
            ts: v.ts || 0,
            update_enc: v.update_enc,
            update_nonce: v.update_nonce,
            update_algo: v.update_algo
          });
        }
      });
    }

    const full = fulls.length ? fulls[fulls.length - 1] : fullSingle;
    const updatesSnap = await baseRef
      .child('u')
      .limitToLast(YJS_PULL_LIMIT)
      .get();
    const updates = [];
    if (updatesSnap.exists()) {
      updatesSnap.forEach((child) => {
        const v = child.val();
        if (v && v.update_enc && v.update_nonce && v.update_algo) {
          if (Number.isFinite(since) && v.ts && v.ts <= since) return;
          updates.push({
            ts: v.ts || 0,
            update_enc: v.update_enc,
            update_nonce: v.update_nonce,
            update_algo: v.update_algo
          });
        }
      });
    }
    return sendJson(res, 200, { full, fulls, updates });
  } catch (err) {
    console.error('yjs pull error', err);
    return sendJson(res, 500, { error: 'server_error' });
  }
});

router.post('/presence', async (req, res) => {
  try {
    const body = req.body || {};
    const id = String(body.id || '').trim();
    if (!ID_RE.test(id)) return sendJson(res, 400, { error: 'invalid_id' });
    const ip = getClientIp(req);
    if (!rateLimitMany(res, [
      { limiter: RL_PRESENCE_IP, key: `presence_ip:${ip}` },
      { limiter: RL_PRESENCE, key: `presence:${ip}:${id}` }
    ])) return;
    const keyProof = String(body.key_proof || '').trim();

    const snap = await loadSpaceDoc(id);
    if (!snap) return sendJson(res, 404, { error: 'not_found' });
    const spaceData = snap.data() || {};
    if (isExpiredData(spaceData, Date.now())) return sendJson(res, 410, { error: 'expired' });
    if (!isWriteAuthorized(spaceData, keyProof)) return sendJson(res, 403, { error: 'forbidden_no_key' });

    let token = String(body.token || '').trim();
    if (!PRESENCE_TOKEN_RE.test(token)) token = crypto.randomBytes(12).toString('hex');

    const ref = rtdb.ref(`presence/${id}`);
    await ref.child(token).set(admin.database.ServerValue.TIMESTAMP);

    const snapPresence = await ref.get();
    const now = Date.now();
    let count = 0;
    const updates = {};
    if (snapPresence.exists()) {
      snapPresence.forEach((child) => {
        const ts = child.val();
        if (typeof ts === 'number' && (now - ts) <= 30000) {
          count++;
        } else {
          updates[child.key] = null;
        }
      });
    }

    if (Object.keys(updates).length > 0) await ref.update(updates);

    return sendJson(res, 200, { ok: true, count });
  } catch (err) {
    console.error('presence error', err);
    return sendJson(res, 500, { error: 'server_error' });
  }
});

app.use('/api', router);
app.use('/', router);

// Always return JSON (helps clients that assume JSON responses).
app.use((req, res) => {
  sendJson(res, 404, { error: 'not_found' });
});

// Express error handler (invalid JSON, body too large, etc.)
app.use((err, req, res, next) => {
  try {
    if (res.headersSent) return next(err);
    if (err && err.type === 'entity.too.large') {
      return sendJson(res, 413, { error: 'payload_too_large' });
    }
    if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
      return sendJson(res, 400, { error: 'invalid_json' });
    }
  } catch (e) {}
  console.error('unhandled error', err);
  return sendJson(res, 500, { error: 'server_error' });
});

exports.api = onRequest({
  region: 'europe-west3',
  cors: false,
  invoker: 'public'
}, app);

const CLEANUP_BATCH = 200;

async function deleteRtdbPaths(ids) {
  if (!ids.length) return;
  const updates = {};
  for (const id of ids) {
    updates[`yjs/${id}`] = null;
    updates[`presence/${id}`] = null;
  }
  await rtdb.ref().update(updates);
}

async function deleteExpiredChallengeDocs(now) {
  let total = 0;
  while (true) {
    const snap = await db
      .collection(APP_CHECK_CHALLENGE_COLLECTION)
      .where('expiresAt', '<=', now)
      .orderBy('expiresAt')
      .limit(CLEANUP_BATCH)
      .get();

    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    total += snap.size;
  }
  return total;
}

exports.cleanupExpired = onSchedule({
  region: 'europe-west3',
  schedule: 'every 60 minutes',
  timeZone: 'UTC'
}, async () => {
  const now = admin.firestore.Timestamp.now();
  let total = 0;

  while (true) {
    const snap = await db
      .collection('spaces')
      .where('expiresAt', '<=', now)
      .orderBy('expiresAt')
      .limit(CLEANUP_BATCH)
      .get();

    if (snap.empty) break;

    const batch = db.batch();
    const ids = [];
    snap.docs.forEach((doc) => {
      ids.push(doc.id);
      batch.delete(doc.ref);
    });

    await batch.commit();
    await deleteRtdbPaths(ids);
    total += ids.length;
  }

  const deletedChallenges = await deleteExpiredChallengeDocs(now);

  console.log('cleanupExpired done', { deleted: total, deletedChallenges });
});
