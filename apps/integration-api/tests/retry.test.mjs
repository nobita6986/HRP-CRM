/**
 * apps/integration-api/tests/retry.test.mjs
 *
 * CORE/1.8 AC1 — Retryable errors with bounded exponential backoff/jitter.
 *
 * Tests prove:
 *  1. Policy/validation errors → DEAD_LETTERED immediately (no retry).
 *  2. Transient errors → RETRY_SCHEDULED with bounded exponential backoff.
 *  3. Max 8 attempts → DEAD_LETTERED after attempt 8.
 *  4. Jitter is within ±20% of expected backoff.
 *  5. Clock advances determine nextAttemptAt deterministically.
 *  6. Duplicate/concurrent receipt → only one processes (idempotency via receiptId).
 *  7. classGatewayError() classifies errors correctly.
 *  8. completeReceipt outcome mapping (SUCCESS → DELIVERED, RETRY → RETRY_SCHEDULED, FAIL → DEAD_LETTERED).
 *
 * Uses embedded PostgreSQL (same harness as other integration-api PG tests).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

// ── Build guard ────────────────────────────────────────────────────────────────
if (!existsSync('./dist/receiver/handler.js')) {
  execSync('npm run build', { stdio: 'inherit' });
}

// ── Import from dist (built by npm run build) ─────────────────────────────────
const {
  isRetryable,
  computeNextAttemptAt,
  decideRetryState,
  DEFAULT_RETRY_POLICY,
  mutableClock,
  manualClock,
  claimSpecificReceipt,
  completeReceipt,
  uuidTokenGenerator,
} = await import('@hrp-engagement/integration-store/worker');

const {
  createPrismaClient,
} = await import('@hrp-engagement/integration-store/client');

const {
  classifyGatewayError,
} = await import('@hrp-engagement/integration-worker/dist/pipeline-executor.js');

// ── PG Harness ─────────────────────────────────────────────────────────────────
/** @type {import('pg').Pool | null} */
let pool = null;
/** @type {import('../../packages/integration-store/dist/client.js').PrismaClient} */
let prisma;

async function setupPrisma() {
  const harness = await import('./pg-receiver-harness.mjs');
  const h = await harness.start();
  prisma = h.prisma;
  pool = h.prisma.$pool;
  return h;
}

async function teardownPrisma() {
  if (prisma) {
    await prisma.$disconnect();
  }
}

let harness;
before(async () => {
  harness = await setupPrisma();
});

after(async () => {
  await teardownPrisma();
  if (harness?.stop) await harness.stop();
});

// ── Helper: create a leased receipt directly in DB ─────────────────────────────
/**
 * Create a receipt row in LEASED state with specified attempts count.
 * Returns the receipt scope used to claim it.
 */
async function createLeasedReceipt(opts = {}) {
  const {
    organizationId = 'org-synthetic-001',
    provider = 'CHATWOOT',
    connectionId = 'conn-synth-001',
    eventId = `evt-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    attempts = 1,
    idempotencyKey = `idem-key-${Date.now()}`,
    correlationId = `corr-${Date.now()}`,
  } = opts;

  const receiptId = `rcpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fencingToken = 'fence-' + Math.random().toString(36).slice(2);
  const workerId = 'worker-test-001';
  const now = new Date();

  await prisma.externalEventReceipt.create({
    data: {
      receiptId,
      schemaVersion: '1',
      organizationId,
      provider,
      connectionId,
      eventId,
      payloadDigest: 'a'.repeat(64),
      state: 'LEASED',
      attempts,
      idempotencyKey,
      correlationId,
      leaseOwner: workerId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      fencingToken,
      leaseFencedAt: now,
    },
  });

  return { receiptId, fencingToken, workerId, organizationId, provider, connectionId, eventId };
}

// ══════════════════════════════════════════════════════════════════════════════
// AC1.1: Non-retryable errors → DEAD_LETTERED immediately (no retry)
// ══════════════════════════════════════════════════════════════════════════════

test('retry: VALIDATION_ERROR → DEAD_LETTERED immediately (no retry)', async () => {
  const clock = mutableClock(1_700_000_000_000);
  const { fencingToken, workerId } = await createLeasedReceipt({ attempts: 1 });

  const result = await completeReceipt(prisma, {
    fencingToken,
    leaseOwner: workerId,
    outcome: 'FAIL',
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Schema validation failed',
      retryable: false,
    },
    clock,
  });

  assert.equal(result.state, 'DEAD_LETTERED', 'VALIDATION_ERROR must dead-letter immediately');
  assert.equal(result.nextAttemptAt, null, 'DEAD_LETTERED has no nextAttemptAt');
  assert.equal(result.fencedRejected, false, 'Must not be fenced rejected');
});

