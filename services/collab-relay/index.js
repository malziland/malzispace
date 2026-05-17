'use strict';

const http = require('http');
const admin = require('firebase-admin');
const WebSocket = require('ws');

const { getTrustedClientIp } = require('./lib/clientIp');
const { consumeWindowBudget, tryAcquireConcurrent, releaseConcurrent } = require('./lib/abuseBudget');
const { sanitizeRoom } = require('./lib/room');
const { parseAllowedOrigins, isOriginAllowed } = require('./lib/origin');
const { verifyWsAuthQuery } = require('./lib/wsAuth');

admin.initializeApp();
const db = admin.firestore();

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('malzispace collab relay');
});

function envInt(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : def;
}

const MAX_PAYLOAD_BYTES = envInt('MZ_WS_MAX_PAYLOAD_BYTES', 1024 * 1024); // 1 MiB
const MAX_CLIENTS_PER_ROOM = envInt('MZ_WS_MAX_CLIENTS_PER_ROOM', 120);
const MAX_ROOMS = envInt('MZ_WS_MAX_ROOMS', 2000);
const MAX_CONN_PER_IP_PER_MIN = envInt('MZ_WS_MAX_CONN_PER_IP_PER_MIN', 120);
const MAX_CONCURRENT_CONN_PER_IP = envInt('MZ_WS_MAX_CONCURRENT_CONN_PER_IP', 24);
const MAX_MSG_PER_SOCKET_10S = envInt('MZ_WS_MAX_MSG_PER_SOCKET_10S', 400);
const MAX_BYTES_PER_SOCKET_10S = envInt('MZ_WS_MAX_BYTES_PER_SOCKET_10S', 2 * 1024 * 1024);
const MAX_BYTES_PER_ROOM_10S = envInt('MZ_WS_MAX_BYTES_PER_ROOM_10S', 8 * 1024 * 1024);
const HEARTBEAT_MS = envInt('MZ_WS_HEARTBEAT_MS', 30_000);
const REQUIRE_ORIGIN = String(process.env.MZ_WS_REQUIRE_ORIGIN || '1') !== '0';
const ALLOW_HOST_FALLBACK = String(process.env.MZ_WS_ALLOW_HOST_FALLBACK || '0') === '1';
const TRUST_PROXY_HOPS = Number.isFinite(Number(process.env.MZ_WS_TRUST_PROXY_HOPS))
  ? Math.max(0, Math.floor(Number(process.env.MZ_WS_TRUST_PROXY_HOPS)))
  : 1;
const WS_AUTH_CACHE_TTL_MS = envInt('MZ_WS_AUTH_CACHE_TTL_MS', 5_000);
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.MZ_ALLOWED_ORIGINS);

const wss = new WebSocket.Server({ server, maxPayload: MAX_PAYLOAD_BYTES });
const rooms = new Map();
const ipConnRate = new Map();
const ipOpenCounts = new Map();
const roomAuthCache = new Map();
const roomTraffic = new Map();
const roomState = new Map();

function getClientIp(req) {
  return getTrustedClientIp(req, { trustProxyHops: TRUST_PROXY_HOPS });
}

function allowConnectionFromIp(ip) {
  const now = Date.now();
  let item = ipConnRate.get(ip);
  if (!item || now >= item.resetAt) {
    item = { count: 0, resetAt: now + 60_000 };
  }
  item.count += 1;
  ipConnRate.set(ip, item);
  return item.count <= MAX_CONN_PER_IP_PER_MIN;
}

function getRoom(name){
  if (!rooms.has(name)) rooms.set(name, new Set());
  return rooms.get(name);
}

function getRoomTraffic(room) {
  if (!roomTraffic.has(room)) {
    roomTraffic.set(room, { windowStartedAt: 0, used: 0 });
  }
  return roomTraffic.get(room);
}

function getCachedRoomAuth(room, nowMs) {
  const cached = roomAuthCache.get(room);
  if (!cached) return null;
  if (cached.cacheUntil <= nowMs) {
    roomAuthCache.delete(room);
    return null;
  }
  return cached;
}

