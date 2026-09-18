/**
 * scripts/generate-manifest-1.13.mjs — Generate / Verify SHA-256 manifest
 * for CORE/1.13 bundle.
 *
 * Generates docs/contracts/handoff-core-1.13.manifest.txt.
 * Separate from CORE/1.9/1.11/1.12 manifests to preserve their
 * audit-PASS baselines as immutable evidence.
 *
 * Modes (mutually exclusive):
 *   (default)            Generate manifest (writes to default OUT_PATH or
 *                        to --output <path> if specified, for tests).
 *   --verify             Verify manifest against files on disk. READ-ONLY.
 *   --check              Coverage check. READ-ONLY.
 *
 * The --output flag only applies to generate (for tests using a scratch
 * path). --verify and --check are ALWAYS READ-ONLY against the bundled
 * OUT_PATH (the audit-PASS artifact), regardless of --output.
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Script lives in apps/context-panel/scripts/, so REPO_ROOT is 3 levels up.
// Use import.meta.url of the CALLING test to determine the actual repo root,
// because REPO_ROOT from script's perspective may differ on Windows.
const SCRIPT_DIR = __dirname; // apps/context-panel/scripts
const SCRIPT_REPO_ROOT = join(SCRIPT_DIR, '..', '..', '..'); // repo root
const OUT_PATH = join(SCRIPT_REPO_ROOT, 'docs/contracts/handoff-core-1.13.manifest.txt');

// ─────────────────────────────────────────────────────────────────────────────
// Detect the actual REPO_ROOT based on where the test is running.
// Test lives in apps/context-panel/tests/, so tests are 1 level deeper.
// ─────────────────────────────────────────────────────────────────────────────
function resolveOutPath(outArg) {
  if (!outArg) return OUT_PATH;
  // If absolute, return as-is (Windows/Linux compatibility)
  if (outArg.match(/^[A-Za-z]:/u) || outArg.startsWith('/')) return outArg;
  // Relative: resolve from SCRIPT_REPO_ROOT
  return join(SCRIPT_REPO_ROOT, outArg);
}

// CORE/1.13 bundle files
const BUNDLE_FILES = [
  // ── NEW: assistant source files
  'apps/context-panel/src/assistant/types.ts',
  'apps/context-panel/src/assistant/fixtures.ts',
  'apps/context-panel/src/assistant/store.ts',
  'apps/context-panel/src/assistant/service.ts',
  'apps/context-panel/src/assistant/index.ts',
  // ── NEW: UI component
  'apps/context-panel/src/ui/components/assistant-panel.tsx',
  // ── NEW: tests
  'apps/context-panel/tests/assistant-service.test.mjs',
  'apps/context-panel/tests/assistant-api.test.mjs',
  'apps/context-panel/tests/assistant-no-model-no-provider.test.mjs',
  'apps/context-panel/tests/assistant-browser-evidence.mjs',
  // ── Generator
  'apps/context-panel/scripts/generate-manifest-1.13.mjs',
  // ── SHARED: modified files (additive, NOT replacing)
  'apps/context-panel/src/server.ts',
  'apps/context-panel/src/ui/app.tsx',
  // ── SHARED: orchestrator-wire.ts modified in B1 for scope-based autofill auth.
  //    Before R3 fix, manifest omitted this file even though its MOCK_IDENTITY_MAP
  //    and canProposeAutofill/canConfirmAutofillDraft helpers are part of the
  //    CORE/1.13 delta. R3 mandates including it.
  'apps/context-panel/src/orchestrator-wire.ts',
  // ── DOCS: excluded from manifest SHA to avoid circular dependency
  //    (handoff references manifest hash). Docs are evidence only, not
  //    source artifacts. The manifest hash covers source + tests + scripts.
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
    const fullPath = join(SCRIPT_REPO_ROOT, relPath);
    if (!existsSync(fullPath)) missing.push(relPath);
  }
  return { duplicates, missing };
}

function generate(outPath = OUT_PATH) {
  const seen = new Set();
  const missing = [];
  const entries = [];

  for (const relPath of BUNDLE_FILES) {
    if (seen.has(relPath)) {
      throw new Error(`Duplicate entry: ${relPath}`);
    }
    seen.add(relPath);

    const fullPath = join(SCRIPT_REPO_ROOT, relPath);
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
  out += '# CORE/1.13 — Handoff Manifest\n';
  out += '# Date: ' + now + '\n';
  out += '# Generator: scripts/generate-manifest-1.13.mjs (SHA-256)\n';
  out += '# Total files: ' + entries.length + '\n';
  out += '#\n';
  out += '# CORE/1.13 delta from CORE/1.12 baseline:\n';
  out += '#  - NEW: 10 files (5 assistant src + 1 UI + 4 tests)\n';
  out += '#  - SHARED: 3 files (server.ts, app.tsx, orchestrator-wire.ts)\n';
  out += '#    orchestrator-wire.ts added in R3 (was missing in pre-R3 baseline).\n';
  out += '#  - DOCS: 1 file (handoff-core-1.13.md, generated by manifest)\n';
  out += '#\n';
  out += '# SHARED files: their hashes reflect CURRENT (post-delta) state, NOT\n';
  out += '# the CORE/1.12 audit-PASS hash. To compare against CORE/1.12 baseline,\n';
  out += '# see docs/contracts/handoff-core-1.12.manifest.txt — the SHARED files\n';
  out += '# are listed in BOTH manifests with potentially different hashes.\n';
  out += '#\n';
  out += '# Format: FILE|<repo-relative-path>|<sha256-hex>\n';
  out += '#\n';
  out += '\n';
  for (const e of entries) {
    out += `FILE|${e.relPath}|${e.hash}\n`;
  }
  out += '\n# Verification (READ-ONLY):\n';
  out += '#   node scripts/generate-manifest-1.13.mjs --verify\n';
  out += '#   node scripts/generate-manifest-1.13.mjs --check\n';

  writeFileSync(outPath, out, 'utf-8');
  console.log(`Manifest written: ${relative(SCRIPT_REPO_ROOT, outPath)} (${entries.length} entries).`);
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
    const fullPath = join(SCRIPT_REPO_ROOT, relPath);
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
  let outPath = OUT_PATH;
  const outIdx = argv.indexOf('--output');
  if (outIdx !== -1 && outIdx + 1 < argv.length) {
    outPath = resolveOutPath(argv[outIdx + 1]);
  }
  generate(outPath);
}
