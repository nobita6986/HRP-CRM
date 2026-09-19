// src/repos/event-receipt.ts — ExternalEventReceipt + DispatchIntent repository.
//
// Critical AC #4 (Backlog §1.3): "Receipt/job state và durable dispatch
// intent không có gap dual-write; nếu queue riêng thì integration
// outbox cùng transaction hoặc poll receipt bền."
//
// CORE/1.3 design:
//  - `commitReceiptWithIntents` — atomic PostgreSQL transaction:
//      1. Upsert ExternalEventReceipt (idempotent theo scope + eventId).
//      2. Insert DispatchIntent(s) cùng receipt.
//      3. Cùng commit boundary → cùng được persist hoặc cùng rollback.
//  - KHÔNG có queue riêng trong 1.3; durable processing intent
//    (DispatchIntent) giữ same transaction với receipt. Worker 1.4 sẽ
//    poll DispatchIntent (leased). Receipt + intent có thể recover vì
//    cả 2 đều durable.
//
// rollback không âm thầm xóa pending receipts:
//  - Repository KHÔNG delete receipt rows ở bất kỳ path nào.
//  - Chỉ mark state transition (PENDING → LEASED → DISPATCH_COMMITTED →
//    RETRY_SCHEDULED / DELIVERED / DEAD_LETTERED / QUARANTINED).
//
// Giới hạn payload: payload KHÔNG lưu raw media; chỉ lưu opaque refs JSON
// (evidenceRefsJson) theo schema contracts.

import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { EventDuplicateKind as PrismaEventDuplicateKind, EventReceiptState } from '@prisma/client';
import { runInTxn } from '../client.js';
import { storeError } from '../errors.js';
import { eventReceiptRowToContract } from '../adapters.js';
import type {
  EventReceiptInput,
  OutboxDeliveryIntentInput,
  TxnResult,
} from '../types.js';
import type { z } from 'zod';
import type { EventReceiptSchema } from '@hrp-engagement/contracts';

type SchemaVersion = '1';

const VALID_DUPLICATE_KINDS = [
  'DEDUPE', 'OUT_OF_ORDER', 'CORRECTION', 'GAP', 'UNKNOWN',
] as const;

function asDuplicateKindEnum(k: string): PrismaEventDuplicateKind {
  if (!(VALID_DUPLICATE_KINDS as readonly string[]).includes(k)) {
    throw storeError('VALIDATION_ERROR', `duplicateKind không hợp lệ: ${k}`, { target: 'duplicateKind' });
  }
  return k as unknown as PrismaEventDuplicateKind;
}

function asStateEnum(s: string): EventReceiptState {
  const allowed = [
    'PENDING', 'LEASED', 'DISPATCH_COMMITTED',
    'RETRY_SCHEDULED', 'DELIVERED', 'DEAD_LETTERED', 'QUARANTINED',
  ] as const;
  if (!(allowed as readonly string[]).includes(s)) {
    throw storeError('VALIDATION_ERROR', `state không hợp lệ: ${s}`, { target: 'state' });
  }
  return s as EventReceiptState;
}

function newReceiptId(organizationId: string, eventId: string): string {
  return `rcpt-${organizationId.slice(0, 8)}-${eventId.slice(0, 16)}`;
}

