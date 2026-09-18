// src/worker/index.ts — Public surface cho CORE/1.4 worker leasing.
export type { Clock, MutableClock } from './clock.js';
export { systemClock, manualClock, mutableClock } from './clock.js';

export {
  DEFAULT_RETRY_POLICY,
  isRetryable,
  computeNextAttemptAt,
  decideRetryState,
  assertValidPolicy,
} from './retry.js';
export type { RetryPolicy } from './retry.js';

export type { IdGenerator } from './lease.js';
export { uuidTokenGenerator } from './lease.js';
export {
  claimNextReceipt,
  claimSpecificReceipt,
  claimNextIntent,
  extendLease,
  releaseLease,
  releaseAllForWorker,
  completeReceipt,
  completeIntent,
  reclaimExpiredLeases,
  findReceiptByFencingToken,
} from './lease.js';
export type {
  ReceiptScope,
  IntentScope,
  LeaseHandle,
  ClaimedReceipt,
  ClaimedIntent,
  CompleteReceiptArgs,
  CompleteReceiptResult,
} from './lease.js';
