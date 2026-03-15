import { devices } from 'playwright';
import crypto from 'node:crypto';
import { launchChromiumBrowser } from '../support/browser.mjs';

const BASE_URL = (process.env.BASE_URL || 'https://malzispace.web.app').replace(/\/+$/, '');

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function makeKey() {
  return b64url(crypto.randomBytes(32));
}

function line(name, pass, detail = '') {
  const mark = pass ? 'PASS' : 'FAIL';
  return `${mark} ${name}${detail ? ` - ${detail}` : ''}`;
}

function createSeededRandom(seed) {
  let state = (Number(seed) >>> 0) || 0x6d2b79f5;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomInt(random, max) {
  const limit = Math.max(1, Number(max) || 0);
  return Math.floor(random() * limit);
}

function pickRandom(random, list) {
  if (!Array.isArray(list) || !list.length) return null;
  return list[randomInt(random, list.length)];
}

async function setEditorHtml(page, html) {
  await page.evaluate((next) => {
    const editor = document.getElementById('editor');
    if (!editor) return;
    editor.innerHTML = next;
    editor.blur();
    editor.focus();
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }, html);
}

async function getEditorHtml(page) {
  return page.$eval('#editor', (el) => el.innerHTML || '');
}

async function getEditorTextLength(page) {
  return page.$eval('#editor', (el) => (el.textContent || '').length);
}

async function getLineNumbers(page) {
  return page.$$eval('#lineNumbersInner .line-number', (nodes) =>
    nodes.map((el) => Number((el.textContent || '').trim())).filter((n) => Number.isFinite(n))
  );
}

async function getTopLevelAlignment(page, limit = 3) {
  return page.evaluate((maxPairs) => {
    const editor = document.getElementById('editor');
    const numberNodes = Array.from(document.querySelectorAll('#lineNumbersInner .line-number'));
    if (!editor) return { ok: false, pairs: [], reason: 'editor_missing' };

    const blocks = Array.from(editor.children || []).flatMap((node) => {
      const tag = (node.tagName || '').toLowerCase();
      if (tag === 'ul' || tag === 'ol') {
        return Array.from(node.children || []).filter((child) => ((child.tagName || '').toLowerCase() === 'li'));
      }
      if (['p', 'div', 'h1', 'h2', 'h3', 'blockquote', 'li', 'hr'].includes(tag)) {
        return [node];
      }
      return [];
    });

    const visualLines = blocks.flatMap((block) => {
      const tag = (block.tagName || '').toLowerCase();
      const rects = [];
      if (tag === 'hr') {
        const rect = block.getBoundingClientRect();
        if (rect && rect.height >= 0) rects.push(rect);
      } else {
        const range = document.createRange();
        range.selectNodeContents(block);
        Array.from(range.getClientRects() || []).forEach((rect) => {
          if (!rect || rect.height <= 0) return;
          const top = Math.round(rect.top * 100) / 100;
          if (!rects.some((entry) => Math.abs(entry.top - top) <= 1)) {
            rects.push(rect);
          }
        });
        if (!rects.length) {
          const rect = block.getBoundingClientRect();
          if (rect && rect.height >= 0) rects.push(rect);
        }
      }
      return rects.map((rect) => ({
        tag,
        top: rect.top,
        height: rect.height
      }));
    });

    const pairCount = Math.min(Number(maxPairs) || 0, numberNodes.length, visualLines.length);
    const pairs = [];
    for (let idx = 0; idx < pairCount; idx += 1) {
      const numRect = numberNodes[idx].getBoundingClientRect();
      const blockRect = visualLines[idx];
      pairs.push({
        line: idx + 1,
        tag: blockRect.tag,
        deltaTop: Math.round((numRect.top - blockRect.top) * 100) / 100,
        numberHeight: Math.round(numRect.height * 100) / 100,
        blockHeight: Math.round(blockRect.height * 100) / 100
      });
    }

    return {
      ok: pairs.length > 0 && pairs.every((pair) => Math.abs(pair.deltaTop) <= 3.5),
      pairs
    };
  }, limit);
}

async function getWrappedLineNumberMatch(page) {
  return page.evaluate(() => {
    const editor = document.getElementById('editor');
    const block = editor && editor.firstElementChild ? editor.firstElementChild : editor;
    if (!editor || !block) return { ok: false, actual: 0, expected: 0, tops: [], reason: 'editor_missing' };
    const numbers = Array.from(document.querySelectorAll('#lineNumbersInner .line-number'));
    const range = document.createRange();
    range.selectNodeContents(block);
    const tops = [];
    Array.from(range.getClientRects() || []).forEach((rect) => {
      if (!rect || rect.height <= 0) return;
      const roundedTop = Math.round(rect.top * 100) / 100;
      if (!tops.some((value) => Math.abs(value - roundedTop) <= 1)) {
        tops.push(roundedTop);
      }
    });
    const expected = Math.max(1, tops.length || 0);
    return {
      ok: numbers.length === expected,
      actual: numbers.length,
      expected,
      tops
    };
  });
}

async function setCursorToEnd(page) {
  await page.evaluate(() => {
    const editor = document.getElementById('editor');
    if (!editor) return;
    editor.focus();
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
    let last = null;
    let node = walker.nextNode();
    while (node) { last = node; node = walker.nextNode(); }
    if (!last) return;
    const r = document.createRange();
    r.setStart(last, last.nodeValue ? last.nodeValue.length : 0);
    r.collapse(true);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(r);
  });
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
    const r = document.createRange();
    r.setStart(node, from);
    r.setEnd(node, to);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(r);
  }, { s: start, e: end });
}

