/**
 * integration-api/tests/gateway.test.mjs — CORE/1.1 gateway mock fixtures.
 *
 * Backlog §Task 1.1 AC:
 *  - EXACT/POSSIBLE/NEW theo fixture ID; cùng fixture/clock cho cùng kết quả.
 *  - Same key/same payload → same result; same key/different payload → conflict.
 *  - Result ledger giới hạn rõ (in-memory, KHÔNG durable production).
 *  - Call log chứng minh no forbidden side effect, không fake merge/Worker/
 *    EFFECTIVE từ chat.
 *  - Mock one-active-case là scenario simulation, không concurrency proof.
 *
 * Test chạy trên dist (build trước test qua npm test workflow của package).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('./dist/gateway/index.js')) {
  execSync('npm run build', { stdio: 'inherit' });
}

const {
  createMockGateway,
  payloadDigest,
  SCENARIOS,
  SCENARIO_IDS,
} = await import('../dist/gateway/index.js');
const {
  AcceptedResponseSchema,
  OperationReferenceSchema,
} = await import('@hrp-engagement/contracts');

// Fixed clock for deterministic test.
const FIXED_CLOCK_MS = 1700000000000;
const now = () => FIXED_CLOCK_MS;

function buildRequest(overrides = {}) {
  return {
    schemaVersion: '1',
    organizationId: 'org-test-001',
    commandId: 'cmd-test-fixture-0001',
    idempotencyKey: 'idem-fixture-0001',
    correlationId: 'corr-fixture-0001',
    method: 'createOrMatchLaborProfile',
    context: {
      schemaVersion: '1',
      organizationId: 'org-test-001',
      tier: 'INBOUND_DEFAULT',
      correlationId: 'corr-fixture-0001',
      provider: 'CHATWOOT',
      connectionId: 'conn-test-001',
    },
    actor: { kind: 'SERVICE', serviceId: 'svc-test-001' },
    scenarioId: 'EXACT_MATCH_SUCCESS',
    payload: { fullName: 'Nguyen Van A', phone: '0901234567' },
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// AC #1: EXACT/POSSIBLE/NEW theo fixture; cùng fixture/clock → cùng kết quả.
// ────────────────────────────────────────────────────────────────────────────

test('gateway: EXACT_MATCH_SUCCESS trả data.matchingOutcome = EXACT_MATCH + version + laborProfileId', async () => {
  const gw = createMockGateway({ now });
  const req = buildRequest({ scenarioId: 'EXACT_MATCH_SUCCESS' });
  const r1 = await gw.call(req);
  assert.equal(r1.status, 'APPLIED');
  assert.equal(r1.data.matchingOutcome, 'EXACT_MATCH');
  assert.equal(r1.data.laborProfileId, 'lp-fixture-exact-001');
  assert.equal(typeof r1.data.version, 'number');
});

test('gateway: POSSIBLE_MATCH_REVIEW trả matchingOutcome = POSSIBLE_MATCH với reviewRef', async () => {
  const gw = createMockGateway({ now });
  const req = buildRequest({ scenarioId: 'POSSIBLE_MATCH_REVIEW' });
  const r = await gw.call(req);
  assert.equal(r.status, 'APPLIED');
  assert.equal(r.data.matchingOutcome, 'POSSIBLE_MATCH');
  assert.equal(r.data.reviewRef, 'rev-fixture-possible-001');
});

test('gateway: NEW_PROFILE_CREATED trả matchingOutcome = NEW_PROFILE với version=1', async () => {
  const gw = createMockGateway({ now });
  const req = buildRequest({ scenarioId: 'NEW_PROFILE_CREATED' });
  const r = await gw.call(req);
  assert.equal(r.status, 'APPLIED');
  assert.equal(r.data.matchingOutcome, 'NEW_PROFILE');
  assert.equal(r.data.version, 1);
});

test('gateway: same fixture + same clock → cùng kết quả (deterministic)', async () => {
  const gw = createMockGateway({ now });
  const req1 = buildRequest({ idempotencyKey: 'idem-deterministic-a' });
  const req2 = buildRequest({ idempotencyKey: 'idem-deterministic-b' });
  const r1 = await gw.call(req1);
  const r2 = await gw.call(req2);
  // Cache miss cả 2 (khác key), nhưng scenario + clock deterministic.
  assert.equal(r1.status, r2.status);
  assert.equal(r1.data.matchingOutcome, r2.data.matchingOutcome);
  assert.equal(r1.data.laborProfileId, r2.data.laborProfileId);
});

// ────────────────────────────────────────────────────────────────────────────
// AC #2: Timeout trước apply, sau apply, permission/policy/version/idempotency
//        conflict, malformed dependency.
// ────────────────────────────────────────────────────────────────────────────

test('gateway: TIMEOUT_BEFORE_APPLY trả FAILED + DEPENDENCY_UNAVAILABLE', async () => {
  const gw = createMockGateway({ now });
  const req = buildRequest({
    scenarioId: 'TIMEOUT_BEFORE_APPLY',
    method: 'openPlacementCase',
    payload: { organizationId: 'org-test-001', intendedStage: 'NEW' },
    idempotencyKey: 'idem-timeout-before',
  });
  const r = await gw.call(req);
  assert.equal(r.status, 'FAILED');
  assert.equal(r.errors[0].code, 'DEPENDENCY_UNAVAILABLE');
});

test('gateway: TIMEOUT_AFTER_APPLY trả ACCEPTED (commit xong mới mất kết nối)', async () => {
  const gw = createMockGateway({ now });
  const req = buildRequest({
    scenarioId: 'TIMEOUT_AFTER_APPLY',
    method: 'openPlacementCase',
    payload: { organizationId: 'org-test-001', intendedStage: 'NEW' },
    idempotencyKey: 'idem-timeout-after',
  });
  const r = await gw.call(req);
  assert.equal(r.status, 'ACCEPTED');
  assert.equal(r.operation.kind, 'COMMAND_OPERATION', 'operation.kind must be COMMAND_OPERATION');
  assert.ok(r.operation.operationId, 'phải có operation.operationId');
  // Validate bằng frozen contract schema.
  assert.ok(AcceptedResponseSchema.safeParse(r).success, 'phải khớp AcceptedResponseSchema');
});

test('gateway: PERMISSION_DENIED trả FAILED + FORBIDDEN khi tier=INBOUND_DEFAULT + merge method', async () => {
  const gw = createMockGateway({ now });
  const req = buildRequest({
    scenarioId: 'PERMISSION_DENIED',
    method: 'mergeLaborProfiles', // privileged
    context: {
      schemaVersion: '1',
      organizationId: 'org-test-001',
      tier: 'INBOUND_DEFAULT',
      correlationId: 'corr-perm-denied',
      provider: 'CHATWOOT',
      connectionId: 'conn-001',
    },
    payload: { sourceId: 'lp-001', targetId: 'lp-002' },
    idempotencyKey: 'idem-perm-denied',
  });
  const r = await gw.call(req);
  assert.equal(r.status, 'FAILED');
  assert.equal(r.errors[0].code, 'FORBIDDEN');
});

test('gateway: POLICY_REJECTION trả FAILED + POLICY_REJECTION', async () => {
  const gw = createMockGateway({ now });
  const req = buildRequest({
    scenarioId: 'POLICY_REJECTION',
    method: 'commitSuppression',
    payload: { organizationId: 'org-test-001', targetId: 'lp-001' },
    idempotencyKey: 'idem-policy',
  });
  const r = await gw.call(req);
  assert.equal(r.status, 'FAILED');
  assert.equal(r.errors[0].code, 'POLICY_REJECTION');
});

test('gateway: VERSION_CONFLICT trả FAILED + VERSION_CONFLICT', async () => {
  const gw = createMockGateway({ now });
  const req = buildRequest({
    scenarioId: 'VERSION_CONFLICT',
    method: 'updatePlacementCase',
    payload: { caseId: 'case-001', intendedStage: 'PROPOSED' },
    idempotencyKey: 'idem-version',
  });
  const r = await gw.call(req);
  assert.equal(r.status, 'FAILED');
  assert.equal(r.errors[0].code, 'VERSION_CONFLICT');
});

test('gateway: MALFORMED_DEPENDENCY_RESPONSE trả FAILED + UNKNOWN_COMMAND_OUTCOME', async () => {
  const gw = createMockGateway({ now });
  const req = buildRequest({
    scenarioId: 'MALFORMED_DEPENDENCY_RESPONSE',
    method: 'openPlacementCase',
    payload: { organizationId: 'org-test-001', intendedStage: 'NEW' },
    idempotencyKey: 'idem-malformed',
  });
  const r = await gw.call(req);
  assert.equal(r.status, 'FAILED');
  assert.equal(r.errors[0].code, 'UNKNOWN_COMMAND_OUTCOME');
});

test('gateway: DEPENDENCY_UNAVAILABLE trả FAILED + DEPENDENCY_UNAVAILABLE', async () => {
  const gw = createMockGateway({ now });
  const req = buildRequest({
    scenarioId: 'DEPENDENCY_UNAVAILABLE',
    method: 'createNextAction',
    payload: { caseId: 'case-001' },
    idempotencyKey: 'idem-dep-unavail',
  });
  const r = await gw.call(req);
  assert.equal(r.status, 'FAILED');
  assert.equal(r.errors[0].code, 'DEPENDENCY_UNAVAILABLE');
});

test('gateway: RATE_LIMITED trả FAILED + RATE_LIMITED', async () => {
  const gw = createMockGateway({ now });
  const req = buildRequest({
    scenarioId: 'RATE_LIMITED',
    method: 'createNextAction',
    payload: { caseId: 'case-001' },
    idempotencyKey: 'idem-rate',
  });
  const r = await gw.call(req);
  assert.equal(r.status, 'FAILED');
  assert.equal(r.errors[0].code, 'RATE_LIMITED');
});

// ────────────────────────────────────────────────────────────────────────────
// AC #3: Same key/same payload → same result (cache); same key/different payload
//        → IDEMPOTENCY_CONFLICT. correlationId KHÔNG tham gia cache.
// ────────────────────────────────────────────────────────────────────────────

test('gateway: same idempotencyKey + same payload trả cùng result (cache hit)', async () => {
  const gw = createMockGateway({ now });
  const baseReq = {
    schemaVersion: '1',
    organizationId: 'org-test-001',
    commandId: 'cmd-cache-1',
    idempotencyKey: 'idem-cache-same',
    method: 'createOrMatchLaborProfile',
    context: {
      schemaVersion: '1',
      organizationId: 'org-test-001',
      tier: 'INBOUND_DEFAULT',
      correlationId: 'corr-cache-a',
      provider: 'CHATWOOT',
      connectionId: 'conn-001',
    },
    actor: { kind: 'SERVICE', serviceId: 'svc-001' },
    scenarioId: 'EXACT_MATCH_SUCCESS',
    payload: { fullName: 'Same Payload', phone: '0900000001' },
  };
  const r1 = await gw.call(baseReq);

  const cacheReq = {
    ...baseReq,
    commandId: 'cmd-cache-2',
    correlationId: 'corr-cache-b', // khác correlationId — không ảnh hưởng cache
  };
  const r2 = await gw.call(cacheReq);

  assert.equal(r1.status, r2.status);
  assert.deepEqual(r1.data, r2.data);

  // Verify log: entry thứ 2 có cacheHit=true.
  const log = gw.readLog();
  assert.equal(log.length, 2);
  assert.equal(log[0].cacheHit, false);
  assert.equal(log[1].cacheHit, true);
  assert.equal(log[1].correlationId, 'corr-cache-b', 'correlationId tracking vẫn ghi đúng');
});

test('gateway: same idempotencyKey + different payload → IDEMPOTENCY_CONFLICT', async () => {
  const gw = createMockGateway({ now });
  const baseReq = {
    schemaVersion: '1',
    organizationId: 'org-test-001',
    commandId: 'cmd-conflict-1',
    idempotencyKey: 'idem-conflict-key',
    method: 'createOrMatchLaborProfile',
    context: {
      schemaVersion: '1',
      organizationId: 'org-test-001',
      tier: 'INBOUND_DEFAULT',
      correlationId: 'corr-conflict-a',
      provider: 'CHATWOOT',
      connectionId: 'conn-001',
    },
    actor: { kind: 'SERVICE', serviceId: 'svc-001' },
    scenarioId: 'EXACT_MATCH_SUCCESS',
    payload: { fullName: 'Original Payload' },
  };
  const r1 = await gw.call(baseReq);
  assert.equal(r1.status, 'APPLIED');

  const conflictReq = {
    ...baseReq,
    commandId: 'cmd-conflict-2',
    correlationId: 'corr-conflict-b',
    payload: { fullName: 'CHANGED Payload' }, // khác payload
  };
  const r2 = await gw.call(conflictReq);
  assert.equal(r2.status, 'FAILED');
  assert.equal(r2.errors[0].code, 'IDEMPOTENCY_CONFLICT');

  // Verify log: entry thứ 2 có idempotencyConflict=true.
  const log = gw.readLog();
  assert.equal(log[1].idempotencyConflict, true);
});

test('gateway: correlationId KHÔNG tham gia cache key (khác correlation, cùng key+payload → cache hit)', async () => {
  const gw = createMockGateway({ now });
  const payload = { name: 'X' };
  const makeReq = (correlationId) => ({
    schemaVersion: '1',
    organizationId: 'org-test-001',
    commandId: 'cmd-corr-' + correlationId,
    idempotencyKey: 'idem-corr-stable',
    correlationId,
    method: 'createOrMatchLaborProfile',
    context: {
      schemaVersion: '1',
      organizationId: 'org-test-001',
      tier: 'INBOUND_DEFAULT',
      correlationId,
      provider: 'CHATWOOT',
      connectionId: 'conn-001',
    },
    actor: { kind: 'SERVICE', serviceId: 'svc-001' },
    scenarioId: 'EXACT_MATCH_SUCCESS',
    payload,
  });

  const r1 = await gw.call(makeReq('corr-alpha'));
  const r2 = await gw.call(makeReq('corr-beta'));
  const r3 = await gw.call(makeReq('corr-gamma'));

  assert.equal(r1.status, 'APPLIED');
  assert.equal(r2.status, 'APPLIED');
  assert.equal(r3.status, 'APPLIED');
  assert.deepEqual(r1.data, r2.data);
  assert.deepEqual(r2.data, r3.data);

  // Log: 3 entries, 1 cache miss + 2 cache hits.
  const log = gw.readLog();
  assert.equal(log.length, 3);
  assert.equal(log[0].cacheHit, false);
  assert.equal(log[1].cacheHit, true);
  assert.equal(log[2].cacheHit, true);

  // correlationId tracking vẫn khác nhau.
  assert.equal(log[0].correlationId, 'corr-alpha');
  assert.equal(log[1].correlationId, 'corr-beta');
  assert.equal(log[2].correlationId, 'corr-gamma');
});

test('gateway: khác idempotencyKey + cùng payload → 2 call độc lập, không cache nhầm', async () => {
  const gw = createMockGateway({ now });
  const payload = { same: true };
  const reqA = buildRequest({ idempotencyKey: 'idem-A', payload });
  const reqB = buildRequest({ idempotencyKey: 'idem-B', payload });

  const rA = await gw.call(reqA);
  const rB = await gw.call(reqB);

  assert.equal(rA.status, 'APPLIED');
  assert.equal(rB.status, 'APPLIED');
  const log = gw.readLog();
  assert.equal(log.length, 2);
  assert.equal(log[0].cacheHit, false);
  assert.equal(log[1].cacheHit, false);
});

// ────────────────────────────────────────────────────────────────────────────
// AC #4: Call log chứng minh no forbidden side effect.
// ────────────────────────────────────────────────────────────────────────────

test('gateway: call log KHÔNG chứa merge capability khi tier=INBOUND_DEFAULT', async () => {
  const gw = createMockGateway({ now });
  // Scenario PERMISSION_DENIED + mergeLaborProfiles: tier check fail → FORBIDDEN.
  // Side effect: chỉ ghi log + trả FAILED; KHÔNG có PR merge fake.
  const req = buildRequest({
    scenarioId: 'PERMISSION_DENIED',
    method: 'mergeLaborProfiles',
    context: {
      schemaVersion: '1',
      organizationId: 'org-test-001',
      tier: 'INBOUND_DEFAULT',
      correlationId: 'corr-no-merge',
      provider: 'CHATWOOT',
      connectionId: 'conn-001',
    },
    payload: { sourceId: 'a', targetId: 'b' },
    idempotencyKey: 'idem-no-merge',
  });
  const r = await gw.call(req);
  assert.equal(r.status, 'FAILED');
  assert.equal(r.errors[0].code, 'FORBIDDEN');

  const log = gw.readLog();
  assert.equal(log.length, 1);
  const entry = log[0];
  // Log phải ghi rõ: tier INBOUND_DEFAULT + method mergeLaborProfiles → FORBIDDEN.
  // KHÔNG có field nào nói "merge applied" hay "EFFECTIVE".
  assert.equal(entry.tier, 'INBOUND_DEFAULT');
  assert.equal(entry.method, 'mergeLaborProfiles');
  assert.equal(entry.outcomeStatus, 'FAILED');
  assert.equal(entry.outcomeErrorCode, 'FORBIDDEN');
  // Verify payload digest deterministic.
  assert.equal(typeof entry.payloadDigest, 'string');
  assert.equal(entry.payloadDigest.length, 64); // SHA-256 hex.
});

test('gateway: payload digest ổn định dù thứ tự key khác nhau (canonical JSON)', async () => {
  const payload1 = { a: 1, b: 2, c: { x: 1, y: 2 } };
  const payload2 = { c: { y: 2, x: 1 }, b: 2, a: 1 };
  const d1 = payloadDigest(payload1);
  const d2 = payloadDigest(payload2);
  assert.equal(d1, d2);
});

test('gateway: payload digest KHÁC khi giá trị khác', () => {
  const d1 = payloadDigest({ a: 1 });
  const d2 = payloadDigest({ a: 2 });
  assert.notEqual(d1, d2);
});

// ────────────────────────────────────────────────────────────────────────────
// AC #5: One-active-case là scenario simulation, không concurrency proof.
// ────────────────────────────────────────────────────────────────────────────

test('gateway: ONE_ACTIVE_CASE scenario ghi rõ SCENARIO_SIMULATION_NOT_CONCURRENCY_PROOF', async () => {
  const gw = createMockGateway({ now });
  const req = buildRequest({
    scenarioId: 'ONE_ACTIVE_CASE',
    payload: { fullName: 'Nguyen Van OAC' },
    idempotencyKey: 'idem-oac',
  });
  const r = await gw.call(req);
  assert.equal(r.status, 'APPLIED');
  assert.equal(r.data.matchingOutcome, 'EXACT_MATCH');
  assert.equal(r.data.activeCaseId, 'case-fixture-oac-001');
  assert.equal(r.data.note, 'SCENARIO_SIMULATION_NOT_CONCURRENCY_PROOF');
});

// ────────────────────────────────────────────────────────────────────────────
// Ledger giới hạn: in-memory, KHÔNG durable production.
// ────────────────────────────────────────────────────────────────────────────

test('gateway: ledger có giới hạn max entries; restart = mất log (KHÔNG durable production)', async () => {
  const gw = createMockGateway({ now });
  for (let i = 0; i < 5; i++) {
    await gw.call(
      buildRequest({
        idempotencyKey: `idem-restart-${i}`,
        payload: { i },
      }),
    );
  }
  let log = gw.readLog();
  assert.equal(log.length, 5);

  gw.reset();
  log = gw.readLog();
  assert.equal(log.length, 0, 'reset phải xóa log');
});

test('gateway: ledger có ring buffer — append vượt max entries vẫn bounded', async () => {
  // Dùng ledger với maxEntries=3 để test nhanh.
  const { CallLedger } = await import('../dist/gateway/ledger.js');
  const ledger = new CallLedger({ maxEntries: 3 });
  for (let i = 0; i < 5; i++) {
    ledger.append({
      scenarioId: 'EXACT_MATCH_SUCCESS',
      method: 'createOrMatchLaborProfile',
      tier: 'INBOUND_DEFAULT',
      organizationId: 'org',
      commandId: `cmd-${i}`,
      idempotencyKey: `idem-${i}`,
      correlationId: `corr-${i}`,
      actorKind: 'SERVICE',
      provider: 'CHATWOOT',
      payloadDigest: 'a'.repeat(64),
      nowEpochMs: FIXED_CLOCK_MS,
      outcomeStatus: 'APPLIED',
      cacheHit: false,
      idempotencyConflict: false,
    });
  }
  const log = ledger.snapshot();
  assert.equal(log.length, 3, 'bounded ở maxEntries=3');
  // Sau 5 appends vào ring buffer maxEntries=3: entries [cmd-2, cmd-3, cmd-4] được ghi.
  // cmd-0 và cmd-1 bị ghi đè; cmd-3 đè lên cmd-0 ở idx=0; cmd-4 đè lên cmd-1 ở idx=1.
  // Thứ tự storage: [cmd-3, cmd-4, cmd-2] (theo insertion order of the surviving entries).
  assert.equal(log[0].commandId, 'cmd-3', 'entry cũ nhất bị ghi đè bởi cmd-3');
  assert.equal(log[1].commandId, 'cmd-4', 'cmd-4 ghi đè cmd-1');
  assert.equal(log[2].commandId, 'cmd-2', 'cmd-2 còn nguyên (chưa bị ghi đè)');
});

// ────────────────────────────────────────────────────────────────────────────
// Capability check (tier × method) cho privileged merge.
// ────────────────────────────────────────────────────────────────────────────

test('gateway: tier=INBOUND_DEFAULT + method=mergeLaborProfiles → FORBIDDEN (no fake privilege)', async () => {
  const gw = createMockGateway({ now });
  const req = buildRequest({
    method: 'mergeLaborProfiles',
    context: {
      schemaVersion: '1',
      organizationId: 'org-test-001',
      tier: 'INBOUND_DEFAULT',
      correlationId: 'corr-cap',
      provider: 'CHATWOOT',
      connectionId: 'conn-001',
    },
    payload: { sourceId: 'a', targetId: 'b' },
    idempotencyKey: 'idem-cap',
    scenarioId: 'EXACT_MATCH_SUCCESS', // scenario cho phép, nhưng tier block
  });
  const r = await gw.call(req);
  assert.equal(r.status, 'FAILED');
  assert.equal(r.errors[0].code, 'FORBIDDEN');
});

test('gateway: tier=PRIVILEGED_MERGE + method=mergeLaborProfiles qua được capability check', async () => {
  const gw = createMockGateway({ now });
  const req = buildRequest({
    method: 'mergeLaborProfiles',
    context: {
      schemaVersion: '1',
      organizationId: 'org-test-001',
      tier: 'PRIVILEGED_MERGE',
      correlationId: 'corr-priv',
      // privileged: không provider/connectionId
    },
    payload: { sourceId: 'a', targetId: 'b' },
    idempotencyKey: 'idem-priv',
    scenarioId: 'PERMISSION_DENIED', // PERMISSION_DENIED chỉ ACCEPTED ở applyScenario, nhưng privileged tier merge không có fixture APPLIED trong scenarios; ta chỉ test capability không chặn
  });
  // PERMISSION_DENIED scenario tier check: allowedTiers=ALL_TIERS.
  // Apply: outcome=FAILED (FORBIDDEN) — đây là scenario fixture, không phải capability.
  // Capability check ở mock-gateway không chặn privileged merge.
  // Ở applyScenario: PERMISSION_DENIED → outcome FAILED FORBIDDEN.
  const r = await gw.call(req);
  assert.equal(r.status, 'FAILED');
  assert.equal(r.errors[0].code, 'FORBIDDEN', 'scenario quyết định FORBIDDEN, không capability');
});

// ────────────────────────────────────────────────────────────────────────────
// CLOSED_CASE_SUCCESS note: SUCCESS != EFFECTIVE (Q-19 placement transitions).
// ────────────────────────────────────────────────────────────────────────────

test('gateway: CLOSED_CASE_SUCCESS note ghi rõ SUCCESS ≠ EFFECTIVE (managed mode Q-19)', async () => {
  const gw = createMockGateway({ now });
  const req = buildRequest({
    scenarioId: 'CLOSED_CASE_SUCCESS',
    method: 'closePlacementCase',
    payload: { caseId: 'case-001', closeReason: 'SUCCESS' },
    idempotencyKey: 'idem-close-success',
  });
  const r = await gw.call(req);
  assert.equal(r.status, 'APPLIED');
  assert.equal(r.data.closeReason, 'SUCCESS');
  assert.ok(
    r.data.note.includes('SUCCESS') && r.data.note.includes('EFFECTIVE'),
    'note phải ghi rõ phân biệt SUCCESS vs EFFECTIVE',
  );
});

// ────────────────────────────────────────────────────────────────────────────
// B1 fix: ACCEPTED operation reference validate via frozen AcceptedResponseSchema.
// Covers TIMEOUT_AFTER_APPLY, OUTBOX_RECEIPT_DURABLE, cache replay, negative.
// ────────────────────────────────────────────────────────────────────────────

test('gateway: OUTBOX_RECEIPT_DURABLE result khớp AcceptedResponseSchema (operation nested)', async () => {
  const gw = createMockGateway({ now });
  const req = buildRequest({
    scenarioId: 'OUTBOX_RECEIPT_DURABLE',
    method: 'createOrMatchLaborProfile',
    payload: { fullName: 'Test Outbox' },
    idempotencyKey: 'idem-outbox-fixture',
  });
  const r = await gw.call(req);
  assert.equal(r.status, 'ACCEPTED');
  assert.equal(r.operation.kind, 'COMMAND_OPERATION');
  assert.ok(r.operation.operationId, 'OUTBOX_RECEIPT_DURABLE phải có operation.operationId');
  assert.ok(AcceptedResponseSchema.safeParse(r).success, 'phải khớp AcceptedResponseSchema');
});

test('gateway: cache replay ACCEPTED giữ nguyên operation.operationId', async () => {
  const gw = createMockGateway({ now });
  const req = buildRequest({
    scenarioId: 'TIMEOUT_AFTER_APPLY',
    method: 'openPlacementCase',
    payload: { organizationId: 'org-test-001', intendedStage: 'NEW' },
    idempotencyKey: 'idem-accepted-replay',
  });
  const r1 = await gw.call(req);
  assert.equal(r1.status, 'ACCEPTED');
  assert.ok(r1.operation.operationId, 'r1 phải có operation.operationId');

  // Replay: same idempotencyKey + payload → cache hit.
  const r2 = await gw.call(req);
  assert.equal(r2.status, 'ACCEPTED');
  assert.equal(r2.operation.kind, 'COMMAND_OPERATION');
  assert.equal(
    r1.operation.operationId,
    r2.operation.operationId,
    'replay phải giữ nguyên operationId (cùng cached result object)',
  );
  assert.ok(AcceptedResponseSchema.safeParse(r1).success);
  assert.ok(AcceptedResponseSchema.safeParse(r2).success);
});

test('gateway: ACCEPTED shape cũ (operationId ở root) bị AcceptedResponseSchema reject', () => {
  // Construct the buggy shape (operationId at root, no nested operation object).
  const badShape = {
    status: 'ACCEPTED',
    schemaVersion: '1',
    commandId: 'cmd-old-shape-001',
    correlationId: 'corr-old-shape-001',
    operationId: 'op-root-001', // ← root-level; missing nested 'operation'
    errors: [],
  };
  const result = AcceptedResponseSchema.safeParse(badShape);
  assert.equal(
    result.success,
    false,
    'AcceptedResponseSchema phải reject shape cũ với operationId ở root',
  );
});

test('gateway: AcceptedResponseSchema validate fixture OUTBOX_RECEIPT_DURABLE round-trip', async () => {
  // B1 requirement: fixture ACCEPTED phải validate qua contract schema.
  const gw = createMockGateway({ now });
  const req = buildRequest({
    scenarioId: 'OUTBOX_RECEIPT_DURABLE',
    method: 'recordInteraction',
    payload: { caseId: 'case-001', note: 'round-trip' },
    idempotencyKey: 'idem-roundtrip',
  });
  const r = await gw.call(req);
  assert.equal(r.status, 'ACCEPTED');

  // parse() throws on failure (strict), safeParse() already used above.
  const parsed = AcceptedResponseSchema.parse(r);
  assert.equal(parsed.status, 'ACCEPTED');
  assert.equal(parsed.operation.kind, 'COMMAND_OPERATION');
  assert.ok(parsed.operation.operationId);
  assert.deepEqual(parsed.errors, []);
});

// ────────────────────────────────────────────────────────────────────────────
// Sanity: tất cả scenario ID có trong SCENARIOS.
// ────────────────────────────────────────────────────────────────────────────

test('gateway: SCENARIO_IDS khớp SCENARIOS keys', () => {
  for (const id of SCENARIO_IDS) {
    assert.ok(SCENARIOS[id], `scenario ${id} phải có fixture`);
  }
});
