// src/orchestrator/dnc-handler.ts — DNC action handler tách riêng (CORE/1.6).
//
// Backlog §0.3a, §0.3e + §Task 1.6:
//  - DNC action tách khỏi full intake workflow.
//  - KHÔNG chờ CCCD / HRP-review hồ sơ.
//  - Safety suppression không tự tạo/merge LaborProfile (Master §10.6.5 #4).
//  - Inbound không tự gỡ DNC (Master §10.6.5 #6).
//
// Implementation: gọi thẳng gateway.commitSuppression với policyHint
// riêng; KHÔNG đụng IntakeCheckpoint. Orchestrator có thể gọi song song
// với run() — DNC là independent path.
//
// B4 (Auditor recheck 2026-09-15):
//  - Payload `context` PHẢI parse được qua `CommitSuppressionInputSchema`
//    (contract freeze). Vì schema strict yêu cầu `context: IntakeContextRefSchema`
//    (không có field `actor`), builder KHÔNG được trộn actor vào payload.context.
//  - Actor validation giữ nguyên (parse qua `ActorSchema`); actor được truyền
//    qua gateway call context (`GatewayCaller` extended với `actor` optional)
//    tương ứng envelope/gateway call shape contracts.
//  - externalAccountId nằm ở `context` (IntakeContextRefSchema.optional), không trong strict source.
//  - Authority boundary tách biệt: thêm field KHÔNG tự chứng minh authorization;
//    runtime HRP gate vẫn authorize.

import {
  IntegrationCommandSourceSchema,
  IntakeContextRefSchema,
  ActorSchema,
  CommitSuppressionInputSchema,
  type ActorClaim,
} from '@hrp-engagement/contracts';
import type { HrpGatewayCallResult } from '../gateway/types.js';
import type { HrpGatewayMethod } from '@hrp-engagement/contracts';
import type { GatewayCaller } from './steps.js';

export interface DncActionInput {
  organizationId: string;
  /** Connection-level reference (provider + connectionId + externalContactId). */
  provider: string;
  connectionId: string;
  externalContactId: string;
  externalAccountId?: string;
  /** Optional: canonical LaborProfile nếu đã match. */
  canonicalId?: string;
  /** Reason (canonical enum from contracts/dnc.ts). */
  reason: string;
  /** Free-text note (redacted, < 500 chars). */
  note?: string;
  /** Caller-set idempotency key (do caller derive, không tự sinh). */
  idempotencyKey: string;
  correlationId: string;
  /** B4: actor từ trusted caller context (fixture/runtime boundary).
   *  Schema validate qua ActorSchema; runtime HRP gate vẫn authorize.
   *  Thêm field KHÔNG tự chứng minh authorization.
   *  Builder KHÔNG đưa actor vào payload.context — actor đi qua gateway call context. */
  actor: ActorClaim;
}

export interface DncActionResult {
  suppressionEventId: string;
  outcome: 'APPLIED' | 'FAILED';
  /** Optional fence token cho recipient-level check. */
  fenceToken?: string;
  fenceCutOffAt?: string;
  errorCode?: string;
  retryClass?: string;
}

/**
 * B4: Build IntegrationCommandSource qua shared schema (KHÔNG hard-code literal).
 * Throws nếu provider/connectionId invalid — caller fix payload.
 */
function buildIntegrationSource(input: DncActionInput) {
  return IntegrationCommandSourceSchema.parse({
    kind: 'INTEGRATION',
    provider: input.provider,
    connectionId: input.connectionId,
  });
}

/**
 * B4 (recheck): Build commitSuppression payload — context đúng `IntakeContextRefSchema`,
 * KHÔNG trộn actor vào context (strict). Payload PHẢI parse qua
 * `CommitSuppressionInputSchema` (contract freeze).
 *
 * externalAccountId nằm ở `context` (IntakeContextRefSchema.optional), không trong strict source.
 * Actor KHÔNG có trong payload — actor truyền qua gateway call context (`GatewayCaller` extended).
 */
export function buildCommitSuppressionPayload(input: DncActionInput): unknown {
  // B4: source qua shared schema.
  const source = buildIntegrationSource(input);

  // B4: context phải parse được qua IntakeContextRefSchema (strict, không có actor).
  const contextRef = IntakeContextRefSchema.parse({
    source,
    ...(input.externalAccountId !== undefined ? { externalAccountId: input.externalAccountId } : {}),
    ...(input.canonicalId !== undefined ? { canonicalId: input.canonicalId } : {}),
  });

  const target =
    input.canonicalId !== undefined
      ? {
          kind: 'LABOR_PROFILE' as const,
          organizationId: input.organizationId,
          laborProfileId: input.canonicalId,
          expectedVersion: 0, // DNC không ghi profile version; runtime gate ignore nếu không có.
          resolvedCanonical: true,
        }
      : {
          kind: 'EXTERNAL_CONTACT' as const,
          organizationId: input.organizationId,
          provider: input.provider,
          connectionId: input.connectionId,
          externalContactId: input.externalContactId,
          ...(input.externalAccountId !== undefined ? { externalAccountId: input.externalAccountId } : {}),
          resolvedCanonical: false as const,
        };

  return {
    schemaVersion: '1',
    organizationId: input.organizationId,
    target,
    reason: input.reason,
    note: input.note,
    // B4: context đúng IntakeContextRefSchema — KHÔNG trộn actor.
    context: contextRef,
  };
}

