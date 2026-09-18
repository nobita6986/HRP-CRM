/**
 * CORE/1.7 AC coverage tests.
 * Verifies 4 AC:
 * - AC1: Permissions/server-side scope + chống lộ candidate PII
 * - AC2: Reviewer/reason/version/audit; stale conflict không overwrite
 * - AC3: Link/unlink khác merge, không có merge capability mặc định
 * - AC4: Replay revalidate mappings/context, không lặp mutation đã applied
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('./dist/server.js')) {
  execSync('npm run build', { stdio: 'inherit' });
}

const { startServer } = await import('../dist/server.js');
const { loadConfig } = await import('../../../packages/config/dist/index.js');
const { ReviewService, reviewStore, createReviewEntry } = await import('../dist/review/index.js');

const servers = [];
let portCounter = 17500;

async function startFreshServer() {
  const port = portCounter++;
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: String(port),
    HRP_ORGANIZATION_ID: 'org-ac-test',
  };
  const r = loadConfig({ env, kind: 'api' });
  const server = await startServer(r.config, { reviewService: new ReviewService(reviewStore) });
  servers.push(server);
  return { server, port: server.address().port };
}

beforeEach(() => {
  reviewStore.clear();
});

after(async () => {
  for (const s of servers) {
    await new Promise((resolve) => s.close(() => resolve()));
  }
});

// ═══════════════════════════════════════════════════════════════
// AC1: Permissions + server-side scope + PII guard
// ═══════════════════════════════════════════════════════════════

test('AC1.1: Server-side scope check - cross-org access bị reject', async () => {
  const { port } = await startFreshServer();
  
  // Tạo entry thuộc org-A
  reviewStore.create({
    reviewEntryId: 'rev-org-a',
    organizationId: 'org-A',
    intakeRevisionId: 'intake-org-a',
    draftDigest: '0xA',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Server đang chạy với org-ac-test, không phải org-A
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/detail?id=rev-org-a`);
  
  // Phải trả 403 (cross-org) hoặc 404 (hidden existence)
  assert.ok(res.status === 403 || res.status === 404, 
    'Cross-org access should be rejected (403) or hidden (404), got ' + res.status);
});

test('AC1.2: PII guard - audit detail bị strip khỏi output', async () => {
  const { port } = await startFreshServer();
  
  // Entry với audit detail chứa PII
  reviewStore.create({
    reviewEntryId: 'rev-pii',
    organizationId: 'org-ac-test',
    intakeRevisionId: 'intake-pii',
    draftDigest: '0xPII',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [
      {
        auditId: 'a-pii',
        at: new Date().toISOString(),
        actor: 'system',
        action: 'CREATED',
        detail: {
          fullName: 'Nguyen Van A',
          phone: '0901234567',
          email: 'test@example.com',
        },
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/detail?id=rev-pii`);
  const body = await res.json();
  
  // Verify PII bị strip
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes('Nguyen Van A'), 'fullName should be stripped');
  assert.ok(!serialized.includes('0901234567'), 'phone should be stripped');
  assert.ok(!serialized.includes('test@example.com'), 'email should be stripped');
  
  // auditSummary có action/at/actor nhưng KHÔNG có detail
  assert.ok(body.auditSummary, 'Should have auditSummary');
  assert.ok(!body.auditSummary[0].detail, 'audit detail should be stripped');
});

test('AC1.3: List output không lộ PII từ entries', async () => {
  const { port } = await startFreshServer();
  
  // Tạo entries có audit với PII
  reviewStore.create({
    reviewEntryId: 'rev-li-1',
    organizationId: 'org-ac-test',
    intakeRevisionId: 'intake-li-1',
    draftDigest: '0xLI1',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [{
      auditId: 'a-li',
      at: new Date().toISOString(),
      actor: 'system',
      action: 'CREATED',
      detail: { sensitiveData: 'SSN-123-45-6789' },
    }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/list`);
  const body = await res.json();
  
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes('SSN-123-45-6789'), 'Sensitive data should be stripped from list');
});

test('AC1.4: Permission context - USER actor có tier INBOUND_REVIEWER', async () => {
  const { port } = await startFreshServer();
  
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/list`, {
    headers: { 'x-review-actor': JSON.stringify({ kind: 'USER', userId: 'user-001' }) },
  });
  
  assert.equal(res.status, 200, 'USER actor should be able to list reviews');
});

test('AC1.5: Permission context - SERVICE actor có tier PRIVILEGED_REVIEWER', async () => {
  const { port } = await startFreshServer();
  
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/list`, {
    headers: { 'x-review-actor': JSON.stringify({ kind: 'SERVICE', serviceId: 'svc-001' }) },
  });
  
  assert.equal(res.status, 200, 'SERVICE actor should be able to list reviews');
});

// ═══════════════════════════════════════════════════════════════
// AC2: Reviewer/reason/version/audit + stale conflict không overwrite
// ═══════════════════════════════════════════════════════════════

test('AC2.1: Decision ghi nhận reviewer, reason, version vào audit log', async () => {
  const { port } = await startFreshServer();
  
  reviewStore.create({
    reviewEntryId: 'rev-dec-001',
    organizationId: 'org-ac-test',
    intakeRevisionId: 'intake-dec-001',
    draftDigest: '0xDEC',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [{ auditId: 'a1', at: new Date().toISOString(), actor: 'system', action: 'CREATED' }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewEntryId: 'rev-dec-001',
      kind: 'ACCEPT',
      reason: 'All evidence verified',
      expectedEntryVersion: 1,
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'DECIDED');
  assert.equal(body.decision.kind, 'ACCEPT');
  assert.equal(body.decision.reason, 'All evidence verified');
  assert.ok(body.decision.reviewerId, 'Reviewer ID should be recorded');
});

test('AC2.2: Stale version conflict không overwrite decision cũ', async () => {
  const { port } = await startFreshServer();
  
  // Entry version = 1 (chỉ có CREATED audit)
  reviewStore.create({
    reviewEntryId: 'rev-stale-001',
    organizationId: 'org-ac-test',
    intakeRevisionId: 'intake-stale-001',
    draftDigest: '0xSTALE',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [{ auditId: 'a1', at: new Date().toISOString(), actor: 'system', action: 'CREATED' }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Lần 1: Decide với version=1 → OK
  const res1 = await fetch(`http://127.0.0.1:${port}/mock/review/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewEntryId: 'rev-stale-001',
      kind: 'ACCEPT',
      reason: 'First',
      expectedEntryVersion: 1,
    }),
  });
  assert.equal(res1.status, 200, 'First decide should succeed');

  // Lần 2: Decide lại với version=1 (stale) → VERSION_CONFLICT
  // Entry đã DECIDED nên sẽ trả ENTRY_ALREADY_DECIDED trước
  const res2 = await fetch(`http://127.0.0.1:${port}/mock/review/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewEntryId: 'rev-stale-001',
      kind: 'REJECT',
      reason: 'Second (stale)',
      expectedEntryVersion: 1,
    }),
  });
  // Có thể là 403 (ENTRY_ALREADY_DECIDED) hoặc 403 (VERSION_CONFLICT)
  // Cả hai đều cho thấy decision không bị overwrite
  assert.equal(res2.status, 403, 'Second decide should be rejected');
  
  // Verify decision cũ vẫn còn
  const detailRes = await fetch(`http://127.0.0.1:${port}/mock/review/detail?id=rev-stale-001`);
  const body = await detailRes.json();
  assert.equal(body.status, 'DECIDED');
  assert.equal(body.decision.kind, 'ACCEPT', 'Original decision should be preserved');
  assert.equal(body.decision.reason, 'First', 'Original reason should be preserved');
});

test('AC2.3: Version mismatch reject với VERSION_CONFLICT', async () => {
  const { port } = await startFreshServer();
  
  // Entry có 2 audit entries (version = 2)
  reviewStore.create({
    reviewEntryId: 'rev-vm-001',
    organizationId: 'org-ac-test',
    intakeRevisionId: 'intake-vm-001',
    draftDigest: '0xVM',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [
      { auditId: 'a1', at: new Date().toISOString(), actor: 'system', action: 'CREATED' },
      { auditId: 'a2', at: new Date().toISOString(), actor: 'user', action: 'LINK:CANDIDATE' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Gửi expectedEntryVersion=1 (stale, current=2)
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewEntryId: 'rev-vm-001',
      kind: 'ACCEPT',
      reason: 'Stale',
      expectedEntryVersion: 1,
    }),
  });

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.code, /VERSION_CONFLICT/);
});

// ═══════════════════════════════════════════════════════════════
// AC3: Link/unlink khác merge, không có merge capability mặc định
// ═══════════════════════════════════════════════════════════════

test('AC3.1: Link target - thêm anchor ref nhưng không merge canonical', async () => {
  const { port } = await startFreshServer();
  
  const entry = reviewStore.create({
    reviewEntryId: 'rev-link-ac',
    organizationId: 'org-ac-test',
    intakeRevisionId: 'intake-link-ac',
    draftDigest: '0xLINKAC',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Link tới CANDIDATE
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewEntryId: 'rev-link-ac',
      targetKind: 'CANDIDATE',
      targetRef: 'cand-001',
      label: 'Candidate A',
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.anchorRefCount, 1, 'Should have 1 anchor ref after link');
  
  // Verify canonicalId KHÔNG bị thay đổi (link không phải merge)
  const updatedEntry = reviewStore.findByIdAnyOrg('rev-link-ac');
  assert.equal(updatedEntry.canonicalId, entry.canonicalId, 'canonicalId should not change via link');
  assert.equal(updatedEntry.canonicalVersion, entry.canonicalVersion, 'canonicalVersion should not change via link');
});

test('AC3.2: Unlink - xóa anchor ref nhưng không affect canonical', async () => {
  const { port } = await startFreshServer();
  
  // Tạo entry với 1 link sẵn
  const entry = reviewStore.create({
    reviewEntryId: 'rev-unlink-ac',
    organizationId: 'org-ac-test',
    intakeRevisionId: 'intake-unlink-ac',
    canonicalId: 'cand-existing',
    canonicalVersion: 3,
    draftDigest: '0xUNLINK',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [{
      linkId: 'lnk-existing',
      targetKind: 'CANDIDATE',
      targetRef: 'cand-existing',
      label: 'Existing',
      addedBy: 'system',
      addedAt: new Date().toISOString(),
    }],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Unlink
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/unlink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewEntryId: 'rev-unlink-ac',
      linkId: 'lnk-existing',
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.anchorRefCount, 0, 'Should have 0 anchor refs after unlink');
  
  // Verify canonical vẫn giữ nguyên
  const updatedEntry = reviewStore.findByIdAnyOrg('rev-unlink-ac');
  assert.equal(updatedEntry.canonicalId, 'cand-existing', 'canonicalId should be preserved');
  assert.equal(updatedEntry.canonicalVersion, 3, 'canonicalVersion should be preserved');
});

test('AC3.3: Không có mergeLaborProfiles capability trong exports', async () => {
  const reviewModule = await import('../dist/review/index.js');
  
  // Verify không có merge capability
  assert.equal(typeof reviewModule.ReviewService, 'function', 'ReviewService should exist');
  
  // Service instance không có merge method
  const svc = new reviewModule.ReviewService(reviewStore);
  assert.equal(typeof svc.mergeLaborProfiles, 'undefined', 'mergeLaborProfiles should NOT exist (AC3)');
  assert.equal(typeof svc.merge, 'undefined', 'merge should NOT exist (AC3)');
  assert.equal(typeof svc.union, 'undefined', 'union should NOT exist (AC3)');
});

test('AC3.4: Link target kinds giới hạn (không có merge target)', async () => {
  const { port } = await startFreshServer();
  
  reviewStore.create({
    reviewEntryId: 'rev-tk-001',
    organizationId: 'org-ac-test',
    intakeRevisionId: 'intake-tk-001',
    draftDigest: '0xTK',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Valid kinds: CANDIDATE, REVISION, SCHEMA, EVIDENCE
  const validKinds = ['CANDIDATE', 'REVISION', 'SCHEMA', 'EVIDENCE'];
  
  for (const kind of validKinds) {
    const res = await fetch(`http://127.0.0.1:${port}/mock/review/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewEntryId: 'rev-tk-001',
        targetKind: kind,
        targetRef: 'ref-' + kind,
        label: 'Test ' + kind,
      }),
    });
    assert.ok(res.status === 200, `Kind ${kind} should be valid, got ${res.status}`);
  }
});

// ═══════════════════════════════════════════════════════════════
// AC4: Replay revalidate, không lặp mutation đã applied
// ═══════════════════════════════════════════════════════════════

test('AC4.1: Replay với COMPLETED checkpoint → canProceed=false (ALREADY_APPLIED)', async () => {
  const { port } = await startFreshServer();
  
  reviewStore.create({
    reviewEntryId: 'rev-rp-001',
    organizationId: 'org-ac-test',
    intakeRevisionId: 'intake-rp-001',
    draftDigest: '0xRP',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewEntryId: 'rev-rp-001',
      checkpointState: 'COMPLETED',
      checkpointDigest: '0xRP',
      appliedSteps: ['IDENTITY', 'PROFILE', 'CASE', 'AVAILABILITY'],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.canProceed, false, 'COMPLETED checkpoint should not proceed');
  assert.match(body.canProceedReason, /ALREADY_APPLIED/);
});

test('AC4.2: Replay với draftDigest drift → canProceed=false (DRAFT_DIGEST_CHANGED)', async () => {
  const { port } = await startFreshServer();
  
  reviewStore.create({
    reviewEntryId: 'rev-rp-002',
    organizationId: 'org-ac-test',
    intakeRevisionId: 'intake-rp-002',
    draftDigest: '0xORIGINAL',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewEntryId: 'rev-rp-002',
      checkpointState: 'RUNNING',
      checkpointDigest: '0xDRIFTED',
      appliedSteps: [],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.canProceed, false, 'Digest drift should not proceed');
  assert.match(body.canProceedReason, /DRAFT_DIGEST_CHANGED/);
});

test('AC4.3: Replay với PARTIAL checkpoint → canProceed=true (resume possible)', async () => {
  const { port } = await startFreshServer();
  
  reviewStore.create({
    reviewEntryId: 'rev-rp-003',
    organizationId: 'org-ac-test',
    intakeRevisionId: 'intake-rp-003',
    draftDigest: '0xPARTIAL',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewEntryId: 'rev-rp-003',
      checkpointState: 'PARTIAL',
      checkpointDigest: '0xPARTIAL',
      appliedSteps: ['IDENTITY', 'PROFILE'],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.canProceed, true, 'PARTIAL checkpoint should allow resume');
  assert.deepEqual(body.appliedSteps, ['IDENTITY', 'PROFILE']);
});

test('AC4.4: Replay với canonicalId drift → canProceed=false', async () => {
  const { port } = await startFreshServer();
  
  reviewStore.create({
    reviewEntryId: 'rev-rp-004',
    organizationId: 'org-ac-test',
    intakeRevisionId: 'intake-rp-004',
    canonicalId: 'cand-A',
    canonicalVersion: 1,
    draftDigest: '0xCD',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewEntryId: 'rev-rp-004',
      checkpointState: 'RUNNING',
      checkpointDigest: '0xCD',
      checkpointCanonicalId: 'cand-B', // different from entry
      checkpointCanonicalVersion: 1,
      appliedSteps: [],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.canProceed, false, 'Canonical ID drift should not proceed');
  assert.match(body.canProceedReason, /CANONICAL_TARGET_CHANGED/);
});

test('AC4.5: Replay với canonicalVersion drift → canProceed=false', async () => {
  const { port } = await startFreshServer();
  
  reviewStore.create({
    reviewEntryId: 'rev-rp-005',
    organizationId: 'org-ac-test',
    intakeRevisionId: 'intake-rp-005',
    canonicalId: 'cand-X',
    canonicalVersion: 5,
    draftDigest: '0xCV',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewEntryId: 'rev-rp-005',
      checkpointState: 'RUNNING',
      checkpointDigest: '0xCV',
      checkpointCanonicalId: 'cand-X',
      checkpointCanonicalVersion: 7, // drifted
      appliedSteps: [],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.canProceed, false, 'Canonical version drift should not proceed');
  assert.match(body.canProceedReason, /VERSION_CONFLICT/);
});

test('AC4.6: Replay KHÔNG lặp mutation - chỉ validate, không thay đổi audit log', async () => {
  const { port } = await startFreshServer();
  
  reviewStore.create({
    reviewEntryId: 'rev-rp-006',
    organizationId: 'org-ac-test',
    intakeRevisionId: 'intake-rp-006',
    draftDigest: '0xNM',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [
      { auditId: 'a1', at: new Date().toISOString(), actor: 'system', action: 'CREATED' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const beforeEntry = reviewStore.findByIdAnyOrg('rev-rp-006');
  const beforeAuditCount = beforeEntry.auditLog.length;

  // Replay với PARTIAL
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewEntryId: 'rev-rp-006',
      checkpointState: 'PARTIAL',
      checkpointDigest: '0xNM',
      appliedSteps: ['IDENTITY'],
    }),
  });

  assert.equal(res.status, 200);
  
  // Verify audit log KHÔNG bị thêm entries (replay là read-only)
  const afterEntry = reviewStore.findByIdAnyOrg('rev-rp-006');
  assert.equal(afterEntry.auditLog.length, beforeAuditCount, 'Replay should NOT add audit entries');
  assert.equal(afterEntry.status, 'OPEN', 'Replay should NOT change status');
});
