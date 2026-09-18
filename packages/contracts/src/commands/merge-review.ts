/**
 * merge-review.ts — Merge & review workflow contracts (Gate 0 / F1).
 *
 * Nguồn: Master-Plan.V2.6.md §10.3.1, §10.3.2, §11 + Backlog Gate0 §0.3b
 * + Auditor findings (Owner chỉ thị G0/0.8-F1).
 *
 * Trọng tâm F1:
 *  - `mergeLaborProfiles`, `commitReviewDecision`, `resolvePossibleMatch`,
 *    `supersedeReviewStatus` là 4 command **PROPOSED/UNAVAILABLE**: schema
 *    bind shape có marker rõ ràng (placeholder strict); KHÔNG để tên method
 *    hay marker allowlist được hiểu là typed contract đã hoàn thiện.
 *  - Privileged merge capability tách khỏi inbound default gateway (đã
 *    enforce ở gateway.ts tier table); schema ở đây là placeholder.
 *  - Review workflow chưa chốt; T1 KHÔNG tự thiết kế workflow để lấp thiếu
 *    DTO. Audit/dual-control/ACID vs eventual consistency phụ thuộc HRP-owned
 *    PR (xem Q-19 transitions, Q-23 Client domain, Q-37 dual-control AI).
 *
 * Điều kiện mở lại path (HRP-owned, Owner xác nhận):
 *  - Q-19 transitions PROPOSED → CONFIRMED với full state machine.
 *  - Q-23 Client domain PROPOSED → CONFIRMED với mapping/contact contract
 *    + review checklist.
 *  - Q-37 dual-control policy cho AI apply CONFIRMED.
 *  - Owner sign-off trên matrix §3 (review/merge tier rows).
 *  - Independent audit recheck sau khi DTO ổn định.
 *
 * Schema ở đây KHÔNG tự quyết policy; chỉ là marker typed contract.
 */
import { z } from 'zod';
import { SCHEMA_VERSION } from '../enums.js';
import {
  OrganizationIdSchema,
  SchemaVersionSchema,
} from '../primitives.js';

/* ───────────────────────────────────────────────────────────────────────────
 * Marker PROPOSED/UNAVAILABLE.
 *
 * Schema placeholder strict để:
 *  - Caller KHÔNG thể gửi typed payload mong merge/review thực thi.
 *  - Runtime HRP gate đọc marker `proposedUnavailable = true` và reject
 *    (hoặc route tới HRP-owned implementation khi mở lại path).
 *  - Audit/log có metadata rõ ràng (`proposedUnavailableReason` +
 *    `proposedAuditRef` tham chiếu decision-register Q-19/Q-23/Q-37).
 *
 * Đây là **markup**, không phải implementation review workflow.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Danh sách Q tham chiếu cho merge/review workflow.
 * Owner chốt Q-19 + Q-23 + Q-37 + matrix §3 trước khi mở lại path.
 */
export const MERGE_REVIEW_PROPOSED_DEPENDENCIES = Object.freeze([
  'Q-19',
  'Q-23',
  'Q-37',
] as const);
export type MergeReviewProposedDependency =
  (typeof MERGE_REVIEW_PROPOSED_DEPENDENCIES)[number];

/**
 * `ProposedUnavailable` — base marker schema.
 * Strict reject nếu thiếu marker; chấp nhận `proposedUnavailable=true`
 * với `proposedUnavailableReason` mô tả lý do và `proposedAuditRef` mảng
 * các Q mà Owner cần chốt.
 */
export const ProposedUnavailableMarkerSchema = z
  .object({
    proposedUnavailable: z.literal(true),
    proposedUnavailableReason: z
      .string()
      .min(1)
      .max(500)
      .refine(
        (s) =>
          !/https?:\/\//i.test(s) &&
          !/data:[a-z]+\/[a-z0-9.+-]+;base64,/i.test(s),
        'proposedUnavailableReason không chứa URL/base64',
      ),
    proposedAuditRef: z.array(z.string().min(1).max(32)).min(1).max(8),
    proposedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type ProposedUnavailableMarker = z.infer<
  typeof ProposedUnavailableMarkerSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * MergeLaborProfilesInput — placeholder PROPOSED/UNAVAILABLE.
 *
 * Workflow merge chưa chốt (Q-19 transitions). HRP-owned PR mới xác định:
 *  - duplicate detection threshold + policy.
 *  - manual review approval gate.
 *  - audit/rollback/notification.
 *  - CCCD residency + privacy policy.
 *
 * Schema KHÔNG định nghĩa typed input đầy đủ; chỉ marker placeholder.
 * ─────────────────────────────────────────────────────────────────────────── */
export const MergeLaborProfilesInputSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    /** Marker PROPOSED/UNAVAILABLE — typed placeholder, không runtime. */
    marker: ProposedUnavailableMarkerSchema,
  })
  .strict()
  .refine(
    (v) =>
      v.marker.proposedAuditRef.some((q) =>
        MERGE_REVIEW_PROPOSED_DEPENDENCIES.includes(
          q as MergeReviewProposedDependency,
        ),
      ),
    'mergeLaborProfiles yêu cầu ít nhất 1 trong Q-19/Q-23/Q-37 trong proposedAuditRef',
  );

export type MergeLaborProfilesInput = z.infer<
  typeof MergeLaborProfilesInputSchema
>;

/**
 * MergeLaborProfilesResult — placeholder PROPOSED/UNAVAILABLE.
 * Runtime KHÔNG trả APPLIED outcome ở Gate 0; chỉ trả marker.
 */
