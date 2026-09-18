/**
 * next-action.ts — NextAction create/update DTO (Gate 0 / 0.3f).
 *
 * Nguồn: Master-Plan.V2.6.md §7.2 + §10.6 + §10.7.3 + Backlog Gate0 §0.3f.
 *
 * Trọng tâm (Backlog §0.3f AC):
 *  - Define create/update intent rõ: target context, actionId khi update,
 *    expectedVersion khi sửa, OPEN/DONE/CANCELLED, due/scheduled time và
 *    timezone.
 *  - Runtime transition và target ownership thuộc HRP, không suy ra chỉ
 *    vì schema pass.
 *  - Snooze/dismiss notification khác DONE; schedule revision/occurrence có
 *    key cho dedupe reminder.
 *
 * Trục riêng (Master §10.6.4): NextAction KHÔNG đổi Handling, KHÔNG đổi
 * stage, KHÔNG đổi CurrentRelationship. Đổi lịch NextAction KHÔNG tự đổi
 * Handling (Master §7.2).
 */
import { z } from 'zod';
import {
  NEXT_ACTION_STATUSES,
  NextActionStatusSchema,
  SCHEMA_VERSION,
} from '../enums.js';
import {
  CanonicalIdSchema,
  ExpectedVersionSchema,
  OrganizationIdSchema,
  SchemaVersionSchema,
} from '../primitives.js';
import { IntakeContextRefSchema } from './intake.js';

/**
 * NextActionKind — phân biệt create vs update intent.
 * Tương ứng AC: "Define create/update intent rõ".
 *
 *  - CREATE: tạo mới; input KHÔNG có actionId, có target context + intent.
 *  - UPDATE: cập nhật; input CÓ actionId + expectedVersion (optimistic
 *    concurrency), patch whitelist.
 */
export const NEXT_ACTION_KINDS = ['CREATE', 'UPDATE'] as const;
export type NextActionKind = (typeof NEXT_ACTION_KINDS)[number];
export const NextActionKindSchema = z.enum(NEXT_ACTION_KINDS);

/**
 * NextActionTargetKind — đích của action (Talent case / Client opportunity /
 * standalone). Schema bind shape; ownership/runtime HRP gate quyết.
 */
export const NEXT_ACTION_TARGET_KINDS = [
  'PLACEMENT_CASE',
  'CLIENT_OPPORTUNITY',
  'STANDALONE',
] as const;
export type NextActionTargetKind =
  (typeof NEXT_ACTION_TARGET_KINDS)[number];
export const NextActionTargetKindSchema = z.enum(
  NEXT_ACTION_TARGET_KINDS,
);

/**
 * NextActionTargetRef — discriminated union cho target.
 *
 * Mỗi ref có `(kind, targetId, expectedVersion?)`; runtime HRP gate xác
 * minh ownership (không suy ra chỉ vì schema pass).
 */
export const NextActionPlacementCaseTargetRefSchema = z
  .object({
    kind: z.literal('PLACEMENT_CASE'),
    organizationId: OrganizationIdSchema,
    placementCaseId: CanonicalIdSchema,
    expectedVersion: ExpectedVersionSchema,
  })
  .strict();
export const NextActionClientOpportunityTargetRefSchema = z
  .object({
    kind: z.literal('CLIENT_OPPORTUNITY'),
    organizationId: OrganizationIdSchema,
    clientOpportunityId: CanonicalIdSchema,
    /** Client domain contract chưa chốt (xem Q-23) — reference opaque. */
    clientReferenceId: z.string().min(1).max(256),
    expectedVersion: ExpectedVersionSchema,
  })
  .strict();
export const NextActionStandaloneTargetRefSchema = z
  .object({
    kind: z.literal('STANDALONE'),
    organizationId: OrganizationIdSchema,
  })
  .strict();

export const NextActionTargetRefSchema = z.discriminatedUnion('kind', [
  NextActionPlacementCaseTargetRefSchema,
  NextActionClientOpportunityTargetRefSchema,
  NextActionStandaloneTargetRefSchema,
]);
export type NextActionTargetRef = z.infer<typeof NextActionTargetRefSchema>;

