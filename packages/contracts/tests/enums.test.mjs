/**
 * enums.test.mjs — Verify enum membership & negative guards.
 *
 * AC từ Implementation-Backlog.Gate0 §Task 0.1:
 *  - 8 stages đúng; CLOSED là status close duy nhất; 9 closeReason.
 *  - 5 Availability; 5 CurrentRelationship (read-only).
 *  - Không chấp nhận CLOSED_SUCCESS / SUCCESS_HRP_WORKFORCE / closeReason
 *    giả lập stage.
 *  - NextAction OPEN/DONE/CANCELLED tách enum mapping.
 *  - ExternalContactMatchState: EXACT_MATCH / POSSIBLE_MATCH / UNRESOLVED
 *    (NEW_PROFILE KHÔNG là mapping state — Backlog §0.3a).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLACEMENT_CASE_STAGES,
  CASE_CLOSE_REASONS,
  AVAILABILITIES,
  CURRENT_RELATIONSHIPS,
  NEXT_ACTION_STATUSES,
  EXTERNAL_CONTACT_MATCH_STATES,
  CLOSED_CASE_STATUS,
  FORBIDDEN_CLOSED_VARIANTS,
  MatchingOutcomeSchema,
  ClosedCaseStatusSchema,
  PlacementCaseStageSchema,
  CaseCloseReasonSchema,
  AvailabilitySchema,
  CurrentRelationshipSchema,
  ExternalContactMatchStateSchema,
  NextActionStatusSchema,
  SCHEMA_VERSION,
} from '../dist/index.js';

test('placement stages đúng 8 giá trị đã chốt', () => {
  assert.deepEqual(
    [...PLACEMENT_CASE_STAGES],
    [
      'NEW',
      'CONTACTING',
      'QUALIFYING',
      'MATCHING',
      'PROPOSED',
      'INTERESTED',
      'CLIENT_PROCESS',
      'READY_TO_START',
    ],
  );
  for (const v of PLACEMENT_CASE_STAGES) {
    assert.equal(PlacementCaseStageSchema.parse(v), v);
  }
});

test('case status đóng duy nhất là CLOSED (ClosedCaseStatusSchema literal)', () => {
  assert.equal(CLOSED_CASE_STATUS, 'CLOSED');
  assert.equal(ClosedCaseStatusSchema.parse('CLOSED'), 'CLOSED');
  assert.throws(() => ClosedCaseStatusSchema.parse('CLOSED_SUCCESS'));
  assert.throws(() => ClosedCaseStatusSchema.parse('OPEN'));
});

test('close reason đúng 9 giá trị, không có stage nào lẫn vào', () => {
  assert.deepEqual(
    [...CASE_CLOSE_REASONS],
    [
      'SUCCESS',
      'NO_LONGER_LOOKING',
      'UNREACHABLE',
      'NO_SUITABLE_JOB',
      'CANDIDATE_WITHDREW',
      'CLIENT_REJECTED',
      'DUPLICATE_CASE',
      'INVALID',
      'OTHER',
    ],
  );
  for (const reason of CASE_CLOSE_REASONS) {
    assert.equal(CaseCloseReasonSchema.parse(reason), reason);
    // closeReason không được làm stage.
    assert.throws(() => PlacementCaseStageSchema.parse(reason));
  }
  // Phải reject mọi closeReason ngoài 9.
  for (const bad of [
    'SUCCESS_HRP_WORKFORCE',
    'SUCCESS_DIRECT_HIRE',
    'CLOSED_NO_ANSWER',
    'FAILED',
    'STAGE_NEW',
  ]) {
    assert.throws(
      () => CaseCloseReasonSchema.parse(bad),
      /Invalid enum value/i,
      `closeReason '${bad}' phải bị reject`,
    );
  }
});

test('availability đúng 5 giá trị', () => {
  assert.deepEqual(
    [...AVAILABILITIES],
    [
      'AVAILABLE_NOW',
      'AVAILABLE_FROM_DATE',
      'NOT_AVAILABLE',
      'DO_NOT_CONTACT',
      'UNKNOWN',
    ],
  );
  for (const v of AVAILABILITIES) {
    assert.equal(AvailabilitySchema.parse(v), v);
  }
  // NO_ANSWER không phải availability.
  assert.throws(() => AvailabilitySchema.parse('NO_ANSWER'));
});

test('current relationship đúng 5 giá trị, đánh dấu read-only', () => {
  assert.deepEqual(
    [...CURRENT_RELATIONSHIPS],
    [
      'NEVER_WORKED',
      'WORKING_VIA_HRP',
      'FORMER_HRP_WORKER',
      'WORKING_EXTERNAL',
      'UNKNOWN',
    ],
  );
  for (const v of CURRENT_RELATIONSHIPS) {
    assert.equal(CurrentRelationshipSchema.parse(v), v);
  }
});

test('matching outcomes là command result, không thêm matching state mới', () => {
  assert.deepEqual([...EXTERNAL_CONTACT_MATCH_STATES], [
    'EXACT_MATCH',
    'POSSIBLE_MATCH',
    'UNRESOLVED',
  ]);
  for (const ok of ['EXACT_MATCH', 'POSSIBLE_MATCH', 'NEW_PROFILE']) {
    assert.equal(MatchingOutcomeSchema.parse(ok), ok);
  }
  // UNRESOLVED không thuộc command result (chỉ là mapping state).
  assert.throws(() => MatchingOutcomeSchema.parse('UNRESOLVED'));
  // NEW_PROFILE không thuộc mapping state (chỉ là command result).
  assert.throws(() => ExternalContactMatchStateSchema.parse('NEW_PROFILE'));
  for (const ok of EXTERNAL_CONTACT_MATCH_STATES) {
    assert.equal(ExternalContactMatchStateSchema.parse(ok), ok);
  }
});

test('next action status là 3 giá trị độc lập', () => {
  assert.deepEqual([...NEXT_ACTION_STATUSES], ['OPEN', 'DONE', 'CANCELLED']);
  for (const v of NEXT_ACTION_STATUSES) {
    assert.equal(NextActionStatusSchema.parse(v), v);
  }
});

test('closed_variants cấm luôn bị reject', () => {
  for (const bad of FORBIDDEN_CLOSED_VARIANTS) {
    assert.throws(
      () => CaseCloseReasonSchema.parse(bad),
      /Invalid enum value/i,
      `biến thể cấm ${bad} phải bị reject`,
    );
    assert.throws(
      () => PlacementCaseStageSchema.parse(bad),
      /Invalid enum value/i,
      `biến thể cấm ${bad} không được làm stage`,
    );
    // ClosedCaseStatusSchema là literal, có thể throw "Invalid literal value"
    // hoặc "Invalid enum value" — chỉ check throw.
    assert.throws(
      () => ClosedCaseStatusSchema.parse(bad),
      /Invalid (enum value|literal value)/i,
      `biến thể cấm ${bad} không được làm status`,
    );
  }
});

test('schema version pin cho envelope', () => {
  assert.equal(SCHEMA_VERSION, '1');
});
