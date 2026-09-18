/**
 * src/assistant/service.ts — Service layer for CORE/1.13.
 *
 * Permission model (CORE/1.13 B1 — scope-based):
 *  - All reads: any authenticated staff.
 *  - Autofill propose: actor must have actor/org/object scope match
 *    (`canProposeAutofill` from orchestrator-wire). Sale/AI without
 *    scope = no proposal access; SUPERVISOR/SYSTEM with `autofill:profile-*`
 *    wildcard = full scope.
 *  - Autofill draft.confirm: requires explicit `autofill:draft.confirm` scope
 *    on top of profile+org scope (`canConfirmAutofillDraft`).
 *  - Provider config update: manager-only (role check + optimistic
 *    concurrency).
 *  - KPI manager-only scenarios: see dashboard module for KPI writes.
 *
 * B4 — Provider write validation: raw HTTP body parsed via Zod schema
 * ProviderConfigWriteRequestSchema with `.strict()` — unknown fields
 * rejected with INVALID_PAYLOAD. Sensitive-looking field names
 * (apiKey, token, secretKey, …) are explicitly listed in a forbid set
 * and rejected before reaching the store. We never echo them.
 */
import { z } from 'zod';
import {
  canProposeAutofill,
  canConfirmAutofillDraft,
} from '../orchestrator-wire.js';
import { SCHEMA_VERSION } from '@hrp-engagement/contracts';
import type {
  AutofillAcceptResult,
  AutofillDraft,
  AutofillProposal,
  BatchItemResult,
  FieldSuggestion,
  OperationReference,
  PlanningBatchItemError,
  PlanningBatchItemInput,
  PlanningBatchResult,
  ProviderConfigRead,
  ProviderConfigWrite,
  ReminderSimResult,
  RescheduleResult,
  TodaySnapshot,
  WeekPlanSnapshot,
} from './types.js';
import { AssistantConfigError } from './types.js';
import { assistantStore } from './store.js';
import { FIXTURE_ASOF, makeReminderSimulation } from './fixtures.js';
import type { MockIdentity } from '../orchestrator-wire.js';
// CORE/1.14 B4: mapping-review metrics wired at real lifecycle events.
import { inc } from '../observability/metrics.js';

// ─────────────────────────────────────────────────────────────────────────────
// B4 — Provider write schema validation (Zod strict, no secrets)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CORE/1.13 B4 — Zod schema for provider config write.
 *  - `.strict()` rejects unknown fields with INVALID_PAYLOAD.
 *  - Explicitly bans raw secret-looking field names (apiKey/token/secretKey
 *    /authorization/bearer/password/credential).
 *  - Use SecretRef schema from `@hrp-engagement/contracts` if needed for
 *    secret references; raw secrets are never accepted.
 */
const ProviderConfigWriteSchema = z
  .object({
    schemaVersion: z.string().optional(),
    configId: z.string().min(1).max(128).optional(),
    providerId: z.string().min(1).max(128),
    baseUrl: z.string().url(),
    model: z.string().min(1).max(256),
    apiStyle: z.enum(['RESPONSES', 'CHAT_COMPLETIONS', 'CUSTOM']),
    capabilities: z.array(z.string().min(1).max(64)).max(16),
    dataPolicy: z.enum(['NO_PII', 'PII_REDACTED', 'INTERNAL_ONLY', 'SANDBOX']),
    budgetMonthly: z
      .object({
        spendLimitVND: z.number().int().nonnegative(),
        tokenLimit: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    active: z.boolean(),
    revision: z.string().min(1).max(64),
  })
  .strict();

/**
 * Forbidden top-level / nested keys that look like raw secrets.
 * Service rejects ANY request containing these anywhere via redactor scan.
 */
const SECRET_FIELD_FORBIDDEN = new Set([
  'apiKey',
  'api_key',
  'apikey',
  'token',
  'access_token',
  'authorization',
  'bearer',
  'password',
  'secretkey',
  'secret_key',
  'credential',
  'credentials',
  'session_id',
  'sessionid',
]);

/** Recursive scan of a JSON-like value to flag any forbidden key. */
function findSecretKeys(value: unknown, path: string[] = []): string[] {
  const hits: string[] = [];
  if (value === null || value === undefined) return hits;
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      hits.push(...findSecretKeys(v, [...path, `[${i}]`]));
    });
    return hits;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_FIELD_FORBIDDEN.has(k)) {
        hits.push([...path, k].join('.'));
      }
      hits.push(...findSecretKeys(v, [...path, k]));
    }
  }
  return hits;
}

