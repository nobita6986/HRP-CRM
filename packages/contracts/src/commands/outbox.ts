/**
 * outbox.ts — Outbox & delivery contracts (Gate 0 / 0.3g).
 *
 * Nguồn: Master-Plan.V2.6.md §9 + §10.6.5 + Backlog Gate0 §0.3g +
 * hrp-connector.md v1.1 (HEAD 414c54b) §7.
 *
 * Phân biệt rõ 4 tầng:
 *  1. **transactionalOutboxPublisher (HRP internal tx port)** — hàm
 *     nội bộ HRP ghi intent cùng transaction với mutation; nhận
 *     transaction context (KHÔNG serialize Prisma transaction object).
 *  2. **OutboxDeliveryIntent (handoff DTO)** — wire payload HRP-side
 *     dispatcher đẩy sang ACL/CRM; contract external, không lộ
 *     Prisma/Hrp state.
 *  3. **OutboxDeliveryReceipt (consumer ack)** — ACL/CRM durable
 *     accept trước khi provider call; HRP chỉ đánh dấu dispatched
 *     sau acceptance bền vững.
 *  4. **DeliveryReportingEvent (callback DTO)** — webhook callback
 *     từ ACL/CRM sau khi provider sent/delivered/failed/UNKNOWN/
 *     suppressed; auth + idempotency + signature.
 *
 * Trọng tâm:
 *  - Push model chính (HRP-side dispatcher → ACL/CRM webhook).
 *    Fallback claim/ack chỉ khi webhook không khả dụng; quyết định
 *    runtime HRP gate.
 *  - Mutation + outbox + idempotency/result + success audit cùng
 *    HRP transaction. Timeout sau commit dùng cùng idempotency key.
 *  - ACK sau durable acceptance; handoff ACCEPTED khác sent/delivered.
 *  - UNKNOWN/suppressed có semantics, không hứa exactly-once
 *    provider.
 *  - Retry/DLQ re-drive KHÔNG bypass DNC; missing API là HRP-owned PR.
 */
import { z } from 'zod';
import { SCHEMA_VERSION } from '../enums.js';
import {
  CanonicalIdSchema,
  CommandIdSchema,
  ConnectionIdSchema,
  ExpectedVersionSchema,
  IdempotencyKeySchema,
  OrganizationIdSchema,
  ProviderNameSchema,
  SchemaVersionSchema,
} from '../primitives.js';
import { ErrorListSchema } from '../errors.js';

/* ───────────────────────────────────────────────────────────────────────────
 * §1. transactionalOutboxPublisher port (HRP internal tx port).
 *
 * Schema bind shape cho hàm internal HRP gọi. T1 cố tình KHÔNG
 * serialize Prisma transaction object (đó là implementation detail);
 * schema chỉ bind `commitHookId` opaque + `intent` shape.
 *
 * Runtime HRP gate enforce: mutation domain change + outbox row
 * cùng transaction; rollback xóa cả hai. Scheduler/dispatcher
 * KHÔNG tạo transaction mới ở đây — chỉ đọc outbox qua API HRP
 * cấp quyền.
 * ─────────────────────────────────────────────────────────────────────────── */
export const OutboxPublisherPortNameSchema = z.literal(
  'transactionalOutboxPublisher',
);

/**
 * OutboxIntentDraft — shape của intent HRP ghi vào outbox cùng
 * transaction. KHÔNG chứa raw PII/CCCD; chỉ opaque reference +
 * template data + dedupe key + correlation.
 *
 * Backlog §0.3g AC #2: "Intent có ID/schema/source/destination
 * reference/approved content hoặc template data/correlation/dedupe;
 * không nguyên hồ sơ/CCCD."
 */
export const OutboxTemplateEngineKindSchema = z.enum([
  'NONE',
  'HRP_INTERNAL',
  'PROVIDER_TEMPLATE',
]);

