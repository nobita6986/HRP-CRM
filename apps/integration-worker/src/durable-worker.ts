// apps/integration-worker/src/durable-worker.ts
//
// CORE/1.4 — Durable worker/queue leasing.
//
// Poll-based worker:
//  1. Poll every pollIntervalMs.
//  2. Reclaim expired leases (lease recovery on restart).
//  3. Claim next available receipt (FOR UPDATE SKIP LOCKED).
//  4. Execute dispatch (executor fixture).
//  5. Complete receipt (state transition with fencing).
//  6. On shutdown: drain leases gracefully.
//
// Boundaries:
//  - Poll PostgreSQL (no external broker).
//  - Receipt committed but not yet picked up → recoverable via poll.
//  - Crash after claim → lease expires → reclaimed by any worker on next poll.
//  - Stale worker cannot complete (fencing token mismatch).
//  - Retry: idempotency key preserved, not regenerated per attempt.
//  - Graceful shutdown: drain leases, wait for in-flight.
//
// AC coverage:
//  [AC1] Poll PG / crash after receipt → recoverable: step 1-2.
//  [AC2] Two workers claim same receipt → only one lease valid: step 3 (FOR UPDATE SKIP LOCKED).
//  [AC3] attempts/nextAttemptAt/owner/fencing: lease.ts manages these.
//  [AC4] Stale worker cannot override: fencing check in completeReceipt.
//  [AC5] Crash/lease expiry → retry durable: step 2 (reclaim) + executor returns retryable outcome.
//  [AC6] Shutdown drain: step 6 (releaseAllForWorker).
//  [AC7] Idempotency key preserved: executor receives + returns unchanged.

import type { Clock } from '@hrp-engagement/integration-store/worker/clock';
import type {
  ClaimedReceipt,
  RetryPolicy,
} from '@hrp-engagement/integration-store/worker';
import {
  claimNextReceipt,
  completeReceipt,
  releaseAllForWorker,
  reclaimExpiredLeases,
  systemClock as storeClock,
  uuidTokenGenerator,
  DEFAULT_RETRY_POLICY,
} from '@hrp-engagement/integration-store/worker';
import type { PrismaClient } from '@prisma/client';
import { executeReceipt, outcomeToStoreError, type ExecutorScenario } from './executor.js';
import {
  executePipelineForReceipt,
  type PipelineExecutorOutcome,
} from './pipeline-executor.js';
import {
  GatewayClient,
  createGatewayClientFromEnv,
} from './gateway-client.js';
import type { StoreError } from '@hrp-engagement/integration-store/errors';

export interface DurableWorkerConfig {
  workerId: string;
  organizationId: string;
  pollIntervalMs: number;
  leaseDurationMs: number;
  maxConcurrentJobs: number;
  retryPolicy: RetryPolicy;
  clock?: Clock;
  idGen?: { next(): string };
  defaultScenario?: ExecutorScenario;
  maxIterations?: number;
  drainTimeoutMs?: number;
  /**
   * CORE/1.5: gateway client for real pipeline execution.
   * When provided, replaces mock executor with real normalize→firewall→mapping→gateway.
   * When omitted, falls back to mock executor (CORE/1.4 behavior).
   */
  gatewayClient?: GatewayClient;
  /**
   * CORE/1.5: mapping service for pipeline execution.
   */
  mappingService?: import('./mapping.js').MappingService;
}

export interface DurableWorkerState {
  workerId: string;
  startedAt: number;
  stoppedAt: number | null;
  iterations: number;
  claimed: number;
  completed: number;
  failed: number;
  reclaimed: number;
  errors: number;
  drained: boolean;
}

interface InFlightJob {
  receipt: ClaimedReceipt;
  startMs: number;
}

