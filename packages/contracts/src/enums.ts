/**
 * enums.ts — Wire constants chính thức (Phase 9 / Gate 0).
 *
 * Nguồn thẩm quyền duy nhất: Master-Plan.V2.6.md §10.6 + hrp-connector.md §3.
 * KHÔNG tự ý thêm giá trị mới. Cấm: CLOSED_SUCCESS, SUCCESS_HRP_WORKFORCE,
 * SUCCESS_DIRECT_HIRE và mọi stage đóng tự phát minh.
 *
 * Nhãn tiếng Việt tách khỏi wire value để tránh đổi schema khi copy chỉnh UI.
 * Validation chạy trên wire value; UI đọc label từ bảng label riêng.
 */
import { z } from 'zod';

/* ───────────────────────────────────────────────────────────────────────────
 * PlacementCase — tiến độ đợt tìm việc (stage trong case đang mở).
 * Một PlacementCase ACTIVE có đúng một stage tại một thời điểm.
 * Khi case CLOSED, stage có thể được giữ lại cho audit (theo HRP policy chưa chốt).
 * ─────────────────────────────────────────────────────────────────────────── */
export const PLACEMENT_CASE_STAGES = [
  'NEW',
  'CONTACTING',
  'QUALIFYING',
  'MATCHING',
  'PROPOSED',
  'INTERESTED',
  'CLIENT_PROCESS',
  'READY_TO_START',
] as const;
export type PlacementCaseStage = (typeof PLACEMENT_CASE_STAGES)[number];
export const PlacementCaseStageSchema = z.enum(PLACEMENT_CASE_STAGES);

export const PLACEMENT_CASE_STAGE_LABELS_VI: Readonly<
  Record<PlacementCaseStage, string>
> = Object.freeze({
  NEW: 'Nhu cầu mới',
  CONTACTING: 'Đang liên hệ',
  QUALIFYING: 'Đang xác định nhu cầu',
  MATCHING: 'Đang tìm việc phù hợp',
  PROPOSED: 'Đã đề xuất việc',
  INTERESTED: 'Quan tâm việc đã đề xuất',
  CLIENT_PROCESS: 'Đang trong quy trình khách hàng',
  READY_TO_START: 'Sẵn sàng bắt đầu',
});

/* ───────────────────────────────────────────────────────────────────────────
 * PlacementCase status.
 * Only the CLOSED wire status has been confirmed by the Owner. The open/active
 * status set is HRP-owned and unknown, so it is intentionally not invented.
 * ─────────────────────────────────────────────────────────────────────────── */
export const CLOSED_CASE_STATUS = 'CLOSED' as const;
export type ClosedCaseStatus = typeof CLOSED_CASE_STATUS;
export const ClosedCaseStatusSchema = z.literal(CLOSED_CASE_STATUS);

export const CASE_CLOSE_REASONS = [
  'SUCCESS',
  'NO_LONGER_LOOKING',
  'UNREACHABLE',
  'NO_SUITABLE_JOB',
  'CANDIDATE_WITHDREW',
  'CLIENT_REJECTED',
  'DUPLICATE_CASE',
  'INVALID',
  'OTHER',
] as const;
export type CaseCloseReason = (typeof CASE_CLOSE_REASONS)[number];
export const CaseCloseReasonSchema = z.enum(CASE_CLOSE_REASONS);

export const CASE_CLOSE_REASON_LABELS_VI: Readonly<
  Record<CaseCloseReason, string>
> = Object.freeze({
  SUCCESS: 'Đã ghép việc thành công',
  NO_LONGER_LOOKING: 'Không còn nhu cầu tìm việc',
  UNREACHABLE: 'Không thể liên lạc được',
  NO_SUITABLE_JOB: 'Không có công việc phù hợp',
  CANDIDATE_WITHDREW: 'Người lao động rút lui/từ chối',
  CLIENT_REJECTED: 'Doanh nghiệp từ chối',
  DUPLICATE_CASE: 'Trùng lặp đợt tìm việc',
  INVALID: 'Hồ sơ không hợp lệ',
  OTHER: 'Lý do khác',
});

