/**
 * gateway.ts — CanonicalHrpGateway contracts (Gate 0 / 0.3h).
 *
 * Nguồn: Master-Plan.V2.6.md §7.2 + Backlog Gate0 §0.3h +
 * hrp-connector.md v1.1 (HEAD 414c54b) §5.
 *
 * Trọng tâm AC:
 *  - CanonicalHrpGateway methods typed request/result theo từng command
 *    (chỉ contracts, không implementation).
 *  - Tách privileged merge capability khỏi inbound default gateway:
 *    - Inbound gateway (CRM/Chat app) chỉ cho phép các commands
 *      intention của intake/review/case/intake/availability/next-action
 *      /interaction workflow.
 *    - Privileged merge gateway (HRP reviewer) cho phép
 *      `mergeLaborProfiles`, `commitReviewDecision`,
 *      `resolvePossibleMatch` — capability riêng.
 *  - Webhook verification contracts nhận raw bytes/headers để verify
 *    signature/timestamp — KHÔNG trust parsed body trước khi verify.
 *  - Ports KHÔNG import Prisma/Next.js runtime; signature chỉ contract.
 *    Hỗ trợ deterministic clock (`nowProvider`) + fault injection
 *    (`faultHooks`) cho test.
 *  - Client contract (recordClientInteraction context) chưa chốt → mark
 *    PROPOSED ở comment + decision register.
 *
 * Chỉ contracts/fixtures. KHÔNG triển khai HTTP client, KHÔNG mock
 * gateway trong package này.
 */
import { z } from 'zod';
import { SCHEMA_VERSION } from '../enums.js';
import {
  CommandIdSchema,
  ConnectionIdSchema,
  OrganizationIdSchema,
  ProviderNameSchema,
  SchemaVersionSchema,
} from '../primitives.js';

/* ───────────────────────────────────────────────────────────────────────────
 * HrpGateway capability enumeration.
 *
 * Phân biệt rõ 3 tier:
 *  - INBOUND_DEFAULT: CRM/Chat app, Chatwoot/Zalo webhook receiver.
 *  - INBOUND_REVIEWER: HRP-side reviewer (UI review staff).
 *  - PRIVILEGED_MERGE: HRP-side privileged reviewer cho merge/resolve.
 *
 * Tier mapping dùng ở capability check runtime HRP gate; schema bind
 * shape để audit/SLA theo tier.
 * ─────────────────────────────────────────────────────────────────────────── */
export const HRP_GATEWAY_TIERS = [
  'INBOUND_DEFAULT',
  'INBOUND_REVIEWER',
  'PRIVILEGED_MERGE',
] as const;
export type HrpGatewayTier = (typeof HRP_GATEWAY_TIERS)[number];
export const HrpGatewayTierSchema = z.enum(HRP_GATEWAY_TIERS);

/**
 * HrpGatewayCallContext — context runtime cấp cho mỗi gateway call.
 *
 * Tier + actor + auth scope + connection + correlation. Runtime gate
 * bind tất cả field với authenticated principal (Master §8 + §11).
 *
 * F2 follow-up (Gate 0 remediation): thêm HRP_UI source path qua
 * INBOUND_DEFAULT. HRP_UI là nguồn internal — không qua provider
 * external — vẫn được phép đi qua gateway INBOUND_DEFAULT với
 * provider='HRP_UI', connectionId=null. Logic superRefine phân biệt
 * HRP_UI (không yêu cầu connection) vs integration provider (bắt
 * buộc connectionId hợp lệ). Source discriminator dùng lại từ
 * primitives.ts (CommandSourceSchema contract nguồn nội bộ).
 */
