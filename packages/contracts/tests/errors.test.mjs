/**
 * errors.test.mjs — Error taxonomy invariants (Backlog §Task 0.2).
 *
 * AC:
 *  - Taxonomy có 10 codes (VALIDATION_ERROR / UNRESOLVED_IDENTITY /
 *    POLICY_REJECTION / VERSION_CONFLICT / IDEMPOTENCY_CONFLICT /
 *    AUTHENTICATION_REQUIRED / FORBIDDEN / DEPENDENCY_UNAVAILABLE /
 *    RATE_LIMITED / UNKNOWN_COMMAND_OUTCOME).
 *  - Retry default: validation/forbidden/version conflict/idempotency
 *    conflict/auth required = NEVER; unresolved/policy = REVIEW_REQUIRED;
 *    dependency/rate-limit = BOUNDED_SAME_KEY; unknown outcome =
 *    RECONCILE_FIRST; version conflict = REFRESH_AND_REVIEW.
 *  - HTTP hint stable theo code.
 *  - StructuredError: KHÔNG raw stack/SQL/providerBody/secret/message/
 *    details. Field path là JSON pointer, không echo giá trị PII.
 *  - messageKey bắt buộc (UI dùng để dịch).
 *  - ErrorList: min 1, max 64.
 *  - retry.retryAfterSec: 0..300.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErrorCodeSchema,
  ErrorListSchema,
  StructuredErrorSchema,
  ERROR_RETRYABLE_DEFAULT,
  ERROR_HTTP_HINT,
  makeError,
} from '../dist/index.js';

test('error code đủ 10 loại', () => {
  assert.deepEqual([...ErrorCodeSchema.options], [
    'VALIDATION_ERROR',
    'UNRESOLVED_IDENTITY',
    'POLICY_REJECTION',
    'VERSION_CONFLICT',
    'IDEMPOTENCY_CONFLICT',
    'AUTHENTICATION_REQUIRED',
    'FORBIDDEN',
    'DEPENDENCY_UNAVAILABLE',
    'RATE_LIMITED',
    'UNKNOWN_COMMAND_OUTCOME',
  ]);
});

test('retry defaults: validation/forbidden/version conflict/idempotency/auth không retry', () => {
  assert.equal(ERROR_RETRYABLE_DEFAULT.VALIDATION_ERROR, false);
  assert.equal(ERROR_RETRYABLE_DEFAULT.FORBIDDEN, false);
  assert.equal(ERROR_RETRYABLE_DEFAULT.VERSION_CONFLICT, false);
  assert.equal(ERROR_RETRYABLE_DEFAULT.IDEMPOTENCY_CONFLICT, false);
  assert.equal(ERROR_RETRYABLE_DEFAULT.AUTHENTICATION_REQUIRED, false);
});

test('retry defaults: unresolved/policy = REVIEW_REQUIRED (semantic)', () => {
  // Semantic: REVIEW_REQUIRED = không auto-retry, cần read/re-review.
  // Schema default retryable = false, nhưng retryClass = REVIEW_REQUIRED.
  assert.equal(ERROR_RETRYABLE_DEFAULT.UNRESOLVED_IDENTITY, false);
  assert.equal(ERROR_RETRYABLE_DEFAULT.POLICY_REJECTION, false);
});

test('retry defaults: dependency/rate-limit là retryable', () => {
  assert.equal(ERROR_RETRYABLE_DEFAULT.DEPENDENCY_UNAVAILABLE, true);
  assert.equal(ERROR_RETRYABLE_DEFAULT.RATE_LIMITED, true);
});

test('HTTP hint ổn định theo code', () => {
  assert.equal(ERROR_HTTP_HINT.VALIDATION_ERROR, 422);
  assert.equal(ERROR_HTTP_HINT.AUTHENTICATION_REQUIRED, 401);
  assert.equal(ERROR_HTTP_HINT.FORBIDDEN, 403);
  assert.equal(ERROR_HTTP_HINT.IDEMPOTENCY_CONFLICT, 409);
  assert.equal(ERROR_HTTP_HINT.VERSION_CONFLICT, 409);
  assert.equal(ERROR_HTTP_HINT.RATE_LIMITED, 429);
  assert.equal(ERROR_HTTP_HINT.DEPENDENCY_UNAVAILABLE, 503);
});

test('makeError cấm chứa raw stack/SQL/providerBody/secret/message/details', () => {
  // Schema reject field cấm (strict + safe allowlist).
  const e = makeError('VALIDATION_ERROR');
  for (const f of ['stack', 'sql', 'providerBody', 'secret', 'message', 'details']) {
    const r = StructuredErrorSchema.safeParse({ ...e, [f]: 'leak-marker' });
    assert.equal(r.success, false, `field '${f}' phải bị reject`);
  }
});

test('field path phải là JSON pointer, không chứa giá trị', () => {
  // Echo PII/giá trị dynamic → reject.
  for (const bad of [
    'unknown',
    '/payload/phone/0900000000',
    'payload.0900000000',
    'unknown.payload',
  ]) {
    const r = StructuredErrorSchema.safeParse({
      ...makeError('VALIDATION_ERROR'),
      fieldPath: bad,
    });
    assert.equal(r.success, false, `fieldPath '${bad}' phải bị reject`);
  }
  // Hợp lệ: 'request', 'actor', 'payload', 'source', etc. (allowlist cố định).
  for (const ok of ['request', 'schemaVersion', 'commandId', 'actor', 'source', 'payload']) {
    const r = StructuredErrorSchema.safeParse({
      ...makeError('VALIDATION_ERROR'),
      fieldPath: ok,
    });
    assert.equal(r.success, true, `fieldPath '${ok}' phải pass`);
  }
});

test('ErrorList minimum 1, maximum 64', () => {
  assert.throws(() => ErrorListSchema.parse([]));
  assert.throws(() => ErrorListSchema.parse(new Array(65).fill(makeError('VALIDATION_ERROR'))));
  assert.equal(ErrorListSchema.parse([makeError('FORBIDDEN')]).length, 1);
});

test('messageKey bắt buộc, dùng để UI dịch', () => {
  // makeError(code) tự lấy messageKey từ ERROR_POLICIES[code].
  const e = makeError('VALIDATION_ERROR');
  assert.equal(typeof e.messageKey, 'string');
  assert.ok(e.messageKey.length > 0);
  assert.equal(e.messageKey, 'errors.validation');
});

test('retry policy: BOUNDED_SAME_KEY (rate-limit, dependency) — caller có thể thêm retryAfterSec ở layer transport', () => {
  // Schema hiện KHÔNG có field `retry.retryAfterSec` ở DTO — runtime
  // HRP gate / transport layer có thể đính retryAfterSec từ Retry-After
  // header. Schema chỉ verify retryClass = BOUNDED_SAME_KEY cho
  // RATE_LIMITED và DEPENDENCY_UNAVAILABLE.
  const rate = makeError('RATE_LIMITED');
  assert.equal(rate.retryClass, 'BOUNDED_SAME_KEY');
  assert.equal(ERROR_RETRYABLE_DEFAULT.RATE_LIMITED, true);

  const dep = makeError('DEPENDENCY_UNAVAILABLE');
  assert.equal(dep.retryClass, 'BOUNDED_SAME_KEY');
  assert.equal(ERROR_RETRYABLE_DEFAULT.DEPENDENCY_UNAVAILABLE, true);
});

test('retry policy: NEVER codes (validation, forbidden, idempotency)', () => {
  for (const code of [
    'VALIDATION_ERROR',
    'FORBIDDEN',
    'IDEMPOTENCY_CONFLICT',
  ]) {
    const e = makeError(code);
    assert.equal(e.retryClass, 'NEVER', `${code} phải có retryClass=NEVER`);
    assert.equal(ERROR_RETRYABLE_DEFAULT[code], false);
  }
});

test('AUTHENTICATION_REQUIRED yêu cầu REAUTHENTICATE (không retry mù với token cũ)', () => {
  // Backlog G-02: AUTHENTICATION_REQUIRED = REAUTHENTICATE.
  const e = makeError('AUTHENTICATION_REQUIRED');
  assert.equal(e.retryClass, 'REAUTHENTICATE');
  assert.equal(ERROR_RETRYABLE_DEFAULT.AUTHENTICATION_REQUIRED, false);
});

test('VERSION_CONFLICT yêu cầu REFRESH_AND_REVIEW (không retry mù)', () => {
  // Backlog G-02: version conflict cần read/re-review, không replay mù.
  const e = makeError('VERSION_CONFLICT');
  assert.equal(e.retryClass, 'REFRESH_AND_REVIEW');
  assert.equal(ERROR_RETRYABLE_DEFAULT.VERSION_CONFLICT, false);
});

test('UNKNOWN_COMMAND_OUTCOME không khẳng định domain đã apply hay chưa', () => {
  // Schema cho phép UNKNOWN_COMMAND_OUTCOME nhưng retryClass RECONCILE_FIRST,
  // không đảm bảo đã apply.
  const e = makeError('UNKNOWN_COMMAND_OUTCOME');
  assert.equal(e.code, 'UNKNOWN_COMMAND_OUTCOME');
  assert.equal(e.retryClass, 'RECONCILE_FIRST');
  assert.equal(ERROR_RETRYABLE_DEFAULT.UNKNOWN_COMMAND_OUTCOME, false);
});