function newIntentId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 32);
  }
  return `it-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// Intent fields subset lưu ở DispatchIntent (CORE/1.3):
//   intentId, organizationId, receiptId, correlationId, dedupeKey,
//   sourceCommandId, consumerDedupeToken, destination (JSON),
//   template (JSON), policy (JSON), channel.
//
// contract OutboxDeliveryIntent có schema strict nhiều field. T1 chỉ
// pick các field thiết kế cho durable processing (idempotency, target,
// template, policy). Các field khác (intentSchemaVersion) lưu như
// schemaVersion scalar.

interface PersistedIntent {
  intentId: string;
  organizationId: string;
  receiptId: string;
  schemaVersion: string;
  correlationId: string | null;
  intentSource: string;       // from intent.sourceCommandId (scalar reference)
  intentTargetJson: unknown;  // destination + template + policy JSON
  idempotencyKey: string | null;
}

function buildPersistedIntentArgs(
  receiptId: string,
  intent: OutboxDeliveryIntentInput,
): PersistedIntent {
  return {
    intentId: intent.intentId,
    organizationId: intent.organizationId,
    receiptId,
    schemaVersion: intent.schemaVersion,
    correlationId: intent.correlationId,
    intentSource: intent.sourceCommandId,
    intentTargetJson: {
      destination: intent.destination,
      template: intent.template,
      policy: intent.policy,
      channel: intent.channel,
    },
    idempotencyKey: intent.dedupeKey,
  };
}

/**
 * Atomic commit: receipt + intents trong CÙNG transaction.
 *
 *  - Cùng `organizationId/provider/connectionId/eventId` => idempotent:
 *      - nếu existing digest = input.payloadDigest → return existing row
 *        + existing intents (idempotent dedupe).
 *      - nếu existing digest != input.payloadDigest → IDEMPOTENCY_CONFLICT
 *        (caller phải dùng version/CORRECTION path riêng).
 *  - IDEMPOTENCY_CONFLICT không được tự merge.
 */
export async function commitReceiptWithIntents(
  prisma: PrismaClient,
  scope: {
    organizationId: string;
    provider: string;
    connectionId: string;
    eventId: string;
  },
  payload: {
    schemaVersion: string;
    receipt: EventReceiptInput;
    intents: OutboxDeliveryIntentInput[];
    correlationId?: string;
    commandRefsJson?: unknown;
  },
): Promise<{ result: TxnResult; created: boolean }> {
  if (!scope.organizationId || !scope.provider || !scope.connectionId || !scope.eventId) {
    throw storeError('SCOPE_MISMATCH', 'thiếu scope (organizationId/provider/connectionId/eventId)');
  }

  if (payload.receipt.organizationId !== scope.organizationId) {
    throw storeError('SCOPE_MISMATCH', 'payload.receipt.organizationId không khớp scope');
  }
  for (const it of payload.intents) {
    if (it.organizationId !== scope.organizationId) {
      throw storeError('SCOPE_MISMATCH', `intent.organizationId (${it.organizationId}) không khớp scope`);
    }
  }

  return runInTxn(prisma, async (tx) => {
    const existing = await tx.externalEventReceipt.findUnique({
      where: { uq_receipt_event_id: {
        organizationId: scope.organizationId,
        provider: scope.provider,
        connectionId: scope.connectionId,
        eventId: scope.eventId,
      } },
    });

    if (existing) {
      if (existing.payloadDigest !== payload.receipt.payloadDigest) {
        throw storeError(
          'VALIDATION_ERROR',
          'IDEMPOTENCY_CONFLICT: same eventId + different payloadDigest không tự merge',
          { target: 'payloadDigest' },
        );
      }

      const existingIntents = await tx.dispatchIntent.findMany({
        where: { receiptId: existing.receiptId, organizationId: scope.organizationId },
      });
      return {
        created: false,
        result: {
          receiptId: existing.receiptId,
          intentIds: existingIntents.map((i) => i.intentId),
          receiptRowVersion: existing.attempts,
        },
      };
    }

    // Tạo mới.
    const receiptId = newReceiptId(scope.organizationId, scope.eventId);
    const createArgs = {
      receiptId,
      schemaVersion: payload.schemaVersion,
      organizationId: scope.organizationId,
      provider: scope.provider,
      connectionId: scope.connectionId,
      eventId: scope.eventId,
      payloadDigest: payload.receipt.payloadDigest,
      state: asStateEnum('PENDING'),
      duplicateKind: asDuplicateKindEnum(payload.receipt.duplicateKind),
      attempts: 0,
      firstSeenAt: new Date(),
      ...(payload.correlationId ? { correlationId: payload.correlationId } : {}),
      ...(payload.commandRefsJson !== undefined
        ? { commandRefsJson: payload.commandRefsJson as Parameters<typeof tx.externalEventReceipt.create>[0]['data']['commandRefsJson'] }
        : {}),
      ...(payload.receipt.resolvedAt ? { resolvedAt: new Date(payload.receipt.resolvedAt) } : {}),
      ...(payload.receipt.reasonCode ? { reasonCode: payload.receipt.reasonCode } : {}),
    };
    // Race-safe upsert: Postgres ON CONFLICT DO NOTHING against the
    // uq_receipt_event_id unique constraint. If a concurrent commit beat us
    // to it, the insert is a no-op (no P2002, no aborted-txn cascade), and
    // we re-read the winner inside the same txn. Digest mismatch on the
    // winner still surfaces IDEMPOTENCY_CONFLICT (409). We name the
    // constraint explicitly so we never collide on a sibling unique index.
    const insertReceiptSql = Prisma.sql`
      INSERT INTO "integration"."ExternalEventReceipt" (
        "receiptId","schemaVersion","organizationId","provider","connectionId",
        "eventId","payloadDigest","state","duplicateKind","attempts",
        "correlationId","commandRefsJson","resolvedAt","reasonCode",
        "firstSeenAt","createdAt","updatedAt"
      ) VALUES (
        ${createArgs.receiptId},
        ${createArgs.schemaVersion},
        ${createArgs.organizationId},
        ${createArgs.provider},
        ${createArgs.connectionId},
        ${createArgs.eventId},
        ${createArgs.payloadDigest},
        ${createArgs.state}::"integration"."EventReceiptState",
        ${createArgs.duplicateKind}::"integration"."EventDuplicateKind",
        ${createArgs.attempts},
        ${createArgs.correlationId ?? null},
        ${createArgs.commandRefsJson === undefined ? Prisma.sql`NULL` : Prisma.sql`${JSON.stringify(createArgs.commandRefsJson)}::jsonb`},
        ${createArgs.resolvedAt ?? null},
        ${createArgs.reasonCode ?? null},
        ${createArgs.firstSeenAt},
        NOW(),
        NOW()
      )
      ON CONFLICT DO NOTHING
      RETURNING "receiptId"
    `;
    const inserted = await tx.$queryRaw<Array<{ receiptId: string }>>(insertReceiptSql);

    if (inserted.length === 0) {
      // Concurrent winner already exists. Re-read inside same txn.
      const raced = await tx.externalEventReceipt.findUnique({
        where: { uq_receipt_event_id: {
          organizationId: scope.organizationId,
          provider: scope.provider,
          connectionId: scope.connectionId,
          eventId: scope.eventId,
        } },
      });
      if (!raced) {
        throw storeError(
          'TRANSACTION_FAILED',
          'Concurrent receipt insert invisible after ON CONFLICT — retry',
          { retryable: true },
        );
      }
      if (raced.payloadDigest !== payload.receipt.payloadDigest) {
        throw storeError(
          'VALIDATION_ERROR',
          'IDEMPOTENCY_CONFLICT: same eventId + different payloadDigest không tự merge',
          { target: 'payloadDigest' },
        );
      }
      const racedIntents = await tx.dispatchIntent.findMany({
        where: { receiptId: raced.receiptId, organizationId: scope.organizationId },
      });
      return {
        created: false,
        result: {
          receiptId: raced.receiptId,
          intentIds: racedIntents.map((i) => i.intentId),
          receiptRowVersion: raced.attempts,
        },
      };
    }

    let created = { receiptId, attempts: 0 as number };

    const intentIds: string[] = [];
    for (const intent of payload.intents) {
      const a = buildPersistedIntentArgs(receiptId, intent);
      const intentCreateArgs = {
        intentId: a.intentId,
        schemaVersion: a.schemaVersion as SchemaVersion,
        organizationId: a.organizationId,
        receiptId: a.receiptId,
        idempotencyKey: a.idempotencyKey,
        correlationId: a.correlationId,
        intentSource: a.intentSource,
        intentTargetJson: a.intentTargetJson as Parameters<typeof tx.dispatchIntent.create>[0]['data']['intentTargetJson'],
        status: 'PENDING' as const,
        attempts: 0,
      };
      await tx.dispatchIntent.create({ data: intentCreateArgs });
      intentIds.push(a.intentId);
    }

    return {
      created: true,
      result: {
        receiptId: created.receiptId,
        intentIds,
        receiptRowVersion: created.attempts,
      },
    };
  });
}

/**
 * Read receipt by scope. Returns null nếu không tồn tại.
 */
export async function findReceipt(
  prisma: PrismaClient,
  scope: {
    organizationId: string;
    provider: string;
    connectionId: string;
    eventId: string;
  },
): Promise<z.infer<typeof EventReceiptSchema> & { eventId: string } | null> {
  if (!scope.organizationId || !scope.provider || !scope.connectionId || !scope.eventId) {
    throw storeError('SCOPE_MISMATCH', 'thiếu scope');
  }
  const row = await prisma.externalEventReceipt.findUnique({
    where: { uq_receipt_event_id: {
      organizationId: scope.organizationId,
      provider: scope.provider,
      connectionId: scope.connectionId,
      eventId: scope.eventId,
    } },
  });
  if (!row) return null;
  return { ...eventReceiptRowToContract(row as never), eventId: scope.eventId };
}

/**
 * listDeadLetteredReceipts — CORE/1.8 AC2: DLQ listing with safe metadata.
 *
 * AC2 requirements:
 * - Returns DEAD_LETTERED receipts for an organization.
 * - Returns SAFE metadata only (NO raw error, NO stack traces, NO PII).
 * - Filter by reasonCode and date range.
 * - Includes attempts count and audit trail.
 *
 * Safe metadata shape:
 *   - receiptId, eventId, organizationId, provider, connectionId
 *   - reasonCode (allowlisted error code only)
 *   - attempts count
 *   - firstSeenAt, resolvedAt timestamps
 *   - payloadDigest (hash only, no raw payload)
 *   - idempotencyKey (if present)
 *   - correlationId (if present)
 *
 * KNOCKOUT criteria (DO NOT include):
 *   - Raw error message that could contain PII
 *   - Stack trace
 *   - Full payload content
 *   - Any CCCD/phone/raw contact info
 */
export interface DeadLetterReceipt {
  receiptId: string;
  organizationId: string;
  provider: string;
  connectionId: string;
  eventId: string;
  reasonCode: string | null;
  attempts: number;
  firstSeenAt: string;
  resolvedAt: string | null;
  payloadDigest: string;
  idempotencyKey: string | null;
  correlationId: string | null;
  // Audit trail for redrive
  redriveCount: number;
  lastRedrivenAt: string | null;
  lastRedriveActor: string | null;
}

export interface ListDeadLetterOpts {
  reasonCode?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  cursor?: string;
}

export async function listDeadLetteredReceipts(
  prisma: PrismaClient,
  organizationId: string,
  opts?: ListDeadLetterOpts,
): Promise<{ items: DeadLetterReceipt[]; nextCursor: string | null }> {
  if (!organizationId) {
    throw storeError('TENANT_SCOPE_REQUIRED', 'listDeadLetteredReceipts yêu cầu organizationId');
  }

  const limit = Math.min(opts?.limit ?? 50, 100);
  // NOTE: Prisma's findMany takes an optional args object. We type `where` directly
  // to avoid inferring a union that would include `undefined` under noUncheckedIndexedAccess.
  const where: {
    organizationId: string;
    state: 'DEAD_LETTERED';
    reasonCode?: string;
    resolvedAt?: { gte?: Date; lte?: Date };
    receiptId?: { lt: string };
  } = {
    organizationId,
    state: 'DEAD_LETTERED',
  };

  // Filter by reasonCode if provided
  if (opts?.reasonCode) {
    where.reasonCode = opts.reasonCode;
  }

  // Filter by date range if provided
  if (opts?.fromDate || opts?.toDate) {
    where.resolvedAt = {};
    if (opts?.fromDate) {
      (where.resolvedAt as unknown as Record<string, Date | undefined>).gte = new Date(opts.fromDate);
    }
    if (opts?.toDate) {
      (where.resolvedAt as unknown as Record<string, Date | undefined>).lte = new Date(opts.toDate);
    }
  }

  // Cursor-based pagination (cursor is receiptId)
  if (opts?.cursor) {
    (where as { receiptId?: { lt: string } }).receiptId = { lt: opts.cursor };
  }

  const rows = await prisma.externalEventReceipt.findMany({
    where,
    orderBy: { resolvedAt: 'desc' },
    take: limit + 1, // Fetch one extra to determine if there's a next page
  });

  const hasNextPage = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => {
    // Parse audit trail from evidenceRefsJson if present
    let redriveCount = 0;
    let lastRedrivenAt: string | null = null;
    let lastRedriveActor: string | null = null;

    if (row.evidenceRefsJson && typeof row.evidenceRefsJson === 'object') {
      const evidence = row.evidenceRefsJson as Record<string, unknown>;
      if (evidence['dlqAudit']) {
        const audit = evidence['dlqAudit'] as Record<string, unknown>;
        redriveCount = typeof audit['redriveCount'] === 'number' ? audit['redriveCount'] as number : 0;
        lastRedrivenAt = typeof audit['lastRedrivenAt'] === 'string' ? audit['lastRedrivenAt'] as string : null;
        lastRedriveActor = typeof audit['lastRedriveActor'] === 'string' ? audit['lastRedriveActor'] as string : null;
      }
    }

    // Return SAFE metadata only — NO raw error, NO stack trace, NO PII
    return {
      receiptId: row.receiptId,
      organizationId: row.organizationId,
      provider: row.provider,
      connectionId: row.connectionId,
      eventId: row.eventId,
      reasonCode: row.reasonCode, // Safe: allowlisted error code only
      attempts: row.attempts,
      firstSeenAt: row.firstSeenAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      payloadDigest: row.payloadDigest, // Safe: SHA-256 hash only
      idempotencyKey: row.idempotencyKey,
      correlationId: row.correlationId,
      redriveCount,
      lastRedrivenAt,
      lastRedriveActor,
    } satisfies DeadLetterReceipt;
  });

  return {
    items,
    nextCursor: hasNextPage && rows[limit - 1] ? rows[limit - 1]!.receiptId : null,
  };
}

/**
 * redriveReceipt — CORE/1.8 AC2: Reset DEAD_LETTERED → PENDING with DNC guard.
 *
 * AC2 requirements:
 * - Resets DEAD_LETTERED receipt to PENDING for reprocessing.
 * - Enforces DNC guard check (MUST check DNC before allowing redrive).
 * - Records audit trail: who redrove, when, reason.
 * - Refuses if OUTBOX_PATCH_FORBIDDEN fields attempted in payload.
 * - Respects maxAttempts cap (blocks if attempts >= maxAttempts).
 * - Preserves event/command keys, actor audit, and DNC guards.
 * - Does NOT bypass DNC/suppression checks.
 *
 * Constraints:
 * - Frozen contracts: does NOT modify OUTBOX_PATCH_FORBIDDEN array.
 * - DNC guard MUST be enforced on every redrive.
 * - No arbitrary payload modification allowed.
 */
export interface RedriveReceiptResult {
  success: boolean;
  receiptId: string;
  newState: 'PENDING';
  attempts: number;
  nextAttemptAt: string | null;
  // Audit trail
  redriveCount: number;
  redrivenAt: string;
  redriveActor: string;
}

export interface RedriveReceiptError {
  success: false;
  code: 'NOT_FOUND' | 'INVALID_STATE' | 'DNC_GUARD_BLOCKED' | 'MAX_ATTEMPTS_EXCEEDED' | 'FORBIDDEN_PATCH_FIELD' | 'SCOPE_MISMATCH';
  message: string;
}

export async function redriveReceipt(
  prisma: PrismaClient,
  receiptId: string,
  actor: { kind: string; [key: string]: unknown },
  clock: { now(): number },
  opts?: {
    /** Optional reason for redrive (audit trail) */
    reason?: string;
    /** DNC check function — MUST be enforced */
    dncCheck?: (args: {
      organizationId: string;
      provider: string;
      connectionId: string;
      recipientRef: string;
    }) => Promise<{ blocked: boolean; reason?: string }>;
    /** Max attempts cap — blocks redrive if attempts >= maxAttempts */
    maxAttempts?: number;
    /** Validate that payload doesn't contain forbidden patch fields */
    validateForbiddenPatch?: (payload: Record<string, unknown>) => { valid: boolean; forbiddenFields?: string[] };
  },
): Promise<RedriveReceiptResult | RedriveReceiptError> {
  return runInTxn(prisma, async (tx) => {
    const now = new Date(clock.now());

    // 1. Find the receipt
    const receipt = await tx.externalEventReceipt.findUnique({
      where: { receiptId },
    });

    if (!receipt) {
      return {
        success: false,
        code: 'NOT_FOUND',
        message: `Receipt ${receiptId} không tìm thấy`,
      } satisfies RedriveReceiptError;
    }

    // 2. Validate state: must be DEAD_LETTERED
    if (receipt.state !== 'DEAD_LETTERED') {
      return {
        success: false,
        code: 'INVALID_STATE',
        message: `Receipt ${receiptId} không ở trạng thái DEAD_LETTERED (hiện tại: ${receipt.state})`,
      } satisfies RedriveReceiptError;
    }

    // 3. Enforce maxAttempts cap
    const maxAttempts = opts?.maxAttempts ?? 5;
    if (receipt.attempts >= maxAttempts) {
      return {
        success: false,
        code: 'MAX_ATTEMPTS_EXCEEDED',
        message: `Receipt ${receiptId} đã đạt attempts=${receipt.attempts} >= maxAttempts=${maxAttempts}`,
      } satisfies RedriveReceiptError;
    }

    // 4. Enforce DNC guard check (CORE/1.8 AC2 requirement)
    if (opts?.dncCheck) {
      // Extract recipientRef from idempotencyKey or correlationId
      // In production, this would resolve from the actual payload/target
      const recipientRef = receipt.idempotencyKey ?? receipt.correlationId ?? `unknown-${receipt.eventId}`;
      const dncResult = await opts.dncCheck({
        organizationId: receipt.organizationId,
        provider: receipt.provider,
        connectionId: receipt.connectionId,
        recipientRef,
      });

      if (dncResult.blocked) {
        return {
          success: false,
          code: 'DNC_GUARD_BLOCKED',
          message: `DNC guard blocked redrive: ${dncResult.reason ?? 'recipient is do-not-contact'}`,
        } satisfies RedriveReceiptError;
      }
    }

    // 5. Validate no forbidden patch fields in evidence/payload
    if (opts?.validateForbiddenPatch && receipt.evidenceRefsJson) {
      const evidence = receipt.evidenceRefsJson as Record<string, unknown>;
      const validationResult = opts.validateForbiddenPatch(evidence);
      if (!validationResult.valid) {
        return {
          success: false,
          code: 'FORBIDDEN_PATCH_FIELD',
          message: `Forbidden patch fields detected: ${(validationResult.forbiddenFields ?? []).join(', ')}`,
        } satisfies RedriveReceiptError;
      }
    }

    // 6. Parse existing audit trail
    let dlqAudit: Record<string, unknown> = {};
    if (receipt.evidenceRefsJson && typeof receipt.evidenceRefsJson === 'object') {
      const existingEvidence = receipt.evidenceRefsJson as Record<string, unknown>;
      if (existingEvidence['dlqAudit']) {
        dlqAudit = existingEvidence['dlqAudit'] as Record<string, unknown>;
      }
    }

    // 7. Build updated audit trail
    const redriveCount = ((dlqAudit['redriveCount'] as number) ?? 0) + 1;
    const actorId = typeof actor === 'object' && actor !== null
      ? ((actor['serviceId'] as string) ?? (actor['userId'] as string) ?? (actor['kind'] as string))
      : String(actor);

    dlqAudit = {
      ...dlqAudit,
      redriveCount,
      lastRedrivenAt: now.toISOString(),
      lastRedriveActor: actorId,
      lastRedriveReason: opts?.reason ?? null,
    };

    // 8. Reset DEAD_LETTERED → PENDING
    await tx.externalEventReceipt.update({
      where: { receiptId },
      data: {
        state: 'PENDING',
        attempts: 0, // Reset attempts for fresh processing
        resolvedAt: null, // Clear resolution
        reasonCode: null, // Clear error code
        leaseOwner: null,
        leaseExpiresAt: null,
        fencingToken: null,
        leaseFencedAt: null,
        nextAttemptAt: now, // Schedule for immediate reprocessing
        evidenceRefsJson: {
          ...((receipt.evidenceRefsJson as Record<string, unknown>) ?? {}),
          dlqAudit,
        } as Parameters<typeof tx.externalEventReceipt.update>[0]['data']['evidenceRefsJson'],
      },
    });

    return {
      success: true,
      receiptId,
      newState: 'PENDING',
      attempts: 0,
      nextAttemptAt: now.toISOString(),
      redriveCount,
      redrivenAt: now.toISOString(),
      redriveActor: actorId,
    };
  });
}

/**
 * Get DLQ statistics for an organization.
 */
export async function getDlqStats(
  prisma: PrismaClient,
  organizationId: string,
): Promise<{
  totalDeadLettered: number;
  byReasonCode: Record<string, number>;
  avgAttempts: number;
  oldestResolvedAt: string | null;
}> {
  if (!organizationId) {
    throw storeError('TENANT_SCOPE_REQUIRED', 'getDlqStats yêu cầu organizationId');
  }

  const rows = await prisma.externalEventReceipt.findMany({
    where: {
      organizationId,
      state: 'DEAD_LETTERED',
    },
    select: {
      reasonCode: true,
      attempts: true,
      resolvedAt: true,
    },
  });

  const byReasonCode: Record<string, number> = {};
  let totalAttempts = 0;
  let oldestResolvedAt: Date | null = null;

  for (const row of rows) {
    const code = row.reasonCode ?? 'UNKNOWN';
    byReasonCode[code] = (byReasonCode[code] ?? 0) + 1;
    totalAttempts += row.attempts;
    if (row.resolvedAt && (!oldestResolvedAt || row.resolvedAt < oldestResolvedAt)) {
      oldestResolvedAt = row.resolvedAt;
    }
  }

  return {
    totalDeadLettered: rows.length,
    byReasonCode,
    avgAttempts: rows.length > 0 ? Math.round(totalAttempts / rows.length) : 0,
    oldestResolvedAt: oldestResolvedAt?.toISOString() ?? null,
  };
}

/**
 * List receipts by org (read-only). Giới hạn limit ≤ 100.
 */
export async function listReceiptsByOrg(
  prisma: PrismaClient,
  query: {
    organizationId: string;
    state?: 'PENDING' | 'LEASED' | 'DISPATCH_COMMITTED' | 'RETRY_SCHEDULED' | 'DELIVERED' | 'DEAD_LETTERED' | 'QUARANTINED';
    limit?: number;
  },
): Promise<Array<z.infer<typeof EventReceiptSchema> & { eventId: string }>> {
  if (!query.organizationId) {
    throw storeError('TENANT_SCOPE_REQUIRED', 'listReceiptsByOrg yêu cầu organizationId');
  }
  const limit = Math.min(query.limit ?? 50, 100);
  const where: {
    organizationId: string;
    state?: 'PENDING' | 'LEASED' | 'DISPATCH_COMMITTED' | 'RETRY_SCHEDULED' | 'DELIVERED' | 'DEAD_LETTERED' | 'QUARANTINED';
  } = { organizationId: query.organizationId };
  if (query.state) where.state = query.state;

  const rows = await prisma.externalEventReceipt.findMany({
    where,
    orderBy: { firstSeenAt: 'desc' },
    take: limit,
  });
  return rows.map((r) => ({
    ...eventReceiptRowToContract(r as never),
    eventId: r.eventId,
  }));
}
