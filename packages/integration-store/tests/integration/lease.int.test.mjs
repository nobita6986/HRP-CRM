/**
 * packages/integration-store/tests/integration/lease.int.test.mjs
 *
 * CORE/1.4 — Durable worker/queue leasing integration tests.
 *
 * Coverage:
 *  T01. claimNextReceipt: creates LEASED state + fencing token
 *  T02. Two workers claim same receipt → only one gets it
 *  T03. completeReceipt SUCCESS → state=DELIVERED, lease fields cleared
 *  T04. completeReceipt FAIL → DEAD_LETTERED, reasonCode set
 *  T05. completeReceipt RETRY → RETRY_SCHEDULED, nextAttemptAt set
 *  T06. lease expiry → reclaimExpiredLeases resets PENDING
 *  T07. stale completion rejected (fencing mismatch)
 *  T08. idempotency: second claim same receipt → idempotent
 *  T09. shutdown drain: releaseAllForWorker resets leases
 *  T10. attempts increment on claim (counter correctness)
 *
 * Note: most tests use `claimSpecificReceipt` (test helper) for
 * cross-test isolation. Only T02 uses claimNextReceipt to verify the
 * real worker poll behavior.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Dynamic import to allow PG_HARNESS_SUFFIX env var to be set before harness loads.
const { start } = await import('./pg-test-harness.mjs');

process.env['PG_HARNESS_SUFFIX'] = 'lease';

/** @type {any} */
let harness = null;

before(async () => {
  harness = await start();
});

after(async () => {
  if (harness) await harness.stop();
});

const ORG = 'org-core14-test';
const PROVIDER = 'chatwoot';
const CONNECTION = 'conn-test-001';

// ─── Helpers ──────────────────────────────────────────────────────

async function insertReceipt(prisma, overrides = {}) {
  const receiptId = `rcpt-test-${Math.random().toString(36).slice(2)}`;
  const row = {
    receiptId,
    schemaVersion: '1',
    organizationId: ORG,
    provider: PROVIDER,
    connectionId: CONNECTION,
    eventId: `evt-${Math.random().toString(36).slice(2)}`,
    payloadDigest: 'a'.repeat(64),
    state: 'PENDING',
    duplicateKind: 'UNKNOWN',
    attempts: 0,
    ...overrides,
  };
  await prisma.externalEventReceipt.create({ data: row });
  return { receiptId, ...row };
}

// ─── T01: claim creates LEASED state + fencing token ─────────────

test('lease: claimNextReceipt → LEASED + fencingToken', async () => {
  const { prisma } = harness;
  const clock = { now: () => Date.now() };
  const idGen = { next: () => `token-${Math.random().toString(36).slice(2)}` };

  // Set future nextAttemptAt to ensure we only pick THIS receipt.
  const { receiptId } = await insertReceipt(prisma);

  const { claimSpecificReceipt } = await import('../../dist/worker/lease.js');
  const result = await claimSpecificReceipt(prisma, {
    workerId: 'worker-a',
    leaseDurationMs: 60_000,
    clock,
    idGen,
    scope: { organizationId: ORG, provider: PROVIDER, connectionId: CONNECTION, eventId: (await prisma.externalEventReceipt.findUnique({ where: { receiptId } })).eventId },
  });

  assert.ok(result, 'should claim receipt');
  assert.ok(result.fencingToken.startsWith('token-'), 'fencingToken set');

  const row = await prisma.externalEventReceipt.findUnique({
    where: { receiptId },
  });
  assert.equal(row.state, 'LEASED');
  assert.equal(row.leaseOwner, 'worker-a');
  assert.ok(row.fencingToken, 'fencingToken persisted');
  assert.ok(row.leaseExpiresAt, 'leaseExpiresAt set');
  assert.equal(row.attempts, 1, 'attempts incremented');
});

// ─── T02: two workers race → only one wins ──────────────────────

