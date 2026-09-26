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
import {
  auditLeftovers,
  boundedWaitPortClosed,
  findEmbeddedPgCtl,
  runPgCtlStop,
  runTaskkill,
  tcpProbeConnect,
  validateWorkerDataDir,
} from '../../../scripts/b02-cleanup.mjs';

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
// PORT. The R5 helper `boundedWaitPortClosed` controls the poll cadence.
// R5-04: bounded pg_ctl stop budget.
const TEARDOWN_PORT_POLL_TIMEOUT_MS = 15_000;
const PG_CTL_TIMEOUT_MS = 8_000;
// R5-02: gap between audit1 and audit2 (kept short — both must be
// closed=true within this gap for PASS).
const AUDIT_GAP_MS = 500;

console.log(`[pg-worker-harness] SUFFIX=${SUFFIX} PORT=${PORT} DATA_DIR=${DATA_DIR}`);

// T1-B round-5: harness.stop() relies on the R5 helpers imported from
// scripts/b02-cleanup.mjs (boundedWaitPortClosed, auditLeftovers,
// tcpProbeConnect, runTaskkill, validateWorkerDataDir,
// findEmbeddedPgCtl, runPgCtlStop). The in-process polling,
// PID-refresh, and pg_ctl fallback are all inlined below.

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
      const teardownSteps = [];
      function recordStep(name, extra) {
        const entry = { atMs: Date.now() - teardownStartedAt, step: name };
        if (extra && typeof extra === 'object') Object.assign(entry, extra);
        teardownSteps.push(entry);
      }
      // Single ownership of prisma disconnect (C-B02-2 invariant).
      try {
        await prisma.$disconnect();
        recordStep('prisma_disconnected', { ok: true });
      } catch (e) {
        recordStep('prisma_disconnected', { ok: false, error: (e && e.message) || String(e) });
        // Continue: we still want to attempt pg.stop and port cleanup
        // even if the Prisma disconnect path itself errored.
      }
      // Now stop postgres. pg.stop() internally runs `pg_ctl stop` and
      // waits, but the listening socket may still be held by a child
      // server process that reparented away from the postmaster. T1-B
      // round-5: bounded polling + PID refresh + pg_ctl fallback.
      let pgStopError = null;
      try {
        await pg.stop();
        recordStep('pg_stop_returned', { ok: true });
      } catch (e) {
        pgStopError = e;
        recordStep('pg_stop_returned', { ok: false, error: (e && e.message) || String(e) });
      }

      // R5-02: bounded port-close polling (≤15 s). On Windows, the
      // embedded-postgres' postmaster can detach and reparent to PID 1
      // (or stay alive under its own handle); the listening socket may
      // survive `pg.stop()` for several seconds. Poll until both
      // netstat and the TCP probe confirm the port is gone.
      const bounded = await boundedWaitPortClosed(PORT, TEARDOWN_PORT_POLL_TIMEOUT_MS);
      recordStep('bounded_wait_port_closed', {
        ok: bounded.ok,
        iterations: bounded.iterations,
        reason: bounded.reason,
      });

      let ownerPid = bounded.finalAudit ? bounded.finalAudit.ownerPid : null;
      let ownerAddress = bounded.finalAudit ? bounded.finalAudit.address : null;

      // R5-03: PID refresh + retry. If the port STILL has a listener,
      // refresh the owner PID from netstat and re-taskkill bounded.
      // We never declare "already gone" on a stale PID; the TCP probe
      // is the source of truth.
      if (bounded.ok !== true) {
        for (let refreshIter = 0; refreshIter < 2; refreshIter += 1) {
          const freshAudit = auditLeftovers(PORT);
          if (freshAudit.closed === true) {
            const probe = await tcpProbeConnect(PORT);
            if (probe.connectable === false) {
              recordStep('pid_refresh_break', { iter: refreshIter, reason: 'closed_after_refresh', audit: freshAudit, tcp: probe });
              ownerPid = null;
              break;
            }
          }
          if (freshAudit.available === false || !freshAudit.ownerPid) {
            recordStep('pid_refresh_break', { iter: refreshIter, reason: 'no_distinct_owner', audit: freshAudit });
            break;
          }
          const freshPid = freshAudit.ownerPid;
          const tk = runTaskkill(['/PID', String(freshPid), '/T', '/F']);
          recordStep('pid_refresh_kill', { iter: refreshIter, pid: freshPid, ...tk });
          ownerPid = freshPid;
          ownerAddress = freshAudit.address;
          // Give the OS a moment to release the socket.
          const reWait = await boundedWaitPortClosed(PORT, 3_000);
          recordStep('pid_refresh_recheck', {
            iter: refreshIter,
            ok: reWait.ok,
            iterations: reWait.iterations,
          });
          if (reWait.ok) break;
        }
      }

      // Final two-consecutive-audit confirmation (R5-02 + R5-03):
      // audit1 AND audit2 (with AUDIT_GAP_MS between) AND a final
      // TCP probe that confirms the OS no longer accepts a SYN.
      const audit1 = auditLeftovers(PORT);
      recordStep('audit1', audit1);
      const interGapAt = Date.now();
      await new Promise((r) => setTimeout(r, AUDIT_GAP_MS));
      const audit2 = auditLeftovers(PORT);
      recordStep('audit2', { interAuditGapMs: Date.now() - interGapAt, ...audit2 });

      const tcpFinal = await tcpProbeConnect(PORT);
      recordStep('tcp_probe_final', tcpFinal);
      const tcpClosed = tcpFinal.connectable === false;

      const auditClean = audit1.closed === true && audit2.closed === true;

      if (!auditClean || !tcpClosed) {
        // R5-04: PostgreSQL-aware fallback via pg_ctl stop on the
        // validated worker data dir. Never run pg_ctl stop on a path
        // that does not match `.tmp_pgdata_worker_*` and is not
        // rooted under the worktree.
        const validation = validateWorkerDataDir({ dataDir: DATA_DIR, worktreeCwd: process.cwd() });
        recordStep('pg_ctl_validation', validation);
        if (validation.ok) {
          const pgCtlPath = findEmbeddedPgCtl({ worktreeCwd: process.cwd() });
          if (pgCtlPath) {
            recordStep('pg_ctl_path', { path: pgCtlPath });
            const stop = runPgCtlStop({
              pgCtlPath,
              dataDir: validation.dataDir,
              timeoutMs: PG_CTL_TIMEOUT_MS,
            });
            recordStep('pg_ctl_stop', stop);
            if (stop.ok) {
              // Re-poll the port after the pg_ctl stop.
              const rePoll = await boundedWaitPortClosed(PORT, 5_000);
              recordStep('pg_ctl_stop_recheck', {
                ok: rePoll.ok,
                iterations: rePoll.iterations,
              });
            }
          } else {
            recordStep('pg_ctl_path', { skipped: 'not_found' });
          }
        }

        // Re-run the audit chain after the fallback.
        const audit1b = auditLeftovers(PORT);
        const interGapAt2 = Date.now();
        await new Promise((r) => setTimeout(r, AUDIT_GAP_MS));
        const audit2b = auditLeftovers(PORT);
        recordStep('audit1_after_fallback', audit1b);
        recordStep('audit2_after_fallback', { interAuditGapMs: Date.now() - interGapAt2, ...audit2b });
        const tcpFinal2 = await tcpProbeConnect(PORT);
        recordStep('tcp_probe_final_after_fallback', tcpFinal2);
        const finalClean =
          audit1b.closed === true &&
          audit2b.closed === true &&
          tcpFinal2.connectable === false;
        if (!finalClean) {
          const elapsedMs = Date.now() - teardownStartedAt;
          const detail = {
            kind: 'harness_stop_failed',
            port: PORT,
            dataDir: DATA_DIR,
            ownerPid,
            ownerAddress,
            elapsedMs,
            steps: teardownSteps,
            pgStopError: pgStopError ? (pgStopError.message || String(pgStopError)) : null,
            reason: !audit1b.closed
              ? 'port_still_listening_after_fallback'
              : !audit2b.closed
                ? 'port_flaky_reopened'
                : 'tcp_still_connectable_after_fallback',
          };
          console.log(JSON.stringify(detail));
          throw new Error(
            '[pg-worker-harness] stop failed: ' +
              detail.reason +
              ' (port=' +
              PORT +
              ', ownerPid=' +
              (ownerPid || audit1b.ownerPid || 'unknown') +
              ')',
          );
        }
      }

      const elapsedMs = Date.now() - teardownStartedAt;
      console.log(
        JSON.stringify({
          kind: 'harness_stop_done',
          port: PORT,
          dataDir: DATA_DIR,
          elapsedMs,
          steps: teardownSteps,
        }),
      );
    },
  };
}
