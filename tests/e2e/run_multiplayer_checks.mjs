import { chromium, webkit } from 'playwright';
import crypto from 'node:crypto';
import { launchBrowserForEngine } from '../support/browser.mjs';

const BASE_URL = (process.env.BASE_URL || 'https://malzispace.web.app').replace(/\/+$/, '');
const SIM_MODE = String(process.env.SIM || '').trim() === '1';
const APP_CHECK_TOKEN = process.env.APP_CHECK_TOKEN || '';
const APP_CHECK_DEBUG_TOKEN = process.env.APP_CHECK_DEBUG_TOKEN || '';
const VERBOSE = String(process.env.MZ_VERBOSE_MULTIPLAYER || '').trim() === '1';
const ENGINE_TIMEOUT_MS = Math.max(30_000, Number(process.env.MZ_MULTIPLAYER_TIMEOUT_MS || 90_000) || 90_000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarize(name, pass, detail = '') {
  const mark = pass ? 'PASS' : 'FAIL';
  return `${mark} ${name}${detail ? ` - ${detail}` : ''}`;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function deriveKeyProof(keyBytes) {
  const digest = await crypto.webcrypto.subtle.digest('SHA-256', keyBytes);
  return b64url(new Uint8Array(digest));
}

function makeSpaceId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 12; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

async function api(path, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  if (APP_CHECK_TOKEN) headers['X-Firebase-AppCheck'] = APP_CHECK_TOKEN;
  const res = await fetch(BASE_URL + path, Object.assign({}, options, { headers }));
  const json = await res.json().catch(() => ({ error: 'invalid_json' }));
  return { status: res.status, json };
}

async function createSpaceUrl() {
  const keyBytes = crypto.randomBytes(32);
  const key = b64url(keyBytes);
  const simQuery = SIM_MODE ? '&sim=1' : '';
  if (SIM_MODE) {
    const id = makeSpaceId();
    return `${BASE_URL}/space.html?id=${id}${simQuery}#${key}`;
  }
  if (!APP_CHECK_TOKEN) {
    throw new Error('APP_CHECK_TOKEN is required for non-sim multiplayer checks');
  }
  const keyProof = await deriveKeyProof(keyBytes);
  const create = await api('/api/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'multiplayer-check', key_proof: keyProof })
  });
  if (create.status !== 200 || !create.json || !create.json.ok || !create.json.id) {
    throw new Error(`create failed: status=${create.status} body=${JSON.stringify(create.json)}`);
  }
  return `${BASE_URL}/space.html?id=${create.json.id}${simQuery}#${key}`;
}

async function getLineMetrics(page) {
  return page.evaluate(() => {
    const editor = document.getElementById('editor');
    const nums = Array.from(document.querySelectorAll('#lineNumbersInner .line-number'))
      .map((el) => Number((el.textContent || '').trim()))
      .filter((n) => Number.isFinite(n));

    const LINE_BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'blockquote', 'li']);

    function hasRenderableNodeContent(el) {
      if (!el || !(el instanceof Element)) return false;
      try {
        if (el.querySelector('img,hr,video,audio,canvas,svg,object,embed,input,textarea,select,button')) return true;
      } catch (e) {}
      const txt = ((el.textContent || '') + '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ').trim();
      return txt.length > 0;
    }

    function countNodeLogicalLines(node) {
      if (!node) return 0;
      if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue || '').length ? 1 : 0;
      if (!(node instanceof Element)) return 0;
      const tag = (node.tagName || '').toLowerCase();
      if (tag === 'br') return 1;
      if (tag === 'ul' || tag === 'ol') {
        const items = Array.from(node.children || []).filter((child) => ((child.tagName || '').toLowerCase() === 'li'));
        if (!items.length) return 1;
        return items.reduce((sum, li) => sum + Math.max(1, countBlockLogicalLines(li)), 0);
      }
      if (LINE_BLOCK_TAGS.has(tag)) return Math.max(1, countBlockLogicalLines(node));
      return countInlineContainerLines(node);
    }

    function countInlineContainerLines(el) {
      if (!el || !(el instanceof Element)) return 0;
      let lines = 0;
      let hasInline = false;
      let sawStructuredChild = false;
      const children = Array.from(el.childNodes || []);
      children.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          if ((child.nodeValue || '').length) hasInline = true;
          return;
        }
        if (!(child instanceof Element)) return;
        const tag = (child.tagName || '').toLowerCase();
        if (tag === 'br') {
          sawStructuredChild = true;
          lines += 1;
          hasInline = false;
          return;
        }
        if (LINE_BLOCK_TAGS.has(tag) || tag === 'ul' || tag === 'ol') {
          sawStructuredChild = true;
          if (hasInline) {
            lines += 1;
            hasInline = false;
          }
          lines += Math.max(1, countNodeLogicalLines(child));
          return;
        }
        const nested = countInlineContainerLines(child);
        if (nested > 0) {
          hasInline = true;
          if (nested > 1) lines += nested - 1;
          return;
        }
        if (hasRenderableNodeContent(child)) hasInline = true;
      });
      if (hasInline) lines += 1;
      if (!sawStructuredChild && lines === 0 && hasRenderableNodeContent(el)) lines += 1;
      return lines;
    }

    function countBlockLogicalLines(block) {
      if (!block || !(block instanceof Element)) return 0;
      let lines = 0;
      let hasInline = false;
      let sawStructuredChild = false;
      const children = Array.from(block.childNodes || []);
      children.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          if ((child.nodeValue || '').length) hasInline = true;
          return;
        }
        if (!(child instanceof Element)) return;
        const tag = (child.tagName || '').toLowerCase();
        if (tag === 'br') {
          sawStructuredChild = true;
          lines += 1;
          hasInline = false;
          return;
        }
        if (LINE_BLOCK_TAGS.has(tag) || tag === 'ul' || tag === 'ol') {
          sawStructuredChild = true;
          if (hasInline) {
            lines += 1;
            hasInline = false;
          }
          lines += Math.max(1, countNodeLogicalLines(child));
          return;
        }
        const nested = countInlineContainerLines(child);
        if (nested > 0) {
          hasInline = true;
          if (nested > 1) lines += nested - 1;
          return;
        }
        if (hasRenderableNodeContent(child)) hasInline = true;
      });
      if (hasInline) lines += 1;
      if (!sawStructuredChild && lines === 0 && hasRenderableNodeContent(block)) lines += 1;
      return Math.max(1, lines);
    }

    const expectedLines = editor ? Math.max(1, countInlineContainerLines(editor)) : 1;
    const continuous = nums.every((n, i) => n === i + 1);
    const startsAtOne = nums[0] === 1;
    return { expectedLines, numberLines: nums.length, continuous, startsAtOne };
  });
}

