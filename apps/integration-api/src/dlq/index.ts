// src/dlq/index.ts — CORE/1.8 AC2: Dead Letter Queue (DLQ) Service.
//
// DLQ responsibilities:
//  1. List dead-lettered receipts with SAFE metadata only (no raw error, no PII).
//  2. Redrive receipts with DNC guard enforcement.
//  3. Provide redrive preview (dry-run) before actual redrive.
//
// AC2 Requirements:
//  - DLQ stores safe error metadata (NO raw stack traces, NO secrets, NO PII).
//  - DLQ stores attempts count and redrive scope.
//  - Redrive preserves event/command keys, actor audit, and DNC guards.
//  - Redrive does NOT bypass DNC/suppression checks.
//  - Redrive does NOT allow arbitrary payload modification.
//
// Constraints:
//  - Frozen contracts in packages/contracts — do NOT modify.
//  - DNC guard MUST be enforced on every redrive.
//  - No HRP/provider/model thật — mock only.

import type { PrismaClient } from '@prisma/client';
import {
  listDeadLetteredReceipts,
  redriveReceipt,
  getDlqStats,
  type DeadLetterReceipt,
  type ListDeadLetterOpts,
  type RedriveReceiptResult,
  type RedriveReceiptError,
} from '@hrp-engagement/integration-store';
import { OUTBOX_PATCH_FORBIDDEN } from '@hrp-engagement/contracts';

// ─── Input validation schemas (safe inputs only) ─────────────────────

/**
 * DlqRedriveInput — safe redrive input.
 *
 * Only allowed fields:
 *  - receiptId: required, identifies the receipt to redrive
 *  - reason: optional, audit trail reason for redrive
 *
 * KNOCKOUT (not allowed):
 *  - Any OUTBOX_PATCH_FORBIDDEN fields
 *  - Payload modification fields
 *  - DNC bypass flags
 */
export interface DlqRedriveInput {
  receiptId: string;
  reason?: string;
}

/**
 * DlqListInput — safe list input.
 *
 * Only allowed fields:
 *  - reasonCode: filter by error reason
 *  - fromDate: filter by resolved date (ISO string)
 *  - toDate: filter by resolved date (ISO string)
 *  - limit: max items to return (default 50, max 100)
 *  - cursor: pagination cursor (receiptId)
 */
export interface DlqListInput {
  reasonCode?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  cursor?: string;
}

// ─── Mock DNC check service ──────────────────────────────────────────

/**
 * MockDncCheckResult — result of DNC guard check.
 *
 * blocked: true means the recipient is do-not-contact.
 * reason: optional reason for blocking.
 */
export interface MockDncCheckResult {
  blocked: boolean;
  reason?: string;
}

/**
 * DNC Guard interface — enforced on every redrive.
 *
 * In production, this would call the actual DNC/suppression service.
 * For mock mode, we simulate DNC behavior.
 */
export interface DncGuard {
  /**
   * Check if recipient is do-not-contact.
   * MUST be called before every redrive.
   *
   * @param args.organizationId - Organization scope
   * @param args.provider - Provider name
   * @param args.connectionId - Connection ID
   * @param args.recipientRef - Recipient reference (from idempotencyKey or correlationId)
   * @returns MockDncCheckResult with blocked=true if DNC active
   */
  check(args: {
    organizationId: string;
    provider: string;
    connectionId: string;
    recipientRef: string;
  }): Promise<MockDncCheckResult>;
}

/**
 * Default mock DNC guard — always allows (for testing).
 * Production would use actual DNC service.
 */
export class MockDncGuard implements DncGuard {
  private blockedRecipients: Set<string> = new Set();

  /**
   * Block a recipient for testing DNC guard behavior.
   */
  blockRecipient(recipientRef: string): void {
    this.blockedRecipients.add(recipientRef);
  }

  /**
   * Unblock a recipient for testing.
   */
  unblockRecipient(recipientRef: string): void {
    this.blockedRecipients.delete(recipientRef);
  }

  async check(args: {
    organizationId: string;
    provider: string;
    connectionId: string;
    recipientRef: string;
  }): Promise<MockDncCheckResult> {
    // Check if recipient is blocked
    if (this.blockedRecipients.has(args.recipientRef)) {
      return {
        blocked: true,
        reason: `Recipient ${args.recipientRef} is do-not-contact (mock DNC)`,
      };
    }

    // Default: allow (not blocked)
    return { blocked: false };
  }
}

// ─── DLQ Service ─────────────────────────────────────────────────────

