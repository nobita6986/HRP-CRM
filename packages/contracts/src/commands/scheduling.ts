/**
 * scheduling.ts — Planning batch DTO (Gate 0 / 0.3f).
 *
 * Nguồn: Master-Plan.V2.6.md §10.6.4 + §13.10.3 + Backlog Gate0 §0.3f.
 *
 * Trọng tâm (Backlog §0.3f AC):
 *  - DTO planning batch có per-item outcome, không báo all success khi một
 *    mục lỗi.
 *
 * Lưu ý:
 *  - Scheduling CHỈ là contracts/fixtures; chưa triển khai scheduler.
 *  - Planning batch gọi runtime HRP gate (SchedulerPort xem Master §7.1).
 *  - Schema bind shape; runtime gate thực thi per-item effect và report
 *    per-item outcome.
 */
import { z } from 'zod';
import { SCHEMA_VERSION } from '../enums.js';
import {
  CanonicalIdSchema,
  ExpectedVersionSchema,
  OrganizationIdSchema,
  SchemaVersionSchema,
  CalendarDateSchema,
} from '../primitives.js';
import { OperationReferenceSchema } from '../envelopes.js';
import { IntakeContextRefSchema } from './intake.js';
import { NextActionScheduleSchema } from './next-action.js';

/**
 * PlanningBatchItemKind — loại item trong batch.
 *  - NEXT_ACTION: tạo/cập nhật NextAction.
 *  - AVAILABILITY: cập nhật availability (xem availability.ts).
 *  - SUPPRESSION: commit suppression (xem suppression.ts).
 *
 * Mỗi item có input riêng; schema bind shape, runtime gate quyết effect.
 */
export const PLANNING_BATCH_ITEM_KINDS = [
  'NEXT_ACTION',
  'AVAILABILITY',
  'SUPPRESSION',
] as const;
export type PlanningBatchItemKind =
  (typeof PLANNING_BATCH_ITEM_KINDS)[number];
export const PlanningBatchItemKindSchema = z.enum(
  PLANNING_BATCH_ITEM_KINDS,
);

/**
 * PlanningBatchItemOutcome — per-item outcome enum.
 * Backlog §0.3f AC: "không báo all success khi một mục lỗi".
 *
 *  - APPLIED: item đã apply.
 *  - ACCEPTED: durable accepted, cần query sau (xem envelopes.ts).
 *  - FAILED: lỗi có structured error, không apply.
 *  - SKIPPED: bị skip do precondition (vd: target đã ở state mong muốn).
 *
 * Schema không tự ý aggregate thành "all success"; runtime gate trả
 * per-item outcome + tổng kết (success/partial/all-failed).
 */
export const PLANNING_BATCH_ITEM_OUTCOMES = [
  'APPLIED',
  'ACCEPTED',
  'FAILED',
  'SKIPPED',
] as const;
export type PlanningBatchItemOutcome =
  (typeof PLANNING_BATCH_ITEM_OUTCOMES)[number];
export const PlanningBatchItemOutcomeSchema = z.enum(
  PLANNING_BATCH_ITEM_OUTCOMES,
);

/**
 * PlanningBatchItem — một item trong batch.
 *
 * `itemId` opaque dùng để correlate input ↔ output khi trộn thứ tự.
 * Schema KHÔNG đảm bảo runtime giữ thứ tự; server có thể reorder.
 *
 * `inputKind` quyết định shape của `input`. Schema dùng
 * `z.discriminatedUnion` để validate theo kind.
 *
 * Patch cho từng kind được giới hạn:
 *  - NEXT_ACTION: schedule + intentSummary (minimal subset).
 *  - AVAILABILITY: availability + availableFromDate.
 *  - SUPPRESSION: target + reason.
 *
 * CHƯA đầy đủ — runtime gate forward đến command chính thức
 * (createNextAction, updateLaborAvailability, commitSuppression) với
 * full validation; schema chỉ bind shape cơ bản để gate batch.
 */
export const PlanningBatchNextActionItemSchema = z
  .object({
    itemKind: z.literal('NEXT_ACTION'),
    itemId: z.string().min(1).max(64),
    organizationId: OrganizationIdSchema,
    targetActionId: CanonicalIdSchema.optional(),
    targetExpectedVersion: ExpectedVersionSchema.optional(),
    schedule: NextActionScheduleSchema,
    intentSummary: z.string().min(1).max(500).optional(),
  })
  .strict();