async function getEditorHtml(page) {
  return page.$eval('#editor', (el) => el.innerHTML || '');
}

async function setEditorHtml(page, html) {
  await page.evaluate((nextHtml) => {
    const editor = document.getElementById('editor');
    if (!editor) return;
    editor.innerHTML = nextHtml;
    editor.focus();
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }, html);
}

async function appendParagraph(page, text) {
  await page.evaluate((value) => {
    const editor = document.getElementById('editor');
    if (!editor) return;
    const safe = String(value || '');
    editor.innerHTML = (editor.innerHTML || '') + `<div>${safe}</div>`;
    editor.focus();
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

async function selectFirstTextRange(page, start, end) {
  await page.evaluate(({ s, e }) => {
    const editor = document.getElementById('editor');
    if (!editor) return;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
    const node = walker.nextNode();
    if (!node) return;
    const max = node.nodeValue ? node.nodeValue.length : 0;
    const from = Math.max(0, Math.min(s, max));
    const to = Math.max(from, Math.min(e, max));
    const range = document.createRange();
    range.setStart(node, from);
    range.setEnd(node, to);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }, { s: start, e: end });
}

async function waitForHtmlConvergence(pageA, pageB, predicate = () => true, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const [htmlA, htmlB] = await Promise.all([getEditorHtml(pageA), getEditorHtml(pageB)]);
    if (htmlA === htmlB && predicate(htmlA)) {
      return { ok: true, html: htmlA };
    }
    await sleep(200);
  }
  const [htmlA, htmlB] = await Promise.all([getEditorHtml(pageA), getEditorHtml(pageB)]);
  return { ok: false, htmlA, htmlB };
}

async function waitForLinkOnBoth(pageA, pageB, timeoutMs = 15000) {
  const hrefOk = (html) => /<a[^>]+href="https:\/\/example\.com\/?"/i.test(String(html || ''));
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const [htmlA, htmlB] = await Promise.all([getEditorHtml(pageA), getEditorHtml(pageB)]);
    if (hrefOk(htmlA) && hrefOk(htmlB)) return { ok: true, htmlA, htmlB };
    await sleep(200);
  }
  const [htmlA, htmlB] = await Promise.all([getEditorHtml(pageA), getEditorHtml(pageB)]);
  return { ok: false, htmlA, htmlB };
}

async function dismissOpenLinkModal(page) {
  if (!page) return;
  const isOpen = await page.evaluate(() => {
    const modal = document.getElementById('linkModal');
    return !!(modal && !modal.hidden);
  });
  if (!isOpen) return;
  await page.click('#cancelLinkModal');
  await page.waitForTimeout(80);
}

async function runListExitFlowScenario(pageA, pageB, buttonSelector, listTag, baseText, afterText) {
  await setEditorHtml(pageA, `<p>${baseText}</p>`);
  const baseSync = await waitForHtmlConvergence(pageA, pageB, (html) => html.includes(baseText));
  if (!baseSync.ok) return { ok: false, detail: 'base sync failed', state: baseSync };

  await selectFirstTextRange(pageA, 0, baseText.length);
  await pageA.click(buttonSelector);
  const listOn = await waitForHtmlConvergence(pageA, pageB, (html) => new RegExp(`<${listTag}\\b`, 'i').test(html));
  if (!listOn.ok) return { ok: false, detail: 'list on failed', state: listOn };

  await selectFirstTextRange(pageA, 0, baseText.length);
  await pageA.click(buttonSelector);
  const listOff = await waitForHtmlConvergence(
    pageA,
    pageB,
    (html) => !/<ul\b|<ol\b/i.test(html) && html.includes(baseText) && !/Eintrag/i.test(html)
  );
  if (!listOff.ok) return { ok: false, detail: 'list off failed', state: listOff };

  await pageA.focus('#editor');
  await pageA.keyboard.press('End');
  await pageA.keyboard.press('Enter');
  await pageA.keyboard.type(afterText);
  await sleep(900);

  const afterTyping = await waitForHtmlConvergence(
    pageA,
    pageB,
    (html) => !/<ul\b|<ol\b/i.test(html) && html.includes(baseText) && html.includes(afterText) && !/Eintrag/i.test(html)
  );
  const linesA = await waitForLineConsistency(pageA);
  const linesB = await waitForLineConsistency(pageB);
  const ok =
    afterTyping.ok
    && linesA.ok
    && linesB.ok
    && linesA.metrics.numberLines >= 2
    && linesB.metrics.numberLines >= 2;

  return {
    ok,
    detail: afterTyping.ok
      ? `html=${afterTyping.html.slice(0, 160)} linesA=${JSON.stringify(linesA.metrics)} linesB=${JSON.stringify(linesB.metrics)}`
      : `${afterTyping.detail || 'typing sync failed'} A=${String(afterTyping.htmlA || '').slice(0, 120)} | B=${String(afterTyping.htmlB || '').slice(0, 120)}`
  };
}

async function waitForLineConsistency(page, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const m = await getLineMetrics(page);
    if (m.startsAtOne && m.continuous && m.numberLines === m.expectedLines) return { ok: true, metrics: m };
    await sleep(200);
  }
  return { ok: false, metrics: await getLineMetrics(page) };
}

