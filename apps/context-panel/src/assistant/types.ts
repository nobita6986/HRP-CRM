/**
 * src/assistant/types.ts — Internal types for CORE/1.13
 * Personal assistant / planning / autofill prototype.
 *
 * Scope:
 *  - AC1: Today/week deterministic planning snapshots
 *  - AC2: Autofill field suggestions with evidence/conflict/staleness
 *  - AC3: Planning batch with partial results, reschedule/version
 *  - AC4: AI provider config UI skeleton
 *  - AC5: Reminder port/simulator (not production scheduler)
 *
 * Reuses contracts: @hrp-engagement/contracts
 *  - ai-proposals.ts  (AIProposalSchema, AUTOFILL kind)
 *  - ai-provider-config.ts (AIProviderConfigSchema)
 *  - next-action.ts (PlanningBatch schemas)
 *  - scheduling.ts (PlanningBatchItemOutcome)
 *
 * PROPOSED / UNKNOWN boundaries are marked with LIMITATION comments.
 */
import type { z } from 'zod';
import type {
  AIProposalSchema,
  ApplyAIProposalInputSchema,
  AIProviderConfigReadSchema,
} from '@hrp-engagement/contracts';
import type { PlanningBatchItemOutcome } from '@hrp-engagement/contracts';

// ─────────────────────────────────────────────────────────────────────────────
// AC1 — Today / Week Planning
// ─────────────────────────────────────────────────────────────────────────────

/** One item on the "today" list. */
export interface TodayItem {
  itemId: string;
  /** 'task' | 'reminder' | 'intake_draft' | 'kpi_progress' | 'follow_up' */
  kind: 'task' | 'reminder' | 'intake_draft' | 'kpi_progress' | 'follow_up';
  title: string;
  dueAt?: string; // ISO datetime
  priority: 'high' | 'medium' | 'low';
  sourceId?: string; // for linking
  sourceSnapshotId?: string; // as-of snapshot that generated this item
  done: boolean;
  ownerId: string;
}

/** Snapshot of today's items — deterministic fixture. */
export interface TodaySnapshot {
  snapshotId: string;
  staffId: string;
  asOf: string; // ISO datetime
  items: TodayItem[];
  kpiSummary: {
    totalTargets: number;
    onTrack: number;
    atRisk: number;
    behind: number;
  };
}

/** One item in a week plan. */
export interface WeekPlanItem {
  planItemId: string;
  dayLabel: string; // e.g. "2026-09-17"
  title: string;
  kind: 'meeting' | 'follow_up' | 'intake_review' | 'other';
  estimatedMinutes?: number;
  sourceId?: string;
}