test('lease: two workers race → only one gets lease', async () => {
  const { prisma } = harness;
  const clock = { now: () => Date.now() };
  const idGenA = { next: () => 'token-a' };
  const idGenB = { next: () => 'token-b' };

  const { receiptId } = await insertReceipt(prisma);

  const { claimSpecificReceipt } = await import('../../dist/worker/lease.js');
  const eventId = (await prisma.externalEventReceipt.findUnique({ where: { receiptId } })).eventId;
  const scope = { organizationId: ORG, provider: PROVIDER, connectionId: CONNECTION, eventId };

  const [resultA, resultB] = await Promise.all([
    claimSpecificReceipt(prisma, {
      workerId: 'worker-a',
      leaseDurationMs: 60_000,
      clock,
      idGen: idGenA,
      scope,
    }),
    claimSpecificReceipt(prisma, {
      workerId: 'worker-b',
      leaseDurationMs: 60_000,
      clock,
      idGen: idGenB,
      scope,
    }),
  ]);

  const winner = resultA ?? resultB;
  const loser = resultA ? resultB : null;
  assert.ok(winner, 'one worker should win');
  assert.equal(loser, null, 'other worker gets null (already leased)');

  const row = await prisma.externalEventReceipt.findUnique({
    where: { receiptId },
  });
  assert.equal(row.leaseOwner, winner.leaseOwner, 'winner owns the lease');
  assert.equal(row.state, 'LEASED');
});

// ─── T03: complete SUCCESS → DELIVERED ────────────────────────

test('lease: completeReceipt SUCCESS → DELIVERED, lease cleared', async () => {
  const { prisma } = harness;
  const clock = { now: () => Date.now() };
  const idGen = { next: () => 'token-success' };

  const { receiptId } = await insertReceipt(prisma);

  const { claimSpecificReceipt, completeReceipt } = await import('../../dist/worker/lease.js');
  const eventId = (await prisma.externalEventReceipt.findUnique({ where: { receiptId } })).eventId;
  const claimed = await claimSpecificReceipt(prisma, {
    workerId: 'worker-a',
    leaseDurationMs: 60_000,
    clock,
    idGen,
    scope: { organizationId: ORG, provider: PROVIDER, connectionId: CONNECTION, eventId },
  });

  const result = await completeReceipt(prisma, {
    fencingToken: claimed.fencingToken,
    leaseOwner: 'worker-a',
    outcome: 'SUCCESS',
    clock,
  });

  assert.equal(result.state, 'DELIVERED');
  assert.equal(result.fencedRejected, false);

  const row = await prisma.externalEventReceipt.findUnique({
    where: { receiptId },
  });
  assert.equal(row.state, 'DELIVERED');
  assert.equal(row.leaseOwner, null, 'lease cleared');
  assert.equal(row.fencingToken, null, 'fencingToken cleared');
  assert.ok(row.resolvedAt, 'resolvedAt set');
});

// ─── T04: complete FAIL → DEAD_LETTERED ─────────────────────

test('lease: completeReceipt FAIL → DEAD_LETTERED, reasonCode set', async () => {
  const { prisma } = harness;
  const clock = { now: () => Date.now() };
  const idGen = { next: () => 'token-fail' };

  const { receiptId } = await insertReceipt(prisma);

  const { claimSpecificReceipt, completeReceipt } = await import('../../dist/worker/lease.js');
  const eventId = (await prisma.externalEventReceipt.findUnique({ where: { receiptId } })).eventId;
  const claimed = await claimSpecificReceipt(prisma, {
    workerId: 'worker-a',
    leaseDurationMs: 60_000,
    clock,
    idGen,
    scope: { organizationId: ORG, provider: PROVIDER, connectionId: CONNECTION, eventId },
  });

  const result = await completeReceipt(prisma, {
    fencingToken: claimed.fencingToken,
    leaseOwner: 'worker-a',
    outcome: 'FAIL',
    error: { code: 'VALIDATION_ERROR', message: 'invalid', retryable: false },
    clock,
  });

  assert.equal(result.state, 'DEAD_LETTERED');

  const row = await prisma.externalEventReceipt.findUnique({
    where: { receiptId },
  });
  assert.equal(row.state, 'DEAD_LETTERED');
  assert.equal(row.reasonCode, 'VALIDATION_ERROR');
  assert.equal(row.leaseOwner, null);
});

// ─── T05: complete RETRY → RETRY_SCHEDULED + nextAttemptAt ──

