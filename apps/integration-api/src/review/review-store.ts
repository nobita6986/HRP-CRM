// src/review/review-store.ts — In-memory review store (CORE/1.7).
//
// Mock/synthetic store — in-memory Map. NOT production durable storage.
// Purpose: CORE/1.7 review service skeleton.
//
// Boundaries:
//  - In-memory Map per process; restart clears all entries.
//  - No persistence; no PG (CORE/1.3/1.6 checkpoint is separate).
//  - Entries keyed by (organizationId, reviewEntryId) — scoped.
//  - No deletion (append-only audit log).
//
// No merge capability: this store only manages review entries,
// links, and decisions. It does NOT expose mergeLaborProfiles.

import type {
  ReviewEntry,
  ReviewLink,
  ReviewDecision,
  ReviewAuditEntry,
  ReviewEntryStatus,
} from './types.js';

export interface ReviewStore {
  create(entry: ReviewEntry): ReviewEntry;
  findById(orgId: string, entryId: string): ReviewEntry | null;
  /** Find entry by ID without org scope — for cross-org FORBIDDEN detection. */
  findByIdAnyOrg(entryId: string): ReviewEntry | null;
  findByIntakeRevision(orgId: string, revisionId: string): ReviewEntry | null;
  update(entry: ReviewEntry): ReviewEntry;
  list(opts: ListReviewsOptions): ListReviewsResult;
}

export interface ListReviewsOptions {
  organizationId: string;
  status?: ReviewEntryStatus;
  cursor?: string;
  pageSize?: number;
}

export interface ListReviewsResult {
  entries: ReviewEntry[];
  nextCursor: string | null;
  totalEstimate: number;
}

