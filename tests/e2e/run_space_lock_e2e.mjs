/**
 * E2E for the owner-link / read-only lock feature.
 *
 * Boots the local Firebase emulator stack (firestore + database + functions +
 * hosting) plus the collab-relay, then drives two Playwright pages:
 *   - Page A loads the landing page, ticks "lock on create", submits, and
 *     becomes the owner of a freshly created space.
 *   - Page B opens the reader URL (owner secret stripped from the hash).
 *
 * Assertions cover initial read-only state, live unlock propagation, and
 * re-lock. The test is the canonical end-to-end smoke for OWNER-01..OWNER-08.
 */
import { startDevStack } from '../support/dev_stack.mjs';
import { launchChromiumBrowser } from '../support/browser.mjs';

function fail(line) {
  console.error(line);
  process.exitCode = 1;
}

function pass(line) {
  console.log(line);
}

async function waitFor(predicate, { timeoutMs = 8000, intervalMs = 100, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout waiting for ${label}`);
}

async function applyTestHarness(context, relayWsUrl) {
  // The frontend ships its production CSP both as an HTTP header (from
  // firebase.json) and as a <meta http-equiv> element in space.html /
  // index.html. Neither allows ws://127.0.0.1, so we strip both — header via
  // response rewrite, meta tag via HTML body rewrite. Production is never
  // touched; this lives in the Playwright test setup.
  await context.route('**/*', async (route) => {
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

  // Pre-set the App Check / WS globals so that:
  //   * config.js sees our localhost WS URL and uses it instead of the prod one
  //   * appcheck.js skips its real init (the guarded singleton pattern)
  //   * any API call adds no App Check header — the API is in bypass mode
  await context.addInitScript(({ wsUrl }) => {
    window.MZ_COLLAB_WS_URL = wsUrl;
    window.__MZ_APP_CHECK_READY__ = Promise.resolve(null);
    window.__MZ_APP_CHECK__ = {
      getToken: async () => null,
      getHeaders: async () => ({})
    };
    window.__MZ_getAppCheckHeaders__ = async () => ({});
  }, { wsUrl: relayWsUrl });
}

async function isEditorEditable(page) {
  return page.evaluate(() => {
    const el = document.getElementById('editor');
    if (!el) return false;
    return el.getAttribute('contenteditable') === 'true';
  });
}

async function getLockButtonState(page) {
  return page.evaluate(() => {
    const btn = document.getElementById('lockToggle');
    if (!btn) return { exists: false };
    return {
      exists: true,
      hidden: btn.hasAttribute('hidden'),
      state: btn.getAttribute('data-state') || '',
      disabled: !!btn.disabled
    };
  });
}

async function waitForLockState(page, expectedState, { timeoutMs = 8000 } = {}) {
  await waitFor(async () => {
    const editable = await isEditorEditable(page);
    if (expectedState === 'locked' && editable) return false;
    if (expectedState === 'unlocked' && !editable) return false;
    return true;
  }, { timeoutMs, label: `editor ${expectedState}` });
}

async function main() {
  const verbose = String(process.env.LOCK_E2E_VERBOSE || '') === '1';
  const stack = await startDevStack({ silent: !verbose });
  pass(`PASS dev_stack_boot - baseUrl=${stack.baseUrl} relayUrl=${stack.relayUrl}`);

  let browser;
  try {
    // Chrome's "Local Network Access" / PNA checks block ws://127.0.0.1 from a
    // page loaded over http://127.0.0.1 because the page is treated as public
    // context. We disable those checks for the test only.
    browser = await launchChromiumBrowser({
      args: [
        '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessFromInsecureSubresources'
      ]
    });

    // -- Page A: owner ------------------------------------------------------
    const ownerContext = await browser.newContext();
    await applyTestHarness(ownerContext, stack.relayUrl);
    const ownerPage = await ownerContext.newPage();
    if (verbose) {
      ownerPage.on('console', (msg) => console.log(`[owner ${msg.type()}]`, msg.text()));
      ownerPage.on('pageerror', (err) => console.log('[owner pageerror]', err.message));
      ownerPage.on('requestfailed', (req) => console.log('[owner requestfailed]', req.url(), req.failure()?.errorText));
      ownerPage.on('response', (res) => {
        if (res.url().includes('/api/')) console.log('[owner api]', res.status(), res.url());
      });
    }

    await ownerPage.goto(`${stack.baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
    await ownerPage.waitForSelector('#createForm', { timeout: 10_000 });

    const lockBox = await ownerPage.$('#lockOnCreate');
    if (!lockBox) throw new Error('lockOnCreate checkbox missing on landing page');
    await ownerPage.check('#lockOnCreate');

    // Capture the initial owner URL BEFORE the page can run init (which calls
    // stripHashFromUrl). The framenavigated event fires while the URL still
    // has the hash intact.
    let initialOwnerUrl = '';
    ownerPage.on('framenavigated', (frame) => {
      if (frame === ownerPage.mainFrame() && !initialOwnerUrl) {
        const url = frame.url();
        if (/\/space\.html/.test(url) && url.indexOf('#') >= 0) initialOwnerUrl = url;
      }
    });
    await Promise.all([
      ownerPage.waitForURL(/\/space\.html/i, { timeout: 15_000 }),
      ownerPage.click('#createForm button[type=submit]')
    ]);

    if (!initialOwnerUrl) initialOwnerUrl = ownerPage.url();
    const hash = new URL(initialOwnerUrl).hash || '';
    if (!hash.includes('.')) throw new Error('owner URL hash does not contain owner-secret separator');
    pass(`PASS owner_url_format - hash has dot separator (len=${hash.length})`);

    // After init the owner secret must be wiped from the address bar but the
    // cached keys + sessionStorage backup keep decryption working.
    await waitFor(async () => {
      return ownerPage.evaluate(() => !window.location.hash);
    }, { timeoutMs: 8000, label: 'owner URL hash stripped from address bar' });
    pass('PASS owner_url_stripped - address bar no longer exposes the owner secret');

    // Wait for the editor to become editable for the owner.
    await waitFor(() => isEditorEditable(ownerPage), { timeoutMs: 15_000, label: 'owner editor editable' });
    pass('PASS owner_editor_editable - owner can edit a freshly locked space');

    await waitFor(async () => {
      const s = await getLockButtonState(ownerPage);
      return s.exists && !s.hidden && s.state === 'locked';
    }, { timeoutMs: 8000, label: 'owner lock button visible & state=locked' });
    pass('PASS owner_sees_lock_button - state=locked');

    await waitFor(async () => {
      return ownerPage.evaluate(() => {
        const banner = document.getElementById('ownerWelcome');
        if (!banner || banner.hasAttribute('hidden')) return false;
        return !!(banner.textContent || '').trim();
      });
    }, { timeoutMs: 8000, label: 'owner-welcome banner visible' });
    pass('PASS owner_welcome_banner - shown once with single-line hint');

    // -- Page B: reader -----------------------------------------------------
    const dot = hash.indexOf('.');
    const readerHash = hash.slice(0, dot);
    const readerUrl = initialOwnerUrl.slice(0, initialOwnerUrl.length - hash.length) + readerHash;

    const readerContext = await browser.newContext();
    await applyTestHarness(readerContext, stack.relayUrl);
    const readerPage = await readerContext.newPage();
    if (verbose) {
      readerPage.on('console', (msg) => console.log(`[reader ${msg.type()}]`, msg.text()));
      readerPage.on('pageerror', (err) => console.log('[reader pageerror]', err.message));
      readerPage.on('websocket', (ws) => {
        console.log('[reader ws open]', ws.url());
        ws.on('framereceived', (frame) => console.log('[reader ws<-]', String(frame.payload).slice(0, 120)));
        ws.on('close', () => console.log('[reader ws close]'));
      });
    }
    await readerPage.goto(readerUrl, { waitUntil: 'domcontentloaded' });
    await readerPage.waitForSelector('#editor', { timeout: 10_000 });

    await waitForLockState(readerPage, 'locked', { timeoutMs: 15_000 });
    pass('PASS reader_blocked_initial - editor disabled while space is locked');

    const readerLockBtn = await getLockButtonState(readerPage);
    if (!readerLockBtn.exists || readerLockBtn.hidden) throw new Error('reader does not see the read-only lock indicator');
    if (!readerLockBtn.disabled) throw new Error('reader lock indicator should be disabled (no toggle for non-owners)');
    pass('PASS reader_sees_lock_indicator - disabled lock icon visible');

    // -- Owner unlocks; reader UI must update live --------------------------
    await ownerPage.click('#lockToggle');
    await waitForLockState(readerPage, 'unlocked', { timeoutMs: 8000 });
    pass('PASS reader_unlocks_live - editor became editable after owner unlock');

    // -- Owner re-locks; reader becomes read-only again ---------------------
    await ownerPage.click('#lockToggle');
    await waitForLockState(readerPage, 'locked', { timeoutMs: 8000 });
    pass('PASS reader_relocks_live - editor disabled again after owner re-lock');

    await ownerContext.close();
    await readerContext.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stack.stop();
  }
}

main().catch((err) => {
  fail(`FAIL lock_e2e - ${err && err.message ? err.message : err}`);
  process.exit(process.exitCode || 1);
});
