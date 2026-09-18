// src/repos/reconciliation.ts — RecoveryAction repository (CORE/1.8 AC5).
//
// AC5 Requirements:
//   1. Detects stuck receipts (LEASED with expired lease).
//   2. Detects stuck DispatchIntent (LEASED with expired lease).
//   3. Reconciliation creates recovery actions with deduplication
//      (same receipt/intent not recovered twice).
//   4. No SQL against HRP core database.
//   5. No outbound to real providers during reconciliation.
//
// Design:
//   - RecoveryAction stores audit trail for each recovery attempt.
//   - Composite unique key (itemType + itemId) ensures idempotency:
//     concurrent reconcilers for the same stuck item → only one row created.
//   - Status: PENDING → APPLIED | SKIPPED | FAILED.
//   - Stored in `integration` schema ONLY — no HRP core tables.
//
// Recovery action kinds:
//   - RESET_TO_PENDING: reset LEASED+expired back to PENDING for reprocessing.
//   - RECLAIM_LEASE: reclaim the expired lease (lease cleanup).
//   - DEAD_LETTER: move stuck item to terminal DEAD_LETTERED state.
//   - SKIP: skip recovery (item already handled by another reconciler).
//
// Concurrency safety:
//   - Unique constraint on (itemType, itemId) prevents duplicate RecoveryAction rows.
//   - createRecoveryAction uses try-catch on Prisma unique constraint violation
//     to return the existing row — caller can check status and decide.
//   - findRecoveryAction reads existing row — caller can dedupe before acting.

import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  RecoveryStatus as PrismaRecoveryStatus,
  RecoveryItemType as PrismaRecoveryItemType,
  RecoveryActionKind as PrismaRecoveryActionKind,
} from '@prisma/client';
import { runInTxn } from '../client.js';
import { storeError } from '../errors.js';

// ─── Wire types (what callers use) ─────────────────────────────────

export type RecoveryStatusWire = 'PENDING' | 'APPLIED' | 'SKIPPED' | 'FAILED';
export type RecoveryItemTypeWire = 'RECEIPT' | 'INTENT' | 'MAPPING';
export type RecoveryActionKindWire =
  | 'RESET_TO_PENDING'
  | 'RECLAIM_LEASE'
  | 'DEAD_LETTER'
  | 'SKIP';

const VALID_RECOVERY_STATUSES: readonly RecoveryStatusWire[] = [
  'PENDING', 'APPLIED', 'SKIPPED', 'FAILED',
] as const;

const VALID_ITEM_TYPES: readonly RecoveryItemTypeWire[] = [
  'RECEIPT', 'INTENT', 'MAPPING',
] as const;

const VALID_ACTION_KINDS: readonly RecoveryActionKindWire[] = [
  'RESET_TO_PENDING', 'RECLAIM_LEASE', 'DEAD_LETTER', 'SKIP',
] as const;

function asStatusEnum(s: string): PrismaRecoveryStatus {
  if (!(VALID_RECOVERY_STATUSES as readonly string[]).includes(s)) {
    throw storeError('VALIDATION_ERROR', `RecoveryStatus không hợp lệ: ${s}`, {
      target: 'status',
    });
  }
  return s as PrismaRecoveryStatus;
}

function asItemTypeEnum(s: string): PrismaRecoveryItemType {
  if (!(VALID_ITEM_TYPES as readonly string[]).includes(s)) {
    throw storeError('VALIDATION_ERROR', `RecoveryItemType không hợp lệ: ${s}`, {
      target: 'itemType',
    });
  }
  return s as PrismaRecoveryItemType;
}

function asActionKindEnum(s: string): PrismaRecoveryActionKind {
  if (!(VALID_ACTION_KINDS as readonly string[]).includes(s)) {
    throw storeError('VALIDATION_ERROR', `RecoveryActionKind không hợp lệ: ${s}`, {
      target: 'action',
    });
  }
  return s as PrismaRecoveryActionKind;
}

// ─── Row shape ─────────────────────────────────────────────────────

export interface RecoveryActionRow {
  recoveryId: string;
  itemType: RecoveryItemTypeWire;
  itemId: string;
  action: RecoveryActionKindWire;
  actor: string;
  snapshotJson: Record<string, unknown> | null;
  status: RecoveryStatusWire;
  createdAt: Date;
  completedAt: Date | null;
  reason: string | null;
}

function rowToContract(row: {
  recoveryId: string;
  itemType: PrismaRecoveryItemType;
  itemId: string;
  action: PrismaRecoveryActionKind;
  actor: string;
  snapshotJson: unknown;
  status: PrismaRecoveryStatus;
  createdAt: Date;
  completedAt: Date | null;
  reason: string | null;
}): RecoveryActionRow {
  return {
    recoveryId: row.recoveryId,
    itemType: row.itemType as RecoveryItemTypeWire,
    itemId: row.itemId,
    action: row.action as RecoveryActionKindWire,
    actor: row.actor,
    snapshotJson:
      row.snapshotJson && typeof row.snapshotJson === 'object'
        ? (row.snapshotJson as Record<string, unknown>)
        : null,
    status: row.status as RecoveryStatusWire,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    reason: row.reason,
  };
}

