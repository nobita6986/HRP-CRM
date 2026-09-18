/**
 * outbox.test.mjs — CORE/1.8 AC3 Outbox tests.
 *
 * Test coverage:
 *  1. outbox: intent submission → PENDING status
 *  2. outbox: intent submission → DISPATCHED status (after dispatcher processes)
 *  3. outbox: duplicate intent (same idempotencyKey) → idempotent, no duplicate processing
 *  4. outbox: delivery receipt accepted → durable record
 *  5. outbox: delivery report SENT → ACK_RECEIVED
 *  6. outbox: delivery report DELIVERED → DELIVERED
 *  7. outbox: delivery report FAILED → FAILED with reason
 *  8. outbox: delivery report UNKNOWN → FAILED (NOT success)
 *  9. outbox: concurrent intents for same target → only one acquires lease
 *
 * Boundaries:
 *  - Frozen contracts in packages/contracts — do NOT modify
 *  - No HRP/provider/model thật — mock only
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Build if not exists
if (!existsSync('./dist/outbox/index.js')) {
  execSync('npm run build', { stdio: 'inherit' });
}

// Dynamic imports
const [{ createPrismaClient }, { createMockGateway }, { SCHEMA_VERSION }] = await Promise.all([
  import('@hrp-engagement/integration-store'),
  import('../dist/gateway/index.js'),
  import('@hrp-engagement/contracts'),
]);

const { DeliveryReceiptHandler } = await import('../dist/outbox/delivery-receipt.js');
const { DeliveryReportingHandler } = await import('../dist/outbox/delivery-reporting.js');
const { OutboxDispatcher } = await import('../dist/outbox/dispatcher.js');

// Test configuration
const TEST_ORG_ID = 'org-test-outbox-001';
const TEST_WORKER_ID = 'test-worker-outbox';
const LEASE_DURATION_MS = 5000;

/**
 * Generate unique intent ID.
 */
function intentId(prefix = 'intent') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate ISO datetime string.
 */
function isoNow() {
  return new Date().toISOString();
}

// Embedded Postgres instance
let embeddedPg = null;
let databaseUrl = null;
let prisma = null;
let pgDataDir = null;

async function setupDatabase() {
  const EmbeddedPostgres = (await import('embedded-postgres')).default;
  // Use deterministic, scoped data dir per process to avoid collisions
  // and match the pg-orchestrator-harness / pg-reconciler-harness pattern.
  const SUFFIX = `outbox_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const PORT = 60000 + (Math.abs([...SUFFIX].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 1500);
  pgDataDir = `.tmp_pgdata_outbox_${SUFFIX}`;
  const USER = 'integration';
  const PASSWORD = 'synthetic';
  const DB = 'integration_store_outbox';
  const SCHEMA = 'integration';

  embeddedPg = new EmbeddedPostgres({
    databaseDir: pgDataDir,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: false,
    // CORE/1.15: pin initdb to portable C-locale (Windows portable).
    initdbFlags: ['--locale=C', '--encoding=UTF8', '--no-locale'],
  });
  await embeddedPg.initialise();
  await embeddedPg.start();
  await embeddedPg.createDatabase(DB);

  databaseUrl = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB}?schema=${SCHEMA}&connection_limit=1`;

  // Create the integration schema
  // Use a single PrismaClient instance throughout setup so search_path persists.
  const setupPrisma = createPrismaClient({ databaseUrl });

  // Create schema FIRST (search_path not set yet — CREATE SCHEMA uses full name)
  await setupPrisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS integration`);

  // Set search_path so subsequent CREATE TYPE / CREATE TABLE land in integration schema
  await setupPrisma.$executeRawUnsafe(`SET search_path TO integration`);

  // Create IntentStatus enum type (required by Prisma for INSERT)
  // NOTE: INVESTIGATION_PENDING added by migration 0005; PENDING/LEASED/DISPATCHED/
  // ACK_RECEIVED/DELIVERED/FAILED/TERMINAL from migration 0001.
  await setupPrisma.$executeRawUnsafe(`
    CREATE TYPE "IntentStatus" AS ENUM (
      'PENDING', 'LEASED', 'DISPATCHED', 'ACK_RECEIVED',
      'DELIVERED', 'FAILED', 'TERMINAL', 'INVESTIGATION_PENDING'
    )`);

  await setupPrisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS integration."DispatchIntent" (
      "intentId" VARCHAR(128) PRIMARY KEY,
      "schemaVersion" VARCHAR(8) NOT NULL,
      "organizationId" VARCHAR(64) NOT NULL,
      "receiptId" VARCHAR(128) NOT NULL,
      "idempotencyKey" VARCHAR(256),
      "correlationId" VARCHAR(128),
      "intentSource" VARCHAR(64) NOT NULL,
      "intentTargetJson" JSONB NOT NULL DEFAULT '{}',
      "status" integration."IntentStatus" NOT NULL DEFAULT 'PENDING',
      "attempts" INT NOT NULL DEFAULT 0,
      "leaseOwner" VARCHAR(128),
      "leaseExpiresAt" TIMESTAMPTZ,
      "fencingToken" VARCHAR(128),
      "leaseFencedAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT "uq_intent_receipt" UNIQUE ("organizationId", "receiptId", "intentId")
    )
  `);
  await setupPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ix_intent_status" ON integration."DispatchIntent"("status")`);
  await setupPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ix_intent_lease_expires" ON integration."DispatchIntent"("leaseExpiresAt")`);
  await setupPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ix_intent_fencing" ON integration."DispatchIntent"("fencingToken")`);

  await setupPrisma.$disconnect();
  prisma = createPrismaClient({ databaseUrl });
}

