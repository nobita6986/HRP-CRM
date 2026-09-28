/**
 * apps/integration-api/tests/pg-idempotency-harness.mjs
 *
 * Embedded-postgres harness for the durable idempotency authority
 * integration tests (T1-B N8N/0.3 r1 — RG-02).
 *
 * Applies the integration-store migrations (0001..0006) on a fresh
 * embedded cluster, then exposes a Prisma client + the dedicated
 * PostgresIdempotencyAuthority for the calling test suite.
 *
 * Naming/port strategy:
 *   - SUFFIX = 'idempotency_auth' (overridable via env)
 *   - PORT   = 57000 + stable hash of SUFFIX % 4000
 *   - DATA_DIR = .tmp_pgdata_idem_${SUFFIX}
 */
import EmbeddedPostgres from 'embedded-postgres';
import { createPrismaClient } from '@hrp-engagement/integration-store';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pkg from 'pg';

const SUFFIX =
  process.env['PG_HARNESS_SUFFIX'] ?? `idempotency_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
const PORT =
  57000 + Math.abs([...SUFFIX].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 4000;
const DATA_DIR = `.tmp_pgdata_idem_${SUFFIX}`;
const USER = 'integration';
const PASSWORD = 'synthetic';
const DB = 'integration_store_idem';
const SCHEMA = 'integration';

console.log(`[pg-idempotency-harness] SUFFIX=${SUFFIX} PORT=${PORT} DATA_DIR=${DATA_DIR}`);

export async function start() {
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: false,
    initdbFlags: ['--locale=C', '--encoding=UTF8', '--no-locale'],
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB);

  const url = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB}?schema=${SCHEMA}`;

  const candidates = [
    path.resolve(process.cwd(), 'node_modules/@hrp-engagement/integration-store/prisma/migrations'),
    path.resolve(process.cwd(), '../../../packages/integration-store/prisma/migrations'),
  ];
  let migrationDir;
  for (const c of candidates) {
    try {
      const stat = readFileSync(path.join(c, '0001_init/migration.sql'), 'utf8');
      if (stat) {
        migrationDir = c;
        break;
      }
    } catch {}
  }
  if (!migrationDir) throw new Error('Cannot locate integration-store prisma migrations');

  const migrationFiles = [
    '0001_init/migration.sql',
    '0002_worker_lease_fencing/migration.sql',
    '0003_intake_checkpoint/migration.sql',
    '0004_recovery_action/migration.sql',
    '0005_reconciliation_entry/migration.sql',
    '0006_automation_idempotency_authority/migration.sql',
  ];

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
    await client.query(`SET client_encoding TO 'UTF8'`);
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    for (const migrationFile of migrationFiles) {
      const fullPath = path.resolve(migrationDir, migrationFile);
      try {
        const sql = readFileSync(fullPath, 'utf8');
        await client.query(sql);
      } catch (err) {
        throw new Error(`Failed to apply migration ${migrationFile}: ${err.message}`);
      }
    }
  } finally {
    await client.end();
  }

  const prisma = createPrismaClient({ databaseUrl: url, logger: 'error' });

  return {
    url,
    prisma,
    async stop() {
      try {
        await prisma.$disconnect();
      } catch {}
      try {
        await pg.stop();
      } catch {}
    },
  };
}
