// src/review/types.ts — Review service core types (CORE/1.7).
//
// Application-level types (NOT contracts freeze). CORE/1.7 review service
// intentionally scopes its own DTOs thay vì touching frozen merge/review
// contracts (which are PROPOSED/UNAVAILABLE marker only — see
// packages/contracts/src/commands/merge-review.ts).
//
// Boundaries:
//  - Review entry tách khỏi IntakeCheckpoint (CORE/1.6) — checkpoint lưu
//    reviewRef opaque; review service lưu chi tiết quyết định + audit.
//  - Review service KHÔNG có merge capability (AC3): không có union/merge
//    profile logic.
//  - Replay revalidates qua checkpoint + mapping context (AC4), không lặp
//    applied mutation.

/** Trạng thái review entry — internal state machine. */
export const REVIEW_ENTRY_STATUSES = [
  'OPEN',
  'DECIDED',
  'EXPIRED',
  'SUPERSEDED',
] as const;
export type ReviewEntryStatus = (typeof REVIEW_ENTRY_STATUSES)[number];

/** Quyết định reviewer. */
export const REVIEW_DECISION_KINDS = [
  'ACCEPT',
  'REJECT',
  'REQUEST_CHANGES',
] as const;
export type ReviewDecisionKind = (typeof REVIEW_DECISION_KINDS)[number];

/** Tier review (mirror allowed actions — schema bind cho tier mapping). */
export const REVIEW_TIERS = [
  'INBOUND_REVIEWER',
  'PRIVILEGED_REVIEWER',
] as const;
export type ReviewTier = (typeof REVIEW_TIERS)[number];

/** Target kinds mà review có thể link tới (KHÔNG bao gồm merge targets). */
export const REVIEW_LINK_TARGET_KINDS = [
  'CANDIDATE',
  'REVISION',
  'SCHEMA',
  'EVIDENCE',
] as const;
export type ReviewLinkTargetKind = (typeof REVIEW_LINK_TARGET_KINDS)[number];

/**
 * Reviewer capability claim — internal shape, validated qua
 * ActorSchema.parse ở service layer.
 */
export interface ReviewerCapability {
  /** Reviewer opaque ID (matched với Actor.userId/serviceId). */
  reviewerId: string;
  /** Tier mà reviewer giữ (server-side enforcement). */
  tier: ReviewTier;
  /** Organization scope — server check khớp checkpoint. */
  organizationId: string;
}

/** PII-redacted candidate summary (server output). */
export interface ReviewCandidateSummary {
  /** Opaque candidate ID. */
  candidateId: string;
  /** Redacted display (không chứa fullName/phone gốc). */
  displayRedacted: string;
  /** Aggregate version snapshot. */
  aggregateVersion: number;
}

/** Audit entry ghi vào review entry. */
export interface ReviewAuditEntry {
  auditId: string;
  at: string; // ISO datetime
  actor: string;
  action: string;
  detail?: Record<string, unknown>;
}

/**
 * Review entry — chứa decision, audit log, links. KHÔNG có canonical mutation.
 */
export interface ReviewEntry {
  reviewEntryId: string;
  organizationId: string;
  /** Reference tới IntakeCheckpoint.intakeRevisionId (CORE/1.6). */
  intakeRevisionId: string;
  /** Canonical target reference nếu đã biết. */
  canonicalId?: string;
  canonicalVersion?: number;
  /** Draft digest lưu khi entry tạo (CORE/1.6 binding). */
  draftDigest: string;
  status: ReviewEntryStatus;
  /** Decision hiện tại — null khi OPEN. */
  decision: ReviewDecision | null;
  /** Khi quyết định stale (version drift), version tại thời điểm đó. */
  decisionVersion: number | null;
  /** Anchor refs ban đầu (intake-derived). Không thể mutated once decided. */
  anchorRefs: ReviewLink[];
  /** Append-only audit log. */
  auditLog: ReviewAuditEntry[];
  createdAt: string;
  updatedAt: string;
}

/** Reviewer decision record. */
export interface ReviewDecision {
  decisionId: string;
  reviewer: ReviewerCapability;
  kind: ReviewDecisionKind;
  reason: string;
  /** Version mà reviewer nhìn thấy khi đưa quyết định. */
  baseVersion: number;
  /** Expected entry version mà reviewer nhắm đến — server check stale. */
  expectedEntryVersion: number;
  at: string;
}

/** Link entry — chỉ metadata, không canonical mutation. */
export interface ReviewLink {
  linkId: string;
  targetKind: ReviewLinkTargetKind;
  targetRef: string;
  /** Display label (redacted). */
  label: string;
  /** Audit binding. */
  addedBy: string;
  addedAt: string;
}

/**
 * Permission context — derived từ actor claim passed qua envelope.
 * Server-side only; client không đặt capability trực tiếp.
 */
export interface ReviewPermissionContext {
  actor: string; // Actor.userId/serviceId stringified
  /** Capability parsed từ trusted caller (fixture/runtime boundary). */
  capability: ReviewerCapability;
  /** Organization từ scope (server check vs entry.organizationId). */
  organizationId: string;
}