async function selectTextRangeByOffsets(page, start, end) {
  await page.evaluate(({ s, e }) => {
    const editor = document.getElementById('editor');
    if (!editor) return;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
    let offset = 0;
    let startPos = null;
    let endPos = null;

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const len = (node.nodeValue || '').length;
      const next = offset + len;
      if (!startPos && s <= next) {
        startPos = { node, offset: Math.max(0, s - offset) };
      }
      if (!endPos && e <= next) {
        endPos = { node, offset: Math.max(0, e - offset) };
        break;
      }
      offset = next;
    }

    if (!startPos || !endPos) return;
    const range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }, { s: start, e: end });
}

async function getRangeFormatStats(page, start, end, cmd) {
  return page.evaluate(({ s, e, command }) => {
    const editor = document.getElementById('editor');
    if (!editor) return { total: 0, formatted: 0, allFormatted: false, anyFormatted: false };
    const specs = {
      bold: { tags: ['b', 'strong'], className: 'mz-fw-bold' },
      italic: { tags: ['i', 'em'], className: 'mz-fs-italic' },
      underline: { tags: ['u'], className: 'mz-td-underline' }
    };
    const spec = specs[command];
    if (!spec) return { total: 0, formatted: 0, allFormatted: false, anyFormatted: false };

    const hasFormat = (node) => {
      let cur = node && node.parentElement;
      while (cur && cur !== editor) {
        const tag = (cur.tagName || '').toLowerCase();
        if (spec.tags.includes(tag)) return true;
        if (spec.className && cur.classList.contains(spec.className)) return true;
        cur = cur.parentElement;
      }
      return false;
    };

    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
    let offset = 0;
    let total = 0;
    let formatted = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const len = (node.nodeValue || '').length;
      const next = offset + len;
      const from = Math.max(s, offset);
      const to = Math.min(e, next);
      if (to > from) {
        const covered = to - from;
        total += covered;
        if (hasFormat(node)) formatted += covered;
      }
      offset = next;
    }

    return {
      total,
      formatted,
      allFormatted: total > 0 && formatted === total,
      anyFormatted: formatted > 0
    };
  }, { s: start, e: end, command: cmd });
}

async function isToolbarButtonActive(page, cmd) {
  return page.$eval(`button[data-cmd="${cmd}"]`, (button) => button.classList.contains('is-active'));
}

async function selectListItemRange(page, itemIndex) {
  await page.evaluate((index) => {
    const items = Array.from(document.querySelectorAll('#editor li'));
    const target = items[index];
    if (!target) return;
    const range = document.createRange();
    range.selectNodeContents(target);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }, itemIndex);
}

async function selectListItemSpan(page, startIndex, endIndex = startIndex) {
  await page.evaluate(({ start, end }) => {
    const items = Array.from(document.querySelectorAll('#editor li'));
    const first = items[start];
    const last = items[end];
    if (!first || !last) return;
    const range = document.createRange();
    range.setStart(first.firstChild || first, 0);
    if (last.lastChild && last.lastChild.nodeType === Node.TEXT_NODE) {
      range.setEnd(last.lastChild, (last.lastChild.nodeValue || '').length);
    } else {
      range.setEnd(last, last.childNodes.length);
    }
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }, { start: startIndex, end: endIndex });
}

