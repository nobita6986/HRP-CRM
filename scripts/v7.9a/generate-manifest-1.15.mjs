/**
 * scripts/v7.9a/generate-manifest-1.15.mjs
 *
 * Generates or verifies docs/contracts/handoff-core-1.15.manifest.txt
 * with SHA-256 hashes of all CORE/1.15 delta files.
 *
 * Modes (mutually exclusive):
 *   (default)          Generate manifest (write).
 *   --verify           Verify manifest against files on disk. READ-ONLY.
 *   --check            Coverage check. READ-ONLY.
 *
 * Run:
 *   node scripts/v7.9a/generate-manifest-1.15.mjs
 *   node scripts/v7.9a/generate-manifest-1.15.mjs --verify
 *   node scripts/v7.9a/generate-manifest-1.15.mjs --check
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT_PATH = path.join(ROOT, 'docs/contracts/handoff-core-1.15.manifest.txt');

const DELTA_FILES = [
  // ── V7.9a Build Fix Delta (CORE/1.15 re-open) ────────────────────────
  //
  // Fix: Clean-environment build from isolated checkout.
  // Root cause: `runInTxn` had union type `(tx: PrismaTransactionClient | unknown)`
  // which collapsed to `unknown` — no `any`/`ts-ignore`/`strict` disabled.
  //
  // Fix: Single `runInTxn(prisma, fn)` overload with `prisma: PrismaClient`
  // and `fn: (tx: PrismaTransactionClient) => Promise<T>`. Prisma guarantees
  // `tx` type at runtime. All 45 TS errors resolved.
  //
  // Also: integration-api needed .d.ts exports for subpaths
  // (./gateway, ./orchestrator, ./review) consumed by context-panel.
  // tsconfig.json now emits declarations; package.json exports types paths.
  // This eliminates legacy "implicit any" / "err unknown" errors in
  // context-panel orchestrator-wire.ts without disabling typecheck.
  //
  // Scope:
  'packages/integration-store/src/client.ts',
  'packages/integration-store/src/index.ts',
  'packages/integration-store/src/repos/contact-link.ts',
  'packages/integration-store/src/repos/conversation-link.ts',
  'packages/integration-store/src/repos/event-receipt.ts',
  'packages/integration-store/src/repos/intake-checkpoint.ts',
  'packages/integration-store/src/repos/reconciliation.ts',
  'packages/integration-store/src/worker/lease.ts',
  'apps/integration-api/tsconfig.json',
  'apps/integration-api/package.json',
  '.gitignore',  // Added .codegraph/ to root .gitignore.

  // ── Scripts fix (CORE/1.15 re-open) ───────────────────────────────────
  //
  // Fix: install.ps1/sh wrong dist path checks (dist/client/index.js → dist/index.js),
  // missing npm ci, missing prisma generate, wrong build order.
  // Now uses npm ci + prisma generate + correct dependency graph.
  // Also fixed UTF-8 encoding for install.sh (was UTF-16LE).
  'scripts/v7.9a/install.ps1',
  'scripts/v7.9a/install.sh',

  // ── Original CORE/1.15 Acceptance Delta ────────────────────────────────
  //
  // PG harness locale fix for Windows portability (--locale=C).
  'apps/integration-api/tests/pg-receiver-harness.mjs',
  'apps/integration-api/tests/pg-orchestrator-harness.mjs',
  'apps/integration-api/tests/pg-reconcile-harness.mjs',
  'apps/integration-api/tests/pg-reconciler-harness.mjs',
  'apps/integration-api/tests/outbox.test.mjs',
  'apps/integration-worker/tests/pg-worker-harness.mjs',
  // Acceptance demo (A01-A15 scenarios).
  'apps/integration-api/tests/acceptance-1.15-demo.mjs',
  // Original runbook scripts.
  'scripts/v7.9a/start.ps1',
  'scripts/v7.9a/start.sh',
  'scripts/v7.9a/stop.ps1',
  'scripts/v7.9a/stop.sh',
  'scripts/v7.9a/seed.mjs',
  'scripts/v7.9a/test-integration.ps1',
  'scripts/v7.9a/test-integration.sh',
  // Shared embedded-PG bootstrap. Lives inside apps/integration-api/scripts/
// so its `import 'embedded-postgres'` resolves from apps/integration-api/
// node_modules (the only place where that dep exists). Auditor recheck
// (2026-09-19 13:50): start.ps1 was inlining the bootstrap as a heredoc
// and running it with the wrong cwd (root), which could not resolve
// embedded-postgres. start.sh was calling scripts/v7.9a/bootstrap-pg.ts
// which did not exist. Both scripts now invoke this single tracked
// bootstrap with cwd set to apps/integration-api.
  'apps/integration-api/scripts/bootstrap-pg.mjs',
  // Original handoff.
  'docs/contracts/handoff-core-1.15.md',
  // Manifest generation tooling.
  'scripts/v7.9a/generate-manifest-1.15.mjs',
  // This delta handoff document.
  'docs/contracts/handoff-core-1.15-delta-build-fix.md',
];

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex').toUpperCase();
}

function check() {
  const seen = new Set();
  const missing = [];
  const duplicates = [];
  for (const relPath of DELTA_FILES) {
    if (seen.has(relPath)) { duplicates.push(relPath); }
    seen.add(relPath);
    const fullPath = path.join(ROOT, relPath);
    if (!existsSync(fullPath)) missing.push(relPath);
  }
  const problems = [];
  if (duplicates.length > 0) problems.push('duplicate entries: ' + duplicates.join(', '));
  if (missing.length > 0) problems.push('missing files: ' + missing.join(', '));
  if (problems.length === 0) {
    console.log('check OK: ' + DELTA_FILES.length + ' bundle entries clean.');
    process.exit(0);
  } else {
    console.error('check FAIL:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
}

function verify() {
  if (!existsSync(OUT_PATH)) {
    console.error('verify FAIL: manifest not found at ' + OUT_PATH);
    process.exit(1);
  }
  const raw = readFileSync(OUT_PATH, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.match(/^[A-F0-9]{64}\s{2}/));
  const manifestEntries = lines.map((l) => {
    const hash = l.substring(0, 64);
    const relPath = l.substring(66).replace(/\s+\(\d+\s+bytes\)$/, '').trim();
    return { relPath, hash };
  });

  const problems = [];
  const checked = [];
  for (const { relPath, hash } of manifestEntries) {
    const fullPath = path.join(ROOT, relPath);
    if (!existsSync(fullPath)) {
      problems.push('missing on disk: ' + relPath);
      continue;
    }
    const actual = sha256(readFileSync(fullPath));
    if (actual !== hash) {
      problems.push('hash mismatch: ' + relPath + ' (manifest=' + hash + ' actual=' + actual + ')');
    } else {
      checked.push(relPath);
    }
  }

  const seen = new Set(manifestEntries.map((e) => e.relPath));
  for (const relPath of DELTA_FILES) {
    if (!seen.has(relPath)) problems.push('bundle file not in manifest: ' + relPath);
  }

  if (problems.length === 0) {
    console.log('verify OK: ' + checked.length + ' entries matched, 0 missing, 0 mismatch.');
    process.exit(0);
  } else {
    console.error('verify FAIL: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
}

function generate() {
  const seen = new Set();
  const missing = [];
  const entries = [];

  for (const relPath of DELTA_FILES) {
    if (seen.has(relPath)) throw new Error('Duplicate entry: ' + relPath);
    seen.add(relPath);
    const fullPath = path.join(ROOT, relPath);
    if (!existsSync(fullPath)) { missing.push(relPath); continue; }
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
  const bundle = createHash('sha256');
  for (const e of entries) bundle.update(e.hash);
  const bundleHash = bundle.digest('hex').toUpperCase();

  let out = '';
  out += '# CORE/1.15 V7.9a acceptance - SHA-256 manifest\n';
  out += '# Date: ' + now + '\n';
  out += '# Total files: ' + entries.length + '\n';
  out += '# Bundle hash: ' + bundleHash + '\n';
  out += '#\n';
  out += '# Format: SHA256  <repo-relative-path>  (bytes bytes)\n';
  out += '#\n';
  out += '# Read-only modes:\n';
  out += '#   node scripts/v7.9a/generate-manifest-1.15.mjs --verify\n';
  out += '#   node scripts/v7.9a/generate-manifest-1.15.mjs --check\n';
  out += '#\n';
  for (const e of entries) {
    out += e.hash + '  ' + e.relPath + '  (' + e.size + ' bytes)\n';
  }
  out += '#\n';
  out += '# Bundle hash (SHA-256 of all file hashes)\n';
  out += '# ' + bundleHash + '\n';

  writeFileSync(OUT_PATH, out, 'utf-8');
  console.log('Manifest written: ' + OUT_PATH + ' (' + entries.length + ' entries).');
  console.log('Bundle hash: ' + bundleHash);
}

const argv = process.argv.slice(2);
if (argv.includes('--verify')) {
  verify();
} else if (argv.includes('--check')) {
  check();
} else {
  generate();
}