/**
 * events.ts — Event envelope + creation events contracts (Gate 0 / 0.4).
 *
 * Nguồn: Master-Plan.V2.6.md §9 + Backlog Gate0 §0.4 +
 * hrp-connector.md v1.1 (HEAD 414c54b) §7.
 *
 * Trọng tâm AC (Owner chỉ thị rev 2):
 *  - Event có organization/eventId/aggregate/version/time/source.
 *  - Out-of-order/correction/duplicate semantics + watermark.
 *  - Creation events phân biệt:
 *    - submittedBy (actor thực hiện submit)
 *    - executingActor (actor thực hiện execution/runtime)
 *    - creditedCreator (attribute ghi nhận credit — KHÔNG nhầm với actor)
 *    - source (system/runtime đã tạo event)
 *    - thiếu review/attribution nguồn thì trả `unavailable`, KHÔNG suy
 *      đoán.
 *  - Marker/forbidden-list KHÔNG tự chứng minh AC được enforce.
 */
import { z } from 'zod';
import { SCHEMA_VERSION } from '../enums.js';
import {
  ActorSchema,
  CanonicalIdSchema,
  CommandIdSchema,
  ConnectionIdSchema,
  CorrelationIdSchema,
  ExpectedVersionSchema,
  IsoTimestampSchema,
  OrganizationIdSchema,
  ProviderNameSchema,
  SchemaVersionSchema,
} from '../primitives.js';

/* ───────────────────────────────────────────────────────────────────────────
 * Aggregate type allowlist — wire enum (gate 0 scope).
 *
 * Schema bind shape: aggregateType ∈ allowlist; runtime HRP gate quyết
 * full taxonomy (Backlog §0.4). Owner chỉ thị rev 2: aggregate type +
 * transition matrix chưa chốt đầy đủ — schema bind literal theo AC.
 * ─────────────────────────────────────────────────────────────────────────── */
export const EVENT_AGGREGATE_TYPES = [
  'LABOR_PROFILE',
  'PLACEMENT_CASE',
  'NEXT_ACTION',
  'INTERACTION',
  'EXTERNAL_CONTACT_LINK',
  'CONVERSATION_LINK',
  'SUPPRESSION',
  'AVAILABILITY',
  'OUTBOX_DELIVERY',
  'MAPPING',
] as const;
export type EventAggregateType =
  (typeof EVENT_AGGREGATE_TYPES)[number];
export const EventAggregateTypeSchema = z.enum(EVENT_AGGREGATE_TYPES);

/* ───────────────────────────────────────────────────────────────────────────
 * Event envelope — HRP-side emit event sau HRP transaction.
 *
 * Schema bind shape CONFIRMED:
 *  - organizationId, eventId, aggregateType/id/version.
 *  - schemaVersion, occurredAt, recordedAt, correlationId.
 *  - sourceCommandId (audit, optional cho system events).
 *  - sourceSystem (system đã emit).
 *  - payload (opaque; server-bind schema theo aggregateType — runtime
 *    gate quyết schema per event).
 *
 * PROPOSED (Owner chốt):
 *  - delivery routing (push webhook vs claim-ack) — runtime gate chọn
 *    1 đường mặc định (đề xuất PUSH_WEBHOOK). Push/claim-ack KHÔNG xử
 *    lý cùng intent thiếu authority/dedupe.
 *  - signature provider protocol cho outbound event signing — KHÔNG tự
 *    chọn protocol chưa xác minh; đây là shared contracts, cần Auditor
 *    kiểm ở bundle cuối.
 * ─────────────────────────────────────────────────────────────────────────── */
