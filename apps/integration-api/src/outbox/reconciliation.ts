/**
 * outbox/reconciliation.ts — CORE/1.8 AC4: UNKNOWN delivery reconciliation.
 *
 * AC4 Requirements:
 *  1. UNKNOWN delivery has a reconcile scenario (NOT blind retry or mark DELIVERED).
 *  2. System does NOT mark DELIVERED or resend blindly on UNKNOWN.
 *  3. Failed handoff does NOT fake success.
 *  4. UNKNOWN triggers investigation/reconciliation workflow.
 *
 * Design:
 *  - ReconciliationEntry tracks investigation state for UNKNOWN deliveries.
 *  - State machine: PENDING_INVESTIGATION → INVESTIGATING → RESOLVED_*.
 *  - NEVER auto-resolve to DELIVERED on UNKNOWN.
 *  - Resolutions: CONFIRMED (mark DELIVERED), FAILED (mark FAILED), RETRY (re-queue).
 *
 * Constraints (Owner instruction):
 *  - Frozen contracts in packages/contracts — do NOT modify.
 *  - UNKNOWN state must NOT auto-transition to DELIVERED.
 *  - No fake success on failed handoff.
 *  - No HRP/provider/model thật — mock only.
 */

import { type PrismaClient } from '@prisma/client';
import { runInTxn } from '@hrp-engagement/integration-store';
import type {
  DeliveryReportingEvent,
  DeliveryFailureReason,
} from '@hrp-engagement/contracts';

/* ─────────────────────────────────────────────────────────────────────────
 * §1. Types
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Reconciliation status enum — mirrors Prisma ReconciliationStatus enum.
 * State machine:
 *  - PENDING_INVESTIGATION: initial state when UNKNOWN received.
 *  - INVESTIGATING: actively investigating (e.g. querying provider logs).
 *  - RESOLVED_CONFIRMED: confirmed delivered after investigation.
 *  - RESOLVED_FAILED: confirmed failed after investigation.
 *  - RESOLVED_RETRY: re-queued for delivery after investigation.
 */
export const RECONCILIATION_STATUSES = [
  'PENDING_INVESTIGATION',
  'INVESTIGATING',
  'RESOLVED_CONFIRMED',
  'RESOLVED_FAILED',
  'RESOLVED_RETRY',
] as const;

export type ReconciliationStatus = typeof RECONCILIATION_STATUSES[number];

/**
 * Resolution kind — explicit resolution from investigation.
 */
export const RESOLUTION_KINDS = ['CONFIRMED', 'FAILED', 'RETRY'] as const;
export type ResolutionKind = typeof RESOLUTION_KINDS[number];

/**
 * ReconciliationEntry — tracks investigation state for UNKNOWN deliveries.
 */
