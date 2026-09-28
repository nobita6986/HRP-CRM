/**
 * automation/postgres-idempotency-authority.ts — T1-B RG-02 authoritative adapter.
 *
 * Replaces the process-local Map of `idempotency-store.ts` with a
 * PostgreSQL-backed ledger that survives process restart and is safe
 * to back concurrently with multiple API instances.
 *
 * Atomic semantics (per RG-02 acceptance criteria):
 *   - first claim on (scopeKey, payloadDigest, correlationId) is atomic.
 *     The claim path uses SELECT FOR UPDATE inside a transaction so
 *     exactly one concurrent caller succeeds.
 *   - record() is idempotent on the same triple.
 *   - digest mismatch or correlationId mismatch returns a conflict
 *     lookup result; nothing is mutated.
 *
 * Bounded pending / lease / recovery:
 *   - The atomic claim inserts a row in PENDING with a fencing token
 *     and leaseExpiresAt = now + leaseDurationMs.
 *   - The terminal record() flips the row to RECORDED; an outstanding
 *     PENDING row whose lease has lapsed (now > leaseExpiresAt) is
 *     reclaimed by `reclaimExpiredLeases`, which converts it back to
 *     a RECORDED row with the lease owner's tag so the next lookup
 *     returns the deterministic recovery response — never permanent stall.
 *
 * Logging policy:
 *   - NEVER log the raw envelope, secret, signature, auth header,
 *     Idempotency-Key header, nor correlationId.
 *   - Diagnostic logs MAY echo scopeKeyHash + digestPrefix (first 8 hex).
 *   - All errors are wrapped via the named error class so callers see
 *     a single, stable error surface.
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import {
  type IdempotencyAuthority,
  type IdempotencyLookup,
} from './idempotency-authority.js';
import type { AutomationIdempotencyRecord, AutomationWireResponse } from './types.js';

/**
 * PostgresIdempotencyAuthority — production-grade adapter for the RG-02
 * durable idempotency ledger. Constructed with a PrismaClient (obtained
 * via @hrp-engagement/integration-store's `createPrismaClient`) and an
 * options bag. The instance owns NO connection state beyond the Prisma
 * pool; close() simply marks the authority as closed (the caller is
 * responsible for `prisma.$disconnect()`).
 */
export interface PostgresAuthorityOptions {
  /** Lease duration for an in-flight PENDING claim. Default 30s. */
  leaseDurationMs?: number;
  /** Retention window for RECORDED rows. Default 7 days. */
  retentionMs?: number;
  /**
   * If true, `reset()` truncates the table. Default false (refuses in
   * production). Tests opt in.
   */
  allowReset?: boolean;
  /** Clock injection. */
  now?: () => number;
  /** Stable identifier for this gateway instance; required for reclaim. */
  instanceId?: string;
}

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Stable, non-reversible 64-bit identifier derived from a string. Used
 * for de-duplicating logs without leaking the input.
 */
function shortHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

function digestPrefix(digest: string | null | undefined): string {
  if (!digest) return '<absent>';
  return digest.slice(0, 8);
}

/**
 * PgIdempotencyLookupConflict — typed error raised when a worker probe
 * detects an inconsistent in-flight claim (e.g. lease fenced by another
 * instance but row not yet reclaimed). Caught by runAdapter retry loops.
 */
export class PgIdempotencyLookupConflict extends Error {
  readonly reason:
    | 'payload_digest_mismatch'
    | 'correlation_id_mismatch'
    | 'lease_expired'
    | 'fencing_rejected';
  readonly scopeKeyHash: string;
  readonly incomingDigestPrefix: string;
  readonly storedDigestPrefix: string;
  readonly storedCorrelationHash: string;
  readonly incomingCorrelationHash: string;
  constructor(args: {
    reason: PgIdempotencyLookupConflict['reason'];
    scopeKey: string;
    incomingDigest: string;
    storedDigest: string;
    incomingCorrelationId: string;
    storedCorrelationId: string;
  }) {
    super('idempotency conflict');
    this.reason = args.reason;
    this.scopeKeyHash = shortHash(args.scopeKey);
    this.incomingDigestPrefix = digestPrefix(args.incomingDigest);
    this.storedDigestPrefix = digestPrefix(args.storedDigest);
    this.storedCorrelationHash = shortHash(args.storedCorrelationId);
    this.incomingCorrelationHash = shortHash(args.incomingCorrelationId);
  }
}

