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
  FailedResponseSchema,
  IdempotencyScopeSchema,
  IsoTimestampSchema,
  OperationQuerySchema,
  RequestEnvelopeBaseSchema,
  ResponseEnvelopeSchema,
  SCHEMA_VERSION,
  SchemaVersionSchema,
  applyApplied,
  canonicalize,
  commandResponse,
  idempotencyDigest,
  makeError,
} from '../dist/index.js';

const reject = (schema, value) => assert.equal(schema.safeParse(value).success, false);
const request = () => ({
  schemaVersion: SCHEMA_VERSION,
  commandId: 'cmd-synthetic-1',
  idempotencyKey: 'submission-synthetic-1:step:1',
  correlationId: 'trace-synthetic-1',
  organizationId: 'org-synthetic-1',
  actor: { kind: 'USER', userId: 'user-synthetic-1' },
  source: { kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null },
});
const responseBase = {
  schemaVersion: SCHEMA_VERSION,
  commandId: 'cmd-synthetic-1',
  correlationId: 'trace-synthetic-1',
};

test('request envelope accepts explicit USER/SERVICE/delegated claims', () => {
  RequestEnvelopeBaseSchema.parse(request());
  for (const actor of [
    { kind: 'SERVICE', serviceId: 'service-synthetic-1' },
    { kind: 'DELEGATED_USER', serviceId: 'service-synthetic-1', userId: 'user-synthetic-1', delegationRef: 'delegation-synthetic-1' },
  ]) RequestEnvelopeBaseSchema.parse({ ...request(), actor });
});

test('actor remains a strict claim and malformed/spoofed shapes fail', () => {
  for (const actor of [
    { kind: 'USER' },
    { kind: 'USER', userId: 'u', verified: true },
    { kind: 'SERVICE', serviceId: 's', userId: 'u' },
    { kind: 'DELEGATED_USER', serviceId: 's', userId: 'u' },
    { kind: 'ADMIN', userId: 'u' },
  ]) reject(ActorSchema, actor);
});

test('source semantics distinguish HRP UI from integration provider connection', () => {
  CommandSourceSchema.parse({ kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null });
  CommandSourceSchema.parse({ kind: 'INTEGRATION', provider: 'CHATWOOT', connectionId: 'connection-1' });
  CommandSourceSchema.parse({ kind: 'INTEGRATION', provider: 'ZALO_OA', connectionId: 'connection-1' });
  for (const source of [
    { kind: 'HRP_UI', provider: 'ZALO_OA', connectionId: null },
    { kind: 'HRP_UI', provider: 'HRP_UI', connectionId: 'fake-zalo' },
    { kind: 'INTEGRATION', provider: 'CHATWOOT', connectionId: null },
    { kind: 'INTEGRATION', provider: 'UNKNOWN', connectionId: 'connection-1' },
  ]) reject(CommandSourceSchema, source);
});

test('unknown version and malformed IDs/timestamps/dates fail without UUID assumptions', () => {
  assert.equal(SchemaVersionSchema.parse('1'), '1');
  reject(SchemaVersionSchema, '2');
  for (const id of ['cuid-like_1', '123', 'a'.repeat(128)]) assert.equal(CanonicalIdSchema.parse(id), id);
  for (const id of ['', ' a', 'a/b', 'a'.repeat(129)]) reject(CanonicalIdSchema, id);
  IsoTimestampSchema.parse('2026-09-13T00:00:00.000Z');
  IsoTimestampSchema.parse('2026-09-13T07:00:00+07:00');
  reject(IsoTimestampSchema, 'yesterday');
  CalendarDateSchema.parse('2024-02-29');
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01']) reject(CalendarDateSchema, date);
});

test('ACCEPTED has durable operation query reference and no applied markers/data', () => {
  const accepted = {
    ...responseBase,
    status: 'ACCEPTED',
    operation: { kind: 'COMMAND_OPERATION', operationId: 'operation-synthetic-1' },
    errors: [],
  };
  AcceptedResponseSchema.parse(accepted);
  OperationQuerySchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-synthetic-1',
    commandId: responseBase.commandId,
    operationId: accepted.operation.operationId,
    actor: request().actor,
  });
  for (const extra of [{ data: { applied: true } }, { applied: true }, { approved: true }]) {
    reject(AcceptedResponseSchema, { ...accepted, ...extra });
  }
  reject(OperationQuerySchema, { schemaVersion: SCHEMA_VERSION, organizationId: 'org-synthetic-1' });
});

test('APPLIED requires command-typed data and an empty error tuple', () => {
  const dataSchema = z.object({ referenceId: CanonicalIdSchema }).strict();
  const schema = applyApplied(dataSchema);
  schema.parse({ ...responseBase, status: 'APPLIED', data: { referenceId: 'canonical-1' }, errors: [] });
  reject(schema, { ...responseBase, status: 'APPLIED', data: {}, errors: [] });
  reject(schema, { ...responseBase, status: 'APPLIED', data: { referenceId: 'canonical-1' }, errors: [makeError('FORBIDDEN')] });
});

test('FAILED requires at least one structured error and contains no success data', () => {
  const failed = { ...responseBase, status: 'FAILED', errors: [makeError('VERSION_CONFLICT')] };
  FailedResponseSchema.parse(failed);
  reject(FailedResponseSchema, { ...responseBase, status: 'FAILED', errors: [] });
  reject(FailedResponseSchema, { ...failed, data: { referenceId: 'canonical-1' } });
});

test('response union rejects inconsistent status-specific fields', () => {
  const schema = commandResponse(z.object({ referenceId: CanonicalIdSchema }).strict());
  assert.equal(schema.options.length, 3);
  reject(schema, { ...responseBase, status: 'DELIVERED', data: { referenceId: 'canonical-1' }, errors: [] });
  reject(ResponseEnvelopeSchema, { ...responseBase, status: 'ACCEPTED', errors: [] });
  AppliedResponseBaseSchema.parse({ ...responseBase, status: 'APPLIED', data: { referenceId: 'canonical-1' }, errors: [] });
});

test('idempotency scope includes organization + allowlisted command + key', () => {
  IdempotencyScopeSchema.parse({
    organizationId: 'org-synthetic-1',
    commandName: 'openPlacementCase',
    idempotencyKey: 'submission-synthetic-1:step:1',
  });
  reject(IdempotencyScopeSchema, { organizationId: 'org-synthetic-1', idempotencyKey: 'submission-synthetic-1:step:1' });
});

test('same semantic payload has same digest; different payload has different digest', async () => {
  const left = await idempotencyDigest({ b: 'x', a: 1 });
  const reordered = await idempotencyDigest({ a: 1, b: 'x' });
  const changed = await idempotencyDigest({ a: 2, b: 'x' });
  assert.equal(left, reordered);
  assert.notEqual(left, changed);
  assert.equal(canonicalize({ b: 2, a: 1 }), '{"a":1,"b":2}');
});

test('correlationId cannot replace required idempotencyKey', () => {
  const missing = request();
  delete missing.idempotencyKey;
  reject(RequestEnvelopeBaseSchema, missing);
});
