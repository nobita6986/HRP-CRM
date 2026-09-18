// src/worker/lease.ts — Durable worker lease repository (CORE/1.4).
//
// Backlog §1.4 AC:
//  - "Hai worker claim cùng receipt chỉ một lease hợp lệ"
//  - "stale worker không commit kết quả ghi đè owner mới"
//  - "attempts/nextAttemptAt/owner/fencing rõ"
//  - "Crash/lease expiry → retry bền"
//
// Design (poll-PostgreSQL):
//  - claimNextReceipt() — atomic UPDATE-WHERE-PENDING-OR-EXPIRED.
//    SELECT first WHERE state IN ('PENDING','RETRY_SCHEDULED') AND
//      (leaseExpiresAt IS NULL OR leaseExpiresAt < now()) AND
//      (nextAttemptAt IS NULL OR nextAttemptAt <= now())
//    ORDER BY firstSeenAt ASC LIMIT 1 FOR UPDATE SKIP LOCKED.
//  - claimSpecificReceipt() — atomic claim of an exact (org, provider,
//    connection, eventId) tuple. Used by tests for isolation; production
//    uses claimNextReceipt.
//  - claimNextIntent() — same shape cho DispatchIntent WHERE status = 'PENDING'.
//  - extendLease() — UPDATE-WHERE-fencingToken (heartbeat).
//  - releaseLease() — UPDATE-WHERE-fencingToken (graceful shutdown / cancel).
//  - completeReceipt() — atomic state transition with fencing check.
//      * On success: state = 'DELIVERED', clear lease fields, attempts++.
//      * On retry: state = 'RETRY_SCHEDULED', attempts++, nextAttemptAt.
//      * On terminal fail: state = 'DEAD_LETTERED'.
//      * On fence mismatch: fencedRejected=true (stale worker rejected).
//  - completeIntent() — same shape for DispatchIntent.
//  - reclaimExpiredLeases() — background sweep: any LEASED with
//    leaseExpiresAt < now() reset to PENDING (fencingToken cleared).
//
// Boundary: scope by organizationId + provider + connectionId.
// Idempotency key preserved across retry: caller passes idempotencyKey
// unchanged; we do NOT regenerate per attempt.

import { Prisma, type PrismaClient } from '@prisma/client';
import { runInTxn } from '../client.js';
import { storeError, type StoreError } from '../errors.js';
import type { Clock } from './clock.js';
import { computeNextAttemptAt, decideRetryState, type RetryPolicy } from './retry.js';

// ─── Public types ─────────────────────────────────────────────────

export interface ReceiptScope {
  organizationId: string;
  provider: string;
  connectionId: string;
  eventId: string;
}

export interface IntentScope {
  organizationId: string;
  receiptId: string;
  intentId: string;
}

export interface LeaseHandle {
  fencingToken: string;
  leaseOwner: string;
  leaseExpiresAt: number;
  leaseFencedAt: number;
}

export interface ClaimedReceipt extends LeaseHandle {
  receiptId: string;
  organizationId: string;
  provider: string;
  connectionId: string;
  eventId: string;
  payloadDigest: string;
  schemaVersion: string;
  attempts: number;
  idempotencyKey: string | null;
  correlationId: string | null;
}

export interface ClaimedIntent extends LeaseHandle {
  intentId: string;
  receiptId: string;
  organizationId: string;
  idempotencyKey: string | null;
  correlationId: string | null;
  intentSource: string;
  attempts: number;
}

// ─── Token generator (injectable) ─────────────────────────────────

export interface IdGenerator {
  next(): string;
}

