/**
 * availability.test.mjs — fixtures G0/0.3e (Availability contracts).
 *
 * Trọng tâm AC:
 *  - Input có laborProfileId + availability + expectedVersion.
 *  - AVAILABLE_FROM_DATE bắt buộc ngày lịch hợp lệ; validation "tương
 *    lai" dùng business clock/runtime context, không hardcode clock.
 *  - Khi đổi khỏi AVAILABLE_FROM_DATE, availableFromDate KHÔNG hợp lệ
 *    (clear khỏi projection); không tự đổi CurrentRelationship/case.
 *  - DO_NOT_CONTACT: state + suppression event transaction; schema bind
 *    shape, runtime gate enforce.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AvailabilityPatchSchema,
  UpdateLaborAvailabilityInputSchema,
  UpdateLaborAvailabilityResultSchema,
  AVAILABILITY_PATCH_FORBIDDEN,
} from '../dist/commands/availability.js';
import {
  AvailabilitySchema,
  SCHEMA_VERSION,
} from '../dist/enums.js';
import { src } from './test-helpers.mjs';

const org = 'org-test-av';
const profileId = 'lp-profile-001';
const conn = 'conn-zalo-1';

test('AVAILABILITIES enum đầy đủ 5 giá trị (Master §10.6.2)', () => {
  for (const a of [
    'AVAILABLE_NOW',
    'AVAILABLE_FROM_DATE',
    'NOT_AVAILABLE',
    'DO_NOT_CONTACT',
    'UNKNOWN',
  ]) {
    assert.equal(AvailabilitySchema.safeParse(a).success, true);
  }
  for (const bad of ['AVAILABLE_NEXT_WEEK', 'OFFLINE', 'random']) {
    assert.equal(
      AvailabilitySchema.safeParse(bad).success,
      false,
      `availability '${bad}' phải bị reject`,
    );
  }
});

test('AvailabilityPatch: AVAILABLE_FROM_DATE yêu cầu availableFromDate', () => {
  // Thiếu availableFromDate → reject.
  assert.equal(
    AvailabilityPatchSchema.safeParse({
      availability: 'AVAILABLE_FROM_DATE',
    }).success,
    false,
  );
  // Có availableFromDate hợp lệ → pass.
  const ok = AvailabilityPatchSchema.parse({
    availability: 'AVAILABLE_FROM_DATE',
    availableFromDate: '2026-12-31',
  });
  assert.equal(ok.availability, 'AVAILABLE_FROM_DATE');
  assert.equal(ok.availableFromDate, '2026-12-31');
});

test('AvailabilityPatch: khác AVAILABLE_FROM_DATE thì KHÔNG có availableFromDate (clear khỏi projection)', () => {
  // availableFromDate cùng state không AVAILABLE_FROM_DATE → reject.
  assert.equal(
    AvailabilityPatchSchema.safeParse({
      availability: 'AVAILABLE_NOW',
      availableFromDate: '2026-12-31',
    }).success,
    false,
  );
  // AVAILABLE_NOW alone → pass.
  const ok = AvailabilityPatchSchema.parse({ availability: 'AVAILABLE_NOW' });
  assert.equal(ok.availability, 'AVAILABLE_NOW');
  assert.equal(ok.availableFromDate, undefined);
});

test('AvailabilityPatch: DO_NOT_CONTACT availableFromDate không hợp lệ (clear)', () => {
  // DO_NOT_CONTACT là state suppression; availableFromDate là date field
  // chỉ cho AVAILABLE_FROM_DATE.
  assert.equal(
    AvailabilityPatchSchema.safeParse({
      availability: 'DO_NOT_CONTACT',
      availableFromDate: '2026-12-31',
    }).success,
    false,
  );
});

test('AvailabilityPatch: KHÔNG hardcode clock (no Date.now() check ở schema)', () => {
  // Schema chỉ check shape/calendar; không so với "now". Ngày trong quá
  // khứ vẫn pass ở schema layer (runtime HRP gate enforce future-date
  // theo Asia/Ho_Chi_Minh + submission/intake effective time).
  const past = AvailabilityPatchSchema.parse({
    availability: 'AVAILABLE_FROM_DATE',
    availableFromDate: '2020-01-01',
  });
  assert.equal(past.availableFromDate, '2020-01-01');

  const farFuture = AvailabilityPatchSchema.parse({
    availability: 'AVAILABLE_FROM_DATE',
    availableFromDate: '2099-12-31',
  });
  assert.equal(farFuture.availableFromDate, '2099-12-31');
});

test('AvailabilityPatch: ngày không tồn tại reject (leap year bounds)', () => {
  assert.equal(
    AvailabilityPatchSchema.safeParse({
      availability: 'AVAILABLE_FROM_DATE',
      availableFromDate: '2026-02-30',
    }).success,
    false,
  );
  assert.equal(
    AvailabilityPatchSchema.safeParse({
      availability: 'AVAILABLE_FROM_DATE',
      availableFromDate: '2026-13-01',
    }).success,
    false,
  );
});

test('UpdateLaborAvailabilityInput: laborProfileId + availability + expectedVersion (AC #1)', () => {
  const r = UpdateLaborAvailabilityInputSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    laborProfileId: profileId,
    expectedVersion: 7,
    patch: { availability: 'AVAILABLE_FROM_DATE', availableFromDate: '2026-12-31' },
    context: { source: src() },
  });
  assert.equal(r.laborProfileId, profileId);
  assert.equal(r.expectedVersion, 7);
  assert.equal(r.patch.availability, 'AVAILABLE_FROM_DATE');
});

test('UpdateLaborAvailabilityInput: thiếu expectedVersion → reject (optimistic concurrency)', () => {
  assert.equal(
    UpdateLaborAvailabilityInputSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      laborProfileId: profileId,
      patch: { availability: 'AVAILABLE_NOW' },
      context: { source: src() },
    }).success,
    false,
  );
});

test('UpdateLaborAvailabilityInput: note KHÔNG chứa URL/base64/data URI', () => {
  const base = {
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    laborProfileId: profileId,
    expectedVersion: 7,
    patch: { availability: 'NOT_AVAILABLE' },
    context: { source: src() },
  };
  assert.equal(
    UpdateLaborAvailabilityInputSchema.safeParse({
      ...base,
      note: 'xem https://example.com để biết thêm',
    }).success,
    false,
  );
  assert.equal(
    UpdateLaborAvailabilityInputSchema.safeParse({
      ...base,
      note: 'data:image/png;base64,iVBOR...',
    }).success,
    false,
  );
  const ok = UpdateLaborAvailabilityInputSchema.safeParse({
    ...base,
    note: 'đã xác nhận với ứng viên qua phone',
  });
  assert.equal(ok.success, true);
});

test('UpdateLaborAvailabilityInput: KHÔNG có field currentRelationship/placementCaseId (trục riêng)', () => {
  // Strict mode + Forbidden list đảm bảo reject khi cố chèn.
  for (const forbidden of ['currentRelationship', 'placementCaseId', 'placementCaseVersion', 'intendedStage', 'status', 'closeReason']) {
    assert.equal(
      UpdateLaborAvailabilityInputSchema.safeParse({
        schemaVersion: SCHEMA_VERSION,
        organizationId: org,
        laborProfileId: profileId,
        expectedVersion: 7,
        patch: {
          availability: 'AVAILABLE_NOW',
          [forbidden]: 'value',
        },
        context: { source: src() },
      }).success,
      false,
      `field cấm '${forbidden}' không được phép trong availability patch`,
    );
  }
});

test('UpdateLaborAvailabilityResult: appliedAvailableFromDate nullable đúng state', () => {
  const r = UpdateLaborAvailabilityResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    canonicalId: profileId,
    version: 8,
    previousAvailability: 'NOT_AVAILABLE',
    appliedAvailability: 'AVAILABLE_FROM_DATE',
    appliedAvailableFromDate: '2026-12-31',
  });
  assert.equal(r.appliedAvailableFromDate, '2026-12-31');

  const r2 = UpdateLaborAvailabilityResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    canonicalId: profileId,
    version: 8,
    previousAvailability: 'AVAILABLE_FROM_DATE',
    appliedAvailability: 'AVAILABLE_NOW',
    appliedAvailableFromDate: null,
  });
  assert.equal(r2.appliedAvailableFromDate, null);

  // Mismatch: appliedAvailability = AVAILABLE_FROM_DATE mà appliedAvailableFromDate = null → reject.
  assert.equal(
    UpdateLaborAvailabilityResultSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      canonicalId: profileId,
      version: 8,
      previousAvailability: 'NOT_AVAILABLE',
      appliedAvailability: 'AVAILABLE_FROM_DATE',
      appliedAvailableFromDate: null,
    }).success,
    false,
  );
});

test('UpdateLaborAvailabilityResult: suppressionEventId chỉ cho DO_NOT_CONTACT (marker)', () => {
  // Schema không enforce; runtime HRP gate đảm bảo chỉ set khi
  // appliedAvailability = DO_NOT_CONTACT. Test ghi marker.
  const r = UpdateLaborAvailabilityResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    canonicalId: profileId,
    version: 8,
    previousAvailability: 'AVAILABLE_NOW',
    appliedAvailability: 'DO_NOT_CONTACT',
    appliedAvailableFromDate: null,
    suppressionEventId: 'sup-evt-001',
  });
  assert.equal(r.suppressionEventId, 'sup-evt-001');
});

test('AVAILABILITY_PATCH_FORBIDDEN: không cho phép auto-merge/creation', () => {
  // Schema không auto-tạo LaborProfile; availability mutation chỉ mutate
  // projection. Patch forbid các field auto-creation.
  assert.ok(AVAILABILITY_PATCH_FORBIDDEN.includes('createLaborProfile'));
  assert.ok(AVAILABILITY_PATCH_FORBIDDEN.includes('mergeLaborProfile'));
  // KHÔNG có removeSuppression / bypassDnc (đó là suppression schema).
  assert.ok(AVAILABILITY_PATCH_FORBIDDEN.includes('dncReason'));
  assert.ok(AVAILABILITY_PATCH_FORBIDDEN.includes('dncNote'));
});