/**
 * NextActionSchedule — lịch theo Asia/Ho_Chi_Minh + ISO 8601 with offset.
 *
 * Phân biệt:
 *  - `scheduledAt`: thời điểm reminder/kích hoạt (server-set).
 *  - `dueAt`: deadline (optional, nếu khác scheduledAt).
 *
 * Timezone đã chốt baseline (Master §13.10.3 + Q-15): Asia/Ho_Chi_Minh
 * (UTC+7, không DST). Schema KHÔNG tự so với ngày hiện tại; runtime HRP
 * gate dùng business clock từ context.
 */
export const NextActionScheduleSchema = z
  .object({
    scheduledAt: z.string().datetime({ offset: true }),
    dueAt: z.string().datetime({ offset: true }).optional(),
    timezone: z.literal('Asia/Ho_Chi_Minh'),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.dueAt && new Date(val.dueAt).getTime() < new Date(val.scheduledAt).getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'dueAt phải >= scheduledAt',
        path: ['dueAt'],
      });
    }
  });
export type NextActionSchedule = z.infer<typeof NextActionScheduleSchema>;

/**
 * SnoozeMode — phân biệt 3 trạng thái reminder:
 *
 *  - ACTIVE: reminder hoạt động bình thường.
 *  - SNOOZED: user đã snooze (lùi lịch); runtime HRP gate cấp next
 *    scheduledAt mới và một `snoozeOccurrenceKey` để dedupe.
 *  - DISMISSED: user dismiss; KHÁC DONE (Backlog §0.3f AC: snooze/dismiss
 *    notification khác DONE). Action có thể vẫn OPEN; chỉ reminder bị
 *    suppress cho lần này.
 *
 * Schema KHÔNG coi DISMISSED = DONE. Schema KHÔNG coi SNOOZED = DONE.
 * Cả hai đều phải có key để dedupe reminder.
 */
export const SNOOZE_MODES = ['ACTIVE', 'SNOOZED', 'DISMISSED'] as const;
export type SnoozeMode = (typeof SNOOZE_MODES)[number];
export const SnoozeModeSchema = z.enum(SNOOZE_MODES);

/**
 * CreateNextActionInput — input cho `createNextAction`.
 *
 * AC #1: target context (NextActionTargetRef), actionId KHÔNG có (chưa
 * tạo), expectedVersion KHÔNG áp dụng cho create. OPEN/DONE/CANCELLED
 * status phải explicit (default runtime có thể coi OPEN, nhưng schema
 * yêu cầu caller khai báo để tránh suy diễn).
 */
export const CreateNextActionInputSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    kind: z.literal('CREATE'),
    target: NextActionTargetRefSchema,
    /**
     * Status khởi tạo. Schema cho phép OPEN hoặc CANCELLED (tạo đã
     * biết cancel). KHÔNG cho phép DONE ở create (hành động mới chưa
     * hoàn tất).
     */
    initialStatus: z.enum(['OPEN', 'CANCELLED']),
    intentSummary: z.string().min(1).max(500),
    schedule: NextActionScheduleSchema,
    snoozeMode: SnoozeModeSchema.default('ACTIVE'),
    /** Optional: reference intake submission / draft revision. */
    intakeRevisionId: z.string().min(1).max(128).optional(),
    /** Optional: idempotency key riêng cho staff review đã confirm. */
    confirmationDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/u, 'confirmationDigest phải SHA-256 hex 64 ký tự')
      .optional(),
    context: IntakeContextRefSchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.intentSummary && /https?:\/\//iu.test(val.intentSummary)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'intentSummary không được chứa URL thô',
        path: ['intentSummary'],
      });
    }
  });
export type CreateNextActionInput = z.infer<typeof CreateNextActionInputSchema>;

/**
 * NextActionPatch — whitelist fields cho UPDATE intent.
 *
 * Backlog §0.3f AC: actionId khi update, expectedVersion khi sửa,
 * OPEN/DONE/CANCELLED, due/scheduled time và timezone. Runtime HRP
 * gate quyết transitions (xem Q-16).
 */
export const NextActionPatchSchema = z
  .object({
    intentSummary: z.string().min(1).max(500).optional(),
    schedule: NextActionScheduleSchema.optional(),
    snoozeMode: SnoozeModeSchema.optional(),
    status: NextActionStatusSchema.optional(),
    /** Revision id cho dedupe reminder (xem NextActionRevisionRef). */
    revisionId: z.string().min(1).max(128).optional(),
  })
  .strict();
