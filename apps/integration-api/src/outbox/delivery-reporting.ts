/**
 * outbox/delivery-reporting.ts — Delivery reporting handler for CORE/1.8 AC3.
 *
 * CORE/1.8 AC3 Requirements:
 *  - Handles DeliveryReportingEvent callbacks (SENT/DELIVERED/FAILED/UNKNOWN/SUPPRESSED)
 *  - Maps to IntentStatus transitions
 *  - UNKNOWN state must NOT be treated as success
 *
 * State machine:
 *  - DISPATCHED → SENT → DELIVERED (success path)
 *  - DISPATCHED → FAILED (terminal failure)
 *  - DISPATCHED → UNKNOWN (not success, requires reconciliation)
 *  - DISPATCHED → SUPPRESSED (terminal, DNC/fence)
 *
 * Design:
 *  - Validates DeliveryReportingEvent per DeliveryReportingEventSchema
 *  - Enforces state transition rules
 *  - UNKNOWN is NOT treated as success (no automatic retry)
 *
 * Boundaries:
 *  - Frozen contracts in packages/contracts — do NOT modify
 *  - Uses existing DispatchIntent table
 */
import type { PrismaClient } from '@prisma/client';
import { runInTxn } from '@hrp-engagement/integration-store';
import {
  DeliveryReportingEventSchema,
  type DeliveryReportingEvent,
  type DeliveryReportingState,
  type DeliveryFailureReason,
} from '@hrp-engagement/contracts';

/**
 * Delivery reporting validation result.
 */
export interface ReportingValidationResult {
  valid: boolean;
  errors?: Array<{ path: string; message: string }>;
  event?: DeliveryReportingEvent;
}

/**
 * Delivery reporting processing result.
 */
export interface ReportingProcessingResult {
  success: boolean;
  intentId: string;
  previousStatus: string | null;
  newStatus: string | null;
  state: DeliveryReportingState;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Map delivery reporting state to IntentStatus.
 */
function mapStateToIntentStatus(state: DeliveryReportingState): string {
  switch (state) {
    case 'SENT':
      return 'ACK_RECEIVED'; // Provider accepted, awaiting delivery confirmation
    case 'DELIVERED':
      return 'DELIVERED';
    case 'FAILED':
      return 'FAILED';
    case 'UNKNOWN':
      return 'FAILED'; // UNKNOWN is treated as failure (not success)
    case 'SUPPRESSED':
      return 'TERMINAL'; // Suppressed is terminal (no retry)
    default:
      return 'FAILED';
  }
}

/**
 * Check if state represents success.
 * UNKNOWN is NOT success per contracts.
 */
function isSuccessState(state: DeliveryReportingState): boolean {
  return state === 'SENT' || state === 'DELIVERED';
}

/**
 * Delivery reporting handler — processes delivery status callbacks from provider.
 *
 * This handler receives DELIVERY_REPORTING_EVENT callbacks indicating the
 * delivery status of an outbound intent.
 *
 * Per contracts:
 *  - SENT: provider accepted, pending delivery confirmation
 *  - DELIVERED: provider confirmed delivered
 *  - FAILED: send failed after retry (audit reason required)
 *  - UNKNOWN: HRP cannot verify (cache stale / HRP offline / provider no response)
 *    → NOT treated as success, requires reconciliation
 *  - SUPPRESSED: dispatch gate SUPPRESSED (DNC active / fence expired)
 *    → NO retry, NO DLQ re-drive
 */
export class DeliveryReportingHandler {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Validate an incoming delivery reporting event.
   * Returns validation result with parsed event if valid.
   */
  validateEvent(raw: unknown): ReportingValidationResult {
    const result = DeliveryReportingEventSchema.safeParse(raw);

    if (!result.success) {
      return {
        valid: false,
        errors: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      };
    }

    return {
      valid: true,
      event: result.data,
    };
  }

