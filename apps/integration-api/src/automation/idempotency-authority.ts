/**
 * automation/idempotency-authority.ts — RG-02 durable idempotency authority.
 *
 * This module defines the AUTHORITATIVE contract for the real gateway
 * idempotency ledger. It is a SEPARATE module from `idempotency-store.ts`
 * because the latter is the synchronous in-memory implementation
 * inherited by the local mock gateway; that module is retained as an
 * injected test adapter ONLY per the N8N/0.3 r1 implementation gate.
 *
 * Authoritative semantics (per RG-02, RG-05 — T1-B N8N/0.3):
 *   - scopeKey          = server-trusted org|conn|service|cmd|idempotencyKey
 *   - atomic first claim  on (scopeKey, payloadDigest, correlationId)
 *   - same triple        -> replay recorded response (cacheHit)
 *   - digest mismatch    -> IDEMPOTENCY_CONFLICT (payload_digest_mismatch)
 *   - correlationId diff -> IDEMPOTENCY_CONFLICT (correlation_id_mismatch)
 *   - first writer wins  : the originally-bound correlationId is preserved
 *                          across subsequent record() calls
 *   - bounded pending/lease/recovery : no permanent stall if owner dies
 *   - retention cleanup  : recorded rows expire after retentionMs
 *
 * The interface is ASYNC. The legacy in-memory store is sync; the new
 * Postgres-backed store is async. The gateway.ts integration change
 * (await lookup/record) is documented in
 * `docs/contracts/n8n/N8N-0.3-REAL-GATEWAY-PLAN-R1/GATEWAY-AUTHORITY-INTEGRATION.md`
 * and is NOT part of this slice.
 *
 * Logging:
 *   Every implementation MUST NOT log the raw envelope, the resolved
 *   secret, the request body, the signature, the authorization header,
 *   the Idempotency-Key header, nor the correlationId in plaintext when
 *   log retention is enabled. Diagnostics may echo only:
 *     - scopeKey (server-derived, non-secret)
 *     - payloadDigest (sha256 hex of envelope — non-secret)
 *     - state transitions: PENDING -> LEASED -> RECORDED
 *     - reason codes: payload_digest_mismatch, correlation_id_mismatch,
 *                     lease_expired, reclaim_succeeded, retention_purged
 *
 * Threat boundary:
 *   - Caller claims (workflowId/revision/executionId/idempotencyKey/
 *     correlationId/sourceEventId) are untrusted until the envelope
 *     passes schema validation.
 *   - scopeKey is computed FROM the server-trusted registry entry, never
 *     from raw body fields.
 *   - payloadDigest is computed over the envelope MINUS volatile tracking
 *     ids (correlationId, occurredAt, commandId, n8nExecutionId).
 */

import type { AutomationIdempotencyRecord } from './types.js';

/**
 * Lookup outcome for an idempotency claim attempt.
 *
 * The shape mirrors the legacy `IdempotencyLookup` discriminated union
 * but is async-friendly and adds the LEASED branch required by RG-02
 * bounded pending/lease semantics.
 */
export type IdempotencyLookup =
  | { hit: false }
  | { hit: true; record: AutomationIdempotencyRecord; cacheHit: true }
  | {
      hit: true;
      record: AutomationIdempotencyRecord | null;
      cacheHit: false;
      /** A claim was leased but its terminal result is not yet recorded. */
      leased: boolean;
      idempotencyConflict: boolean;
      storedDigest: string;
      incomingDigest: string;
      storedCorrelationId: string;
      incomingCorrelationId: string;
      leaseOwner: string | null;
      reason:
        | 'payload_digest_mismatch'
        | 'correlation_id_mismatch'
        | 'lease_expired'
        | 'fencing_rejected';
    };

/**
 * Reason taxonomy for authority-level log/audit events. Never log
 * secret-bearing fields under any of these reasons.
 */
export type IdempotencyReasonCode =
  | 'first_claim'
  | 'replay_cache_hit'
  | 'payload_digest_mismatch'
  | 'correlation_id_mismatch'
  | 'lease_expired'
  | 'reclaim_succeeded'
  | 'retention_purged'
  | 'rollback_dropped_pending'
  | 'record_idempotent_replay';

/**
 * Authoritative interface every real-gateway idempotency adapter MUST
 * implement. Adapters are pluggable: the real gateway runtime wires in
 * `PostgresIdempotencyAuthority`; tests inject `InMemoryIdempotencyAuthority`.
 */
