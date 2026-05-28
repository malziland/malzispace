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
      disabled: !!btn.disabled,
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

// Owners drive lock/protect via the three-state mode switch (v1.3.1+), not
// the legacy #lockToggle / #protectToggle icon buttons.
async function clickMode(page, mode) {
  return page.click(`#modeSwitch .mode-segment[data-mode="${mode}"]`);
}

async function currentOwnerMode(page) {
  return page.evaluate(() => {
    const active = document.querySelector('#modeSwitch .mode-segment[aria-checked="true"]');
    return active ? active.getAttribute('data-mode') : null;
  });
}

async function isAppendOnlyActive(page) {
  return page.evaluate(() => document.body.classList.contains('has-append-only'));
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

    // The owner drives lock/protect via the three-state mode switch. It is
    // owner-only, so its visibility also confirms owner status.
    await waitFor(async () => {
      return ownerPage.evaluate(() => {
        const m = document.getElementById('modeSwitch');
        return !!m && !m.hasAttribute('hidden');
      });
    }, { timeoutMs: 8000, label: 'owner sees mode switch' });
    pass('PASS owner_sees_mode_switch');

    // First unlock the space — the landing-page "lock on create" path leaves
    // the space read_only (mode=locked) initially.
    await clickMode(ownerPage, 'open');
    await waitFor(async () => (await currentOwnerMode(ownerPage)) === 'open',
      { timeoutMs: 8000, label: 'space unlocked (mode=open)' });
    await waitFor(() => isEditorEditable(ownerPage), { timeoutMs: 8000, label: 'editor editable after unlock' });
    pass('PASS owner_unlocked - mode=open before protect test begins');

    // Protect is off initially: no banner, no body flag.
    if (await isAppendOnlyActive(ownerPage)) throw new Error('owner: append-only should be off initially');
    pass('PASS owner_protect_off_initially');

    // Banner is hidden when protect is off.
    if (await isProtectBannerVisible(ownerPage)) throw new Error('owner: protect banner should be hidden when protect=off');
    pass('PASS owner_no_banner_when_off');

    // Wait until collaboration init has fully settled (initial load + pull),
    // otherwise an async pull can clobber the seed right before activation.
    await waitFor(() => ownerPage.evaluate(() => window.__MZ_COLLAB_READY__ === true),
      { timeoutMs: 10_000, label: 'owner collab ready' });

    // Seed some plain text for retroactive marking, and confirm it is present
    // and stable immediately before activating protect.
    await setEditorContent(ownerPage, '<p>Aufgabe: Brainstorming</p>');
    await waitFor(() => ownerPage.evaluate(() => /Brainstorming/.test(document.getElementById('editor').textContent || '')),
      { timeoutMs: 8000, label: 'seed content present before activation' });

    // ── Owner activates protect ────────────────────────────────────
    await clickMode(ownerPage, 'protect');
    await waitFor(async () => (await currentOwnerMode(ownerPage)) === 'protect' && (await isAppendOnlyActive(ownerPage)),
      { timeoutMs: 8000, label: 'mode=protect + append-only active' });
    pass('PASS owner_activates_protect - mode=protect');

    if (!await isProtectBannerVisible(ownerPage)) throw new Error('owner: protect banner must appear when protect=on');
    pass('PASS owner_banner_visible_when_on');

    // Retroactive marking: existing content must now be wrapped in .mz-owner-text.
    await waitFor(() => ownerPage.evaluate(() => !!document.getElementById('editor').querySelector('.mz-owner-text')),
      { timeoutMs: 8000, label: 'retroactive marking wraps existing content' });
    pass('PASS retroactive_marking - existing content wrapped in .mz-owner-text on first activation');

    // NOTE: the owner-edits-own-content check runs AFTER the reader probes —
    // it mutates the shared doc, and doing it here would race the reader's
    // initial load of the (then still stable) marked content.

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

    // Reader never gets an interactive protect toggle. Since v1.3.1 a passive
    // shield indicator is shown while protect is active — it must be disabled.
    const readerProtectBtn = await getProtectButtonState(readerPage);
    const interactiveForReader = readerProtectBtn.exists
      && !readerProtectBtn.hidden
      && readerProtectBtn.display !== 'none'
      && !readerProtectBtn.disabled;
    if (interactiveForReader) {
      throw new Error('reader: protect control must be passive (disabled) for non-owners: ' + JSON.stringify(readerProtectBtn));
    }
    pass('PASS reader_no_interactive_protect_toggle - indicator is passive/disabled');

    // Reader DOES see the banner.
    await waitFor(() => isProtectBannerVisible(readerPage), { timeoutMs: 8000, label: 'reader sees protect banner' });
    pass('PASS reader_sees_banner');

    // The owner-marked content (retro-marked on activation) must reach the
    // reader before we probe edit-blocking on it.
    await waitFor(() => readerPage.evaluate(() => {
      const sp = document.getElementById('editor').querySelector('.mz-owner-text');
      return !!sp && (sp.textContent || '').trim().length >= 8;
    }), { timeoutMs: 12_000, label: 'owner-marked content reaches reader' });
    pass('PASS reader_receives_owner_content');

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

    // Reader cannot paste over owner-marked text. The paste handler runs its
    // own manual delete+insert (bypassing beforeinput), so it must carry its
    // own participant guard (regression fixed 2026-05-28).
    const readerPasteBlocked = await readerPage.evaluate(() => {
      const ed = document.getElementById('editor');
      const span = ed.querySelector('.mz-owner-text');
      if (!span) return { ok: false, reason: 'no_span' };
      const before = ed.textContent;
      const range = document.createRange();
      range.selectNodeContents(span);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      const dt = new DataTransfer();
      dt.setData('text/plain', 'HACK');
      const evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      ed.dispatchEvent(evt);
      const after = ed.textContent;
      return { ok: after === before, before, after };
    });
    if (!readerPasteBlocked.ok) {
      throw new Error('reader paste over owner text was not blocked: ' + JSON.stringify(readerPasteBlocked));
    }
    pass('PASS reader_paste_blocked - paste over owner content left it unchanged');

    // Reconciliation safety net: if a mutation slips past the preventive guard
    // (e.g. a non-cancelable composition event on a mobile keyboard) and
    // deletes part of the owner text, the next input must restore it.
    const readerReconciled = await readerPage.evaluate(() => {
      const ed = document.getElementById('editor');
      const span = ed.querySelector('.mz-owner-text');
      if (!span) return { ok: false, reason: 'no_span' };
      const before = span.textContent;
      const tn = span.firstChild;
      if (!tn || tn.nodeType !== 3 || (tn.textContent || '').length < 8) {
        return { ok: false, reason: 'unexpected_owner_node' };
      }
      tn.deleteData(3, 4); // chop characters out of the middle of owner text
      ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', cancelable: false }));
      const restored = ed.querySelector('.mz-owner-text');
      const after = restored ? restored.textContent : null;
      return { ok: after === before, before, after };
    });
    if (!readerReconciled.ok) {
      throw new Error('reconciliation did not restore mutated owner text: ' + JSON.stringify(readerReconciled));
    }
    pass('PASS reader_reconcile_revert - slipped-through owner mutation was restored');

    // Owner can still edit anything, including their own protected text. Done
    // here (after the reader probes) so it doesn't race the reader's load.
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

    // ── Owner deactivates protect → reader's banner must disappear ─
    await clickMode(ownerPage, 'open');
    await waitFor(async () => (await currentOwnerMode(ownerPage)) === 'open' && !(await isAppendOnlyActive(ownerPage)),
      { timeoutMs: 8000, label: 'mode=open + append-only off' });
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
