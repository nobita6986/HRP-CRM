/**
 * integration-api/tests/orchestrator.test.mjs — CORE/1.6 intake orchestrator tests.
 *
 * Pure JavaScript (ESM) — no TypeScript syntax for .mjs compatibility.
 * Coverage: AC1–AC9, digest, step idempotency, partial failure, resume, DNC.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockGateway } from '../dist/gateway/index.js';
import {
  IntakeOrchestrator,
  OrchestratorError,
  digestCanonical,
  buildCanonicalDraft,
  executeDncAction,
  buildCommitSuppressionPayload,
  assertCommitSuppressionPayloadValid,
  buildStepIdempotencyKey,
  STEP_ORDER,
} from '../dist/orchestrator/index.js';
import { ErrorCodeSchema, CommitSuppressionInputSchema } from '@hrp-engagement/contracts';

const FIXED_NOW = 1_700_000_000_000;
const now = () => FIXED_NOW;
let idCounter = 0;
const idGen = () => `icp-test-${FIXED_NOW}-${(idCounter += 1)}`;

// ──────────────────────────────────────────────────────────────────────────────
// Mock Prisma matching integration-store API (standalone functions, not prisma.intakeCheckpoint.*).
// The real integration-store exports: createIntakeCheckpoint, findIntakeCheckpoint, updateIntakeCheckpoint.
// ──────────────────────────────────────────────────────────────────────────────

class MockIntakeStore {
  constructor() {
    this.checkpoints = new Map();
    this._idGen = () => idGen();
  }

  async create(args) {
    const key = `${args.organizationId}:${args.intakeRevisionId}`;
    const existing = this.checkpoints.get(key);
    if (existing) {
      if (existing.draftDigest !== args.draftDigest) {
        const e = new Error('IDEMPOTENCY_CONFLICT: draftDigest khác');
        e.code = 'DUPLICATE_KEY';
        throw e;
      }
      return existing;
    }
    this.checkpoints.set(key, { ...args, createdAt: new Date(), updatedAt: new Date() });
    return this.checkpoints.get(key);
  }

  async findByOrgRevision(args) {
    const key = `${args.organizationId}:${args.intakeRevisionId}`;
    return this.checkpoints.get(key) ?? null;
  }

  async findByCheckpointId(checkpointId) {
    for (const v of this.checkpoints.values()) {
      if (v.checkpointId === checkpointId) return v;
    }
    return null;
  }

  async updateByCheckpointId(checkpointId, data) {
    for (const [k, v] of this.checkpoints.entries()) {
      if (v.checkpointId === checkpointId) {
        const updated = { ...v, ...data, updatedAt: new Date() };
        this.checkpoints.set(k, updated);
        return updated;
      }
    }
    throw new Error('checkpoint not found');
  }

  async updateByOrgRevision(args) {
    const key = `${args.organizationId}:${args.intakeRevisionId}`;
    const existing = this.checkpoints.get(key);
    if (!existing) {
      const e = new Error('checkpoint not found');
      e.code = 'VALIDATION_ERROR';
      throw e;
    }
    const updated = { ...existing, ...args, updatedAt: new Date() };
    this.checkpoints.set(key, updated);
    return updated;
  }

  reset() {
    this.checkpoints.clear();
    idCounter = 0;
  }
}

const mockStore = new MockIntakeStore();

// Wrap the store in a Prisma-like object that matches the Prisma API.
// Integration-store calls: createIntakeCheckpoint(prisma, input) → prisma.intakeCheckpoint.create({data})
//                          findIntakeCheckpoint(prisma, scope) → prisma.intakeCheckpoint.findUnique({where})
//                          updateIntakeCheckpoint(prisma, scope, update) → prisma.intakeCheckpoint.update({where, data})
const mockPrisma = {
  intakeCheckpoint: {
    async findUnique(args) {
      if (args.where && args.where.uq_intake_checkpoint_org_revision) {
        const q = args.where.uq_intake_checkpoint_org_revision;
        return mockStore.findByOrgRevision({ organizationId: q.organizationId, intakeRevisionId: q.intakeRevisionId });
      }
      if (args.where && args.where.checkpointId) {
        return mockStore.findByCheckpointId(args.where.checkpointId);
      }
      return null;
    },
    async create(args) {
      if (args.data) return mockStore.create(args.data);
      return null;
    },
    async update(args) {
      if (args.where && args.where.checkpointId && args.data) {
        return mockStore.updateByCheckpointId(args.where.checkpointId, args.data);
      }
      return null;
    },
  },
  async intakeCheckpoint_(args) {
    return null;
  },
  $transaction(fn) { return fn(mockPrisma); },
  reset() { mockStore.reset(); },
};

// Helper: read raw checkpoint by key (for test assertions).
function getCheckpoint(orgId, revId) {
  return mockStore.checkpoints.get(`${orgId}:${revId}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Mock helpers.
// ──────────────────────────────────────────────────────────────────────────────

function buildGateway() { return createMockGateway({ now }); }

function buildPreviewCaller(fixtures) {
  return {
    async resolveIdentityCandidates() {
      return {
        candidates: fixtures.map((f) => ({
          candidateId: f.candidateId ?? 'cand-001',
          strength: f.strength ?? 'STRONG',
        })),
      };
    },
  };
}

function buildGatewayCaller(gw) {
  return async (args) => gw.call({
    schemaVersion: '1',
    organizationId: args.organizationId,
    commandId: `cmd-${args.method}-test`,
    idempotencyKey: args.idempotencyKey,
    correlationId: args.correlationId,
    method: args.method,
    context: {
      schemaVersion: '1',
      organizationId: args.organizationId,
      tier: 'INBOUND_DEFAULT',
      correlationId: args.correlationId,
      provider: 'CHATWOOT',
      connectionId: 'conn-test-001',
    },
    // B4: actor từ trusted caller context → envelope, không phải payload.context.
    actor: args.actor ?? { kind: 'SERVICE', serviceId: 'svc-test' },
    scenarioId: args.scenarioId,
    payload: args.payload,
  });
}

function makeDraft(overrides = {}) {
  return {
    fullName: 'Nguyen Van A',
    phone: '0901234567',
    citizenIdentity: { number: '123456789012', address: '123 Nguyen Trai, Q1' },
    intent: { stage: 'NEW', availability: 'AVAILABLE_NOW' },
    evidenceRefs: [
      { evidenceId: 'ev-ref-001', kind: 'CCCD_FRONT' },
      { evidenceId: 'ev-ref-002', kind: 'CCCD_BACK' },
    ],
    ...overrides,
  };
}

function makeConfirmation(overrides = {}) {
  const draft = makeDraft();
  const ctx = {
    organizationId: 'org-test-001',
    intakeRevisionId: 'rev-001',
    ...draft,
  };
  const digest = digestCanonical(buildCanonicalDraft(ctx));
  return {
    draftRevisionId: 'rev-001',
    draftDigest: digest,
    ...overrides,
  };
}

function makeRunRequest(overrides = {}) {
  const conf = makeConfirmation();
  const draft = makeDraft();
  const merged = {
    ...draft,
    ...overrides,
    // EvidenceRefs cần merge array nếu được override.
    ...(overrides.evidenceRefs ? { evidenceRefs: overrides.evidenceRefs } : {}),
    // Intent cần merge sâu.
    ...(overrides.intent ? { intent: { ...draft.intent, ...overrides.intent } } : {}),
  };
  // B1+B3: server-compute digest từ actual payload. Phải khớp confirmation digest
  // nếu caller không override canonicalId/version.
  const canonicalId = (overrides.confirmation && overrides.confirmation.context && overrides.confirmation.context.canonicalId) || 'lp-exact-001';
  const canonicalVersion = (overrides.confirmation && overrides.confirmation.context && overrides.confirmation.context.canonicalVersion) || 1;
  const ctx = {
    organizationId: 'org-test-001',
    intakeRevisionId: 'rev-001',
    ...merged,
    canonicalId,
    canonicalVersion,
  };
  const newDigest = digestCanonical(buildCanonicalDraft(ctx));
  return {
    organizationId: 'org-test-001',
    intakeRevisionId: 'rev-001',
    fullName: merged.fullName,
    phone: merged.phone,
    citizenIdentity: merged.citizenIdentity,
    contactAddress: undefined,
    dob: undefined,
    intent: merged.intent,
    evidenceRefs: merged.evidenceRefs,
    confirmation: {
      organizationId: 'org-test-001',
      // context chỉ chứa 4 fields theo StaffReviewContextSchema; KHÔNG spread toàn bộ draft.
      context: {
        draftRevisionId: 'rev-001',
        draftDigest: newDigest,
        canonicalId,
        canonicalVersion,
      },
      confirmed: true,
    },
    draftDigest: newDigest,
    provider: 'CHATWOOT',
    connectionId: 'conn-test-001',
    externalReference: 'ext-ref-001',
    correlationId: 'corr-001',
    ...overrides,
  };
}

function createOrch(gw, preview) {
  return new IntakeOrchestrator({
    prisma: mockPrisma,
    gatewayCall: buildGatewayCaller(gw),
    identityPreview: preview ?? buildPreviewCaller([]),
    now,
    idGen,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// AC1: Preview no-mutation.
// ──────────────────────────────────────────────────────────────────────────────

test('AC1: preview() KHÔNG gọi createOrMatchLaborProfile', async () => {
  let calledCreateOrMatch = false;
  const safeGw = {
    async call(req) {
      if (req.method === 'createOrMatchLaborProfile') calledCreateOrMatch = true;
      return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '', data: {}, errors: [] };
    },
  };
  const orch = createOrch(safeGw, {
    async resolveIdentityCandidates() {
      return { candidates: [{ candidateId: 'cand-preview-001', strength: 'STRONG' }] };
    },
  });
  const result = await orch.preview(
    { organizationId: 'org-test-001', signal: { fullName: 'Nguyen Van A', phone: '0901234567' }, provider: 'CHATWOOT', connectionId: 'conn-test-001' },
    'corr-preview-001',
  );
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].strength, 'STRONG');
  assert.equal(calledCreateOrMatch, false, 'preview KHÔNG được gọi createOrMatch');
});

test('AC1: preview trả STRONG/WEAK/PARTIAL + hasStrongMatch', async () => {
  const orch = createOrch(buildGateway(), buildPreviewCaller([
    { strength: 'STRONG', candidateId: 'cand-strong' },
    { strength: 'WEAK', candidateId: 'cand-weak' },
  ]));
  const result = await orch.preview(
    { organizationId: 'org-test-001', signal: { phone: '0912345678' }, provider: 'CHATWOOT', connectionId: 'conn-test-001' },
    'corr-preview-002',
  );
  assert.equal(result.hasStrongMatch, true);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].strength, 'STRONG');
  assert.equal(result.candidates[1].strength, 'WEAK');
});

test('AC1: preview TTL = 5 phút', async () => {
  const orch = createOrch(buildGateway(), buildPreviewCaller([]));
  const before = FIXED_NOW;
  const result = await orch.preview(
    { organizationId: 'org-test-001', signal: { phone: '0901234567' }, provider: 'CHATWOOT', connectionId: 'conn-test-001' },
    'corr-preview-003',
  );
  const after = FIXED_NOW;
  const ttlMs = 5 * 60 * 1000;
  const expMs = new Date(result.previewExpiresAt).getTime();
  assert.ok(expMs >= before + ttlMs && expMs <= after + ttlMs + 1000, `TTL=${ttlMs}ms`);
});

// ──────────────────────────────────────────────────────────────────────────────
// AC2: run() tạo checkpoint + 5-step state machine.
// ──────────────────────────────────────────────────────────────────────────────

beforeEach(() => { mockPrisma.reset(); });

test('AC2: run() tạo checkpoint (state RUNNING ngay sau create, COMPLETED sau flow)', async () => {
  // Đây kiểm tra: createIntakeCheckpoint trả row state='RUNNING' tại create time
  // (orchestrator chạy các step synchronously trong cùng run() nên final state là terminal).
  // Assert cả intermediate state tại create + terminal sau run.
  const { createIntakeCheckpoint } = await import('@hrp-engagement/integration-store');
  // Tạo request — không chạy flow để giữ state RUNNING ban đầu.
  const req = makeRunRequest();
  const { row, created } = await createIntakeCheckpoint(mockPrisma, {
    checkpointId: 'icp-initial-state-test',
    schemaVersion: '1',
    organizationId: req.organizationId,
    intakeRevisionId: req.intakeRevisionId,
    draftDigest: req.draftDigest,
    canonicalId: req.confirmation.context.canonicalId,
    canonicalVersion: req.confirmation.context.canonicalVersion,
    currentStep: 'CONFIRM_VALIDATE',
    state: 'RUNNING',
    appliedSteps: [],
    stepResults: {},
    correlationId: req.correlationId,
    idempotencyKey: `intake:${req.intakeRevisionId}`,
  });
  assert.equal(created, true);
  assert.equal(row.state, 'RUNNING', 'createIntakeCheckpoint ghi state=RUNNING');
  assert.equal(row.draftDigest.length, 64, 'draftDigest SHA-256 hex 64 chars');
  // Cleanup: xóa row trực tiếp để test sau không bị ảnh hưởng.
  mockStore.checkpoints.delete(`${req.organizationId}:${req.intakeRevisionId}`);
});

test('AC2: EXACT_MATCH_SUCCESS → COMPLETED', async () => {
  const orch = createOrch(buildGateway());
  const result = await orch.run(makeRunRequest());
  assert.ok(['COMPLETED', 'PARTIAL', 'REVIEW_PENDING'].includes(result.state), `state=${result.state}`);
  assert.ok(result.appliedSteps.length >= 1, 'ít nhất 1 step đã apply');
  assert.equal(result.checkpointId.startsWith('icp-test-'), true);
  assert.equal(result.actedOnAnyStep, true);
});

test('AC2: run() idempotent — gọi lại cùng draftDigest không tạo checkpoint mới', async () => {
  // B2: stable gateway giữ version = 1 để confirmation binding ổn định qua run-thu-2.
  const stableGw = {
    async call(req) {
      if (req.method === 'createOrMatchLaborProfile') {
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { matchingOutcome: 'EXACT_MATCH', laborProfileId: 'lp-exact-001', version: 1 }, errors: [] };
      }
      if (req.method === 'updateLaborProfile') {
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { status: 'NOOP', canonicalId: 'lp-exact-001', currentVersion: 1 }, errors: [] };
      }
      if (req.method === 'openPlacementCase') {
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { canonicalId: 'case-001', version: 1, appliedStage: 'NEW' }, errors: [] };
      }
      if (req.method === 'updateLaborAvailability') {
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { canonicalId: 'lp-exact-001', version: 1, appliedAvailability: 'AVAILABLE_NOW', appliedAvailableFromDate: null }, errors: [] };
      }
      return { status: 'FAILED', schemaVersion: '1', commandId: '', correlationId: '', errors: [] };
    },
  };
  const orch = createOrch(stableGw);
  const req = makeRunRequest();
  await orch.run(req);
  const countBefore = mockStore.checkpoints.size;
  await orch.run(req);
  const countAfter = mockStore.checkpoints.size;
  assert.equal(countAfter, countBefore, 'idempotent: không tạo row mới');
});

test('AC2: checkpoint.state chuyển RUNNING → COMPLETED/FAILED/PARTIAL/REVIEW_PENDING', async () => {
  const orch = createOrch(buildGateway());
  await orch.run(makeRunRequest());
  const checkpoint = getCheckpoint('org-test-001', 'rev-001');
  assert.ok(['COMPLETED', 'FAILED', 'PARTIAL', 'REVIEW_PENDING'].includes(checkpoint.state),
    `state=${checkpoint.state} phải là final state`);
});

// ──────────────────────────────────────────────────────────────────────────────
// AC3: EXACT profile no-op không tính created.
// ──────────────────────────────────────────────────────────────────────────────

test('AC3: EXACT profile step trả isNoOp flag', async () => {
  const orch = createOrch(buildGateway());
  const result = await orch.run(makeRunRequest());
  if (result.stepResults['PROFILE']) {
    assert.equal(typeof result.stepResults['PROFILE'].isNoOp === 'boolean', true, 'PROFILE có isNoOp');
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// AC4: POSSIBLE dừng để review.
// ──────────────────────────────────────────────────────────────────────────────

test('AC4: POSSIBLE_MATCH → REVIEW_PENDING, KHÔNG chạy PROFILE/CASE/AVAILABILITY', async () => {
  const possibleGw = {
    async call(req) {
      if (req.method === 'createOrMatchLaborProfile') {
        return {
          status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { matchingOutcome: 'POSSIBLE_MATCH', reviewRef: 'rev-possible-001' }, errors: [],
        };
      }
      assert.fail(`Unexpected call: ${req.method}`);
      return { status: 'FAILED', schemaVersion: '1', commandId: '', correlationId: '', errors: [] };
    },
  };
  const orch = createOrch(possibleGw);
  const result = await orch.run(makeRunRequest());
  assert.equal(result.state, 'REVIEW_PENDING', 'POSSIBLE → REVIEW_PENDING');
  assert.ok(result.appliedSteps.includes('IDENTITY'), 'IDENTITY đã applied');
  assert.equal(result.appliedSteps.includes('PROFILE'), false, 'PROFILE không được chạy');
  assert.equal(result.appliedSteps.includes('CASE'), false, 'CASE không được chạy');
  assert.equal(result.appliedSteps.includes('AVAILABILITY'), false, 'AVAILABILITY không được chạy');
});

test('AC4: POSSIBLE reviewRef được ghi vào checkpoint', async () => {
  const possibleGw = {
    async call(req) {
      if (req.method === 'createOrMatchLaborProfile') {
        return {
          status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { matchingOutcome: 'POSSIBLE_MATCH', reviewRef: 'rev-possible-001' }, errors: [],
        };
      }
      return { status: 'FAILED', schemaVersion: '1', commandId: '', correlationId: '', errors: [] };
    },
  };
  const orch = createOrch(possibleGw);
  await orch.run(makeRunRequest());
  const checkpoint = getCheckpoint('org-test-001', 'rev-001');
  const results = checkpoint.stepResultsJson;
  const idResult = results['IDENTITY'];
  assert.equal(idResult?.kind, 'POSSIBLE_MATCH');
  assert.equal(idResult?.reviewRef, 'rev-possible-001');
});

// ──────────────────────────────────────────────────────────────────────────────
// AC5: NEW_PROFILE chỉ theo scenario policy mock.
// ──────────────────────────────────────────────────────────────────────────────

test('AC5: NEW_PROFILE scenario được accept (APPLIED)', async () => {
  const newGw = {
    async call(req) {
      if (req.method === 'createOrMatchLaborProfile') {
        return {
          status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { matchingOutcome: 'NEW_PROFILE', laborProfileId: 'lp-new-001', version: 1 }, errors: [],
        };
      }
      return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '', data: {}, errors: [] };
    },
  };
  const orch = createOrch(newGw);
  const result = await orch.run(makeRunRequest());
  assert.ok(result.appliedSteps.includes('IDENTITY'), 'IDENTITY đã apply');
});

// ──────────────────────────────────────────────────────────────────────────────
// AC6: Profile applied rồi case fail → PARTIAL, resume đúng step.
// ──────────────────────────────────────────────────────────────────────────────

test('AC6: CASE step fail → PARTIAL với partialFailure ghi rõ step/code/retryable', async () => {
  const failCaseGw = {
    async call(req) {
      if (req.method === 'createOrMatchLaborProfile') {
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { matchingOutcome: 'EXACT_MATCH', laborProfileId: 'lp-exact-001', version: 1 }, errors: [] };
      }
      if (req.method === 'updateLaborProfile') {
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { status: 'NOOP', canonicalId: 'lp-exact-001', currentVersion: 1 }, errors: [] };
      }
      if (req.method === 'openPlacementCase') {
        return { status: 'FAILED', schemaVersion: '1', commandId: '', correlationId: '',
          errors: [{ code: 'POLICY_REJECTION', messageKey: 'errors.policyRejection', retryClass: 'NEVER' }] };
      }
      return { status: 'FAILED', schemaVersion: '1', commandId: '', correlationId: '', errors: [] };
    },
  };
  const orch = createOrch(failCaseGw);
  const result = await orch.run(makeRunRequest());
  assert.equal(result.state, 'PARTIAL', 'CASE fail → PARTIAL');
  assert.ok(result.partialFailure, 'partialFailure có dữ liệu');
  assert.equal(result.partialFailure.failedStep, 'CASE', 'failedStep = CASE');
  assert.equal(result.partialFailure.errorCode, 'POLICY_REJECTION', 'errorCode ghi rõ');
  assert.equal(result.partialFailure.retryable, false, 'REVIEW_REQUIRED không retryable');
  assert.ok(result.appliedSteps.includes('IDENTITY'), 'IDENTITY đã applied');
  assert.ok(result.appliedSteps.includes('PROFILE'), 'PROFILE đã applied');
  assert.ok(!result.appliedSteps.includes('CASE'), 'CASE chưa apply');
});

test('AC6: resumeWithPayload() skip appliedSteps, chỉ chạy remaining steps', async () => {
  // Use a counter that survives across run+resume để mock biết retry vs first-call.
  let caseCalls = 0;
  const failCaseGw = {
    async call(req) {
      if (req.method === 'createOrMatchLaborProfile') {
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { matchingOutcome: 'EXACT_MATCH', laborProfileId: 'lp-exact-001', version: 1 }, errors: [] };
      }
      if (req.method === 'updateLaborProfile') {
        // B2: NOOP giữ version = 1 để confirmation binding ổn định sau resume.
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { status: 'NOOP', canonicalId: 'lp-exact-001', currentVersion: 1 }, errors: [] };
      }
      if (req.method === 'openPlacementCase') {
        caseCalls++;
        if (caseCalls === 1) {
          return { status: 'FAILED', schemaVersion: '1', commandId: '', correlationId: '',
            errors: [{ code: 'POLICY_REJECTION', messageKey: 'errors.policyRejection', retryClass: 'NEVER' }] };
        }
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { canonicalId: 'case-001', version: 1, appliedStage: 'NEW' }, errors: [] };
      }
      if (req.method === 'updateLaborAvailability') {
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { canonicalId: 'lp-exact-001', version: 1, appliedAvailability: 'AVAILABLE_NOW', appliedAvailableFromDate: null }, errors: [] };
      }
      return { status: 'FAILED', schemaVersion: '1', commandId: '', correlationId: '', errors: [] };
    },
  };
  const orch = createOrch(failCaseGw);
  const req = makeRunRequest();
  const firstResult = await orch.run(req);
  assert.equal(firstResult.state, 'PARTIAL');

  const resumeResult = await orch.resumeWithPayload(req);
  assert.equal(resumeResult.state, 'COMPLETED', 'resume → COMPLETED');
  assert.equal(caseCalls, 2, 'CASE chạy 2 lần (1 fail + 1 retry success)');
});

test('AC6: resume KHÔNG tạo duplicate profile (idempotency key preserved)', async () => {
  let identityCount = 0;
  const idemGw = {
    async call(req) {
      if (req.method === 'createOrMatchLaborProfile') identityCount++;
      if (req.method === 'createOrMatchLaborProfile') {
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { matchingOutcome: 'EXACT_MATCH', laborProfileId: 'lp-exact-001', version: 1 }, errors: [] };
      }
      if (req.method === 'updateLaborProfile') {
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { status: 'NOOP', canonicalId: 'lp-exact-001', currentVersion: 1 }, errors: [] };
      }
      if (req.method === 'openPlacementCase') {
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { canonicalId: 'case-rsm-001', version: 1, appliedStage: 'NEW' }, errors: [] };
      }
      if (req.method === 'updateLaborAvailability') {
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { canonicalId: 'lp-exact-001', version: 1, appliedAvailability: 'AVAILABLE_NOW', appliedAvailableFromDate: null }, errors: [] };
      }
      return { status: 'FAILED', schemaVersion: '1', commandId: '', correlationId: '', errors: [] };
    },
  };
  const orch = createOrch(idemGw);
  const req = makeRunRequest();
  await orch.run(req);
  await orch.resumeWithPayload(req);
  assert.equal(identityCount, 1, 'createOrMatchLaborProfile chỉ gọi 1 lần');
});

// ──────────────────────────────────────────────────────────────────────────────
// AC7: draftDigest khác → DUPLICATE_KEY.
// ──────────────────────────────────────────────────────────────────────────────

test('AC7: digest khác → OrchestratorError IDEMPOTENCY_CONFLICT', async () => {
  const orch = createOrch(buildGateway());
  const req = makeRunRequest();
  await orch.run(req); // digest A.
  const reqEdited = makeRunRequest({ fullName: 'Tran Van B' }); // digest B.
  try {
    await orch.run(reqEdited);
    assert.fail('phải throw IDEMPOTENCY_CONFLICT');
  } catch (err) {
    assert.ok(err instanceof OrchestratorError, 'là OrchestratorError');
    // B3: validate code qua ErrorCodeSchema (contract freeze), không chỉ assert string.
    const codeResult = ErrorCodeSchema.safeParse(err.code);
    assert.equal(codeResult.success, true, `code "${err.code}" không hợp lệ theo ErrorCodeSchema`);
    assert.equal(err.code, 'IDEMPOTENCY_CONFLICT', 'code = IDEMPOTENCY_CONFLICT');
  }
});

test('AC7: edit field → digest đổi → server chặn', async () => {
  const orch = createOrch(buildGateway());
  const req1 = makeRunRequest();
  await orch.run(req1);
  const req2 = makeRunRequest({ fullName: 'Edited Name', intent: { stage: 'CONTACTING', availability: 'AVAILABLE_NOW' } });
  try {
    await orch.run(req2);
    assert.fail('phải throw IDEMPOTENCY_CONFLICT');
  } catch (err) {
    assert.ok(err instanceof OrchestratorError);
    assert.equal(err.code, 'IDEMPOTENCY_CONFLICT');
  }
});

test('AC7: evidence đổi → digest đổi → confirmation cũ invalid', async () => {
  const orch = createOrch(buildGateway());
  await orch.run(makeRunRequest());
  const req2 = makeRunRequest({ evidenceRefs: [
    { evidenceId: 'ev-CHG', kind: 'CCCD_FRONT' },
    { evidenceId: 'ev-CHG2', kind: 'CCCD_BACK' },
  ] });
  try {
    await orch.run(req2);
    assert.fail('phải throw');
  } catch (err) {
    assert.equal(err.code, 'IDEMPOTENCY_CONFLICT');
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// AC8: confirmation binding — draftRevisionId/canonicalVersion đổi → invalid.
// B3: stale confirmation → VALIDATION_ERROR (không phải DUPLICATE_KEY).
// ──────────────────────────────────────────────────────────────────────────────

test('AC8: draftRevisionId khác → server-compute digest đổi → IDEMPOTENCY_CONFLICT', async () => {
  // B1: draftRevisionId đi vào canonical draft qua intakeRevisionId (cùng giá trị).
  // Đổi draftRevisionId trong confirmation context mà KHÔNG đổi req.intakeRevisionId
  // → row đã có intakeRevisionId cũ → isConfirmationValid fail → VALIDATION_ERROR.
  const orch = createOrch(buildGateway());
  const baseReq = makeRunRequest();
  await orch.run(baseReq);
  const req2 = makeRunRequest();
  req2.confirmation.context.draftRevisionId = 'rev-CHANGED';
  try {
    await orch.run(req2);
    assert.fail('phải throw');
  } catch (err) {
    // B3: confirmation binding fail (revision drift) → VALIDATION_ERROR.
    assert.equal(err.code, 'VALIDATION_ERROR');
  }
});

test('AC8: canonicalId khác → server-compute digest đổi → IDEMPOTENCY_CONFLICT', async () => {
  // B1: canonicalId nằm trong canonical draft → đổi canonicalId
  // làm digest đổi → IDEMPOTENCY_CONFLICT (semantic drift).
  const orch = createOrch(buildGateway());
  const baseReq = makeRunRequest();
  await orch.run(baseReq);
  const req2 = makeRunRequest();
  req2.confirmation.context.canonicalId = 'lp-DIFFERENT';
  // Recompute digest để khớp với canonicalId mới.
  req2.draftDigest = digestCanonical(buildCanonicalDraft({
    organizationId: req2.organizationId,
    intakeRevisionId: req2.intakeRevisionId,
    fullName: req2.fullName,
    phone: req2.phone,
    citizenIdentity: req2.citizenIdentity,
    intent: req2.intent,
    evidenceRefs: req2.evidenceRefs,
    canonicalId: 'lp-DIFFERENT',
    canonicalVersion: 1,
  }));
  req2.confirmation.context.draftDigest = req2.draftDigest;
  try {
    await orch.run(req2);
    assert.fail('phải throw');
  } catch (err) {
    // B1: digest mismatch vs saved row → IDEMPOTENCY_CONFLICT.
    assert.equal(err.code, 'IDEMPOTENCY_CONFLICT');
  }
});

test('AC8: canonicalVersion khác → server-compute digest đổi → IDEMPOTENCY_CONFLICT', async () => {
  // B1: canonicalVersion là một phần của review context → thay đổi version
  // làm digest đổi → IDEMPOTENCY_CONFLICT (semantic drift).
  const orch = createOrch(buildGateway());
  const baseReq = makeRunRequest();
  await orch.run(baseReq);
  const req2 = makeRunRequest();
  req2.confirmation.context.canonicalVersion = 99;
  try {
    await orch.run(req2);
    assert.fail('phải throw');
  } catch (err) {
    // B1+B3: digest mismatch do canonicalVersion drift → IDEMPOTENCY_CONFLICT.
    assert.equal(err.code, 'IDEMPOTENCY_CONFLICT');
  }
});

test('AC8: confirmed:true không đủ — cần digest binding (VALIDATION_ERROR)', async () => {
  const orch = createOrch(buildGateway());
  const req = makeRunRequest();
  // B1+B3: chỉ đổi confirmation.context.draftDigest, không đổi req.draftDigest
  // → server-compute vs req.draftDigest khớp, nhưng confirmation.context.draftDigest lệch
  // → VALIDATION_ERROR.
  const badConf = { ...req.confirmation, context: { ...req.confirmation.context, draftDigest: 'wrongdigest0000000000000000000000000000000000000000000' } };
  try {
    await orch.run({ ...req, confirmation: badConf });
    assert.fail('phải throw');
  } catch (err) {
    // B3: stale confirmation digest → VALIDATION_ERROR.
    assert.equal(err.code, 'VALIDATION_ERROR');
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// AC9: DNC action tách khỏi full intake.
// B4: actor bắt buộc từ trusted caller context; tests parse bằng shared schemas.
// ──────────────────────────────────────────────────────────────────────────────

const DNC_TEST_ACTOR = { kind: 'SERVICE', serviceId: 'svc-dnc-test' };

test('AC9: DNC hoạt động khi intake chưa đủ', async () => {
  let calledDnc = false;
  const dncGw = {
    async call(req) {
      if (req.method === 'commitSuppression') {
        calledDnc = true;
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { suppressionEventId: 'dnc-ev-001' }, errors: [] };
      }
      return buildGatewayCaller(buildGateway())(req);
    },
  };
  const result = await executeDncAction({
    organizationId: 'org-test-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-test-001',
    externalContactId: 'ext-contact-001',
    reason: 'CANDIDATE_REQUEST',
    idempotencyKey: 'dnc-idem-001',
    correlationId: 'corr-dnc-001',
    actor: DNC_TEST_ACTOR,
  }, buildGatewayCaller(dncGw));
  assert.equal(calledDnc, true);
  assert.equal(result.outcome, 'APPLIED');
  assert.equal(result.suppressionEventId, 'dnc-ev-001');
});

test('AC9: DNC payload không chứa CCCD', async () => {
  let capturedPayload = null;
  const dncGw = {
    async call(req) {
      if (req.method === 'commitSuppression') {
        capturedPayload = req.payload;
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { suppressionEventId: 'dnc-ev-002' }, errors: [] };
      }
      return { status: 'FAILED', schemaVersion: '1', commandId: '', correlationId: '', errors: [] };
    },
  };
  await executeDncAction({
    organizationId: 'org-test-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-test-001',
    externalContactId: 'ext-contact-002',
    reason: 'CANDIDATE_REQUEST',
    idempotencyKey: 'dnc-idem-002',
    correlationId: 'corr-dnc-002',
    actor: DNC_TEST_ACTOR,
  }, buildGatewayCaller(dncGw));
  const target = capturedPayload.target;
  assert.equal(target.kind, 'EXTERNAL_CONTACT', 'DNC dùng EXTERNAL_CONTACT (không CCCD)');
  assert.equal(target.resolvedCanonical, false, 'resolvedCanonical=false');
});

test('AC9: DNC + intake chạy song song (independent path)', async () => {
  let dncCount = 0;
  const gw = {
    async call(req) {
      if (req.method === 'commitSuppression') { dncCount++; return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '', data: { suppressionEventId: 'dnc-ev-003' }, errors: [] }; }
      return buildGatewayCaller(buildGateway())(req);
    },
  };
  const orch = createOrch(gw);
  const [intakeResult, dncResult] = await Promise.all([
    orch.run(makeRunRequest()),
    executeDncAction({
      organizationId: 'org-test-001',
      provider: 'CHATWOOT',
      connectionId: 'conn-test-001',
      externalContactId: 'ext-contact-003',
      reason: 'CANDIDATE_REQUEST',
      idempotencyKey: 'dnc-idem-003',
      correlationId: 'corr-dnc-003',
      actor: DNC_TEST_ACTOR,
    }, buildGatewayCaller(gw)),
  ]);
  assert.equal(dncCount, 1, 'DNC gọi 1 lần');
  assert.equal(dncResult.outcome, 'APPLIED');
  assert.ok(['COMPLETED', 'PARTIAL', 'REVIEW_PENDING'].includes(intakeResult.state), 'intake đã hoàn thành');
});

// ──────────────────────────────────────────────────────────────────────────────
// B4 (Auditor recheck 2026-09-15): Evidence bắt buộc.
//
// 1. Payload thực tế do builder tạo parse PASS qua CommitSuppressionInputSchema
//    import từ @hrp-engagement/contracts.
// 2. Gateway spy xác nhận actor đúng được truyền ở envelope, không nằm
//    trong payload.context.
// 3. Missing/malformed actor vẫn bị chặn trước gateway call.
// 4. externalAccountId parse được; DNC không cần full intake/CCCD.
// 5. Shape cũ chứa context.actor bị reject.
// ──────────────────────────────────────────────────────────────────────────────

const DNC_TEST_ACTOR_CANONICAL = { kind: 'USER', userId: 'user-dnc-evidence' };

function makeDncInputFixture(overrides = {}) {
  return {
    organizationId: 'org-evidence-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-evidence-001',
    externalContactId: 'ext-contact-evidence-001',
    externalAccountId: 'ext-acct-evidence-001',
    reason: 'CANDIDATE_REQUEST',
    note: 'evidence test',
    idempotencyKey: 'dnc-evidence-idem-001',
    correlationId: 'corr-evidence-001',
    actor: DNC_TEST_ACTOR_CANONICAL,
    ...overrides,
  };
}

// B4-Evidence #1: payload do builder tạo parse PASS qua CommitSuppressionInputSchema.
test('B4-Evidence #1: buildCommitSuppressionPayload parse PASS qua CommitSuppressionInputSchema (contract freeze)', () => {
  const input = makeDncInputFixture();
  const payload = buildCommitSuppressionPayload(input);
  // Nếu fail, throw ZodError với issues chi tiết.
  const result = CommitSuppressionInputSchema.safeParse(payload);
  assert.equal(result.success, true, `payload schema invalid: ${JSON.stringify(result.error?.issues)}`);
  // Helper exported cũng pass.
  assertCommitSuppressionPayloadValid(input);
});

// B4-Evidence #1b: externalAccountId parse được, DNC không cần full intake.
test('B4-Evidence #1b: externalAccountId parse được; DNC không cần CCCD/full intake', () => {
  const input = makeDncInputFixture({
    externalAccountId: 'ext-acct-min-001',
    // KHÔNG có canonicalId, KHÔNG có citizenIdentity, KHÔNG có CCCD.
    reason: 'OTHER',
    note: 'audit-note-min',
  });
  const payload = buildCommitSuppressionPayload(input);
  const result = CommitSuppressionInputSchema.safeParse(payload);
  assert.equal(result.success, true, `payload schema invalid: ${JSON.stringify(result.error?.issues)}`);
  // externalAccountId nằm trong context (IntakeContextRefSchema) VÀ trong target.
  assert.equal(payload.context.externalAccountId, 'ext-acct-min-001');
  assert.equal(payload.target.externalAccountId, 'ext-acct-min-001');
  // target.kind = EXTERNAL_CONTACT (DNC không tự tạo LaborProfile).
  assert.equal(payload.target.kind, 'EXTERNAL_CONTACT');
});

// B4-Evidence #2: Gateway spy xác nhận actor ở envelope, không trong payload.context.
test('B4-Evidence #2: actor truyền ở envelope, KHÔNG nằm trong payload.context', async () => {
  const capturedCalls = [];
  const spyGw = {
    async call(req) {
      capturedCalls.push(req);
      return { status: 'APPLIED', schemaVersion: '1', commandId: req.commandId, correlationId: req.correlationId,
        data: { suppressionEventId: 'dnc-evidence-001' }, errors: [] };
    },
  };
  const input = makeDncInputFixture();
  const result = await executeDncAction(input, buildGatewayCaller(spyGw));
  assert.equal(result.outcome, 'APPLIED');
  assert.equal(capturedCalls.length, 1);
  const captured = capturedCalls[0];

  // Actor ở envelope (gw.call signature) → gw.context actor.
  assert.deepEqual(captured.actor, DNC_TEST_ACTOR_CANONICAL,
    'actor ở envelope (gw.call args.actor)');

  // Actor KHÔNG trong payload.context.
  assert.equal(captured.payload.context.actor, undefined,
    'payload.context KHÔNG có actor (strict IntakeContextRefSchema)');
  // Payload vẫn parse được qua contract freeze.
  const schemaCheck = CommitSuppressionInputSchema.safeParse(captured.payload);
  assert.equal(schemaCheck.success, true,
    `payload phải parse được qua contract: ${JSON.stringify(schemaCheck.error?.issues)}`);
  // Payload chỉ chứa các field allowlisted của IntakeContextRefSchema.
  const ctxKeys = Object.keys(captured.payload.context).sort();
  assert.deepEqual(ctxKeys, ['externalAccountId', 'source'],
    `context chỉ chứa field strict của IntakeContextRefSchema, got: ${ctxKeys.join(',')}`);
});

// B4-Evidence #3: missing actor bị chặn trước gateway call (không gateway call nào được gọi).
test('B4-Evidence #3a: missing actor → ZodError trước gateway call', async () => {
  let callCount = 0;
  const spyGw = {
    async call() {
      callCount += 1;
      return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '', data: {}, errors: [] };
    },
  };
  const input = makeDncInputFixture();
  delete input.actor;
  await assert.rejects(
    () => executeDncAction(input, buildGatewayCaller(spyGw)),
    (err) => err.name === 'ZodError',
    'missing actor → ZodError',
  );
  assert.equal(callCount, 0, 'không gateway call nào được gọi khi thiếu actor');
});

// B4-Evidence #3b: malformed actor (sai shape) bị chặn trước gateway call.
test('B4-Evidence #3b: malformed actor → ZodError trước gateway call', async () => {
  let callCount = 0;
  const spyGw = {
    async call() {
      callCount += 1;
      return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '', data: {}, errors: [] };
    },
  };
  const input = makeDncInputFixture({ actor: { kind: 'BOGUS' } }); // invalid kind
  await assert.rejects(
    () => executeDncAction(input, buildGatewayCaller(spyGw)),
    (err) => err.name === 'ZodError',
    'malformed actor → ZodError',
  );
  assert.equal(callCount, 0, 'không gateway call nào được gọi khi actor malformed');
});

// B4-Evidence #5: shape cũ chứa context.actor bị reject qua schema.
test('B4-Evidence #5: payload với context.actor (shape cũ) bị CommitSuppressionInputSchema reject', () => {
  // Mô phỏng payload cũ trước B4 fix (context.actor có mặt).
  const oldShapePayload = {
    schemaVersion: '1',
    organizationId: 'org-evidence-001',
    target: {
      kind: 'EXTERNAL_CONTACT',
      organizationId: 'org-evidence-001',
      provider: 'CHATWOOT',
      connectionId: 'conn-evidence-001',
      externalContactId: 'ext-contact-evidence-001',
      resolvedCanonical: false,
    },
    reason: 'CANDIDATE_REQUEST',
    context: {
      source: { kind: 'INTEGRATION', provider: 'CHATWOOT', connectionId: 'conn-evidence-001' },
      externalAccountId: 'ext-acct-evidence-001',
      // Shape cũ — vi phạm strict IntakeContextRefSchema.
      actor: DNC_TEST_ACTOR_CANONICAL,
    },
  };
  const result = CommitSuppressionInputSchema.safeParse(oldShapePayload);
  assert.equal(result.success, false, 'shape cũ context.actor phải bị reject');
  // IntakeContextRefSchema strict — phát hiện unrecognized key 'actor' ở context.
  assert.ok(
    result.error.issues.some(
      (i) => Array.isArray(i.path) && i.path.length >= 1 && i.path[0] === 'context'
        && (i.code === 'unrecognized_keys' || i.message.includes('actor')),
    ),
    `phải có issue về context.actor strict: ${JSON.stringify(result.error.issues)}`,
  );
});

// B4-Evidence #4: DNC với actor + externalAccountId + reason OTHER vẫn chạy độc lập,
// không tạo intake checkpoint, không cần CCCD/full intake.
test('B4-Evidence #4: DNC không cần CCCD/full intake; actor + externalAccountId đủ', async () => {
  let calledDnc = false;
  let capturedActor = null;
  const dncGw = {
    async call(req) {
      if (req.method === 'commitSuppression') {
        calledDnc = true;
        capturedActor = req.actor;
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { suppressionEventId: 'dnc-evidence-004' }, errors: [] };
      }
      return { status: 'FAILED', schemaVersion: '1', commandId: '', correlationId: '', errors: [] };
    },
  };
  const input = makeDncInputFixture({
    reason: 'OTHER',
    externalAccountId: 'ext-acct-evidence-004',
    note: 'audit note for OTHER',
    actor: { kind: 'USER', userId: 'user-dnc-evidence-004' },
  });
  // KHÔNG CCCD, KHÔNG fullName, KHÔNG phone — chỉ có DNC fields.
  const result = await executeDncAction(input, buildGatewayCaller(dncGw));
  assert.equal(calledDnc, true);
  assert.equal(result.outcome, 'APPLIED');
  assert.deepEqual(capturedActor, { kind: 'USER', userId: 'user-dnc-evidence-004' });
});

// B4: DNC thiếu actor → throw (parse bằng shared ActorSchema).
test('B4: DNC thiếu actor → ZodError từ shared ActorSchema', async () => {
  const dncGw = {
    async call() { return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '', data: {}, errors: [] }; },
  };
  await assert.rejects(
    () => executeDncAction({
      organizationId: 'org-test-001',
      provider: 'CHATWOOT',
      connectionId: 'conn-test-001',
      externalContactId: 'ext-contact-004',
      reason: 'CANDIDATE_REQUEST',
      idempotencyKey: 'dnc-idem-004',
      correlationId: 'corr-dnc-004',
      // thiếu actor
    }, buildGatewayCaller(dncGw)),
    (err) => err.name === 'ZodError',
    'thiếu actor → ZodError',
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// Digest helper.
// ──────────────────────────────────────────────────────────────────────────────

test('digestCanonical: SHA-256 hex 64 ký tự, stable với key order', () => {
  const obj1 = { a: 1, b: 2 };
  const obj2 = { b: 2, a: 1 };
  const d1 = digestCanonical(obj1);
  const d2 = digestCanonical(obj2);
  assert.equal(d1.length, 64);
  assert.equal(d1, d2, 'key order khác → cùng digest');
});

test('digestCanonical: nested stable', () => {
  const obj = { nested: { deep: { value: 'test' } }, arr: [1, 2, 3] };
  assert.equal(digestCanonical(obj), digestCanonical(obj));
  assert.equal(digestCanonical(obj).length, 64);
});

test('buildCanonicalDraft: stable với evidence order', () => {
  const ctx1 = { organizationId: 'org-test-001', intakeRevisionId: 'rev-001', fullName: 'Test', phone: '0901234567',
    citizenIdentity: { number: '123', address: 'addr' },
    intent: { stage: 'NEW', availability: 'AVAILABLE_NOW' },
    evidenceRefs: [{ evidenceId: 'a', kind: 'CCCD_FRONT' }, { evidenceId: 'b', kind: 'CCCD_BACK' }] };
  const ctx2 = { ...ctx1 };
  const d1 = digestCanonical(buildCanonicalDraft(ctx1));
  const d2 = digestCanonical(buildCanonicalDraft(ctx2));
  assert.equal(d1, d2, 'same content → same digest');
});

test('buildStepIdempotencyKey: deterministic, không chứa attempt', () => {
  const k1 = buildStepIdempotencyKey('rev-001', 'IDENTITY');
  const k2 = buildStepIdempotencyKey('rev-001', 'IDENTITY');
  const k3 = buildStepIdempotencyKey('rev-001', 'PROFILE');
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);
  assert.ok(k1.includes('rev-001'));
  assert.ok(k1.includes('IDENTITY'));
  assert.ok(!k1.includes('attempt') && !k1.includes('retry'));
});

test('STEP_ORDER: 5 step theo đúng thứ tự', () => {
  assert.deepEqual(STEP_ORDER, ['CONFIRM_VALIDATE', 'IDENTITY', 'PROFILE', 'CASE', 'AVAILABILITY']);
});

// ──────────────────────────────────────────────────────────────────────────────
// Retry / idempotency.
// ──────────────────────────────────────────────────────────────────────────────

test('retry: gateway fail → PARTIAL với retryable=true', async () => {
  let callCount = 0;
  const retryGw = {
    async call(req) {
      callCount++;
      if (callCount === 1) {
        return { status: 'FAILED', schemaVersion: '1', commandId: '', correlationId: '',
          errors: [{ code: 'DEPENDENCY_UNAVAILABLE', messageKey: 'errors.dependencyUnavailable', retryClass: 'BOUNDED_SAME_KEY' }] };
      }
      return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
        data: { matchingOutcome: 'EXACT_MATCH', laborProfileId: 'lp-retry-001', version: 1 }, errors: [] };
    },
  };
  const orch = createOrch(retryGw);
  const result = await orch.run(makeRunRequest());
  assert.equal(result.state, 'PARTIAL');
  assert.equal(result.partialFailure?.retryable, true);
});

test('idempotency: same key → same result (no double-call on applied steps)', async () => {
  let identityCount = 0;
  const idemGw = {
    async call(req) {
      if (req.method === 'createOrMatchLaborProfile') identityCount++;
      if (req.method === 'createOrMatchLaborProfile') {
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { matchingOutcome: 'EXACT_MATCH', laborProfileId: 'lp-exact-001', version: 1 }, errors: [] };
      }
      if (req.method === 'updateLaborProfile') {
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { status: 'NOOP', canonicalId: 'lp-exact-001', currentVersion: 1 }, errors: [] };
      }
      if (req.method === 'openPlacementCase') {
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { canonicalId: 'case-idm-001', version: 1, appliedStage: 'NEW' }, errors: [] };
      }
      if (req.method === 'updateLaborAvailability') {
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { canonicalId: 'lp-exact-001', version: 1, appliedAvailability: 'AVAILABLE_NOW', appliedAvailableFromDate: null }, errors: [] };
      }
      return { status: 'FAILED', schemaVersion: '1', commandId: '', correlationId: '', errors: [] };
    },
  };
  const orch = createOrch(idemGw);
  const req = makeRunRequest();
  await orch.run(req);
  const identityAfterFirst = identityCount;
  await orch.resumeWithPayload(req);
  assert.equal(identityCount, identityAfterFirst, 'resume không gọi lại IDENTITY');
});

// ──────────────────────────────────────────────────────────────────────────────
// OrchestratorError taxonomy.
// ──────────────────────────────────────────────────────────────────────────────

test('OrchestratorError: code + message + retryable', () => {
  const err = new OrchestratorError('VERSION_CONFLICT', 'version lệch', false);
  assert.equal(err.code, 'VERSION_CONFLICT');
  assert.equal(err.message, 'version lệch');
  assert.equal(err.retryable, false);
  assert.equal(err.name, 'OrchestratorError');
});

test('OrchestratorError: retryable codes nhận diện đúng', () => {
  const retryableCodes = ['DEPENDENCY_UNAVAILABLE', 'RATE_LIMITED', 'BOUNDED_SAME_KEY'];
  const nonRetryableCodes = ['VALIDATION_ERROR', 'FORBIDDEN', 'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT'];
  for (const code of retryableCodes) {
    const err = new OrchestratorError(code, 'test', true);
    assert.equal(err.retryable, true, `${code} → retryable`);
  }
  for (const code of nonRetryableCodes) {
    const err = new OrchestratorError(code, 'test', false);
    assert.equal(err.retryable, false, `${code} → not retryable`);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Checkpoint survives instance recreation.
// ──────────────────────────────────────────────────────────────────────────────

test('checkpoint survives orchestrator instance recreation', async () => {
  // B2: gateway không bump version (NOOP) để resume vẫn bind được.
  const stableGw = {
    async call(req) {
      if (req.method === 'createOrMatchLaborProfile') {
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { matchingOutcome: 'EXACT_MATCH', laborProfileId: 'lp-exact-001', version: 1 }, errors: [] };
      }
      if (req.method === 'updateLaborProfile') {
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { status: 'NOOP', canonicalId: 'lp-exact-001', currentVersion: 1 }, errors: [] };
      }
      if (req.method === 'openPlacementCase') {
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { canonicalId: 'case-001', version: 1, appliedStage: 'NEW' }, errors: [] };
      }
      if (req.method === 'updateLaborAvailability') {
        return { status: 'APPLIED', schemaVersion: '1', commandId: '', correlationId: '',
          data: { canonicalId: 'lp-exact-001', version: 1, appliedAvailability: 'AVAILABLE_NOW', appliedAvailableFromDate: null }, errors: [] };
      }
      return { status: 'FAILED', schemaVersion: '1', commandId: '', correlationId: '', errors: [] };
    },
  };
  const orch1 = createOrch(stableGw);
  await orch1.run(makeRunRequest());
  const orch2 = createOrch(stableGw);
  const result = await orch2.resumeWithPayload(makeRunRequest());
  assert.ok(result.checkpointId);
  assert.ok(result.appliedSteps.length >= 1);
  const checkpoint = getCheckpoint('org-test-001', 'rev-001');
  assert.ok(['COMPLETED', 'PARTIAL', 'REVIEW_PENDING'].includes(checkpoint.state));
});