export const OutboxIntentDraftSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    /** Server-set intent id (server canonical). */
    intentId: CanonicalIdSchema,
    /** Schema version của payload. */
    intentSchemaVersion: SchemaVersionSchema,
    /** Source reference (commandId đã tạo mutation). */
    sourceCommandId: CommandIdSchema,
    /** Destination reference: provider + connection + recipient/handle. */
    destination: z
      .object({
        provider: ProviderNameSchema,
        connectionId: ConnectionIdSchema,
        recipientRef: z
          .string()
          .min(1)
          .max(512)
          .regex(/^[A-Za-z0-9][A-Za-z0-9._@+-]*$/u, 'recipientRef ký tự không hợp lệ'),
        /** Optional: external account/inbox/conversation id. */
        externalAccountId: z.string().min(1).max(256).optional(),
        externalInboxId: z.string().min(1).max(256).optional(),
        externalConversationId: z.string().min(1).max(256).optional(),
      })
      .strict(),
    /** Template engine — NONE = literal content; HRP_INTERNAL/PROVIDER_TEMPLATE
     *  = reference + params. */
    template: z
      .object({
        engine: OutboxTemplateEngineKindSchema,
        /** Approved content literal (engine = NONE) hoặc template ref. */
        contentRef: z.string().min(1).max(512),
        /** Redacted params cho template substitution. KHÔNG chứa PII raw. */
        params: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
    /** Correlation giữ cho retry, không thay thế idempotency key. */
    correlationId: z.string().min(8).max(128),
    /** Dedupe key cho provider retry; server canonical (HRP set). */
    dedupeKey: IdempotencyKeySchema,
    /** Optional: policy references (audit) — purpose + suppression scope
     * + retry policy ver. */
    policy: z
      .object({
        purpose: z.string().min(1).max(256),
        suppressionCheckRequired: z.boolean(),
        retryPolicyVersion: z.string().min(1).max(64),
        /** Marker: gắn với suppression event đã commit (nếu có). */
        suppressionEventId: z.string().min(1).max(128).optional(),
      })
      .strict(),
  })
  .strict();
export type OutboxIntentDraft = z.infer<typeof OutboxIntentDraftSchema>;

/**
 * OutboxPublishHook — payload mà `transactionalOutboxPublisher(tx)` nhận.
 *
 * Schema bind shape constraint: hàm internal HRP, KHÔNG export qua
 * S2S; CRM/ACL không bao giờ gọi trực tiếp. Schema là marker để
 * HRP-side implementation typing.
 *
 * Tx context chỉ là opaque ID (server runtime handle); KHÔNG
 * serialize Prisma transaction object (Master §9.1 + connector §7).
 */
export const OutboxPublishHookSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    /** Opaque transaction handle do HRP runtime cấp. */
    txHandle: z.string().min(1).max(128),
    intent: OutboxIntentDraftSchema,
  })
  .strict();
export type OutboxPublishHook = z.infer<typeof OutboxPublishHookSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * §2. OutboxDeliveryIntent (handoff DTO) — wire payload HRP dispatcher
 * đẩy sang ACL/CRM khi consumer subscribe (push model) hoặc pick từ
 * poll claim/ack (fallback).
 *
 * Đây là wire shape; CRM ngữ cảnh external. Schema bind shape; runtime
 * HRP gate cấp `commitHookId` (idempotency/receipt) cho CRM.
 *
 * Phân biệt với OutboxIntentDraft: DeliveryIntent là wire-bound (CRM
 * có thể nhận qua webhook); IntentDraft là HRP internal storage.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * OutboxDeliveryChannel — delivery transport chính.
 *  - PUSH_WEBHOOK: HRP-side dispatcher POST DeliveryIntent tới
 *    ACL/CRM endpoint đã khai báo.
 *  - PULL_CLAIM_ACK: ACL/CRM claim lease qua API; pull intent.
 *    Fallback khi webhook không khả dụng.
 *
 * Push là mặc định; Pull chỉ fallback (theo lý do đã ghi ở đầu file).
 */
export const OUTBOX_DELIVERY_CHANNELS = [
  'PUSH_WEBHOOK',
  'PULL_CLAIM_ACK',
] as const;
export type OutboxDeliveryChannel =
  (typeof OUTBOX_DELIVERY_CHANNELS)[number];
export const OutboxDeliveryChannelSchema = z.enum(
  OUTBOX_DELIVERY_CHANNELS,
);

export const OutboxDeliveryIntentSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    intentId: CanonicalIdSchema,
    intentSchemaVersion: SchemaVersionSchema,
    sourceCommandId: CommandIdSchema,
    destination: z
      .object({
        provider: ProviderNameSchema,
        connectionId: ConnectionIdSchema,
        recipientRef: z
          .string()
          .min(1)
          .max(512)
          .regex(/^[A-Za-z0-9][A-Za-z0-9._@+-]*$/u, 'recipientRef ký tự không hợp lệ'),
        externalAccountId: z.string().min(1).max(256).optional(),
        externalInboxId: z.string().min(1).max(256).optional(),
        externalConversationId: z.string().min(1).max(256).optional(),
      })
      .strict(),
    template: z
      .object({
        engine: OutboxTemplateEngineKindSchema,
        contentRef: z.string().min(1).max(512),
        params: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
    correlationId: z.string().min(8).max(128),
    dedupeKey: IdempotencyKeySchema,
    policy: z
      .object({
        purpose: z.string().min(1).max(256),
        suppressionCheckRequired: z.boolean(),
        retryPolicyVersion: z.string().min(1).max(64),
        suppressionEventId: z.string().min(1).max(128).optional(),
      })
      .strict(),
    /** Delivery channel HRP chọn runtime. */
    channel: OutboxDeliveryChannelSchema,
    /** Idempotency token CRM dùng để dedupe (HRP cấp). */
    consumerDedupeToken: IdempotencyKeySchema,
  })
  .strict();
