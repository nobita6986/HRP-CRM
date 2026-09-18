/**
 * tests/manifest-readonly-1.13.test.mjs — CORE/1.13 manifest read-only contract tests.
 *
 * CORE/1.13 delta (post-audit):
 *  - Test generates to scratch via --output (never touches bundled).
 *  - --verify / --check are read-only against the BUNDLED manifest.
 *  - After test run, bundled manifest bytes are unchanged (proving test
 *    is non-destructive).
 *
 * Verifies:
 *  - generate with --output writes to scratch only.
 *  - --verify is READ-ONLY: does not modify manifest bytes.
 *  - --check is READ-ONLY: only reads for coverage check.
 *  - Manifest paths are distinct (1.9 / 1.11 / 1.12 / 1.13 separate).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../scripts/generate-manifest-1.13.mjs');
// Absolute paths for scratch output to avoid Windows path joining issues.
const SCRATCH_OUT = join(__dirname, 'scratch-handoff-core-1.13.manifest.txt');
// __dirname = apps/context-panel/tests/
// '../../..' = project root (D:/CodeApp/Hrp-Crm/)
const BUNDLED = join(__dirname, '../../../docs/contracts/handoff-core-1.13.manifest.txt');

// Build if needed.
if (!existsSync('./dist/server.js')) {
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

/** SHA-256 of a file's bytes. */
function fileHash(path) {
  const data = readFileSync(path);
  return createHash('sha256').update(data).digest('hex');
}

test('manifest: generate writes to --output scratch file (not bundled)', () => {
  // Record bundled hash before.
  const beforeHash = fileHash(BUNDLED);
  // Generate to scratch.
  run(`${SCRIPT} --output ${SCRATCH_OUT}`);
  assert.equal(existsSync(SCRATCH_OUT), true, 'scratch manifest should be created');
  // Bundled manifest unchanged.
  assert.equal(fileHash(BUNDLED), beforeHash, 'bundled manifest must NOT be modified by --output');
  // Clean up scratch.
  if (existsSync(SCRATCH_OUT)) unlinkSync(SCRATCH_OUT);
});

test('manifest: --verify is read-only (does not modify bundled manifest)', () => {
  const beforeHash = fileHash(BUNDLED);
  const beforeContent = readFileSync(BUNDLED);
  // Run verify (should be read-only).
  const result = run(`${SCRIPT} --verify`);
  assert.equal(result.exitStatus, 0, '--verify should exit 0 for clean manifest');
  // Bundled bytes unchanged.
  assert.equal(fileHash(BUNDLED), beforeHash, 'bundled manifest bytes must NOT change after --verify');
  assert.deepEqual(readFileSync(BUNDLED), beforeContent, 'bundled content must be identical after --verify');
});

test('manifest: --check is read-only', () => {
  const beforeHash = fileHash(BUNDLED);
  const exitCode = run(`${SCRIPT} --check`).exitStatus;
  assert.equal(exitCode, 0, '--check should exit 0');
  assert.equal(fileHash(BUNDLED), beforeHash, '--check must not modify manifest');
});

test('manifest: CORE/1.13 manifest path is distinct from other CORE manifests', () => {
  const others = [
    'D:/CodeApp/Hrp-Crm/docs/contracts/handoff-core-1.9.manifest.txt',
    'D:/CodeApp/Hrp-Crm/docs/contracts/handoff-core-1.11.manifest.txt',
    'D:/CodeApp/Hrp-Crm/docs/contracts/handoff-core-1.12.manifest.txt',
    'D:/CodeApp/Hrp-Crm/docs/contracts/handoff-core-1.12.postaudit.manifest.txt',
  ];
  for (const other of others) {
    assert.notEqual(BUNDLED, other, `${BUNDLED} must be distinct from ${other}`);
  }
});

test('manifest: CORE/1.13 manifest covers all assistant-source + test + script files', () => {
  // Verify the bundled manifest has expected source files for the CORE/1.13 delta.
  // R3 mandate: orchestrator-wire.ts is a SHARED file modified in B1 for
  // scope-based autofill auth. It IS part of the CORE/1.13 delta (not
  // CORE/1.9 — the CORE/1.9 manifest is frozen at its baseline-PASS snapshot).
  const content = readFileSync(BUNDLED, 'utf-8');
  const required = [
    'src/assistant/store.ts',
    'src/assistant/service.ts',
    'src/assistant/types.ts',
    'src/assistant/fixtures.ts',
    'src/assistant/index.ts',
    'src/ui/components/assistant-panel.tsx',
    'tests/assistant-service.test.mjs',
    'tests/assistant-api.test.mjs',
    'tests/assistant-browser-evidence.mjs',
    'scripts/generate-manifest-1.13.mjs',
    // R3 added:
    'src/orchestrator-wire.ts',
  ];
  for (const file of required) {
    assert.ok(content.includes(file), `bundled manifest must include ${file}`);
  }
});