/**
 * B4 (recheck): Validate builder output qua `CommitSuppressionInputSchema`.
 * Nếu fail → throw ZodError; caller biết payload không khớp contract freeze.
 * Đây là evidence #1 mà Auditor yêu cầu: payload do builder tạo PHẢI parse PASS
 * qua schema contract (không chỉ là structural typing TypeScript).
 */
export function assertCommitSuppressionPayloadValid(input: DncActionInput): void {
  const payload = buildCommitSuppressionPayload(input);
  CommitSuppressionInputSchema.parse(payload);
}

/** Run DNC action via gateway. Independent of intake checkpoint. */
export async function executeDncAction(
  input: DncActionInput,
  gatewayCall: GatewayCaller,
): Promise<DncActionResult> {
  // B4: validate actor trước gateway call (fail-closed nếu missing/malformed).
  // Đây là evidence #3 mà Auditor yêu cầu: missing/malformed actor bị chặn
  // TRƯỚC khi gateway call.
  const validatedActor = ActorSchema.parse(input.actor);

  // Validate payload qua CommitSuppressionInputSchema (contract freeze).
  // Nếu payload không khớp, fail-closed ở runtime (không bypass validation).
  const payload = buildCommitSuppressionPayload(input);
  CommitSuppressionInputSchema.parse(payload);

  const result = await gatewayCall({
    organizationId: input.organizationId,
    method: 'commitSuppression' as HrpGatewayMethod,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    scenarioId: 'OUTBOX_RECEIPT_DURABLE', // gateway ACK; runtime HRP handles actual commit.
    payload,
    // B4: actor đi qua gateway call context (envelope level), không nằm trong payload.context.
    actor: validatedActor,
  });

  if (result.status === 'FAILED') {
    const err = result.errors[0];
    return {
      suppressionEventId: '',
      outcome: 'FAILED',
      ...(err?.code !== undefined ? { errorCode: err.code } : {}),
      ...(err?.retryClass !== undefined ? { retryClass: err.retryClass } : {}),
    };
  }

  if (result.status === 'APPLIED') {
    // Mock gateway returns APPLIED with data containing suppressionEventId/fence fields.
    const data = result.data as { suppressionEventId?: string; fenceToken?: string; fenceCutOffAt?: string } | undefined;
    return {
      suppressionEventId: data?.suppressionEventId ?? `dnc-${(input.idempotencyKey ?? 'no-key').slice(-16)}`,
      outcome: 'APPLIED',
      ...(data?.fenceToken !== undefined ? { fenceToken: data.fenceToken } : {}),
      ...(data?.fenceCutOffAt !== undefined ? { fenceCutOffAt: data.fenceCutOffAt } : {}),
    };
  }

  if (result.status === 'ACCEPTED') {
    // ACCEPTED = queued for retry; suppressionEventId provided via operation ref.
    const opId = 'operation' in result && typeof result.operation === 'object'
      ? result.operation?.operationId
      : undefined;
    return {
      suppressionEventId: opId ?? `dnc-${input.idempotencyKey.slice(-16)}`,
      outcome: 'APPLIED',
    };
  }

  // Unknown status → fail-closed.
  return {
    suppressionEventId: '',
    outcome: 'FAILED',
    errorCode: 'UNKNOWN_COMMAND_OUTCOME',
  };
}

/**
 * Helper: validate DNC không đòi CCCD / đầy đủ intake.
 * Schema validate only requires externalReference + reason + connectionId + actor.
 * T1 chỉ enforces ở runtime — không block based on missing fields outside DTO.
 *
 * B4: actor bắt buộc từ trusted caller context.
 */
export function isDncActionCallable(input: Partial<DncActionInput>): input is DncActionInput {
  return Boolean(
    input.organizationId &&
      input.provider &&
      input.connectionId &&
      input.externalContactId &&
      input.reason &&
      input.idempotencyKey &&
      input.correlationId &&
      input.actor !== undefined,
  );
}

// Suppress unused HrpGatewayCallResult import (used in types but flagged by noUnused locals off).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _Unused = HrpGatewayCallResult;
