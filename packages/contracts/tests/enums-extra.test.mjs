/**
 * enums-extra.test.mjs — Bổ sung từ đối chiếu contracts.synthetic.mjs.
 *
 * Phần hợp nhất vào suite chính:
 *  - ExternalContactLink match state (3 giá trị: EXACT_MATCH/POSSIBLE_MATCH/UNRESOLVED)
 *    → phân biệt với MatchingOutcome (command result, có NEW_PROFILE).
 *    NEW_PROFILE không phải mapping state (Backlog §0.3a).
 *  - Schema ngăn nhầm: ExternalContactMatchStateSchema reject NEW_PROFILE,
 *    MatchingOutcomeSchema reject UNRESOLVED.
 *  - Calendar date bounds: leap year 2024-02-29 OK, 2026-02-29 reject,
 *    2026-04-31 reject, 2026-13-01 reject.
 *  - Idempotency key max 256 (boundary).
 *
 * Phần KHÔNG hợp nhất (xem _synthetic-coverage.md để biết lý do):
 *  - Vietnamese label maps (UI/i18n — ngoài Gate 0 scope).
 *  - Actor kind DELEGATED_USER (API khác baseline Master V2.6).
 *  - defineCommandContract factory (chưa thuộc baseline Gate 0).
 *  - test mọi actor kind variations (chỉ giữ phù hợp baseline).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTERNAL_CONTACT_MATCH_STATES,
  ExternalContactMatchStateSchema,
  MatchingOutcomeSchema,
  CalendarDateSchema,
  IdempotencyKeySchema,
  ExpectedVersionSchema,
} from '../dist/index.js';

test('ExternalContactLink match state đúng 3 giá trị đã chốt', () => {
  assert.deepEqual(
    [...EXTERNAL_CONTACT_MATCH_STATES],
    ['EXACT_MATCH', 'POSSIBLE_MATCH', 'UNRESOLVED'],
  );
  for (const v of EXTERNAL_CONTACT_MATCH_STATES) {
    assert.equal(ExternalContactMatchStateSchema.parse(v), v);
  }
});

test('ExternalContactLink match state KHÔNG chấp nhận NEW_PROFILE (đây là command result, không phải mapping state)', () => {
  // Backlog §0.3a: NEW_PROFILE không là matching state thứ tư.
  assert.throws(
    () => ExternalContactMatchStateSchema.parse('NEW_PROFILE'),
    /Invalid enum value/i,
    'NEW_PROFILE không được là mapping state',
  );
});

test('MatchingOutcome (command result) KHÔNG chấp nhận UNRESOLVED (đây là mapping state, không phải command result)', () => {
  // Backlog §0.3a: 3 nhánh command result, UNRESOLVED riêng cho mapping state.
  assert.throws(
    () => MatchingOutcomeSchema.parse('UNRESOLVED'),
    /Invalid enum value/i,
    'UNRESOLVED không thuộc command result',
  );
});

test('Cross-schema: ExternalContactMatchState accept EXACT_MATCH/POSSIBLE_MATCH; MatchingOutcome không', () => {
  // Sanity check phân biệt 2 schema.
  assert.equal(
    ExternalContactMatchStateSchema.safeParse('UNRESOLVED').success,
    true,
  );
  assert.equal(
    MatchingOutcomeSchema.safeParse('NEW_PROFILE').success,
    true,
  );
  assert.equal(
    ExternalContactMatchStateSchema.safeParse('NEW_PROFILE').success,
    false,
  );
  assert.equal(
    MatchingOutcomeSchema.safeParse('UNRESOLVED').success,
    false,
  );
});

test('CalendarDate: leap year 2024-02-29 OK', () => {
  assert.equal(CalendarDateSchema.parse('2024-02-29'), '2024-02-29');
});

test('CalendarDate: 2026-02-29 (không leap) bị reject', () => {
  assert.throws(() => CalendarDateSchema.parse('2026-02-29'));
});

test('CalendarDate: 2026-04-31 (ngày không tồn tại) bị reject', () => {
  assert.throws(() => CalendarDateSchema.parse('2026-04-31'));
});

test('CalendarDate: 2026-13-01 (tháng không hợp lệ) bị reject', () => {
  assert.throws(() => CalendarDateSchema.parse('2026-13-01'));
});

test('IdempotencyKey: boundary 256 chars OK', () => {
  const max = 'a'.repeat(256);
  assert.equal(IdempotencyKeySchema.parse(max), max);
});

test('IdempotencyKey: 257 chars bị reject', () => {
  // IdempotencyKey: 1..256 chars.
  assert.throws(() => IdempotencyKeySchema.parse('a'.repeat(257)));
});

test('ExpectedVersion: negative bị reject', () => {
  assert.throws(() => ExpectedVersionSchema.parse(-1));
  assert.throws(() => ExpectedVersionSchema.parse(1.5));
});

test('ExpectedVersion: 0 và integer lớn OK', () => {
  assert.equal(ExpectedVersionSchema.parse(0), 0);
  assert.equal(ExpectedVersionSchema.parse(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
});
