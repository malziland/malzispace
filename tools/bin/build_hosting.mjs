#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

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

function hashedRelOf(relPath, hash) {
  const parsed = path.posix.parse(relPath);
  return path.posix.join(parsed.dir, `${parsed.name}.${hash}${parsed.ext}`);
}

/** Does `content` (a file at `fileRelPath`) reference the fingerprinted
 *  file `depRel`? Mirrors the matching in rewriteReferences so detected
 *  dependencies are exactly the references that will be rewritten. */
function referencesDep(content, fileRelPath, depRel) {
  if (content.includes(`/${depRel}`)) return true;
  const fileDir = path.posix.dirname(fileRelPath);
  const relSource = path.posix.relative(fileDir, depRel) || path.posix.basename(depRel);
  if (relSource && content.includes(relSource)) return true;
  const dotted = withDotPrefix(relSource);
  return !!(dotted && content.includes(dotted));
}

/**
 * Compute the fingerprint manifest so each file's hash reflects its FULL
 * transitive content. A naive single pass (hash original source, then rewrite
 * imports) is wrong: a module whose own source is unchanged but whose imports
 * now point to changed dependencies keeps its old filename while its served
 * content differs → with `immutable` caching, returning visitors get a stale
 * module graph (this is the bug that kept the protect fix from reaching
 * already-open tabs).
 *
 * Fix: a file's hash = H(own source + the sorted source-hashes of every file
 * in its transitive dependency closure). Cycle-safe (the closure is just a
 * reachable set), so it works even though some modules import each other.
 */
async function computeManifest(files) {
  const fpRels = files.filter(shouldFingerprint);
  const sourceHash = new Map();
  const text = new Map();

  for (const relPath of fpRels) {
    const ext = path.posix.extname(relPath).toLowerCase();
    if (TEXT_EXTENSIONS.has(ext)) {
      const content = await fs.readFile(path.join(OUT_DIR, relPath), 'utf8');
      text.set(relPath, content);
      sourceHash.set(relPath, hashBuffer(Buffer.from(content)));
    } else {
      sourceHash.set(relPath, hashBuffer(await fs.readFile(path.join(OUT_DIR, relPath))));
    }
  }

  // Direct dependency edges between fingerprinted files.
  const deps = new Map();
  for (const relPath of fpRels) {
    const content = text.get(relPath);
    const set = new Set();
    if (content) {
      for (const dep of fpRels) {
        if (dep !== relPath && referencesDep(content, relPath, dep)) set.add(dep);
      }
    }
    deps.set(relPath, set);
  }

  // Transitive closure (cycle-safe) → content-address each file by its own
  // source plus every reachable dependency's source hash.
  const manifest = {};
  for (const relPath of fpRels) {
    const closure = new Set();
    const stack = [...deps.get(relPath)];
    while (stack.length) {
      const d = stack.pop();
      if (closure.has(d)) continue;
      closure.add(d);
      for (const next of deps.get(d) || []) if (!closure.has(next)) stack.push(next);
    }
    const parts = [relPath, sourceHash.get(relPath)];
    for (const d of [...closure].sort()) parts.push(`${d}:${sourceHash.get(d)}`);
    manifest[relPath] = hashedRelOf(relPath, hashBuffer(Buffer.from(parts.join('\n'))));
  }
  return manifest;
}

/** Rewrite references in every text file, then rename fingerprinted files. */
async function applyManifest(manifest) {
  const outFiles = await walk(OUT_DIR);
  for (const relPath of outFiles) {
    const ext = path.posix.extname(relPath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    const absPath = path.join(OUT_DIR, relPath);
    const rewritten = rewriteReferences(await fs.readFile(absPath, 'utf8'), relPath, manifest);
    await fs.writeFile(absPath, rewritten);
  }
  for (const [relPath, hashedRelPath] of Object.entries(manifest)) {
    if (relPath === hashedRelPath) continue;
    const from = path.join(OUT_DIR, relPath);
    const to = path.join(OUT_DIR, hashedRelPath);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
  }
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

/**
 * Run `node --check` on every JS/MJS source file. Bails out before any
 * fingerprinting or copying happens so a syntax error never reaches the
 * build/ tree, much less production. Native module resolution is bypassed
 * by --check, so the relative-import paths in our ES modules don't matter.
 */
async function syntaxCheckSources(sourceFiles) {
  const jsFiles = sourceFiles.filter((rel) => {
    const ext = path.posix.extname(rel).toLowerCase();
    return ext === '.js' || ext === '.mjs';
  });
  const failures = [];
  for (const rel of jsFiles) {
    const abs = path.join(SRC_DIR, rel);
    try {
      await execFileP(process.execPath, ['--check', abs], { maxBuffer: 8 * 1024 * 1024 });
    } catch (err) {
      failures.push({ rel, stderr: String(err.stderr || err.message || err).trim() });
    }
  }
  if (failures.length) {
    console.error(`Syntax check failed for ${failures.length} file(s):`);
    for (const f of failures) {
      console.error(`\n--- ${f.rel} ---\n${f.stderr}`);
    }
    throw new Error('syntax_check_failed');
  }
  console.log(`Syntax check passed for ${jsFiles.length} JS file(s).`);
}

async function main() {
  const sourceFiles = await walk(SRC_DIR);
  await syntaxCheckSources(sourceFiles);
  await copySourceTree(sourceFiles);
  const manifest = await computeManifest(sourceFiles);
  await applyManifest(manifest);
  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Hosting build ready: ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
