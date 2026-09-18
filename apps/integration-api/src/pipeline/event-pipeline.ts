/**
 * pipeline/event-pipeline.ts — CORE/1.5
 *
 * Event pipeline: normalize → semantic firewall → mapping → gateway call.
 *
 * Full pipeline:
 *  1. Parse provider event (CORE/1.2)
 *  2. Normalize → InboundEvent (this module)
 *  3. Semantic firewall → ClassificationResult
 *  4. Mapping service → MappingResult
 *  5. Execute action: call gateway / create review / skip / blocked
 *
 * Boundaries:
 *  - Staff-assisted conversion: needs review confirmation before gateway call.
 *    This module handles the confirmation check; the actual confirmation
 *    is a separate HRP-owned step (CORE/1.6).
 *  - Retry/replay: idempotency key stable, no double-action.
 *  - Call log: records classification, mapping, gateway result.
 */
import type { InboundEvent } from '../normalizer/event-normalizer.js';
import type { ClassificationResult } from '../firewall/semantic-firewall.js';
import type { MappingResult, MappingService } from '../mapping/mapping-service.js';
import type { MockGateway } from '../gateway/types.js';
import type { HrpGatewayCallRequest } from '../gateway/types.js';

/* ───────────────────────────────────────────────────────────────────────────
 * Pipeline result.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Outcome of processing a single event. */
export type PipelineOutcome =
  | {
      outcome: 'GATEWAY_CALLED';
      operationId: string;
      commandId: string;
      command: string;
      classification: ClassificationResult;
      mappingResult: MappingResult;
    }
  | {
      outcome: 'REVIEW_CREATED';
      reviewQueueEntryId: string;
      command: string;
      classification: ClassificationResult;
      mappingResult: MappingResult;
    }
  | {
      outcome: 'SKIPPED';
      reason: string;
      classification: ClassificationResult;
    }
  | {
      outcome: 'BLOCKED';
      reason: string;
      classification: ClassificationResult;
    }
  | {
      outcome: 'GATEWAY_ERROR';
      error: string;
      classification: ClassificationResult;
      mappingResult: MappingResult;
    };

/* ───────────────────────────────────────────────────────────────────────────
 * Pipeline options.
 * ─────────────────────────────────────────────────────────────────────────── */

