// tests/parser-result.test.mjs
// M3 parser tests for parseTalentContextReadResult per CONTRACT-03C.2 r2 (C-03).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));

function findWorkspaceRoot(startDir) {
  let cur = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(cur, 'package.json');
    if (existsSync(candidate)) return dirname(candidate);
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

const WORKSPACE = findWorkspaceRoot(HERE);
assert.ok(WORKSPACE, 'integration-api workspace root must be reachable from ' + HERE);

const DIST = resolve(WORKSPACE, 'dist', 'orchestrator', 'talent-context-read', 'parser-result.js');
if (!existsSync(DIST)) execSync('npm run build', { cwd: WORKSPACE, stdio: 'inherit' });
assert.ok(existsSync(DIST), 'parser-result.js must be built at ' + DIST);

const { parseTalentContextReadResult } = await import(pathToFileURL(DIST).href);

// Build a valid TalentContextReadResult sample.
function validResult() {
  return {
    schemaVersion: '1',
    correlationId: 'c-' + 'a'.repeat(31),
    organizationId: 'o-' + 'a'.repeat(31),
    target: {
      kind: 'TALENT',
      laborProfileId: 'cp-' + 'a'.repeat(31),
    },
    identitySummary: {
      schemaVersion: '1',
      fullNameRedacted: '[REDACTED]',
      displayOnly: true,
    },
    unavailableFields: [],
    resolvedAt: new Date().toISOString(),
  };
}

test('parseTalentContextReadResult: valid input parses with ok=true', () => {
  const r = parseTalentContextReadResult(validResult());
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.identitySummary.fullNameRedacted, '[REDACTED]');
    assert.equal(r.value.identitySummary.displayOnly, true);
    assert.deepEqual(r.value.unavailableFields, []);
  }
});

test('parseTalentContextReadResult: preserves unavailableFields semantics', () => {
  const sample = { ...validResult(), identitySummary: undefined, unavailableFields: ['identitySummary'] };
  // Remove identitySummary to actually mark it unavailable.
  delete sample.identitySummary;
  const r = parseTalentContextReadResult(sample);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.value.unavailableFields, ['identitySummary']);
    assert.equal(r.value.identitySummary, undefined);
  }
});

test('parseTalentContextReadResult: missing target returns local-validation-failure', () => {
  const bad = { ...validResult() };
  delete bad.target;
  const r = parseTalentContextReadResult(bad);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'local-validation-failure');
});

test('parseTalentContextReadResult: unknown field rejected (strict mode)', () => {
  const bad = { ...validResult(), evilUnknownField: 'x' };
  const r = parseTalentContextReadResult(bad);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'local-validation-failure');
});

test('parseTalentContextReadResult: identitySummary with displayOnly=false rejected', () => {
  const bad = { ...validResult() };
  bad.identitySummary = { schemaVersion: '1', fullNameRedacted: 'X', displayOnly: false };
  const r = parseTalentContextReadResult(bad);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'local-validation-failure');
});

test('parseTalentContextReadResult: identitySummary present and marked unavailable is rejected', () => {
  const bad = { ...validResult(), unavailableFields: ['identitySummary'] };
  const r = parseTalentContextReadResult(bad);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'local-validation-failure');
});

test('parseTalentContextReadResult: invalid moduleSchemaVersion rejects', () => {
  const bad = { ...validResult(), schemaVersion: 'NOT-A-NUMBER' };
  const r = parseTalentContextReadResult(bad);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'local-validation-failure');
});

test('parseTalentContextReadResult: non-object input returns local-validation-failure', () => {
  for (const bad of ['string', 42, null, undefined, true, []]) {
    const r = parseTalentContextReadResult(bad);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'local-validation-failure');
  }
});

test('parseTalentContextReadResult: never fabricates an HRP wire error envelope', () => {
  // A synthetic HRP-error envelope is NOT a result, so the parser must
  // report local-validation-failure and MUST NOT surface a synthetic HRP
  // error envelope of its own.
  const fakeError = { status: 'FAILED', errors: [] };
  const r = parseTalentContextReadResult(fakeError);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'local-validation-failure');
});
