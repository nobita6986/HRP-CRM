// src/review/review-service.ts — Review service business logic (CORE/1.7).
//
// Review service operations: list, detail, decide, link, unlink, replay.
// No merge capability: does NOT expose mergeLaborProfiles.
//
// Boundaries:
//  - AC1: permissions mock, server-side scope check, PII guard.
//  - AC2: reviewer/reason/version/audit stored; stale reviewer conflict.
//  - AC3: link/unlink/relink is NOT merge; no privileged merge in this handler.
//  - AC4: replay revalidates mappings/context; no applied mutation repeat.
//
// AC alignment:
//  - AC1: list/detail use permission context from trusted actor; PII stripped at output.
//  - AC2: applyDecision checks version against current; stale = VERSION_CONFLICT.
//  - AC3: addLink/removeLink only manipulate review anchor refs; no profile mutation.
//  - AC4: replayWithCheckpoint loads checkpoint, checks state, returns validation result.

import type {
  ReviewEntry,
  ReviewLink,
  ReviewDecision,
  ReviewLinkTargetKind,
  ReviewPermissionContext,
  ReviewerCapability,
} from './types.js';
import {
  REVIEW_ENTRY_STATUSES,
  REVIEW_DECISION_KINDS,
  REVIEW_LINK_TARGET_KINDS,
  type ReviewEntryStatus,
} from './types.js';
import type { ReviewStore } from './review-store.js';
import type { ListReviewsOptions, ListReviewsResult } from './review-store.js';
import {
  reviewStore as defaultStore,
  createReviewEntry,
  applyDecision,
  addLink,
  removeLink,
  createAuditEntry,
  nextDecisionId,
  nextLinkId,
} from './review-store.js';
import {
  canListReviews,
  canGetReviewDetail,
  canDecide,
  canLink,
  canUnlink,
  canReplay,
  buildPermissionContext,
} from './permissions.js';

// ─── Error types ───────────────────────────────────────────────────────────────

/** Review service errors — mirror OrchestratorError pattern. */
export class ReviewServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'ReviewServiceError';
  }
}

// ─── Output types (PII-redacted) ───────────────────────────────────────────────

/** Redacted review entry output — candidate PII stripped. */
export interface ReviewEntryOutput {
  reviewEntryId: string;
  organizationId: string;
  intakeRevisionId: string;
  canonicalId: string | null;
  canonicalVersion: number | null;
  status: string;
  decision: ReviewDecisionOutput | null;
  anchorRefCount: number;
  createdAt: string;
  updatedAt: string;
  /** Audit log summary (no PII fields). */
  auditSummary: { action: string; at: string; actor: string }[];
}

export interface ReviewDecisionOutput {
  decisionId: string;
  reviewerId: string;
  tier: string;
  kind: string;
  reason: string;
  baseVersion: number;
  at: string;
}

export interface ReviewListOutput {
  organizationId: string;
  entries: ReviewEntryOutput[];
  nextCursor: string | null;
  totalEstimate: number;
}

export interface ReplayResult {
  reviewEntryId: string;
  checkpointState: string;
  appliedSteps: string[];
  revalidatedMappings: boolean;
  contextVersion: number | null;
  canProceed: boolean;
  canProceedReason?: string;
}

/**
 * Redact PII from entry for output.
 * Candidate PII (fullName, phone, address) NOT included in output.
 */
function redactEntry(entry: ReviewEntry): ReviewEntryOutput {
  return {
    reviewEntryId: entry.reviewEntryId,
    organizationId: entry.organizationId,
    intakeRevisionId: entry.intakeRevisionId,
    canonicalId: entry.canonicalId ?? null,
    canonicalVersion: entry.canonicalVersion ?? null,
    status: entry.status,
    decision: entry.decision
      ? {
          decisionId: entry.decision.decisionId,
          reviewerId: entry.decision.reviewer.reviewerId,
          tier: entry.decision.reviewer.tier,
          kind: entry.decision.kind,
          reason: entry.decision.reason,
          baseVersion: entry.decision.baseVersion,
          at: entry.decision.at,
        }
      : null,
    anchorRefCount: entry.anchorRefs.length,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    auditSummary: entry.auditLog.map((a) => ({
      action: a.action,
      at: a.at,
      actor: a.actor,
      // NO detail field (could contain PII from decision reason).
    })),
  };
}

