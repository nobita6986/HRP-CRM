/**
 * mapping/mapping-service.ts — CORE/1.5
 *
 * Mapping service: resolves external contact → canonical target (Talent/Client).
 *
 * Policy (Backlog §Task 1.5 AC):
 *  - UNKNOWN/POSSIBLE mapping giữ receipt + review, không ép target.
 *  - Talent/Client branches tách (Client domain PROPOSED/UNAVAILABLE).
 *  - Chatwoot hrp_* attributes không được dùng làm nguồn đáng tin
 *    để thay canonical target (AC3).
 *  - Out-of-order / mapping revision đổi không áp dụng sai target.
 *  - Reconciliation hoặc chuyển review.
 *
 * Triển khai:
 *  - Lookup ExternalContactLink từ integration store.
 *  - EXACT_MATCH → resolve LaborProfileId (Talent) hoặc ClientContactId (Client).
 *  - POSSIBLE_MATCH → tạo review receipt, không apply.
 *  - UNRESOLVED → tạo review receipt, không apply.
 *  - No link found → UNRESOLVED.
 *
 * Marker:
 *  - Đây là fixture/dev contract; không tuyên bố đã xác minh mapping
 *    semantics provider thật.
 */
import type { InboundEvent } from '../normalizer/event-normalizer.js';
import type { ClassificationResult } from '../firewall/semantic-firewall.js';

/* ───────────────────────────────────────────────────────────────────────────
 * Mapping decision result.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Target reference after mapping resolution. */
export interface MappingResolution {
  /** Unified mapping state. */
  state: 'EXACT_MATCH' | 'POSSIBLE_MATCH' | 'UNRESOLVED';
  /** Labor profile ID — only if state = EXACT_MATCH and targetBranch = TALENT. */
  laborProfileId: string | null;
  /** Labor profile version — only if EXACT_MATCH + TALENT. */
  laborProfileVersion: number | null;
  /** Client contact ID — only if state = EXACT_MATCH and targetBranch = CLIENT. */
  clientContactId: string | null;
  /** Client contact version — only if EXACT_MATCH + CLIENT. */
  clientContactVersion: number | null;
  /**
   * Review queue entry — created if POSSIBLE_MATCH or UNRESOLVED.
   * Null if EXACT_MATCH.
   */
  reviewQueueEntryId: string | null;
  /**
   * Whether to create a canonical profile from this event.
   * True only for EXACT_MATCH with high confidence.
   */
  createProfile: boolean;
}

/**
 * Mapping service result.
 */
export interface MappingResult {
  /** Resolution of the mapping. */
  resolution: MappingResolution;
  /**
   * Action to take based on mapping + classification.
   * Determines whether to call gateway and which command.
   */
  action: MappingAction;
  /**
   * Whether this event should be processed.
   * False if BLOCKED or if mapping prevents action.
   */
  shouldProcess: boolean;
}

/** Action to take after mapping. */
export type MappingAction =
  /**
   * Call gateway command for canonical action.
   * Only for AUTHORITATIVE + EXACT_MATCH.
   */
  | { type: 'CALL_GATEWAY'; command: string; targetBranch: 'TALENT' | 'CLIENT' }
  /**
   * Create review receipt. For POSSIBLE_MATCH or UNRESOLVED.
   * Event is kept, action deferred.
   */
  | { type: 'CREATE_REVIEW' }
  /**
   * Skip processing — echo, private note, metadata events.
   * Non-authoritative or blocked.
   */
  | { type: 'SKIP' }
  /**
   * Mapping blocked — spoofed attributes or out-of-order / mapping revision.
   * Event is logged but no action taken.
   */
  | { type: 'BLOCKED' };

/* ───────────────────────────────────────────────────────────────────────────
 * Mapping service interface.
 *
 * In production: reads ExternalContactLink from integration-store.
 * In mock/test: returns fixture-based resolution.
 * ─────────────────────────────────────────────────────────────────────────── */
export interface MappingService {
  /**
   * Resolve external contact to canonical target.
   *
   * Input: external contact hints from InboundEvent
   * Output: MappingResult
   *
   * Policy:
   *  - EXACT_MATCH (high confidence): resolve LaborProfileId/ClientContactId.
   *  - POSSIBLE_MATCH: create review queue entry, no mutation.
   *  - UNRESOLVED: create review queue entry, no mutation.
   *  - No link found: UNRESOLVED.
   */
  resolve(args: {
    event: InboundEvent;
    classification: ClassificationResult;
  }): Promise<MappingResult>;

