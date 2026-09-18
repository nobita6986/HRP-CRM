/**
 * interactions.ts — recordTalentInteraction / recordClientInteraction DTOs.
 *
 * Ràng buộc (Backlog §Task 0.3d, Master §10.3.2, §10.7):
 *  - Talent interaction gắn với LaborProfile canonical (id opaque).
 *  - Client interaction có context riêng (Client domain); thiếu input ghi
 *    UNKNOWN.
 *  - Strict payload, summary giới hạn, KHÔNG transcript/attachment bytes/
 *    raw URL; KHÔNG arbitrary fields.
 *  - Phân biệt:
 *     + occurredAt    : thời điểm thực tế tương tác xảy ra (canonical).
 *     + effectiveAt   : thời điểm HRP ghi nhận có hiệu lực (server-set).
 *     + recordedAt    : thời điểm HRP system ghi vào store (server-set).
 *    Client set occurredAt; effectiveAt/recordedAt do server-set.
 *  - Actor là CLAIM — runtime HRP gate xác minh auth/delegation; schema
 *    KHÔNG coi actor là bằng chứng đã xác thực.
 *  - Assignee KHÔNG phải actor. Actor là claim người thực hiện; assignee
 *    là field riêng, có thể không trùng actor.
 */
import { z } from 'zod';
import {
  ActorSchema,
  CanonicalIdSchema,
  ConnectionIdSchema,
  CommandSourceSchema,
  IntegrationCommandSourceSchema,
  HrpUiCommandSourceSchema,
  OrganizationIdSchema,
} from '../primitives.js';
import { CommandEvidenceRefSchema } from './evidence.js';
import { IntakeContextRefSchema } from './intake.js';

/* ───────────────────────────────────────────────────────────────────────────
 * InteractionKind — phân biệt loại tương tác.
 * Theo Master §10.3.2, các kind đã chốt; runtime HRP gate có thể extend.
 * ─────────────────────────────────────────────────────────────────────────── */
export const INTERACTION_KINDS = [
  'PLACEMENT_PROGRESS',
  'FOLLOWUP',
  'NOTE',
  'CLIENT_OUTREACH',
  'TALENT_OUTREACH',
] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];
export const InteractionKindSchema = z.enum(INTERACTION_KINDS);

/* ───────────────────────────────────────────────────────────────────────────
 * InteractionOutcome — kết quả của tương tác.
 * ─────────────────────────────────────────────────────────────────────────── */
export const INTERACTION_OUTCOMES = [
  'POSITIVE',
  'NEUTRAL',
  'NEGATIVE',
  'PENDING',
  'UNKNOWN',
] as const;
export type InteractionOutcome = (typeof INTERACTION_OUTCOMES)[number];
export const InteractionOutcomeSchema = z.enum(INTERACTION_OUTCOMES);

/* ───────────────────────────────────────────────────────────────────────────
 * InteractionContextRef — tham chiếu conversation/message/connection.
 *
 * F2 (Auditor findings, Owner chỉ thị G0/0.8): source discriminator dùng
 * `CommandSourceSchema` từ primitives (HRP_UI vs INTEGRATION), đồng bộ
 * với primitives/envelope shape.
 *  - HRP_UI source KHÔNG có connectionId (CommandSourceSchema enforce
 *    `connectionId: null`).
 *  - INTEGRATION source bắt buộc connectionId (CommandSourceSchema enforce
 *    `ConnectionIdSchema`).
 *  - `externalConversationId` / `externalAccountId` / `externalMessageId`
 *    chỉ áp dụng khi source là INTEGRATION; HRP_UI không cần.
 *
 * Schema KHÔNG ràng buộc cứng actor vs assignee; runtime xác minh.
 * ─────────────────────────────────────────────────────────────────────────── */
export const InteractionContextRefSchema = z
  .object({
    source: CommandSourceSchema,
    externalConversationId: z.string().min(1).max(256).optional(),
    externalAccountId: z.string().min(1).max(128).optional(),
    externalMessageId: z.string().min(1).max(256).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.source.kind === 'HRP_UI') {
      if (val.externalConversationId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'externalConversationId không hợp lệ với HRP_UI source',
          path: ['externalConversationId'],
        });
      }
      if (val.externalAccountId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'externalAccountId không hợp lệ với HRP_UI source',
          path: ['externalAccountId'],
        });
      }
      if (val.externalMessageId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'externalMessageId không hợp lệ với HRP_UI source',
          path: ['externalMessageId'],
        });
      }
    }
  });
export type InteractionContextRef = z.infer<typeof InteractionContextRefSchema>;

/**
 * Re-export các source schema phụ thuộc để test/audit dễ gọi.
 * KHÔNG dùng để bypass CommandSourceSchema.
 */
export { CommandSourceSchema, IntegrationCommandSourceSchema, HrpUiCommandSourceSchema };

/* ───────────────────────────────────────────────────────────────────────────
 * InteractionAssigneeRef — assignee riêng với actor.
 * Actor là người thực hiện; assignee có thể là người nhận followup.
 * KHÔNG đồng nhất actor === assignee.
 * ─────────────────────────────────────────────────────────────────────────── */
