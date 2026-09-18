// apps/integration-worker/src/executor.ts
//
// CORE/1.4 — Durable worker queue leasing.
//
// Executor fixture: simulates what the worker does when processing a receipt.
// Isolated from CORE/1.1 (CHANGES_REQUIRED, not integrated). This fixture:
//  - Accepts a ClaimedReceipt + executor scenario config.
//  - Calls a deterministic mock gateway (scenarios: SUCCESS, FAIL, TIMEOUT,
//    PERMISSION_DENIED, IDEMPOTENCY_CONFLICT).
//  - Returns structured outcome for the worker's completeReceipt call.
//
// Boundaries:
//  - NOT the real HRP gateway. NOT production dispatch.
//  - Deterministic by fixture ID + clock.
//  - Idempotency key preserved (not regenerated per attempt).
//  - No forbidden side effects (no fake merge/Worker/EFFECTIVE).
//  - One-active-case simulation only, not concurrency proof.

export type ExecutorScenario =
  | 'SUCCESS'
  | 'FAIL_VALIDATION'
  | 'FAIL_VERSION_CONFLICT'
  | 'FAIL_IDEMPOTENCY_CONFLICT'
  | 'FAIL_PERMISSION_DENIED'
  | 'FAIL_POLICY_REJECTION'
  | 'TIMEOUT_BEFORE_APPLY'
  | 'TIMEOUT_AFTER_APPLY';

export interface ExecutorInput {
  receiptId: string;
  eventId: string;
  organizationId: string;
  provider: string;
  connectionId: string;
  payloadDigest: string;
  schemaVersion: string;
  attempts: number;
  /** Idempotency key preserved — NOT regenerated per attempt. */
  idempotencyKey: string | null;
  correlationId: string | null;
}

export interface ExecutorOutcome {
  status: 'SUCCESS' | 'RETRY' | 'FAIL';
  code: string;
  message: string;
  retryable: boolean;
}

function makeOutcome(
  status: ExecutorOutcome['status'],
  code: ExecutorOutcome['code'],
  message: string,
  retryable: boolean,
): ExecutorOutcome {
  return { status, code, message, retryable };
}

export interface ExecutorOptions {
  /**
   * Scenario drives deterministic outcome.
   * Default: 'SUCCESS'.
   */
  scenario?: ExecutorScenario;
  /**
   * Injectable clock — used for timeout simulation.
   * Default: system clock.
   */
  clock?: () => number;
  /**
   * Custom fixture ID — for deterministic same-fixture/same-clock = same-result.
   * Default: `${receiptId}-${scenario}`.
   */
  fixtureId?: string;
}

/**
 * Execute a receipt dispatch against the mock gateway.
 *
 * Determinism:
 *  - Same fixtureId + clock → same outcome.
 *  - idempotencyKey is read-only; NOT regenerated per attempt.
 *  - Same key + same payload → same result (idempotent by design).
 */
export function executeReceipt(
  input: ExecutorInput,
  opts: ExecutorOptions = {},
): ExecutorOutcome {
  const scenario = opts.scenario ?? 'SUCCESS';
  const fixtureId = opts.fixtureId ?? `${input.receiptId}-${scenario}`;

  // Deterministic dispatch based on scenario.
  switch (scenario) {
    case 'SUCCESS':
      return makeOutcome(
        'SUCCESS',
        'NO_ERROR',
        `Receipt ${input.receiptId} dispatched successfully`,
        false,
      );

    case 'FAIL_VALIDATION':
      return makeOutcome(
        'FAIL',
        'VALIDATION_ERROR',
        `Invalid payload digest or schema version`,
        false, // non-retryable
      );

    case 'FAIL_VERSION_CONFLICT':
      return makeOutcome(
        'FAIL',
        'VERSION_CONFLICT',
        `Canonical entity version mismatch`,
        false, // non-retryable
      );

    case 'FAIL_IDEMPOTENCY_CONFLICT':
      return makeOutcome(
        'FAIL',
        'IDEMPOTENCY_CONFLICT',
        `Same idempotency key used with different payload`,
        false, // non-retryable
      );

    case 'FAIL_PERMISSION_DENIED':
      return makeOutcome(
        'FAIL',
        'POLICY_REJECTION',
        `Actor lacks permission for this operation`,
        false, // non-retryable
      );

    case 'FAIL_POLICY_REJECTION':
      return makeOutcome(
        'FAIL',
        'POLICY_REJECTION',
        `Dispatch policy (e.g., DNC fence) denied`,
        false, // non-retryable
      );

    case 'TIMEOUT_BEFORE_APPLY':
      return makeOutcome(
        'RETRY',
        'TRANSACTION_FAILED',
        `Gateway timeout before canonical apply`,
        true, // retryable
      );

    case 'TIMEOUT_AFTER_APPLY':
      // Idempotent: the apply already happened, retry returns success.
      // In production this would be caught by idempotency key.
      // In mock, we simulate this by returning SUCCESS if idempotencyKey present.
      if (input.idempotencyKey) {
        return makeOutcome(
          'SUCCESS',
          'IDEMPOTENT_APPLIED',
          `Timeout after apply; idempotency key present — idempotent success`,
          false,
        );
      }
      return makeOutcome(
        'RETRY',
        'TRANSACTION_FAILED',
        `Gateway timeout after apply but no idempotency key`,
        true,
      );

    default:
      return makeOutcome(
        'FAIL',
        'VALIDATION_ERROR',
        `Unknown scenario: ${scenario}`,
        false,
      );
  }
}

/**
 * Convert ExecutorOutcome → StoreError shape (for completeReceipt).
 */
export function outcomeToStoreError(outcome: ExecutorOutcome): {
  code: string;
  message: string;
  retryable: boolean;
} {
  return {
    code: outcome.code,
    message: outcome.message,
    retryable: outcome.retryable,
  };
}
