/**
 * apps/integration-worker/tests/pg-worker-harness.mjs
 *
 * Embedded PostgreSQL harness for integration-worker pipeline tests.
 *
 * Mirrors apps/integration-api/tests/pg-receiver-harness.mjs but with
 * a different SUFFIX so multiple harnesses don't collide.
 *
 * Required by T1-B / C-B02-1: every run MUST pass an explicit, unique
 * `PG_HARNESS_SUFFIX` (the runner script derives it from a timestamp +
 * entropy). Falling back to a random suffix silently would mask parallel
 * collisions; we fail loud instead so a misconfigured run is visible.
 *
 * T1-B round-6 / R6-01: persistent:true.
 *
 *   `persistent: true` keeps the data directory alive through the entire
 *   shutdown sequence. The old `persistent: false` caused embedded-postgres
 *   to delete the data directory as soon as `pg.stop()` returned, even if
 *   the PostgreSQL server process had not yet fully released its listening
 *   socket. When the cleanup helper then tried `pg_ctl stop -D <dataDir>`
 *   as a fallback, the directory was already gone and the command failed
 *   with "directory does not exist" — leaving an orphaned listener on the
 *   suffix port.
 *
 *   With `persistent: true` the data directory survives until:
 *     1. audit1.closed = true
 *     2. audit2.closed = true
 *     3. TCP probe connectable = false
 *   Only then does `stop()` delete the directory itself (or leaves it for
 *   the caller to delete after confirming the port is closed).
 *
 * T1-B round-6 / R6-02: idempotent stop.
 *
 *   `stop()` records a `stopPromise` so concurrent or repeated calls all
 *   await the same teardown. The harness, the `after()` hook, and the
 *   runner's `killTreeScoped` all go through the same `stop()` — there is
 *   only one owner of `prisma.$disconnect`, `pg.stop`, port verification,
 *   and data directory removal.
 *
 * T1-B round-6 / R6-04: shutdown ordering.
 *
 *   1. Disconnect Prisma.
 *   2. pg.stop() with bounded timeout.
 *   3. Port check (netstat + TCP).
 *   4. If port still open AND dataDir is usable for pg_ctl:
 *        pg_ctl stop with bounded timeout.
 *   5. If still open:
 *        PID refresh via fresh netstat + exact taskkill (bounded).
 *   6. Two consecutive closed audits + TCP probe.
 *   7. Delete data directory only after steps 1–6 confirm success.
 */

