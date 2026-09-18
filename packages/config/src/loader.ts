/**
 * config/src/loader.ts — load + validate RuntimeConfig/ApiConfig/WorkerConfig/PanelConfig.
 *
 * CORE/1.0 boundary guards:
 *  - `loadConfig` đọc env an toàn, không crash process; trả về discriminated
 *    union dựa trên `appKind`.
 *  - `assertNotProductionMock` chặn startup nếu mock mode ở production.
 *  - Loader REJECT các env var HRP core (HRP_DATABASE_URL, HRP_PRISMA_CLIENT_PATH)
 *    ngay từ input — không cho phép chúng xuất hiện trong RuntimeConfig.
 */
import { z } from 'zod';
import {
  ApiConfigSchema,
  PanelConfigObject,
  PanelConfigSchema,
  RuntimeConfigSchema,
  WorkerConfigSchema,
  type ApiConfig,
  type AppKind,
  type PanelConfig,
  type WorkerConfig,
} from './types.js';
import { isMockAllowed, isProductionEnv, parseMockMode, parseNodeEnv } from './mock.js';

/** Forbidden env keys ở app runtime (HRP core markers). */
export const FORBIDDEN_ENV_KEYS = [
  'HRP_DATABASE_URL',
  'HRP_PRISMA_CLIENT_PATH',
  'HRP_CORE_DSN',
  'HRP_CANONICAL_DSN',
  'HRP_PROVIDER_API_KEY',
  'HRP_AI_MODEL_ENDPOINT',
] as const;

/**
 * ConfigSchema — full schema cho mọi app kind.
 * Discriminated union theo appKind.
 * Variants là ZodObject (không ZodEffects) để discriminatedUnion hợp lệ;
 * Panel refine riêng vì cần logic đặc thù.
 */
export const ConfigSchema = z.discriminatedUnion('appKind', [
  ApiConfigSchema,
  WorkerConfigSchema,
  PanelConfigObject,
]);
export type Config = ApiConfig | WorkerConfig | PanelConfig;

export interface LoadConfigOptions {
  env: Record<string, string | undefined>;
  kind: AppKind;
}

export interface LoadConfigResult {
  config: Config;
  /** Mock được phép ở env hiện tại. */
  mockAllowed: boolean;
  /** Production env hay không. */
  production: boolean;
  /** Forbidden env keys đã tìm thấy (nếu có). */
  forbiddenFound: string[];
}

/**
 * Load config từ env.
 *
 * - Throw nếu có forbidden env key (HRP core markers).
 * - Throw nếu env không khớp schema.
 * - KHÔNG throw nếu mock ở production (đó là job của `assertNotProductionMock`).
 */
