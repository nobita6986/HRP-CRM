// tests/parser-request.test.mjs
// M3 parser tests per CONTRACT-03C.2 r2 (C-03).
// Tests are placed in integration-api/tests/ (matching the existing test
// runner pattern) and import from the compiled dist output.
//
// The parser source lives at:
//   src/orchestrator/talent-context-read/parser-request.ts
// Compiled output:
//   dist/orchestrator/talent-context-read/parser-request.js
//
// Tests assume dist has been built (npm run build). If dist is missing,
// tests trigger a build first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));

// Resolve the integration-api workspace root from this test file's location.
function findWorkspaceRoot(startDir) {
  let cur = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(cur, 'package.json');
    if (existsSync(candidate)) {
      return dirname(candidate);
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

const WORKSPACE = findWorkspaceRoot(HERE);
assert.ok(WORKSPACE, 'integration-api workspace root must be reachable from ' + HERE);

const DIST = resolve(WORKSPACE, 'dist', 'orchestrator', 'talent-context-read', 'parser-request.js');
if (!existsSync(DIST)) {
  execSync('npm run build', { cwd: WORKSPACE, stdio: 'inherit' });
}
assert.ok(existsSync(DIST), 'parser-request.js must be built at ' + DIST);

const { parseTalentContextReadRequest } = await import(pathToFileURL(DIST).href);

// Build a valid TalentContextReadQueryRequest sample with shape-valid
// canonical-base64url token values.
function validRequest() {
  // delegationRef must be 'dg_' + canonical base64url of 32 bytes.
  const delegationRef = 'dg_' + randomBytes(32).toString('base64url');
  return {
    schemaVersion: '1',
    correlationId: 'c-' + 'a'.repeat(31),
    organizationId: 'o-' + 'a'.repeat(31),
    actor: {
      kind: 'DELEGATED_USER',
      serviceId: 'svc-' + 'x'.repeat(13),
      userId: 'u-' + 'x'.repeat(31),
      delegationRef,
    },
    target: {
      kind: 'TALENT',
      laborProfileId: 'cp-' + 'a'.repeat(31),
    },
    fieldAllowlist: ['identitySummary'],
  };
}

test('parseTalentContextReadRequest: valid input parses with ok=true', () => {
  const r = parseTalentContextReadRequest(validRequest());
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.target.kind, 'TALENT');
    assert.equal(r.value.actor.kind, 'DELEGATED_USER');
    assert.deepEqual(r.value.fieldAllowlist, ['identitySummary']);
  }
});

test('parseTalentContextReadRequest: missing actor returns local-validation-failure', () => {
  const bad = { ...validRequest() };
  delete bad.actor;
  const r = parseTalentContextReadRequest(bad);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'local-validation-failure');
    assert.ok(Array.isArray(r.issues));
    assert.ok(r.issues.length > 0);
  }
});

test('parseTalentContextReadRequest: unknown field is rejected (strict mode)', () => {
  const bad = { ...validRequest(), evilUnknownField: 'should-be-rejected' };
  const r = parseTalentContextReadRequest(bad);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'local-validation-failure');
    assert.ok(r.issues.length > 0);
  }
});

test('parseTalentContextReadRequest: empty fieldAllowlist returns local-validation-failure', () => {
  const bad = { ...validRequest(), fieldAllowlist: [] };
  const r = parseTalentContextReadRequest(bad);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'local-validation-failure');
    assert.ok(r.issues.length > 0);
  }
});

test('parseTalentContextReadRequest: invalid field name returns local-validation-failure', () => {
  const bad = { ...validRequest(), fieldAllowlist: ['unknownField'] };
  const r = parseTalentContextReadRequest(bad);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'local-validation-failure');
  }
});

test('parseTalentContextReadRequest: invalid delegationRef rejected (corrupt byte base64url)', () => {
  const bad = JSON.parse(JSON.stringify(validRequest()));
  bad.actor.delegationRef = 'NOT-A-VALID-dg-ref';
  const r = parseTalentContextReadRequest(bad);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'local-validation-failure');
  }
});

test('parseTalentContextReadRequest: non-object input returns local-validation-failure', () => {
  for (const bad of ['string', 42, null, undefined, true, []]) {
    const r = parseTalentContextReadRequest(bad);
    assert.equal(r.ok, false, 'non-object input must be local-validation-failure; got ' + JSON.stringify(bad));
    if (!r.ok) {
      assert.equal(r.reason, 'local-validation-failure');
    }
  }
});

test('parseTalentContextReadRequest: never fabricates an HRP wire error envelope', () => {
  // A synthetic HRP-error envelope (status=FAILED, errors=[]) is NOT a
  // valid REQUEST, so the parser must report it as local-validation-failure
  // and MUST NOT surface a synthetic HRP error envelope of its own.
  const fakeError = { status: 'FAILED', errors: [] };
  const r = parseTalentContextReadRequest(fakeError);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'local-validation-failure');
    // Make sure the issue list references the request schema fields, not a
    // fabricated HRP error envelope.
    const flatPaths = JSON.stringify(r.issues);
    assert.ok(/schemaVersion|correlationId|organizationId|actor|target|fieldAllowlist/.test(flatPaths));
  }
});

test('parseTalentContextReadRequest: invalid moduleSchemaVersion rejects', () => {
  const bad = { ...validRequest(), schemaVersion: 'NOT-A-NUMBER' };
  const r = parseTalentContextReadRequest(bad);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'local-validation-failure');
  }
});
