/**
 * automation/in-memory-idempotency-authority.ts — RG-02 in-memory adapter.
 *
 * Per RG-02: "The in-memory store may remain only as an explicitly
 * injected test adapter." This module is the test adapter for the
 * `IdempotencyAuthority` interface. It mirrors the legacy
 * `AutomationIdempotencyStore` semantics plus the bounded pending/lease
 * stubs needed to drive unit tests in isolation without PostgreSQL.
 *
 * Logging: NEVER logs raw envelope / secret / signature / auth header.
 * It MAY log scopeKey hash + digest prefix for recovery sweeps.
 */

import { SCHEMA_VERSION } from '@hrp-engagement/contracts';
import type {
  AutomationIdempotencyRecord,
} from './types.js';
import {
  type IdempotencyAuthority,
  type IdempotencyLookup,
} from './idempotency-authority.js';

interface InternalRow {
  record: AutomationIdempotencyRecord;
  state: 'RECORDED' | 'PENDING';
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
}

export interface InMemoryAuthorityOptions {
  maxRecords?: number;
  retentionMs?: number;
  leaseDurationMs?: number;
  now?: () => number;
}

const DEFAULT_MAX_RECORDS = 100_000;
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LEASE_MS = 30_000;

export class InMemoryIdempotencyAuthority implements IdempotencyAuthority {
  private readonly rows = new Map<string, InternalRow>();
  private readonly insertionOrder: string[] = [];
  private readonly maxRecords: number;
  private readonly retentionMs: number;
  private readonly leaseDurationMs: number;
  private readonly now: () => number;
  private closed = false;

