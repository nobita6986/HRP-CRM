/**
 * pipeline-executor.ts — CORE/1.5 + CORE/1.8 AC1
 *
 * Worker executor for receipt processing — REAL pipeline.
 *
 * Full pipeline:
 *  1. Re-parse provider event from receipt
 *  2. Normalize → InboundEvent
 *  3. Semantic firewall → ClassificationResult
 *  4. Mapping service → MappingResult
 *  5. Execute action: call gateway / create review / skip
 *
 * CORE/1.8 AC1 — Retryable errors with bounded exponential backoff/jitter:
 *  - When gateway returns FAILED, we classify the error code:
 *    * Policy/validation errors (VALIDATION_ERROR, VERSION_CONFLICT,
 *      IDEMPOTENCY_CONFLICT, SCOPE_MISMATCH, TENANT_SCOPE_REQUIRED)
 *      → immediate DEAD_LETTERED (no retry).
 *    * Transient errors (TRANSACTION_FAILED, DEPENDENCY_UNAVAILABLE, etc.)
 *      → bounded RETRY_SCHEDULED (up to maxAttempts=8 with exponential backoff).
 *  - completeReceipt(gatewayError) is called with the injected retry policy
 *    and clock so that nextAttemptAt is deterministic in tests.
 *  - Idempotency key is preserved across retries (not regenerated per attempt).
 *
 * Worker reads `commandRefsJson` from receipt which contains the parsed
 * event payload (stored by integration-api at commit time).
 *
 * Idempotency:
 *  - idempotencyKey preserved from receipt
 *  - Same key + same payload → same gateway result
 *  - Retry preserves key — no double-action
 */
import type { PrismaClient } from '@prisma/client';
import { storeError, type StoreError } from '@hrp-engagement/integration-store';
import type { RetryPolicy } from '@hrp-engagement/integration-store/worker/retry';
import { classify, type ClassificationResult } from './firewall.js';
import {
  normalizeChatwootEvent,
  type InboundEvent,
} from './normalizer-shim/event-normalizer.js';
import {
  createMockMappingService,
  createProductionMappingService,
  type MappingResult,
  type MappingService,
} from './mapping.js';
import type { GatewayClient } from './gateway-client.js';
import type {
  HrpGatewayCallRequest,
  HrpGatewayCallResult,
} from './shared-types.js';
import {
  createMockRevisionTracker,
  type RevisionTracker,
  type RevisionCheckOutcome,
} from './mapping.js';

/* ───────────────────────────────────────────────────────────────────────────
 * Executor result.
 * ─────────────────────────────────────────────────────────────────────────── */
export type PipelineExecutorOutcome =
  | {
      status: 'SUCCESS';
      receiptId: string;
      gatewayResult: HrpGatewayCallResult;
      classification: ClassificationResult;
      mappingResult: MappingResult;
      operationId?: string;
    }
  | {
      status: 'REVIEW';
      receiptId: string;
      reviewQueueEntryId: string;
      classification: ClassificationResult;
      mappingResult: MappingResult;
    }
  | {
      status: 'SKIPPED';
      receiptId: string;
      reason: string;
      classification: ClassificationResult;
    }
  | {
      status: 'GATEWAY_ERROR';
      receiptId: string;
      code: string;
      message: string;
      /** true = will retry (bounded); false = dead-lettered immediately. */
      retryable: boolean;
      /** CORE/1.8: retry decision determined by completeReceipt */
      retryDecision?: 'RETRY_SCHEDULED' | 'DEAD_LETTERED';
      /** CORE/1.8: next attempt epoch ms (only if RETRY_SCHEDULED) */
      nextAttemptAt?: number | null;
      classification?: ClassificationResult;
      mappingResult?: MappingResult;
      gatewayResult?: HrpGatewayCallResult;
    };

/* ───────────────────────────────────────────────────────────────────────────
 * CORE/1.8 AC1 — Retry infrastructure.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * CORE/1.8 AC1: Classification result combining retryability + decision.
 */
export interface GatewayErrorClassification {
  /** Whether the error is retryable. */
  retryable: boolean;
  /** Concrete decision once current attempts is known. */
  decision: 'RETRY_SCHEDULED' | 'DEAD_LETTERED';
  /** Human-readable reason for the decision. */
  reason: string;
}

