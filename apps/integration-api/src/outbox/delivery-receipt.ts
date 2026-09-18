/**
 * outbox/delivery-receipt.ts — Delivery receipt handler for CORE/1.8 AC3.
 *
 * CORE/1.8 AC3 Requirements:
 *  - OutboxDeliveryReceipt input validation (per contracts)
 *  - Only accepts outcome: 'ACCEPTED' (accepted ≠ delivered)
 *  - Records durable receipt timestamp
 *
 * Design:
 *  - Validates OutboxDeliveryReceipt per OutboxDeliveryReceiptSchema
 *  - Updates DispatchIntent status to ACK_RECEIVED on ACCEPTED
 *  - Transaction boundary: durable receipt recorded before returning success
 *
 * Boundaries:
 *  - Frozen contracts in packages/contracts — do NOT modify
 *  - Uses existing DispatchIntent table
 */
import type { PrismaClient } from '@prisma/client';
import { runInTxn } from '@hrp-engagement/integration-store';
import {
  OutboxDeliveryReceiptSchema,
  type OutboxDeliveryReceipt,
} from '@hrp-engagement/contracts';

/**
 * Receipt validation result.
 */
export interface ReceiptValidationResult {
  valid: boolean;
  errors?: Array<{ path: string; message: string }>;
  receipt?: OutboxDeliveryReceipt;
}

/**
 * Delivery receipt processing result.
 */
export interface ReceiptProcessingResult {
  success: boolean;
  intentId: string;
  status: 'ACK_RECEIVED' | 'ALREADY_PROCESSED' | 'NOT_FOUND' | 'VALIDATION_ERROR';
  acceptedAt?: string;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Delivery receipt handler — validates and processes delivery receipts.
 *
 * This handler receives OUTBOX_DELIVERY_RECEIPT callbacks from the provider,
 * indicating that the provider has durably accepted the outbound intent.
 *
 * Per contracts:
 *  - ACCEPTED = provider has durably accepted (persisted receipt)
 *  - ACCEPTED ≠ DELIVERED (that comes later via DeliveryReportingEvent)
 */
export class DeliveryReceiptHandler {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Validate an incoming delivery receipt.
   * Returns validation result with parsed receipt if valid.
   */
  validateReceipt(raw: unknown): ReceiptValidationResult {
    const result = OutboxDeliveryReceiptSchema.safeParse(raw);

    if (!result.success) {
      return {
        valid: false,
        errors: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      };
    }

    // Additional semantic validation: only ACCEPTED is valid
    if (result.data.outcome !== 'ACCEPTED') {
      return {
        valid: false,
        errors: [{
          path: 'outcome',
          message: `Invalid outcome: ${result.data.outcome}. Only 'ACCEPTED' is valid for delivery receipt.`,
        }],
      };
    }

    return {
      valid: true,
      receipt: result.data,
    };
  }

  /**
   * Process a delivery receipt.
   *
   * Workflow:
   *  1. Validate receipt schema
   *  2. Find corresponding DispatchIntent
   *  3. Update status to ACK_RECEIVED (durable)
   *  4. Record acceptedAt timestamp
   *
   * Returns processing result.
   */
  async processReceipt(raw: unknown): Promise<ReceiptProcessingResult> {
    // Step 1: Validate
    const validation = this.validateReceipt(raw);
    if (!validation.valid || !validation.receipt) {
      return {
        success: false,
        intentId: 'unknown',
        status: 'VALIDATION_ERROR',
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.errors?.map((e) => `${e.path}: ${e.message}`).join('; ') ?? 'Invalid receipt',
        },
      };
    }

    const receipt = validation.receipt;

    // Step 2: Find and update DispatchIntent
    // Use transaction to ensure atomicity
    try {
      const result = await runInTxn(this.prisma, async (tx) => {
        // Find the intent
        const intent = await tx.dispatchIntent.findFirst({
          where: {
            intentId: receipt.intentId,
            organizationId: receipt.organizationId,
          },
        });

        if (!intent) {
          return { found: false, intent };
        }

        // Check current status — only update if not already terminal
        const terminalStatuses = ['ACK_RECEIVED', 'DELIVERED', 'FAILED', 'TERMINAL'];
        if (terminalStatuses.includes(intent.status)) {
          return { found: true, alreadyProcessed: true, intent };
        }

        // Update to ACK_RECEIVED
        await tx.dispatchIntent.update({
          where: { intentId: intent.intentId },
          data: {
            status: 'ACK_RECEIVED',
            updatedAt: new Date(),
          },
        });

        return { found: true, alreadyProcessed: false, intent, acceptedAt: receipt.acceptedAt };
      });

      if (!result.found) {
        return {
          success: false,
          intentId: receipt.intentId,
          status: 'NOT_FOUND',
          error: {
            code: 'INTENT_NOT_FOUND',
            message: `Intent ${receipt.intentId} not found for organization ${receipt.organizationId}`,
          },
        };
      }

      if (result.alreadyProcessed) {
        console.log(JSON.stringify({
          level: 'warn',
          msg: 'DeliveryReceiptHandler: intent already processed',
          intentId: receipt.intentId,
          currentStatus: result.intent?.status,
        }));

        return {
          success: true,
          intentId: receipt.intentId,
          status: 'ALREADY_PROCESSED',
        };
      }

      console.log(JSON.stringify({
        level: 'info',
        msg: 'DeliveryReceiptHandler: receipt processed',
        intentId: receipt.intentId,
        acceptedAt: receipt.acceptedAt,
      }));

      return {
        success: true,
        intentId: receipt.intentId,
        status: 'ACK_RECEIVED',
        acceptedAt: receipt.acceptedAt,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.log(JSON.stringify({
        level: 'error',
        msg: 'DeliveryReceiptHandler: processing failed',
        intentId: receipt.intentId,
        error: errorMessage,
      }));

      return {
        success: false,
        intentId: receipt.intentId,
        status: 'VALIDATION_ERROR',
        error: {
          code: 'PROCESSING_ERROR',
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Build an ACK response per contracts.
   *
   * The ACK response shape follows OutboxDeliveryReceiptSchema structure.
   */
  buildAckResponse(receipt: OutboxDeliveryReceipt): object {
    return {
      schemaVersion: receipt.schemaVersion,
      organizationId: receipt.organizationId,
      intentId: receipt.intentId,
      consumerDedupeToken: receipt.consumerDedupeToken,
      outcome: receipt.outcome,
      acceptedAt: receipt.acceptedAt,
      errors: receipt.errors ?? [],
    };
  }
}

/**
 * Create a delivery receipt handler.
 */
export function createDeliveryReceiptHandler(prisma: PrismaClient): DeliveryReceiptHandler {
  return new DeliveryReceiptHandler(prisma);
}
