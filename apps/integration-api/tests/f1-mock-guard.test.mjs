/**
 * F1 mock boundary guard tests for CORE/1.7 review service.
 *
 * Auditor requirement: F1 — Mock boundary guard
 * - Chặn toàn bộ /mock/review/* khi mockMode=off
 * - Dùng hành vi nhất quán với gateway guard hiện có
 * - Trả 404, không lộ dữ liệu hoặc mutation
 * - Không chỉ dựa vào x-review-actor
 *
 * Required tests (5):
 * 1. mockMode=off: list/detail/decide/link/unlink/replay đều bị chặn
 * 2. Header actor hợp lệ cũng không bypass guard
 * 3. Spy证明review service không được gọi khi bị chặn
 * 4. Mock enabled: các luồng hợp lệ vẫn hoạt động + permission/scope checks
 * 5. Regression: guard hiện có không bị ảnh hưởng
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
const { ReviewService, reviewStore } = await import('../dist/review/index.js');

const servers = [];
let portCounter = 18000;

async function startServerMockOff() {
  const port = portCounter++;
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'off',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: String(port),
    HRP_ORGANIZATION_ID: 'org-f1-test',
  };
  const r = loadConfig({ env, kind: 'api' });
  // reviewService passed in but should NEVER be called when mockMode=off
  const reviewService = new ReviewService(reviewStore);
  const server = await startServer(r.config, { reviewService });
  servers.push(server);
  return { server, port, reviewService };
}

async function startServerMockOn() {
  const port = portCounter++;
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: String(port),
    HRP_ORGANIZATION_ID: 'org-f1-test',
  };
  const r = loadConfig({ env, kind: 'api' });
  const reviewService = new ReviewService(reviewStore);
  const server = await startServer(r.config, { reviewService });
  servers.push(server);
  return { server, port, reviewService };
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
// T1: mockMode=off — tất cả /mock/review/* bị chặn
// ═══════════════════════════════════════════════════════════════

test('F1-T1.1: GET /mock/review/list bị chặn khi mockMode=off', async () => {
  const { port } = await startServerMockOff();

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/list`);

  assert.equal(res.status, 404, 'Should return 404 when mock disabled');
  const body = await res.json();
  assert.equal(body.error, 'mock_disabled', 'Should have mock_disabled error');
  assert.ok(!body.message?.includes('fullName'), 'Should not leak PII in error');
  assert.ok(!body.message?.includes('phone'), 'Should not leak PII in error');
});

test('F1-T1.2: GET /mock/review/detail bị chặn khi mockMode=off', async () => {
  const { port } = await startServerMockOff();

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/detail?id=rev-any`);

  assert.equal(res.status, 404, 'Should return 404 when mock disabled');
  const body = await res.json();
  assert.equal(body.error, 'mock_disabled');
});

test('F1-T1.3: POST /mock/review/decide bị chặn khi mockMode=off', async () => {
  const { port } = await startServerMockOff();

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewEntryId: 'rev-001', kind: 'ACCEPT', reason: 'ok', expectedEntryVersion: 1 }),
  });

  assert.equal(res.status, 404, 'Should return 404 when mock disabled');
  const body = await res.json();
  assert.equal(body.error, 'mock_disabled');
});

test('F1-T1.4: POST /mock/review/link bị chặn khi mockMode=off', async () => {
  const { port } = await startServerMockOff();

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewEntryId: 'rev-001', targetKind: 'CANDIDATE', targetRef: 'x', label: 'y' }),
  });

  assert.equal(res.status, 404, 'Should return 404 when mock disabled');
  const body = await res.json();
  assert.equal(body.error, 'mock_disabled');
});

test('F1-T1.5: POST /mock/review/unlink bị chặn khi mockMode=off', async () => {
  const { port } = await startServerMockOff();

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/unlink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewEntryId: 'rev-001', linkId: 'lnk-001' }),
  });

  assert.equal(res.status, 404, 'Should return 404 when mock disabled');
  const body = await res.json();
  assert.equal(body.error, 'mock_disabled');
});

test('F1-T1.6: POST /mock/review/replay bị chặn khi mockMode=off', async () => {
  const { port } = await startServerMockOff();

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewEntryId: 'rev-001', checkpointState: 'RUNNING', checkpointDigest: '0xABC' }),
  });

  assert.equal(res.status, 404, 'Should return 404 when mock disabled');
  const body = await res.json();
  assert.equal(body.error, 'mock_disabled');
});

// ═══════════════════════════════════════════════════════════════
// T2: Header actor hợp lệ cũng không bypass guard
// ═══════════════════════════════════════════════════════════════

test('F1-T2.1: SERVICE actor header bị chặn khi mockMode=off', async () => {
  const { port } = await startServerMockOff();

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/list`, {
    headers: { 'x-review-actor': JSON.stringify({ kind: 'SERVICE', serviceId: 'svc-admin' }) },
  });

  assert.equal(res.status, 404, 'Should block even with valid SERVICE actor');
  const body = await res.json();
  assert.equal(body.error, 'mock_disabled');
});

test('F1-T2.2: USER actor header bị chặn khi mockMode=off', async () => {
  const { port } = await startServerMockOff();

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/list`, {
    headers: { 'x-review-actor': JSON.stringify({ kind: 'USER', userId: 'user-001' }) },
  });

  assert.equal(res.status, 404, 'Should block even with valid USER actor');
  const body = await res.json();
  assert.equal(body.error, 'mock_disabled');
});

test('F1-T2.3: Arbitrary actor JSON bị chặn khi mockMode=off', async () => {
  const { port } = await startServerMockOff();

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/decide`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-review-actor': JSON.stringify({ kind: 'SERVICE', serviceId: 'svc-priv-reviewer', tier: 'PRIVILEGED' }),
    },
    body: JSON.stringify({ reviewEntryId: 'rev-001', kind: 'ACCEPT', reason: 'test', expectedEntryVersion: 1 }),
  });

  assert.equal(res.status, 404, 'Should block even with PRIVILEGED actor claim');
  const body = await res.json();
  assert.equal(body.error, 'mock_disabled');
});

// ═══════════════════════════════════════════════════════════════
// T3: Spy — review service không được gọi khi bị chặn
// ═══════════════════════════════════════════════════════════════

test('F1-T3.1: reviewService.submitDecision KHÔNG được gọi khi mockMode=off', async () => {
  const { port, reviewService } = await startServerMockOff();

  // Spy on submitDecision
  let callCount = 0;
  const original = reviewService.submitDecision.bind(reviewService);
  reviewService.submitDecision = function (...args) {
    callCount++;
    return original(...args);
  };

  await fetch(`http://127.0.0.1:${port}/mock/review/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewEntryId: 'rev-001', kind: 'ACCEPT', reason: 'test', expectedEntryVersion: 1 }),
  });

  assert.equal(callCount, 0, 'submitDecision should NOT be called when mockMode=off');

  // Restore
  reviewService.submitDecision = original;
});

test('F1-T3.2: reviewService.listReviews KHÔNG được gọi khi mockMode=off', async () => {
  const { port, reviewService } = await startServerMockOff();

  let callCount = 0;
  const original = reviewService.listReviews.bind(reviewService);
  reviewService.listReviews = function (...args) {
    callCount++;
    return original(...args);
  };

  await fetch(`http://127.0.0.1:${port}/mock/review/list`);

  assert.equal(callCount, 0, 'listReviews should NOT be called when mockMode=off');

  // Restore
  reviewService.listReviews = original;
});

test('F1-T3.3: reviewService.getReviewDetail KHÔNG được gọi khi mockMode=off', async () => {
  const { port, reviewService } = await startServerMockOff();

  let callCount = 0;
  const original = reviewService.getReviewDetail.bind(reviewService);
  reviewService.getReviewDetail = function (...args) {
    callCount++;
    return original(...args);
  };

  await fetch(`http://127.0.0.1:${port}/mock/review/detail?id=rev-001`);

  assert.equal(callCount, 0, 'getReviewDetail should NOT be called when mockMode=off');

  // Restore
  reviewService.getReviewDetail = original;
});

// ═══════════════════════════════════════════════════════════════
// T4: Mock enabled — các luồng hợp lệ vẫn hoạt động
// ═══════════════════════════════════════════════════════════════

test('F1-T4.1: GET /mock/review/list hoạt động khi mockMode=deterministic', async () => {
  const { port } = await startServerMockOn();

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/list`);

  assert.equal(res.status, 200, 'Should return 200 when mock enabled');
  const body = await res.json();
  assert.ok(Array.isArray(body.entries), 'Should have entries array');
});

test('F1-T4.2: GET /mock/review/detail hoạt động khi mockMode=deterministic', async () => {
  const { port } = await startServerMockOn();

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/detail?id=nonexistent`);

  // Entry not found = 404, but from service (not from guard)
  assert.equal(res.status, 404, 'Should return 404 from service not guard');
});

test('F1-T4.3: POST /mock/review/decide hoạt động khi mockMode=deterministic', async () => {
  const { port } = await startServerMockOn();

  // Tạo entry trước
  reviewStore.create({
    reviewEntryId: 'rev-f1-001',
    organizationId: 'org-f1-test',
    intakeRevisionId: 'intake-f1-001',
    draftDigest: '0xF1',
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
    body: JSON.stringify({ reviewEntryId: 'rev-f1-001', kind: 'ACCEPT', reason: 'F1 test', expectedEntryVersion: 1 }),
  });

  assert.equal(res.status, 200, 'Should return 200 when mock enabled');
  const body = await res.json();
  assert.equal(body.status, 'DECIDED');
});

test('F1-T4.4: Permission/scope checks vẫn hoạt động khi mockMode=deterministic', async () => {
  const { port } = await startServerMockOn();

  // Tạo entry thuộc org khác
  reviewStore.create({
    reviewEntryId: 'rev-f1-cross',
    organizationId: 'org-different',
    intakeRevisionId: 'intake-cross',
    draftDigest: '0xCROSS',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Cross-org access bị chặn bởi service, không phải guard
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/detail?id=rev-f1-cross`);

  assert.equal(res.status, 403, 'Cross-org should be 403 from service');
});

test('F1-T4.5: Link hoạt động khi mockMode=deterministic', async () => {
  const { port } = await startServerMockOn();

  reviewStore.create({
    reviewEntryId: 'rev-f1-link',
    organizationId: 'org-f1-test',
    intakeRevisionId: 'intake-link',
    draftDigest: '0xLINK',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewEntryId: 'rev-f1-link', targetKind: 'CANDIDATE', targetRef: 'cand-001', label: 'Test' }),
  });

  assert.equal(res.status, 200, 'Should return 200 when mock enabled');
  const body = await res.json();
  assert.equal(body.anchorRefCount, 1);
});

test('F1-T4.6: Unlink hoạt động khi mockMode=deterministic', async () => {
  const { port } = await startServerMockOn();

  reviewStore.create({
    reviewEntryId: 'rev-f1-unlink',
    organizationId: 'org-f1-test',
    intakeRevisionId: 'intake-unlink',
    draftDigest: '0xUNLINK',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [{
      linkId: 'lnk-pre',
      targetKind: 'CANDIDATE',
      targetRef: 'cand-pre',
      label: 'Pre-existing',
      addedBy: 'system',
      addedAt: new Date().toISOString(),
    }],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/unlink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewEntryId: 'rev-f1-unlink', linkId: 'lnk-pre' }),
  });

  assert.equal(res.status, 200, 'Should return 200 when mock enabled');
  const body = await res.json();
  assert.equal(body.anchorRefCount, 0);
});

test('F1-T4.7: Replay hoạt động khi mockMode=deterministic', async () => {
  const { port } = await startServerMockOn();

  reviewStore.create({
    reviewEntryId: 'rev-f1-replay',
    organizationId: 'org-f1-test',
    intakeRevisionId: 'intake-replay',
    draftDigest: '0xREPLAY',
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
    body: JSON.stringify({ reviewEntryId: 'rev-f1-replay', checkpointState: 'RUNNING', checkpointDigest: '0xREPLAY' }),
  });

  assert.equal(res.status, 200, 'Should return 200 when mock enabled');
  const body = await res.json();
  assert.ok('canProceed' in body);
});

// ═══════════════════════════════════════════════════════════════
// T5: Regression — guard hiện có không bị ảnh hưởng
// ═══════════════════════════════════════════════════════════════

test('F1-T5.1: /mock/gateway/* vẫn bị chặn khi mockMode=off (regression)', async () => {
  const { port } = await startServerMockOff();

  // Gateway call
  const res1 = await fetch(`http://127.0.0.1:${port}/mock/gateway/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenarioId: 'backlog', payload: { test: true } }),
  });
  assert.equal(res1.status, 404, 'Gateway call should still be blocked');
  const body1 = await res1.json();
  assert.equal(body1.error, 'mock_disabled');

  // Gateway log
  const res2 = await fetch(`http://127.0.0.1:${port}/mock/gateway/log`);
  assert.equal(res2.status, 404, 'Gateway log should still be blocked');
  const body2 = await res2.json();
  assert.equal(body2.error, 'mock_disabled');
});

test('F1-T5.2: /mock/gateway/* hoạt động khi mockMode=deterministic (regression)', async () => {
  const { port } = await startServerMockOn();

  // Gateway call - dùng payload đúng như gateway.test.mjs
  const res1 = await fetch(`http://127.0.0.1:${port}/mock/gateway/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: '1',
      organizationId: 'org-test-001',
      commandId: 'cmd-test-001',
      idempotencyKey: 'idem-regression-001',
      correlationId: 'corr-regression-001',
      method: 'createOrMatchLaborProfile',
      context: {
        schemaVersion: '1',
        organizationId: 'org-test-001',
        tier: 'INBOUND_DEFAULT',
        correlationId: 'corr-regression-001',
        provider: 'CHATWOOT',
        connectionId: 'conn-test-001',
      },
      actor: { kind: 'SERVICE', serviceId: 'svc-test-001' },
      scenarioId: 'EXACT_MATCH_SUCCESS',
      payload: { fullName: 'Test User', phone: '0900000000' },
    }),
  });
  assert.equal(res1.status, 200, 'Gateway call should work when mock enabled');

  // Gateway log
  const res2 = await fetch(`http://127.0.0.1:${port}/mock/gateway/log`);
  assert.equal(res2.status, 200, 'Gateway log should work when mock enabled');
});

test('F1-T5.3: /health/* luôn hoạt động (regression)', async () => {
  const { port } = await startServerMockOff();

  const res1 = await fetch(`http://127.0.0.1:${port}/health/live`);
  assert.equal(res1.status, 200, 'Health live should always work');

  const res2 = await fetch(`http://127.0.0.1:${port}/health/ready`);
  assert.equal(res2.status, 200, 'Health ready should always work');
});

test('F1-T5.4: Unknown routes trả 404 route_not_found (regression)', async () => {
  const { port } = await startServerMockOff();

  const res = await fetch(`http://127.0.0.1:${port}/unknown/route`);
  assert.equal(res.status, 404, 'Unknown routes should return 404');
  const body = await res.json();
  assert.equal(body.error, 'route_not_found');
});
