/**
 * kpi.ts — KPI contracts (Gate 0 / 0.5).
 *
 * Nguồn: Backlog Gate0 §Task 0.5 + Master V2.6 §13.10.3.
 *
 * Trọng tâm AC (Owner chỉ thị):
 *  - KPI assign/revise manager-owned.
 *  - Sale/AI chỉ read/propose; KHÔNG tự mutate target.
 *  - HRP-owned module chưa xác nhận → tách namespace experimental/version;
 *    không block Gate 0 Phase 9; không production mutation.
 */
import { z } from 'zod';
import { SCHEMA_VERSION } from '../enums.js';
import {
  ActorSchema,
  ExpectedVersionSchema,
  OrganizationIdSchema,
  SchemaVersionSchema,
  CalendarDateSchema,
} from '../primitives.js';

/* ───────────────────────────────────────────────────────────────────────────
 * KPI target type — enum allowlist (Phase 9 + Phase 10 experimental).
 *
 * Schema bind shape CONFIRMED:
 *  - PROFILE_CREATED: đếm profile được tạo.
 *  - PROFILE_UPDATED: đếm profile được cập nhật.
 *  - PROFILE_SUBMITTED: đếm profile được submit (đã qua review).
 *  - CASE_OPENED / CASE_CLOSED.
 *  - CONVERSATIONS_DELIVERED / CONVERSATIONS_REPLIED.
 *  - INTERACTIONS_LOGGED.
 *  - ASSIGNMENTS_COMPLETED.
 *
 * PROPOSED: thêm target mới phải HRP-owned PR + audit.
 *
 * Lưu ý Q-9 (Master §13.10.3): profile created/updated/submitted phải
 * là 3 metric KHÁC NHAU; created không tự đồng nghĩa submitted.
 * ─────────────────────────────────────────────────────────────────────────── */
export const KPI_TARGET_TYPES = [
  'PROFILE_CREATED',
  'PROFILE_UPDATED',
  'PROFILE_SUBMITTED',
  'CASE_OPENED',
  'CASE_CLOSED',
  'INTERACTIONS_LOGGED',
  'CONVERSATIONS_DELIVERED',
  'CONVERSATIONS_REPLIED',
  'ASSIGNMENTS_COMPLETED',
] as const;
export const KPITargetTypeSchema = z.enum(KPI_TARGET_TYPES);

/* ───────────────────────────────────────────────────────────────────────────
 * KPI period — granularity.
 *
 * Schema bind shape CONFIRMED: DAILY / WEEKLY / MONTHLY / QUARTERLY.
 * Runtime HRP gate quyết period anchor (timezone business clock).
 * ─────────────────────────────────────────────────────────────────────────── */
export const KPI_PERIODS = [
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
] as const;
export const KPIPeriodSchema = z.enum(KPI_PERIODS);

/* ───────────────────────────────────────────────────────────────────────────
 * KPI target assignment — DTO assign KPI cho actor/team/role.
 *
 * Schema bind shape CONFIRMED (Backlog §0.5 AC #3):
 *  - manager-only write (runtime gate enforce; schema marker).
 *  - targetActorRole/targetActorId — owner/role.
 *  - targetValue ≥ 0 (count) hoặc rate ∈ [0,1].
 *  - targetVersion — server-set monotonic; revisionId cho dedupe.
 *  - cohort — optional filter (region, source, period anchor).
 *  - attribution source — Phase 9 enum / Phase 10 experimental.
 * ─────────────────────────────────────────────────────────────────────────── */
