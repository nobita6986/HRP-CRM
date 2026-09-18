/**
 * envelopes.test.mjs — Envelope invariants (request/response/ACCEPTED/APPLIED/FAILED).
 *
 * AC từ Backlog §Task 0.2:
 *  - RequestEnvelopeBase: schemaVersion + commandId + correlationId +
 *    idempotencyKey + organizationId + actor + source + payload.
 *  - ACCEPTED có operation ref bền, không data.
 *  - APPLIED có data, errors rỗng.
 *  - FAILED ≥1 error, không data.
 *  - Operation reference query có commandId + operationId.
 *  - Idempotency digest ổn định (sha256 canonical JSON).
 *  - Canonicalize sort key.
 *  - Source discriminator HRP_UI vs INTEGRATION (CHATWOOT/ZALO_OA).
 *  - Strict: reject field thừa.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  AcceptedResponseSchema,
  ActorSchema,
  AppliedResponseBaseSchema,
  CalendarDateSchema,
  CanonicalIdSchema,
  CommandSourceSchema,
  CorrelationIdSchema,
  FailedResponseSchema,
  IdempotencyKeySchema,
  IsoTimestampSchema,
  OperationQuerySchema,
  OperationReferenceSchema,
  RequestEnvelopeBaseSchema,
  ResponseEnvelopeSchema,
  SCHEMA_VERSION,
  SchemaVersionSchema,
  applyApplied,
  canonicalize,
  commandRequest,
  commandResponse,
  idempotencyDigest,
  makeError,
  ExpectedVersionSchema,
  ConnectionIdSchema,
  OrganizationIdSchema,
} from '../dist/index.js';

const reject = (schema, value) =>
  assert.equal(schema.safeParse(value).success, false);

const envelopeFor = (payload = { hello: 'world' }) => ({
  schemaVersion: SCHEMA_VERSION,
  commandId: 'cmd-env-001',
  idempotencyKey: 'submission-env-001:step:1',
  correlationId: 'trace-env-001',
  organizationId: 'org-env-001',
  actor: { kind: 'USER', userId: 'user-env-001' },
  source: { kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null },
  payload,
});

test('schema version pin cho envelope', () => {
  assert.equal(SCHEMA_VERSION, '1');
  assert.equal(SchemaVersionSchema.parse('1'), '1');
  reject(SchemaVersionSchema, '2');
  reject(SchemaVersionSchema, '');
});

test('commandRequest envelope base hợp lệ với USER actor và HRP_UI source', () => {
  const requestSchema = commandRequest(z.object({ hello: z.string() }).strict());
  const r = requestSchema.parse(envelopeFor());
  assert.equal(r.commandId, 'cmd-env-001');
  assert.equal(r.actor.kind, 'USER');
});

test('commandRequest envelope base hợp lệ với SERVICE actor + INTEGRATION source', () => {
  const requestSchema = commandRequest(z.object({ hello: z.string() }).strict());
  const r = requestSchema.parse({
    ...envelopeFor(),
    actor: { kind: 'SERVICE', serviceId: 'svc-env-001' },
    source: { kind: 'INTEGRATION', provider: 'ZALO_OA', connectionId: 'conn-zalo-1' },
  });
  assert.equal(r.source.provider, 'ZALO_OA');
});

test('commandRequest envelope hợp lệ với DELEGATED_USER actor', () => {
  // Baseline actor API: DELEGATED_USER là discriminator thứ 3 với
  // serviceId + userId + delegationRef.
  const requestSchema = commandRequest(z.object({ hello: z.string() }).strict());
  const r = requestSchema.parse({
    ...envelopeFor(),
    actor: {
      kind: 'DELEGATED_USER',
      serviceId: 'svc-env-001',
      userId: 'user-env-001',
      delegationRef: 'deleg-env-001',
    },
  });
  assert.equal(r.actor.kind, 'DELEGATED_USER');
});

test('malformed actor (USER có serviceId) bị reject (strict)', () => {
  reject(ActorSchema, { kind: 'USER', userId: 'u1', serviceId: 's1' });
  reject(ActorSchema, { kind: 'SERVICE', userId: 'u1' });
});

test('actor SERVICE hợp lệ với chỉ serviceId (audit sẽ kiểm runtime)', () => {
  // Schema chỉ enforce shape; runtime HRP audit sẽ quyết policy.
  assert.equal(
    ActorSchema.safeParse({ kind: 'SERVICE', serviceId: 'svc-1' }).success,
    true,
  );
});

test('source HRP_UI: provider=HRP_UI, connectionId=null', () => {
  // HRP_UI + provider ZALO_OA → reject (HRP_UI không có external connection).
  reject(CommandSourceSchema, {
    kind: 'HRP_UI',
    provider: 'ZALO_OA',
    connectionId: null,
  });
  // HRP_UI + connectionId không phải null → reject.
  reject(CommandSourceSchema, {
    kind: 'HRP_UI',
    provider: 'HRP_UI',
    connectionId: 'fake-conn',
  });
  // Hợp lệ.
  assert.equal(
    CommandSourceSchema.safeParse({
      kind: 'HRP_UI',
      provider: 'HRP_UI',
      connectionId: null,
    }).success,
    true,
  );
});

test('source INTEGRATION chỉ chấp nhận CHATWOOT/ZALO_OA, không UNKNOWN', () => {
  // INTEGRATION + provider UNKNOWN → reject.
  reject(CommandSourceSchema, {
    kind: 'INTEGRATION',
    provider: 'UNKNOWN',
    connectionId: 'conn-1',
  });
  // Hợp lệ.
  assert.equal(
    CommandSourceSchema.safeParse({
      kind: 'INTEGRATION',
      provider: 'CHATWOOT',
      connectionId: 'conn-cw-1',
    }).success,
    true,
  );
});

test('unknown schema version bị reject', () => {
  const requestSchema = commandRequest(z.object({ hello: z.string() }).strict());
  reject(requestSchema, { ...envelopeFor(), schemaVersion: '99' });
});

test('idempotency key vượt giới hạn độ dài bị reject', () => {
  const requestSchema = commandRequest(z.object({ hello: z.string() }).strict());
  reject(requestSchema, {
    ...envelopeFor(),
    idempotencyKey: 'a'.repeat(257),
  });
});

test('correlation id và idempotency key tồn tại độc lập', () => {
  const requestSchema = commandRequest(z.object({ hello: z.string() }).strict());
  const r = requestSchema.parse({
    ...envelopeFor(),
    idempotencyKey: 'submission-1:step:1',
    correlationId: 'trace-distinct-1',
  });
  assert.equal(r.correlationId, 'trace-distinct-1');
  assert.equal(r.idempotencyKey, 'submission-1:step:1');
});

test('correlationId không thay thế idempotencyKey', () => {
  const requestSchema = commandRequest(z.object({ hello: z.string() }).strict());
  const missing = envelopeFor();
  delete missing.idempotencyKey;
  reject(requestSchema, missing);
});

test('CorrelationId/CommandId/IdempotencyKey/OrganizationId/ConnectionId opaque với regex', () => {
  for (const id of ['cuid-like_1', '123', 'a'.repeat(128)]) {
    assert.equal(CanonicalIdSchema.parse(id), id);
  }
  for (const id of ['', ' a', 'a/b', 'a\n', 'a'.repeat(129)]) {
    reject(CanonicalIdSchema, id);
  }
  reject(IdempotencyKeySchema, 'a'.repeat(257));
  reject(IdempotencyKeySchema, '');
  reject(ConnectionIdSchema, '');
  reject(OrganizationIdSchema, '');
  assert.equal(CorrelationIdSchema.parse('trace-x-y-12345'), 'trace-x-y-12345');
});

test('IsoTimestamp accept ISO 8601 với offset; reject chuỗi không hợp lệ', () => {
  assert.equal(IsoTimestampSchema.parse('2026-09-13T00:00:00.000Z'), '2026-09-13T00:00:00.000Z');
  assert.equal(IsoTimestampSchema.parse('2026-09-13T07:00:00+07:00'), '2026-09-13T07:00:00+07:00');
  reject(IsoTimestampSchema, 'yesterday');
  reject(IsoTimestampSchema, '2026-13-13T00:00:00Z');
});

test('CalendarDate accept ngày lịch hợp lệ; reject ngày không tồn tại', () => {
  assert.equal(CalendarDateSchema.parse('2024-02-29'), '2024-02-29'); // leap year
  reject(CalendarDateSchema, '2026-02-29'); // không leap
  reject(CalendarDateSchema, '2026-04-31');
  reject(CalendarDateSchema, '2026-13-01');
});

test('ACCEPTED response có operation reference, không có data', () => {
  const accepted = {
    schemaVersion: SCHEMA_VERSION,
    commandId: 'cmd-env-accept-1',
    correlationId: 'trace-env-accept-1',
    status: 'ACCEPTED',
    operation: { kind: 'COMMAND_OPERATION', operationId: 'op-env-1' },
    errors: [],
  };
  AcceptedResponseSchema.parse(accepted);
  // Có data → reject.
  reject(AcceptedResponseSchema, {
    ...accepted,
    data: { referenceId: 'lp-1' },
  });
  // Có applied marker → reject.
  reject(AcceptedResponseSchema, { ...accepted, applied: true });
  reject(AcceptedResponseSchema, { ...accepted, approved: true });
});

test('OperationReference schema: kind + operationId required', () => {
  OperationReferenceSchema.parse({ kind: 'COMMAND_OPERATION', operationId: 'op-env-1' });
  reject(OperationReferenceSchema, { kind: 'COMMAND_OPERATION' });
  reject(OperationReferenceSchema, { operationId: 'op-env-1' });
});

test('OperationQuery: schemaVersion + org + commandId + operationId + actor required', () => {
  OperationQuerySchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-env-1',
    commandId: 'cmd-env-1',
    operationId: 'op-env-1',
    actor: { kind: 'USER', userId: 'user-env-1' },
  });
  // Thiếu operationId → reject.
  reject(OperationQuerySchema, {
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-env-1',
    commandId: 'cmd-env-1',
    actor: { kind: 'USER', userId: 'user-env-1' },
  });
});

test('APPLIED response yêu cầu data, errors rỗng', () => {
  const dataSchema = z.object({ referenceId: CanonicalIdSchema }).strict();
  const responseSchema = applyApplied(dataSchema);
  responseSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    commandId: 'cmd-env-apply-1',
    correlationId: 'trace-env-apply-1',
    status: 'APPLIED',
    data: { referenceId: 'lp-1' },
    errors: [],
  });
  // Thiếu data → reject.
  reject(responseSchema, {
    schemaVersion: SCHEMA_VERSION,
    commandId: 'cmd-env-apply-1',
    correlationId: 'trace-env-apply-1',
    status: 'APPLIED',
    errors: [],
  });
  // Có errors → reject.
  reject(responseSchema, {
    schemaVersion: SCHEMA_VERSION,
    commandId: 'cmd-env-apply-1',
    correlationId: 'trace-env-apply-1',
    status: 'APPLIED',
    data: { referenceId: 'lp-1' },
    errors: [makeError('VALIDATION_ERROR')],
  });
});

test('APPLIED base schema chấp nhận data unknown ở layer envelope chung', () => {
  AppliedResponseBaseSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    commandId: 'cmd-env-apply-2',
    correlationId: 'trace-env-apply-2',
    status: 'APPLIED',
    data: { anything: 'goes' },
    errors: [],
  });
});

test('FAILED response không được có data hữu dụng', () => {
  const failed = {
    schemaVersion: SCHEMA_VERSION,
    commandId: 'cmd-env-fail-1',
    correlationId: 'trace-env-fail-1',
    status: 'FAILED',
    errors: [makeError('VERSION_CONFLICT')],
  };
  FailedResponseSchema.parse(failed);
  reject(FailedResponseSchema, { ...failed, errors: [] });
  reject(FailedResponseSchema, { ...failed, data: { referenceId: 'lp-1' } });
  reject(FailedResponseSchema, {
    ...failed,
    operation: { kind: 'COMMAND_OPERATION', operationId: 'op-env-1' },
  });
});

test('idempotency: same payload digest → trùng', async () => {
  const a = await idempotencyDigest({ b: 'x', a: 1 });
  const b = await idempotencyDigest({ a: 1, b: 'x' });
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/u);
});

test('idempotency: different payload digest → khác', async () => {
  const a = await idempotencyDigest({ a: 1 });
  const b = await idempotencyDigest({ a: 2 });
  assert.notEqual(a, b);
});

test('canonicalize sort key ổn định', () => {
  assert.equal(canonicalize({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(canonicalize({ a: 1, b: 2 }), '{"a":1,"b":2}');
  assert.equal(canonicalize({}), '{}');
});

test('commandResponse factory: discriminated union 3 status', () => {
  const dataSchema = z.object({ referenceId: CanonicalIdSchema }).strict();
  const responseSchema = commandResponse(dataSchema);
  assert.equal(responseSchema.options.length, 3);
  // Status không hợp lệ → reject.
  reject(responseSchema, {
    schemaVersion: SCHEMA_VERSION,
    commandId: 'cmd-env-resp-1',
    correlationId: 'trace-env-resp-1',
    status: 'DELIVERED',
    data: { referenceId: 'lp-1' },
    errors: [],
  });
});

test('ResponseEnvelope union (3 status)', () => {
  reject(ResponseEnvelopeSchema, {
    schemaVersion: SCHEMA_VERSION,
    commandId: 'cmd-env-resp-2',
    correlationId: 'trace-env-resp-2',
    status: 'DELIVERED',
    data: { referenceId: 'lp-1' },
    errors: [],
  });
});

test('ExpectedVersion: non-negative integer; reject -1, 1.5', () => {
  assert.equal(ExpectedVersionSchema.parse(0), 0);
  assert.equal(ExpectedVersionSchema.parse(7), 7);
  reject(ExpectedVersionSchema, -1);
  reject(ExpectedVersionSchema, 1.5);
});

