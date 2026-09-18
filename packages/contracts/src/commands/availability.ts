/**
 * availability.ts — UpdateLaborAvailability DTO (Gate 0 / 0.3e).
 *
 * Nguồn: Master-Plan.V2.6.md §10.6.2 + §10.6.4 + Backlog Gate0 §0.3e.
 *
 * Trọng tâm:
 *  - Availability TÁCH BIỆT với PlacementCase stage và CurrentRelationship
 *    (Master §10.6.4 — hai trục chỉnh độc lập).
 *  - Input có laborProfileId + availability + expectedVersion; mutate theo
 *    optimistic concurrency. Server reject nếu expectedVersion lệch.
 *  - AVAILABLE_FROM_DATE bắt buộc ngày lịch hợp lệ (CalendarDateSchema).
 *    Validation "tương lai" KHÔNG thực thi ở schema (no hardcoded clock);
 *    runtime HRP gate dùng BUSINESS_TIMEZONE + submission/intake effective
 *    time (xem primitives.ts).
 *  - Khi đổi khỏi AVAILABLE_FROM_DATE, command phải xử lý ngày cũ rõ ràng
 *    (clear khỏi projection, giữ audit); schema không tự đổi
 *    CurrentRelationship/case.
 *  - DO_NOT_CONTACT: state + suppression event phải đi cùng transaction ở
 *    runtime HRP. Schema bind shape; runtime gate enforce.
 *  - Đến ngày hẹn KHÔNG tự chuyển sang AVAILABLE_NOW nếu chưa có HRP
 *    policy cho phép (Master §10.6.2). Scheduler policy là HRP-owned.
 *
 * Không phải:
 *  - Không phải assignment/scheduling; xem next-action.ts / scheduling.ts.
 *  - Không auto-merge profile, không tạo LaborProfile mới.
 */
import { z } from 'zod';
import {
  AvailabilitySchema,
  SCHEMA_VERSION,
} from '../enums.js';
import {
  CalendarDateSchema,
  CanonicalIdSchema,
  ExpectedVersionSchema,
  OrganizationIdSchema,
  SchemaVersionSchema,
} from '../primitives.js';
import { IntakeContextRefSchema } from './intake.js';

/**
 * AvailabilityPatch — whitelist fields được phép patch trên projection.
 *
 * Master §10.6.4: cập nhật Availability không tự đóng case và cập nhật
 * case không tự đổi Availability. Patch này KHÔNG có:
 *  - currentRelationship (read-only, projection; xem enums.ts).
 *  - placementCaseId / placementCaseVersion (case là trục riêng).
 *  - status / closeReason (case mutation, xem placement-case.ts).
 *  - handling / beneficiary / worker (Master §10.2).
 *
 * Khi availability = AVAILABLE_FROM_DATE, availableFromDate bắt buộc.
 * Khi availability KHÁC AVAILABLE_FROM_DATE, availableFromDate KHÔNG hợp lệ
 * (clear khỏi projection; không để dữ liệu mâu thuẫn).
 */
export const AvailabilityPatchSchema = z
  .object({
    availability: AvailabilitySchema,
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
        message:
          'availableFromDate chỉ hợp lệ khi availability = AVAILABLE_FROM_DATE; clear khỏi projection khi đổi state',
        path: ['availableFromDate'],
      });
    }
  });
export type AvailabilityPatch = z.infer<typeof AvailabilityPatchSchema>;

/**
 * UpdateLaborAvailabilityInput — input cho `updateLaborAvailability`.
 *
 * Schema bind shape; runtime HRP gate enforce:
 *  - actor/scope (xác minh auth).
 *  - idempotency (server đối chiếu key+cached result).
 *  - expectedVersion (optimistic concurrency; conflict → REFRESH_AND_REVIEW).
 *  - DO_NOT_CONTACT transaction với suppression event (Master §10.6.5).
 *  - Past-date / future-date rule (Asia/Ho_Chi_Minh, runtime context).
 *
 * Schema KHÔNG hardcode ngày hiện tại (no Date.now()); runtime gate
 * nhận business clock từ context.
 */
export const UpdateLaborAvailabilityInputSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    laborProfileId: CanonicalIdSchema,
    expectedVersion: ExpectedVersionSchema,
    patch: AvailabilityPatchSchema,
    /** Context cho actor/source introspection (intake payload). */
    context: IntakeContextRefSchema,
    /** Optional: short note (≤ 500 chars), KHÔNG chứa PII raw, URL/base64. */
    note: z.string().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    // Note KHÔNG chứa URL / base64 / data URI — đồng nhất với placement case.
    if (val.note) {
      const rejectUrlOrBase64 = (re: RegExp, label: string) => {
        if (re.test(val.note!)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `note không được chứa ${label}`,
            path: ['note'],
          });
        }
      };
      rejectUrlOrBase64(/https?:\/\//iu, 'URL thô');
      rejectUrlOrBase64(/data:[a-z]+\/[a-z0-9.+-]+;base64,/iu, 'data URI base64');
      rejectUrlOrBase64(/^[A-Za-z0-9+/]{200,}={0,2}$/u, 'base64 blob thô');
    }
  });
export type UpdateLaborAvailabilityInput = z.infer<
  typeof UpdateLaborAvailabilityInputSchema
>;

/**
 * UpdateLaborAvailabilityResult — server trả về sau khi mutate.
 *
 * `appliedAvailability` là wire value đã apply (server có thể reject/reorder
 * nếu không hợp lệ, vd: DO_NOT_CONTACT yêu cầu suppression transaction).
 *
 * `appliedAvailableFromDate` chỉ xuất hiện khi appliedAvailability =
 * AVAILABLE_FROM_DATE; các state khác trả null.
 *
 * `previousAvailability` echo state cũ để UI hiển thị diff.
 */
export const UpdateLaborAvailabilityResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    canonicalId: CanonicalIdSchema,
    version: ExpectedVersionSchema,
    previousAvailability: AvailabilitySchema,
    appliedAvailability: AvailabilitySchema,
    appliedAvailableFromDate: CalendarDateSchema.nullable(),
    /** Marker: server đã emit suppression event cùng transaction (chỉ cho DO_NOT_CONTACT). */
    suppressionEventId: z.string().min(1).max(128).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (
      val.appliedAvailability === 'AVAILABLE_FROM_DATE' &&
      !val.appliedAvailableFromDate
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'appliedAvailableFromDate phải có khi appliedAvailability = AVAILABLE_FROM_DATE',
        path: ['appliedAvailableFromDate'],
      });
    }
    if (
      val.appliedAvailability !== 'AVAILABLE_FROM_DATE' &&
      val.appliedAvailableFromDate !== null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'appliedAvailableFromDate phải null khi appliedAvailability ≠ AVAILABLE_FROM_DATE',
        path: ['appliedAvailableFromDate'],
      });
    }
  });
export type UpdateLaborAvailabilityResult = z.infer<
  typeof UpdateLaborAvailabilityResultSchema
>;

/**
 * Forbidden fields cho availability mutation.
 * Patch KHÔNG được phép có những field này; runtime reject trước khi
 * chạm domain.
 */
export const AVAILABILITY_PATCH_FORBIDDEN = Object.freeze([
  // Trục riêng — case stage/status/closeReason thuộc placement-case.ts.
  'placementCaseId',
  'placementCaseVersion',
  'intendedStage',
  'status',
  'closeReason',
  // Projection read-only — Master §10.6.3 reject mutation.
  'currentRelationship',
  'relationshipPrecedence',
  // Trục riêng — Handling thuộc HRP-owned runtime, không qua schema.
  'handlingAssignment',
  'handlingSla',
  // PII / contact — schema khác (interaction).
  'phone',
  'email',
  'fullName',
  'cccd',
  // DO_NOT_CONTACT specifics — schema khác (suppression.ts).
  'dncReason',
  'dncNote',
  'dncEvidence',
  // Auto-merge / creation — schema không tạo LaborProfile ở gate này.
  'createLaborProfile',
  'mergeLaborProfile',
] as const);
