/**
 * routing/config-store.ts — CORE/1.11 In-memory routing pool store.
 *
 * Stores pool configurations with version-based optimistic concurrency.
 * Config revision rules:
 *   - Update requires expectedVersion (optimistic locking)
 *   - Version increments atomically on successful update
 *   - stale update → VERSION_CONFLICT (caller must read and retry)
 *
 * This is a MOCK. No real persistence (lost on server restart).
 */

import type { RoutingPool, RoutingDecision } from './types.js';
import {
  UpdateRoutingPoolInputSchema,
  RoutingPoolSchema,
} from '@hrp-engagement/contracts';
import { z } from 'zod';

export interface ConfigRevision {
  poolId: string;
  expectedVersion: number;
  updatedBy: string;
  reasonCode: string;
  patch: RoutingPool['schemaVersion'] extends string
    ? Record<string, unknown>
    : never;
  updatedAt: string;
}

/** Global singleton pool store (mirrors reviewStore pattern). */
class RoutingPoolStore {
  private readonly pools = new Map<string, RoutingPool>();

  /** List all pools. */
  list(): RoutingPool[] {
    return [...this.pools.values()];
  }

  /** Get pool by ID. */
  get(poolId: string): RoutingPool | null {
    return this.pools.get(poolId) ?? null;
  }

  /** Put pool (create or replace). */
  put(pool: RoutingPool): void {
    RoutingPoolSchema.parse(pool); // validate shape
    this.pools.set(pool.poolId, pool);
  }

  /**
   * Update pool with optimistic concurrency check.
   * Throws VERSION_CONFLICT if expectedVersion does not match current version.
   * Throws POOL_NOT_FOUND if poolId does not exist.
   */
  update(input: {
    poolId: string;
    expectedVersion: number;
    updatedBy: string;
    reasonCode: string;
    patch: Partial<RoutingPool>;
  }): RoutingPool {
    const current = this.pools.get(input.poolId);
    if (!current) {
      throw new RoutingConfigError('POOL_NOT_FOUND', `Pool ${input.poolId} not found`);
    }
    if (current.version !== input.expectedVersion) {
      throw new RoutingConfigError(
        'VERSION_CONFLICT',
        `Version conflict: expected ${input.expectedVersion}, current ${current.version}`,
      );
    }

    // Apply patch
    const merged: RoutingPool = {
      ...current,
      ...input.patch,
      poolId: current.poolId, // immutable
      organizationId: current.organizationId, // immutable
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: { kind: 'USER', userId: input.updatedBy },
    };

    RoutingPoolSchema.parse(merged);
    this.pools.set(input.poolId, merged);
    return merged;
  }

  /** Seed initial fixture pools (called once on startup). */
  seed(pools: RoutingPool[]): void {
    for (const pool of pools) {
      RoutingPoolSchema.parse(pool);
      this.pools.set(pool.poolId, pool);
    }
  }

  /** Reset all pools (for tests). */
  reset(): void {
    this.pools.clear();
  }
}

export class RoutingConfigError extends Error {
  constructor(
    public code: RoutingConfigErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RoutingConfigError';
  }
}

export type RoutingConfigErrorCode =
  | 'POOL_NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'VALIDATION_ERROR'
  | 'MANAGER_REQUIRED';

/** Singleton store. */
export const routingPoolStore = new RoutingPoolStore();

/* ───────────────────────────────────────────────────────────────────────────
 * Manager-only write enforcement.
 *
 * AC #4: AI/sale không tự sửa weights nếu thiếu manager capability.
 * This function enforces at the SERVICE BOUNDARY — not just UI hide.
 * ─────────────────────────────────────────────────────────────────────────── */

export function requireManagerRole(role: string): void {
  const MANAGER_ROLES = new Set(['SUPERVISOR', 'SYSTEM']);
  if (!MANAGER_ROLES.has(role)) {
    throw new RoutingConfigError(
      'MANAGER_REQUIRED',
      'Chỉ quản lý (SUPERVISOR/SYSTEM) mới được sửa cấu hình routing.',
    );
  }
}