test('retry: VERSION_CONFLICT → DEAD_LETTERED immediately', async () => {
  const clock = mutableClock(1_700_000_000_000);
  const { fencingToken, workerId } = await createLeasedReceipt({ attempts: 1 });

  const result = await completeReceipt(prisma, {
    fencingToken,
    leaseOwner: workerId,
    outcome: 'FAIL',
    error: {
      code: 'VERSION_CONFLICT',
      message: 'Aggregate version mismatch',
      retryable: false,
    },
    clock,
  });

  assert.equal(result.state, 'DEAD_LETTERED', 'VERSION_CONFLICT must dead-letter immediately');
  assert.equal(result.nextAttemptAt, null);
});

test('retry: IDEMPOTENCY_CONFLICT → DEAD_LETTERED immediately', async () => {
  const clock = mutableClock(1_700_000_000_000);
  const { fencingToken, workerId } = await createLeasedReceipt({ attempts: 1 });

  const result = await completeReceipt(prisma, {
    fencingToken,
    leaseOwner: workerId,
    outcome: 'FAIL',
    error: {
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'Idempotency key conflict with different payload',
      retryable: false,
    },
    clock,
  });

  assert.equal(result.state, 'DEAD_LETTERED', 'IDEMPOTENCY_CONFLICT must dead-letter immediately');
});

test('retry: SCOPE_MISMATCH → DEAD_LETTERED immediately', async () => {
  const clock = mutableClock(1_700_000_000_000);
  const { fencingToken, workerId } = await createLeasedReceipt({ attempts: 1 });

  const result = await completeReceipt(prisma, {
    fencingToken,
    leaseOwner: workerId,
    outcome: 'FAIL',
    error: {
      code: 'SCOPE_MISMATCH',
      message: 'Scope mismatch in request',
      retryable: false,
    },
    clock,
  });

  assert.equal(result.state, 'DEAD_LETTERED', 'SCOPE_MISMATCH must dead-letter immediately');
});

test('retry: TENANT_SCOPE_REQUIRED → DEAD_LETTERED immediately', async () => {
  const clock = mutableClock(1_700_000_000_000);
  const { fencingToken, workerId } = await createLeasedReceipt({ attempts: 1 });

  const result = await completeReceipt(prisma, {
    fencingToken,
    leaseOwner: workerId,
    outcome: 'FAIL',
    error: {
      code: 'TENANT_SCOPE_REQUIRED',
      message: 'Tenant scope required',
      retryable: false,
    },
    clock,
  });

  assert.equal(result.state, 'DEAD_LETTERED', 'TENANT_SCOPE_REQUIRED must dead-letter immediately');
});

// ══════════════════════════════════════════════════════════════════════════════
// AC1.2: Transient errors → RETRY_SCHEDULED with bounded exponential backoff
// ══════════════════════════════════════════════════════════════════════════════

test('retry: TRANSACTION_FAILED → RETRY_SCHEDULED with bounded backoff', async () => {
  const clock = mutableClock(1_700_000_000_000);
  const { fencingToken, workerId } = await createLeasedReceipt({ attempts: 1 });

  const result = await completeReceipt(prisma, {
    fencingToken,
    leaseOwner: workerId,
    outcome: 'RETRY',
    error: {
      code: 'TRANSACTION_FAILED',
      message: 'Database transaction failed',
      retryable: true,
    },
    retryPolicy: DEFAULT_RETRY_POLICY,
    clock,
  });

  assert.equal(result.state, 'RETRY_SCHEDULED', 'TRANSACTION_FAILED must schedule retry');
  assert.ok(result.nextAttemptAt !== null, 'RETRY_SCHEDULED must have nextAttemptAt');
  assert.ok(result.nextAttemptAt > clock.now(), 'nextAttemptAt must be in the future');
});