export const uuidTokenGenerator: IdGenerator = {
  next(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID().replace(/-/g, '');
    }
    return `${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
  },
};

// ─── Helpers ──────────────────────────────────────────────────────

function asIsoDate(epochMs: number): Date {
  return new Date(epochMs);
}

function requireScope(scope: { organizationId?: string }): string {
  if (!scope.organizationId) {
    throw storeError('SCOPE_MISMATCH', 'thiếu organizationId');
  }
  return scope.organizationId;
}

// ─── 1. claimNextReceipt ──────────────────────────────────────────

/**
 * Atomically claim next available receipt for processing.
 *
 * Eligible: state IN ('PENDING', 'RETRY_SCHEDULED') AND
 *           (leaseExpiresAt IS NULL OR leaseExpiresAt <= now()) AND
 *           (nextAttemptAt IS NULL OR nextAttemptAt <= now()).
 *
 * On claim: state → 'LEASED', leaseOwner set, leaseExpiresAt = now() +
 *           leaseDurationMs, fencingToken = generator.next(),
 *           leaseFencedAt = now, attempts++ (attempted counter).
 *
 * Returns null nếu không có receipt available.
 */
export async function claimNextReceipt(
  prisma: PrismaClient,
  args: {
    workerId: string;
    leaseDurationMs: number;
    clock: Clock;
    idGen: IdGenerator;
    maxPerPoll?: number;
    organizationId?: string;
  },
): Promise<ClaimedReceipt | null> {
  const orgId = args.organizationId ?? '';
  const nowMs = args.clock.now();
  const expiresAt = asIsoDate(nowMs + args.leaseDurationMs);
  const now = asIsoDate(nowMs);
  const token = args.idGen.next();
  const take = args.maxPerPoll ?? 1;

  return runInTxn(prisma, async (tx) => {
    const rows = await tx.$queryRaw<Array<{
      receiptId: string;
      organizationId: string;
      provider: string;
      connectionId: string;
      eventId: string;
      payloadDigest: string;
      schemaVersion: string;
      attempts: number;
      idempotencyKey: string | null;
      correlationId: string | null;
    }>>`
      SELECT "receiptId", "organizationId", "provider", "connectionId",
             "eventId", "payloadDigest", "schemaVersion", "attempts",
             "idempotencyKey", "correlationId"
      FROM integration."ExternalEventReceipt"
      WHERE "state" IN ('PENDING', 'RETRY_SCHEDULED')
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= ${now})
        AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
        ${orgId ? Prisma.sql`AND "organizationId" = ${orgId}` : Prisma.empty}
      ORDER BY "firstSeenAt" ASC
      LIMIT ${take}
      FOR UPDATE SKIP LOCKED
    `;
    if (rows.length === 0) return null;

    const row = rows[0]!;
    await tx.externalEventReceipt.update({
      where: { receiptId: row.receiptId },
      data: {
        state: 'LEASED',
        leaseOwner: args.workerId,
        leaseExpiresAt: expiresAt,
        fencingToken: token,
        leaseFencedAt: now,
        attempts: { increment: 1 },
        nextAttemptAt: null,
      },
    });
    return {
      receiptId: row.receiptId,
      organizationId: row.organizationId,
      provider: row.provider,
      connectionId: row.connectionId,
      eventId: row.eventId,
      payloadDigest: row.payloadDigest,
      schemaVersion: row.schemaVersion,
      attempts: row.attempts + 1,
      idempotencyKey: row.idempotencyKey,
      correlationId: row.correlationId,
      fencingToken: token,
      leaseOwner: args.workerId,
      leaseExpiresAt: nowMs + args.leaseDurationMs,
      leaseFencedAt: nowMs,
    };
  });
}

// ─── 1b. claimSpecificReceipt (test helper for isolation) ─────────

/**
 * Atomic claim of a specific receipt by scope (org/provider/connection/eventId).
 * Production worker uses claimNextReceipt; this helper is for tests that
 * need isolation across multiple test cases.
 *
 * Returns ClaimedReceipt or null if not found / not eligible.
 */
export async function claimSpecificReceipt(
  prisma: PrismaClient,
  args: {
    workerId: string;
    leaseDurationMs: number;
    clock: Clock;
    idGen: IdGenerator;
    scope: {
      organizationId: string;
      provider: string;
      connectionId: string;
      eventId: string;
    };
  },
): Promise<ClaimedReceipt | null> {
  const nowMs = args.clock.now();
  const expiresAt = asIsoDate(nowMs + args.leaseDurationMs);
  const now = asIsoDate(nowMs);
  const token = args.idGen.next();

  return runInTxn(prisma, async (tx) => {
    const row = await tx.externalEventReceipt.findUnique({
      where: {
        uq_receipt_event_id: {
          organizationId: args.scope.organizationId,
          provider: args.scope.provider,
          connectionId: args.scope.connectionId,
          eventId: args.scope.eventId,
        },
      },
    });
    if (!row) return null;
    if (row.state !== 'PENDING' && row.state !== 'RETRY_SCHEDULED') return null;
    if (row.leaseExpiresAt && row.leaseExpiresAt > now) return null;

    const updated = await tx.externalEventReceipt.update({
      where: { receiptId: row.receiptId },
      data: {
        state: 'LEASED',
        leaseOwner: args.workerId,
        leaseExpiresAt: expiresAt,
        fencingToken: token,
        leaseFencedAt: now,
        attempts: { increment: 1 },
        nextAttemptAt: null,
      },
    });
    return {
      receiptId: updated.receiptId,
      organizationId: updated.organizationId,
      provider: updated.provider,
      connectionId: updated.connectionId,
      eventId: updated.eventId,
      payloadDigest: updated.payloadDigest,
      schemaVersion: updated.schemaVersion,
      attempts: updated.attempts,
      idempotencyKey: updated.idempotencyKey,
      correlationId: updated.correlationId,
      fencingToken: token,
      leaseOwner: args.workerId,
      leaseExpiresAt: nowMs + args.leaseDurationMs,
      leaseFencedAt: nowMs,
    };
  });
}

// ─── 2. claimNextIntent ──────────────────────────────────────────

export async function claimNextIntent(
  prisma: PrismaClient,
  args: {
    workerId: string;
    leaseDurationMs: number;
    clock: Clock;
    idGen: IdGenerator;
    receiptId?: string;
    organizationId?: string;
  },
): Promise<ClaimedIntent | null> {
  const orgId = args.organizationId ?? '';
  const receiptId = args.receiptId ?? '';
  const nowMs = args.clock.now();
  const expiresAt = asIsoDate(nowMs + args.leaseDurationMs);
  const now = asIsoDate(nowMs);
  const token = args.idGen.next();

  return runInTxn(prisma, async (tx) => {
    const rows = await tx.$queryRaw<Array<{
      intentId: string;
      receiptId: string;
      organizationId: string;
      idempotencyKey: string | null;
      correlationId: string | null;
      intentSource: string;
      attempts: number;
    }>>`
      SELECT "intentId", "receiptId", "organizationId", "idempotencyKey",
             "correlationId", "intentSource", "attempts"
      FROM integration."DispatchIntent"
      WHERE "status" = 'PENDING'
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= ${now})
        ${orgId ? Prisma.sql`AND "organizationId" = ${orgId}` : Prisma.empty}
        ${receiptId ? Prisma.sql`AND "receiptId" = ${receiptId}` : Prisma.empty}
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    if (rows.length === 0) return null;
    const row = rows[0]!;
    await tx.dispatchIntent.update({
      where: { intentId: row.intentId },
      data: {
        status: 'LEASED',
        leaseOwner: args.workerId,
        leaseExpiresAt: expiresAt,
        fencingToken: token,
        leaseFencedAt: now,
        attempts: { increment: 1 },
      },
    });
    return {
      intentId: row.intentId,
      receiptId: row.receiptId,
      organizationId: row.organizationId,
      idempotencyKey: row.idempotencyKey,
      correlationId: row.correlationId,
      intentSource: row.intentSource,
      attempts: row.attempts + 1,
      fencingToken: token,
      leaseOwner: args.workerId,
      leaseExpiresAt: nowMs + args.leaseDurationMs,
      leaseFencedAt: nowMs,
    };
  });
}

