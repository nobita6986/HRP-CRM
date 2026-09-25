/**
 * automation/idempotency-store.ts — in-memory idempotency ledger.
 *
 * Per N8N/0.3 r1 binding:
 *  - Scope key:        orgId|connId|serviceId|commandName|idempotencyKey
 *  - Record key:       scopeKey
 *  - correlationId:    BOUND into the record on first successful write.
 *                      Lookup compares the stored bound correlationId
 *                      with the incoming correlationId. Mismatch is
 *                      treated as IDEMPOTENCY_CONFLICT (409), even
 *                      when the payload digest is byte-identical.
 *
 * Why correlationId is bound:
 *   Per N8N/0.3 r1 verdict, the same logical flow / retry MUST keep
 *   the same correlationId. Same (idempotencyKey, payloadDigest) but
 *   rotated correlationId means the caller is NOT the same logical
 *   flow as the record — it is a different retry/fanout attempt
 *   reusing a key, which we refuse. commandId and n8nExecutionId
 *   may rotate; they are NOT part of this binding.
 *
 * Behavior:
 *  - lookup: returns a hit ONLY if (scopeKey, payloadDigest) match the
 *    stored record AND the stored boundCorrelationId equals the
 *    incoming correlationId.
 *  - Differing correlationId even with same digest -> IDEMPOTENCY_CONFLICT.
 *  - Differing digest (any correlationId) -> IDEMPOTENCY_CONFLICT.
 *  - record: stores the result keyed by scopeKey and binds the
 *    correlationId at first-write time. Subsequent updates preserve
 *    the originally bound correlationId (first-writer-wins).
 *
 * Eviction: LRU by insertion when maxRecords is reached; TTL on read.
 */

import { AutomationIdempotencyRecord, AutomationWireResponse } from './types.js';

export type IdempotencyLookup =
  | { hit: false }
  | { hit: true; record: AutomationIdempotencyRecord; cacheHit: true }
  | {
      hit: true;
      record: null;
      cacheHit: false;
      idempotencyConflict: true;
      storedDigest: string;
      incomingDigest: string;
      storedCorrelationId: string;
      incomingCorrelationId: string;
      reason: 'payload_digest_mismatch' | 'correlation_id_mismatch';
    };

export class AutomationIdempotencyStore {
  private readonly map = new Map<string, AutomationIdempotencyRecord>();
  private readonly insertionOrder: string[] = [];
  private readonly maxRecords: number;
  private readonly retentionMs: number;
  private readonly now: () => number;

  constructor(
    opts: {
      maxRecords?: number;
      retentionMs?: number;
      now?: () => number;
    } = {},
  ) {
    this.maxRecords = opts.maxRecords ?? 100_000;
    this.retentionMs = opts.retentionMs ?? 24 * 60 * 60 * 1000;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Scope key derivation. Caller passes the server-trusted scope
   * fields; the gateway does NOT include any caller-claim fields.
   * correlationId is intentionally excluded from the scope key; it
   * is bound into the record value instead.
   */
  static scopeKey(args: {
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

  lookup(args: {
    scopeKey: string;
    payloadDigest: string;
    correlationId: string;
  }): IdempotencyLookup {
    this.evictExpired();
    const stored = this.map.get(args.scopeKey);
    if (!stored) {
      return { hit: false };
    }
    if (stored.payloadDigest !== args.payloadDigest) {
      return {
        hit: true,
        record: null,
        cacheHit: false,
        idempotencyConflict: true,
        storedDigest: stored.payloadDigest,
        incomingDigest: args.payloadDigest,
        storedCorrelationId: stored.boundCorrelationId,
        incomingCorrelationId: args.correlationId,
        reason: 'payload_digest_mismatch',
      };
    }
    if (stored.boundCorrelationId !== args.correlationId) {
      return {
        hit: true,
        record: null,
        cacheHit: false,
        idempotencyConflict: true,
        storedDigest: stored.payloadDigest,
        incomingDigest: args.payloadDigest,
        storedCorrelationId: stored.boundCorrelationId,
        incomingCorrelationId: args.correlationId,
        reason: 'correlation_id_mismatch',
      };
    }
    return { hit: true, record: stored, cacheHit: true };
  }

  /**
   * Records a successful invocation. correlationId is bound on the
   * FIRST write only; subsequent writes preserve the original binding
   * so a second writer cannot overwrite a record keyed by another
   * logical flow.
   */
  record(record: AutomationIdempotencyRecord): void {
    const existing = this.map.get(record.scopeKey);
    if (existing) {
      // Preserve the originally-bound correlationId. Other fields are
      // updated in place; this keeps the LRU insertion order steady.
      this.map.set(record.scopeKey, {
        ...record,
        boundCorrelationId: existing.boundCorrelationId,
      });
      return;
    }
    this.map.set(record.scopeKey, record);
    this.insertionOrder.push(record.scopeKey);
    while (this.insertionOrder.length > this.maxRecords) {
      const evicted = this.insertionOrder.shift();
      if (evicted) this.map.delete(evicted);
    }
  }

  size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
    this.insertionOrder.length = 0;
  }

  private evictExpired(): void {
    const cutoff = this.now() - this.retentionMs;
    let i = 0;
    while (i < this.insertionOrder.length) {
      const key = this.insertionOrder[i];
      if (!key) {
        i += 1;
        continue;
      }
      const rec = this.map.get(key);
      if (!rec || rec.createdAt < cutoff) {
        this.map.delete(key);
        this.insertionOrder.splice(i, 1);
        continue;
      }
      i += 1;
    }
  }
}

export type IdempotencyStoreRecordArgs = Omit<AutomationIdempotencyRecord, 'createdAt' | 'result'> & {
  result: AutomationWireResponse;
};
