/**
 * scheduling.test.mjs — fixtures G0/0.3f (Planning batch DTO).
 *
 * Trọng tâm AC (Backlog §0.3f):
 *  - DTO planning batch có per-item outcome, không báo all success khi một
 *    mục lỗi.
 *
 * Lưu ý:
 *  - Schema bind shape; runtime HRP gate forward đến command tương ứng.
 *  - Schema KHÔNG có field "allSuccess: boolean"; caller đọc per-item +
 *    summary.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PlanningBatchInputSchema,
  PlanningBatchItemSchema,
  PlanningBatchItemResultSchema,
  PlanningBatchSummarySchema,
  PlanningBatchResultSchema,
  PlanningBatchItemKindSchema,
  PlanningBatchItemOutcomeSchema,
} from '../dist/commands/scheduling.js';
import { SCHEMA_VERSION } from '../dist/enums.js';
import { src, ext } from './test-helpers.mjs';

const org = 'org-test-sch';
const conn = 'conn-cw-1';

test('PlanningBatchItemKind: NEXT_ACTION / AVAILABILITY / SUPPRESSION', () => {
  for (const k of ['NEXT_ACTION', 'AVAILABILITY', 'SUPPRESSION']) {
    assert.equal(PlanningBatchItemKindSchema.safeParse(k).success, true);
  }
});

test('PlanningBatchItemOutcome: APPLIED / ACCEPTED / FAILED / SKIPPED (per-item)', () => {
  for (const o of ['APPLIED', 'ACCEPTED', 'FAILED', 'SKIPPED']) {
    assert.equal(PlanningBatchItemOutcomeSchema.safeParse(o).success, true);
  }
  // KHÔNG có 'ALL_SUCCESS' hay 'SUCCESS' chung.
  assert.equal(
    PlanningBatchItemOutcomeSchema.safeParse('ALL_SUCCESS').success,
    false,
    'ALL_SUCCESS không phải per-item outcome hợp lệ (Backlog §0.3f)',
  );
  assert.equal(
    PlanningBatchItemOutcomeSchema.safeParse('SUCCESS').success,
    false,
  );
});

test('PlanningBatchItem: 3 kind discriminator', () => {
  const next = PlanningBatchItemSchema.parse({
    itemKind: 'NEXT_ACTION',
    itemId: 'item-1',
    organizationId: org,
    schedule: {
      scheduledAt: '2026-09-14T09:00:00.000+07:00',
      timezone: 'Asia/Ho_Chi_Minh',
    },
  });
  assert.equal(next.itemKind, 'NEXT_ACTION');

  const avail = PlanningBatchItemSchema.parse({
    itemKind: 'AVAILABILITY',
    itemId: 'item-2',
    organizationId: org,
    laborProfileId: 'lp-001',
    expectedVersion: 5,
    availability: 'AVAILABLE_NOW',
  });
  assert.equal(avail.itemKind, 'AVAILABILITY');

  const sup = PlanningBatchItemSchema.parse({
    itemKind: 'SUPPRESSION',
    itemId: 'item-3',
    organizationId: org,
    externalContact: {
      provider: 'CHATWOOT',
      connectionId: conn,
      externalContactId: 'ext-001',
    },
    reason: 'CANDIDATE_REQUEST',
  });
  assert.equal(sup.itemKind, 'SUPPRESSION');
});

test('PlanningBatchInput: items array 1..500 + batchId', () => {
  // Empty items → reject.
  assert.equal(
    PlanningBatchInputSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      batchId: 'batch-001',
      items: [],
      context: { source: src() },
    }).success,
    false,
  );

  // Có 1 item → OK.
  const r = PlanningBatchInputSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    batchId: 'batch-001',
    items: [
      {
        itemKind: 'NEXT_ACTION',
        itemId: 'item-1',
        organizationId: org,
        schedule: {
          scheduledAt: '2026-09-14T09:00:00.000+07:00',
          timezone: 'Asia/Ho_Chi_Minh',
        },
      },
    ],
    context: { source: src() },
  });
  assert.equal(r.items.length, 1);
});

test('PlanningBatchItemResult: FAILED phải có error; non-FAILED KHÔNG có error', () => {
  // FAILED + error OK.
  const r1 = PlanningBatchItemResultSchema.parse({
    itemId: 'item-1',
    itemKind: 'NEXT_ACTION',
    outcome: 'FAILED',
    error: {
      itemId: 'item-1',
      errorCode: 'VERSION_CONFLICT',
      messageKey: 'placement.case.version_conflict',
      retryClass: 'REFRESH_AND_REVIEW',
    },
  });
  assert.equal(r1.outcome, 'FAILED');

  // FAILED + no error → reject.
  assert.equal(
    PlanningBatchItemResultSchema.safeParse({
      itemId: 'item-1',
      itemKind: 'NEXT_ACTION',
      outcome: 'FAILED',
    }).success,
    false,
  );

  // APPLIED + error → reject.
  assert.equal(
    PlanningBatchItemResultSchema.safeParse({
      itemId: 'item-1',
      itemKind: 'NEXT_ACTION',
      outcome: 'APPLIED',
      appliedId: 'na-001',
      appliedVersion: 1,
      error: {
        itemId: 'item-1',
        errorCode: 'VERSION_CONFLICT',
        messageKey: 'x',
        retryClass: 'NEVER',
      },
    }).success,
    false,
    'APPLIED outcome không được có error',
  );
});

test('PlanningBatchItemResult: APPLIED phải có appliedId', () => {
  // APPLIED + appliedId OK.
  const r = PlanningBatchItemResultSchema.parse({
    itemId: 'item-1',
    itemKind: 'NEXT_ACTION',
    outcome: 'APPLIED',
    appliedId: 'na-001',
    appliedVersion: 1,
  });
  assert.equal(r.appliedId, 'na-001');

  // APPLIED + no appliedId → reject.
  assert.equal(
    PlanningBatchItemResultSchema.safeParse({
      itemId: 'item-1',
      itemKind: 'NEXT_ACTION',
      outcome: 'APPLIED',
    }).success,
    false,
    'APPLIED phải có appliedId',
  );

  // SKIPPED không cần appliedId.
  const skip = PlanningBatchItemResultSchema.parse({
    itemId: 'item-1',
    itemKind: 'NEXT_ACTION',
    outcome: 'SKIPPED',
  });
  assert.equal(skip.outcome, 'SKIPPED');
});

test('PlanningBatchItemResult: ACCEPTED KHÔNG mang appliedId/appliedVersion; có pendingReference canonical OperationReference (Q-32)', () => {
  // ACCEPTED + pendingReference OperationReference OK — caller có thể
  // gọi envelope OperationQuery với operationId để poll result.
  const r = PlanningBatchItemResultSchema.parse({
    itemId: 'item-1',
    itemKind: 'NEXT_ACTION',
    outcome: 'ACCEPTED',
    pendingReference: {
      kind: 'COMMAND_OPERATION',
      operationId: 'op-ref-001-min8',
    },
  });
  assert.equal(r.outcome, 'ACCEPTED');
  assert.equal(r.appliedId, undefined);
  assert.equal(r.appliedVersion, undefined);
  assert.equal(r.pendingReference.kind, 'COMMAND_OPERATION');
  assert.equal(r.pendingReference.operationId, 'op-ref-001-min8');

  // ACCEPTED + appliedId → reject (ACCEPTED không mang dấu hiệu APPLIED).
  assert.equal(
    PlanningBatchItemResultSchema.safeParse({
      itemId: 'item-1',
      itemKind: 'NEXT_ACTION',
      outcome: 'ACCEPTED',
      appliedId: 'na-001',
    }).success,
    false,
    'ACCEPTED KHÔNG có appliedId (Owner rev 2: ACCEPTED không mang dấu hiệu APPLIED)',
  );

  // ACCEPTED + appliedVersion → reject.
  assert.equal(
    PlanningBatchItemResultSchema.safeParse({
      itemId: 'item-1',
      itemKind: 'NEXT_ACTION',
      outcome: 'ACCEPTED',
      appliedVersion: 1,
    }).success,
    false,
    'ACCEPTED KHÔNG có appliedVersion',
  );

  // ACCEPTED + không có gì vẫn OK (server sẽ cấp pendingReference riêng).
  const r2 = PlanningBatchItemResultSchema.parse({
    itemId: 'item-1',
    itemKind: 'NEXT_ACTION',
    outcome: 'ACCEPTED',
  });
  assert.equal(r2.outcome, 'ACCEPTED');
});

test('PlanningBatchItemResult: FAILED/SKIPPED/APPLIED không có pendingReference', () => {
  // FAILED + pendingReference → reject.
  assert.equal(
    PlanningBatchItemResultSchema.safeParse({
      itemId: 'item-1',
      itemKind: 'NEXT_ACTION',
      outcome: 'FAILED',
      error: {
        itemId: 'item-1',
        errorCode: 'VERSION_CONFLICT',
        messageKey: 'x',
        retryClass: 'NEVER',
      },
      pendingReference: {
        kind: 'COMMAND_OPERATION',
        operationId: 'op-ref-002-min8',
      },
    }).success,
    false,
    'FAILED KHÔNG có pendingReference',
  );

  // SKIPPED + pendingReference → reject.
  assert.equal(
    PlanningBatchItemResultSchema.safeParse({
      itemId: 'item-1',
      itemKind: 'NEXT_ACTION',
      outcome: 'SKIPPED',
      pendingReference: {
        kind: 'COMMAND_OPERATION',
        operationId: 'op-ref-003-min8',
      },
    }).success,
    false,
    'SKIPPED KHÔNG có pendingReference',
  );

  // APPLIED + pendingReference → reject (đã apply ngay).
  assert.equal(
    PlanningBatchItemResultSchema.safeParse({
      itemId: 'item-1',
      itemKind: 'NEXT_ACTION',
      outcome: 'APPLIED',
      appliedId: 'na-001',
      pendingReference: {
        kind: 'COMMAND_OPERATION',
        operationId: 'op-ref-004-min8',
      },
    }).success,
    false,
    'APPLIED KHÔNG có pendingReference (đã apply ngay)',
  );
});

test('PlanningBatchSummary: applied + accepted + failed + skipped = total', () => {
  // Sum khớp → OK.
  const ok = PlanningBatchSummarySchema.parse({
    totalItems: 5,
    appliedCount: 2,
    acceptedCount: 1,
    failedCount: 1,
    skippedCount: 1,
  });
  assert.equal(ok.totalItems, 5);

  // Sum lệch → reject.
  assert.equal(
    PlanningBatchSummarySchema.safeParse({
      totalItems: 5,
      appliedCount: 2,
      acceptedCount: 1,
      failedCount: 1,
      skippedCount: 0,
    }).success,
    false,
    'Tổng applied/accepted/failed/skipped phải = totalItems',
  );
});

test('PlanningBatchResult: items.length = summary.totalItems (Backlog §0.3f AC)', () => {
  // Per-item outcome + summary khớp. ACCEPTED không có appliedId
  // (Owner rev 2); APPLIED có appliedId.
  const r = PlanningBatchResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    batchId: 'batch-001',
    items: [
      {
        itemId: 'item-1',
        itemKind: 'NEXT_ACTION',
        outcome: 'APPLIED',
        appliedId: 'na-001',
        appliedVersion: 1,
      },
      {
        itemId: 'item-2',
        itemKind: 'AVAILABILITY',
        outcome: 'FAILED',
        error: {
          itemId: 'item-2',
          errorCode: 'VERSION_CONFLICT',
          messageKey: 'x',
          retryClass: 'REFRESH_AND_REVIEW',
        },
      },
      {
        itemId: 'item-3',
        itemKind: 'SUPPRESSION',
        outcome: 'SKIPPED',
      },
    ],
    summary: {
      totalItems: 3,
      appliedCount: 1,
      acceptedCount: 0,
      failedCount: 1,
      skippedCount: 1,
    },
    completedAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r.items.length, 3);
  // 1 FAILED → KHÔNG coi là all success.
  const hasFailed = r.items.some((i) => i.outcome === 'FAILED');
  assert.equal(hasFailed, true, 'Batch có 1 FAILED → caller biết partial failure');

  // ACCEPTED item không có appliedId → summary.acceptedCount = 1 OK.
  const r2 = PlanningBatchResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    batchId: 'batch-002',
    items: [
      {
        itemId: 'item-1',
        itemKind: 'NEXT_ACTION',
        outcome: 'ACCEPTED',
        pendingReference: {
          kind: 'COMMAND_OPERATION',
          operationId: 'op-ref-001-min8',
        },
      },
      {
        itemId: 'item-2',
        itemKind: 'AVAILABILITY',
        outcome: 'APPLIED',
        appliedId: 'na-002',
        appliedVersion: 1,
      },
    ],
    summary: {
      totalItems: 2,
      appliedCount: 1,
      acceptedCount: 1,
      failedCount: 0,
      skippedCount: 0,
    },
    completedAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r2.items.length, 2);

  // items.length != summary.totalItems → reject.
  assert.equal(
    PlanningBatchResultSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      batchId: 'batch-003',
      items: [
        {
          itemId: 'item-1',
          itemKind: 'NEXT_ACTION',
          outcome: 'APPLIED',
          appliedId: 'na-001',
          appliedVersion: 1,
        },
      ],
      summary: {
        totalItems: 2,
        appliedCount: 1,
        acceptedCount: 0,
        failedCount: 0,
        skippedCount: 0,
      },
      completedAt: '2026-09-13T10:00:00.000+07:00',
    }).success,
    false,
    'items.length phải = summary.totalItems',
  );
});

test('PlanningBatchResult: KHÔNG có field allSuccess (Backlog §0.3f)', () => {
  // Schema cho PlanningBatchResult không có allSuccess; caller đọc
  // per-item + summary để quyết định.
  const r = PlanningBatchResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    batchId: 'batch-001',
    items: [
      {
        itemId: 'item-1',
        itemKind: 'NEXT_ACTION',
        outcome: 'APPLIED',
        appliedId: 'na-001',
        appliedVersion: 1,
      },
    ],
    summary: {
      totalItems: 1,
      appliedCount: 1,
      acceptedCount: 0,
      failedCount: 0,
      skippedCount: 0,
    },
    completedAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(r, 'allSuccess'),
    false,
    'PlanningBatchResult KHÔNG có field allSuccess (caller tự quyết từ per-item)',
  );
});

test('PlanningBatchItem: AVAILABILITY KHÔNG cho DO_NOT_CONTACT (cần command riêng)', () => {
  // Backlog §10.6.5: DO_NOT_CONTACT đi qua suppression.ts với transaction.
  // Planning batch AVAILABILITY chỉ cho 4 state không phải DO_NOT_CONTACT.
  assert.equal(
    PlanningBatchItemSchema.safeParse({
      itemKind: 'AVAILABILITY',
      itemId: 'item-1',
      organizationId: org,
      laborProfileId: 'lp-001',
      expectedVersion: 5,
      availability: 'DO_NOT_CONTACT',
    }).success,
    false,
    'AVAILABILITY batch item KHÔNG cho DO_NOT_CONTACT (dùng suppression.ts)',
  );
});

test('PlanningBatchInput: batchId length 8..128', () => {
  assert.equal(
    PlanningBatchInputSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      batchId: 'short',
      items: [
        {
          itemKind: 'NEXT_ACTION',
          itemId: 'item-1',
          organizationId: org,
          schedule: {
            scheduledAt: '2026-09-14T09:00:00.000+07:00',
            timezone: 'Asia/Ho_Chi_Minh',
          },
        },
      ],
      context: { source: src() },
    }).success,
    false,
    'batchId phải >= 8 ký tự',
  );
});