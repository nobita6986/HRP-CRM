/**
 * scripts/generate-manifest.mjs — Generate / Verify SHA-256 manifest for CORE/1.10 bundle.
 *
 * Modes (mutually exclusive):
 *   (default)            Generate manifest: writes docs/contracts/handoff-core-1.10.manifest.txt
 *   --verify             Verify manifest against files on disk. READ-ONLY: never writes
 *                        any file. Exits 0 if all hashes match, 1 on any missing/mismatch.
 *   --check              Coverage check: every file in BUNDLE_FILES exists, no duplicates,
 *                        manifest itself covers them. READ-ONLY. Exits 0 on clean, 1 on issues.
 *
 * Same read-only contract as CORE/1.9 manifest script (see handoff-core-1.9.md §3).
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const OUT_PATH = join(REPO_ROOT, 'docs/contracts/handoff-core-1.10.manifest.txt');

const BUNDLE_FILES = [
  // Source
  'apps/core-1.10-media/src/evidence-store.ts',
  'apps/core-1.10-media/src/secret-provider.ts',
  'apps/core-1.10-media/src/url-policy.ts',
  'apps/core-1.10-media/src/policy-harness.ts',
  'apps/core-1.10-media/src/index.ts',
  // Build / config
  'apps/core-1.10-media/package.json',
  'apps/core-1.10-media/tsconfig.json',
  'apps/core-1.10-media/scripts/generate-manifest.mjs',
  // Tests
  'apps/core-1.10-media/tests/evidence-store.test.mjs',
  'apps/core-1.10-media/tests/secret-provider.test.mjs',
  'apps/core-1.10-media/tests/url-policy.test.mjs',
  'apps/core-1.10-media/tests/policy-harness.test.mjs',
  // Docs
  'apps/core-1.10-media/README.md',
  'docs/contracts/adr-media-01-vn.md',
  'docs/contracts/handoff-core-1.10.md',
];

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function checkCoverage() {
  const seen = new Set();
  const missing = [];
  const duplicates = [];
  for (const relPath of BUNDLE_FILES) {
    if (seen.has(relPath)) duplicates.push(relPath);
    seen.add(relPath);
    const fullPath = join(REPO_ROOT, relPath);
    if (!existsSync(fullPath)) missing.push(relPath);
  }
  return { duplicates, missing };
}

function generate() {
  const seen = new Set();
  const missing = [];
  const entries = [];

  for (const relPath of BUNDLE_FILES) {
    if (seen.has(relPath)) {
      throw new Error(`Duplicate entry in manifest: ${relPath}`);
    }
    seen.add(relPath);
    const fullPath = join(REPO_ROOT, relPath);
    if (!existsSync(fullPath)) {
      missing.push(relPath);
      continue;
    }
    const buf = readFileSync(fullPath);
    const stat = statSync(fullPath);
    const hash = sha256(buf);
    entries.push({ relPath, hash, size: stat.size });
  }

  if (missing.length > 0) {
    console.error('Missing files (cannot generate manifest):');
    for (const m of missing) console.error('  - ' + m);
    process.exit(1);
  }

  const now = new Date().toISOString();
  let out = '';
  out += '# CORE/1.10 — Handoff Manifest\n';
  out += '# Date: ' + now + '\n';
  out += '# Generator: scripts/generate-manifest.mjs (SHA-256)\n';
  out += '# Total files: ' + entries.length + '\n';
  out += '#\n';
  out += '# Format: FILE|<repo-relative-path>|<sha256-hex>\n';
  out += '#\n';
  out += '\n';
  for (const e of entries) {
    out += `FILE|${e.relPath}|${e.hash}\n`;
  }
  out += '\n# Verification (READ-ONLY):\n';
  out += '#   node scripts/generate-manifest.mjs --verify\n';
  out += '#   node scripts/generate-manifest.mjs --check\n';

  writeFileSync(OUT_PATH, out, 'utf-8');
  console.log(`Manifest written: ${relative(REPO_ROOT, OUT_PATH)} (${entries.length} entries).`);
}

function verify() {
  if (!existsSync(OUT_PATH)) {
    console.error(`verify FAIL: manifest not found at ${OUT_PATH}`);
    process.exit(1);
  }
  const raw = readFileSync(OUT_PATH, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.startsWith('FILE|'));
  const manifestEntries = lines.map((l) => {
    const [, relPath, hash] = l.split('|');
    return { relPath, hash };
  });

  const seen = new Set();
  const problems = [];
  const checked = [];

  for (const { relPath, hash } of manifestEntries) {
    if (seen.has(relPath)) problems.push(`duplicate entry: ${relPath}`);
    seen.add(relPath);
    const fullPath = join(REPO_ROOT, relPath);
    if (!existsSync(fullPath)) {
      problems.push(`missing on disk: ${relPath}`);
      continue;
    }
    const actual = sha256(readFileSync(fullPath));
    if (actual !== hash) {
      problems.push(`hash mismatch: ${relPath} (manifest=${hash} actual=${actual})`);
    }
    checked.push(relPath);
  }

  for (const relPath of BUNDLE_FILES) {
    if (!seen.has(relPath)) problems.push(`bundle file not in manifest: ${relPath}`);
  }

  if (problems.length === 0) {
    console.log(`verify OK: ${checked.length} entries matched, 0 missing, 0 mismatch.`);
    process.exit(0);
  } else {
    console.error(`verify FAIL: ${problems.length} problem(s)`);
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
}

function check() {
  const { duplicates, missing } = checkCoverage();
  const problems = [];
  if (duplicates.length > 0) problems.push(`duplicate bundle entries: ${duplicates.join(', ')}`);
  if (missing.length > 0) problems.push(`missing bundle files: ${missing.join(', ')}`);

  if (problems.length === 0) {
    console.log(`check OK: ${BUNDLE_FILES.length} bundle entries clean.`);
    process.exit(0);
  } else {
    console.error(`check FAIL:`);
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
}

const argv = process.argv.slice(2);
if (argv.includes('--verify')) {
  verify();
} else if (argv.includes('--check')) {
  check();
} else {
  generate();
}
