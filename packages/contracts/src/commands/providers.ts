/**
 * providers.ts — Provider/transport contracts (Gate 0 / 0.3h).
 *
 * Nguồn: Master-Plan.V2.6.md §7.1, §8 + Backlog Gate0 §0.3h +
 * hrp-connector.md v1.1 (HEAD 414c54b) §2, §7.
 *
 * Trọng tâm:
 *  - Provider transport contracts (Chatwoot, Zalo OA) bind shape.
 *  - Provider KHÔNG giữ policy tuyển dụng (theo Master §7.1
 *    "ChatwootGateway và ZaloOaGateway: transport, không giữ policy
 *    tuyển dụng").
 *  - Capability token opaque; không expose internal secret value.
 *  - Probe/handshake contracts cho integration endpoint health check.
 *  - DID/connection registry shape (provider + connection metadata).
 */
import { z } from 'zod';
import { SCHEMA_VERSION } from '../enums.js';
import {
  ConnectionIdSchema,
  OrganizationIdSchema,
  ProviderNameSchema,
  SchemaVersionSchema,
} from '../primitives.js';

/* ───────────────────────────────────────────────────────────────────────────
 * Provider capabilities allowlist.
 *
 * Theo Master §10.2.1 + connector §2: capability groups đề xuất
 * (context.read, intake.submit, profile.complete, case.update/close,
 * availability.update, interaction.record, next-action.update,
 * analytics.read/export, outbox.consume). Merge, HRP review, credential
 * management cần capability riêng.
 *
 * Schema bind shape allowlist; runtime HRP gate quyết capability
 * exact (token opaque ở đây, KHÔNG expose value).
 * ─────────────────────────────────────────────────────────────────────────── */
export const HRP_PROVIDER_CAPABILITIES = [
  'context.read',
  'intake.submit',
  'profile.complete',
  'case.update',
  'case.close',
  'availability.update',
  'interaction.record',
  'next-action.update',
  'outbox.consume',
  'analytics.read',
  'analytics.export',
  'webhook.receive',
] as const;
export type HrpProviderCapability =
  (typeof HRP_PROVIDER_CAPABILITIES)[number];
export const HrpProviderCapabilitySchema = z.enum(
  HRP_PROVIDER_CAPABILITIES,
);

/**
 * ProviderCapabilityToken — opaque capability token runtime cấp.
 * KHÔNG chứa secret value; chỉ reference.
 */
export const ProviderCapabilityTokenSchema = z
  .string()
  .min(8)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u, 'capabilityToken ký tự không hợp lệ');

/**
 * ProviderConnectionRef — reference provider connection đã xác thực.
 */
export const ProviderConnectionRefSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    provider: ProviderNameSchema,
    connectionId: ConnectionIdSchema,
    /** Capability token opaque runtime cấp. */
    capabilityToken: ProviderCapabilityTokenSchema,
  })
  .strict();
export type ProviderConnectionRef = z.infer<
  typeof ProviderConnectionRefSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * Chatwoot / Zalo OA transport-specific envelope shape.
 *
 * Schema bind shape cho normalize webhook payload từ provider.
 * Provider có thể có field riêng; schema này là canonical sau khi
 * `webhook.receive` verify pass (xem gateway.ts).
 * ─────────────────────────────────────────────────────────────────────────── */
export const ChatwootMessageKindSchema = z.enum([
  'INCOMING',
  'OUTGOING',
  'PRIVATE_NOTE',
  'SYSTEM',
]);

export const ChatwootNormalizedWebhookSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    provider: z.literal('CHATWOOT'),
    connectionId: ConnectionIdSchema,
    event: z.string().min(1).max(256),
    accountId: z.string().min(1).max(128),
    inboxId: z.string().min(1).max(128),
    conversationId: z.string().min(1).max(256),
    messageId: z.string().min(1).max(256).optional(),
    senderType: ChatwootMessageKindSchema.optional(),
    payload: z.unknown(),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type ChatwootNormalizedWebhook = z.infer<
  typeof ChatwootNormalizedWebhookSchema
>;

export const ZaloOaNormalizedWebhookSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    provider: z.literal('ZALO_OA'),
    connectionId: ConnectionIdSchema,
    event: z.string().min(1).max(256),
    oaId: z.string().min(1).max(128),
    userId: z.string().min(1).max(128),
    messageId: z.string().min(1).max(256).optional(),
    payload: z.unknown(),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type ZaloOaNormalizedWebhook = z.infer<
  typeof ZaloOaNormalizedWebhookSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * ProviderProbeRequest — health check / handshake contracts.
 *
 * Production probe: runtime chạy qua gateway verify; schema bind
 * shape request + response.
 *
 * Client contract chưa chốt (Q-23 UNRESOLVED/PROPOSED): probe KHÔNG
 * lộ raw Contactability/Contact; chỉ kiểm tra transport reachability.
 * ─────────────────────────────────────────────────────────────────────────── */
export const ProviderProbeRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    provider: ProviderNameSchema,
    connectionId: ConnectionIdSchema,
    /** Marker: probe mode — deep check capability token. */
    deepCheck: z.boolean(),
  })
  .strict();

export const ProviderProbeOutcomeSchema = z.enum([
  'REACHABLE',
  'UNREACHABLE',
  'AUTH_EXPIRED',
  'RATE_LIMITED',
  'CAPABILITY_REVOKED',
  'UNKNOWN',
]);

export const ProviderProbeResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    outcome: ProviderProbeOutcomeSchema,
    /** Server-set timestamp probe. */
    probedAt: z.string().datetime({ offset: true }),
    /** Latency nếu REACHABLE. */
    latencyMs: z.number().int().nonnegative().max(60_000).optional(),
    /** Capabilities verified (deep check only). */
    capabilitiesVerified: z
      .array(HrpProviderCapabilitySchema)
      .max(HRP_PROVIDER_CAPABILITIES.length)
      .optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.outcome === 'REACHABLE' && val.latencyMs === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'REACHABLE outcome phải có latencyMs',
        path: ['latencyMs'],
      });
    }
    if (val.outcome !== 'REACHABLE' && val.latencyMs !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${val.outcome} outcome KHÔNG có latencyMs`,
        path: ['latencyMs'],
      });
    }
  });
export type ProviderProbeResult = z.infer<typeof ProviderProbeResultSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * Provider allowed/disallowed operations.
 *
 * Provider KHÔNG giữ policy tuyển dụng. Schema forbid các field
 * "internal policy" / "override placement" / "credit assignment"
 * etc.
 * ─────────────────────────────────────────────────────────────────────────── */
export const PROVIDER_PAYLOAD_FORBIDDEN = Object.freeze([
  // Policy tuyển dụng — Provider không giữ.
  'routingDecision',
  'handlingAssignment',
  'creditPolicyVersion',
  'candidateAssignment',
  'workerCreation',
  'beneficiaryAssignment',
  'placementEffective',
  // Bypass canonical.
  'bypassDnc',
  'bypassReview',
  'bypassStaffReview',
  'forceApproval',
  'forcePlacement',
  'ignoreFreshness',
  // Core DB URL.
  'coreDbUrl',
  'corePrismaUrl',
  'coreCredentials',
] as const);

export { SCHEMA_VERSION };
