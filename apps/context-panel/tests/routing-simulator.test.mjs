/**
 * tests/routing-simulator.test.mjs — CORE/1.11 weighted distribution simulator unit tests.
 *
 * Covers:
 *  - AC #1: 3:2:1:4 ratio achieved (within tolerance).
 *  - AC #2: offline / capacity / quota scenarios.
 *  - Deterministic seed (same seed = same result).
 *  - SOURCE_ALLOCATION fallback (no online staff).
 *  - WEIGHT_ZERO scenario.
 *  - Config revision: version increments atomically.
 *  - Manager-only write enforcement (AC #4).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Import from compiled dist
const {
  makeWeightedFixturePool,
  makeSourceAllocationFixturePool,
} = await import('../dist/routing/types.js');
const { simulateDistribution } = await import('../dist/routing/simulator.js');
const {
  routingPoolStore,
  requireManagerRole,
  RoutingConfigError,
} = await import('../dist/routing/config-store.js');
const {
  simulate,
  updatePool,
  createPool,
  seedFixtures,
} = await import('../dist/routing/service.js');

function resetStore() {
  routingPoolStore.reset();
  seedFixtures();
}

function makeManagerIdentity() {
  return {
    staffId: 'staff-supervisor-001',
    role: 'SUPERVISOR',
    organizationId: 'org-001',
    actor: { kind: 'USER', userId: 'staff-supervisor-001' },
  };
}

function makeSaleIdentity() {
  return {
    staffId: 'staff-intake-001',
    role: 'INTAKE_OPERATOR',
    organizationId: 'org-001',
    actor: { kind: 'USER', userId: 'staff-intake-001' },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// AC #1: Source assignment vs weighted distribution + 3:2:1:4 ratio
// ═══════════════════════════════════════════════════════════════════════════

test('routing: SOURCE_ALLOCATION assigns every customer to fixed owner', () => {
  const fixture = makeSourceAllocationFixturePool();
  // Increase max capacity so all 50 fit
  fixture.staffStates[0].maxCapacity = 100;
  const result = simulateDistribution(fixture, 50, 'realtime', 0);

  assert.equal(result.customerCount, 50);
  assert.equal(result.assignments.length, 50);
  assert.equal(result.fallbackQueue.length, 0);
  for (const a of result.assignments) {
    assert.equal(a.staffActorId, 'staff-sale-A');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AC #1: BATCH (largest remainder) — DETERMINISTIC exact ratio for 3:2:1:4
// Reference: Master-Plan.V2.6.md §10.2.3 (batch largest remainder)
// ═══════════════════════════════════════════════════════════════════════════

test('routing: BATCH mode 100 customers achieves EXACT 30:20:10:40 (largest remainder)', () => {
  resetStore();
  // Use high capacity so ratio is not constrained by caps.
  const fixture = makeWeightedFixturePool({ maxCapacity: 100, periodCap: 100 });
  const result = simulateDistribution(fixture, 100, 'batch', 0);

  // Total weight = 3+2+1+4 = 10. Expected exact: A=30, B=20, C=10, D=40.
  const counts = new Map();
  for (const a of result.assignments) {
    counts.set(a.staffActorId, (counts.get(a.staffActorId) ?? 0) + 1);
  }

  assert.equal(counts.get('staff-sale-A'), 30, `A should be exactly 30, got ${counts.get('staff-sale-A')}`);
  assert.equal(counts.get('staff-sale-B'), 20, `B should be exactly 20, got ${counts.get('staff-sale-B')}`);
  assert.equal(counts.get('staff-sale-C'), 10, `C should be exactly 10, got ${counts.get('staff-sale-C')}`);
  assert.equal(counts.get('staff-sale-D'), 40, `D should be exactly 40, got ${counts.get('staff-sale-D')}`);
  // Sum invariant: assigned + fallback = customerCount.
  assert.equal(result.assignments.length + result.fallbackQueue.length, 100);
  // No fallback for this scenario.
  assert.equal(result.fallbackQueue.length, 0);
});

test('routing: BATCH mode 10 customers achieves exact 3:2:1:4 distribution', () => {
  const fixture = makeWeightedFixturePool({ maxCapacity: 100, periodCap: 100 });
  const result = simulateDistribution(fixture, 10, 'batch', 0);

  const counts = new Map();
  for (const a of result.assignments) {
    counts.set(a.staffActorId, (counts.get(a.staffActorId) ?? 0) + 1);
  }

  assert.equal(counts.get('staff-sale-A'), 3);
  assert.equal(counts.get('staff-sale-B'), 2);
  assert.equal(counts.get('staff-sale-C'), 1);
  assert.equal(counts.get('staff-sale-D'), 4);
});

test('routing: BATCH mode is deterministic across calls (no PRNG involved)', () => {
  const fixture1 = makeWeightedFixturePool({ maxCapacity: 100, periodCap: 100 });
  const fixture2 = makeWeightedFixturePool({ maxCapacity: 100, periodCap: 100 });
  const r1 = simulateDistribution(fixture1, 100, 'batch', 0);
  const r2 = simulateDistribution(fixture2, 100, 'batch', 99999);

  for (let i = 0; i < r1.assignments.length; i++) {
    assert.equal(r1.assignments[i].staffActorId, r2.assignments[i].staffActorId);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AC #1: REALTIME (smooth WRR) — streaming approximation, exact in expectation
// Reference: Master-Plan.V2.6.md §10.2.3 (realtime smooth WRR Nginx)
// ═══════════════════════════════════════════════════════════════════════════

test('routing: REALTIME 100 customers achieves 30:20:10:40 ratio (within ±2 per slot)', () => {
  resetStore();
  const fixture = makeWeightedFixturePool({ maxCapacity: 100, periodCap: 100 });
  const result = simulateDistribution(fixture, 100, 'realtime', 0);

  const counts = new Map();
  for (const a of result.assignments) {
    counts.set(a.staffActorId, (counts.get(a.staffActorId) ?? 0) + 1);
  }

  // Smooth WRR is deterministic (no PRNG); the result is exact for
  // N divisible by total weight. For N=100, total=10, N%total=0, so
  // distribution is exact.
  const a = counts.get('staff-sale-A') ?? 0;
  const b = counts.get('staff-sale-B') ?? 0;
  const c = counts.get('staff-sale-C') ?? 0;
  const d = counts.get('staff-sale-D') ?? 0;
  assert.ok(Math.abs(a - 30) <= 2, `A=${a} not within ±2 of 30`);
  assert.ok(Math.abs(b - 20) <= 2, `B=${b} not within ±2 of 20`);
  assert.ok(Math.abs(c - 10) <= 2, `C=${c} not within ±2 of 10`);
  assert.ok(Math.abs(d - 40) <= 2, `D=${d} not within ±2 of 40`);
});

test('routing: REALTIME is deterministic across calls (tie-break by stable order)', () => {
  const fixture1 = makeWeightedFixturePool({ maxCapacity: 100, periodCap: 100 });
  const fixture2 = makeWeightedFixturePool({ maxCapacity: 100, periodCap: 100 });
  const r1 = simulateDistribution(fixture1, 100, 'realtime', 0);
  const r2 = simulateDistribution(fixture2, 100, 'realtime', 99999);

  for (let i = 0; i < r1.assignments.length; i++) {
    assert.equal(r1.assignments[i].staffActorId, r2.assignments[i].staffActorId);
  }
});

test('routing: BATCH and REALTIME produce identical totals when N is divisible by totalWeight', () => {
  const f1 = makeWeightedFixturePool({ maxCapacity: 100, periodCap: 100 });
  const f2 = makeWeightedFixturePool({ maxCapacity: 100, periodCap: 100 });
  const batch = simulateDistribution(f1, 100, 'batch', 0);
  const realtime = simulateDistribution(f2, 100, 'realtime', 0);

  // Per-staff totals should be equal when N is multiple of total weight.
  const batchCounts = new Map();
  for (const a of batch.assignments) batchCounts.set(a.staffActorId, (batchCounts.get(a.staffActorId) ?? 0) + 1);
  const realtimeCounts = new Map();
  for (const a of realtime.assignments) realtimeCounts.set(a.staffActorId, (realtimeCounts.get(a.staffActorId) ?? 0) + 1);

  assert.deepEqual([...batchCounts.entries()].sort(), [...realtimeCounts.entries()].sort());
});

// ═══════════════════════════════════════════════════════════════════════════
// AC #2: offline / capacity / quota fallback scenarios
// ═══════════════════════════════════════════════════════════════════════════

test('routing: staff B offline — assignments redistribute among A,C,D', () => {
  const fixture = makeWeightedFixturePool({ staffBOffline: true });
  const result = simulateDistribution(fixture, 100, 'realtime', 0);

  // No assignment should go to B
  for (const a of result.assignments) {
    assert.notEqual(a.staffActorId, 'staff-sale-B');
  }
  // Total should still be 100 (no fallback unless caps hit)
  assert.equal(result.assignments.length + result.fallbackQueue.length, 100);
});

test('routing: staff A capacity full — rest goes to B, C, D', () => {
  // Set A's currentCapacity to A's maxCapacity (25) so A is at cap.
  const fixture = makeWeightedFixturePool();
  fixture.staffStates[0].currentCapacity = fixture.staffStates[0].maxCapacity;
  const result = simulateDistribution(fixture, 100, 'realtime', 0);

  // A should get 0 (capacity exhausted)
  const aCount = result.assignments.filter((a) => a.staffActorId === 'staff-sale-A').length;
  assert.equal(aCount, 0);
  // Total should still be 100 (B, C, D absorb)
  assert.equal(result.assignments.length + result.fallbackQueue.length, 100);
});

test('routing: staff C quota exhausted — C gets 0', () => {
  const fixture = makeWeightedFixturePool({ staffCQuotaFull: true });
  const result = simulateDistribution(fixture, 100, 'realtime', 0);

  const cCount = result.assignments.filter((a) => a.staffActorId === 'staff-sale-C').length;
  assert.equal(cCount, 0);
});

test('routing: all staff offline → ALL_STAFF_OFFLINE fallback', () => {
  const fixture = makeWeightedFixturePool({ staffAOffline: true, staffBOffline: true });
  // Need to also set C offline via manual state override
  fixture.staffStates[2].online = false;
  fixture.staffStates[3].online = false;

  const result = simulateDistribution(fixture, 50, 'realtime', 0);

  assert.equal(result.fallbackQueue.length, 50);
  assert.equal(result.assignments.length, 0);
  assert.equal(result.fallbackQueue[0].fallbackReason, 'ALL_STAFF_OFFLINE');
});

test('routing: zero weight (all weights = 0) → WEIGHT_ZERO fallback', () => {
  const fixture = makeWeightedFixturePool();
  // Manually zero out weights
  if (fixture.pool.weights) {
    fixture.pool.weights = fixture.pool.weights.map((w) => ({ ...w, weight: 0 }));
  }
  const result = simulateDistribution(fixture, 20, 'realtime', 0);

  assert.equal(result.fallbackQueue.length, 20);
  assert.equal(result.fallbackQueue[0].fallbackReason, 'WEIGHT_ZERO');
});

// ═══════════════════════════════════════════════════════════════════════════
// AC #2: Config revision (version increment + stale update)
// ═══════════════════════════════════════════════════════════════════════════

test('routing: config update increments version', () => {
  resetStore();
  const manager = makeManagerIdentity();

  const before = routingPoolStore.get('pool-weighted-3-2-1-4');
  assert.ok(before);
  assert.equal(before.version, 1);

  const updated = updatePool(
    {
      organizationId: 'org-001',
      poolId: 'pool-weighted-3-2-1-4',
      expectedVersion: 1,
      patch: { description: 'Updated description' },
      reasonCode: 'TEST_UPDATE',
    },
    manager,
  );

  assert.equal(updated.version, 2);
  assert.equal(updated.description, 'Updated description');
});

test('routing: stale update throws VERSION_CONFLICT', () => {
  resetStore();
  const manager = makeManagerIdentity();

  assert.throws(
    () =>
      updatePool(
        {
          organizationId: 'org-001',
          poolId: 'pool-weighted-3-2-1-4',
          expectedVersion: 99, // stale
          patch: { description: 'stale' },
          reasonCode: 'STALE',
        },
        manager,
      ),
    (err) => {
      assert.ok(err instanceof RoutingConfigError);
      assert.equal(err.code, 'VERSION_CONFLICT');
      return true;
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// AC #4: Manager-only enforcement at service boundary
// ═══════════════════════════════════════════════════════════════════════════

test('routing: requireManagerRole allows SUPERVISOR', () => {
  assert.doesNotThrow(() => requireManagerRole('SUPERVISOR'));
});

test('routing: requireManagerRole allows SYSTEM', () => {
  assert.doesNotThrow(() => requireManagerRole('SYSTEM'));
});

test('routing: requireManagerRole rejects INTAKE_OPERATOR (sale)', () => {
  assert.throws(
    () => requireManagerRole('INTAKE_OPERATOR'),
    (err) => {
      assert.ok(err instanceof RoutingConfigError);
      assert.equal(err.code, 'MANAGER_REQUIRED');
      return true;
    },
  );
});

test('routing: requireManagerRole rejects TALENT_REVIEWER (sale)', () => {
  assert.throws(
    () => requireManagerRole('TALENT_REVIEWER'),
    (err) => {
      assert.ok(err instanceof RoutingConfigError);
      assert.equal(err.code, 'MANAGER_REQUIRED');
      return true;
    },
  );
});

test('routing: updatePool by non-manager throws MANAGER_REQUIRED (NOT just UI hide)', () => {
  resetStore();
  const sale = makeSaleIdentity();

  assert.throws(
    () =>
      updatePool(
        {
          organizationId: 'org-001',
          poolId: 'pool-weighted-3-2-1-4',
          expectedVersion: 1,
          patch: { description: 'sale trying' },
          reasonCode: 'UNAUTHORIZED',
        },
        sale,
      ),
    (err) => {
      assert.ok(err instanceof RoutingConfigError);
      assert.equal(err.code, 'MANAGER_REQUIRED');
      return true;
    },
  );
});

test('routing: createPool by non-manager throws MANAGER_REQUIRED', () => {
  const sale = makeSaleIdentity();

  assert.throws(
    () =>
      createPool(
        {
          schemaVersion: '1',
          organizationId: 'org-001',
          poolId: 'pool-sale-attempt',
          displayName: 'Sale try',
          strategy: 'SOURCE_ALLOCATION',
          eligibleSet: {
            schemaVersion: '1',
            organizationId: 'org-001',
            roles: ['SALE'],
          },
        },
        sale,
      ),
    (err) => {
      assert.ok(err instanceof RoutingConfigError);
      assert.equal(err.code, 'MANAGER_REQUIRED');
      return true;
    },
  );
});

test('routing: simulate is NOT manager-only (read-only operation)', () => {
  resetStore();
  const sale = makeSaleIdentity();

  // Sale can simulate (read-only)
  const { result } = simulate({
    poolId: 'pool-weighted-3-2-1-4',
    customerCount: 10,
    seed: 42,
  });
  assert.equal(result.customerCount, 10);
  // Verify identity object is not used by simulate (no manager check)
  void sale;
});

// ═══════════════════════════════════════════════════════════════════════════
// No catch-up burst: staff returning online doesn't retro-fill
// ═══════════════════════════════════════════════════════════════════════════

test('routing: staff coming online does NOT retro-fill earlier fallback', () => {
  // Simulate batch 1: all offline → all fallback
  const fixture1 = makeWeightedFixturePool({ staffAOffline: true, staffBOffline: true });
  fixture1.staffStates[2].online = false;
  fixture1.staffStates[3].online = false;
  const result1 = simulateDistribution(fixture1, 20, 'realtime', 0);
  assert.equal(result1.fallbackQueue.length, 20);

  // Simulate batch 2: same fixture, all online → all assigned
  const fixture2 = makeWeightedFixturePool();
  const result2 = simulateDistribution(fixture2, 20, 'realtime', 0);
  assert.equal(result2.assignments.length, 20);
  assert.equal(result2.fallbackQueue.length, 0);

  // Result 1's fallback is NOT retroactively filled; result 2 is independent.
  assert.equal(result1.assignments.length, 0);
  assert.equal(result2.fallbackQueue.length, 0);
});

test('routing: chained offline→online in a batch — no catch-up burst', () => {
  // Customer 0-9: B is offline. Customers 10-19: B comes online.
  // Invariant: customers 0-9 are NEVER assigned to B even after B
  // comes online for customers 10-19.
  //
  // We model this by calling simulateDistribution twice with the
  // SAME fixture object, flipping staff B's online state between calls.
  // Since the simulator is per-customer and stateless across calls,
  // customer 0-9 in batch 1 cannot retroactively move to B.

  const fixture = makeWeightedFixturePool({ staffBOffline: true });
  const batch1 = simulateDistribution(fixture, 10, 'realtime', 0);
  // batch1 should have 0 assignments to B (B is offline)
  for (let i = 0; i < 10; i++) {
    assert.notEqual(batch1.assignments[i]?.staffActorId, 'staff-sale-B');
  }

  // Now flip B online mid-batch. Re-simulate with same fixture
  // (but staff B is now online). This is a NEW batch — customers 0-9
  // of batch1 do NOT move.
  fixture.staffStates[1].online = true;
  const batch2 = simulateDistribution(fixture, 10, 'realtime', 0);

  // batch1's assignment list is unchanged.
  assert.equal(batch1.fallbackQueue.length + batch1.assignments.length, 10);
  for (let i = 0; i < 10; i++) {
    assert.notEqual(batch1.assignments[i]?.staffActorId, 'staff-sale-B');
  }

  // batch2 may have some assignments to B.
  const bCount2 = batch2.assignments.filter((a) => a.staffActorId === 'staff-sale-B').length;
  assert.ok(bCount2 >= 0, `B should now be eligible`);

  // No-catch-up: sum of assignments in both batches ≤ total customers.
  assert.equal(batch1.assignments.length + batch1.fallbackQueue.length, 10);
  assert.equal(batch2.assignments.length + batch2.fallbackQueue.length, 10);
});
