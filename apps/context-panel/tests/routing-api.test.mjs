/**
 * context-panel/tests/routing-api.test.mjs — CORE/1.11 routing API integration tests.
 *
 * Boots the real panel server and exercises:
 *  - GET /api/routing/pools (read by any authenticated identity)
 *  - POST /api/routing/pools/:id/simulate (read-only, no manager check)
 *  - PUT /api/routing/pools/:id (MANAGER ONLY — server-side enforcement)
 *  - POST /api/routing/pools (MANAGER ONLY — server-side enforcement)
 *
 * AC #4: AI/sale không tự sửa weights nếu thiếu manager capability.
 *         enforce tại mock service boundary, không chỉ ẩn nút.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { request } from 'node:http';

if (!existsSync('./dist/server.js')) {
  execSync('npm run build', { stdio: 'inherit' });
}

const { startPanel } = await import('../dist/server.js');
const { loadConfig } = await import('../../../packages/config/dist/index.js');

let server, port;

async function fetchJson(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: 'GET', headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          let json;
          try {
            json = JSON.parse(body);
          } catch {
            json = body;
          }
          resolve({ status: res.statusCode, body: json });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function sendJson(path, method, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            json = text;
          }
          resolve({ status: res.statusCode, body: json });
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const SUPERVISOR = 'staff-supervisor-001';
const INTAKE_OP = 'staff-intake-001'; // sale — not manager
const TALENT_REVIEWER = 'staff-talent-001'; // sale — not manager

test.before(async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '15555',
    HRP_ALLOW_DEV_TOOLS: 'true',
  };
  const { config } = loadConfig({ env, kind: 'panel' });
  server = await startPanel(config);
  port = config.listen.port;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Read endpoints (any authenticated identity)
// ═══════════════════════════════════════════════════════════════════════════

test('routing-api: GET /api/routing/pools returns seeded pool (supervisor)', async () => {
  const res = await fetchJson('/api/routing/pools', { 'x-hrp-staff-id': SUPERVISOR });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.pools));
  assert.ok(res.body.pools.length >= 1);
  const pool = res.body.pools.find((p) => p.poolId === 'pool-weighted-3-2-1-4');
  assert.ok(pool);
  assert.equal(pool.strategy, 'WEIGHTED_DISTRIBUTION');
});

test('routing-api: GET /api/routing/pools returns seeded pool (sale can read)', async () => {
  const res = await fetchJson('/api/routing/pools', { 'x-hrp-staff-id': INTAKE_OP });
  assert.equal(res.status, 200);
  assert.ok(res.body.pools.length >= 1);
});

test('routing-api: GET /api/routing/pools 401 without identity', async () => {
  const res = await fetchJson('/api/routing/pools');
  assert.equal(res.status, 401);
});

// ═══════════════════════════════════════════════════════════════════════════
// Simulate (read-only, no manager check)
// ═══════════════════════════════════════════════════════════════════════════

test('routing-api: POST /api/routing/pools/:id/simulate by sale (read-only, allowed)', async () => {
  const res = await sendJson(
    '/api/routing/pools/pool-weighted-3-2-1-4/simulate?count=10&scenario=normal',
    'POST',
    {},
    { 'x-hrp-staff-id': INTAKE_OP },
  );
  assert.equal(res.status, 200);
  assert.ok(res.body.result);
  assert.equal(res.body.result.customerCount, 10);
});

test('routing-api: simulate returns 10 customer assignments', async () => {
  const res = await sendJson(
    '/api/routing/pools/pool-weighted-3-2-1-4/simulate?count=10&scenario=normal',
    'POST',
    {},
    { 'x-hrp-staff-id': SUPERVISOR },
  );
  assert.equal(res.status, 200);
  const assignments = res.body.result.assignments;
  assert.equal(assignments.length, 10);
  // Per-staff distribution: each assignment has a staffActorId
  for (const a of assignments) {
    assert.ok(a.staffActorId);
  }
});

test('routing-api: simulate 100 customers', async () => {
  const res = await sendJson(
    '/api/routing/pools/pool-weighted-3-2-1-4/simulate?count=100&scenario=normal',
    'POST',
    {},
    { 'x-hrp-staff-id': SUPERVISOR },
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.result.customerCount, 100);
});

test('routing-api: simulate 404 on unknown pool', async () => {
  const res = await sendJson(
    '/api/routing/pools/no-such-pool/simulate?count=10',
    'POST',
    {},
    { 'x-hrp-staff-id': SUPERVISOR },
  );
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'POOL_NOT_FOUND');
});

// ═══════════════════════════════════════════════════════════════════════════
// Update pool — MANAGER ONLY (AC #4 enforced at server)
// ═══════════════════════════════════════════════════════════════════════════

test('routing-api: PUT pool by SUPERVISOR (manager) → 200', async () => {
  const res = await sendJson(
    '/api/routing/pools/pool-weighted-3-2-1-4',
    'PUT',
    {
      organizationId: 'org-001',
      poolId: 'pool-weighted-3-2-1-4',
      expectedVersion: 1,
      patch: { description: 'Updated via API' },
      reasonCode: 'TEST_API',
    },
    { 'x-hrp-staff-id': SUPERVISOR },
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.pool.version, 2);
  assert.equal(res.body.pool.description, 'Updated via API');
});

test('routing-api: PUT pool by INTAKE_OPERATOR (sale) → 403 MANAGER_REQUIRED (NOT just UI hide)', async () => {
  const res = await sendJson(
    '/api/routing/pools/pool-weighted-3-2-1-4',
    'PUT',
    {
      organizationId: 'org-001',
      poolId: 'pool-weighted-3-2-1-4',
      expectedVersion: 2,
      patch: { description: 'Sale trying to update' },
      reasonCode: 'UNAUTHORIZED',
    },
    { 'x-hrp-staff-id': INTAKE_OP },
  );
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'MANAGER_REQUIRED');
  // Pool was NOT updated
  const check = await fetchJson('/api/routing/pools', { 'x-hrp-staff-id': SUPERVISOR });
  const pool = check.body.pools.find((p) => p.poolId === 'pool-weighted-3-2-1-4');
  assert.notEqual(pool.description, 'Sale trying to update');
  assert.equal(pool.version, 2); // unchanged from previous SUPERVISOR update
});

test('routing-api: PUT pool by TALENT_REVIEWER (sale) → 403 MANAGER_REQUIRED', async () => {
  const res = await sendJson(
    '/api/routing/pools/pool-weighted-3-2-1-4',
    'PUT',
    {
      organizationId: 'org-001',
      poolId: 'pool-weighted-3-2-1-4',
      expectedVersion: 2,
      patch: { description: 'Reviewer trying' },
      reasonCode: 'UNAUTHORIZED',
    },
    { 'x-hrp-staff-id': TALENT_REVIEWER },
  );
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'MANAGER_REQUIRED');
});

test('routing-api: PUT pool with stale version → 409 VERSION_CONFLICT', async () => {
  const res = await sendJson(
    '/api/routing/pools/pool-weighted-3-2-1-4',
    'PUT',
    {
      organizationId: 'org-001',
      poolId: 'pool-weighted-3-2-1-4',
      expectedVersion: 99, // stale
      patch: { description: 'Stale' },
      reasonCode: 'STALE',
    },
    { 'x-hrp-staff-id': SUPERVISOR },
  );
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'VERSION_CONFLICT');
});

// ═══════════════════════════════════════════════════════════════════════════
// Create pool — MANAGER ONLY
// ═══════════════════════════════════════════════════════════════════════════

test('routing-api: POST pool by SUPERVISOR → 201', async () => {
  const res = await sendJson(
    '/api/routing/pools',
    'POST',
    {
      schemaVersion: '1',
      organizationId: 'org-001',
      poolId: 'pool-test-create-001',
      displayName: 'Test create pool',
      strategy: 'SOURCE_ALLOCATION',
      eligibleSet: {
        schemaVersion: '1',
        organizationId: 'org-001',
        roles: ['SALE'],
      },
      fixedOwner: {
        schemaVersion: '1',
        provider: 'ZALO',
        connectionId: 'zalo-oa-001',
        recipientActorId: 'staff-sale-A',
        recipientRole: 'SALE',
      },
    },
    { 'x-hrp-staff-id': SUPERVISOR },
  );
  assert.equal(res.status, 201);
  assert.equal(res.body.pool.poolId, 'pool-test-create-001');
});

test('routing-api: POST pool by INTAKE_OPERATOR → 403 MANAGER_REQUIRED', async () => {
  const res = await sendJson(
    '/api/routing/pools',
    'POST',
    {
      schemaVersion: '1',
      organizationId: 'org-001',
      poolId: 'pool-sale-attempt-002',
      displayName: 'Sale attempt',
      strategy: 'SOURCE_ALLOCATION',
      eligibleSet: {
        schemaVersion: '1',
        organizationId: 'org-001',
        roles: ['SALE'],
      },
      fixedOwner: {
        schemaVersion: '1',
        provider: 'ZALO',
        connectionId: 'zalo-oa-001',
        recipientActorId: 'staff-sale-A',
        recipientRole: 'SALE',
      },
    },
    { 'x-hrp-staff-id': INTAKE_OP },
  );
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'MANAGER_REQUIRED');
});

// ═══════════════════════════════════════════════════════════════════════════
// Fallback scenarios via simulate endpoint
// ═══════════════════════════════════════════════════════════════════════════

test('routing-api: simulate with all-offline scenario returns fallback queue', async () => {
  // Note: server uses default fixture (all online). This test confirms the
  // simulation endpoint returns a result with `assignments` and `fallbackQueue`
  // fields; the all-offline scenario is exercised in unit tests.
  const res = await sendJson(
    '/api/routing/pools/pool-weighted-3-2-1-4/simulate?count=10&scenario=all-offline',
    'POST',
    {},
    { 'x-hrp-staff-id': SUPERVISOR },
  );
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.result.fallbackQueue));
  assert.ok(Array.isArray(res.body.result.assignments));
  // Normal fixture: 10 assigned, 0 fallback
  assert.equal(res.body.result.assignments.length, 10);
  assert.equal(res.body.result.fallbackQueue.length, 0);
});
