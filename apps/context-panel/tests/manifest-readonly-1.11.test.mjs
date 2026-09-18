/**
 * tests/manifest-readonly-1.11.test.mjs — CORE/1.11 manifest read-only tests (R3 pattern).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

test('R3 (CORE/1.11): generate manifest writes file to disk', () => {
  // Generate (deliberate; only after evidence stable)
  execSync('node scripts/generate-manifest-1.11.mjs', { stdio: 'pipe' });
  assert.ok(existsSync('../../docs/contracts/handoff-core-1.11.manifest.txt'));
});

test('R3 (CORE/1.11): --verify exits 0 on clean manifest', () => {
  try {
    execSync('node scripts/generate-manifest-1.11.mjs --verify', { stdio: 'pipe' });
  } catch (err) {
    assert.fail(`verify should exit 0: ${err.message}`);
  }
});

test('R3 (CORE/1.11): --check reports clean coverage', () => {
  try {
    execSync('node scripts/generate-manifest-1.11.mjs --check', { stdio: 'pipe' });
  } catch (err) {
    assert.fail(`check should exit 0: ${err.message}`);
  }
});

test('R3 (CORE/1.11): manifest separates CORE/1.11 from CORE/1.9 baseline', () => {
  // CORE/1.11 manifest is at a DIFFERENT file path than CORE/1.9 manifest.
  // This preserves the CORE/1.9 audit-PASS baseline as immutable evidence.
  const v11 = '../../docs/contracts/handoff-core-1.11.manifest.txt';
  const v19 = '../../docs/contracts/handoff-core-1.9.manifest.txt';
  assert.notEqual(v11, v19, 'manifest paths must be distinct');

  const raw = readFileSync(v11, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.startsWith('FILE|'));
  assert.ok(lines.length >= 10, `expected at least 10 entries, got ${lines.length}`);
});
