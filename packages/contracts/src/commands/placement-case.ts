/**
 * placement-case.ts — OpenPlacementCase / UpdatePlacementCase /
 * ClosePlacementCase DTOs.
 *
 * Ràng buộc (Backlog §Task 0.3c):
 *  - OpenPlacementCase KHÔNG yêu cầu caseId (chưa tạo); server sẽ tạo
 *    và trả về trong result.
 *  - Update/Close có target caseId + expectedVersion (optimistic locking).
 *  - closeReason RIÊNG với stage enum (CASE_CLOSE_REASONS, 9 giá trị).
 *  - CLOSED status server-owned; client KHÔNG set status trong patch.
 *  - SUCCESS không phải EFFECTIVE — placement EFFECTIVE là workflow
 *    managed mode riêng (G0/0.6); schema KHÔNG nhầm.
 *  - KHÔNG tự định open-status set / active set / transitions (G-06
 *    unknown). Schema chỉ bind shape; transitions matrix do HRP domain
 *    chốt.
 *  - Patch whitelist nghiêm ngặt: KHÔNG CurrentRelationship / status
 *    / closeReason / placementCaseId / handling / beneficiary.
 *  - Strict payload; summary giới hạn 500 ký tự; KHÔNG transcript /
 *    attachment bytes / raw URL.
 */
import { z } from 'zod';
import { SCHEMA_VERSION } from '../enums.js';
import {
  CanonicalIdSchema,
  ExpectedVersionSchema,
  OrganizationIdSchema,
} from '../primitives.js';
import {
  AvailabilitySchema,
  CaseCloseReasonSchema,
  PlacementCaseStageSchema,
} from '../enums.js';
import { CalendarDateSchema } from '../primitives.js';
import { CommandEvidenceRefSchema } from './evidence.js';
import { IntakeContextRefSchema } from './intake.js';

/* ───────────────────────────────────────────────────────────────────────────
 * Patch whitelist cho updatePlacementCase.
 *  - Allowed: stage, availability, availableFromDate, contactNotes,
 *    intentSummary, scheduledActionAt.
 *  - Forbidden (do strict + đặc tả): CurrentRelationship, status,
 *    closeReason, caseId, laborProfileId, handling, beneficiary, worker,
 *    arbitraryPatch, rawPatch, transcript, attachment, rawUrl.
 * ─────────────────────────────────────────────────────────────────────────── */
export const PLACEMENT_CASE_PATCH_WHITELIST = Object.freeze([
  'intendedStage',
  'availability',
  'availableFromDate',
  'contactNotes',
  'intentSummary',
  'scheduledActionAt',
] as const);
export type PlacementCasePatchKey =
  (typeof PLACEMENT_CASE_PATCH_WHITELIST)[number];

export const PLACEMENT_CASE_PATCH_FORBIDDEN = Object.freeze([
  'currentRelationship',
  'CurrentRelationship',
  'status',
  'STATUS',
  'caseStatus',
  'caseStatusAt',
  'closeReason',
  'closedAt',
  'closedBy',
  'placementCaseId',
  'caseId',
  'laborProfileId',
  'handling',
  'handlingAssignmentId',
  'beneficiary',
  'worker',
  'assignment',
  'effectiveness',
  'effectiveAt',
  'isEffective',
  'arbitraryPatch',
  'rawPatch',
  'transcript',
  'attachment',
  'rawUrl',
  'effective',
  'EFFECTIVE',
] as const);

/** Whitelist + value schema cho từng key. */
const PlacementCasePatchValueSchema = z.union([
  z.string().min(1).max(500),
  z.boolean(),
  z.number().finite(),
  AvailabilitySchema,
  CalendarDateSchema,
]);