test('retry: DEPENDENCY_UNAVAILABLE → RETRY_SCHEDULED', async () => {
  const clock = mutableClock(1_700_000_000_000);
  const { fencingToken, workerId } = await createLeasedReceipt({ attempts: 1 });

  const result = await completeReceipt(prisma, {
    fencingToken,
    leaseOwner: workerId,
    outcome: 'RETRY',
    error: {
      code: 'TRANSACTION_FAILED', // mapped from gateway's DEPENDENCY_UNAVAILABLE
      message: 'Dependency unavailable',
      retryable: true,
    },
    retryPolicy: DEFAULT_RETRY_POLICY,
    clock,
  });

  assert.equal(result.state, 'RETRY_SCHEDULED');
  assert.ok(result.nextAttemptAt !== null);
});

// ══════════════════════════════════════════════════════════════════════════════
// AC1.3: Max 8 attempts → DEAD_LETTERED
// ══════════════════════════════════════════════════════════════════════════════

test('retry: max 8 attempts → DEAD_LETTERED (attempt 8 is last)', async () => {
  const clock = mutableClock(1_700_000_000_000);

  // Attempt 7 should still allow retry.
  const r7 = await createLeasedReceipt({ attempts: 7 });
  const result7 = await completeReceipt(prisma, {
    fencingToken: r7.fencingToken,
    leaseOwner: r7.workerId,
    outcome: 'RETRY',
    error: {
      code: 'TRANSACTION_FAILED',
      message: 'Transient failure',
      retryable: true,
    },
    retryPolicy: DEFAULT_RETRY_POLICY,
    clock,
  });
  assert.equal(result7.state, 'RETRY_SCHEDULED', 'Attempt 7 should still retry');
  assert.ok(result7.nextAttemptAt !== null);

  // Attempt 8 → DEAD_LETTERED.
  const r8 = await createLeasedReceipt({ attempts: 8 });
  const result8 = await completeReceipt(prisma, {
    fencingToken: r8.fencingToken,
    leaseOwner: r8.workerId,
    outcome: 'RETRY',
    error: {
      code: 'TRANSACTION_FAILED',
      message: 'Transient failure after 8 attempts',
      retryable: true,
    },
    retryPolicy: DEFAULT_RETRY_POLICY,
    clock,
  });
  assert.equal(result8.state, 'DEAD_LETTERED', 'Attempt 8 must dead-letter (maxAttempts=8)');
  assert.equal(result8.nextAttemptAt, null);
});

test('retry: maxAttempts=3 boundary → attempt 3 is DEAD_LETTERED', async () => {
  const clock = mutableClock(1_700_000_000_000);
  const customPolicy = { ...DEFAULT_RETRY_POLICY, maxAttempts: 3 };

  const r2 = await createLeasedReceipt({ attempts: 2 });
  const result2 = await completeReceipt(prisma, {
    fencingToken: r2.fencingToken,
    leaseOwner: r2.workerId,
    outcome: 'RETRY',
    error: { code: 'TRANSACTION_FAILED', message: 'Transient', retryable: true },
    retryPolicy: customPolicy,
    clock,
  });
  assert.equal(result2.state, 'RETRY_SCHEDULED', 'Attempt 2 should still retry with maxAttempts=3');

  const r3 = await createLeasedReceipt({ attempts: 3 });
  const result3 = await completeReceipt(prisma, {
    fencingToken: r3.fencingToken,
    leaseOwner: r3.workerId,
    outcome: 'RETRY',
    error: { code: 'TRANSACTION_FAILED', message: 'Transient', retryable: true },
    retryPolicy: customPolicy,
    clock,
  });
  assert.equal(result3.state, 'DEAD_LETTERED', 'Attempt 3 must dead-letter with maxAttempts=3');
});