// ─── Service class ─────────────────────────────────────────────────────────────

export class ReviewService {
  constructor(private readonly store: ReviewStore = defaultStore) {}

  /**
   * List reviews — scope-filtered, paginated.
   * AC1: permissions check, server-side scope.
   */
  listReviews(
    actor: unknown,
    organizationId: string,
    opts: { status?: string; cursor?: string; pageSize?: number } = {},
  ): ReviewListOutput {
    const ctx = buildPermissionContext(actor, organizationId);
    const perm = canListReviews(ctx);
    if (!perm.allowed) {
      throw new ReviewServiceError('FORBIDDEN', perm.reason ?? 'Forbidden', false);
    }

    const listOpts: ListReviewsOptions = {
      organizationId,
      ...(opts.status ? { status: opts.status as ReviewEntryStatus } : {}),
    };
    const result = this.store.list(listOpts);
    return {
      organizationId,
      entries: result.entries.map(redactEntry),
      nextCursor: result.nextCursor,
      totalEstimate: result.totalEstimate,
    };
  }

  /**
   * Get review detail — PII-redacted.
   * AC1: PII guard (candidate summary NOT full name/phone).
   *
   * Two-phase check:
   *  1. Lookup by entryId (any org).
   *  2. If found but org mismatch → FORBIDDEN SCOPE_MISMATCH.
   *  3. If not found at all → NOT_FOUND.
   */
  getReviewDetail(
    actor: unknown,
    organizationId: string,
    reviewEntryId: string,
  ): ReviewEntryOutput {
    const ctx = buildPermissionContext(actor, organizationId);
    // Search across orgs to detect cross-org access attempts.
    const crossOrgEntry = this.store.findByIdAnyOrg(reviewEntryId);
    if (!crossOrgEntry) {
      throw new ReviewServiceError('NOT_FOUND', `Review entry not found: ${reviewEntryId}`, false);
    }
    const perm = canGetReviewDetail(ctx, crossOrgEntry.organizationId);
    if (!perm.allowed) {
      throw new ReviewServiceError('FORBIDDEN', perm.reason ?? 'Forbidden', false);
    }
    return redactEntry(crossOrgEntry);
  }

  /**
   * Internal: get entry + verify scope (throw NOT_FOUND or FORBIDDEN).
   */
  private findEntryOrThrow(
    organizationId: string,
    reviewEntryId: string,
  ): ReviewEntry {
    const entry = this.store.findByIdAnyOrg(reviewEntryId);
    if (!entry) {
      throw new ReviewServiceError('NOT_FOUND', `Review entry not found: ${reviewEntryId}`, false);
    }
    if (entry.organizationId !== organizationId) {
      throw new ReviewServiceError(
        'FORBIDDEN',
        'SCOPE_MISMATCH: entry belongs to a different organization',
        false,
      );
    }
    return entry;
  }

  /**
   * Submit review decision.
   * AC2: reviewer/reason/version/audit stored; stale reviewer version conflict.
   */
  submitDecision(
    actor: unknown,
    organizationId: string,
    reviewEntryId: string,
    input: {
      kind: string;
      reason: string;
      expectedEntryVersion: number;
    },
  ): ReviewEntryOutput {
    const ctx = buildPermissionContext(actor, organizationId);
    const entry = this.findEntryOrThrow(organizationId, reviewEntryId);
    const perm = canDecide(ctx, entry.organizationId, entry.status);
    if (!perm.allowed) {
      throw new ReviewServiceError('FORBIDDEN', perm.reason ?? 'Forbidden', false);
    }

    // AC2: validate decision kind.
    if (!REVIEW_DECISION_KINDS.includes(input.kind as never)) {
      throw new ReviewServiceError(
        'VALIDATION_ERROR',
        `Invalid decision kind: ${input.kind}`,
        false,
      );
    }

    // AC2: stale version conflict — if entry version changed, reject.
    // Entry version = number of audit entries (deterministic snapshot).
    const currentEntryVersion = entry.auditLog.length;
    if (currentEntryVersion !== input.expectedEntryVersion) {
      throw new ReviewServiceError(
        'VERSION_CONFLICT',
        `VERSION_CONFLICT: entry version ${currentEntryVersion} != expected ${input.expectedEntryVersion} — review stale, re-fetch and retry`,
        false,
      );
    }

    // Build decision record.
    const decision: ReviewDecision = {
      decisionId: nextDecisionId(),
      reviewer: ctx.capability,
      kind: input.kind as ReviewDecision['kind'],
      reason: input.reason,
      baseVersion: currentEntryVersion,
      expectedEntryVersion: input.expectedEntryVersion,
      at: new Date().toISOString(),
    };

    const updated = applyDecision(entry, decision);
    this.store.update(updated);
    return redactEntry(updated);
  }