async function waitForRemoteCursor(page, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await page.evaluate(() => {
      const editor = document.getElementById('editor');
      const layer = document.getElementById('collabCursors');
      if (!editor || !layer) return { count: 0, inBounds: false };
      const er = editor.getBoundingClientRect();
      const carets = Array.from(layer.children || []);
      if (!carets.length) return { count: 0, inBounds: false };
      const inBounds = carets.some((c) => {
        const r = c.getBoundingClientRect();
        return r.top >= er.top - 30 && r.top <= er.bottom + 30 && r.left >= er.left - 40 && r.left <= er.right + 40;
      });
      return { count: carets.length, inBounds };
    });
    if (info.count > 0 && info.inBounds) return { ok: true, info };
    await sleep(200);
  }
  return {
    ok: false,
    info: await page.evaluate(() => {
      const layer = document.getElementById('collabCursors');
      return { count: layer?.children?.length || 0, inBounds: false };
    })
  };
}

async function runForEngine(engineName, browserType) {
  const results = [];
  const log = (message) => {
    if (VERBOSE) console.log(`[${engineName}] ${message}`);
  };
  const browser = await launchBrowserForEngine(engineName, browserType);
  try {
    const scenarioPromise = (async () => {
      const contextA = await browser.newContext();
      const contextB = SIM_MODE ? contextA : await browser.newContext();
      if (!SIM_MODE && APP_CHECK_DEBUG_TOKEN) {
        log('injecting App Check debug token');
        const injectDebugToken = async (context) => {
          await context.addInitScript((token) => {
            window.__MZ_APPCHECK_DEBUG_TOKEN__ = token;
            self.FIREBASE_APPCHECK_DEBUG_TOKEN = token;
          }, APP_CHECK_DEBUG_TOKEN);
        };
        await injectDebugToken(contextA);
        if (contextB !== contextA) await injectDebugToken(contextB);
      }
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      pageA.setDefaultTimeout(15_000);
      pageB.setDefaultTimeout(15_000);

      try {
        const shareUrl = await createSpaceUrl();
        log(`share url ready: ${shareUrl}`);
        await pageA.goto(shareUrl, { waitUntil: 'domcontentloaded' });
        await pageB.goto(shareUrl, { waitUntil: 'domcontentloaded' });
        log('pages loaded');
        await Promise.all([pageA.waitForSelector('#editor'), pageB.waitForSelector('#editor')]);
        await Promise.all([
          pageA.waitForFunction(() => window.__MZ_COLLAB_READY__ === true, null, { timeout: 20_000 }),
          pageB.waitForFunction(() => window.__MZ_COLLAB_READY__ === true, null, { timeout: 20_000 })
        ]);
        log('editors and collab ready');
        await sleep(600);

        await pageA.evaluate(() => {
      const editor = document.getElementById('editor');
      if (!editor) return;
      editor.innerHTML = '';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await sleep(250);

        log('running concurrent typing scenario');
        // Two users typing concurrently.
        await Promise.all([
      pageA.focus('#editor'),
      pageB.focus('#editor')
        ]);
        await Promise.all([
      pageA.keyboard.type('alpha\nbeta\ngamma'),
      pageB.keyboard.type('eins\nzwei\ndrei')
        ]);
        await sleep(1500);

        const linesA = await waitForLineConsistency(pageA);
        const linesB = await waitForLineConsistency(pageB);
        results.push({
      name: `${engineName}: line numbers page A`,
      pass: linesA.ok,
      detail: JSON.stringify(linesA.metrics)
    });
    results.push({
      name: `${engineName}: line numbers page B`,
      pass: linesB.ok,
      detail: JSON.stringify(linesB.metrics)
    });

        const htmlA = await getEditorHtml(pageA);
        const htmlB = await getEditorHtml(pageB);
        results.push({
      name: `${engineName}: content converges`,
      pass: htmlA === htmlB,
      detail: `A=${htmlA.slice(0, 120)} | B=${htmlB.slice(0, 120)}`
    });

        log('running sequential convergence scenario');
        await appendParagraph(pageA, 'LEFTSEQ');
        await sleep(700);
        await appendParagraph(pageB, 'RIGHTSEQ');
        await sleep(1400);
        const htmlSeqA = await getEditorHtml(pageA);
        const htmlSeqB = await getEditorHtml(pageB);
        const sequentialConverged = htmlSeqA === htmlSeqB && /LEFTSEQ/.test(htmlSeqA) && /RIGHTSEQ/.test(htmlSeqA);
        results.push({
      name: `${engineName}: sequential edits converge`,
      pass: sequentialConverged,
      detail: `A=${htmlSeqA.slice(0, 140)} | B=${htmlSeqB.slice(0, 140)}`
    });

        log('running enter blank-line scenario');
        await setEditorHtml(pageA, '<p>EnterTest</p>');
        const resetAfterEnter = await waitForHtmlConvergence(pageA, pageB, (html) => /EnterTest/.test(html));
        await pageA.focus('#editor');
        await pageA.keyboard.press('End');
        await pageA.keyboard.press('Enter');
        await pageA.keyboard.press('Enter');
        await sleep(900);
        const enterSync = await waitForHtmlConvergence(pageA, pageB, () => true);
        const enterLinesA = await waitForLineConsistency(pageA);
        const enterLinesB = await waitForLineConsistency(pageB);
        const enoughBlankLines =
      enterSync.ok
      && enterLinesA.ok
      && enterLinesB.ok
      && enterLinesA.metrics.numberLines >= 3
      && enterLinesB.metrics.numberLines >= 3;
        results.push({
      name: `${engineName}: enter blank lines sync`,
      pass: !!resetAfterEnter.ok && enoughBlankLines,
      detail: enterSync.ok
        ? `html=${enterSync.html.slice(0, 140)} linesA=${JSON.stringify(enterLinesA.metrics)} linesB=${JSON.stringify(enterLinesB.metrics)}`
        : `A=${String(enterSync.htmlA || '').slice(0, 140)} | B=${String(enterSync.htmlB || '').slice(0, 140)}`
    });

        log('running list toggle scenarios');
        await setEditorHtml(pageA, '<p>Bullet Item</p>');
        await waitForHtmlConvergence(pageA, pageB, (html) => /Bullet Item/.test(html));
        await selectFirstTextRange(pageA, 0, 11);
        await pageA.click('button[data-cmd="insertUnorderedList"]');
        const bulletOn = await waitForHtmlConvergence(pageA, pageB, (html) => /<ul/i.test(html));
        await selectFirstTextRange(pageA, 0, 11);
        await pageA.click('button[data-cmd="insertUnorderedList"]');
        const bulletOff = await waitForHtmlConvergence(pageA, pageB, (html) => !/<ul/i.test(html) && /Bullet Item/.test(html));
        results.push({
      name: `${engineName}: bullet toggle sync`,
      pass: bulletOn.ok && bulletOff.ok,
      detail: bulletOff.ok
        ? bulletOff.html.slice(0, 140)
        : `on=${String(bulletOn.htmlA || bulletOn.html || '').slice(0, 100)} offA=${String(bulletOff.htmlA || '').slice(0, 100)} offB=${String(bulletOff.htmlB || '').slice(0, 100)}`
    });

        await setEditorHtml(pageA, '<p>Number Item</p>');
        await waitForHtmlConvergence(pageA, pageB, (html) => /Number Item/.test(html));
        await selectFirstTextRange(pageA, 0, 11);
        await pageA.click('button[data-cmd="insertOrderedList"]');
        const orderedOn = await waitForHtmlConvergence(pageA, pageB, (html) => /<ol/i.test(html));
        await selectFirstTextRange(pageA, 0, 11);
        await pageA.click('button[data-cmd="insertOrderedList"]');
        const orderedOff = await waitForHtmlConvergence(pageA, pageB, (html) => !/<ol/i.test(html) && /Number Item/.test(html));
        results.push({
      name: `${engineName}: numbered toggle sync`,
      pass: orderedOn.ok && orderedOff.ok,
      detail: orderedOff.ok
        ? orderedOff.html.slice(0, 140)
        : `on=${String(orderedOn.htmlA || orderedOn.html || '').slice(0, 100)} offA=${String(orderedOff.htmlA || '').slice(0, 100)} offB=${String(orderedOff.htmlB || '').slice(0, 100)}`
    });

        log('running list-exit scenarios');
        const bulletExitFlow = await runListExitFlowScenario(
      pageA,
      pageB,
      'button[data-cmd="insertUnorderedList"]',
      'ul',
      'BulletFlow',
      'WeiterOhneBullet'
    );
        results.push({
      name: `${engineName}: bullet off then enter stays plain`,
      pass: bulletExitFlow.ok,
      detail: bulletExitFlow.detail
    });

        const orderedExitFlow = await runListExitFlowScenario(
      pageA,
      pageB,
      'button[data-cmd="insertOrderedList"]',
      'ol',
      'OrderedFlow',
      'WeiterOhneNummer'
    );
        results.push({
      name: `${engineName}: ordered off then enter stays plain`,
      pass: orderedExitFlow.ok,
      detail: orderedExitFlow.detail
    });

        log('running link sync scenario');
        await setEditorHtml(pageA, '<p>Link Text</p>');
        await waitForHtmlConvergence(pageA, pageB, (html) => /Link Text/.test(html));
        await selectFirstTextRange(pageA, 0, 9);
        await pageA.click('button[data-cmd="createLink"]');
        await pageA.fill('#linkUrlInput', 'https://example.com');
        await pageA.click('#saveLinkModal');
        const linkSync = await waitForLinkOnBoth(pageA, pageB);
        const beforeUrlB = pageB.url();
        let popupB = null;
        let afterUrlB = beforeUrlB;
        if (linkSync.ok) {
          await dismissOpenLinkModal(pageA);
          await dismissOpenLinkModal(pageB);
          const popupOnB = pageB.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
          await pageB.click('#editor a[href]');
          popupB = await popupOnB;
          await sleep(200);
          afterUrlB = pageB.url();
        }
        if (popupB) await popupB.close().catch(() => {});
        results.push({
      name: `${engineName}: link sync and open on page B`,
      pass: linkSync.ok && !!popupB && beforeUrlB === afterUrlB,
      detail: linkSync.ok
        ? `popup=${!!popupB} before==after=${beforeUrlB === afterUrlB}`
        : `A=${String(linkSync.htmlA || '').slice(0, 120)} | B=${String(linkSync.htmlB || '').slice(0, 120)}`
    });

        log('running remote cursor scenario');
        const cursorA = await waitForRemoteCursor(pageA);
        const cursorB = await waitForRemoteCursor(pageB);
        results.push({
      name: `${engineName}: remote cursor page A`,
      pass: cursorA.ok,
      detail: JSON.stringify(cursorA.info)
    });
        results.push({
      name: `${engineName}: remote cursor page B`,
      pass: cursorB.ok,
      detail: JSON.stringify(cursorB.info)
    });

    // Link click should open one new tab and keep current page URL.
        log('running final link popup scenario');
        await pageA.evaluate(() => {
      const editor = document.getElementById('editor');
      if (!editor) return;
      editor.innerHTML = '<p><a href="https://example.com">Example</a></p>';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
        await dismissOpenLinkModal(pageA);
        const beforeUrl = pageA.url();
        const popupPromise = pageA.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
        await pageA.click('#editor a[href]');
        const popup = await popupPromise;
        await sleep(200);
        const afterUrl = pageA.url();
        const onePopup = !!popup;
        if (popup) await popup.close().catch(() => {});

        results.push({
      name: `${engineName}: link opens new tab only`,
      pass: onePopup && beforeUrl === afterUrl,
      detail: `popup=${onePopup} before=${beforeUrl} after=${afterUrl}`
    });

        log('closing pages');
        await pageA.close();
        await pageB.close();
        if (contextB !== contextA) {
          await contextB.close();
        }
        await contextA.close();
        return results;
      } finally {
        if (!pageA.isClosed()) await pageA.close().catch(() => {});
        if (!pageB.isClosed()) await pageB.close().catch(() => {});
        if (contextB !== contextA) {
          await contextB.close().catch(() => {});
        }
        await contextA.close().catch(() => {});
      }
    })();

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${engineName} timed out after ${ENGINE_TIMEOUT_MS}ms`)), ENGINE_TIMEOUT_MS);
    });
    return await Promise.race([scenarioPromise, timeoutPromise]);
  } finally {
    await browser.close();
  }
}

async function main() {
  const all = [];
  const requestedEngines = String(process.env.ENGINES || 'chromium,webkit')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const engines = [
    ['chromium', chromium],
    ['webkit', webkit]
  ].filter(([name]) => requestedEngines.includes(name));

  for (const [name, browserType] of engines) {
    try {
      all.push(...(await runForEngine(name, browserType)));
    } catch (e) {
      all.push({ name: `${name} run`, pass: false, detail: String(e && e.message ? e.message : e) });
    }
  }

  const passed = all.filter((r) => r.pass).length;
  console.log(`Multiplayer checks: ${passed}/${all.length} passed`);
  all.forEach((r) => console.log(summarize(r.name, r.pass, r.detail)));
  process.exit(passed === all.length ? 0 : 1);
}

main().catch((err) => {
  console.error('Multiplayer checks crashed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
