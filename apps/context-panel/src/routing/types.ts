/**
 * routing/types.ts — CORE/1.11 Routing simulator types.
 *
 * Reuses contracts from Gate 0.5 (routing.ts):
 *   ROUTING_STRATEGIES, RoutingPoolSchema, RoutingWeightEntrySchema,
 *   RoutingDecisionSchema, UpdateRoutingPoolInputSchema.
 *
 * Internal types (not in contracts):
 *   - StaffState: online/offline, current capacity usage, quota usage.
 *   - SimulationResult: per-customer assignment + fallback queue.
 *   - SimulationConfig: customer count + seed (deterministic).
 *
 * This is a MOCK implementation. No real Chatwoot assignment API calls.
 */

import {
  RoutingPoolSchema,
  RoutingDecisionSchema,
  ROUTING_STRATEGIES,
  RoutingWeightEntrySchema,
} from '@hrp-engagement/contracts';
import type { z } from 'zod';

export type RoutingPool = z.infer<typeof RoutingPoolSchema>;
export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;
export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number];
export type RoutingWeightEntry = z.infer<typeof RoutingWeightEntrySchema>;

/** Staff state for simulation. */
export interface StaffState {
  actorId: string;
  role: string;
  /** Online = can receive new customers. Offline = skipped. */
  online: boolean;
  /** Number of currently active conversations (simulates concurrent load). */
  currentCapacity: number;
  /** Max concurrent conversations allowed (from pool eligibleSet.capacityGate). */
  maxCapacity: number;
  /** How many assignments already made in current period (resets per simulation). */
  periodAssignments: number;
  /** Period cap (from RoutingWeightEntry.cap). */
  periodCap: number;
  /** Period of the cap (from RoutingWeightEntry.capPeriod). */
  capPeriod: 'DAILY' | 'WEEKLY' | 'MONTHLY' | null;
}

/** Individual customer assignment result. */
export interface AssignmentSlot {
  customerIndex: number;
  assigned: boolean;
  staffActorId?: string;
  staffRole?: string;
  reason: string;
  /** Fallback reason if not assigned. */
  fallbackReason?: FallbackReason;
}

/** Why a customer went to fallback. */
export type FallbackReason =
  | 'ALL_STAFF_OFFLINE'
  | 'ALL_STAFF_AT_CAPACITY'
  | 'ALL_STAFF_QUOTA_EXHAUSTED'
  | 'NO_ELIGIBLE_WEIGHT'
  | 'WEIGHT_ZERO';

/** Result of a distribution simulation. */
export interface SimulationResult {
  poolId: string;
  poolVersion: number;
  strategy: RoutingStrategy;
  /** 'batch' (largest remainder) or 'realtime' (smooth WRR). */
  mode: string;
  customerCount: number;
  /** Ordered assignments (customerIndex 0..n-1). */
  assignments: AssignmentSlot[];
  /** Customers that could not be assigned. */
  fallbackQueue: AssignmentSlot[];
  /** Per-staff summary after simulation. */
  staffSummary: StaffSummary[];
  /** Total weight for WEIGHTED_DISTRIBUTION. */
  totalWeight: number;
  /** Seed used (for reproducibility tagging — both modes are deterministic). */
  seed: number;
}

export interface StaffSummary {
  actorId: string;
  role: string;
  assignedCount: number;
  capacityUsed: number;
  capacityMax: number;
  quotaUsed: number;
  quotaMax: number;
}

/** Fixture pool — initial seeded data for the simulator. */
export interface FixturePool {
  pool: RoutingPool;
  /** Staff states for this pool's eligible set. */
  staffStates: StaffState[];
}

/**
 * Create a fixture pool with WEIGHTED_DISTRIBUTION and the specified ratio.
 *
 * Ratio 3:2:1:4 means:
 *   - staff-A: weight=3
 *   - staff-B: weight=2
 *   - staff-C: weight=1
 *   - staff-D: weight=4
 *
 * With capacity caps: each staff has maxCapacity=25, periodCap=50.
 * For 100 customers: ~3+2+1+4=10 weight, so A gets ~30, B~20, C~10, D~40.
 */
