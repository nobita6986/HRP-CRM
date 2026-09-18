/**
 * next-action.test.mjs — fixtures G0/0.3f (NextAction contracts).
 *
 * Trọng tâm AC (Backlog §0.3f):
 *  - Define create/update intent rõ: target context, actionId khi update,
 *    expectedVersion khi sửa, OPEN/DONE/CANCELLED, due/scheduled time và
 *    timezone.
 *  - Runtime transition và target ownership thuộc HRP, không suy ra chỉ
 *    vì schema pass.
 *  - Snooze/dismiss notification khác DONE; schedule revision/occurrence
 *    có key cho dedupe reminder.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NextActionKindSchema,
  NextActionTargetKindSchema,
  NextActionTargetRefSchema,
  NextActionScheduleSchema,
  SnoozeModeSchema,
  CreateNextActionInputSchema,
  UpdateNextActionInputSchema,
  NextActionPatchSchema,
  NextActionRevisionRefSchema,
  NextActionResultSchema,
  NEXT_ACTION_PATCH_FORBIDDEN,
} from '../dist/commands/next-action.js';
import { NextActionStatusSchema, SCHEMA_VERSION } from '../dist/enums.js';
import { src, ext } from './test-helpers.mjs';

const org = 'org-test-na';
const actionId = 'na-001';
const caseId = 'lp-case-001';

test('NextActionKind: CREATE / UPDATE phân biệt intent (AC #1)', () => {
  assert.equal(NextActionKindSchema.safeParse('CREATE').success, true);
  assert.equal(NextActionKindSchema.safeParse('UPDATE').success, true);
  assert.equal(NextActionKindSchema.safeParse('random').success, false);
});

test('NextActionStatus: OPEN / DONE / CANCELLED đầy đủ 3 giá trị', () => {
  for (const s of ['OPEN', 'DONE', 'CANCELLED']) {
    assert.equal(NextActionStatusSchema.safeParse(s).success, true);
  }
  assert.equal(NextActionStatusSchema.safeParse('SNOOZED').success, false, 'SNOOZED không thuộc status chính');
  assert.equal(NextActionStatusSchema.safeParse('DISMISSED').success, false, 'DISMISSED không thuộc status chính');
});

test('SnoozeMode: ACTIVE / SNOOZED / DISMISSED tách riêng status (AC #3 snooze≠DONE)', () => {
  for (const m of ['ACTIVE', 'SNOOZED', 'DISMISSED']) {
    assert.equal(SnoozeModeSchema.safeParse(m).success, true);
  }
  assert.equal(SnoozeModeSchema.safeParse('DONE').success, false, 'DONE không thuộc SnoozeMode (khác DONE)');
});

test('NextActionTargetRef: 3 kind discriminator', () => {
  // PLACEMENT_CASE.
  const pc = NextActionTargetRefSchema.parse({
    kind: 'PLACEMENT_CASE',
    organizationId: org,
    placementCaseId: caseId,
    expectedVersion: 3,
  });
  assert.equal(pc.kind, 'PLACEMENT_CASE');

  // CLIENT_OPPORTUNITY (Client domain contract chưa chốt — Q-23 unknown).
  const co = NextActionTargetRefSchema.parse({
    kind: 'CLIENT_OPPORTUNITY',
    organizationId: org,
    clientOpportunityId: 'co-001',
    clientReferenceId: 'opaque-client-ref',
    expectedVersion: 1,
  });
  assert.equal(co.kind, 'CLIENT_OPPORTUNITY');

  // STANDALONE.
  const sa = NextActionTargetRefSchema.parse({
    kind: 'STANDALONE',
    organizationId: org,
  });
  assert.equal(sa.kind, 'STANDALONE');
});

test('NextActionTargetKind: 3 giá trị chính thức', () => {
  for (const k of ['PLACEMENT_CASE', 'CLIENT_OPPORTUNITY', 'STANDALONE']) {
    assert.equal(NextActionTargetKindSchema.safeParse(k).success, true);
  }
});

test('NextActionSchedule: ISO 8601 + Asia/Ho_Chi_Minh timezone literal', () => {
  const ok = NextActionScheduleSchema.parse({
    scheduledAt: '2026-09-13T10:00:00.000+07:00',
    timezone: 'Asia/Ho_Chi_Minh',
  });
  assert.equal(ok.timezone, 'Asia/Ho_Chi_Minh');

  // Timezone khác → reject.
  assert.equal(
    NextActionScheduleSchema.safeParse({
      scheduledAt: '2026-09-13T10:00:00.000+07:00',
      timezone: 'UTC',
    }).success,
    false,
  );
});

test('NextActionSchedule: dueAt >= scheduledAt', () => {
  // dueAt trước scheduledAt → reject.
  assert.equal(
    NextActionScheduleSchema.safeParse({
      scheduledAt: '2026-09-13T10:00:00.000+07:00',
      dueAt: '2026-09-13T09:00:00.000+07:00',
      timezone: 'Asia/Ho_Chi_Minh',
    }).success,
    false,
  );
  // Bằng nhau OK.
  const ts = '2026-09-13T10:00:00.000+07:00';
  const eq = NextActionScheduleSchema.parse({
    scheduledAt: ts,
    dueAt: ts,
    timezone: 'Asia/Ho_Chi_Minh',
  });
  assert.equal(eq.dueAt, ts);
});

test('CreateNextActionInput: target + initialStatus + intentSummary + schedule (AC #1)', () => {
  const r = CreateNextActionInputSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    kind: 'CREATE',
    target: {
      kind: 'PLACEMENT_CASE',
      organizationId: org,
      placementCaseId: caseId,
      expectedVersion: 3,
    },
    initialStatus: 'OPEN',
    intentSummary: 'gọi lại xác nhận lịch phỏng vấn',
    schedule: {
      scheduledAt: '2026-09-14T09:00:00.000+07:00',
      timezone: 'Asia/Ho_Chi_Minh',
    },
    context: { source: src() },
  });
  assert.equal(r.kind, 'CREATE');
  assert.equal(r.initialStatus, 'OPEN');
  assert.equal(r.schedule.timezone, 'Asia/Ho_Chi_Minh');
});

test('CreateNextActionInput: KHÔNG cho phép initialStatus=DONE (chưa hoàn tất)', () => {
  // DONE chỉ có qua UPDATE; CREATE chỉ OPEN/CANCELLED.
  assert.equal(
    CreateNextActionInputSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      kind: 'CREATE',
      target: {
        kind: 'PLACEMENT_CASE',
        organizationId: org,
        placementCaseId: caseId,
        expectedVersion: 3,
      },
      initialStatus: 'DONE',
      intentSummary: 'x',
      schedule: {
        scheduledAt: '2026-09-14T09:00:00.000+07:00',
        timezone: 'Asia/Ho_Chi_Minh',
      },
      context: { source: src() },
    }).success,
    false,
    'CREATE không cho phép initialStatus=DONE',
  );
});

test('CreateNextActionInput: intentSummary KHÔNG chứa URL thô', () => {
  assert.equal(
    CreateNextActionInputSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      kind: 'CREATE',
      target: {
        kind: 'PLACEMENT_CASE',
        organizationId: org,
        placementCaseId: caseId,
        expectedVersion: 3,
      },
      initialStatus: 'OPEN',
      intentSummary: 'xem https://example.com để biết thêm',
      schedule: {
        scheduledAt: '2026-09-14T09:00:00.000+07:00',
        timezone: 'Asia/Ho_Chi_Minh',
      },
      context: { source: src() },
    }).success,
    false,
  );
});

test('UpdateNextActionInput: actionId + expectedVersion + patch (AC #1)', () => {
  const r = UpdateNextActionInputSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    kind: 'UPDATE',
    actionId,
    expectedVersion: 1,
    patch: {
      status: 'DONE',
      snoozeMode: 'DISMISSED',
    },
    context: { source: src() },
  });
  assert.equal(r.actionId, actionId);
  assert.equal(r.patch.status, 'DONE');
  assert.equal(r.patch.snoozeMode, 'DISMISSED');
});

test('UpdateNextActionInput: thiếu expectedVersion → reject (optimistic concurrency)', () => {
  assert.equal(
    UpdateNextActionInputSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      kind: 'UPDATE',
      actionId,
      patch: { status: 'DONE' },
      context: { source: src() },
    }).success,
    false,
  );
});

test('NextActionPatch: status, snoozeMode, schedule, intentSummary đều optional', () => {
  // Empty patch OK (runtime sẽ reject nếu không có gì để update).
  const empty = NextActionPatchSchema.parse({});
  assert.equal(empty.status, undefined);
});

test('NextActionRevisionRef: revisionId + occurrenceKey cho dedupe reminder (AC #3)', () => {
  // Mỗi snooze/dismiss rerun cấp revisionId + occurrenceKey để dedupe.
  const r1 = NextActionRevisionRefSchema.parse({
    revisionId: 'rev-001',
    occurrenceKey: 'occ-001',
    status: 'OPEN',
    snoozeMode: 'ACTIVE',
    issuedAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r1.revisionId, 'rev-001');
  assert.equal(r1.occurrenceKey, 'occ-001');

  // Snooze rerun → occurrenceKey mới.
  const r2 = NextActionRevisionRefSchema.parse({
    revisionId: 'rev-002',
    occurrenceKey: 'occ-002',
    status: 'OPEN',
    snoozeMode: 'SNOOZED',
    issuedAt: '2026-09-13T10:05:00.000+07:00',
  });
  assert.equal(r2.snoozeMode, 'SNOOZED');
  assert.notEqual(r2.occurrenceKey, r1.occurrenceKey, 'occurrenceKey phải mới cho snooze rerun');
});

test('NextActionResult: appliedRevision cho scheduler/reminder kế tiếp', () => {
  const r = NextActionResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    actionId,
    version: 2,
    appliedStatus: 'OPEN',
    appliedSnoozeMode: 'ACTIVE',
    appliedSchedule: {
      scheduledAt: '2026-09-14T09:00:00.000+07:00',
      timezone: 'Asia/Ho_Chi_Minh',
    },
    appliedRevision: {
      revisionId: 'rev-001',
      occurrenceKey: 'occ-001',
      status: 'OPEN',
      snoozeMode: 'ACTIVE',
      issuedAt: '2026-09-13T10:00:00.000+07:00',
    },
  });
  assert.equal(r.appliedRevision.occurrenceKey, 'occ-001');
});

test('NEXT_ACTION_PATCH_FORBIDDEN: không cho phép đổi Handling / PlacementCase / read-only fields', () => {
  // Master §7.2: NextAction không đổi Handling.
  assert.ok(NEXT_ACTION_PATCH_FORBIDDEN.includes('handlingAssignment'));
  assert.ok(NEXT_ACTION_PATCH_FORBIDDEN.includes('handlingSla'));
  assert.ok(NEXT_ACTION_PATCH_FORBIDDEN.includes('handlingReset'));
  // Trục PlacementCase riêng.
  assert.ok(NEXT_ACTION_PATCH_FORBIDDEN.includes('placementCaseId'));
  assert.ok(NEXT_ACTION_PATCH_FORBIDDEN.includes('intendedStage'));
  assert.ok(NEXT_ACTION_PATCH_FORBIDDEN.includes('closeReason'));
  // Projection read-only.
  assert.ok(NEXT_ACTION_PATCH_FORBIDDEN.includes('currentRelationship'));
  // Actor từ envelope.
  assert.ok(NEXT_ACTION_PATCH_FORBIDDEN.includes('actor'));
});
