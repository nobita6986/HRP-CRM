/**
 * src/assistant/store.ts — In-memory store for CORE/1.13 assistant/planning.
 *
 * Singleton Map-based store. State lost on restart (LIMITATION: in-memory).
 */
import type {
  AutofillDraft,
  AutofillProposal,
  BatchItemResult,
  PlanningBatchItemInput,
  PlanningBatchSummary,
  ProviderConfigRead,
  ProviderConfigWrite,
  WeekPlanSnapshot,
  TodaySnapshot,
} from './types.js';
import { AssistantConfigError } from './types.js';
import { createHash } from 'node:crypto';

/** SHA-256 of an arbitrary string. */
function computeDigest(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}
import {
  makeAutofillProposals,
  makeBatchResults,
  makeProviderConfigs,
  makeTodaySnapshot,
  makeWeekPlanSnapshot,
} from './fixtures.js';

/**
 * Singleton store class. State is reset on each server restart.
 */
export class AssistantStore {
  private autofillByProfile = new Map<string, AutofillProposal[]>();
  /** Drafts created when manager accepts an autofill proposal.
   * Draft is mutable in `acceptedFields` until confirmed. */
  private autofillDrafts = new Map<string, AutofillDraft>();
  /** Mutation ledger — once a draft is confirmed, its id is recorded here.
   * Prevents replay from re-applying the same mutation. */
  private appliedMutations = new Set<string>();
  /** Server-side authoritative NextAction versions (reschedule). */
  private nextActionVersions = new Map<string, string>();
  /** Batch items metadata — keyed by `${batchId}:${itemId}`.
   * Holds payloadDigest + outcome + appliedRevisionId/pendingId for
   * B2/B3 replay safety. */
  private batchItemsMeta = new Map<
    string,
    {
      payloadDigest: string;
      outcome: 'APPLIED' | 'ACCEPTED' | 'FAILED' | 'SKIPPED';
      appliedRevisionId?: string;
      pendingId?: string;
      recordedAt: string;
    }
  >();
  private providerConfigs = new Map<string, ProviderConfigRead>();
  private todayByStaff = new Map<string, TodaySnapshot>();
  private weekByStaff = new Map<string, WeekPlanSnapshot>();
  private batchResults = new Map<string, BatchItemResult[]>();
  private seeded = false;

  /** Seed once per server lifecycle. */
  seedOnce(): void {
    if (this.seeded) return;
    // Seed provider configs
    for (const cfg of makeProviderConfigs()) {
      this.providerConfigs.set(cfg.configId, cfg);
    }
    this.seeded = true;
  }

  /** Get or create today snapshot for a staffId. */
  getOrCreateToday(staffId: string): TodaySnapshot {
    const existing = this.todayByStaff.get(staffId);
    if (existing) return existing;
    const fresh = makeTodaySnapshot(staffId);
    this.todayByStaff.set(staffId, fresh);
    return fresh;
  }

  /** Get or create week plan snapshot for a staffId. */
  getOrCreateWeek(staffId: string): WeekPlanSnapshot {
    const existing = this.weekByStaff.get(staffId);
    if (existing) return existing;
    const fresh = makeWeekPlanSnapshot(staffId);
    this.weekByStaff.set(staffId, fresh);
    return fresh;
  }

  /** Get autofill proposals for a profile. Lazy create. */
  getOrCreateAutofill(profileId: string, actorId: string): AutofillProposal[] {
    const existing = this.autofillByProfile.get(profileId);
    if (existing) return existing;
    const fresh = makeAutofillProposals(profileId, actorId);
    this.autofillByProfile.set(profileId, fresh);
    return fresh;
  }

  /** Mark a proposal as accepted/rejected. */
  updateProposalStatus(
    profileId: string,
    proposalId: string,
    status: AutofillProposal['status'],
  ): AutofillProposal {
    const list = this.autofillByProfile.get(profileId);
    if (!list) {
      throw new AssistantConfigError('NOT_FOUND', 'Profile không có proposal');
    }
    const proposal = list.find((p) => p.proposalId === proposalId);
    if (!proposal) {
      throw new AssistantConfigError('NOT_FOUND', 'Proposal không tồn tại');
    }
    if (proposal.status === 'STALE') {
      throw new AssistantConfigError(
        'STALE_CONTEXT',
        'Context đã thay đổi; cần preview lại',
        409,
      );
    }
    proposal.status = status;
    return proposal;
  }