export const KPIAssignmentInputSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    /** assignmentId opaque (server-set khi tạo). */
    assignmentId: z.string().min(1).max(128).optional(),
    targetType: KPITargetTypeSchema,
    period: KPIPeriodSchema,
    /** Bắt buộc targetValue theo đơn vị count; ≥ 0. */
    targetValue: z.number().nonnegative(),
    /** Optional: rate target (0..1) nếu metric là rate. */
    targetRate: z.number().min(0).max(1).optional(),
    targetActorRole: z.enum(['SALE', 'AI_AGENT', 'STAFF', 'TEAM', 'UNIT']),
    targetActorId: z.string().min(1).max(128).optional(),
    /** Cohort filter — schema bind shape; runtime gate filter. */
    cohort: z
      .object({
        region: z.array(z.string().min(1).max(64)).max(8).optional(),
        source: z.array(z.string().min(1).max(64)).max(8).optional(),
        /** Period anchor — YYYY-MM-DD. */
        periodStart: CalendarDateSchema.optional(),
        periodEnd: CalendarDateSchema.optional(),
      })
      .strict()
      .optional(),
    /** Source/attribution — schema bind; thiếu trả 'unavailable' runtime. */
    attributionSource: z
      .enum(['CHATWOOT', 'ZALO_OA', 'INTERNAL_FORM', 'HRP_UI', 'EXPERIMENTAL'])
      .optional(),
    /**
     * Required actor: manager capability (runtime gate enforce; schema
     * marker Q-30).
     */
    assignedBy: ActorSchema,
    /** Optimistic concurrency cho revise. */
    expectedRevision: ExpectedVersionSchema.optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.targetValue === 0 && val.cohort === undefined) {
      // target=0 + no cohort: cho phép nhưng cảnh báo (audit); schema
      // không reject để cho phép edge case target-zero.
    }
    if (
      val.cohort?.periodStart &&
      val.cohort?.periodEnd &&
      val.cohort.periodStart > val.cohort.periodEnd
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'periodStart phải <= periodEnd',
        path: ['cohort', 'periodStart'],
      });
    }
  });

export const KPIAssignmentResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    assignmentId: z.string().min(1).max(128),
    revisionId: z.string().min(1).max(128),
    /** Server-set applied version. */
    appliedRevision: ExpectedVersionSchema,
    appliedAt: z.string().datetime({ offset: true }),
    /** Optional reference — backend ủy quyền tới gate tương ứng. */
    operationReference: z
      .object({
        kind: z.literal('COMMAND_OPERATION'),
        operationId: z.string().min(8).max(64),
      })
      .strict()
      .optional(),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * KPI revision (manager-only) — revise target.
 *
 * Schema bind shape CONFIRMED: chỉ revise value; không sửa actor/role/
 * targetType/cohort history (audit).
 * ─────────────────────────────────────────────────────────────────────────── */
export const KPIRevisionInputSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    assignmentId: z.string().min(1).max(128),
    newTargetValue: z.number().nonnegative().optional(),
    newTargetRate: z.number().min(0).max(1).optional(),
    /** Optimistic concurrency. */
    expectedRevision: ExpectedVersionSchema,
    /** Lý do revise (audit). */
    reasonCode: z.string().min(1).max(64),
    revisedBy: ActorSchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.newTargetValue === undefined && val.newTargetRate === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'phải có newTargetValue hoặc newTargetRate',
        path: ['newTargetValue'],
      });
    }
  });

/* ───────────────────────────────────────────────────────────────────────────
 * KPI propose — sale/AI có thể propose (read-only target); KHÔNG
 * mutate target.
 *
 * Schema bind shape CONFIRMED:
 *  - proposedTargetValue/rate — propose value (audit).
 *  - rationale (≤ 512, reject URL/base64).
 *  - KHÔNG có field `mutateTarget` / `applyAsManager` (schema marker).
 * ─────────────────────────────────────────────────────────────────────────── */
export const KPIProposeInputSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    assignmentId: z.string().min(1).max(128),
    proposedTargetValue: z.number().nonnegative().optional(),
    proposedTargetRate: z.number().min(0).max(1).optional(),
    rationale: z
      .string()
      .min(1)
      .max(512)
      .refine(
        (s) =>
          !/https?:\/\//i.test(s) &&
          !/data:[^\s]+/i.test(s) &&
          !/[A-Za-z0-9+/]{100,}={0,2}/.test(s),
        'rationale KHÔNG chứa URL/base64/data URI',
      ),
    proposedBy: ActorSchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    if (
      val.proposedTargetValue === undefined &&
      val.proposedTargetRate === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'phải có proposedTargetValue hoặc proposedTargetRate',
        path: ['proposedTargetValue'],
      });
    }
  });

