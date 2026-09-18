/**
 * scripts/generate-manifest-1.11.mjs — Generate / Verify SHA-256 manifest for CORE/1.11 bundle.
 *
 * Generates docs/contracts/handoff-core-1.11.manifest.txt.
 * Separate from CORE/1.9 manifest to preserve CORE/1.9 baseline evidence.
 *
 * The CORE/1.11 delta from CORE/1.9 baseline includes:
 *  - NEW files added (4 routing source files + 1 UI component + 2 tests + 1 server bootstrap + 1 browser evidence)
 *  - SHARED files modified (server.ts, app.tsx, generate-manifest.mjs for 1.9 baseline)
 *  - DOCS (handoff-core-1.11.md, routing-browser evidence files)
 *
 * Modes (mutually exclusive):
 *   (default)            Generate manifest
 *   --verify             Verify manifest against files on disk. READ-ONLY.
 *   --check              Coverage check. READ-ONLY.
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const OUT_PATH = join(REPO_ROOT, 'docs/contracts/handoff-core-1.11.manifest.txt');

// CORE/1.11 bundle files
const BUNDLE_FILES = [
  // ── NEW: routing source files
  'apps/context-panel/src/routing/types.ts',
  'apps/context-panel/src/routing/simulator.ts',
  'apps/context-panel/src/routing/config-store.ts',
  'apps/context-panel/src/routing/service.ts',
  // ── NEW: UI component
  'apps/context-panel/src/ui/components/routing-panel.tsx',
  // ── NEW: tests
  'apps/context-panel/tests/routing-simulator.test.mjs',
  'apps/context-panel/tests/routing-api.test.mjs',
  'apps/context-panel/tests/routing-browser-evidence.mjs',
  'apps/context-panel/tests/routing-server-bootstrap.mjs',
  'apps/context-panel/tests/manifest-readonly-1.11.test.mjs',
  'apps/context-panel/scripts/generate-manifest-1.11.mjs',
  // ── SHARED: modified files (changes from CORE/1.9 baseline)
  'apps/context-panel/src/server.ts',
  'apps/context-panel/src/ui/app.tsx',
  // ── DOCS
  'docs/contracts/handoff-core-1.11.md',
  'docs/contracts/handoff-core-1.11.status.md',
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
      throw new Error(`Duplicate entry: ${relPath}`);
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
  out += '# CORE/1.11 — Handoff Manifest\n';
  out += '# Date: ' + now + '\n';
  out += '# Generator: scripts/generate-manifest-1.11.mjs (SHA-256)\n';
  out += '# Total files: ' + entries.length + '\n';
  out += '#\n';
  out += '# CORE/1.11 delta from CORE/1.9 baseline:\n';
  out += '#  - NEW: 9 files (4 routing src + 1 UI + 4 tests/bootstrap)\n';
  out += '#  - SHARED: 2 files (server.ts, app.tsx) — modified by adding routing routes/tab\n';
  out += '#  - DOCS: 1 file (handoff-core-1.11.md)\n';
  out += '#\n';
  out += '# SHARED files: their hashes reflect CURRENT (post-delta) state, NOT\n';
  out += '# the CORE/1.9 audit-PASS hash. To compare against CORE/1.9 baseline,\n';
  out += '# see docs/contracts/handoff-core-1.9.manifest.txt — the SHARED files\n';
  out += '# are listed in BOTH manifests with potentially different hashes.\n';
  out += '#\n';
  out += '# Format: FILE|<repo-relative-path>|<sha256-hex>\n';
  out += '#\n';
  out += '\n';
  for (const e of entries) {
    out += `FILE|${e.relPath}|${e.hash}\n`;
  }
  out += '\n# Verification (READ-ONLY):\n';
  out += '#   node scripts/generate-manifest-1.11.mjs --verify\n';
  out += '#   node scripts/generate-manifest-1.11.mjs --check\n';

  writeFileSync(OUT_PATH, out, 'utf-8');
  console.log(`Manifest written: ${relative(REPO_ROOT, OUT_PATH)} (${entries.length} entries).`);
}

function verify() {
  // STRICTLY READ-ONLY. Do NOT call writeFileSync. Exit nonzero on missing/mismatch.
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

  const problems = [];
  const checked = [];

  for (const { relPath, hash } of manifestEntries) {
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

  // Cross-check: every BUNDLE_FILES entry must be present.
  const seen = new Set(manifestEntries.map((e) => e.relPath));
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
  // STRICTLY READ-ONLY. Coverage check.
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