export interface IdempotencyAuthority {
  /**
   * Server-trusted scope key derivation. Identical across implementations.
   */
  scopeKey(args: {
    organizationId: string;
    connectionId: string;
    serviceId: string;
    commandName: string;
    idempotencyKey: string;
  }): string;

  /**
   * Attempt a first claim on the (scopeKey, payloadDigest, correlationId)
   * triple. Implementations MUST be atomic — exactly one concurrent claim
   * wins. The wire contract:
   *
   *   - No row                                -> { hit: false }.
   *   - Row exists, triple identical          -> { hit: true, record, cacheHit }.
   *   - Row exists, digest differs            -> { hit: true, idempotencyConflict,
   *                                              reason: 'payload_digest_mismatch' }.
   *   - Row exists, correlationId differs     -> { hit: true, idempotencyConflict,
   *                                              reason: 'correlation_id_mismatch' }.
   *   - Row exists in PENDING/LEASED and the
   *     inbound triple matches (in-progress)  -> implementations MAY return
   *                                              { hit: false } so that the
   *                                              caller proceeds and races the
   *                                              terminal record() call. The
   *                                              record() path is idempotent on
   *                                              the same triple (first writer
   *                                              wins), so a colliding caller
   *                                              cannot apply the downstream
   *                                              action twice.
   */
  lookup(args: {
    scopeKey: string;
    payloadDigest: string;
    correlationId: string;
  }): Promise<IdempotencyLookup>;

  /**
   * Record the terminal result. MUST be idempotent on the same triple
   * (scopeKey, payloadDigest, correlationId). First-writer-wins preserves
   * the originally-bound correlationId even if a later writer submits
   * a different one.
   *
   * Throws only on hard infrastructure failure (DB offline, schema
   * missing). Returns void on success.
   */
  record(record: AutomationIdempotencyRecord): Promise<void>;

  /**
   * Diagnostic-only; implementations may return an estimate. Used by
   * integration tests and ops dashboards, NEVER by the runtime path.
   */
  size(): Promise<number>;

  /**
   * Diagnostic-only; truncates authority state. Tests use this to set
   * up a known baseline; production adapters MUST refuse this call when
   * configured in real-runtime mode.
   */
  reset(): Promise<void>;

  /**
   * TTL purge of expired recorded rows. Implementations MUST honor
   * retentionMs. Returns the number of rows purged (diagnostic only).
   */
  purgeExpired(now?: number): Promise<number>;

  /**
   * Reclaim any lease whose heartbeat has lapsed (leaseExpiresAt <
   * `now`). Implements the bounded-pending recovery semantics. Returns
   * the number of leases reclaimed.
   */
  reclaimExpiredLeases(args: {
    now: number;
    leaseOwner: string;
  }): Promise<number>;

  /**
   * Close any DB pool / timers owned by the authority. Safe to call
   * multiple times. After close(), all other methods throw.
   */
  close(): Promise<void>;
}

/**
 * AuthorityAdapterStats — minimal observability shape returned by tests
 * and recovery sweeps. Does NOT contain secrets or envelope data.
 */
export interface AuthorityAdapterStats {
  readonly recordedRows: number;
  readonly leasedRows: number;
  readonly pendingRows: number;
  readonly expiredPendingReclaimed: number;
  readonly purgedRetention: number;
}

/**
 * A no-op authoritative reason tagger used by adapters that want a
 * uniform stringification for redacted log entries.
 */
export function formatIdempotencyReason(
  code: IdempotencyReasonCode,
  detail?: { scopeKey?: string; payloadDigest?: string },
): string {
  const tag = code;
  if (!detail) return tag;
  const scope = detail.scopeKey ? `scopeKeyHash=${stableShort(detail.scopeKey)}` : 'scopeKeyHash=<absent>';
  const digest = detail.payloadDigest ? `digestPrefix=${detail.payloadDigest.slice(0, 8)}` : 'digestPrefix=<absent>';
  return `${tag} ${scope} ${digest}`;
}

/**
 * Stable, short, non-reversible identifier for a long string. Uses a
 * 64-bit FNV-1a hash (NOT cryptographic — for log de-duplication ONLY).
 * NEVER log the raw scopeKey — it is server-derived but is a known
 * fixed-shape string an operator might correlate.
 */
function stableShort(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}
