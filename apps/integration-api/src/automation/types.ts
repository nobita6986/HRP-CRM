/**
 * automation/types.ts — N8N/0.2 CRM Automation Gateway types.
 *
 * Scope:
 *  - Schemas are LOCAL to this module. They MUST NOT be added to
 *    packages/contracts (FROZEN at 0.0.8-g0.8-fixes per Owner brief).
 *    Reuse envelope/primitive types from @hrp-engagement/contracts
 *    where they exist; only invent new shapes that frozen contracts
 *    do not cover.
 *  - Every type is `.strict()` so unknown fields fail closed.
 *
 * Threat boundary (see THREAT-BOUNDARY.md in the bundle):
 *  - Caller claim: workflowId / revision / executionId / correlationId /
 *    idempotencyKey / sourceEventId.
 *  - Server-trusted: organizationId / connectionId / serviceId binding
 *    resolved from service credential; actor, role, permission are
 *    NEVER trusted from body.
 *
 * N8N/0.2 does NOT replace the existing webhook receiver (CORE/1.2),
 * orchestrator (CORE/1.6), or outbox (CORE/1.8). It is a NEW inbound
 * surface specifically for n8n-driven automation calls.
 */

import { z } from 'zod';
import {
  SCHEMA_VERSION,
  SchemaVersionSchema,
  OrganizationIdSchema,
  IdempotencyKeySchema,
  CorrelationIdSchema,
  CommandNameSchema,
  ActorSchema,
  CommandSourceSchema,
  CommandIdSchema,
  makeError,
  type ContractError,
} from '@hrp-engagement/contracts';

const opaqueId = (name: string, max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, name + ' ky tu khong hop le');

/* CALLER IDENTITY */

export const N8nExecutionIdSchema = opaqueId('n8nExecutionId', 128);
export const WorkflowIdSchema = opaqueId('workflowId', 128);
export const WorkflowRevisionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const N8nSourceSchema = z
  .object({
    kind: z.literal('N8N_AUTOMATION'),
    workflowId: WorkflowIdSchema,
    workflowRevision: WorkflowRevisionSchema,
    n8nExecutionId: N8nExecutionIdSchema,
    sourceEventId: z.string().min(1).max(128).optional(),
    workflowLabel: z.string().min(1).max(128).optional(),
  })
  .strict();

/* ALLOWLISTED OPERATIONS */

export const AUTOMATION_OPERATIONS = [
  'listDueNextActions',
  'acknowledgeReminder',
  'getNextAction',
] as const;

export const AutomationOperationNameSchema = z.enum(AUTOMATION_OPERATIONS);

/* OPERATION PAYLOADS */

export const ListDueNextActionsPayloadSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    dueAfter: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'dueAfter phai YYYY-MM-DD').optional(),
    dueBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'dueBefore phai YYYY-MM-DD').optional(),
    statusFilter: z.enum(['OPEN', 'OPEN_OR_DUE', 'OVERDUE_ONLY']).optional(),
    pageSize: z.number().int().min(1).max(200).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

export const AcknowledgeReminderPayloadSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    nextActionId: opaqueId('nextActionId', 128),
    notificationOutcome: z.enum(['SENT', 'FAILED', 'SKIPPED']),
    reminderRevisionId: opaqueId('reminderRevisionId', 128),
    channel: z.enum(['INTERNAL_TEST', 'EMAIL_INTERNAL', 'DASHBOARD_ONLY']),
  })
  .strict();

export const GetNextActionPayloadSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    nextActionId: opaqueId('nextActionId', 128),
  })
  .strict();

export const AutomationPayloadSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('listDueNextActions'), payload: ListDueNextActionsPayloadSchema }).strict(),
  z.object({ op: z.literal('acknowledgeReminder'), payload: AcknowledgeReminderPayloadSchema }).strict(),
  z.object({ op: z.literal('getNextAction'), payload: GetNextActionPayloadSchema }).strict(),
]);

/* REQUEST ENVELOPE */

export const AutomationRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    commandId: CommandIdSchema,
    commandName: CommandNameSchema,
    idempotencyKey: IdempotencyKeySchema,
    correlationId: CorrelationIdSchema,
    organizationId: OrganizationIdSchema,
    source: CommandSourceSchema,
    actor: ActorSchema,
    occurredAt: z.string().datetime({ offset: true }).optional(),
    automationSource: N8nSourceSchema,
    operation: AutomationPayloadSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.commandName !== value.operation.op) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['commandName'],
        message: 'commandName phai khop operation.op',
      });
    }
  });

export type AutomationRequest = z.infer<typeof AutomationRequestSchema>;

/* RESPONSE PAYLOADS */

export const DueNextActionItemSchema = z
  .object({
    nextActionId: opaqueId('nextActionId', 128),
    targetRedacted: z.string().min(1).max(256),
    targetKind: z.enum(['PLACEMENT_CASE', 'CLIENT_OPPORTUNITY', 'STANDALONE']),
    status: z.enum(['OPEN', 'DONE', 'CANCELLED']),
    snoozeMode: z.enum(['ACTIVE', 'SNOOZED', 'DISMISSED']),
    dueAt: z.string().datetime({ offset: true }),
    scheduledAt: z.string().datetime({ offset: true }),
    timezone: z.literal('Asia/Ho_Chi_Minh'),
    assignedToRedacted: opaqueId('userId', 128),
  })
  .strict();