/**
 * CORE/1.8 AC1: Classify a gateway error code for retry decisions.
 *
 * This function is the central error-classification policy for the event pipeline.
 * Policy/validation errors (VALIDATION_ERROR, VERSION_CONFLICT, IDEMPOTENCY_CONFLICT,
 * SCOPE_MISMATCH, TENANT_SCOPE_REQUIRED) → DEAD_LETTERED immediately.
 * Transient errors (TRANSACTION_FAILED, DEPENDENCY_UNAVAILABLE, RATE_LIMITED, etc.) →
 * bounded RETRY_SCHEDULED (up to maxAttempts with exponential backoff).
 */
export function classifyGatewayError(
  errorCode: string,
  retryClass?: string,
): GatewayErrorClassification {
  // Explicit NEVER retryClass from gateway overrides everything → no retry.
  if (retryClass === 'NEVER') {
    return {
      retryable: false,
      decision: 'DEAD_LETTERED',
      reason: `Gateway error ${errorCode} has retryClass=NEVER → immediate DEAD_LETTERED`,
    };
  }

  // Non-retryable canonical codes (CORE/1.8 AC1: policy/validation errors).
  const nonRetryableCodes = new Set([
    'VALIDATION_ERROR',
    'VERSION_CONFLICT',
    'IDEMPOTENCY_CONFLICT',
    'SCOPE_MISMATCH',
    'TENANT_SCOPE_REQUIRED',
  ]);
  if (nonRetryableCodes.has(errorCode)) {
    return {
      retryable: false,
      decision: 'DEAD_LETTERED',
      reason: `${errorCode} is a policy/validation error → immediate DEAD_LETTERED (no retry)`,
    };
  }

  // All other errors are treated as transient → bounded retry.
  return {
    retryable: true,
    decision: 'RETRY_SCHEDULED',
    reason: `${errorCode} is transient → bounded RETRY_SCHEDULED (up to maxAttempts=8)`,
  };
}

/* ───────────────────────────────────────────────────────────────────────────
 * Executor options.
 * ─────────────────────────────────────────────────────────────────────────── */
