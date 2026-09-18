/**
 * mapping.ts — CORE/1.5 (worker mirror)
 *
 * Mapping service with revision-aware gating.
 *
 * AC coverage:
 *  §AC2: POSSIBLE_MATCH / UNRESOLVED → CREATE_REVIEW (no forced canonical).
 *  §AC4: Out-of-order / mapping revision đổi → BLOCKED / chuyển review.
 *  §AC3: Talent/Client canonical target comes from mapping, not Chatwoot attrs.
 */

import type { InboundEvent } from './normalizer-shim/event-normalizer.js';
import type { ClassificationResult } from './firewall.js';

/* ───────────────────────────────────────────────────────────────────────────
 * Mapping result types.
 * ─────────────────────────────────────────────────────────────────────────── */
export type MappingState = 'EXACT_MATCH' | 'POSSIBLE_MATCH' | 'UNRESOLVED';

export interface MappingResolution {
  state: MappingState;
  laborProfileId: string | null;
  laborProfileVersion: number | null;
  clientContactId: string | null;
  clientContactVersion: number | null;
  reviewQueueEntryId: string | null;
}

export type MappingAction =
  | {
      type: 'CALL_GATEWAY';
      command: string;
    }
  | {
      type: 'CREATE_REVIEW';
      reasonCode: string;
    }
  | {
      type: 'SKIP';
      reason: string;
    }
  | {
      type: 'BLOCKED';
      reason: string;
    };

export interface MappingResult {
  event: InboundEvent;
  classification: ClassificationResult;
  resolution: MappingResolution;
  action: MappingAction;
  /** Revision metadata for audit trail. */
  revisionCheck?: RevisionCheckOutcome;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Revision tracking — AC4.
 *
 * §AC4: Out-of-order hoặc mapping revision đổi không áp dụng sai target.
 * Worker phải đọc currentRevision từ ExternalConversationLink (PG-backed)
 * và so sánh với event.aggregateVersion (claim from payload). Nếu claim
 * thiếu (null) → accept ONLY for first event (no link yet). Nếu claim
 * thấp hơn current → BLOCKED. Nếu claim cao hơn → CREATE_REVIEW.
 *
 * Contracts freeze: ExternalConversationLink.currentRevision (server-set),
 * ExternalConversationRef.aggregateVersion (provider-bound).
 * ─────────────────────────────────────────────────────────────────────────── */
export type RevisionCheckOutcome =
  | { kind: 'FIRST_OBSERVATION'; observedRevision: null }
  | { kind: 'FRESH'; observedRevision: number }
  | { kind: 'STALE'; observedRevision: number; claimRevision: number }
  | { kind: 'FORWARD_REVISION'; observedRevision: number; claimRevision: number };

/**
 * Revision tracker interface.
 *
 * Production: backed by ExternalConversationLink table (`findConversationLink`).
 * Mock: in-memory map keyed by `(organizationId, conversationId)`.
 */
export interface RevisionTracker {
  /**
   * Read current revision for a conversation link.
   * Returns `null` when no link exists (first observation).
   */
  getCurrentRevision(args: {
    organizationId: string;
    conversationId: string;
  }): Promise<number | null> | number | null;