export const ListDueNextActionsDataSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    items: z.array(DueNextActionItemSchema).max(200),
    nextCursor: z.string().min(1).max(512).optional(),
    serverNow: z.string().datetime({ offset: true }),
  })
  .strict();

export const AcknowledgeReminderDataSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    nextActionId: opaqueId('nextActionId', 128),
    reminderRevisionId: opaqueId('reminderRevisionId', 128),
    recordedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const GetNextActionDataSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    item: DueNextActionItemSchema,
    serverNow: z.string().datetime({ offset: true }),
  })
  .strict();

export type ListDueNextActionsPayload = z.infer<typeof ListDueNextActionsPayloadSchema>;
export type AcknowledgeReminderPayload = z.infer<typeof AcknowledgeReminderPayloadSchema>;
export type GetNextActionPayload = z.infer<typeof GetNextActionPayloadSchema>;
export type DueNextActionItem = z.infer<typeof DueNextActionItemSchema>;
export type ListDueNextActionsData = z.infer<typeof ListDueNextActionsDataSchema>;
export type AcknowledgeReminderData = z.infer<typeof AcknowledgeReminderDataSchema>;
export type GetNextActionData = z.infer<typeof GetNextActionDataSchema>;

/* SERVICE IDENTITY */

export const AUTOMATION_SERVICE_ALGORITHMS = ['HMAC_SHA256'] as const;
export type AutomationServiceAlgorithm = (typeof AUTOMATION_SERVICE_ALGORITHMS)[number];

export const AutomationServiceEntrySchema = z
  .object({
    serviceId: opaqueId('serviceId', 128),
    organizationId: OrganizationIdSchema,
    connectionId: opaqueId('connectionId', 128),
    secret: z.string().min(8).max(512),
    algorithm: z.literal('HMAC_SHA256'),
    expiresAt: z.number().int().nonnegative(),
    allowedOperations: z.array(AutomationOperationNameSchema).min(1).max(32),
  })
  .strict();

export type AutomationServiceEntry = z.infer<typeof AutomationServiceEntrySchema>;

/* KILL SWITCH */

export const KillSwitchTargetSchema = z
  .object({
    workflowId: WorkflowIdSchema.optional(),
    connectionId: opaqueId('connectionId', 128).optional(),
    organizationId: OrganizationIdSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.connectionId && !v.organizationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'kill switch can connectionId hoac organizationId',
        path: ['connectionId'],
      });
    }
  });

export type KillSwitchTarget = z.infer<typeof KillSwitchTargetSchema>;

/* ERROR TAXONOMY */

export const AUTOMATION_GATEWAY_ERROR_CODES = [
  'n8n_credential_expired',
  'n8n_signature_mismatch',
  'n8n_organization_mismatch',
  'n8n_operation_not_allowed',
  'n8n_kill_switch_active',
  'n8n_payload_too_large',
  'n8n_rate_limited',
  'n8n_idempotency_conflict',
  'n8n_timeout',
  'n8n_dependency_offline',
  'n8n_command_name_mismatch',
  'n8n_internal_error',
] as const;

export type AutomationGatewayErrorCode = (typeof AUTOMATION_GATEWAY_ERROR_CODES)[number];

export interface AutomationGatewayError {
  readonly code: AutomationGatewayErrorCode;
  readonly wireCode: ContractError['code'];
  readonly messageKey: ContractError['messageKey'];
  readonly retryClass: ContractError['retryClass'];
  readonly httpHint: number;
  readonly fieldPath?: ContractError['fieldPath'];
  readonly internalReason: string;
}

