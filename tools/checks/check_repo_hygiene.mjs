import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

const tracked = execFileSync('git', ['-C', ROOT_DIR, 'ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const blockedFilePatterns = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.secrets?(\/|$)/i,
  /(^|\/)keys?(\/|$)/i,
  /\.(pem|p12|pfx|key|crt|cer)$/i,
  /(^|\/)(firebase-admin|service-account|serviceAccount).+\.json$/i
];

const secretMatchers = [
  { label: 'private key block', regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { label: 'service account private_key', regex: /"private_key"\s*:/ },
  { label: 'service account client_email', regex: /"client_email"\s*:/ },
  { label: 'aws access key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'github token', regex: /\bghp_[0-9A-Za-z]{36,}\b/ },
  { label: 'slack token', regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ }
];

const publicFirebaseApiKeyAllowlist = new Set([
  'apps/web/public/assets/config.js',
  'tests/live/run_smoke_with_temp_debug_token.mjs'
]);

const inlineViolationMatchers = [
  {
    label: 'inline <style> block',
    paths: [/^apps\/web\/public\/.+\.(html|svg)$/i],
    regex: /<style\b/i
  },
  {
    label: 'inline style attribute',
    paths: [/^apps\/web\/public\/.+\.(html|svg)$/i],
    regex: /\sstyle\s*=/i
  },
  {
    label: 'inline script block',
    paths: [/^apps\/web\/public\/.+\.html$/i],
    regex: /<script(?![^>]*\bsrc=)/i
  },
  {
    label: 'inline event handler',
    paths: [/^apps\/web\/public\/.+\.(html|svg)$/i],
    regex: /\son[a-z]+\s*=/i
  },
  {
    label: 'javascript: url',
    paths: [/^apps\/web\/public\/.+\.(html|svg|js)$/i],
    regex: /javascript:/i
  },
  {
    label: 'DOM style mutation',
    paths: [/^apps\/web\/public\/.+\.js$/i],
    regex: /\.style\.[A-Za-z_$][\w$]*/i
  },
  {
    label: 'DOM style attribute mutation',
    paths: [/^apps\/web\/public\/.+\.js$/i],
    regex: /setAttribute\(\s*['"]style['"]/i
  },
  {
    label: 'manual local asset version query',
    paths: [/^apps\/web\/public\/.+\.html$/i],
    regex: /\b(?:src|href)\s*=\s*['"][^'"]*(?:assets|node)\/[^'"]+\?v=/i
  }
];

const findings = [];

for (const relPath of tracked) {
  if (blockedFilePatterns.some((pattern) => pattern.test(relPath))) {
    findings.push(`${relPath}: blocked filename/pattern`);
    continue;
  }
  const absPath = path.join(ROOT_DIR, relPath);
  let text;
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch {
    continue;
  }

  for (const matcher of secretMatchers) {
    if (matcher.regex.test(text)) {
      findings.push(`${relPath}: ${matcher.label}`);
    }
  }

  const firebaseApiKeys = text.match(/AIza[0-9A-Za-z_-]{20,}/g) || [];
  if (firebaseApiKeys.length > 0 && !publicFirebaseApiKeyAllowlist.has(relPath)) {
    findings.push(`${relPath}: unexpected Firebase web API key literal`);
  }

  for (const matcher of inlineViolationMatchers) {
    if (!matcher.paths.some((pattern) => pattern.test(relPath))) continue;
    if (matcher.regex.test(text)) {
      findings.push(`${relPath}: ${matcher.label}`);
    }
  }
}

try {
  const appCheckPath = path.join(ROOT_DIR, 'apps/web/public/assets/appcheck.js');
  const firebaseJsonPath = path.join(ROOT_DIR, 'firebase.json');
  const appCheckText = fs.readFileSync(appCheckPath, 'utf8');
  const firebaseJsonText = fs.readFileSync(firebaseJsonPath, 'utf8');
  const usesRecaptchaAppCheck = /ReCaptcha(?:V3|Enterprise)Provider/.test(appCheckText);
  const hasStrictStyleSrcSelf = /style-src\s+'self'(?![^"]*(?:'unsafe-inline'|nonce-))/i.test(firebaseJsonText);
  if (usesRecaptchaAppCheck && hasStrictStyleSrcSelf) {
    findings.push(
      'firebase.json + apps/web/public/assets/appcheck.js: reCAPTCHA-based App Check conflicts with strict static style-src policy and will trigger CSP inline-style violations'
    );
  }
} catch (error) {
  findings.push(`repo policy inspection failed: ${error && error.message ? error.message : error}`);
}

if (findings.length > 0) {
  console.error('Repository hygiene check failed:');
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}

console.log('Repository hygiene: OK');
