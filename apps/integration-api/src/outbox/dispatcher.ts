/**
 * outbox/dispatcher.ts — Outbox dispatcher for CORE/1.8 AC3.
 *
 * CORE/1.8 AC3 Requirements:
 *  1. Simulate accepted HRP outbound intent → durable receipt → ACK → mock provider
 *  2. Duplicate intent does NOT produce duplicate delivery logic
 *  3. Durable receipt before provider call (transaction boundary)
 *  4. ACK response shape per contracts
 *
 * Design:
 *  - OutboxDispatcher polls DispatchIntent rows (status=PENDING)
 *  - For each intent: claim it (LEASED), call mock provider (via gateway), commit result
 *  - Uses claimNextIntent + completeIntent with fencing token for atomicity
 *  - Idempotency via idempotencyKey on DispatchIntent
 *
 * Boundaries:
 *  - Frozen contracts in packages/contracts — do NOT modify
 *  - Use existing DispatchIntent table and claimNextIntent/completeIntent
 *  - No HRP/provider/model thật — mock only
 */
import type { PrismaClient } from '@prisma/client';
import { worker } from '@hrp-engagement/integration-store';
import { SCHEMA_VERSION } from '@hrp-engagement/contracts';
import type { MockGateway } from '../gateway/index.js';
import type { ScenarioId, HrpGatewayCallRequest } from '../gateway/types.js';

const { claimNextIntent, completeIntent, uuidTokenGenerator } = worker;


/**
 * Dispatch result — outcome of processing one intent.
 */