  /**
   * Check if mapping revision changed since last processing.
   * Used for AC4: out-of-order / mapping revision changed → BLOCKED.
   */
  checkMappingRevision(args: {
    externalContactId: string;
    eventWatermark: string;
  }): Promise<{ changed: boolean; currentVersion: number }>;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Mock mapping service — fixture-based deterministic resolution.
 *
 * Deterministic by event identity + scenario.
 * ─────────────────────────────────────────────────────────────────────────── */

export type MappingScenario =
  | 'EXACT_MATCH'   // Contact already linked to LaborProfile
  | 'POSSIBLE_MATCH' // Contact ambiguous → review needed
  | 'UNRESOLVED'    // No mapping found → review needed
  | 'NO_LINK';       // No link record → UNRESOLVED

interface MockMappingOptions {
  scenario?: MappingScenario;
  /** Deterministic clock for ID generation. */
  now?: () => number;
  /**
   * Mapping aggregate version — for out-of-order detection.
   * If eventWatermark is older than this version, mapping revision changed.
   */
  mappingVersion?: number;
  /** Simulate mapping revision changed (AC4). */
  simulateRevisionChange?: boolean;
}

const DEFAULT_SCENARIO: MappingScenario = 'UNRESOLVED';

let _mockCounter = 0;
function mockId(prefix: string, now: () => number): string {
  _mockCounter += 1;
  return `${prefix}-${now().toString(36)}-${_mockCounter.toString(36)}`;
}

/**
 * Create a mock mapping service for testing/deterministic scenarios.
 */
export function createMockMappingService(
  opts: MockMappingOptions = {},
): MappingService {
  const scenario = opts.scenario ?? DEFAULT_SCENARIO;
  const mappingVersion = opts.mappingVersion ?? 1;
  const simulateRevisionChange = opts.simulateRevisionChange ?? false;

  return {
    async resolve(args: { event: InboundEvent; classification: ClassificationResult }): Promise<MappingResult> {
      const { event, classification } = args;
      const now = opts.now ?? (() => Date.now());

      // NON_AUTHORITATIVE or BLOCKED → SKIP
      if (
        classification.classification === 'NON_AUTHORITATIVE' ||
        classification.classification === 'BLOCKED'
      ) {
        return {
          resolution: {
            state: 'UNRESOLVED',
            laborProfileId: null,
            laborProfileVersion: null,
            clientContactId: null,
            clientContactVersion: null,
            reviewQueueEntryId: null,
            createProfile: false,
          },
          action: { type: 'SKIP' },
          shouldProcess: false,
        };
      }

      // REVIEW_NEEDED → CREATE_REVIEW
      if (classification.classification === 'REVIEW_NEEDED') {
        const reviewId = mockId('rev', now);
        return {
          resolution: {
            state: event.contactHints.likelyTalent ? 'POSSIBLE_MATCH' : 'UNRESOLVED',
            laborProfileId: null,
            laborProfileVersion: null,
            clientContactId: null,
            clientContactVersion: null,
            reviewQueueEntryId: reviewId,
            createProfile: false,
          },
          action: { type: 'CREATE_REVIEW' },
          shouldProcess: true,
        };
      }

      // AUTHORITATIVE → resolve by scenario
      switch (scenario) {
        case 'EXACT_MATCH': {
          const laborProfileId = `lp-mock-${now().toString(36)}-${_mockCounter}`;
          const laborProfileVersion = 1;
          return {
            resolution: {
              state: 'EXACT_MATCH',
              laborProfileId,
              laborProfileVersion,
              clientContactId: null,
              clientContactVersion: null,
              reviewQueueEntryId: null,
              createProfile: true,
            },
            action: {
              type: 'CALL_GATEWAY',
              command: 'createOrMatchLaborProfile',
              targetBranch: 'TALENT',
            },
            shouldProcess: true,
          };
        }

        case 'POSSIBLE_MATCH': {
          const reviewId = mockId('rev', now);
          return {
            resolution: {
              state: 'POSSIBLE_MATCH',
              laborProfileId: null,
              laborProfileVersion: null,
              clientContactId: null,
              clientContactVersion: null,
              reviewQueueEntryId: reviewId,
              createProfile: false,
            },
            action: { type: 'CREATE_REVIEW' },
            shouldProcess: true,
          };
        }

        case 'UNRESOLVED':
        case 'NO_LINK':
        default: {
          const reviewId = mockId('rev', now);
          return {
            resolution: {
              state: 'UNRESOLVED',
              laborProfileId: null,
              laborProfileVersion: null,
              clientContactId: null,
              clientContactVersion: null,
              reviewQueueEntryId: reviewId,
              createProfile: false,
            },
            action: { type: 'CREATE_REVIEW' },
            shouldProcess: true,
          };
        }
      }
    },

    async checkMappingRevision(args: {
      externalContactId: string;
      eventWatermark: string;
    }): Promise<{ changed: boolean; currentVersion: number }> {
      if (simulateRevisionChange) {
        return { changed: true, currentVersion: mappingVersion + 1 };
      }
      return { changed: false, currentVersion: mappingVersion };
    },
  };
}

/* ───────────────────────────────────────────────────────────────────────────
 * Production mapping service stub.
 *
 * In production, this reads ExternalContactLink from integration-store
 * using the contact hints from the normalized event.
 *
 * Stub returns UNRESOLVED for all events (placeholder).
 * ─────────────────────────────────────────────────────────────────────────── */
export function createProductionMappingService(): MappingService {
  return {
    async resolve(args: { event: InboundEvent; classification: ClassificationResult }): Promise<MappingResult> {
      const { event, classification } = args;

      // Default: UNRESOLVED for all events (needs real store lookup)
      return {
        resolution: {
          state: 'UNRESOLVED',
          laborProfileId: null,
          laborProfileVersion: null,
          clientContactId: null,
          clientContactVersion: null,
          reviewQueueEntryId: null,
          createProfile: false,
        },
        action: { type: 'CREATE_REVIEW' },
        shouldProcess: true,
      };
    },

    async checkMappingRevision(args: {
      externalContactId: string;
      eventWatermark: string;
    }): Promise<{ changed: boolean; currentVersion: number }> {
      // Placeholder: no revision tracking
      return { changed: false, currentVersion: 0 };
    },
  };
}
