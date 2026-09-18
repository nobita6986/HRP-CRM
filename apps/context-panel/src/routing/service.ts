/**
 * routing/service.ts — CORE/1.11 Routing service API (server-side).
 *
 * Exported functions called by server routes. Each validates role before
 * performing mutations (AC #4: manager-only for write operations).
 *
 * Reuses contracts: RoutingPoolSchema, UpdateRoutingPoolInputSchema,
 * ROUTING_STRATEGIES, ROUTING_PATCH_FORBIDDEN (Gate 0.5).
 *
 * This is a MOCK. No real Chatwoot assignment API calls.
 */

import type { MockIdentity } from '../orchestrator-wire.js';
import type {
  SimulationResult,
  FixturePool,
} from './types.js';
import {
  makeWeightedFixturePool,
  makeSourceAllocationFixturePool,
} from './types.js';
import { simulateDistribution } from './simulator.js';
import {
  routingPoolStore,
  requireManagerRole,
} from './config-store.js';
import type { RoutingPool, RoutingDecision } from './types.js';
import {
  RoutingPoolSchema,
  ROUTING_PATCH_FORBIDDEN,
} from '@hrp-engagement/contracts';

/* ───────────────────────────────────────────────────────────────────────────
 * Pool read — anyone with valid identity can read
 * ─────────────────────────────────────────────────────────────────────────── */

export interface PoolListResult {
  pools: RoutingPool[];
}

export function listPools(): PoolListResult {
  return { pools: routingPoolStore.list() };
}

export function getPool(poolId: string): RoutingPool {
  const pool = routingPoolStore.get(poolId);
  if (!pool) throw { errorCode: 'POOL_NOT_FOUND', message: `Pool ${poolId} not found.` };
  return pool;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Simulation — read-only, no auth gate beyond valid identity
 * ─────────────────────────────────────────────────────────────────────────── */

export interface SimulateRequest {
  poolId: string;
  customerCount: 10 | 100;
  /** Algorithm: 'batch' (largest remainder) or 'realtime' (smooth WRR). */
  mode?: 'batch' | 'realtime';
  seed?: number;
  /** Override pool weights for this simulation (optional). */
  weightOverrides?: Array<{ actorId: string; weight: number }>;
}

export interface SimulateResult {
  result: SimulationResult;
  pool: RoutingPool;
}

export function simulate(req: SimulateRequest): SimulateResult {
  const pool = routingPoolStore.get(req.poolId);
  if (!pool) throw { errorCode: 'POOL_NOT_FOUND', message: `Pool ${req.poolId} not found.` };

  // Build fixture with current pool weights
  let fixture: FixturePool;
  if (pool.strategy === 'SOURCE_ALLOCATION') {
    fixture = makeSourceAllocationFixturePool();
    fixture.pool = { ...pool }; // use current pool state
  } else {
    fixture = makeWeightedFixturePool();
    fixture.pool = { ...pool }; // use current pool state

    // Apply weight overrides if provided
    if (req.weightOverrides && req.weightOverrides.length > 0) {
      fixture.pool = {
        ...fixture.pool,
        weights: fixture.pool.weights?.map((w) => {
          const override = req.weightOverrides!.find((o) => o.actorId === w.recipientActorId);
          if (override) {
            return { ...w, weight: override.weight };
          }
          return w;
        }),
      };
    }
  }

  const mode = req.mode ?? 'realtime';
  const seed = req.seed ?? 0;
  const result = simulateDistribution(fixture, req.customerCount, mode, seed);

  return { result, pool: fixture.pool };
}

/* ───────────────────────────────────────────────────────────────────────────
 * Pool write — MANAGER ONLY
 * ─────────────────────────────────────────────────────────────────────────── */

export interface UpdatePoolRequest {
  organizationId: string;
  poolId: string;
  expectedVersion: number;
  patch: {
    displayName?: string;
    description?: string;
    strategy?: RoutingPool['strategy'];
    eligibleSet?: RoutingPool['eligibleSet'];
    fixedOwner?: RoutingPool['fixedOwner'];
    weights?: RoutingPool['weights'];
  };
  reasonCode: string;
}

export function updatePool(
  req: UpdatePoolRequest,
  identity: MockIdentity,
): RoutingPool {
  // AC #4: Manager-only enforcement at service boundary.
  requireManagerRole(identity.role);

  // Validate patch fields against FORBIDDEN list
  for (const key of Object.keys(req.patch)) {
    if ((ROUTING_PATCH_FORBIDDEN as readonly string[]).includes(key)) {
      throw {
        errorCode: 'FORBIDDEN_FIELD',
        message: `Field "${key}" is not allowed in routing pool patch.`,
      };
    }
  }

  const updated = routingPoolStore.update({
    poolId: req.poolId,
    expectedVersion: req.expectedVersion,
    updatedBy: identity.staffId,
    reasonCode: req.reasonCode,
    patch: req.patch as Partial<RoutingPool>,
  });

  return updated;
}

export function createPool(
  req: Omit<RoutingPool, 'version' | 'updatedAt' | 'updatedBy'>,
  identity: MockIdentity,
): RoutingPool {
  // AC #4: Manager-only enforcement at service boundary.
  requireManagerRole(identity.role);

  const pool: RoutingPool = {
    ...req,
    version: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: { kind: 'USER', userId: identity.staffId },
  };

  RoutingPoolSchema.parse(pool); // validate shape
  routingPoolStore.put(pool);
  return pool;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Seed initial fixture pools
 * ─────────────────────────────────────────────────────────────────────────── */

export function seedFixtures(): void {
  const { pool: weightedPool, staffStates: _ws } = makeWeightedFixturePool();
  routingPoolStore.seed([weightedPool]);
}
