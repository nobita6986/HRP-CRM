/**
 * apps/integration-api/tests/pg-orchestrator-harness.mjs
 *
 * Embedded-postgres harness cho intake orchestrator PG-E2E tests (CORE/1.6).
 * Tách riêng port + data dir để không xung đột với pg-receiver-harness.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { createPrismaClient } from '@hrp-engagement/integration-store';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pkg from 'pg';

const SUFFIX = process.env['PG_HARNESS_SUFFIX'] ?? `orchestrator_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
const PORT = 61000 + Math.abs([...SUFFIX].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 4000;
const DATA_DIR = `.tmp_pgdata_orch_${SUFFIX}`;
const USER = 'integration';
const PASSWORD = 'synthetic';
const DB = 'integration_store_orch';
const SCHEMA = 'integration';

console.log(`[pg-orchestrator-harness] SUFFIX=${SUFFIX} PORT=${PORT} DATA_DIR=${DATA_DIR}`);

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
  const migrationFiles = [
    '0001_init/migration.sql',
    '0002_worker_lease_fencing/migration.sql',
    '0003_intake_checkpoint/migration.sql',
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
