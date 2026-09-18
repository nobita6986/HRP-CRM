/**
 * outbox/index.ts — CORE/1.8: Outbox module barrel.
 *
 * CORE/1.8 AC3: Outbound intent simulation
 *  - OutboxDispatcher: polls and dispatches PENDING intents via gateway
 *  - DeliveryReceiptHandler: handles delivery receipts (ACCEPTED only)
 *  - DeliveryReportingHandler: handles delivery reports (SENT/DELIVERED/FAILED/etc.)
 *
 * CORE/1.8 AC4: UNKNOWN delivery reconciliation
 *  - ReconciliationService: CRUD for reconciliation entries
 *  - UnknownDeliveryHandler: handles UNKNOWN delivery events
 *  - ReconciliationError: error types
 *
 * Boundaries:
 *  - Frozen contracts in packages/contracts — do NOT modify
 *  - No HRP/provider/model thật — mock only
 */

// CORE/1.8 AC3: Outbox dispatcher and handlers
export { OutboxDispatcher, DEFAULT_DISPATCHER_CONFIG } from './dispatcher.js';
export type { DispatchResult, OutboxDispatcherConfig } from './dispatcher.js';

export { DeliveryReceiptHandler, createDeliveryReceiptHandler } from './delivery-receipt.js';
export type { ReceiptValidationResult, ReceiptProcessingResult } from './delivery-receipt.js';

export { DeliveryReportingHandler, createDeliveryReportingHandler } from './delivery-reporting.js';
export type { ReportingValidationResult, ReportingProcessingResult } from './delivery-reporting.js';

export { OutboxHttpHandler } from './http-handler.js';
export type { OutboxHttpHandlerOptions } from './http-handler.js';

// CORE/1.8 AC4: UNKNOWN delivery reconciliation
export {
  ReconciliationService,
  ReconciliationError,
  type ReconciliationEntry,
  type ReconciliationStatus,
  type ResolutionKind,
} from './reconciliation.js';

export {
  UnknownDeliveryHandler,
  UnknownDeliveryHandlerError,
  type UnknownDeliveryResult,
  type UnknownHandlerErrorCode,
} from './unknown-handler.js';
