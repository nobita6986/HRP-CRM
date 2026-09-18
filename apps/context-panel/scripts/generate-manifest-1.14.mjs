/**
 * scripts/generate-manifest-1.14.mjs — Generate / Verify SHA-256 manifest
 * for CORE/1.14 bundle (Observability + security regression).
 *
 * Generates docs/contracts/handoff-core-1.14.manifest.txt.
 * Separate from CORE/1.9/1.11/1.12/1.13 manifests to preserve their
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
const SCRIPT_DIR = __dirname; // apps/context-panel/scripts
const SCRIPT_REPO_ROOT = join(SCRIPT_DIR, '..', '..', '..'); // repo root
const OUT_PATH = join(SCRIPT_REPO_ROOT, 'docs/contracts/handoff-core-1.14.manifest.txt');

function resolveOutPath(outArg) {
  if (!outArg) return OUT_PATH;
  if (outArg.match(/^[A-Za-z]:/u) || outArg.startsWith('/')) return outArg;
  return join(SCRIPT_REPO_ROOT, outArg);
}

// CORE/1.14 bundle files
const BUNDLE_FILES = [
  // ── NEW: observability module
  'apps/context-panel/src/observability/correlation.ts',
  'apps/context-panel/src/observability/metrics.ts',
  'apps/context-panel/src/observability/log-scrubber.ts',
  'apps/context-panel/src/observability/kill-switch.ts',
  'apps/context-panel/src/observability/index.ts',
  // ── NEW: tests
  'apps/context-panel/tests/observability.test.mjs',
  'apps/context-panel/tests/kill-switch.test.mjs',
  'apps/context-panel/tests/recovery.test.mjs',
  'apps/context-panel/tests/security-regression-1.14.test.mjs',
  'apps/context-panel/tests/correlation-trace.test.mjs',
  'apps/context-panel/tests/log-scrubber.test.mjs',
  // ── Generator
  'apps/context-panel/scripts/generate-manifest-1.14.mjs',
  // ── SHARED: server.ts modified to add correlation/kill-switch/admin endpoints
  'apps/context-panel/src/server.ts',
  'apps/context-panel/src/ui/app.tsx',
  // CORE/1.14 B1: shared-file delta — assistant/service.ts and
  // orchestrator-wire.ts are part of the working tree delta (B3 wires
  // correlationId through orchestrator).
  'apps/context-panel/src/assistant/service.ts',
  'apps/context-panel/src/orchestrator-wire.ts',
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
  out += '# CORE/1.14 — Handoff Manifest\n';
  out += '# Date: ' + now + '\n';
  out += '# Generator: scripts/generate-manifest-1.14.mjs (SHA-256)\n';
  out += '# Total files: ' + entries.length + '\n';
  out += '#\n';
  out += '# CORE/1.14 delta from CORE/1.13 baseline:\n';
  out += '#  - NEW: 5 files (observability module)\n';
  out += '#  - NEW: 6 test files (unit + regression)\n';
  out += '#  - SHARED: 4 files (server.ts, ui/app.tsx, assistant/service.ts, orchestrator-wire.ts)\n';
  out += '#    orchestrator-wire.ts added in B1 (correlation propagation);\n';
  out += '#    assistant/service.ts added in B1 (NOT_FOUND → 404 mapping).\n';
  out += '#\n';
  out += '# Format: FILE|<repo-relative-path>|<sha256-hex>\n';
  out += '#\n';
  out += '\n';
  for (const e of entries) {
    out += `FILE|${e.relPath}|${e.hash}\n`;
  }
  out += '\n# Verification (READ-ONLY):\n';
  out += '#   node scripts/generate-manifest-1.14.mjs --verify\n';
  out += '#   node scripts/generate-manifest-1.14.mjs --check\n';

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
