// src/review/wiring.ts — In-process wiring to CORE/1.7 review service (R4).
//
// Reads unresolved reviews from the CORE/1.7 review store (in-memory).
// Statically imports @hrp-engagement/integration-api/review — the integration-api
// package ships .d.ts for this surface, so we can use named imports directly.
//
// Boundaries:
//  - Permissions are checked here via canIdentityListUnresolved() (mirrors
//    CORE/1.7 canListReviews() using identity.role).
//  - audit/versioning are preserved by the upstream ReviewService entries
//    (returned with version, createdAt, scope).
//  - In-memory state is shared per process; restart clears.
//
// Side-effects: importing this module does NOT start a server. Only the
// reviewStore + ReviewService surface is imported (review service has no
// listen() side-effect on import).

import { reviewStore } from '@hrp-engagement/integration-api/review';
import type { MockIdentity } from '../orchestrator-wire.js';

export interface UnresolvedReviewEntry {
  reviewEntryId: string;
  organizationId: string;
  laborProfileId: string | null;
  channel: string;
  payload: Record<string, unknown>;
  createdAt: string;
  scope: string;
  status: 'PENDING' | 'IN_REVIEW' | 'UNRESOLVED';
  version: number;
}

export interface ListReviewsOptionsShape {
  organizationId: string;
  status?: 'PENDING' | 'IN_REVIEW' | 'UNRESOLVED';
  pageSize?: number;
}

/**
 * List unresolved reviews for a given identity.
 * Mirrors CORE/1.7 ReviewService.listForReviewer() boundary by filtering
 * reviewStore.list() to status === 'UNRESOLVED' for the identity's org.
 */
export async function listUnresolvedReviews(
  identity: MockIdentity,
  limit = 50,
): Promise<UnresolvedReviewEntry[]> {
  const opts: ListReviewsOptionsShape = {
    organizationId: identity.organizationId,
    status: 'UNRESOLVED',
    pageSize: limit,
  };
  const result = reviewStore.list(opts as unknown as Parameters<typeof reviewStore.list>[0]);
  const entries = (result?.entries ?? []) as unknown as Array<Record<string, unknown>>;
  return entries.map((e) => ({
    reviewEntryId: String(e.reviewEntryId ?? e.entryId ?? ''),
    organizationId: String(e.organizationId ?? ''),
    laborProfileId: (e.laborProfileId as string | null | undefined) ?? null,
    channel: String(e.channel ?? ''),
    payload: (e.payload as Record<string, unknown> | undefined) ?? {},
    createdAt: String(e.createdAt ?? new Date().toISOString()),
    scope: String(e.scope ?? ''),
    status: (e.status as 'PENDING' | 'IN_REVIEW' | 'UNRESOLVED' | undefined) ?? 'UNRESOLVED',
    version: typeof e.version === 'number' ? e.version : 1,
  }));
}

/**
 * Decides whether the identity may list reviews.
 * Mirrors CORE/1.7 canListReviews() — uses identity.role directly.
 */
export function canIdentityListUnresolved(identity: MockIdentity): boolean {
  return (
    identity.role === 'INTAKE_OPERATOR' ||
    identity.role === 'SUPERVISOR' ||
    identity.role === 'SYSTEM'
  );
}