async function getRoomAuthEntry(room, nowMs) {
  const cached = getCachedRoomAuth(room, nowMs);
  if (cached) return cached;

  const snap = await db.collection('spaces').doc(room).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  const expiresAt = data.expiresAt && typeof data.expiresAt.toMillis === 'function'
    ? data.expiresAt.toMillis()
    : 0;
  const keyProof = typeof data.key_proof === 'string' ? data.key_proof : '';
  if (!keyProof || (expiresAt && expiresAt <= nowMs)) return null;
  const ownerKeyProof = typeof data.owner_key_proof === 'string' && data.owner_key_proof.length > 0
    ? data.owner_key_proof
    : null;

  const entry = {
    keyProof,
    ownerKeyProof,
    readOnly: !!data.read_only,
    cacheUntil: nowMs + WS_AUTH_CACHE_TTL_MS
  };
  roomAuthCache.set(room, entry);
  return entry;
}

function broadcastLockState(room, readOnly) {
  const set = rooms.get(room);
  if (!set) return;
  const msg = JSON.stringify({ type: 'lock_state', read_only: !!readOnly });
  for (const client of set) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(msg); } catch (e) {}
    }
  }
}

function attachRoomState(room, initial) {
  let state = roomState.get(room);
  if (state) {
    state.refCount += 1;
    return state;
  }
  // Seed the in-memory state from the auth-cache entry so the first
  // broadcast on connect carries the *current* lock value, not the
  // listener's pre-snapshot default (which used to flap clients from
  // read_only:true to read_only:false right after they connected).
  state = {
    readOnly: !!(initial && initial.readOnly),
    ownerKeyProof: (initial && initial.ownerKeyProof) || null,
    listener: null,
    refCount: 1
  };
  roomState.set(room, state);
  try {
    state.listener = db.collection('spaces').doc(room).onSnapshot(
      (snap) => {
        if (!snap.exists) return;
        const data = snap.data() || {};
        const nextReadOnly = !!data.read_only;
        const nextOwnerKeyProof = typeof data.owner_key_proof === 'string' && data.owner_key_proof.length > 0
          ? data.owner_key_proof
          : null;
        const changed = state.readOnly !== nextReadOnly;
        state.readOnly = nextReadOnly;
        state.ownerKeyProof = nextOwnerKeyProof;
        // Auth cache may hold stale owner_key_proof; invalidate so the next
        // connection re-reads it. Existing connections already authenticated.
        roomAuthCache.delete(room);
        if (changed) broadcastLockState(room, nextReadOnly);
      },
      (err) => {
        console.error('room state listener error', { room, code: err?.code, message: err?.message });
      }
    );
  } catch (e) {
    console.error('room state listener attach failed', { room, message: e?.message });
  }
  return state;
}

function detachRoomState(room) {
  const state = roomState.get(room);
  if (!state) return;
  state.refCount -= 1;
  if (state.refCount <= 0) {
    try { if (typeof state.listener === 'function') state.listener(); } catch (e) {}
    roomState.delete(room);
  }
}