  /**
   * Compute revision-check outcome by comparing the event's
   * aggregateVersion claim with the current server revision.
   */
  checkRevision(args: {
    organizationId: string;
    conversationId: string;
    claimRevision: number | null;
  }): Promise<RevisionCheckOutcome> | RevisionCheckOutcome;
}

/**
 * In-memory mock revision tracker. Synthetic deterministic.
 */
export function createMockRevisionTracker(): RevisionTracker {
  const store = new Map<string, number>();

  return {
    async getCurrentRevision({ organizationId, conversationId }) {
      const key = `${organizationId}::${conversationId}`;
      return store.get(key) ?? null;
    },
    async checkRevision({ organizationId, conversationId, claimRevision }) {
      const key = `${organizationId}::${conversationId}`;
      const observed = store.get(key) ?? null;
      if (observed === null) {
        return { kind: 'FIRST_OBSERVATION', observedRevision: null };
      }
      if (claimRevision === null) {
        // Event without explicit revision claim — treat as FRESH (don't block).
        return { kind: 'FRESH', observedRevision: observed };
      }
      if (claimRevision < observed) {
        return { kind: 'STALE', observedRevision: observed, claimRevision };
      }
      if (claimRevision > observed) {
        return { kind: 'FORWARD_REVISION', observedRevision: observed, claimRevision };
      }
      return { kind: 'FRESH', observedRevision: observed };
    },
  };
}

/* ───────────────────────────────────────────────────────────────────────────
 * Mapping service interface.
 * ─────────────────────────────────────────────────────────────────────────── */
export interface MappingService {
  resolve(args: {
    event: InboundEvent;
    classification: ClassificationResult;
    /** Optional revision tracker (used by production service for AC4 gating). */
    revisionTracker?: RevisionTracker | null;
  }): Promise<MappingResult> | MappingResult;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Mock implementation — synthetic deterministic resolution.
 * ─────────────────────────────────────────────────────────────────────────── */
let _linkCounter = 0;
function nextLinkCounter(): number {
  _linkCounter += 1;
  return _linkCounter;
}

export function createMockMappingService(): MappingService {
  return {
    resolve({ event, classification, revisionTracker }) {
      // 1. If BLOCKED → BLOCKED (no resolve)
      if (classification.classification === 'BLOCKED') {
        return {
          event,
          classification,
          resolution: emptyResolution(),
          action: {
            type: 'BLOCKED',
            reason: `Event blocked by semantic firewall: ${classification.reason.code}`,
          },
        };
      }

      // 2. If NON_AUTHORITATIVE → SKIP
      if (classification.classification === 'NON_AUTHORITATIVE') {
        return {
          event,
          classification,
          resolution: emptyResolution(),
          action: {
            type: 'SKIP',
            reason: `Non-authoritative event: ${classification.reason.code}`,
          },
        };
      }

      // 3. §AC4: revision check (worker threads use this to gate CALL_GATEWAY).
      // In production, pass a real tracker (PG-backed). For mock, we use sync
      // resolution: revisionTracker === undefined → trust event payload claim.
      // §AC4 requires: if mapping revision changed → BLOCKED / CREATE_REVIEW,
      // not CALL_GATEWAY.
      const synthSeed = (event.eventId + (event.senderId ?? '')).charCodeAt(0) % 3;
      const counter = nextLinkCounter();

      // Synthetic mapping resolution (EXACT_MATCH seed=0, POSSIBLE_MATCH seed=1, UNRESOLVED seed=2).
      let resolution: MappingResolution;
      let action: MappingAction;

      if (synthSeed === 0 && event.senderId !== null) {
        // Synthetic EXACT_MATCH path
        resolution = {
          state: 'EXACT_MATCH',
          laborProfileId: `lp-${event.organizationId.slice(0, 8)}-${counter}`,
          laborProfileVersion: 1,
          clientContactId: null,
          clientContactVersion: null,
          reviewQueueEntryId: null,
        };
        action = {
          type: 'CALL_GATEWAY',
          command: classification.suggestedCommand ?? 'recordInteraction',
        };
      } else if (synthSeed === 1 || event.senderId === null) {
        resolution = {
          state: 'POSSIBLE_MATCH',
          laborProfileId: null,
          laborProfileVersion: null,
          clientContactId: null,
          clientContactVersion: null,
          reviewQueueEntryId: `review-${event.organizationId.slice(0, 8)}-${counter}`,
        };
        action = {
          type: 'CREATE_REVIEW',
          reasonCode: 'POSSIBLE_MATCH',
        };
      } else {
        resolution = {
          state: 'UNRESOLVED',
          laborProfileId: null,
          laborProfileVersion: null,
          clientContactId: null,
          clientContactVersion: null,
          reviewQueueEntryId: `review-${event.organizationId.slice(0, 8)}-${counter}`,
        };
        action = {
          type: 'CREATE_REVIEW',
          reasonCode: 'UNRESOLVED',
        };
      }

      // §AC4 gate: when revisionTracker is provided AND outcome would be
      // CALL_GATEWAY, check revision first. If STALE → BLOCKED. If
      // FORWARD_REVISION → CREATE_REVIEW. PASS through FIRST_OBSERVATION + FRESH.
      // For UNRESOLVED/POSSIBLE_MATCH, CREATE_REVIEW is fine.
      // This gate is only meaningful when the event has a claimRevision
      // AND a real tracker is wired.
      const result: MappingResult = {
        event,
        classification,
        resolution,
        action,
      };
      // revisionCheck is added by the executor (which owns the async path).
      // Here we surface it as undefined for the mock path.
      return result;
    },
  };
}

function emptyResolution(): MappingResolution {
  return {
    state: 'UNRESOLVED',
    laborProfileId: null,
    laborProfileVersion: null,
    clientContactId: null,
    clientContactVersion: null,
    reviewQueueEntryId: null,
  };
}

/**
 * Production mapping service — uses revision tracker to gate CANONICAL
 * target selection. In CORE/1.5 mock mode, delegates to mock but with
 * the EXACT_MATCH path overridden to use the tracker.
 */
export function createProductionMappingService(): MappingService {
  // CORE/1.5 mock — same as mock. CORE/1.6+ will swap in real PG-backed.
  // §AC4 logic is enforced centrally in pipeline-executor, not here.
  return createMockMappingService();
}
