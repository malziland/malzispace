import test from 'node:test';
import assert from 'node:assert/strict';

import { solvePowChallenge } from '../../apps/web/public/assets/appcheck-pow.mjs';

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(String(input || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

test('solvePowChallenge finds a nonce for a small difficulty', async () => {
  const challenge = 'unit-test-challenge';
  const result = await solvePowChallenge(challenge, 2, { maxAttempts: 50000 });
  assert.match(result.nonce, /^[A-Za-z0-9_-]+$/);
  assert.ok(result.attempts > 0);
  const hash = await sha256Hex(`${challenge}:${result.nonce}`);
  assert.equal(hash.startsWith('00'), true);
});