export function makeWeightedFixturePool(
  overrides?: Partial<{
    staffAWeight: number;
    staffBWeight: number;
    staffCWeight: number;
    staffDWeight: number;
    staffAOffline: boolean;
    staffBOffline: boolean;
    staffCQuotaFull: boolean;
    staffDCapacityFull: boolean;
    /** Override max capacity for all staff (default 25). */
    maxCapacity?: number;
    /** Override period cap for all staff (default 50). */
    periodCap?: number;
  }>,
): FixturePool {
  const opts = {
    staffAWeight: 3,
    staffBWeight: 2,
    staffCWeight: 1,
    staffDWeight: 4,
    staffAOffline: false,
    staffBOffline: false,
    staffCQuotaFull: false,
    staffDCapacityFull: false,
    maxCapacity: 25,
    periodCap: 50,
    ...overrides,
  };

  const staffStates: StaffState[] = [
    {
      actorId: 'staff-sale-A',
      role: 'SALE',
      online: !opts.staffAOffline,
      currentCapacity: opts.staffAOffline ? 0 : 0,
      maxCapacity: opts.maxCapacity,
      periodAssignments: 0,
      periodCap: opts.periodCap,
      capPeriod: 'DAILY',
    },
    {
      actorId: 'staff-sale-B',
      role: 'SALE',
      online: !opts.staffBOffline,
      currentCapacity: 0,
      maxCapacity: opts.maxCapacity,
      periodAssignments: 0,
      periodCap: opts.periodCap,
      capPeriod: 'DAILY',
    },
    {
      actorId: 'staff-sale-C',
      role: 'SALE',
      online: true,
      currentCapacity: 0,
      maxCapacity: opts.maxCapacity,
      periodAssignments: opts.staffCQuotaFull ? opts.periodCap : 0,
      periodCap: opts.periodCap,
      capPeriod: 'DAILY',
    },
    {
      actorId: 'staff-sale-D',
      role: 'SALE',
      online: true,
      currentCapacity: opts.staffDCapacityFull ? opts.maxCapacity : 0,
      maxCapacity: opts.maxCapacity,
      periodAssignments: 0,
      periodCap: opts.periodCap,
      capPeriod: 'DAILY',
    },
  ];

  const weights = [
    { actorId: 'staff-sale-A', role: 'SALE', weight: opts.staffAWeight },
    { actorId: 'staff-sale-B', role: 'SALE', weight: opts.staffBWeight },
    { actorId: 'staff-sale-C', role: 'SALE', weight: opts.staffCWeight },
    { actorId: 'staff-sale-D', role: 'SALE', weight: opts.staffDWeight },
  ];

  const pool: RoutingPool = {
    schemaVersion: '1',
    organizationId: 'org-001',
    poolId: 'pool-weighted-3-2-1-4',
    displayName: 'Weighted Distribution 3:2:1:4',
    description: 'Test pool with ratio 3:2:1:4 (total 10)',
    strategy: 'WEIGHTED_DISTRIBUTION',
    eligibleSet: {
      schemaVersion: '1',
      organizationId: 'org-001',
      roles: ['SALE'],
      capacityGate: {
        maxConcurrent: 5,
        requireOnline: true,
      },
    },
    weights: weights.map((w) => ({
      schemaVersion: '1',
      recipientActorId: w.actorId,
      recipientRole: w.role as 'SALE',
      weight: w.weight,
      cap: 10,
      capPeriod: 'DAILY',
    })),
    version: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: { kind: 'USER', userId: 'staff-supervisor-001' },
  };

  return { pool, staffStates };
}

/**
 * Create a SOURCE_ALLOCATION fixture pool.
 */
export function makeSourceAllocationFixturePool(): FixturePool {
  const pool: RoutingPool = {
    schemaVersion: '1',
    organizationId: 'org-001',
    poolId: 'pool-source-alloc-001',
    displayName: 'Source Allocation (Zalo OA)',
    description: 'One-to-one assignment per source',
    strategy: 'SOURCE_ALLOCATION',
    eligibleSet: {
      schemaVersion: '1',
      organizationId: 'org-001',
      roles: ['SALE'],
    },
    fixedOwner: {
      schemaVersion: '1',
      provider: 'ZALO',
      connectionId: 'zalo-oa-001',
      recipientActorId: 'staff-sale-A',
      recipientRole: 'SALE',
    },
    version: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: { kind: 'USER', userId: 'staff-supervisor-001' },
  };
  const staffStates: StaffState[] = [
    {
      actorId: 'staff-sale-A',
      role: 'SALE',
      online: true,
      currentCapacity: 0,
      maxCapacity: 5,
      periodAssignments: 0,
      periodCap: 10,
      capPeriod: 'DAILY',
    },
  ];
  return { pool, staffStates };
}