export const KPIProposeResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    proposalId: z.string().min(1).max(128),
    assignmentId: z.string().min(1).max(128),
    proposedAt: z.string().datetime({ offset: true }),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * KPI read — get current target + actual progress (read-only cho sale/AI).
 *
 * Schema bind shape CONFIRMED:
 *  - targetValue/targetRate.
 *  - actualValue/actualRate.
 *  - revisionId (last).
 *  - attributionSource 'available' / 'unavailable' (Q-30 thiếu
 *    nguồn KHÔNG đoán).
 * ─────────────────────────────────────────────────────────────────────────── */
export const KPIReadResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    assignmentId: z.string().min(1).max(128),
    targetType: KPITargetTypeSchema,
    period: KPIPeriodSchema,
    targetValue: z.number().nonnegative().optional(),
    targetRate: z.number().min(0).max(1).optional(),
    actualValue: z.number().nonnegative().optional(),
    actualRate: z.number().min(0).max(1).optional(),
    revisionId: z.string().min(1).max(128),
    /**
     * Attribution availability — schema bind (Owner Q-30 thiếu nguồn
     * KHÔNG đoán).
     */
    attribution: z.enum(['AVAILABLE', 'UNAVAILABLE']),
    attributionReasonCode: z.string().min(1).max(64).optional(),
    /** Snapshot timestamp — server-set, asOf. */
    asOf: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.attribution === 'UNAVAILABLE' && !val.attributionReasonCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'UNAVAILABLE attribution yêu cầu reasonCode',
        path: ['attributionReasonCode'],
      });
    }
    if (val.attribution === 'AVAILABLE' && val.attributionReasonCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'AVAILABLE KHÔNG có reasonCode',
        path: ['attributionReasonCode'],
      });
    }
  });

/* ───────────────────────────────────────────────────────────────────────────
 * KPI module namespace experimental/version — Phase 10 marker.
 *
 * Schema bind shape CONFIRMED: namespace tag `phase10-experimental`.
 * Phase 9 (Gate 0) chỉ bind shape; runtime HRP gate quyết module
 * enable/disable.
 * ─────────────────────────────────────────────────────────────────────────── */
export const KPI_MODULE_NAMESPACE = 'phase10-experimental' as const;

export const KPIModuleNamespaceSchema = z.literal(KPI_MODULE_NAMESPACE);

/* ───────────────────────────────────────────────────────────────────────────
 * KPI forbid-list (Q-30 marker audit).
 *
 * Owner rev 2: marker KHÔNG tự chứng minh AC enforce. Schema strict đã
 * reject field không khai báo; runtime HRP gate enforce qua code review
 * + lint + integration test.
 * ─────────────────────────────────────────────────────────────────────────── */
export const KPI_PATCH_FORBIDDEN = Object.freeze([
  // Sale/AI không mutate target.
  'saleMutateTarget',
  'aiMutateTarget',
  'proposeApplyAsManager',
  // Manager-only write — chống privilege escalation.
  'bypassManagerCapability',
  'fakeActorAsManager',
  'reviseAsNonManager',
  // Không promote canonical-ready khi chưa domain chốt.
  'markAsCanonicalReady',
  'promoteToProduction',
  // Không suy diễn thiếu source.
  'assumeAttribution',
  'assumeReviewer',
  // Không phá vỡ optimistic concurrency.
  'bypassExpectedRevision',
  'silentReviseTarget',
  // Không drop history.
  'dropAssignmentHistory',
  'dropRevisionHistory',
] as const);

export { SCHEMA_VERSION };
