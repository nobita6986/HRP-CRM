/**
 * scripts/generate-manifest.mjs — Generate / Verify SHA-256 manifest for CORE/1.9 bundle.
 *
 * Modes (mutually exclusive):
 *   (default)            Generate manifest: writes docs/contracts/handoff-core-1.9.manifest.txt
 *   --verify             Verify manifest against files on disk. READ-ONLY: never writes
 *                        any file. Exits 0 if all hashes match, 1 on any missing/mismatch.
 *   --check              Coverage check: every file in BUNDLE_FILES exists, no duplicates,
 *                        manifest itself covers them. READ-ONLY. Exits 0 on clean, 1 on issues.
 *
 * Separation:
 *   - Generate is a deliberate action taken AFTER code/evidence is stable.
 *   - Verify/Check are read-only operations that may be run at any time without
 *     touching the manifest on disk.
 *
 * Test guarantee:
 *   --verify does NOT call writeFileSync; manifest bytes are preserved across runs.
 *   On mismatch, --verify exits 1 and leaves the manifest file untouched.
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const OUT_PATH = join(REPO_ROOT, 'docs/contracts/handoff-core-1.9.manifest.txt');

/**
 * Files in CORE/1.9 bundle.
 *
 * R4 (re-recheck): verbatim orchestrator/gateway copies in apps/context-panel/src/
 * were removed; the panel now imports from @hrp-engagement/integration-api (the
 * shared package). The removed local files are listed in REMOVED_FILES below and
 * are NOT included in the manifest (they no longer exist).
 */
const BUNDLE_FILES = [
  // Source - server + wire + review wiring (R4 shared-module wiring)
  'apps/context-panel/src/server.ts',
  'apps/context-panel/src/orchestrator-wire.ts',
  'apps/context-panel/src/gateway-call-log.ts',
  'apps/context-panel/src/review/wiring.ts',
  // CORE/1.11 — Routing module (NEW: extends server, app.tsx, adds 4th tab)
  'apps/context-panel/src/routing/types.ts',
  'apps/context-panel/src/routing/simulator.ts',
  'apps/context-panel/src/routing/config-store.ts',
  'apps/context-panel/src/routing/service.ts',
  // Source - UI
  'apps/context-panel/src/ui/mock-api.ts',
  'apps/context-panel/src/ui/types.ts',
  'apps/context-panel/src/ui/app.tsx',
  'apps/context-panel/src/ui/components/index.ts',
  'apps/context-panel/src/ui/components/talent-panel.tsx',
  'apps/context-panel/src/ui/components/client-panel.tsx',
  'apps/context-panel/src/ui/components/intake-review.tsx',
  'apps/context-panel/src/ui/components/context-panel.tsx',
  'apps/context-panel/src/ui/components/states.tsx',
  'apps/context-panel/src/ui/components/placement-case.tsx',
  'apps/context-panel/src/ui/components/availability.tsx',
  'apps/context-panel/src/ui/components/close-reason-select.tsx',
  'apps/context-panel/src/ui/components/current-relationship.tsx',
  'apps/context-panel/src/ui/components/badge.tsx',
  'apps/context-panel/src/ui/components/routing-panel.tsx',
  // Build
  'apps/context-panel/scripts/build-ui.mjs',
  'apps/context-panel/scripts/generate-manifest.mjs',
  'apps/context-panel/package.json',
  // Tests
  'apps/context-panel/tests/server.test.mjs',
  'apps/context-panel/tests/panel-ui.test.mjs',
  'apps/context-panel/tests/browser-evidence.mjs',
  'apps/context-panel/tests/security-evidence.mjs',
  'apps/context-panel/tests/manifest-readonly.test.mjs',
  'apps/context-panel/tests/routing-simulator.test.mjs',
  'apps/context-panel/tests/routing-api.test.mjs',
  'apps/context-panel/tests/evidence/summary.json',
  'apps/context-panel/tests/evidence/summary.r2.json',
  'apps/context-panel/tests/evidence/summary.r3.json',
  // Handoff docs (CORE/1.9 still bundled)
  'docs/contracts/handoff-core-1.9.md',
  'docs/contracts/handoff-core-1.9.status.md',
  'docs/reviews/audit-core-1.9.md',
];

/**
 * REMOVED in R4 re-recheck — verbatim orchestrator/gateway copies and source-link
 * mechanism (no longer exist on disk and must NOT be hashed in manifest).
 */
const REMOVED_FILES = [
  // Verbatim orchestrator copies (replaced by @hrp-engagement/integration-api/orchestrator import)
  'apps/context-panel/src/orchestrator/index.ts',
  'apps/context-panel/src/orchestrator/intake-orchestrator.ts',
  'apps/context-panel/src/orchestrator/digest.ts',
  'apps/context-panel/src/orchestrator/dnc-handler.ts',
  'apps/context-panel/src/orchestrator/steps.ts',
  // Verbatim gateway copies (replaced by @hrp-engagement/integration-api/gateway import)
  'apps/context-panel/src/gateway/index.ts',
  'apps/context-panel/src/gateway/mock-gateway.ts',
  'apps/context-panel/src/gateway/ledger.ts',
  'apps/context-panel/src/gateway/scenarios.ts',
  'apps/context-panel/src/gateway/types.ts',
  // Store shim (was only used by removed copies)
  'apps/context-panel/src/store/intake-checkpoint-shim.ts',
  // Source-link mechanism (R4 superseded)
  'apps/context-panel/src/types/integration-api-shims.d.ts',
  'apps/context-panel/src/.source-link.json',
  'apps/context-panel/scripts/generate-source-link.mjs',
];

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function checkCoverage() {
  // --check: ensure no duplicates, no missing files in BUNDLE_FILES.
  const seen = new Set();
  const missing = [];
  const duplicates = [];
  for (const relPath of BUNDLE_FILES) {
    if (seen.has(relPath)) duplicates.push(relPath);
    seen.add(relPath);
    const fullPath = join(REPO_ROOT, relPath);
    if (!existsSync(fullPath)) missing.push(relPath);
  }
  // Also ensure REMOVED_FILES actually no longer exist (no silent resurrection).
  const stillExists = REMOVED_FILES.filter((p) => existsSync(join(REPO_ROOT, p)));
  return { duplicates, missing, stillExists };
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
  out += '# CORE/1.9 — Handoff Manifest\n';
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
  out += '#\n';
  out += '# Removed (R4 re-recheck — verbatim copies/source-link superseded):\n';
  for (const r of REMOVED_FILES) out += `#   - ${r}\n`;

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

  // Cross-check: every BUNDLE_FILES entry must be present in the manifest.
  for (const relPath of BUNDLE_FILES) {
    if (!seen.has(relPath)) problems.push(`bundle file not in manifest: ${relPath}`);
  }

  // Cross-check: every REMOVED_FILES entry must NOT be in the manifest (no zombie hashes).
  for (const relPath of REMOVED_FILES) {
    if (seen.has(relPath)) problems.push(`removed file still in manifest: ${relPath}`);
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
  const { duplicates, missing, stillExists } = checkCoverage();
  const problems = [];
  if (duplicates.length > 0) problems.push(`duplicate bundle entries: ${duplicates.join(', ')}`);
  if (missing.length > 0) problems.push(`missing bundle files: ${missing.join(', ')}`);
  if (stillExists.length > 0) problems.push(`removed files still on disk: ${stillExists.join(', ')}`);

  if (problems.length === 0) {
    console.log(`check OK: ${BUNDLE_FILES.length} bundle entries clean, ${REMOVED_FILES.length} removed files confirmed absent.`);
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