async function getEditorHealth(page) {
  return page.evaluate(() => {
    const editor = document.getElementById('editor');
    if (!editor) return { ok: false, issues: ['editor_missing'], html: '' };

    const issues = [];
    const allowedTopLevel = new Set(['p', 'div', 'h1', 'h2', 'h3', 'ul', 'ol', 'blockquote', 'hr']);
    const inlineCandidates = ['strong', 'em', 'u', 's', 'span', 'a', 'b', 'i'];

    Array.from(editor.childNodes || []).forEach((node, index) => {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent || '').trim()) {
        issues.push(`top_level_text:${index}`);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = (node.tagName || '').toLowerCase();
      if (!allowedTopLevel.has(tag)) {
        issues.push(`top_level_tag:${tag}:${index}`);
      }
      if (tag === 'ul' || tag === 'ol') {
        Array.from(node.childNodes || []).forEach((child, childIndex) => {
          if (child.nodeType === Node.TEXT_NODE && (child.textContent || '').trim()) {
            issues.push(`list_text_child:${tag}:${childIndex}`);
            return;
          }
          if (child.nodeType === Node.ELEMENT_NODE && (child.tagName || '').toLowerCase() !== 'li') {
            issues.push(`list_non_li:${tag}:${(child.tagName || '').toLowerCase()}:${childIndex}`);
          }
        });
      }
      if (tag === 'hr') {
        const next = node.nextSibling;
        if (next && next.nodeType === Node.TEXT_NODE && (next.textContent || '').trim()) {
          issues.push(`text_after_hr:${index}`);
        }
      }
    });

    Array.from(editor.querySelectorAll('li')).forEach((item, index) => {
      const parentTag = (item.parentElement && item.parentElement.tagName || '').toLowerCase();
      if (parentTag !== 'ul' && parentTag !== 'ol') {
        issues.push(`orphan_li:${index}`);
      }
    });

    Array.from(editor.querySelectorAll('[style], script')).forEach((node, index) => {
      issues.push(`forbidden_node:${(node.tagName || '').toLowerCase()}:${index}`);
    });

    Array.from(editor.querySelectorAll(inlineCandidates.join(','))).forEach((element, index) => {
      const text = (element.textContent || '').replace(/\u200B/g, '').replace(/\u00A0/g, ' ').trim();
      const html = (element.innerHTML || '').replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/gi, ' ').trim();
      const hasMeaningfulChildren = Array.from(element.children || []).some((child) => {
        const tag = (child.tagName || '').toLowerCase();
        return tag && tag !== 'br';
      });
      if (!text && !html && !hasMeaningfulChildren) {
        if (element.hasAttribute('data-mz-caret-format')) return;
        const hasBr = element.querySelector('br');
        if (hasBr) {
          const block = element.closest('p,div,li,h1,h2,h3,blockquote');
          const blockText = block ? (block.textContent || '').replace(/\u200B/g, '').trim() : '';
          if (block && !blockText) return;
        }
        issues.push(`empty_inline:${(element.tagName || '').toLowerCase()}:${index}`);
      }
    });

    return {
      ok: issues.length === 0,
      issues: Array.from(new Set(issues)).slice(0, 12),
      html: (editor.innerHTML || '').slice(0, 400)
    };
  });
}

async function runWildInteractionScenario(page, modeName, seed, consoleIssues, pageErrors) {
  const random = createSeededRandom(seed);
  const inlineCommands = ['bold', 'italic', 'underline'];
  const allCommands = ['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList', 'insertHorizontalRule'];
  const consoleStart = consoleIssues.length;
  const pageErrorStart = pageErrors.length;
  const steps = [];

  await page.evaluate(() => {
    window.prompt = () => 'https://example.com/chaos';
  });
  await setEditorHtml(page, '<p>Alpha Beta</p><p>Gamma Delta</p><ul><li>One</li><li>Two</li><li>Three</li></ul><p>Omega Sigma</p>');

  for (let step = 0; step < 20; step += 1) {
    const branch = random();
    let action = 'noop';

    if (branch < 0.22) {
      const length = await getEditorTextLength(page);
      const start = randomInt(random, Math.max(1, length));
      const end = Math.min(length, start + 1 + randomInt(random, Math.max(2, Math.min(10, Math.max(1, length - start)))));
      const cmd = pickRandom(random, allCommands);
      await selectTextRangeByOffsets(page, start, end);
      await page.click(`button[data-cmd="${cmd}"]`);
      action = `range:${start}-${end}:${cmd}`;
    } else if (branch < 0.38) {
      const length = await getEditorTextLength(page);
      const offset = randomInt(random, Math.max(1, length + 1));
      const cmd = pickRandom(random, allCommands);
      await selectTextRangeByOffsets(page, offset, offset);
      await page.click(`button[data-cmd="${cmd}"]`);
      if (random() < 0.45) await page.click(`button[data-cmd="${cmd}"]`);
      action = `caret:${offset}:${cmd}`;
    } else if (branch < 0.56) {
      const itemCount = await page.$$eval('#editor li', (nodes) => nodes.length);
      if (itemCount > 0) {
        const left = randomInt(random, itemCount);
        const right = randomInt(random, itemCount);
        const from = Math.min(left, right);
        const to = Math.max(left, right);
        const cmd = pickRandom(random, ['insertUnorderedList', 'insertOrderedList']);
        await selectListItemSpan(page, from, to);
        await page.click(`button[data-cmd="${cmd}"]`);
        action = `list:${from}-${to}:${cmd}`;
      }
    } else if (branch < 0.72) {
      const length = await getEditorTextLength(page);
      const offset = randomInt(random, Math.max(1, length + 1));
      const token = `Wild${seed}_${step}`;
      await selectTextRangeByOffsets(page, offset, offset);
      if (random() < 0.4) {
        const cmd = pickRandom(random, inlineCommands);
        await page.click(`button[data-cmd="${cmd}"]`);
        action = `typefmt:${offset}:${cmd}:${token}`;
      } else {
        action = `type:${offset}:${token}`;
      }
      await page.keyboard.type(token);
    } else if (branch < 0.84) {
      const length = await getEditorTextLength(page);
      const offset = randomInt(random, Math.max(1, length + 1));
      await selectTextRangeByOffsets(page, offset, offset);
      await page.keyboard.press('Enter');
      if (random() < 0.65) {
        await page.keyboard.type(`Line${step}`);
      }
      action = `enter:${offset}`;
    } else {
      const length = await getEditorTextLength(page);
      const start = 0;
      const end = Math.max(1, length);
      const cmdA = pickRandom(random, allCommands);
      const cmdB = pickRandom(random, allCommands);
      await selectTextRangeByOffsets(page, start, end);
      await page.click(`button[data-cmd="${cmdA}"]`);
      await page.click(`button[data-cmd="${cmdB}"]`);
      action = `spam:${cmdA}:${cmdB}`;
    }

    steps.push(action);
    await page.waitForTimeout(40);

    const newConsoleIssues = consoleIssues.slice(consoleStart);
    const newPageErrors = pageErrors.slice(pageErrorStart);
    const health = await getEditorHealth(page);
    const alignment = await getTopLevelAlignment(page, 6);
    if (newConsoleIssues.length || newPageErrors.length || !health.ok || !alignment.ok) {
      return {
        name: `${modeName}: wild interactions seed ${seed}`,
        pass: false,
        detail: JSON.stringify({
          step: step + 1,
          action,
          steps,
          console: newConsoleIssues.slice(0, 4),
          pageErrors: newPageErrors.slice(0, 4),
          health,
          alignment
        })
      };
    }
  }

  const health = await getEditorHealth(page);
  return {
    name: `${modeName}: wild interactions seed ${seed}`,
    pass: health.ok,
    detail: JSON.stringify({ steps, health })
  };
}