export interface ReconciliationEntry {
  entryId: string;
  organizationId: string;
  intentId: string;
  receiptId: string;
  status: ReconciliationStatus;
  reasonCode: DeliveryFailureReason;
  investigationNote: string | null;
  investigatorActor: string;
  investigatedAt: Date;
  resolvedByActor: string | null;
  resolvedAt: Date | null;
  resolution: ResolutionKind | null;
  resolutionNote: string | null;
  retryIdempotencyKey: string | null;
  aggregateVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

/* ─────────────────────────────────────────────────────────────────────────
 * §2. ReconciliationService — CRUD for reconciliation entries
 * ───────────────────────────────────────────────────────────────────────── */

export interface ReconciliationServiceOptions {
  /** Organization ID for scope boundary. */
  organizationId: string;
}

/**
 * ReconciliationService — manages reconciliation entries for UNKNOWN deliveries.
 *
 * Key invariants (AC4):
 *  - UNKNOWN never auto-resolves to DELIVERED.
 *  - Failed handoff does NOT fake success.
 *  - Reconciliation requires explicit resolution: CONFIRMED, FAILED, or RETRY.
 */
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly opts: ReconciliationServiceOptions,
  ) {}

  /* ─── Create entry when UNKNOWN received ─────────────────────────────── */

  /**
   * Create a reconciliation entry when UNKNOWN delivery is received.
   *
   * AC4: Creates entry with actor + timestamp; transitions intent to
   * INVESTIGATION_PENDING (NOT DELIVERED, NOT FAILED).
   *
   * @param intentId      - DispatchIntent.intentId from the UNKNOWN event.
   * @param receiptId     - DispatchIntent.receiptId for correlation.
   * @param reason        - Why UNKNOWN (e.g. 'STALE_CACHE', 'HRP_OFFLINE').
   * @param investigatorActor - Actor who initiated investigation (e.g. 'SERVICE:svc-unknown-handler').
   * @param investigationNote - Optional note describing initial investigation context.
   * @returns Created reconciliation entry.
   * @throws If intent not found or already has reconciliation entry.
   */
  async createReconciliationEntry(
    intentId: string,
    receiptId: string,
    reason: DeliveryFailureReason,
    investigatorActor: string,
    investigationNote?: string,
  ): Promise<ReconciliationEntry> {
    return runInTxn(this.prisma, async (tx) => {
      // 1. Verify intent exists and transition to INVESTIGATION_PENDING.
      // AC4: NOT DELIVERED, NOT FAILED — explicitly INVESTIGATION_PENDING.
      const intent = await tx.dispatchIntent.findUnique({
        where: { intentId },
      });

      if (!intent) {
        throw reconciliationError('INTENT_NOT_FOUND', `Intent ${intentId} not found`);
      }

      // Check if already has reconciliation entry (idempotency).
      const existing = await tx.reconciliationEntry.findFirst({
        where: { intentId },
      });

      if (existing) {
        throw reconciliationError(
          'ALREADY_RECONCILING',
          `Intent ${intentId} already has reconciliation entry ${existing.entryId}`,
        );
      }

      // AC4 invariant: UNKNOWN must NOT transition to DELIVERED or FAILED directly.
      // Only PENDING/LEASED/DISPATCHED/ACK_RECEIVED can transition to INVESTIGATION_PENDING.
      const terminalStatuses = ['DELIVERED', 'FAILED', 'TERMINAL'];
      if (terminalStatuses.includes(intent.status)) {
        throw reconciliationError(
          'INVALID_STATE_TRANSITION',
          `Cannot investigate intent in terminal state ${intent.status}`,
        );
      }

      // 2. Transition intent to INVESTIGATION_PENDING.
      await tx.dispatchIntent.update({
        where: { intentId },
        data: {
          status: 'INVESTIGATION_PENDING',
          // Clear lease fields since this intent is no longer in active processing.
          leaseOwner: null,
          leaseExpiresAt: null,
          fencingToken: null,
          leaseFencedAt: null,
        },
      });

      // 3. Create reconciliation entry.
      const entryId = generateId('re-');
      const now = new Date();

      const entry = await tx.reconciliationEntry.create({
        data: {
          entryId,
          schemaVersion: '1',
          organizationId: this.opts.organizationId,
          intentId,
          receiptId,
          status: 'PENDING_INVESTIGATION',
          reasonCode: reason,
          investigationNote: investigationNote ?? null,
          investigatorActor,
          investigatedAt: now,
          aggregateVersion: 0,
        },
      });

      return mapToReconciliationEntry(entry);
    });
  }

  /* ─── Update investigation status ────────────────────────────────────── */

  /**
   * Mark investigation as actively investigating (not pending).
   *
   * @param entryId  - Reconciliation entry ID.
   * @param note     - Optional note about investigation progress.
   */
  async markInvestigating(
    entryId: string,
    note?: string,
  ): Promise<ReconciliationEntry> {
    const entry = await this.prisma.reconciliationEntry.findUnique({
      where: { entryId },
    });

    if (!entry) {
      throw reconciliationError('NOT_FOUND', `Entry ${entryId} not found`);
    }

    if (entry.status !== 'PENDING_INVESTIGATION') {
      throw reconciliationError(
        'INVALID_STATE_TRANSITION',
        `Can only mark PENDING_INVESTIGATION as investigating, got ${entry.status}`,
      );
    }

    const updated = await this.prisma.reconciliationEntry.update({
      where: { entryId },
      data: {
        status: 'INVESTIGATING',
        investigationNote: note ?? entry.investigationNote,
      },
    });

    return mapToReconciliationEntry(updated);
  }

  /* ─── Resolve reconciliation ──────────────────────────────────────────── */

  /**
   * Resolve reconciliation with explicit resolution.
   *
   * AC4: Never auto-resolve to DELIVERED; resolution must be explicit.
   * Resolutions:
   *  - CONFIRMED: mark intent as DELIVERED (confirmed after investigation).
   *  - FAILED: mark intent as FAILED (confirmed failure).
   *  - RETRY: re-queue intent for delivery with new idempotency key.
   *
   * @param entryId          - Reconciliation entry ID.
   * @param resolution       - Resolution kind: CONFIRMED | FAILED | RETRY.
   * @param resolvedByActor  - Actor who performed resolution.
   * @param resolutionNote   - Optional note explaining resolution.
   * @param retryIdempotencyKey - Required if resolution = RETRY.
   * @param expectedVersion  - Optimistic lock version.
   */
  async resolveReconciliation(
    entryId: string,
    resolution: ResolutionKind,
    resolvedByActor: string,
    resolutionNote?: string,
    retryIdempotencyKey?: string,
    expectedVersion?: number,
  ): Promise<ReconciliationEntry> {
    if (!RESOLUTION_KINDS.includes(resolution)) {
      throw reconciliationError(
        'VALIDATION_ERROR',
        `Invalid resolution: ${resolution}. Must be one of: ${RESOLUTION_KINDS.join(', ')}`,
      );
    }

    if (resolution === 'RETRY' && !retryIdempotencyKey) {
      throw reconciliationError(
        'VALIDATION_ERROR',
        'retryIdempotencyKey required when resolution is RETRY',
      );
    }

    return runInTxn(this.prisma, async (tx) => {
      // 1. Fetch entry with optimistic lock.
      const entry = await tx.reconciliationEntry.findUnique({
        where: { entryId },
      });

      if (!entry) {
        throw reconciliationError('NOT_FOUND', `Entry ${entryId} not found`);
      }

      // 2. Check version for optimistic locking.
      if (expectedVersion !== undefined && entry.aggregateVersion !== expectedVersion) {
        throw reconciliationError(
          'VERSION_CONFLICT',
          `Version conflict: expected ${expectedVersion}, got ${entry.aggregateVersion}`,
        );
      }

      // 3. Only non-terminal states can be resolved.
      const terminalStatuses = ['RESOLVED_CONFIRMED', 'RESOLVED_FAILED', 'RESOLVED_RETRY'];
      if (terminalStatuses.includes(entry.status)) {
        throw reconciliationError(
          'ALREADY_RESOLVED',
          `Entry ${entryId} already resolved as ${entry.status}`,
        );
      }

      // 4. Resolve intent based on resolution.
      const now = new Date();
      let intentNewStatus: 'DELIVERED' | 'FAILED' | 'PENDING';

      switch (resolution) {
        case 'CONFIRMED':
          // AC4: CONFIRMED means investigation confirmed delivery.
          // This is NOT blind retry — it's explicit confirmation after investigation.
          intentNewStatus = 'DELIVERED';
          break;
        case 'FAILED':
          // AC4: FAILED means investigation confirmed permanent failure.
          intentNewStatus = 'FAILED';
          break;
        case 'RETRY':
          // AC4: RETRY means re-queue for delivery attempt.
          intentNewStatus = 'PENDING';
          break;
      }

      // 5. Update intent status.
      await tx.dispatchIntent.update({
        where: { intentId: entry.intentId },
        data: { status: intentNewStatus },
      });

      // 6. Update reconciliation entry.
      const updated = await tx.reconciliationEntry.update({
        where: { entryId },
        data: {
          status: `RESOLVED_${resolution}` as any,
          resolvedByActor,
          resolvedAt: now,
          resolution,
          resolutionNote: resolutionNote ?? null,
          retryIdempotencyKey: retryIdempotencyKey ?? null,
          aggregateVersion: { increment: 1 },
        },
      });

      return mapToReconciliationEntry(updated);
    });
  }

  /* ─── Query reconciliation entries ───────────────────────────────────── */

  /**
   * List reconciliation entries with optional filters.
   *
   * @param opts.filter.status    - Filter by status.
   * @param opts.filter.intentId  - Filter by intent ID.
   * @param opts.filter.reasonCode - Filter by reason code.
   * @param opts.cursor           - Cursor for pagination.
   * @param opts.pageSize         - Page size (max 100).
   */
  async listEntries(opts?: {
    filter?: {
      status?: ReconciliationStatus;
      intentId?: string;
      reasonCode?: string;
    };
    cursor?: string;
    pageSize?: number;
  }): Promise<{ entries: ReconciliationEntry[]; nextCursor?: string }> {
    const pageSize = Math.min(opts?.pageSize ?? 50, 100);

    const where: any = {
      organizationId: this.opts.organizationId,
    };

    if (opts?.filter?.status) {
      where.status = opts.filter.status;
    }
    if (opts?.filter?.intentId) {
      where.intentId = opts.filter.intentId;
    }
    if (opts?.filter?.reasonCode) {
      where.reasonCode = opts.filter.reasonCode;
    }

    const entries = await this.prisma.reconciliationEntry.findMany({
      where,
      orderBy: { investigatedAt: 'desc' },
      take: pageSize + 1,
      ...(opts?.cursor ? { skip: 1, cursor: { entryId: opts.cursor } } : {}),
    });

    const hasMore = entries.length > pageSize;
    const result = entries.slice(0, pageSize);

    return {
      entries: result.map(mapToReconciliationEntry),
      nextCursor: hasMore ? result[result.length - 1]?.entryId : undefined,
    };
  }

  /**
   * Get single reconciliation entry by ID.
   */
  async getEntry(entryId: string): Promise<ReconciliationEntry | null> {
    const entry = await this.prisma.reconciliationEntry.findUnique({
      where: { entryId },
    });
    return entry ? mapToReconciliationEntry(entry) : null;
  }

  /**
   * Get reconciliation entry by intent ID.
   */
  async getEntryByIntent(intentId: string): Promise<ReconciliationEntry | null> {
    const entry = await this.prisma.reconciliationEntry.findFirst({
      where: { intentId },
    });
    return entry ? mapToReconciliationEntry(entry) : null;
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * §3. Error handling
 * ───────────────────────────────────────────────────────────────────────── */

export class ReconciliationError extends Error {
  constructor(
    public readonly code: ReconciliationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReconciliationError';
  }
}

export type ReconciliationErrorCode =
  | 'INTENT_NOT_FOUND'
  | 'ALREADY_RECONCILING'
  | 'INVALID_STATE_TRANSITION'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'ALREADY_RESOLVED'
  | 'VALIDATION_ERROR';

function reconciliationError(code: ReconciliationErrorCode, message: string): never {
  throw new ReconciliationError(code, message);
}

/* ─────────────────────────────────────────────────────────────────────────
 * §4. Helpers
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Map Prisma model to ReconciliationEntry interface.
 */
function mapToReconciliationEntry(row: any): ReconciliationEntry {
  return {
    entryId: row.entryId,
    organizationId: row.organizationId,
    intentId: row.intentId,
    receiptId: row.receiptId,
    status: row.status,
    reasonCode: row.reasonCode,
    investigationNote: row.investigationNote,
    investigatorActor: row.investigatorActor,
    investigatedAt: row.investigatedAt,
    resolvedByActor: row.resolvedByActor,
    resolvedAt: row.resolvedAt,
    resolution: row.resolution,
    resolutionNote: row.resolutionNote,
    retryIdempotencyKey: row.retryIdempotencyKey,
    aggregateVersion: row.aggregateVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Generate deterministic ID for reconciliation entry.
 * Uses timestamp + random suffix for uniqueness.
 */
function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}${timestamp}-${random}`;
}