async function teardownDatabase() {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
  if (embeddedPg) {
    await embeddedPg.stop();
    embeddedPg = null;
  }
  // Clean up data dir to avoid leaks between runs
  if (pgDataDir) {
    try {
      const { rmSync } = await import('node:fs');
      rmSync(pgDataDir, { recursive: true, force: true });
    } catch {}
    pgDataDir = null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Tests: Delivery Reporting Handler
// ───────────────────────────────────────────────────────────────────────────

describe('outbox: delivery reporting', () => {
  before(setupDatabase);
  after(teardownDatabase);

  let reportingHandler;
  let receiptHandler;

  beforeEach(() => {
    reportingHandler = new DeliveryReportingHandler(prisma);
    receiptHandler = new DeliveryReceiptHandler(prisma);
  });

  // Helper to create an intent in DISPATCHED state
  async function createDispatchedIntent(intentIdVal) {
    return prisma.dispatchIntent.create({
      data: {
        intentId: intentIdVal,
        schemaVersion: SCHEMA_VERSION,
        organizationId: TEST_ORG_ID,
        receiptId: `receipt-${intentIdVal}`,
        intentSource: 'TEST',
        intentTargetJson: {},
        status: 'DISPATCHED',
      },
    });
  }

  // ── Test 1: Delivery report SENT → ACK_RECEIVED ──────────────────────────

  test('outbox: delivery report SENT → ACK_RECEIVED', async () => {
    const intentIdVal = intentId('report-sent');
    await createDispatchedIntent(intentIdVal);

    const event = {
      schemaVersion: SCHEMA_VERSION,
      organizationId: TEST_ORG_ID,
      intentId: intentIdVal,
      consumerDedupeToken: `dedupe-${intentIdVal}`,
      state: 'SENT',
      reportedAt: isoNow(),
    };

    const result = await reportingHandler.processEvent(event);

    assert.strictEqual(result.success, true, 'Processing should succeed');
    assert.strictEqual(result.state, 'SENT', 'State should be SENT');
    assert.strictEqual(result.newStatus, 'ACK_RECEIVED', 'New status should be ACK_RECEIVED');
  });

  // ── Test 2: Delivery report DELIVERED → DELIVERED ────────────────────────

  test('outbox: delivery report DELIVERED → DELIVERED', async () => {
    const intentIdVal = intentId('report-delivered');
    await createDispatchedIntent(intentIdVal);

    const event = {
      schemaVersion: SCHEMA_VERSION,
      organizationId: TEST_ORG_ID,
      intentId: intentIdVal,
      consumerDedupeToken: `dedupe-${intentIdVal}`,
      state: 'DELIVERED',
      reportedAt: isoNow(),
    };

    const result = await reportingHandler.processEvent(event);

    assert.strictEqual(result.success, true, 'Processing should succeed');
    assert.strictEqual(result.state, 'DELIVERED', 'State should be DELIVERED');
    assert.strictEqual(result.newStatus, 'DELIVERED', 'New status should be DELIVERED');
  });

  // ── Test 3: Delivery report FAILED → FAILED with reason ──────────────────

  test('outbox: delivery report FAILED → FAILED with reason', async () => {
    const intentIdVal = intentId('report-failed');
    await createDispatchedIntent(intentIdVal);

    const event = {
      schemaVersion: SCHEMA_VERSION,
      organizationId: TEST_ORG_ID,
      intentId: intentIdVal,
      consumerDedupeToken: `dedupe-${intentIdVal}`,
      state: 'FAILED',
      reportedAt: isoNow(),
      reason: 'PROVIDER_REJECTED',
    };

    const result = await reportingHandler.processEvent(event);

    assert.strictEqual(result.success, true, 'Processing should succeed');
    assert.strictEqual(result.state, 'FAILED', 'State should be FAILED');
    assert.strictEqual(result.newStatus, 'FAILED', 'New status should be FAILED');
  });

  // ── Test 4: Delivery report UNKNOWN → FAILED (NOT success) ──────────────

  test('outbox: delivery report UNKNOWN → FAILED (NOT success)', async () => {
    const intentIdVal = intentId('report-unknown');
    await createDispatchedIntent(intentIdVal);

    const event = {
      schemaVersion: SCHEMA_VERSION,
      organizationId: TEST_ORG_ID,
      intentId: intentIdVal,
      consumerDedupeToken: `dedupe-${intentIdVal}`,
      state: 'UNKNOWN',
      reportedAt: isoNow(),
      reason: 'HRP_OFFLINE',
    };

    const result = await reportingHandler.processEvent(event);

    assert.strictEqual(result.success, true, 'Processing should succeed');
    assert.strictEqual(result.state, 'UNKNOWN', 'State should be UNKNOWN');
    assert.strictEqual(result.newStatus, 'FAILED', 'UNKNOWN should map to FAILED (not success)');

    // Verify UNKNOWN is NOT treated as success
    const isSuccess = result.state === 'SENT' || result.state === 'DELIVERED';
    assert.strictEqual(isSuccess, false, 'UNKNOWN should NOT be treated as success');
  });

  // ── Test 5: Delivery report validation ────────────────────────────────────

  test('outbox: delivery report validation rejects missing reason for FAILED state', async () => {
    const intentIdVal = intentId('report-invalid');
    await createDispatchedIntent(intentIdVal);

    const invalidEvent = {
      schemaVersion: SCHEMA_VERSION,
      organizationId: TEST_ORG_ID,
      intentId: intentIdVal,
      consumerDedupeToken: `dedupe-${intentIdVal}`,
      state: 'FAILED',
      reportedAt: isoNow(),
      // Missing reason — should be rejected
    };

    const result = await reportingHandler.processEvent(invalidEvent);

    assert.strictEqual(result.success, false, 'Should fail validation');
    assert.ok(result.error, 'Should have error');
    assert.ok(result.error.message.includes('reason'), 'Error should mention missing reason');
  });

  test('outbox: delivery report validation rejects reason for SENT state', async () => {
    const intentIdVal = intentId('report-invalid-sent');
    await createDispatchedIntent(intentIdVal);

    const invalidEvent = {
      schemaVersion: SCHEMA_VERSION,
      organizationId: TEST_ORG_ID,
      intentId: intentIdVal,
      consumerDedupeToken: `dedupe-${intentIdVal}`,
      state: 'SENT',
      reportedAt: isoNow(),
      reason: 'SHOULD_NOT_BE_HERE', // Should NOT have reason for SENT
    };

    const result = await reportingHandler.processEvent(invalidEvent);

    assert.strictEqual(result.success, false, 'Should fail validation');
    assert.ok(result.error, 'Should have error');
  });

  // ── Test 6: Delivery receipt accepted → ACK_RECEIVED ─────────────────────

  test('outbox: delivery receipt accepted → ACK_RECEIVED', async () => {
    const intentIdVal = intentId('receipt-ack');
    await createDispatchedIntent(intentIdVal);

    const receipt = {
      schemaVersion: SCHEMA_VERSION,
      organizationId: TEST_ORG_ID,
      intentId: intentIdVal,
      consumerDedupeToken: `dedupe-${intentIdVal}`,
      outcome: 'ACCEPTED',
      acceptedAt: isoNow(),
    };

    const result = await receiptHandler.processReceipt(receipt);

    assert.strictEqual(result.success, true, 'Processing should succeed');
    assert.strictEqual(result.status, 'ACK_RECEIVED', 'Status should be ACK_RECEIVED');
  });

  // ── Test 7: Receipt for non-existent intent → NOT_FOUND ─────────────────

  test('outbox: receipt for non-existent intent → NOT_FOUND', async () => {
    const fakeIntentIdVal = intentId('fake');

    const event = {
      schemaVersion: SCHEMA_VERSION,
      organizationId: TEST_ORG_ID,
      intentId: fakeIntentIdVal,
      consumerDedupeToken: `dedupe-${fakeIntentIdVal}`,
      state: 'SENT',
      reportedAt: isoNow(),
    };

    const result = await reportingHandler.processEvent(event);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error?.code, 'INTENT_NOT_FOUND');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Tests: Outbox Dispatcher
// ───────────────────────────────────────────────────────────────────────────

describe('outbox: dispatcher', () => {
  before(setupDatabase);
  after(teardownDatabase);

  let gateway;
  let dispatcher;

  beforeEach(() => {
    gateway = createMockGateway();
    dispatcher = new OutboxDispatcher(prisma, gateway, {
      workerId: TEST_WORKER_ID,
      leaseDurationMs: LEASE_DURATION_MS,
      pollIntervalMs: 100,
      batchSize: 10,
    });
  });

  // ── Test 8: Intent processed → DELIVERED status ─────────────────────────

  test('outbox: intent processed by dispatcher → DELIVERED status', async () => {
    const intentIdVal = intentId('dispatch');

    // Create PENDING intent
    await prisma.dispatchIntent.create({
      data: {
        intentId: intentIdVal,
        schemaVersion: SCHEMA_VERSION,
        organizationId: TEST_ORG_ID,
        receiptId: `receipt-${intentIdVal}`,
        idempotencyKey: `idem-${intentIdVal}`,
        correlationId: `corr-${intentIdVal}`,
        intentSource: 'TEST',
        intentTargetJson: {
          provider: 'MOCK_PROVIDER',
          connectionId: 'conn-001',
          gatewayMethod: 'recordInteraction',
          scenarioId: 'OUTBOX_RECEIPT_DURABLE',
        },
        status: 'PENDING',
      },
    });

    // Process one intent
    const result = await dispatcher.processNextIntent();

    assert.ok(result, 'Should return a result');
    assert.strictEqual(result.intentId, intentIdVal, 'Should be the right intent');
    assert.strictEqual(result.status, 'DISPATCHED', 'Status should be DISPATCHED');

    // Verify in database
    const intent = await prisma.dispatchIntent.findUnique({
      where: { intentId: intentIdVal },
    });
    assert.ok(intent, 'Intent should exist');
    assert.strictEqual(intent.status, 'DELIVERED', 'After SUCCESS completion, status should be DELIVERED');
  });

  // ── Test 9: Concurrent dispatchers for same intent → only one acquires lease ──

  test('outbox: concurrent dispatchers for same intent → only one acquires lease (no duplicate delivery)', async () => {
    // Setup: create ONE PENDING intent. Two dispatchers will race to claim it.
    // With FOR UPDATE SKIP LOCKED, only the first transaction can lock the row;
    // the other gets null (no row visible to lock). This proves dispatcher/lease
    // does NOT allow duplicate processing of the same intent.
    const sharedIntentId = intentId('concurrent-same');
    const receiptId = `concurrent-receipt-${Date.now()}`;

    await prisma.dispatchIntent.create({
      data: {
        intentId: sharedIntentId,
        schemaVersion: SCHEMA_VERSION,
        organizationId: TEST_ORG_ID,
        receiptId,
        intentSource: 'TEST',
        intentTargetJson: {},
        status: 'PENDING',
      },
    });

    // Create two dispatchers with different worker IDs
    const dispatcher1 = new OutboxDispatcher(prisma, gateway, {
      workerId: 'worker-1',
      leaseDurationMs: LEASE_DURATION_MS,
      pollIntervalMs: 100,
      batchSize: 5,
    });

    const dispatcher2 = new OutboxDispatcher(prisma, gateway, {
      workerId: 'worker-2',
      leaseDurationMs: LEASE_DURATION_MS,
      pollIntervalMs: 100,
      batchSize: 5,
    });

    // Both dispatchers try to claim the SAME intent simultaneously
    const [result1, result2] = await Promise.all([
      dispatcher1.processNextIntent(),
      dispatcher2.processNextIntent(),
    ]);

    // Only one should succeed (the one that acquired the lease on the row)
    const successResults = [result1, result2].filter((r) => r !== null);
    assert.strictEqual(
      successResults.length,
      1,
      'Only one dispatcher should acquire the lease for the same intent',
    );

    // The successful one should have processed the shared intent
    const successResult = successResults[0];
    assert.ok(successResult, 'One result should be non-null');
    assert.strictEqual(
      successResult.intentId,
      sharedIntentId,
      'Successful claim must be for the shared intent',
    );

    // No duplicate delivery: only one DispatchIntent row should be in terminal state
    const finalState = await prisma.dispatchIntent.findUnique({
      where: { intentId: sharedIntentId },
    });
    assert.ok(finalState, 'Intent must still exist after dispatch');
    assert.strictEqual(
      finalState.attempts,
      1,
      `Intent must be claimed exactly once (attempts=${finalState.attempts})`,
    );
    assert.strictEqual(
      finalState.status,
      'DELIVERED',
      `Intent must be in DELIVERED state after SUCCESS outcome (was=${finalState.status})`,
    );
  });

  // ── Test 10: No pending intents → null result ─────────────────────────────

  test('outbox: no pending intents → null result', async () => {
    // Clear any existing intents
    await prisma.dispatchIntent.deleteMany({
      where: { organizationId: TEST_ORG_ID },
    });

    const result = await dispatcher.processNextIntent();
    assert.strictEqual(result, null, 'Should return null when no intents available');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Tests: Edge cases
// ───────────────────────────────────────────────────────────────────────────

describe('outbox: edge cases', () => {
  before(setupDatabase);
  after(teardownDatabase);

  let reportingHandler;

  beforeEach(() => {
    reportingHandler = new DeliveryReportingHandler(prisma);
  });

  // ── Test 11: Invalid state transition ────────────────────────────────────

  test('outbox: invalid state transition → rejected', async () => {
    const intentIdVal = intentId('invalid-transition');

    // Create intent in terminal state
    await prisma.dispatchIntent.create({
      data: {
        intentId: intentIdVal,
        schemaVersion: SCHEMA_VERSION,
        organizationId: TEST_ORG_ID,
        receiptId: `receipt-${intentIdVal}`,
        intentSource: 'TEST',
        intentTargetJson: {},
        status: 'TERMINAL', // Already terminal
      },
    });

    const event = {
      schemaVersion: SCHEMA_VERSION,
      organizationId: TEST_ORG_ID,
      intentId: intentIdVal,
      consumerDedupeToken: `dedupe-${intentIdVal}`,
      state: 'DELIVERED',
      reportedAt: isoNow(),
    };

    const result = await reportingHandler.processEvent(event);

    // Should either succeed (idempotent) or fail with invalid transition
    // Both are acceptable behaviors
    assert.ok(
      result.success || result.error?.code === 'INVALID_TRANSITION',
      'Should either succeed or reject invalid transition'
    );
  });
});