  /**
   * Process a delivery reporting event.
   *
   * Workflow:
   *  1. Validate event schema
   *  2. Find corresponding DispatchIntent
   *  3. Validate state transition
   *  4. Update status based on reporting state
   *
   * Returns processing result.
   */
  async processEvent(raw: unknown): Promise<ReportingProcessingResult> {
    // Step 1: Validate
    const validation = this.validateEvent(raw);
    if (!validation.valid || !validation.event) {
      return {
        success: false,
        intentId: 'unknown',
        previousStatus: null,
        newStatus: null,
        state: 'UNKNOWN',
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.errors?.map((e) => `${e.path}: ${e.message}`).join('; ') ?? 'Invalid event',
        },
      };
    }

    const event = validation.event;

    // Step 2: Find and update DispatchIntent
    try {
      const result = await runInTxn(this.prisma, async (tx) => {
        // Find the intent
        const intent = await tx.dispatchIntent.findFirst({
          where: {
            intentId: event.intentId,
            organizationId: event.organizationId,
          },
        });

        if (!intent) {
          return { found: false, previousStatus: null };
        }

        const previousStatus = intent.status;

        // Validate state transition
        // Allowed transitions from DISPATCHED or ACK_RECEIVED
        const allowedFromStatuses = ['DISPATCHED', 'ACK_RECEIVED', 'PENDING', 'LEASED'];
        if (!allowedFromStatuses.includes(intent.status)) {
          return {
            found: true,
            previousStatus,
            invalidTransition: true,
            currentStatus: intent.status,
          };
        }

        // Map state to IntentStatus
        const newStatus = mapStateToIntentStatus(event.state);

        // Update the intent
        await tx.dispatchIntent.update({
          where: { intentId: intent.intentId },
          data: {
            status: newStatus as any,
            updatedAt: new Date(),
          },
        });

        return { found: true, previousStatus, newStatus };
      });

      if (!result.found) {
        return {
          success: false,
          intentId: event.intentId,
          previousStatus: null,
          newStatus: null,
          state: event.state,
          error: {
            code: 'INTENT_NOT_FOUND',
            message: `Intent ${event.intentId} not found for organization ${event.organizationId}`,
          },
        };
      }

      if ('invalidTransition' in result && result.invalidTransition) {
        return {
          success: false,
          intentId: event.intentId,
          previousStatus: result.previousStatus ?? null,
          newStatus: null,
          state: event.state,
          error: {
            code: 'INVALID_TRANSITION',
            message: `Cannot transition from ${result.currentStatus} to ${event.state}`,
          },
        };
      }

      console.log(JSON.stringify({
        level: 'info',
        msg: 'DeliveryReportingHandler: event processed',
        intentId: event.intentId,
        previousStatus: result.previousStatus,
        newStatus: result.newStatus,
        state: event.state,
        isSuccess: isSuccessState(event.state),
      }));

      return {
        success: true,
        intentId: event.intentId,
        previousStatus: result.previousStatus ?? null,
        newStatus: result.newStatus ?? null,
        state: event.state,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.log(JSON.stringify({
        level: 'error',
        msg: 'DeliveryReportingHandler: processing failed',
        intentId: event.intentId,
        error: errorMessage,
      }));

      return {
        success: false,
        intentId: event.intentId,
        previousStatus: null,
        newStatus: null,
        state: event.state,
        error: {
          code: 'PROCESSING_ERROR',
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Build reporting response.
   */
  buildResponse(result: ReportingProcessingResult): object {
    return {
      success: result.success,
      intentId: result.intentId,
      previousStatus: result.previousStatus,
      newStatus: result.newStatus,
      state: result.state,
      isSuccess: result.success && isSuccessState(result.state),
      error: result.error,
    };
  }
}

/**
 * Create a delivery reporting handler.
 */
export function createDeliveryReportingHandler(prisma: PrismaClient): DeliveryReportingHandler {
  return new DeliveryReportingHandler(prisma);
}
