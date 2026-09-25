/**
 * automation/idempotency-store.ts — in-memory idempotency ledger.
 *
 * Per Plan §N8N/0.2 AC: "idempotency, digest và replay conflict".
 *
 * Scope key: orgId|connectionId|serviceId|commandName|idempotencyKey.
 * correlationId is INTENTIONALLY excluded from the scope key — it is a
 * tracking identifier and the same logical command may legitimately
 * appear under different correlation ids (retries, fan-out, etc).
 *
 * Behavior:
 *  - lookup: returns a hit if (scopeKey, payloadDigest) match the
 *    stored record.
 *  - ecord: stores a result keyed by scopeKey + payloadDigest.
 *  - On lookup, if scopeKey matches but payloadDigest DIFFERS, the
 *    store returns idempotencyConflict=true so the gateway can return
 *    the FROZEN IDEMPOTENCY_CONFLICT (409).
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
  }): IdempotencyLookup {
    this.evictExpired();
    const stored = this.map.get(args.scopeKey);
    if (!stored) {
      return { hit: false };
    }
    if (stored.payloadDigest === args.payloadDigest) {
      return { hit: true, record: stored, cacheHit: true };
    }
    return {
      hit: true,
      record: null,
      cacheHit: false,
      idempotencyConflict: true,
      storedDigest: stored.payloadDigest,
      incomingDigest: args.payloadDigest,
    };
  }

  record(record: AutomationIdempotencyRecord): void {
    if (this.map.has(record.scopeKey)) {
      // Update in place; preserve insertion order so LRU is sensible.
      this.map.set(record.scopeKey, record);
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