export type OutboxDeliveryIntent = z.infer<typeof OutboxDeliveryIntentSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * §3. OutboxDeliveryReceipt — CRM/ACL ack trước khi provider call.
 *
 * Handoff ACCEPTED = CRM đã durable accept (đã persist receipt).
 * HRP chỉ đánh dấu dispatched sau acceptance; không suy diễn
 * delivered khi CRM đã ACK.
 *
 * Backlog §0.3g AC #4: "Handoff accepted khác provider sent/delivered".
 * ─────────────────────────────────────────────────────────────────────────── */
export const DeliveryReceiptOutcomes = ['ACCEPTED'] as const;
export type DeliveryReceiptOutcome =
  (typeof DeliveryReceiptOutcomes)[number];
export const DeliveryReceiptOutcomeSchema =
  z.enum(DeliveryReceiptOutcomes);

export const OutboxDeliveryReceiptSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    intentId: CanonicalIdSchema,
    consumerDedupeToken: IdempotencyKeySchema,
    outcome: DeliveryReceiptOutcomeSchema,
    /** Server-set timestamp CRM persist receipt. */
    acceptedAt: z.string().datetime({ offset: true }),
    /** Idempotency: same key + same digest → same outcome. */
    errors: ErrorListSchema.optional(),
  })
  .strict();
export type OutboxDeliveryReceipt = z.infer<
  typeof OutboxDeliveryReceiptSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * §4. DeliveryReportingEvent — callback DTO.
 *
 * ACL/CRM POST DeliveryReportingEvent về HRP sau khi provider
 * sent/delivered/failed/UNKNOWN/suppressed. Webhook có auth +
 * idempotency + signature per connector §7.
 *
 * UNKNOWN/suppressed có semantics, không hứa exactly-once provider.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * DeliveryReportingState — runtime state từ CRM/ACL.
 *  - SENT: provider accepted, pending delivery confirmation.
 *  - DELIVERED: provider confirmed delivered.
 *  - FAILED: gửi fail sau retry (audit reason).
 *  - UNKNOWN: HRP không xác minh được (cache stale / HRP offline
 *    / provider không phản hồi kịp). KHÔNG retry nếu đã qua
 *    deadline; reconcile.
 *  - SUPPRESSED: dispatch gate SUPPRESSED (DNC active / fence expired).
 *    KHÔNG retry, KHÔNG DLQ re-drive.
 */
export const DELIVERY_REPORTING_STATES = [
  'SENT',
  'DELIVERED',
  'FAILED',
  'UNKNOWN',
  'SUPPRESSED',
] as const;
export type DeliveryReportingState =
  (typeof DELIVERY_REPORTING_STATES)[number];
export const DeliveryReportingStateSchema = z.enum(
  DELIVERY_REPORTING_STATES,
);

/**
 * DeliveryFailureReason — semantic reasons khi FAILED hoặc UNKNOWN.
 * KHÔNG để CRM đẩy dynamic field; allowlist only.
 *  - PROVIDER_REJECTED: provider refused.
 *  - PROVIDER_TIMEOUT: timeout từ provider.
 *  - DISPATCH_GATE_DENIED: dispatcher gate trả SUPPRESSED (DNC).
 *    Retry/DLQ KHÔNG bypass DNC.
 *  - STALE_CACHE: freshness cache HRP quá hạn (fail closed).
 *  - HRP_OFFLINE: HRP không xác minh được (Master §10.6.5 #3).
 *  - RECIPIENT_RESOLVED: mapping thay đổi làm fence token lệch.
 *  - UNKNOWN_REASON: catch-all (audit required).
 */
export const DELIVERY_FAILURE_REASONS = [
  'PROVIDER_REJECTED',
  'PROVIDER_TIMEOUT',
  'DISPATCH_GATE_DENIED',
  'STALE_CACHE',
  'HRP_OFFLINE',
  'RECIPIENT_RESOLVED',
  'UNKNOWN_REASON',
] as const;
export type DeliveryFailureReason =
  (typeof DELIVERY_FAILURE_REASONS)[number];
export const DeliveryFailureReasonSchema = z.enum(
  DELIVERY_FAILURE_REASONS,
);