/** Deterministic ID generator for tests / synthetic use. */
let _idCounter = 0;
export function resetIdCounter(): void {
  _idCounter = 0;
}
function nextId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${_idCounter.toString().padStart(4, '0')}`;
}

/** Deterministic decisionId — matches nextId pattern, separate counter. */
let _decisionCounter = 0;
export function nextDecisionId(): string {
  _decisionCounter += 1;
  return `dec-${_decisionCounter.toString().padStart(4, '0')}`;
}

/** Deterministic linkId — matches nextId pattern, separate counter. */
let _linkCounter = 0;
export function nextLinkId(): string {
  _linkCounter += 1;
  return `lnk-${_linkCounter.toString().padStart(4, '0')}`;
}

/** Reset all synthetic counters (test setup helper). */
export function resetAllCounters(): void {
  _idCounter = 0;
  _decisionCounter = 0;
  _linkCounter = 0;
}

/**
 * Generate audit entry for append-only log.
 */
export function createAuditEntry(args: {
  actor: string;
  action: string;
  detail?: Record<string, unknown>;
}): ReviewAuditEntry {
  return {
    auditId: nextId('audit'),
    at: new Date().toISOString(),
    actor: args.actor,
    action: args.action,
    ...(args.detail !== undefined ? { detail: args.detail } : {}),
  };
}

/** In-memory review store — singleton per process. */
class InMemoryReviewStore implements ReviewStore {
  private readonly store = new Map<string, ReviewEntry>();

  /** Key: `${orgId}:${entryId}` */
  private static key(orgId: string, entryId: string): string {
    return `${orgId}:${entryId}`;
  }

  create(entry: ReviewEntry): ReviewEntry {
    const k = InMemoryReviewStore.key(entry.organizationId, entry.reviewEntryId);
    if (this.store.has(k)) {
      throw new Error(`REVIEW_ENTRY_EXISTS: ${entry.reviewEntryId}`);
    }
    this.store.set(k, { ...entry });
    return { ...entry };
  }

  findById(orgId: string, entryId: string): ReviewEntry | null {
    const k = InMemoryReviewStore.key(orgId, entryId);
    const e = this.store.get(k);
    return e ? { ...e } : null;
  }

  findByIdAnyOrg(entryId: string): ReviewEntry | null {
    for (const e of this.store.values()) {
      if (e.reviewEntryId === entryId) {
        return { ...e };
      }
    }
    return null;
  }

  findByIntakeRevision(orgId: string, revisionId: string): ReviewEntry | null {
    for (const e of this.store.values()) {
      if (e.organizationId === orgId && e.intakeRevisionId === revisionId) {
        return { ...e };
      }
    }
    return null;
  }

  update(entry: ReviewEntry): ReviewEntry {
    const k = InMemoryReviewStore.key(entry.organizationId, entry.reviewEntryId);
    if (!this.store.has(k)) {
      throw new Error(`REVIEW_ENTRY_NOT_FOUND: ${entry.reviewEntryId}`);
    }
    const updated = { ...entry, updatedAt: new Date().toISOString() };
    this.store.set(k, updated);
    return { ...updated };
  }

  list(opts: ListReviewsOptions): ListReviewsResult {
    const { organizationId, status, cursor, pageSize = 20 } = opts;
    const entries: ReviewEntry[] = [];

    for (const e of this.store.values()) {
      if (e.organizationId !== organizationId) continue;
      if (status && e.status !== status) continue;
      entries.push({ ...e });
    }

    // Sort by createdAt desc.
    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    // Cursor pagination: cursor = entryId of last seen item.
    let start = 0;
    if (cursor) {
      const idx = entries.findIndex((e) => e.reviewEntryId === cursor);
      if (idx >= 0) start = idx + 1;
    }

    const page = entries.slice(start, start + pageSize);
    const nextCursor =
      start + pageSize < entries.length ? page[page.length - 1]?.reviewEntryId ?? null : null;

    return {
      entries: page,
      nextCursor,
      totalEstimate: entries.length,
    };
  }

  /** Debug: list all entries (for test introspection). */
  entries(): ReviewEntry[] {
    return Array.from(this.store.values()).map((e) => ({ ...e }));
  }

  /** Debug: clear all (for test isolation). */
  clear(): void {
    this.store.clear();
  }
}

/** Singleton instance — accessible for test introspection. */
export const reviewStore = new InMemoryReviewStore();

/** Create a new review entry (factory). */
export function createReviewEntry(args: {
  organizationId: string;
  intakeRevisionId: string;
  canonicalId?: string;
  canonicalVersion?: number;
  draftDigest: string;
}): ReviewEntry {
  const now = new Date().toISOString();
  return {
    reviewEntryId: nextId('rev'),
    organizationId: args.organizationId,
    intakeRevisionId: args.intakeRevisionId,
    ...(args.canonicalId !== undefined ? { canonicalId: args.canonicalId } : {}),
    ...(args.canonicalVersion !== undefined ? { canonicalVersion: args.canonicalVersion } : {}),
    draftDigest: args.draftDigest,
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [createAuditEntry({ actor: 'system', action: 'CREATED' })],
    createdAt: now,
    updatedAt: now,
  };
}

/** Apply decision to entry — returns updated entry. */
export function applyDecision(
  entry: ReviewEntry,
  decision: ReviewDecision,
): ReviewEntry {
  const now = new Date().toISOString();
  return {
    ...entry,
    status: 'DECIDED',
    decision,
    decisionVersion: decision.baseVersion,
    auditLog: [
      ...entry.auditLog,
      createAuditEntry({
        actor: decision.reviewer.reviewerId,
        action: `DECISION:${decision.kind}`,
        detail: {
          reason: decision.reason,
          baseVersion: decision.baseVersion,
          expectedEntryVersion: decision.expectedEntryVersion,
        },
      }),
    ],
    updatedAt: now,
  };
}

/** Add link to entry. */
export function addLink(entry: ReviewEntry, link: ReviewLink): ReviewEntry {
  return {
    ...entry,
    anchorRefs: [...entry.anchorRefs, link],
    auditLog: [
      ...entry.auditLog,
      createAuditEntry({
        actor: link.addedBy,
        action: `LINK:${link.targetKind}`,
        detail: { linkId: link.linkId, targetRef: link.targetRef },
      }),
    ],
    updatedAt: new Date().toISOString(),
  };
}

/** Remove link from entry. */
export function removeLink(entry: ReviewEntry, linkId: string, removedBy: string): ReviewEntry {
  return {
    ...entry,
    anchorRefs: entry.anchorRefs.filter((l) => l.linkId !== linkId),
    auditLog: [
      ...entry.auditLog,
      createAuditEntry({
        actor: removedBy,
        action: 'UNLINK',
        detail: { linkId },
      }),
    ],
    updatedAt: new Date().toISOString(),
  };
}
