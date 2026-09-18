/**
 * ports.ts — Application ports contracts (Gate 0 / 0.3h).
 *
 * Nguồn: Master-Plan.V2.6.md §7.1 + Backlog Gate0 §0.3h +
 * hrp-connector.md v1.1.
 *
 * Trọng tâm:
 *  - Các port runtime (Worker, Scheduler, Storage, Secret, Queue,
 *    Object, Chatwoot, Zalo OA) bind shape qua contract.
 *  - Port KHÔNG import Prisma / Next.js runtime; chỉ contract
 *    TypeScript interface marker (implementation do runtime
 *    HRP-owned cung cấp).
 *  - Hỗ trợ deterministic clock + fault injection qua option (xem
 *    gateway.ts NowProvider/FaultHooks) — đồng bộ test strategy.
 *  - Storage KHÔNG cùng DB transaction với canonical command (xem
 *    connector §8): upload → evidence ready → claim canonical;
 *    partial failure retry giữ evidenceId.
 */
import { z } from 'zod';
import { SCHEMA_VERSION } from '../enums.js';
import {
  CanonicalIdSchema,
  OrganizationIdSchema,
  ProviderNameSchema,
  SchemaVersionSchema,
} from '../primitives.js';

/* ───────────────────────────────────────────────────────────────────────────
 * WorkerPort — background job port.
 * ─────────────────────────────────────────────────────────────────────────── */
export const WorkerPortEnqueueRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    /** Worker name allowlist. */
    workerName: z.string().min(1).max(128),
    /** Job payload (worker-specific). */
    payload: z.unknown(),
    /** Optional: idempotency key retry. */
    idempotencyKey: z.string().min(8).max(256).optional(),
    /** Optional: delay (seconds) — runtime clock-based. */
    delaySec: z.number().int().nonnegative().max(86_400).optional(),
  })
  .strict();

export const WorkerPortEnqueueResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    jobId: z.string().min(1).max(128),
    enqueuedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type WorkerPortEnqueueResult = z.infer<
  typeof WorkerPortEnqueueResultSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * SchedulerPort — cron/schedule port.
 * ─────────────────────────────────────────────────────────────────────────── */
export const SchedulerPortEnqueueRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    /** Cron expression / delay config — runtime validate. */
    scheduleSpec: z.string().min(1).max(512),
    /** Job payload (worker-specific). */
    payload: z.unknown(),
    /** Marker: nếu có NextAction reference thì gắn. */
    nextActionId: CanonicalIdSchema.optional(),
    /** Marker: do retry gắn revision/occurrenceId. */
    occurrenceKey: z.string().min(1).max(128).optional(),
    /** Timezone literal — runtime resolve theo business clock. */
    timezone: z.literal('Asia/Ho_Chi_Minh'),
  })
  .strict();

export const SchedulerPortEnqueueResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    scheduleId: z.string().min(1).max(128),
    nextFireAt: z.string().datetime({ offset: true }),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * QueuePort — durable queue port.
 * ─────────────────────────────────────────────────────────────────────────── */
export const QueuePortEnqueueRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    queueName: z.string().min(1).max(128),
    payload: z.unknown(),
    /** Marker: lease + fencing cho retry. */
    leaseToken: z.string().min(8).max(256).optional(),
    /** Optional: max attempts before DLQ. */
    maxAttempts: z.number().int().positive().max(20).default(5),
  })
  .strict();

export const QueuePortEnqueueResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    queueItemId: z.string().min(1).max(128),
    enqueuedAt: z.string().datetime({ offset: true }),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * SecretProviderPort — secret lookup port.
 *
 * SecretProvider lấy secret theo connection và capability;
 * KHÔNG expose value cho UI. Schema bind opaque reference
 * (`secretHandle`) runtime resolve; tier đã verify mới trả.
 * ─────────────────────────────────────────────────────────────────────────── */
export const SecretPortAccessLevelSchema = z.enum([
  'PRIVILEGED_HRP_GATE',
  'INTEGRATION_BOUND',
  'REVIEWER_BOUND',
]);

