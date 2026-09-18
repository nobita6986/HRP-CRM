// src/errors.ts — Internal error types cho integration store (CORE/1.3).
//
// Errors carry metadata chỉ từ store layer; KHÔNG leak PII/CCC/raw payload.
// Caller (Gate 0 contracts) map sang canonical error codes:
//  - VALIDATION_ERROR (schema fail)
//  - VERSION_CONFLICT (aggregateVersion mismatch)
//  - IDEMPOTENCY_CONFLICT (duplicate scope + same key different payload)
//  - FORBIDDEN (cross-scope attempt)
//  - UNKNOWN_COMMAND_OUTCOME (txn state corruption)
//
// T1 cố tình KHÔNG dùng class extends Error để tránh serialize ngầm;
// dùng plain object + code/retryable fields.

export interface StoreError {
  readonly code:
    | 'VALIDATION_ERROR'
    | 'DUPLICATE_KEY'
    | 'VERSION_CONFLICT'
    | 'SCOPE_MISMATCH'
    | 'TRANSACTION_FAILED'
    | 'TENANT_SCOPE_REQUIRED';
  readonly message: string;
  readonly retryable: boolean;
  readonly target?: string;
}

export function storeError(
  code: StoreError['code'],
  message: string,
  opts?: { retryable?: boolean; target?: string },
): StoreError {
  const e: StoreError = {
    code,
    message,
    retryable: opts?.retryable ?? false,
  };
  if (opts?.target) {
    return { ...e, target: opts.target };
  }
  return e;
}

export function isStoreError(x: unknown): x is StoreError {
  return !!x && typeof x === 'object' && 'code' in x && typeof (x as { code: unknown }).code === 'string';
}