const AUTOMATION_ERROR_TABLE: Readonly<Record<AutomationGatewayErrorCode, AutomationGatewayError>> =
  Object.freeze({
    n8n_credential_expired: {
      code: 'n8n_credential_expired',
      wireCode: 'AUTHENTICATION_REQUIRED',
      messageKey: 'errors.authenticationRequired',
      retryClass: 'REAUTHENTICATE',
      httpHint: 401,
      fieldPath: 'request',
      internalReason: 'service credential expired or revoked',
    },
    n8n_signature_mismatch: {
      code: 'n8n_signature_mismatch',
      wireCode: 'AUTHENTICATION_REQUIRED',
      messageKey: 'errors.authenticationRequired',
      retryClass: 'REAUTHENTICATE',
      httpHint: 401,
      fieldPath: 'request',
      internalReason: 'HMAC signature did not match',
    },
    n8n_organization_mismatch: {
      code: 'n8n_organization_mismatch',
      wireCode: 'FORBIDDEN',
      messageKey: 'errors.forbidden',
      retryClass: 'NEVER',
      httpHint: 403,
      fieldPath: 'organizationId',
      internalReason: 'body organizationId disagrees with registry',
    },
    n8n_operation_not_allowed: {
      code: 'n8n_operation_not_allowed',
      wireCode: 'FORBIDDEN',
      messageKey: 'errors.forbidden',
      retryClass: 'NEVER',
      httpHint: 403,
      fieldPath: 'commandId',
      internalReason: 'operation not in service allowed list',
    },
    n8n_kill_switch_active: {
      code: 'n8n_kill_switch_active',
      wireCode: 'DEPENDENCY_UNAVAILABLE',
      messageKey: 'errors.dependencyUnavailable',
      retryClass: 'BOUNDED_SAME_KEY',
      httpHint: 503,
      fieldPath: 'request',
      internalReason: 'kill switch active for target',
    },
    n8n_payload_too_large: {
      code: 'n8n_payload_too_large',
      wireCode: 'VALIDATION_ERROR',
      messageKey: 'errors.validation',
      retryClass: 'NEVER',
      httpHint: 422,
      fieldPath: 'request',
      internalReason: 'serialized request exceeded payload limit',
    },
    n8n_rate_limited: {
      code: 'n8n_rate_limited',
      wireCode: 'RATE_LIMITED',
      messageKey: 'errors.rateLimited',
      retryClass: 'BOUNDED_SAME_KEY',
      httpHint: 429,
      fieldPath: 'request',
      internalReason: 'workflow exceeded per-window request budget',
    },
    n8n_idempotency_conflict: {
      code: 'n8n_idempotency_conflict',
      wireCode: 'IDEMPOTENCY_CONFLICT',
      messageKey: 'errors.idempotencyConflict',
      retryClass: 'NEVER',
      httpHint: 409,
      fieldPath: 'idempotencyKey',
      internalReason: 'same key replayed with different payload digest',
    },
    n8n_timeout: {
      code: 'n8n_timeout',
      wireCode: 'DEPENDENCY_UNAVAILABLE',
      messageKey: 'errors.dependencyUnavailable',
      retryClass: 'BOUNDED_SAME_KEY',
      httpHint: 503,
      fieldPath: 'request',
      internalReason: 'adapter exceeded timeout budget',
    },
    n8n_dependency_offline: {
      code: 'n8n_dependency_offline',
      wireCode: 'DEPENDENCY_UNAVAILABLE',
      messageKey: 'errors.dependencyUnavailable',
      retryClass: 'BOUNDED_SAME_KEY',
      httpHint: 503,
      fieldPath: 'request',
      internalReason: 'CRM adapter reports offline',
    },
    n8n_command_name_mismatch: {
      code: 'n8n_command_name_mismatch',
      wireCode: 'VALIDATION_ERROR',
      messageKey: 'errors.validation',
      retryClass: 'NEVER',
      httpHint: 422,
      fieldPath: 'commandId',
      internalReason: 'commandName does not match operation.op',
    },
    n8n_internal_error: {
      code: 'n8n_internal_error',
      wireCode: 'UNKNOWN_COMMAND_OUTCOME',
      messageKey: 'errors.unknownCommandOutcome',
      retryClass: 'RECONCILE_FIRST',
      httpHint: 503,
      fieldPath: 'request',
      internalReason: 'gateway internal failure',
    },
  });

export function getAutomationGatewayError(
  code: AutomationGatewayErrorCode,
): AutomationGatewayError {
  return AUTOMATION_ERROR_TABLE[code];
}

export type AutomationWireStatus = 'ACCEPTED' | 'APPLIED' | 'FAILED';

export interface AutomationWireResponse {
  readonly status: AutomationWireStatus;
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly commandId: string;
  readonly correlationId: string;
  readonly data?: unknown;
  readonly errors?: ReadonlyArray<ContractError>;
}

export interface AutomationIdempotencyRecord {
  readonly scopeKey: string;
  readonly idempotencyKey: string;
  readonly payloadDigest: string;
  readonly commandName: string;
  readonly organizationId: string;
  readonly connectionId: string;
  readonly workflowId: string;
  readonly createdAt: number;
  readonly result: AutomationWireResponse;
}

export function makeAutomationError(
  code: AutomationGatewayErrorCode,
  fieldPath?: ContractError['fieldPath'],
): ContractError {
  const def = AUTOMATION_ERROR_TABLE[code];
  return makeError(def.wireCode, fieldPath ?? def.fieldPath);
}

export interface AutomationGatewayConfig {
  maxPayloadBytes: number;
  defaultTimeoutMs: number;
  rateLimitPerMinute: number;
  idempotencyRetentionMs: number;
  maxIdempotencyRecords: number;
}

export const DEFAULT_AUTOMATION_GATEWAY_CONFIG: AutomationGatewayConfig = Object.freeze({
  maxPayloadBytes: 64 * 1024,
  defaultTimeoutMs: 5_000,
  rateLimitPerMinute: 60,
  idempotencyRetentionMs: 24 * 60 * 60 * 1000,
  maxIdempotencyRecords: 100_000,
});

export { SCHEMA_VERSION };