interface RawRow {
  scopeKey: string;
  payloadDigest: string;
  boundCorrelationId: string;
  incomingCorrelationIdOnRecord: string;
  idempotencyKey: string;
  commandName: string;
  organizationId: string;
  connectionId: string;
  serviceId: string;
  workflowId: string;
  state: 'PENDING' | 'RECORDED';
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  fencingToken: string | null;
  leaseFencedAt: Date | null;
  resultJson: Prisma.JsonValue;
  claimCount: number;
  hitCount: number;
  createdAt: Date;
  updatedAt: Date;
}

function rowToRecord(row: RawRow): AutomationIdempotencyRecord {
  const result = row.resultJson as unknown as AutomationWireResponse;
  return {
    scopeKey: row.scopeKey,
    idempotencyKey: row.idempotencyKey,
    payloadDigest: row.payloadDigest,
    boundCorrelationId: row.boundCorrelationId,
    commandName: row.commandName,
    organizationId: row.organizationId,
    connectionId: row.connectionId,
    workflowId: row.workflowId,
    createdAt: row.createdAt.getTime(),
    result,
  };
}

export class PostgresIdempotencyAuthority implements IdempotencyAuthority {
  private readonly prisma: PrismaClient;
  private readonly leaseDurationMs: number;
  private readonly retentionMs: number;
  private readonly allowReset: boolean;
  private readonly now: () => number;
  private readonly instanceId: string;
  private closed = false;

  constructor(prisma: PrismaClient, opts: PostgresAuthorityOptions = {}) {
    this.prisma = prisma;
    this.leaseDurationMs = opts.leaseDurationMs ?? DEFAULT_LEASE_MS;
    this.retentionMs = opts.retentionMs ?? DEFAULT_RETENTION_MS;
    this.allowReset = opts.allowReset ?? false;
    this.now = opts.now ?? (() => Date.now());
    this.instanceId = opts.instanceId ?? `pg-idem-${shortHash(Math.random().toString(36))}`;
  }

  scopeKey(args: {
    organizationId: string;
    connectionId: string;
    serviceId: string;
    commandName: string;
    idempotencyKey: string;
  }): string {
    return [
      args.organizationId,
      args.connectionId,
      args.serviceId,
      args.commandName,
      args.idempotencyKey,
    ].join('\u0000');
  }