export async function startDurableWorker(
  prisma: PrismaClient,
  config: DurableWorkerConfig,
): Promise<{
  state: DurableWorkerState;
  stop: () => Promise<void>;
}> {
  const clock: Clock = config.clock ?? storeClock();
  const idGen = config.idGen ?? uuidTokenGenerator;
  const retryPolicy = config.retryPolicy ?? DEFAULT_RETRY_POLICY;
  const pollIntervalMs = config.pollIntervalMs ?? 5_000;
  const leaseDurationMs = config.leaseDurationMs ?? 60_000;
  const drainTimeoutMs = config.drainTimeoutMs ?? 10_000;

  const state: DurableWorkerState = {
    workerId: config.workerId,
    startedAt: clock.now(),
    stoppedAt: null,
    iterations: 0,
    claimed: 0,
    completed: 0,
    failed: 0,
    reclaimed: 0,
    errors: 0,
    drained: false,
  };

  const inFlight = new Map<string, InFlightJob>();
  let running = true;

  const poll = async (): Promise<void> => {
    while (running) {
      try {
        // Step 1: reclaim expired leases.
        const reclaimed = await reclaimExpiredLeases(prisma, clock);
        state.reclaimed += reclaimed.receipts + reclaimed.intents;

        // Step 2: claim next receipt.
        const receipt = await claimNextReceipt(prisma, {
          workerId: config.workerId,
          leaseDurationMs,
          clock,
          idGen,
          maxPerPoll: 1,
          organizationId: config.organizationId,
        });

        if (!receipt) {
          await sleep(Math.min(pollIntervalMs, 1_000));
          continue;
        }

        state.claimed += 1;
        state.iterations += 1;
        inFlight.set(receipt.receiptId, { receipt, startMs: clock.now() });

        // Step 3: execute dispatch.
        // CORE/1.5: if gateway client is provided, use real pipeline (normalize → firewall → mapping → gateway).
        // Otherwise fall back to CORE/1.4 mock executor.
        const usePipeline = config.gatewayClient !== undefined;
        let outcome: PipelineExecutorOutcome | ReturnType<typeof executeReceipt>;
        if (usePipeline) {
          // CORE/1.8 AC1: wire completeReceiptFn so gateway errors trigger
          // bounded retry (bounded exponential backoff + jitter) via completeReceipt.
          // The durable worker owns the Prisma transaction boundary; we pass the
          // injected completeReceipt so the pipeline can coordinate retry decision.
          outcome = await executePipelineForReceipt(
            {
              receiptId: receipt.receiptId,
              eventId: receipt.eventId,
              organizationId: receipt.organizationId,
              provider: receipt.provider,
              connectionId: receipt.connectionId,
              payloadDigest: receipt.payloadDigest,
              schemaVersion: receipt.schemaVersion,
              attempts: receipt.attempts,
              idempotencyKey: receipt.idempotencyKey,
              correlationId: receipt.correlationId,
              fencingToken: receipt.fencingToken,
              leaseOwner: config.workerId,
            },
            {
              gatewayClient: config.gatewayClient!,
              prisma,
              ...(config.mappingService ? { mappingService: config.mappingService } : {}),
              completeReceiptFn: completeReceipt,
            },
          );
        } else {
          outcome = executeReceipt(
            {
              receiptId: receipt.receiptId,
              eventId: receipt.eventId,
              organizationId: receipt.organizationId,
              provider: receipt.provider,
              connectionId: receipt.connectionId,
              payloadDigest: receipt.payloadDigest,
              schemaVersion: receipt.schemaVersion,
              attempts: receipt.attempts,
              idempotencyKey: receipt.idempotencyKey,
              correlationId: receipt.correlationId,
            },
            { scenario: config.defaultScenario },
          );
        }

        // Map PipelineExecutorOutcome / ExecutorOutcome → completeReceipt args
        let completeOutcome: 'SUCCESS' | 'RETRY' | 'FAIL';
        let errCode: StoreError['code'];
        let errMessage: string;
        let retryable: boolean;

        if (usePipeline) {
          const pipelineOutcome = outcome as PipelineExecutorOutcome;
          switch (pipelineOutcome.status) {
            case 'SUCCESS':
            case 'REVIEW':
            case 'SKIPPED':
              // All three are "completed without error" from worker perspective.
              completeOutcome = 'SUCCESS';
              errCode = 'TRANSACTION_FAILED'; // placeholder; success path doesn't carry err
              errMessage = pipelineOutcome.status === 'SUCCESS'
                ? `Pipeline SUCCESS: receipt ${receipt.receiptId}`
                : pipelineOutcome.status === 'REVIEW'
                  ? `Pipeline REVIEW: receipt ${receipt.receiptId}, reviewQueueEntryId=${pipelineOutcome.reviewQueueEntryId}`
                  : `Pipeline SKIPPED: ${pipelineOutcome.reason}`;
              retryable = false;
              break;
            case 'GATEWAY_ERROR':
              completeOutcome = pipelineOutcome.retryable ? 'RETRY' : 'FAIL';
              // Map gateway code → store code. Conservative: any non-success is TXN_FAILED.
              errCode = 'TRANSACTION_FAILED';
              errMessage = `${pipelineOutcome.code}: ${pipelineOutcome.message}`;
              retryable = pipelineOutcome.retryable;
              break;
          }
        } else {
          const executorOutcome = outcome as ReturnType<typeof executeReceipt>;
          const storeErr = outcomeToStoreError(executorOutcome);
          completeOutcome = executorOutcome.status === 'SUCCESS'
            ? 'SUCCESS'
            : executorOutcome.status === 'RETRY'
              ? 'RETRY'
              : 'FAIL';
          errCode = mapExecutorCode(storeErr.code);
          errMessage = storeErr.message;
          retryable = storeErr.retryable;
        }

        const completeArgs = {
          fencingToken: receipt.fencingToken,
          leaseOwner: config.workerId,
          outcome: completeOutcome,
          error: {
            code: errCode,
            message: errMessage,
            retryable,
          },
          retryPolicy,
          clock,
        };
        const result = await completeReceipt(prisma, completeArgs);

        inFlight.delete(receipt.receiptId);
        if (result.fencedRejected) {
          state.errors += 1;
          console.warn(
            JSON.stringify({
              level: 'warn',
              msg: 'fence rejected — stale worker attempted completion',
              workerId: config.workerId,
              receiptId: receipt.receiptId,
            }),
          );
        } else if (result.state === 'DELIVERED') {
          state.completed += 1;
        } else if (result.state === 'DEAD_LETTERED') {
          state.failed += 1;
        } else {
          state.completed += 1;
        }

        if (config.maxIterations && state.iterations >= config.maxIterations) {
          running = false;
        }
      } catch (err) {
        state.errors += 1;
        console.error(
          JSON.stringify({
            level: 'error',
            msg: 'worker poll error',
            workerId: config.workerId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        await sleep(2_000);
      }

      if (running) {
        await sleep(pollIntervalMs);
      }
    }
  };

  const stop = async (): Promise<void> => {
    if (!running) return;
    running = false;

    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'worker shutting down — draining leases',
        workerId: config.workerId,
        inFlightCount: inFlight.size,
      }),
    );

    const drainStart = clock.now();
    await releaseAllForWorker(prisma, { workerId: config.workerId, clock });

    const deadline = drainStart + drainTimeoutMs;
    while (inFlight.size > 0 && clock.now() < deadline) {
      await sleep(100);
    }

    state.drained = true;
    state.stoppedAt = clock.now();

    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'worker drained',
        workerId: config.workerId,
        inFlightRemaining: inFlight.size,
        totalIterations: state.iterations,
        claimed: state.claimed,
        completed: state.completed,
        failed: state.failed,
        reclaimed: state.reclaimed,
      }),
    );
  };

  poll().catch((err) => {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'worker poll loop crashed',
        workerId: config.workerId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    state.errors += 1;
    state.stoppedAt = clock.now();
  });

  return { state, stop };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Map executor error codes → StoreError codes.
 * Executor returns internal codes (e.g., 'NO_ERROR', 'IDEMPOTENT_APPLIED');
 * we map to valid StoreError codes for the repository layer.
 */
function mapExecutorCode(code: string): StoreError['code'] {
  switch (code) {
    case 'VALIDATION_ERROR':
    case 'VERSION_CONFLICT':
    case 'IDEMPOTENCY_CONFLICT':
    case 'TRANSACTION_FAILED':
    case 'DUPLICATE_KEY':
    case 'SCOPE_MISMATCH':
    case 'TENANT_SCOPE_REQUIRED':
      return code as StoreError['code'];
    case 'NO_ERROR':
    case 'IDEMPOTENT_APPLIED':
    case 'POLICY_REJECTION':
      return 'VALIDATION_ERROR';
    default:
      return 'TRANSACTION_FAILED';
  }
}