export const HrpGatewayCallContextSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    tier: HrpGatewayTierSchema,
    /** Caller-set correlation id; runtime đối chiếu auth. */
    correlationId: z.string().min(8).max(128),
    /**
     * Provider tag. Cho phép:
     *  - 'HRP_UI' khi caller là HRP UI internal (không external).
     *  - CHATWOOT/ZALO_OA/GENERIC (provider external hợp lệ) cho
     *    inbound integration.
     *  - KHÔNG có provider thì hợp lệ với INBOUND_REVIEWER /
     *    PRIVILEGED_MERGE (HRP-side, không external).
     */
    provider: ProviderNameSchema.optional(),
    /**
     * Connection opaque id — required khi provider là integration
     * external; phải là null khi provider='HRP_UI'; KHÔNG được có ở
     * INBOUND_REVIEWER / PRIVILEGED_MERGE tier.
     */
    connectionId: ConnectionIdSchema.nullable().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.tier === 'INBOUND_DEFAULT') {
      // INBOUND_DEFAULT tier yêu cầu provider. Nếu provider là
      // HRP_UI (internal source) → connectionId phải null/undefined.
      // Nếu provider là integration (CHATWOOT/ZALO_OA/GENERIC) →
      // connectionId bắt buộc (string non-empty).
      if (!val.provider) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'INBOUND_DEFAULT tier yêu cầu provider (HRP_UI cho internal source; provider external cho integration)',
          path: ['provider'],
        });
        return;
      }
      if (val.provider === 'HRP_UI') {
        if (val.connectionId !== undefined && val.connectionId !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'HRP_UI internal source KHÔNG đi kèm connectionId (phải null hoặc bỏ trống)',
            path: ['connectionId'],
          });
        }
      } else {
        if (val.connectionId === undefined || val.connectionId === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'INBOUND_DEFAULT với provider external yêu cầu connectionId hợp lệ',
            path: ['connectionId'],
          });
        }
      }
      return;
    }
    if (
      val.tier === 'INBOUND_REVIEWER' ||
      val.tier === 'PRIVILEGED_MERGE'
    ) {
      // Reviewer / privileged tier: HRP-side, không qua provider
      // external. Cấm provider và connectionId (kể cả null).
      if (val.provider !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${val.tier} tier KHÔNG được có provider (HRP-side, không qua provider external)`,
          path: ['provider'],
        });
      }
      if (val.connectionId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${val.tier} tier KHÔNG được có connectionId (HRP-side)`,
          path: ['connectionId'],
        });
      }
    }
  });
export type HrpGatewayCallContext = z.infer<
  typeof HrpGatewayCallContextSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * HrpGatewayErrorMapping — error taxonomy runtime map.
 *
 * Schema bind shape; runtime HRP gate map envelope error codes →
 * canonical error (xem errors.ts). Tier-specific mapping: PRIVILEGED_MERGE
 * expose thêm `ELEVATED_REVIEW_REQUIRED` (chưa chốt — PROPOSED).
 * ─────────────────────────────────────────────────────────────────────────── */
export const HrpGatewayErrorMappingRefSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    /** Error code mapping table — chỉ reference, runtime instance. */
    mappingId: z.string().min(1).max(128),
    /** Tier áp dụng. */
    applicableTiers: z.array(HrpGatewayTierSchema).min(1),
    /** Marker: PRIVILEGED_MERGE expose elevated errors. */
    elevatedForPrivileged: z.boolean(),
  })
  .strict();
export type HrpGatewayErrorMappingRef = z.infer<
  typeof HrpGatewayErrorMappingRefSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * WebhookReceiverPort — type contracts cho inbound webhook receiver.
 *
 * T1 cố tình bind raw bytes (`Uint8Array`) + headers thô
 * (`Record<string, string>`) để receiver verify signature trước khi
 * parse JSON. KHÔNG nhận parsed object trước khi verify.
 *
 * Provider protocols khác nhau:
 *  - Chatwoot: HMAC SHA-256 với secret + body.
 *  - Zalo OA: x-signature header + checksum body.
 *  - Generic: configurable.
 *
 * Schema bind `expectedAlgorithms` allowlist để reject algorithm
 * downgrade attack (per Master §11).
 * ─────────────────────────────────────────────────────────────────────────── */
