import fs from 'node:fs';
import { chromium } from 'playwright';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getLocalChromiumFallbacks() {
  const candidates = [];
  const envPath = String(process.env.PW_CHROMIUM_EXECUTABLE_PATH || '').trim();
  if (envPath) candidates.push(envPath);
  const allowSystemBrowsers = /^(1|true|yes)$/i.test(String(process.env.PW_ALLOW_SYSTEM_CHROMIUM || '').trim());
  if (allowSystemBrowsers && process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  }
  return candidates.filter((candidate, index, list) =>
    candidate && list.indexOf(candidate) === index && fs.existsSync(candidate)
  );
}

export async function launchChromiumBrowser(options = {}) {
  const base = Object.assign({ headless: true }, options);
  const preferredChannel = String(process.env.PW_CHROMIUM_CHANNEL || '').trim();
  const localFallbacks = getLocalChromiumFallbacks();
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (preferredChannel) {
      try {
        return await chromium.launch(Object.assign({}, base, { channel: preferredChannel }));
      } catch (error) {}
    }

    try {
      return await chromium.launch(base);
    } catch (error) {
      lastError = error;
    }

    for (const executablePath of localFallbacks) {
      try {
        return await chromium.launch(Object.assign({}, base, { executablePath }));
      } catch (fallbackError) {
        lastError = fallbackError;
      }
    }

    if (attempt < 3) await sleep(350);
  }

  throw lastError;
}

export async function launchBrowserForEngine(engineName, browserType, options = {}) {
  if (engineName === 'chromium') {
    return launchChromiumBrowser(options);
  }
  return browserType.launch(Object.assign({ headless: true }, options));
}
