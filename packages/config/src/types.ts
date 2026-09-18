/**
 * config/src/types.ts — discriminated union of app configs.
 *
 * CORE/1.0:
 *  - RuntimeConfig = shared base (env, mockMode, organizationId, schemaVersion).
 *  - ApiConfig = HTTP API app.
 *  - WorkerConfig = background worker app.
 *  - PanelConfig = UI mock app.
 *
 * Boundary:
 *  - Không có HRP core DSN (HRP_DATABASE_URL chỉ là marker rejected ở loader).
 *  - Không có secret thật. Mock mode tách bạch production env.
 *  - Pin exact contracts version (Gate 0 freeze).
 */
import { z } from 'zod';
import { SCHEMA_VERSION } from '@hrp-engagement/contracts';

/** App kind discriminator. */
export const APP_KINDS = ['api', 'worker', 'panel'] as const;
export type AppKind = (typeof APP_KINDS)[number];
export const AppKindSchema = z.enum(APP_KINDS);

/** NODE_ENV enum — strict 3 giá trị. */
export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];
export const NodeEnvSchema = z.enum(NODE_ENVS);

/** Mock mode literal — phải explicit. */
export const MOCK_MODES = ['off', 'deterministic'] as const;
export type MockMode = (typeof MOCK_MODES)[number];
export const MockModeSchema = z.enum(MOCK_MODES);

/** Listen address (host/port). */
export const ListenAddressSchema = z
  .object({
    host: z.string().min(1).max(253).regex(/^[A-Za-z0-9._-]+$/u, 'host không hợp lệ'),
    port: z.number().int().min(1024).max(65535),
  })
  .strict();
export type ListenAddress = z.infer<typeof ListenAddressSchema>;

/**
 * RuntimeConfigObject — ZodObject base (chưa refine).
 * Dùng để `.extend()` cho ApiConfig/WorkerConfig/PanelConfig.
 */
const RuntimeConfigObject = z
  .object({
    appKind: AppKindSchema,
    nodeEnv: NodeEnvSchema,
    organizationId: z.string().min(1).max(128),
    schemaVersion: z.literal(SCHEMA_VERSION),
    contractsVersion: z.literal('0.0.8-g0.8-fixes'),
    mockMode: MockModeSchema,
    /** ISO datetime — runtime clock for tests (deterministic mock). */
    nowEpochMs: z.number().int().nonnegative().optional(),
  })
  .strict();

/**
 * RuntimeConfigSchema — schema public, với superRefine chặn HRP core DSN.
 */
export const RuntimeConfigSchema = RuntimeConfigObject.superRefine((val, ctx) => {
  if ('HRP_DATABASE_URL' in (val as Record<string, unknown>)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'RuntimeConfig KHÔNG được chứa HRP_DATABASE_URL (HRP core DSN cấm ở app runtime)',
      path: ['HRP_DATABASE_URL'],
    });
  }
});
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

/**
 * ApiConfig — HTTP API app.
 *  - listen: bind address.
 *  - mockRoutes: allowlist route prefix (mock chỉ register mock routes).
 *  - requestTimeoutMs: bounded.
 *  - receiver: CORE/1.2 webhook receiver config (size/rate/enable).
 */
export const ReceiverConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    maxBodyBytes: z.number().int().min(1024).max(10_485_760).default(262_144),
    rateLimitPerMinute: z.number().int().min(1).max(60_000).default(600),
    /** Idle TTL cho rate map entries (ms). 0 = tắt. CORE/1.2 default 5min. */
    rateMapIdleEvictionMs: z.number().int().min(0).max(3_600_000).default(300_000),
    /** Max entries trong rate map; LRU eviction khi vượt. */
    rateMapMaxEntries: z.number().int().min(1).max(100_000).default(10_000),
  })
  .strict();

export const ApiConfigSchema = RuntimeConfigObject.extend({
  appKind: z.literal('api'),
  listen: ListenAddressSchema,
  /** Mock route allowlist (e.g. /health, /mock/integration/*). */
  mockRoutes: z.array(z.string().regex(/^\/[A-Za-z0-9._/-]*$/u)).default([]),
  requestTimeoutMs: z.number().int().min(100).max(60_000).default(15_000),
  receiver: ReceiverConfigSchema.default(() => ({
    enabled: false,
    maxBodyBytes: 262_144,
    rateLimitPerMinute: 600,
    rateMapIdleEvictionMs: 300_000,
    rateMapMaxEntries: 10_000,
  })),
}).strict();
export type ApiConfig = z.infer<typeof ApiConfigSchema>;
export type ReceiverConfig = z.infer<typeof ReceiverConfigSchema>;

/**
 * WorkerConfig — background worker app.
 */
export const WorkerConfigSchema = RuntimeConfigObject.extend({
  appKind: z.literal('worker'),
  pollIntervalMs: z.number().int().min(100).max(60_000).default(5_000),
  leaseDurationMs: z.number().int().min(1_000).max(86_400_000).default(60_000),
  maxConcurrentJobs: z.number().int().min(1).max(64).default(4),
}).strict();
export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;

/**
 * PanelConfigObject — ZodObject cho Panel.
 * PanelConfigSchema thêm superRefine ở dưới.
 */
export const PanelConfigObject = RuntimeConfigObject.extend({
  appKind: z.literal('panel'),
  listen: ListenAddressSchema,
  allowDevTools: z.boolean().default(false),
}).strict();

export const PanelConfigSchema = PanelConfigObject.superRefine((val, ctx) => {
  if (val.nodeEnv === 'production' && val.allowDevTools) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'PanelConfig: allowDevTools KHÔNG được true ở production',
      path: ['allowDevTools'],
    });
  }
});
export type PanelConfig = z.infer<typeof PanelConfigSchema>;
