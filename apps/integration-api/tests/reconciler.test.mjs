/**
 * apps/integration-api/tests/reconciler.test.mjs
 *
 * CORE/1.8 AC5 — Reconciler tests for stuck receipts/jobs/mappings.
 *
 * Test cases:
 *   1. reconciler: stuck receipt detected → RecoveryAction created
 *   2. reconciler: stuck intent detected → RecoveryAction created
 *   3. reconciler: concurrent recovery for same stuck item → only one RecoveryAction (dedupe)
 *   4. reconciler: recovery resets stuck receipt to PENDING
 *   5. reconciler: recovery resets stuck intent to PENDING
 *   6. reconciler: recovery action has actor + timestamp audit
 *   7. reconciler: idempotent recovery (same item recovered twice → idempotent)
 *   8. reconciler: does NOT write to HRP core tables (only integration schema)
 *   9. reconciler: stuck receipt not stuck → no RecoveryAction created
 *   10. reconciler: HTTP handler lists stuck items
 *   11. reconciler: scheduler runs scan and recovers items
 *   12. reconciler: HTTP handler lists recovery actions
 *   13. recovery action has correct snapshot
 *   14. batch reconciliation of multiple stuck receipts
 *   15. intent recovery when receipt is also stuck
 *   16. scheduler dedupes concurrent scans
 *   17. completeRecoveryAction transitions status correctly
 *   18. resetStuckReceipt only resets LEASED+expired
 *   19. concurrent createRecoveryAction race condition
 *
 * All tests use embedded PostgreSQL with integration schema ONLY.
 * No HRP core tables are touched.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { start } from './pg-reconciler-harness.mjs';
import {
  createRecoveryAction,
  findRecoveryAction,
  completeRecoveryAction,
  findStuckReceipts,
  findStuckIntents,
  resetStuckReceipt,
  resetStuckIntent,
  listRecoveryActions,
} from '@hrp-engagement/integration-store';
import {
  reconcileReceipts,
  recoverReceipt,
} from '../dist/reconciler/stuck-receipt-reconciler.js';
import {
  reconcileIntents,
  recoverIntent,
} from '../dist/reconciler/stuck-intent-reconciler.js';
import { ReconciliationScheduler } from '../dist/reconciler/reconciliation-scheduler.js';
import { ReconciliationHttpHandler } from '../dist/reconciler/http-handler.js';

// ─── Harness ──────────────────────────────────────────────────────

/** @type {import('@prisma/client').PrismaClient | null} */
let prisma;
let harnessStop;

function getPrisma() {
  if (!prisma) throw new Error('Test harness not started');
  return prisma;
}

before(async () => {
  const harness = await start();
  prisma = harness.prisma;
  harnessStop = harness.stop;
});

after(async () => {
  if (harnessStop) await harnessStop();
});

// ─── Test helpers ─────────────────────────────────────────────────

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a receipt in LEASED state with expired lease.
 */
async function createStuckReceipt(overrides = {}) {
  const receiptId = overrides.receiptId ?? newId('rcpt');
  const now = new Date();
  const expired = new Date(now.getTime() - 60_000);

  const receipt = await getPrisma().externalEventReceipt.create({
    data: {
      receiptId,
      schemaVersion: '1',
      organizationId: overrides.organizationId ?? 'org-reconciler-test',
      provider: overrides.provider ?? 'MOCK_PROVIDER',
      connectionId: overrides.connectionId ?? 'conn-reconciler-test',
      eventId: overrides.eventId ?? `evt-${receiptId}`,
      payloadDigest: 'a'.repeat(64),
      state: 'LEASED',
      attempts: overrides.attempts ?? 1,
      leaseOwner: overrides.leaseOwner ?? 'dead-worker-001',
      leaseExpiresAt: expired,
      fencingToken: overrides.fencingToken ?? 'dead-token-001',
      leaseFencedAt: expired,
    },
  });
  return receipt;
}