  /**
   * Link target to review entry (AC3: NOT merge).
   * Adds anchor ref — does NOT call any canonical mutation.
   */
  linkTarget(
    actor: unknown,
    organizationId: string,
    reviewEntryId: string,
    input: {
      targetKind: string;
      targetRef: string;
      label: string;
    },
  ): ReviewEntryOutput {
    const ctx = buildPermissionContext(actor, organizationId);
    const entry = this.findEntryOrThrow(organizationId, reviewEntryId);
    const perm = canLink(ctx, entry.organizationId, entry.status);
    if (!perm.allowed) {
      throw new ReviewServiceError('FORBIDDEN', perm.reason ?? 'Forbidden', false);
    }

    if (!REVIEW_LINK_TARGET_KINDS.includes(input.targetKind as ReviewLinkTargetKind)) {
      throw new ReviewServiceError(
        'VALIDATION_ERROR',
        `Invalid targetKind: ${input.targetKind}`,
        false,
      );
    }

    const link: ReviewLink = {
      linkId: nextLinkId(),
      targetKind: input.targetKind as ReviewLinkTargetKind,
      targetRef: input.targetRef,
      label: input.label,
      addedBy: ctx.actor,
      addedAt: new Date().toISOString(),
    };

    const updated = addLink(entry, link);
    this.store.update(updated);
    return redactEntry(updated);
  }

  /**
   * Unlink target from review entry (AC3: NOT merge).
   * Removes anchor ref — does NOT call any canonical mutation.
   */
  unlinkTarget(
    actor: unknown,
    organizationId: string,
    reviewEntryId: string,
    linkId: string,
  ): ReviewEntryOutput {
    const ctx = buildPermissionContext(actor, organizationId);
    const entry = this.findEntryOrThrow(organizationId, reviewEntryId);
    const perm = canUnlink(ctx, entry.organizationId, entry.status);
    if (!perm.allowed) {
      throw new ReviewServiceError('FORBIDDEN', perm.reason ?? 'Forbidden', false);
    }

    // Guard: linkId must exist on this entry.
    const hasLink = entry.anchorRefs.some((l) => l.linkId === linkId);
    if (!hasLink) {
      throw new ReviewServiceError('NOT_FOUND', `Link not found: ${linkId} on review entry ${reviewEntryId}`, false);
    }

    const updated = removeLink(entry, linkId, ctx.actor);
    this.store.update(updated);
    return redactEntry(updated);
  }

