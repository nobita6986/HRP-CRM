#!/usr/bin/env node
/**
 * apps/integration-api/scripts/bootstrap-pg.mjs
 *
 * Shared embedded PostgreSQL bootstrap for V7.9a demo + test schema apply.
 * Lives inside apps/integration-api/ so the `embedded-postgres` module
 * resolves correctly via that package's node_modules (root has none).
 *
 * CORE/1.15 - V7.9a. NOT HRP core DB. Synthetic, ephemeral, integration-store only.
 *
 * Steps:
 *   1. Initialise EmbeddedPostgres once into .tmp_pgdata_v79a/pgdata.
 *   2. Start PG on 127.0.0.1:51000.
 *   3. Create database `integration_store` if missing (idempotent).
 *   4. Apply every Prisma migration SQL under
 *      packages/integration-store/prisma/migrations (each `NNNN_*` subdir
 *      has its own migration.sql file). Runs them in lexical order against
 *      schema=integration. Re-applying is harmless on first run; we treat
 *      `already exists` as already-applied and continue.
 *   5. Log "[pg] ready on 127.0.0.1:51000" when accepting connections.
 *   6. Stay running until SIGINT/SIGTERM (drains gracefully).
 *
 * Working directory contract:
 *   cwd must be apps/integration-api (this script's package root).
 *   The start.ps1 and start.sh scripts set it before invoking node.
 *
 * Usage (manual):
 *   cd apps/integration-api
 *   node scripts/bootstrap-pg.mjs
 */

import EmbeddedPostgres from 'embedded-postgres';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'pg';
const { Client } = pkg;

const PG_PORT = 51000;
const PG_USER = 'integration';
const PG_PASSWORD = 'synthetic';
const PG_DB = 'integration_store';
const PG_SCHEMA = 'integration';
const DATA_DIR = '.tmp_pgdata_v79a/pgdata';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Locate the integration-store migration directory. This file lives in
// apps/integration-api/scripts/, and the migration directory sits in
// packages/integration-store/prisma/migrations/ relative to the repo root.
const REPO_ROOT = path.resolve(__dirname, '../../..');
const MIGRATION_DIR = path.join(REPO_ROOT, 'packages/integration-store/prisma/migrations');

async function applyMigrations() {
  const entries = readdirSync(MIGRATION_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  if (entries.length === 0) {
    console.warn('[pg] no migration directories found at ' + MIGRATION_DIR);
    return;
  }
  const client = new Client({
    host: '127.0.0.1',
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    database: PG_DB,
  });
  await client.connect();
  try {
    await client.query(`SET client_encoding TO UTF8`);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${PG_SCHEMA}`);
    await client.query(`SET search_path TO ${PG_SCHEMA}, public`);
    for (const dir of entries) {
      const sqlPath = path.join(MIGRATION_DIR, dir, 'migration.sql');
      let sql;
      try {
        sql = readFileSync(sqlPath, 'utf8');
      } catch (err) {
        console.warn(`[pg] skip ${dir}: no migration.sql`);
        continue;
      }
      try {
        await client.query(sql);
        console.log(`[pg] applied ${dir}`);
      } catch (err) {
        // Idempotent reapply; many migrations use CREATE TYPE/TABLE without IF NOT EXISTS.
        // Skip if relation already exists.
        const msg = String(err && err.message ? err.message : err);
        if (/already exists/i.test(msg)) {
          console.log(`[pg] ${dir} already applied (skipped)`);
          continue;
        }
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

async function main() {
  // Defensive cleanup: if a previous run left the data dir around (persistent=false
  // still keeps the dir on disk because external postgres-12.x docs say so), wipe it
  // before initialise() so initdb can run cleanly. Fail-soft: missing dir is fine.
  try {
    const { rmSync } = await import('node:fs');
    rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {}

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: false,
    initdbFlags: ['--locale=C', '--encoding=UTF8', '--no-locale'],
  });

  await pg.initialise();
  await pg.start();

  // createDatabase is idempotent: throws if already exists, which we swallow.
  try {
    await pg.createDatabase(PG_DB);
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (!/already exists|duplicate database/i.test(msg)) {
      throw err;
    }
  }

  // Apply Prisma schema migrations (idempotent for first-time wiring).
  await applyMigrations();

  console.log(`[pg] ready on 127.0.0.1:${PG_PORT}`);

  // Drain on SIGINT/SIGTERM so start.* scripts can stop cleanly.
  const shutdown = async (signal) => {
    try {
      console.log(`[pg] received ${signal}, draining...`);
      await pg.stop();
      console.log('[pg] stopped');
      process.exit(0);
    } catch (err) {
      console.error('[pg] stop failed:', err && err.message ? err.message : err);
      process.exit(1);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Keep process alive.
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error('[pg] bootstrap failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});