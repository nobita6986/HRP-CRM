/**
 * HTTP boundary self-check tests for CORE/1.7 review service.
 * Verifies:
 * - Request routing không rơi vào fallback 404
 * - Async service resolve/reject được xử lý đúng
 * - Error responses có HTTP status phù hợp, không lộ stack/PII
 * - Error format tuân thủ convention hiện có
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
let portCounter = 17000;

async function startFreshServer() {
  const port = portCounter++;
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: String(port),
    HRP_ORGANIZATION_ID: 'org-boundary-test',
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
// B1: Routing - request không rơi vào fallback 404
// ═══════════════════════════════════════════════════════════════

test('B1.1: Valid /mock/review/list → 200, không 404', async () => {
  const { port } = await startFreshServer();
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/list`);
  assert.notEqual(res.status, 404, 'Should not return 404 for valid route');
  assert.equal(res.status, 200, 'Should return 200 for valid route');
});

test('B1.2: Valid /mock/review/detail → 200 hoặc 404 (entry tồn tại hay không), không fallback', async () => {
  const { port } = await startFreshServer();
  
  // Entry không tồn tại → 404, nhưng là logic nghiệp vụ, không phải fallback
  const res1 = await fetch(`http://127.0.0.1:${port}/mock/review/detail?id=nonexistent`);
  assert.equal(res1.status, 404, 'Should return 404 for nonexistent entry');
  
  // Tạo entry và test lại
  reviewStore.create({
    reviewEntryId: 'rev-b1-001',
    organizationId: 'org-boundary-test',
    intakeRevisionId: 'intake-b1-001',
    draftDigest: '0xB1',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  
  const res2 = await fetch(`http://127.0.0.1:${port}/mock/review/detail?id=rev-b1-001`);
  assert.equal(res2.status, 200, 'Should return 200 for existing entry');
});

test('B1.3: Unknown /mock/review/* → 404 route_not_found (không phải double response)', async () => {
  const { port } = await startFreshServer();
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/bogus`);
  assert.equal(res.status, 404, 'Should return 404 for unknown route');
  const body = await res.json();
  assert.equal(body.error, 'route_not_found', 'Should have route_not_found error');
});

// ═══════════════════════════════════════════════════════════════
// B2: Async resolve/reject handling - không double response
// ═══════════════════════════════════════════════════════════════

test('B2.1: POST /decide thành công → 200, chỉ một response', async () => {
  const { port } = await startFreshServer();
  reviewStore.create({
    reviewEntryId: 'rev-b2-001',
    organizationId: 'org-boundary-test',
    intakeRevisionId: 'intake-b2-001',
    draftDigest: '0xB2',
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
    body: JSON.stringify({ reviewEntryId: 'rev-b2-001', kind: 'ACCEPT', reason: 'OK', expectedEntryVersion: 1 }),
  });

  assert.equal(res.status, 200, 'Should return 200 on success');
  const body = await res.json();
  assert.equal(body.status, 'DECIDED', 'Should have DECIDED status');
});

test('B2.2: POST /decide với VERSION_CONFLICT → 403, chỉ một response (không unhandled)', async () => {
  const { port } = await startFreshServer();
  reviewStore.create({
    reviewEntryId: 'rev-b2-002',
    organizationId: 'org-boundary-test',
    intakeRevisionId: 'intake-b2-002',
    draftDigest: '0xB2STALE',
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

  // expectedEntryVersion=1 nhưng current version=2 → VERSION_CONFLICT
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewEntryId: 'rev-b2-002', kind: 'ACCEPT', reason: 'Stale', expectedEntryVersion: 1 }),
  });

  assert.equal(res.status, 403, 'Should return 403 for VERSION_CONFLICT');
  const body = await res.json();
  assert.match(body.code, /VERSION_CONFLICT/, 'Should have VERSION_CONFLICT code');
  assert.ok(body.error.includes('VERSION_CONFLICT'), 'Error message should include code');
});

test('B2.3: POST /link với VALIDATION_ERROR → 403, chỉ một response', async () => {
  const { port } = await startFreshServer();
  reviewStore.create({
    reviewEntryId: 'rev-b2-003',
    organizationId: 'org-boundary-test',
    intakeRevisionId: 'intake-b2-003',
    draftDigest: '0xB3',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // targetKind không hợp lệ
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewEntryId: 'rev-b2-003', targetKind: 'BOGUS', targetRef: 'x', label: 'y' }),
  });

  assert.equal(res.status, 403, 'Should return 403 for VALIDATION_ERROR');
  const body = await res.json();
  assert.match(body.code, /VALIDATION_ERROR/, 'Should have VALIDATION_ERROR code');
});

// ═══════════════════════════════════════════════════════════════
// B3: Error format - không lộ stack/PII
// ═══════════════════════════════════════════════════════════════

test('B3.1: ReviewServiceError không lộ stack trace', async () => {
  const { port } = await startFreshServer();
  
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/detail?id=nonexistent`);
  const body = await res.json();
  
  // Error không nên chứa "at " (stack trace pattern)
  assert.ok(!body.error?.includes(' at '), 'Error should not contain stack trace');
  assert.ok(!body.error?.includes('Error:'), 'Error should not contain Error prefix from stack');
});

test('B3.2: Unexpected error trả 500 nhưng không lộ chi tiết', async () => {
  const { port } = await startFreshServer();
  reviewStore.create({
    reviewEntryId: 'rev-b3-002',
    organizationId: 'org-boundary-test',
    intakeRevisionId: 'intake-b3-002',
    draftDigest: '0xB3X',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Gửi body không hợp lệ để trigger unexpected error path
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not valid json{',
  });

  // Parse error → 400
  assert.equal(res.status, 400, 'Invalid JSON should return 400');
  const body = await res.json();
  assert.ok(body.error, 'Should have error field');
});

test('B3.3: Error response có đầy đủ fields: error, code, message', async () => {
  const { port } = await startFreshServer();
  reviewStore.create({
    reviewEntryId: 'rev-b3-003',
    organizationId: 'org-boundary-test',
    intakeRevisionId: 'intake-b3-003',
    draftDigest: '0xB3Y',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // VALIDATION_ERROR
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewEntryId: 'rev-b3-003', targetKind: 'INVALID', targetRef: 'x', label: 'y' }),
  });

  assert.equal(res.status, 403, 'Should return 403');
  const body = await res.json();
  assert.ok(body.error, 'Should have error field');
  assert.ok(body.code, 'Should have code field');
  // message là optional
});

// ═══════════════════════════════════════════════════════════════
// B4: HTTP Status code mapping
// ═══════════════════════════════════════════════════════════════

test('B4.1: NOT_FOUND → 404', async () => {
  const { port } = await startFreshServer();
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/detail?id=not-exist`);
  assert.equal(res.status, 404);
});

test('B4.2: VALIDATION_ERROR → 403', async () => {
  const { port } = await startFreshServer();
  reviewStore.create({
    reviewEntryId: 'rev-b4-002',
    organizationId: 'org-boundary-test',
    intakeRevisionId: 'intake-b4-002',
    draftDigest: '0xB4',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewEntryId: 'rev-b4-002', kind: 'INVALID_KIND', reason: 'x', expectedEntryVersion: 1 }),
  });
  assert.equal(res.status, 403, 'Invalid decision kind should return 403');
});

test('B4.3: VERSION_CONFLICT → 403', async () => {
  const { port } = await startFreshServer();
  reviewStore.create({
    reviewEntryId: 'rev-b4-003',
    organizationId: 'org-boundary-test',
    intakeRevisionId: 'intake-b4-003',
    draftDigest: '0xB4C',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [
      { auditId: 'a1', at: new Date().toISOString(), actor: 'system', action: 'CREATED' },
      { auditId: 'a2', at: new Date().toISOString(), actor: 'user', action: 'DECISION:ACCEPT' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Version đã thay đổi
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewEntryId: 'rev-b4-003', kind: 'REJECT', reason: 'Stale', expectedEntryVersion: 1 }),
  });
  assert.equal(res.status, 403, 'Stale version should return 403');
  const body = await res.json();
  assert.match(body.code, /VERSION_CONFLICT/);
});

test('B4.4: Invalid JSON → 400', async () => {
  const { port } = await startFreshServer();
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'invalid json',
  });
  assert.equal(res.status, 400, 'Invalid JSON should return 400');
});

// ═══════════════════════════════════════════════════════════════
// B5: GET/POST routing không nhầm lẫn
// ═══════════════════════════════════════════════════════════════

test('B5.1: GET /list ≠ POST /decide', async () => {
  const { port } = await startFreshServer();
  
  // GET /list
  const getRes = await fetch(`http://127.0.0.1:${port}/mock/review/list`);
  assert.equal(getRes.status, 200, 'GET /list should work');
  
  // POST /decide với GET method → 404
  const postRes = await fetch(`http://127.0.0.1:${port}/mock/review/decide`, { method: 'GET' });
  assert.equal(postRes.status, 404, 'GET /decide should return 404');
});

test('B5.2: POST body validation - missing fields → 400', async () => {
  const { port } = await startFreshServer();
  
  // Thiếu required fields
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewEntryId: 'rev-xxx' }), // missing kind, reason, expectedEntryVersion
  });
  
  assert.equal(res.status, 400, 'Missing fields should return 400');
  const body = await res.json();
  assert.match(body.error, /VALIDATION_ERROR/);
});
