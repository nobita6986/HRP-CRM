/**
 * automation/errors.ts — internal error classes.
 *
 * These errors are NEVER serialized into the wire response. They are
 * caught at the gateway boundary, mapped to the FROZEN error envelope,
 * and re-emitted using the N8N-specific error table in types.ts.
 */

export class ValidationError extends Error {
  readonly kind = 'ValidationError' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class GatewayInternalError extends Error {
  readonly kind = 'GatewayInternalError' as const;
  constructor(message: string) {
    super(message);
    this.name = 'GatewayInternalError';
  }
}

export class DependencyOfflineError extends Error {
  readonly kind = 'DependencyOfflineError' as const;
  constructor(message: string) {
    super(message);
    this.name = 'DependencyOfflineError';
  }
}

export class TimeoutError extends Error {
  readonly kind = 'TimeoutError' as const;
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}