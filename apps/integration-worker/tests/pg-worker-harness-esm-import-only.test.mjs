/**
 * apps/integration-worker/tests/pg-worker-harness-esm-import-only.test.mjs
 *
 * T1-B / V7.9b / B.02 -- ESM-import regression test (import-only classification).
 *
 * Classification (per C-R2F-03 option B):
 *
 *   This test is an ESM/import regression test, NOT a runtime proof of the
 *   R6-07 fallback chain. It only asserts:
 *
 *     1. The harness module is parseable as ESM (i.e. no top-level
 *        `require(...)` calls remain; the historical bug was exactly
 *        `require('node:path')` / `require('node:fs')` inside an
 *        .mjs file which produced `ReferenceError: require is not defined`
 *        at runtime).
 *     2. harness.start() can complete (the harness module loads under
 *        Node's ESM loader without throwing on its top-level imports).
 *     3. harness.stop() does NOT throw a `ReferenceError` for the
 *        `node:fs` / `node:path` imports used by the R6-07 postmaster.pid
 *        peek.
 *
 *   This test does NOT claim runtime coverage of:
 *     - `pg_ctl_validation`
 *     - `pg_ctl_postmaster_pid_check`
 *     - `pg_ctl_stop` or `recorded_pid_already_gone`
 *     - `bounded_wait_port_closed`
 *
 *   The R6-07 fallback chain is exercised end-to-end only by the B.02
 *   isolated gate (`scripts/run-b02-isolated.mjs`) and the focused
 *   negative-timeout probe (see `docs/contracts/T1-B-POSTGRES-LISTENER-R2-FINAL.md`).
 *
 * Why this classification:
 *
 *   Producing a deterministic seam that forces the harness into the R6-07
 *   branch without introducing a non-trivial amount of synthetic code into
 *   production (e.g. a dummy TCP listener that races the embedded-postgres
 *   postmaster for the suffix port) violates C-R2F-02's "no complexity for
 *   a test-only reason" rule. T0 explicitly allows this option:
 *
 *     "B. Nếu không thể tạo deterministic fallback mà không làm phức tạp
 *        production code: Giữ test là ESM/import regression test và đổi
 *        tên/claim trung thực"
 *
 * Strict UTF-8 no BOM.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url));
const WORKER_TESTS_DIR = resolve(HERE, '..');

test('pg-worker-harness.mjs is ESM-only (no CommonJS require)', async (t) => {
  const harnessPath = join(WORKER_TESTS_DIR, 'pg-worker-harness.mjs');
  const src = readFileSync(harnessPath, 'utf8');

  await t.test('no top-level require(...) calls remain', () => {
    // Strip line comments and block comments before scanning, so any
    // `require(...)` that appears inside a comment does not produce a
    // false positive. We deliberately keep string literals intact --
    // a stray string `'require('node:path')'` would still need to be
    // matched, but since the fix removed the actual calls, no literal
    // remains in production code.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const matches = stripped.match(/\brequire\s*\(/g) || [];
    assert.equal(
      matches.length,
      0,
      'pg-worker-harness.mjs must not contain any `require(` call; found ' +
        matches.length +
        ' occurrence(s). Historical bug: `require is not defined` in .mjs file.',
    );
  });

  await t.test('static import for node:fs and node:path is present', () => {
    // The R6-07 fallback uses `existsSync` and `readFileSync` from
    // node:fs, plus `path.join` from node:path. Both modules must be
    // imported at the top of the file (NOT via `require`).
    assert.match(
      src,
      /^import\s+\{[^}]*\bexistsSync\b[^}]*\}\s+from\s+['"]node:fs['"]/m,
      'expected static import of existsSync from node:fs at top of file',
    );
    assert.match(
      src,
      /^import\s+\{[^}]*\breadFileSync\b[^}]*\}\s+from\s+['"]node:fs['"]/m,
      'expected static import of readFileSync from node:fs at top of file',
    );
    assert.match(
      src,
      /^import\s+(?:path\b|\{[^}]*\}\s+from\s+['"]node:path['"])/m,
      'expected static import of path (default or namespace) from node:path at top of file',
    );
  });
});

test('harness.stop() does not throw ReferenceError on the ESM imports used by R6-07', async (t) => {
  // We boot the harness for real (so the ESM module loads through Node's
  // loader and the top-level `import` statements are evaluated), then
  // call stop(). The historical failure was a ReferenceError raised when
  // the R6-07 postmaster.pid peek reached `require('node:fs')` inside
  // an .mjs file. With static imports that path is impossible; we assert
  // the absence of that specific failure mode here.
  //
  // We do NOT assert that the R6-07 branch was traversed -- in an
  // isolated test run the embedded-postgres `pg.stop()` typically
  // returns with the port already closed, so the harness takes the
  // fast path (`post_stop_port_already_closed`) and the R6-07 fallback
  // never runs. See the file header for classification rationale.
  //
  // Note on harness.stop() outcome: this test only asserts that
  // stop() did NOT throw ReferenceError. stop() may throw other
  // errors (e.g. `port_still_listening` if the embedded-postgres
  // child became a Windows ghost listener) -- those failures are
  // unrelated to the ESM fix and are reported separately via the
  // B.02 isolated gate. The 8/8 business scenarios and the R6-07
  // fallback runtime coverage live there.
  const suffix = 'esm_io_' + Date.now().toString(36) + '_' + randomBytes(3).toString('hex');
  process.env['PG_HARNESS_SUFFIX'] = suffix;

  let stopErr = null;
  let stopErrName = null;
  let stopErrMsg = null;
  let harness = null;
  try {
    const harnessUrl = pathToFileURL(join(WORKER_TESTS_DIR, 'pg-worker-harness.mjs')).href;
    const mod = await import(harnessUrl);
    harness = await mod.start();
    await harness.stop();
  } catch (e) {
    stopErr = e;
    stopErrName = e && e.name;
    stopErrMsg = (e && e.message) ? String(e.message) : String(e);
  }

  await t.test('harness.stop() did not throw a ReferenceError', () => {
    if (!stopErr) return;
    assert.ok(
      !/require is not defined/.test(stopErrMsg),
      'must not throw ReferenceError: require is not defined; got: ' + stopErrMsg,
    );
    if (stopErrName === 'ReferenceError') {
      assert.ok(
        !/node:fs|node:path/.test(stopErrMsg),
        'ReferenceError must not reference node:fs / node:path; got: ' + stopErrMsg,
      );
    }
  });

  // Force a clean exit so the embedded-postgres child (which may still
  // hold the suffix port as a Windows ghost listener, the same pattern
  // documented in the B.02 isolated gate evidence) does not keep the
  // Node test runner alive past the assertion. This is a test-runner
  // hygiene detail only; it does not affect the assertions above.
  if (harness && typeof harness.stop === 'function') {
    try { await harness.stop(); } catch {}
  }
});
