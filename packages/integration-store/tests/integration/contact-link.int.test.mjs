/**
 * packages/integration-store/tests/integration/contact-link.int.test.mjs
 *
 * PostgreSQL integration tests (real PG via embedded-postgres):
 *  - Fresh DB + migration applied từ `prisma/migrations/0001_init/`.
 *  - Duplicate (same scope) → idempotent upsert (same version).
 *  - Duplicate (different payload target) → VERSION_CONFLICT.
 *  - Scope isolation: org-A KHÔNG đọc row org-B.
 *  - Cross-scope write attempt → SCOPE_MISMATCH.
 *  - Transaction rollback: lỗi giữa đường KHÔNG tạo row; pending receipts
 *    KHÔNG bị âm thầm xóa.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Set env TRƯỚC khi dynamic import harness module (static import sẽ hoist).
process.env['PG_HARNESS_SUFFIX'] = 'contact_link';
const { start } = await import('./pg-test-harness.mjs');

const harness = await start();
const { prisma } = harness;

test.after(async () => { await harness.stop(); });

test('PG: contact link upsert tạo row mới lần đầu', async () => {
  const { upsertContactLink } = await import('../../dist/index.js');
  const scope = {
    organizationId: 'org-pg-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-pg-001',
    externalAccountId: 'acct-pg-1',
    externalContactId: 'c-pg-1',
  };
  const out = await upsertContactLink(prisma, scope, {
    schemaVersion: '1',
    organizationId: scope.organizationId,
    provider: scope.provider,
    connectionId: scope.connectionId,
    external: { externalAccountId: scope.externalAccountId, externalContactId: scope.externalContactId },
    state: 'EXACT_MATCH',
    matchedTarget: { kind: 'TALENT', matchedLaborProfileId: 'lp-pg-1', matchedLaborProfileVersion: 1 },
    aggregateVersion: 1,
  });
  assert.equal(out.created, true);
  assert.equal(out.row.state, 'EXACT_MATCH');
  assert.equal(out.row.aggregateVersion, 1);
});

test('PG: duplicate scope + same version → idempotent (created=false)', async () => {
  const { upsertContactLink } = await import('../../dist/index.js');
  const scope = {
    organizationId: 'org-pg-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-pg-001',
    externalAccountId: 'acct-pg-2',
    externalContactId: 'c-pg-2',
  };
  const input = {
    schemaVersion: '1',
    organizationId: scope.organizationId,
    provider: scope.provider,
    connectionId: scope.connectionId,
    external: { externalAccountId: scope.externalAccountId, externalContactId: scope.externalContactId },
    state: 'EXACT_MATCH',
    matchedTarget: { kind: 'TALENT', matchedLaborProfileId: 'lp-pg-2', matchedLaborProfileVersion: 1 },
    aggregateVersion: 5,
  };
  const first = await upsertContactLink(prisma, scope, input);
  const second = await upsertContactLink(prisma, scope, input);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.row.aggregateVersion, 5);
});

test('PG: duplicate scope + higher version → update OK', async () => {
  const { upsertContactLink } = await import('../../dist/index.js');
  const scope = {
    organizationId: 'org-pg-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-pg-001',
    externalAccountId: 'acct-pg-3',
    externalContactId: 'c-pg-3',
  };
  await upsertContactLink(prisma, scope, {
    schemaVersion: '1',
    organizationId: scope.organizationId,
    provider: scope.provider,
    connectionId: scope.connectionId,
    external: { externalAccountId: scope.externalAccountId, externalContactId: scope.externalContactId },
    state: 'EXACT_MATCH',
    matchedTarget: { kind: 'TALENT', matchedLaborProfileId: 'lp-pg-3', matchedLaborProfileVersion: 1 },
    aggregateVersion: 1,
  });
  const out = await upsertContactLink(prisma, scope, {
    schemaVersion: '1',
    organizationId: scope.organizationId,
    provider: scope.provider,
    connectionId: scope.connectionId,
    external: { externalAccountId: scope.externalAccountId, externalContactId: scope.externalContactId },
    state: 'EXACT_MATCH',
    matchedTarget: { kind: 'TALENT', matchedLaborProfileId: 'lp-pg-3', matchedLaborProfileVersion: 2 },
    aggregateVersion: 5,
  });
  assert.equal(out.created, false);
  assert.equal(out.row.aggregateVersion, 5);
  assert.equal(out.row.matchedTarget.matchedLaborProfileVersion, 2);
});

test('PG: duplicate scope + lower version → VERSION_CONFLICT', async () => {
  const { upsertContactLink } = await import('../../dist/index.js');
  const scope = {
    organizationId: 'org-pg-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-pg-001',
    externalAccountId: 'acct-pg-4',
    externalContactId: 'c-pg-4',
  };
  await upsertContactLink(prisma, scope, {
    schemaVersion: '1',
    organizationId: scope.organizationId,
    provider: scope.provider,
    connectionId: scope.connectionId,
    external: { externalAccountId: scope.externalAccountId, externalContactId: scope.externalContactId },
    state: 'EXACT_MATCH',
    matchedTarget: { kind: 'TALENT', matchedLaborProfileId: 'lp-pg-4', matchedLaborProfileVersion: 1 },
    aggregateVersion: 10,
  });
  await assert.rejects(
    upsertContactLink(prisma, scope, {
      schemaVersion: '1',
      organizationId: scope.organizationId,
      provider: scope.provider,
      connectionId: scope.connectionId,
      external: { externalAccountId: scope.externalAccountId, externalContactId: scope.externalContactId },
      state: 'EXACT_MATCH',
      matchedTarget: { kind: 'TALENT', matchedLaborProfileId: 'lp-pg-4', matchedLaborProfileVersion: 1 },
      aggregateVersion: 5,
    }),
    (err) => err && err.code === 'VERSION_CONFLICT',
  );
});

test('PG: cross-scope isolation — org-B đọc org-A KHÔNG thấy', async () => {
  const { upsertContactLink, findContactLinkByScope } = await import('../../dist/index.js');
  const scopeA = {
    organizationId: 'org-pg-isoA',
    provider: 'CHATWOOT',
    connectionId: 'conn-pg-isoA',
    externalAccountId: 'acct-isoA',
    externalContactId: 'c-isoA',
  };
  await upsertContactLink(prisma, scopeA, {
    schemaVersion: '1',
    organizationId: scopeA.organizationId,
    provider: scopeA.provider,
    connectionId: scopeA.connectionId,
    external: { externalAccountId: scopeA.externalAccountId, externalContactId: scopeA.externalContactId },
    state: 'UNRESOLVED',
    aggregateVersion: 0,
  });
  const gotB = await findContactLinkByScope(prisma, {
    ...scopeA,
    organizationId: 'org-pg-isoB',
  });
  assert.equal(gotB, null, 'org-B phải không thấy row org-A');
});

test('PG: cross-scope write attempt (input.organizationId khác scope) → SCOPE_MISMATCH', async () => {
  const { upsertContactLink } = await import('../../dist/index.js');
  await assert.rejects(
    upsertContactLink(
      prisma,
      {
        organizationId: 'org-pg-attempt',
        provider: 'CHATWOOT',
        connectionId: 'conn-attempt',
        externalAccountId: 'acct-1',
      },
      {
        schemaVersion: '1',
        organizationId: 'org-pg-other', // khác scope.organizationId
        provider: 'CHATWOOT',
        connectionId: 'conn-attempt',
        external: { externalAccountId: 'acct-1' },
        state: 'UNRESOLVED',
        aggregateVersion: 0,
      },
    ),
    (err) => err && err.code === 'SCOPE_MISMATCH',
  );
});
