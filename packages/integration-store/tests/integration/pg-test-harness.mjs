/**
 * packages/integration-store/tests/integration/pg-test-harness.mjs
 *
 * Embedded Postgres harness cho integration tests.
 * Tải Postgres binary (Windows: @embedded-postgres/windows-x64) + extract
 * ra thư mục tạm; init cluster; start ở port 55432 (không xung đột port
 * HRP/dev khác); apply schema từ migration SQL.
 *
 * Lifecycle: `start()` → URL + Prisma client; `stop()` → shutdown + cleanup.
 * Idempotent trong 1 process; tách file tạm `.tmp_pgdata/` ở CWD.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { createPrismaClient } from '../../dist/index.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pkg from 'pg';

// Per-harness DATA_DIR + PORT — cho phép multiple test files chạy song song.
// Caller truyền suffix qua env var `PG_HARNESS_SUFFIX` (mặc định 'main').
//
// Lưu ý: env phải được set TRƯỚC khi import module này ở test file, vì
// `PORT` + `DATA_DIR` là module-level const.
const SUFFIX = process.env['PG_HARNESS_SUFFIX'] ?? 'main';
// Use larger hash space (5000) to avoid port collisions across multiple test files.
const PORT = 55000 + Math.abs([...SUFFIX].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 5000;
const DATA_DIR = `.tmp_pgdata_${SUFFIX}`;
const USER = 'integration';
const PASSWORD = 'synthetic';
const DB = 'integration_store';
const SCHEMA = 'integration';

console.log(`[pg-test-harness] SUFFIX=${SUFFIX} PORT=${PORT} DATA_DIR=${DATA_DIR}`);

/**
 * @returns {{ url: string, prisma: import('@prisma/client').PrismaClient, stop: () => Promise<void> }}
 */
export async function start() {
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB);

  const url = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB}?schema=${SCHEMA}`;
  // Apply all migrations in order (0001_init + 0002_worker_lease_fencing).
  const migrationDir = path.resolve(process.cwd(), 'prisma/migrations');
  const migrationFiles = ['0001_init/migration.sql', '0002_worker_lease_fencing/migration.sql', '0003_intake_checkpoint/migration.sql'];

  const { Client } = pkg;
  const client = new Client({
    host: '127.0.0.1',
    port: PORT,
    user: USER,
    password: PASSWORD,
    database: DB,
  });
  await client.connect();
  try {
    // Set UTF-8 client encoding for migration files containing Vietnamese comments.
    await client.query(`SET client_encoding TO 'UTF8'`);
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    for (const migrationFile of migrationFiles) {
      const fullPath = path.resolve(migrationDir, migrationFile);
      const sql = readFileSync(fullPath, 'utf8');
      await client.query(sql);
    }
  } finally {
    await client.end();
  }

  const prisma = createPrismaClient({ databaseUrl: url, logger: 'error' });

  return {
    url,
    prisma,
    async stop() {
      await prisma.$disconnect();
      await pg.stop();
    },
  };
}
