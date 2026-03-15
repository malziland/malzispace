import crypto from 'node:crypto';
import { execFile as execFileCb, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const BASE_URL = process.env.BASE_URL || 'https://malzispace.web.app';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const PROJECT_NUMBER = process.env.FIREBASE_PROJECT_NUMBER;
const APP_ID = process.env.FIREBASE_APP_ID;

if (!FIREBASE_API_KEY || !PROJECT_ID || !PROJECT_NUMBER || !APP_ID) {
  console.error('Required env vars: FIREBASE_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_PROJECT_NUMBER, FIREBASE_APP_ID');
  process.exit(1);
}
const APP_RESOURCE = `projects/${PROJECT_NUMBER}/apps/${APP_ID}`;
const API_ROOT = 'https://firebaseappcheck.googleapis.com/v1';
const DEFAULT_COMMAND = ['node', 'tests/live/smoke_test.mjs'];
const FETCH_TIMEOUT_MS = Math.max(5_000, Number(process.env.MZ_APPCHECK_FETCH_TIMEOUT_MS || 20_000) || 20_000);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

async function getAccessToken() {
  const fromEnv = String(process.env.GCP_ACCESS_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  const { stdout } = await execFile('gcloud', ['auth', 'print-access-token']);
  const token = String(stdout || '').trim();
  assert(token, 'Missing gcloud access token');
  return token;
}

async function appCheckAdminRequest(path, options = {}) {
  const accessToken = await getAccessToken();
  const headers = Object.assign(
    {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': PROJECT_ID
    },
    options.headers || {}
  );
  const res = await fetchWithTimeout(`${API_ROOT}${path}`, Object.assign({}, options, { headers }));
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`App Check API failed ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function appCheckPublicRequest(path, options = {}) {
  const headers = Object.assign(
    {
      'Content-Type': 'application/json'
    },
    options.headers || {}
  );
  const url = new URL(`${API_ROOT}${path}`);
  url.searchParams.set('key', FIREBASE_API_KEY);
  const res = await fetchWithTimeout(url, Object.assign({}, options, { headers }));
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`App Check public API failed ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function createDebugToken() {
  const secret = crypto.randomUUID();
  const displayName = `codex-smoke-${new Date().toISOString()}`;
  const body = { displayName, token: secret };
  const json = await appCheckAdminRequest(`/${encodeURIComponent(APP_RESOURCE)}/debugTokens`.replace(/%2F/g, '/'), {
    method: 'POST',
    body: JSON.stringify(body)
  });
  assert(json && json.name, `Debug token creation returned invalid payload: ${JSON.stringify(json)}`);
  return { secret, name: json.name, displayName };
}

async function exchangeDebugToken(secret) {
  const json = await appCheckPublicRequest(`/${encodeURIComponent(APP_RESOURCE)}:exchangeDebugToken`.replace(/%2F/g, '/'), {
    method: 'POST',
    body: JSON.stringify({ debugToken: secret, limitedUse: false })
  });
  const token = String((json && json.token) || '').trim();
  assert(token, `Debug token exchange returned invalid payload: ${JSON.stringify(json)}`);
  return token;
}

async function deleteDebugToken(name) {
  if (!name) return;
  await appCheckAdminRequest(`/${encodeURIComponent(name)}`.replace(/%2F/g, '/'), {
    method: 'DELETE'
  });
}

async function main() {
  let created = null;
  try {
    created = await createDebugToken();
    const appCheckToken = await exchangeDebugToken(created.secret);
    console.log(`Temporary debug token created: ${created.displayName}`);
    const command = process.argv.slice(2);
    const [execPath, ...execArgs] = command.length ? command : DEFAULT_COMMAND;
    await new Promise((resolve, reject) => {
      const child = spawn(
        execPath,
        execArgs,
        {
          cwd: process.cwd(),
          env: Object.assign({}, process.env, {
            BASE_URL,
            APP_CHECK_TOKEN: appCheckToken,
            APP_CHECK_DEBUG_TOKEN: created.secret
          }),
          stdio: ['ignore', 'pipe', 'pipe']
        }
      );
      let settled = false;
      child.stdout.on('data', (chunk) => {
        process.stdout.write(chunk);
      });
      child.stderr.on('data', (chunk) => {
        process.stderr.write(chunk);
      });
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });
      child.on('exit', (code, signal) => {
        if (settled) return;
        settled = true;
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`Child process failed: code=${code} signal=${signal || ''}`.trim()));
      });
    });
  } finally {
    if (created && created.name) {
      try {
        await deleteDebugToken(created.name);
        console.log(`Temporary debug token deleted: ${created.name}`);
      } catch (err) {
        console.error(`Failed to delete debug token ${created.name}:`, err && err.message ? err.message : err);
      }
    }
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