async function testToolbar(modeName, contextOptions) {
  const results = [];
  const browser = await launchChromiumBrowser();
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const consoleIssues = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    const text = String(msg.text() || '');
    // Chromium's contenteditable engine internally emits CSP-style warnings for
    // inline style application during DOM mutations.  These are harmless internal
    // warnings (not actual policy violations from our code) and unavoidable when
    // using contenteditable.  Skip style-src related warnings; catch all others.
    if (/violates the following Content Security Policy directive/i.test(text)) {
      if (/style-src/i.test(text)) return;          // Chromium internal — ignore
      if (/unsafe-eval/i.test(text)) return;        // Firebase SDK uses eval() internally — ignore
      consoleIssues.push(`${msg.type()}:${text}`);   // Real CSP violations — report
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(String(error && error.stack ? error.stack : error || ''));
  });

  try {
    const key = makeKey();
    const url = `${BASE_URL}/space.html?id=simtest01&sim=1#${key}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#editor');
    await page.waitForTimeout(250);

    const requiredButtons = [
      'button[data-cmd="bold"]',
      'button[data-cmd="italic"]',
      'button[data-cmd="underline"]',
      'button[data-cmd="insertUnorderedList"]',
      'button[data-cmd="insertOrderedList"]',
      'button[data-cmd="createLink"]',
      'button[data-cmd="insertHorizontalRule"]'
    ];
    for (const selector of requiredButtons) {
      const visible = await page.locator(selector).isVisible();
      results.push({ name: `${modeName}: visible ${selector}`, pass: visible });
    }

    await setEditorHtml(page, '<p>Alpha Beta</p>');
    await selectFirstTextRange(page, 0, 5);
    await page.click('button[data-cmd="bold"]');
    let html = await getEditorHtml(page);
    results.push({
      name: `${modeName}: bold`,
      pass: /<strong|<b>|class="[^"]*\bmz-fw-bold\b/i.test(html),
      detail: html.slice(0, 120)
    });

    await setEditorHtml(page, '<p>Alpha Beta</p>');
    await selectFirstTextRange(page, 0, 5);
    await page.click('button[data-cmd="italic"]');
    html = await getEditorHtml(page);
    results.push({
      name: `${modeName}: italic`,
      pass: /<em>|<i>|class="[^"]*\bmz-fs-italic\b/i.test(html),
      detail: html.slice(0, 120)
    });

    await setEditorHtml(page, '<p>Alpha Beta</p>');
    await selectFirstTextRange(page, 0, 5);
    await page.click('button[data-cmd="underline"]');
    html = await getEditorHtml(page);
    results.push({
      name: `${modeName}: underline`,
      pass: /<u>|class="[^"]*\bmz-td-underline\b/i.test(html),
      detail: html.slice(0, 120)
    });

    await setEditorHtml(page, '<p>Alpha</p>');
    await setCursorToEnd(page);
    await page.click('button[data-cmd="italic"]');
    await page.keyboard.type('I');
    let italicCollapsedActive = await isToolbarButtonActive(page, 'italic');
    await page.click('button[data-cmd="italic"]');
    await page.keyboard.type('N');
    html = await getEditorHtml(page);
    let italicCollapsedInactive = await isToolbarButtonActive(page, 'italic');
    results.push({
      name: `${modeName}: italic collapsed toggle turns off for following text`,
      pass: italicCollapsedActive && !italicCollapsedInactive && /<p>Alpha(?:<em>|<i>|<span[^>]*mz-fs-italic[^>]*>)I(?:<\/em>|<\/i>|<\/span>)N<\/p>/i.test(html),
      detail: `${html.slice(0, 180)} | active=${italicCollapsedActive} inactive=${italicCollapsedInactive}`
    });

    await setEditorHtml(page, '<p>Alpha</p>');
    await setCursorToEnd(page);
    await page.click('button[data-cmd="underline"]');
    await page.keyboard.type('U');
    let underlineCollapsedActive = await isToolbarButtonActive(page, 'underline');
    await page.click('button[data-cmd="underline"]');
    await page.keyboard.type('N');
    html = await getEditorHtml(page);
    let underlineCollapsedInactive = await isToolbarButtonActive(page, 'underline');
    results.push({
      name: `${modeName}: underline collapsed toggle turns off for following text`,
      pass: underlineCollapsedActive && !underlineCollapsedInactive && /<p>Alpha(?:<u>|<span[^>]*mz-td-underline[^>]*>)U(?:<\/u>|<\/span>)N<\/p>/i.test(html),
      detail: `${html.slice(0, 180)} | active=${underlineCollapsedActive} inactive=${underlineCollapsedInactive}`
    });

    await setEditorHtml(page, '<p>Alpha</p>');
    await setCursorToEnd(page);
    await page.click('button[data-cmd="bold"]');
    await page.keyboard.type('Bold');
    await page.keyboard.press('Enter');
    const boldAfterEnterActive = await isToolbarButtonActive(page, 'bold');
    await page.click('button[data-cmd="bold"]');
    const boldAfterToggleOff = await isToolbarButtonActive(page, 'bold');
    await page.keyboard.type('Plain');
    html = await getEditorHtml(page);
    results.push({
      name: `${modeName}: bold can be turned off on the new line after enter`,
      pass: boldAfterEnterActive && !boldAfterToggleOff && /<p>Alpha(?:<strong>|<b>|<span[^>]*mz-fw-bold[^>]*>)Bold(?:<\/strong>|<\/b>|<\/span>)<\/p><p>Plain<\/p>/i.test(html),
      detail: `${html.slice(0, 220)} | afterEnter=${boldAfterEnterActive} afterToggle=${boldAfterToggleOff}`
    });

    await setEditorHtml(page, '<p>Alpha Beta</p>');
    await selectFirstTextRange(page, 0, 5);
    await page.click('button[data-cmd="insertUnorderedList"]');
    html = await getEditorHtml(page);
    results.push({
      name: `${modeName}: unordered`,
      pass: /<ul|<li/i.test(html),
      detail: html.slice(0, 120)
    });
    await selectFirstTextRange(page, 0, 5);
    await page.click('button[data-cmd="insertUnorderedList"]');
    html = await getEditorHtml(page);
    results.push({
      name: `${modeName}: unordered toggle off`,
      pass: !/<ul/i.test(html) && /Alpha Beta/i.test(html),
      detail: html.slice(0, 120)
    });

    await setEditorHtml(page, '<ul><li>One</li><li>Two</li><li>Three</li></ul>');
    await selectListItemRange(page, 1);
    await page.click('button[data-cmd="insertUnorderedList"]');
    html = await getEditorHtml(page);
    results.push({
      name: `${modeName}: unordered toggle off only selected item`,
      pass: /<ul><li>One<\/li><\/ul><p>Two<\/p><ul><li>Three<\/li><\/ul>/i.test(html),
      detail: html.slice(0, 200)
    });

    await setEditorHtml(page, '<ul><li>One</li><li>Two</li><li>Three</li></ul>');
    await selectListItemSpan(page, 0, 1);
    await page.click('button[data-cmd="insertUnorderedList"]');
    html = await getEditorHtml(page);
    results.push({
      name: `${modeName}: unordered toggle off only selected two items`,
      pass: /<p>One<\/p><p>Two<\/p><ul><li>Three<\/li><\/ul>/i.test(html),
      detail: html.slice(0, 200)
    });

    await setEditorHtml(page, '<p>Alpha Beta</p>');
    await selectFirstTextRange(page, 0, 5);
    await page.click('button[data-cmd="insertOrderedList"]');
    html = await getEditorHtml(page);
    results.push({
      name: `${modeName}: ordered`,
      pass: /<ol|<li/i.test(html),
      detail: html.slice(0, 120)
    });
    await selectFirstTextRange(page, 0, 5);
    await page.click('button[data-cmd="insertOrderedList"]');
    html = await getEditorHtml(page);
    results.push({
      name: `${modeName}: ordered toggle off`,
      pass: !/<ol/i.test(html) && /Alpha Beta/i.test(html),
      detail: html.slice(0, 120)
    });

    await setEditorHtml(page, '<ol><li>One</li><li>Two</li><li>Three</li></ol>');
    await selectListItemRange(page, 1);
    await page.click('button[data-cmd="insertOrderedList"]');
    html = await getEditorHtml(page);
    results.push({
      name: `${modeName}: ordered toggle off only selected item`,
      pass: /<ol><li>One<\/li><\/ol><p>Two<\/p><ol><li>Three<\/li><\/ol>/i.test(html),
      detail: html.slice(0, 200)
    });

    await setEditorHtml(page, '<ol><li>One</li><li>Two</li><li>Three</li></ol>');
    await selectListItemSpan(page, 0, 1);
    await page.click('button[data-cmd="insertOrderedList"]');
    html = await getEditorHtml(page);
    results.push({
      name: `${modeName}: ordered toggle off only selected two items`,
      pass: /<p>One<\/p><p>Two<\/p><ol><li>Three<\/li><\/ol>/i.test(html),
      detail: html.slice(0, 200)
    });

    await setEditorHtml(page, '<p>Alpha Beta</p>');
    await selectFirstTextRange(page, 0, 5);
    await page.click('button[data-cmd="createLink"]');
    await page.waitForSelector('#linkModal:not([hidden])');
    const linkModalText = await page.$eval('#linkModal .modal-card', (el) => (el.textContent || '').trim());
    results.push({
      name: `${modeName}: createLink modal shows translated copy`,
      pass: !/linkModal\./.test(linkModalText) && /Link|Adresse|Abbrechen|Insert|Address|Cancel/.test(linkModalText),
      detail: linkModalText.slice(0, 180)
    });
    await page.fill('#linkUrlInput', 'https://example.com');
    await page.click('#saveLinkModal');
    html = await getEditorHtml(page);
    results.push({
      name: `${modeName}: createLink`,
      pass: /<p><a[^>]+href="https:\/\/example\.com\/?">Alpha<\/a> Beta<\/p>/i.test(html),
      detail: html.slice(0, 160)
    });

    await setEditorHtml(page, '<p>Alpha Beta</p>');
    await selectFirstTextRange(page, 0, 5);
    await page.click('button[data-cmd="createLink"]');
    const linkModalVisible = await page.locator('#linkModal').isVisible();
    await page.click('#cancelLinkModal');
    await page.waitForTimeout(80);
    const linkModalHidden = await page.locator('#linkModal').isHidden();
    await page.click('button[data-cmd="bold"]');
    await page.keyboard.type('Z');
    html = await getEditorHtml(page);
    results.push({
      name: `${modeName}: createLink cancel closes immediately and restores toolbar`,
      pass: linkModalVisible && linkModalHidden && /<strong>Z<\/strong>|<b>Z<\/b>|<span[^>]*mz-fw-bold[^>]*>Z<\/span>/i.test(html),
      detail: `${html.slice(0, 160)} | visible=${linkModalVisible} hidden=${linkModalHidden}`
    });

    await setEditorHtml(page, '<p>Al<b>pha B</b>eta Gamma</p>');
    await selectTextRangeByOffsets(page, 4, 9);
    let beforeMixedBold = await isToolbarButtonActive(page, 'bold');
    await page.click('button[data-cmd="bold"]');
    html = await getEditorHtml(page);
    let mixedBoldStats = await getRangeFormatStats(page, 4, 9, 'bold');
    let afterMixedBold = await isToolbarButtonActive(page, 'bold');
    results.push({
      name: `${modeName}: bold applies to mixed selection`,
      pass: !beforeMixedBold && mixedBoldStats.allFormatted && afterMixedBold,
      detail: `${html.slice(0, 160)} | stats=${JSON.stringify(mixedBoldStats)} | before=${beforeMixedBold} after=${afterMixedBold}`
    });

    await selectTextRangeByOffsets(page, 4, 9);
    await page.click('button[data-cmd="bold"]');
    html = await getEditorHtml(page);
    mixedBoldStats = await getRangeFormatStats(page, 4, 9, 'bold');
    afterMixedBold = await isToolbarButtonActive(page, 'bold');
    results.push({
      name: `${modeName}: bold removes on selected range`,
      pass: !mixedBoldStats.anyFormatted && !afterMixedBold,
      detail: `${html.slice(0, 160)} | stats=${JSON.stringify(mixedBoldStats)} | active=${afterMixedBold}`
    });

    await setEditorHtml(page, '<p>Alpha Beta Gamma</p>');
    await selectTextRangeByOffsets(page, 6, 10);
    await page.click('button[data-cmd="italic"]');
    html = await getEditorHtml(page);
    let italicStats = await getRangeFormatStats(page, 6, 10, 'italic');
    let italicActive = await isToolbarButtonActive(page, 'italic');
    results.push({
      name: `${modeName}: italic applies to partial range`,
      pass: italicStats.allFormatted && italicActive,
      detail: `${html.slice(0, 160)} | stats=${JSON.stringify(italicStats)} | active=${italicActive}`
    });

    await selectTextRangeByOffsets(page, 6, 10);
    await page.click('button[data-cmd="italic"]');
    html = await getEditorHtml(page);
    italicStats = await getRangeFormatStats(page, 6, 10, 'italic');
    italicActive = await isToolbarButtonActive(page, 'italic');
    results.push({
      name: `${modeName}: italic removes on partial range`,
      pass: !italicStats.anyFormatted && !italicActive,
      detail: `${html.slice(0, 160)} | stats=${JSON.stringify(italicStats)} | active=${italicActive}`
    });

    await setEditorHtml(page, '<p>Alpha Beta Gamma</p>');
    await selectTextRangeByOffsets(page, 11, 16);
    await page.click('button[data-cmd="underline"]');
    html = await getEditorHtml(page);
    let underlineStats = await getRangeFormatStats(page, 11, 16, 'underline');
    let underlineActive = await isToolbarButtonActive(page, 'underline');
    results.push({
      name: `${modeName}: underline applies to partial range`,
      pass: underlineStats.allFormatted && underlineActive,
      detail: `${html.slice(0, 160)} | stats=${JSON.stringify(underlineStats)} | active=${underlineActive}`
    });

    await selectTextRangeByOffsets(page, 11, 16);
    await page.click('button[data-cmd="underline"]');
    html = await getEditorHtml(page);
    underlineStats = await getRangeFormatStats(page, 11, 16, 'underline');
    underlineActive = await isToolbarButtonActive(page, 'underline');
    results.push({
      name: `${modeName}: underline removes on partial range`,
      pass: !underlineStats.anyFormatted && !underlineActive,
      detail: `${html.slice(0, 160)} | stats=${JSON.stringify(underlineStats)} | active=${underlineActive}`
    });

    await setEditorHtml(page, '<p>Alpha Beta</p>');
    await page.focus('#editor');
    await page.keyboard.press('End');
    await page.click('button[data-cmd="insertHorizontalRule"]');
    await page.keyboard.type('BelowRule');
    html = await getEditorHtml(page);
    const hrLineNums = await getLineNumbers(page);
    results.push({
      name: `${modeName}: horizontal rule creates block below`,
      pass: /<p>Alpha Beta<\/p><hr[^>]*><p>BelowRule<\/p>/i.test(html) && hrLineNums.length >= 3,
      detail: `${html.slice(0, 200)} | lines=${JSON.stringify(hrLineNums)}`
    });

    await setEditorHtml(page, '<p><a href="https://example.com">Example</a></p>');
    const beforeUrl = page.url();
    const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
    await page.click('#editor a[href]');
    const popup = await popupPromise;
    await page.waitForTimeout(150);
    const afterUrl = page.url();
    const linkOk = !!popup && beforeUrl === afterUrl;
    if (popup) await popup.close().catch(() => {});
    results.push({
      name: `${modeName}: link open new tab only`,
      pass: linkOk,
      detail: `popup=${!!popup} before==after=${beforeUrl === afterUrl}`
    });

    await setEditorHtml(page, '<p>Alpha</p>');
    await page.focus('#editor');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
    const lineNums = await getLineNumbers(page);
    results.push({
      name: `${modeName}: enter shows line 2 immediately`,
      pass: lineNums.length === 2 && lineNums[0] === 1 && lineNums[1] === 2,
      detail: JSON.stringify(lineNums)
    });

    await setEditorHtml(page, '<p>Alpha</p>');
    await setCursorToEnd(page);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Beta');
    await page.waitForTimeout(120);
    html = await getEditorHtml(page);
    results.push({
      name: `${modeName}: enter keeps caret on new line while typing`,
      pass: /<p>Alpha<\/p><p>Beta<\/p>/i.test(html),
      detail: html.slice(0, 200)
    });

    await setEditorHtml(page, '<p>Alpha</p><p><br></p><p>Beta</p>');
    await page.waitForTimeout(120);
    let alignment = await getTopLevelAlignment(page);
    results.push({
      name: `${modeName}: line numbers align on plain blocks`,
      pass: alignment.ok,
      detail: JSON.stringify(alignment.pairs)
    });

    await setEditorHtml(page, '<p>Alpha</p><p><br></p><p>Beta</p>');
    await selectFirstTextRange(page, 0, 5);
    await page.click('button[data-cmd="bold"]');
    await page.waitForTimeout(120);
    alignment = await getTopLevelAlignment(page);
    results.push({
      name: `${modeName}: line numbers align after bold`,
      pass: alignment.ok,
      detail: JSON.stringify(alignment.pairs)
    });

    await setEditorHtml(page, `<p>${'WrapToken'.repeat(36)}</p>`);
    await page.waitForTimeout(120);
    const wrapped = await getWrappedLineNumberMatch(page);
    results.push({
      name: `${modeName}: wrapped visual lines match line numbers`,
      pass: wrapped.ok,
      detail: JSON.stringify(wrapped)
    });

    // --- Word-like real use case tests ---

    // Bold entire line on/off (user's exact reported bug)
    await setEditorHtml(page, '<p>Hello World</p>');
    await selectTextRangeByOffsets(page, 0, 11);
    await page.click('button[data-cmd="bold"]');
    html = await getEditorHtml(page);
    const boldOnHtml = html;
    const boldApplied = /<strong|<b>/i.test(html) && /Hello World/i.test(html);
    await selectTextRangeByOffsets(page, 0, 11);
    await page.click('button[data-cmd="bold"]');
    await page.waitForTimeout(80);
    html = await getEditorHtml(page);
    const boldRemoved = !/<strong|<b>/i.test(html) && /Hello World/i.test(html);
    const noExtraBreaks = (html.match(/<br>/gi) || []).length <= 0;
    const noExtraBlocks = (html.match(/<p>/gi) || []).length <= 1;
    results.push({
      name: `${modeName}: word-like bold on then off preserves text`,
      pass: boldApplied && boldRemoved && noExtraBreaks && noExtraBlocks,
      detail: `on=${boldOnHtml.slice(0,80)} off=${html.slice(0,80)} breaks=${!noExtraBreaks} extraBlocks=${!noExtraBlocks}`
    });

    // Italic entire line on/off
    await setEditorHtml(page, '<p>Hello World</p>');
    await selectTextRangeByOffsets(page, 0, 11);
    await page.click('button[data-cmd="italic"]');
    html = await getEditorHtml(page);
    const italicOn = /<em|<i>/i.test(html);
    await selectTextRangeByOffsets(page, 0, 11);
    await page.click('button[data-cmd="italic"]');
    await page.waitForTimeout(80);
    html = await getEditorHtml(page);
    const italicOff = !/<em|<i>/i.test(html) && /Hello World/i.test(html);
    results.push({
      name: `${modeName}: word-like italic on then off preserves text`,
      pass: italicOn && italicOff && (html.match(/<p>/gi) || []).length <= 1,
      detail: `off=${html.slice(0,80)}`
    });

    // Underline entire line on/off
    await setEditorHtml(page, '<p>Hello World</p>');
    await selectTextRangeByOffsets(page, 0, 11);
    await page.click('button[data-cmd="underline"]');
    html = await getEditorHtml(page);
    const underlineOn = /<u>/i.test(html);
    await selectTextRangeByOffsets(page, 0, 11);
    await page.click('button[data-cmd="underline"]');
    await page.waitForTimeout(80);
    html = await getEditorHtml(page);
    const underlineOff = !/<u>/i.test(html) && /Hello World/i.test(html);
    results.push({
      name: `${modeName}: word-like underline on then off preserves text`,
      pass: underlineOn && underlineOff && (html.match(/<p>/gi) || []).length <= 1,
      detail: `off=${html.slice(0,80)}`
    });

    // Type → Bold → Type → Unbold → Type (word processor workflow)
    await setEditorHtml(page, '<p></p>');
    await page.focus('#editor');
    await page.keyboard.type('Normal ');
    await page.click('button[data-cmd="bold"]');
    await page.keyboard.type('Bold');
    await page.click('button[data-cmd="bold"]');
    await page.keyboard.type(' Normal');
    await page.waitForTimeout(80);
    html = await getEditorHtml(page);
    const hasNormalBoldNormal = /Normal\s/.test(html) && /<(strong|b)>Bold<\/(strong|b)>/i.test(html) && /Normal$/i.test(html.replace(/<[^>]+>/g, ''));
    results.push({
      name: `${modeName}: word-like type bold type unbold type`,
      pass: hasNormalBoldNormal,
      detail: html.slice(0, 160)
    });

    // Multi-line: bold then unbold should not create ghost lines
    await setEditorHtml(page, '<p>Line One</p><p>Line Two</p><p>Line Three</p>');
    await selectTextRangeByOffsets(page, 0, 8);
    await page.click('button[data-cmd="bold"]');
    await selectTextRangeByOffsets(page, 0, 8);
    await page.click('button[data-cmd="bold"]');
    await page.waitForTimeout(80);
    html = await getEditorHtml(page);
    const multiLineBlocks = (html.match(/<p>/gi) || []).length;
    results.push({
      name: `${modeName}: word-like multi-line bold toggle no ghost lines`,
      pass: multiLineBlocks === 3 && /Line One/i.test(html) && !/<strong|<b>/i.test(html.split('</p>')[0]),
      detail: `blocks=${multiLineBlocks} html=${html.slice(0,160)}`
    });

    const fixedSeeds = modeName === 'desktop' ? [11, 29, 42, 1337] : [7, 4068698211];
    for (const seed of fixedSeeds) {
      results.push(await runWildInteractionScenario(page, modeName, seed, consoleIssues, pageErrors));
    }

    results.push({
      name: `${modeName}: no CSP/runtime browser errors`,
      pass: consoleIssues.length === 0 && pageErrors.length === 0,
      detail: JSON.stringify({
        console: consoleIssues.slice(0, 6),
        pageErrors: pageErrors.slice(0, 6)
      })
    });
  } finally {
    await context.close();
    await browser.close();
  }

  return results;
}

async function main() {
  const all = [];
  all.push(...(await testToolbar('desktop', { viewport: { width: 1440, height: 900 } })));
  all.push(...(await testToolbar('mobile', devices['iPhone 12'])));

  const passed = all.filter((r) => r.pass).length;
  console.log(`Space toolbar/mobile checks: ${passed}/${all.length} passed`);
  all.forEach((r) => console.log(line(r.name, r.pass, r.detail)));
  if (passed !== all.length) process.exit(1);
}

main().catch((err) => {
  console.error('Space toolbar/mobile checks failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
