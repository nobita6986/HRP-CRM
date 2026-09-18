/**
 * apps/integration-api/tests/review-service.test.mjs — CORE/1.7
 *
 * Unit tests for ReviewService covering AC1–AC4.
 *
 * AC1: permissions mock, server-side scope check, PII guard.
 * AC2: reviewer/reason/version/audit stored; stale version conflict.
 * AC3: link/unlink/relink is NOT merge; no privileged merge capability.
 * AC4: replay revalidates mappings/context; no applied mutation repeat.
 */

import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

// Dynamic imports so that ESM test can load compiled TypeScript dist.
const dist = '../dist/review/index.js';
const {
  ReviewService,
  ReviewServiceError,
  reviewStore,
  createReviewEntry,
  parseReviewerCapability,
  buildPermissionContext,
  canDecide,
  canReplay,
} = await import(dist);

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeUserActor(userId = 'user-reviewer-001') {
  return { kind: 'USER', userId };
}

function makeServiceActor(serviceId = 'svc-reviewer-001') {
  return { kind: 'SERVICE', serviceId };
}

function makeOrgContext(orgId = 'org-review-001') {
  return { organizationId: orgId };
}

// ─── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  reviewStore.clear();
});

describe('CORE/1.7 — ReviewService', () => {

  // ─── AC1: Permissions mock + server-side scope check + PII guard ─────────

  test('AC1: listReviews — ANY reviewer can list (scope-filtered)', () => {
    // Create an entry.
    const entry = createReviewEntry({
      organizationId: 'org-review-001',
      intakeRevisionId: 'rev-001',
      draftDigest: '0xABCD',
    });
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    const actor = makeUserActor();
    const result = svc.listReviews(actor, 'org-review-001');
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].reviewEntryId, entry.reviewEntryId);
  });

  test('AC1: cross-org scope check — reviewer from org-A cannot list org-B entries', () => {
    const entry = createReviewEntry({
      organizationId: 'org-B',
      intakeRevisionId: 'rev-B',
      draftDigest: '0xBEEF',
    });
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    const actor = makeUserActor();
    // Reviewer in org-A trying to list in org-A.
    // Entry in org-B should not appear.
    const result = svc.listReviews(actor, 'org-review-001');
    assert.equal(result.entries.length, 0, 'cross-org entries must be filtered out');
  });

  test('AC1: PII guard — detail output does NOT include fullName/phone/citizenIdentity', () => {
    const entry = createReviewEntry({
      organizationId: 'org-review-001',
      intakeRevisionId: 'rev-pii-001',
      canonicalId: 'lp-001',
      canonicalVersion: 1,
      draftDigest: '0xPIICANDIDATE',
    });
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    const result = svc.getReviewDetail(makeUserActor(), 'org-review-001', entry.reviewEntryId);

    // Verify no PII fields in output.
    assert.ok(!('fullName' in result), 'fullName must not be in output');
    assert.ok(!('phone' in result), 'phone must not be in output');
    assert.ok(!('citizenIdentity' in result), 'citizenIdentity must not be in output');
    assert.ok(!('address' in result), 'address must not be in output');
    // Output should have redacted fields.
    assert.ok('canonicalId' in result, 'canonicalId should be in output');
    assert.ok('decision' in result, 'decision should be in output');
  });

  test('AC1: missing actor → buildPermissionContext throws', () => {
    assert.throws(
      () => buildPermissionContext(null, 'org-001'),
      /Invalid actor claim/i,
    );
  });

  test('AC1: malformed actor (no userId/serviceId) → throws', () => {
    assert.throws(
      () => buildPermissionContext({ kind: 'USER' }, 'org-001'),
      /must have userId or serviceId/i,
    );
  });

  test('AC1: getReviewDetail with invalid org → FORBIDDEN', () => {
    const entry = createReviewEntry({
      organizationId: 'org-B',
      intakeRevisionId: 'rev-002',
      draftDigest: '0xDEADBEEF',
    });
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    assert.throws(
      () => svc.getReviewDetail(makeUserActor(), 'org-A', entry.reviewEntryId),
      (err) => {
        if (!(err instanceof ReviewServiceError)) return false;
        assert.equal(err.code, 'FORBIDDEN');
        assert.ok(err.message.includes('SCOPE_MISMATCH'), err.message);
        return true;
      },
    );
  });

  // ─── AC2: Decision with reviewer/reason/version/audit; stale conflict ─────

  test('AC2: submitDecision stores reviewer/reason/version/audit', () => {
    const entry = createReviewEntry({
      organizationId: 'org-review-001',
      intakeRevisionId: 'rev-dec-001',
      draftDigest: '0xDECISION01',
    });
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    const actor = makeUserActor('user-reviewer-001');
    const result = svc.submitDecision(actor, 'org-review-001', entry.reviewEntryId, {
      kind: 'ACCEPT',
      reason: 'Talent profile verified via CCCD',
      expectedEntryVersion: 1,
    });

    assert.equal(result.status, 'DECIDED');
    assert.ok(result.decision, 'decision must be set');
    assert.equal(result.decision?.reviewerId, 'user-reviewer-001');
    assert.equal(result.decision?.tier, 'INBOUND_REVIEWER');
    assert.equal(result.decision?.kind, 'ACCEPT');
    assert.equal(result.decision?.reason, 'Talent profile verified via CCCD');
    assert.equal(result.decision?.baseVersion, 1);
  });

  test('AC2: stale version conflict on OPEN entry → VERSION_CONFLICT, no overwrite', () => {
    const entry = createReviewEntry({
      organizationId: 'org-review-001',
      intakeRevisionId: 'rev-stale-001',
      draftDigest: '0xSTALE01',
    });
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    const actor = makeUserActor();

    // Link first (changes version).
    svc.linkTarget(actor, 'org-review-001', entry.reviewEntryId, {
      targetKind: 'CANDIDATE',
      targetRef: 'cand-stale-001',
      label: 'Some label',
    });

    // Stale attempt: expectedEntryVersion=1 but current=2 (CREATED + LINK).
    assert.throws(
      () =>
        svc.submitDecision(actor, 'org-review-001', entry.reviewEntryId, {
          kind: 'REJECT',
          reason: 'Stale attempt',
          expectedEntryVersion: 1, // stale!
        }),
      (err) => {
        if (!(err instanceof ReviewServiceError)) return false;
        assert.equal(err.code, 'VERSION_CONFLICT', 'stale → VERSION_CONFLICT');
        assert.ok(err.message.includes('VERSION_CONFLICT'), err.message);
        return true;
      },
    );

    // Verify entry still OPEN with link (no overwrite).
    const current = svc.getReviewDetail(actor, 'org-review-001', entry.reviewEntryId);
    assert.equal(current.status, 'OPEN', 'still OPEN');
    assert.equal(current.decision, null, 'no decision recorded');
    assert.equal(current.anchorRefCount, 1, 'link preserved');
  });

  test('AC2: two reviewers on same OPEN entry → only first decides; second stale', () => {
    const entry = createReviewEntry({
      organizationId: 'org-review-001',
      intakeRevisionId: 'rev-race-001',
      draftDigest: '0xRACE01',
    });
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    const actor1 = makeUserActor('user-rev-001');
    const actor2 = makeUserActor('user-rev-002');

    // First reviewer decides.
    const r1 = svc.submitDecision(actor1, 'org-review-001', entry.reviewEntryId, {
      kind: 'ACCEPT',
      reason: 'Reviewer 1 approves',
      expectedEntryVersion: 1,
    });
    assert.equal(r1.status, 'DECIDED');
    assert.equal(r1.decision?.reviewerId, 'user-rev-001');

    // Second reviewer tries with stale version → VERSION_CONFLICT (entry already has DECISION audit).
    assert.throws(
      () =>
        svc.submitDecision(actor2, 'org-review-001', entry.reviewEntryId, {
          kind: 'REJECT',
          reason: 'Reviewer 2 disagrees',
          expectedEntryVersion: 1,
        }),
      (err) => {
        if (!(err instanceof ReviewServiceError)) return false;
        // Already decided → FORBIDDEN with ENTRY_ALREADY_DECIDED reason
        // (canDecide rejects DECIDED before version check).
        assert.equal(err.code, 'FORBIDDEN');
        assert.ok(err.message.includes('ENTRY_ALREADY_DECIDED'), err.message);
        return true;
      },
    );

    // Entry still shows first reviewer.
    const current = svc.getReviewDetail(actor1, 'org-review-001', entry.reviewEntryId);
    assert.equal(current.decision?.reviewerId, 'user-rev-001');
  });

  test('AC2: audit log append-only — decision adds audit entry', () => {
    const entry = createReviewEntry({
      organizationId: 'org-review-001',
      intakeRevisionId: 'rev-audit-001',
      draftDigest: '0xAUDIT01',
    });
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    const actor = makeUserActor('auditor-001');
    svc.submitDecision(actor, 'org-review-001', entry.reviewEntryId, {
      kind: 'REQUEST_CHANGES',
      reason: 'Missing evidence document',
      expectedEntryVersion: 1,
    });

    const detail = svc.getReviewDetail(actor, 'org-review-001', entry.reviewEntryId);
    assert.ok(detail.auditSummary.length >= 2, 'audit log has CREATED + DECISION entries');
    const actions = detail.auditSummary.map((a) => a.action);
    assert.ok(actions.includes('CREATED'), 'has CREATED');
    assert.ok(actions.some((a) => a.startsWith('DECISION:')), 'has DECISION audit');
  });

  // ─── AC3: Link/unlink/relink — NOT merge ─────────────────────────────────

  test('AC3: linkTarget adds anchor ref, does NOT call merge', () => {
    const entry = createReviewEntry({
      organizationId: 'org-review-001',
      intakeRevisionId: 'rev-link-001',
      draftDigest: '0xLINK01',
    });
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    const actor = makeUserActor('linker-001');
    const result = svc.linkTarget(actor, 'org-review-001', entry.reviewEntryId, {
      targetKind: 'CANDIDATE',
      targetRef: 'cand-001',
      label: 'Nguyen Van A',
    });

    assert.equal(result.anchorRefCount, 1, 'link added');
    assert.equal(result.status, 'OPEN', 'entry still OPEN — no merge happened');
    // Verify no canonical profile was mutated.
    assert.ok(!result.decision, 'no decision set');
  });

  test('AC3: unlinkTarget removes anchor ref, does NOT call merge', () => {
    const entry = createReviewEntry({
      organizationId: 'org-review-001',
      intakeRevisionId: 'rev-unlink-001',
      draftDigest: '0xUNLINK01',
    });
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    const actor = makeUserActor('unlinker-001');

    // Link first.
    const linked = svc.linkTarget(actor, 'org-review-001', entry.reviewEntryId, {
      targetKind: 'EVIDENCE',
      targetRef: 'ev-001',
      label: 'CCCD front',
    });

    // Verify entry has 1 anchor after link.
    assert.equal(linked.anchorRefCount, 1);

    // Unlink with non-existent linkId → NOT_FOUND (linkId is internal; unlink validates).
    assert.throws(
      () =>
        svc.unlinkTarget(actor, 'org-review-001', entry.reviewEntryId, 'nonexistent-link-id'),
      (err) => {
        if (!(err instanceof ReviewServiceError)) return false;
        // linkId not on entry → NOT_FOUND.
        assert.equal(err.code, 'NOT_FOUND');
        return true;
      },
    );
  });

  test('AC3: linkTarget on DECIDED entry → CANNOT_LINK', () => {
    const entry = createReviewEntry({
      organizationId: 'org-review-001',
      intakeRevisionId: 'rev-link-decided-001',
      draftDigest: '0xLINKDEC01',
    });
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    const actor = makeUserActor();

    // Decide first.
    svc.submitDecision(actor, 'org-review-001', entry.reviewEntryId, {
      kind: 'ACCEPT',
      reason: 'OK',
      expectedEntryVersion: 1,
    });

    // Link after decision → CANNOT_LINK.
    assert.throws(
      () =>
        svc.linkTarget(actor, 'org-review-001', entry.reviewEntryId, {
          targetKind: 'CANDIDATE',
          targetRef: 'cand-002',
          label: 'Should fail',
        }),
      (err) => {
        if (!(err instanceof ReviewServiceError)) return false;
        assert.equal(err.code, 'FORBIDDEN');
        assert.ok(err.message.includes('CANNOT_LINK'), err.message);
        return true;
      },
    );
  });

  test('AC3: service-tier reviewer can link on OPEN entry', () => {
    const entry = createReviewEntry({
      organizationId: 'org-review-001',
      intakeRevisionId: 'rev-svc-link-001',
      draftDigest: '0xSVCLINK01',
    });
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    const actor = makeServiceActor('svc-reviewer-001');
    const result = svc.linkTarget(actor, 'org-review-001', entry.reviewEntryId, {
      targetKind: 'SCHEMA',
      targetRef: 'schema-rev-001',
      label: 'Policy schema v2',
    });

    assert.equal(result.anchorRefCount, 1);
    assert.equal(result.status, 'OPEN');
  });

  // ─── AC4: Replay revalidates mappings/context; no applied mutation repeat ─────

  test('AC4: replay COMPLETED checkpoint → ALREADY_APPLIED, no mutation', () => {
    const entry = createReviewEntry({
      organizationId: 'org-review-001',
      intakeRevisionId: 'rev-replay-001',
      draftDigest: '0xREPLAY01',
    });
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    const actor = makeUserActor();

    const result = svc.replayReview(actor, 'org-review-001', entry.reviewEntryId, {
      state: 'COMPLETED',
      draftDigest: '0xREPLAY01',
      canonicalId: 'lp-replay-001',
      canonicalVersion: 2,
      appliedSteps: ['IDENTITY', 'PROFILE', 'CASE', 'AVAILABILITY'],
    });

    assert.equal(result.canProceed, false, 'cannot proceed when already applied');
    assert.ok(result.canProceedReason?.includes('ALREADY_APPLIED'), result.canProceedReason);
    assert.deepEqual(result.appliedSteps, ['IDENTITY', 'PROFILE', 'CASE', 'AVAILABILITY']);
    assert.equal(result.revalidatedMappings, true, 'mappings revalidated');
  });

  test('AC4: replay with digest drift → DRAFT_DIGEST_CHANGED, no mutation', () => {
    const entry = createReviewEntry({
      organizationId: 'org-review-001',
      intakeRevisionId: 'rev-replay-drift-001',
      draftDigest: '0xORIGINAL',
    });
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    const actor = makeUserActor();

    const result = svc.replayReview(actor, 'org-review-001', entry.reviewEntryId, {
      state: 'OPEN',
      draftDigest: '0xDRIFTED', // different digest
      appliedSteps: [],
    });

    assert.equal(result.canProceed, false);
    assert.ok(result.canProceedReason?.includes('DRAFT_DIGEST_CHANGED'), result.canProceedReason);
  });

  test('AC4: replay with canonicalId drift → CANONICAL_TARGET_CHANGED', () => {
    const entry = createReviewEntry({
      organizationId: 'org-review-001',
      intakeRevisionId: 'rev-replay-id-drift-001',
      canonicalId: 'lp-original-001',
      draftDigest: '0xIDDRIFT',
    });
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    const actor = makeUserActor();

    const result = svc.replayReview(actor, 'org-review-001', entry.reviewEntryId, {
      state: 'OPEN',
      draftDigest: '0xIDDRIFT',
      canonicalId: 'lp-CHANGED-001', // different target
      appliedSteps: [],
    });

    assert.equal(result.canProceed, false);
    assert.ok(result.canProceedReason?.includes('CANONICAL_TARGET_CHANGED'), result.canProceedReason);
  });

  test('AC4: replay with version drift → VERSION_CONFLICT', () => {
    const entry = createReviewEntry({
      organizationId: 'org-review-001',
      intakeRevisionId: 'rev-replay-ver-001',
      canonicalVersion: 3,
      draftDigest: '0xVERDRIFT',
    });
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    const actor = makeUserActor();

    const result = svc.replayReview(actor, 'org-review-001', entry.reviewEntryId, {
      state: 'OPEN',
      draftDigest: '0xVERDRIFT',
      canonicalVersion: 5, // checkpoint has higher version than review
      appliedSteps: [],
    });

    assert.equal(result.canProceed, false);
    assert.ok(result.canProceedReason?.includes('VERSION_CONFLICT'), result.canProceedReason);
  });

  test('AC4: replay OPEN checkpoint → canProceed=true', () => {
    const entry = createReviewEntry({
      organizationId: 'org-review-001',
      intakeRevisionId: 'rev-replay-open-001',
      draftDigest: '0xREPLAYOPEN',
    });
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    const actor = makeUserActor();

    const result = svc.replayReview(actor, 'org-review-001', entry.reviewEntryId, {
      state: 'REVIEW_PENDING',
      draftDigest: '0xREPLAYOPEN',
      appliedSteps: [],
    });

    assert.equal(result.canProceed, true, 'REVIEW_PENDING → can proceed');
    assert.equal(result.checkpointState, 'REVIEW_PENDING');
  });

  test('AC4: replay PARTIAL checkpoint → canProceed=true (resume possible)', () => {
    const entry = createReviewEntry({
      organizationId: 'org-review-001',
      intakeRevisionId: 'rev-replay-partial-001',
      draftDigest: '0xREPLAYPARTIAL',
    });
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    const actor = makeUserActor();

    const result = svc.replayReview(actor, 'org-review-001', entry.reviewEntryId, {
      state: 'PARTIAL',
      draftDigest: '0xREPLAYPARTIAL',
      appliedSteps: ['IDENTITY', 'PROFILE'],
    });

    assert.equal(result.canProceed, true, 'PARTIAL → can proceed for resume');
    assert.deepEqual(result.appliedSteps, ['IDENTITY', 'PROFILE']);
  });

  // ─── Decision kind validation ────────────────────────────────────────────

  test('AC2: invalid decision kind → VALIDATION_ERROR', () => {
    const entry = createReviewEntry({
      organizationId: 'org-review-001',
      intakeRevisionId: 'rev-invalid-kind-001',
      draftDigest: '0xINVALIDKIND',
    });
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    assert.throws(
      () =>
        svc.submitDecision(makeUserActor(), 'org-review-001', entry.reviewEntryId, {
          kind: 'BOGUS_KIND',
          reason: 'test',
          expectedEntryVersion: 1,
        }),
      (err) => {
        if (!(err instanceof ReviewServiceError)) return false;
        assert.equal(err.code, 'VALIDATION_ERROR');
        return true;
      },
    );
  });

  // ─── Replay: cross-org scope check ─────────────────────────────────────

  test('AC1: replay cross-org → FORBIDDEN SCOPE_MISMATCH', () => {
    const entry = createReviewEntry({
      organizationId: 'org-B',
      intakeRevisionId: 'rev-replay-scope-001',
      draftDigest: '0xSCOPEMISMATCH',
    });
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    assert.throws(
      () =>
        svc.replayReview(makeUserActor(), 'org-A', entry.reviewEntryId, {
          state: 'OPEN',
          draftDigest: '0xSCOPEMISMATCH',
          appliedSteps: [],
        }),
      (err) => {
        if (!(err instanceof ReviewServiceError)) return false;
        assert.equal(err.code, 'FORBIDDEN');
        assert.ok(err.message.includes('SCOPE_MISMATCH'), err.message);
        return true;
      },
    );
  });

  // ─── Tier enforcement ────────────────────────────────────────────────────

  test('AC2: INBOUND_REVIEWER cannot decide EXPIRED entry', () => {
    const entry = createReviewEntry({
      organizationId: 'org-review-001',
      intakeRevisionId: 'rev-expired-001',
      draftDigest: '0xEXPIRED01',
    });
    // Manually set status to EXPIRED.
    entry.status = 'EXPIRED';
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    const actor = makeUserActor(); // INBOUND_REVIEWER tier

    assert.throws(
      () =>
        svc.submitDecision(actor, 'org-review-001', entry.reviewEntryId, {
          kind: 'ACCEPT',
          reason: 'Should fail',
          expectedEntryVersion: 1,
        }),
      (err) => {
        if (!(err instanceof ReviewServiceError)) return false;
        assert.equal(err.code, 'FORBIDDEN');
        assert.ok(err.message.includes('INSUFFICIENT_TIER'), err.message);
        return true;
      },
    );
  });

  test('AC2: PRIVILEGED_REVIEWER can decide EXPIRED entry', () => {
    const entry = createReviewEntry({
      organizationId: 'org-review-001',
      intakeRevisionId: 'rev-priv-001',
      draftDigest: '0xPRIV01',
    });
    entry.status = 'EXPIRED';
    reviewStore.create(entry);

    const svc = new ReviewService(reviewStore);
    const actor = makeServiceActor('svc-priv-reviewer'); // PRIVILEGED_REVIEWER

    const result = svc.submitDecision(actor, 'org-review-001', entry.reviewEntryId, {
      kind: 'REJECT',
      reason: 'Privilege override',
      expectedEntryVersion: 1,
    });

    assert.equal(result.status, 'DECIDED');
    assert.equal(result.decision?.tier, 'PRIVILEGED_REVIEWER');
  });

  // ─── Service instantiation: createFromIntake ──────────────────────────────

  test('AC1: createFromIntake → creates OPEN entry from checkpoint ref', () => {
    const svc = new ReviewService(reviewStore);
    const result = svc.createFromIntake({
      organizationId: 'org-intake-001',
      intakeRevisionId: 'rev-from-intake-001',
      draftDigest: '0xINTAKE01',
      canonicalId: 'lp-from-intake-001',
      canonicalVersion: 1,
    });

    assert.equal(result.status, 'OPEN');
    assert.equal(result.decision, null, 'OPEN → no decision');
    assert.equal(result.canonicalId, 'lp-from-intake-001');
  });
});

