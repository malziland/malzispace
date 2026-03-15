#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const SRC_DIR = path.join(ROOT_DIR, 'apps', 'web', 'public');
const OUT_DIR = path.join(ROOT_DIR, 'build', 'hosting');
const MANIFEST_PATH = path.join(OUT_DIR, 'asset-manifest.json');

const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.svg']);

function isIgnored(relPath) {
  const name = path.posix.basename(relPath);
  return name === '.DS_Store';
}

function shouldFingerprint(relPath) {
  return relPath.startsWith('assets/') || relPath.startsWith('node/');
}

function toPosix(filePath) {
  return filePath.split(path.sep).join(path.posix.sep);
}

function withDotPrefix(relPath) {
  if (!relPath || relPath.startsWith('.') || relPath.startsWith('/')) return relPath;
  return `./${relPath}`;
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 10);
}

async function walk(dirPath, basePath = dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absPath = path.join(dirPath, entry.name);
    const relPath = toPosix(path.relative(basePath, absPath));
    if (isIgnored(relPath)) continue;
    if (entry.isDirectory()) {
      files.push(...await walk(absPath, basePath));
      continue;
    }
    if (entry.isFile()) files.push(relPath);
  }
  return files.sort();
}

async function copySourceTree(files) {
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  for (const relPath of files) {
    const srcPath = path.join(SRC_DIR, relPath);
    const outPath = path.join(OUT_DIR, relPath);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.copyFile(srcPath, outPath);
  }
}

async function fingerprintFiles(files) {
  const manifest = {};
  for (const relPath of files) {
    if (!shouldFingerprint(relPath)) continue;
    const outPath = path.join(OUT_DIR, relPath);
    const buffer = await fs.readFile(outPath);
    const parsed = path.posix.parse(relPath);
    const hashedRelPath = path.posix.join(parsed.dir, `${parsed.name}.${hashBuffer(buffer)}${parsed.ext}`);
    const hashedOutPath = path.join(OUT_DIR, hashedRelPath);
    await fs.mkdir(path.dirname(hashedOutPath), { recursive: true });
    await fs.rename(outPath, hashedOutPath);
    manifest[relPath] = hashedRelPath;
  }
  return manifest;
}

function rewriteReferences(content, fileRelPath, manifest) {
  let next = content;
  const fileDir = path.posix.dirname(fileRelPath);
  const entries = Object.entries(manifest).sort((a, b) => b[0].length - a[0].length);

  for (const [sourceRel, hashedRel] of entries) {
    const absoluteSource = `/${sourceRel}`;
    const absoluteHashed = `/${hashedRel}`;
    if (next.includes(absoluteSource)) {
      next = next.split(absoluteSource).join(absoluteHashed);
    }

    const relativeSource = path.posix.relative(fileDir, sourceRel) || path.posix.basename(sourceRel);
    const relativeHashed = path.posix.relative(fileDir, hashedRel) || path.posix.basename(hashedRel);
    const variants = new Map([
      [relativeSource, relativeHashed],
      [withDotPrefix(relativeSource), withDotPrefix(relativeHashed)]
    ]);

    for (const [from, to] of variants.entries()) {
      if (!from || from === to) continue;
      if (next.includes(from)) {
        next = next.split(from).join(to);
      }
    }
  }

  return next;
}

async function rewriteTextFiles(manifest) {
  const outFiles = await walk(OUT_DIR);
  for (const relPath of outFiles) {
    const ext = path.posix.extname(relPath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    const absPath = path.join(OUT_DIR, relPath);
    const original = await fs.readFile(absPath, 'utf8');
    const rewritten = rewriteReferences(original, relPath, manifest);
    await fs.writeFile(absPath, rewritten);
  }
}

async function main() {
  const sourceFiles = await walk(SRC_DIR);
  await copySourceTree(sourceFiles);
  const manifest = await fingerprintFiles(sourceFiles);
  await rewriteTextFiles(manifest);
  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Hosting build ready: ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
