/**
 * outbox/unknown-handler.ts — CORE/1.8 AC4: UNKNOWN delivery handler.
 *
 * AC4 Requirements:
 *  1. UNKNOWN delivery has a reconcile scenario (NOT blind retry or mark DELIVERED).
 *  2. System does NOT mark DELIVERED or resend blindly on UNKNOWN.
 *  3. Failed handoff does NOT fake success.
 *  4. UNKNOWN triggers investigation/reconciliation workflow.
 *
 * Design:
 *  - When DeliveryReportingEvent.state === 'UNKNOWN':
 *    - Transition intent to INVESTIGATION_PENDING (NOT DELIVERED, NOT FAILED).
 *    - Create ReconciliationEntry with actor + timestamp.
 *    - Return acknowledgment that investigation is required.
 *
 * Constraints (Owner instruction):
 *  - Frozen contracts in packages/contracts — do NOT modify.
 *  - UNKNOWN state must NOT auto-transition to DELIVERED.
 *  - No fake success on failed handoff.
 *  - No HRP/provider/model thật — mock only.
 */

import type { PrismaClient } from '@prisma/client';
import type {
  DeliveryReportingEvent,
  DeliveryFailureReason,
} from '@hrp-engagement/contracts';
import { ReconciliationService } from './reconciliation.js';

/* ─────────────────────────────────────────────────────────────────────────
 * §1. Types
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Result of handling an UNKNOWN delivery event.
 */
export interface UnknownDeliveryResult {
  /** Whether the handler successfully processed the UNKNOWN event. */
  handled: boolean;
  /** Reconciliation entry ID if created, null if already exists. */
  reconciliationEntryId: string | null;
  /** Intent ID that was transitioned. */
  intentId: string;
  /** New status of the intent. */
  intentStatus: 'INVESTIGATION_PENDING';
  /** Human-readable message for acknowledgment. */
  message: string;
  /** Whether a reconciliation entry already existed (idempotent). */
  alreadyReconciling: boolean;
}

/**
 * Error codes for unknown handler operations.
 */
export type UnknownHandlerErrorCode =
  | 'UNKNOWN_HANDLER_ERROR'
  | 'DELIVERY_EVENT_INVALID'
  | 'INTENT_NOT_FOUND'
  | 'INVALID_STATE_FOR_UNKNOWN';

/* ─────────────────────────────────────────────────────────────────────────
 * §2. UnknownDeliveryHandler
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * UnknownDeliveryHandler — handles UNKNOWN delivery events.
 *
 * Key behavior (AC4):
 *  - UNKNOWN does NOT auto-mark as DELIVERED or FAILED.
 *  - UNKNOWN creates a reconciliation entry for investigation.
 *  - UNKNOWN does NOT trigger blind retry.
 *  - UNKNOWN acknowledgment tells caller investigation is required.
 *
 * This handler is idempotent: calling it multiple times with the same
 * intentId returns the same result (no duplicate reconciliation entries).
 */
export class UnknownDeliveryHandler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly reconciliationService: ReconciliationService,
    private readonly organizationId: string,
  ) {}

  /**
   * Handle an UNKNOWN delivery event.
   *
   * AC4 behavior:
   *  1. Validate the delivery event.
   *  2. Check if reconciliation already exists (idempotent).
   *  3. Transition intent to INVESTIGATION_PENDING.
   *  4. Create ReconciliationEntry.
   *  5. Return acknowledgment that investigation is required.
   *
   * @param event   - The DeliveryReportingEvent with state === 'UNKNOWN'.
   * @param actor   - Actor handling the event (e.g. 'SERVICE:svc-unknown-handler').
   * @returns UnknownDeliveryResult with reconciliation entry info.
   */
  async handleUnknownDelivery(
    event: DeliveryReportingEvent,
    actor: { kind: string; [key: string]: unknown },
  ): Promise<UnknownDeliveryResult> {
    // 1. Validate event.
    if (event.state !== 'UNKNOWN') {
      throw new UnknownDeliveryHandlerError(
        'DELIVERY_EVENT_INVALID',
        `Expected state UNKNOWN, got ${event.state}`,
      );
    }

    if (!event.reason) {
      throw new UnknownDeliveryHandlerError(
        'DELIVERY_EVENT_INVALID',
        'UNKNOWN state requires a reason field',
      );
    }

    // 2. Get intent to find receiptId and verify state.
    const intent = await this.prisma.dispatchIntent.findUnique({
      where: { intentId: event.intentId },
    });

    if (!intent) {
      throw new UnknownDeliveryHandlerError(
        'INTENT_NOT_FOUND',
        `Intent ${event.intentId} not found`,
      );
    }

    // 3. Check if already reconciling (idempotent check).
    const existingEntry = await this.reconciliationService.getEntryByIntent(event.intentId);

    if (existingEntry) {
      // Already has reconciliation entry — return existing state (idempotent).
      return {
        handled: true,
        reconciliationEntryId: existingEntry.entryId,
        intentId: event.intentId,
        intentStatus: 'INVESTIGATION_PENDING',
        message: 'Investigation already in progress',
        alreadyReconciling: true,
      };
    }

    // 4. Create reconciliation entry (transitions intent to INVESTIGATION_PENDING).
    const actorString = formatActor(actor);

    const entry = await this.reconciliationService.createReconciliationEntry(
      event.intentId,
      intent.receiptId,
      event.reason as DeliveryFailureReason,
      actorString,
      `UNKNOWN delivery received at ${event.reportedAt}. Reason: ${event.reason}. Provider ref: ${JSON.stringify(event.providerRef ?? null)}. Fence: ${JSON.stringify(event.fenceContext ?? null)}.`,
    );

    // 5. Return acknowledgment.
    return {
      handled: true,
      reconciliationEntryId: entry.entryId,
      intentId: event.intentId,
      intentStatus: 'INVESTIGATION_PENDING',
      message: 'UNKNOWN delivery received. Investigation required before resolution.',
      alreadyReconciling: false,
    };
  }

  /**
   * Check if an intent is in investigation state.
   *
   * @param intentId - Intent ID to check.
   * @returns True if intent is INVESTIGATION_PENDING.
   */
  async isUnderInvestigation(intentId: string): Promise<boolean> {
    const entry = await this.reconciliationService.getEntryByIntent(intentId);
    if (!entry) return false;

    const terminalStatuses = ['RESOLVED_CONFIRMED', 'RESOLVED_FAILED', 'RESOLVED_RETRY'];
    return !terminalStatuses.includes(entry.status);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * §3. Error handling
 * ───────────────────────────────────────────────────────────────────────── */

export class UnknownDeliveryHandlerError extends Error {
  constructor(
    public readonly code: UnknownHandlerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'UnknownDeliveryHandlerError';
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * §4. Helpers
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Format actor as string for audit trail.
 */
function formatActor(actor: { kind: string; [key: string]: unknown }): string {
  const parts: string[] = [actor.kind];

  if ('serviceId' in actor && actor.serviceId) {
    parts.push(String(actor.serviceId));
  } else if ('userId' in actor && actor.userId) {
    parts.push(String(actor.userId));
  } else if ('systemId' in actor && actor.systemId) {
    parts.push(String(actor.systemId));
  }

  return parts.join(':');
}
