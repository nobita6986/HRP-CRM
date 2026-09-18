// src/reconciler/reconciliation-scheduler.ts — Reconciliation Scheduler (CORE/1.8 AC5).
//
// AC5 requirements:
//   1. Periodic scan for stuck receipts and intents.
//   2. Reconciliation creates recovery actions with deduplication.
//   3. No SQL against HRP core database.
//   4. No outbound to real providers.
//
// Design:
//   - ReconciliationScheduler runs periodic scans on an interval.
//   - NOT a real production scheduler (no cron); this is a synthetic/mock
//     scheduler that can be triggered manually or via HTTP API.
//   - Each scan: reconcileReceipts() + reconcileIntents().
//   - Scheduler maintains:
//       - lastScanAt: timestamp of last scan.
//       - lastScanStats: count of items processed.
//       - schedulerId: unique ID per scheduler instance.
//   - Actor string: "reconciler:<schedulerId>".
//
// Thread-safety: safe to call runScan() concurrently; each scan uses
// its own Prisma transaction per item. Concurrent scans for the same
// stuck item are handled by RecoveryAction idempotency key.

import type { PrismaClient } from '@prisma/client';
import { reconcileReceipts, type ReconcileReceiptResult } from './stuck-receipt-reconciler.js';
import { reconcileIntents, type ReconcileIntentResult } from './stuck-intent-reconciler.js';

export interface ScanStats {
  /** Number of receipt scans performed (total runs). */
  receiptScans: number;
  /** Number of intent scans performed (total runs). */
  intentScans: number;
  /** Last scan timestamp (ISO string). */
  lastScanAt: string | null;
  /** Total stuck receipts recovered in last scan. */
  lastReceiptsRecovered: number;
  /** Total stuck intents recovered in last scan. */
  lastIntentsRecovered: number;
  /** Total errors in last scan. */
  lastErrors: string[];
  /** Scheduler ID (for audit actor). */
  schedulerId: string;
}

export interface ReconciliationSchedulerDeps {
  /** Prisma client for integration store. */
  prisma: PrismaClient;
  /** Optional scheduler ID (default auto-generated). */
  schedulerId?: string;
  /** Optional scan interval in ms (for auto-mode; default 60_000). */
  intervalMs?: number;
}

/**
 * ReconciliationScheduler — orchestrates periodic reconciliation scans.
 *
 * This is a SYNTHETIC/MOCK scheduler (not a real production cron):
 *   - start() begins auto-scanning on interval.
 *   - runScan() performs one immediate scan (can be called manually or by HTTP).
 *   - stop() halts auto-scanning.
 *
 * Thread-safety:
 *   - Auto-scan runs in the background; calling runScan() while auto-scan
 *     is running is safe (both use same Prisma client, DB handles locking).
 *   - Concurrent scans for the same stuck item: idempotency key dedupes.
 */
export class ReconciliationScheduler {
  private readonly prisma: PrismaClient;
  private readonly schedulerId: string;
  private readonly intervalMs: number;
  private autoScanTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  // Stats accumulated over scheduler lifetime.
  private stats: ScanStats;

  constructor(deps: ReconciliationSchedulerDeps) {
    this.prisma = deps.prisma;
    this.schedulerId = deps.schedulerId ?? `sched-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.intervalMs = deps.intervalMs ?? 60_000;
    this.stats = {
      receiptScans: 0,
      intentScans: 0,
      lastScanAt: null,
      lastReceiptsRecovered: 0,
      lastIntentsRecovered: 0,
      lastErrors: [],
      schedulerId: this.schedulerId,
    };
  }

  /** Actor string used in RecoveryAction audit trail. */
  private get actor(): string {
    return `reconciler:${this.schedulerId}`;
  }

  /**
   * Start auto-scanning on the configured interval.
   * Safe to call multiple times (idempotent).
   */
  start(): void {
    if (this.stopped) return;
    if (this.autoScanTimer !== null) return; // already started

    this.autoScanTimer = setInterval(() => {
      if (!this.stopped) {
        void this.runScan().catch((err) => {
          // Log but don't crash the timer.
          console.error(JSON.stringify({
            level: 'error',
            msg: 'ReconciliationScheduler auto-scan error',
            schedulerId: this.schedulerId,
            error: err instanceof Error ? err.message : String(err),
          }));
        });
      }
    }, this.intervalMs);
  }

  /**
   * Stop auto-scanning. Safe to call multiple times.
   */
  stop(): void {
    this.stopped = true;
    if (this.autoScanTimer !== null) {
      clearInterval(this.autoScanTimer);
      this.autoScanTimer = null;
    }
  }

  /**
   * Run one reconciliation scan (receipts + intents).
   *
   * Can be called manually or via HTTP API.
   *
   * @returns scan results and updated stats.
   */
  async runScan(): Promise<{
    receiptResults: ReconcileReceiptResult[];
    intentResults: ReconcileIntentResult[];
    stats: ScanStats;
  }> {
    const scanAt = new Date().toISOString();

    // Scan receipts.
    const receiptScan = await reconcileReceipts({
      prisma: this.prisma,
      actor: this.actor,
      batchSize: 200,
    });

    // Scan intents.
    const intentScan = await reconcileIntents({
      prisma: this.prisma,
      actor: this.actor,
      batchSize: 200,
    });

    // Update stats.
    const recoveredReceipts = receiptScan.results.filter(
      (r) => r.action === 'RECOVERED',
    ).length;
    const recoveredIntents = intentScan.results.filter(
      (r) => r.action === 'RECOVERED',
    ).length;

    this.stats = {
      receiptScans: this.stats.receiptScans + 1,
      intentScans: this.stats.intentScans + 1,
      lastScanAt: scanAt,
      lastReceiptsRecovered: recoveredReceipts,
      lastIntentsRecovered: recoveredIntents,
      lastErrors: [
        ...receiptScan.errors,
        ...intentScan.errors,
      ].slice(0, 50), // cap errors list
      schedulerId: this.schedulerId,
    };

    return {
      receiptResults: receiptScan.results,
      intentResults: intentScan.results,
      stats: this.stats,
    };
  }

  /**
   * Get current scheduler stats (read-only snapshot).
   */
  getStats(): Readonly<ScanStats> {
    return { ...this.stats };
  }

  /** Scheduler ID. */
  getSchedulerId(): string {
    return this.schedulerId;
  }

  /** True if auto-scanning is active. */
  isRunning(): boolean {
    return this.autoScanTimer !== null && !this.stopped;
  }
}