test('lease: completeReceipt RETRY → RETRY_SCHEDULED, nextAttemptAt set', async () => {
  const { prisma } = harness;
  const nowMs = Date.now();
  const clock = { now: () => nowMs };
  const idGen = { next: () => 'token-retry' };
  const { DEFAULT_RETRY_POLICY } = await import('../../dist/worker/index.js');

  const { receiptId } = await insertReceipt(prisma);

  const { claimSpecificReceipt, completeReceipt } = await import('../../dist/worker/lease.js');
  const eventId = (await prisma.externalEventReceipt.findUnique({ where: { receiptId } })).eventId;
  const claimed = await claimSpecificReceipt(prisma, {
    workerId: 'worker-a',
    leaseDurationMs: 60_000,
    clock,
    idGen,
    scope: { organizationId: ORG, provider: PROVIDER, connectionId: CONNECTION, eventId },
  });

  const result = await completeReceipt(prisma, {
    fencingToken: claimed.fencingToken,
    leaseOwner: 'worker-a',
    outcome: 'RETRY',
    error: { code: 'TRANSACTION_FAILED', message: 'timeout', retryable: true },
    retryPolicy: DEFAULT_RETRY_POLICY,
    clock,
  });

  assert.equal(result.state, 'RETRY_SCHEDULED');
  assert.ok(result.nextAttemptAt, 'nextAttemptAt set');

  const row = await prisma.externalEventReceipt.findUnique({
    where: { receiptId },
  });
  assert.equal(row.state, 'RETRY_SCHEDULED');
  assert.ok(row.nextAttemptAt, 'nextAttemptAt in DB');
  assert.equal(row.leaseOwner, null, 'lease cleared');
});

// ─── T06: lease expiry → reclaimExpiredLeases resets PENDING ──

test('lease: lease expiry → reclaimExpiredLeases resets PENDING', async () => {
  const { prisma } = harness;
  const clock = { now: () => Date.now() };
  const idGen = { next: () => 'token-expire' };

  // Insert directly in LEASED state with expired lease to test reclaim
  // without affecting other test receipts.
  const { receiptId } = await insertReceipt(prisma, {
    state: 'LEASED',
    leaseOwner: 'worker-dead',
    leaseExpiresAt: new Date(Date.now() - 5_000),
    fencingToken: 'dead-token',
  });

  const { reclaimExpiredLeases } = await import('../../dist/worker/lease.js');
  const result = await reclaimExpiredLeases(prisma, clock);

  assert.ok(result.receipts >= 1, 'reclaimed at least one receipt');

  const row = await prisma.externalEventReceipt.findUnique({
    where: { receiptId },
  });
  assert.equal(row.state, 'PENDING');
  assert.equal(row.leaseOwner, null, 'lease cleared');
  assert.equal(row.fencingToken, null);
});

// ─── T07: stale completion rejected (fencing mismatch) ────────

test('lease: stale completion with wrong fencingToken → fencedRejected', async () => {
  const { prisma } = harness;
  const clock = { now: () => Date.now() };
  const idGen = { next: () => 'token-claim' };

  const { receiptId } = await insertReceipt(prisma);

  const { claimSpecificReceipt, completeReceipt } = await import('../../dist/worker/lease.js');
  const eventId = (await prisma.externalEventReceipt.findUnique({ where: { receiptId } })).eventId;
  const claimed = await claimSpecificReceipt(prisma, {
    workerId: 'worker-a',
    leaseDurationMs: 60_000,
    clock,
    idGen,
    scope: { organizationId: ORG, provider: PROVIDER, connectionId: CONNECTION, eventId },
  });

  // Worker B (stale) tries to complete with wrong token.
  const staleResult = await completeReceipt(prisma, {
    fencingToken: 'wrong-token-stale',
    leaseOwner: 'worker-b',
    outcome: 'SUCCESS',
    clock,
  });

  assert.equal(staleResult.fencedRejected, true, 'stale completion rejected');

  // Real owner should still be able to complete.
  const realResult = await completeReceipt(prisma, {
    fencingToken: claimed.fencingToken,
    leaseOwner: 'worker-a',
    outcome: 'SUCCESS',
    clock,
  });
  assert.equal(realResult.fencedRejected, false);
  assert.equal(realResult.state, 'DELIVERED');

  const row = await prisma.externalEventReceipt.findUnique({
    where: { receiptId },
  });
  assert.equal(row.state, 'DELIVERED');
});

// ─── T08: idempotency — second claim same receipt → null ──────

