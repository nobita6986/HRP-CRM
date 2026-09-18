/**
 * dnc.ts — Canonical DO_NOT_CONTACT (DNC) reasons shared module.
 *
 * Nguồn: Backlog Gate0 §0.3e + Master V2.6 §10.6.5 + Auditor findings
 * (Owner chỉ thị G0/0.8-F4).
 *
 * F4 (Auditor findings, Owner chỉ thị G0/0.8):
 *  - Reuse MỘT `DncReasonSchema` cho identity DNC action và suppression
 *    `commitSuppression` để payload đi xuyên hai contract không lệch
 *    enum.
 *  - Canonical reasons (4 giá trị):
 *      + CANDIDATE_REQUEST  - ứng viên yêu cầu dừng liên hệ.
 *      + PRIVACY_REQUEST    - yêu cầu từ privacy/data-owner.
 *      + HRP_POLICY         - chính sách HRP áp dụng (HRP-owned gate).
 *      + OTHER              - lý do khác; audit note bắt buộc.
 *  - Compatibility delta `PRIVACY` (legacy) → `PRIVACY_REQUEST` (canonical):
 *    schema alias chấp nhận cả `PRIVACY` lẫn `PRIVACY_REQUEST` để không
 *    âm thầm đổi nghĩa; normalize về canonical qua `normalizeDncReason`.
 *    Caller phát hiện `wasLegacy` để audit log.
 *  - Enum membership KHÔNG tự cấp quyền dùng `HRP_POLICY` cho mọi actor;
 *    authorization là runtime gate (HRP-owned audit). Schema chỉ bind
 *    shape, không gán capability.
 *  - DNC vẫn độc lập với full intake/CCCD (Backlog §0.3a + §0.3e).
 */
import { z } from 'zod';
import { SCHEMA_VERSION } from '../enums.js';

/**
 * Canonical DNC reasons (4 giá trị). Dùng cho cả identity DNC action
 * và suppression commit.
 */
export const DNC_REASONS = [
  'CANDIDATE_REQUEST',
  'PRIVACY_REQUEST',
  'HRP_POLICY',
  'OTHER',
] as const;
export type DncReason = (typeof DNC_REASONS)[number];
export const DncReasonSchema = z.enum(DNC_REASONS);

/**
 * Legacy DNC reasons (3 giá trị cũ). Dùng cho back-compat với code
 * trước đợt G0/0.8 — chấp nhận `PRIVACY` cũ, không âm thầm đổi nghĩa.
 * Alias KHÔNG tự map; caller gọi `normalizeDncReason` để chuyển sang
 * canonical.
 */
export const LEGACY_DNC_REASONS = [
  'CANDIDATE_REQUEST',
  'PRIVACY',
  'OTHER',
] as const;
export type LegacyDncReason = (typeof LEGACY_DNC_REASONS)[number];
export const LegacyDncReasonSchema = z.enum(LEGACY_DNC_REASONS);

/**
 * `DncReasonAcceptAliasSchema` — chấp nhận canonical hoặc legacy.
 * Khi nhận legacy, schema vẫn pass; caller normalize qua
 * `normalizeDncReason` để chuyển sang canonical cho storage/audit.
 *
 * Đây là schema dùng cho `identity.ts DncActionSchema` (F4 yêu cầu
 * compatibility delta), KHÔNG dùng cho `suppression.ts commitSuppression`
 * (đã canonical 4 giá trị).
 */
export const DncReasonAcceptAliasSchema = z.union([
  DncReasonSchema,
  LegacyDncReasonSchema,
]);

/**
 * `wasLegacy` audit marker — true khi input là legacy shape.
 */
export interface NormalizeDncReasonResult {
  reason: DncReason;
  wasLegacy: boolean;
}

export function normalizeDncReason(input: unknown): NormalizeDncReasonResult {
  if (typeof input !== 'string') {
    throw new TypeError('DncReason phải là string');
  }
  if ((DNC_REASONS as readonly string[]).includes(input)) {
    return { reason: input as DncReason, wasLegacy: false };
  }
  if (input === 'PRIVACY') {
    return { reason: 'PRIVACY_REQUEST', wasLegacy: true };
  }
  throw new RangeError(
    `DncReason không hợp lệ: ${input} (canonical: ${DNC_REASONS.join(', ')}; legacy: ${LEGACY_DNC_REASONS.join(', ')})`,
  );
}

/**
 * Marker runtime: enum membership không tự cấp quyền HRP_POLICY.
 * Schema bind shape; capability check ở runtime HRP gate (Q-37 dual-control
 * AI, Q-19 transitions). Đây chỉ là doc-marker, KHÔNG phải AC enforce.
 */
export const DNC_REASON_AUTHORIZATION_NOTE =
  'DNC_REASON=HRP_POLICY không tự cấp quyền cho mọi actor; runtime gate xác minh capability.' as const;

export { SCHEMA_VERSION };
