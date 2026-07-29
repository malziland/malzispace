/**
 * Accessibility E2E for the critical user flows (UI-profile requirement,
 * see docs/adr/ADR-0001 and docs/VERIFICATION.md):
 *   1. Landing page — create a space.
 *   2. Editor (simulator mode) — open a space and write.
 *
 * Two layers per page:
 *   - axe-core scan: violations with impact serious/critical fail the run;
 *     lesser findings are logged but do not gate (documented cap).
 *   - keyboard pass: Tab reaches the primary controls and the contenteditable
 *     editor, and typing works — the automated half of the manual keyboard
 *     smoketest documented in docs/frontend/A11Y_SMOKETEST.md.
 */
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { launchChromiumBrowser } from '../support/browser.mjs';

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core/axe.min.js');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/+$/, '');

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeKey() {
  return b64url(crypto.randomBytes(32));
}

function fail(name, detail) {
  console.error(`FAIL ${name} - ${detail}`);
  process.exitCode = 1;
}

function pass(name, detail = '') {
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`);
}

// The production CSP (HTTP header from firebase.json + <meta http-equiv>
// fallback in the HTML) has no 'unsafe-inline', which correctly blocks the
// axe-core injection. CSP is not under test here, so we strip both for the
// scanned pages — same pattern as the lock E2E's applyTestHarness.
async function stripCsp(page) {
  await page.route('**/*', async (route) => {
    try {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers['content-security-policy'];
      delete headers['Content-Security-Policy'];
      const contentType = headers['content-type'] || '';
      let body = await response.body();
      if (contentType.includes('text/html')) {
        const html = body.toString('utf8');
        const stripped = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
        body = Buffer.from(stripped, 'utf8');
        if (headers['content-length']) headers['content-length'] = String(body.length);
      }
      await route.fulfill({ status: response.status(), headers, body });
    } catch (e) {
      try { await route.continue(); } catch (err) {}
    }
  });
}

async function runAxe(page, label) {
  await page.addScriptTag({ path: AXE_PATH });
  const results = await page.evaluate(async () => {
    return await window.axe.run(document, {
      resultTypes: ['violations'],
      // Color-contrast on the canvas-like dark theme is checked manually
      // (see A11Y_SMOKETEST.md); axe's automated contrast heuristics stay on.
    });
  });
  const gating = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const advisory = results.violations.filter((v) => v.impact !== 'serious' && v.impact !== 'critical');
  for (const v of advisory) {
    console.log(`  advisory(${label}): ${v.id} [${v.impact}] x${v.nodes.length} — ${v.help}`);
  }
  if (gating.length > 0) {
    for (const v of gating) {
      const target = v.nodes[0]?.target?.join(' ') || '?';
      console.error(`  violation(${label}): ${v.id} [${v.impact}] x${v.nodes.length} — ${v.help} (first: ${target})`);
    }
    fail(`a11y_axe_${label}`, `${gating.length} serious/critical axe violation(s)`);
    return false;
  }
  pass(`a11y_axe_${label}`, `0 serious/critical violations (${advisory.length} advisory logged)`);
  return true;
}

async function tabUntil(page, wantedPredicates, maxPresses = 40) {
  const seen = new Set();
  const found = new Map();
  for (let i = 0; i < maxPresses && found.size < wantedPredicates.length; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      return {
        id: el.id || '',
        tag: el.tagName,
        cmd: el.getAttribute ? (el.getAttribute('data-cmd') || '') : '',
        type: el.getAttribute ? (el.getAttribute('type') || '') : ''
      };
    });
    if (!info) continue;
    seen.add(`${info.tag}#${info.id}[${info.cmd}]`);
    for (const [name, predicate] of wantedPredicates) {
      if (!found.has(name) && predicate(info)) found.set(name, info);
    }
  }
  return { found, seen };
}

async function checkLanding(browser) {
  const page = await browser.newPage();
  try {
    await stripCsp(page);
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#createForm', { timeout: 10_000 });
    await runAxe(page, 'landing');

    const { found } = await tabUntil(page, [
      ['create_submit', (el) => el.tag === 'BUTTON' && el.type === 'submit'],
    ]);
    if (found.has('create_submit')) {
      pass('a11y_keyboard_landing', 'Tab reaches the create-space submit button');
    } else {
      fail('a11y_keyboard_landing', 'create-space submit button not reachable via Tab');
    }
  } finally {
    await page.close();
  }
}

async function checkEditor(browser) {
  const page = await browser.newPage();
  try {
    await stripCsp(page);
    const url = `${BASE_URL}/space.html?id=a11ytest01&sim=1#${makeKey()}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#editor', { timeout: 10_000 });
    await page.waitForTimeout(300);
    await runAxe(page, 'editor');

    const { found } = await tabUntil(page, [
      ['toolbar_bold', (el) => el.cmd === 'bold'],
      ['editor', (el) => el.id === 'editor'],
    ]);
    if (!found.has('toolbar_bold')) {
      fail('a11y_keyboard_toolbar', 'bold toolbar button not reachable via Tab');
    } else {
      pass('a11y_keyboard_toolbar', 'Tab reaches the formatting toolbar');
    }
    if (!found.has('editor')) {
      fail('a11y_keyboard_editor_focus', 'contenteditable editor not reachable via Tab');
      return;
    }
    pass('a11y_keyboard_editor_focus', 'Tab reaches the editor');

    await page.focus('#editor');
    await page.keyboard.type('A11y keyboard check');
    const text = await page.evaluate(() => document.getElementById('editor').innerText || '');
    if (text.includes('A11y keyboard check')) {
      pass('a11y_keyboard_typing', 'keyboard input lands in the editor');
    } else {
      fail('a11y_keyboard_typing', `expected typed text in editor, got: ${JSON.stringify(text.slice(0, 80))}`);
    }
  } finally {
    await page.close();
  }
}

// Every other shipped page. The landing page and the editor get the dedicated
// checks above (they also exercise keyboard paths); these are scanned for axe
// violations only. Without this list a page like privacy.html could regress
// unnoticed — which is exactly how four broken legal-text links and three
// missing main landmarks survived until 2026-07-29.
const OTHER_PAGES = [
  'impressum.html',
  'privacy.html',
  'agb.html',
  'reset-cache.html',
  'editor-simulator.html',
];

async function checkStaticPage(browser, name) {
  const page = await browser.newPage();
  try {
    await stripCsp(page);
    await page.goto(`${BASE_URL}/${name}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    await runAxe(page, name.replace(/\.html$/, ''));
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await launchChromiumBrowser();
  try {
    await checkLanding(browser);
    await checkEditor(browser);
    for (const name of OTHER_PAGES) {
      await checkStaticPage(browser, name);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  if (process.exitCode) {
    console.error('A11Y CHECKS FAILED');
  } else {
    console.log('A11Y CHECKS OK');
  }
}

main().catch((err) => {
  fail('a11y_run', err && err.message ? err.message : String(err));
  process.exit(process.exitCode || 1);
});
