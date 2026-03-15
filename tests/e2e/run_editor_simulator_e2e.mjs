import { launchChromiumBrowser } from '../support/browser.mjs';

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/+$/, '');

function summarize(result) {
  const mark = result.pass ? 'PASS' : 'FAIL';
  const detail = result.detail ? ` - ${result.detail}` : '';
  return `${mark} ${result.name}${detail}`;
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

async function setSelection(page, start, end) {
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

async function setColor(page, inputId, color) {
  await page.evaluate(({ id, value }) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { id: inputId, value: color });
}

async function getEditorHtml(page) {
  return page.$eval('#editor', (el) => el.innerHTML || '');
}

async function runReloadPersistenceTest(context) {
  const page = await context.newPage();
  const url = `${BASE_URL}/editor-simulator.html?skipAuto=1&t=${Date.now()}`;
  await page.goto(url);
  await page.waitForSelector('#editor');

  await setEditorHtml(page, '<p>Reload Alpha Beta</p>');
  await setSelection(page, 0, 6);
  await page.click('button[data-cmd="bold"]');

  await page.waitForTimeout(1500);
  const beforeReload = await getEditorHtml(page);

  await page.reload();
  await page.waitForSelector('#editor');
  await page.waitForTimeout(200);
  const afterReload = await getEditorHtml(page);

  const pass = /Reload/i.test(afterReload)
    && /<strong|<b>|class="[^"]*\bmz-fw-bold\b/i.test(afterReload);

  await page.close();

  return {
    name: 'Reload Persistenz',
    pass,
    detail: pass ? '' : `before=${beforeReload.slice(0, 140)} | after=${afterReload.slice(0, 140)}`
  };
}

async function main() {
  const browser = await launchChromiumBrowser();
  const context = await browser.newContext();

  try {
    const page = await context.newPage();
    const autoUrl = `${BASE_URL}/editor-simulator.html?reset=1&t=${Date.now()}`;
    await page.goto(autoUrl);
    await page.waitForFunction(() => Array.isArray(window.__MZ_SIM_TEST_RESULTS__), null, { timeout: 30000 });

    const builtIn = await page.evaluate(() => {
      return (window.__MZ_SIM_TEST_RESULTS__ || []).map((r) => ({
        name: r.name,
        pass: !!r.pass,
        detail: r.detail || ''
      }));
    });

    const reloadResult = await runReloadPersistenceTest(context);

    const all = [...builtIn, reloadResult];
    const passed = all.filter((r) => r.pass).length;

    console.log(`Simulator E2E: ${passed}/${all.length} passed`);
    all.forEach((r) => console.log(summarize(r)));

    await page.close();
    await browser.close();

    if (passed !== all.length) {
      process.exit(1);
    }
  } catch (err) {
    await browser.close();
    console.error('Simulator E2E failed:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

main();