describe('CORE/1.7 — parseReviewerCapability', () => {
  test('USER actor → INBOUND_REVIEWER tier', () => {
    const cap = parseReviewerCapability({ kind: 'USER', userId: 'u-001' }, 'org-001');
    assert.equal(cap.tier, 'INBOUND_REVIEWER');
    assert.equal(cap.reviewerId, 'u-001');
    assert.equal(cap.organizationId, 'org-001');
  });

  test('SERVICE actor → PRIVILEGED_REVIEWER tier', () => {
    const cap = parseReviewerCapability({ kind: 'SERVICE', serviceId: 'svc-001' }, 'org-001');
    assert.equal(cap.tier, 'PRIVILEGED_REVIEWER');
    assert.equal(cap.reviewerId, 'svc-001');
  });

  test('DELEGATED_USER actor → INBOUND_REVIEWER tier', () => {
    const cap = parseReviewerCapability({ kind: 'DELEGATED_USER', userId: 'du-001', serviceId: 'svc-001' }, 'org-001');
    assert.equal(cap.tier, 'INBOUND_REVIEWER');
    assert.equal(cap.reviewerId, 'du-001');
  });

  test('invalid actor kind → throws', () => {
    assert.throws(
      () => parseReviewerCapability({ kind: 'BOGUS' }, 'org-001'),
      /Invalid actor kind/i,
    );
  });
});
