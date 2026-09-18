/**
 * config/tests/loader.test.mjs — fixtures CORE/1.0 config loader.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Build trước khi test (cần dist/ cho typecheck).
if (!existsSync('./dist/index.js')) {
  execSync('npm run build', { stdio: 'inherit' });
}

const {
  loadConfig,
  assertNotProductionMock,
  isMockAllowed,
  isProductionEnv,
  parseMockMode,
  parseNodeEnv,
} = await import('../dist/index.js');

test('parseNodeEnv: NODE_ENVS strict 3 giá trị', () => {
  assert.equal(parseNodeEnv('development'), 'development');
  assert.equal(parseNodeEnv('test'), 'test');
  assert.equal(parseNodeEnv('production'), 'production');
  assert.equal(parseNodeEnv(undefined), 'development');
  assert.equal(parseNodeEnv('garbage'), 'development');
});

test('parseMockMode: MOCK_MODES strict 2 giá trị', () => {
  assert.equal(parseMockMode('off'), 'off');
  assert.equal(parseMockMode('deterministic'), 'deterministic');
  assert.equal(parseMockMode(undefined), 'off');
  assert.equal(parseMockMode('garbage'), 'off');
});

test('isProductionEnv: chỉ true khi NODE_ENV=production', () => {
  assert.equal(isProductionEnv({ NODE_ENV: 'production' }), true);
  assert.equal(isProductionEnv({ NODE_ENV: 'development' }), false);
  assert.equal(isProductionEnv({ NODE_ENV: 'test' }), false);
  assert.equal(isProductionEnv({}), false);
});

test('isMockAllowed: production cấm mock', () => {
  assert.equal(isMockAllowed({ NODE_ENV: 'production' }, 'deterministic'), false);
  assert.equal(isMockAllowed({ NODE_ENV: 'production' }, 'off'), false);
  assert.equal(isMockAllowed({ NODE_ENV: 'development' }, 'deterministic'), true);
  assert.equal(isMockAllowed({ NODE_ENV: 'test' }, 'deterministic'), true);
});

test('assertNotProductionMock: throw nếu production + mock', () => {
  assert.throws(
    () => assertNotProductionMock({ NODE_ENV: 'production', HRP_MOCK_MODE: 'deterministic' }),
    /STARTUP_BLOCKED/,
  );
});

test('assertNotProductionMock: KHÔNG throw khi development/test hoặc production+off', () => {
  assert.doesNotThrow(() =>
    assertNotProductionMock({ NODE_ENV: 'development', HRP_MOCK_MODE: 'deterministic' }),
  );
  assert.doesNotThrow(() => assertNotProductionMock({ NODE_ENV: 'production', HRP_MOCK_MODE: 'off' }));
});

test('loadConfig: API app với env synthetic pass', () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_ORGANIZATION_ID: 'org-test-001',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '4001',
  };
  const r = loadConfig({ env, kind: 'api' });
  assert.equal(r.config.appKind, 'api');
  assert.equal(r.config.contractsVersion, '0.0.8-g0.8-fixes');
  assert.equal(r.config.listen.host, '127.0.0.1');
  assert.equal(r.config.listen.port, 4001);
  assert.equal(r.mockAllowed, true);
  assert.equal(r.production, false);
  // CORE/1.2 — receiver defaults
  assert.equal(r.config.receiver.enabled, false);
  assert.equal(r.config.receiver.maxBodyBytes, 262144);
  assert.equal(r.config.receiver.rateLimitPerMinute, 600);
});

test('loadConfig: API app — receiver config từ env', () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'off',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '4001',
    HRP_RECEIVER_ENABLED: 'true',
    HRP_RECEIVER_MAX_BODY_BYTES: '524288',
    HRP_RECEIVER_RATE_LIMIT_PER_MIN: '1200',
  };
  const r = loadConfig({ env, kind: 'api' });
  assert.equal(r.config.receiver.enabled, true);
  assert.equal(r.config.receiver.maxBodyBytes, 524288);
  assert.equal(r.config.receiver.rateLimitPerMinute, 1200);
});

test('loadConfig: API app — receiver rateMapIdleEvictionMs default + env override', () => {
  const r1 = loadConfig({
    env: {
      NODE_ENV: 'development',
      HRP_MOCK_MODE: 'off',
      HRP_LISTEN_HOST: '127.0.0.1',
      HRP_LISTEN_PORT: '4001',
    },
    kind: 'api',
  });
  assert.equal(r1.config.receiver.rateMapIdleEvictionMs, 300_000); // default 5min
  assert.equal(r1.config.receiver.rateMapMaxEntries, 10_000); // default

  const r2 = loadConfig({
    env: {
      NODE_ENV: 'development',
      HRP_MOCK_MODE: 'off',
      HRP_LISTEN_HOST: '127.0.0.1',
      HRP_LISTEN_PORT: '4001',
      HRP_RECEIVER_RATE_MAP_IDLE_MS: '60000',
      HRP_RECEIVER_RATE_MAP_MAX_ENTRIES: '500',
    },
    kind: 'api',
  });
  assert.equal(r2.config.receiver.rateMapIdleEvictionMs, 60_000);
  assert.equal(r2.config.receiver.rateMapMaxEntries, 500);
});

test('loadConfig: API app — receiver maxBodyBytes dưới 1024 bị reject', () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'off',
    HRP_RECEIVER_MAX_BODY_BYTES: '256',
  };
  assert.throws(
    () => loadConfig({ env, kind: 'api' }),
    /Number must be greater than or equal to 1024|too_small/,
  );
});

test('loadConfig: Worker app với env synthetic pass', () => {
  const env = {
    NODE_ENV: 'test',
    HRP_MOCK_MODE: 'deterministic',
    HRP_POLL_INTERVAL_MS: '1000',
    HRP_LEASE_DURATION_MS: '30000',
    HRP_MAX_CONCURRENT_JOBS: '8',
  };
  const r = loadConfig({ env, kind: 'worker' });
  assert.equal(r.config.appKind, 'worker');
  assert.equal(r.config.pollIntervalMs, 1000);
  assert.equal(r.config.maxConcurrentJobs, 8);
});

test('loadConfig: Panel app allowDevTools=false ở production bị reject', () => {
  const env = {
    NODE_ENV: 'production',
    HRP_MOCK_MODE: 'off',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '4003',
    HRP_ALLOW_DEV_TOOLS: 'true',
  };
  assert.throws(
    () => loadConfig({ env, kind: 'panel' }),
    /allowDevTools KHÔNG được true ở production/,
  );
});

test('loadConfig: Forbidden env keys (HRP_DATABASE_URL) bị reject', () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_DATABASE_URL: 'postgres://hrp-core-leaked',
  };
  assert.throws(
    () => loadConfig({ env, kind: 'api' }),
    /HRP_DATABASE_URL/,
  );
});

test('loadConfig: Forbidden HRP_PRISMA_CLIENT_PATH bị reject', () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_PRISMA_CLIENT_PATH: '/hrp/core/prisma/client',
  };
  assert.throws(
    () => loadConfig({ env, kind: 'worker' }),
    /HRP_PRISMA_CLIENT_PATH/,
  );
});

test('loadConfig: contractsVersion pin exact 0.0.8-g0.8-fixes', () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'off',
  };
  const r = loadConfig({ env, kind: 'api' });
  assert.equal(r.config.contractsVersion, '0.0.8-g0.8-fixes');
});

test('loadConfig: forbiddenFound liệt kê key HRP core', () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'off',
    HRP_DATABASE_URL: 'leaked',
    HRP_PRISMA_CLIENT_PATH: 'leaked',
  };
  try {
    loadConfig({ env, kind: 'api' });
    assert.fail('expected throw');
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e));
    assert.ok(msg.includes('HRP_DATABASE_URL'));
    assert.ok(msg.includes('HRP_PRISMA_CLIENT_PATH'));
  }
});
