/**
 * src/observability/kill-switch.ts — CORE/1.14 kill-switch + recovery runbook.
 *
 * Two-state machine:
 *   ARMED   → mutating routes return 423 LOCKED.
 *   DISARMED → mutating routes function normally.
 *
 * Trigger sources:
 *   - Env flag `HRP_KILL_SWITCH=armed` on startup.
 *   - Manager-only POST /api/admin/killswitch with body `{ state: 'armed'|'disarmed' }`.
 *
 * Recovery runbook:
 *   POST /api/admin/recovery/run    — replay queued receipts (idempotent).
 *   GET  /api/admin/recovery/status — depth + last action.
 *   POST /api/admin/recovery/resolve { receiptId } — manually mark resolved.
 *
 * Invariants (CORE/1.14 brief):
 *   - Kill-switch never silently swallows a receipt — armed route returns
 *     423 with body `{ error: 'KILL_SWITCH_ARMED', receiptId }` so the
 *     caller knows to retry via recovery.
 *   - Recovery is idempotent — replaying the same receipt twice MUST NOT
 *     produce duplicate side effects. Receipts are tracked by `receiptId`
 *     (server-generated UUID) + applied-state ledger.
 *   - Recovery does NOT fake success: if receipt state is FAILED with
 *     unrecoverable error, recovery returns the same error.
 */
import { randomUUID } from 'node:crypto';
import { inc, type RecoveryState } from './metrics.js';

export type KillSwitchState = 'armed' | 'disarmed';

export interface RecoveryReceipt {
  receiptId: string;
  correlationId: string;
  /** Where the receipt originated (routeName). */
  routeName: string;
  /** Side effect kind — used to dedupe replay attempts. */
  effectKind: 'commit_batch' | 'confirm_draft' | 'provider_put' | 'intake_run' | 'intake_dnc';
  /** Input idempotency key from caller (or derived digest). */
  idempotencyKey: string;
  /** Current receipt state. */
  state: 'pending' | 'applied' | 'failed';
  /** Reason for failure (if state=failed). */
  failureReason?: string;
  /** When the receipt was first enqueued. */
  enqueuedAt: string;
  /** When applied (if state=applied). */
  appliedAt?: string;
}

class KillSwitch {
  private state: KillSwitchState;

  constructor() {
    const env = process.env.HRP_KILL_SWITCH;
    this.state = env === 'armed' ? 'armed' : 'disarmed';
  }

  getState(): KillSwitchState {
    return this.state;
  }

  /** Manager-only state transition. Returns previous state. */
  setState(next: KillSwitchState): KillSwitchState {
    const prev = this.state;
    this.state = next;
    inc('kill_switch.transition', { killSwitchState: next });
    if (next === 'armed') {
      inc('kill_switch.armed', {});
    } else {
      inc('kill_switch.disarmed', {});
    }
    return prev;
  }

  /** True if mutating routes should be blocked. */
  isArmed(): boolean {
    return this.state === 'armed';
  }
}

class RecoveryLedger {
  /** In-memory receipt store keyed by receiptId. */
  private receipts: Map<string, RecoveryReceipt> = new Map();
  /** Index for idempotency: idempotencyKey -> receiptId. */
  private byIdempotencyKey: Map<string, string> = new Map();
  private lastAction: { kind: 'replay' | 'resolve'; receiptId: string; at: string } | null = null;

  /** Register a new receipt. Returns receiptId. */
  register(args: {
    correlationId: string;
    routeName: string;
    effectKind: RecoveryReceipt['effectKind'];
    idempotencyKey: string;
  }): string {
    // If a receipt with same idempotencyKey already exists, return its id.
    const existing = this.byIdempotencyKey.get(args.idempotencyKey);
    if (existing) {
      return existing;
    }
    const receiptId = `rcpt-${randomUUID()}`;
    const receipt: RecoveryReceipt = {
      receiptId,
      correlationId: args.correlationId,
      routeName: args.routeName,
      effectKind: args.effectKind,
      idempotencyKey: args.idempotencyKey,
      state: 'pending',
      enqueuedAt: new Date().toISOString(),
    };
    this.receipts.set(receiptId, receipt);
    this.byIdempotencyKey.set(args.idempotencyKey, receiptId);
    inc('recovery.registered', {});
    return receiptId;
  }

