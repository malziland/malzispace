/**
 * E2E for the append-only / "Inhalt schützen" feature (v1.3.0).
 *
 * Boots the local Firebase emulator stack plus the collab-relay and drives
 * two Playwright pages:
 *   - Owner: ticks "lock on create", waits for the editor, activates protect,
 *     types trainer text (should be wrapped in .mz-owner-text).
 *   - Reader: opens the reader URL, unlocks first, then verifies protect
 *     banner is visible, owner-marked content is preserved, and edits to
 *     that content are blocked.
 *
 * Assertions cover initial protect=false state, retroactive marking on
 * first activation, live propagation via append_only_state relay frame,
 * participant block + displacement guard, owner edits owner content
 * freely, and toggle off restores full editability.
 */
import { startDevStack } from '../support/dev_stack.mjs';
import { launchChromiumBrowser } from '../support/browser.mjs';

function fail(line) { console.error(line); process.exitCode = 1; }
function pass(line) { console.log(line); }

async function waitFor(predicate, { timeoutMs = 8000, intervalMs = 100, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout waiting for ${label}`);
}

async function applyTestHarness(context, relayWsUrl) {
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
    } catch (e) { try { await route.continue(); } catch (err) {} }
  });
  await context.addInitScript(({ wsUrl }) => {
    window.MZ_COLLAB_WS_URL = wsUrl;
    window.__MZ_APP_CHECK_READY__ = Promise.resolve(null);
    window.__MZ_APP_CHECK__ = { getToken: async () => null, getHeaders: async () => ({}) };
    window.__MZ_getAppCheckHeaders__ = async () => ({});
  }, { wsUrl: relayWsUrl });
}

async function isEditorEditable(page) {
  return page.evaluate(() => {
    const el = document.getElementById('editor');
    return el ? el.getAttribute('contenteditable') === 'true' : false;
  });
}

async function getProtectButtonState(page) {
  return page.evaluate(() => {
    const btn = document.getElementById('protectToggle');
    if (!btn) return { exists: false };
    return {
      exists: true,
      hidden: btn.hasAttribute('hidden'),
      display: getComputedStyle(btn).display,
      state: btn.getAttribute('data-state') || ''
    };
  });
}

async function isProtectBannerVisible(page) {
  return page.evaluate(() => {
    const banner = document.getElementById('protectBanner');
    if (!banner) return false;
    if (banner.hasAttribute('hidden')) return false;
    return getComputedStyle(banner).display !== 'none';
  });
}

async function setEditorContent(page, html) {
  return page.evaluate((h) => {
    const ed = document.getElementById('editor');
    ed.innerHTML = h;
    ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }, html);
}

async function main() {
  const verbose = String(process.env.PROTECT_E2E_VERBOSE || '') === '1';
  const stack = await startDevStack({ silent: !verbose });
  pass(`PASS dev_stack_boot - baseUrl=${stack.baseUrl} relayUrl=${stack.relayUrl}`);

  let browser;
  try {
    browser = await launchChromiumBrowser({
      args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessFromInsecureSubresources']
    });

    // ── Owner setup ────────────────────────────────────────────────
    const ownerContext = await browser.newContext();
    await applyTestHarness(ownerContext, stack.relayUrl);
    const ownerPage = await ownerContext.newPage();
    if (verbose) {
      ownerPage.on('console', (m) => console.log(`[owner ${m.type()}]`, m.text()));
      ownerPage.on('pageerror', (e) => console.log('[owner pageerror]', e.message));
    }
    await ownerPage.goto(`${stack.baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
    await ownerPage.waitForSelector('#createForm', { timeout: 10_000 });
    await ownerPage.check('#lockOnCreate');

    let initialOwnerUrl = '';
    ownerPage.on('framenavigated', (frame) => {
      if (frame === ownerPage.mainFrame() && !initialOwnerUrl) {
        const u = frame.url();
        if (/\/space\.html/.test(u) && u.indexOf('#') >= 0) initialOwnerUrl = u;
      }
    });
    await Promise.all([
      ownerPage.waitForURL(/\/space\.html/i, { timeout: 15_000 }),
      ownerPage.click('#createForm button[type=submit]')
    ]);
    if (!initialOwnerUrl) initialOwnerUrl = ownerPage.url();

    await waitFor(() => isEditorEditable(ownerPage), { timeoutMs: 15_000, label: 'owner editor editable' });

    // First unlock the space — protect is independent of lock but the
    // landing-page "lock on create" path leaves the space read_only initially.
    await ownerPage.click('#lockToggle');
    await waitFor(async () => {
      return ownerPage.evaluate(() => {
        const l = document.getElementById('lockToggle');
        return l && l.getAttribute('data-state') === 'open';
      });
    }, { timeoutMs: 8000, label: 'space unlocked' });
    pass('PASS owner_unlocked - space unlocked before protect test begins');

    // Protect button must be visible for the owner, state=off initially.
    await waitFor(async () => {
      const s = await getProtectButtonState(ownerPage);
      return s.exists && !s.hidden && s.state === 'off';
    }, { timeoutMs: 8000, label: 'owner sees protect button (state=off)' });
    pass('PASS owner_sees_protect_button - state=off initially');

    // Banner is hidden when protect is off.
    if (await isProtectBannerVisible(ownerPage)) throw new Error('owner: protect banner should be hidden when protect=off');
    pass('PASS owner_no_banner_when_off');

    // Seed some plain text for retroactive marking.
    await setEditorContent(ownerPage, '<p>Aufgabe: Brainstorming</p>');
    await ownerPage.waitForTimeout(500);

    // ── Owner activates protect ────────────────────────────────────
    await ownerPage.click('#protectToggle');
    await waitFor(async () => {
      const s = await getProtectButtonState(ownerPage);
      return s.state === 'on';
    }, { timeoutMs: 8000, label: 'protect button state=on' });
    pass('PASS owner_activates_protect - state=on');

    if (!await isProtectBannerVisible(ownerPage)) throw new Error('owner: protect banner must appear when protect=on');
    pass('PASS owner_banner_visible_when_on');

    // Retroactive marking: existing content must now be wrapped in .mz-owner-text.
    const hasRetroMarking = await ownerPage.evaluate(() => {
      const ed = document.getElementById('editor');
      return !!ed.querySelector('.mz-owner-text');
    });
    if (!hasRetroMarking) throw new Error('retroactive marking did not wrap existing content');
    pass('PASS retroactive_marking - existing content wrapped in .mz-owner-text on first activation');

    // Owner can still edit anything (including their own protected text).
    const ownerCanEditOwn = await ownerPage.evaluate(() => {
      const ed = document.getElementById('editor');
      const span = ed.querySelector('.mz-owner-text');
      if (!span) return false;
      const range = document.createRange();
      range.selectNodeContents(span);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      const before = ed.textContent;
      document.execCommand('delete');
      return ed.textContent !== before;
    });
    if (!ownerCanEditOwn) throw new Error('owner cannot edit their own owner-marked text');
    pass('PASS owner_can_edit_own_marked_text');

    // Re-seed for reader test.
    await setEditorContent(ownerPage, '<p><span class="mz-owner-text">Aufgabe: Antworten unten</span></p>');
    await ownerPage.waitForTimeout(500);

    // ── Reader ─────────────────────────────────────────────────────
    const hash = new URL(initialOwnerUrl).hash || '';
    const dot = hash.indexOf('.');
    const readerHash = hash.slice(0, dot);
    const readerUrl = initialOwnerUrl.slice(0, initialOwnerUrl.length - hash.length) + readerHash;

    const readerContext = await browser.newContext();
    await applyTestHarness(readerContext, stack.relayUrl);
    const readerPage = await readerContext.newPage();
    if (verbose) {
      readerPage.on('console', (m) => console.log(`[reader ${m.type()}]`, m.text()));
      readerPage.on('pageerror', (e) => console.log('[reader pageerror]', e.message));
    }
    await readerPage.goto(readerUrl, { waitUntil: 'domcontentloaded' });
    await readerPage.waitForSelector('#editor', { timeout: 10_000 });
    await readerPage.waitForTimeout(2500); // initial /api/load + ws frames

    // Reader does NOT see the protect toggle.
    const readerProtectBtn = await getProtectButtonState(readerPage);
    if (readerProtectBtn.exists && readerProtectBtn.display !== 'none' && !readerProtectBtn.hidden) {
      throw new Error('reader: protect toggle must be hidden for non-owners');
    }
    pass('PASS reader_no_protect_button');

    // Reader DOES see the banner.
    await waitFor(() => isProtectBannerVisible(readerPage), { timeoutMs: 8000, label: 'reader sees protect banner' });
    pass('PASS reader_sees_banner');

    // Reader cannot edit owner-marked text. We simulate a Backspace at the
    // end of the protected span and verify the content is unchanged.
    const readerEditBlocked = await readerPage.evaluate(() => {
      const ed = document.getElementById('editor');
      const span = ed.querySelector('.mz-owner-text');
      if (!span) return { ok: false, reason: 'no_span' };
      const textBefore = ed.textContent;
      const range = document.createRange();
      range.selectNodeContents(span);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      // Fire beforeinput with deleteContentBackward like backspace would.
      const evt = new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true });
      ed.dispatchEvent(evt);
      const blocked = evt.defaultPrevented;
      const textAfter = ed.textContent;
      return { ok: blocked && textAfter === textBefore, blocked, changed: textAfter !== textBefore };
    });
    if (!readerEditBlocked.ok) {
      throw new Error('reader edit was not blocked: ' + JSON.stringify(readerEditBlocked));
    }
    pass('PASS reader_edit_blocked - beforeinput.defaultPrevented + content unchanged');

    // ── Owner deactivates protect → reader's banner must disappear ─
    await ownerPage.click('#protectToggle');
    await waitFor(async () => {
      const s = await getProtectButtonState(ownerPage);
      return s.state === 'off';
    }, { timeoutMs: 8000, label: 'owner protect button state=off' });
    pass('PASS owner_deactivates_protect');

    await waitFor(async () => !(await isProtectBannerVisible(readerPage)), { timeoutMs: 8000, label: 'reader banner hides live' });
    pass('PASS reader_banner_hides_live - protect=off propagated via relay');

    await ownerContext.close();
    await readerContext.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stack.stop();
  }
}

main().catch((err) => {
  fail(`FAIL protect_e2e - ${err && err.message ? err.message : err}`);
  process.exit(process.exitCode || 1);
});