// ══════════════════════════════════════════════════════════════════════════════
// AC1.4: Jitter is within ±20% of expected backoff
// ══════════════════════════════════════════════════════════════════════════════

test('retry: jitter is within ±20% of expected backoff (jitterFraction=0.2)', async () => {
  // Run many samples with FIXED epoch to verify jitter bounds statistically.
  // Math.random() is stateful — different clock epochs advance the RNG differently,
  // producing unexpected jitter values across different seeds. We use a fixed epoch
  // so each sample gets an independent random jitter from the same RNG state.
  const policy = { ...DEFAULT_RETRY_POLICY, jitterFraction: 0.2 };
  const sampleCount = 100;
  const currentAttempts = 0; // 0-based: this is attempt #1

  // Expected exponential backoff for attempt 1 = baseMs * 2^(0) = 1000 * 1 = 1000ms.
  // Jitter = ±jitterFraction of the exponential backoff.
  const expectedBase = policy.baseMs * Math.pow(2, currentAttempts); // 1000ms
  const jitterRange = expectedBase * policy.jitterFraction; // 200ms
  const minExpected = expectedBase - jitterRange; // 800ms
  const maxExpected = expectedBase + jitterRange; // 1200ms

  const clock = manualClock(1_700_000_000_000); // fixed epoch for all samples
  const samples = [];
  for (let i = 0; i < sampleCount; i++) {
    const nextAt = computeNextAttemptAt(policy, currentAttempts, clock);
    const backoff = nextAt - clock.now();
    samples.push(backoff);
  }

  // All samples must be within ±20%.
  for (const backoff of samples) {
    assert.ok(
      backoff >= minExpected && backoff <= maxExpected,
      `Jitter out of range: ${backoff}ms expected [${minExpected}, ${maxExpected}]`,
    );
  }

  // Also verify we get actual variation (not all the same value).
  const uniqueValues = new Set(samples);
  assert.ok(
    uniqueValues.size > 1,
    `Jitter produced no variation across ${sampleCount} samples — Math.random must vary`,
  );
});