import EmbeddedPostgres from 'embedded-postgres';
import { createPrismaClient } from '@hrp-engagement/integration-store';
import { readFileSync, existsSync } from 'node:fs';
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
    persistent: true,
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
    pg,
    _stopPromise: null,
    async stop() {
      // R6-02 idempotent guard: every concurrent or repeated call awaits
      // the same teardown. Single owner of prisma disconnect, pg.stop,
      // port verification, and dataDir removal.
      if (this._stopPromise) return this._stopPromise;
      const teardown = (async () => {
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
        }
        // Now stop postgres. pg.stop() internally runs `pg_ctl stop` and
        // waits, but the listening socket may still be held by a child
        // server process that reparented away from the postmaster. R6-04:
        // bounded polling + PID refresh + pg_ctl fallback.
        let pgStopError = null;
        try {
          await pg.stop();
          recordStep('pg_stop_returned', { ok: true });
        } catch (e) {
          pgStopError = e;
          recordStep('pg_stop_returned', { ok: false, error: (e && e.message) || String(e) });
        }

        // R6-04 step 3: netstat + TCP probe to see whether pg.stop
        // actually released the port. If yes, we're done; if no, we
        // need the pg_ctl + PID-refresh fallback.
        const initialProbe = await tcpProbeConnect(PORT);
        recordStep('tcp_probe_after_pg_stop', initialProbe);
        let initialAudit = auditLeftovers(PORT);
        recordStep('audit_after_pg_stop', initialAudit);

        if (initialAudit.closed === true && initialProbe.connectable === false) {
          // pg.stop() really did free the port. Skip straight to the
          // post-cleanup audit chain.
          const audit1 = initialAudit;
          await new Promise((r) => setTimeout(r, AUDIT_GAP_MS));
          const audit2 = auditLeftovers(PORT);
          recordStep('audit2', { interAuditGapMs: Date.now() - teardownStartedAt, ...audit2 });
          const tcpFinal = initialProbe;
          recordStep('tcp_probe_final', tcpFinal);
          recordStep('post_stop_port_already_closed', {
            audit1Closed: audit1.closed === true,
            audit2Closed: audit2.closed === true,
            tcpClosed: tcpFinal.connectable === false,
          });
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
          return;
        }

        // R6-04 step 4: pg_ctl fallback. The pg_ctl stop on a STILL-LISTENING
        // server is the only way to free the socket when the postmaster
        // has reparented. Only run pg_ctl if the data directory is usable
        // (exists, valid PG marker). With `persistent: true` the directory
        // survives pg.stop, so this validation can succeed.
        //
        // R6-07: if the postmaster.pid file points to a PID that no
        // longer exists (because pg.stop() already killed the postmaster
        // but left a stale postmaster.pid), pg_ctl will refuse to signal
        // the missing PID. We detect this and skip pg_ctl gracefully so
        // the rest of the teardown chain can still run.
        const validation = validateWorkerDataDir({ dataDir: DATA_DIR, worktreeCwd: process.cwd() });
        recordStep('pg_ctl_validation', validation);
        if (validation.usable === true) {
          const pgCtlPath = findEmbeddedPgCtl({ worktreeCwd: process.cwd() });
          if (pgCtlPath) {
            recordStep('pg_ctl_path', { path: pgCtlPath });
            // R6-07: peek at postmaster.pid and verify the recorded
            // PID still exists. If not, pg_ctl stop will fail with
            // "No such process"; skip to avoid wasted work and to
            // record the real reason for the orphan listener.
            const pidFilePath = path.join(validation.dataDir, 'postmaster.pid');
            let recordedPid = null;
            try {
              if (existsSync(pidFilePath)) {
                const lines = readFileSync(pidFilePath, 'utf8').split(/\r?\n/);
                if (lines.length > 0) recordedPid = parseInt(lines[0].trim(), 10);
              }
            } catch {}
            let pidAlive = null;
            if (recordedPid && Number.isFinite(recordedPid) && recordedPid > 0) {
              // Use the same tasklist-based check the helper exports.
              const { pidExists } = await import('../../../scripts/b02-cleanup.mjs');
              pidAlive = pidExists(recordedPid);
            }
            recordStep('pg_ctl_postmaster_pid_check', {
              recordedPid,
              pidAlive: pidAlive && pidAlive.exists,
              pidExistsDurationMs: pidAlive && pidAlive.durationMs,
            });
            if (recordedPid && pidAlive && pidAlive.exists === false) {
              // The postmaster.pid references a dead PID. pg_ctl stop
              // will return "No such process"; record and skip.
              recordStep('pg_ctl_stop', {
                ok: false,
                skipped: 'recorded_pid_already_gone',
                recordedPid,
                note: 'postmaster.pid references a PID that no longer exists; pg_ctl stop would fail with "No such process"',
              });
            } else {
              const stop = runPgCtlStop({
                pgCtlPath,
                dataDir: validation.dataDir,
                timeoutMs: PG_CTL_TIMEOUT_MS,
              });
              recordStep('pg_ctl_stop', stop);
            }
          } else {
            recordStep('pg_ctl_path', { skipped: 'not_found' });
          }
        } else {
          recordStep('pg_ctl_validation', {
            safe: validation.safe,
            usable: validation.usable,
            reason: validation.reason,
          });
        }

        // R6-04 step 5: bounded port-close polling (≤15 s). R6-05 fix:
        // startedAt is captured ONCE, elapsedMs is total elapsed, and the
        // return value carries timeoutBudgetMs / pollIntervalMs.
        const bounded = await boundedWaitPortClosed(PORT, TEARDOWN_PORT_POLL_TIMEOUT_MS);
        recordStep('bounded_wait_port_closed', {
          ok: bounded.ok,
          iterations: bounded.iterations,
          elapsedMs: bounded.elapsedMs,
          timeoutBudgetMs: bounded.timeoutBudgetMs,
          pollIntervalMs: bounded.pollIntervalMs,
          reason: bounded.reason,
        });

        // R6-04 / R6-07: PID refresh + retry. If the port STILL has a
        // listener after pg.stop + pg_ctl + bounded wait, refresh the
        // owner PID from a FRESH netstat read and retry taskkill bounded.
        // R6-07: if the same PID comes back from netstat (alreadyGone on
        // taskkill), do NOT keep retrying — that PID is a stale OS record.
        // Re-poll briefly and then fail-closed; do not loop forever.
        let ownerPid = bounded.finalAudit && bounded.finalAudit.ownerPid ? bounded.finalAudit.ownerPid : null;
        let ownerAddress = bounded.finalAudit && bounded.finalAudit.address ? bounded.finalAudit.address : null;

        if (bounded.ok !== true) {
          const seenPids = new Set();
          if (ownerPid) seenPids.add(ownerPid);
          let refreshed = false;
          for (let refreshIter = 0; refreshIter < 3; refreshIter += 1) {
            const freshAudit = auditLeftovers(PORT);
            if (freshAudit.closed === true) {
              const probe = await tcpProbeConnect(PORT);
              if (probe.connectable === false) {
                recordStep('pid_refresh_break', {
                  iter: refreshIter,
                  reason: 'closed_after_refresh',
                  audit: freshAudit,
                  tcp: probe,
                });
                ownerPid = null;
                refreshed = true;
                break;
              }
            }
            if (freshAudit.available === false || !freshAudit.ownerPid) {
              recordStep('pid_refresh_break', { iter: refreshIter, reason: 'no_owner', audit: freshAudit });
              break;
            }
            if (seenPids.has(freshAudit.ownerPid)) {
              // Same PID we already tried — stop the loop. taskkill code 128
              // on a known PID means the OS process is gone; the listener
              // is now in an indeterminate state (likely inherited by a
              // service host process that netstat cannot resolve).
              recordStep('pid_refresh_break', {
                iter: refreshIter,
                reason: 'stale_pid_repeated',
                pid: freshAudit.ownerPid,
                audit: freshAudit,
              });
              break;
            }
            seenPids.add(freshAudit.ownerPid);
            const freshPid = freshAudit.ownerPid;
            const tk = runTaskkill(['/PID', String(freshPid), '/T', '/F']);
            recordStep('pid_refresh_kill', { iter: refreshIter, pid: freshPid, ...tk });
            ownerPid = freshPid;
            ownerAddress = freshAudit.address;
            refreshed = true;
            // Brief re-poll, bounded.
            const reWait = await boundedWaitPortClosed(PORT, 3_000);
            recordStep('pid_refresh_recheck', {
              iter: refreshIter,
              ok: reWait.ok,
              iterations: reWait.iterations,
              elapsedMs: reWait.elapsedMs,
            });
            if (reWait.ok) break;
          }
          recordStep('pid_refresh_done', { refreshed, ownerPid });
        }

        // Final two-consecutive-audit confirmation (R5-02 + R5-03 + R6-04):
        // audit1 AND audit2 (with AUDIT_GAP_MS between) AND a final TCP
        // probe that confirms the OS no longer accepts a SYN.
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
            reason: !audit1.closed
              ? 'port_still_listening'
              : !audit2.closed
                ? 'port_flaky_reopened'
                : 'tcp_still_connectable',
          };
          console.log(JSON.stringify(detail));
          throw new Error(
            '[pg-worker-harness] stop failed: ' +
              detail.reason +
              ' (port=' +
              PORT +
              ', ownerPid=' +
              (ownerPid || audit1.ownerPid || 'unknown') +
              ')',
          );
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
      })();
      this._stopPromise = teardown;
      try {
        return await teardown;
      } finally {
        // Do NOT clear _stopPromise — once stop has been awaited once, it
        // must remain idempotent for any subsequent invocations.
      }
    },
  };
}