  /** Create an autofill mutation draft (actor must have profile scope per B1).
   * Returns a draft with a server-bound draftRevision and confirmationDigest
   * binding the proposed field-payload. The digest is STABLE per
   * (actorId, proposalId, profileId, sorted fieldPaths) so the caller
   * can retry confirm with same inputs and get B5 idempotent return.
   */
  createAutofillDraft(
    profileId: string,
    proposalId: string,
    actorId: string,
    fieldPaths: string[],
  ): AutofillDraft {
    const list = this.autofillByProfile.get(profileId);
    if (!list) {
      throw new AssistantConfigError('NOT_FOUND', 'Profile không có proposal');
    }
    const proposal = list.find((p) => p.proposalId === proposalId);
    if (!proposal) {
      throw new AssistantConfigError('NOT_FOUND', 'Proposal không tồn tại');
    }
    if (proposal.status === 'STALE') {
      throw new AssistantConfigError(
        'STALE_CONTEXT',
        'Context đã thay đổi; cần preview lại',
        409,
      );
    }

    // Stable draftId — keyed by deterministic primitives so retry can
    // locate same draft (idempotency). Caller receives this id + digest
    // and sends them back on confirm.
    const sortedFields = [...fieldPaths].sort();
    const stableKey = `${actorId}|${profileId}|${proposalId}|${sortedFields.join(',')}`;
    const stableDraftId = `draft-${computeDigest(stableKey).slice(0, 16)}`;
    const draftRevision = 'rev-1';

    // Reuse existing draft if it exists with same stableKey+actor.
    const existing = this.autofillDrafts.get(stableDraftId);
    if (existing && existing.actorId === actorId && !existing.applied) {
      return existing;
    }

    // confirmationDigest: SHA-256 over canonicalized payload — binding
    // for confirm. Includes actorId, profileId, proposalId, fieldPaths.
    const confirmationDigest = computeDigest(stableKey);

    const draft: AutofillDraft = {
      draftId: stableDraftId,
      proposalId,
      profileId,
      organizationId: proposal.organizationId,
      actorId,
      fieldPaths: sortedFields,
      draftRevision,
      confirmationDigest,
      applied: false,
      createdAt: new Date().toISOString(),
    };
    this.autofillDrafts.set(stableDraftId, draft);
    return draft;
  }

  /** Get a draft. */
  getAutofillDraft(draftId: string): AutofillDraft | undefined {
    return this.autofillDrafts.get(draftId);
  }

  /**
   * Confirm a draft — applies the mutation. Returns the applied draft.
   *
   * B5 — Idempotent recovery:
   *  - When draft.applied=true AND request is valid (correct revision +
   *    digest + same actorId), return the same applied draft. NO
   *    re-mutation. Response carries applied=true and original
   *    appliedAt. This handles "lost response after apply → retry".
   *  - When request mismatches (wrong revision, wrong digest, different
   *    actor), reject with appropriate error code.
   *
   * Note: actor-org authorization happens at the service layer (which
   * has access to MockIdentity). This method enforces actorId binding
   * (only original actor or 'system' override may confirm).
   * "system" override is reserved for HRP-owned system actors; it is
   * not exposed in current mock identity maps — added defensively for
   * future.
   */
  confirmAutofillDraft(
    draftId: string,
    expectedDraftRevision: string,
    confirmationDigest: string,
    actorId: string,
  ): AutofillDraft {
    const draft = this.autofillDrafts.get(draftId);
    if (!draft) {
      throw new AssistantConfigError('NOT_FOUND', 'Draft không tồn tại');
    }
    // Actor binding — service layer enforces actor-org; here enforce
    // actorId binding (draft was created by this actor or by system).
    if (draft.actorId !== actorId && actorId !== 'system') {
      throw new AssistantConfigError(
        'FORBIDDEN',
        'Confirm phải được gửi bởi cùng actor đã tạo draft',
        403,
      );
    }

    // B5 idempotent return: applied + valid request → same draft, no re-mutate.
    if (draft.applied) {
      if (draft.draftRevision !== expectedDraftRevision) {
        throw new AssistantConfigError(
          'DRAFT_VERSION_CONFLICT',
          'Draft đã được apply trước đó với revision khác; không thể replay',
          409,
        );
      }
      if (draft.confirmationDigest !== confirmationDigest) {
        throw new AssistantConfigError(
          'CONFIRMATION_MISMATCH',
          'Digest không khớp với draft đã apply',
          400,
        );
      }
      return draft; // same applied record, no re-mutation.
    }

    if (this.appliedMutations.has(draftId)) {
      throw new AssistantConfigError(
        'DUPLICATE_MUTATION',
        'Mutation đã được apply cho draft này',
        409,
      );
    }
    if (draft.draftRevision !== expectedDraftRevision) {
      throw new AssistantConfigError(
        'DRAFT_VERSION_CONFLICT',
        'Draft đã bị thay đổi; refresh trước khi confirm',
        409,
      );
    }
    if (draft.confirmationDigest !== confirmationDigest) {
      throw new AssistantConfigError(
        'CONFIRMATION_MISMATCH',
        'Digest không khớp với draft gốc',
        400,
      );
    }

    draft.applied = true;
    draft.appliedAt = new Date().toISOString();
    this.appliedMutations.add(draftId);

    const list = this.autofillByProfile.get(draft.profileId);
    if (list) {
      const proposal = list.find((p) => p.proposalId === draft.proposalId);
      if (proposal && proposal.status !== 'STALE') {
        proposal.status = 'ACCEPTED';
      }
    }
    return draft;
  }

