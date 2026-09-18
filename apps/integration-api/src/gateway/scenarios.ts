/**
 * gateway/scenarios.ts — Scenario fixtures cho deterministic mock.
 *
 * CORE/1.1 (Backlog §Task 1.1):
 *  - EXACT/POSSIBLE/NEW theo fixture ID; cùng fixture/clock cho cùng kết quả.
 *  - Mô phỏng timeout trước apply, timeout sau apply,
 *    permission/policy/version/idempotency conflict, malformed dependency.
 *  - One-active-case là SCENARIO SIMULATION — KHÔNG bằng chứng concurrency
 *    hay policy HRP thật.
 *  - Privileged merge capability, EFFECTIVE, Client domain, managed modes
 *    vẫn PROPOSED/UNAVAILABLE (Q-19/33/34/37/23) — không fake success.
 *
 * T1 cố tình KHÔNG xây identity/domain policy thật; chỉ pick outcome
 * theo fixture.
 */
import type { ScenarioFixture, ScenarioId } from './types.js';
import type { MatchingOutcome } from '@hrp-engagement/contracts';

/* ───────────────────────────────────────────────────────────────────────────
 * Common helpers.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Build EXACT/POSSIBLE/NEW createOrMatch data theo outcome. */
function createOrMatchData(outcome: MatchingOutcome, opts?: {
  laborProfileId?: string;
  reviewRef?: string;
  version?: number;
}): Record<string, unknown> {
  const base: Record<string, unknown> = { matchingOutcome: outcome };
  if (opts?.laborProfileId) base.laborProfileId = opts.laborProfileId;
  if (opts?.reviewRef) base.reviewRef = opts.reviewRef;
  if (opts?.version !== undefined) base.version = opts.version;
  return base;
}

/** Build one-active-case data with explicit scenario note. */
function oneActiveCaseData(
  outcome: MatchingOutcome,
  laborProfileId: string,
  activeCaseId: string,
): Record<string, unknown> {
  return {
    matchingOutcome: outcome,
    laborProfileId,
    activeCaseId,
    note: 'SCENARIO_SIMULATION_NOT_CONCURRENCY_PROOF',
  };
}

/* ───────────────────────────────────────────────────────────────────────────
 * Tier allowlist cho scenario — kiểm soát capability.
 * Merge/privileged methods chỉ PRIVILEGED_MERGE tier mới chạy được.
 * INBOUND_DEFAULT chặn merge/resolve methods (Capability matrix xem
 * contracts/commands/gateway.ts).
 * ─────────────────────────────────────────────────────────────────────────── */

const ALL_TIERS: ReadonlyArray<'INBOUND_DEFAULT' | 'INBOUND_REVIEWER' | 'PRIVILEGED_MERGE'> = [
  'INBOUND_DEFAULT',
  'INBOUND_REVIEWER',
  'PRIVILEGED_MERGE',
];

const NON_PRIVILEGED: ReadonlyArray<'INBOUND_DEFAULT' | 'INBOUND_REVIEWER' | 'PRIVILEGED_MERGE'> = [
  'INBOUND_DEFAULT',
  'INBOUND_REVIEWER',
];

const ALL_METHODS = [
  'createOrMatchLaborProfile',
  'updateLaborProfile',
  'openPlacementCase',
  'updatePlacementCase',
  'closePlacementCase',
  'recordInteraction',
  'recordClientInteraction',
  'updateLaborAvailability',
  'commitSuppression',
  'dispatchAuthorizationCheck',
  'createNextAction',
  'updateNextAction',
  'queryOutboxDelivery',
  'commitReviewDecision',
  'resolvePossibleMatch',
  'supersedeReviewStatus',
  'mergeLaborProfiles',
] as const;

const NON_PRIVILEGED_METHODS = ALL_METHODS.filter(
  (m) => m !== 'mergeLaborProfiles' && m !== 'resolvePossibleMatch' && m !== 'commitReviewDecision' && m !== 'supersedeReviewStatus',
);

