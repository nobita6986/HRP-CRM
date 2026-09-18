import { z } from 'zod';
import { EvidenceKindSchema, SCHEMA_VERSION } from './enums.js';

/** Wire contract version v1. Unknown versions must fail closed. */
export const SchemaVersionSchema = z.literal(SCHEMA_VERSION);

/**
 * Business clock timezone đã chốt baseline theo Owner chỉ thị.
 * Áp dụng cho: `availableFromDate` validation, submission lifecycle
 * timing, KPI/reporting. UTC+7, không DST. Runtime HRP gate dùng
 * constant này để đánh giá "ngày tương lai" (Q-15).
 */
export const BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh' as const;
export const BusinessTimezoneSchema = z.literal(BUSINESS_TIMEZONE);

const opaqueId = (name: string, max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, `${name} ký tự không hợp lệ`);

export const CorrelationIdSchema = opaqueId('correlationId', 128).min(8);
export const CommandIdSchema = opaqueId('commandId', 64).min(8);

/**
 * Runtime scopes an idempotency key by verified organization and allowlisted
 * command name. A correlation id is deliberately not part of that identity.
 */
export const IdempotencyKeySchema = z
  .string()
  .min(8)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/u, 'idempotencyKey ký tự không hợp lệ');

export const OrganizationIdSchema = opaqueId('organizationId', 64);
export const CanonicalIdSchema = opaqueId('canonical id', 128);
export const ExpectedVersionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const CommandNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][A-Za-z0-9]*$/u, 'commandName phải là tên allowlisted');

export const IdempotencyScopeSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    commandName: CommandNameSchema,
    idempotencyKey: IdempotencyKeySchema,
  })
  .strict();
export type IdempotencyScope = z.infer<typeof IdempotencyScopeSchema>;

/** ISO-8601 timestamp containing an explicit UTC offset. */
export const IsoTimestampSchema = z
  .string()
  .min(20)
  .max(40)
  .datetime({ offset: true });

/** Calendar date with both shape and real Gregorian-date validation. */
export const CalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'calendarDate phải YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, 'calendarDate không tồn tại');

export const ProviderNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u, 'providerName ký tự không hợp lệ');
export const ConnectionIdSchema = opaqueId('connectionId', 128);

/**
 * Actor is an untrusted request claim. Authentication must bind every field to
 * the authenticated principal/delegation and re-authorize organization/target,
 * including replay/result-query paths.
 */
export const UserActorClaimSchema = z
  .object({ kind: z.literal('USER'), userId: opaqueId('userId', 128) })
  .strict();
export const ServiceActorClaimSchema = z
  .object({ kind: z.literal('SERVICE'), serviceId: opaqueId('serviceId', 128) })
  .strict();
export const DelegatedUserActorClaimSchema = z
  .object({
    kind: z.literal('DELEGATED_USER'),
    serviceId: opaqueId('serviceId', 128),
    userId: opaqueId('userId', 128),
    delegationRef: opaqueId('delegationRef', 128),
  })
  .strict();
export const ActorSchema = z.discriminatedUnion('kind', [
  UserActorClaimSchema,
  ServiceActorClaimSchema,
  DelegatedUserActorClaimSchema,
]);
export type ActorClaim = z.infer<typeof ActorSchema>;

/**
 * Source is also a claim, never authentication proof. HRP_UI has no external
 * connection. Integration sources require an explicit provider/connection.
 */
export const HrpUiCommandSourceSchema = z
  .object({
    kind: z.literal('HRP_UI'),
    provider: z.literal('HRP_UI'),
    connectionId: z.null(),
  })
  .strict();
export const IntegrationCommandSourceSchema = z
  .object({
    kind: z.literal('INTEGRATION'),
    provider: z.enum(['CHATWOOT', 'ZALO_OA']),
    connectionId: ConnectionIdSchema,
  })
  .strict();
export const CommandSourceSchema = z.discriminatedUnion('kind', [
  HrpUiCommandSourceSchema,
  IntegrationCommandSourceSchema,
]);
export type CommandSourceClaim = z.infer<typeof CommandSourceSchema>;

export const InboundSourceSchema = z
  .object({
    provider: ProviderNameSchema,
    connectionId: ConnectionIdSchema,
    externalAccountId: opaqueId('externalAccountId', 128).optional(),
    externalInboxId: opaqueId('externalInboxId', 128).optional(),
    externalConversationId: opaqueId('externalConversationId', 256).optional(),
    externalMessageId: opaqueId('externalMessageId', 256).optional(),
  })
  .strict();

export const EvidenceIdSchema = opaqueId('evidenceId', 128);
export const EvidenceRefSchema = z
  .object({
    evidenceId: EvidenceIdSchema,
    kind: EvidenceKindSchema,
  })
  .strict();

export { SCHEMA_VERSION };