export type NextActionPatch = z.infer<typeof NextActionPatchSchema>;

/**
 * UpdateNextActionInput — input cho `updateNextAction`.
 *
 * AC #1: actionId + expectedVersion (optimistic concurrency).
 *
 * Runtime HRP gate quyết transitions (OPEN → DONE, OPEN → CANCELLED,
 * snooze/dismiss); schema KHÔNG enforce transitions matrix (Q-16 +
 * Backlog §0.3f).
 */
export const UpdateNextActionInputSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    kind: z.literal('UPDATE'),
    actionId: CanonicalIdSchema,
    expectedVersion: ExpectedVersionSchema,
    patch: NextActionPatchSchema,
    context: IntakeContextRefSchema,
  })
  .strict();
export type UpdateNextActionInput = z.infer<
  typeof UpdateNextActionInputSchema
>;

/**
 * NextActionRevisionRef — schedule revision/occurrence key cho dedupe reminder.
 *
 * Backlog §0.3f AC: "schedule revision/occurrence có key cho dedupe
 * reminder". Mỗi lần scheduler rerun / snooze, server cấp `revisionId`
 * mới; nếu reminder đã được dedupe theo revision cũ, không gửi lại.
 */
export const NextActionRevisionRefSchema = z
  .object({
    revisionId: z.string().min(1).max(128),
    /** Occurrence key cho reminder dedupe (snooze/dismiss rerun). */
    occurrenceKey: z.string().min(1).max(128),
    /** Status hiện tại. */
    status: NextActionStatusSchema,
    /** SnoozeMode hiện tại. */
    snoozeMode: SnoozeModeSchema,
    /** Server-set timestamp của revision này. */
    issuedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type NextActionRevisionRef = z.infer<
  typeof NextActionRevisionRefSchema
>;

/**
 * CreateNextActionResult / UpdateNextActionResult.
 *
 * `appliedRevision` là key dedupe cho lần scheduler/reminder kế tiếp.
 * `appliedStatus` có thể khác initialStatus/patch nếu runtime HRP gate
 * reject/reorder.
 */
export const NextActionResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    actionId: CanonicalIdSchema,
    version: ExpectedVersionSchema,
    appliedStatus: NextActionStatusSchema,
    appliedSnoozeMode: SnoozeModeSchema,
    appliedSchedule: NextActionScheduleSchema,
    appliedRevision: NextActionRevisionRefSchema,
  })
  .strict();
export type NextActionResult = z.infer<typeof NextActionResultSchema>;

/**
 * Forbidden fields cho NextAction mutation.
 *
 * Patch KHÔNG được phép có:
 *  - Handling (Master §7.2: NextAction không đổi Handling).
 *  - PlacementCase stage/status/closeReason (trục riêng).
 *  - CurrentRelationship (read-only projection).
 *  - Actor (đến từ envelope).
 */
export const NEXT_ACTION_PATCH_FORBIDDEN = Object.freeze([
  // Trục Handling — KHÔNG đổi qua NextAction.
  'handlingAssignment',
  'handlingSla',
  'handlingReset',
  // Trục PlacementCase — riêng placement-case.ts.
  'placementCaseId',
  'placementCaseVersion',
  'intendedStage',
  'stage',
  'status_case',
  'closeReason',
  // Projection read-only.
  'currentRelationship',
  // Contact PII — schema khác.
  'phone',
  'email',
  'fullName',
  'cccd',
  // DO_NOT_CONTACT — schema khác.
  'dncReason',
  'dncNote',
  // Actor — đến từ envelope.
  'actor',
  'assigneeAsActor',
] as const);

/**
 * Re-export helper: status có thể có ở runtime gate là `DISMISSED`.
 * Schema dùng NextActionStatusSchema (OPEN/DONE/CANCELLED) cho status
 * chính; SNOOZE/DISMISSED tách ở SnoozeMode. Đây là quyết định design
 * (snooze/dismiss ≠ DONE — Backlog §0.3f).
 */
export const NEXT_ACTION_STATUS_VALUES = NEXT_ACTION_STATUSES;
