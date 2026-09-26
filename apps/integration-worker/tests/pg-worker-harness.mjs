/**
 * apps/integration-worker/tests/pg-worker-harness.mjs
 *
 * Embedded PostgreSQL harness for integration-worker pipeline tests.
 *
 * Mirrors apps/integration-api/tests/pg-receiver-harness.mjs but with
 * a different SUFFIX so multiple harnesses don't collide.
 *
 * T1-B / C-B02-1, C-B02-2: every run MUST pass an explicit, unique
 * `PG_HARNESS_SUFFIX` (the runner script derives it from a timestamp +
 * entropy). Falling back to a random suffix silently would mask parallel
 * collisions; we fail loud instead so a misconfigured run is visible.
 *
 * T1-B round-4 / R4-01: natural PostgreSQL teardown.
 *
 *   `pg.stop()` returning is NOT sufficient — the postgres child may
 *   not have released the listening socket yet, and the parent test
 *   process can sit alive until the runner's 180 s outer timeout.
 *   We MUST poll the harness port until it is closed before declaring
 *   `harness_stop_done`. If the port is still open after a bounded
 *   budget, throw a teardown error so the test fails fast and the
 *   runner records a hard fail rather than a silent TIMED_OUT.
 *
 *   Single Prisma disconnect ownership is preserved: `stop()` calls
 *   `prisma.$disconnect()` exactly once before `pg.stop()`.
 *
 * Net: port-close poll is built on a bounded `netstat` call (no
 * unbounded blocking), so the harness cannot itself become the
 * cause of an outer timeout.
 */

import EmbeddedPostgres from 'embedded-postgres';
import { createPrismaClient } from '@hrp-engagement/integration-store';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pkg from 'pg';
import { execSync } from 'node:child_process';

// Required by T1-B / C-B02-1. Every call to start() must supply a unique
// suffix so port + data dir never collide across sequential runs.
const SUFFIX = process.env['PG_HARNESS_SUFFIX'];
if (!SUFFIX || typeof SUFFIX !== 'string' || SUFFIX.length < 4) {
  throw new Error(
    '[pg-worker-harness] PG_HARNESS_SUFFIX is required and must be a non-trivial string. ' +
      'Set it explicitly per run (e.g. worker_pipeline_<ts>_<rand>) so port + data dir are isolated.',
  );
}
const PORT = 53000 + (Math.abs([...SUFFIX].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 5000);
const DATA_DIR = `.tmp_pgdata_worker_${SUFFIX}`;
const USER = 'integration';
const PASSWORD = 'synthetic';
const DB = 'integration_store_worker';
const SCHEMA = 'integration';

// T1-B round-4 / R4-01 teardown budget. After pg.stop() returns, the
// postgres child has up to TEARDOWN_PORT_POLL_TIMEOUT_MS to release
// PORT. We poll every TEARDOWN_PORT_POLL_INTERVAL_MS. If still listening
// when the budget expires, stop() throws.
const TEARDOWN_PORT_POLL_INTERVAL_MS = 250;
const TEARDOWN_PORT_POLL_TIMEOUT_MS = 15_000;
// Bounded netstat for the port-close probe. If netstat hangs or is
// unavailable, the probe returns `closed: null` and stop() throws.
const NETSTAT_TIMEOUT_MS = 5_000;

console.log(`[pg-worker-harness] SUFFIX=${SUFFIX} PORT=${PORT} DATA_DIR=${DATA_DIR}`);

/**
 * Probe whether `port` has a LISTENING socket on 127.0.0.1.
 *
 * Bounded (NETSTAT_TIMEOUT_MS). On timeout / spawn error / unparseable
 * output returns { closed: null } — the caller treats that as "unknown"
 * and throws (R4-01 fail-closed teardown).
 */
function isPortListening(port) {
  const startedAt = Date.now();
  let out = '';
  try {
    out = execSync('netstat -ano -p tcp', {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: NETSTAT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    }).toString('utf8');
  } catch (e) {
    return {
      closed: null,
      durationMs: Date.now() - startedAt,
      errorCategory: classifyExecError(e),
      note: 'netstat probe failed: ' + ((e && e.message) || String(e)),
    };
  }
  const durationMs = Date.now() - startedAt;
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/\s(127\.0\.0\.1|\[::\]):(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
    if (m && Number(m[2]) === port) {
      return {
        closed: false,
        ownerPid: Number(m[3]),
        address: m[1],
        durationMs,
      };
    }
  }
  return { closed: true, durationMs };
}

function classifyExecError(e) {
  if (!e) return 'unknown';
  const msg = (e.message || String(e)).toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
  if (msg.includes('enoent') || msg.includes('not found')) return 'missing_tool';
  if (msg.includes('eperm') || msg.includes('eacces') || msg.includes('access')) {
    return 'access_denied';
  }
  return 'spawn_error';
}

async function waitForPortClosed(port) {
  const deadline = Date.now() + TEARDOWN_PORT_POLL_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    last = isPortListening(port);
    if (last.closed === true) return last;
    if (last.closed === null) {
      // Unknown — bail out and let stop() throw.
      return last;
    }
    await new Promise((r) => setTimeout(r, TEARDOWN_PORT_POLL_INTERVAL_MS));
  }
  return last;
}

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
      const teardownStartedAt = Date.now();
      // Single ownership of prisma disconnect (C-B02-2 invariant).
      try {
        await prisma.$disconnect();
      } catch (e) {
        throw new Error(
          '[pg-worker-harness] prisma.$disconnect failed: ' +
            ((e && e.message) || String(e)),
        );
      }
      // Now stop postgres. pg.stop() internally runs `pg_ctl stop` and
      // waits, but the listening socket may still be held by a child
      // server process. We poll after pg.stop() returns to confirm the
      // port is gone.
      await pg.stop();
      const probe = await waitForPortClosed(PORT);
      if (probe.closed === true) {
        const elapsedMs = Date.now() - teardownStartedAt;
        console.log(
          JSON.stringify({
            kind: 'harness_stop_done',
            port: PORT,
            elapsedMs,
            probeDurationMs: probe.durationMs,
          }),
        );
        return;
      }
      const elapsedMs = Date.now() - teardownStartedAt;
      const detail = {
        kind: 'harness_stop_failed',
        port: PORT,
        elapsedMs,
        probe,
        reason:
          probe.closed === null
            ? 'port-close probe unavailable'
            : 'port still listening after pg.stop()',
      };
      console.log(JSON.stringify(detail));
      throw new Error(
        '[pg-worker-harness] stop failed: ' +
          detail.reason +
          ' (port=' +
          PORT +
          ', ownerPid=' +
          (probe.ownerPid || 'unknown') +
          ')',
      );
    },
  };
}
