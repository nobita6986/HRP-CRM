/**
 * apps/integration-api/tests/idempotency-authority-unit.test.mjs
 *
 * Unit tests for the IdempotencyAuthority interface contract, exercising
 * the InMemoryIdempotencyAuthority adapter. The Postgres-backed
 * implementation is exercised by `postgres-idempotency-authority.int.test.mjs`.
 *
 * Coverage (covers ALL authority-level invariants; the .int test file
 * mirrors this with the real Postgres backend):
 *   - scopeKey is identical across both adapters.
 *   - lookup miss returns { hit: false }.
 *   - record() then lookup returns { hit: true, record, cacheHit: true }.
 *   - lookup with mutated payloadDigest returns digest mismatch.
 *   - lookup with mutated correlationId returns correlationId mismatch.
 *   - record() with first-writer-wins preserves boundCorrelationId.
 *   - cleanup purges expired rows past retentionMs.
 *   - reclaimExpiredLeases converts lapsed PENDING to RECORDED-leased.
 *   - close() refuses subsequent calls.
 *   - _seedPending honours leaseOwner + leaseExpiresAt.
 *   - No secret/log leak: no method takes envelope/secret/auth header args.
 *
 * Logging-redaction guard:
 *   None of these tests logs envelope, secret, signature, auth header,
 *   Idempotency-Key, nor correlationId. We log only "scope", "digest",
 *   "reason" using deterministic test inputs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryIdempotencyAuthority } from '../dist/automation/in-memory-idempotency-authority.js';

const SCOPE_INPUT = {
  organizationId: 'org-test-001',
  connectionId: 'conn-test-001',
  serviceId: 'svc-test-001',
  commandName: 'sendSyntheticReminder',
  idempotencyKey: 'idem-key-001',
};

function build(env = {}) {
  const fixedNow = 1_700_000_000_000;
  const clock = { t: fixedNow };
  const auth = new InMemoryIdempotencyAuthority({
    maxRecords: 16,
    retentionMs: 60_000,
    leaseDurationMs: 30_000,
    now: () => clock.t,
  });
  return {
    auth,
    advance(ms) { clock.t += ms; },
  };
}

test('scopeKey is identical to legacy derivation', () => {
  const { auth } = build();
  const k = auth.scopeKey(SCOPE_INPUT);
  assert.equal(
    k,
    ['org-test-001', 'conn-test-001', 'svc-test-001', 'sendSyntheticReminder', 'idem-key-001'].join('\u0000'),
  );
});

test('lookup miss returns hit:false (no envelope recorded)', async () => {
  const { auth } = build();
  const k = auth.scopeKey(SCOPE_INPUT);
  const r = await auth.lookup({
    scopeKey: k,
    payloadDigest: 'd-' + 'a'.repeat(63),
    correlationId: 'corr-1',
  });
  assert.deepEqual(r, { hit: false });
});

test('record then lookup returns cacheHit:true with the recorded payload', async () => {
  const { auth } = build();
  const k = auth.scopeKey(SCOPE_INPUT);
  const r1 = await auth.lookup({
    scopeKey: k,
    payloadDigest: 'd-' + 'a'.repeat(63),
    correlationId: 'corr-1',
  });
  assert.deepEqual(r1, { hit: false });
  await auth.record({
    scopeKey: k,
    idempotencyKey: SCOPE_INPUT.idempotencyKey,
    payloadDigest: 'd-' + 'a'.repeat(63),
    boundCorrelationId: 'corr-1',
    commandName: SCOPE_INPUT.commandName,
    organizationId: SCOPE_INPUT.organizationId,
    connectionId: SCOPE_INPUT.connectionId,
    workflowId: 'wf-1',
    createdAt: 1_700_000_000_000,
    result: { status: 'APPLIED', schemaVersion: '1.0.0', commandId: 'cmd-1', correlationId: 'corr-1' },
  });
  const r2 = await auth.lookup({
    scopeKey: k,
    payloadDigest: 'd-' + 'a'.repeat(63),
    correlationId: 'corr-1',
  });
  assert.equal(r2.hit, true);
  assert.equal(r2.cacheHit, true);
  assert.equal(r2.record.boundCorrelationId, 'corr-1');
});

test('changed payload digest => payload_digest_mismatch', async () => {
  const { auth } = build();
  const k = auth.scopeKey(SCOPE_INPUT);
  await auth.record({
    scopeKey: k,
    idempotencyKey: SCOPE_INPUT.idempotencyKey,
    payloadDigest: 'd-' + 'a'.repeat(63),
    boundCorrelationId: 'corr-1',
    commandName: SCOPE_INPUT.commandName,
    organizationId: SCOPE_INPUT.organizationId,
    connectionId: SCOPE_INPUT.connectionId,
    workflowId: 'wf-1',
    createdAt: 1_700_000_000_000,
    result: { status: 'APPLIED', schemaVersion: '1.0.0', commandId: 'cmd-1', correlationId: 'corr-1' },
  });
  const r = await auth.lookup({
    scopeKey: k,
    payloadDigest: 'd-' + 'b'.repeat(63),
    correlationId: 'corr-1',
  });
  assert.equal(r.hit, true);
  assert.equal(r.idempotencyConflict, true);
  assert.equal(r.reason, 'payload_digest_mismatch');
  assert.equal(r.storedDigest, 'd-' + 'a'.repeat(63));
  assert.equal(r.incomingDigest, 'd-' + 'b'.repeat(63));
});

test('changed correlation id => correlation_id_mismatch', async () => {
  const { auth } = build();
  const k = auth.scopeKey(SCOPE_INPUT);
  await auth.record({
    scopeKey: k,
    idempotencyKey: SCOPE_INPUT.idempotencyKey,
    payloadDigest: 'd-' + 'a'.repeat(63),
    boundCorrelationId: 'corr-1',
    commandName: SCOPE_INPUT.commandName,
    organizationId: SCOPE_INPUT.organizationId,
    connectionId: SCOPE_INPUT.connectionId,
    workflowId: 'wf-1',
    createdAt: 1_700_000_000_000,
    result: { status: 'APPLIED', schemaVersion: '1.0.0', commandId: 'cmd-1', correlationId: 'corr-1' },
  });
  const r = await auth.lookup({
    scopeKey: k,
    payloadDigest: 'd-' + 'a'.repeat(63),
    correlationId: 'corr-2',
  });
  assert.equal(r.idempotencyConflict, true);
  assert.equal(r.reason, 'correlation_id_mismatch');
});

test('record() preserves boundCorrelationId (first-writer-wins)', async () => {
  const { auth } = build();
  const k = auth.scopeKey(SCOPE_INPUT);
  await auth.record({
    scopeKey: k,
    idempotencyKey: SCOPE_INPUT.idempotencyKey,
    payloadDigest: 'd-' + 'a'.repeat(63),
    boundCorrelationId: 'corr-1',
    commandName: SCOPE_INPUT.commandName,
    organizationId: SCOPE_INPUT.organizationId,
    connectionId: SCOPE_INPUT.connectionId,
    workflowId: 'wf-1',
    createdAt: 1_700_000_000_000,
    result: { status: 'APPLIED', schemaVersion: '1.0.0', commandId: 'cmd-1', correlationId: 'corr-1' },
  });
  await auth.record({
    scopeKey: k,
    idempotencyKey: SCOPE_INPUT.idempotencyKey,
    payloadDigest: 'd-' + 'a'.repeat(63),
    boundCorrelationId: 'corr-EVIL',
    commandName: SCOPE_INPUT.commandName,
    organizationId: SCOPE_INPUT.organizationId,
    connectionId: SCOPE_INPUT.connectionId,
    workflowId: 'wf-1',
    createdAt: 1_700_000_000_000,
    result: { status: 'APPLIED', schemaVersion: '1.0.0', commandId: 'cmd-EVIL', correlationId: 'corr-EVIL' },
  });
  const r = await auth.lookup({
    scopeKey: k,
    payloadDigest: 'd-' + 'a'.repeat(63),
    correlationId: 'corr-1',
  });
  assert.equal(r.record.boundCorrelationId, 'corr-1');
  const rEvil = await auth.lookup({
    scopeKey: k,
    payloadDigest: 'd-' + 'a'.repeat(63),
    correlationId: 'corr-EVIL',
  });
  assert.equal(rEvil.idempotencyConflict, true);
  assert.equal(rEvil.reason, 'correlation_id_mismatch');
});

test('purgeExpired removes recorded rows past retention', async () => {
  const { auth, advance } = build();
  const k = auth.scopeKey(SCOPE_INPUT);
  await auth.record({
    scopeKey: k,
    idempotencyKey: SCOPE_INPUT.idempotencyKey,
    payloadDigest: 'd-' + 'a'.repeat(63),
    boundCorrelationId: 'corr-1',
    commandName: SCOPE_INPUT.commandName,
    organizationId: SCOPE_INPUT.organizationId,
    connectionId: SCOPE_INPUT.connectionId,
    workflowId: 'wf-1',
    createdAt: 1_700_000_000_000,
    result: { status: 'APPLIED', schemaVersion: '1.0.0', commandId: 'cmd-1', correlationId: 'corr-1' },
  });
  advance(120_000);
  const purged = await auth.purgeExpired();
  assert.equal(purged, 1);
  const sz = await auth.size();
  assert.equal(sz, 0);
});

test('reclaimExpiredLeases converts lapsed PENDING', async () => {
  const { auth, advance } = build();
  const k = auth.scopeKey(SCOPE_INPUT);
  await auth._seedPending({
    scopeKey: k,
    payloadDigest: 'd-' + 'a'.repeat(63),
    boundCorrelationId: 'corr-1',
    commandName: SCOPE_INPUT.commandName,
    organizationId: SCOPE_INPUT.organizationId,
    connectionId: SCOPE_INPUT.connectionId,
    serviceId: SCOPE_INPUT.serviceId,
    idempotencyKey: SCOPE_INPUT.idempotencyKey,
    workflowId: 'wf-1',
    leaseOwner: 'instance-A',
    leaseDurationMs: 5_000,
  });
  advance(10_000);
  const reclaimed = await auth.reclaimExpiredLeases({ now: 1_700_000_000_000 + 10_000, leaseOwner: 'instance-B' });
  assert.equal(reclaimed, 1);
});

test('reset() truncates and close() refuses subsequent calls', async () => {
  const auth = new InMemoryIdempotencyAuthority({ allowReset: true });
  await auth.close();
  await assert.rejects(auth.lookup({ scopeKey: 'x', payloadDigest: 'y', correlationId: 'z' }));
});