/* ───────────────────────────────────────────────────────────────────────────
 * Scenario fixtures.
 * ─────────────────────────────────────────────────────────────────────────── */

export const SCENARIOS: Readonly<Record<ScenarioId, ScenarioFixture>> = Object.freeze({
  // ── EXACT/POSSIBLE/NEW theo fixture ID (Backlog §1.1 AC #1) ────────────
  EXACT_MATCH_SUCCESS: {
    id: 'EXACT_MATCH_SUCCESS',
    allowedTiers: NON_PRIVILEGED,
    allowedMethods: ['createOrMatchLaborProfile'],
    outcome: 'APPLIED',
    data: createOrMatchData('EXACT_MATCH', {
      laborProfileId: 'lp-fixture-exact-001',
      version: 1,
    }),
  },
  POSSIBLE_MATCH_REVIEW: {
    id: 'POSSIBLE_MATCH_REVIEW',
    allowedTiers: NON_PRIVILEGED,
    allowedMethods: ['createOrMatchLaborProfile'],
    outcome: 'APPLIED',
    data: createOrMatchData('POSSIBLE_MATCH', {
      reviewRef: 'rev-fixture-possible-001',
    }),
  },
  NEW_PROFILE_CREATED: {
    id: 'NEW_PROFILE_CREATED',
    allowedTiers: NON_PRIVILEGED,
    allowedMethods: ['createOrMatchLaborProfile'],
    outcome: 'APPLIED',
    data: createOrMatchData('NEW_PROFILE', {
      laborProfileId: 'lp-fixture-new-001',
      version: 1,
    }),
  },

  // ── Timeout trước/sau apply (Backlog §1.1 AC #2) ───────────────────────
  TIMEOUT_BEFORE_APPLY: {
    id: 'TIMEOUT_BEFORE_APPLY',
    allowedTiers: ALL_TIERS,
    allowedMethods: NON_PRIVILEGED_METHODS,
    outcome: 'FAILED',
    errorCode: 'DEPENDENCY_UNAVAILABLE',
    latencyMs: 100,
  },
  TIMEOUT_AFTER_APPLY: {
    id: 'TIMEOUT_AFTER_APPLY',
    allowedTiers: ALL_TIERS,
    allowedMethods: ['openPlacementCase', 'updatePlacementCase'],
    /**
     * Server đã APPLIED commit rồi mới mất kết nối; trả ACCEPTED (queue retry).
     * Caller dùng idempotency key để retry; ledger cache cho cùng kết quả.
     */
    outcome: 'ACCEPTED',
  },

  // ── Permission / policy / version / idempotency conflicts ───────────────
  PERMISSION_DENIED: {
    id: 'PERMISSION_DENIED',
    allowedTiers: ALL_TIERS,
    allowedMethods: ALL_METHODS,
    outcome: 'FAILED',
    errorCode: 'FORBIDDEN',
  },
  POLICY_REJECTION: {
    id: 'POLICY_REJECTION',
    allowedTiers: NON_PRIVILEGED,
    allowedMethods: ['commitSuppression', 'recordInteraction'],
    outcome: 'FAILED',
    errorCode: 'POLICY_REJECTION',
  },
  VERSION_CONFLICT: {
    id: 'VERSION_CONFLICT',
    allowedTiers: ALL_TIERS,
    allowedMethods: ['updatePlacementCase', 'updateLaborProfile'],
    outcome: 'FAILED',
    errorCode: 'VERSION_CONFLICT',
  },
  IDEMPOTENCY_CONFLICT: {
    /**
     * Note: scenario này KHÔNG trigger conflict tự động. Conflict chỉ xảy ra
     * khi caller gửi cùng idempotencyKey với payload KHÁC. Mock detect ở
     * `mock-gateway.ts`. Fixture này để log/demo — không ảnh hưởng path.
     */
    id: 'IDEMPOTENCY_CONFLICT',
    allowedTiers: ALL_TIERS,
    allowedMethods: ALL_METHODS,
    outcome: 'FAILED',
    errorCode: 'IDEMPOTENCY_CONFLICT',
  },

  // ── Malformed dependency response (Backlog §1.1 AC #2) ──────────────────
  MALFORMED_DEPENDENCY_RESPONSE: {
    id: 'MALFORMED_DEPENDENCY_RESPONSE',
    allowedTiers: ALL_TIERS,
    allowedMethods: NON_PRIVILEGED_METHODS,
    outcome: 'FAILED',
    errorCode: 'UNKNOWN_COMMAND_OUTCOME',
  },

  // ── One-active-case scenario simulation (Backlog §1.1 AC #5) ───────────
  ONE_ACTIVE_CASE: {
    id: 'ONE_ACTIVE_CASE',
    allowedTiers: NON_PRIVILEGED,
    allowedMethods: ['createOrMatchLaborProfile'],
    outcome: 'APPLIED',
    data: oneActiveCaseData('EXACT_MATCH', 'lp-fixture-oac-001', 'case-fixture-oac-001'),
  },

  // ── Case close + placement proposed (reference AC §1.6 follow-on) ───────
  CLOSED_CASE_SUCCESS: {
    id: 'CLOSED_CASE_SUCCESS',
    allowedTiers: NON_PRIVILEGED,
    allowedMethods: ['closePlacementCase'],
    outcome: 'APPLIED',
    data: {
      status: 'CLOSED',
      caseId: 'case-fixture-closed-001',
      closeReason: 'SUCCESS',
      closedAt: '2026-09-14T00:00:00.000Z',
      note: 'SCENARIO_FIXTURE — SUCCESS ≠ EFFECTIVE; placement EFFECTIVE là workflow managed mode (Q-19).',
    },
  },
  DNC_REJECTED: {
    id: 'DNC_REJECTED',
    allowedTiers: NON_PRIVILEGED,
    allowedMethods: ['recordInteraction', 'commitSuppression'],
    outcome: 'FAILED',
    errorCode: 'POLICY_REJECTION',
  },
  SUPPRESSION_REQUIRED: {
    id: 'SUPPRESSION_REQUIRED',
    allowedTiers: NON_PRIVILEGED,
    allowedMethods: ['dispatchAuthorizationCheck'],
    outcome: 'APPLIED',
    data: {
      status: 'SUPPRESSED',
      note: 'SCENARIO_FIXTURE — không tự fake gỡ DNC; runtime HRP gate enforce.',
    },
  },
  PLACEMENT_PROPOSED: {
    id: 'PLACEMENT_PROPOSED',
    allowedTiers: NON_PRIVILEGED,
    allowedMethods: ['updatePlacementCase'],
    outcome: 'APPLIED',
    data: {
      intendedStage: 'PROPOSED',
      caseId: 'case-fixture-proposed-001',
      version: 2,
      note: 'SCENARIO_FIXTURE — stage PROPOSED; EFFECTED đòi hỏi managed mode policy (Q-19).',
    },
  },

  // ── Outbox / dependency / rate-limit ────────────────────────────────────
  OUTBOX_RECEIPT_DURABLE: {
    id: 'OUTBOX_RECEIPT_DURABLE',
    allowedTiers: ALL_TIERS,
    allowedMethods: NON_PRIVILEGED_METHODS,
    outcome: 'ACCEPTED',
  },
  DEPENDENCY_UNAVAILABLE: {
    id: 'DEPENDENCY_UNAVAILABLE',
    allowedTiers: ALL_TIERS,
    allowedMethods: ALL_METHODS,
    outcome: 'FAILED',
    errorCode: 'DEPENDENCY_UNAVAILABLE',
  },
  RATE_LIMITED: {
    id: 'RATE_LIMITED',
    allowedTiers: ALL_TIERS,
    allowedMethods: ALL_METHODS,
    outcome: 'FAILED',
    errorCode: 'RATE_LIMITED',
  },
});