/**
 * Create a DispatchIntent in LEASED state with expired lease.
 */
async function createStuckIntent(overrides = {}) {
  const intentId = overrides.intentId ?? newId('intent');
  const receiptId = overrides.receiptId ?? newId('rcpt');
  const now = new Date();
  const expired = new Date(now.getTime() - 60_000);

  const intent = await getPrisma().dispatchIntent.create({
    data: {
      intentId,
      schemaVersion: '1',
      organizationId: overrides.organizationId ?? 'org-reconciler-test',
      receiptId,
      idempotencyKey: `idem-${intentId}`,
      intentSource: 'TEST_COMMAND',
      intentTargetJson: {
        destination: { provider: 'MOCK', connectionId: 'c1' },
        template: {},
        policy: {},
      },
      status: 'LEASED',
      attempts: overrides.attempts ?? 1,
      leaseOwner: overrides.leaseOwner ?? 'dead-worker-002',
      leaseExpiresAt: expired,
      fencingToken: overrides.fencingToken ?? 'dead-token-002',
      leaseFencedAt: expired,
    },
  });
  return intent;
}

// ─── AC5 Tests ───────────────────────────────────────────────────

describe('CORE/1.8 AC5 — Reconciler', () => {

  // AC5 Test 1: Stuck receipt detected → RecoveryAction created
  test('reconciler: stuck receipt detected → RecoveryAction created', async () => {
    const p = getPrisma();
    const orgId = 'org-ac5-01';

    const receipt = await createStuckReceipt({ organizationId: orgId });

    const stuck = await findStuckReceipts(p, { organizationId: orgId, limit: 10 });
    assert(stuck.some(r => r.receiptId === receipt.receiptId),
      'Receipt should be detected as stuck');

    const result = await reconcileReceipts({
      prisma: p,
      actor: 'test-actor-ac5-01',
      batchSize: 10,
    });

    const recovered = result.results.filter(r => r.action === 'RECOVERED');
    assert(recovered.length === 1,
      `Expected 1 recovered, got ${result.scanned} scanned, results: ${JSON.stringify(result.results)}`);

    const action = await findRecoveryAction(p, { itemType: 'RECEIPT', itemId: receipt.receiptId });
    assert(action !== null, 'RecoveryAction should exist');
    assert(action.status === 'APPLIED', `Expected APPLIED, got ${action.status}`);
    assert(action.actor === 'test-actor-ac5-01');
    assert(action.itemType === 'RECEIPT');
    assert(action.itemId === receipt.receiptId);
    assert(action.createdAt instanceof Date);
  });

  // AC5 Test 2: Stuck intent detected → RecoveryAction created
  test('reconciler: stuck intent detected → RecoveryAction created', async () => {
    const p = getPrisma();
    const orgId = 'org-ac5-02';

    const intent = await createStuckIntent({ organizationId: orgId });

    const stuck = await findStuckIntents(p, { organizationId: orgId, limit: 10 });
    assert(stuck.some(i => i.intentId === intent.intentId),
      'Intent should be detected as stuck');

    const result = await reconcileIntents({
      prisma: p,
      actor: 'test-actor-ac5-02',
      batchSize: 10,
    });

    const recovered = result.results.filter(r => r.action === 'RECOVERED');
    assert(recovered.length === 1,
      `Expected 1 recovered, got results: ${JSON.stringify(result.results)}`);

    const action = await findRecoveryAction(p, { itemType: 'INTENT', itemId: intent.intentId });
    assert(action !== null, 'RecoveryAction should exist');
    assert(action.status === 'APPLIED');
    assert(action.actor === 'test-actor-ac5-02');
    assert(action.itemType === 'INTENT');
    assert(action.itemId === intent.intentId);
  });

  // AC5 Test 3: Concurrent recovery for same stuck item → dedupe
  test('reconciler: concurrent recovery for same stuck item → only one RecoveryAction (dedupe)', async () => {
    const p = getPrisma();
    const orgId = 'org-ac5-03';

    const receipt = await createStuckReceipt({ organizationId: orgId });

    const [result1, result2] = await Promise.all([
      reconcileReceipts({ prisma: p, actor: 'test-actor-ac5-03-first', batchSize: 10 }),
      reconcileReceipts({ prisma: p, actor: 'test-actor-ac5-03-second', batchSize: 10 }),
    ]);

    const actions = await listRecoveryActions(p, { itemType: 'RECEIPT', limit: 10 });
    const ourActions = actions.filter(a => a.itemId === receipt.receiptId);

    assert(ourActions.length === 1,
      `Expected exactly 1 RecoveryAction, got ${ourActions.length}: ${JSON.stringify(ourActions)}`);

    const allResults = [
      ...result1.results.filter(r => r.receiptId === receipt.receiptId),
      ...result2.results.filter(r => r.receiptId === receipt.receiptId),
    ];
    const recoveredCount = allResults.filter(r => r.action === 'RECOVERED').length;
    const skippedCount = allResults.filter(r => r.action === 'SKIPPED').length;

    assert(recoveredCount === 1, `Expected exactly 1 RECOVERED, got ${recoveredCount}`);
    assert(skippedCount === 1, `Expected exactly 1 SKIPPED (the other reconciler), got ${skippedCount}`);
  });

  // AC5 Test 4: Recovery resets stuck receipt to PENDING
  test('reconciler: recovery resets stuck receipt to PENDING', async () => {
    const p = getPrisma();
    const orgId = 'org-ac5-04';

    const receipt = await createStuckReceipt({ organizationId: orgId });

    const result = await reconcileReceipts({
      prisma: p,
      actor: 'test-actor-ac5-04',
      batchSize: 10,
    });

    assert(result.results.some(r => r.action === 'RECOVERED'), 'Should have recovered');

    const updated = await p.externalEventReceipt.findUnique({ where: { receiptId: receipt.receiptId } });
    assert(updated !== null, 'Receipt should still exist');
    assert(updated.state === 'PENDING', `Expected PENDING, got ${updated.state}`);
    assert(updated.leaseOwner === null, 'leaseOwner should be cleared');
    assert(updated.leaseExpiresAt === null, 'leaseExpiresAt should be cleared');
    assert(updated.fencingToken === null, 'fencingToken should be cleared');
    assert(updated.leaseFencedAt === null, 'leaseFencedAt should be cleared');
  });

  // AC5 Test 5: Recovery resets stuck intent to PENDING
  test('reconciler: recovery resets stuck intent to PENDING', async () => {
    const p = getPrisma();
    const orgId = 'org-ac5-05';

    const intent = await createStuckIntent({ organizationId: orgId });

    const result = await reconcileIntents({
      prisma: p,
      actor: 'test-actor-ac5-05',
      batchSize: 10,
    });

    assert(result.results.some(r => r.action === 'RECOVERED'), 'Should have recovered');

    const updated = await p.dispatchIntent.findUnique({ where: { intentId: intent.intentId } });
    assert(updated !== null, 'Intent should still exist');
    assert(updated.status === 'PENDING', `Expected PENDING, got ${updated.status}`);
    assert(updated.leaseOwner === null);
    assert(updated.leaseExpiresAt === null);
    assert(updated.fencingToken === null);
    assert(updated.leaseFencedAt === null);
  });

  // AC5 Test 6: Recovery action has actor + timestamp audit
  test('reconciler: recovery action has actor + timestamp audit', async () => {
    const p = getPrisma();
    const orgId = 'org-ac5-06';

    const receipt = await createStuckReceipt({ organizationId: orgId });

    const before = Date.now();
    await reconcileReceipts({ prisma: p, actor: 'auditor-ac5-06', batchSize: 10 });
    const after = Date.now();

    const action = await findRecoveryAction(p, { itemType: 'RECEIPT', itemId: receipt.receiptId });
    assert(action !== null, 'RecoveryAction should exist');

    assert(action.actor === 'auditor-ac5-06',
      `Actor should be 'auditor-ac5-06', got '${action.actor}'`);

    assert(action.createdAt instanceof Date, 'createdAt should be a Date');
    const tsMs = action.createdAt.getTime();
    assert(tsMs >= before, `createdAt (${tsMs}) should be >= before (${before})`);
    assert(tsMs <= after + 1000, `createdAt (${tsMs}) should be <= after+1s (${after + 1000})`);

    assert(action.completedAt instanceof Date, 'completedAt should be set for APPLIED action');
    assert(action.completedAt.getTime() >= before, 'completedAt should be >= before');

    assert(action.snapshotJson !== null, 'snapshotJson should be present');
    assert(typeof action.snapshotJson === 'object', 'snapshotJson should be an object');
    const snap = action.snapshotJson;
    assert(snap.state === 'LEASED', 'snapshot should contain original state');
    assert(snap.attempts === 1, 'snapshot should contain attempts count');
  });

  // AC5 Test 7: Idempotent recovery
  test('reconciler: idempotent recovery (same item recovered twice → idempotent)', async () => {
    const p = getPrisma();
    const orgId = 'org-ac5-07';

    const receipt = await createStuckReceipt({ organizationId: orgId });

    const r1 = await recoverReceipt(p, receipt.receiptId, 'idempotent-actor-07');
    assert(r1.action === 'RECOVERED', 'First recovery should succeed');
    assert(r1.recoveryId !== null, 'First recovery should have recoveryId');
    const recoveryId1 = r1.recoveryId;

    const r2 = await recoverReceipt(p, receipt.receiptId, 'idempotent-actor-07-dup');
    assert(r2.action === 'SKIPPED', 'Second recovery should be SKIPPED (idempotent)');
    assert(r2.recoveryId === recoveryId1, 'Second recovery should return same recoveryId');

    const action = await findRecoveryAction(p, { itemType: 'RECEIPT', itemId: receipt.receiptId });
    assert(action !== null);
    assert(action.status === 'APPLIED');
    assert(action.actor === 'idempotent-actor-07', 'First actor should be preserved');

    const updated = await p.externalEventReceipt.findUnique({ where: { receiptId: receipt.receiptId } });
    assert(updated.state === 'PENDING');
    assert(updated.attempts === 1, 'attempts should NOT be incremented by recovery');
  });

  // AC5 Test 8: Reconciliation does NOT write to HRP core tables
  test('reconciler: does NOT write to HRP core tables (only integration schema)', async () => {
    const p = getPrisma();
    const orgId = 'org-ac5-08';

    const receipt = await createStuckReceipt({ organizationId: orgId });

    await reconcileReceipts({ prisma: p, actor: 'test-ac5-08', batchSize: 10 });

    const action = await findRecoveryAction(p, { itemType: 'RECEIPT', itemId: receipt.receiptId });
    assert(action !== null, 'RecoveryAction should be in integration schema');

    const inIntegration = await p.externalEventReceipt.findUnique({ where: { receiptId: receipt.receiptId } });
    assert(inIntegration !== null, 'Receipt should be in integration schema');

    const publicTables = await p.$queryRaw`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE '%recovery%'
    `;
    assert(publicTables.length === 0,
      `No recovery tables should exist in public schema: ${JSON.stringify(publicTables)}`);

    const schemas = await p.$queryRaw`
      SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'hrp_core'
    `;
    assert(schemas.length === 0, 'hrp_core schema should not exist');
  });

  // AC5 Test 9: Non-stuck receipt → no RecoveryAction
  test('reconciler: non-stuck receipt → no RecoveryAction created', async () => {
    const p = getPrisma();
    const orgId = 'org-ac5-09';

    const receiptId = newId('rcpt-not-stuck');
    await p.externalEventReceipt.create({
      data: {
        receiptId,
        schemaVersion: '1',
        organizationId: orgId,
        provider: 'MOCK',
        connectionId: 'conn-ac5-09',
        eventId: `evt-${receiptId}`,
        payloadDigest: 'b'.repeat(64),
        state: 'PENDING',
        attempts: 0,
      },
    });

    const result = await reconcileReceipts({ prisma: p, actor: 'test-ac5-09', batchSize: 10 });

    const ourResult = result.results.filter(r => r.receiptId === receiptId);
    assert(ourResult.length === 0, 'Non-stuck receipt should not appear in reconciliation results');

    const action = await findRecoveryAction(p, { itemType: 'RECEIPT', itemId: receiptId });
    assert(action === null, 'No RecoveryAction should exist for non-stuck receipt');
  });

  // AC5 Test 10: Scheduler runs scan and recovers items
  test('reconciler: scheduler runs scan and recovers items', async () => {
    const p = getPrisma();
    const orgId = 'org-ac5-10';

    const receipt = await createStuckReceipt({ organizationId: orgId });
    const intent = await createStuckIntent({ organizationId: orgId, receiptId: receipt.receiptId });

    const scheduler = new ReconciliationScheduler({
      prisma: p,
      schedulerId: 'sched-ac5-10',
      intervalMs: 999_999_999,
    });

    const result = await scheduler.runScan();

    const receiptRecovered = result.receiptResults.some(
      r => r.receiptId === receipt.receiptId && r.action === 'RECOVERED',
    );
    assert(receiptRecovered, 'Receipt should be recovered by scheduler');

    const intentRecovered = result.intentResults.some(
      r => r.intentId === intent.intentId && r.action === 'RECOVERED',
    );
    assert(intentRecovered, 'Intent should be recovered by scheduler');

    assert(result.stats.receiptScans >= 1, 'receiptScans should be incremented');
    assert(result.stats.intentScans >= 1, 'intentScans should be incremented');
    assert(result.stats.lastReceiptsRecovered >= 1, 'lastReceiptsRecovered should be set');
    assert(result.stats.lastIntentsRecovered >= 1, 'lastIntentsRecovered should be set');
    assert(result.stats.lastScanAt !== null, 'lastScanAt should be set');
    assert(result.stats.schedulerId === 'sched-ac5-10');

    scheduler.stop();
  });

  // AC5 Test 11: HTTP handler lists stuck items
  test('reconciler: HTTP handler lists stuck items', async () => {
    const p = getPrisma();
    const orgId = 'org-ac5-11';

    const receipt = await createStuckReceipt({ organizationId: orgId });
    const intent = await createStuckIntent({ organizationId: orgId, receiptId: receipt.receiptId });

    const handler = new ReconciliationHttpHandler({ prisma: p, organizationId: orgId });

    let responseBody = '';
    const mockRes = {
      _statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      get statusCode() { return this._statusCode; },
      set statusCode(v) { this._statusCode = v; },
      end(body) { responseBody = body; },
    };

    await handler.handle(
      { url: '/mock/reconciler/stuck', method: 'GET' },
      mockRes,
    );

    const body = JSON.parse(responseBody);
    assert(body.status === 'ok', `Expected ok, got: ${JSON.stringify(body)}`);
    assert(body.stuckReceipts.length >= 1, 'Should list at least our stuck receipt');
    assert(body.stuckIntents.length >= 1, 'Should list at least our stuck intent');
    assert(
      body.stuckReceipts.some(r => r.receiptId === receipt.receiptId),
      'Our receipt should be listed',
    );
    assert(
      body.stuckIntents.some(i => i.intentId === intent.intentId),
      'Our intent should be listed',
    );
    assert(body.summary.stuckReceiptCount >= 1);
    assert(body.summary.stuckIntentCount >= 1);
  });

  // AC5 Test 12: Manual recovery via recoverReceipt/recoverIntent
  test('reconciler: manual recovery via recoverReceipt/recoverIntent', async () => {
    const p = getPrisma();
    const orgId = 'org-ac5-12';

    const receipt = await createStuckReceipt({ organizationId: orgId });
    const intent = await createStuckIntent({ organizationId: orgId, receiptId: receipt.receiptId });

    const result = await recoverReceipt(p, receipt.receiptId, 'http-manual-ac5-12');
    assert(result.action === 'RECOVERED', 'Manual receipt recovery should work');

    const intentResult = await recoverIntent(p, intent.intentId, 'http-manual-ac5-12');
    assert(intentResult.action === 'RECOVERED', 'Manual intent recovery should work');
  });

  // AC5 Test 13: HTTP handler lists recovery actions
  test('reconciler: HTTP handler lists recovery actions', async () => {
    const p = getPrisma();
    const orgId = 'org-ac5-13';

    const receipt = await createStuckReceipt({ organizationId: orgId });
    await reconcileReceipts({ prisma: p, actor: 'http-list-ac5-13', batchSize: 10 });

    const handler = new ReconciliationHttpHandler({ prisma: p, organizationId: orgId });

    let responseBody = '';
    const mockRes = {
      _statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      get statusCode() { return this._statusCode; },
      set statusCode(v) { this._statusCode = v; },
      end(body) { responseBody = body; },
    };

    await handler.handle(
      { url: '/mock/reconciler/recovery-actions', method: 'GET' },
      mockRes,
    );

    const body = JSON.parse(responseBody);
    assert(body.status === 'ok', `Expected ok, got: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.actions), 'actions should be an array');
    assert(body.actions.length >= 1, 'Should have at least our recovery action');

    const ourAction = body.actions.find(a => a.itemId === receipt.receiptId);
    assert(ourAction !== undefined, 'Our receipt recovery should be listed');
    assert(ourAction.status === 'APPLIED');
    assert(ourAction.actor === 'http-list-ac5-13');
    assert(ourAction.recoveryId !== null);
    assert(ourAction.createdAt !== null);
  });

  // AC5 Test 14: Recovery action snapshot captures stuck state
  test('reconciler: recovery action snapshot captures stuck state', async () => {
    const p = getPrisma();
    const orgId = 'org-ac5-14';

    const receipt = await createStuckReceipt({
      organizationId: orgId,
      provider: 'PROVIDER_SNAPSHOT_TEST',
      connectionId: 'conn-snapshot',
      attempts: 3,
      leaseOwner: 'lease-owner-snapshot',
    });

    await reconcileReceipts({ prisma: p, actor: 'snapshot-ac5-14', batchSize: 10 });

    const action = await findRecoveryAction(p, { itemType: 'RECEIPT', itemId: receipt.receiptId });
    assert(action !== null);
    assert(action.snapshotJson !== null);

    const snap = action.snapshotJson;
    assert(snap.state === 'LEASED', 'snapshot.state should be LEASED');
    assert(snap.attempts === 3, 'snapshot.attempts should be 3');
    assert(snap.leaseOwner === 'lease-owner-snapshot');
    assert(snap.provider === 'PROVIDER_SNAPSHOT_TEST');
    assert(snap.connectionId === 'conn-snapshot');
  });

  // AC5 Test 15: Batch reconciliation of multiple stuck receipts
  test('reconciler: batch reconciliation of multiple stuck receipts', async () => {
    const p = getPrisma();
    const orgId = 'org-ac5-15';

    const receipts = await Promise.all([
      createStuckReceipt({ organizationId: orgId }),
      createStuckReceipt({ organizationId: orgId }),
      createStuckReceipt({ organizationId: orgId }),
      createStuckReceipt({ organizationId: orgId }),
      createStuckReceipt({ organizationId: orgId }),
    ]);

    const result = await reconcileReceipts({ prisma: p, actor: 'batch-ac5-15', batchSize: 10 });

    assert(result.scanned === 5, `Should have scanned 5 receipts, got ${result.scanned}`);
    assert(result.errors.length === 0, `No errors expected, got: ${result.errors.join(', ')}`);

    const recovered = result.results.filter(r => r.action === 'RECOVERED');
    assert(recovered.length === 5, `Expected 5 recovered, got ${recovered.length}`);

    for (const rcpt of receipts) {
      const updated = await p.externalEventReceipt.findUnique({ where: { receiptId: rcpt.receiptId } });
      assert(updated.state === 'PENDING', `Receipt ${rcpt.receiptId} should be PENDING`);
    }

    const actions = await listRecoveryActions(p, { itemType: 'RECEIPT', limit: 10 });
    assert(actions.length >= 5, `Expected >=5 actions, got ${actions.length}`);
  });

  // AC5 Test 16: Intent recovery when receipt is also stuck
  test('reconciler: intent recovery when receipt is also stuck', async () => {
    const p = getPrisma();
    const orgId = 'org-ac5-16';

    const receipt = await createStuckReceipt({ organizationId: orgId });
    const intent = await createStuckIntent({ organizationId: orgId, receiptId: receipt.receiptId });

    const [receiptResult, intentResult] = await Promise.all([
      reconcileReceipts({ prisma: p, actor: 'dual-ac5-16', batchSize: 10 }),
      reconcileIntents({ prisma: p, actor: 'dual-ac5-16', batchSize: 10 }),
    ]);

    assert(receiptResult.results.some(
      r => r.receiptId === receipt.receiptId && r.action === 'RECOVERED',
    ));
    assert(intentResult.results.some(
      r => r.intentId === intent.intentId && r.action === 'RECOVERED',
    ));

    const receiptAction = await findRecoveryAction(p, { itemType: 'RECEIPT', itemId: receipt.receiptId });
    const intentAction = await findRecoveryAction(p, { itemType: 'INTENT', itemId: intent.intentId });
    assert(receiptAction !== null, 'Receipt RecoveryAction should exist');
    assert(intentAction !== null, 'Intent RecoveryAction should exist');
    assert(receiptAction.actor === 'dual-ac5-16');
    assert(intentAction.actor === 'dual-ac5-16');
  });

  // AC5 Test 17: Scheduler dedupes concurrent scans
  test('reconciler: scheduler: concurrent scans for same stuck item → dedupe', async () => {
    const p = getPrisma();
    const orgId = 'org-ac5-17';

    const receipt = await createStuckReceipt({ organizationId: orgId });

    const scheduler = new ReconciliationScheduler({
      prisma: p,
      schedulerId: 'sched-concurrent-ac5-17',
      intervalMs: 999_999_999,
    });

    const [scan1, scan2] = await Promise.all([
      scheduler.runScan(),
      scheduler.runScan(),
    ]);

    const actions = await listRecoveryActions(p, { itemType: 'RECEIPT', limit: 10 });
    const ourActions = actions.filter(a => a.itemId === receipt.receiptId);
    assert(ourActions.length === 1, `Expected 1 RecoveryAction, got ${ourActions.length}`);

    assert(scan1.stats.receiptScans >= 1);
    assert(scan2.stats.receiptScans >= 1);

    scheduler.stop();
  });

  // AC5 Test 18: completeRecoveryAction transitions status correctly
  test('completeRecoveryAction: transitions PENDING → APPLIED/SKIPPED/FAILED', async () => {
    const p = getPrisma();

    const { row } = await createRecoveryAction(p, {
      itemType: 'RECEIPT',
      itemId: 'rcpt-complete-test',
      action: 'RESET_TO_PENDING',
      actor: 'complete-test-actor',
      reason: 'Test completeRecoveryAction',
    });
    assert(row.status === 'PENDING');

    const applied = await completeRecoveryAction(p, {
      recoveryId: row.recoveryId,
      status: 'APPLIED',
      reason: 'Applied successfully',
    });
    assert(applied !== null);
    assert(applied.status === 'APPLIED');
    assert(applied.completedAt instanceof Date);

    const again = await completeRecoveryAction(p, {
      recoveryId: row.recoveryId,
      status: 'FAILED',
      reason: 'Overwrite attempt',
    });
    assert(again.status === 'APPLIED', 'Should stay APPLIED, not transition to FAILED');

    const { row: row2 } = await createRecoveryAction(p, {
      itemType: 'INTENT',
      itemId: 'intent-complete-test',
      action: 'SKIP',
      actor: 'complete-test-actor',
    });
    assert(row2.status === 'PENDING');
    const skipped = await completeRecoveryAction(p, {
      recoveryId: row2.recoveryId,
      status: 'SKIPPED',
      reason: 'Skipped because another reconciler handled it',
    });
    assert(skipped.status === 'SKIPPED');
    assert(skipped.completedAt instanceof Date);

    const { row: row3 } = await createRecoveryAction(p, {
      itemType: 'MAPPING',
      itemId: 'mapping-complete-test',
      action: 'DEAD_LETTER',
      actor: 'complete-test-actor',
    });
    const failed = await completeRecoveryAction(p, {
      recoveryId: row3.recoveryId,
      status: 'FAILED',
      reason: 'Recovery failed permanently',
    });
    assert(failed.status === 'FAILED');
  });

  // AC5 Test 19: resetStuckReceipt only resets LEASED+expired
  test('resetStuckReceipt: only resets LEASED+expired receipts', async () => {
    const p = getPrisma();
    const orgId = 'org-ac5-19';

    const pendingId = newId('rcpt-pending');
    await p.externalEventReceipt.create({
      data: {
        receiptId: pendingId,
        schemaVersion: '1',
        organizationId: orgId,
        provider: 'MOCK',
        connectionId: 'conn',
        eventId: `evt-${pendingId}`,
        payloadDigest: 'c'.repeat(64),
        state: 'PENDING',
        attempts: 0,
      },
    });

    const reset = await resetStuckReceipt(p, pendingId);
    assert(reset === false, 'PENDING receipt should not be reset');

    const stuck = await createStuckReceipt({ organizationId: orgId });
    const resetStuck = await resetStuckReceipt(p, stuck.receiptId);
    assert(resetStuck === true, 'LEASED+expired receipt should be reset');

    const resetAgain = await resetStuckReceipt(p, stuck.receiptId);
    assert(resetAgain === false, 'PENDING receipt (after reset) should not be reset again');
  });

  // AC5 Test 20: Concurrent createRecoveryAction race condition
  test('createRecoveryAction: concurrent inserts with same (itemType, itemId) → dedupe', async () => {
    const p = getPrisma();

    const [result1, result2] = await Promise.all([
      createRecoveryAction(p, {
        itemType: 'RECEIPT',
        itemId: 'rcpt-race-test',
        action: 'RESET_TO_PENDING',
        actor: 'race-actor-1',
        reason: 'Race test 1',
      }),
      createRecoveryAction(p, {
        itemType: 'RECEIPT',
        itemId: 'rcpt-race-test',
        action: 'RESET_TO_PENDING',
        actor: 'race-actor-2',
        reason: 'Race test 2',
      }),
    ]);

    const createdCount = [result1, result2].filter(r => r.created).length;
    const foundCount = [result1, result2].filter(r => !r.created).length;

    assert(createdCount === 1, `Expected 1 created, got ${createdCount}`);
    assert(foundCount === 1, `Expected 1 found (existing), got ${foundCount}`);
    assert(result1.row.recoveryId === result2.row.recoveryId,
      'Both calls should return same recoveryId');
  });
});