export const PlacementCasePatchSchema = z
  .record(z.string(), PlacementCasePatchValueSchema)
  .superRefine((obj, ctx) => {
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'placementCasePatch phải có ít nhất một field',
      });
      return;
    }
    for (const k of keys) {
      if (!(PLACEMENT_CASE_PATCH_WHITELIST as readonly string[]).includes(k)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `field '${k}' không thuộc placement case patch whitelist`,
          path: [k],
        });
      }
      if ((PLACEMENT_CASE_PATCH_FORBIDDEN as readonly string[]).includes(k)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `field cấm '${k}' không được phép trong placement case patch`,
          path: [k],
        });
      }
    }
  });

export type PlacementCasePatch = z.infer<typeof PlacementCasePatchSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * OpenPlacementCase — input payload.
 * Open KHÔNG yêu cầu caseId (chưa tạo). Server sẽ cấp canonicalId + version.
 *  - intendedStage: dùng đủ enum chính thức PlacementCaseStageSchema
 *    (8 giá trị). Schema KHÔNG tự giới hạn vào NEW/CONTACTING/QUALIFYING
 *    vì open-status set/transitions matrix chưa chốt (G-06 unknown,
 *    Q-19); runtime HRP gate enforce open-status set policy.
 *  - initialAvailability / availableFromDate: optional kèm theo intent.
 *  - laborProfileId: optional — nếu EXACT đã xác minh, có thể bind.
 *  - context: IntakeContextRef (reuse từ intake.ts).
 * ─────────────────────────────────────────────────────────────────────────── */
export const OpenPlacementCaseInputSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    laborProfileId: CanonicalIdSchema.optional(),
    intendedStage: PlacementCaseStageSchema,
    initialAvailability: AvailabilitySchema.optional(),
    availableFromDate: CalendarDateSchema.optional(),
    context: IntakeContextRefSchema,
    /** Optional: reference intake submission / draft revision. */
    intakeRevisionId: z.string().min(1).max(128).optional(),
    /** Optional: idempotency key riêng cho staff review đã confirm. */
    confirmationDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/u, 'confirmationDigest phải SHA-256 hex 64 ký tự')
      .optional(),
    /** Optional: short summary (<= 500 ký tự), KHÔNG chứa PII raw. */
    intentSummary: z.string().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.initialAvailability === 'AVAILABLE_FROM_DATE' && !val.availableFromDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'AVAILABLE_FROM_DATE yêu cầu availableFromDate',
        path: ['availableFromDate'],
      });
    }
    if (val.initialAvailability && val.initialAvailability !== 'AVAILABLE_FROM_DATE' && val.availableFromDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'availableFromDate chỉ hợp lệ khi availability = AVAILABLE_FROM_DATE',
        path: ['availableFromDate'],
      });
    }
    // Future-date rule KHÔNG enforce ở schema layer (no hardcoded clock).
    // Runtime HRP gate kiểm tra theo business clock Asia/Ho_Chi_Minh
    // và submission/intake effective time (xem Q-15, BUSINESS_TIMEZONE).
  });

export type OpenPlacementCaseInput = z.infer<typeof OpenPlacementCaseInputSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * UpdatePlacementCase — input payload.
 * Có target caseId + expectedVersion.
 * ─────────────────────────────────────────────────────────────────────────── */
export const UpdatePlacementCaseInputSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    placementCaseId: CanonicalIdSchema,
    expectedVersion: ExpectedVersionSchema,
    patch: PlacementCasePatchSchema,
    /** Optional: evidence refs cho contactNotes hoặc intentSummary. */
    evidenceRefs: z.array(CommandEvidenceRefSchema).max(8).optional(),
    /** Optional: idempotency key. */
    idempotencyHint: z.string().min(1).max(256).optional(),
  })
  .strict();

export type UpdatePlacementCaseInput = z.infer<
  typeof UpdatePlacementCaseInputSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * ClosePlacementCase — input payload.
 * Có target caseId + expectedVersion + closeReason.
 * CLOSED status server-owned (HRP-owned runtime set status).
 * SUCCESS KHÔNG là EFFECTIVE — đây là closeReason, không phải workflow
 * managed mode.
 * ─────────────────────────────────────────────────────────────────────────── */
export const ClosePlacementCaseInputSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    placementCaseId: CanonicalIdSchema,
    expectedVersion: ExpectedVersionSchema,
    closeReason: CaseCloseReasonSchema,
    /** Optional: note redacted (≤500 chars, KHÔNG transcript/attachment). */
    note: z.string().min(1).max(500).optional(),
    /** Optional: idempotency key. */
    idempotencyHint: z.string().min(1).max(256).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    // note free text không được là transcript/URL/attachment markers.
    if (val.note) {
      if (/data:|base64,|https?:\/\//u.test(val.note)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'note không được chứa URL/base64/data URI',
          path: ['note'],
        });
      }
      if (val.note.length > 500) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'note tối đa 500 ký tự',
          path: ['note'],
        });
      }
    }
  });

export type ClosePlacementCaseInput = z.infer<
  typeof ClosePlacementCaseInputSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * Kết quả OpenPlacementCase — server trả canonicalId + version.
 * appliedStage dùng đủ enum chính thức PlacementCaseStageSchema.
 * ─────────────────────────────────────────────────────────────────────────── */
export const OpenPlacementCaseResultSchema = z
  .object({
    canonicalId: CanonicalIdSchema,
    version: ExpectedVersionSchema,
    /** Stage đã apply (server có thể reject/reorder nếu open-status set không cho phép). */
    appliedStage: PlacementCaseStageSchema,
  })
  .strict();
export type OpenPlacementCaseResult = z.infer<
  typeof OpenPlacementCaseResultSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * Kết quả UpdatePlacementCase / ClosePlacementCase — APPLIED/NOOP.
 * ─────────────────────────────────────────────────────────────────────────── */
export const UpdatePlacementCaseResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('APPLIED'),
      canonicalId: CanonicalIdSchema,
      newVersion: ExpectedVersionSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('NOOP'),
      canonicalId: CanonicalIdSchema,
      currentVersion: ExpectedVersionSchema,
    })
    .strict(),
]);
export type UpdatePlacementCaseResult = z.infer<
  typeof UpdatePlacementCaseResultSchema
>;

export const ClosePlacementCaseResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('APPLIED'),
      canonicalId: CanonicalIdSchema,
      newVersion: ExpectedVersionSchema,
      /** Server xác nhận status = CLOSED (server-owned, không phải client set). */
      appliedStatus: z.literal('CLOSED'),
    })
    .strict(),
  z
    .object({
      status: z.literal('NOOP'),
      canonicalId: CanonicalIdSchema,
      currentVersion: ExpectedVersionSchema,
    })
    .strict(),
]);
export type ClosePlacementCaseResult = z.infer<
  typeof ClosePlacementCaseResultSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * Open-status set / active set / transitions matrix: PROPOSED ở Gate 0.
 *
 * F1/G0/0.8 fix (Owner chỉ thị): Schema KHÔNG tự định open-status set.
 * Helper `PLACEMENT_CASE_INTENDED_STAGE_ALLOWED` chỉ là **runtime
 * suggestion** (giới hạn về 3 stage "early flow" để gợi ý UI/chat int-
 * ake), KHÔNG phải invariant đã chốt. Schema bind shape đầy đủ enum
 * `PlacementCaseStageSchema` (8 giá trị); runtime HRP gate (Q-19) en-
 * force open-status set policy. KHÔNG dùng helper này để narrow schema.
 *
 * `isIntendedStageAllowed(stage)` trả true cho các stage thuộc early-
 * flow (NEW/CONTACTING/QUALIFYING). KHÔNG dùng để chặn submit; nếu ca-
 * ller gửi MATCHING hay sau đó, schema vẫn pass.
 * ─────────────────────────────────────────────────────────────────────────── */

export const PLACEMENT_CASE_INTENDED_STAGE_ALLOWED = Object.freeze([
  'NEW',
  'CONTACTING',
  'QUALIFYING',
] as const);

export function isIntendedStageAllowed(stage: string): boolean {
  return (
    (PLACEMENT_CASE_INTENDED_STAGE_ALLOWED as readonly string[]).includes(
      stage,
    )
  );
}

export { SCHEMA_VERSION };
