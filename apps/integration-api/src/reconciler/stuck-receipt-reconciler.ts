// src/reconciler/stuck-receipt-reconciler.ts — Stuck Receipt Reconciler (CORE/1.8 AC5).
//
// AC5 requirements for receipts:
//   1. Detects stuck receipts (LEASED + expired lease).
//   2. Creates RecoveryAction with idempotency key per stuck receipt.
//   3. Resets stuck receipt to PENDING for reprocessing.
//   4. Records actor + timestamp + action taken.
//
// Design:
//   - ReconcileReceipts() scans for LEASED receipts with expired lease.
//   - For each stuck receipt:
//       (a) createRecoveryAction(itemType='RECEIPT', itemId=receiptId)
//           → idempotent: concurrent reconcilers → only one RecoveryAction.
//       (b) If created (this reconciler won): resetStuckReceipt().
//       (c) Mark RecoveryAction as APPLIED or SKIPPED.
//   - No SQL against HRP core database.
//   - No outbound to real providers during reconciliation.
//   - Actor string: "reconciler:<schedulerId>" or "manual:<operatorId>".

import type { PrismaClient } from '@prisma/client';
import { worker } from '@hrp-engagement/integration-store';
import {
  createRecoveryAction,
  completeRecoveryAction,
  findStuckReceipts,
  resetStuckReceipt,
  type RecoveryStatusWire,
} from '@hrp-engagement/integration-store';

type Clock = typeof worker extends { Clock: infer T } ? T : never;

export interface ReconcileReceiptResult {
  receiptId: string;
  action: 'RECOVERED' | 'SKIPPED' | 'FAILED' | 'NOT_STUCK';
  recoveryId: string | null;
  error?: string;
}

export interface StuckReceiptReconcilerDeps {
  /** Prisma client for integration store. */
  prisma: PrismaClient;
  /** Actor identifier for recovery actions. */
  actor: string;
  /** Optional: limit receipts per reconciliation scan. */
  batchSize?: number;
  /** Optional: clock for audit timestamps (uses Date.now() if not provided). */
  clock?: Clock;
}

/**
 * Reconcile stuck receipts.
 *
 * Scans for LEASED receipts with expired lease, creates RecoveryAction
 * (idempotent per receipt), and resets them to PENDING.
 *
 * @param deps.prisma — integration store Prisma client.
 * @param deps.actor — who is running reconciliation (e.g. "reconciler:scheduled-001").
 * @param deps.batchSize — max receipts to process per call (default 100).
 * @returns list of results per receipt.
 */
export async function reconcileReceipts(
  deps: StuckReceiptReconcilerDeps,
): Promise<{
  scanned: number;
  results: ReconcileReceiptResult[];
  errors: string[];
}> {
  const { prisma, actor, batchSize = 100 } = deps;

  const stuckReceipts = await findStuckReceipts(prisma, { limit: batchSize });
  const results: ReconcileReceiptResult[] = [];
  const errors: string[] = [];

  for (const receipt of stuckReceipts) {
    const snapshot = {
      state: receipt.state,
      leaseExpiresAt: receipt.leaseExpiresAt?.toISOString() ?? null,
      leaseOwner: receipt.leaseOwner,
      attempts: receipt.attempts,
      provider: receipt.provider,
      connectionId: receipt.connectionId,
    };

    try {
      // Step 1: create RecoveryAction (idempotent per receipt).
      const { row: recovery, created } = await createRecoveryAction(prisma, {
        itemType: 'RECEIPT',
        itemId: receipt.receiptId,
        action: 'RESET_TO_PENDING',
        actor,
        snapshot,
        reason: `Stuck receipt detected: LEASED + lease expired at ${receipt.leaseExpiresAt?.toISOString() ?? 'unknown'}`,
      });

      if (!created) {
        // Another reconciler already handled this receipt.
        results.push({
          receiptId: receipt.receiptId,
          action: 'SKIPPED',
          recoveryId: recovery.recoveryId,
        });
        continue;
      }

      // Step 2: reset the stuck receipt.
      const reset = await resetStuckReceipt(prisma, receipt.receiptId);
      if (!reset) {
        // Receipt was already processed (e.g. another worker completed it).
        await completeRecoveryAction(prisma, {
          recoveryId: recovery.recoveryId,
          status: 'SKIPPED',
          reason: 'Receipt no longer in LEASED+expired state — likely completed by another worker',
        });
        results.push({
          receiptId: receipt.receiptId,
          action: 'SKIPPED',
          recoveryId: recovery.recoveryId,
        });
        continue;
      }

      // Step 3: mark recovery as APPLIED.
      await completeRecoveryAction(prisma, {
        recoveryId: recovery.recoveryId,
        status: 'APPLIED',
        reason: 'Receipt reset to PENDING; lease fields cleared',
      });

      results.push({
        receiptId: receipt.receiptId,
        action: 'RECOVERED',
        recoveryId: recovery.recoveryId,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`receipt ${receipt.receiptId}: ${msg}`);
      results.push({
        receiptId: receipt.receiptId,
        action: 'FAILED',
        recoveryId: null,
        error: msg,
      });
    }
  }

  return { scanned: stuckReceipts.length, results, errors };
}

/**
 * Manually recover a specific receipt by ID (for HTTP API or manual trigger).
 *
 * @returns result of recovery attempt.
 */
export async function recoverReceipt(
  prisma: PrismaClient,
  receiptId: string,
  actor: string,
): Promise<ReconcileReceiptResult> {
  const snapshot = {
    manualTrigger: true,
    receiptId,
  };

  const { row: recovery, created } = await createRecoveryAction(prisma, {
    itemType: 'RECEIPT',
    itemId: receiptId,
    action: 'RESET_TO_PENDING',
    actor,
    snapshot,
    reason: 'Manual recovery trigger via HTTP API',
  });

  if (!created) {
    return {
      receiptId,
      action: 'SKIPPED',
      recoveryId: recovery.recoveryId,
    };
  }

  const reset = await resetStuckReceipt(prisma, receiptId);
  if (!reset) {
    await completeRecoveryAction(prisma, {
      recoveryId: recovery.recoveryId,
      status: 'SKIPPED',
      reason: 'Receipt not in LEASED+expired state',
    });
    return {
      receiptId,
      action: 'SKIPPED',
      recoveryId: recovery.recoveryId,
    };
  }

  await completeRecoveryAction(prisma, {
    recoveryId: recovery.recoveryId,
    status: 'APPLIED',
    reason: 'Manual recovery: receipt reset to PENDING',
  });

  return {
    receiptId,
    action: 'RECOVERED',
    recoveryId: recovery.recoveryId,
  };
}