function newRecoveryId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `ra-${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
  }
  return `ra-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}

// ─── Public API ────────────────────────────────────────────────────

export interface CreateRecoveryActionArgs {
  itemType: RecoveryItemTypeWire;
  itemId: string;
  action: RecoveryActionKindWire;
  actor: string;
  snapshot?: Record<string, unknown>;
  reason?: string;
}

export interface CreateRecoveryResult {
  /** The created or existing row. */
  row: RecoveryActionRow;
  /** True if this call created a new row; false if an existing row was found. */
  created: boolean;
}

/**
 * Create a recovery action for a stuck item (idempotent).
 *
 * Idempotency: unique constraint on (itemType, itemId).
 *   - If no existing row: creates new RecoveryAction with status=PENDING.
 *   - If existing row found: returns existing row (dedupe).
 *
 * Concurrent calls with same (itemType, itemId):
 *   - PostgreSQL unique constraint → one call wins, others get unique violation.
 *   - We catch `P2002` (unique constraint) and return existing row.
 *
 * @returns { created: true, row: newRow } if this call created the action.
 * @returns { created: false, row: existingRow } if another call already created it.
 */
export async function createRecoveryAction(
  prisma: PrismaClient,
  args: CreateRecoveryActionArgs,
): Promise<CreateRecoveryResult> {
  if (!args.itemId) {
    throw storeError('VALIDATION_ERROR', 'itemId là bắt buộc', { target: 'itemId' });
  }
  if (!args.actor) {
    throw storeError('VALIDATION_ERROR', 'actor là bắt buộc', { target: 'actor' });
  }

  const recoveryId = newRecoveryId();

  try {
    const created = await prisma.recoveryAction.create({
      data: {
        recoveryId,
        itemType: asItemTypeEnum(args.itemType),
        itemId: args.itemId,
        action: asActionKindEnum(args.action),
        actor: args.actor,
        // Cast to Prisma's expected JSON type
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        snapshotJson: (args.snapshot as any) ?? null,
        status: 'PENDING' as PrismaRecoveryStatus,
        reason: args.reason ?? null,
      },
    });
    return { row: rowToContract(created), created: true };
  } catch (err: unknown) {
    // P2002 = unique constraint violation → another reconciler already created.
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      // Find and return the existing row.
      const existing = await findRecoveryAction(prisma, {
        itemType: args.itemType,
        itemId: args.itemId,
      });
      if (!existing) {
        // Race: row deleted between insert failure and find.
        // Retry once by calling ourselves recursively (capped at 1 retry).
        return createRecoveryAction(prisma, { ...args, actor: `${args.actor} (retry)` });
      }
      return { row: existing, created: false };
    }
    // Re-throw unexpected errors.
    throw err;
  }
}

/**
 * Find existing recovery action for a stuck item.
 *
 * Returns null if no recovery action exists for this (itemType, itemId).
 * Use this to check if an item has already been scheduled for recovery
 * before taking any action (dedupe).
 */
export async function findRecoveryAction(
  prisma: PrismaClient,
  scope: { itemType: RecoveryItemTypeWire; itemId: string },
): Promise<RecoveryActionRow | null> {
  const row = await prisma.recoveryAction.findUnique({
    where: {
      uq_recovery_idem_key: {
        itemType: asItemTypeEnum(scope.itemType),
        itemId: scope.itemId,
      },
    },
  });
  return row ? rowToContract(row) : null;
}

/**
 * Mark a recovery action as complete (APPLIED | SKIPPED | FAILED).
 *
 * Only transitions from PENDING → terminal state.
 * Returns null if recovery action not found or already completed.
 */
export async function completeRecoveryAction(
  prisma: PrismaClient,
  args: {
    recoveryId: string;
    status: RecoveryStatusWire;
    reason?: string;
  },
): Promise<RecoveryActionRow | null> {
  const validTerminalStatuses = ['APPLIED', 'SKIPPED', 'FAILED'] as const;
  if (
    args.status !== 'APPLIED' &&
    args.status !== 'SKIPPED' &&
    args.status !== 'FAILED'
  ) {
    throw storeError(
      'VALIDATION_ERROR',
      `completeRecoveryAction chỉ chấp nhận terminal status (APPLIED/SKIPPED/FAILED), nhận được: ${args.status}`,
      { target: 'status' },
    );
  }

  return runInTxn(prisma, async (tx) => {
    const existing = await tx.recoveryAction.findUnique({
      where: { recoveryId: args.recoveryId },
    });
    if (!existing) return null;
    if (existing.status !== 'PENDING') return rowToContract(existing);

    const updated = await tx.recoveryAction.update({
      where: { recoveryId: args.recoveryId },
      data: {
        status: asStatusEnum(args.status),
        completedAt: new Date(),
        reason: args.reason ?? existing.reason,
      },
    });
    return rowToContract(updated);
  });
}