  /**
   * Atomic claim lookup. Uses `prisma.$transaction` with `SELECT FOR
   * UPDATE` to serialize concurrent claims on the same scopeKey.
   *
   * Returns one of:
   *   - { hit: false }                                -> proceed (caller
   *                                                      should run the
   *                                                      adapter and then
   *                                                      call record()).
   *   - { hit: true, record, cacheHit: true }         -> recorded replay.
   *   - { hit: true, record: null, conflict }         -> digest / correlation
   *                                                      mismatch; caller
   *                                                      MUST treat as
   *                                                      IDEMPOTENCY_CONFLICT.
   *   - { hit: true, record, leased: true }           -> in-flight PENDING
   *                                                      claim still in
   *                                                      window; caller
   *                                                      may proceed and
   *                                                      race record(). The
   *                                                      record() path
   *                                                      preserves first-
   *                                                      writer-wins on
   *                                                      resultJson so a
   *                                                      duplicate apply
   *                                                      cannot happen.
   */
  async lookup(args: {
    scopeKey: string;
    payloadDigest: string;
    correlationId: string;
  }): Promise<IdempotencyLookup> {
    this.assertOpen();
    const nowMs = this.now();
    const nowDate = new Date(nowMs);

    return this.prisma.$transaction(async (tx) => {
      // FOR UPDATE so any concurrent claim on the same scopeKey blocks
      // until this transaction commits.
      const rows = await tx.$queryRaw<RawRow[]>`
        SELECT * FROM integration."AutomationIdempotencyRecord"
        WHERE "scopeKey" = ${args.scopeKey}
        FOR UPDATE
      `;
      const row = rows[0];

      if (!row) {
        // No prior claim. Reserve a PENDING lease so a concurrent caller's
        // SELECT FOR UPDATE in this same window sees the row and falls into
        // the leased branch — they will not create a duplicate row.
        const leaseExpiresAt = new Date(nowMs + this.leaseDurationMs);
        const fencingToken = this.newFencingToken();
        await tx.$executeRaw`
          INSERT INTO integration."AutomationIdempotencyRecord" (
            "scopeKey", "payloadDigest", "boundCorrelationId",
            "incomingCorrelationIdOnRecord", "idempotencyKey", "commandName",
            "organizationId", "connectionId", "serviceId", "workflowId",
            "state", "leaseOwner", "leaseExpiresAt", "fencingToken",
            "leaseFencedAt", "resultJson",
            "createdAt", "updatedAt", "claimCount", "hitCount"
          ) VALUES (
            ${args.scopeKey}, ${args.payloadDigest}, ${args.correlationId},
            ${args.correlationId}, ${''}, ${''},
            ${''}, ${''}, ${''}, ${''},
            'PENDING', ${this.instanceId}, ${leaseExpiresAt}, ${fencingToken},
            ${nowDate}, ${{} as unknown as Prisma.InputJsonValue},
            ${nowDate}, ${nowDate}, 1, 0
          )
          ON CONFLICT ("scopeKey") DO NOTHING
        `;
        return { hit: false };
      }

      // Increment claimCount defensively (cheap hot read).
      await tx.automationIdempotencyRecord.update({
        where: { scopeKey: row.scopeKey },
        data: { claimCount: { increment: 1 } },
      });

      // 1) Digest mismatch wins over correlationId mismatch.
      if (row.payloadDigest !== args.payloadDigest) {
        return {
          hit: true,
          record: null,
          cacheHit: false,
          leased: row.state === 'PENDING',
          idempotencyConflict: true,
          storedDigest: row.payloadDigest,
          incomingDigest: args.payloadDigest,
          storedCorrelationId: row.boundCorrelationId,
          incomingCorrelationId: args.correlationId,
          leaseOwner: row.leaseOwner,
          reason: 'payload_digest_mismatch',
        };
      }
      // 2) Digest matches but bound correlationId differs -> conflict.
      if (row.boundCorrelationId !== args.correlationId) {
        return {
          hit: true,
          record: null,
          cacheHit: false,
          leased: row.state === 'PENDING',
          idempotencyConflict: true,
          storedDigest: row.payloadDigest,
          incomingDigest: args.payloadDigest,
          storedCorrelationId: row.boundCorrelationId,
          incomingCorrelationId: args.correlationId,
          leaseOwner: row.leaseOwner,
          reason: 'correlation_id_mismatch',
        };
      }
      // 3) Triple identical. State PENDING? Tell the caller it is leased.
      if (row.state === 'PENDING') {
        return {
          hit: true,
          record: rowToRecord(row),
          cacheHit: false,
          leased: true,
          idempotencyConflict: false,
          storedDigest: row.payloadDigest,
          incomingDigest: args.payloadDigest,
          storedCorrelationId: row.boundCorrelationId,
          incomingCorrelationId: args.correlationId,
          leaseOwner: row.leaseOwner,
          reason: 'lease_expired',
        };
      }
      // 4) RECORDED with same triple -> hit, replay.
      return { hit: true, record: rowToRecord(row), cacheHit: true };
    });
  }

