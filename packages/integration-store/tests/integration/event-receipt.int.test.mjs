/**
 * packages/integration-store/tests/integration/event-receipt.int.test.mjs
 *
 * PostgreSQL integration tests cho ExternalEventReceipt + DispatchIntent.
 *
 * Critical AC #4: receipt + dispatch intent trong cùng transaction
 * (no dual-write gap). Commit cả 2 hoặc rollback cả 2.
 *
 * AC #6 (downgrade): rollback không âm thầm xóa pending receipts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

// Dùng suffix riêng để tránh race với test file khác.
// Set env TRƯỚC khi dynamic import harness module (static import sẽ hoist).
process.env['PG_HARNESS_SUFFIX'] = 'event_receipt';
const { start } = await import('./pg-test-harness.mjs');

const harness = await start();
const { prisma } = harness;

test.after(async () => { await harness.stop(); });

function makeReceipt(over = {}) {
  return {
    schemaVersion: '1',
    organizationId: 'org-pg-rec-001',
    eventId: 'evt-pg-rec-001',
    payloadDigest: 'a'.repeat(64),
    duplicateKind: 'DEDUPE',
    ...over,
  };
}

function makeIntent(idSuffix) {
  return {
    schemaVersion: '1',
    organizationId: 'org-pg-rec-001',
    intentId: `it-pg-${idSuffix}-${Date.now()}`,
    intentSchemaVersion: '1',
    sourceCommandId: 'cmd-pg-rec-001',
    destination: {
      provider: 'CHATWOOT',
      connectionId: 'conn-rec-001',
      recipientRef: 'ext-conv-rec-001',
    },
    template: { engine: 'HRP_INTERNAL', contentRef: 'tmpl-rec-001' },
    correlationId: 'corr-pg-rec-001',
    dedupeKey: `dedupe-pg-rec-${idSuffix}-${Date.now()}`,
    policy: { purpose: 'test', suppressionCheckRequired: false, retryPolicyVersion: 'v1' },
    channel: 'PUSH_WEBHOOK',
    consumerDedupeToken: `ct-pg-rec-${idSuffix}-${Date.now()}`,
  };
}

test('PG: commitReceiptWithIntents tạo receipt + intent atomic', async () => {
  const { commitReceiptWithIntents, findReceipt } = await import('../../dist/index.js');
  const scope = {
    organizationId: 'org-pg-rec-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-rec-001',
    eventId: 'evt-pg-rec-001',
  };
  const out = await commitReceiptWithIntents(prisma, scope, {
    schemaVersion: '1',
    receipt: makeReceipt(),
    intents: [makeIntent('a')],
  });
  assert.equal(out.created, true);
  assert.equal(out.result.intentIds.length, 1);

  const receipt = await findReceipt(prisma, scope);
  assert.ok(receipt);
  assert.equal(receipt.payloadDigest, 'a'.repeat(64));
});

test('PG: commitReceiptWithIntents idempotent khi digest khớp', async () => {
  const { commitReceiptWithIntents } = await import('../../dist/index.js');
  const scope = {
    organizationId: 'org-pg-rec-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-rec-001',
    eventId: 'evt-pg-rec-002',
  };
  const first = await commitReceiptWithIntents(prisma, scope, {
    schemaVersion: '1',
    receipt: makeReceipt({ eventId: 'evt-pg-rec-002' }),
    intents: [makeIntent('idemp')],
  });
  const second = await commitReceiptWithIntents(prisma, scope, {
    schemaVersion: '1',
    receipt: makeReceipt({ eventId: 'evt-pg-rec-002' }),
    intents: [makeIntent('idemp')],
  });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.deepEqual(second.result.intentIds, first.result.intentIds, 'cùng intent ids trả về (idempotent)');
});

test('PG: IDEMPOTENCY_CONFLICT — same eventId + different payloadDigest reject', async () => {
  const { commitReceiptWithIntents } = await import('../../dist/index.js');
  const scope = {
    organizationId: 'org-pg-rec-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-rec-001',
    eventId: 'evt-pg-rec-003',
  };
  await commitReceiptWithIntents(prisma, scope, {
    schemaVersion: '1',
    receipt: makeReceipt({ eventId: 'evt-pg-rec-003', payloadDigest: 'a'.repeat(64) }),
    intents: [makeIntent('c1')],
  });
  await assert.rejects(
    commitReceiptWithIntents(prisma, scope, {
      schemaVersion: '1',
      receipt: makeReceipt({ eventId: 'evt-pg-rec-003', payloadDigest: 'b'.repeat(64) }),
      intents: [makeIntent('c2')],
    }),
    (err) => err && err.code === 'VALIDATION_ERROR' && /IDEMPOTENCY_CONFLICT/.test(err.message),
  );
});

test('PG: dual-write gap — lỗi giữa đường KHÔNG tạo row (atomic rollback)', async () => {
  const { commitReceiptWithIntents } = await import('../../dist/index.js');
  const scope = {
    organizationId: 'org-pg-rec-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-rec-001',
    eventId: 'evt-pg-rec-rollback',
  };
  // Build 1 intent OK + 1 intent cố tình vi phạm FK length để ép lỗi DB.
  const goodIntent = makeIntent('rb1');
  const badIntent = {
    ...makeIntent('rb2'),
    intentId: 'x'.repeat(200), // vượt quá 128 chars VARCHAR
  };

  await assert.rejects(
    commitReceiptWithIntents(prisma, scope, {
      schemaVersion: '1',
      receipt: makeReceipt({ eventId: 'evt-pg-rec-rollback' }),
      intents: [goodIntent, badIntent],
    }),
  );

  // Sau rollback, KHÔNG có row receipt.
  const found = await prisma.externalEventReceipt.findFirst({
    where: { organizationId: scope.organizationId, eventId: scope.eventId },
  });
  assert.equal(found, null, 'rollback phải xóa cả receipt + intents; không âm thầm giữ row pending');
});

test('PG: rollback-downgrade scenario — explicit tx abort KHÔNG âm thầm xóa pending receipts', async () => {
  // Chứng minh behavior chính sách: receipts pending KHÔNG bị xóa khi
  // unrelated caller rollback 1 tx khác (worker 1.4 sẽ phụ thuộc vào đây).
  const { commitReceiptWithIntents } = await import('../../dist/index.js');

  const scopeA = {
    organizationId: 'org-pg-rec-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-rec-001',
    eventId: 'evt-pg-rec-survive-A',
  };
  await commitReceiptWithIntents(prisma, scopeA, {
    schemaVersion: '1',
    receipt: makeReceipt({ eventId: 'evt-pg-rec-survive-A' }),
    intents: [],
  });

  // Concurrent tx cố tình abort — không đụng receipt scopeA.
  try {
    await prisma.$transaction(async (tx) => {
      // Tạo 1 receipt pending hợp lệ.
      await tx.externalEventReceipt.create({
        data: {
          receiptId: 'rcpt-other-rollback',
          schemaVersion: '1',
          organizationId: 'org-pg-other',
          provider: 'CHATWOOT',
          connectionId: 'conn-other',
          eventId: 'evt-other-rb',
          payloadDigest: 'c'.repeat(64),
          state: 'PENDING',
          duplicateKind: 'DEDUPE',
          attempts: 0,
        },
      });
      // Ép throw.
      throw new Error('SYNTHETIC_TX_ABORT');
    });
  } catch (e) {
    if (!/SYNTHETIC_TX_ABORT/.test(String(e))) throw e;
  }

  // scopeA receipt phải vẫn còn nguyên.
  const scopeARow = await prisma.externalEventReceipt.findFirst({
    where: { organizationId: scopeA.organizationId, eventId: scopeA.eventId },
  });
  assert.ok(scopeARow, 'receipt pending ở scopeA phải KHÔNG bị xóa bởi rollback tx khác');
});

test('PG: cross-scope receipt attempt (input khác scope) → SCOPE_MISMATCH', async () => {
  const { commitReceiptWithIntents } = await import('../../dist/index.js');
  await assert.rejects(
    commitReceiptWithIntents(
      prisma,
      {
        organizationId: 'org-pg-rec-iso-A',
        provider: 'CHATWOOT',
        connectionId: 'conn-rec-iso-A',
        eventId: 'evt-iso-1',
      },
      {
        schemaVersion: '1',
        receipt: {
          schemaVersion: '1',
          organizationId: 'org-pg-other',
          eventId: 'evt-iso-1',
          payloadDigest: 'd'.repeat(64),
          duplicateKind: 'DEDUPE',
        },
        intents: [],
      },
    ),
    (err) => err && err.code === 'SCOPE_MISMATCH',
  );
});

test('PG: listReceiptsByOrg filter theo state', async () => {
  const { listReceiptsByOrg, commitReceiptWithIntents } = await import('../../dist/index.js');
  const org = 'org-pg-list-' + Date.now();
  // Tạo receipt PENDING.
  await commitReceiptWithIntents(prisma, {
    organizationId: org,
    provider: 'CHATWOOT',
    connectionId: 'conn-list',
    eventId: 'evt-list-1',
  }, {
    schemaVersion: '1',
    receipt: {
      schemaVersion: '1',
      organizationId: org,
      eventId: 'evt-list-1',
      payloadDigest: 'e'.repeat(64),
      duplicateKind: 'DEDUPE',
    },
    intents: [],
  });
  const items = await listReceiptsByOrg(prisma, { organizationId: org, state: 'PENDING' });
  assert.ok(items.length >= 1);
  assert.equal(items[0].eventId, 'evt-list-1');
});

test('PG: store KHÔNG copy LaborProfile/PlacementCase canonical — schema có scalar fields only', async () => {
  // Verify bằng cách thử insert row có matchedLaborProfileId = 'x' (không phải FK) — phải OK.
  const { upsertContactLink } = await import('../../dist/index.js');
  const scope = {
    organizationId: 'org-pg-no-fk',
    provider: 'CHATWOOT',
    connectionId: 'conn-no-fk',
    externalAccountId: 'acct-no-fk',
    externalContactId: 'c-no-fk',
  };
  const out = await upsertContactLink(prisma, scope, {
    schemaVersion: '1',
    organizationId: scope.organizationId,
    provider: scope.provider,
    connectionId: scope.connectionId,
    external: { externalAccountId: scope.externalAccountId, externalContactId: scope.externalContactId },
    state: 'EXACT_MATCH',
    matchedTarget: {
      kind: 'TALENT',
      matchedLaborProfileId: 'lp-fictional-does-not-exist-in-hrp',
      matchedLaborProfileVersion: 999,
    },
    aggregateVersion: 1,
  });
  assert.equal(out.created, true);
  // Assert no FK constraint by raw SQL.
  const cols = await prisma.$queryRaw`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'integration' AND table_name = 'ExternalContactLink' AND column_name IN ('matchedLaborProfileId', 'matchedClientContactId')`;
  for (const c of cols) {
    assert.equal(c.is_nullable, 'YES', 'canonical IDs phải là nullable scalar fields — không FK');
  }
});
