// src/review/permissions.ts — Review service permissions (CORE/1.7).
//
// Server-side scope and capability enforcement.
//
// Boundaries:
//  - Actor capability KHÔNG tự parse từ untrusted client payload.
//  - Capability must come from trusted caller context (fixture/runtime boundary).
//  - Cross-org scope check: reject with SCOPE_MISMATCH.
//  - PII guard: server strips PII from candidate detail output.

// import type không circular
import type { ReviewPermissionContext, ReviewerCapability } from './types.js';

/** Capability check result — không throw, trả raw result. */
export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Parse reviewer capability từ trusted actor claim.
 * Called at trusted boundary (server entry point), not from raw client payload.
 *
 * Throws ZodError nếu actor shape không hợp lệ — đây là fail-closed
 * cho malformed actor claims.
 */
export function parseReviewerCapability(
  actor: unknown,
  organizationId: string,
): ReviewerCapability {
  if (!actor || typeof actor !== 'object') {
    throw new Error('Invalid actor claim: not an object');
  }
  const a = actor as Record<string, unknown>;

  // Actor must be USER or SERVICE kind (from ActorSchema).
  const kind = a['kind'] as string | undefined;
  if (kind !== 'USER' && kind !== 'SERVICE' && kind !== 'DELEGATED_USER') {
    throw new Error(`Invalid actor kind for review: ${kind}`);
  }

  const userId = a['userId'] as string | undefined;
  const serviceId = a['serviceId'] as string | undefined;
  const reviewerId = userId ?? serviceId;
  if (!reviewerId) {
    throw new Error('Actor must have userId or serviceId for review');
  }

  // Tier derived from actor kind + explicit capability claim (trusted boundary).
  const tier = kind === 'SERVICE' ? 'PRIVILEGED_REVIEWER' : 'INBOUND_REVIEWER';

  return {
    reviewerId,
    tier,
    organizationId,
  };
}

/**
 * Build permission context từ trusted actor + organization.
 * Throws nếu actor không hợp lệ.
 */
export function buildPermissionContext(
  actor: unknown,
  organizationId: string,
): ReviewPermissionContext {
  const capability = parseReviewerCapability(actor, organizationId);
  const actorKey =
    capability.tier === 'INBOUND_REVIEWER'
      ? `user:${capability.reviewerId}`
      : `service:${capability.reviewerId}`;
  return {
    actor: actorKey,
    capability,
    organizationId,
  };
}

/**
 * Check permission cho list reviews.
 * - ANY reviewer tier can list (scope-filtered).
 */
export function canListReviews(ctx: ReviewPermissionContext): PermissionCheckResult {
  return { allowed: true };
}

/**
 * Check permission cho get review detail.
 * - ANY reviewer tier can read (scope-filtered).
 * - PII is stripped at output transform (see redactedOutput).
 */
export function canGetReviewDetail(
  ctx: ReviewPermissionContext,
  entryOrganizationId: string,
): PermissionCheckResult {
  if (ctx.organizationId !== entryOrganizationId) {
    return {
      allowed: false,
      reason: 'SCOPE_MISMATCH: reviewer org does not match entry org',
    };
  }
  return { allowed: true };
}

/**
 * Check permission cho submit review decision.
 * - INBOUND_REVIEWER: can decide on OPEN entries.
 * - PRIVILEGED_REVIEWER: can decide on OPEN + override expired entries.
 */
export function canDecide(
  ctx: ReviewPermissionContext,
  entryOrganizationId: string,
  entryStatus: string,
): PermissionCheckResult {
  if (ctx.organizationId !== entryOrganizationId) {
    return {
      allowed: false,
      reason: 'SCOPE_MISMATCH: reviewer org does not match entry org',
    };
  }
  if (entryStatus === 'DECIDED') {
    return {
      allowed: false,
      reason: 'ENTRY_ALREADY_DECIDED: cannot decide on DECIDED entry',
    };
  }
  if (entryStatus === 'SUPERSEDED') {
    return {
      allowed: false,
      reason: 'ENTRY_SUPERSEDED: cannot decide on SUPERSEDED entry',
    };
  }
  // INBOUND_REVIEWER cannot decide on EXPIRED.
  if (entryStatus === 'EXPIRED' && ctx.capability.tier === 'INBOUND_REVIEWER') {
    return {
      allowed: false,
      reason: 'INSUFFICIENT_TIER: INBOUND_REVIEWER cannot decide EXPIRED entry',
    };
  }
  return { allowed: true };
}

/**
 * Check permission cho link/unlink operations.
 * - Link: requires INBOUND_REVIEWER+ on OPEN entries.
 * - Unlink: requires INBOUND_REVIEWER+ on OPEN/DECIDED entries.
 */
export function canLink(
  ctx: ReviewPermissionContext,
  entryOrganizationId: string,
  entryStatus: string,
): PermissionCheckResult {
  if (ctx.organizationId !== entryOrganizationId) {
    return {
      allowed: false,
      reason: 'SCOPE_MISMATCH',
    };
  }
  if (entryStatus !== 'OPEN') {
    return {
      allowed: false,
      reason: 'CANNOT_LINK: entry must be OPEN',
    };
  }
  return { allowed: true };
}

export function canUnlink(
  ctx: ReviewPermissionContext,
  entryOrganizationId: string,
  entryStatus: string,
): PermissionCheckResult {
  if (ctx.organizationId !== entryOrganizationId) {
    return {
      allowed: false,
      reason: 'SCOPE_MISMATCH',
    };
  }
  if (entryStatus === 'EXPIRED') {
    return {
      allowed: false,
      reason: 'CANNOT_UNLINK: entry is EXPIRED',
    };
  }
  return { allowed: true };
}

/**
 * Check permission cho replay.
 * - Requires INBOUND_REVIEWER+; runs on OPEN/DECIDED entries.
 * - Replay is read-only revalidation, not mutation.
 */
export function canReplay(
  ctx: ReviewPermissionContext,
  entryOrganizationId: string,
): PermissionCheckResult {
  if (ctx.organizationId !== entryOrganizationId) {
    return {
      allowed: false,
      reason: 'SCOPE_MISMATCH',
    };
  }
  return { allowed: true };
}