export function loadConfig(options: LoadConfigOptions): LoadConfigResult {
  const { env, kind } = options;

  // 1. Check forbidden keys (HRP core markers).
  const forbiddenFound = FORBIDDEN_ENV_KEYS.filter((k) => env[k] !== undefined && env[k] !== '');
  if (forbiddenFound.length > 0) {
    throw new Error(
      `App config chứa forbidden env keys (HRP core markers): ${forbiddenFound.join(', ')}. ` +
        'CORE/1.0 cấm HRP core DSN/Prisma client trong apps/integration-*.',
    );
  }

  // 2. Read base fields.
  const nodeEnv = parseNodeEnv(env['NODE_ENV']);
  const mockMode = parseMockMode(env['HRP_MOCK_MODE']);
  const organizationId = env['HRP_ORGANIZATION_ID'] ?? 'org-synthetic-001';
  const nowEpochMs = env['HRP_NOW_EPOCH_MS']
    ? Number.parseInt(env['HRP_NOW_EPOCH_MS'], 10)
    : undefined;

  const baseInput = {
    appKind: kind,
    nodeEnv,
    organizationId,
    schemaVersion: '1' as const,
    contractsVersion: '0.0.8-g0.8-fixes' as const,
    mockMode,
    ...(nowEpochMs !== undefined ? { nowEpochMs } : {}),
  };

  // 3. Discriminate by appKind.
  let parsed: Config;
  if (kind === 'api') {
    const listen = parseListen(env);
    parsed = ApiConfigSchema.parse({
      ...baseInput,
      appKind: 'api',
      listen,
      mockRoutes: parseMockRoutes(env),
      requestTimeoutMs: parseIntDefault(env['HRP_REQUEST_TIMEOUT_MS'], 15_000),
      receiver: parseReceiverConfig(env),
    });
  } else if (kind === 'worker') {
    parsed = WorkerConfigSchema.parse({
      ...baseInput,
      appKind: 'worker',
      pollIntervalMs: parseIntDefault(env['HRP_POLL_INTERVAL_MS'], 5_000),
      leaseDurationMs: parseIntDefault(env['HRP_LEASE_DURATION_MS'], 60_000),
      maxConcurrentJobs: parseIntDefault(env['HRP_MAX_CONCURRENT_JOBS'], 4),
    });
  } else {
    const listen = parseListen(env);
    // Panel: dùng PanelConfigSchema (đã refine) để chặn allowDevTools ở production.
    parsed = PanelConfigSchema.parse({
      ...baseInput,
      appKind: 'panel',
      listen,
      allowDevTools: env['HRP_ALLOW_DEV_TOOLS'] === 'true',
    });
  }

  // Validate against discriminated union to ensure shape correctness.
  // (Skip RuntimeConfigSchema.parse because discriminated union already enforces.)
  ConfigSchema.parse(parsed);

  return {
    config: parsed,
    mockAllowed: isMockAllowed(env, mockMode),
    production: isProductionEnv(env),
    forbiddenFound,
  };
}

function parseListen(env: Record<string, string | undefined>) {
  return {
    host: env['HRP_LISTEN_HOST'] ?? '127.0.0.1',
    port: parseIntDefault(env['HRP_LISTEN_PORT'], 3000),
  };
}

function parseMockRoutes(env: Record<string, string | undefined>): string[] {
  const raw = env['HRP_MOCK_ROUTES'];
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseIntDefault(raw: string | undefined, def: number): number {
  if (raw === undefined) return def;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : def;
}

function parseReceiverConfig(env: Record<string, string | undefined>): {
  enabled: boolean;
  maxBodyBytes: number;
  rateLimitPerMinute: number;
  rateMapIdleEvictionMs: number;
  rateMapMaxEntries: number;
} {
  return {
    enabled: env['HRP_RECEIVER_ENABLED'] === 'true',
    maxBodyBytes: parseIntDefault(env['HRP_RECEIVER_MAX_BODY_BYTES'], 262_144),
    rateLimitPerMinute: parseIntDefault(env['HRP_RECEIVER_RATE_LIMIT_PER_MIN'], 600),
    rateMapIdleEvictionMs: parseIntDefault(env['HRP_RECEIVER_RATE_MAP_IDLE_MS'], 300_000),
    rateMapMaxEntries: parseIntDefault(env['HRP_RECEIVER_RATE_MAP_MAX_ENTRIES'], 10_000),
  };
}

/**
 * Assert app KHÔNG chạy mock ở production.
 * Throw nếu production + mockMode !== 'off'.
 *
 * Gọi trước khi start app — đây là startup guard bắt buộc theo
 * CORE/1.0 AC: "startup chặn mock bị gắn nhãn production".
 */
export function assertNotProductionMock(env: Record<string, string | undefined>): void {
  const production = isProductionEnv(env);
  const mockMode = parseMockMode(env['HRP_MOCK_MODE']);
  if (production && mockMode !== 'off') {
    throw new Error(
      `STARTUP_BLOCKED: HRP_MOCK_MODE=${mockMode} không được phép ở NODE_ENV=production. ` +
        'CORE/1.0 AC: startup chặn mock bị gắn nhãn production. ' +
        'Set HRP_MOCK_MODE=off hoặc NODE_ENV !== production.',
    );
  }
}
