/**
 * automation/digest.ts — canonical digest for idempotency + signatures.
 *
 * Canonical JSON + SHA-256 helpers used by the gateway for idempotency
 * and HMAC verification. Reimplemented locally (rather than re-using
 * the async exports from @hrp-engagement/contracts) because the
 * gateway needs a synchronous digest path for HMAC signing.
 *
 * If the contracts package ever exports a sync helper, this file
 * becomes a thin re-export.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

function canonical(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('non-finite number không hỗ trợ canonical digest');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']';
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const key of keys) {
      parts.push(JSON.stringify(key) + ':' + canonical(record[key]));
    }
    return '{' + parts.join(',') + '}';
  }
  throw new TypeError('giá trị không biểu diễn được bằng canonical JSON');
}

export function canonicalJson(value: unknown): string {
  return canonical(value);
}

export function sha256Hex(input: string | Uint8Array): string {
  const h = createHash('sha256');
  h.update(typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input));
  return h.digest('hex');
}

/**
 * Canonical digest of a payload object (or any JSON value).
 */
export function payloadDigestHex(value: unknown): string {
  return sha256Hex(canonical(value));
}

/**
 * HMAC-SHA256 signature of a string input with the provided secret.
 * Returns a hex digest.
 *
 * The signing input is the concatenation of:
 *   scopeKey + '\n' + payloadDigestHex
 *
 * Both scopeKey and payloadDigestHex are server-deterministic and
 * contain no caller-claim data.
 */
export function hmacSha256Hex(input: string, secret: string): string {
  return createHash('sha256')
    .update(Buffer.from(input, 'utf8'))
    .update(Buffer.from(secret, 'utf8'))
    .digest('hex');
}

/**
 * Constant-time comparison of two hex digests.
 */
export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}