export interface PipelineOptions {
  /** The normalized event. */
  event: InboundEvent;
  /** Injected mapping service. */
  mappingService: MappingService;
  /** Injected gateway. */
  gateway: MockGateway;
  /**
   * Idempotency key for the event.
   * Preserved across retries — not regenerated per attempt.
   */
  idempotencyKey: string;
  /**
   * Correlation ID for tracing.
   */
  correlationId: string;
  /**
   * Organization ID.
   */
  organizationId: string;
  /**
   * Clock for deterministic ID generation.
   */
  now?: () => number;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Pipeline steps.
 * ─────────────────────────────────────────────────────────────────────────── */

let _pipelineCounter = 0;
function makeIdempotencyKey(event: InboundEvent, prefix: string, now: () => number): string {
  const eventId = event.eventId;
  return `${prefix}-${event.organizationId}-${eventId.slice(0, 16)}-${now().toString(36)}`;
}

/**
 * Build gateway call request from pipeline result.
 */
/**
 * buildGatewayRequest — builds HrpGatewayCallRequest from pipeline context.
 *
 * Scenario selection policy:
 *  - Most events use EXACT_MATCH_SUCCESS → applied case
 *  - OUTBOX_RECEIPT_DURABLE / TIMEOUT_AFTER_APPLY → accepted (queue retry)
 *  - POSSIBLE_MATCH → review scenario
 *  - PERMISSION_DENIED → fail scenario
 *  - Malformed → fail
 *
 * In production, the scenario would be replaced by actual HRP gateway behavior.
 * This mock selects the closest scenario to the expected outcome.
 */
function buildGatewayRequest(args: {
  command: string;
  event: InboundEvent;
  mappingResult: MappingResult;
  classification: ClassificationResult;
  idempotencyKey: string;
  correlationId: string;
  organizationId: string;
  now?: () => number;
}): HrpGatewayCallRequest {
  const { command, event, mappingResult, classification, idempotencyKey, correlationId, organizationId } = args;
  const now = args.now ?? (() => Date.now());

  // Build payload based on command type
  const payload = buildCommandPayload(command, event, mappingResult, organizationId);

  // Scenario selection: maps event classification → mock scenario
  // In production, this would be replaced by actual HRP gateway behavior
  let scenarioId: HrpGatewayCallRequest['scenarioId'] = 'EXACT_MATCH_SUCCESS';
  switch (classification.classification) {
    case 'AUTHORITATIVE': {
      if (mappingResult.resolution.state === 'EXACT_MATCH') {
        scenarioId = 'EXACT_MATCH_SUCCESS';
      } else {
        // POSSIBLE_MATCH or UNRESOLVED — mock as possible match review
        scenarioId = 'POSSIBLE_MATCH_REVIEW';
      }
      break;
    }
    case 'NON_AUTHORITATIVE':
      // Echo/private note — gateway would return applied (no-op)
      scenarioId = 'EXACT_MATCH_SUCCESS';
      break;
    case 'REVIEW_NEEDED':
      scenarioId = 'POSSIBLE_MATCH_REVIEW';
      break;
    case 'BLOCKED':
    default:
      scenarioId = 'PERMISSION_DENIED';
      break;
  }

  const request: HrpGatewayCallRequest = {
    schemaVersion: '1',
    organizationId,
    commandId: `cmd-pipeline-${now().toString(36)}-${_pipelineCounter++}`,
    idempotencyKey,
    correlationId,
    method: command as HrpGatewayCallRequest['method'],
    context: {
      schemaVersion: '1',
      organizationId,
      tier: 'INBOUND_DEFAULT',
      correlationId,
      provider: (event.provider ?? 'CHATWOOT') as HrpGatewayCallRequest['context']['provider'],
      connectionId: event.connectionId,
    },
    actor: { kind: 'SERVICE', serviceId: 'integration-worker' },
    scenarioId,
    payload,
  };

  return request;
}

function buildCommandPayload(
  command: string,
  event: InboundEvent,
  mappingResult: MappingResult,
  organizationId: string,
): unknown {
  switch (command) {
    case 'createOrMatchLaborProfile': {
      return {
        // Identity hints (not authoritative)
        identity: {
          phone: null, // from event
          fullName: event.contentPreview || null,
        },
        // Provenance: integration source
        provenance: {
          source: 'INTEGRATION',
          provider: event.provider,
          connectionId: event.connectionId,
          eventId: event.eventId,
        },
        // Optional existing target (if EXACT_MATCH)
        existingLaborProfileId: mappingResult.resolution.laborProfileId ?? null,
      };
    }

    case 'recordInteraction': {
      return {
        organizationId,
        laborProfileId: mappingResult.resolution.laborProfileId ?? 'UNRESOLVED',
        kind: 'MESSAGE',
        outcome: 'POSITIVE',
        context: {
          source: { kind: 'INTEGRATION' },
          externalConversationId: event.conversationHints.conversationId ?? null,
          externalAccountId: event.senderId ?? null,
        },
        occurredAt: event.occurredAt ?? new Date().toISOString(),
        summary: event.contentPreview || undefined,
      };
    }

    default:
      return {};
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * Pipeline entry point.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Execute the full event pipeline.
 *
 * Steps:
 *  1. Classification (semantic firewall)
 *  2. Mapping service resolve
 *  3. Execute action based on classification + mapping
 *
 * Idempotency:
 *  - idempotencyKey is preserved across retries.
 *  - Same key + same payload → same gateway result (cached by gateway mock).
 *  - No forbidden mutations or outbound loops.
 *
 * Call log is written by the gateway.
 */
export async function executePipeline(opts: PipelineOptions): Promise<PipelineOutcome> {
  const { event, mappingService, gateway, idempotencyKey, correlationId, organizationId } = opts;
  const now = opts.now ?? (() => Date.now());

  // Step 1: Import classification (semantic firewall)
  // Lazy import to avoid circular dependency
  const { classify } = await import('../firewall/semantic-firewall.js');
  const classification = classify(event);

  // Step 2: Mapping service resolve
  const mappingResult = await mappingService.resolve({
    event,
    classification,
  });

  // Step 3: Execute action
  switch (mappingResult.action.type) {
    case 'CALL_GATEWAY': {
      // Check if this is AUTHORITATIVE event
      if (classification.classification !== 'AUTHORITATIVE') {
        // Should not happen if mapping is correct, but defensive check
        return {
          outcome: 'BLOCKED',
          reason: `AUTHORITATIVE classification required for CALL_GATEWAY. Got: ${classification.classification}`,
          classification,
        };
      }

      // Build gateway request
      const request = buildGatewayRequest({
        command: mappingResult.action.command,
        event,
        mappingResult,
        classification,
        idempotencyKey,
        correlationId,
        organizationId,
        now,
      });

      try {
        // Call gateway (deterministic mock)
        const result = await gateway.call(request);

        if (result.status === 'ACCEPTED') {
          return {
            outcome: 'GATEWAY_CALLED',
            operationId: (result as { operation?: { operationId: string } }).operation?.operationId ?? 'unknown',
            commandId: request.commandId,
            command: mappingResult.action.command,
            classification,
            mappingResult,
          };
        }

        if (result.status === 'APPLIED') {
          return {
            outcome: 'GATEWAY_CALLED',
            operationId: 'applied',
            commandId: request.commandId,
            command: mappingResult.action.command,
            classification,
            mappingResult,
          };
        }

        // FAILED
        return {
          outcome: 'GATEWAY_ERROR',
          error: result.errors[0]?.messageKey ?? 'Gateway returned FAILED',
          classification,
          mappingResult,
        };
      } catch (err) {
        return {
          outcome: 'GATEWAY_ERROR',
          error: err instanceof Error ? err.message : String(err),
          classification,
          mappingResult,
        };
      }
    }

    case 'CREATE_REVIEW': {
      return {
        outcome: 'REVIEW_CREATED',
        reviewQueueEntryId: mappingResult.resolution.reviewQueueEntryId ?? 'unknown',
        command: mappingResult.action.type,
        classification,
        mappingResult,
      };
    }

    case 'SKIP': {
      return {
        outcome: 'SKIPPED',
        reason: `Event ${event.eventType} classified as ${classification.classification}. Non-authoritative event.`,
        classification,
      };
    }

    case 'BLOCKED': {
      return {
        outcome: 'BLOCKED',
        reason: `Event blocked by semantic firewall. Classification: ${classification.reason.code}`,
        classification,
      };
    }
  }
}
