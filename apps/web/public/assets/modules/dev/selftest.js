/**
 * @module dev/selftest
 * Editor toolbar self-test: automated verification of formatting
 * commands in simulator mode.
 */
import ctx from '../core/context.js';
import { saveEditorRange } from '../services/selection.js';

/**
 * Find the first text node inside the editor.
 * @returns {Text|null}
 */
function getFirstEditorTextNode() {
  const root = ctx.editor.querySelector('p,h1,h2,h3,blockquote,div,li,span,strong,em,u,s,a') || ctx.editor;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  return walker.nextNode();
}

/**
 * Set a selection range on the first text node in the editor.
 * @param {number} start - Start offset.
 * @param {number} end - End offset.
 * @returns {boolean} Whether the selection was set.
 */
function setEditorSelection(start, end) {
  const textNode = getFirstEditorTextNode();
  if (!textNode) return false;
  const len = (textNode.nodeValue || '').length;
  const s = Math.max(0, Math.min(start, len));
  const e = Math.max(s, Math.min(end, len));
  const range = document.createRange();
  range.setStart(textNode, s);
  range.setEnd(textNode, e);
  const sel = window.getSelection && window.getSelection();
  if (!sel) return false;
  sel.removeAllRanges();
  sel.addRange(range);
  saveEditorRange();
  return true;
}

/**
 * Simulate a toolbar button click.
 * @param {string} selector - CSS selector for the button.
 * @returns {boolean} Whether the button was found and clicked.
 */
function clickToolbar(selector) {
  const btn = ctx.editorToolbar && ctx.editorToolbar.querySelector(selector);
  if (!btn) return false;
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
}

/**
 * Create or update the selftest results panel in the DOM.
 * @param {string[]} lines - Result lines to display.
 */
function mountSelftestPanel(lines) {
  let panel = document.getElementById('editorSelftestPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'editorSelftestPanel';
    panel.className = 'editor-selftest-panel';
    const wrap = ctx.editor.closest('.editor-wrap');
    if (wrap) wrap.insertBefore(panel, wrap.firstChild);
  }
  panel.replaceChildren();
  const list = document.createElement('ul');
  lines.forEach((line) => {
    const item = document.createElement('li');
    item.textContent = line;
    list.appendChild(item);
  });
  panel.appendChild(list);
}

/**
 * Run the toolbar self-test suite.
 * Only executes when SELFTEST_MODE is enabled (via ?selftest=1).
 * Tests all toolbar formatting commands and displays results.
 */
export async function runToolbarSelftest() {
  if (!ctx.SELFTEST_MODE) return;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const test = async (name, fn, check) => {
    ctx.setEditorWithCursor('<p>Alpha Beta Gamma</p>');
    await wait(30);
    await fn();
    await wait(40);
    const html = ctx.editor.innerHTML || '';
    const pass = (check instanceof RegExp) ? check.test(html) : !!check(html);
    results.push({ name, pass, html });
  };

  await test('Fett', async () => {
    setEditorSelection(0, 5);
    clickToolbar('button[data-cmd="bold"]');
  }, /<strong|<b>|class="[^"]*\bmz-fw-bold\b/i);

  await test('Kursiv', async () => {
    setEditorSelection(0, 5);
    clickToolbar('button[data-cmd="italic"]');
  }, /<em>|<i>|class="[^"]*\bmz-fs-italic\b/i);

  await test('Unterstrichen', async () => {
    setEditorSelection(0, 5);
    clickToolbar('button[data-cmd="underline"]');
  }, /<u>|class="[^"]*\bmz-td-underline\b/i);

  await test('Aufzählung', async () => {
    setEditorSelection(0, 5);
    clickToolbar('button[data-cmd="insertUnorderedList"]');
  }, /<ul|<li/i);

  await test('Nummerierte Liste', async () => {
    setEditorSelection(0, 5);
    clickToolbar('button[data-cmd="insertOrderedList"]');
  }, /<ol|<li/i);

  await test('Linksbündig', async () => {
    setEditorSelection(2, 2);
    clickToolbar('button[data-cmd="justifyLeft"]');
  }, /data-mz-align="left"/i);

  await test('Zentriert', async () => {
    setEditorSelection(2, 2);
    clickToolbar('button[data-cmd="justifyCenter"]');
  }, /data-mz-align="center"/i);

  await test('Rechtsbündig', async () => {
    setEditorSelection(2, 2);
    clickToolbar('button[data-cmd="justifyRight"]');
  }, /data-mz-align="right"/i);

  await test('Blocksatz', async () => {
    setEditorSelection(2, 2);
    clickToolbar('button[data-cmd="justifyFull"]');
  }, /data-mz-align="justify"/i);

  await test('Link einfügen', async () => {
    setEditorSelection(0, 5);
    clickToolbar('button[data-cmd="createLink"]');
    if (ctx.linkUrlInput) ctx.linkUrlInput.value = 'https://example.com';
    ctx.saveLinkModalBtn?.click();
  }, /<p><a[^>]+href="https:\/\/example\.com\/?">Alpha<\/a> Beta Gamma<\/p>/i);

  await test('Horizontale Linie', async () => {
    setEditorSelection(2, 2);
    clickToolbar('button[data-cmd="insertHorizontalRule"]');
  }, /<hr/i);

  const ok = results.filter((r) => r.pass).length;
  const lines = [`Selftest: ${ok}/${results.length} OK`];
  results.forEach((r) => lines.push(`${r.pass ? 'OK' : 'FAIL'} ${r.name}`));
  mountSelftestPanel(lines);
}
