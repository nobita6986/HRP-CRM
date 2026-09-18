/**
 * integration-api/src/receiver/hmac-verify.ts — CORE/1.2
 *
 * HMAC signature verification cho inbound webhook receiver. **CÔ LẬP** —
 * algorithm + secret từ ConnectionRegistry (server-trusted), KHÔNG từ
 * request header / URL path / body.
 *
 * Per Owner brief + Auditor F2 (CORE/1.2 CHANGES_REQUIRED):
 *  - Pin algorithm theo connection config tin cậy.
 *  - Header nếu có chỉ được đối chiếu, không chọn/override algorithm.
 *  - Tests: connection SHA512 không nhận request chọn SHA256;
 *    missing/unsupported/mismatched config fail closed.
 *
 * Algorithm support (CORE/1.2):
 *  - HMAC_SHA256
 *  - HMAC_SHA512
 *
 * KHÔNG support ED25519 (chưa test fixture; sẽ xem xét V7.9b/c).
 *
 * Provider signature headers:
 *  - CHATWOOT: `X-Chatwoot-Signature` (hex).
 *  - ZALO_OA:  `X-Zalo-Oa-Signature` (hex).
 *  - GENERIC:  `X-Webhook-Signature` (hex); algorithm cross-check
 *    header `X-Webhook-Algorithm` (optional; cross-check only).
 *
 * Fail closed:
 *  - missing signature header → 401.
 *  - header algorithm mismatch → 401.
 *  - malformed signature (non-hex / empty) → 401.
 *  - signature mismatch → 401.
 *  - registry missing entry → 401 (returned by caller; this layer
 *    không phụ trách registry resolution).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ConnectionAlgorithm } from './connection-registry.js';

export type HmacVerifyResult =
  | { ok: true; algorithm: ConnectionAlgorithm }
  | {
      ok: false;
      reason:
        | 'missing_signature_header'
        | 'algorithm_header_mismatch'
        | 'malformed_signature'
        | 'signature_mismatch';
      message: string;
    };

/** Headers we look at for provider-specific signature. */
export const SIGNATURE_HEADER_BY_PROVIDER: Readonly<Record<string, string>> =
  Object.freeze({
    CHATWOOT: 'x-chatwoot-signature',
    ZALO_OA: 'x-zalo-oa-signature',
    GENERIC: 'x-webhook-signature',
  });

/** Generic-only header for algorithm cross-check (Pinned algorithm comes from registry). */
export const ALGORITHM_HEADER = 'x-webhook-algorithm';

const ALLOWED_ALGORITHMS = new Set<string>(['HMAC_SHA256', 'HMAC_SHA512']);

export function isSupportedAlgorithmString(s: string): boolean {
  return ALLOWED_ALGORITHMS.has(s);
}

/**
 * Verify HMAC signature với algorithm PÍN từ registry.
 *
 * @param args.rawBody        Raw bytes từ HTTP request (KHÔNG mutate).
 * @param args.headers        Header keys lowercase (Node.js http convention).
 * @param args.provider       Provider từ URL path (đã registry-verified).
 * @param args.pinnedAlgorithm Algorithm từ ConnectionRegistry — KHÔNG dùng header.
 * @param args.secret         Shared secret từ ConnectionRegistry (synthetic env).
 */
export function verifyHmacSignature(args: {
  rawBody: Uint8Array;
  headers: Record<string, string>;
  provider: string;
  pinnedAlgorithm: ConnectionAlgorithm;
  secret: string;
}): HmacVerifyResult {
  const { rawBody, headers, provider, pinnedAlgorithm, secret } = args;

  const sigHeader = SIGNATURE_HEADER_BY_PROVIDER[provider];
  if (!sigHeader) {
    // Provider không có mapping → caller không nên gọi. Fail closed.
    return {
      ok: false,
      reason: 'missing_signature_header',
      message: `Provider không có signature header mapping: ${provider}`,
    };
  }
  const sigValue = headers[sigHeader] ?? headers[sigHeader.toLowerCase()];
  if (!sigValue) {
    return {
      ok: false,
      reason: 'missing_signature_header',
      message: `Thiếu signature header: ${sigHeader}`,
    };
  }

  // F2: algorithm cross-check. Header CHỈ đối chiếu, không chọn.
  if (provider === 'GENERIC') {
    const declared = (headers[ALGORITHM_HEADER] ?? '').trim();
    if (declared !== '') {
      if (!isSupportedAlgorithmString(declared)) {
        return {
          ok: false,
          reason: 'algorithm_header_mismatch',
          message: `Header ${ALGORITHM_HEADER}=${declared} không thuộc allowlist [${[...ALLOWED_ALGORITHMS].join(', ')}]`,
        };
      }
      if (declared !== pinnedAlgorithm) {
        return {
          ok: false,
          reason: 'algorithm_header_mismatch',
          message: `Header ${ALGORITHM_HEADER}=${declared} KHÔNG khớp pinned algorithm từ registry: ${pinnedAlgorithm}`,
        };
      }
    }
    // If header absent → use pinned algorithm (registry is source of truth).
  }

  // Decode signature từ hex.
  let sigBytes: Buffer;
  try {
    sigBytes = Buffer.from(sigValue.trim(), 'hex');
    if (sigBytes.length === 0) {
      throw new Error('empty');
    }
  } catch {
    return {
      ok: false,
      reason: 'malformed_signature',
      message: 'Signature không phải hex hợp lệ',
    };
  }

  const expected = createHmac(pinnedAlgorithm === 'HMAC_SHA256' ? 'sha256' : 'sha512', secret)
    .update(rawBody)
    .digest();

  if (
    sigBytes.length !== expected.length ||
    !timingSafeEqual(sigBytes, expected)
  ) {
    return {
      ok: false,
      reason: 'signature_mismatch',
      message: 'HMAC signature không khớp',
    };
  }

  return { ok: true, algorithm: pinnedAlgorithm };
}
