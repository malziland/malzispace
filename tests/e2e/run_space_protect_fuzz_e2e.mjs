/**
 * REAL-INPUT fuzz E2E for the append-only / "Inhalt schützen" protection.
 *
 * Unlike run_space_protect_e2e.mjs (which dispatches synthetic events), this
 * harness drives a participant with the REAL keyboard and REAL clipboard via
 * Playwright — typing into the middle of owner-marked text, select-all+type,
 * Backspace/Delete mid-text, real Ctrl/Cmd+V, plus a random keystroke fuzz.
 * It runs in BOTH Chromium and WebKit (the Safari engine), because the bug
 * reported by the user reproduced in Safari and via real paste in Brave.
 *
 * Invariant under test: while protect is on, NOTHING a participant does may
 * change the concatenated text of the owner-marked spans.
 */
import { chromium, webkit } from 'playwright';
import { startDevStack } from '../support/dev_stack.mjs';
import { launchChromiumBrowser } from '../support/browser.mjs';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
let failures = 0;
function fail(line) { console.error('FAIL ' + line); failures += 1; }
function pass(line) { console.log('PASS ' + line); }

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

const isEditorEditable = (page) => page.evaluate(() => {
  const el = document.getElementById('editor');
  return el ? el.getAttribute('contenteditable') === 'true' : false;
});
const clickMode = (page, mode) => page.click(`#modeSwitch .mode-segment[data-mode="${mode}"]`);
const currentOwnerMode = (page) => page.evaluate(() => {
  const a = document.querySelector('#modeSwitch .mode-segment[aria-checked="true"]');
  return a ? a.getAttribute('data-mode') : null;
});
const isAppendOnlyActive = (page) => page.evaluate(() => document.body.classList.contains('has-append-only'));
const getOwnerText = (page) => page.evaluate(() => {
  let s = '';
  document.querySelectorAll('#editor .mz-owner-text').forEach((sp) => {
    s += (sp.textContent || '').replace(/​/g, '').replace(/ /g, ' ');
  });
  return s;
});

/** Put the caret inside the owner span at the given fraction of its text. */
function placeCaretInOwner(page, fraction) {
  return page.evaluate((frac) => {
    const ed = document.getElementById('editor');
    ed.focus();
    const span = ed.querySelector('.mz-owner-text');
    if (!span) return false;
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    const tn = walker.nextNode();
    if (!tn) return false;
    const off = Math.max(0, Math.min(tn.textContent.length, Math.floor(tn.textContent.length * frac)));
    const r = document.createRange();
    r.setStart(tn, off); r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(r);
    return true;
  }, fraction);
}

/** Select a sub-range strictly inside the owner span text. */
function selectInsideOwner(page) {
  return page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.focus();
    const span = ed.querySelector('.mz-owner-text');
    if (!span) return false;
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    const tn = walker.nextNode();
    if (!tn || tn.textContent.length < 4) return false;
    const a = Math.floor(tn.textContent.length * 0.25);
    const b = Math.floor(tn.textContent.length * 0.75);
    const r = document.createRange();
    r.setStart(tn, a); r.setEnd(tn, b);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(r);
    return true;
  });
}

/** Place the caret in the last top-level block (the auto free line). Returns
 *  true only if that block carries no owner content (i.e. it is writable). */
function placeCaretInTail(page) {
  return page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.focus();
    const last = ed.lastElementChild;
    if (!last) return false;
    const r = document.createRange();
    r.selectNodeContents(last);
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(r);
    return !(last.querySelector && last.querySelector('.mz-owner-text'))
      && !(last.classList && last.classList.contains('mz-owner-text'));
  });
}

