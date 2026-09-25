/**
 * automation/rate-limiter.ts — per-workflow token bucket.
 *
 * Implements Plan §N8N/0.2 AC: "bounded retry". Workflows have a fixed
 * per-window request budget; bursts up to capacity are allowed but
 * cannot exceed ateLimitPerMinute sustained throughput.
 *
 * In-memory; not distributed. Production migration requires Redis or
 * equivalent — see NEXT-GATE.md.
 */

export interface RateLimiterDecision {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
  readonly remainingTokens: number;
  readonly capacity: number;
}

export class TokenBucketRateLimiter {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, { tokens: number; lastRefill: number }>();

  constructor(opts: { capacity: number; perMinute: number; now?: () => number }) {
    if (opts.capacity <= 0) throw new Error('TokenBucket: capacity must be > 0');
    if (opts.perMinute <= 0) throw new Error('TokenBucket: perMinute must be > 0');
    this.capacity = opts.capacity;
    this.refillPerMs = opts.perMinute / 60_000;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Take one token from the bucket for the given key. If the bucket is
   * empty, the request is denied and etryAfterMs is the minimum
   * time until the bucket has at least one token.
   */
  take(key: string): RateLimiterDecision {
    const nowMs = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: nowMs };
      this.buckets.set(key, bucket);
    } else {
      const elapsed = Math.max(0, nowMs - bucket.lastRefill);
      bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs);
      bucket.lastRefill = nowMs;
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return {
        allowed: true,
        retryAfterMs: 0,
        remainingTokens: bucket.tokens,
        capacity: this.capacity,
      };
    }
    const deficit = 1 - bucket.tokens;
    const retryAfterMs = Math.ceil(deficit / this.refillPerMs);
    return {
      allowed: false,
      retryAfterMs,
      remainingTokens: bucket.tokens,
      capacity: this.capacity,
    };
  }

  reset(): void {
    this.buckets.clear();
  }

  peek(key: string): { tokens: number; lastRefill: number } | null {
    const b = this.buckets.get(key);
    if (!b) return null;
    return { tokens: b.tokens, lastRefill: b.lastRefill };
  }
}