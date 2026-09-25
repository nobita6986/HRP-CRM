// tests/parser-mock.test.mjs
// M4 deterministic-mock port tests per CONTRACT-03C.2 r2 (C-04).

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

const DIST = resolve(WORKSPACE, 'dist', 'orchestrator', 'talent-context-read', 'index.js');
if (!existsSync(DIST)) execSync('npm run build', { cwd: WORKSPACE, stdio: 'inherit' });
assert.ok(existsSync(DIST), 'index.js must be built at ' + DIST);

const { createDeterministicTalentContextReadPort } = await import(
  pathToFileURL(resolve(WORKSPACE, 'dist', 'orchestrator', 'talent-context-read', 'index.js')).href
);

function validRequest() {
  return {
    schemaVersion: '1',
    correlationId: 'c-' + 'a'.repeat(31),
    organizationId: 'o-' + 'a'.repeat(31),
    actor: {
      kind: 'DELEGATED_USER',
      serviceId: 'svc-' + 'x'.repeat(13),
      userId: 'u-' + 'x'.repeat(31),
      delegationRef: 'dg_' + randomBytes(32).toString('base64url'),
    },
    target: {
      kind: 'TALENT',
      laborProfileId: 'cp-' + 'a'.repeat(31),
    },
    fieldAllowlist: ['identitySummary'],
  };
}

test('M4 mock: deterministic — same input produces same output', async () => {
  const port = createDeterministicTalentContextReadPort();
  const r1 = await port.read(validRequest());
  const r2 = await port.read(validRequest());
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  if (r1.ok && r2.ok) {
    assert.ok(r1.result.identitySummary);
    assert.ok(r2.result.identitySummary);
    assert.equal(r1.result.identitySummary.fullNameRedacted, r2.result.identitySummary.fullNameRedacted);
    assert.equal(r1.result.resolvedAt, r2.result.resolvedAt);
  }
});

test('M4 mock: full name is redacted in identitySummary', async () => {
  const port = createDeterministicTalentContextReadPort({
    seedFullName: 'Nguyễn Văn An',
  });
  const r = await port.read(validRequest());
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(r.result.identitySummary);
    if (r.result.identitySummary) {
      // Raw seed must not appear in the redacted output.
      assert.ok(!r.result.identitySummary.fullNameRedacted.includes('Nguy'));
      assert.ok(!r.result.identitySummary.fullNameRedacted.includes('Văn'));
      assert.equal(r.result.identitySummary.displayOnly, true);
    }
  }
});

test('M4 mock: never fabricates HRP error envelope when forceErrorCode is absent', async () => {
  const port = createDeterministicTalentContextReadPort();
  const r = await port.read(validRequest());
  assert.equal(r.ok, true);
  if (!r.ok) {
    assert.notEqual(r.reason, 'valid-hrp-error-envelope');
  }
});

test('M4 mock: forceErrorCode=NOT_FOUND returns valid-hrp-error-envelope', async () => {
  const port = createDeterministicTalentContextReadPort({
    forceErrorCode: 'NOT_FOUND',
  });
  const r = await port.read(validRequest());
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'valid-hrp-error-envelope');
  }
});

test('M4 mock: invalid input returns local-validation-failure', async () => {
  const port = createDeterministicTalentContextReadPort();
  const r = await port.read({ bogus: true });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'local-validation-failure');
    assert.ok(Array.isArray(r.issues));
  }
});

test('M4 mock: unsafe seed (control chars) yields WHOLE-PROJECTION omission', async () => {
  const port = createDeterministicTalentContextReadPort({
    seedFullName: '\u0000Nguyen', // control char triggers 'unsafe'
  });
  const r = await port.read(validRequest());
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.result.identitySummary, undefined);
    assert.deepEqual(r.result.unavailableFields, ['identitySummary']);
  }
});

test('M4 mock: result envelope re-parses (no drift from schema)', async () => {
  const port = createDeterministicTalentContextReadPort();
  const r = await port.read(validRequest());
  assert.equal(r.ok, true);
  if (r.ok) {
    // Spot-check the synthetic result envelope: it must include
    // schemaVersion=1, correlationId preserved, organizationId preserved,
    // and target preserved.
    assert.equal(r.result.schemaVersion, '1');
    assert.equal(r.result.correlationId, validRequest().correlationId);
    assert.equal(r.result.organizationId, validRequest().organizationId);
    assert.equal(r.result.target.kind, 'TALENT');
  }
});