/** Drop forbidden secret keys from a request body before processing. */
function redactSecrets<T extends Record<string, unknown>>(obj: T): T {
  const redacted = { ...obj };
  for (const k of Object.keys(redacted)) {
    if (SECRET_FIELD_FORBIDDEN.has(k)) {
      delete (redacted as Record<string, unknown>)[k];
    } else if (typeof redacted[k] === 'object' && redacted[k] !== null) {
      (redacted as Record<string, unknown>)[k] = redactSecrets(
        redacted[k] as Record<string, unknown>,
      );
    }
  }
  return redacted;
}

/**
 * B4 — Validate provider write request.
 * Returns parsed provider config or throws INVALID_PAYLOAD with reason
 * (Zod issue list / forbidden keys). Never echoes offending payload.
 */
export function parseProviderConfigWrite(input: unknown): ProviderConfigWrite {
  if (input === null || typeof input !== 'object') {
    throw new AssistantConfigError(
      'INVALID_PAYLOAD',
      'Body phải là JSON object',
      400,
    );
  }
  // Pre-flight secret scan — reject before schema parse so we never log
  // the secret value. Reason only mentions key name, not value.
  const secretHits = findSecretKeys(input);
  if (secretHits.length > 0) {
    throw new AssistantConfigError(
      'INVALID_PAYLOAD',
      `Request chứa secret fields bị cấm: ${secretHits.join(', ')}`,
      400,
    );
  }
  const result = ProviderConfigWriteSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5) // cap log/PII risk
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.code}`)
      .join('; ');
    throw new AssistantConfigError(
      'INVALID_PAYLOAD',
      `Provider write schema không hợp lệ: ${issues}`,
      400,
    );
  }
  const parsed = result.data;
  return {
    providerId: parsed.providerId,
    baseUrl: parsed.baseUrl,
    model: parsed.model,
    apiStyle: parsed.apiStyle,
    capabilities: parsed.capabilities,
    dataPolicy: parsed.dataPolicy,
    budgetMonthly: parsed.budgetMonthly,
    active: parsed.active,
    revision: parsed.revision,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AC1 — Today / Week
// ─────────────────────────────────────────────────────────────────────────────
export function readToday(identity: MockIdentity): TodaySnapshot {
  if (!identity) {
    throw new AssistantConfigError('UNAUTHORIZED', 'Thiếu staff identity', 401);
  }
  return assistantStore.getOrCreateToday(identity.staffId);
}

export function readWeek(identity: MockIdentity): WeekPlanSnapshot {
  if (!identity) {
    throw new AssistantConfigError('UNAUTHORIZED', 'Thiếu staff identity', 401);
  }
  return assistantStore.getOrCreateWeek(identity.staffId);
}

// ─────────────────────────────────────────────────────────────────────────────
// AC2 — Autofill
// ─────────────────────────────────────────────────────────────────────────────
export function listAutofillProposals(
  identity: MockIdentity,
  profileId: string,
): AutofillProposal[] {
  if (!identity) {
    throw new AssistantConfigError('UNAUTHORIZED', 'Thiếu staff identity', 401);
  }
  return assistantStore.getOrCreateAutofill(profileId, identity.staffId);
}

/**
 * Accept some fields from a proposal.
 *
 * CORE/1.13 B1 — scope-based authorization:
 *  - Calls `canProposeAutofill(identity, profileId, proposalOrgId)` which
 *    checks actor/organizationId/object scope match. Sale without scope
 *    is rejected.
 *  - If allowed to propose AND identity has `autofill:draft.confirm` scope:
 *    create DRAFT (server-bound with confirmationDigest) → canMutate=true.
 *  - If only propose-only (no draft.confirm scope): moves proposal to
 *    PENDING_REVIEW, canMutate=false.
 *  - AI (actor.kind=SERVICE) is propose-only by definition.
 */
export function acceptAutofillFields(
  identity: MockIdentity,
  profileId: string,
  proposalId: string,
  acceptedFieldPaths: string[],
  rejectedFieldPaths: string[],
): AutofillAcceptResult {
  if (!identity) {
    throw new AssistantConfigError('UNAUTHORIZED', 'Thiếu staff identity', 401);
  }

  const proposals = assistantStore.getOrCreateAutofill(profileId, identity.staffId);
  const proposal = proposals.find((p) => p.proposalId === proposalId);
  if (!proposal) {
    throw new AssistantConfigError('NOT_FOUND', 'Proposal không tồn tại', 404);
  }
  if (proposal.status === 'STALE') {
    throw new AssistantConfigError(
      'STALE_CONTEXT',
      'Context đã thay đổi; cần preview lại trước khi accept',
      409,
    );
  }

  // B1: actor/org/object scope check — server-side, no bypass.
  if (!canProposeAutofill(identity, profileId, proposal.organizationId)) {
    throw new AssistantConfigError(
      'FORBIDDEN',
      'Actor không có scope trong org của profile này',
      403,
    );
  }

  // Validate all accepted paths exist in the proposal.
  for (const path of acceptedFieldPaths) {
    if (!proposal.fields.find((f: FieldSuggestion) => f.fieldPath === path)) {
      throw new AssistantConfigError(
        'INVALID_FIELD',
        `Field không tồn tại trong proposal: ${path}`,
        400,
      );
    }
  }

  // AI (SERVICE actor) is propose-only — even with autofill:draft.confirm
  // scope, SERVICE never gets to mutate. (audit B1 + AI suggest-only).
  const isAi = identity.actor.kind === 'SERVICE';
  const canConfirm = !isAi && canConfirmAutofillDraft(
    identity,
    profileId,
    proposal.organizationId,
  );

  if (canConfirm) {
    // Proposer with confirm-capability: create DRAFT (no mutation yet).
    // Caller must still call `confirmAutofillDraft()` to actually apply.
    const draft = assistantStore.createAutofillDraft(
      profileId,
      proposalId,
      identity.staffId,
      acceptedFieldPaths,
    );
    assistantStore.updateProposalStatus(profileId, proposalId, 'PENDING_REVIEW');
    // CORE/1.14 B4: mapping-review decision wired at real lifecycle event.
    inc('mapping_review', { decision: 'review' });
    return {
      acceptedFields: acceptedFieldPaths,
      rejectedFields: rejectedFieldPaths,
      canMutate: true,
      mutated: false,
      draftId: draft.draftId,
      draftRevision: draft.draftRevision,
      confirmationDigest: draft.confirmationDigest,
    };
  }
  // Propose-only path (sale, AI, or any actor without confirm scope).
  assistantStore.updateProposalStatus(profileId, proposalId, 'PENDING_REVIEW');
  // CORE/1.14 B4: propose-only path uses accept decision.
  inc('mapping_review', { decision: 'accept' });
  return {
    acceptedFields: acceptedFieldPaths,
    rejectedFields: rejectedFieldPaths,
    canMutate: false,
    mutated: false,
  };
}

/**
 * Confirm an autofill draft — apply the mutation.
 *
 * CORE/1.13 B1 — scope-based authorization:
 *  - Confirms require actor/org/object scope match AND
 *    `autofill:draft.confirm` capability (manager + scope).
 *
 * CORE/1.13 B5 — idempotent recovery:
 *  - When the draft is already applied AND the request is valid
 *    (matching draftRevision + confirmationDigest + actorId), return
 *    the SAME applied draft (no re-mutation). Returns 200.
 *  - When request mismatches (wrong revision/digest), reject with
 *    DRAFT_VERSION_CONFLICT/CONFIRMATION_MISMATCH.
 *
 * Audit checks are enforced at TWO layers:
 *  - service layer: actor-org, scope match, request binding.
 *  - store layer: actorId binding + applied+request match.
 * Neither layer short-circuits authorization early.
 */
export function confirmAutofillDraft(
  identity: MockIdentity,
  draftId: string,
  expectedDraftRevision: string,
  confirmationDigest: string,
): { draft: AutofillDraft } {
  if (!identity) {
    throw new AssistantConfigError('UNAUTHORIZED', 'Thiếu staff identity', 401);
  }
  const draft = assistantStore.getAutofillDraft(draftId);
  if (!draft) {
    throw new AssistantConfigError('NOT_FOUND', 'Draft không tồn tại', 404);
  }
  // B1: actor org/scope match for the draft's organizationId+profileId.
  if (!canConfirmAutofillDraft(identity, draft.profileId, draft.organizationId)) {
    throw new AssistantConfigError(
      'FORBIDDEN',
      'Actor không có quyền confirm draft này (cần autofill:draft.confirm scope)',
      403,
    );
  }
  const result = assistantStore.confirmAutofillDraft(
    draftId,
    expectedDraftRevision,
    confirmationDigest,
    identity.staffId,
  );
  return { draft: result };
}

/**
 * Reject all fields in a proposal.
 */
export function rejectAutofillProposal(
  identity: MockIdentity,
  profileId: string,
  proposalId: string,
): AutofillProposal {
  if (!identity) {
    throw new AssistantConfigError('UNAUTHORIZED', 'Thiếu staff identity', 401);
  }
  const result = assistantStore.updateProposalStatus(profileId, proposalId, 'REJECTED');
  // CORE/1.14 B4: mapping-review reject path wired.
  inc('mapping_review', { decision: 'reject' });
  return result;
}

/**
 * Check if a proposal is stale (context version mismatch).
 */
export function isProposalStale(
  identity: MockIdentity,
  profileId: string,
  proposalId: string,
  currentContextVersion: string,
): boolean {
  if (!identity) return false;
  const proposals = assistantStore.getOrCreateAutofill(profileId, identity.staffId);
  const proposal = proposals.find((p) => p.proposalId === proposalId);
  if (!proposal) return true; // not found → stale
  return proposal.contextVersion !== currentContextVersion;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC3 — Planning Batch with Partial Results
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Commit a planning batch.
 *
 * CORE/1.13 B2 — ACCEPTED replay safety:
 *  - If a batchId+itemId was already ACCEPTED and the request has the SAME
 *    payload digest → return the same ACCEPTED outcome with the original
 *    `pendingId` and `replayReference`. No re-mutation, no SKIPPED.
 *  - If the item was APPLIED and replayed → return SKIPPED with
 *    skipReason=ALREADY_APPLIED (no re-mutation). Original appliedRevisionId
 *    preserved so caller can reference.
 *
 * CORE/1.13 B3 — Same-key/diff-payload conflict:
 *  - Caller provides `payloadDigest` per item. Store records the first
 *    digest for that batchId+itemId. On replay:
 *    - same digest → outcome replayed as above.
 *    - different digest → FAILED with errorCode=PAYLOAD_MISMATCH before
 *      any mutation. Frozen contract: contract conflict reported before
 *      mutation (Backlog §0.3f).
 *
 * CORE/1.13 contract delta — REMOVED `allSuccess`:
 *  - Frozen contract `PlanningBatchResultSchema` (scheduling.ts) does NOT
 *    have `allSuccess`. We expose `summary` matching frozen summary shape.
 *  - Caller reads per-item outcome + summary.appliedCount/acceptedCount/etc.
 */
/**
 * commitPlanningBatch — wire-aligned with frozen
 * `PlanningBatchResultSchema` in @hrp-engagement/contracts/scheduling.ts
 * (R2 fix).
 *
 * Behavior:
 *  - B2: ACCEPTED replay → return same ACCEPTED + `pendingReference`
 *    (canonical OperationReference); no re-mutation.
 *  - B2: APPLIED replay → SKIPPED with `ALREADY_APPLIED` reason.
 *  - R2/B3: same-key/diff-payload → FAILED with `error.errorCode='PAYLOAD_MISMATCH'`
 *    and `retryClass='REVIEW_REQUIRED'`.
 *  - FAILED carries full structured `error` object (PlanningBatchItemError);
 *    NO appliedId/appliedVersion (per frozen contract superRefine).
 *  - ACCEPTED carries `pendingReference` (OperationReference); NO appliedId
 *    (per Owner rev 2: ACCEPTED không mang dấu hiệu APPLIED).
 *  - APPLIED carries `appliedId` (canonical id) + optional `appliedVersion`.
 */
export function commitPlanningBatch(
  identity: MockIdentity,
  batchId: string,
  itemIds: string[],
  itemInputs: PlanningBatchItemInput[] = [],
  simulatedOutcomes: BatchItemResult[] = [],
): PlanningBatchResult {
  if (!identity) {
    throw new AssistantConfigError('UNAUTHORIZED', 'Thiếu staff identity', 401);
  }

  // Index caller-supplied payload digests by itemId (R2/B3).
  const inputByItemId = new Map<string, PlanningBatchItemInput>();
  for (const input of itemInputs) {
    inputByItemId.set(input.itemId, input);
  }
  const getItemKind = (itemId: string): 'NEXT_ACTION' | 'AVAILABILITY' | 'SUPPRESSION' =>
    inputByItemId.get(itemId)?.itemKind ?? 'NEXT_ACTION';

  // Per-item replay-or-fresh resolution.
  const decided: BatchItemResult[] = [];
  const freshItemIds: string[] = [];
  for (const itemId of itemIds) {
    const newDigest = inputByItemId.get(itemId)?.payloadDigest ?? '';
    const itemKind = getItemKind(itemId);
    const previous = assistantStore.getBatchItemMeta(batchId, itemId);

    if (previous) {
      // ── R2/B3: same-key/diff-payload conflict ──
      if (newDigest && previous.payloadDigest !== newDigest) {
        const error: PlanningBatchItemError = {
          itemId,
          errorCode: 'PAYLOAD_MISMATCH',
          messageKey: 'planning.batch.item.payloadMismatch',
          retryClass: 'REVIEW_REQUIRED',
        };
        decided.push({
          itemId,
          itemKind,
          outcome: 'FAILED',
          error,
        });
        continue;
      }

      // ── B2: ACCEPTED replay → keep ACCEPTED + pendingReference ──
      if (previous.outcome === 'ACCEPTED') {
        const pendingRef: OperationReference | undefined = previous.pendingId
          ? { kind: 'COMMAND_OPERATION', operationId: previous.pendingId }
          : undefined;
        decided.push({
          itemId,
          itemKind,
          outcome: 'ACCEPTED',
          pendingReference: pendingRef,
        });
        continue;
      }
      // APPLIED replay → SKIPPED, no re-mutation.
      if (previous.outcome === 'APPLIED') {
        decided.push({
          itemId,
          itemKind,
          outcome: 'SKIPPED',
          appliedId: previous.appliedRevisionId,
        });
        continue;
      }
      if (previous.outcome === 'FAILED') {
        decided.push({
          itemId,
          itemKind,
          outcome: 'FAILED',
          error: {
            itemId,
            errorCode: 'PREVIOUS_FAILED',
            messageKey: 'planning.batch.item.previousFailed',
            retryClass: 'NEVER',
          },
        });
        continue;
      }
      // SKIPPED replay → return SKIPPED.
      decided.push({
        itemId,
        itemKind,
        outcome: 'SKIPPED',
      });
      continue;
    }
    freshItemIds.push(itemId);
  }

  // Generate deterministic outcomes for fresh items (or use caller-provided).
  const freshOutcomes =
    simulatedOutcomes.length > 0
      ? simulatedOutcomes.filter((r) => freshItemIds.includes(r.itemId))
      : generateDeterministicOutcomes(batchId, freshItemIds);

  // Record fresh outcomes into ledger. Always record (even legacy w/o digest)
  // — '' sentinel for absent digest so legacy replay still detects.
  for (const r of freshOutcomes) {
    const input = inputByItemId.get(r.itemId);
    const digest = input?.payloadDigest ?? '';
    const extras: { appliedRevisionId?: string; pendingId?: string } = {};
    if (r.outcome === 'APPLIED') {
      if (r.appliedId) extras.appliedRevisionId = r.appliedId;
    } else if (r.outcome === 'ACCEPTED') {
      if (r.pendingReference) extras.pendingId = r.pendingReference.operationId;
    }
    assistantStore.recordBatchItemMeta(
      batchId,
      r.itemId,
      digest,
      r.outcome,
      extras,
    );
  }

  // Combine decided (replay path) + fresh outcomes. Preserve caller order.
  const allResults = [...decided, ...freshOutcomes];
  const orderedResults: BatchItemResult[] = [];
  for (const itemId of itemIds) {
    const found = allResults.find((r) => r.itemId === itemId);
    if (found) orderedResults.push(found);
  }

  // Compute summary counts (frozen contract shape).
  const appliedCount = orderedResults.filter((r) => r.outcome === 'APPLIED').length;
  const acceptedCount = orderedResults.filter((r) => r.outcome === 'ACCEPTED').length;
  const failedCount = orderedResults.filter((r) => r.outcome === 'FAILED').length;
  const skippedCount = orderedResults.filter((r) => r.outcome === 'SKIPPED').length;
  const totalItems = orderedResults.length;
  const summary = {
    totalItems,
    appliedCount,
    acceptedCount,
    failedCount,
    skippedCount,
  };

  assistantStore.saveBatchResults(batchId, orderedResults);

  // R2: include schemaVersion + completedAt per frozen contract.
  return {
    schemaVersion: SCHEMA_VERSION,
    batchId,
    items: orderedResults,
    summary,
    completedAt: new Date().toISOString(),
  };
}

/**
 * Generate deterministic per-item outcomes — wire-aligned (R2 fix).
 * Returns items with `itemKind` (default NEXT_ACTION), no flat errorCode/
 * errorMessage/ad-hoc pendingId/replayReference/skipReason.
 */
function generateDeterministicOutcomes(
  batchId: string,
  itemIds: string[],
): BatchItemResult[] {
  const outcomes: Array<'APPLIED' | 'FAILED' | 'SKIPPED' | 'ACCEPTED'> = [
    'APPLIED',
    'FAILED',
    'SKIPPED',
    'ACCEPTED',
  ];
  return itemIds.map((itemId, i) => {
    const idx = (batchId.length + itemId.length + i) % outcomes.length;
    const outcome = outcomes[idx]!;
    const itemKind: 'NEXT_ACTION' | 'AVAILABILITY' | 'SUPPRESSION' = 'NEXT_ACTION';
    if (outcome === 'FAILED') {
      return {
        itemId,
        itemKind,
        outcome,
        error: {
          itemId,
          errorCode: 'CONFLICT',
          messageKey: 'planning.batch.item.mockConflict',
          retryClass: 'REVIEW_REQUIRED',
        },
      };
    }
    if (outcome === 'APPLIED') {
      return {
        itemId,
        itemKind,
        outcome,
        appliedId: `nextaction-${batchId}-${itemId}`,
        // ExpectedVersionSchema is a number per frozen contract.
        appliedVersion: 1,
      };
    }
    if (outcome === 'ACCEPTED') {
      return {
        itemId,
        itemKind,
        outcome,
        pendingReference: {
          kind: 'COMMAND_OPERATION',
          // CommandIdSchema requires ≥8 chars.
          operationId: `op-${batchId}-${itemId}`.padEnd(8, '_').slice(0, 64),
        },
      };
    }
    // SKIPPED
    return { itemId, itemKind, outcome };
  });
}

/**
 * Reschedule NextAction with optimistic concurrency.
 * Returns VERSION_CONFLICT if expectedVersion doesn't match.
 *
 * Server-side authoritative: actionId versions are stored server-side.
 * Client cannot bypass by sending arbitrary expectedVersion — the server
 * compares against its own recorded version. If mismatch, returns
 * VERSION_CONFLICT with the current server-side version.
 */
export function rescheduleNextAction(
  identity: MockIdentity,
  actionId: string,
  expectedVersion: string,
  newSchedule: { scheduledAt: string; dueAt?: string },
): RescheduleResult {
  if (!identity) {
    throw new AssistantConfigError('UNAUTHORIZED', 'Thiếu staff identity', 401);
  }

  // Server-side authoritative version. Initialize if not seen.
  if (!assistantStore.getNextActionVersion(actionId)) {
    assistantStore.setNextActionVersion(actionId, 'v-current');
  }
  const serverVersion = assistantStore.getNextActionVersion(actionId)!;

  // Server-side compare: client's expectedVersion MUST match server's.
  // No fallback to identity or actionId-based heuristics that could leak
  // privilege.
  if (expectedVersion !== serverVersion) {
    return {
      success: false,
      error: 'VERSION_CONFLICT',
      message:
        'Lịch đã được cập nhật bởi người khác; refresh và thử lại',
      currentVersion: serverVersion,
      expectedVersion,
    };
  }

  // Success: bump server version, return new appliedRevision.
  const newVersion = `v-${Math.floor(Date.now() / 1000)}`;
  assistantStore.setNextActionVersion(actionId, newVersion);
  return {
    success: true,
    newVersion,
    appliedRevision: {
      revisionId: `rev-${actionId}-${Date.now()}`,
      occurrenceKey: `occ-${actionId}-${Date.now()}`,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AC4 — Provider Config
// ─────────────────────────────────────────────────────────────────────────────
export function listProviderConfigs(identity: MockIdentity): ProviderConfigRead[] {
  if (!identity) {
    throw new AssistantConfigError('UNAUTHORIZED', 'Thiếu staff identity', 401);
  }
  assistantStore.seedOnce();
  return assistantStore.listProviders();
}

/**
 * CORE/1.13 B4 — Update provider config.
 *  - Validates raw body via `parseProviderConfigWrite(input)` (Zod strict).
 *  - Rejects unknown fields and any secret-looking key with 400 INVALID_PAYLOAD.
 *  - Then forwards to store which enforces manager-role + optimistic
 *    concurrency.
 *  - Never echoes secrets into response/log.
 */
export function updateProviderConfig(
  identity: MockIdentity,
  configId: string,
  input: unknown,
): ProviderConfigRead {
  if (!identity) {
    throw new AssistantConfigError('UNAUTHORIZED', 'Thiếu staff identity', 401);
  }
  // B4: schema-validate the raw body BEFORE any further processing.
  // We accept `unknown` and narrow via parseProviderConfigWrite so we
  // don't accept arbitrary shape.
  const parsed = parseProviderConfigWrite(input);
  const isManager = identity.role === 'SUPERVISOR' || identity.role === 'SYSTEM';
  return assistantStore.updateProvider(configId, parsed, identity.staffId, isManager);
}

// ─────────────────────────────────────────────────────────────────────────────
// AC5 — Reminder Port / Simulator
// ─────────────────────────────────────────────────────────────────────────────
export function simulateReminders(
  identity: MockIdentity,
): ReminderSimResult {
  if (!identity) {
    throw new AssistantConfigError('UNAUTHORIZED', 'Thiếu staff identity', 401);
  }
  const { wouldFireCount, suppressedCount } = makeReminderSimulation();
  return {
    portHandles: [], // LIMITATION: out of scope for CORE/1.13 mock
    suppressedCount,
    pendingCount: wouldFireCount,
    simulationTimestamp: FIXTURE_ASOF,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────
export { AssistantConfigError };