  /** List provider configs. */
  listProviders(): ProviderConfigRead[] {
    return Array.from(this.providerConfigs.values());
  }

  /** Get a provider config. */
  getProvider(configId: string): ProviderConfigRead | undefined {
    return this.providerConfigs.get(configId);
  }

  /** Update provider config — manager-only, optimistic concurrency. */
  updateProvider(
    configId: string,
    input: ProviderConfigWrite,
    actorId: string,
    isManager: boolean,
  ): ProviderConfigRead {
    if (!isManager) {
      throw new AssistantConfigError(
        'FORBIDDEN',
        'Chỉ quản lý mới được sửa provider config',
        403,
      );
    }
    const existing = this.providerConfigs.get(configId);
    if (!existing) {
      throw new AssistantConfigError('NOT_FOUND', 'Provider không tồn tại');
    }
    if (existing.version !== input.revision) {
      throw new AssistantConfigError(
        'VERSION_CONFLICT',
        'Config đã thay đổi; refresh trước khi save',
        409,
      );
    }
    // PROPOSED: secretRef persistence is OUT OF SCOPE for CORE/1.13 (UI skeleton only).
    const updated: ProviderConfigRead = {
      configId: existing.configId,
      providerId: input.providerId,
      baseUrl: input.baseUrl,
      model: input.model,
      apiStyle: input.apiStyle,
      capabilities: input.capabilities,
      dataPolicy: input.dataPolicy,
      budgetMonthly: input.budgetMonthly
        ? {
            spendLimitVND: input.budgetMonthly.spendLimitVND,
            currentSpendVND: existing.budgetMonthly?.currentSpendVND ?? 0,
            tokenLimit: input.budgetMonthly.tokenLimit,
            currentTokens: existing.budgetMonthly?.currentTokens ?? 0,
          }
        : undefined,
      active: input.active,
      version: `v-${Number(existing.version.slice(2)) + 1}`,
    };
    this.providerConfigs.set(configId, updated);
    return updated;
  }

  /** Save batch results. */
  saveBatchResults(batchId: string, results: BatchItemResult[]): void {
    this.batchResults.set(batchId, results);
  }

  /** Get batch results. */
  getBatchResults(batchId: string): BatchItemResult[] | undefined {
    return this.batchResults.get(batchId);
  }

  /** Server-side authoritative version for NextAction (reschedule optimistic concurrency). */
  getNextActionVersion(actionId: string): string | undefined {
    return this.nextActionVersions.get(actionId);
  }

  /** Set server-side authoritative version. */
  setNextActionVersion(actionId: string, version: string): void {
    this.nextActionVersions.set(actionId, version);
  }

  // ── Batch item meta (B2 replay safety, B3 payload digest) ────────────────

  /** Get metadata for a batch item (batchId+itemId). */
  getBatchItemMeta(batchId: string, itemId: string):
    | {
        payloadDigest: string;
        outcome: 'APPLIED' | 'ACCEPTED' | 'FAILED' | 'SKIPPED';
        appliedRevisionId?: string;
        pendingId?: string;
        recordedAt: string;
      }
    | undefined {
    return this.batchItemsMeta.get(`${batchId}:${itemId}`);
  }

  /** Record a batch item outcome so replay can be detected. */
  recordBatchItemMeta(
    batchId: string,
    itemId: string,
    payloadDigest: string,
    outcome: 'APPLIED' | 'ACCEPTED' | 'FAILED' | 'SKIPPED',
    extras?: { appliedRevisionId?: string; pendingId?: string },
  ): void {
    this.batchItemsMeta.set(`${batchId}:${itemId}`, {
      payloadDigest,
      outcome,
      appliedRevisionId: extras?.appliedRevisionId,
      pendingId: extras?.pendingId,
      recordedAt: new Date().toISOString(),
    });
  }

  // ── Autofill draft permission helpers (B1) ──────────────────────────────

  /** Check if actor is allowed to create a draft for this profile (scope check). */
  isAutofillDraftCreateAllowed(
    actorId: string,
    organizationId: string,
    profileId: string,
    actorScopePredicate: (
      actorId: string,
      organizationId: string,
      profileId: string,
    ) => boolean,
  ): boolean {
    // Centralized predicate so service-layer can enforce B1.
    // The actual predicate lives in orchestrator-wire; we pass it through.
    return actorScopePredicate(actorId, organizationId, profileId);
  }

  /** Clear all (for tests). */
  reset(): void {
    this.autofillByProfile.clear();
    this.autofillDrafts.clear();
    this.appliedMutations.clear();
    this.nextActionVersions.clear();
    this.batchItemsMeta.clear();
    this.providerConfigs.clear();
    this.todayByStaff.clear();
    this.weekByStaff.clear();
    this.batchResults.clear();
    this.seeded = false;
  }
}

/** Module-level singleton. */
export const assistantStore = new AssistantStore();