export interface PipelineExecutorOptions {
  /** Prisma client for receipt state updates (completeReceipt). */
  prisma?: PrismaClient;
  /** Gateway client (HTTP). */
  gatewayClient: GatewayClient;
  /** Mapping service. Defaults to mock. */
  mappingService?: MappingService;
  /** Revision tracker (for AC4). Defaults to mock in-memory tracker. */
  revisionTracker?: RevisionTracker;
  /** Clock for deterministic ID generation and backoff. */
  now?: () => number;
  /**
   * CORE/1.8 AC1: Optional injected completeReceipt function.
   * When provided, gateway errors will be routed through completeReceipt
   * with the retry policy and clock for bounded backoff.
   *
   * Shape: (prisma, args) => Promise<CompleteReceiptResult>
   * Args include fencingToken, leaseOwner, outcome, error, retryPolicy, clock.
   */
  completeReceiptFn?: (
    prisma: PrismaClient,
    args: {
      fencingToken: string;
      leaseOwner: string;
      outcome: 'SUCCESS' | 'RETRY' | 'FAIL';
      error?: StoreError;
      retryPolicy?: RetryPolicy;
      clock: { now(): number };
    },
  ) => Promise<{
    state: 'DELIVERED' | 'RETRY_SCHEDULED' | 'DEAD_LETTERED';
    nextAttemptAt: number | null;
    fencedRejected: boolean;
  }>;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Receipt context from worker.
 * ─────────────────────────────────────────────────────────────────────────── */
export interface ExecutorInput {
  receiptId: string;
  eventId: string;
  organizationId: string;
  provider: string;
  connectionId: string;
  payloadDigest: string;
  schemaVersion: string;
  attempts: number;
  /** Idempotency key preserved. */
  idempotencyKey: string | null;
  /** Correlation ID. */
  correlationId: string | null;
  /**
   * CORE/1.4 fencing: token that must match on completion.
   * Used to prevent stale workers from overwriting newer lease owners.
   */
  fencingToken: string;
  /**
   * CORE/1.4 lease owner: worker identity that claimed this receipt.
   * Passed to completeReceipt to verify we are the rightful completer.
   */
  leaseOwner: string;
  /**
   * Stored parsed event payload from integration-api at commit time.
   */
  parsedEvent?: unknown;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Main executor entry.
 * ─────────────────────────────────────────────────────────────────────────── */
export async function executePipelineForReceipt(
  input: ExecutorInput,
  options: PipelineExecutorOptions,
): Promise<PipelineExecutorOutcome> {
  const { receiptId, organizationId, provider, connectionId, idempotencyKey, correlationId } = input;
  const mappingService = options.mappingService ?? createMockMappingService();
  const now = options.now ?? (() => Date.now());

  // Step 1: Normalize
  let event: InboundEvent | null = null;
  if (input.parsedEvent && typeof input.parsedEvent === 'object') {
    const parsedBody = input.parsedEvent;
    const eventType = (parsedBody as Record<string, unknown>)['event'] as string | undefined;
    if (eventType) {
      const normalizeResult = normalizeChatwootEvent(
        {
          ok: true,
          eventType,
          eventId: input.eventId,
          eventIdSource: 'primary',
          parsedBody,
        },
        parsedBody,
        { organizationId, provider, connectionId },
      );

      if (normalizeResult.ok) {
        event = normalizeResult.event;
      }
    }
  }

  if (!event) {
    return {
      status: 'SKIPPED',
      receiptId,
      reason: 'Event normalization failed — cannot determine InboundEventType',
      classification: {
        classification: 'BLOCKED',
        reason: {
          code: 'BLOCKED_UNKNOWN',
          message: 'Failed to normalize provider event',
        },
        suggestedCommand: null,
        targetBranch: null,
      },
    };
  }

  // Step 2: Semantic firewall
  const classification = classify(event);

  // Step 3: Mapping service
  // §AC4 gate: revision tracking (when conversation link exists).
  const revisionTracker = options.revisionTracker ?? createMockRevisionTracker();

  const mappingResult = await mappingService.resolve({
    event,
    classification,
    revisionTracker,
  });

  // §AC4: enforce revision gate centrally.
  // If the event has a mappingRevision claim AND a real (or mock) tracker
  // is provided, gate CALL_GATEWAY when revision is STALE or FORWARD.
  let revisionCheck: RevisionCheckOutcome | undefined;
  if (event.mappingRevision !== null && event.conversationHints.conversationId !== null) {
    revisionCheck = await Promise.resolve(revisionTracker.checkRevision({
      organizationId,
      conversationId: event.conversationHints.conversationId,
      claimRevision: event.mappingRevision,
    }));

    if (revisionCheck.kind === 'STALE') {
      // Event references an older mapping revision → BLOCKED.
      // Decision rationale: applying canonical target from outdated revision
      // would write to wrong aggregate. Must re-link or staff-confirm.
      const blockedResult: MappingResult = {
        event,
        classification: {
          ...classification,
          classification: 'BLOCKED',
          reason: {
            code: 'BLOCKED_MAPPING_REVISION_CHANGE',
            message: `Event references mapping revision ${revisionCheck.claimRevision} but current is ${revisionCheck.observedRevision}`,
          },
        },
        resolution: {
          state: 'UNRESOLVED',
          laborProfileId: null,
          laborProfileVersion: null,
          clientContactId: null,
          clientContactVersion: null,
          reviewQueueEntryId: null,
        },
        action: {
          type: 'BLOCKED',
          reason: `Mapping revision stale: claim=${revisionCheck.claimRevision}, current=${revisionCheck.observedRevision}`,
        },
        revisionCheck,
      };
      return {
        status: 'SKIPPED',
        receiptId,
        reason: `Mapping revision stale: claim=${revisionCheck.claimRevision}, current=${revisionCheck.observedRevision}`,
        classification: blockedResult.classification,
      };
    }
    if (revisionCheck.kind === 'FORWARD_REVISION') {
      // Event claims a higher revision than observed — possible spoof OR
      // first event after re-link. Either way, defer to review queue.
      if (mappingResult.action.type === 'CALL_GATEWAY') {
        const reviewResult: MappingResult = {
          ...mappingResult,
          action: {
            type: 'CREATE_REVIEW',
            reasonCode: 'FORWARD_REVISION_PENDING_RECONCILE',
          },
          revisionCheck,
        };
        return {
          status: 'REVIEW',
          receiptId,
          reviewQueueEntryId: reviewResult.resolution.reviewQueueEntryId ?? 'review-forward-revision',
          classification: reviewResult.classification,
          mappingResult: reviewResult,
        };
      }
    }
  }

  // Step 4: Execute action
  const action = mappingResult.action;
  switch (action.type) {
    case 'SKIP':
      return {
        status: 'SKIPPED',
        receiptId,
        reason: `Event ${event.eventType} classified as ${classification.classification}. ${action.reason}`,
        classification,
      };

    case 'BLOCKED':
      return {
        status: 'SKIPPED',
        receiptId,
        reason: `Event blocked by semantic firewall. Reason: ${action.reason}`,
        classification,
      };

    case 'CREATE_REVIEW':
      return {
        status: 'REVIEW',
        receiptId,
        reviewQueueEntryId: mappingResult.resolution.reviewQueueEntryId ?? 'unknown',
        classification,
        mappingResult,
      };

    case 'CALL_GATEWAY': {
      const request = buildGatewayRequestFromPipeline({
        command: action.command,
        event,
        mappingResult,
        idempotencyKey: idempotencyKey ?? `auto-${receiptId}`,
        correlationId: correlationId ?? receiptId,
        organizationId,
        provider,
        now,
      });

      try {
        const gatewayResult = await options.gatewayClient.call(request);

        let operationId: string | undefined;
        if (gatewayResult.status === 'ACCEPTED') {
          operationId = gatewayResult.operation?.operationId;
        }

        if (gatewayResult.status === 'FAILED') {
          const error = gatewayResult.errors[0];
          const errorCode = error?.code ?? 'UNKNOWN';
          const retryClass = error?.retryClass;

          // CORE/1.8 AC1: classify error → retryable vs non-retryable.
          const cls = classifyGatewayError(errorCode, retryClass);

          // If we have completeReceiptFn wired, persist the retry decision.
          let retryDecision: 'RETRY_SCHEDULED' | 'DEAD_LETTERED' | undefined;
          let nextAttemptAt: number | null | undefined;
          if (options.completeReceiptFn && options.prisma) {
            const outcome: 'RETRY' | 'FAIL' = cls.retryable ? 'RETRY' : 'FAIL';
            const storeErr: StoreError = storeError(
              errorCode as StoreError['code'],
              error?.messageKey ?? 'Gateway returned FAILED',
              { retryable: cls.retryable },
            );
            try {
              const cr = await options.completeReceiptFn(options.prisma, {
                fencingToken: input.fencingToken,
                leaseOwner: input.leaseOwner,
                outcome,
                error: storeErr,
                retryPolicy: { baseMs: 1_000, maxMs: 300_000, maxAttempts: 8, jitterFraction: 0.2 },
                clock: { now },
              });
              // Narrow union to the two states we actually expect for RETRY/FAIL outcome.
              if (cr.state === 'RETRY_SCHEDULED' || cr.state === 'DEAD_LETTERED') {
                retryDecision = cr.state;
              }
              nextAttemptAt = cr.nextAttemptAt;
            } catch (_completeReceiptErr) {
              // If completeReceipt fails, fall back to local classification.
              // This is a defensive guard — completeReceipt should not throw for
              // valid fencingToken/leaseOwner within the retry policy path.
              retryDecision = cls.decision;
            }
          } else {
            retryDecision = cls.decision;
          }

          return {
            status: 'GATEWAY_ERROR',
            receiptId,
            code: errorCode,
            message: error?.messageKey ?? 'Gateway returned FAILED',
            retryable: cls.retryable,
            retryDecision,
            nextAttemptAt,
            classification,
            mappingResult,
            gatewayResult,
          };
        }

        return {
          status: 'SUCCESS',
          receiptId,
          gatewayResult,
          classification,
          mappingResult,
          operationId,
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isTimeout = errMsg.includes('timeout');
        return {
          status: 'GATEWAY_ERROR',
          receiptId,
          code: isTimeout ? 'DEPENDENCY_UNAVAILABLE' : 'TRANSACTION_FAILED',
          message: errMsg,
          retryable: true,
          classification,
          mappingResult,
        };
      }
    }
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * Gateway request builder.
 * ─────────────────────────────────────────────────────────────────────────── */
let _execCounter = 0;

function buildGatewayRequestFromPipeline(args: {
  command: string;
  event: InboundEvent;
  mappingResult: MappingResult;
  idempotencyKey: string;
  correlationId: string;
  organizationId: string;
  provider: string;
  now: () => number;
}): HrpGatewayCallRequest {
  const {
    command,
    event,
    mappingResult,
    idempotencyKey,
    correlationId,
    organizationId,
    provider,
  } = args;

  const scenarioId = selectScenarioId(args.event.eventType, mappingResult.resolution.state);
  _execCounter += 1;

  return {
    schemaVersion: '1',
    organizationId,
    commandId: `cmd-${event.organizationId.slice(0, 8)}-${event.eventId.slice(0, 16)}-${_execCounter}`,
    idempotencyKey,
    correlationId,
    method: command as HrpGatewayCallRequest['method'],
    context: {
      schemaVersion: '1',
      organizationId,
      tier: 'INBOUND_DEFAULT',
      correlationId,
      provider: provider as 'CHATWOOT' | 'ZALO_OA' | 'GENERIC' | 'HRP_UI',
      connectionId: event.connectionId,
    },
    actor: { kind: 'SERVICE', serviceId: 'integration-worker' },
    scenarioId,
    payload: buildPayload(command, event, mappingResult),
  };
}

function selectScenarioId(
  eventType: InboundEvent['eventType'],
  mappingState: MappingResult['resolution']['state'],
): string {
  if (eventType === 'MESSAGE_CREATED' || eventType === 'CLIENT_INBOUND_MESSAGE') {
    return mappingState === 'EXACT_MATCH' ? 'EXACT_MATCH_SUCCESS' : 'POSSIBLE_MATCH_REVIEW';
  }
  if (eventType === 'CONVERSATION_CREATED') return 'NEW_PROFILE_CREATED';
  if (eventType === 'CONVERSATION_RESOLVED') return 'CLOSED_CASE_SUCCESS';
  if (eventType === 'PARTICIPANT_ADDED') return 'POSSIBLE_MATCH_REVIEW';
  // NON_AUTHORITATIVE / BLOCKED — should not reach here. Defensive default.
  return 'EXACT_MATCH_SUCCESS';
}

function buildPayload(
  command: string,
  event: InboundEvent,
  mappingResult: MappingResult,
): unknown {
  const base = {
    organizationId: event.organizationId,
    source: {
      provider: event.provider,
      connectionId: event.connectionId,
      eventId: event.eventId,
      senderKind: event.senderKind,
      senderId: event.senderId,
    },
  };

  switch (command) {
    case 'createOrMatchLaborProfile':
      return {
        ...base,
        identity: {
          fullName: event.contactHints.fullName,
          phone: event.contactHints.phone,
        },
        matchedTarget: mappingResult.resolution.laborProfileId
          ? {
              laborProfileId: mappingResult.resolution.laborProfileId,
              version: mappingResult.resolution.laborProfileVersion ?? 1,
            }
          : null,
        metadata: {
          contactHints: event.contactHints,
          conversationHints: event.conversationHints,
        },
      };

    case 'recordInteraction':
      return {
        ...base,
        organizationId: event.organizationId,
        laborProfileId: mappingResult.resolution.laborProfileId ?? 'UNRESOLVED',
        kind: 'PLACEMENT_PROGRESS',
        outcome: 'POSITIVE',
        context: {
          source: { kind: 'INTEGRATION' as const },
          externalConversationId: event.conversationHints.conversationId ?? null,
          externalAccountId: event.senderId ?? null,
        },
        occurredAt: event.occurredAt ?? new Date().toISOString(),
        summary: event.contentPreview ?? undefined,
      };

    case 'updateLaborAvailability':
      return {
        ...base,
        laborProfileId: mappingResult.resolution.laborProfileId ?? 'UNRESOLVED',
        availability: 'UNKNOWN',
        expectedVersion: mappingResult.resolution.laborProfileVersion ?? 0,
      };

    case 'createNextAction':
      return {
        ...base,
        targetType: 'TALENT' as const,
        targetId: mappingResult.resolution.laborProfileId ?? 'UNRESOLVED',
        kind: 'FOLLOWUP' as const,
        dueAt: new Date(Date.now() + 86400000).toISOString(),
      };

    case 'queryOutboxDelivery':
      return {
        ...base,
        organizationId: event.organizationId,
        filter: {
          provider: event.provider,
          connectionId: event.connectionId,
        },
      };

    default:
      return base;
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * Factory.
 * ─────────────────────────────────────────────────────────────────────────── */
export function createPipelineExecutor(opts: PipelineExecutorOptions): {
  execute: (input: ExecutorInput) => Promise<PipelineExecutorOutcome>;
} {
  return {
    execute: (input: ExecutorInput) => executePipelineForReceipt(input, opts),
  };
}

/**
 * Helper for production code: use real mapping service.
 */
export function createProductionPipelineExecutor(
  gatewayClient: GatewayClient,
  prisma?: PrismaClient,
): {
  execute: (input: ExecutorInput) => Promise<PipelineExecutorOutcome>;
} {
  return createPipelineExecutor({
    gatewayClient,
    mappingService: createProductionMappingService(),
    ...(prisma !== undefined ? { prisma } : {}),
  });
}
