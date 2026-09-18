// src/worker/retry.ts — Bounded retry policy (CORE/1.4).
//
// Backlog §1.4 AC:
//  - "Crash/lease expiry → retry bền".
//  - "Retry command giữ idempotency key; không tạo key theo attempt".
//
// Design:
//  - bounded exponential backoff: base * 2^(attempt-1), capped at maxMs.
//  - jitter: ±jitterFraction (default ±10%) để tránh retry storm.
//  - non-retryable errors: VALIDATION_ERROR, VERSION_CONFLICT,
//    IDEMPOTENCY_CONFLICT, FORBIDDEN. Worker KHÔNG retry these;
//    chuyển sang DEAD_LETTERED.
//  - retryable: TRANSACTION_FAILED, transient. Worker re-queue.
//  - maxAttempts default 5 (per Backlog ports.ts QueuePortEnqueueRequest
//    default).
//
// Caller (worker poll loop) gọi `computeNextAttemptAt` để tính
// nextAttemptAt khi schedule retry.

import { storeError, type StoreError } from '../errors.js';

export interface RetryPolicy {
  /** Base delay (ms). */
  baseMs: number;
  /** Maximum delay (ms) — cap exponential growth. */
  maxMs: number;
  /** Max attempts before DEAD_LETTERED. */
  maxAttempts: number;
  /** Jitter fraction (0..1). Default 0.1 = ±10%. */
  jitterFraction: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  baseMs: 1_000,
  maxMs: 5 * 60_000, // 5 minutes
  maxAttempts: 8,
  jitterFraction: 0.2,
});

/**
 * Errors that NEVER trigger retry. Worker → DEAD_LETTERED directly.
 */
const NON_RETRYABLE_CODES: ReadonlySet<string> = new Set([
  'VALIDATION_ERROR',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'SCOPE_MISMATCH',
  'TENANT_SCOPE_REQUIRED',
]);

export function isRetryable(err: StoreError): boolean {
  if (err.retryable) return true;
  return !NON_RETRYABLE_CODES.has(err.code);
}

/**
 * Compute next attempt time given current attempt count.
 * Returns Date.now() + backoff for the upcoming attempt number.
 *
 * @param policy  retry policy (default DEFAULT_RETRY_POLICY).
 * @param currentAttempts  attempt count BEFORE this failure (0-based).
 * @param clock  injected clock for determinism.
 * @returns next attempt epoch ms.
 */
export function computeNextAttemptAt(
  policy: RetryPolicy,
  currentAttempts: number,
  clock: { now(): number },
): number {
  // currentAttempts = số lần đã thử trước đó. Lần tiếp theo = currentAttempts+1.
  // backoff = base * 2^(nextAttempt-1), cap tại maxMs.
  const nextAttempt = currentAttempts + 1;
  const exp = Math.min(policy.baseMs * Math.pow(2, nextAttempt - 1), policy.maxMs);
  const jitter = exp * policy.jitterFraction;
  const offset = exp + (Math.random() * 2 - 1) * jitter;
  return clock.now() + Math.max(0, Math.round(offset));
}

/**
 * Decide terminal state for a failed attempt:
 *  - returns 'RETRY_SCHEDULED' if attempts < maxAttempts AND err retryable.
 *  - returns 'DEAD_LETTERED' otherwise.
 *
 * Caller phải set state này qua repository (lease.completeReceipt /
 * lease.failReceipt) cùng nextAttemptAt nếu retry.
 *
 * NOTE: nextAttemptAt computation is NOT done here — call sites use
 * computeNextAttemptAt(policy, currentAttempts, clock) separately so that
 * the clock can be injected (deterministic in tests, real systemClock in prod).
 * Keeping them separate makes it trivial to unit-test backoff formula.
 */
export function decideRetryState(
  policy: RetryPolicy,
  currentAttempts: number,
  err: StoreError,
): { terminal: 'RETRY_SCHEDULED' | 'DEAD_LETTERED' } {
  const retryable = isRetryable(err);
  const overAttempts = currentAttempts >= policy.maxAttempts;
  if (!retryable || overAttempts) {
    return { terminal: 'DEAD_LETTERED' };
  }
  return { terminal: 'RETRY_SCHEDULED' };
}

/**
 * Validate a retry policy. Used at worker bootstrap.
 */
export function assertValidPolicy(p: RetryPolicy): void {
  if (p.baseMs < 1) throw storeError('VALIDATION_ERROR', 'baseMs < 1', { target: 'baseMs' });
  if (p.maxMs < p.baseMs) throw storeError('VALIDATION_ERROR', 'maxMs < baseMs', { target: 'maxMs' });
  if (p.maxAttempts < 1 || p.maxAttempts > 20) {
    throw storeError('VALIDATION_ERROR', 'maxAttempts out of range [1,20]', { target: 'maxAttempts' });
  }
  if (p.jitterFraction < 0 || p.jitterFraction > 0.5) {
    throw storeError('VALIDATION_ERROR', 'jitterFraction out of range [0,0.5]', { target: 'jitterFraction' });
  }
}