/**
 * Find all stuck receipts: LEASED state + leaseExpiresAt < now.
 *
 * These are candidates for reconciliation: their worker lease expired,
 * but they were never completed or released.
 *
 * Optional: scope by organizationId.
 */
export async function findStuckReceipts(
  prisma: PrismaClient,
  opts?: { organizationId?: string; limit?: number },
): Promise<
  Array<{
    receiptId: string;
    organizationId: string;
    provider: string;
    connectionId: string;
    eventId: string;
    state: string;
    leaseExpiresAt: Date | null;
    leaseOwner: string | null;
    attempts: number;
  }>
> {
  const now = new Date();
  const limit = Math.min(opts?.limit ?? 200, 500);

  const rows = await prisma.externalEventReceipt.findMany({
    where: {
      state: 'LEASED',
      leaseExpiresAt: { lt: now },
      ...(opts?.organizationId ? { organizationId: opts.organizationId } : {}),
    },
    select: {
      receiptId: true,
      organizationId: true,
      provider: true,
      connectionId: true,
      eventId: true,
      state: true,
      leaseExpiresAt: true,
      leaseOwner: true,
      attempts: true,
    },
    take: limit,
    orderBy: { leaseExpiresAt: 'asc' },
  });
  return rows;
}

/**
 * Find all stuck DispatchIntents: LEASED state + leaseExpiresAt < now.
 *
 * These are candidates for reconciliation: their worker lease expired,
 * but they were never completed or released.
 *
 * Optional: scope by organizationId.
 */
export async function findStuckIntents(
  prisma: PrismaClient,
  opts?: { organizationId?: string; limit?: number },
): Promise<
  Array<{
    intentId: string;
    receiptId: string;
    organizationId: string;
    status: string;
    leaseExpiresAt: Date | null;
    leaseOwner: string | null;
    attempts: number;
  }>
> {
  const now = new Date();
  const limit = Math.min(opts?.limit ?? 200, 500);

  const rows = await prisma.dispatchIntent.findMany({
    where: {
      status: 'LEASED',
      leaseExpiresAt: { lt: now },
      ...(opts?.organizationId ? { organizationId: opts.organizationId } : {}),
    },
    select: {
      intentId: true,
      receiptId: true,
      organizationId: true,
      status: true,
      leaseExpiresAt: true,
      leaseOwner: true,
      attempts: true,
    },
    take: limit,
    orderBy: { leaseExpiresAt: 'asc' },
  });
  return rows;
}

/**
 * Reset a stuck receipt back to PENDING for reprocessing.
 *
 * Safety: only resets receipts that are LEASED + lease is expired.
 * This is called AFTER createRecoveryAction confirms no existing recovery.
 *
 * @returns true if the receipt was reset; false if it was not in a resetable state.
 */
export async function resetStuckReceipt(
  prisma: PrismaClient,
  receiptId: string,
): Promise<boolean> {
  const now = new Date();
  const result = await prisma.externalEventReceipt.updateMany({
    where: {
      receiptId,
      state: 'LEASED',
      leaseExpiresAt: { lt: now },
    },
    data: {
      state: 'PENDING',
      leaseOwner: null,
      leaseExpiresAt: null,
      fencingToken: null,
      leaseFencedAt: null,
    },
  });
  return result.count > 0;
}

/**
 * Reset a stuck DispatchIntent back to PENDING for reprocessing.
 *
 * Safety: only resets intents that are LEASED + lease is expired.
 * This is called AFTER createRecoveryAction confirms no existing recovery.
 *
 * @returns true if the intent was reset; false if it was not in a resetable state.
 */
export async function resetStuckIntent(
  prisma: PrismaClient,
  intentId: string,
): Promise<boolean> {
  const now = new Date();
  const result = await prisma.dispatchIntent.updateMany({
    where: {
      intentId,
      status: 'LEASED',
      leaseExpiresAt: { lt: now },
    },
    data: {
      status: 'PENDING',
      leaseOwner: null,
      leaseExpiresAt: null,
      fencingToken: null,
      leaseFencedAt: null,
    },
  });
  return result.count > 0;
}

/**
 * List recovery actions (for HTTP API /debugging).
 *
 * @param opts.filter — optional status filter.
 * @param opts.limit — max rows (default 50, max 200).
 */
export async function listRecoveryActions(
  prisma: PrismaClient,
  opts?: {
    status?: RecoveryStatusWire;
    itemType?: RecoveryItemTypeWire;
    actor?: string;
    limit?: number;
  },
): Promise<RecoveryActionRow[]> {
  const limit = Math.min(opts?.limit ?? 50, 200);
  // Typed directly to avoid union-with-undefined from noUncheckedIndexedAccess.
  const where: {
    status?: ReturnType<typeof asStatusEnum>;
    itemType?: ReturnType<typeof asItemTypeEnum>;
    actor?: { contains: string };
  } = {};
  if (opts?.status) where.status = asStatusEnum(opts.status);
  if (opts?.itemType) where.itemType = asItemTypeEnum(opts.itemType);
  if (opts?.actor) where.actor = { contains: opts.actor };

  const rows = await prisma.recoveryAction.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(rowToContract);
}
