// src/orchestrator/steps.ts — Step definitions + step context (CORE/1.6).
//
// State machine: CONFIRM_VALIDATE → IDENTITY → PROFILE → CASE → AVAILABILITY.
// Each step:
//  - Idempotency: cùng (organizationId, stepKey) → cùng kết quả từ cache (gateway ledger).
//  - Fail-fast: error → state=FAILED|PARTIAL; appliedSteps ghi nhận.
//  - Resume: skip applied steps, retry từ failedStep.
//
// Notes:
//  - DNC KHÔNG thuộc full intake; tách sang dnc-handler.ts (Backlog §0.3a + §1.6 AC).
//  - EXACT outcome: profile step dùng fill-missing; idempotent → NOOP nếu đã match (KHÔNG tính created).
//  - POSSIBLE outcome: dừng để review; state → REVIEW_PENDING.
//  - NEW outcome: dùng canonicalId từ gateway (mock accepted policy).

import type { HrpGatewayCallResult } from '../gateway/types.js';
import type { HrpGatewayMethod, MatchingOutcome } from '@hrp-engagement/contracts';

export type StepName =
  | 'CONFIRM_VALIDATE'
  | 'IDENTITY'
  | 'PROFILE'
  | 'CASE'
  | 'AVAILABILITY';

/** Thứ tự step (linear; ngoại lệ POSSIBLE dừng ở IDENTITY). */
export const STEP_ORDER: ReadonlyArray<StepName> = [
  'CONFIRM_VALIDATE',
  'IDENTITY',
  'PROFILE',
  'CASE',
  'AVAILABILITY',
];

/** Identity outcome (3-valued). */
export type IdentityOutcomeKind = 'EXACT_MATCH' | 'POSSIBLE_MATCH' | 'NEW_PROFILE';

/** Identity step result. */
export interface IdentityStepResult {
  kind: IdentityOutcomeKind;
  /** EXACT_MATCH + NEW_PROFILE: canonicalId + version. POSSIBLE_MATCH: reviewRef. */
  canonicalId?: string;
  version?: number;
  reviewRef?: string;
  /** Raw gateway response (APPLIED/ACCEPTED) cho audit/debug. */
  gatewayResponse?: HrpGatewayCallResult;
}

/** Profile step result (fill-missing semantics). */
export interface ProfileStepResult {
  kind: 'APPLIED' | 'NOOP';
  canonicalId: string;
  newVersion?: number;
  currentVersion?: number;
  /** True nếu step không thay đổi gì (EXACT_MATCH đã có sẵn giá trị). */
  isNoOp: boolean;
}

/** Case step result. */
export interface CaseStepResult {
  canonicalId: string;
  version: number;
  appliedStage: string;
}

/** Availability step result. */
export interface AvailabilityStepResult {
  canonicalId: string;
  version: number;
  appliedAvailability: string;
  appliedAvailableFromDate: string | null;
}

/** Step input context — orchestrator builds from intake submission. */
export interface StepRunContext {
  organizationId: string;
  intakeRevisionId: string;
  /** SHA-256 hex 64 chars; bind confirmation. */
  draftDigest: string;
  /** Optional: target reference khi EXACT đã xác minh. */
  canonicalId?: string;
  canonicalVersion?: number;

  /** Intake fields (canonical shape cho step). */
  fullName: string;
  phone: string;
  citizenId: string;
  citizenAddress: string;
  contactAddress?: string;
  dob?: string;

  intent: {
    stage: string;
    availability: string;
    availableFromDate?: string;
  };

  /** Provenance for gateway call. */
  provider: string;
  connectionId: string;
  externalReference: string;

  correlationId: string;
  /** Per-step idempotencyKey (rebuilt from intakeRevisionId + stepName). */
  stepIdempotencyKey: string;
}

/** Gateway call wrapper (mock or real). */
export type GatewayCaller = (args: {
  organizationId: string;
  method: HrpGatewayMethod;
  idempotencyKey: string;
  correlationId: string;
  scenarioId: string;
  payload: unknown;
  /** B4: actor từ trusted caller context, truyền qua gateway call context
   *  (tương ứng envelope level per contracts). Optional cho backward compat —
   *  caller nào cần DNC/orchestrator auth audit PHẢI pass actor. */
  actor?: unknown;
}) => Promise<HrpGatewayCallResult>;

/** Build per-step idempotency key — derived, NOT per-attempt. */
export function buildStepIdempotencyKey(intakeRevisionId: string, step: StepName): string {
  return `intake:${intakeRevisionId}:${step}`;
}

/** Select scenario ID for identity step (deterministic). */
export function selectIdentityScenario(
  outcome: IdentityOutcomeKind,
  policy: 'ALLOW_NEW' | 'MATCH_ONLY' | 'REVIEW_REQUIRED',
): string {
  if (policy === 'REVIEW_REQUIRED') return 'POSSIBLE_MATCH_REVIEW';
  switch (outcome) {
    case 'EXACT_MATCH':
      return 'EXACT_MATCH_SUCCESS';
    case 'POSSIBLE_MATCH':
      return 'POSSIBLE_MATCH_REVIEW';
    case 'NEW_PROFILE':
      return 'NEW_PROFILE_CREATED';
  }
}

/** Build createOrMatchLaborProfile payload. */
export function buildCreateOrMatchPayload(
  ctx: StepRunContext,
  policy: 'ALLOW_NEW' | 'MATCH_ONLY' | 'REVIEW_REQUIRED',
): unknown {
  return {
    organizationId: ctx.organizationId,
    signal: {
      fullName: ctx.fullName,
      phone: ctx.phone,
      citizenId: ctx.citizenId,
      citizenAddress: ctx.citizenAddress,
      ...(ctx.dob ? { dob: ctx.dob } : {}),
    },
    provenance: {
      provider: ctx.provider,
      connectionId: ctx.connectionId,
      collectedAt: new Date().toISOString(),
      externalReference: ctx.externalReference,
    },
    intakeRevisionId: ctx.intakeRevisionId,
    policyHint: policy,
  };
}

/** Extract MatchingOutcome from gateway response data. */
export function extractMatchingOutcome(result: HrpGatewayCallResult): MatchingOutcome | null {
  if (result.status !== 'APPLIED') return null;
  const data = result.data as { matchingOutcome?: MatchingOutcome } | undefined;
  return data?.matchingOutcome ?? null;
}
