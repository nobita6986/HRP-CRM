/**
 * tests/dashboard-api.test.mjs — CORE/1.12 Dashboard API integration tests.
 *
 * Boots the real context-panel server (in-process) and exercises the new
 * HTTP endpoints. Validates AC #4 (manager-only at the HTTP boundary) and
 * AC #5 (no model/HRP DB calls — purely synthetic).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { request } from 'node:http';

if (!existsSync('./dist/server.js')) {
  execSync('npm run build', { stdio: 'inherit' });
}

const { startPanel } = await import('../dist/server.js');
const { loadConfig } = await import('../../../packages/config/dist/index.js');

let server;
let port;

async function fetchJson(path, options = {}) {
  const { method = 'GET', headers = {}, body = null } = options;
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };
    if (data) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(data);
    }
    const r = request(
      { host: '127.0.0.1', port, path, method, headers: reqHeaders },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let json;
          try { json = JSON.parse(text); } catch { json = text; }
          resolve({ status: res.statusCode, body: json });
        });
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

before(async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '15503',
    HRP_ALLOW_DEV_TOOLS: 'true',
  };
  const { config } = loadConfig({ env, kind: 'panel' });
  port = config.listen.port;
  server = await startPanel(config);
});

after(async () => {
  if (server && server.close) {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test('api: GET /api/dashboard/snapshot returns metrics + KPIs + coverage', async () => {
  const r = await fetchJson('/api/dashboard/snapshot?period=WEEKLY&grain=ORGANIZATION', {
    headers: { 'x-hrp-staff-id': 'staff-supervisor-001' },
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.metrics.length > 0, 'should have metrics');
  assert.ok(r.body.kpis.length > 0, 'should have KPIs');
  assert.ok(r.body.coverage);
  assert.match(r.body.coverage.creditPolicy, /CONFIRMED|PARTIAL|UNKNOWN/);
});

test('api: GET /api/dashboard/snapshot includes growth metric', async () => {
  const r = await fetchJson('/api/dashboard/snapshot?period=WEEKLY&grain=ORGANIZATION', {
    headers: { 'x-hrp-staff-id': 'staff-supervisor-001' },
  });
  assert.equal(r.status, 200);
  assert.ok('growth' in r.body, 'should have growth key');
});

test('api: GET /api/dashboard/drilldown returns rows with sumCheck.consistent=true', async () => {
  const r = await fetchJson('/api/dashboard/drilldown?stage=CREATED&period=WEEKLY', {
    headers: { 'x-hrp-staff-id': 'staff-supervisor-001' },
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.rows.length > 0);
  assert.equal(r.body.sumCheck.consistent, true);
});

test('api: POST /api/dashboard/kpis/assign — manager (supervisor) succeeds', async () => {
  const r = await fetchJson('/api/dashboard/kpis/assign', {
    method: 'POST',
    headers: { 'x-hrp-staff-id': 'staff-supervisor-001' },
    body: {
      organizationId: 'org-001',
      targetType: 'PROFILE_CREATED',
      period: 'MONTHLY',
      targetValue: 150,
      targetActorRole: 'TEAM',
      reasonCode: 'API_TEST_ASSIGN',
    },
  });
  assert.equal(r.status, 201, `expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert.ok(r.body.assignment.assignmentId.length > 0);
});

test('api: POST /api/dashboard/kpis/assign — sale (talent reviewer) is blocked (403)', async () => {
  const r = await fetchJson('/api/dashboard/kpis/assign', {
    method: 'POST',
    headers: { 'x-hrp-staff-id': 'staff-talent-001' },
    body: {
      organizationId: 'org-001',
      targetType: 'PROFILE_CREATED',
      period: 'MONTHLY',
      targetValue: 150,
      targetActorRole: 'TEAM',
      reasonCode: 'API_TEST_SALE_BLOCKED',
    },
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'MANAGER_REQUIRED');
});

test('api: POST /api/dashboard/kpis/assign — intake operator is blocked (403)', async () => {
  const r = await fetchJson('/api/dashboard/kpis/assign', {
    method: 'POST',
    headers: { 'x-hrp-staff-id': 'staff-intake-001' },
    body: {
      organizationId: 'org-001',
      targetType: 'PROFILE_CREATED',
      period: 'MONTHLY',
      targetValue: 150,
      targetActorRole: 'TEAM',
      reasonCode: 'API_TEST_INTAKE_BLOCKED',
    },
  });
  assert.equal(r.status, 403);
});

test('api: POST /api/dashboard/kpis/assign — missing X-HRP-Staff-Id is 401', async () => {
  const r = await fetchJson('/api/dashboard/kpis/assign', {
    method: 'POST',
    body: {
      organizationId: 'org-001',
      targetType: 'PROFILE_CREATED',
      period: 'MONTHLY',
      targetValue: 150,
      targetActorRole: 'TEAM',
      reasonCode: 'API_TEST_UNAUTH',
    },
  });
  assert.equal(r.status, 401);
});

test('api: target-zero without cohort annotation is rejected at server boundary (400)', async () => {
  const r = await fetchJson('/api/dashboard/kpis/assign', {
    method: 'POST',
    headers: { 'x-hrp-staff-id': 'staff-supervisor-001' },
    body: {
      organizationId: 'org-001',
      targetType: 'PROFILE_CREATED',
      period: 'MONTHLY',
      targetValue: 0,
      targetActorRole: 'TEAM',
      reasonCode: 'API_TEST_TARGET_ZERO_NO_COHORT',
    },
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'TARGET_ZERO_NOT_ALLOWED');
});

test('api: PUT /api/dashboard/kpis/revise — stale revision returns 409 VERSION_CONFLICT', async () => {
  const list = await fetchJson('/api/dashboard/kpis', {
    headers: { 'x-hrp-staff-id': 'staff-supervisor-001' },
  });
  const kpi = list.body.assignments.find((k) => k.assignmentId === 'kpi-prof-created-monthly');
  assert.ok(kpi);

  // Revise with correct expectedRevision → 200
  const ok = await fetchJson('/api/dashboard/kpis/revise', {
    method: 'PUT',
    headers: { 'x-hrp-staff-id': 'staff-supervisor-001' },
    body: {
      assignmentId: kpi.assignmentId,
      newTargetValue: 999,
      expectedRevision: kpi.appliedRevision,
      reasonCode: 'API_TEST_REVISE_OK',
    },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.assignment.targetValue, 999);

  // Stale revise → 409
  const stale = await fetchJson('/api/dashboard/kpis/revise', {
    method: 'PUT',
    headers: { 'x-hrp-staff-id': 'staff-supervisor-001' },
    body: {
      assignmentId: kpi.assignmentId,
      newTargetValue: 1000,
      expectedRevision: kpi.appliedRevision, // stale
      reasonCode: 'API_TEST_REVISE_STALE',
    },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'VERSION_CONFLICT');
});

test('api: POST /api/dashboard/kpis/propose — sale can propose; target NOT mutated', async () => {
  const list = await fetchJson('/api/dashboard/kpis', {
    headers: { 'x-hrp-staff-id': 'staff-supervisor-001' },
  });
  const kpi = list.body.assignments.find((k) => k.assignmentId === 'kpi-prof-created-monthly');
  const before = kpi.targetValue;

  const r = await fetchJson('/api/dashboard/kpis/propose', {
    method: 'POST',
    headers: { 'x-hrp-staff-id': 'staff-talent-001' },
    body: {
      assignmentId: kpi.assignmentId,
      proposedTargetValue: 99999,
      rationale: 'API test: sale proposes but target MUST NOT be mutated',
    },
  });
  assert.equal(r.status, 201);

  // Re-fetch and verify target unchanged.
  const listAfter = await fetchJson('/api/dashboard/kpis', {
    headers: { 'x-hrp-staff-id': 'staff-supervisor-001' },
  });
  const kpiAfter = listAfter.body.assignments.find((k) => k.assignmentId === kpi.assignmentId);
  assert.equal(kpiAfter.targetValue, before, 'target MUST NOT be mutated by propose');
});

test('api: GET /api/dashboard/snapshot — unauthorized returns 401', async () => {
  const r = await fetchJson('/api/dashboard/snapshot', {});
  assert.equal(r.status, 401);
});

test('api: drilldown for actorId belonging to a different sale → 403', async () => {
  const r = await fetchJson(
    '/api/dashboard/drilldown?stage=CREATED&period=WEEKLY&grain=ACTOR&actorId=staff-sale-B',
    { headers: { 'x-hrp-staff-id': 'staff-talent-001' } },
  );
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'MANAGER_REQUIRED');
});

test('api: drilldown for actorId matching sale\'s own staffId → 200', async () => {
  const r = await fetchJson(
    '/api/dashboard/drilldown?stage=CREATED&period=WEEKLY&grain=ACTOR&actorId=staff-talent-001',
    { headers: { 'x-hrp-staff-id': 'staff-talent-001' } },
  );
  assert.equal(r.status, 200);
});

test('api: PUT /api/dashboard/kpis/revise — sale is blocked (403)', async () => {
  const r = await fetchJson('/api/dashboard/kpis/revise', {
    method: 'PUT',
    headers: { 'x-hrp-staff-id': 'staff-talent-001' },
    body: {
      assignmentId: 'kpi-prof-created-monthly',
      newTargetValue: 999,
      expectedRevision: 1,
      reasonCode: 'API_TEST_SALE_REVISE_BLOCKED',
    },
  });
  assert.equal(r.status, 403);
});
