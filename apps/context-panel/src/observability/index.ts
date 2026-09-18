/**
 * src/observability/index.ts — CORE/1.14 observability surface re-exports.
 */

export {
  generateCorrelationId,
  isValidCorrelationId,
  resolveCorrelation,
  type CorrelationContext,
} from './correlation.js';
export {
  inc,
  snapshot,
  resetAll,
  get,
  isAllowedLabelKey,
  observe,
  observationsSnapshot,
  getObservation,
  setClock,
  resetClock,
  now,
  type CounterSnapshot,
  type ObservationSummary,
  type Outcome,
  type MappingReviewDecision,
  type DlqDecision,
  type KillSwitchState,
  type RecoveryState,
} from './metrics.js';
export { scrub, isBlockedFieldName } from './log-scrubber.js';
export {
  killSwitch,
  recoveryLedger,
  aggregateRecoveryState,
  resetForTest,
  type RecoveryReceipt,
} from './kill-switch.js';