async function setupOwner(stack) {
  const ownerBrowser = await launchChromiumBrowser({
    args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessFromInsecureSubresources']
  });
  const ctx = await ownerBrowser.newContext();
  await applyTestHarness(ctx, stack.relayUrl);
  const page = await ctx.newPage();
  await page.goto(`${stack.baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#createForm', { timeout: 10_000 });
  await page.check('#lockOnCreate');
  let ownerUrl = '';
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && !ownerUrl) {
      const u = frame.url();
      if (/\/space\.html/.test(u) && u.indexOf('#') >= 0) ownerUrl = u;
    }
  });
  await Promise.all([
    page.waitForURL(/\/space\.html/i, { timeout: 15_000 }),
    page.click('#createForm button[type=submit]')
  ]);
  if (!ownerUrl) ownerUrl = page.url();
  await waitFor(() => isEditorEditable(page), { timeoutMs: 15_000, label: 'owner editor editable' });
  await waitFor(() => page.evaluate(() => { const m = document.getElementById('modeSwitch'); return !!m && !m.hasAttribute('hidden'); }),
    { timeoutMs: 8000, label: 'owner mode switch' });
  await clickMode(page, 'open');
  await waitFor(async () => (await currentOwnerMode(page)) === 'open', { timeoutMs: 8000, label: 'unlocked' });
  await waitFor(() => isEditorEditable(page), { timeoutMs: 8000, label: 'editable after unlock' });
  await waitFor(() => page.evaluate(() => window.__MZ_COLLAB_READY__ === true), { timeoutMs: 10_000, label: 'owner collab ready' });
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = '<p>Trainer Aufgabe Text</p>';
    ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await waitFor(() => page.evaluate(() => /Trainer Aufgabe Text/.test(document.getElementById('editor').textContent || '')),
    { timeoutMs: 8000, label: 'seed present' });
  await clickMode(page, 'protect');
  await waitFor(async () => (await currentOwnerMode(page)) === 'protect' && (await isAppendOnlyActive(page)),
    { timeoutMs: 8000, label: 'protect active' });
  await waitFor(() => page.evaluate(() => !!document.getElementById('editor').querySelector('.mz-owner-text')),
    { timeoutMs: 8000, label: 'retro-marked' });
  const hash = new URL(ownerUrl).hash || '';
  const readerHash = hash.slice(0, hash.indexOf('.'));
  const readerUrl = ownerUrl.slice(0, ownerUrl.length - hash.length) + readerHash;
  return { ownerBrowser, ownerPage: page, readerUrl };
}

async function runEngine(engineName, browserType, stack, readerUrl) {
  const browser = engineName === 'chromium'
    ? await launchChromiumBrowser({ args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessFromInsecureSubresources'] })
    : await browserType.launch({ headless: true });
  let ctx;
  try {
    ctx = await browser.newContext();
    if (engineName === 'chromium') {
      try { await ctx.grantPermissions(['clipboard-read', 'clipboard-write']); } catch (e) {}
    }
    await applyTestHarness(ctx, stack.relayUrl);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`[${engineName} reader pageerror]`, e.message));
    await page.goto(readerUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#editor', { timeout: 10_000 });
    await waitFor(() => isAppendOnlyActive(page), { timeoutMs: 12_000, label: `${engineName}: reader protect active` });
    await waitFor(() => page.evaluate(() => {
      const sp = document.getElementById('editor').querySelector('.mz-owner-text');
      return !!sp && (sp.textContent || '').trim().length >= 8;
    }), { timeoutMs: 12_000, label: `${engineName}: reader has owner content` });

    const original = await getOwnerText(page);
    pass(`${engineName}_reader_ready - owner text="${original}"`);

    const editorText = () => page.evaluate(() => document.getElementById('editor').textContent || '');

    const checkUnchanged = async (label) => {
      const now = await getOwnerText(page);
      if (now !== original) {
        fail(`${engineName}_${label} - owner text CHANGED: "${original}" -> "${now}"`);
        return false;
      }
      pass(`${engineName}_${label} - owner text intact`);
      return true;
    };

    // Spec: a participant may NOT attach to protected text. There must be an
    // auto-maintained free line below the last protected block where they
    // write. Verify that free line exists and is writable in BOTH engines.
    const tailWritable = await placeCaretInTail(page);
    if (!tailWritable) {
      fail(`${engineName}_free_line_exists - no writable free line below protected block`);
    } else {
      pass(`${engineName}_free_line_exists - auto free line present below owner`);
    }
    // Click the last block too (a real user click), so the caret is reliably
    // in the free line even on engines that ignore a JS-set selection.
    try { await page.locator('#editor > *:last-child').click(); } catch (e) {}
    await page.keyboard.type('PARTICIPANTOK', { delay: 15 });
    await page.waitForTimeout(150);
    if (!/PARTICIPANTOK/.test(await editorText())) {
      fail(`${engineName}_control_type_in_free_line - participant could NOT write in the free line`);
    } else {
      pass(`${engineName}_control_type_in_free_line - participant writes in the free line`);
    }
    try { await page.evaluate(() => navigator.clipboard.writeText('PASTEOK')); } catch (e) {}
    await page.keyboard.press(`${MOD}+v`);
    await page.waitForTimeout(150);
    if (!/PASTEOK/.test(await editorText())) {
      console.log(`[${engineName}] NOTE: real clipboard paste did not insert in the free line on this engine.`);
    } else {
      pass(`${engineName}_control_paste_in_free_line - real paste inserts in the free line`);
    }
    await checkUnchanged('free_line_writes_keep_owner_intact');

    // NEGATIVE: typing/Enter directly at the owner boundary must NOT attach.
    await placeCaretInOwner(page, 1); // end boundary of owner text
    await page.keyboard.type('XSHOULDNOTSTICK', { delay: 12 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('YSHOULDNOTSTICK', { delay: 12 });
    await page.waitForTimeout(150);
    await checkUnchanged('no_attach_at_owner_boundary');
    if (/SHOULDNOTSTICK/.test(await editorText())) {
      fail(`${engineName}_no_attach_at_owner_boundary_text - text attached at owner boundary (must be blocked)`);
    } else {
      pass(`${engineName}_no_attach_at_owner_boundary_text - boundary typing/Enter blocked`);
    }

    // 1) Type into the middle of owner text.
    await placeCaretInOwner(page, 0.5);
    await page.keyboard.type('HACK', { delay: 15 });
    await page.waitForTimeout(120);
    await checkUnchanged('type_mid_owner');

    // 2) Select-all then type a character (classic "markieren + tippen").
    await page.evaluate(() => document.getElementById('editor').focus());
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.type('Z', { delay: 15 });
    await page.waitForTimeout(120);
    await checkUnchanged('selectall_type');

    // 3) Backspace in the middle of owner text.
    await placeCaretInOwner(page, 0.5);
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Backspace'); }
    await page.waitForTimeout(120);
    await checkUnchanged('backspace_mid_owner');

    // 4) Delete forward in the middle of owner text.
    await placeCaretInOwner(page, 0.3);
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Delete'); }
    await page.waitForTimeout(120);
    await checkUnchanged('delete_mid_owner');

    // 5) Real clipboard paste over a selection inside owner text.
    try { await page.evaluate(() => navigator.clipboard.writeText('PASTED-PAYLOAD')); } catch (e) {}
    const selOk = await selectInsideOwner(page);
    await page.keyboard.press(`${MOD}+v`);
    await page.waitForTimeout(150);
    await checkUnchanged(`real_paste_over_owner${selOk ? '' : '_noselect'}`);

    // 6) Random fuzz: wild typing, navigation, deletes, selections, pastes.
    let seed = 1337;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const chars = 'abcdefghijklmnoöäüß ZXY123.,!';
    try { await page.evaluate(() => navigator.clipboard.writeText('FUZZ')); } catch (e) {}
    for (let i = 0; i < 140; i++) {
      const pick = Math.floor(rnd() * 9);
      if (pick === 0) await placeCaretInOwner(page, rnd());
      else if (pick === 1) await selectInsideOwner(page);
      else if (pick === 2) await page.keyboard.press('Backspace');
      else if (pick === 3) await page.keyboard.press('Delete');
      else if (pick === 4) await page.keyboard.press('ArrowLeft');
      else if (pick === 5) await page.keyboard.press('ArrowRight');
      else if (pick === 6) { await page.keyboard.press(`${MOD}+a`); }
      else if (pick === 7) await page.keyboard.press(`${MOD}+v`);
      else await page.keyboard.type(chars[Math.floor(rnd() * chars.length)]);
    }
    await page.waitForTimeout(200);
    await checkUnchanged('random_fuzz_140_actions');

    await ctx.close();
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  const stack = await startDevStack({ silent: true });
  pass(`dev_stack_boot - baseUrl=${stack.baseUrl}`);
  const { ownerBrowser, readerUrl } = await setupOwner(stack);
  pass('owner_setup - protected content created');
  try {
    const only = String(process.env.ENGINE || '').trim();
    const engines = only ? [only] : ['chromium', 'webkit'];
    for (const eng of engines) {
      await runEngine(eng, eng === 'webkit' ? webkit : chromium, stack, readerUrl);
    }
  } finally {
    await ownerBrowser.close().catch(() => {});
    await stack.stop();
  }
  if (failures > 0) { console.error(`\n${failures} protection FAILURE(s).`); process.exit(1); }
  console.log('\nAll protection invariants held.');
}

main().catch((err) => { console.error('FAIL fuzz_e2e -', err && err.message ? err.message : err); process.exit(1); });