  /**
   * Replay review — revalidate against checkpoint (AC4).
   *
   * Checkpoint comes from IntakeCheckpoint store (CORE/1.6).
   * This method takes a checkpoint snapshot (already loaded by caller).
   * Replay is read-only revalidation — no mutation is repeated.
   *
   * AC4 behavior:
   *  - checkpoint.state === 'COMPLETED': canProceed=false, reason='ALREADY_APPLIED'.
   *  - checkpoint.state === 'RUNNING'/'PARTIAL': canProceed=true (resume possible).
   *  - checkpoint.state === 'REVIEW_PENDING': canProceed=true (review needed first).
   *  - checkpoint.draftDigest !== entry.draftDigest: canProceed=false (semantic drift).
   *  - canonicalId/canonicalVersion changed: canProceed=false (target drift).
   */
  replayReview(
    actor: unknown,
    organizationId: string,
    reviewEntryId: string,
    checkpointSnapshot: {
      state: string;
      draftDigest: string;
      canonicalId?: string | null;
      canonicalVersion?: number | null;
      appliedSteps: string[];
    },
  ): ReplayResult {
    const ctx = buildPermissionContext(actor, organizationId);
    const entry = this.findEntryOrThrow(organizationId, reviewEntryId);
    const perm = canReplay(ctx, entry.organizationId);
    if (!perm.allowed) {
      throw new ReviewServiceError('FORBIDDEN', perm.reason ?? 'Forbidden', false);
    }

    // AC4: revalidate draft digest binding.
    if (checkpointSnapshot.draftDigest !== entry.draftDigest) {
      return {
        reviewEntryId: entry.reviewEntryId,
        checkpointState: checkpointSnapshot.state,
        appliedSteps: checkpointSnapshot.appliedSteps,
        revalidatedMappings: false,
        contextVersion: checkpointSnapshot.canonicalVersion ?? null,
        canProceed: false,
        canProceedReason: 'DRAFT_DIGEST_CHANGED: confirmation binding invalid — re-review required',
      };
    }

    // AC4: revalidate canonical target.
    if (
      entry.canonicalId !== undefined &&
      checkpointSnapshot.canonicalId !== undefined &&
      entry.canonicalId !== checkpointSnapshot.canonicalId
    ) {
      return {
        reviewEntryId: entry.reviewEntryId,
        checkpointState: checkpointSnapshot.state,
        appliedSteps: checkpointSnapshot.appliedSteps,
        revalidatedMappings: true,
        contextVersion: checkpointSnapshot.canonicalVersion ?? null,
        canProceed: false,
        canProceedReason: 'CANONICAL_TARGET_CHANGED: target drifted from review state',
      };
    }

    // AC4: revalidate canonical version.
    if (
      entry.canonicalVersion !== undefined &&
      checkpointSnapshot.canonicalVersion !== undefined &&
      entry.canonicalVersion !== checkpointSnapshot.canonicalVersion
    ) {
      return {
        reviewEntryId: entry.reviewEntryId,
        checkpointState: checkpointSnapshot.state,
        appliedSteps: checkpointSnapshot.appliedSteps,
        revalidatedMappings: true,
        contextVersion: checkpointSnapshot.canonicalVersion ?? null,
        canProceed: false,
        canProceedReason: 'VERSION_CONFLICT: canonical version drifted from review state',
      };
    }

    // AC4: applied steps check.
    const alreadyApplied = checkpointSnapshot.state === 'COMPLETED';
    if (alreadyApplied) {
      return {
        reviewEntryId: entry.reviewEntryId,
        checkpointState: checkpointSnapshot.state,
        appliedSteps: checkpointSnapshot.appliedSteps,
        revalidatedMappings: true,
        contextVersion: checkpointSnapshot.canonicalVersion ?? null,
        canProceed: false,
        canProceedReason: 'ALREADY_APPLIED: checkpoint COMPLETED — no mutation to replay',
      };
    }

    return {
      reviewEntryId: entry.reviewEntryId,
      checkpointState: checkpointSnapshot.state,
      appliedSteps: checkpointSnapshot.appliedSteps,
      revalidatedMappings: true,
      contextVersion: checkpointSnapshot.canonicalVersion ?? null,
      canProceed: true,
    };
  }

  /**
   * Create review entry from intake checkpoint (called by orchestrator when
   * REVIEW_PENDING state is reached in CORE/1.6).
   */
  createFromIntake(args: {
    organizationId: string;
    intakeRevisionId: string;
    draftDigest: string;
    canonicalId?: string;
    canonicalVersion?: number;
  }): ReviewEntryOutput {
    const entry = createReviewEntry({
      organizationId: args.organizationId,
      intakeRevisionId: args.intakeRevisionId,
      draftDigest: args.draftDigest,
      ...(args.canonicalId !== undefined ? { canonicalId: args.canonicalId } : {}),
      ...(args.canonicalVersion !== undefined ? { canonicalVersion: args.canonicalVersion } : {}),
    });
    this.store.create(entry);
    return redactEntry(entry);
  }
}