/** Helper runtime: closeReason hợp lệ khi case ở status=CLOSED. */
export const CloseCommandSchema = z
  .object({
    closeReason: CaseCloseReasonSchema,
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * Availability — mức sẵn sàng nhận việc.
 * TÁCH BIỆT với stage case và CurrentRelationship.
 * AVAILABLE_FROM_DATE đi kèm ngày lịch (YYYY-MM-DD Asia/Ho_Chi_Minh).
 * ─────────────────────────────────────────────────────────────────────────── */
export const AVAILABILITIES = [
  'AVAILABLE_NOW',
  'AVAILABLE_FROM_DATE',
  'NOT_AVAILABLE',
  'DO_NOT_CONTACT',
  'UNKNOWN',
] as const;
export type Availability = (typeof AVAILABILITIES)[number];
export const AvailabilitySchema = z.enum(AVAILABILITIES);

export const AVAILABILITY_LABELS_VI: Readonly<Record<Availability, string>> =
  Object.freeze({
    AVAILABLE_NOW: 'Có thể đi làm ngay',
    AVAILABLE_FROM_DATE: 'Sẵn sàng từ ngày',
    NOT_AVAILABLE: 'Chưa cần việc lúc này',
    DO_NOT_CONTACT: 'Không muốn HRP liên hệ',
    UNKNOWN: 'Chưa rõ',
  });

/* ───────────────────────────────────────────────────────────────────────────
 * CurrentRelationship — projection chỉ đọc (read-only).
 * KHÔNG được phép xuất hiện trong mutation DTO; backend reject nếu cố chèn.
 * PRECEDENCE giữa nhiều quan hệ là HRP-owned (UI không tự chọn).
 * ─────────────────────────────────────────────────────────────────────────── */
export const CURRENT_RELATIONSHIPS = [
  'NEVER_WORKED',
  'WORKING_VIA_HRP',
  'FORMER_HRP_WORKER',
  'WORKING_EXTERNAL',
  'UNKNOWN',
] as const;
export type CurrentRelationship = (typeof CURRENT_RELATIONSHIPS)[number];
export const CurrentRelationshipSchema = z.enum(CURRENT_RELATIONSHIPS);

export const CURRENT_RELATIONSHIP_LABELS_VI: Readonly<
  Record<CurrentRelationship, string>
> = Object.freeze({
  NEVER_WORKED: 'Chưa từng làm qua HRP',
  WORKING_VIA_HRP: 'Đang làm qua HRP',
  FORMER_HRP_WORKER: 'Đã từng làm qua HRP',
  WORKING_EXTERNAL: 'Đang làm ngoài HRP',
  UNKNOWN: 'Chưa đủ dữ liệu',
});

/**
 * Cờ helper: cho biết enum thuộc diện read-only.
 * Mutation DTO phải kiểm tra cờ này (ví dụ qua pickForbid) để reject field.
 */
export const CURRENT_RELATIONSHIP_READONLY = true as const;

/* ───────────────────────────────────────────────────────────────────────────
 * NextAction — trạng thái của một hành động kế tiếp được lập lịch.
 * Độc lập với PlacementCase stage và Availability.
 * ─────────────────────────────────────────────────────────────────────────── */
export const NEXT_ACTION_STATUSES = ['OPEN', 'DONE', 'CANCELLED'] as const;
export type NextActionStatus = (typeof NEXT_ACTION_STATUSES)[number];
export const NextActionStatusSchema = z.enum(NEXT_ACTION_STATUSES);

/* ───────────────────────────────────────────────────────────────────────────
 * Matching outcomes — discriminated tag cho createOrMatchLaborProfile.
 * Là COMMAND RESULT, không phải state thứ tư của ExternalContactLink.
 * - EXACT_MATCH: target canonical đã xác minh, có canonical ID + version.
 * - POSSIBLE_MATCH: candidate/review reference; KHÔNG có target mutation hợp lệ.
 * - NEW_PROFILE: HRP đã tạo profile theo creation policy.
 * ─────────────────────────────────────────────────────────────────────────── */
export const MATCHING_OUTCOMES = [
  'EXACT_MATCH',
  'POSSIBLE_MATCH',
  'NEW_PROFILE',
] as const;
export type MatchingOutcome = (typeof MATCHING_OUTCOMES)[number];
export const MatchingOutcomeSchema = z.enum(MATCHING_OUTCOMES);

/* ───────────────────────────────────────────────────────────────────────────
 * ExternalContactLink match state — STATE mapping (command side).
 * Phân biệt với `MATCHING_OUTCOMES` (command result):
 *  - MATCHING_OUTCOMES là kết quả createOrMatchLaborProfile:
 *    EXACT_MATCH / POSSIBLE_MATCH / NEW_PROFILE (NEW_PROFILE là command
 *    result chứ KHÔNG phải mapping state).
 *  - EXTERNAL_CONTACT_MATCH_STATES là trạng thái của link giữa
 *    ExternalContact (Chatwoot) ↔ LaborProfile canonical: EXACT_MATCH /
 *    POSSIBLE_MATCH / UNRESOLVED.
 * Schema ngăn không cho nhầm: NEW_PROFILE không thuộc mapping state,
 * UNRESOLVED không thuộc command result.
 * ─────────────────────────────────────────────────────────────────────────── */
export const EXTERNAL_CONTACT_MATCH_STATES = [
  'EXACT_MATCH',
  'POSSIBLE_MATCH',
  'UNRESOLVED',
] as const;
export type ExternalContactMatchState =
  (typeof EXTERNAL_CONTACT_MATCH_STATES)[number];
export const ExternalContactMatchStateSchema = z.enum(
  EXTERNAL_CONTACT_MATCH_STATES,
);

/* ───────────────────────────────────────────────────────────────────────────
 * Evidence kind — opaque reference cho attachment CCCD.
 * Quyết định final scan/hash/provenance là do server xác minh, không tin client.
 * ─────────────────────────────────────────────────────────────────────────── */
export const EVIDENCE_KINDS = ['CCCD_FRONT', 'CCCD_BACK'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export const EvidenceKindSchema = z.enum(EVIDENCE_KINDS);

/* ───────────────────────────────────────────────────────────────────────────
 * Re-export guard constants cho những lệnh không được nằm trong schema.
 * Ví dụ: ký hiệu dùng trong tests để từ chối payload có field cấm.
 * ─────────────────────────────────────────────────────────────────────────── */
export const FORBIDDEN_CLOSED_VARIANTS = Object.freeze([
  'CLOSED_SUCCESS',
  'CLOSED_FAILURE',
  'SUCCESS_HRP_WORKFORCE',
  'SUCCESS_DIRECT_HIRE',
  'CLOSED_NO_ANSWER',
] as const);

export const SCHEMA_VERSION = '1' as const;
