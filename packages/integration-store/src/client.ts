// src/client.ts — Prisma client factory cho integration store.
//
// T1 cố ý KHÔNG expose Prisma Client trực tiếp tới caller; chỉ
// repository functions. Caller (CORE/1.4 worker, CORE/1.5 normalize, etc.)
// chỉ gọi repo API.
//
// Connection URL: read từ env `DATABASE_URL`. Đảm bảo KHÔNG trỏ tới
// HRP core DSN (gate enforcement ở assertSafeDatabaseUrl).

import { PrismaClient } from '@prisma/client';
import { storeError } from './errors.js';

/**
 * Assert Database URL an toàn.
 *  - Phải trỏ tới database riêng (createDatabase) — KHÔNG phải `postgres` admin db.
 *  - KHÔNG được trỏ tới user/role/schema của HRP core (`hrp_core`).
 *  - `?schema=integration` strongly recommended.
 */
export function assertSafeDatabaseUrl(url: string): void {
  if (!url) {
    throw storeError('VALIDATION_ERROR', 'DATABASE_URL trống', { target: 'DATABASE_URL' });
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw storeError('VALIDATION_ERROR', 'DATABASE_URL không phải URL hợp lệ', { target: 'DATABASE_URL' });
  }
  if (!/^postgres(ql)?:$/i.test(parsed.protocol)) {
    throw storeError('VALIDATION_ERROR', 'DATABASE_URL phải là postgres://', { target: 'DATABASE_URL' });
  }
  if (/hrp_core/iu.test(url)) {
    throw storeError(
      'VALIDATION_ERROR',
      'DATABASE_URL không được trỏ tới HRP core (schema/role hrp_core)',
      { target: 'DATABASE_URL' },
    );
  }
  if (/^postgres$/i.test(parsed.pathname.replace(/^\//u, ''))) {
    throw storeError(
      'VALIDATION_ERROR',
      'DATABASE_URL không được trỏ vào admin database "postgres"',
      { target: 'DATABASE_URL' },
    );
  }
}

export interface CreatePrismaOptions {
  databaseUrl?: string;
  logger?: 'info' | 'warn' | 'error';
}

export function createPrismaClient(opts?: CreatePrismaOptions): PrismaClient {
  const url = opts?.databaseUrl ?? process.env['DATABASE_URL'];
  if (!url) {
    throw storeError('VALIDATION_ERROR', 'DATABASE_URL chưa được set');
  }
  assertSafeDatabaseUrl(url);
  return new PrismaClient({
    datasources: { db: { url } },
    log: opts?.logger ? [opts.logger] : ['error'],
  });
}

// ── Transaction types ─────────────────────────────────────────────────────────

/**
 * The type Prisma passes as `tx` to $transaction callbacks.
 * Extracted once here so callers don't write the long
 * `Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]` chain.
 */
export type PrismaTransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

// ── Mock Prisma Client ────────────────────────────────────────────────────────

export interface MockCheckpointStore {
  findByOrgRevision(orgId: string, revisionId: string): Promise<unknown | null>;
  findByCheckpointId(checkpointId: string): Promise<{ organizationId: string; intakeRevisionId: string } | null>;
  create(data: unknown): Promise<{ row: unknown; created: boolean }>;
  updateByOrgRevision(orgId: string, revisionId: string, data: unknown): Promise<unknown>;
}

/**
 * MockPrismaClient — minimal Prisma-like surface used by integration-store
 * repository functions when running against an in-memory store (B4 / CORE-1.9).
 *
 * The interface lists ONLY the fields actually called by repository code:
 * `intakeCheckpoint.findUnique/create/update` and `$transaction`.
 */
export interface MockPrismaClient {
  readonly isMockPrisma: true;
  readonly intakeCheckpoint: {
    findUnique(args: {
      where: {
        uq_intake_checkpoint_org_revision?: {
          organizationId: string;
          intakeRevisionId: string;
        };
      };
    }): Promise<unknown | null>;
    create(args: { data: unknown }): Promise<unknown>;
    update(args: {
      where: {
        uq_intake_checkpoint_org_revision?: {
          organizationId: string;
          intakeRevisionId: string;
        };
        checkpointId?: string;
      };
      data: unknown;
    }): Promise<unknown>;
  };
  readonly $transaction: <T>(fn: (tx: MockPrismaClient) => Promise<T>) => Promise<T>;
  readonly $disconnect: () => Promise<void>;
}

/** B4: In-memory mock Prisma client for CORE-1.9 context-panel. */
export function createMockPrismaClient(store: MockCheckpointStore): MockPrismaClient {
  const mock: MockPrismaClient = {
    isMockPrisma: true as const,
    intakeCheckpoint: {
      async findUnique(args) {
        const q = args.where.uq_intake_checkpoint_org_revision;
        if (!q) return null;
        return store.findByOrgRevision(q.organizationId, q.intakeRevisionId);
      },
      async create(args) {
        return (await store.create(args.data)).row;
      },
      async update(args) {
        const q = args.where.uq_intake_checkpoint_org_revision;
        if (q) {
          return store.updateByOrgRevision(q.organizationId, q.intakeRevisionId, args.data);
        }
        if (args.where.checkpointId && store.findByCheckpointId) {
          const key = await store.findByCheckpointId(args.where.checkpointId);
          if (key) {
            return store.updateByOrgRevision(key.organizationId, key.intakeRevisionId, args.data);
          }
        }
        return null;
      },
    },
    $transaction: async <T>(fn: (tx: MockPrismaClient) => Promise<T>) => fn(mock),
    $disconnect: async () => { /* no-op */ },
  };
  return mock;
}

// ── runInTxn ─────────────────────────────────────────────────────────

/**
 * runInTxn — run `fn` inside a transaction.
 *
 * Single function: forwards to `prisma.$transaction(fn)`. Inside `fn`,
 * `tx` is typed as `PrismaTransactionClient` — the full Prisma model surface
 * (all model CRUD, `$queryRaw`, etc.).
 *
 * Repository functions always use the real path — their parameters are
 * `PrismaClient` only. The `MockPrismaClient` type exists for the B4 /
 * CORE-1.9 context-panel mock path, which does NOT use `runInTxn` directly;
 * instead it implements the minimal mock surface that repo functions need when
 * called through the mock.
 *
 * The `as` cast on `fn` is at the I/O boundary: Prisma itself guarantees the
 * callback receives the correctly typed `tx`. No `any`/`unknown`/`ts-ignore` at
 * any call site.
 */
export function runInTxn<T>(
  prisma: PrismaClient,
  fn: (tx: PrismaTransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(fn as (tx: PrismaTransactionClient) => Promise<T>);
}
