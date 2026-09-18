/**
 * tests/manifest-readonly.test.mjs — Read-only verification guarantee (R3).
 *
 * Proves:
 *  1. The manifest verification path is read-only: running --verify does NOT
 *     modify the manifest file's bytes. The test captures the file hash
 *     before/after and asserts equality.
 *  2. --verify exits 1 when a hash mismatch is detected, WITHOUT modifying the
 *     manifest on disk.
 *  3. --verify exits 0 when all hashes match.
 *  4. --check reports clean coverage.
 *
 * Run: node --test tests/manifest-readonly.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..');
const REPO_ROOT = join(__dirname, '..', '..', '..');
const MANIFEST_PATH = join(REPO_ROOT, 'docs/contracts/handoff-core-1.9.manifest.txt');
const SCRIPT_PATH = join(APP_ROOT, 'scripts', 'generate-manifest.mjs');

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function runScript(args) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: APP_ROOT,
    encoding: 'utf-8',
  });
}

test('R3: --verify does not modify manifest bytes (read-only)', () => {
  if (!existsSync(MANIFEST_PATH)) {
    // Generate first if missing — this is a separate, deliberate action.
    const gen = runScript([]);
    assert.equal(gen.status, 0, 'generate must succeed before verifying: ' + gen.stderr);
  }
  const beforeBytes = readFileSync(MANIFEST_PATH);
  const beforeHash = sha256(beforeBytes);

  const result = runScript(['--verify']);
  const afterBytes = readFileSync(MANIFEST_PATH);
  const afterHash = sha256(afterBytes);

  assert.equal(
    beforeHash,
    afterHash,
    '--verify must NOT modify manifest bytes (read-only contract)',
  );
  // --verify should pass against a clean manifest
  assert.equal(result.status, 0, '--verify should exit 0 on clean manifest: ' + result.stderr);
});

test('R3: --verify exits 1 on mismatch WITHOUT writing manifest', () => {
  // Generate a fresh manifest, then tamper with one BUNDLE_FILES entry. --verify
  // must FAIL with exit code 1 and the manifest bytes must be preserved.
  const gen = runScript([]);
  assert.equal(gen.status, 0, 'initial generate must succeed');

  const beforeBytes = readFileSync(MANIFEST_PATH);
  const beforeHash = sha256(beforeBytes);

  // Tamper with a bundle-tracked file (build-ui.mjs is bundled). Add a harmless comment line.
  const tamperPath = join(APP_ROOT, 'scripts', 'build-ui.mjs');
  const original = readFileSync(tamperPath, 'utf-8');
  writeFileSync(tamperPath, original + '\n// tampered-for-r3-test\n');

  try {
    const result = runScript(['--verify']);
    const afterBytes = readFileSync(MANIFEST_PATH);
    const afterHash = sha256(afterBytes);

    assert.notEqual(result.status, 0, '--verify must exit nonzero on mismatch');
    assert.match(result.stderr + result.stdout, /verify FAIL/i);

    assert.equal(
      beforeHash,
      afterHash,
      '--verify must NEVER write the manifest file (even on failure)',
    );
  } finally {
    writeFileSync(tamperPath, original);
  }

  // After restore, --verify must pass again and still not modify the file.
  const result2 = runScript(['--verify']);
  assert.equal(result2.status, 0, '--verify should pass after restoring the file');
  const finalBytes = readFileSync(MANIFEST_PATH);
  assert.equal(sha256(finalBytes), beforeHash, 'manifest still untouched after restore');
});

test('R3: --check reports clean coverage (no missing/duplicate, no zombie removed)', () => {
  const result = runScript(['--check']);
  const manifestBefore = sha256(readFileSync(MANIFEST_PATH));
  assert.equal(result.status, 0, '--check should pass on stable snapshot: ' + result.stderr);
  // --check is also read-only.
  const manifestAfter = sha256(readFileSync(MANIFEST_PATH));
  assert.equal(manifestBefore, manifestAfter, '--check must not modify manifest');
});

test('R3: generate vs verify are explicit separate modes', () => {
  // Generate writes the file.
  const gen = runScript([]);
  assert.equal(gen.status, 0, 'generate (no flag) must succeed');

  // Capture hash, then verify: must NOT change it.
  const before = sha256(readFileSync(MANIFEST_PATH));
  const verify = runScript(['--verify']);
  const after = sha256(readFileSync(MANIFEST_PATH));

  assert.equal(before, after, '--verify does not write');
  assert.equal(verify.status, 0, '--verify passes against freshly generated manifest');
});
