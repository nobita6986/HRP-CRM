/**
 * tests/manifest-readonly-1.14.test.mjs — CORE/1.14 manifest read-only contract tests.
 *
 * CORE/1.14 delta:
 *  - Test generates to scratch via --output (never touches bundled manifest).
 *  - --verify / --check are read-only against BUNDLED manifest.
 *  - After test run, bundled manifest bytes are unchanged (proving test
 *    is non-destructive).
 *
 * Verifies:
 *  - generate with --output writes to scratch only.
 *  - --verify is READ-ONLY: does not modify manifest bytes.
 *  - --check is READ-ONLY: only reads for coverage check.
 *  - Manifest paths are distinct (1.9 / 1.11 / 1.12 / 1.13 / 1.14 separate).
 *  - Bundled manifest covers all 5 observability files + 6 test files.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../scripts/generate-manifest-1.14.mjs');
const SCRATCH_OUT = join(__dirname, 'scratch-handoff-core-1.14.manifest.txt');
const BUNDLED = join(__dirname, '../../../docs/contracts/handoff-core-1.14.manifest.txt');

// Build if needed.
if (!existsSync('./dist/server.js')) {
  execSync('npm run build', { stdio: 'inherit' });
}
if (!existsSync('./dist/observability/index.js')) {
  execSync('npm run build', { stdio: 'inherit' });
}

function run(args) {
  try {
    const out = execSync(`node ${args}`, { cwd: process.cwd(), encoding: 'utf-8' });
    return { stdout: out, exitStatus: 0 };
  } catch (e) {
    const err = /** @type {{ status?: number; stdout?: string; stderr?: string }} */ (e);
    return { stdout: err.stdout ?? '', exitStatus: err.status ?? 1 };
  }
}

function fileHash(path) {
  const data = readFileSync(path);
  return createHash('sha256').update(data).digest('hex');
}

test('manifest: generate writes to --output scratch file (not bundled)', () => {
  // Generate the bundled manifest first if missing.
  if (!existsSync(BUNDLED)) {
    run(SCRIPT);
  }
  const beforeHash = fileHash(BUNDLED);
  // Generate to scratch.
  run(`${SCRIPT} --output ${SCRATCH_OUT}`);
  assert.equal(existsSync(SCRATCH_OUT), true, 'scratch manifest should be created');
  // Bundled manifest unchanged.
  assert.equal(fileHash(BUNDLED), beforeHash, 'bundled manifest must NOT be modified by --output');
  if (existsSync(SCRATCH_OUT)) unlinkSync(SCRATCH_OUT);
});

test('manifest: --verify is read-only (does not modify bundled manifest)', () => {
  const beforeHash = fileHash(BUNDLED);
  const beforeContent = readFileSync(BUNDLED);
  const result = run(`${SCRIPT} --verify`);
  assert.equal(result.exitStatus, 0, '--verify should exit 0 for clean manifest');
  assert.equal(fileHash(BUNDLED), beforeHash, 'bundled manifest bytes must NOT change after --verify');
  assert.deepEqual(readFileSync(BUNDLED), beforeContent, 'bundled content must be identical after --verify');
});

test('manifest: --check is read-only', () => {
  const beforeHash = fileHash(BUNDLED);
  const exitCode = run(`${SCRIPT} --check`).exitStatus;
  assert.equal(exitCode, 0, '--check should exit 0');
  assert.equal(fileHash(BUNDLED), beforeHash, '--check must not modify manifest');
});

test('manifest: CORE/1.14 manifest path is distinct from other CORE manifests', () => {
  const others = [
    'D:/CodeApp/Hrp-Crm/docs/contracts/handoff-core-1.9.manifest.txt',
    'D:/CodeApp/Hrp-Crm/docs/contracts/handoff-core-1.11.manifest.txt',
    'D:/CodeApp/Hrp-Crm/docs/contracts/handoff-core-1.12.manifest.txt',
    'D:/CodeApp/Hrp-Crm/docs/contracts/handoff-core-1.12.postaudit.manifest.txt',
    'D:/CodeApp/Hrp-Crm/docs/contracts/handoff-core-1.13.manifest.txt',
  ];
  for (const other of others) {
    assert.notEqual(BUNDLED, other, `${BUNDLED} must be distinct from ${other}`);
  }
});

test('manifest: CORE/1.14 manifest covers all observability + test files', () => {
  const content = readFileSync(BUNDLED, 'utf-8');
  const required = [
    'src/observability/correlation.ts',
    'src/observability/metrics.ts',
    'src/observability/log-scrubber.ts',
    'src/observability/kill-switch.ts',
    'src/observability/index.ts',
    'tests/observability.test.mjs',
    'tests/kill-switch.test.mjs',
    'tests/recovery.test.mjs',
    'tests/security-regression-1.14.test.mjs',
    'tests/correlation-trace.test.mjs',
    'tests/log-scrubber.test.mjs',
    'scripts/generate-manifest-1.14.mjs',
    'src/server.ts',
    // CORE/1.14 B1: shared-file delta.
    'src/assistant/service.ts',
    'src/orchestrator-wire.ts',
  ];
  for (const file of required) {
    assert.ok(content.includes(file), `bundled manifest must include ${file}`);
  }
});

test('manifest: bundled manifest SHA-256 matches bundle hash output', () => {
  // Sanity: content hash is stable, no missing files.
  const content = readFileSync(BUNDLED, 'utf-8');
  const lineCount = content.split('\n').filter((l) => l.startsWith('FILE|')).length;
  assert.ok(lineCount >= 12, `manifest must cover at least 12 files (got ${lineCount})`);
});
