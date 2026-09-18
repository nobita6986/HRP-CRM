/**
 * integration-api/tests/server.test.mjs — CORE/1.1 fixture cho HTTP API.
 *
 * CORE/1.1 = CORE/1.0 + CanonicalHrpGateway deterministic mock.
 *  - CORE/1.0 boundaries giữ nguyên (mock mode, startup guard, contracts pin,
 *    health tách, allowlist routes).
 *  - Thêm: POST /mock/gateway/call + GET /mock/gateway/log (xem gateway.test.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('./dist/server.js')) {
  execSync('npm run build', { stdio: 'inherit' });
}

const { startServer, VERSION } = await import('../dist/server.js');
const { loadConfig, assertNotProductionMock } = await import(
  '../../../packages/config/dist/index.js'
);

test('integration-api: VERSION exposed (CORE/1.2)', () => {
  assert.equal(VERSION, '1.2.0-core1.8');
});

test('integration-api: contractsVersion pin 0.0.8-g0.8-fixes', () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '14001',
  };
  const r = loadConfig({ env, kind: 'api' });
  assert.equal(r.config.contractsVersion, '0.0.8-g0.8-fixes');
});

test('integration-api: assertNotProductionMock throws ở production + mock', () => {
  assert.throws(
    () =>
      assertNotProductionMock({
        NODE_ENV: 'production',
        HRP_MOCK_MODE: 'deterministic',
      }),
    /STARTUP_BLOCKED/,
  );
});

test('integration-api: HRP_DATABASE_URL bị reject bởi config loader', () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_DATABASE_URL: 'postgres://hrp-core-leaked',
  };
  assert.throws(() => loadConfig({ env, kind: 'api' }), /HRP_DATABASE_URL/);
});

test('integration-api: startServer với config hợp lệ + close', async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '14002',
  };
  const r = loadConfig({ env, kind: 'api' });
  const server = await startServer(r.config);
  try {
    const addr = server.address();
    const port = addr ? addr.port : 0;
    assert.ok(port >= 1024, 'port should be valid');
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test('integration-api: /health/live trả status=live (CORE/1.2)', async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '14003',
  };
  const r = loadConfig({ env, kind: 'api' });
  const server = await startServer(r.config);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/health/live`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'live');
    assert.equal(body.version, '1.2.0-core1.8');
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test('integration-api: /health/ready tách với live (dependenciesConnected=false)', async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '14004',
  };
  const r = loadConfig({ env, kind: 'api' });
  const server = await startServer(r.config);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/health/ready`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ready');
    assert.equal(body.dependenciesConnected, false);
    assert.equal(body.contractsVersion, '0.0.8-g0.8-fixes');
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test('integration-api: /mock/integration trả mock status', async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '14005',
    HRP_MOCK_ROUTES: '/mock/integration',
  };
  const r = loadConfig({ env, kind: 'api' });
  const server = await startServer(r.config);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/mock/integration/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'mock');
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test('integration-api: route ngoài allowlist trả 404', async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '14006',
  };
  const r = loadConfig({ env, kind: 'api' });
  const server = await startServer(r.config);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/random/not/allowed`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'route_not_found');
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

// ─── Auditor CHANGES_REQUIRED guard: /mock/gateway/* blocked when mockMode=off ──

test('integration-api: /mock/gateway/call blocked khi mockMode=off → 404 mock_disabled', async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'off',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '14007',
  };
  const r = loadConfig({ env, kind: 'api' });
  const server = await startServer(r.config);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/mock/gateway/call`, {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'mock_disabled');
    assert.match(body.message, /mockMode=off|HRP_MOCK_MODE=off/);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test('integration-api: /mock/gateway/log blocked khi mockMode=off → 404 mock_disabled', async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'off',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '14008',
  };
  const r = loadConfig({ env, kind: 'api' });
  const server = await startServer(r.config);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/mock/gateway/log`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'mock_disabled');
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test('integration-api: /mock/gateway/call VẪN hoạt động khi mockMode=deterministic (CORE/1.1 không tự đóng)', async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '14009',
  };
  const r = loadConfig({ env, kind: 'api' });
  const server = await startServer(r.config);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/mock/gateway/call`, {
      method: 'POST',
      body: JSON.stringify({
        schemaVersion: '1',
        organizationId: 'org-synthetic-001',
        actor: { kind: 'SERVICE', serviceId: 'svc-test' },
        correlationId: 'corr-001',
        idempotencyKey: 'idem-001',
        idempotencyKeyDigest: 'a'.repeat(64),
        payloadDigest: 'b'.repeat(64),
        gateway: { scenarioId: 'EXACT_OK', provider: 'CHATWOOT' },
        command: { kind: 'noop', payload: {} },
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    // Có thể 200 (mock result) hoặc 400 (schema fail). Quan trọng: KHÔNG 404.
    assert.notEqual(res.status, 404);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});
