/**
 * apps/integration-api/tests/review-http.test.mjs — CORE/1.7
 *
 * HTTP-level integration tests for /mock/review/* routes.
 * Each test starts a fresh server on a unique port and tears it down on completion.
 *
 * Covers AC1 (scope/PII), AC2 (decision + version conflict), AC3 (link/unlink),
 * AC4 (replay).
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
let portCounter = 16000;

async function startFreshServer() {
  const port = portCounter++;
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: String(port),
    HRP_ORGANIZATION_ID: 'org-review-http-001',
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

test('HTTP: GET /mock/review/list → 200 + empty list when no entries', async () => {
  const { port } = await startFreshServer();
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/list`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.organizationId, 'org-review-http-001');
  assert.deepEqual(body.entries, []);
  assert.equal(body.totalEstimate, 0);
});

test('HTTP: GET /mock/review/list with status filter', async () => {
  const { port } = await startFreshServer();
  reviewStore.create({
    reviewEntryId: 'rev-list-001',
    organizationId: 'org-review-http-001',
    intakeRevisionId: 'intake-list-001',
    draftDigest: '0xABCD',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/list?status=OPEN`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.entries.length, 1);
  assert.equal(body.entries[0].status, 'OPEN');
});

test('HTTP: GET /mock/review/detail?id=... → 200 + redacted output (PII guard)', async () => {
  const { port } = await startFreshServer();
  reviewStore.create({
    reviewEntryId: 'rev-detail-001',
    organizationId: 'org-review-http-001',
    intakeRevisionId: 'intake-detail-001',
    canonicalId: 'lp-detail-001',
    canonicalVersion: 2,
    draftDigest: '0xDETAIL',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [
      {
        auditId: 'a-001',
        at: new Date().toISOString(),
        actor: 'system',
        action: 'CREATED',
        detail: { reason: 'PII content: fullName=John Doe phone=1234567890' },
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/detail?id=rev-detail-001`);
  assert.equal(res.status, 200);
  const body = await res.json();

  // AC1: PII guard — fullName/phone should NOT appear in output.
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes('John Doe'), 'fullName must NOT leak via detail field');
  assert.ok(!serialized.includes('1234567890'), 'phone must NOT leak via detail field');

  // Output should contain audit summary (no detail field).
  assert.ok(body.auditSummary, 'audit summary present');
  assert.ok(!body.auditSummary[0].detail, 'audit detail stripped');
});

test('HTTP: GET /mock/review/detail?id=invalid → 404', async () => {
  const { port } = await startFreshServer();
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/detail?id=nonexistent`);
  assert.equal(res.status, 404);
});

test('HTTP: POST /mock/review/decide → 200 DECIDED', async () => {
  const { port } = await startFreshServer();
  reviewStore.create({
    reviewEntryId: 'rev-decide-001',
    organizationId: 'org-review-http-001',
    intakeRevisionId: 'intake-decide-001',
    draftDigest: '0xDECIDE',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [
      { auditId: 'a-001', at: new Date().toISOString(), actor: 'system', action: 'CREATED' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewEntryId: 'rev-decide-001',
      kind: 'ACCEPT',
      reason: 'All evidence verified',
      expectedEntryVersion: 1,
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'DECIDED');
  assert.equal(body.decision.kind, 'ACCEPT');
});

test('HTTP: POST /mock/review/decide with stale version → 403 VERSION_CONFLICT', async () => {
  const { port } = await startFreshServer();
  reviewStore.create({
    reviewEntryId: 'rev-decide-stale-001',
    organizationId: 'org-review-http-001',
    intakeRevisionId: 'intake-decide-stale-001',
    draftDigest: '0xSTALE',
    status: 'OPEN',
    decision: null,
    decisionVersion: null,
    anchorRefs: [],
    auditLog: [
      { auditId: 'a-001', at: new Date().toISOString(), actor: 'system', action: 'CREATED' },
      { auditId: 'a-002', at: new Date().toISOString(), actor: 'user', action: 'LINK:CANDIDATE' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const res = await fetch(`http://127.0.0.1:${port}/mock/review/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewEntryId: 'rev-decide-stale-001',
      kind: 'ACCEPT',
      reason: 'Stale',
      expectedEntryVersion: 1, // current is 2
    }),
  });

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /VERSION_CONFLICT/);
});

test('HTTP: POST /mock/review/link → 200 + anchorRefCount=1', async () => {
  const { port } = await startFreshServer();
  reviewStore.create({
    reviewEntryId: 'rev-link-001',
    organizationId: 'org-review-http-001',
    intakeRevisionId: 'intake-link-001',
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
    body: JSON.stringify({
      reviewEntryId: 'rev-link-001',
      targetKind: 'CANDIDATE',
      targetRef: 'cand-001',
      label: 'Candidate A (REDACTED)',
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.anchorRefCount, 1);
});

test('HTTP: POST /mock/review/link invalid targetKind → 403 VALIDATION_ERROR', async () => {
  const { port } = await startFreshServer();
  reviewStore.create({
    reviewEntryId: 'rev-link-invalid-001',
    organizationId: 'org-review-http-001',
    intakeRevisionId: 'intake-link-invalid-001',
    draftDigest: '0xLINV',
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
    body: JSON.stringify({
      reviewEntryId: 'rev-link-invalid-001',
      targetKind: 'BOGUS_KIND',
      targetRef: 'x-001',
      label: 'x',
    }),
  });

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /VALIDATION_ERROR/);
});

test('HTTP: POST /mock/review/replay COMPLETED checkpoint → canProceed=false', async () => {
  const { port } = await startFreshServer();
  reviewStore.create({
    reviewEntryId: 'rev-replay-001',
    organizationId: 'org-review-http-001',
    intakeRevisionId: 'intake-replay-001',
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
    body: JSON.stringify({
      reviewEntryId: 'rev-replay-001',
      checkpointState: 'COMPLETED',
      checkpointDigest: '0xREPLAY',
      appliedSteps: ['IDENTITY', 'PROFILE', 'CASE', 'AVAILABILITY'],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.canProceed, false);
  assert.match(body.canProceedReason, /ALREADY_APPLIED/);
});

test('HTTP: POST /mock/review/replay with draftDigest drift → canProceed=false', async () => {
  const { port } = await startFreshServer();
  reviewStore.create({
    reviewEntryId: 'rev-replay-drift-001',
    organizationId: 'org-review-http-001',
    intakeRevisionId: 'intake-replay-drift-001',
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
      reviewEntryId: 'rev-replay-drift-001',
      checkpointState: 'RUNNING',
      checkpointDigest: '0xDRIFTED', // different from entry's 0xORIGINAL
      appliedSteps: [],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.canProceed, false);
  assert.match(body.canProceedReason, /DRAFT_DIGEST_CHANGED/);
});

test('HTTP: POST /mock/review/replay with PARTIAL checkpoint → canProceed=true', async () => {
  const { port } = await startFreshServer();
  reviewStore.create({
    reviewEntryId: 'rev-replay-partial-001',
    organizationId: 'org-review-http-001',
    intakeRevisionId: 'intake-replay-partial-001',
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
      reviewEntryId: 'rev-replay-partial-001',
      checkpointState: 'PARTIAL',
      checkpointDigest: '0xPARTIAL',
      appliedSteps: ['IDENTITY', 'PROFILE'],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.canProceed, true);
  assert.deepEqual(body.appliedSteps, ['IDENTITY', 'PROFILE']);
});

test('HTTP: unknown /mock/review/* subroute → 404', async () => {
  const { port } = await startFreshServer();
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/bogus`, { method: 'GET' });
  assert.equal(res.status, 404);
});

test('HTTP: review route registered under /mock/review/* path', async () => {
  const { port } = await startFreshServer();
  const res = await fetch(`http://127.0.0.1:${port}/mock/review/list`);
  assert.notEqual(res.status, 404);
  assert.equal(res.status, 200);
});