export const PlanningBatchAvailabilityItemSchema = z
  .object({
    itemKind: z.literal('AVAILABILITY'),
    itemId: z.string().min(1).max(64),
    organizationId: OrganizationIdSchema,
    laborProfileId: CanonicalIdSchema,
    expectedVersion: ExpectedVersionSchema,
    availability: z.enum([
      'AVAILABLE_NOW',
      'AVAILABLE_FROM_DATE',
      'NOT_AVAILABLE',
      'UNKNOWN',
      // DO_NOT_CONTACT không đi qua planning batch thường — cần
      // command riêng (suppression.ts) để ghi suppression event
      // đúng transaction. Schema từ chối để tránh bypass.
    ]),
    availableFromDate: CalendarDateSchema.optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.availability === 'AVAILABLE_FROM_DATE' && !val.availableFromDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'AVAILABLE_FROM_DATE yêu cầu availableFromDate',
        path: ['availableFromDate'],
      });
    }
    if (val.availability !== 'AVAILABLE_FROM_DATE' && val.availableFromDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'availableFromDate chỉ hợp lệ khi availability = AVAILABLE_FROM_DATE',
        path: ['availableFromDate'],
      });
    }
  });

export const PlanningBatchSuppressionItemSchema = z
  .object({
    itemKind: z.literal('SUPPRESSION'),
    itemId: z.string().min(1).max(64),
    organizationId: OrganizationIdSchema,
    /**
     * External contact reference cho safety suppression (không tạo
     * LaborProfile). Runtime HRP gate forward đến commitSuppression.
     */
    externalContact: z
      .object({
        provider: z.enum(['CHATWOOT', 'ZALO_OA']),
        connectionId: z.string().min(1).max(128),
        externalContactId: z.string().min(1).max(256),
      })
      .strict(),
    reason: z.enum([
      'CANDIDATE_REQUEST',
      'PRIVACY_REQUEST',
      'HRP_POLICY',
      'OTHER',
    ]),
  })
  .strict();

export const PlanningBatchItemSchema = z.union([
  PlanningBatchNextActionItemSchema,
  PlanningBatchAvailabilityItemSchema,
  PlanningBatchSuppressionItemSchema,
]);
export type PlanningBatchItem = z.infer<typeof PlanningBatchItemSchema>;

/**
 * PlanningBatchInput — input cho planning batch operation.
 *
 * Schema bind shape; runtime HRP gate forward đến command tương ứng
 * (createNextAction / updateNextAction / updateLaborAvailability /
 * commitSuppression). Schema không tự quyết per-item effect; chỉ đảm
 * bảo mỗi item có shape hợp lệ.
 *
 * `batchId` opaque để dedupe batch (cùng batchId + idempotency key →
 * same result).
 */
export const PlanningBatchInputSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    batchId: z.string().min(8).max(128),
    items: z.array(PlanningBatchItemSchema).min(1).max(500),
    context: IntakeContextRefSchema,
  })
  .strict();
export type PlanningBatchInput = z.infer<typeof PlanningBatchInputSchema>;

/**
 * PlanningBatchItemError — per-item error.
 * Schema KHÔNG auto-aggregate; mỗi item có outcome riêng.
 */
export const PlanningBatchItemErrorSchema = z
  .object({
    itemId: z.string().min(1).max(64),
    errorCode: z.string().min(1).max(128),
    messageKey: z.string().min(1).max(128),
    fieldPath: z.string().min(1).max(256).optional(),
    retryClass: z.enum([
      'NEVER',
      'REVIEW_REQUIRED',
      'REFRESH_AND_REVIEW',
      'REAUTHENTICATE',
      'BOUNDED_SAME_KEY',
      'RECONCILE_FIRST',
    ]),
  })
  .strict();
export type PlanningBatchItemError = z.infer<
  typeof PlanningBatchItemErrorSchema
>;

/**
 * PlanningBatchItemResult — per-item result.
 *
 * `outcome` là wire enum (APPLIED/ACCEPTED/FAILED/SKIPPED); KHÔNG có
 * `ALL_SUCCESS` vì đó là aggregation sai (Backlog §0.3f AC).
 *
 * `error` chỉ có khi outcome = FAILED.
 *
 * Per AC envelope (Owner chỉ thị rev 2): ACCEPTED không mang dấu hiệu
 * APPLIED. ACCEPTED = durable accepted pending (server chỉ reference,
 * chưa applied riêng). APPLIED = đã apply. Schema:
 *  - APPLIED / SKIPPED: `appliedId` + `appliedVersion` optional (apply
 *    ngay thì có; skip vì pre-condition).
 *  - ACCEPTED: `appliedId`/`appliedVersion` KHÔNG có (chỉ `pendingId`
 *    optional cho caller trace; runtime gate cấp).
 *
 * Phân biệt với envelope ACCEPTED response: envelope ACCEPTED chỉ có
 * `operation: OperationReferenceSchema` (xem envelopes.ts), không
 * mang `data`. Per-item ACCEPTED ở đây vẫn ghi nhận item đã được
 * commit durable ở handoff, nhưng CẢNH BÁO rõ: KHÔNG đồng nghĩa
 * APPLIED.
 */