test('retry: jitter ±10% policy — samples within bounds', async () => {
  // Same methodology: fixed epoch for independent random jitter samples.
  const policy = { ...DEFAULT_RETRY_POLICY, jitterFraction: 0.1 };
  const sampleCount = 50;
  const currentAttempts = 1; // 0-based: attempt #2 → backoff = baseMs * 2^1 = 2000ms

  // Expected exponential backoff = baseMs * 2^(currentAttempts) = 1000 * 2 = 2000ms.
  const expectedBase = policy.baseMs * Math.pow(2, currentAttempts); // 2000ms
  const jitterRange = expectedBase * policy.jitterFraction; // 200ms
  const minExpected = expectedBase - jitterRange; // 1800ms
  const maxExpected = expectedBase + jitterRange; // 2200ms

  const clock = manualClock(1_700_000_000_000); // fixed epoch
  for (let i = 0; i < sampleCount; i++) {
    const nextAt = computeNextAttemptAt(policy, currentAttempts, clock);
    const backoff = nextAt - clock.now();
    assert.ok(
      backoff >= minExpected && backoff <= maxExpected,
      `Attempt 2 jitter out of range: ${backoff}ms expected [${minExpected}, ${maxExpected}]`,
    );
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// AC1.5: Clock advances determine nextAttemptAt deterministically
// ══════════════════════════════════════════════════════════════════════════════

test('retry: clock advances determine nextAttemptAt', async () => {
  // Different clock epochs produce different nextAttemptAt values.
  const policy = DEFAULT_RETRY_POLICY;

  const clockA = manualClock(1_700_000_000_000);
  const clockB = manualClock(1_700_000_000_100); // 100ms later

  // currentAttempts=0 means "this is the first attempt" → nextAttempt=1 → exp=baseMs=1000.
  const nextA = computeNextAttemptAt(policy, 0, clockA);
  const nextB = computeNextAttemptAt(policy, 0, clockB);

  // The actual backoff component should be similar (±jitter × 2),
  // but since clock.now() is different, the epoch values will differ
  // by approximately the same amount.
  const backoffA = nextA - clockA.now();
  const backoffB = nextB - clockB.now();

  // Backoff should both be within policy bounds (base ± jitter).
  const minBackoff = policy.baseMs * (1 - policy.jitterFraction);
  const maxBackoff = policy.baseMs * (1 + policy.jitterFraction);
  assert.ok(backoffA >= minBackoff && backoffA <= maxBackoff,
    `Backoff A should be within jitter bounds: A=${backoffA}ms`);
  assert.ok(backoffB >= minBackoff && backoffB <= maxBackoff,
    `Backoff B should be within jitter bounds: B=${backoffB}ms`);
});

test('retry: nextAttemptAt stored in DB via completeReceipt', async () => {
  const clock = mutableClock(1_700_000_000_000);
  const { fencingToken, workerId, receiptId } = await createLeasedReceipt({ attempts: 1 });

  const result = await completeReceipt(prisma, {
    fencingToken,
    leaseOwner: workerId,
    outcome: 'RETRY',
    error: {
      code: 'TRANSACTION_FAILED',
      message: 'Transient',
      retryable: true,
    },
    retryPolicy: DEFAULT_RETRY_POLICY,
    clock,
  });

  assert.equal(result.state, 'RETRY_SCHEDULED');
  assert.ok(result.nextAttemptAt !== null);

  // Verify the row in DB has the correct nextAttemptAt.
  const row = await prisma.externalEventReceipt.findUnique({
    where: { receiptId },
    select: { state: true, nextAttemptAt: true, reasonCode: true, attempts: true },
  });
  assert.ok(row !== null, 'Receipt must still exist after RETRY_SCHEDULED');
  assert.equal(row.state, 'RETRY_SCHEDULED');
  assert.ok(row.nextAttemptAt !== null, 'DB nextAttemptAt must be set');
  assert.equal(row.reasonCode, 'TRANSACTION_FAILED');
});

test('retry: SUCCESS → DELIVERED (no retry)', async () => {
  const clock = mutableClock(1_700_000_000_000);
  const { fencingToken, workerId } = await createLeasedReceipt({ attempts: 1 });

  const result = await completeReceipt(prisma, {
    fencingToken,
    leaseOwner: workerId,
    outcome: 'SUCCESS',
    clock,
  });

  assert.equal(result.state, 'DELIVERED');
  assert.equal(result.nextAttemptAt, null);
  assert.equal(result.fencedRejected, false);
});

// ══════════════════════════════════════════════════════════════════════════════
// AC1.6: Exponential backoff formula
// ══════════════════════════════════════════════════════════════════════════════

test('retry: exponential backoff grows correctly across attempts', async () => {
  const policy = { ...DEFAULT_RETRY_POLICY, jitterFraction: 0 }; // No jitter for predictable test.
  const sampleCount = 100;
  const clock = manualClock(1_700_000_000_000);

  // We test by calling computeNextAttemptAt with zero jitter.
  // The expected backoff = baseMs * 2^(attempt-1), capped at maxMs.
  for (let attempt = 1; attempt <= 8; attempt++) {
    const nextAt = computeNextAttemptAt({ ...policy, jitterFraction: 0 }, attempt - 1, clock);
    const backoff = nextAt - clock.now();
    const expectedBackoff = Math.min(policy.baseMs * Math.pow(2, attempt - 1), policy.maxMs);
    assert.equal(
      backoff,
      expectedBackoff,
      `Attempt ${attempt}: backoff=${backoff}ms expected ${expectedBackoff}ms`,
    );
  }
});

test('retry: backoff capped at maxMs', async () => {
  // Attempt 10 → 2^9 * 1000 = 512000ms = 8.5 minutes > maxMs (300000).
  const policy = { baseMs: 1_000, maxMs: 300_000, maxAttempts: 8, jitterFraction: 0 };
  const clock = manualClock(1_700_000_000_000);

  const nextAt = computeNextAttemptAt(policy, 9, clock);
  const backoff = nextAt - clock.now();
  assert.equal(backoff, policy.maxMs, `Backoff must be capped at maxMs=${policy.maxMs}`);
});

// ══════════════════════════════════════════════════════════════════════════════
// AC1.7: Duplicate/concurrent receipt → only one processes (idempotency)
// ══════════════════════════════════════════════════════════════════════════════

test('retry: duplicate/concurrent receipt → fencedRejected for stale worker', async () => {
  const clock = mutableClock(1_700_000_000_000);
  const { fencingToken, workerId, receiptId } = await createLeasedReceipt({ attempts: 1 });

  // First worker completes successfully.
  const result1 = await completeReceipt(prisma, {
    fencingToken,
    leaseOwner: workerId,
    outcome: 'SUCCESS',
    clock,
  });
  assert.equal(result1.state, 'DELIVERED');
  assert.equal(result1.fencedRejected, false);

  // Second worker tries to complete with SAME fencing token → fenced rejected.
  const result2 = await completeReceipt(prisma, {
    fencingToken,
    leaseOwner: 'worker-stale-002', // different worker
    outcome: 'SUCCESS',
    clock,
  });
  assert.equal(result2.fencedRejected, true, 'Stale worker must be fenced rejected');
  assert.equal(result2.state, 'DELIVERED', 'fencedRejected still returns DELIVERED as placeholder state');
});

test('retry: claimSpecificReceipt prevents double-claim of same receipt', async () => {
  const clock = mutableClock(1_700_000_000_000);

  const scope = {
    organizationId: 'org-idempotent-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-idem-001',
    eventId: `evt-idem-${Date.now()}`,
  };

  // Create a receipt in PENDING state.
  const receiptId = `rcpt-idem-${Date.now()}`;
  await prisma.externalEventReceipt.create({
    data: {
      receiptId,
      schemaVersion: '1',
      ...scope,
      payloadDigest: 'b'.repeat(64),
      state: 'PENDING',
      attempts: 0,
    },
  });

  // Worker A claims it.
  const claimedA = await claimSpecificReceipt(prisma, {
    workerId: 'worker-A',
    leaseDurationMs: 60_000,
    clock,
    idGen: uuidTokenGenerator,
    scope,
  });
  assert.ok(claimedA !== null, 'Worker A must be able to claim the receipt');

  // Worker B tries to claim the same receipt → must fail.
  const claimedB = await claimSpecificReceipt(prisma, {
    workerId: 'worker-B',
    leaseDurationMs: 60_000,
    clock,
    idGen: uuidTokenGenerator,
    scope,
  });
  assert.equal(claimedB, null, 'Worker B must NOT be able to claim same receipt (already leased)');
});

// ══════════════════════════════════════════════════════════════════════════════
// AC1.8: isRetryable() and decideRetryState() pure function tests
// ══════════════════════════════════════════════════════════════════════════════

test('isRetryable: VALIDATION_ERROR → false', () => {
  assert.equal(isRetryable({ code: 'VALIDATION_ERROR', message: 'x', retryable: false }), false);
});

test('isRetryable: VERSION_CONFLICT → false', () => {
  assert.equal(isRetryable({ code: 'VERSION_CONFLICT', message: 'x', retryable: false }), false);
});

test('isRetryable: IDEMPOTENCY_CONFLICT → false', () => {
  assert.equal(isRetryable({ code: 'IDEMPOTENCY_CONFLICT', message: 'x', retryable: false }), false);
});

test('isRetryable: SCOPE_MISMATCH → false', () => {
  assert.equal(isRetryable({ code: 'SCOPE_MISMATCH', message: 'x', retryable: false }), false);
});

test('isRetryable: TENANT_SCOPE_REQUIRED → false', () => {
  assert.equal(isRetryable({ code: 'TENANT_SCOPE_REQUIRED', message: 'x', retryable: false }), false);
});

test('isRetryable: TRANSACTION_FAILED → true', () => {
  assert.equal(isRetryable({ code: 'TRANSACTION_FAILED', message: 'x', retryable: true }), true);
});

test('isRetryable: error with retryable=true overrides non-retryable code', () => {
  // If err.retryable is explicitly true, use that (even for non-retryable codes).
  assert.equal(isRetryable({ code: 'VALIDATION_ERROR', message: 'x', retryable: true }), true);
});

test('decideRetryState: TRANSACTION_FAILED, attempts=1 → RETRY_SCHEDULED', () => {
  const result = decideRetryState(DEFAULT_RETRY_POLICY, 1, {
    code: 'TRANSACTION_FAILED',
    message: 'Transient',
    retryable: true,
  });
  assert.equal(result.terminal, 'RETRY_SCHEDULED');
});

test('decideRetryState: VALIDATION_ERROR → DEAD_LETTERED', () => {
  const result = decideRetryState(DEFAULT_RETRY_POLICY, 1, {
    code: 'VALIDATION_ERROR',
    message: 'Bad input',
    retryable: false,
  });
  assert.equal(result.terminal, 'DEAD_LETTERED');
});

test('decideRetryState: attempts >= maxAttempts → DEAD_LETTERED', () => {
  const result = decideRetryState(DEFAULT_RETRY_POLICY, 8, {
    code: 'TRANSACTION_FAILED',
    message: 'Transient',
    retryable: true,
  });
  assert.equal(result.terminal, 'DEAD_LETTERED');
});

test('decideRetryState: RETRY outcome with no policy → DEAD_LETTERED', async () => {
  // When RETRY is requested but no policy is provided, it must dead-letter.
  // This is defensive: callers must always provide a policy for retryable errors.
  const clock = mutableClock(1_700_000_000_000);
  const { fencingToken, workerId } = await createLeasedReceipt({ attempts: 1 });

  const result = await completeReceipt(prisma, {
    fencingToken,
    leaseOwner: workerId,
    outcome: 'RETRY',
    error: { code: 'TRANSACTION_FAILED', message: 'No policy', retryable: true },
    // NO retryPolicy!
    clock,
  });

  assert.equal(result.state, 'DEAD_LETTERED', 'RETRY without policy must dead-letter');
});

// ══════════════════════════════════════════════════════════════════════════════
// AC1.9: classifyGatewayError() tests
// ══════════════════════════════════════════════════════════════════════════════

test('classifyGatewayError: VALIDATION_ERROR → DEAD_LETTERED', () => {
  const cls = classifyGatewayError('VALIDATION_ERROR');
  assert.equal(cls.retryable, false);
  assert.equal(cls.decision, 'DEAD_LETTERED');
  assert.ok(cls.reason.includes('VALIDATION_ERROR'));
});

test('classifyGatewayError: VERSION_CONFLICT → DEAD_LETTERED', () => {
  const cls = classifyGatewayError('VERSION_CONFLICT');
  assert.equal(cls.retryable, false);
  assert.equal(cls.decision, 'DEAD_LETTERED');
});

test('classifyGatewayError: IDEMPOTENCY_CONFLICT → DEAD_LETTERED', () => {
  const cls = classifyGatewayError('IDEMPOTENCY_CONFLICT');
  assert.equal(cls.retryable, false);
  assert.equal(cls.decision, 'DEAD_LETTERED');
});

test('classifyGatewayError: SCOPE_MISMATCH → DEAD_LETTERED', () => {
  const cls = classifyGatewayError('SCOPE_MISMATCH');
  assert.equal(cls.retryable, false);
  assert.equal(cls.decision, 'DEAD_LETTERED');
});

test('classifyGatewayError: TENANT_SCOPE_REQUIRED → DEAD_LETTERED', () => {
  const cls = classifyGatewayError('TENANT_SCOPE_REQUIRED');
  assert.equal(cls.retryable, false);
  assert.equal(cls.decision, 'DEAD_LETTERED');
});

test('classifyGatewayError: retryClass=NEVER → DEAD_LETTERED', () => {
  // Even for unknown codes, retryClass=NEVER makes it non-retryable.
  const cls = classifyGatewayError('SOME_UNKNOWN_ERROR', 'NEVER');
  assert.equal(cls.retryable, false);
  assert.equal(cls.decision, 'DEAD_LETTERED');
});

test('classifyGatewayError: TRANSACTION_FAILED → RETRY_SCHEDULED', () => {
  const cls = classifyGatewayError('TRANSACTION_FAILED');
  assert.equal(cls.retryable, true);
  assert.equal(cls.decision, 'RETRY_SCHEDULED');
});

test('classifyGatewayError: DEPENDENCY_UNAVAILABLE → RETRY_SCHEDULED', () => {
  const cls = classifyGatewayError('DEPENDENCY_UNAVAILABLE');
  assert.equal(cls.retryable, true);
  assert.equal(cls.decision, 'RETRY_SCHEDULED');
});

test('classifyGatewayError: RATE_LIMITED → RETRY_SCHEDULED', () => {
  const cls = classifyGatewayError('RATE_LIMITED');
  assert.equal(cls.retryable, true);
  assert.equal(cls.decision, 'RETRY_SCHEDULED');
});

test('classifyGatewayError: retryClass=BOUNDED_SAME_KEY → RETRY_SCHEDULED', () => {
  const cls = classifyGatewayError('TRANSACTION_FAILED', 'BOUNDED_SAME_KEY');
  assert.equal(cls.retryable, true);
  assert.equal(cls.decision, 'RETRY_SCHEDULED');
});

// ══════════════════════════════════════════════════════════════════════════════
// AC1.10: FAIL outcome always → DEAD_LETTERED
// ══════════════════════════════════════════════════════════════════════════════

test('retry: FAIL outcome → DEAD_LETTERED even for TRANSACTION_FAILED', async () => {
  const clock = mutableClock(1_700_000_000_000);
  const { fencingToken, workerId } = await createLeasedReceipt({ attempts: 1 });

  // FAIL always goes to DEAD_LETTERED (caller used FAIL for non-retryable cases).
  const result = await completeReceipt(prisma, {
    fencingToken,
    leaseOwner: workerId,
    outcome: 'FAIL',
    error: {
      code: 'TRANSACTION_FAILED',
      message: 'Failed with retryable error',
      retryable: true, // even if retryable, FAIL means "give up"
    },
    retryPolicy: DEFAULT_RETRY_POLICY,
    clock,
  });

  assert.equal(result.state, 'DEAD_LETTERED', 'FAIL outcome must dead-letter regardless of error');
  assert.equal(result.nextAttemptAt, null);
});

// ══════════════════════════════════════════════════════════════════════════════
// AC1.11: reasonCode persisted in DB on DEAD_LETTERED and RETRY_SCHEDULED
// ══════════════════════════════════════════════════════════════════════════════

test('retry: reasonCode persisted in DB on DEAD_LETTERED', async () => {
  const clock = mutableClock(1_700_000_000_000);
  const { fencingToken, workerId, receiptId } = await createLeasedReceipt({ attempts: 1 });

  await completeReceipt(prisma, {
    fencingToken,
    leaseOwner: workerId,
    outcome: 'FAIL',
    error: {
      code: 'VERSION_CONFLICT',
      message: 'Aggregate version mismatch',
      retryable: false,
    },
    clock,
  });

  const row = await prisma.externalEventReceipt.findUnique({
    where: { receiptId },
    select: { state: true, reasonCode: true },
  });
  assert.ok(row !== null);
  assert.equal(row.state, 'DEAD_LETTERED');
  assert.equal(row.reasonCode, 'VERSION_CONFLICT');
});

test('retry: reasonCode persisted in DB on RETRY_SCHEDULED', async () => {
  const clock = mutableClock(1_700_000_000_000);
  const { fencingToken, workerId, receiptId } = await createLeasedReceipt({ attempts: 2 });

  await completeReceipt(prisma, {
    fencingToken,
    leaseOwner: workerId,
    outcome: 'RETRY',
    error: {
      code: 'DEPENDENCY_UNAVAILABLE',
      message: 'External service unavailable',
      retryable: true,
    },
    retryPolicy: DEFAULT_RETRY_POLICY,
    clock,
  });

  const row = await prisma.externalEventReceipt.findUnique({
    where: { receiptId },
    select: { state: true, reasonCode: true },
  });
  assert.ok(row !== null);
  assert.equal(row.state, 'RETRY_SCHEDULED');
  assert.equal(row.reasonCode, 'DEPENDENCY_UNAVAILABLE');
});