export const MergeLaborProfilesResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    outcome: z.literal('PROPOSED_UNAVAILABLE'),
    marker: ProposedUnavailableMarkerSchema,
  })
  .strict();

export type MergeLaborProfilesResult = z.infer<
  typeof MergeLaborProfilesResultSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * CommitReviewDecisionInput — placeholder PROPOSED/UNAVAILABLE.
 *
 * Review workflow chưa chốt; Q-19 + Q-23 + Q-37 dependencies.
 * Schema chỉ là marker; runtime HRP-owned PR sẽ thay bằng typed
 * decision (accept/reject/request_changes) + reviewer + reviewer_capability.
 * ─────────────────────────────────────────────────────────────────────────── */
export const CommitReviewDecisionInputSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    marker: ProposedUnavailableMarkerSchema,
  })
  .strict()
  .refine(
    (v) =>
      v.marker.proposedAuditRef.some((q) =>
        MERGE_REVIEW_PROPOSED_DEPENDENCIES.includes(
          q as MergeReviewProposedDependency,
        ),
      ),
    'commitReviewDecision yêu cầu ít nhất 1 trong Q-19/Q-23/Q-37 trong proposedAuditRef',
  );

export type CommitReviewDecisionInput = z.infer<
  typeof CommitReviewDecisionInputSchema
>;

export const CommitReviewDecisionResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    outcome: z.literal('PROPOSED_UNAVAILABLE'),
    marker: ProposedUnavailableMarkerSchema,
  })
  .strict();

export type CommitReviewDecisionResult = z.infer<
  typeof CommitReviewDecisionResultSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * ResolvePossibleMatchInput — placeholder PROPOSED/UNAVAILABLE.
 *
 * EXACT_MATCH/POSSIBLE_MATCH hiện có ở mappings.ts (typed); nhưng
 * `resolvePossibleMatch` (terminal: pick one) workflow chưa chốt.
 * Schema chỉ marker.
 * ─────────────────────────────────────────────────────────────────────────── */
export const ResolvePossibleMatchInputSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    marker: ProposedUnavailableMarkerSchema,
  })
  .strict()
  .refine(
    (v) =>
      v.marker.proposedAuditRef.some((q) =>
        MERGE_REVIEW_PROPOSED_DEPENDENCIES.includes(
          q as MergeReviewProposedDependency,
        ),
      ),
    'resolvePossibleMatch yêu cầu ít nhất 1 trong Q-19/Q-23/Q-37 trong proposedAuditRef',
  );

export type ResolvePossibleMatchInput = z.infer<
  typeof ResolvePossibleMatchInputSchema
>;

export const ResolvePossibleMatchResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    outcome: z.literal('PROPOSED_UNAVAILABLE'),
    marker: ProposedUnavailableMarkerSchema,
  })
  .strict();

export type ResolvePossibleMatchResult = z.infer<
  typeof ResolvePossibleMatchResultSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * SupersedeReviewStatusInput — placeholder PROPOSED/UNAVAILABLE.
 *
 * Q-19 transitions chưa chốt; supersede chưa typed. Schema marker only.
 * ─────────────────────────────────────────────────────────────────────────── */
export const SupersedeReviewStatusInputSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    marker: ProposedUnavailableMarkerSchema,
  })
  .strict()
  .refine(
    (v) =>
      v.marker.proposedAuditRef.some((q) =>
        MERGE_REVIEW_PROPOSED_DEPENDENCIES.includes(
          q as MergeReviewProposedDependency,
        ),
      ),
    'supersedeReviewStatus yêu cầu ít nhất 1 trong Q-19/Q-23/Q-37 trong proposedAuditRef',
  );

export type SupersedeReviewStatusInput = z.infer<
  typeof SupersedeReviewStatusInputSchema
>;

export const SupersedeReviewStatusResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    outcome: z.literal('PROPOSED_UNAVAILABLE'),
    marker: ProposedUnavailableMarkerSchema,
  })
  .strict();

export type SupersedeReviewStatusResult = z.infer<
  typeof SupersedeReviewStatusResultSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * MergeReview marker helpers.
 *
 * Tạo marker chuẩn dùng chung cho tests + audit + matrix row.
 * KHÔNG tự ý tạo marker ngoài helper để tránh drift.
 * ─────────────────────────────────────────────────────────────────────────── */
export function buildProposedUnavailableMarker(args: {
  reason: string;
  auditRefs: readonly MergeReviewProposedDependency[];
  proposedAt?: string;
}): ProposedUnavailableMarker {
  return {
    proposedUnavailable: true,
    proposedUnavailableReason: args.reason,
    proposedAuditRef: [...args.auditRefs],
    ...(args.proposedAt !== undefined ? { proposedAt: args.proposedAt } : {}),
  };
}

/**
 * `isProposedUnavailable` — helper nhận diện marker placeholder.
 * Type guard: input có `proposedUnavailable = true` không?
 *
 * Trả true/false; KHÔNG throw.
 */
export function isProposedUnavailable(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const candidate = input as { proposedUnavailable?: unknown };
  return candidate.proposedUnavailable === true;
}

/**
 * Forbidden fields cho merge/review mutation.
 * Patch KHÔNG được phép có những field cấm (schema reject trước domain).
 */
export const MERGE_REVIEW_FORBIDDEN_FIELDS = Object.freeze([
  'forceApply',
  'skipReview',
  'autoApprove',
  'autoMerge',
  'silentlyOverwrite',
  'bypassVersionCheck',
  'bypassDnc',
  'bypassAudit',
  'commandPayload',
  'commandDraft',
  'arbitraryCommand',
] as const);

export { SCHEMA_VERSION };
