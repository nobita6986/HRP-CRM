/**
 * apps/integration-api/tests/pg-reconcile-harness.mjs
 *
 * Embedded-postgres harness for outbox-reconcile test (CORE/1.8 AC4).
 * Pattern matches pg-orchestrator-harness.mjs (CORE/1.6).
 */
import EmbeddedPostgres from 'embedded-postgres';
import { createPrismaClient } from '@hrp-engagement/integration-store';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pkg from 'pg';

const SUFFIX = process.env['PG_HARNESS_SUFFIX'] ?? `reconcile_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
const PORT = 63000 + (Math.abs([...SUFFIX].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 1500);
const DATA_DIR = `.tmp_pgdata_reconcile_${SUFFIX}`;
const USER = 'integration';
const PASSWORD = 'synthetic';
const DB = 'integration_store_reconcile';
const SCHEMA = 'integration';

console.log(`[pg-reconcile-harness] SUFFIX=${SUFFIX} PORT=${PORT} DATA_DIR=${DATA_DIR}`);

export async function start() {
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: false,
    // CORE/1.15: pin initdb to portable C-locale (Windows portable).
    initdbFlags: ['--locale=C', '--encoding=UTF8', '--no-locale'],
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB);

  const url = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB}?schema=${SCHEMA}&connection_limit=1`;

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
  ];

  const { Client } = pkg;
  const client = new Client({ connectionString: url });
  await client.connect();
  for (const mf of migrationFiles) {
    const fp = path.join(migrationDir, mf);
    try {
      const sql = readFileSync(fp, 'utf8');
      // Strip control chars (Windows WIN1252 PG can't handle U+0080-U+009F)
      const safe = sql.replace(/[\u0080-\u009F]/g, '');
      await client.query(safe);
    } catch (e) {
      // Migration may not exist (e.g. 0004) — skip
    }
  }
  await client.end();

  const prisma = createPrismaClient({ databaseUrl: url });

  return {
    prisma,
    stop: async () => {
      await prisma.$disconnect();
      try {
        await pg.stop();
      } catch {}
    },
    connectionUrl: url,
  };
}