  constructor(opts: InMemoryAuthorityOptions = {}) {
    this.maxRecords = opts.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.retentionMs = opts.retentionMs ?? DEFAULT_RETENTION_MS;
    this.leaseDurationMs = opts.leaseDurationMs ?? DEFAULT_LEASE_MS;
    this.now = opts.now ?? (() => Date.now());
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

  async lookup(args: {
    scopeKey: string;
    payloadDigest: string;
    correlationId: string;
  }): Promise<IdempotencyLookup> {
    this.assertOpen();
    this.purgeExpiredInternal(this.now());
    const row = this.rows.get(args.scopeKey);
    if (!row) {
      return { hit: false };
    }
    if (row.record.payloadDigest !== args.payloadDigest) {
      return {
        hit: true,
        record: null,
        cacheHit: false,
        leased: row.state === 'PENDING',
        idempotencyConflict: true,
        storedDigest: row.record.payloadDigest,
        incomingDigest: args.payloadDigest,
        storedCorrelationId: row.record.boundCorrelationId,
        incomingCorrelationId: args.correlationId,
        leaseOwner: row.leaseOwner,
        reason: 'payload_digest_mismatch',
      };
    }
    if (row.record.boundCorrelationId !== args.correlationId) {
      return {
        hit: true,
        record: null,
        cacheHit: false,
        leased: row.state === 'PENDING',
        idempotencyConflict: true,
        storedDigest: row.record.payloadDigest,
        incomingDigest: args.payloadDigest,
        storedCorrelationId: row.record.boundCorrelationId,
        incomingCorrelationId: args.correlationId,
        leaseOwner: row.leaseOwner,
        reason: 'correlation_id_mismatch',
      };
    }
    if (row.state === 'PENDING') {
      return {
        hit: true,
        record: row.record,
        cacheHit: false,
        leased: true,
        idempotencyConflict: false,
        storedDigest: row.record.payloadDigest,
        incomingDigest: args.payloadDigest,
        storedCorrelationId: row.record.boundCorrelationId,
        incomingCorrelationId: args.correlationId,
        leaseOwner: row.leaseOwner,
        reason: 'lease_expired',
      };
    }
    return { hit: true, record: row.record, cacheHit: true };
  }

  async record(record: AutomationIdempotencyRecord): Promise<void> {
    this.assertOpen();
    const existing = this.rows.get(record.scopeKey);
    if (existing) {
      // First-writer-wins on boundCorrelationId.
      this.rows.set(record.scopeKey, {
        record: {
          ...record,
          boundCorrelationId: existing.record.boundCorrelationId,
        },
        state: 'RECORDED',
        leaseOwner: null,
        leaseExpiresAt: null,
      });
      return;
    }
    this.rows.set(record.scopeKey, {
      record,
      state: 'RECORDED',
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    this.insertionOrder.push(record.scopeKey);
    while (this.insertionOrder.length > this.maxRecords) {
      const evicted = this.insertionOrder.shift();
      if (evicted) this.rows.delete(evicted);
    }
  }

  /**
   * Test-only helper: pre-populate a PENDING/LEASED row to simulate
   * the bounded-pending state. Production code MUST go through
   * PostgresIdempotencyAuthority.
   */
  async _seedPending(args: {
    scopeKey: string;
    payloadDigest: string;
    boundCorrelationId: string;
    commandName: string;
    organizationId: string;
    connectionId: string;
    serviceId: string;
    idempotencyKey: string;
    workflowId: string;
    leaseOwner: string;
    leaseDurationMs?: number;
  }): Promise<void> {
    this.assertOpen();
    const leaseDurationMs = args.leaseDurationMs ?? this.leaseDurationMs;
    const leasedAt = this.now();
    const bound: AutomationIdempotencyRecord = {
      scopeKey: args.scopeKey,
      idempotencyKey: args.idempotencyKey,
      payloadDigest: args.payloadDigest,
      boundCorrelationId: args.boundCorrelationId,
      commandName: args.commandName,
      organizationId: args.organizationId,
      connectionId: args.connectionId,
      workflowId: args.workflowId,
      createdAt: leasedAt,
      result: {
        status: 'ACCEPTED',
        schemaVersion: SCHEMA_VERSION,
        commandId: 'seed-pending',
        correlationId: args.boundCorrelationId,
      } as AutomationIdempotencyRecord['result'],
    };
    this.rows.set(args.scopeKey, {
      record: bound,
      state: 'PENDING',
      leaseOwner: args.leaseOwner,
      leaseExpiresAt: leasedAt + leaseDurationMs,
    });
    this.insertionOrder.push(args.scopeKey);
  }

  async size(): Promise<number> {
    this.assertOpen();
    return this.rows.size;
  }

  async reset(): Promise<void> {
    this.assertOpen();
    this.rows.clear();
    this.insertionOrder.length = 0;
  }

  async purgeExpired(now?: number): Promise<number> {
    this.assertOpen();
    return this.purgeExpiredInternal(now ?? this.now());
  }

  private purgeExpiredInternal(cutoffWall: number): number {
    const cutoff = cutoffWall - this.retentionMs;
    let purged = 0;
    let i = 0;
    while (i < this.insertionOrder.length) {
      const key = this.insertionOrder[i];
      if (!key) {
        i += 1;
        continue;
      }
      const row = this.rows.get(key);
      if (!row) {
        this.insertionOrder.splice(i, 1);
        continue;
      }
      if (row.state === 'RECORDED' && row.record.createdAt < cutoff) {
        this.rows.delete(key);
        this.insertionOrder.splice(i, 1);
        purged += 1;
        continue;
      }
      i += 1;
    }
    return purged;
  }

  async reclaimExpiredLeases(args: {
    now: number;
    leaseOwner: string;
  }): Promise<number> {
    this.assertOpen();
    let count = 0;
    for (const [key, row] of this.rows.entries()) {
      if (
        row.state === 'PENDING' &&
        row.leaseExpiresAt !== null &&
        row.leaseExpiresAt < args.now
      ) {
        // The reclaim owner takes over the lease. The PENDING row is
        // converted to a RECORDED lease-reclaimed record so that
        // subsequent identical replays get a deterministic recorded
        // response. (For tests this is observable.)
        this.rows.set(key, {
          record: {
            ...row.record,
            createdAt: args.now,
          },
          state: 'RECORDED',
          leaseOwner: args.leaseOwner,
          leaseExpiresAt: null,
        });
        count += 1;
      }
    }
    return count;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('InMemoryIdempotencyAuthority has been closed');
    }
  }
}