/** Week plan snapshot — deterministic fixture. */
export interface WeekPlanSnapshot {
  snapshotId: string;
  staffId: string;
  weekStart: string; // ISO date
  items: WeekPlanItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// AC2 — Autofill Suggestions
// ─────────────────────────────────────────────────────────────────────────────

/** One field suggestion in an autofill proposal. */
export interface FieldSuggestion {
  fieldPath: string; // dotted path, e.g. "intent.availability"
  proposedValue: unknown;
  currentValue?: unknown; // for UI diff
  confidence: number; // 0..1
  reasonCode: string; // e.g. "CHAT_CONTEXT", "HISTORICAL", "INFERRED"
  /** True if conflicting evidence exists (multiple interpretations). */
  hasConflict: boolean;
  conflictNote?: string;
  /** True if the context used to generate this is now stale. */
  stale: boolean;
  staleReason?: string;
  evidenceLabel: string; // human-readable, e.g. "Tin nhắn 2026-09-16 14:30"
}

/** Autofill proposal status. */
export type AutofillStatus = 'DRAFT' | 'PENDING_REVIEW' | 'ACCEPTED' | 'REJECTED' | 'STALE';

/** Full autofill proposal — wraps AUTOFILL proposal from contracts. */
export interface AutofillProposal {
  proposalId: string;
  revisionId: string;
  profileId: string;
  organizationId: string;
  status: AutofillStatus;
  fields: FieldSuggestion[];
  contextSnapshotId: string; // as-of that was used to generate
  contextVersion: string; // version of context when generated
  createdAt: string; // ISO datetime
  expiresAt?: string; // ISO datetime
  createdByActor: string; // staffId of actor who initiated
}

/** Result of accepting some fields from an autofill proposal. */
export interface AutofillAcceptResult {
  acceptedFields: string[]; // fieldPaths
  rejectedFields: string[]; // fieldPaths
  /** Only manager can mutate canonical; sale/AI propose only. */
  canMutate: boolean;
  /** If true, mutation was applied (manager only, after confirm). */
  mutated: boolean;
  /**
   * Always returned. Even manager mutation flows through a draft + confirm
   * step. After accept, a draftId is created; mutation happens only after
   * the user calls confirmAutofillDraft(draftId, expectedDraftRevision).
   * Sale/AI: canMutate=false means they cannot even create a mutation draft;
   * their accept just moves proposal to PENDING_REVIEW (no draft created).
   */
  draftId?: string;
  draftRevision?: string;
  /** Confirmation binding — must be sent back to confirmDraft to apply. */
  confirmationDigest?: string;
}

/** A pending autofill mutation draft (created on manager accept). */
export interface AutofillDraft {
  draftId: string;
  proposalId: string;
  profileId: string;
  organizationId: string;
  actorId: string; // staff who accepted
  fieldPaths: string[]; // selected fieldPaths
  /** Server-set optimistic-concurrency version. */
  draftRevision: string;
  /** SHA-256 digest of the draft payload — required for confirm. */
  confirmationDigest: string;
  /** True after confirm() ran successfully. */
  applied: boolean;
  /** Server-set: when draft was applied (after confirm). */
  appliedAt?: string;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC3 — Planning Batch with Partial Results
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-item input — pre-computed payload digest for R2/B3 same-key/diff-payload
 * conflict detection. Server compares against recorded digest.
 */
export interface PlanningBatchItemInput {
  itemId: string;
  itemKind: 'NEXT_ACTION' | 'AVAILABILITY' | 'SUPPRESSION';
  /** SHA-256 of canonicalized item payload — optional, server uses '' sentinel if absent. */
  payloadDigest?: string;
}

/**
 * Per-item error (frozen contract `PlanningBatchItemErrorSchema`).
 * Only present when `outcome === 'FAILED'`.
 */
export interface PlanningBatchItemError {
  itemId: string;
  /** Wire error code, max 128 chars. */
  errorCode: string;
  /** i18n message key, max 128 chars. */
  messageKey: string;
  /** Field path that caused the error (optional). */
  fieldPath?: string;
  /** Retry class per frozen contract enum. */
  retryClass:
    | 'NEVER'
    | 'REVIEW_REQUIRED'
    | 'REFRESH_AND_REVIEW'
    | 'REAUTHENTICATE'
    | 'BOUNDED_SAME_KEY'
    | 'RECONCILE_FIRST';
}

/**
 * Canonical OperationReference for ACCEPTED outcome pending (frozen contract
 * `OperationReferenceSchema`). Allows caller to call envelope OperationQuery
 * with operationId to poll result.
 */
export interface OperationReference {
  kind: 'COMMAND_OPERATION';
  operationId: string;
}

/**
 * Per-item result — wire-aligned with frozen `PlanningBatchItemResultSchema`
 * in @hrp-engagement/contracts/scheduling.ts (R2 fix).
 *
 *  - APPLIED  → `appliedId` required; `appliedVersion` optional; NO error;
 *               NO pendingReference (đã apply ngay).
 *  - ACCEPTED → `pendingReference` (canonical OperationReference) optional;
 *               NO appliedId/appliedVersion (Owner rev 2: ACCEPTED không
 *               mang dấu hiệu APPLIED).
 *  - FAILED   → `error` required (PlanningBatchItemError); NO appliedId,
 *               NO appliedVersion, NO pendingReference.
 *  - SKIPPED  → no error, no pendingReference; `appliedId`+`appliedVersion`
 *               optional if skip happens to have a target canonical id.
 */
export interface BatchItemResult {
  itemId: string;
  itemKind: 'NEXT_ACTION' | 'AVAILABILITY' | 'SUPPRESSION';
  outcome: PlanningBatchItemOutcome;
  appliedId?: string;
  /**
   * `appliedVersion` is `ExpectedVersionSchema` in frozen contract — a
   * non-negative integer (NOT a string). We map internal string `revision`
   * to int counter.
   */
  appliedVersion?: number;
  pendingReference?: OperationReference;
  error?: PlanningBatchItemError;
}

/**
 * Planning batch summary counts (frozen contract `PlanningBatchSummarySchema`).
 * NO `allSuccess` field — caller reads per-item outcomes.
 */
export interface PlanningBatchSummary {
  totalItems: number;
  appliedCount: number;
  acceptedCount: number;
  failedCount: number;
  skippedCount: number;
}

/**
 * Planning batch result — wire-aligned with frozen `PlanningBatchResultSchema`
 * in @hrp-engagement/contracts/scheduling.ts (R2 fix).
 *
 * NO `allSuccess`. NO flat `appliedCount`/`failedCount` etc. Caller MUST read
 * per-item outcomes + summary to decide success/partial/all-failed.
 */
export interface PlanningBatchResult {
  schemaVersion: string;
  batchId: string;
  items: BatchItemResult[];
  summary: PlanningBatchSummary;
  completedAt: string;
}

/** Stale version error for reschedule. */
export interface RescheduleStaleResult {
  success: false;
  error: 'VERSION_CONFLICT';
  message: string; // Vietnamese
  currentVersion: string;
  expectedVersion: string;
}

export interface RescheduleSuccessResult {
  success: true;
  newVersion: string;
  appliedRevision: {
    revisionId: string;
    occurrenceKey: string;
  };
}

export type RescheduleResult = RescheduleStaleResult | RescheduleSuccessResult;

// ─────────────────────────────────────────────────────────────────────────────
// AC4 — AI Provider Config
// ─────────────────────────────────────────────────────────────────────────────

/** Provider config for AI — read DTO (no API key exposed). */
export interface ProviderConfigRead {
  configId: string;
  providerId: string;
  baseUrl: string;
  model: string;
  apiStyle: 'RESPONSES' | 'CHAT_COMPLETIONS' | 'CUSTOM';
  capabilities: string[];
  dataPolicy: 'NO_PII' | 'PII_REDACTED' | 'INTERNAL_ONLY' | 'SANDBOX';
  budgetMonthly?: {
    spendLimitVND: number;
    currentSpendVND: number;
    tokenLimit: number;
    currentTokens: number;
  };
  active: boolean;
  version: string;
}

/** Input for saving provider config. */
export interface ProviderConfigWrite {
  providerId: string;
  baseUrl: string;
  model: string;
  apiStyle: 'RESPONSES' | 'CHAT_COMPLETIONS' | 'CUSTOM';
  capabilities: string[];
  dataPolicy: 'NO_PII' | 'PII_REDACTED' | 'INTERNAL_ONLY' | 'SANDBOX';
  budgetMonthly?: {
    spendLimitVND: number;
    tokenLimit: number;
  };
  active: boolean;
  secretRef?: string; // reference only, not raw key
  revision: string; // optimistic concurrency
}

// ─────────────────────────────────────────────────────────────────────────────
// AC5 — Reminder Port / Simulator
// ─────────────────────────────────────────────────────────────────────────────

/** Opaque handle for a reminder port. */
export interface ReminderPortHandle {
  handleId: string; // opaque ID
  ttlSeconds: number;
  /** True = reminder would fire; false = suppressed (DNC, off hours, etc.) */
  wouldFire: boolean;
  fireAt?: string; // ISO datetime if wouldFire=true
}

/** Result of simulating a reminder. */
export interface ReminderSimResult {
  portHandles: ReminderPortHandle[];
  suppressedCount: number;
  pendingCount: number;
  simulationTimestamp: string; // ISO datetime
}

// ─────────────────────────────────────────────────────────────────────────────
// Service errors
// ─────────────────────────────────────────────────────────────────────────────

export class AssistantConfigError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
    public readonly httpStatus = 500,
  ) {
    super(message);
    this.name = 'AssistantConfigError';
  }
}