// ─── 3. extendLease (heartbeat) ───────────────────────────────────

export async function extendLease(
  prisma: PrismaClient,
  args: {
    fencingToken: string;
    leaseOwner: string;
    leaseDurationMs: number;
    clock: Clock;
    kind: 'receipt' | 'intent';
  },
): Promise<boolean> {
  const nowMs = args.clock.now();
  const newExpiry = asIsoDate(nowMs + args.leaseDurationMs);
  const now = asIsoDate(nowMs);
  if (args.kind === 'receipt') {
    const result = await prisma.externalEventReceipt.updateMany({
      where: {
        fencingToken: args.fencingToken,
        leaseOwner: args.leaseOwner,
        state: 'LEASED',
      },
      data: {
        leaseExpiresAt: newExpiry,
        leaseFencedAt: now,
      },
    });
    return result.count === 1;
  }
  const result = await prisma.dispatchIntent.updateMany({
    where: {
      fencingToken: args.fencingToken,
      leaseOwner: args.leaseOwner,
      status: 'LEASED',
    },
    data: {
      leaseExpiresAt: newExpiry,
      leaseFencedAt: now,
    },
  });
  return result.count === 1;
}

// ─── 4. releaseLease (graceful / cancel) ─────────────────────────

export async function releaseLease(
  prisma: PrismaClient,
  args: {
    fencingToken: string;
    leaseOwner: string;
    kind: 'receipt' | 'intent';
  },
): Promise<boolean> {
  if (args.kind === 'receipt') {
    const result = await prisma.externalEventReceipt.updateMany({
      where: {
        fencingToken: args.fencingToken,
        leaseOwner: args.leaseOwner,
        state: 'LEASED',
      },
      data: {
        state: 'PENDING',
        leaseOwner: null,
        leaseExpiresAt: null,
        fencingToken: null,
        leaseFencedAt: null,
      },
    });
    return result.count === 1;
  }
  const result = await prisma.dispatchIntent.updateMany({
    where: {
      fencingToken: args.fencingToken,
      leaseOwner: args.leaseOwner,
      status: 'LEASED',
    },
    data: {
      status: 'PENDING',
      leaseOwner: null,
      leaseExpiresAt: null,
      fencingToken: null,
      leaseFencedAt: null,
    },
  });
  return result.count === 1;
}

    // ─── 5. completeReceipt (terminal state transition w/ fencing) ────
    //
    // CORE/1.8 AC1: bounded exponential backoff + jitter.
    //
    // When outcome === 'RETRY', caller passes the injected clock + retryPolicy.
    // We call decideRetryState (determines DEAD_LETTERED vs RETRY_SCHEDULED) and
    // computeNextAttemptAt (clock-aware backoff) atomically inside the transaction.
    // This keeps retry timing deterministic in tests (manualClock) and real in prod
    // (systemClock injected at the call site).
    //
    // CORE/1.8 AC1: bounded exponential backoff + jitter.
    //
    // When outcome === 'RETRY', caller passes the injected clock + retryPolicy.
    // We call decideRetryState (determines DEAD_LETTERED vs RETRY_SCHEDULED) and
    // computeNextAttemptAt (clock-aware backoff) atomically inside the transaction.
    // This keeps retry timing deterministic in tests (manualClock) and real in prod
    // (systemClock injected at the call site).

    export interface CompleteReceiptArgs {
      fencingToken: string;
      leaseOwner: string;
      /** 'SUCCESS' → DELIVERED. 'RETRY' → compute backoff. 'FAIL' → DEAD_LETTERED. */
      outcome: 'SUCCESS' | 'RETRY' | 'FAIL';
      /** Error metadata for retry/dead-letter decision. */
      error?: StoreError;
      /** Injected retry policy (from DEFAULT_RETRY_POLICY or test override). */
      retryPolicy?: RetryPolicy;
      /** Injected clock for deterministic nextAttemptAt computation. */
      clock: Clock;
    }

    export interface CompleteReceiptResult {
      state: 'DELIVERED' | 'RETRY_SCHEDULED' | 'DEAD_LETTERED';
      nextAttemptAt: number | null;
      fencedRejected: boolean;
    }

