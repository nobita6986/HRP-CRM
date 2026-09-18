/**
 * outbox.test.mjs — fixtures G0/0.3g (Outbox + delivery).
 *
 * Trọng tâm AC (Backlog §0.3g):
 *  - Phân biệt transactionalOutboxPublisher (HRP internal tx port) vs
 *    handoff DTO; KHÔNG serialize Prisma transaction object.
 *  - Intent có ID/schema/source/destination reference/approved content
 *    hoặc template data/correlation/dedupe; KHÔNG nguyên hồ sơ/CCCD.
 *  - Push hoặc claim/ack chọn đề xuất có lý do (default PUSH_WEBHOOK).
 *  - ACK sau durable acceptance; handoff ACCEPTED khác sent/delivered;
 *    UNKNOWN/suppressed có semantics, không hứa exactly-once provider.
 *  - Retry/DLQ không bypass DNC.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OutboxPublishHookSchema,
  OutboxIntentDraftSchema,
  OutboxDeliveryIntentSchema,
  OutboxDeliveryChannelSchema,
  OutboxDeliveryReceiptSchema,
  DeliveryReportingEventSchema,
  OutboxClaimRequestSchema,
  OutboxClaimLeaseSchema,
  OutboxClaimAckSchema,
  DeliveryReportingStateSchema,
  DeliveryFailureReasonSchema,
  OUTBOX_DELIVERY_CHANNELS,
  OUTBOX_PATCH_FORBIDDEN,
} from '../dist/commands/outbox.js';
import { SCHEMA_VERSION } from '../dist/enums.js';

const org = 'org-test-outbox';
const cmdId = 'cmd-0001';

function baseIntentFields() {
  return {
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    intentId: 'intent-001',
    intentSchemaVersion: SCHEMA_VERSION,
    sourceCommandId: cmdId,
    destination: {
      provider: 'CHATWOOT',
      connectionId: 'conn-cw-1',
      recipientRef: 'recipient.123',
    },
    template: {
      engine: 'NONE',
      contentRef: 'literal content — staff approved',
    },
    correlationId: 'trace-abc-1234567',
    dedupeKey: 'dedupe-key-abc-12345678',
    policy: {
      purpose: 'next-step-reminder',
      suppressionCheckRequired: true,
      retryPolicyVersion: 'v1',
    },
  };
}

function baseDeliveryIntentFields() {
  // Top-level envelope cho OutboxDeliveryIntent: có schemaVersion + channel + consumerDedupeToken.
  return {
    ...baseIntentFields(),
    channel: 'PUSH_WEBHOOK',
    consumerDedupeToken: 'consumer-dedupe-12345678',
  };
}

test('OUTBOX_DELIVERY_CHANNELS: PUSH_WEBHOOK default + PULL_CLAIM_ACK fallback', () => {
  assert.deepEqual([...OUTBOX_DELIVERY_CHANNELS], [
    'PUSH_WEBHOOK',
    'PULL_CLAIM_ACK',
  ]);
  assert.equal(
    OutboxDeliveryChannelSchema.safeParse('PUSH_WEBHOOK').success,
    true,
  );
  assert.equal(
    OutboxDeliveryChannelSchema.safeParse('POLLING_LEASE_LEGACY').success,
    false,
    'PUSH_WEBHOOK + PULL_CLAIM_ACK là 2 channel cho phép',
  );
});

test('OutboxIntentDraft: KHÔNG raw PII / CCCD / full hồ sơ (AC #2)', () => {
  const ok = OutboxIntentDraftSchema.parse(baseIntentFields());
  assert.equal(ok.intentId, 'intent-001');

  // Strict mode + payload không có CCCD fields.
  for (const pii of ['cccdNumber', 'cccdFront', 'cccdBack', 'fullName', 'phoneRaw', 'addressRaw', 'dobRaw', 'fullProfile', 'rawTranscript']) {
    assert.equal(
      OUTBOX_PATCH_FORBIDDEN.includes(pii),
      true,
      `'${pii}' phải nằm trong OUTBOX_PATCH_FORBIDDEN (Backlog §0.3g AC #2)`,
    );
  }
});

test('OutboxIntentDraft: 3 template engine kinds (NONE/HRP_INTERNAL/PROVIDER_TEMPLATE)', () => {
  for (const engine of ['NONE', 'HRP_INTERNAL', 'PROVIDER_TEMPLATE']) {
    const r = OutboxIntentDraftSchema.parse({
      ...baseIntentFields(),
      template: { engine, contentRef: 'ref-001' },
    });
    assert.equal(r.template.engine, engine);
  }
});

test('OutboxPublishHook: txHandle opaque, KHÔNG serialize Prisma transaction', () => {
  // Schema bind shape chỉ: txHandle (string), intent.
  // Forbidden list có prismaTx/prismaTransaction/sqlTransaction.
  for (const forbidden of [
    'prismaTx',
    'prismaTransaction',
    'sqlTransaction',
    'sqlTransactionObject',
    'databaseTransactionObject',
  ]) {
    assert.ok(
      OUTBOX_PATCH_FORBIDDEN.includes(forbidden),
      `'${forbidden}' không được serialize (Master §9.1)`,
    );
  }

  // txHandle opaque OK.
  const r = OutboxPublishHookSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    txHandle: 'tx-handle-001',
    intent: baseIntentFields(),
  });
  assert.equal(r.txHandle, 'tx-handle-001');
});

test('OutboxDeliveryIntent: PUSH_WEBHOOK channel bind shape', () => {
  const r = OutboxDeliveryIntentSchema.parse(baseDeliveryIntentFields());
  assert.equal(r.channel, 'PUSH_WEBHOOK');
});

test('OutboxDeliveryIntent: PULL_CLAIM_ACK channel + tenant fallback', () => {
  // PULL dùng khi webhook không khả dụng; schema không phân biệt logic,
  // chỉ enum channel.
  const r = OutboxDeliveryIntentSchema.parse({
    ...baseDeliveryIntentFields(),
    channel: 'PULL_CLAIM_ACK',
  });
  assert.equal(r.channel, 'PULL_CLAIM_ACK');
});

test('OutboxDeliveryReceipt: chỉ ACCEPTED outcome + acceptedAt timestamp', () => {
  // Handoff ACCEPTED = CRM durable accept; chưa sent/delivered.
  const r = OutboxDeliveryReceiptSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    intentId: 'intent-001',
    consumerDedupeToken: 'consumer-dedupe-12345678',
    outcome: 'ACCEPTED',
    acceptedAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r.outcome, 'ACCEPTED');

  // Schema chỉ cho ACCEPTED; KHÔNG cho SENT/DELIVERED ở receipt
  // (đó là callback DeliveryReportingEvent).
  assert.equal(
    OutboxDeliveryReceiptSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      intentId: 'intent-001',
      consumerDedupeToken: 'consumer-dedupe-12345678',
      outcome: 'SENT',
      acceptedAt: '2026-09-13T10:00:00.000+07:00',
    }).success,
    false,
    'Receipt chỉ chấp nhận ACCEPTED; SENT/DELIVERED qua DeliveryReportingEvent',
  );
});

test('DeliveryReportingState: 5 giá trị (SENT/DELIVERED/FAILED/UNKNOWN/SUPPRESSED)', () => {
  for (const s of [
    'SENT',
    'DELIVERED',
    'FAILED',
    'UNKNOWN',
    'SUPPRESSED',
  ]) {
    assert.equal(DeliveryReportingStateSchema.safeParse(s).success, true);
  }
  assert.equal(
    DeliveryReportingStateSchema.safeParse('PARTIAL').success,
    false,
    'PARTIAL không phải state hợp lệ',
  );
});

test('DeliveryFailureReason: 7 giá trị allowlist (PROVIDER_REJECTED/.../UNKNOWN_REASON)', () => {
  for (const r of [
    'PROVIDER_REJECTED',
    'PROVIDER_TIMEOUT',
    'DISPATCH_GATE_DENIED',
    'STALE_CACHE',
    'HRP_OFFLINE',
    'RECIPIENT_RESOLVED',
    'UNKNOWN_REASON',
  ]) {
    assert.equal(DeliveryFailureReasonSchema.safeParse(r).success, true);
  }
  // DISPATCH_GATE_DENIED = DNC; retry/DLQ KHÔNG bypass.
  assert.equal(
    DeliveryFailureReasonSchema.safeParse('BYPASS_DNC').success,
    false,
    'BYPASS_DNC không nằm trong allowlist (Backlog §0.3g AC #4)',
  );
});

test('DeliveryReportingEvent: SENT/DELIVERED KHÔNG có reason; FAILED/UNKNOWN/SUPPRESSED có reason', () => {
  // SENT + no reason OK.
  const r1 = DeliveryReportingEventSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    intentId: 'intent-001',
    consumerDedupeToken: 'consumer-dedupe-12345678',
    state: 'SENT',
    reportedAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r1.state, 'SENT');

  // SENT + reason → reject.
  assert.equal(
    DeliveryReportingEventSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      intentId: 'intent-001',
      consumerDedupeToken: 'consumer-dedupe-12345678',
      state: 'SENT',
      reportedAt: '2026-09-13T10:00:00.000+07:00',
      reason: 'PROVIDER_TIMEOUT',
    }).success,
    false,
    'SENT/DELIVERED KHÔNG có reason',
  );

  // FAILED + reason OK.
  const r2 = DeliveryReportingEventSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    intentId: 'intent-001',
    consumerDedupeToken: 'consumer-dedupe-12345678',
    state: 'FAILED',
    reportedAt: '2026-09-13T10:00:00.000+07:00',
    reason: 'PROVIDER_TIMEOUT',
  });
  assert.equal(r2.reason, 'PROVIDER_TIMEOUT');

  // FAILED + no reason → reject.
  assert.equal(
    DeliveryReportingEventSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      intentId: 'intent-001',
      consumerDedupeToken: 'consumer-dedupe-12345678',
      state: 'FAILED',
      reportedAt: '2026-09-13T10:00:00.000+07:00',
    }).success,
    false,
    'FAILED/UNKNOWN/SUPPRESSED phải có reason',
  );
});

test('DeliveryReportingEvent: SUPPRESSED = DISPATCH_GATE_DENIED (DNC fence)', () => {
  // Master §10.6.5 #2 + Backlog §0.3g AC #4: SUPPRESSED do DNC fence,
  // KHÔNG retry/DLQ re-drive.
  const r = DeliveryReportingEventSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    intentId: 'intent-001',
    consumerDedupeToken: 'consumer-dedupe-12345678',
    state: 'SUPPRESSED',
    reportedAt: '2026-09-13T10:00:00.000+07:00',
    reason: 'DISPATCH_GATE_DENIED',
  });
  assert.equal(r.state, 'SUPPRESSED');
  assert.equal(r.reason, 'DISPATCH_GATE_DENIED');
});

test('DeliveryReportingEvent: fenceContext token + cutOffAt đi cùng', () => {
  // fenceContext chỉ optional, nếu có thì fenceToken + fenceCutOffAt đi cùng.
  const ok = DeliveryReportingEventSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    intentId: 'intent-001',
    consumerDedupeToken: 'consumer-dedupe-12345678',
    state: 'SUPPRESSED',
    reportedAt: '2026-09-13T10:00:00.000+07:00',
    reason: 'DISPATCH_GATE_DENIED',
    fenceContext: {
      fenceToken: 'fence-001',
      fenceCutOffAt: '2026-09-13T11:00:00.000+07:00',
    },
  });
  assert.equal(ok.fenceContext.fenceToken, 'fence-001');

  // Chỉ fenceToken → reject.
  assert.equal(
    DeliveryReportingEventSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      intentId: 'intent-001',
      consumerDedupeToken: 'consumer-dedupe-12345678',
      state: 'SUPPRESSED',
      reportedAt: '2026-09-13T10:00:00.000+07:00',
      reason: 'DISPATCH_GATE_DENIED',
      fenceContext: { fenceToken: 'fence-001' },
    }).success,
    false,
    'fenceContext phải có fenceToken + fenceCutOffAt đi cùng',
  );
});

test('OutboxClaimRequest: fallback PULL_CLAIM_ACK cho CRM khi webhook không khả dụng', () => {
  const r = OutboxClaimRequestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    consumerId: 'consumer-001',
    capabilities: ['outbox.consume', 'case.update'],
    batchSize: 50,
  });
  assert.equal(r.batchSize, 50);
});

test('OutboxClaimLease: leaseId + fencingToken + leaseTtlSec + intents array', () => {
  const r = OutboxClaimLeaseSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    leaseId: 'lease-001',
    fencingToken: 'fence-token-001',
    leaseTtlSec: 60,
    expiresAt: '2026-09-13T10:01:00.000+07:00',
    intents: [baseDeliveryIntentFields()],
  });
  assert.equal(r.intents.length, 1);
});

test('OutboxClaimAck: receipts array (durable accept cho từng intent)', () => {
  const r = OutboxClaimAckSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    leaseId: 'lease-001',
    fencingToken: 'fence-token-001',
    receipts: [
      {
        schemaVersion: SCHEMA_VERSION,
        organizationId: org,
        intentId: 'intent-001',
        consumerDedupeToken: 'consumer-dedupe-12345678',
        outcome: 'ACCEPTED',
        acceptedAt: '2026-09-13T10:00:00.000+07:00',
      },
    ],
  });
  assert.equal(r.receipts.length, 1);
  assert.equal(r.receipts[0].outcome, 'ACCEPTED');
});

test('OUTBOX_PATCH_FORBIDDEN: KHÔNG retry/DLQ bypass DNC; KHÔNG Prisma tx', () => {
  // Backlog §0.3g AC #4: Retry/DLQ re-drive KHÔNG bypass DNC.
  assert.ok(OUTBOX_PATCH_FORBIDDEN.includes('bypassDnc'));
  assert.ok(OUTBOX_PATCH_FORBIDDEN.includes('retryWithoutSuppressionCheck'));
  assert.ok(OUTBOX_PATCH_FORBIDDEN.includes('dlqRedriveBypass'));
  assert.ok(OUTBOX_PATCH_FORBIDDEN.includes('forceSendWithoutSuppression'));
  // Master §9.1: KHÔNG Prisma tx object trong envelope.
  assert.ok(OUTBOX_PATCH_FORBIDDEN.includes('prismaTx'));
  assert.ok(OUTBOX_PATCH_FORBIDDEN.includes('sqlTransaction'));
  // AC #2: KHÔNG full hồ sơ.
  assert.ok(OUTBOX_PATCH_FORBIDDEN.includes('fullProfile'));
  assert.ok(OUTBOX_PATCH_FORBIDDEN.includes('fullIntakeSubmission'));
});