/**
 * DlqService — CORE/1.8 AC2 Dead Letter Queue service.
 *
 * Provides:
 *  - listDeadLetters: list DEAD_LETTERED receipts with safe metadata
 *  - getDlqStats: get DLQ statistics for an organization
 *  - redriveReceipt: reset DEAD_LETTERED → PENDING with DNC guard
 *  - getRedrivePreview: dry-run preview of redrive outcome
 *
 * Constraints enforced:
 *  - NO raw error details in output
 *  - DNC guard MUST be enforced
 *  - OUTBOX_PATCH_FORBIDDEN fields rejected
 *  - maxAttempts cap enforced
 */
export class DlqService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly dncGuard: DncGuard,
    private readonly maxAttempts: number = 5,
  ) {}

  /**
   * List dead-lettered receipts with SAFE metadata.
   *
   * AC2: Returns only safe metadata — no raw error, no PII.
   *
   * @param organizationId - Organization scope (required)
   * @param opts - Optional filters (reasonCode, date range, pagination)
   * @returns Paginated list of dead letter receipts with safe metadata
   */
  async listDeadLetters(
    organizationId: string,
    opts?: DlqListInput,
  ): Promise<{ items: DeadLetterReceipt[]; nextCursor: string | null }> {
    if (!organizationId) {
      throw new DlqServiceError('TENANT_SCOPE_REQUIRED', 'organizationId là bắt buộc');
    }

    const listOpts: ListDeadLetterOpts = {
      reasonCode: opts?.reasonCode,
      fromDate: opts?.fromDate,
      toDate: opts?.toDate,
      limit: opts?.limit,
      cursor: opts?.cursor,
    };

    return listDeadLetteredReceipts(this.prisma, organizationId, listOpts);
  }

  /**
   * Get DLQ statistics for an organization.
   *
   * @param organizationId - Organization scope (required)
   * @returns Statistics including total count, breakdown by reason, avg attempts
   */
  async getStats(organizationId: string): Promise<{
    totalDeadLettered: number;
    byReasonCode: Record<string, number>;
    avgAttempts: number;
    oldestResolvedAt: string | null;
  }> {
    if (!organizationId) {
      throw new DlqServiceError('TENANT_SCOPE_REQUIRED', 'organizationId là bắt buộc');
    }

    return getDlqStats(this.prisma, organizationId);
  }

  /**
   * Redrive a dead-lettered receipt.
   *
   * AC2 requirements:
   *  - Resets DEAD_LETTERED → PENDING for reprocessing
   *  - Enforces DNC guard check (MUST check before allowing redrive)
   *  - Records audit trail: who redrove, when, reason
   *  - Refuses if OUTBOX_PATCH_FORBIDDEN fields in payload
   *  - Respects maxAttempts cap
   *
   * @param organizationId - Organization scope
   * @param actor - Actor performing the redrive (for audit)
   * @param input - Redrive input (receiptId, optional reason)
   * @returns Redrive result or error
   */
  async redriveReceipt(
    organizationId: string,
    actor: { kind: string; [key: string]: unknown },
    input: DlqRedriveInput,
  ): Promise<RedriveReceiptResult | RedriveReceiptError> {
    // Validate organization scope
    if (!organizationId) {
      return {
        success: false,
        code: 'SCOPE_MISMATCH',
        message: 'organizationId là bắt buộc',
      };
    }

    if (!input.receiptId) {
      return {
        success: false,
        code: 'SCOPE_MISMATCH',
        message: 'receiptId là bắt buộc',
      };
    }

    // Validate that input doesn't contain forbidden fields
    const forbiddenInInput = Object.keys(input).filter((key) =>
      (OUTBOX_PATCH_FORBIDDEN as readonly string[]).includes(key),
    );
    if (forbiddenInInput.length > 0) {
      return {
        success: false,
        code: 'FORBIDDEN_PATCH_FIELD',
        message: `Forbidden fields not allowed: ${forbiddenInInput.join(', ')}`,
      };
    }

    // Perform redrive with DNC guard
    const clock = { now: () => Date.now() };

    return redriveReceipt(this.prisma, input.receiptId, actor, clock, {
      reason: input.reason,
      maxAttempts: this.maxAttempts,
      dncCheck: async (args: {
        organizationId: string;
        provider: string;
        connectionId: string;
        recipientRef: string;
      }) => {
        // Enforce DNC guard — this is REQUIRED per AC2
        return this.dncGuard.check(args);
      },
      validateForbiddenPatch: (payload: Record<string, unknown>) => {
        // Check evidence/payload for forbidden fields
        const forbiddenFields: string[] = [];
        for (const key of Object.keys(payload)) {
          if ((OUTBOX_PATCH_FORBIDDEN as readonly string[]).includes(key)) {
            forbiddenFields.push(key);
          }
        }
        return {
          valid: forbiddenFields.length === 0,
          forbiddenFields: forbiddenFields.length > 0 ? forbiddenFields : undefined,
        };
      },
    });
  }

  /**
   * Get redrive preview (dry-run).
   *
   * Simulates redrive outcome without actually changing state.
   * Useful for UI to show what would happen before confirming.
   *
   * @param organizationId - Organization scope
   * @param receiptId - Receipt to preview redrive for
   * @returns Preview of redrive outcome
   */
  async getRedrivePreview(
    organizationId: string,
    receiptId: string,
  ): Promise<{
    canRedrive: boolean;
    reason?: string;
    attempts: number;
    maxAttempts: number;
    dncStatus: 'BLOCKED' | 'ALLOWED' | 'UNKNOWN';
    currentState: string;
  }> {
    if (!organizationId || !receiptId) {
      return {
        canRedrive: false,
        reason: 'organizationId và receiptId là bắt buộc',
        attempts: 0,
        maxAttempts: this.maxAttempts,
        dncStatus: 'UNKNOWN',
        currentState: 'UNKNOWN',
      };
    }

    // Fetch receipt state
    const receipt = await this.prisma.externalEventReceipt.findUnique({
      where: { receiptId },
      select: {
        state: true,
        attempts: true,
        idempotencyKey: true,
        correlationId: true,
        organizationId: true,
        provider: true,
        connectionId: true,
      },
    });

    if (!receipt) {
      return {
        canRedrive: false,
        reason: 'Receipt không tìm thấy',
        attempts: 0,
        maxAttempts: this.maxAttempts,
        dncStatus: 'UNKNOWN',
        currentState: 'UNKNOWN',
      };
    }

    // Check organization scope
    if (receipt.organizationId !== organizationId) {
      return {
        canRedrive: false,
        reason: 'SCOPE_MISMATCH: receipt không thuộc organization này',
        attempts: receipt.attempts,
        maxAttempts: this.maxAttempts,
        dncStatus: 'UNKNOWN',
        currentState: receipt.state,
      };
    }

    // Check state
    if (receipt.state !== 'DEAD_LETTERED') {
      return {
        canRedrive: false,
        reason: `Receipt không ở trạng thái DEAD_LETTERED (hiện tại: ${receipt.state})`,
        attempts: receipt.attempts,
        maxAttempts: this.maxAttempts,
        dncStatus: 'UNKNOWN',
        currentState: receipt.state,
      };
    }

    // Check attempts cap
    if (receipt.attempts >= this.maxAttempts) {
      return {
        canRedrive: false,
        reason: `Attempts ${receipt.attempts} >= maxAttempts ${this.maxAttempts}`,
        attempts: receipt.attempts,
        maxAttempts: this.maxAttempts,
        dncStatus: 'UNKNOWN',
        currentState: receipt.state,
      };
    }

    // Check DNC status
    const recipientRef = receipt.idempotencyKey ?? receipt.correlationId ?? `unknown-${receiptId}`;
    const dncResult = await this.dncGuard.check({
      organizationId: receipt.organizationId,
      provider: receipt.provider,
      connectionId: receipt.connectionId,
      recipientRef,
    });

    return {
      canRedrive: !dncResult.blocked,
      reason: dncResult.blocked ? dncResult.reason : undefined,
      attempts: receipt.attempts,
      maxAttempts: this.maxAttempts,
      dncStatus: dncResult.blocked ? 'BLOCKED' : 'ALLOWED',
      currentState: receipt.state,
    };
  }
}

// ─── DLQ Service Error ────────────────────────────────────────────────

/**
 * DlqServiceError — typed error for DLQ service operations.
 */
export class DlqServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DlqServiceError';
  }
}

// ─── HTTP Status mapping ─────────────────────────────────────────────

/**
 * Map DlqServiceError code to HTTP status.
 */
export function dlqServiceErrorToHttpStatus(code: string): number {
  switch (code) {
    case 'TENANT_SCOPE_REQUIRED':
    case 'SCOPE_MISMATCH':
      return 400;
    case 'NOT_FOUND':
      return 404;
    case 'DNC_GUARD_BLOCKED':
      return 403;
    case 'MAX_ATTEMPTS_EXCEEDED':
    case 'FORBIDDEN_PATCH_FIELD':
    case 'INVALID_STATE':
      return 409;
    default:
      return 500;
  }
}