export const DeliveryReportingEventSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    intentId: CanonicalIdSchema,
    consumerDedupeToken: IdempotencyKeySchema,
    state: DeliveryReportingStateSchema,
    /** Idempotency: server-set timestamp CRM/ACL report. */
    reportedAt: z.string().datetime({ offset: true }),
    /** Reason chỉ required khi state ∈ {FAILED, UNKNOWN, SUPPRESSED}. */
    reason: DeliveryFailureReasonSchema.optional(),
    /** Optional: provider reference (message id, delivery id). */
    providerRef: z
      .object({
        providerMessageId: z.string().min(1).max(512).optional(),
        providerDeliveryId: z.string().min(1).max(512).optional(),
      })
      .strict()
      .optional(),
    /** Marker: từ dispatcher failure cut-off / fence. */
    fenceContext: z
      .object({
        fenceToken: z.string().min(8).max(256),
        fenceCutOffAt: z.string().datetime({ offset: true }),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (
      (val.state === 'FAILED' ||
        val.state === 'UNKNOWN' ||
        val.state === 'SUPPRESSED') &&
      !val.reason
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${val.state} state phải có reason`,
        path: ['reason'],
      });
    }
    if (val.state === 'SENT' || val.state === 'DELIVERED') {
      if (val.reason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${val.state} state KHÔNG có reason (chỉ FAILED/UNKNOWN/SUPPRESSED)`,
          path: ['reason'],
        });
      }
    }
    // fenceContext: nếu có fenceCutOffAt thì fenceToken bắt buộc.
    if (val.fenceContext) {
      if (
        !val.fenceContext.fenceToken ||
        !val.fenceContext.fenceCutOffAt
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'fenceContext phải có fenceToken + fenceCutOffAt đi cùng nhau',
          path: ['fenceContext'],
        });
      }
    }
  });
export type DeliveryReportingEvent = z.infer<
  typeof DeliveryReportingEventSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * §5. OutboxClaimLease (fallback PULL_CLAIM_ACK).
 *
 * Khi PUSH_WEBHOOK không khả dụng, ACL/CRM claim lease qua API
 * với fencing token. Runtime HRP gate cấp lease + fencing TTL.
 *
 * Retry/DLQ re-drive KHÔNG bypass DNC (Backlog §0.3g AC #4).
 * Missing API là HRP-owned PR (theo lý do đã chốt ở top file).
 * ─────────────────────────────────────────────────────────────────────────── */
export const OutboxClaimRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    consumerId: z.string().min(1).max(128),
    /** ACL/CRM-side capability scope (caller-side). */
    capabilities: z
      .array(z.string().min(1).max(64))
      .min(1)
      .max(64),
    /** Max items to lease in this claim. */
    batchSize: z.number().int().positive().max(500).default(50),
  })
  .strict();

export const OutboxClaimLeaseSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    leaseId: z.string().min(1).max(128),
    fencingToken: z.string().min(8).max(256),
    /** Lease TTL — server-set. */
    leaseTtlSec: z.number().int().positive().max(3600),
    expiresAt: z.string().datetime({ offset: true }),
    intents: z.array(OutboxDeliveryIntentSchema).min(1).max(500),
  })
  .strict();
export type OutboxClaimLease = z.infer<typeof OutboxClaimLeaseSchema>;

export const OutboxClaimAckSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    leaseId: z.string().min(1).max(128),
    fencingToken: z.string().min(8).max(256),
    receipts: z
      .array(OutboxDeliveryReceiptSchema)
      .min(1)
      .max(500),
  })
  .strict();
export type OutboxClaimAck = z.infer<typeof OutboxClaimAckSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * §6. Outbox disallowed / forbidden.
 *
 * Backlog §0.3g AC #1 + connector §7:
 *  - KHÔNG serialize Prisma transaction object trong envelope.
 *  - KHÔNG raw PII / CCCD / full hồ sơ.
 *  - KHÔNG retry/DLQ re-drive để bypass DNC.
 *  - KHÔNG ghi outbox sau commit (không atomic).
 * ─────────────────────────────────────────────────────────────────────────── */
export const OUTBOX_PATCH_FORBIDDEN = Object.freeze([
  // Tx object — KHÔNG serialize.
  'prismaTx',
  'prismaTransaction',
  'sqlTransaction',
  'sqlTransactionObject',
  'databaseTransactionObject',
  // PII raw.
  'cccdNumber',
  'cccdFront',
  'cccdBack',
  'fullName',
  'phoneRaw',
  'addressRaw',
  'dobRaw',
  // Full hồ sơ.
  'fullProfile',
  'fullIntakeSubmission',
  'rawTranscript',
  'chatwootLabelPii',
  // DNC bypass — KHÔNG.
  'bypassDnc',
  'retryWithoutSuppressionCheck',
  'dlqRedriveBypass',
  'forceSendWithoutSuppression',
  // Post-commit write — KHÔNG.
  'writeAfterCommit',
  'httpCallAfterCommit',
  'sendToProviderAfterCommit',
] as const);

export { SCHEMA_VERSION };
