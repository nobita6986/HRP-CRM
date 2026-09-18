/**
 * scripts/generate-manifest-1.12-postaudit.mjs — Generate / Verify SHA-256
 * manifest for the POST-AUDIT follow-up delta of CORE/1.12.
 *
 * This is SEPARATE from the audit-PASS manifest at
 * docs/contracts/handoff-core-1.12.manifest.txt, which is preserved
 * unchanged as immutable evidence of the original snapshot.
 *
 * The post-audit delta captures ONLY the files changed in the follow-up
 * (test fix + status doc correction). It is NOT meant to replace the
 * audit-PASS artifact.
 *
 * Modes (mutually exclusive):
 *   (default)            Generate manifest (writes to default OUT_PATH or
 *                        to --output <path> if specified, for tests).
 *   --verify             Verify manifest against files on disk. READ-ONLY.
 *   --check              Coverage check. READ-ONLY.
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const OUT_PATH = join(
  REPO_ROOT,
  'docs/contracts/handoff-core-1.12.postaudit.manifest.txt',
);

// Post-audit delta: only the files changed in the follow-up
// (manifest-readonly test fix + status doc correction).
const DELTA_FILES = [
  // Test rewrite to use --output scratch path
  'apps/context-panel/tests/manifest-readonly-1.12.test.mjs',
  // Manifest script: added --output flag for tests
  'apps/context-panel/scripts/generate-manifest-1.12.mjs',
  // Status doc: corrected test counts (service 12→16, delta 48→52)
  'docs/contracts/handoff-core-1.12.status.md',
  // Handoff doc (no business change, but listed for completeness)
  'docs/contracts/handoff-core-1.12.md',
  // Generator for this manifest
  'apps/context-panel/scripts/generate-manifest-1.12-postaudit.mjs',
];

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function checkCoverage() {
  const seen = new Set();
  const missing = [];
  const duplicates = [];
  for (const relPath of DELTA_FILES) {
    if (seen.has(relPath)) duplicates.push(relPath);
    seen.add(relPath);
    const fullPath = join(REPO_ROOT, relPath);
    if (!existsSync(fullPath)) missing.push(relPath);
  }
  return { duplicates, missing };
}

function generate(outPath = OUT_PATH) {
  const seen = new Set();
  const missing = [];
  const entries = [];

  for (const relPath of DELTA_FILES) {
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
  out += '# CORE/1.12 — POST-AUDIT Delta Manifest\n';
  out += '# Date: ' + now + '\n';
  out += '# Generator: scripts/generate-manifest-1.12-postaudit.mjs (SHA-256)\n';
  out += '# Total files: ' + entries.length + '\n';
  out += '#\n';
  out += '# This manifest captures ONLY the post-audit follow-up delta:\n';
  out += '#   - manifest-readonly-1.12.test.mjs: rewritten to use --output\n';
  out += '#     scratch path so the test never touches the bundled audit-PASS\n';
  out += '#     manifest at docs/contracts/handoff-core-1.12.manifest.txt.\n';
  out += '#   - generate-manifest-1.12.mjs: added --output flag (generate only).\n';
  out += '#   - handoff-core-1.12.status.md: corrected test counts\n';
  out += '#     (service 12→16, business delta 48, total 52).\n';
  out += '#   - handoff-core-1.12.md: minor corrections only.\n';
  out += '#\n';
  out += '# The audit-PASS manifest at:\n';
  out += '#   docs/contracts/handoff-core-1.12.manifest.txt\n';
  out += '# is PRESERVED UNCHANGED as immutable evidence of the original\n';
  out += '# CORE/1.12 snapshot. DO NOT regenerate that file from this delta.\n';
  out += '#\n';
  out += '# Format: FILE|<repo-relative-path>|<sha256-hex>\n';
  out += '#\n';
  out += '\n';
  for (const e of entries) {
    out += `FILE|${e.relPath}|${e.hash}\n`;
  }
  out += '\n# Verification (READ-ONLY):\n';
  out += '#   node scripts/generate-manifest-1.12-postaudit.mjs --verify\n';
  out += '#   node scripts/generate-manifest-1.12-postaudit.mjs --check\n';

  writeFileSync(outPath, out, 'utf-8');
  console.log(`Post-audit manifest written: ${relative(REPO_ROOT, outPath)} (${entries.length} entries).`);
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

  const seen = new Set(manifestEntries.map((e) => e.relPath));
  for (const relPath of DELTA_FILES) {
    if (!seen.has(relPath)) problems.push(`delta file not in manifest: ${relPath}`);
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
    console.log(`check OK: ${DELTA_FILES.length} delta entries clean.`);
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
  let outPath = OUT_PATH;
  const outIdx = argv.indexOf('--output');
  if (outIdx !== -1 && outIdx + 1 < argv.length) {
    outPath = join(REPO_ROOT, argv[outIdx + 1]);
  }
  generate(outPath);
}