export const InteractionAssigneeRefSchema = z
  .object({
    userId: z.string().min(1).max(128),
    /** Optional: scope/role id. */
    scopeId: z.string().min(1).max(64).optional(),
    /** Optional: next-action deadline cho assignee. */
    dueAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type InteractionAssigneeRef = z.infer<
  typeof InteractionAssigneeRefSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * RecordTalentInteraction — input payload.
 *  - laborProfileId: opaque canonical target.
 *  - actor: claim, runtime xác minh.
 *  - assignee: optional, riêng actor.
 *  - occurredAt: client-set; effectiveAt/recordedAt do server-set.
 *  - summary: ≤ 500 chars, KHÔNG transcript/URL/attachment.
 *  - evidenceRefs: optional (vd: chụp ảnh trạng thái, đính kèm).
 * ─────────────────────────────────────────────────────────────────────────── */
export const RecordTalentInteractionInputSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    laborProfileId: CanonicalIdSchema,
    kind: InteractionKindSchema,
    outcome: InteractionOutcomeSchema,
    context: InteractionContextRefSchema,
    /** Client-set: thời điểm tương tác thực tế xảy ra. */
    occurredAt: z.string().datetime({ offset: true }),
    /** Optional: assignee cho followup; runtime KHÔNG đồng nhất với actor. */
    assignee: InteractionAssigneeRefSchema.optional(),
    /** Optional: short summary (≤500 chars), KHÔNG transcript/URL/attachment. */
    summary: z.string().min(1).max(500).optional(),
    /** Optional: evidence refs. */
    evidenceRefs: z.array(CommandEvidenceRefSchema).max(8).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.summary) {
      if (/data:|base64,|https?:\/\//u.test(val.summary)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'summary không được chứa URL/base64/data URI',
          path: ['summary'],
        });
      }
    }
  });

export type RecordTalentInteractionInput = z.infer<
  typeof RecordTalentInteractionInputSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * RecordClientInteraction — input payload.
 * Client domain riêng với Talent:
 *  - clientReferenceId: opaque id cho Client (thiếu schema chi tiết — ghi
 *    UNKNOWN ở Backlog §0.3d; runtime HRP gate resolve canonical).
 *  - Client required context (Master §10.7) chưa chốt — schema cho phép
 *    optional reference; runtime enforce.
 * ─────────────────────────────────────────────────────────────────────────── */
export const RecordClientInteractionInputSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    /** Client reference id — runtime HRP resolve canonical Client ID. */
    clientReferenceId: z.string().min(1).max(256),
    kind: InteractionKindSchema,
    outcome: InteractionOutcomeSchema,
    context: InteractionContextRefSchema,
    occurredAt: z.string().datetime({ offset: true }),
    /** Optional assignee. */
    assignee: InteractionAssigneeRefSchema.optional(),
    /** Optional summary. */
    summary: z.string().min(1).max(500).optional(),
    evidenceRefs: z.array(CommandEvidenceRefSchema).max(8).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.summary) {
      if (/data:|base64,|https?:\/\//u.test(val.summary)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'summary không được chứa URL/base64/data URI',
          path: ['summary'],
        });
      }
    }
  });

export type RecordClientInteractionInput = z.infer<
  typeof RecordClientInteractionInputSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * InteractionTimestamps — phân biệt 3 timestamp semantics.
 *  - occurredAt: client-set, thời điểm thực tế tương tác xảy ra.
 *  - effectiveAt: server-set, thời điểm HRP ghi nhận có hiệu lực
 *    (vd: sau khi đối soát xong).
 *  - recordedAt: server-set, thời điểm record được persist vào store.
 *
 * Lưu ý: baseline CHƯA CHỐT rule order (occurredAt ≤ effectiveAt ≤
 * recordedAt). Schema chỉ validate ISO 8601 datetime format cho cả 3
 * field; runtime HRP gate có thể enforce order khi domain decision
 * xong. Đây là semantic design ghi trong doc, KHÔNG phải invariant
 * đã chốt. (xem Q-22)
 * ─────────────────────────────────────────────────────────────────────────── */
export const InteractionTimestampsSchema = z
  .object({
    occurredAt: z.string().datetime({ offset: true }),
    effectiveAt: z.string().datetime({ offset: true }),
    recordedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type InteractionTimestamps = z.infer<
  typeof InteractionTimestampsSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * Kết quả recordTalentInteraction / recordClientInteraction.
 * Server trả timestamps + interactionId opaque.
 * ─────────────────────────────────────────────────────────────────────────── */
export const RecordInteractionResultSchema = z
  .object({
    interactionId: z.string().min(1).max(128),
    timestamps: InteractionTimestampsSchema,
  })
  .strict();
export type RecordInteractionResult = z.infer<
  typeof RecordInteractionResultSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * Marker constants:
 *  - INTERACTION_PAYLOAD_FORBIDDEN_FIELDS: field cấm trong summary +
 *    payload (transcript/attachment bytes/rawUrl/arbitrary).
 * ─────────────────────────────────────────────────────────────────────────── */
export const INTERACTION_PAYLOAD_FORBIDDEN_FIELDS = Object.freeze([
  'transcript',
  'rawTranscript',
  'message',
  'rawMessage',
  'attachment',
  'attachments',
  'base64',
  'dataUri',
  'rawUrl',
  'publicUrl',
  'signedUrl',
  'arbitraryPatch',
  'noteInternal',
  'currentRelationship',
] as const);
