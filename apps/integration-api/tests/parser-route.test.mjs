// tests/parser-route.test.mjs
// M4 gated route-mock tests per CONTRACT-03C.2 r2 (C-04).

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

const { registerTalentContextReadRouteMock } = await import(
  pathToFileURL(DIST).href
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

function clearEnv() {
  delete process.env.HRP_MOCK_MODE;
}

test('M4 route: NOT registered when HRP_MOCK_MODE is unset', () => {
  clearEnv();
  const handle = registerTalentContextReadRouteMock();
  assert.equal(handle.registered, false);
});

test('M4 route: read returns mock-disabled when not registered', async () => {
  clearEnv();
  const handle = registerTalentContextReadRouteMock();
  const r = await handle.read(validRequest(), {
    assertedOrganizationId: 'o-' + 'a'.repeat(31),
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'mock-disabled');
});

test('M4 route: registered under HRP_MOCK_MODE=deterministic', () => {
  clearEnv();
  process.env.HRP_MOCK_MODE = 'deterministic';
  try {
    const handle = registerTalentContextReadRouteMock();
    assert.equal(handle.registered, true);
  } finally {
    clearEnv();
  }
});

test('M4 route: registered under HRP_MOCK_MODE=deterministic + force flag (test override)', () => {
  clearEnv();
  const handle = registerTalentContextReadRouteMock({ force: true });
  assert.equal(handle.registered, true);
});

test('M4 route: default org binding rejects (no body trust)', async () => {
  clearEnv();
  const handle = registerTalentContextReadRouteMock({ force: true });
  const r = await handle.read(validRequest(), {
    assertedOrganizationId: 'o-' + 'a'.repeat(31),
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'org-binding-rejected');
});

test('M4 route: org binding accepts when hook returns true', async () => {
  clearEnv();
  const handle = registerTalentContextReadRouteMock({
    force: true,
    assertOrgBinding: () => true,
  });
  const r = await handle.read(validRequest(), {
    assertedOrganizationId: 'o-' + 'a'.repeat(31),
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    // The redacted display name MUST NOT contain the raw PII strings.
    assert.ok(typeof r.redactedDisplayName === 'string');
    assert.ok(!r.redactedDisplayName.includes('Nguy'));
  }
});

test('M4 route: invalid request returns local-validation-failure', async () => {
  clearEnv();
  const handle = registerTalentContextReadRouteMock({
    force: true,
    assertOrgBinding: () => true,
  });
  const r = await handle.read({ bogus: true }, {
    assertedOrganizationId: 'o-' + 'a'.repeat(31),
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'local-validation-failure');
});

test('M4 route: org binding derived from callContext, not request body', async () => {
  clearEnv();
  const HOOK_ORG = 'o-HOOKORG' + 'x'.repeat(24);
  let hookSawOrg = null;
  const handle = registerTalentContextReadRouteMock({
    force: true,
    assertOrgBinding: (ctx) => {
      hookSawOrg = ctx.assertedOrganizationId;
      return true;
    },
  });
  const sample = { ...validRequest(), organizationId: 'o-BODYORG' + 'x'.repeat(24) };
  const r = await handle.read(sample, { assertedOrganizationId: HOOK_ORG });
  assert.equal(r.ok, true);
  assert.equal(hookSawOrg, HOOK_ORG, 'hook must see callContext org id, never body org id');
});

test('M4 route: returned result has organizationId from callContext (not body)', async () => {
  clearEnv();
  const HOOK_ORG = 'o-HOOKORG' + 'x'.repeat(24);
  const BODY_ORG = 'o-BODYORG' + 'x'.repeat(24);
  const handle = registerTalentContextReadRouteMock({
    force: true,
    assertOrgBinding: () => true,
  });
  const sample = { ...validRequest(), organizationId: BODY_ORG };
  const r = await handle.read(sample, { assertedOrganizationId: HOOK_ORG });
  assert.equal(r.ok, true);
  if (r.ok) {
    const result = r.result;
    assert.equal(result.organizationId, HOOK_ORG);
    assert.notEqual(result.organizationId, BODY_ORG);
  }
});
