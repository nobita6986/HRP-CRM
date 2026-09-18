// src/reconciler/stuck-intent-reconciler.ts — Stuck Intent Reconciler (CORE/1.8 AC5).
//
// AC5 requirements for DispatchIntent:
//   1. Detects stuck DispatchIntent (LEASED + expired lease).
//   2. Creates RecoveryAction with idempotency key per stuck intent.
//   3. Resets stuck intent to PENDING for reprocessing.
//   4. Records actor + timestamp + action taken.
//
// Design:
//   - ReconcileIntents() scans for LEASED intents with expired lease.
//   - For each stuck intent:
//       (a) createRecoveryAction(itemType='INTENT', itemId=intentId)
//           → idempotent: concurrent reconcilers → only one RecoveryAction.
//       (b) If created (this reconciler won): resetStuckIntent().
//       (c) Mark RecoveryAction as APPLIED or SKIPPED.
//   - No SQL against HRP core database.
//   - No outbound to real providers during reconciliation.
//   - Actor string: "reconciler:<schedulerId>" or "manual:<operatorId>".

import type { PrismaClient } from '@prisma/client';
import { worker, storeError } from '@hrp-engagement/integration-store';
import {
  createRecoveryAction,
  completeRecoveryAction,
  findStuckIntents,
  resetStuckIntent,
} from '@hrp-engagement/integration-store';

type Clock = typeof worker extends { Clock: infer T } ? T : never;

export interface ReconcileIntentResult {
  intentId: string;
  receiptId: string;
  action: 'RECOVERED' | 'SKIPPED' | 'FAILED' | 'NOT_STUCK';
  recoveryId: string | null;
  error?: string;
}

export interface StuckIntentReconcilerDeps {
  /** Prisma client for integration store. */
  prisma: PrismaClient;
  /** Actor identifier for recovery actions. */
  actor: string;
  /** Optional: limit intents per reconciliation scan. */
  batchSize?: number;
  /** Optional: clock for audit timestamps. */
  clock?: Clock;
}

/**
 * Reconcile stuck DispatchIntents.
 *
 * Scans for LEASED intents with expired lease, creates RecoveryAction
 * (idempotent per intent), and resets them to PENDING.
 *
 * @param deps.prisma — integration store Prisma client.
 * @param deps.actor — who is running reconciliation (e.g. "reconciler:scheduled-001").
 * @param deps.batchSize — max intents to process per call (default 100).
 * @returns list of results per intent.
 */
export async function reconcileIntents(
  deps: StuckIntentReconcilerDeps,
): Promise<{
  scanned: number;
  results: ReconcileIntentResult[];
  errors: string[];
}> {
  const { prisma, actor, batchSize = 100 } = deps;

  const stuckIntents = await findStuckIntents(prisma, { limit: batchSize });
  const results: ReconcileIntentResult[] = [];
  const errors: string[] = [];

  for (const intent of stuckIntents) {
    const snapshot = {
      status: intent.status,
      leaseExpiresAt: intent.leaseExpiresAt?.toISOString() ?? null,
      leaseOwner: intent.leaseOwner,
      attempts: intent.attempts,
      receiptId: intent.receiptId,
    };

    try {
      // Step 1: create RecoveryAction (idempotent per intent).
      const { row: recovery, created } = await createRecoveryAction(prisma, {
        itemType: 'INTENT',
        itemId: intent.intentId,
        action: 'RESET_TO_PENDING',
        actor,
        snapshot,
        reason: `Stuck intent detected: LEASED + lease expired at ${intent.leaseExpiresAt?.toISOString() ?? 'unknown'}`,
      });

      if (!created) {
        // Another reconciler already handled this intent.
        results.push({
          intentId: intent.intentId,
          receiptId: intent.receiptId,
          action: 'SKIPPED',
          recoveryId: recovery.recoveryId,
        });
        continue;
      }

      // Step 2: reset the stuck intent.
      const reset = await resetStuckIntent(prisma, intent.intentId);
      if (!reset) {
        // Intent was already processed (e.g. another worker completed it).
        await completeRecoveryAction(prisma, {
          recoveryId: recovery.recoveryId,
          status: 'SKIPPED',
          reason: 'Intent no longer in LEASED+expired state — likely completed by another worker',
        });
        results.push({
          intentId: intent.intentId,
          receiptId: intent.receiptId,
          action: 'SKIPPED',
          recoveryId: recovery.recoveryId,
        });
        continue;
      }

      // Step 3: mark recovery as APPLIED.
      await completeRecoveryAction(prisma, {
        recoveryId: recovery.recoveryId,
        status: 'APPLIED',
        reason: 'Intent reset to PENDING; lease fields cleared',
      });

      results.push({
        intentId: intent.intentId,
        receiptId: intent.receiptId,
        action: 'RECOVERED',
        recoveryId: recovery.recoveryId,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`intent ${intent.intentId}: ${msg}`);
      results.push({
        intentId: intent.intentId,
        receiptId: intent.receiptId,
        action: 'FAILED',
        recoveryId: null,
        error: msg,
      });
    }
  }

  return { scanned: stuckIntents.length, results, errors };
}

/**
 * Manually recover a specific DispatchIntent by ID (for HTTP API or manual trigger).
 *
 * @returns result of recovery attempt.
 */
export async function recoverIntent(
  prisma: PrismaClient,
  intentId: string,
  actor: string,
): Promise<ReconcileIntentResult & { receiptId: string }> {
  const snapshot = {
    manualTrigger: true,
    intentId,
  };

  const { row: recovery, created } = await createRecoveryAction(prisma, {
    itemType: 'INTENT',
    itemId: intentId,
    action: 'RESET_TO_PENDING',
    actor,
    snapshot,
    reason: 'Manual recovery trigger via HTTP API',
  });

  if (!created) {
    return {
      intentId,
      receiptId: '', // caller should look up separately if needed
      action: 'SKIPPED',
      recoveryId: recovery.recoveryId,
    };
  }

  const reset = await resetStuckIntent(prisma, intentId);
  if (!reset) {
    await completeRecoveryAction(prisma, {
      recoveryId: recovery.recoveryId,
      status: 'SKIPPED',
      reason: 'Intent not in LEASED+expired state',
    });
    return {
      intentId,
      receiptId: '',
      action: 'SKIPPED',
      recoveryId: recovery.recoveryId,
    };
  }

  await completeRecoveryAction(prisma, {
    recoveryId: recovery.recoveryId,
    status: 'APPLIED',
    reason: 'Manual recovery: intent reset to PENDING',
  });

  return {
    intentId,
    receiptId: '',
    action: 'RECOVERED',
    recoveryId: recovery.recoveryId,
  };
}