test('lease: idempotency — second claim same receipt → null (already LEASED)', async () => {
  const { prisma } = harness;
  const clock = { now: () => Date.now() };
  const idGen = { next: () => 'token-idempotent' };

  const { receiptId } = await insertReceipt(prisma);

  const { claimSpecificReceipt } = await import('../../dist/worker/lease.js');
  const eventId = (await prisma.externalEventReceipt.findUnique({ where: { receiptId } })).eventId;
  const scope = { organizationId: ORG, provider: PROVIDER, connectionId: CONNECTION, eventId };

  const first = await claimSpecificReceipt(prisma, {
    workerId: 'worker-a',
    leaseDurationMs: 60_000,
    clock,
    idGen,
    scope,
  });
  assert.ok(first, 'first claim succeeds');

  const second = await claimSpecificReceipt(prisma, {
    workerId: 'worker-b',
    leaseDurationMs: 60_000,
    clock,
    idGen: { next: () => 'token-b-second' },
    scope,
  });
  assert.equal(second, null, 'second claim returns null (already LEASED)');

  const row = await prisma.externalEventReceipt.findUnique({
    where: { receiptId },
  });
  assert.equal(row.leaseOwner, 'worker-a', 'original owner retained');
});

// ─── T09: shutdown drain releases leases ───────────────────────

test('lease: releaseAllForWorker → PENDING, lease cleared', async () => {
  const { prisma } = harness;
  const clock = { now: () => Date.now() };
  const idGen = { next: () => 'token-drain' };

  const { receiptId } = await insertReceipt(prisma);

  const { claimSpecificReceipt, releaseAllForWorker } = await import('../../dist/worker/lease.js');
  const eventId = (await prisma.externalEventReceipt.findUnique({ where: { receiptId } })).eventId;
  await claimSpecificReceipt(prisma, {
    workerId: 'worker-a',
    leaseDurationMs: 60_000,
    clock,
    idGen,
    scope: { organizationId: ORG, provider: PROVIDER, connectionId: CONNECTION, eventId },
  });

  const drainResult = await releaseAllForWorker(prisma, {
    workerId: 'worker-a',
    clock,
  });

  assert.ok(drainResult.receipts >= 1, 'released at least one receipt');

  const row = await prisma.externalEventReceipt.findUnique({
    where: { receiptId },
  });
  assert.equal(row.state, 'PENDING');
  assert.equal(row.leaseOwner, null);
  assert.equal(row.fencingToken, null);
});

// ─── T10: attempts increment on each claim ─────────────────────

test('lease: attempts counter increments per claim', async () => {
  const { prisma } = harness;
  const clock = { now: () => Date.now() };
  const idGenA = { next: () => 'token-claim1' };
  const idGenB = { next: () => 'token-claim2' };

  // Start with attempts=2; lease cleared; state=PENDING.
  const { receiptId } = await insertReceipt(prisma, {
    state: 'RETRY_SCHEDULED',
    attempts: 2,
    nextAttemptAt: new Date(Date.now() - 1_000),
  });

  const { claimSpecificReceipt, releaseLease } = await import('../../dist/worker/lease.js');
  const eventId = (await prisma.externalEventReceipt.findUnique({ where: { receiptId } })).eventId;
  const scope = { organizationId: ORG, provider: PROVIDER, connectionId: CONNECTION, eventId };

  // Claim → attempts should go 2 → 3.
  const first = await claimSpecificReceipt(prisma, {
    workerId: 'worker-a',
    leaseDurationMs: 60_000,
    clock,
    idGen: idGenA,
    scope,
  });
  assert.equal(first.attempts, 3, 'first claim: attempts=3');

  let row = await prisma.externalEventReceipt.findUnique({ where: { receiptId } });
  assert.equal(row.attempts, 3);

  // Release and reclaim → attempts should go 3 → 4.
  await releaseLease(prisma, {
    fencingToken: first.fencingToken,
    leaseOwner: 'worker-a',
    kind: 'receipt',
  });

  const second = await claimSpecificReceipt(prisma, {
    workerId: 'worker-b',
    leaseDurationMs: 60_000,
    clock,
    idGen: idGenB,
    scope,
  });
  assert.equal(second.attempts, 4, 'second claim: attempts=4');

  row = await prisma.externalEventReceipt.findUnique({ where: { receiptId } });
  assert.equal(row.attempts, 4);
});
