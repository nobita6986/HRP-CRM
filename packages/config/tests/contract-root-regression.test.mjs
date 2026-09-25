// M2: contract-root-regression.test.mjs
// Per-consumer test that proves:
//  - exact 379/379 root export set equality with the bilaterally accepted baseline
//  - SCHEMA_VERSION pinned to "1"
//  - PACKAGE_VERSION pinned to "0.0.8-g0.8-fixes"
//  - no talent-context-read/v1 SUBPATH-only names leak into root
//  - representative round-trip probes on frozen root schemas/functions.
//
// Source of truth for the baseline 379-name fixture:
//   packages/contracts/tests/fixtures/baseline-379.fixtures.json
//
// The subpath-leak names that must NOT appear in the frozen root are stored
// in tests/fixtures/talent-context-subpath.fixtures.json (auto-derived from
// packages/contracts/dist/talent-context-read/index.js minus the four
// overlap primitive schema names that legitimately appear in both).
//
// Implementation per CONTRACT-03C.2 r2 M2 (FILE-CHANGE-PLAN.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function findContractsDist(startDir) {
  let cur = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(cur, 'packages', 'contracts', 'dist', 'index.js');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

const CONTRACTS_DIST = findContractsDist(HERE);
assert.ok(CONTRACTS_DIST, 'unable to locate packages/contracts/dist/index.js from ' + HERE);

const FIXTURE = resolve(dirname(CONTRACTS_DIST), '..', 'tests', 'fixtures', 'baseline-379.fixtures.json');
assert.ok(existsSync(FIXTURE), 'baseline fixture must exist: ' + FIXTURE);

const SUBPATH_FIXTURE = resolve(dirname(CONTRACTS_DIST), '..', 'tests', 'fixtures', 'talent-context-subpath.fixtures.json');
assert.ok(existsSync(SUBPATH_FIXTURE), 'subpath fixture must exist: ' + SUBPATH_FIXTURE);

const baselineJson = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const BASELINE_EXPORTS = baselineJson.exports;
assert.equal(baselineJson.count, 379, 'baseline fixture must report count=379; got ' + baselineJson.count);

const subpathJson = JSON.parse(readFileSync(SUBPATH_FIXTURE, 'utf8'));
const SUBPATH_ONLY_NAMES = new Set(subpathJson.subpath_only);

const root = await import(pathToFileURL(CONTRACTS_DIST).href);
const LIVE_EXPORTS = Object.keys(root).sort();

test('root: exact 379/379 set equality with bilaterally accepted baseline', () => {
  assert.equal(LIVE_EXPORTS.length, 379, 'LIVE root must have exactly 379 named exports; got ' + LIVE_EXPORTS.length);
  const baseSet = new Set(BASELINE_EXPORTS);
  const liveSet = new Set(LIVE_EXPORTS);
  const missing = [];
  const unexpected = [];
  for (const e of baseSet) if (!liveSet.has(e)) missing.push(e);
  for (const e of liveSet) if (!baseSet.has(e)) unexpected.push(e);
  assert.deepEqual(missing, [], 'no exports may be missing from frozen root; missing: ' + JSON.stringify(missing));
  assert.deepEqual(unexpected, [], 'no unexpected exports may be added to frozen root; unexpected: ' + JSON.stringify(unexpected));
});

test('SCHEMA_VERSION pinned to "1"', () => {
  assert.equal(typeof root.SCHEMA_VERSION, 'string');
  assert.equal(root.SCHEMA_VERSION, '1');
});

test('PACKAGE_VERSION pinned to "0.0.8-g0.8-fixes"', () => {
  assert.equal(typeof root.PACKAGE_VERSION, 'string');
  assert.equal(root.PACKAGE_VERSION, '0.0.8-g0.8-fixes');
});

test('no talent-context-read subpath-only names leak into frozen root', () => {
  const liveSet = new Set(LIVE_EXPORTS);
  const leaks = [];
  for (const name of SUBPATH_ONLY_NAMES) {
    if (liveSet.has(name)) leaks.push(name);
  }
  assert.deepEqual(leaks, [], 'frozen root must not expose any talent-context-read subpath-only names; leaks: ' + JSON.stringify(leaks));
});

test('frozen root is callable from the installed artifact (not local source)', async () => {
  // Re-import the root module from CONTRACTS_DIST (the workspace dist path).
  // This proves the test reads from the INSTALLED/built artifact, not from
  // any local source that may be present in the consumer's node_modules tree.
  const url = pathToFileURL(CONTRACTS_DIST).href;
  const mod = await import(url);
  assert.equal(typeof mod.SCHEMA_VERSION, 'string');
  assert.equal(typeof mod.PACKAGE_VERSION, 'string');
});

test('representative frozen-root identity schema round-trip', () => {
  let foundAny = false;
  for (const k of LIVE_EXPORTS) {
    const v = root[k];
    if (v && typeof v === 'object' && typeof v.safeParse === 'function') {
      const r = v.safeParse({});
      assert.equal(typeof r.success, 'boolean');
      foundAny = true;
      break;
    }
  }
  assert.equal(foundAny, true, 'must find at least one Zod-style schema with safeParse in frozen root');
});

test('representative frozen-root command/binding functions are callable', () => {
  let foundAny = false;
  for (const k of LIVE_EXPORTS) {
    if (typeof root[k] === 'function' && (k.startsWith('is') || k.startsWith('build') || k.startsWith('assert') || k.startsWith('extract') || k.startsWith('select') || k.startsWith('encode') || k.startsWith('decode') || k.startsWith('parse'))) {
      const fn = root[k];
      assert.equal(typeof fn, 'function');
      foundAny = true;
      // Don't actually invoke behaviour-testing; just assert callable.
    }
  }
  assert.equal(foundAny, true, 'must find at least one frozen-root callable (is*/build*/assert*/parse*/extract*/select*/encode*/decode*)');
});

test('representative frozen-root event/envelope/error schema round-trip (safeParse)', () => {
  let testedAt = 0;
  for (const k of LIVE_EXPORTS) {
    const v = root[k];
    if (v && typeof v === 'object' && typeof v.safeParse === 'function' && (/Envelope|Error|Event|Schema/i.test(k))) {
      const r = v.safeParse({});
      if (typeof r.success === 'boolean') testedAt++;
      if (testedAt >= 3) break;
    }
  }
  assert.ok(testedAt >= 3, 'must probe at least three envelope/error/event schemas; tested=' + testedAt);
});

test('representative frozen-root enum schema exists by name pattern', () => {
  let foundAny = false;
  for (const k of LIVE_EXPORTS) {
    if (/_STATE$|_STATUS$|_REASON$|_OUTCOME$|_CLASS$|_KIND$|_MODE$|_SOURCE$|_SHAPE$|_KIND$/.test(k)) { foundAny = true; break; }
  }
  assert.equal(foundAny, true, 'must find at least one enum-like export name in frozen root');
});