export async function completeReceipt(
  prisma: PrismaClient,
  args: CompleteReceiptArgs,
): Promise<CompleteReceiptResult> {
  return runInTxn(prisma, async (tx) => {
    const nowMs = args.clock.now();
    const now = asIsoDate(nowMs);

    const row = await tx.externalEventReceipt.findFirst({
      where: {
        fencingToken: args.fencingToken,
        leaseOwner: args.leaseOwner,
        state: 'LEASED',
      },
    });
    if (!row) {
      return { state: 'DELIVERED', nextAttemptAt: null, fencedRejected: true };
    }

    if (args.outcome === 'SUCCESS') {
      await tx.externalEventReceipt.update({
        where: { receiptId: row.receiptId },
        data: {
          state: 'DELIVERED',
          resolvedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          fencingToken: null,
          leaseFencedAt: null,
        },
      });
      return { state: 'DELIVERED', nextAttemptAt: null, fencedRejected: false };
    }

    const policy = args.retryPolicy;
    const err = args.error ?? storeError('TRANSACTION_FAILED', 'unknown failure', { retryable: false });
    let decision: ReturnType<typeof decideRetryState>;
    if (args.outcome === 'RETRY' && policy) {
      decision = decideRetryState(policy, row.attempts, err);
    } else {
      // outcome === 'FAIL' or outcome === 'RETRY' with no policy.
      // CORE/1.8 AC1: policy/validation errors (VALIDATION_ERROR, VERSION_CONFLICT,
      // IDEMPOTENCY_CONFLICT, SCOPE_MISMATCH, TENANT_SCOPE_REQUIRED) → DEAD_LETTERED
      // immediately. Transient errors without a policy also go to DEAD_LETTERED
      // (caller is responsible for wiring retryPolicy for transient errors).
      decision = { terminal: 'DEAD_LETTERED' as const };
    }

    if (decision.terminal === 'RETRY_SCHEDULED' && policy) {
      // CORE/1.8 AC1: bounded exponential backoff + jitter via injected clock.
      // row.attempts = number of attempts already made BEFORE this failure.
      // computeNextAttemptAt(base, currentAttempts, clock) gives us the epoch ms
      // when the NEXT attempt should run.
      const nextAt = computeNextAttemptAt(policy, row.attempts, args.clock);
      await tx.externalEventReceipt.update({
        where: { receiptId: row.receiptId },
        data: {
          state: 'RETRY_SCHEDULED',
          nextAttemptAt: asIsoDate(nextAt),
          reasonCode: err.code,
          leaseOwner: null,
          leaseExpiresAt: null,
          fencingToken: null,
          leaseFencedAt: null,
        },
      });
      return {
        state: 'RETRY_SCHEDULED',
        nextAttemptAt: nextAt,
        fencedRejected: false,
      };
    }

    await tx.externalEventReceipt.update({
      where: { receiptId: row.receiptId },
      data: {
        state: 'DEAD_LETTERED',
        resolvedAt: now,
        reasonCode: err.code,
        leaseOwner: null,
        leaseExpiresAt: null,
        fencingToken: null,
        leaseFencedAt: null,
      },
    });
    return {
      state: 'DEAD_LETTERED',
      nextAttemptAt: null,
      fencedRejected: false,
    };
  });
}