export interface DispatchResult {
  intentId: string;
  status: 'DISPATCHED' | 'ACK_RECEIVED' | 'FAILED' | 'TERMINAL';
  providerRef?: {
    providerMessageId?: string;
    providerDeliveryId?: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Dispatcher configuration.
 */
export interface OutboxDispatcherConfig {
  /** Worker ID for lease ownership. */
  workerId: string;
  /** Lease duration in milliseconds. */
  leaseDurationMs: number;
  /** Poll interval when no intents available. */
  pollIntervalMs: number;
  /** Max intents to process per poll cycle. */
  batchSize: number;
  /** Optional clock for testing. */
  clock?: () => number;
  /** Optional ID generator for testing. */
  idGen?: { next(): string };
}

/**
 * Default dispatcher configuration.
 */
export const DEFAULT_DISPATCHER_CONFIG: OutboxDispatcherConfig = {
  workerId: `outbox-dispatcher-${process.pid}`,
  leaseDurationMs: 30_000, // 30 seconds
  pollIntervalMs: 1_000,   // 1 second
  batchSize: 10,
};

/**
 * Clock provider — returns epoch milliseconds.
 */
export type ClockProvider = () => number;

/**
 * Simple clock implementation.
 */
function defaultClock(): number {
  return Date.now();
}

/**
 * OutboxDispatcher — polls PENDING intents and dispatches via mock gateway.
 *
 * Workflow per intent:
 *  1. claimNextIntent() → LEASED + fencing token
 *  2. Simulate durable receipt (already done in step 1 - commit is atomic)
 *  3. Call mock provider via gateway with scenarioId
 *  4. Update status to DISPATCHED/ACK_RECEIVED/FAILED via completeIntent
 */
export class OutboxDispatcher {
  private readonly prisma: PrismaClient;
  private readonly gateway: MockGateway;
  private readonly config: OutboxDispatcherConfig;
  private readonly clock: ClockProvider;
  private readonly idGen: { next(): string };
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    prisma: PrismaClient,
    gateway: MockGateway,
    config: Partial<OutboxDispatcherConfig> = {},
  ) {
    this.prisma = prisma;
    this.gateway = gateway;
    this.config = { ...DEFAULT_DISPATCHER_CONFIG, ...config };
    this.clock = this.config.clock ?? defaultClock;
    this.idGen = this.config.idGen ?? uuidTokenGenerator;
  }

  /**
   * Start the dispatcher polling loop.
   * Returns a stop function.
   */
  start(): () => void {
    if (this.running) {
      console.log(JSON.stringify({
        level: 'warn',
        msg: 'OutboxDispatcher already running',
      }));
      return this.stop.bind(this);
    }

    this.running = true;
    console.log(JSON.stringify({
      level: 'info',
      msg: 'OutboxDispatcher started',
      workerId: this.config.workerId,
      pollIntervalMs: this.config.pollIntervalMs,
      batchSize: this.config.batchSize,
    }));

    // Start polling immediately
    this.schedulePoll();

    return this.stop.bind(this);
  }

  /**
   * Stop the dispatcher.
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    console.log(JSON.stringify({
      level: 'info',
      msg: 'OutboxDispatcher stopped',
      workerId: this.config.workerId,
    }));
  }

  /**
   * Process one poll cycle — claim and dispatch up to batchSize intents.
   */
  async pollOnce(): Promise<DispatchResult[]> {
    if (!this.running) return [];

    const results: DispatchResult[] = [];
    let processed = 0;

    while (processed < this.config.batchSize) {
      const result = await this.processNextIntent();
      if (!result) break; // No more intents available
      results.push(result);
      processed++;
    }

    if (results.length > 0) {
      console.log(JSON.stringify({
        level: 'info',
        msg: 'OutboxDispatcher poll cycle complete',
        processed: results.length,
      }));
    }

    return results;
  }

  /**
   * Process the next available intent.
   * Returns null if no intent available.
   */
  async processNextIntent(): Promise<DispatchResult | null> {
    // Step 1: Claim next PENDING intent (atomic with fencing)
    const claimed = await claimNextIntent(this.prisma, {
      workerId: this.config.workerId,
      leaseDurationMs: this.config.leaseDurationMs,
      clock: { now: this.clock },
      idGen: this.idGen,
    });

    if (!claimed) {
      return null; // No pending intents
    }

    console.log(JSON.stringify({
      level: 'debug',
      msg: 'OutboxDispatcher claimed intent',
      intentId: claimed.intentId,
      fencingToken: claimed.fencingToken,
      attempts: claimed.attempts,
    }));

    try {
      // Step 2: Call mock provider via gateway
      const result = await this.dispatchToGateway(claimed.intentId, claimed.idempotencyKey);

      // Step 3: Complete with success — status moves to DISPATCHED (waiting for ACK)
      const completeResult = await completeIntent(this.prisma, {
        fencingToken: claimed.fencingToken,
        leaseOwner: this.config.workerId,
        outcome: 'SUCCESS',
      });

      if (completeResult.fencedRejected) {
        console.log(JSON.stringify({
          level: 'warn',
          msg: 'OutboxDispatcher: fence rejected (stale worker)',
          intentId: claimed.intentId,
        }));
      }

      return {
        intentId: claimed.intentId,
        status: 'DISPATCHED',
        providerRef: result.providerRef,
      };
    } catch (err) {
      // Provider call failed — complete with FAIL
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorCode = err instanceof Error && 'code' in err
        ? (err as { code: string }).code
        : 'DISPATCH_FAILED';

      console.log(JSON.stringify({
        level: 'error',
        msg: 'OutboxDispatcher: dispatch failed',
        intentId: claimed.intentId,
        error: errorMessage,
      }));

      await completeIntent(this.prisma, {
        fencingToken: claimed.fencingToken,
        leaseOwner: this.config.workerId,
        outcome: 'FAIL',
      });

      return {
        intentId: claimed.intentId,
        status: 'FAILED',
        error: {
          code: errorCode,
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Dispatch intent to mock gateway.
   * Builds a gateway call request from the intent data.
   */
  private async dispatchToGateway(
    intentId: string,
    idempotencyKey: string | null,
  ): Promise<{
    success: boolean;
    providerRef?: { providerMessageId?: string; providerDeliveryId?: string };
  }> {
    // Fetch the full intent details for the gateway call
    const intent = await this.prisma.dispatchIntent.findUnique({
      where: { intentId },
    });

    if (!intent) {
      throw Object.assign(new Error('Intent not found'), { code: 'INTENT_NOT_FOUND' });
    }

    // Parse intent target JSON
    const intentTarget = typeof intent.intentTargetJson === 'object'
      ? intent.intentTargetJson as Record<string, unknown>
      : {};

    // Build gateway call request
    // Scenario defaults to OUTBOX_RECEIPT_DURABLE for outbox intents
    const scenarioId: ScenarioId = (intentTarget['scenarioId'] as ScenarioId) ?? 'OUTBOX_RECEIPT_DURABLE';

    const request: HrpGatewayCallRequest = {
      schemaVersion: SCHEMA_VERSION,
      organizationId: intent.organizationId,
      commandId: intent.intentId, // Use intentId as commandId
      idempotencyKey: idempotencyKey ?? `outbox-${intentId}`,
      correlationId: intent.correlationId ?? `corr-${intentId}`,
      method: (intentTarget['gatewayMethod'] as HrpGatewayCallRequest['method']) ?? 'recordInteraction',
      context: {
        schemaVersion: SCHEMA_VERSION,
        organizationId: intent.organizationId,
        correlationId: intent.correlationId ?? `corr-${intentId}`,
        provider: (intentTarget['provider'] as string | undefined) ?? 'MOCK_PROVIDER',
        connectionId: (intentTarget['connectionId'] as string | null | undefined) ?? intent.receiptId,
        tier: (intentTarget['tier'] as HrpGatewayCallRequest['context']['tier']) ?? 'INBOUND_DEFAULT',
      },
      actor: {
        kind: 'SERVICE' as const,
        serviceId: (intentTarget['actorId'] as string) ?? intent.organizationId,
      },
      scenarioId,
      payload: intentTarget['payload'] ?? {
        intentId,
        receiptId: intent.receiptId,
        message: intentTarget['message'] ?? 'Outbound intent dispatch',
      },
    };

    // Call gateway
    const response = await this.gateway.call(request);

    // Process response
    if (response.status === 'APPLIED' || response.status === 'ACCEPTED') {
      // Extract operation ID if present (only for ACCEPTED status)
      let providerMessageId: string | undefined;
      if (response.status === 'ACCEPTED' && 'operation' in response) {
        const op = response.operation as { operationId?: string };
        providerMessageId = op.operationId;
      }
      return {
        success: true,
        providerRef: {
          providerMessageId,
        },
      };
    }

    // FAILED response
    const errors = 'errors' in response ? response.errors : [];
    const errorCode = errors[0]?.code ?? 'UNKNOWN_ERROR';
    const errorMessage = errors[0]?.messageKey ?? 'Gateway call failed';

    throw Object.assign(new Error(`${errorCode}: ${errorMessage}`), { code: errorCode });
  }

  /**
   * Schedule the next poll.
   */
  private schedulePoll(): void {
    if (!this.running) return;

    this.pollTimer = setTimeout(async () => {
      await this.pollOnce();
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  /**
   * Check if dispatcher is running.
   */
  isRunning(): boolean {
    return this.running;
  }
}

/**
 * Create an outbox dispatcher with default configuration.
 */
export function createOutboxDispatcher(
  prisma: PrismaClient,
  gateway: MockGateway,
  config?: Partial<OutboxDispatcherConfig>,
): OutboxDispatcher {
  return new OutboxDispatcher(prisma, gateway, config);
}
