// src/worker/clock.ts — Injectable deterministic clock.
//
// CORE/1.4 — Durable worker leasing needs a clock for:
//  - leaseExpiresAt computation (now + duration).
//  - nextAttemptAt computation (now + backoff).
//  - leaseFencedAt audit timestamp.
//
// Production wiring uses `systemClock()`. Tests inject `manualClock(epoch)`
// or `mutableClock()` for deterministic backoff timing.
export interface Clock {
  /** Returns current epoch ms. */
  now(): number;
}

export function systemClock(): Clock {
  return {
    now: () => Date.now(),
  };
}

export function manualClock(epoch: number): Clock {
  return {
    now: () => epoch,
  };
}

/**
 * Mutable clock for tests that simulate time passing without sleeping.
 * Call `advance(ms)` to move the clock forward.
 */
export interface MutableClock extends Clock {
  advance(ms: number): void;
  set(epoch: number): void;
}

export function mutableClock(initial?: number): MutableClock {
  let current = initial ?? Date.now();
  return {
    now: () => current,
    advance(ms: number): void {
      if (ms < 0) throw new Error('mutableClock.advance: ms must be >= 0');
      current += ms;
    },
    set(epoch: number): void {
      current = epoch;
    },
  };
}