export const EventEnvelopeSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    /** Server-set canonical event id (opaque). */
    eventId: z.string().min(8).max(128),
    eventType: z.string().min(1).max(128),
    aggregateType: EventAggregateTypeSchema,
    /** Canonical aggregate id (opaque). */
    aggregateId: CanonicalIdSchema,
    /** Monotonic aggregate version (server-set). */
    aggregateVersion: ExpectedVersionSchema,
    /** Caller-supplied timestamp when event occurred. */
    occurredAt: IsoTimestampSchema,
    /** Server-set timestamp when event was recorded. */
    recordedAt: IsoTimestampSchema,
    correlationId: CorrelationIdSchema.optional(),
    sourceCommandId: CommandIdSchema.optional(),
    /** Source system emit event (HRP_ENGAGEMENT, INTEGRATION, ...). */
    sourceSystem: z.enum([
      'HRP_ENGAGEMENT',
      'INTEGRATION',
      'HRP_INTERNAL',
      'PROVIDER',
      'SYSTEM',
    ]),
    /**
     * Delivery routing marker — runtime HRP gate chọn:
     *  - PUSH_WEBHOOK: HRP-side dispatcher đẩy webhook.
     *  - PULL_CLAIM_ACK: CRM claim lease qua API; fallback khi webhook
     *    không khả dụng.
     * KHÔNG xử lý cùng intent thiếu authority/dedupe — channel là
     * property của intent, runtime gate quyết runtime.
     */
    deliveryChannel: z
      .enum(['PUSH_WEBHOOK', 'PULL_CLAIM_ACK'])
      .default('PUSH_WEBHOOK'),
    /** Connection scope (provider + connection id). */
    deliveryScope: z
      .object({
        provider: ProviderNameSchema.optional(),
        connectionId: ConnectionIdSchema.optional(),
      })
      .strict()
      .optional(),
    /** Opaque payload; runtime gate bind schema per eventType. */
    payload: z.unknown(),
    /**
     * Correction marker — nếu true, event là correction của event trước
     * (audit, KHÔNG tự override previous). Schema bind, runtime gate
     * chốt deduplication + sequence.
     */
    isCorrection: z.boolean().default(false),
    /**
     * Watermark — server-set cho ordering/replay recovery. Schema bind
     * shape; runtime gate quyết retention.
     */
    watermark: z.string().min(1).max(256).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (
      val.sourceSystem === 'PROVIDER' &&
      !val.deliveryScope?.provider
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'PROVIDER source yêu cầu provider trong deliveryScope',
        path: ['deliveryScope', 'provider'],
      });
    }
    // recordedAt >= occurredAt không enforce (nếu sau commit, có thể
    // nhỏ hơn occurredAt cho batch retry). Runtime HRP gate chốt rule.
  });
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * Duplicate / out-of-order / correction semantics.
 *
 * Schema bind shape:
 *  - Duplicate: cùng (organizationId, eventId) trong window retention
 *    → DEDUPE theo provider reconciliation policy.
 *  - Out-of-order: aggregateVersion < current aggregateVersion → event
 *    là correction hoặc replay; KHÔNG apply mutation mới.
 *  - Correction: isCorrection=true, aggregateVersion > previous.version
 *    → event ghi đè nhưng KHÔNG xóa lịch sử; CRM apply reverse mapping.
 *
 * PROPOSED (Owner chốt): retention window, replay semantics, gap
 * reconciliation — runtime HRP gate.
 * ─────────────────────────────────────────────────────────────────────────── */
export const EventDuplicateKindSchema = z.enum([
  'DEDUPE',
  'OUT_OF_ORDER',
  'CORRECTION',
  'GAP',
  'UNKNOWN',
]);

