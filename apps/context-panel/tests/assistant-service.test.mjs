/**
 * tests/assistant-service.test.mjs — CORE/1.13 Assistant service unit tests.
 *
 * Validates:
 *  - AC1: today/week deterministic snapshots reproducible
 *  - AC2: autofill accept (manager mutation vs sale/AI propose-only)
 *  - AC2: stale proposal cannot be accepted
 *  - AC3: planning batch partial results, no double-mutation on replay
 *  - AC3: reschedule stale version returns VERSION_CONFLICT
 *  - AC4: provider config update manager-only, optimistic concurrency
 *  - AC5: reminder simulator returns deterministic count
 *
 * Runs against the built dist/ output.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Import frozen contract schemas — required for R2 contract-conformance
// evidence (must parse the REAL response, not just check field names).
const {
  PlanningBatchResultSchema,
  PlanningBatchItemResultSchema,
} = await import('../../../packages/contracts/dist/commands/scheduling.js');

// Build if dist/ is missing.
if (!existsSync('./dist/assistant/service.js')) {
  execSync('npm run build', { stdio: 'inherit' });
}

const {
  readToday,
  readWeek,
  listAutofillProposals,
  acceptAutofillFields,
  rejectAutofillProposal,
  isProposalStale,
  commitPlanningBatch,
  rescheduleNextAction,
  listProviderConfigs,
  updateProviderConfig,
  simulateReminders,
  AssistantConfigError,
} = await import('../dist/assistant/service.js');
const { assistantStore } = await import('../dist/assistant/store.js');
const {
  confirmAutofillDraft,
} = await import('../dist/assistant/service.js');

before(() => {
  // Reset store for deterministic test run.
  assistantStore.reset();
});

function supervisorIdentity() {
  return {
    staffId: 'staff-supervisor-001',
    role: 'SUPERVISOR',
    organizationId: 'org-001',
    actor: { kind: 'USER', userId: 'staff-supervisor-001' },
    extraScopes: ['autofill:profile-*', 'autofill:draft.confirm'],
  };
}

function saleIdentity() {
  return {
    staffId: 'staff-talent-001',
    role: 'TALENT_REVIEWER',
    organizationId: 'org-001',
    actor: { kind: 'USER', userId: 'staff-talent-001' },
    // CORE/1.13 B1 — talent reviewers have propose-only scope on
    // profile-talent-* profiles. NO draft.confirm scope.
    extraScopes: ['autofill:profile-talent-*'],
  };
}

function intakeIdentity() {
  return {
    staffId: 'staff-intake-001',
    role: 'INTAKE_OPERATOR',
    organizationId: 'org-001',
    actor: { kind: 'USER', userId: 'staff-intake-001' },
    // Intake operators have full draft.confirm on profile-intake-* profiles.
    extraScopes: ['autofill:profile-intake-*', 'autofill:draft.confirm'],
  };
}

function noScopeIdentity() {
  return {
    staffId: 'staff-no-scope-001',
    role: 'TALENT_REVIEWER',
    organizationId: 'org-001',
    actor: { kind: 'USER', userId: 'staff-no-scope-001' },
    // CORE/1.13 B1 — sale without explicit scope; cannot propose.
    extraScopes: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AC1 — Today / Week (deterministic, reproducible)
// ─────────────────────────────────────────────────────────────────────────────

test('AC1: readToday returns deterministic snapshot for staff', () => {
  const snap1 = readToday(saleIdentity());
  const snap2 = readToday(saleIdentity());
  assert.equal(snap1.snapshotId, snap2.snapshotId, 'same snapshotId for same staff');
  assert.equal(snap1.staffId, 'staff-talent-001');
  assert.ok(snap1.items.length >= 3, 'should have at least 3 items');
  assert.ok(snap1.kpiSummary.totalTargets >= 4);
});

test('AC1: readToday without identity throws UNAUTHORIZED', () => {
  try {
    readToday(null);
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof AssistantConfigError);
    assert.equal(err.errorCode, 'UNAUTHORIZED');
  }
});

test('AC1: readWeek returns 5+ items', () => {
  const snap = readWeek(supervisorIdentity());
  assert.ok(snap.items.length >= 5, 'should have at least 5 week items');
  assert.match(snap.weekStart, /^\d{4}-\d{2}-\d{2}$/);
});

test('AC1: today snapshot has snapshotId and asOf', () => {
  const snap = readToday(intakeIdentity());
  assert.match(snap.snapshotId, /^today-snap-/);
  assert.match(snap.asOf, /^\d{4}-\d{2}-\d{2}T/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC2 — Autofill
// ─────────────────────────────────────────────────────────────────────────────

test('AC2: listAutofillProposals returns 3 proposals (clear/conflict/stale)', () => {
  const proposals = listAutofillProposals(saleIdentity(), 'profile-demo-001');
  assert.equal(proposals.length, 3, 'should have 3 fixture proposals');
  const clear = proposals.find((p) => p.proposalId.includes('clear'));
  const conflict = proposals.find((p) => p.proposalId.includes('conflict'));
  const stale = proposals.find((p) => p.proposalId.includes('stale'));
  assert.ok(clear, 'should have clear proposal');
  assert.ok(conflict, 'should have conflict proposal');
  assert.ok(stale, 'should have stale proposal');
  assert.equal(stale.status, 'STALE');
  assert.ok(clear.fields.length >= 1);
  assert.ok(conflict.fields[0].hasConflict);
});

test('AC2: stale proposal CANNOT be accepted (throws STALE_CONTEXT 409)', () => {
  const proposals = listAutofillProposals(saleIdentity(), 'profile-stale-001');
  const stale = proposals.find((p) => p.status === 'STALE');
  assert.ok(stale);
  try {
    acceptAutofillFields(
      supervisorIdentity(),
      'profile-stale-001',
      stale.proposalId,
      [stale.fields[0].fieldPath],
      [],
    );
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof AssistantConfigError);
    assert.equal(err.errorCode, 'STALE_CONTEXT');
    assert.equal(err.httpStatus, 409);
  }
});

test('AC2: manager accepting fields creates DRAFT (canMutate=true, mutated=false until confirm)', () => {
  const proposals = listAutofillProposals(supervisorIdentity(), 'profile-mgr-001');
  const clear = proposals.find((p) => p.proposalId.includes('clear'));
  const result = acceptAutofillFields(
    supervisorIdentity(),
    'profile-mgr-001',
    clear.proposalId,
    [clear.fields[0].fieldPath],
    [clear.fields[1].fieldPath],
  );
  assert.equal(result.canMutate, true);
  assert.equal(result.mutated, false, 'accept only creates draft; mutation requires confirm()');
  assert.deepEqual(result.acceptedFields, [clear.fields[0].fieldPath]);
  assert.deepEqual(result.rejectedFields, [clear.fields[1].fieldPath]);
  assert.ok(result.draftId);
});

test('AC2: sale accepting fields does NOT mutate (canMutate=false, mutated=false)', () => {
  // CORE/1.13 B1: sale has scope on profile-talent-*. Use that namespace.
  const proposals = listAutofillProposals(saleIdentity(), 'profile-talent-sale-001');
  const clear = proposals.find((p) => p.proposalId.includes('clear'));
  const result = acceptAutofillFields(
    saleIdentity(),
    'profile-talent-sale-001',
    clear.proposalId,
    [clear.fields[0].fieldPath],
    [clear.fields[1].fieldPath],
  );
  assert.equal(result.canMutate, false);
  assert.equal(result.mutated, false);
  // Proposal moves to PENDING_REVIEW (not ACCEPTED, not REJECTED).
  const updated = listAutofillProposals(saleIdentity(), 'profile-talent-sale-001');
  const proposal = updated.find((p) => p.proposalId === clear.proposalId);
  assert.equal(proposal.status, 'PENDING_REVIEW');
});

test('AC2: rejecting a proposal moves it to REJECTED', () => {
  const proposals = listAutofillProposals(saleIdentity(), 'profile-talent-rej-001');
  const clear = proposals.find((p) => p.proposalId.includes('clear'));
  const rejected = rejectAutofillProposal(
    saleIdentity(),
    'profile-talent-rej-001',
    clear.proposalId,
  );
  assert.equal(rejected.status, 'REJECTED');
});

// ── Q1 — Manager mutation requires draft + confirm (no direct apply) ────────

test('Q1: manager accept creates DRAFT only (mutated=false)', () => {
  const proposals = listAutofillProposals(supervisorIdentity(), 'profile-q1-001');
  const clear = proposals.find((p) => p.proposalId.includes('clear'));
  const result = acceptAutofillFields(
    supervisorIdentity(),
    'profile-q1-001',
    clear.proposalId,
    [clear.fields[0].fieldPath],
    [clear.fields[1].fieldPath],
  );
  assert.equal(result.canMutate, true);
  assert.equal(result.mutated, false, 'manager accept must NOT directly mutate');
  assert.ok(result.draftId, 'draftId must be returned');
  assert.ok(result.draftRevision, 'draftRevision must be returned');
  assert.match(result.confirmationDigest, /^[a-f0-9]{64}$/u, 'SHA-256 hex digest');
});

test('B1: actor without scope → 403 FORBIDDEN (server-side, no UI bypass)', () => {
  // Use no-scope actor and a profile id they have no scope for.
  const proposals = listAutofillProposals(noScopeIdentity(), 'profile-b1-no-scope-001');
  const clear = proposals.find((p) => p.proposalId.includes('clear'));
  try {
    acceptAutofillFields(
      noScopeIdentity(),
      'profile-b1-no-scope-001',
      clear.proposalId,
      [clear.fields[0].fieldPath],
      [],
    );
    assert.fail('should have thrown FORBIDDEN');
  } catch (err) {
    assert.ok(err instanceof AssistantConfigError);
    assert.equal(err.errorCode, 'FORBIDDEN');
    assert.equal(err.httpStatus, 403);
  }
});

test('B1: sale proposes in their scope, no draftId (propose-only)', () => {
  // Sale with scope on profile-talent-* can propose but not confirm.
  const proposals = listAutofillProposals(saleIdentity(), 'profile-talent-sale-001');
  const clear = proposals.find((p) => p.proposalId.includes('clear'));
  const result = acceptAutofillFields(
    saleIdentity(),
    'profile-talent-sale-001',
    clear.proposalId,
    [clear.fields[0].fieldPath],
    [],
  );
  // Propose-only: canMutate=false (no draft.confirm scope).
  assert.equal(result.canMutate, false);
  assert.equal(result.mutated, false);
  assert.equal(result.draftId, undefined, 'sale must NOT receive a draftId');
});

test('B1: sale confirmed by sale → 403 (no draft.confirm scope)', () => {
  // Sale accepts in their scope to confirm they don't get draftId.
  // Then attempt to call confirm directly via raw draft (simulating
  // attacker crafting a draft confirm request).
  const proposals = listAutofillProposals(saleIdentity(), 'profile-talent-sale-attack');
  const clear = proposals.find((p) => p.proposalId.includes('clear'));
  const accept = acceptAutofillFields(
    saleIdentity(),
    'profile-talent-sale-attack',
    clear.proposalId,
    [clear.fields[0].fieldPath],
    [],
  );
  // No draft created (propose-only) — attack vector via direct draftId
  // is impossible because accept returns no draftId.
  assert.equal(accept.draftId, undefined, 'sale has no draftId');

  // Even if attacker fabricates a draftId, confirm path enforces scope.
  try {
    confirmAutofillDraft(
      saleIdentity(),
      'fabricated-draft-id-attack',
      'rev-1',
      'a'.repeat(64),
    );
    assert.fail('should throw NOT_FOUND or FORBIDDEN');
  } catch (err) {
    assert.ok(err instanceof AssistantConfigError);
    assert.ok(
      err.errorCode === 'NOT_FOUND' || err.errorCode === 'FORBIDDEN',
      `expected NOT_FOUND or FORBIDDEN, got ${err.errorCode}`,
    );
  }
});

test('B1: intake actor (with autofill:draft.confirm scope) can confirm in their scope', () => {
  const proposals = listAutofillProposals(intakeIdentity(), 'profile-intake-mgr-001');
  const clear = proposals.find((p) => p.proposalId.includes('clear'));
  const accept = acceptAutofillFields(
    intakeIdentity(),
    'profile-intake-mgr-001',
    clear.proposalId,
    [clear.fields[0].fieldPath],
    [],
  );
  assert.equal(accept.canMutate, true, 'intake scope grants draft creation');
  assert.ok(accept.draftId, 'intake receives a draftId');
  // Confirm with correct params → applies.
  const confirm = confirmAutofillDraft(
    intakeIdentity(),
    accept.draftId,
    accept.draftRevision,
    accept.confirmationDigest,
  );
  assert.equal(confirm.draft.applied, true);
});

test('B1: cross-scope actor: intake cannot confirm on profile-talent-* (scope mismatch)', () => {
  // First: intake tries to create draft on profile-talent-* (out of scope).
  const proposals = listAutofillProposals(intakeIdentity(), 'profile-talent-cross-1');
  const clear = proposals.find((p) => p.proposalId.includes('clear'));
  try {
    acceptAutofillFields(
      intakeIdentity(),
      'profile-talent-cross-1',
      clear.proposalId,
      [clear.fields[0].fieldPath],
      [],
    );
    assert.fail('should throw FORBIDDEN — intake has no scope on profile-talent-*');
  } catch (err) {
    assert.ok(err instanceof AssistantConfigError);
    assert.equal(err.errorCode, 'FORBIDDEN');
  }
});

test('B1: cross-org actor: actor with org=* (SYSTEM) requires explicit scope, not bypass', () => {
  // Test that SYSTEM actor — even with org='*' — must have explicit
  // autofill:profile-* scope. Build a SYSTEM identity with no scopes
  // and verify it cannot create draft.
  const systemNoScope = {
    staffId: 'svc-no-scope',
    role: 'SYSTEM',
    organizationId: '*',
    actor: { kind: 'SERVICE', serviceId: 'svc-no-scope' },
    extraScopes: [], // no autofill scope
  };
  const proposals = listAutofillProposals(systemNoScope, 'profile-b1-sys-no-1');
  const clear = proposals.find((p) => p.proposalId.includes('clear'));
  try {
    acceptAutofillFields(
      systemNoScope,
      'profile-b1-sys-no-1',
      clear.proposalId,
      [clear.fields[0].fieldPath],
      [],
    );
    assert.fail('SYSTEM without autofill:profile-* should still be rejected');
  } catch (err) {
    assert.ok(err instanceof AssistantConfigError);
    assert.equal(err.errorCode, 'FORBIDDEN');
  }
});

test('Q1: manager confirm() applies mutation (mutated=true via draft)', () => {
  const proposals = listAutofillProposals(supervisorIdentity(), 'profile-q1-confirm-001');
  const clear = proposals.find((p) => p.proposalId.includes('clear'));
  const accept = acceptAutofillFields(
    supervisorIdentity(),
    'profile-q1-confirm-001',
    clear.proposalId,
    [clear.fields[0].fieldPath],
    [],
  );
  assert.ok(accept.draftId);
  const confirm = confirmAutofillDraft(
    supervisorIdentity(),
    accept.draftId,
    accept.draftRevision,
    accept.confirmationDigest,
  );
  assert.equal(confirm.draft.applied, true);
  assert.ok(confirm.draft.appliedAt);
});

test('B5: confirm replay returns same applied draft (idempotent recovery)', () => {
  // CORE/1.13 B5: retry of confirm after a "lost response" returns the
  // same applied draft with NO re-mutation.
  const proposals = listAutofillProposals(supervisorIdentity(), 'profile-b5-replay-001');
  const clear = proposals.find((p) => p.proposalId.includes('clear'));
  const accept = acceptAutofillFields(
    supervisorIdentity(),
    'profile-b5-replay-001',
    clear.proposalId,
    [clear.fields[0].fieldPath],
    [],
  );
  // First confirm.
  const confirm1 = confirmAutofillDraft(
    supervisorIdentity(),
    accept.draftId,
    accept.draftRevision,
    accept.confirmationDigest,
  );
  assert.equal(confirm1.draft.applied, true);
  const firstAppliedAt = confirm1.draft.appliedAt;
  assert.ok(firstAppliedAt, 'first appliedAt must be set');

  // Retry (e.g. lost response) — same request → idempotent return.
  const confirm2 = confirmAutofillDraft(
    supervisorIdentity(),
    accept.draftId,
    accept.draftRevision,
    accept.confirmationDigest,
  );
  assert.equal(confirm2.draft.applied, true);
  assert.equal(
    confirm2.draft.appliedAt,
    firstAppliedAt,
    'retry must return same appliedAt — no re-mutation',
  );
  // Mutated must still be detected by accepting once and seeing no
  // double-counted mutation. (Side-effect: appliedMutations ledger
  // contains draftId only once — verified internally by store.)
});

test('B5: confirm replay with wrong revision/digest on applied draft returns same conflict', () => {
  const proposals = listAutofillProposals(supervisorIdentity(), 'profile-b5-mismatch-001');
  const clear = proposals.find((p) => p.proposalId.includes('clear'));
  const accept = acceptAutofillFields(
    supervisorIdentity(),
    'profile-b5-mismatch-001',
    clear.proposalId,
    [clear.fields[0].fieldPath],
    [],
  );
  confirmAutofillDraft(
    supervisorIdentity(),
    accept.draftId,
    accept.draftRevision,
    accept.confirmationDigest,
  );
  // Wrong revision on applied draft → DRAFT_VERSION_CONFLICT.
  try {
    confirmAutofillDraft(
      supervisorIdentity(),
      accept.draftId,
      'rev-wrong',
      accept.confirmationDigest,
    );
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof AssistantConfigError);
    assert.equal(err.errorCode, 'DRAFT_VERSION_CONFLICT');
    assert.equal(err.httpStatus, 409);
  }
  // Wrong digest on applied draft → CONFIRMATION_MISMATCH.
  try {
    confirmAutofillDraft(
      supervisorIdentity(),
      accept.draftId,
      accept.draftRevision,
      '0'.repeat(64),
    );
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof AssistantConfigError);
    assert.equal(err.errorCode, 'CONFIRMATION_MISMATCH');
  }
});

test('B5: confirm does NOT short-circuit before authorization + request-binding check', () => {
  // Different actor tries to replay — must be rejected (FORBIDDEN) instead of
  // returning the cached applied success.
  const proposals = listAutofillProposals(supervisorIdentity(), 'profile-b5-cross-actor-1');
  const clear = proposals.find((p) => p.proposalId.includes('clear'));
  const accept = acceptAutofillFields(
    supervisorIdentity(),
    'profile-b5-cross-actor-1',
    clear.proposalId,
    [clear.fields[0].fieldPath],
    [],
  );
  confirmAutofillDraft(
    supervisorIdentity(),
    accept.draftId,
    accept.draftRevision,
    accept.confirmationDigest,
  );
  // Different actor (intake with same draft.confirm scope but different
  // staffId) tries to replay → FORBIDDEN (actor binding).
  const otherActor = intakeIdentity();
  try {
    confirmAutofillDraft(
      otherActor,
      accept.draftId,
      accept.draftRevision,
      accept.confirmationDigest,
    );
    assert.fail('should throw FORBIDDEN (actor binding)');
  } catch (err) {
    assert.ok(err instanceof AssistantConfigError);
    assert.equal(err.errorCode, 'FORBIDDEN');
  }
});

test('Q1: confirm with wrong digest returns CONFIRMATION_MISMATCH 400 (un-applied draft)', () => {
  const proposals = listAutofillProposals(supervisorIdentity(), 'profile-q1-digest-001');
  const clear = proposals.find((p) => p.proposalId.includes('clear'));
  const accept = acceptAutofillFields(
    supervisorIdentity(),
    'profile-q1-digest-001',
    clear.proposalId,
    [clear.fields[0].fieldPath],
    [],
  );
  try {
    confirmAutofillDraft(
      supervisorIdentity(),
      accept.draftId,
      accept.draftRevision,
      '0'.repeat(64),
    );
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof AssistantConfigError);
    assert.equal(err.errorCode, 'CONFIRMATION_MISMATCH');
  }
});

test('Q1: confirm with wrong revision returns DRAFT_VERSION_CONFLICT 409', () => {
  const proposals = listAutofillProposals(supervisorIdentity(), 'profile-q1-rev-001');
  const clear = proposals.find((p) => p.proposalId.includes('clear'));
  const accept = acceptAutofillFields(
    supervisorIdentity(),
    'profile-q1-rev-001',
    clear.proposalId,
    [clear.fields[0].fieldPath],
    [],
  );
  try {
    confirmAutofillDraft(
      supervisorIdentity(),
      accept.draftId,
      'rev-wrong',
      accept.confirmationDigest,
    );
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof AssistantConfigError);
    assert.equal(err.errorCode, 'DRAFT_VERSION_CONFLICT');
    assert.equal(err.httpStatus, 409);
  }
});

test('Q2: sale confirm returns FORBIDDEN 403', () => {
  const proposals = listAutofillProposals(supervisorIdentity(), 'profile-q2-sale-confirm-001');
  const clear = proposals.find((p) => p.proposalId.includes('clear'));
  const accept = acceptAutofillFields(
    supervisorIdentity(),
    'profile-q2-sale-confirm-001',
    clear.proposalId,
    [clear.fields[0].fieldPath],
    [],
  );
  try {
    confirmAutofillDraft(
      saleIdentity(),
      accept.draftId,
      accept.draftRevision,
      accept.confirmationDigest,
    );
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof AssistantConfigError);
    assert.equal(err.errorCode, 'FORBIDDEN');
    assert.equal(err.httpStatus, 403);
  }
});

test('AC2: isProposalStale detects context version mismatch', () => {
  const proposals = listAutofillProposals(saleIdentity(), 'profile-stale-detect');
  const clear = proposals.find((p) => p.proposalId.includes('clear'));
  assert.equal(
    isProposalStale(saleIdentity(), 'profile-stale-detect', clear.proposalId, clear.contextVersion),
    false,
  );
  assert.equal(
    isProposalStale(saleIdentity(), 'profile-stale-detect', clear.proposalId, 'v-other'),
    true,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// AC3 — Planning Batch with Partial Results
// ─────────────────────────────────────────────────────────────────────────────

test('AC3: planning batch reports per-item outcomes (partial allowed)', () => {
  const result = commitPlanningBatch(
    supervisorIdentity(),
    'batch-ac3-mixed',
    ['item-1', 'item-2', 'item-3', 'item-4'],
    [
      { itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'd1' },
      { itemId: 'item-2', itemKind: 'NEXT_ACTION', payloadDigest: 'd2' },
      { itemId: 'item-3', itemKind: 'NEXT_ACTION', payloadDigest: 'd3' },
      { itemId: 'item-4', itemKind: 'NEXT_ACTION', payloadDigest: 'd4' },
    ],
    [
      {
        itemId: 'item-1',
        itemKind: 'NEXT_ACTION',
        outcome: 'APPLIED',
        appliedId: 'na-1',
        appliedVersion: 1,
      },
      {
        itemId: 'item-2',
        itemKind: 'NEXT_ACTION',
        outcome: 'ACCEPTED',
        pendingReference: { kind: 'COMMAND_OPERATION', operationId: 'op-2-fixed' },
      },
      {
        itemId: 'item-3',
        itemKind: 'NEXT_ACTION',
        outcome: 'FAILED',
        error: {
          itemId: 'item-3',
          errorCode: 'CONFLICT',
          messageKey: 'planning.batch.item.conflict',
          retryClass: 'REVIEW_REQUIRED',
        },
      },
      { itemId: 'item-4', itemKind: 'NEXT_ACTION', outcome: 'SKIPPED' },
    ],
  );
  assert.equal(result.batchId, 'batch-ac3-mixed');
  assert.equal(result.items.length, 4);
  assert.equal(typeof result.summary, 'object');
  assert.equal(result.summary.totalItems, 4);
  assert.equal(typeof result.summary.appliedCount, 'number');
  assert.equal(typeof result.summary.acceptedCount, 'number');
  assert.equal(typeof result.summary.failedCount, 'number');
  assert.equal(typeof result.summary.skippedCount, 'number');
  // Schema parse OK (frozen contract).
  const parsed = PlanningBatchResultSchema.safeParse(result);
  assert.equal(
    parsed.success,
    true,
    'AC3 mixed-outcome response must parse with frozen schema: ' +
      JSON.stringify(parsed.error?.issues),
  );
});

test('AC3: replanning same batch does not duplicate mutation (idempotent)', async () => {
  // CORE/1.13 R2 contract: items array, summary counts, frozen schema.
  // APPLIED → SKIPPED on replay, ACCEPTED → ACCEPTED with pendingReference
  // preserved.
  const r1 = commitPlanningBatch(
    supervisorIdentity(),
    'batch-idem',
    ['a-item-1', 'a-item-2'],
    [
      { itemId: 'a-item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'd1' },
      { itemId: 'a-item-2', itemKind: 'NEXT_ACTION', payloadDigest: 'd2' },
    ],
    [
      { itemId: 'a-item-1', itemKind: 'NEXT_ACTION', outcome: 'APPLIED', appliedId: 'nextaction-A', appliedVersion: 1 },
      {
        itemId: 'a-item-2',
        itemKind: 'NEXT_ACTION',
        outcome: 'ACCEPTED',
        pendingReference: { kind: 'COMMAND_OPERATION', operationId: 'pending-B' },
      },
    ],
  );
  assert.equal(r1.summary.appliedCount, 1);
  assert.equal(r1.summary.acceptedCount, 1);

  // R2 contract parse — real response must conform to frozen
  // PlanningBatchResultSchema.
  const parsed1 = PlanningBatchResultSchema.safeParse(r1);
  assert.equal(parsed1.success, true, 'r1 must parse with frozen schema');

  // Replay with same digests.
  const r2 = commitPlanningBatch(
    supervisorIdentity(),
    'batch-idem',
    ['a-item-1', 'a-item-2'],
    [
      { itemId: 'a-item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'd1' },
      { itemId: 'a-item-2', itemKind: 'NEXT_ACTION', payloadDigest: 'd2' },
    ],
  );
  const a1 = r2.items.find((x) => x.itemId === 'a-item-1');
  const a2 = r2.items.find((x) => x.itemId === 'a-item-2');
  // APPLIED replay → SKIPPED; appliedId preserved (frozen: SKIPPED may
  // carry appliedId if skip has a target canonical).
  assert.equal(a1.outcome, 'SKIPPED');
  assert.equal(a1.appliedId, 'nextaction-A', 'original appliedId preserved on SKIPPED replay');
  // ACCEPTED replay → keep ACCEPTED with pendingReference preserved.
  assert.equal(a2.outcome, 'ACCEPTED');
  assert.equal(a2.pendingReference?.operationId, 'pending-B');
  // Frozen schema parse OK.
  const parsed2 = PlanningBatchResultSchema.safeParse(r2);
  assert.equal(parsed2.success, true, 'r2 must parse with frozen schema');
});

test('AC3: PlanningBatchResult does NOT include allSuccess (frozen contract conformance)', () => {
  const r = commitPlanningBatch(
    supervisorIdentity(),
    'batch-contract',
    ['item-1'],
    [{ itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'd-1' }],
    [
      {
        itemId: 'item-1',
        itemKind: 'NEXT_ACTION',
        outcome: 'APPLIED',
        appliedId: 'na-c',
        appliedVersion: 1,
      },
    ],
  );
  assert.equal('allSuccess' in r, false, 'allSuccess must NOT be present');
  assert.equal('allSuccess' in r.summary, false, 'allSuccess NOT in summary');
  assert.equal(typeof r.summary, 'object');
  assert.equal(r.summary.totalItems, 1);
  assert.equal(r.summary.appliedCount, 1);
  // Schema parse OK.
  const parsed = PlanningBatchResultSchema.safeParse(r);
  assert.equal(parsed.success, true, 'contract response must parse with frozen schema');
});

// ── B2 — Batch ACCEPTED replay keeps ACCEPTED + reference; APPLIED replays SKIPPED ──

test('B2: ACCEPTED replay returns same ACCEPTED + pendingReference', () => {
  const r1 = commitPlanningBatch(
    supervisorIdentity(),
    'batch-b2-accept',
    ['item-1'],
    [{ itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'p1' }],
    [
      {
        itemId: 'item-1',
        itemKind: 'NEXT_ACTION',
        outcome: 'ACCEPTED',
        pendingReference: { kind: 'COMMAND_OPERATION', operationId: 'op-canonical-1-fixed' },
      },
    ],
  );
  assert.equal(r1.items[0].outcome, 'ACCEPTED');
  assert.equal(r1.items[0].pendingReference?.operationId, 'op-canonical-1-fixed');
  // Frozen schema parse OK.
  const parsed1 = PlanningBatchItemResultSchema.safeParse(r1.items[0]);
  assert.equal(parsed1.success, true, 'ACCEPTED item must parse with frozen schema');

  // Replay with same digest.
  const r2 = commitPlanningBatch(
    supervisorIdentity(),
    'batch-b2-accept',
    ['item-1'],
    [{ itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'p1' }],
  );
  assert.equal(r2.items[0].outcome, 'ACCEPTED', 'replay keeps ACCEPTED');
  assert.equal(r2.items[0].pendingReference?.operationId, 'op-canonical-1-fixed', 'pendingReference preserved');
  // ACCEPTED outcome MUST NOT carry appliedId (Owner rev 2: ACCEPTED does not
  // carry APPLIED signal).
  assert.equal(r2.items[0].appliedId, undefined, 'ACCEPTED has no appliedId per contract');
  assert.equal(r2.summary.acceptedCount, 1, 'ACCEPTED counted in summary');
  assert.equal(r2.summary.skippedCount, 0, 'ACCEPTED replay is NOT skipped');
  // Frozen schema parse OK on replay.
  const parsed2 = PlanningBatchResultSchema.safeParse(r2);
  assert.equal(parsed2.success, true, 'ACCEPTED replay result must parse with frozen schema');
});

test('B2: APPLIED replay → SKIPPED (no re-mutation), original rev preserved', () => {
  const r1 = commitPlanningBatch(
    supervisorIdentity(),
    'batch-b2-applied',
    ['item-1'],
    [{ itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'p1' }],
    [
      {
        itemId: 'item-1',
        itemKind: 'NEXT_ACTION',
        outcome: 'APPLIED',
        appliedId: 'nextaction-original',
        appliedVersion: 1,
      },
    ],
  );
  const r2 = commitPlanningBatch(
    supervisorIdentity(),
    'batch-b2-applied',
    ['item-1'],
    [{ itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'p1' }],
  );
  assert.equal(r2.items[0].outcome, 'SKIPPED');
  assert.equal(r2.items[0].appliedId, 'nextaction-original', 'original appliedId preserved on SKIPPED replay');
  assert.equal(r2.items[0].pendingReference, undefined, 'SKIPPED has no pendingReference per contract');
  // Frozen schema parse OK.
  const parsed = PlanningBatchResultSchema.safeParse(r2);
  assert.equal(parsed.success, true, 'SKIPPED replay result must parse with frozen schema');
});

test('B2: partial replay — mixed APPLIED+ACCEPTED+FAILED items', () => {
  // First commit: item-1 APPLIED, item-2 ACCEPTED, item-3 FAILED, item-4 fresh SKIPPED.
  const r1 = commitPlanningBatch(
    supervisorIdentity(),
    'batch-b2-partial',
    ['item-1', 'item-2', 'item-3', 'item-4'],
    [
      { itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'p1' },
      { itemId: 'item-2', itemKind: 'AVAILABILITY', payloadDigest: 'p2' },
      { itemId: 'item-3', itemKind: 'NEXT_ACTION', payloadDigest: 'p3' },
      { itemId: 'item-4', itemKind: 'NEXT_ACTION', payloadDigest: 'p4' },
    ],
    [
      {
        itemId: 'item-1',
        itemKind: 'NEXT_ACTION',
        outcome: 'APPLIED',
        appliedId: 'nextaction-A',
        appliedVersion: 1,
      },
      {
        itemId: 'item-2',
        itemKind: 'AVAILABILITY',
        outcome: 'ACCEPTED',
        pendingReference: { kind: 'COMMAND_OPERATION', operationId: 'pend-2-fixed' },
      },
      {
        itemId: 'item-3',
        itemKind: 'NEXT_ACTION',
        outcome: 'FAILED',
        error: {
          itemId: 'item-3',
          errorCode: 'CONFLICT',
          messageKey: 'planning.batch.item.conflict',
          retryClass: 'REVIEW_REQUIRED',
        },
      },
      { itemId: 'item-4', itemKind: 'NEXT_ACTION', outcome: 'SKIPPED' },
    ],
  );
  // Schema parse — frozen contract.
  const parsed1 = PlanningBatchResultSchema.safeParse(r1);
  assert.equal(parsed1.success, true, 'mixed outcome response must parse with frozen schema');

  // Replay all four with same digests.
  const r2 = commitPlanningBatch(
    supervisorIdentity(),
    'batch-b2-partial',
    ['item-1', 'item-2', 'item-3', 'item-4'],
    [
      { itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'p1' },
      { itemId: 'item-2', itemKind: 'AVAILABILITY', payloadDigest: 'p2' },
      { itemId: 'item-3', itemKind: 'NEXT_ACTION', payloadDigest: 'p3' },
      { itemId: 'item-4', itemKind: 'NEXT_ACTION', payloadDigest: 'p4' },
    ],
  );
  const item1 = r2.items.find((x) => x.itemId === 'item-1');
  const item2 = r2.items.find((x) => x.itemId === 'item-2');
  const item3 = r2.items.find((x) => x.itemId === 'item-3');
  // item-1 APPLIED → SKIPPED.
  assert.equal(item1.outcome, 'SKIPPED');
  assert.equal(item1.appliedId, 'nextaction-A');
  // item-2 ACCEPTED → ACCEPTED (replay).
  assert.equal(item2.outcome, 'ACCEPTED');
  assert.equal(item2.pendingReference?.operationId, 'pend-2-fixed');
  // item-3 FAILED → FAILED (replay, kept).
  assert.equal(item3.outcome, 'FAILED');
  assert.equal(item3.error?.errorCode, 'PREVIOUS_FAILED');
  // Frozen schema parse.
  const parsed2 = PlanningBatchResultSchema.safeParse(r2);
  assert.equal(parsed2.success, true, 'mixed replay response must parse with frozen schema');
});

// ── B3 — Same key/canncel payload digest → FAILED PAYLOAD_MISMATCH before mutation ──

test('B3: same key with different payload digest → FAILED PAYLOAD_MISMATCH (no re-mutate)', () => {
  // First commit with digest 'p1' → APPLIED.
  const r1 = commitPlanningBatch(
    supervisorIdentity(),
    'batch-b3-diff',
    ['item-1'],
    [{ itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'p1' }],
    [
      {
        itemId: 'item-1',
        itemKind: 'NEXT_ACTION',
        outcome: 'APPLIED',
        appliedId: 'nextaction-1',
        appliedVersion: 1,
      },
    ],
  );
  assert.equal(r1.items[0].outcome, 'APPLIED');
  // Frozen schema parse of fresh APPLIED.
  const parsed1 = PlanningBatchItemResultSchema.safeParse(r1.items[0]);
  assert.equal(parsed1.success, true, 'fresh APPLIED must parse with frozen schema');

  // Replay with different digest → FAILED with structured error, no re-mutation.
  const r2 = commitPlanningBatch(
    supervisorIdentity(),
    'batch-b3-diff',
    ['item-1'],
    [{ itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'p1-CHANGED' }],
  );
  assert.equal(r2.items[0].outcome, 'FAILED');
  assert.equal(r2.items[0].error?.errorCode, 'PAYLOAD_MISMATCH');
  assert.equal(r2.items[0].error?.retryClass, 'REVIEW_REQUIRED');
  // FAILED MUST NOT carry appliedId/appliedVersion (per contract).
  assert.equal(r2.items[0].appliedId, undefined);
  assert.equal(r2.items[0].appliedVersion, undefined);
  // Frozen schema parse of FAILED.
  const parsed2 = PlanningBatchItemResultSchema.safeParse(r2.items[0]);
  assert.equal(parsed2.success, true, 'FAILED with structured error must parse with frozen schema');
});

test('B3: same key/same payload → outcome preserved (no double mutation)', () => {
  // CORE/1.13 B3 contract: replay with same digest = idempotent.
  const r1 = commitPlanningBatch(
    supervisorIdentity(),
    'batch-b3-same',
    ['item-1'],
    [{ itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'SHA-256-CANONICAL-PAYLOAD' }],
    [
      {
        itemId: 'item-1',
        itemKind: 'NEXT_ACTION',
        outcome: 'APPLIED',
        appliedId: 'nextaction-original',
        appliedVersion: 1,
      },
    ],
  );
  const r2 = commitPlanningBatch(
    supervisorIdentity(),
    'batch-b3-same',
    ['item-1'],
    [{ itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'SHA-256-CANONICAL-PAYLOAD' }],
  );
  assert.equal(r2.items[0].outcome, 'SKIPPED', 'APPLIED → SKIPPED on replay');
  assert.equal(r2.items[0].appliedId, 'nextaction-original', 'original appliedId preserved');
});

test('B3: keys without payloadDigest → no digest check (legacy replay still works)', () => {
  // For backward compatibility, callers not sending payloadDigest get
  // the legacy replay-skip behavior.
  const r1 = commitPlanningBatch(
    supervisorIdentity(),
    'batch-b3-no-digest',
    ['item-1'],
    [],
    [
      {
        itemId: 'item-1',
        itemKind: 'NEXT_ACTION',
        outcome: 'APPLIED',
        appliedId: 'nextaction-1',
        appliedVersion: 1,
      },
    ],
  );
  const r2 = commitPlanningBatch(
    supervisorIdentity(),
    'batch-b3-no-digest',
    ['item-1'],
    [],
  );
  // Legacy path: APPLIED → SKIPPED.
  assert.equal(r2.items[0].outcome, 'SKIPPED');
});

// ── R2 — Real response parsed by frozen PlanningBatchResultSchema ──

test('R2: mixed outcomes response parses with PlanningBatchResultSchema', () => {
  const r = commitPlanningBatch(
    supervisorIdentity(),
    'batch-r2-mixed',
    ['item-1', 'item-2', 'item-3', 'item-4'],
    [
      { itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'd1' },
      { itemId: 'item-2', itemKind: 'AVAILABILITY', payloadDigest: 'd2' },
      { itemId: 'item-3', itemKind: 'SUPPRESSION', payloadDigest: 'd3' },
      { itemId: 'item-4', itemKind: 'NEXT_ACTION', payloadDigest: 'd4' },
    ],
    [
      {
        itemId: 'item-1',
        itemKind: 'NEXT_ACTION',
        outcome: 'APPLIED',
        appliedId: 'na-1',
        appliedVersion: 1,
      },
      {
        itemId: 'item-2',
        itemKind: 'AVAILABILITY',
        outcome: 'ACCEPTED',
        pendingReference: { kind: 'COMMAND_OPERATION', operationId: 'op-2-fixed' },
      },
      {
        itemId: 'item-3',
        itemKind: 'SUPPRESSION',
        outcome: 'FAILED',
        error: {
          itemId: 'item-3',
          errorCode: 'CONFLICT',
          messageKey: 'demo.conflict',
          retryClass: 'REVIEW_REQUIRED',
        },
      },
      { itemId: 'item-4', itemKind: 'NEXT_ACTION', outcome: 'SKIPPED' },
    ],
  );
  // Frozen contract parse.
  const parsed = PlanningBatchResultSchema.safeParse(r);
  assert.equal(parsed.success, true, 'mixed outcome response MUST parse with frozen schema: ' + JSON.stringify(parsed.error?.issues));
  assert.equal(parsed.data.items.length, 4);
  assert.equal(parsed.data.summary.totalItems, 4);
});

test('R2: ACCEPTED replay response parses with PlanningBatchResultSchema', () => {
  // First commit with ACCEPTED.
  const r1 = commitPlanningBatch(
    supervisorIdentity(),
    'batch-r2-accept-replay',
    ['item-1'],
    [{ itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'd-1' }],
    [
      {
        itemId: 'item-1',
        itemKind: 'NEXT_ACTION',
        outcome: 'ACCEPTED',
        pendingReference: { kind: 'COMMAND_OPERATION', operationId: 'op-original' },
      },
    ],
  );
  // Replay.
  const r2 = commitPlanningBatch(
    supervisorIdentity(),
    'batch-r2-accept-replay',
    ['item-1'],
    [{ itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'd-1' }],
  );
  // ACCEPTED on replay must keep pendingReference, no re-mutation.
  assert.equal(r2.items[0].outcome, 'ACCEPTED');
  assert.equal(r2.items[0].pendingReference?.operationId, 'op-original');
  // Frozen schema parse OK.
  const parsed = PlanningBatchResultSchema.safeParse(r2);
  assert.equal(parsed.success, true, 'ACCEPTED replay must parse with frozen schema');
});

test('R2: APPLIED replay response parses with PlanningBatchResultSchema', () => {
  const r1 = commitPlanningBatch(
    supervisorIdentity(),
    'batch-r2-applied-replay',
    ['item-1'],
    [{ itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'd-1' }],
    [
      {
        itemId: 'item-1',
        itemKind: 'NEXT_ACTION',
        outcome: 'APPLIED',
        appliedId: 'na-fresh',
        appliedVersion: 1,
      },
    ],
  );
  const r2 = commitPlanningBatch(
    supervisorIdentity(),
    'batch-r2-applied-replay',
    ['item-1'],
    [{ itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'd-1' }],
  );
  assert.equal(r2.items[0].outcome, 'SKIPPED');
  assert.equal(r2.items[0].appliedId, 'na-fresh');
  // Schema parse OK.
  const parsed = PlanningBatchResultSchema.safeParse(r2);
  assert.equal(parsed.success, true, 'APPLIED replay must parse with frozen schema');
});

test('R2: same-key/diff-payload response parses with PlanningBatchResultSchema', () => {
  const r1 = commitPlanningBatch(
    supervisorIdentity(),
    'batch-r2-pm',
    ['item-1'],
    [{ itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'd-orig' }],
    [
      {
        itemId: 'item-1',
        itemKind: 'NEXT_ACTION',
        outcome: 'APPLIED',
        appliedId: 'na-orig',
        appliedVersion: 1,
      },
    ],
  );
  const r2 = commitPlanningBatch(
    supervisorIdentity(),
    'batch-r2-pm',
    ['item-1'],
    [{ itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'd-DIFFERENT' }],
  );
  assert.equal(r2.items[0].outcome, 'FAILED');
  assert.equal(r2.items[0].error?.errorCode, 'PAYLOAD_MISMATCH');
  // FAILED must not have appliedId.
  assert.equal(r2.items[0].appliedId, undefined);
  // Schema parse OK.
  const parsed = PlanningBatchResultSchema.safeParse(r2);
  assert.equal(parsed.success, true, 'PAYLOAD_MISMATCH response must parse with frozen schema');
});

test('R2: response does NOT include ad-hoc fields (no flat errorCode/errorMessage on item)', () => {
  const r = commitPlanningBatch(
    supervisorIdentity(),
    'batch-r2-adhoc',
    ['item-1'],
    [],
    [
      {
        itemId: 'item-1',
        itemKind: 'NEXT_ACTION',
        outcome: 'FAILED',
        error: {
          itemId: 'item-1',
          errorCode: 'TEST',
          messageKey: 'demo.test',
          retryClass: 'NEVER',
        },
      },
    ],
  );
  // No ad-hoc flat fields.
  assert.equal(r.items[0].errorCode, undefined, 'no flat errorCode field');
  assert.equal(r.items[0].errorMessage, undefined, 'no flat errorMessage field');
  assert.equal(r.items[0].pendingId, undefined, 'no ad-hoc pendingId');
  assert.equal(r.items[0].replayReference, undefined, 'no ad-hoc replayReference');
  assert.equal(r.items[0].skipReason, undefined, 'no ad-hoc skipReason (use contract fields)');
  // AllSuccess absent at top-level.
  assert.equal('allSuccess' in r, false);
  // Schema parses.
  const parsed = PlanningBatchResultSchema.safeParse(r);
  assert.equal(parsed.success, true);
});

test('AC3: reschedule fresh version returns success', () => {
  const r = rescheduleNextAction(supervisorIdentity(), 'act-fresh', 'v-current', {
    scheduledAt: '2026-09-18T09:00:00+07:00',
  });
  assert.equal(r.success, true);
  assert.match(r.newVersion, /^v-/);
});

test('AC3: reschedule stale version returns VERSION_CONFLICT', () => {
  const r = rescheduleNextAction(supervisorIdentity(), 'act-stale', 'v-old', {
    scheduledAt: '2026-09-18T09:00:00+07:00',
  });
  assert.equal(r.success, false);
  assert.equal(r.error, 'VERSION_CONFLICT');
  assert.match(r.message, /cập nhật|conflict|version/i);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC4 — Provider Config (manager-only)
// ─────────────────────────────────────────────────────────────────────────────

test('AC4: listProviderConfigs seeds 2 fixtures (openai + anthropic)', () => {
  const providers = listProviderConfigs(supervisorIdentity());
  assert.ok(providers.length >= 2);
  const ids = providers.map((p) => p.providerId);
  assert.ok(ids.includes('provider-openai'));
  assert.ok(ids.includes('provider-anthropic'));
});

test('AC4: provider config read DTO does NOT include raw API key', () => {
  const providers = listProviderConfigs(supervisorIdentity());
  for (const p of providers) {
    // Should not have apiKey field at all
    assert.equal('apiKey' in p, false, `${p.providerId} must not expose apiKey`);
    assert.equal('key' in p, false, `${p.providerId} must not expose key`);
    assert.equal('secret' in p, false, `${p.providerId} must not expose secret`);
  }
});

test('AC4: sale CANNOT update provider config (403 FORBIDDEN)', () => {
  const providers = listProviderConfigs(saleIdentity());
  const target = providers[0];
  try {
    updateProviderConfig(saleIdentity(), target.configId, {
      providerId: target.providerId,
      baseUrl: target.baseUrl,
      model: target.model,
      apiStyle: target.apiStyle,
      capabilities: target.capabilities,
      dataPolicy: target.dataPolicy,
      active: !target.active,
      revision: target.version,
    });
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof AssistantConfigError);
    assert.equal(err.errorCode, 'FORBIDDEN');
    assert.equal(err.httpStatus, 403);
  }
});

test('AC4: manager updating provider with stale revision returns VERSION_CONFLICT', () => {
  const providers = listProviderConfigs(supervisorIdentity());
  const target = providers[0];
  try {
    updateProviderConfig(supervisorIdentity(), target.configId, {
      providerId: target.providerId,
      baseUrl: target.baseUrl,
      model: target.model,
      apiStyle: target.apiStyle,
      capabilities: target.capabilities,
      dataPolicy: target.dataPolicy,
      active: !target.active,
      revision: 'v-stale',
    });
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof AssistantConfigError);
    assert.equal(err.errorCode, 'VERSION_CONFLICT');
    assert.equal(err.httpStatus, 409);
  }
});

test('AC4: manager updating provider with current revision succeeds', () => {
  const providers = listProviderConfigs(supervisorIdentity());
  const target = providers[0];
  const updated = updateProviderConfig(supervisorIdentity(), target.configId, {
    providerId: target.providerId,
    baseUrl: target.baseUrl,
    model: target.model,
    apiStyle: target.apiStyle,
    capabilities: target.capabilities,
    dataPolicy: target.dataPolicy,
    active: !target.active,
    revision: target.version,
  });
  assert.notEqual(updated.version, target.version, 'version should increment');
  assert.equal(updated.active, !target.active, 'active should toggle');
});

// ── B4 — Provider write schema validation: strict, no secrets, no unknown ──

test('B4: provider write rejects unknown fields (strict schema)', () => {
  const providers = listProviderConfigs(supervisorIdentity());
  const target = providers[0];
  try {
    updateProviderConfig(supervisorIdentity(), target.configId, {
      providerId: target.providerId,
      baseUrl: target.baseUrl,
      model: target.model,
      apiStyle: target.apiStyle,
      capabilities: target.capabilities,
      dataPolicy: target.dataPolicy,
      active: target.active,
      revision: target.version,
      // Unknown field — should be rejected.
      secretBackdoor: 'value',
    });
    assert.fail('should reject unknown field');
  } catch (err) {
    assert.ok(err instanceof AssistantConfigError);
    assert.equal(err.errorCode, 'INVALID_PAYLOAD');
    assert.equal(err.httpStatus, 400);
  }
});

test('B4: provider write rejects raw apiKey (forbidden field)', () => {
  const providers = listProviderConfigs(supervisorIdentity());
  const target = providers[0];
  try {
    updateProviderConfig(supervisorIdentity(), target.configId, {
      providerId: target.providerId,
      baseUrl: target.baseUrl,
      model: target.model,
      apiStyle: target.apiStyle,
      capabilities: target.capabilities,
      dataPolicy: target.dataPolicy,
      active: target.active,
      revision: target.version,
      apiKey: 'sk-1234567890abcdef',
    });
    assert.fail('should reject forbidden apiKey field');
  } catch (err) {
    assert.ok(err instanceof AssistantConfigError);
    assert.equal(err.errorCode, 'INVALID_PAYLOAD');
    assert.match(err.message, /apiKey/);
  }
});

test('B4: provider write rejects token / secretKey / password nested', () => {
  const providers = listProviderConfigs(supervisorIdentity());
  const target = providers[0];
  // Try nested in budgetMonthly.
  try {
    updateProviderConfig(supervisorIdentity(), target.configId, {
      providerId: target.providerId,
      baseUrl: target.baseUrl,
      model: target.model,
      apiStyle: target.apiStyle,
      capabilities: target.capabilities,
      dataPolicy: target.dataPolicy,
      active: target.active,
      revision: target.version,
      budgetMonthly: {
        spendLimitVND: 100,
        tokenLimit: 100,
        // Forbidden nested field.
        secretKey: 'leaked',
      },
    });
    assert.fail('should reject nested secretKey');
  } catch (err) {
    assert.ok(err instanceof AssistantConfigError);
    assert.equal(err.errorCode, 'INVALID_PAYLOAD');
  }
});

test('B4: provider write error message does NOT echo secrets', () => {
  const providers = listProviderConfigs(supervisorIdentity());
  const target = providers[0];
  try {
    updateProviderConfig(supervisorIdentity(), target.configId, {
      providerId: target.providerId,
      baseUrl: target.baseUrl,
      model: target.model,
      apiStyle: target.apiStyle,
      capabilities: target.capabilities,
      dataPolicy: target.dataPolicy,
      active: target.active,
      revision: target.version,
      apiKey: 'should-not-appear-in-error-sk-SECRET-SHOULD-NOT-LEAK',
    });
  } catch (err) {
    // Error message must NOT contain the raw secret value.
    assert.equal(err instanceof AssistantConfigError, true);
    assert.equal(
      err.message.includes('should-not-appear-in-error-sk-SECRET-SHOULD-NOT-LEAK'),
      false,
      'error message must NOT contain the raw secret',
    );
    // Must mention only the field name.
    assert.match(err.message, /apiKey/);
  }
});

test('B4: provider write requires url for baseUrl (invalid URL rejected)', () => {
  const providers = listProviderConfigs(supervisorIdentity());
  const target = providers[0];
  try {
    updateProviderConfig(supervisorIdentity(), target.configId, {
      providerId: target.providerId,
      baseUrl: 'not-a-url',
      model: target.model,
      apiStyle: target.apiStyle,
      capabilities: target.capabilities,
      dataPolicy: target.dataPolicy,
      active: target.active,
      revision: target.version,
    });
    assert.fail('should reject non-URL baseUrl');
  } catch (err) {
    assert.ok(err instanceof AssistantConfigError);
    assert.equal(err.errorCode, 'INVALID_PAYLOAD');
  }
});

test('B4: provider write — manager-only + version conflict still enforced (B4 keeps AC4 invariants)', () => {
  const providers = listProviderConfigs(supervisorIdentity());
  const target = providers[0];
  // Sale rejected (manager-only).
  const saleAttempt = () =>
    updateProviderConfig(saleIdentity(), target.configId, {
      providerId: target.providerId,
      baseUrl: target.baseUrl,
      model: target.model,
      apiStyle: target.apiStyle,
      capabilities: target.capabilities,
      dataPolicy: target.dataPolicy,
      active: target.active,
      revision: target.version,
    });
  assert.throws(saleAttempt, (err) => err.errorCode === 'FORBIDDEN');
  // Stale revision rejected (version conflict).
  const staleAttempt = () =>
    updateProviderConfig(supervisorIdentity(), target.configId, {
      providerId: target.providerId,
      baseUrl: target.baseUrl,
      model: target.model,
      apiStyle: target.apiStyle,
      capabilities: target.capabilities,
      dataPolicy: target.dataPolicy,
      active: target.active,
      revision: 'v-stale',
    });
  assert.throws(staleAttempt, (err) => err.errorCode === 'VERSION_CONFLICT');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC5 — Reminder Port / Simulator
// ─────────────────────────────────────────────────────────────────────────────

test('AC5: reminder simulator returns deterministic counts', () => {
  const r1 = simulateReminders(supervisorIdentity());
  const r2 = simulateReminders(supervisorIdentity());
  assert.equal(r1.pendingCount, r2.pendingCount);
  assert.equal(r1.suppressedCount, r2.suppressedCount);
  assert.ok(r1.pendingCount >= 0);
  assert.ok(r1.suppressedCount >= 0);
});

test('AC5: reminder simulator does NOT claim real notification dispatched', () => {
  const r = simulateReminders(supervisorIdentity());
  assert.equal(r.portHandles.length, 0, 'CORE/1.13 port/simulator only — no handles');
  assert.match(r.simulationTimestamp, /^\d{4}-\d{2}-\d{2}T/);
});