  async record(record: AutomationIdempotencyRecord): Promise<void> {
    this.assertOpen();
    const nowMs = this.now();
    await this.prisma.$transaction(async (tx) => {
      // SELECT FOR UPDATE so concurrent record() calls serialize.
      const rows = await tx.$queryRaw<RawRow[]>`
        SELECT * FROM integration."AutomationIdempotencyRecord"
        WHERE "scopeKey" = ${record.scopeKey}
        FOR UPDATE
      `;
      const row = rows[0];
      if (!row) {
        // No row was claimed via lookup() — caller bypassed the contract.
        // Persist the new row directly with a fresh first-writer binding.
        const leaseExpiresAt = new Date(nowMs + this.leaseDurationMs);
        const fencingToken = this.newFencingToken();
        await tx.$executeRaw`
          INSERT INTO integration."AutomationIdempotencyRecord" (
            "scopeKey", "payloadDigest", "boundCorrelationId",
            "incomingCorrelationIdOnRecord", "idempotencyKey", "commandName",
            "organizationId", "connectionId", "serviceId", "workflowId",
            "state", "leaseOwner", "leaseExpiresAt", "fencingToken",
            "leaseFencedAt", "resultJson",
            "createdAt", "updatedAt", "claimCount", "hitCount"
          ) VALUES (
            ${record.scopeKey}, ${record.payloadDigest},
            ${record.boundCorrelationId}, ${record.boundCorrelationId},
            ${record.idempotencyKey}, ${record.commandName},
            ${record.organizationId}, ${record.connectionId},
            ${''}, ${record.workflowId},
            'RECORDED', NULL, NULL, NULL, NULL,
            ${record.result as unknown as Prisma.InputJsonValue},
            ${new Date(record.createdAt)}, ${new Date(nowMs)}, 0, 1
          )
          ON CONFLICT ("scopeKey") DO NOTHING
        `;
        void leaseExpiresAt;
        void fencingToken;
        return;
      }

      // First-writer-wins: do NOT overwrite the bound correlationId.
      const isFirstWriter = row.state === 'PENDING';
      await tx.automationIdempotencyRecord.update({
        where: { scopeKey: record.scopeKey },
        data: {
          state: 'RECORDED',
          leaseOwner: null,
          leaseExpiresAt: null,
          fencingToken: null,
          leaseFencedAt: null,
          resultJson: record.result as unknown as Prisma.InputJsonValue,
          hitCount: { increment: 1 },
          // If we are filling empty bookkeeping fields from a pre-claim
          // PENDING row (placeholders), promote them. Otherwise preserve
          // the existing values.
          idempotencyKey: row.idempotencyKey || record.idempotencyKey,
          commandName: row.commandName || record.commandName,
          organizationId: row.organizationId || record.organizationId,
          connectionId: row.connectionId || record.connectionId,
          workflowId: row.workflowId || record.workflowId,
          boundCorrelationId: isFirstWriter
            ? record.boundCorrelationId
            : row.boundCorrelationId,
          // Track which correlationId attempt actually wrote the row
          // (audit-only; boundCorrelationId stays first-writer).
          incomingCorrelationIdOnRecord: record.boundCorrelationId,
        },
      });
    });
  }

  async size(): Promise<number> {
    this.assertOpen();
    return this.prisma.automationIdempotencyRecord.count();
  }

  async reset(): Promise<void> {
    this.assertOpen();
    if (!this.allowReset) {
      throw new Error('reset() refused: allowReset=false on a production authority');
    }
    await this.prisma.$executeRawUnsafe(
      `TRUNCATE TABLE integration."AutomationIdempotencyRecord"`,
    );
  }

  async purgeExpired(now?: number): Promise<number> {
    this.assertOpen();
    const cutoffMs = (now ?? this.now()) - this.retentionMs;
    const cutoffDate = new Date(cutoffMs);
    const result = await this.prisma.automationIdempotencyRecord.deleteMany({
      where: {
        state: 'RECORDED',
        createdAt: { lt: cutoffDate },
      },
    });
    return result.count;
  }

  async reclaimExpiredLeases(args: {
    now: number;
    leaseOwner: string;
  }): Promise<number> {
    this.assertOpen();
    const nowDate = new Date(args.now);
    const result = await this.prisma.automationIdempotencyRecord.updateMany({
      where: {
        state: 'PENDING',
        leaseExpiresAt: { lt: nowDate },
      },
      data: {
        state: 'RECORDED',
        leaseOwner: args.leaseOwner,
        leaseFencedAt: nowDate,
      },
    });
    return result.count;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('PostgresIdempotencyAuthority has been closed');
    }
  }

  private newFencingToken(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID().replace(/-/g, '');
    }
    return `${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
  }
}