export const SecretPortGetRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    /** Connection id xác thực. */
    provider: ProviderNameSchema.optional(),
    connectionId: z.string().min(1).max(128).optional(),
    /** Capability đòi secret. */
    capability: z.string().min(1).max(128),
    /** Server-set tier caller có để dùng secret. */
    accessorTier: SecretPortAccessLevelSchema,
  })
  .strict();

export const SecretPortHandleSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    secretHandle: z.string().min(8).max(256),
    /** TTL seconds; runtime revoke khi hết hạn. */
    expiresInSec: z.number().int().positive().max(3600),
  })
  .strict();
export type SecretPortHandle = z.infer<typeof SecretPortHandleSchema>;

/**
 * Schema forbid các operation lộ raw secret value:
 *  - KHÔNG có `secretValue: string`.
 *  - AccessorTier chỉ PRIVILEGED_HRP_GATE / INTEGRATION_BOUND /
 *    REVIEWER_BOUND.
 */
export const SECRET_PORT_FORBIDDEN_FIELDS = Object.freeze([
  'secretValue',
  'rawSecret',
  'plaintextSecret',
  'passwordRaw',
  'apiKeyRaw',
  'tokenRaw',
] as const);

/* ───────────────────────────────────────────────────────────────────────────
 * ObjectStoragePort — encrypted/private upload/read.
 *
 * Storage KHÔNG cùng DB transaction với canonical command (Master
 * §11 + connector §8): upload → evidence ready → claim canonical;
 * partial failure retry giữ evidenceId.
 *
 * Connect cho evidence service nội địa (CCCD): chỉ opaque handle,
 * KHÔNG public URL expose.
 * ─────────────────────────────────────────────────────────────────────────── */
export const ObjectStorageUploadRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    /** Evidence kind (CCCD_FRONT/CCCD_BACK, mở rộng sau). */
    kind: z.enum(['CCCD_FRONT', 'CCCD_BACK']),
    /** Encrypted bytes payload. */
    bytes: z.instanceof(Uint8Array),
    /** Opaque metadata runtime set. */
    owner: z.string().min(1).max(128),
    /** Marker: residency VN (default true cho CCCD). */
    vnResidency: z.boolean(),
  })
  .strict();

export const ObjectStorageHandleSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    /** Opaque storage handle (server-runtime). */
    storageHandle: z.string().min(8).max(256),
    /** SHA-256 hex digest của bytes. */
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/u, 'digest phải SHA-256 hex 64 ký tự'),
    /** Server-set timestamp. */
    storedAt: z.string().datetime({ offset: true }),
    /** Marker: quarantine (chờ scan). */
    quarantined: z.boolean(),
  })
  .strict();
export type ObjectStorageHandle = z.infer<typeof ObjectStorageHandleSchema>;

/**
 * ObjectStorageReadRequest — chỉ return signed URL TTL ngắn
 * (Master §11: "Gateway cấp signed URL TTL ngắn sau auth").
 */
export const ObjectStorageReadRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    storageHandle: z.string().min(8).max(256),
    /** Authenticated principal request (audit). */
    accessor: z.string().min(1).max(256),
    /** TTL — runtime bind ≤ 60 sec cho CCCD. */
    ttlSec: z.number().int().positive().max(60),
  })
  .strict();

export const ObjectStorageReadResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    storageHandle: z.string().min(8).max(256),
    /** Signed URL TTL ngắn. */
    signedUrl: z.string().url(),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * Ports forbidden imports (runtime HRP gate enforce).
 *
 * Marker audit: ports KHÔNG import Prisma / Next.js runtime.
 * Schema không thể enforce import constraint; runtime HRP gate qua
 * code review + lint + ESLint rule.
 * ─────────────────────────────────────────────────────────────────────────── */
export const PORTS_FORBIDDEN_IMPORTS = Object.freeze([
  '@prisma/client',
  'next',
  'next/server',
  'next/headers',
  'next/router',
  'react-dom/server',
  'react',
  'fs', // pure node fs; runtime gate quyết nếu cần evidence service.
  'pg',
  'mysql2',
  'drizzle-orm',
] as const);

export { SCHEMA_VERSION };