export const PlanningBatchItemResultSchema = z
  .object({
    itemId: z.string().min(1).max(64),
    itemKind: PlanningBatchItemKindSchema,
    outcome: PlanningBatchItemOutcomeSchema,
    /**
     * Reference kết quả apply: chỉ set khi outcome = APPLIED hoặc SKIPPED
     * (apply ngay hoặc skip nhưng vẫn có target canonical). ACCEPTED
     * KHÔNG set (server sẽ cấp riêng qua envelope ACCEPTED sau).
     */
    appliedId: CanonicalIdSchema.optional(),
    appliedVersion: ExpectedVersionSchema.optional(),
    /**
     * Pending reference cho ACCEPTED outcome (canonical OperationReference).
     * Schema bind canonical OperationReference (kind = COMMAND_OPERATION +
     * operationId) — caller có thể gọi envelope OperationQuery với
     * operationId để poll result. KHÔNG opaque string để chống nhầm.
     * (Q-32: hoàn thiện contract ACCEPTED có reference/query semantics
     * thuộc Gate 0; implementation query API chỉ để sau.)
     */
    pendingReference: OperationReferenceSchema.optional(),
    error: PlanningBatchItemErrorSchema.optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.outcome === 'FAILED' && !val.error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'FAILED outcome phải có error',
        path: ['error'],
      });
    }
    if (val.outcome !== 'FAILED' && val.error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Chỉ FAILED outcome mới có error',
        path: ['error'],
      });
    }
    // APPLIED: appliedId bắt buộc.
    if (val.outcome === 'APPLIED' && !val.appliedId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'APPLIED outcome phải có appliedId',
        path: ['appliedId'],
      });
    }
    // ACCEPTED: KHÔNG có appliedId (per Owner rev 2 chỉ thị — ACCEPTED
    // không mang dấu hiệu APPLIED). Có thể có pendingReference để trace.
    if (val.outcome === 'ACCEPTED' && val.appliedId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'ACCEPTED outcome KHÔNG có appliedId (chỉ pendingReference; xem envelope ACCEPTED)',
        path: ['appliedId'],
      });
    }
    if (val.outcome === 'ACCEPTED' && val.appliedVersion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ACCEPTED outcome KHÔNG có appliedVersion',
        path: ['appliedVersion'],
      });
    }
    // FAILED/SKIPPED: KHÔNG có pendingReference.
    if (
      (val.outcome === 'FAILED' || val.outcome === 'SKIPPED') &&
      val.pendingReference
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${val.outcome} outcome KHÔNG có pendingReference`,
        path: ['pendingReference'],
      });
    }
    // APPLIED: KHÔNG có pendingReference (đã apply ngay).
    if (val.outcome === 'APPLIED' && val.pendingReference) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'APPLIED outcome KHÔNG có pendingReference (đã apply ngay)',
        path: ['pendingReference'],
      });
    }
  });
export type PlanningBatchItemResult = z.infer<
  typeof PlanningBatchItemResultSchema
>;

/**
 * PlanningBatchSummary — tổng kết batch (đếm per-item outcome).
 *
 * Schema KHÔNG có field "allSuccess: boolean". Caller đọc per-item
 * outcome để quyết định success hay partial hay all-failed.
 */
export const PlanningBatchSummarySchema = z
  .object({
    totalItems: z.number().int().nonnegative(),
    appliedCount: z.number().int().nonnegative(),
    acceptedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const sum =
      val.appliedCount +
      val.acceptedCount +
      val.failedCount +
      val.skippedCount;
    if (sum !== val.totalItems) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Tổng applied/accepted/failed/skipped (${sum}) phải = totalItems (${val.totalItems})`,
        path: ['totalItems'],
      });
    }
  });
export type PlanningBatchSummary = z.infer<
  typeof PlanningBatchSummarySchema
>;

/**
 * PlanningBatchResult — server response.
 *
 * `items` là per-item result theo thứ tự runtime có thể đã reorder.
 * `summary` là tổng kết đếm outcome.
 *
 * Backlog §0.3f AC bảo đảm: không có field "allSuccess" / "success"
 * chung; caller phải đọc per-item + summary.
 */
export const PlanningBatchResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    batchId: z.string().min(8).max(128),
    items: z.array(PlanningBatchItemResultSchema),
    summary: PlanningBatchSummarySchema,
    completedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.items.length !== val.summary.totalItems) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'items.length phải = summary.totalItems (per-item outcome)',
        path: ['items'],
      });
    }
  });
export type PlanningBatchResult = z.infer<typeof PlanningBatchResultSchema>;

/**
 * Re-export SCHEMA_VERSION để package dùng nhất quán.
 */
export { SCHEMA_VERSION };
