#!/usr/bin/env node
/**
 * Take README screenshots of the malzispace UI via simulator mode.
 * Usage: node tools/bin/take_screenshots.mjs [base_url]
 */
import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const outDir = join(root, 'docs', 'screenshots');
const BASE = process.argv[2] || 'http://127.0.0.1:4173';

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const browser = await chromium.launch();

  // ── 1. Landing page (desktop) ──────────────────────────────────
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
    await sleep(500);
    await page.screenshot({ path: join(outDir, '01-landing.png'), fullPage: false });
    console.log('  01-landing.png');
    await page.close();
  }

  // ── 2. Space editor (desktop, sim mode) ────────────────────────
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${BASE}/editor-simulator.html?skipAuto=1&reset=1`, { waitUntil: 'networkidle' });
    await sleep(1500);

    // Hide the simulator header card (h1 + description + results)
    await page.evaluate(() => {
      const simHeader = document.querySelector('header.card.sim-card-stack');
      if (simHeader) simHeader.style.display = 'none';
    });

    // Clear default content and type demo text
    const editor = page.locator('#editor');
    await editor.click();
    await page.keyboard.down('Meta');
    await page.keyboard.press('a');
    await page.keyboard.up('Meta');
    await page.keyboard.press('Backspace');
    await sleep(200);

    // Bold heading
    const boldBtn = page.locator('button[data-cmd="bold"]');
    await boldBtn.click();
    await page.keyboard.type('Meeting Notes');
    await boldBtn.click();
    await page.keyboard.press('Enter');

    // Normal text
    await page.keyboard.type('Project deadline is next Friday. All tasks should be completed by EOD Thursday.');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    // Italic subheading
    const italicBtn = page.locator('button[data-cmd="italic"]');
    await italicBtn.click();
    await page.keyboard.type('Action Items');
    await italicBtn.click();
    await page.keyboard.press('Enter');

    // Create a bullet list
    const ulBtn = page.locator('button[data-cmd="insertUnorderedList"]');
    await ulBtn.click();
    await page.keyboard.type('Review documentation updates');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Update the test suite for new features');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Deploy to staging environment');

    await sleep(500);

    // Clip to the toolbar + editor area (skip sim header)
    const toolbarCard = page.locator('header.toolbar.card');
    const editorCard = page.locator('main.card.editor-wrap');
    const toolbarBox = await toolbarCard.boundingBox();
    const editorBox = await editorCard.boundingBox();

    if (toolbarBox && editorBox) {
      const y = Math.max(0, toolbarBox.y - 16);
      const h = editorBox.y + editorBox.height - y + 16;
      await page.screenshot({
        path: join(outDir, '02-editor.png'),
        clip: { x: 0, y, width: 1280, height: Math.min(h, 700) },
      });
    } else {
      await page.screenshot({ path: join(outDir, '02-editor.png'), fullPage: false });
    }
    console.log('  02-editor.png');
    await page.close();
  }

  // ── 3. Space editor (mobile, sim mode) ────────────────────────
  {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await page.goto(`${BASE}/editor-simulator.html?skipAuto=1&reset=1`, { waitUntil: 'networkidle' });
    await sleep(1500);

    // Hide simulator header
    await page.evaluate(() => {
      const simHeader = document.querySelector('header.card.sim-card-stack');
      if (simHeader) simHeader.style.display = 'none';
    });

    const editor = page.locator('#editor');
    await editor.tap();
    // Clear (use Control on non-Mac Playwright)
    await page.keyboard.down('Meta');
    await page.keyboard.press('a');
    await page.keyboard.up('Meta');
    await page.keyboard.press('Backspace');
    await sleep(200);

    await page.keyboard.type('Quick note from mobile');
    await page.keyboard.press('Enter');
    await page.keyboard.type('End-to-end encrypted.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Auto-deleted after 24h.');

    await sleep(500);

    const toolbarCard = page.locator('header.toolbar.card');
    const toolbarBox = await toolbarCard.boundingBox();
    const y = toolbarBox ? Math.max(0, toolbarBox.y - 8) : 0;
    await page.screenshot({
      path: join(outDir, '03-mobile.png'),
      clip: { x: 0, y, width: 390, height: 700 },
    });
    console.log('  03-mobile.png');
    await page.close();
  }

  await browser.close();
  console.log(`\nScreenshots saved to docs/screenshots/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
