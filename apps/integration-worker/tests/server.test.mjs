/**
 * integration-worker/tests/server.test.mjs — CORE/1.0 worker scaffold fixtures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('./dist/server.js')) {
  execSync('npm run build', { stdio: 'inherit' });
}

const { startWorker, VERSION } = await import('../dist/server.js');
const { loadConfig, assertNotProductionMock } = await import(
  '../../../packages/config/dist/index.js'
);

test('integration-worker: VERSION exposed', () => {
  assert.equal(VERSION, '1.1.0-core1.4');
});

test('integration-worker: contractsVersion pin 0.0.8-g0.8-fixes', () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
  };
  const r = loadConfig({ env, kind: 'worker' });
  assert.equal(r.config.contractsVersion, '0.0.8-g0.8-fixes');
});

test('integration-worker: assertNotProductionMock throws ở production + mock', () => {
  assert.throws(
    () =>
      assertNotProductionMock({
        NODE_ENV: 'production',
        HRP_MOCK_MODE: 'deterministic',
      }),
    /STARTUP_BLOCKED/,
  );
});

test('integration-worker: HRP_DATABASE_URL bị reject', () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_DATABASE_URL: 'postgres://hrp-core-leaked',
  };
  assert.throws(() => loadConfig({ env, kind: 'worker' }), /HRP_DATABASE_URL/);
});

test('integration-worker: startWorker với mock=deterministic có state', async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_POLL_INTERVAL_MS: '100',
  };
  const r = loadConfig({ env, kind: 'worker' });
  const w = await startWorker(r.config, { databaseUrl: '' });
  try {
    assert.equal(w.state.ticks >= 0, true);
    assert.ok(w.healthPort >= 1024, 'health port must be valid');
    // Wait một tick để interval chạy.
    await new Promise((r2) => setTimeout(r2, 150));
    assert.ok(w.state.ticks >= 1, `expected >=1 tick, got ${w.state.ticks}`);
  } finally {
    await w.stop();
  }
});

test('integration-worker: startWorker với mock=off KHÔNG tick', async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'off',
    HRP_POLL_INTERVAL_MS: '100',
  };
  const r = loadConfig({ env, kind: 'worker' });
  const w = await startWorker(r.config, { databaseUrl: '' });
  try {
    await new Promise((r2) => setTimeout(r2, 200));
    assert.equal(w.state.ticks, 0, 'mock=off phải không tick');
  } finally {
    await w.stop();
  }
});

test('integration-worker: /health/live trả status=live', async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'off',
  };
  const r = loadConfig({ env, kind: 'worker' });
  const w = await startWorker(r.config, { databaseUrl: '' });
  try {
    const res = await fetch(`http://127.0.0.1:${w.healthPort}/health/live`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'live');
    assert.equal(body.version, '1.1.0-core1.4');
  } finally {
    await w.stop();
  }
});

test('integration-worker: /health/ready tách live + dependenciesConnected=false', async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'off',
  };
  const r = loadConfig({ env, kind: 'worker' });
  // Explicitly disable durable worker (no DATABASE_URL option).
  const w = await startWorker(r.config, { databaseUrl: '' });
  try {
    const res = await fetch(`http://127.0.0.1:${w.healthPort}/health/ready`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ready');
    assert.equal(body.dependenciesConnected, false);
    assert.equal(body.queueReady, false);
    assert.equal(body.leaseReady, false);
  } finally {
    await w.stop();
  }
});

test('integration-worker: startWorker throw nếu appKind không phải worker', async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'off',
  };
  const r = loadConfig({ env, kind: 'api' });
  // ép kiểu để test guard nội bộ
  await assert.rejects(
    () => startWorker(/** @type {any} */ (r.config), { databaseUrl: '' }),
    /Expected worker config/,
  );
});
