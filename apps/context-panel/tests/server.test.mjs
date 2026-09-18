/**
 * context-panel/tests/server.test.mjs — CORE/1.9 panel scaffold fixtures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('./dist/server.js')) {
  execSync('npm run build', { stdio: 'inherit' });
}

const { startPanel, VERSION } = await import('../dist/server.js');
const { loadConfig, assertNotProductionMock } = await import(
  '../../../packages/config/dist/index.js'
);

test('context-panel: VERSION exposed', () => {
  assert.equal(VERSION, '1.0.0-core1.9');
});

test('context-panel: contractsVersion pin 0.0.8-g0.8-fixes', () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '15001',
    HRP_ALLOW_DEV_TOOLS: 'true',
  };
  const r = loadConfig({ env, kind: 'panel' });
  assert.equal(r.config.contractsVersion, '0.0.8-g0.8-fixes');
});

test('context-panel: assertNotProductionMock throws ở production + mock', () => {
  assert.throws(
    () =>
      assertNotProductionMock({
        NODE_ENV: 'production',
        HRP_MOCK_MODE: 'deterministic',
      }),
    /STARTUP_BLOCKED/,
  );
});

test('context-panel: HRP_DATABASE_URL bị reject', () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_DATABASE_URL: 'postgres://hrp-core-leaked',
  };
  assert.throws(() => loadConfig({ env, kind: 'panel' }), /HRP_DATABASE_URL/);
});

test('context-panel: allowDevTools=true ở production bị reject', () => {
  const env = {
    NODE_ENV: 'production',
    HRP_MOCK_MODE: 'off',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '15002',
    HRP_ALLOW_DEV_TOOLS: 'true',
  };
  assert.throws(() => loadConfig({ env, kind: 'panel' }), /allowDevTools/);
});

test('context-panel: allowDevTools=false ở production pass', () => {
  const env = {
    NODE_ENV: 'production',
    HRP_MOCK_MODE: 'off',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '15002',
    HRP_ALLOW_DEV_TOOLS: 'false',
  };
  const r = loadConfig({ env, kind: 'panel' });
  assert.equal(r.config.allowDevTools, false);
});

test('context-panel: /health/live trả status=live', async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'off',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '15003',
    HRP_ALLOW_DEV_TOOLS: 'false',
  };
  const r = loadConfig({ env, kind: 'panel' });
  const server = await startPanel(r.config);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/health/live`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'live');
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test('context-panel: /health/ready tách live + dependenciesConnected=false', async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'off',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '15004',
    HRP_ALLOW_DEV_TOOLS: 'false',
  };
  const r = loadConfig({ env, kind: 'panel' });
  const server = await startPanel(r.config);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/health/ready`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ready');
    assert.equal(body.dependenciesConnected, false);
    assert.equal(body.uiRealBackend, false);
    assert.equal(body.contractsVersion, '0.0.8-g0.8-fixes');
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test('context-panel: / trả HTML mock', async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '15005',
    HRP_ALLOW_DEV_TOOLS: 'true',
  };
  const r = loadConfig({ env, kind: 'panel' });
  const server = await startPanel(r.config);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    const ct = res.headers.get('content-type') ?? '';
    assert.ok(ct.includes('text/html'));
    const body = await res.text();
    assert.ok(body.includes('HRP Context Panel'));
    assert.ok(body.includes('CORE/1.9'));
    assert.ok(body.includes('0.0.8-g0.8-fixes'));
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test('context-panel: route không tồn tại trả 404', async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'off',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '15006',
    HRP_ALLOW_DEV_TOOLS: 'false',
  };
  const r = loadConfig({ env, kind: 'panel' });
  const server = await startPanel(r.config);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/random`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'route_not_found');
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test('context-panel: startPanel throw nếu appKind không phải panel', async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'off',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '15007',
  };
  const r = loadConfig({ env, kind: 'api' });
  await assert.rejects(
    () => startPanel(/** @type {any} */ (r.config)),
    /Expected panel config/,
  );
});