export const WEBHOOK_SIGNATURE_ALGORITHMS = [
  'HMAC_SHA256',
  'HMAC_SHA512',
  'ED25519',
] as const;
export type WebhookSignatureAlgorithm =
  (typeof WEBHOOK_SIGNATURE_ALGORITHMS)[number];
export const WebhookSignatureAlgorithmSchema = z.enum(
  WEBHOOK_SIGNATURE_ALGORITHMS,
);

export const WebhookRawHeadersSchema = z
  .record(z.string(), z.string())
  .refine(
    (h) =>
      Object.keys(h).every((k) =>
        /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/u.test(k),
      ),
    'header key phải là HTTP token hợp lệ',
  );

export const WebhookReceiverRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    provider: ProviderNameSchema,
    connectionId: ConnectionIdSchema,
    /** Raw bytes (Uint8Array); receiver verify signature trước khi parse. */
    rawBody: z.instanceof(Uint8Array),
    /** Raw HTTP headers (key lowercase per HTTP/2 convention or as-sent). */
    headers: WebhookRawHeadersSchema,
    /** Expected signature algorithms — allowlist. */
    expectedAlgorithms: z.array(WebhookSignatureAlgorithmSchema).min(1),
    /** Server clock for timestamp window check (deterministic test). */
    nowEpochMs: z.number().int().nonnegative(),
    /** Maximum timestamp age seconds — runtime HRP gate bound. */
    maxAgeSec: z.number().int().positive().max(86_400),
  })
  .strict();
export type WebhookReceiverRequest = z.infer<
  typeof WebhookReceiverRequestSchema
>;

/**
 * WebhookReceiverVerified — payload đã verify xong.
 * `parsedBody` chỉ có khi verify pass; runtime bind schema theo provider.
 */
export const WebhookReceiverVerifiedSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    provider: ProviderNameSchema,
    connectionId: ConnectionIdSchema,
    algorithm: WebhookSignatureAlgorithmSchema,
    /** Server-set timestamp verify. */
    verifiedAt: z.string().datetime({ offset: true }),
    parsedBody: z.unknown(),
  })
  .strict();
export type WebhookReceiverVerified = z.infer<
  typeof WebhookReceiverVerifiedSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * HrpGateway method enumeration — contracts only.
 *
 * Mỗi method map 1:1 với command name + ACL capability allowlist.
 * Schema bind shape cho audit; runtime HRP gate tier check.
 *
 * Tier restriction:
 *  - INBOUND_DEFAULT: chỉ các method intake/review/case/availability/
 *    next-action/interaction/outbox-read (KHÔNG merge/resolve privileged).
 *  - INBOUND_REVIEWER: + review workflow methods.
 *  - PRIVILEGED_MERGE: + mergeLaborProfiles, resolvePossibleMatch,
 *    commitReviewDecision (privileged).
 * ─────────────────────────────────────────────────────────────────────────── */
export const HRP_GATEWAY_METHODS = [
  // Intake + profile (inbound default).
  'createOrMatchLaborProfile',
  'updateLaborProfile',
  'mergeLaborProfiles',
  // Case.
  'openPlacementCase',
  'updatePlacementCase',
  'closePlacementCase',
  // Interactions.
  'recordInteraction',
  'recordClientInteraction',
  // Availability + suppression (NextAction outbox).
  'updateLaborAvailability',
  'commitSuppression',
  'dispatchAuthorizationCheck',
  // NextAction.
  'createNextAction',
  'updateNextAction',
  // Outbox read/reporting.
  'queryOutboxDelivery',
  // Review workflow (reviewer tier).
  'commitReviewDecision',
  'resolvePossibleMatch',
  // Privileged.
  'supersedeReviewStatus',
] as const;
export type HrpGatewayMethod = (typeof HRP_GATEWAY_METHODS)[number];
export const HrpGatewayMethodSchema = z.enum(HRP_GATEWAY_METHODS);

/**
 * HrpGatewayMethodCapability — schema bind shape cho method × tier.
 * Schema KHÔNG enforce ở runtime; chỉ là marker table reference
 * cho capability check runtime HRP gate.
 */
export const HrpGatewayMethodCapabilitySchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    method: HrpGatewayMethodSchema,
    tier: HrpGatewayTierSchema,
    /** Marker: method này có merge capability riêng không. */
    privileged: z.boolean(),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * Ports — abstract interfaces (typings only, KHÔNG import Prisma/Next).
 *
 * Note: TypeScript type `interface` ở đây là runtime contract
 * description; actual implementation là HRP-owned PR. Schema bind
 * shape cho từng port; runtime HRP gate nhận impl qua DI.
 *
 * Deterministic clock: Port nhận `NowProvider` để test; production
 * cung cấp impl dùng `Date.now()` / business clock.
 *
 * Fault injection: Port nhận `FaultHooks` (test optional) để inject
 * latency/error mà không cần import dev-only dependency.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * NowProvider — đồng hồ deterministic cho port.
 * Trả về epoch milliseconds.
 */
export type NowProvider = () => number;

/**
 * FaultHooks — optional, default no-op.
 *  - latencyMs: insert latency trước khi trả.
 *  - injectError: ép port throw error (audit required). KHÔNG dùng
 *    để bypass authorization.
 */
export const FaultHooksSchema = z
  .object({
    latencyMs: z.number().int().nonnegative().max(60_000).default(0),
    injectErrorCode: z
      .enum([
        'DEPENDENCY_UNAVAILABLE',
        'RATE_LIMITED',
        'UNKNOWN_COMMAND_OUTCOME',
      ])
      .optional(),
  })
  .strict();
export type FaultHooks = z.infer<typeof FaultHooksSchema>;

/**
 * HrpGatewayPort — abstract port cho canonical HRP gateway.
 *
 * T1 KHÔNG khai báo implementation; chỉ contract type. Runtime HRP
 * gate cung cấp impl qua DI (HTTP client, mock, etc.).
 *
 * - `call(command, payload, context)`: gọi 1 command runtime.
 * - `verifyWebhook(request)`: nhận raw bytes/headers + verify.
 * - `commitReceipt(receipt)`: durable accept cho outbox intent.
 *
 * Port KHÔNG chứa:
 *  - import Prisma client.
 *  - import Next.js server runtime.
 *  - hardcoded credentials.
 *  - direct HTTP throttling logic (runtime policy class khác).
 */
export interface HrpGatewayPort {
  /**
   * Call 1 command qua HRP gateway.
   * Returns Result union đã định nghĩa ở envelopes.ts.
   */
  call(
    command: HrpGatewayMethodSchemaT,
    payload: unknown,
    context: HrpGatewayCallContext,
    options?: { now?: NowProvider; faults?: FaultHooks },
  ): Promise<HrpGatewayCallResult>;

  /**
   * Verify webhook — nhận raw bytes/headers, KHÔNG trust parsed body.
   * Runtime HRP gate reject nếu signature missing/mismatch/algorithm
   * ngoài allowlist.
   */
  verifyWebhook(
    request: WebhookReceiverRequest,
    options?: { now?: NowProvider },
  ): Promise<WebhookReceiverVerified>;

  /**
   * Commit delivery receipt — durable accept cho outbox intent.
   * HRP chỉ đánh dấu dispatched sau acceptance.
   */
  commitReceipt(
    receipt: OutboxDeliveryReceiptShape,
    context: HrpGatewayCallContext,
    options?: { now?: NowProvider; faults?: FaultHooks },
  ): Promise<HrpGatewayCallResult>;
}

// Forward type aliases for ports (chỉ type; runtime HRP gate xuất
// Schema cho gateway ở file khác nếu cần).
import type { z as ZodNamespace } from 'zod';
type HrpGatewayMethodSchemaT = ZodNamespace.infer<
  typeof HrpGatewayMethodSchema
>;
type HrpGatewayCallResult = unknown;
type OutboxDeliveryReceiptShape = unknown;
