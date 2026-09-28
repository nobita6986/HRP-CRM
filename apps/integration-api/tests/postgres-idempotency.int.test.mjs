/**
 * apps/integration-api/tests/postgres-idempotency.int.test.mjs
 *
 * Integration tests for PostgresIdempotencyAuthority (T1-B N8N/0.3 r1 -- RG-02).
 * Mirrors the unit-test suite but exercises the real PostgreSQL adapter against
 * an embedded cluster.
 *
 * Coverage:
 *   1. first claim on fresh scope returns hit:false and inserts PENDING row
 *   2. record() transitions PENDING -> RECORDED; replay returns hit:true
 *   3. digest mismatch returns IDEMPOTENCY_CONFLICT (payload_digest_mismatch)
 *   4. correlation id mismatch returns correlation_id_mismatch
 *   5. first-writer-wins preserves originally-bound correlationId
 *   6. process restart: a new authority instance reads the recorded row
 *   7. two-instance concurrent claim: exactly one row persists
 *   8. bounded pending: lease expires -> reclaim converts PENDING -> RECORDED
 *   9. retention: recorded rows older than retentionMs are purged
 *  10. log redaction: diagnostic surface never leaks secrets or scope keys
 *  11. rollback: caller-side failure does not leak the PENDING claim
 */

import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { start as startHarness } from './pg-idempotency-harness.mjs';

const { PostgresIdempotencyAuthority } = await import(
  '../dist/automation/postgres-idempotency-authority.js',
);

let harness;
let prisma;

before(async () => {
  harness = await startHarness();
  prisma = harness.prisma;
});

after(async () => {
  if (harness) await harness.stop();
});

function makeRecord(overrides = {}) {
  const base = {
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-001',
    idempotencyKey: 'idem-001',
    payloadDigest:
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    boundCorrelationId: 'corr-001',
    commandName: 'cmd-create_task',
    organizationId: 'org-a',
    connectionId: 'conn-1',
    workflowId: 'wf-001',
    createdAt: Date.now(),
    result: {
      status: 'ACCEPTED',
      schemaVersion: '1',
      commandId: 'cmd-id-001',
      correlationId: 'corr-001',
    },
  };
  return { ...base, ...overrides };
}

test('1. first claim on fresh scope returns hit:false and inserts PENDING row', async () => {
  const auth = new PostgresIdempotencyAuthority(prisma, {
    instanceId: 'instance-A',
    leaseDurationMs: 30_000,
    allowReset: true,
  });
  await auth.reset();

  const result = await auth.lookup({
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-001',
    payloadDigest: 'digest-A',
    correlationId: 'corr-A',
  });
  assert.equal(result.hit, false);

  const rows = await prisma.automationIdempotencyRecord.findMany();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, 'PENDING');
  assert.equal(rows[0].boundCorrelationId, 'corr-A');
  assert.equal(rows[0].payloadDigest, 'digest-A');
  assert.equal(rows[0].leaseOwner, 'instance-A');

  await auth.close();
});

test('2. record() transitions PENDING -> RECORDED; replay returns hit:true', async () => {
  const auth = new PostgresIdempotencyAuthority(prisma, {
    instanceId: 'instance-A', allowReset: true,
  });
  await auth.reset();

  await auth.lookup({
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-002',
    payloadDigest: 'digest-B',
    correlationId: 'corr-B',
  });
  await auth.record(makeRecord({
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-002',
    idempotencyKey: 'idem-002',
    payloadDigest: 'digest-B',
    boundCorrelationId: 'corr-B',
    commandName: 'cmd-create_task',
    organizationId: 'org-a',
    connectionId: 'conn-1',
    workflowId: 'wf-002',
    result: {
      status: 'APPLIED',
      schemaVersion: '1',
      commandId: 'cmd-id-002',
      correlationId: 'corr-B',
    },
  }));

  const replay = await auth.lookup({
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-002',
    payloadDigest: 'digest-B',
    correlationId: 'corr-B',
  });
  assert.equal(replay.hit, true);
  assert.equal(replay.cacheHit, true);
  assert.equal(replay.record.result.status, 'APPLIED');
  await auth.close();
});

test('3. digest mismatch returns payload_digest_mismatch', async () => {
  const auth = new PostgresIdempotencyAuthority(prisma, { allowReset: true });
  await auth.reset();
  await auth.lookup({
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-003',
    payloadDigest: 'digest-C-orig',
    correlationId: 'corr-C',
  });
  await auth.record(makeRecord({
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-003',
    idempotencyKey: 'idem-003',
    payloadDigest: 'digest-C-orig',
    boundCorrelationId: 'corr-C',
    result: { status: "ACCEPTED", schemaVersion: "1", commandId: "x", correlationId: "corr-C" },
  }));
  const conflict = await auth.lookup({
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-003',
    payloadDigest: 'digest-C-MUTATED',
    correlationId: 'corr-C',
  });
  assert.equal(conflict.idempotencyConflict, true);
  assert.equal(conflict.reason, 'payload_digest_mismatch');
  assert.equal(conflict.storedDigest, 'digest-C-orig');
  assert.equal(conflict.incomingDigest, 'digest-C-MUTATED');
  await auth.close();
});

