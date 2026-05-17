/**
 * Boot the local stack used by emulator-backed E2E tests:
 *   - Firebase emulator (firestore + database + functions + hosting)
 *   - Collab-relay (separate Node process pointed at the emulators)
 *
 * The functions emulator runs the API service. App Check is bypassed via
 * MZ_DISABLE_APPCHECK=1. Both API and relay accept the localhost origin.
 *
 * Exports startDevStack() returning a handle with .stop() and ports.
 */
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import net from 'node:net';

const HOSTING_PORT = 4173;
const FUNCTIONS_PORT = 5001;
const FIRESTORE_PORT = 8080;
const DATABASE_PORT = 9000;
const RELAY_PORT = 9100;
const PROJECT_ID = 'malzispace';
const ALLOWED_ORIGIN = `http://127.0.0.1:${HOSTING_PORT}`;

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function tcpReady(port, host = '127.0.0.1', timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise((resolve) => {
      const sock = net.createConnection({ port, host });
      sock.once('connect', () => { sock.end(); resolve(true); });
      sock.once('error', () => resolve(false));
    });
    if (open) return true;
    await wait(250);
  }
  return false;
}

async function httpReady(url, timeoutMs = 60_000, isReady = (res) => res.status >= 200 && res.status < 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (isReady(res)) return true;
    } catch (e) {}
    await wait(300);
  }
  return false;
}

async function ensurePortsFree(ports) {
  for (const port of ports) {
    if (!(await isPortFree(port))) {
      throw new Error(`Port ${port} is already in use. Stop the existing process and retry.`);
    }
  }
}

export async function startDevStack({ silent = true } = {}) {
  await ensurePortsFree([HOSTING_PORT, FUNCTIONS_PORT, FIRESTORE_PORT, DATABASE_PORT, RELAY_PORT]);

  const processes = [];
  const stop = async () => {
    for (const child of processes.slice().reverse()) {
      try {
        if (child.pid && !child.killed) child.kill('SIGTERM');
      } catch (e) {}
    }
    await wait(500);
    for (const child of processes) {
      try {
        if (child.pid && !child.killed) child.kill('SIGKILL');
      } catch (e) {}
    }
  };

  try {
    const env = Object.assign({}, process.env, {
      MZ_DISABLE_APPCHECK: '1',
      MZ_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
      MZ_TRUST_PROXY_HOPS: '0',
      MZ_WS_TRUST_PROXY_HOPS: '0',
      MZ_WS_REQUIRE_ORIGIN: '1',
      GCLOUD_PROJECT: PROJECT_ID,
      GOOGLE_CLOUD_PROJECT: PROJECT_ID,
      FIREBASE_PROJECT: PROJECT_ID
    });

    const emulator = spawn(
      'firebase',
      [
        'emulators:start',
        '--only', 'functions,firestore,database,hosting',
        '--project', PROJECT_ID
      ],
      {
        env,
        stdio: silent ? ['ignore', 'pipe', 'pipe'] : 'inherit'
      }
    );
    processes.push(emulator);
    if (silent) {
      emulator.stdout?.on('data', () => {});
      emulator.stderr?.on('data', () => {});
    }
    emulator.on('exit', (code, signal) => {
      if (code && code !== 0 && code !== 130) {
        console.error(`firebase emulators exited with code=${code} signal=${signal}`);
      }
    });

    const firestoreOk = await tcpReady(FIRESTORE_PORT);
    const databaseOk = await tcpReady(DATABASE_PORT);
    const hostingOk = await httpReady(`http://127.0.0.1:${HOSTING_PORT}/`);
    if (!firestoreOk || !databaseOk || !hostingOk) {
      throw new Error(`Firebase emulator not ready (firestore=${firestoreOk}, db=${databaseOk}, host=${hostingOk})`);
    }
    // Functions emulator: port opens long before the function is loaded. The
    // hosting proxy returns 404 in the meantime. We poll an existing route on
    // the function until it answers with the route's own status (here 400
    // invalid_app_id) instead of a 404 from the proxy.
    const functionsOk = await httpReady(
      `http://127.0.0.1:${HOSTING_PORT}/api/appcheck/challenge`,
      90_000,
      (res) => res.status === 400
    );
    if (!functionsOk) throw new Error('Functions emulator not serving /api/* yet');

    const relayEnv = Object.assign({}, env, {
      PORT: String(RELAY_PORT),
      FIRESTORE_EMULATOR_HOST: `127.0.0.1:${FIRESTORE_PORT}`,
      FIREBASE_DATABASE_EMULATOR_HOST: `127.0.0.1:${DATABASE_PORT}`
    });
    const relay = spawn(
      process.execPath,
      ['services/collab-relay/index.js'],
      {
        env: relayEnv,
        stdio: silent ? ['ignore', 'pipe', 'pipe'] : 'inherit'
      }
    );
    processes.push(relay);
    if (silent) {
      relay.stdout?.on('data', () => {});
      relay.stderr?.on('data', () => {});
    }
    relay.on('exit', (code, signal) => {
      if (code && code !== 0 && code !== 130 && code !== 143) {
        console.error(`relay exited code=${code} signal=${signal}`);
      }
    });

    const relayOk = await tcpReady(RELAY_PORT);
    if (!relayOk) throw new Error('Collab relay not ready on port ' + RELAY_PORT);

    return {
      baseUrl: `http://127.0.0.1:${HOSTING_PORT}`,
      relayUrl: `ws://127.0.0.1:${RELAY_PORT}`,
      stop
    };
  } catch (err) {
    await stop();
    throw err;
  }
}
