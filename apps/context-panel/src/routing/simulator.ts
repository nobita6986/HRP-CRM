/**
 * routing/simulator.ts — CORE/1.11 Weighted distribution simulator.
 *
 * Two algorithms (per Master V2.6 §10.2.3 PROPOSED):
 *
 * 1. BATCH — Largest remainder method (Hare quota / Hamilton):
 *    quota_i = N × weight_i / totalWeight (real number).
 *    Each recipient gets floor(quota_i) base; remainder slots go to
 *    recipients with the largest fractional parts (tie-break by stable
 *    sort on actorId). Result is DETERMINISTIC — same inputs give
 *    identical output without any PRNG.
 *    Reference: Master-Plan.V2.6.md §10.2.3 (batch active campaign).
 *
 * 2. REALTIME — Smooth weighted round-robin (Nginx algorithm):
 *    Each customer increments currentWeight[i] by weight_i; pick the
 *    recipient with highest currentWeight (tie-break by stable sort on
 *    actorId); subtract totalWeight from chosen. Result is a streaming
 *    approximation; for large N approaches exact ratio.
 *    Reference: Master-Plan.V2.6.md §10.2.3 (realtime smooth WRR).
 *
 * Deterministic invariants:
 *  - Batch mode: same (N, weights, eligible set) → identical sequence.
 *  - Realtime mode: deterministic because tie-break is stable (NO PRNG).
 *  - Same pool + same staff states + same mode → identical results
 *    across runs.
 *
 * No-catch-up-burst invariant:
 *  - Each call to simulateDistribution() is independent.
 *  - Caller may mutate staff states between calls; the simulator
 *    NEVER retroactively reassigns earlier customers to staff who
 *    came online later. There is no shared state between calls.
 *
 * This is a MOCK. No real Chatwoot assignment API calls.
 */

import type {
  SimulationResult,
  AssignmentSlot,
  StaffState,
  StaffSummary,
  FallbackReason,
  FixturePool,
} from './types.js';

export type SimulationMode = 'batch' | 'realtime';

/* ───────────────────────────────────────────────────────────────────────────
 * Smooth weighted round-robin (Nginx algorithm)
 *
 * State: per-staff currentWeight accumulator.
 * Per customer: add weight[i] to currentWeight[i]; pick staff with
 * max currentWeight (tie-break by stable sort); subtract totalWeight
 * from chosen.
 * ─────────────────────────────────────────────────────────────────────────── */

interface WrrState {
  staffStates: StaffState[];
  /** Per-staff currentWeight accumulator (parallel to staffStates). */
  currentWeights: number[];
  totalWeight: number;
}

function initWrr(
  states: StaffState[],
  weights: ReadonlyArray<{ recipientActorId: string; weight: number }>,
): WrrState {
  const currentWeights = states.map((s) => 0);
  const totalWeight = weights.reduce((s, w) => s + w.weight, 0);
  return { staffStates: states, currentWeights, totalWeight };
}

/**
 * Pick one staff via smooth WRR.
 * Returns null if no eligible staff remain (caller should fallback).
 * Mutates currentWeights in place.
 */
