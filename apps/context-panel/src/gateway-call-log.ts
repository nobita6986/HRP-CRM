/**
 * context-panel/src/gateway-call-log.ts — Per-session gateway call log (B4 evidence).
 *
 * Tracks gateway invocations issued by IntakeOrchestrator (wrapped by
 * orchestrator-wire) to enable regression tests to assert:
 *  - applied steps did NOT re-invoke the gateway for already-applied steps
 *  - resumed calls only invoke gateway for the not-yet-applied steps
 *  - replay with same idempotencyKey hits the ledger cache (no new mutation)
 *
 * This is NOT a production audit log. It is a test-only intra-process observer
 * pointing at the CORE/1.1 mock gateway ledger.
 */

import type { ServerSession } from './orchestrator-wire.js';

export interface GatewayCallEntry {
  /** Iso-epoc millis (fixedNow() in tests) when call entered wrapper. */
  at: number;
  method: string;
  idempotencyKey: string;
  organizationId: string;
  correlationId: string;
  scenarioId: string;
  actorKind: string;
  actorId: string;
}

/** Per-session gateway call log. NOT reset per request. */
class GatewayCallLog {
  private readonly entries: GatewayCallEntry[] = [];

  record(entry: Omit<GatewayCallEntry, 'at'>): void {
    this.entries.push({ ...entry, at: Date.now() });
  }

  snapshot(): ReadonlyArray<GatewayCallEntry> {
    return Object.freeze([...this.entries]);
  }

  size(): number {
    return this.entries.length;
  }

  filterByIdempotencyKey(key: string): ReadonlyArray<GatewayCallEntry> {
    return Object.freeze(this.entries.filter((e) => e.idempotencyKey === key));
  }

  countByMethod(method: string): number {
    return this.entries.filter((e) => e.method === method).length;
  }

  reset(): void {
    this.entries.length = 0;
  }
}

/**
 * Lazy-attach a GatewayCallLog to the session so we don't need to break the
 * existing ServerSession API. The session is held in module scope, so we use
 * a WeakMap keyed by session identity.
 */
const logBySession = new WeakMap<object, GatewayCallLog>();

export function gatewayCallLog(session: ServerSession): GatewayCallLog {
  let log = logBySession.get(session);
  if (!log) {
    log = new GatewayCallLog();
    logBySession.set(session, log);
  }
  return log;
}

export function ledgerSnapshot(session: ServerSession): ReadonlyArray<GatewayCallEntry> {
  return gatewayCallLog(session).snapshot();
}

/** Reset all logs attached to this session. Test-only. */
export function resetCallLog(session: ServerSession): void {
  gatewayCallLog(session).reset();
}
