// tests/parser-error.test.mjs
// M3 parser tests for parseTalentContextReadError per CONTRACT-03C.2 r2 (C-03).
//
// IMPORTANT: parseTalentContextReadError is intentionally narrow. It only
// accepts the dedicated seven-code HRP error envelope. It MUST NOT accept
// command-only frozen error codes (e.g. ContractErrorCode schema).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

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

const DIST = resolve(WORKSPACE, 'dist', 'orchestrator', 'talent-context-read', 'parser-error.js');
if (!existsSync(DIST)) execSync('npm run build', { cwd: WORKSPACE, stdio: 'inherit' });
assert.ok(existsSync(DIST), 'parser-error.js must be built at ' + DIST);

const { parseTalentContextReadError } = await import(pathToFileURL(DIST).href);

// Build a valid HRP error envelope.
function validError() {
  return {
    schemaVersion: '1',
    status: 'FAILED',
    correlationId: 'c-' + 'a'.repeat(31),
    errors: [
      {
        code: 'NOT_FOUND',
        messageKey: 'errors.talentContext.notFound',
        retryClass: 'NEVER',
      },
    ],
  };
}

test('parseTalentContextReadError: valid HRP error envelope parses with ok=true', () => {
  const r = parseTalentContextReadError(validError());
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.status, 'FAILED');
    assert.equal(r.value.errors.length, 1);
    assert.equal(r.value.errors[0].code, 'NOT_FOUND');
    assert.equal(r.value.errors[0].retryClass, 'NEVER');
  }
});

test('parseTalentContextReadError: another valid seven-code (FORBIDDEN)', () => {
  const sample = validError();
  sample.errors = [
    {
      code: 'FORBIDDEN',
      messageKey: 'errors.forbidden',
      retryClass: 'NEVER',
    },
  ];
  const r = parseTalentContextReadError(sample);
  assert.equal(r.ok, true);
});

test('parseTalentContextReadError: status != FAILED returns local-validation-failure', () => {
  const bad = { ...validError(), status: 'OK' };
  const r = parseTalentContextReadError(bad);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'local-validation-failure');
});

test('parseTalentContextReadError: missing errors returns local-validation-failure', () => {
  const bad = { ...validError() };
  delete bad.errors;
  const r = parseTalentContextReadError(bad);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'local-validation-failure');
});

test('parseTalentContextReadError: errors.length != 1 returns local-validation-failure', () => {
  const bad = { ...validError(), errors: [] };
  const r = parseTalentContextReadError(bad);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'local-validation-failure');

  const bad2 = { ...validError(), errors: [validError().errors[0], validError().errors[0]] };
  const r2 = parseTalentContextReadError(bad2);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.reason, 'local-validation-failure');
});

test('parseTalentContextReadError: command-only frozen error codes are rejected', () => {
  // Attempt to inject a frozen command error code (e.g. something like
  // 'GATEWAY_TIMEOUT') into the seven-code parser. Must reject.
  const bad = {
    ...validError(),
    errors: [
      {
        code: 'GATEWAY_TIMEOUT',
        messageKey: 'errors.gateway.timeout',
        retryClass: 'NEVER',
      },
    ],
  };
  const r = parseTalentContextReadError(bad);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'local-validation-failure');
});

test('parseTalentContextReadError: unknown error code rejected', () => {
  const bad = {
    ...validError(),
    errors: [
      {
        code: 'NOT_A_REAL_CODE',
        messageKey: 'errors.talentContext.notFound',
        retryClass: 'NEVER',
      },
    ],
  };
  const r = parseTalentContextReadError(bad);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'local-validation-failure');
});

test('parseTalentContextReadError: messageKey/retryClass mismatch rejected', () => {
  const bad = {
    ...validError(),
    errors: [
      {
        code: 'NOT_FOUND',
        messageKey: 'errors.forbidden', // wrong messageKey for NOT_FOUND
        retryClass: 'NEVER',
      },
    ],
  };
  const r = parseTalentContextReadError(bad);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'local-validation-failure');
});

test('parseTalentContextReadError: unknown field rejected (strict mode)', () => {
  const bad = { ...validError(), evilUnknownField: 'x' };
  const r = parseTalentContextReadError(bad);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'local-validation-failure');
});

test('parseTalentContextReadError: non-object input returns local-validation-failure', () => {
  for (const bad of ['string', 42, null, undefined, true, []]) {
    const r = parseTalentContextReadError(bad);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'local-validation-failure');
  }
});

test('parseTalentContextReadError: never fabricates an HRP wire error envelope', () => {
  // A plain request payload is NOT an error envelope; the parser must
  // report local-validation-failure and MUST NOT surface a synthetic HRP
  // error envelope of its own.
  const requestLike = {
    schemaVersion: '1',
    correlationId: 'c-' + 'a'.repeat(31),
    organizationId: 'o-' + 'a'.repeat(31),
  };
  const r = parseTalentContextReadError(requestLike);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'local-validation-failure');
});