// ─── 6. completeIntent (terminal state transition w/ fencing) ─────

export interface CompleteIntentArgs {
  fencingToken: string;
  leaseOwner: string;
  outcome: 'SUCCESS' | 'RETRY' | 'FAIL';
  error?: StoreError;
}

export async function completeIntent(
  prisma: PrismaClient,
  args: CompleteIntentArgs,
): Promise<{ status: 'DELIVERED' | 'FAILED' | 'TERMINAL'; fencedRejected: boolean }> {
  return runInTxn(prisma, async (tx) => {
    const row = await tx.dispatchIntent.findFirst({
      where: {
        fencingToken: args.fencingToken,
        leaseOwner: args.leaseOwner,
        status: 'LEASED',
      },
    });
    if (!row) {
      return { status: 'DELIVERED', fencedRejected: true };
    }
    if (args.outcome === 'SUCCESS') {
      await tx.dispatchIntent.update({
        where: { intentId: row.intentId },
        data: {
          status: 'DELIVERED',
          leaseOwner: null,
          leaseExpiresAt: null,
          fencingToken: null,
          leaseFencedAt: null,
        },
      });
      return { status: 'DELIVERED', fencedRejected: false };
    }
    await tx.dispatchIntent.update({
      where: { intentId: row.intentId },
      data: {
        status: args.outcome === 'RETRY' ? 'FAILED' : 'TERMINAL',
        leaseOwner: null,
        leaseExpiresAt: null,
        fencingToken: null,
        leaseFencedAt: null,
      },
    });
    return { status: args.outcome === 'RETRY' ? 'FAILED' : 'TERMINAL', fencedRejected: false };
  });
}

// ─── 7. reclaimExpiredLeases (background sweep) ──────────────────

export async function reclaimExpiredLeases(
  prisma: PrismaClient,
  clock: Clock,
): Promise<{ receipts: number; intents: number }> {
  const now = asIsoDate(clock.now());
  const receipts = await prisma.externalEventReceipt.updateMany({
    where: {
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
  const intents = await prisma.dispatchIntent.updateMany({
    where: {
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
  return { receipts: receipts.count, intents: intents.count };
}

// ─── 8. releaseAllForWorker (shutdown drain) ──────────────────────

export async function releaseAllForWorker(
  prisma: PrismaClient,
  args: { workerId: string; clock: Clock },
): Promise<{ receipts: number; intents: number }> {
  const now = asIsoDate(args.clock.now());
  const receipts = await prisma.externalEventReceipt.updateMany({
    where: {
      leaseOwner: args.workerId,
      state: 'LEASED',
    },
    data: {
      state: 'PENDING',
      leaseOwner: null,
      leaseExpiresAt: null,
      fencingToken: null,
      leaseFencedAt: now,
    },
  });
  const intents = await prisma.dispatchIntent.updateMany({
    where: {
      leaseOwner: args.workerId,
      status: 'LEASED',
    },
    data: {
      status: 'PENDING',
      leaseOwner: null,
      leaseExpiresAt: null,
      fencingToken: null,
      leaseFencedAt: now,
    },
  });
  return { receipts: receipts.count, intents: intents.count };
}

// ─── 9. findReceiptByFencingToken (worker internal) ──────────────

export async function findReceiptByFencingToken(
  prisma: PrismaClient,
  fencingToken: string,
): Promise<{ receiptId: string; state: string } | null> {
  const row = await prisma.externalEventReceipt.findFirst({
    where: { fencingToken },
    select: { receiptId: true, state: true },
  });
  if (!row) return null;
  return { receiptId: row.receiptId, state: row.state };
}

// ─── 10. requireOwnerScope helper ─────────────────────────────────

export function requireWorkerScope(scope: {
  organizationId?: string;
}): string {
  return requireScope(scope);
}