function wrrPick(
  wrr: WrrState,
  weights: ReadonlyArray<{ recipientActorId: string; weight: number }>,
): StaffState | null {
  const eligibleIdx: number[] = [];
  wrr.staffStates.forEach((s, i) => {
    if (s.online && !isAtCapacity(s) && !isQuotaExhausted(s)) {
      eligibleIdx.push(i);
    }
  });
  if (eligibleIdx.length === 0) return null;

  // Add weight to currentWeight for each eligible.
  for (const i of eligibleIdx) {
    const s = wrr.staffStates[i]!;
    const w = weights.find((wt) => wt.recipientActorId === s.actorId)?.weight ?? 0;
    wrr.currentWeights[i] = (wrr.currentWeights[i] ?? 0) + w;
  }

  // Pick max (tie-break by staffStates order, which is stable).
  let bestIdx = eligibleIdx[0]!;
  let bestWeight = wrr.currentWeights[bestIdx]!;
  for (let k = 1; k < eligibleIdx.length; k++) {
    const i = eligibleIdx[k]!;
    if ((wrr.currentWeights[i] ?? 0) > bestWeight) {
      bestWeight = wrr.currentWeights[i] ?? 0;
      bestIdx = i;
    }
  }

  // Subtract totalWeight from chosen.
  wrr.currentWeights[bestIdx] = (wrr.currentWeights[bestIdx] ?? 0) - wrr.totalWeight;

  return wrr.staffStates[bestIdx]!;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Largest remainder method (Hamilton)
 *
 * Compute quota_i = N × weight_i / totalWeight for each eligible staff.
 * Each staff gets floor(quota_i). The remaining N - sum(floor) slots
 * go to recipients with the largest fractional parts. Tie-break by
 * actorId (stable sort).
 *
 * Result: deterministic and exact ratio (modulo capacity/quota
 * constraints).
 * ─────────────────────────────────────────────────────────────────────────── */

interface QuotaPlan {
  actorId: string;
  baseCount: number; // floor of quota
  fractional: number; // fractional part
}

function computeQuotaPlan(
  N: number,
  weights: ReadonlyArray<{ recipientActorId: string; weight: number }>,
  states: StaffState[],
): QuotaPlan[] {
  const eligible = states.filter(
    (s) => s.online && !isAtCapacity(s) && !isQuotaExhausted(s),
  );
  const eligibleIds = new Set(eligible.map((s) => s.actorId));
  const eligibleWeights = weights.filter((w) => eligibleIds.has(w.recipientActorId) && w.weight > 0);

  if (eligibleWeights.length === 0) return [];

  const totalW = eligibleWeights.reduce((s, w) => s + w.weight, 0);
  const plans: QuotaPlan[] = eligibleWeights.map((w) => {
    const exact = (N * w.weight) / totalW;
    const baseCount = Math.floor(exact);
    return {
      actorId: w.recipientActorId,
      baseCount,
      fractional: exact - baseCount,
    };
  });

  let assigned = plans.reduce((s, p) => s + p.baseCount, 0);
  let remainder = N - assigned;

  if (remainder < 0) {
    // Capacity/quota may reduce N; in that case floor of one recipient
    // can exceed available slots. Distribute remaining N from top
    // fractional down. Caller's N is the *requested* count, not the
    // *assignable* count (after capacity/quota). We compute by
    // eligible capacity, not raw N. For mock, we treat N as upper bound.
    remainder = Math.max(0, remainder);
  }

  // Sort by fractional desc, then actorId asc (stable).
  plans.sort((a, b) => {
    if (b.fractional !== a.fractional) return b.fractional - a.fractional;
    return a.actorId < b.actorId ? -1 : a.actorId > b.actorId ? 1 : 0;
  });

  // Distribute remainder by index order.
  for (let i = 0; i < remainder && i < plans.length; i++) {
    plans[i]!.baseCount++;
  }

  return plans;
}

function planToQueue(plans: QuotaPlan[]): Array<{ actorId: string; remaining: number }> {
  // Convert plan to a queue; iterate in stable order (by actorId).
  const result = plans.map((p) => ({ actorId: p.actorId, remaining: p.baseCount }));
  result.sort((a, b) => (a.actorId < b.actorId ? -1 : a.actorId > b.actorId ? 1 : 0));
  return result;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Eligibility helpers
 * ─────────────────────────────────────────────────────────────────────────── */

function isAtCapacity(s: StaffState): boolean {
  return s.currentCapacity >= s.maxCapacity;
}

function isQuotaExhausted(s: StaffState): boolean {
  if (!s.capPeriod || s.periodCap === 0) return false;
  return s.periodAssignments >= s.periodCap;
}

function classifyFallback(states: StaffState[]): FallbackReason {
  const anyOnline = states.some((s) => s.online);
  if (!anyOnline) return 'ALL_STAFF_OFFLINE';

  const anyCapacity = states.some((s) => s.online && !isAtCapacity(s));
  if (!anyCapacity) return 'ALL_STAFF_AT_CAPACITY';

  const anyQuota = states.some((s) => s.online && !isQuotaExhausted(s));
  if (!anyQuota) return 'ALL_STAFF_QUOTA_EXHAUSTED';

  return 'NO_ELIGIBLE_WEIGHT';
}

/* ───────────────────────────────────────────────────────────────────────────
 * Simulation entry point
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Simulate routing N customers through the pool.
 *
 * @param fixture   - seeded pool + staff states
 * @param count     - number of customers to simulate
 * @param mode      - 'batch' (largest remainder) or 'realtime' (smooth WRR)
 * @param seed      - DEPRECATED: both modes are now deterministic; kept
 *                    for API compatibility. The value is recorded in
 *                    SimulationResult.seed for reproducibility tagging.
 */
export function simulateDistribution(
  fixture: FixturePool,
  count: number,
  mode: SimulationMode = 'realtime',
  seed: number = 0,
): SimulationResult {
  const { pool, staffStates } = fixture;
  const totalWeight = pool.weights
    ? pool.weights.reduce((s, w) => s + w.weight, 0)
    : 0;

  // Clone staff states so multiple simulations don't mutate shared state.
  const states = staffStates.map((s) => ({ ...s, periodAssignments: s.periodAssignments }));
  const assignments: AssignmentSlot[] = [];
  const fallbackQueue: AssignmentSlot[] = [];

  // Pre-compute batch plan if mode = batch.
  let batchQueue: Array<{ actorId: string; remaining: number }> | null = null;
  let batchIndex = 0;
  if (mode === 'batch' && pool.strategy === 'WEIGHTED_DISTRIBUTION') {
    const plan = computeQuotaPlan(count, pool.weights ?? [], states);
    batchQueue = planToQueue(plan);
  }

  // Pre-compute WRR state if mode = realtime.
  const wrr = mode === 'realtime' && pool.strategy === 'WEIGHTED_DISTRIBUTION'
    ? initWrr(states, pool.weights ?? [])
    : null;

  for (let i = 0; i < count; i++) {
    const slot = assignOneCustomer(
      i,
      pool.strategy,
      pool.weights ?? [],
      states,
      totalWeight,
      mode,
      batchQueue,
      batchIndex,
      wrr,
    );
    batchIndex++;
    if (slot.assigned) {
      assignments.push(slot);
    } else {
      fallbackQueue.push(slot);
    }
  }

  const staffSummary: StaffSummary[] = states.map((s) => ({
    actorId: s.actorId,
    role: s.role,
    assignedCount: s.periodAssignments,
    capacityUsed: s.currentCapacity,
    capacityMax: s.maxCapacity,
    quotaUsed: s.periodAssignments,
    quotaMax: s.capPeriod ? s.periodCap : 0,
  }));

  return {
    poolId: pool.poolId,
    poolVersion: pool.version,
    strategy: pool.strategy,
    mode,
    customerCount: count,
    assignments,
    fallbackQueue,
    staffSummary,
    totalWeight,
    seed,
  };
}

interface AssignmentInputs {
  wrr?: WrrState | null;
  batchQueue?: Array<{ actorId: string; remaining: number }> | null;
}

function assignOneCustomer(
  customerIndex: number,
  strategy: string,
  weights: ReadonlyArray<{ recipientActorId: string; recipientRole: string; weight: number }>,
  states: StaffState[],
  totalWeight: number,
  mode: SimulationMode,
  batchQueue: Array<{ actorId: string; remaining: number }> | null,
  batchIndex: number,
  wrr: WrrState | null,
): AssignmentSlot {
  if (strategy === 'SOURCE_ALLOCATION') {
    // One-to-one: first online staff (or fallback).
    const online = states.filter((s) => s.online && !isAtCapacity(s));
    if (online.length === 0) {
      return {
        customerIndex,
        assigned: false,
        fallbackReason: 'ALL_STAFF_OFFLINE',
        reason: 'SOURCE_ALLOCATION: no online staff',
      };
    }
    const chosen = online[0]!;
    chosen.currentCapacity++;
    chosen.periodAssignments++;
    return {
      customerIndex,
      assigned: true,
      staffActorId: chosen.actorId,
      staffRole: chosen.role,
      reason: 'SOURCE_ALLOCATION: fixed owner',
    };
  }

  // WEIGHTED_DISTRIBUTION
  if (weights.length === 0 || totalWeight === 0) {
    return {
      customerIndex,
      assigned: false,
      fallbackReason: 'WEIGHT_ZERO',
      reason: 'WEIGHTED_DISTRIBUTION: no eligible weight',
    };
  }

  // Choose algorithm based on mode.
  let chosen: StaffState | null = null;

  if (mode === 'batch' && batchQueue) {
    chosen = batchPick(batchQueue, batchIndex, states);
  } else if (mode === 'realtime' && wrr) {
    chosen = wrrPick(wrr, weights);
  }

  if (!chosen) {
    const reason = classifyFallback(states);
    return {
      customerIndex,
      assigned: false,
      fallbackReason: reason,
      reason: `WEIGHTED_DISTRIBUTION (${mode}): ${reason}`,
    };
  }

  chosen.currentCapacity++;
  chosen.periodAssignments++;

  return {
    customerIndex,
    assigned: true,
    staffActorId: chosen.actorId,
    staffRole: chosen.role,
    reason: `WEIGHTED_DISTRIBUTION (${mode}): slot ${customerIndex}`,
  };
}

function batchPick(
  queue: Array<{ actorId: string; remaining: number }>,
  _index: number,
  states: StaffState[],
): StaffState | null {
  // Round-robin through the plan. If a recipient runs out of capacity
  // mid-batch, skip them (they may still have quota but no capacity
  // for next customer).
  for (let k = 0; k < queue.length; k++) {
    const entry = queue[k]!;
    if (entry.remaining <= 0) continue;
    const s = states.find((ss) => ss.actorId === entry.actorId);
    if (!s) continue;
    if (!s.online || isAtCapacity(s) || isQuotaExhausted(s)) continue;
    entry.remaining--;
    return s;
  }
  return null;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Helpers for the UI
 * ─────────────────────────────────────────────────────────────────────────── */

/** Aggregate assignment counts by staff. */
export function aggregateAssignments(result: SimulationResult): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of result.assignments) {
    if (a.staffActorId) {
      map.set(a.staffActorId, (map.get(a.staffActorId) ?? 0) + 1);
    }
  }
  return map;
}

/** Distribution ratios from assignment counts. */
export function computeRatios(result: SimulationResult): Map<string, string> {
  const counts = aggregateAssignments(result);
  const total = result.assignments.length;
  const map = new Map<string, string>();
  for (const [actorId, count] of counts) {
    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
    map.set(actorId, `${count}/${total} (${pct}%)`);
  }
  return map;
}
