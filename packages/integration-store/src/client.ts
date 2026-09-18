// src/client.ts — Prisma client factory cho integration store.
//
// T1 cố tình KHÔNG expose Prisma Client trực tiếp tới caller; chỉ
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
 *  - `?schema=integration` strongly recommended; nếu thiếu, Prisma với
 *    multiSchema sẽ vẫn qualify SQL bằng `"integration"."Table"` — tự
 *    work. Nhưng để runtime có default search_path, nên có param.
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
  // CẤM trỏ tới admin databases (postgres/postgres-template). Integration
  // store phải ở database riêng (Owner-created cluster, embedded-postgres test,
  // hoặc production-managed instance).
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
    datasources: {
      db: { url },
    },
    log: opts?.logger ? [opts.logger] : ['error'],
  });
}

// Overload 1: Real Prisma client — tx is PrismaClient tx type
// Overload 2: Mock prisma (B4) — tx is unknown (in-memory store)
export async function runInTxn<T>(
  prisma: PrismaClient | { isMockPrisma: true },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0] | unknown) => Promise<T>,
): Promise<T> {
  if ('isMockPrisma' in prisma) {
    return fn(prisma) as Promise<T>;
  }
  const _real = prisma as PrismaClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return _real.$transaction(fn as any) as Promise<T>;
}

// ── B4: CORE/1.9 Mock Prisma Client ───────────────────────────────────────────

export interface MockCheckpointStore {
  findByOrgRevision(orgId: string, revisionId: string): Promise<unknown | null>;
  findByCheckpointId(checkpointId: string): Promise<{ organizationId: string; intakeRevisionId: string } | null>;
  create(data: unknown): Promise<{ row: unknown; created: boolean }>;
  updateByOrgRevision(orgId: string, revisionId: string, data: unknown): Promise<unknown>;
}

/** B4: In-memory mock Prisma client for CORE/1.9 context-panel.
 *  Returns an object with the minimal Prisma-like interface that
 *  integration-store repository functions expect. The store is
 *  backed by a provided MockCheckpointStore (e.g., ServerSession).
 *
 *  This lets the full integration-store repo functions (createIntakeCheckpoint,
 *  findIntakeCheckpoint, updateIntakeCheckpoint) run without a real database,
 *  using the same code path as production. */
export function createMockPrismaClient(store: MockCheckpointStore): {
  isMockPrisma: true;
  intakeCheckpoint: {
    findUnique(args: { where: { uq_intake_checkpoint_org_revision?: { organizationId: string; intakeRevisionId: string } } }): Promise<unknown | null>;
    create(args: { data: unknown }): Promise<unknown>;
    update(args: { where: { uq_intake_checkpoint_org_revision: { organizationId: string; intakeRevisionId: string } }; data: unknown }): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
  $disconnect(): Promise<void>;
} {
  return {
    isMockPrisma: true as const,
    intakeCheckpoint: {
      async findUnique(args: { where: { uq_intake_checkpoint_org_revision?: { organizationId: string; intakeRevisionId: string } } }) {
        const q = args.where.uq_intake_checkpoint_org_revision;
        if (!q) return null;
        return store.findByOrgRevision(q.organizationId, q.intakeRevisionId);
      },
      async create(args: { data: unknown }) {
        const r = await store.create(args.data);
        return r.row;
      },
      async update(args: { where: { uq_intake_checkpoint_org_revision?: { organizationId: string; intakeRevisionId: string }; checkpointId?: string }; data: unknown }) {
        // Support BOTH update keys: uq_intake_checkpoint_org_revision AND checkpointId.
        const q = args.where.uq_intake_checkpoint_org_revision;
        if (q) {
          return store.updateByOrgRevision(q.organizationId, q.intakeRevisionId, args.data);
        }
        // Fallback: lookup by checkpointId to find org/revision.
        if (args.where.checkpointId && store.findByCheckpointId) {
          const key = await store.findByCheckpointId(args.where.checkpointId);
          if (key) {
            return store.updateByOrgRevision(key.organizationId, key.intakeRevisionId, args.data);
          }
        }
        return null;
      },
    },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(this);
    },
    async $disconnect() {
      // no-op
    },
  };
}