wss.on('connection', async (ws, req) => {
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  if (!isOriginAllowed(origin, host, ALLOWED_ORIGINS, REQUIRE_ORIGIN, ALLOW_HOST_FALLBACK)) {
    try { ws.close(1008, 'origin_not_allowed'); } catch (e) {}
    return;
  }

  const ip = getClientIp(req);
  if (!allowConnectionFromIp(ip)) {
    try { ws.close(1013, 'rate_limited'); } catch (e) {}
    return;
  }
  if (!tryAcquireConcurrent(ipOpenCounts, ip, MAX_CONCURRENT_CONN_PER_IP)) {
    try { ws.close(1013, 'too_many_connections'); } catch (e) {}
    return;
  }
  ws.clientIp = ip;

  const url = new URL(req.url, 'http://localhost');
  const room = sanitizeRoom(url.searchParams.get('room') || 'default');
  if (!room) {
    releaseConcurrent(ipOpenCounts, ip);
    try { ws.close(1008, 'invalid_room'); } catch (e) {}
    return;
  }

  const isOwnerClaim = url.searchParams.get('is_owner') === '1';
  let authEntry = null;
  try {
    authEntry = await getRoomAuthEntry(room, Date.now());
    if (!authEntry) {
      releaseConcurrent(ipOpenCounts, ip);
      try { ws.close(1008, 'auth_invalid'); } catch (e) {}
      return;
    }
    if (isOwnerClaim) {
      if (!authEntry.ownerKeyProof || !verifyWsAuthQuery(url.searchParams, room, authEntry.ownerKeyProof, { sigParamName: 'owner_sig' })) {
        releaseConcurrent(ipOpenCounts, ip);
        try { ws.close(1008, 'auth_invalid'); } catch (e) {}
        return;
      }
      ws.isOwner = true;
    } else {
      if (!verifyWsAuthQuery(url.searchParams, room, authEntry.keyProof)) {
        releaseConcurrent(ipOpenCounts, ip);
        try { ws.close(1008, 'auth_invalid'); } catch (e) {}
        return;
      }
      ws.isOwner = false;
    }
  } catch (e) {
    console.error('ws auth validation failed', e);
    releaseConcurrent(ipOpenCounts, ip);
    try { ws.close(1011, 'auth_unavailable'); } catch (err) {}
    return;
  }

  if (rooms.size >= MAX_ROOMS && !rooms.has(room)) {
    releaseConcurrent(ipOpenCounts, ip);
    try { ws.close(1013, 'server_busy'); } catch (e) {}
    return;
  }

  const set = getRoom(room);
  if (set.size >= MAX_CLIENTS_PER_ROOM) {
    releaseConcurrent(ipOpenCounts, ip);
    try { ws.close(1013, 'room_full'); } catch (e) {}
    return;
  }
  set.add(ws);
  ws.roomName = room;
  ws.isAlive = true;
  ws.msgWindowStartedAt = Date.now();
  ws.msgWindowCount = 0;
  ws.byteBudget = { windowStartedAt: 0, used: 0 };

  const lockState = attachRoomState(room, authEntry);
  // Send current lock state to the new client so its UI is consistent without
  // waiting for the next toggle. The seed value comes from the auth cache,
  // which read read_only synchronously alongside the key material.
  try {
    ws.send(JSON.stringify({ type: 'lock_state', read_only: !!lockState.readOnly }));
  } catch (e) {}

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data) => {
    const now = Date.now();
    if ((now - ws.msgWindowStartedAt) >= 10_000) {
      ws.msgWindowStartedAt = now;
      ws.msgWindowCount = 0;
    }
    ws.msgWindowCount += 1;
    if (ws.msgWindowCount > MAX_MSG_PER_SOCKET_10S) {
      try { ws.close(1008, 'rate_limited'); } catch (e) {}
      return;
    }

    try {
      const bytes = typeof data === 'string' ? Buffer.byteLength(data) : (data ? data.length : 0);
      if (bytes > MAX_PAYLOAD_BYTES) {
        try { ws.close(1009, 'message_too_big'); } catch (e) {}
        return;
      }
      if (!consumeWindowBudget(ws.byteBudget, now, 10_000, MAX_BYTES_PER_SOCKET_10S, bytes).ok) {
        try { ws.close(1008, 'byte_rate_limited'); } catch (e) {}
        return;
      }
      if (!consumeWindowBudget(getRoomTraffic(room), now, 10_000, MAX_BYTES_PER_ROOM_10S, bytes).ok) {
        try { ws.close(1013, 'room_busy'); } catch (e) {}
        return;
      }
    } catch (e) {}

    // When the space is locked, non-owner Yjs updates are dropped silently.
    // The frontend disables the editor for readers, so this is defence in
    // depth — a misbehaving client cannot leak writes into the relay.
    if (lockState.readOnly && !ws.isOwner) return;

    for (const client of set) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  });

  ws.on('error', () => {
    // Prevent noisy unhandled errors from crashing the process.
  });

  ws.on('close', () => {
    set.delete(ws);
    releaseConcurrent(ipOpenCounts, ws.clientIp || ip);
    detachRoomState(room);
    if (set.size === 0) {
      rooms.delete(room);
      roomTraffic.delete(room);
    }
  });
});

const heartbeatTimer = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch (e) {}
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
  // Prune stale ipConnRate entries to prevent unbounded memory growth.
  const now = Date.now();
  for (const [ip, item] of ipConnRate) {
    if (now >= item.resetAt) ipConnRate.delete(ip);
  }
}, HEARTBEAT_MS);
heartbeatTimer.unref();

wss.on('close', () => {
  clearInterval(heartbeatTimer);
});

const port = process.env.PORT || 8080;
server.listen(port, () => {
  console.log(`collab relay listening on ${port}`);
});
