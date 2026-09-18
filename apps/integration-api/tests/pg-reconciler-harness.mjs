/**
 * apps/integration-api/tests/pg-reconciler-harness.mjs
 *
 * Embedded-postgres harness cho reconciler AC5 integration tests.
 * Adds RecoveryAction migration on top of existing migrations.
 *
 * Lifecycle: `start()` → { url, prisma }; `stop()` → shutdown + cleanup.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { createPrismaClient } from '@hrp-engagement/integration-store';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pkg from 'pg';

const SUFFIX = process.env['PG_HARNESS_SUFFIX'] ?? `reconciler_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
const PORT = 62000 + Math.abs([...SUFFIX].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 3000;
const DATA_DIR = `.tmp_pgdata_reconciler_${SUFFIX}`;
const USER = 'integration';
const PASSWORD = 'synthetic';
const DB = 'integration_store_reconciler';
const SCHEMA = 'integration';

console.log(`[pg-reconciler-harness] SUFFIX=${SUFFIX} PORT=${PORT} DATA_DIR=${DATA_DIR}`);

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

  // Apply integration-store migrations.
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

  // Base migrations + AC5 RecoveryAction migration.
  const migrationFiles = [
    '0001_init/migration.sql',
    '0002_worker_lease_fencing/migration.sql',
    '0003_intake_checkpoint/migration.sql',
    // CORE/1.8 AC5 — RecoveryAction model
    '0004_recovery_action/migration.sql',
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
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    for (const migrationFile of migrationFiles) {
      const fullPath = path.resolve(migrationDir, migrationFile);
      // Read as UTF-8, strip C1 control chars (U+0080-U+009F) that cannot
      // round-trip through embedded PostgreSQL WIN1252 encoding on Windows.
      const buf = readFileSync(fullPath);
      const cleaned = String.prototype.replaceAll.call(
        buf.toString('utf8'),
        /[\u0080-\u009F]/g,
        ' ',
      );
      await client.query(cleaned);
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