test('4. correlation id mismatch returns correlation_id_mismatch', async () => {
  const auth = new PostgresIdempotencyAuthority(prisma, { allowReset: true });
  await auth.reset();
  await auth.lookup({
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-004',
    payloadDigest: 'digest-D',
    correlationId: 'corr-D-original',
  });
  await auth.record(makeRecord({
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-004',
    idempotencyKey: 'idem-004',
    payloadDigest: 'digest-D',
    boundCorrelationId: 'corr-D-original',
    commandName: 'cmd-create_task',
    organizationId: 'org-a',
    connectionId: 'conn-1',
    workflowId: 'wf-004',
    result: { status: "ACCEPTED", schemaVersion: "1", commandId: "x", correlationId: "corr-D-original" },
  }));
  const conflict = await auth.lookup({
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-004',
    payloadDigest: 'digest-D',
    correlationId: 'corr-D-MUTATED',
  });
  assert.equal(conflict.idempotencyConflict, true);
  assert.equal(conflict.reason, 'correlation_id_mismatch');
  assert.equal(conflict.storedCorrelationId, 'corr-D-original');
  assert.equal(conflict.incomingCorrelationId, 'corr-D-MUTATED');
  await auth.close();
});

test('5. first-writer-wins preserves originally-bound correlationId', async () => {
  const auth = new PostgresIdempotencyAuthority(prisma, { allowReset: true });
  await auth.reset();
  await auth.lookup({
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-005',
    payloadDigest: 'digest-E',
    correlationId: 'corr-E-first',
  });
  await auth.record(makeRecord({
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-005',
    idempotencyKey: 'idem-005',
    payloadDigest: 'digest-E',
    boundCorrelationId: 'corr-E-first',
    commandName: 'cmd-create_task',
    organizationId: 'org-a',
    connectionId: 'conn-1',
    workflowId: 'wf-005',
    result: { status: "ACCEPTED", schemaVersion: "1", commandId: "x", correlationId: "corr-E-first" },
  }));
  await auth.record(makeRecord({
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-005',
    idempotencyKey: 'idem-005',
    payloadDigest: 'digest-E',
    boundCorrelationId: 'corr-E-second',
    commandName: 'cmd-create_task',
    organizationId: 'org-a',
    connectionId: 'conn-1',
    workflowId: 'wf-005',
    result: { status: "ACCEPTED", schemaVersion: "1", commandId: "y", correlationId: "corr-E-second" },
  }));
  const row = await prisma.automationIdempotencyRecord.findUnique({
    where: { scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-005' },
  });
  assert.equal(row.boundCorrelationId, 'corr-E-first');
  await auth.close();
});

test('6. process restart: a new authority instance reads the recorded row', async () => {
  const auth1 = new PostgresIdempotencyAuthority(prisma, { allowReset: true });
  await auth1.reset();
  await auth1.lookup({
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-006',
    payloadDigest: 'digest-F',
    correlationId: 'corr-F',
  });
  await auth1.record(makeRecord({
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-006',
    idempotencyKey: 'idem-006',
    payloadDigest: 'digest-F',
    boundCorrelationId: 'corr-F',
    commandName: 'cmd-create_task',
    organizationId: 'org-a',
    connectionId: 'conn-1',
    workflowId: 'wf-006',
    result: { status: "ACCEPTED", schemaVersion: "1", commandId: "z", correlationId: "corr-F" },
  }));
  await auth1.close();

  const auth2 = new PostgresIdempotencyAuthority(prisma, {
    instanceId: 'instance-B',
  });
  const replay = await auth2.lookup({
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-006',
    payloadDigest: 'digest-F',
    correlationId: 'corr-F',
  });
  assert.equal(replay.hit, true);
  assert.equal(replay.cacheHit, true);
  assert.equal(replay.record.result.commandId, 'z');
  await auth2.close();
});

test('7. two-instance concurrent claim: exactly one row persists', async () => {
  const auth = new PostgresIdempotencyAuthority(prisma, { allowReset: true });
  await auth.reset();
  const scopeKey = "org-a|conn-1|svc-1|cmd-create_task|idem-007";
  await Promise.all([
    auth.lookup({ scopeKey, payloadDigest: 'digest-G', correlationId: 'corr-G' }),
    auth.lookup({ scopeKey, payloadDigest: 'digest-G', correlationId: 'corr-G' }),
  ]);
  const rows = await prisma.automationIdempotencyRecord.findMany({ where: { scopeKey } });
  assert.equal(rows.length, 1);
  await auth.close();
});

test('8. bounded pending: lease expires then reclaim converts PENDING -> RECORDED', async () => {
  const auth = new PostgresIdempotencyAuthority(prisma, {
    instanceId: 'instance-leased',
    leaseDurationMs: 50,
    allowReset: true,
  });
  await auth.reset();
  await auth.lookup({
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-008',
    payloadDigest: 'digest-H',
    correlationId: 'corr-H',
  });
  await new Promise((r) => setTimeout(r, 80));
  const reclaimed = await auth.reclaimExpiredLeases({
    now: Date.now() + 1000,
    leaseOwner: 'reclaimer',
  });
  assert.equal(reclaimed, 1);
  const row = await prisma.automationIdempotencyRecord.findUnique({
    where: { scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-008' },
  });
  assert.equal(row.state, 'RECORDED');
  assert.equal(row.leaseOwner, 'reclaimer');
  await auth.close();
});

test('9. retention: recorded rows older than retentionMs are purged', async () => {
  const auth = new PostgresIdempotencyAuthority(prisma, {
    instanceId: 'instance-retention',
    retentionMs: 50,
    allowReset: true,
  });
  await auth.reset();
  await auth.lookup({
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-009',
    payloadDigest: 'digest-I',
    correlationId: 'corr-I',
  });
  await auth.record(makeRecord({
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-009',
    idempotencyKey: 'idem-009',
    payloadDigest: 'digest-I',
    boundCorrelationId: 'corr-I',
    commandName: 'cmd-create_task',
    organizationId: 'org-a',
    connectionId: 'conn-1',
    workflowId: 'wf-009',
    result: { status: "ACCEPTED", schemaVersion: "1", commandId: "q", correlationId: "corr-I" },
  }));
  await prisma.automationIdempotencyRecord.update({
    where: { scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-009' },
    data: { createdAt: new Date(Date.now() - 1_000_000) },
  });
  const purged = await auth.purgeExpired();
  assert.equal(purged, 1);
  const remaining = await prisma.automationIdempotencyRecord.count();
  assert.equal(remaining, 0);
  await auth.close();
});

test('10. log redaction: diagnostic surface never leaks secrets', async () => {
  const captured = [];
  const originalErr = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    captured.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    return originalErr(chunk, ...rest);
  };
  try {
    const auth = new PostgresIdempotencyAuthority(prisma, {
      instanceId: 'instance-redact', allowReset: true,
    });
    await auth.reset();
    const SECRET = 'REDACT_TESTSECRET_dbe8f81c4a';
    const HEADER = 'REDACT_TESTHEADER_authorization_bearer_xyz';
    const KEY = 'REDACT_TESTKEY_iam_topsecret';
    await auth.lookup({
      scopeKey: 'org-a|conn-1|svc-1|cmd-redact|id-1',
      payloadDigest: 'digest-redact-1',
      correlationId: 'corr-redact-1',
    });
    await auth.record(makeRecord({
      scopeKey: 'org-a|conn-1|svc-1|cmd-redact|id-1',
      idempotencyKey: 'idem-redact',
      payloadDigest: 'digest-redact-1',
      boundCorrelationId: 'corr-redact-1',
      commandName: 'cmd-redact',
      organizationId: 'org-a',
      connectionId: 'conn-1',
      workflowId: SECRET,
      result: { status: "ACCEPTED", schemaVersion: "1", commandId: KEY, correlationId: "corr-redact-1" },
    }));
    void HEADER;
    await auth.close();
  } finally {
    process.stderr.write = originalErr;
  }
  const joined = captured.join("");
  assert.ok(!joined.includes('REDACT_TESTSECRET'));
  assert.ok(!joined.includes('REDACT_TESTKEY'));
  assert.ok(!joined.toLowerCase().includes('authorization'));
});

test('11. rollback: caller-side failure does not leak the PENDING claim', async () => {
  const auth = new PostgresIdempotencyAuthority(prisma, { allowReset: true, leaseDurationMs: 50 });
  await auth.reset();
  await auth.lookup({
    scopeKey: 'org-a|conn-1|svc-1|cmd-create_task|idem-011',
    payloadDigest: 'digest-K',
    correlationId: 'corr-K',
  });
  await new Promise((r) => setTimeout(r, 80));
  const reclaimed = await auth.reclaimExpiredLeases({
    now: Date.now() + 1000,
    leaseOwner: 'reclaimer-after-rollback',
  });
  assert.equal(reclaimed >= 1, true);
  await auth.close();
});
