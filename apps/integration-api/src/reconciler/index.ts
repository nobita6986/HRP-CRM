// src/reconciler/index.ts — Barrel export for reconciler package.
//
// CORE/1.8 AC5 — Reconciler for stuck receipts/jobs/mappings.
//
// Exports:
//   - StuckReceiptReconciler: reconcileReceipts(), recoverReceipt()
//   - StuckIntentReconciler: reconcileIntents(), recoverIntent()
//   - ReconciliationScheduler: periodic scan orchestrator
//   - HTTP handler: /mock/reconciler/* routes

export {
  reconcileReceipts,
  recoverReceipt,
  type ReconcileReceiptResult,
  type StuckReceiptReconcilerDeps,
} from './stuck-receipt-reconciler.js';

export {
  reconcileIntents,
  recoverIntent,
  type ReconcileIntentResult,
  type StuckIntentReconcilerDeps,
} from './stuck-intent-reconciler.js';

export {
  ReconciliationScheduler,
  type ScanStats,
  type ReconciliationSchedulerDeps,
} from './reconciliation-scheduler.js';

export { ReconciliationHttpHandler } from './http-handler.js';