export const EventReceiptSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    eventId: z.string().min(8).max(128),
    /** Provider payload hash (server-set, SHA-256 hex). */
    payloadDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/u, 'payloadDigest phải SHA-256 hex 64 ký tự'),
    duplicateKind: EventDuplicateKindSchema,
    /**
     * `resolvedAt` — server-set. Nếu gap, có thể trả null + reasonCode.
     */
    resolvedAt: IsoTimestampSchema.optional(),
    reasonCode: z.string().min(1).max(64).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.duplicateKind === 'GAP' && !val.reasonCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'GAP duplicate kind yêu cầu reasonCode',
        path: ['reasonCode'],
      });
    }
    if (
      (val.duplicateKind === 'DEDUPE' || val.duplicateKind === 'UNKNOWN') &&
      val.reasonCode
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${val.duplicateKind} KHÔNG có reasonCode (chỉ GAP/CORRECTION/OUT_OF_ORDER)`,
        path: ['reasonCode'],
      });
    }
  });

/* ───────────────────────────────────────────────────────────────────────────
 * Watermark — server-set monotonic cursor.
 *
 * PROPOSED: format/runtime chốt; schema bind opaque string.
 * ─────────────────────────────────────────────────────────────────────────── */
export const EventWatermarkSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    /** Aggregate version cuối. */
    aggregateVersion: ExpectedVersionSchema,
    /** Server-set timestamp watermark. */
    watermarkAt: IsoTimestampSchema,
    opaqueCursor: z.string().min(1).max(256),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * Creation event sources — DTO phân biệt các actor/source/attribution.
 *
 * Owner chỉ thị rev 2:
 *  - Creation events phân biệt:
 *    - submittedBy: actor thực hiện submit (form/UI submit).
 *    - executingActor: actor thực hiện execution/runtime (có thể là
 *      SERVICE hoặc DELEGATED_USER từ automation).
 *    - creditedCreator: attribution cho credit/analytics (KHÁC actor).
 *    - source: system runtime đã tạo event (HRP_ENGAGEMENT, ...).
 *  - Thiếu review/attribution source → trả `unavailable`, KHÔNG đoán.
 * ─────────────────────────────────────────────────────────────────────────── */
export const AttributionStateSchema = z.enum([
  /**
   * Source/attribution có sẵn, audit được.
   */
  'AVAILABLE',
  /**
   * Source/attribution CHƯA có — KHÔNG đoán, trả `unavailable` để caller
   * biết thiếu thông tin.
   */
  'UNAVAILABLE',
]);

export const CreationActorAttributionSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    /** submittedBy — actor thực hiện submit. */
    submittedBy: ActorSchema.optional(),
    /** executingActor — actor thực hiện execution (có thể khác). */
    executingActor: ActorSchema.optional(),
    /** creditedCreator — attribution cho credit (KHÁC actor). */
    creditedCreator: ActorSchema.optional(),
    /** source — system runtime đã tạo event. */
    source: z.enum([
      'HRP_ENGAGEMENT',
      'INTEGRATION',
      'HRP_INTERNAL',
      'PROVIDER',
      'SYSTEM',
    ]),
    /** Trạng thái attribution tổng quát — AVAILABLE hoặc UNAVAILABLE. */
    attributionState: AttributionStateSchema,
    /**
     * Reason nếu UNAVAILABLE — KHÔNG đoán, chỉ note lý do thiếu.
     */
    unavailableReasonCode: z.string().min(1).max(64).optional(),
    /**
     * Source review — nếu creation cần review; runtime HRP gate chốt
     * marker review (Master §9).
     */
    reviewReference: z.string().min(1).max(128).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.attributionState === 'UNAVAILABLE' && !val.unavailableReasonCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'UNAVAILABLE attribution yêu cầu unavailableReasonCode (KHÔNG đoán)',
        path: ['unavailableReasonCode'],
      });
    }
    if (val.attributionState === 'AVAILABLE' && val.unavailableReasonCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'AVAILABLE KHÔNG có unavailableReasonCode',
        path: ['unavailableReasonCode'],
      });
    }
    // creditedCreator KHÁC executingActor — schema không enforce equal/diff
    // (runtime HRP gate quyết rule; schema chỉ bind shape distinct fields).
  });

/* ───────────────────────────────────────────────────────────────────────────
 * Profile/Case creation events — typed creation event envelope.
 *
 * Schema bind shape:
 *  - LaborProfileCreated / LaborProfileApplied / CaseOpened / CaseClosed
 *  - 3 label tách biệt (Backlog §0.3b + Owner rev 2): SUBMITTED/APPLIED/
 *    HRP_REVIEWED (proposed cho future review workflow).
 * ─────────────────────────────────────────────────────────────────────────── */
export const CreationEventLabelSchema = z.enum([
  'SUBMITTED',
  'APPLIED',
  'HRP_REVIEWED',
]);

export const ProfileCreationEventSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    envelope: EventEnvelopeSchema,
    /** Required attribution phân biệt submittedBy/executingActor/creditedCreator. */
    attribution: CreationActorAttributionSchema,
    laborProfileId: CanonicalIdSchema,
    laborProfileVersion: ExpectedVersionSchema,
    /** Creation event label — schema marker (Owner rev 2 AC). */
    creationLabel: CreationEventLabelSchema,
    /** Optional: review reference nếu có. */
    reviewReference: z.string().min(1).max(128).optional(),
  })
  .strict();

export const PlacementCaseCreationEventSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    envelope: EventEnvelopeSchema,
    attribution: CreationActorAttributionSchema,
    placementCaseId: CanonicalIdSchema,
    placementCaseVersion: ExpectedVersionSchema,
    creationLabel: CreationEventLabelSchema,
    reviewReference: z.string().min(1).max(128).optional(),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * Events forbidden fields — marker audit.
 *
 * Owner chỉ thị rev 2:
 *  - "Marker/forbidden-list không tự chứng minh AC được enforce".
 *  - Signature provider protocol chưa xác minh — KHÔNG tự chọn; đây là
 *    shared contracts, cần Auditor kiểm ở bundle cuối.
 * ─────────────────────────────────────────────────────────────────────────── */
export const EVENT_PATCH_FORBIDDEN = Object.freeze([
  // KHÔNG sửa event trước.
  'modifyPastEvent',
  'rewriteAggregateVersion',
  // KHÔNG suy diễn actor.
  'assumeSubmittedBy',
  'assumeExecutingActor',
  'assumeCreditedCreator',
  'fillActorFromAssignee',
  // KHÔNG đoán attribution.
  'assumeAttribution',
  'assumeReviewer',
  // KHÔNG xử lý cùng intent thiếu authority/dedupe qua 2 channel.
  'dualChannelWithoutFencing',
  'dualChannelWithoutDedupe',
  // Signature provider protocol — KHÔNG tự chọn chưa xác minh.
  'useUnverifiedSignatureProtocol',
  'useUnverifiedJwtAlgorithm',
  'useUnverifiedWebhookAlgorithm',
  // KHÔNG cho phép out-of-order rewrite canonical.
  'rewriteCanonicalOnOutOfOrder',
  'overrideCorrectionWithStale',
  // KHÔNG cho phép gap → silent overwrite.
  'silentlyOverwriteOnGap',
  'dropGap',
  // KHÔNG cho phép dedupe bypass.
  'bypassDedup',
  'bypassEventId',
  'bypassReplayRetention',
] as const);

export { SCHEMA_VERSION };