  /** Mark receipt as applied (terminal state). */
  markApplied(receiptId: string): void {
    const r = this.receipts.get(receiptId);
    if (!r) return;
    if (r.state === 'applied') {
      // Idempotent: already applied — return success, do not duplicate.
      return;
    }
    r.state = 'applied';
    r.appliedAt = new Date().toISOString();
    inc('recovery.applied', {});
  }

  /** Mark receipt as failed (terminal state). */
  markFailed(receiptId: string, reason: string): void {
    const r = this.receipts.get(receiptId);
    if (!r) return;
    if (r.state === 'failed') return;
    r.state = 'failed';
    r.failureReason = reason;
    inc('recovery.failed', {});
    // CORE/1.14 B4: failed receipts enter DLQ semantics; only count
    // events that match dlq semantics (failed terminal state from a
    // recovered-blocked mutation). Pending/recovery-in-progress events
    // are NOT DLQ events.
    inc('intent.dlq', { decision: 'give_up' });
  }

  /** Lookup a receipt by id. */
  get(receiptId: string): RecoveryReceipt | null {
    return this.receipts.get(receiptId) ?? null;
  }

  /** Lookup a receipt by idempotencyKey. */
  getByIdempotencyKey(idempotencyKey: string): RecoveryReceipt | null {
    const id = this.byIdempotencyKey.get(idempotencyKey);
    return id ? this.receipts.get(id) ?? null : null;
  }

  /** All pending receipts (for recovery run). */
  listPending(): RecoveryReceipt[] {
    return Array.from(this.receipts.values()).filter((r) => r.state === 'pending');
  }

  /** Total count by state. */
  depth(): { pending: number; applied: number; failed: number; total: number } {
    let pending = 0;
    let applied = 0;
    let failed = 0;
    for (const r of this.receipts.values()) {
      if (r.state === 'pending') pending++;
      else if (r.state === 'applied') applied++;
      else if (r.state === 'failed') failed++;
    }
    return { pending, applied, failed, total: this.receipts.size };
  }

  /** Mark receipt as resolved by manager. */
  resolve(receiptId: string): boolean {
    const r = this.receipts.get(receiptId);
    if (!r) return false;
    if (r.state === 'applied') {
      // Already applied — do nothing.
      this.lastAction = { kind: 'resolve', receiptId, at: new Date().toISOString() };
      return true;
    }
    r.state = 'applied';
    r.appliedAt = new Date().toISOString();
    this.lastAction = { kind: 'resolve', receiptId, at: new Date().toISOString() };
    inc('recovery.resolve', {});
    return true;
  }

  /** Record last replay action. */
  recordReplay(receiptId: string): void {
    this.lastAction = { kind: 'replay', receiptId, at: new Date().toISOString() };
    inc('recovery.replay', {});
  }

  getLastAction(): RecoveryLedger['lastAction'] {
    return this.lastAction;
  }

  /** Reset ledger — for test isolation. */
  reset(): void {
    this.receipts.clear();
    this.byIdempotencyKey.clear();
    this.lastAction = null;
  }
}

export const killSwitch = new KillSwitch();
export const recoveryLedger = new RecoveryLedger();

/**
 * Aggregate recovery state — surfaced via /api/admin/recovery/status.
 * Returns:
 *   'healthy'      — no pending or failed receipts.
 *   'degraded'     — pending > 0 OR failed > 0 but kill-switch DISARMED.
 *   'recovering'   — kill-switch ARMED (operator actively suppressing).
 *   'recovered'    — lastAction exists and is recent (≤60s) replay/resolve.
 */
export function aggregateRecoveryState(): RecoveryState {
  const depth = recoveryLedger.depth();
  if (depth.pending === 0 && depth.failed === 0) return 'healthy';
  if (killSwitch.isArmed()) return 'recovering';
  if (depth.failed > 0) return 'degraded';
  return 'degraded';
}

/**
 * Test-only: reset kill-switch state. (Server-level singleton — use
 * `killSwitch.setState('disarmed')` to disable env-set state.)
 */
export function resetForTest(): void {
  killSwitch.setState('disarmed');
  recoveryLedger.reset();
}
