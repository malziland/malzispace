import crypto from 'node:crypto';
import { launchChromiumBrowser } from '../support/browser.mjs';

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/+$/, '');

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function line(name, pass, detail = '') {
  return `${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`;
}

async function textOf(page, selector) {
  return page.locator(selector).first().textContent();
}

async function checkLanding(page, results) {
  await page.goto(`${BASE_URL}/index.html?lang=en`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  const hero = (await textOf(page, '.hero-sub')) || '';
  const button = (await textOf(page, '#createForm button')) || '';
  const privacyCard = (await page.locator('.info-grid > .info-item').nth(1).textContent()) || '';
  const openSourceButton = (await textOf(page, '.opensource-link')) || '';
  const openSourceHref = await page.locator('.opensource-link').getAttribute('href');
  const lang = await page.evaluate(() => document.documentElement.lang);

  results.push({ name: 'landing lang=en sets html lang', pass: lang === 'en', detail: lang });
  results.push({ name: 'landing hero subtitle translated', pass: /Share text in seconds/i.test(hero), detail: hero.trim() });
  results.push({ name: 'landing create button translated', pass: /Create new space/i.test(button), detail: button.trim() });
  results.push({ name: 'landing privacy card translated', pass: /No accounts/i.test(privacyCard), detail: privacyCard.trim() });
  results.push({ name: 'landing open source button translated', pass: /Open source on GitHub/i.test(openSourceButton), detail: openSourceButton.trim() });
  results.push({ name: 'landing open source button points to malzispace repo', pass: String(openSourceHref || '') === 'https://github.com/malziland/malzispace', detail: String(openSourceHref || '') });
}

async function checkSpace(page, results) {
  const key = b64url(crypto.randomBytes(32));
  await page.goto(`${BASE_URL}/space.html?id=simtest01&sim=1&lang=en#${key}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#editor');
  await page.waitForTimeout(300);

  const titleLabel = (await textOf(page, '.title-label')) || '';
  const shareBtn = (await textOf(page, '#showQr')) || '';
  const statusTitle = await page.locator('#status').getAttribute('title') || '';
  const presence = (await textOf(page, '#presence')) || '';
  const placeholder = await page.locator('#editor').getAttribute('data-placeholder');
  const footerImprint = (await page.locator('.site-footer a').first().textContent()) || '';

  results.push({ name: 'space title label translated', pass: /Title/i.test(titleLabel), detail: titleLabel.trim() });
  results.push({ name: 'space share button translated', pass: /Share/i.test(shareBtn), detail: shareBtn.trim() });
  results.push({ name: 'space status dot has title', pass: /Connected|Simulator/i.test(statusTitle) && !/Verbunden|Getrennt/i.test(statusTitle), detail: statusTitle.trim() });
  results.push({ name: 'space presence translated', pass: /1 person/i.test(presence), detail: presence.trim() });
  results.push({ name: 'space editor placeholder translated', pass: /Paste text here/i.test(String(placeholder || '')), detail: String(placeholder || '') });
  results.push({ name: 'space footer imprint translated', pass: /Imprint/i.test(footerImprint), detail: footerImprint.trim() });
}

async function checkPrivacy(page, results) {
  await page.goto(`${BASE_URL}/privacy.html?lang=en`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  const heading = (await textOf(page, 'h1')) || '';
  const updated = (await textOf(page, '.legal-subtitle')) || '';
  const servicesText = (await page.locator('.legal-section').nth(4).textContent()) || '';
  const back = (await textOf(page, '.back-link')) || '';

  results.push({ name: 'privacy heading translated', pass: /^Privacy$/i.test(heading.trim()), detail: heading.trim() });
  results.push({ name: 'privacy updated translated', pass: /March 2026/i.test(updated), detail: updated.trim() });
  results.push({
    name: 'privacy service regions retained',
    pass: /eur3/.test(servicesText)
      && /europe-west1/.test(servicesText)
      && /europe-west3/.test(servicesText)
      && /proof-of-work|custom proof-of-work/i.test(servicesText),
    detail: servicesText.replace(/\s+/g, ' ').trim().slice(0, 180)
  });
  results.push({ name: 'privacy back link translated', pass: /Back to homepage/i.test(back), detail: back.trim() });
}

async function checkTerms(page, results) {
  await page.goto(`${BASE_URL}/agb.html?lang=en`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  const heading = (await textOf(page, 'h1')) || '';
  const meta = (await textOf(page, '.legal-subtitle')) || '';
  const section = (await page.locator('.legal-section h2').first().textContent()) || '';

  results.push({ name: 'terms heading translated', pass: /Terms of Use/i.test(heading), detail: heading.trim() });
  results.push({ name: 'terms meta translated', pass: /malziSPACE by malziland/i.test(meta), detail: meta.trim() });
  results.push({ name: 'terms section translated', pass: /Scope/i.test(section), detail: section.trim() });
}

async function checkImprint(page, results) {
  await page.goto(`${BASE_URL}/impressum.html?lang=en`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  const heading = (await textOf(page, 'h1')) || '';
  const body = (await page.locator('.legal-block').first().textContent()) || '';

  results.push({ name: 'imprint heading translated', pass: /^Imprint$/i.test(heading.trim()), detail: heading.trim() });
  results.push({ name: 'imprint business description translated', pass: /digital knowledge design/i.test(body) && /Austria/i.test(body), detail: body.replace(/\s+/g, ' ').trim().slice(0, 180) });
}

async function main() {
  const browser = await launchChromiumBrowser();
  const page = await browser.newPage();
  const results = [];

  try {
    await checkLanding(page, results);
    await checkSpace(page, results);
    await checkPrivacy(page, results);
    await checkTerms(page, results);
    await checkImprint(page, results);
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`I18N/legal checks: ${passed}/${results.length} passed`);
  results.forEach((r) => console.log(line(r.name, r.pass, r.detail)));
  if (passed !== results.length) process.exit(1);
}

main().catch((err) => {
  console.error('I18N/legal checks failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
