/**
 * scripts/cleanup-probe.mjs -- T1-B round-4 / R4-05.
 *
 * Narrow maintained probe for the production cleanup helper
 * (`scripts/b02-cleanup.mjs`). This probe is REQUIRED to PASS before
 * the full B.02 Local E2E gate is re-run.
 *
 * What it does:
 *   1. Spawns a Node child that opens a TCP listener on a free
 *      127.0.0.1 port (the "production helper" exact-port path is
 *      exercised against this listener).
 *   2. Forces the runner timeout so the killTreeScoped() path runs.
 *   3. Verifies R4-03 cleanup criteria:
 *        - root process no longer exists;
 *        - suffix port closed in TWO consecutive audit probes;
 *        - test child emits close (or is confirmed gone);
 *        - data dir removed.
 *   4. Writes meta + stdout/stderr + summary files to the evidence dir.
 *
 * Exit codes:
 *   0 = GATE_PASS  (probe produced in an "honest" mode)
 *   2 = PROBE_PASS (negative-probe mode ran successfully)
 *   1 = PROBE_FAIL / GATE_FAIL
 *
 * The default mode is PROBE (negative-lifecycle probe). Run with
 *   B02_PROBE_HAPPY=1
 * to test the natural-exit branch instead.
 *
 * Usage:
 *   node scripts/cleanup-probe.mjs
 *   B02_PROBE_HAPPY=1 node scripts/cleanup-probe.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  killTreeScoped,
  awaitChildClose,
  auditLeftovers,
  summarizeCleanup,
  tcpProbeConnect,
  validateWorkerDataDir,
  findEmbeddedPgCtl,
  runPgCtlStop,
  runTaskkill,
} from './b02-cleanup.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVIDENCE_DIR = path.resolve(
  __dirname,
  '..',
  'apps',
  'integration-worker',
  '.b02-probe',
);
const HAPPY_MODE = process.env['B02_PROBE_HAPPY'] === '1';
const ORPHAN_MODE = process.env['B02_PROBE_ORPHAN'] === '1';
const PROBE_TIMEOUT_MS = Number(process.env['B02_PROBE_TIMEOUT_MS'] ?? '1500');

function findFreePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });
}

/**
 * A trivial child that listens on the port we hand it and stays alive
 * for `keepaliveMs`. After that it exits naturally. The probe tests
 * both the natural-exit (HAPPY_MODE) and the timeout path.
 *
 * Usage:
 *   node cleanup-probe-child.mjs <port> <keepaliveMs> <markFile>
 */
const CHILD_SOURCE = `
const net = require('node:net');
const fs = require('node:fs');
const port = Number(process.argv[2]);
const keepaliveMs = Number(process.argv[3]);
const markFile = process.argv[4];

const s = net.createServer();
s.on('error', (e) => {
  process.stderr.write(JSON.stringify({ kind: 'child_error', error: e.message }) + '\\n');
  process.exit(2);
});
s.listen(port, '127.0.0.1', () => {
  if (markFile) {
    try { fs.writeFileSync(markFile, String(process.pid), 'utf8'); } catch {}
  }
  process.stdout.write(JSON.stringify({ kind: 'child_listening', port, pid: process.pid }) + '\\n');
  setTimeout(() => {
    process.stdout.write(JSON.stringify({ kind: 'child_exiting' }) + '\\n');
    s.close(() => process.exit(0));
  }, keepaliveMs).unref();
});
`;

/**
 * R5-06: orphan / reparented-listener probe child.
 *
 * This child spawns a DETACHED grandchild that opens a TCP listener
 * on the port we hand it. The grandchild is spawned with detached:true
 * and stdio:ignore so it survives the parent exiting. After spawning
 * the grandchild, the root writes its PID to the mark file and exits
 * normally.
 *
 * Usage:
 *   node cleanup-probe-orphan-child.cjs <port> <markFile>
 *
 * Result: when this child exits, the grandchild (listener) keeps
 * listening on the port — exactly the orphan/descendant scenario the
 * cleanup helper must handle via PID refresh + retry.
 */
const ORPHAN_CHILD_SOURCE = `
const net = require('node:net');
const fs = require('node:fs');
const { spawn } = require('child_process');
const port = Number(process.argv[2]);
const markFile = process.argv[3];

const grandchildSource = [
  "const net = require('node:net');",
  "const fs = require('node:fs');",
  "const port = Number(process.argv[2]);",
  "const markFile = process.argv[3];",
  "const s = net.createServer();",
  "s.on('error', (e) => {",
  "  try { fs.writeFileSync(markFile + '.gc.error', String(e.message)); } catch {}",
  "  process.exit(2);",
  "});",
  "s.listen(port, '127.0.0.1', () => {",
  "  try { fs.writeFileSync(markFile, String(process.pid)); } catch {}",
  "  console.log(JSON.stringify({ kind: 'grandchild_listening', port, pid: process.pid }));",
  "});",
  "process.on('SIGTERM', () => { s.close(() => process.exit(0)); });",
].join('\\n');

const tmpPath = markFile + '.gc.cjs';
fs.writeFileSync(tmpPath, grandchildSource);

const child = spawn(process.execPath, [tmpPath, String(port), markFile], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
});
child.unref();
process.stdout.write(JSON.stringify({ kind: 'orphan_root_started', grandchildPid: child.pid, port }) + '\\n');
// Exit naturally so the parent (the probe) sees a clean close.
process.exit(0);
`;

async function main() {
  const evidenceRunDir = path.join(EVIDENCE_DIR, String(Date.now()));
  await mkdir(evidenceRunDir, { recursive: true });
  const metaPath = path.join(evidenceRunDir, 'probe.meta.json');
  const stdoutPath = path.join(evidenceRunDir, 'probe.stdout.txt');
  const stderrPath = path.join(evidenceRunDir, 'probe.stderr.txt');
  const summaryPath = path.join(evidenceRunDir, 'summary.json');

  const port = await findFreePort();
  const startedAt = Date.now();
  const stages = [];
  function recordStage(name, extra) {
    stages.push({ atMs: Date.now() - startedAt, stage: name, ...(extra || {}) });
  }

  // Write child source to a temp file.
  const { spawn } = await import('node:child_process');
  const { writeFile: wfSync } = await import('node:fs/promises');
  const tmpChildPath = path.join(evidenceRunDir, 'cleanup-probe-child.cjs');
  await wfSync(
    tmpChildPath,
    ORPHAN_MODE ? ORPHAN_CHILD_SOURCE : CHILD_SOURCE,
    'utf8',
  );

  const keepaliveMs = HAPPY_MODE ? 200 : 60_000; // happy: short so natural exit; probe: long so runner times out
  const markFile = path.join(evidenceRunDir, 'child.pid');
  const dataDir = path.join(evidenceRunDir, 'data');
  await mkdir(dataDir, { recursive: true });

  const child = spawn(
    process.execPath,
    ORPHAN_MODE
      ? [tmpChildPath, String(port), markFile]
      : [tmpChildPath, String(port), String(keepaliveMs), markFile],
    {
      cwd: __dirname,
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  let stdoutRaw = '';
  let stderrRaw = '';
  child.stdout.on('data', (d) => (stdoutRaw += d.toString()));
  child.stderr.on('data', (d) => (stderrRaw += d.toString()));
  recordStage('spawned', { pid: child.pid, mode: ORPHAN_MODE ? 'orphan' : (HAPPY_MODE ? 'happy' : 'probe') });

  // Wait for the child to log its startup marker.
  const startMarker = ORPHAN_MODE ? '"orphan_root_started"' : '"child_listening"';
  const listenDeadline = Date.now() + 5000;
  while (Date.now() < listenDeadline) {
    if (stdoutRaw.includes(startMarker)) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  // ORPHAN_MODE: the root child exits cleanly after spawning the
  // detached grandchild. Give the grandchild a moment to bind the port.
  if (ORPHAN_MODE) {
    await new Promise((r) => setTimeout(r, 500));
  }
  recordStage('child_started', {
    saw: stdoutRaw.includes(startMarker),
    pidFileExists: existsSync(markFile),
  });

  // For ORPHAN_MODE the root exits; await its close so we know the
  // grandchild is alone with the port.
  let race;
  if (ORPHAN_MODE) {
    race = await awaitChildClose(child, 5000);
    recordStage('orphan_root_close', race);
    // After the root exits, the grandchild should still be listening.
    const tcpAfterRootExit = await tcpProbeConnect(port);
    recordStage('orphan_tcp_after_root_exit', tcpAfterRootExit);
  } else if (HAPPY_MODE) {
    // Happy mode: do not enforce a runner timeout; just await close.
    race = await awaitChildClose(child, Math.max(keepaliveMs + 2000, 5000));
    recordStage('happy_close', race);
  } else {
    race = await awaitChildClose(child, PROBE_TIMEOUT_MS);
    recordStage('probe_close_or_timeout', race);
  }

  let cleanup = null;
  let timedOut = false;
  let exitCode = null;
  let signal = null;
  let noExit = false;

  if (race.kind === 'timeout') {
    timedOut = true;
    cleanup = await killTreeScoped({
      rootPid: child.pid,
      suffixPort: port,
      dataDir,
      worktreeCwd: __dirname,
    });
    recordStage('cleanup_result', { ok: cleanup.ok, failureStage: cleanup.failureStage });
    const finalClose = await awaitChildClose(child, 5000);
    recordStage('final_close', finalClose);
    if (finalClose.kind === 'close') {
      exitCode = finalClose.code;
      signal = finalClose.signal;
    } else {
      exitCode = null;
      signal = 'SIGKILL_PENDING';
      noExit = true;
    }
  } else if (race.kind === 'close') {
    exitCode = race.code;
    signal = race.signal;
    const tcpAfterClose = await tcpProbeConnect(port);
    const audit1 = auditLeftovers(port);
    await new Promise((r) => setTimeout(r, 500));
    const audit2 = auditLeftovers(port);
    const tcpFinal = await tcpProbeConnect(port);
    cleanup = {
      ok:
        audit1.closed === true &&
        audit2.closed === true &&
        tcpAfterClose.connectable === false &&
        tcpFinal.connectable === false,
      rootGone: true,
      portOwner: null,
      audit1,
      audit2,
      tcpAfterClose,
      tcpClosed: tcpFinal.connectable === false,
      tcpProbe: tcpFinal,
      dataDirRemoved: 'pending_outer_cleanup',
      steps: [
        { step: 'taskkill_root', skipped: 'natural_exit' },
        { step: 'netstat_port', available: audit1.available, portHits: audit1.portHits || [] },
        { step: 'taskkill_port_owner', skipped: audit1.closed ? 'port_closed' : 'port_owner_unknown' },
        { step: 'tcp_probe_after_close', ...tcpAfterClose },
        { step: 'audit1', ...audit1 },
        { step: 'audit2', ...audit2 },
        { step: 'tcp_probe_final', ...tcpFinal },
      ],
      failureStage:
        audit1.closed !== true || audit2.closed !== true || tcpFinal.connectable === true
          ? audit1.closed !== true
            ? 'audit1'
            : audit2.closed !== true
              ? 'audit2'
              : 'tcp_probe_final'
          : null,
    };
  } else if (race.kind === 'error') {
    exitCode = null;
    signal = 'SPAWN_ERROR_EVENT';
    noExit = true;
  }

  // ORPHAN_MODE: even after the root child exits cleanly, the
  // grandchild still holds the port. We MUST invoke killTreeScoped
  // so the helper exercises its PID-refresh + pg_ctl fallback path,
  // regardless of whether the root exited cleanly or timed out.
  // We OVERWRITE any synthetic cleanup built above because the
  // synthetic one assumes the port is closed, but the grandchild
  // is still listening on it.
  if (ORPHAN_MODE) {
    recordStage('orphan_kill_phase_start');
    cleanup = await killTreeScoped({
      rootPid: child.pid,
      suffixPort: port,
      dataDir,
      worktreeCwd: __dirname,
    });
    recordStage('orphan_cleanup_result', {
      ok: cleanup.ok,
      failureStage: cleanup.failureStage,
      portOwnerRefreshed: cleanup.portOwnerRefreshed,
      pgCtlAttempts: cleanup.pgCtlAttempts,
    });
  }

  // Outer data-dir cleanup if needed.
  let dataDirCleanup = cleanup && cleanup.dataDirRemoved ? cleanup.dataDirRemoved : 'not_attempted';
  if (dataDirCleanup === 'pending_outer_cleanup' && existsSync(dataDir)) {
    try {
      await rm(dataDir, { recursive: true, force: true });
      dataDirCleanup = 'removed';
    } catch (e) {
      dataDirCleanup = 'failed: ' + ((e && e.message) || String(e));
    }
  } else if (dataDirCleanup === 'pending_outer_cleanup') {
    dataDirCleanup = 'absent';
  }

  // R4-03 final cleanup verification: root no longer exists.
  const rootGone = cleanup ? cleanup.rootGone : null;
  const childPidFileExistedAtEnd = existsSync(markFile);

  const meta = {
    port,
    happyMode: HAPPY_MODE,
    orphanMode: ORPHAN_MODE,
    timeoutMs: PROBE_TIMEOUT_MS,
    startedAt,
    finishedAt: Date.now(),
    elapsedMs: Date.now() - startedAt,
    timedOut,
    exitCode,
    signal,
    noExit,
    rootGone,
    cleanup: cleanup ? summarizeCleanup(cleanup) : null,
    cleanupRaw: cleanup,
    dataDirCleanup,
    stages,
    childPidFile: markFile,
    childPidFileExistedAtEnd,
    stdout: stdoutRaw,
    stderr: stderrRaw,
  };
  await writeFile(stdoutPath, meta.stdout);
  await writeFile(stderrPath, meta.stderr);
  await writeFile(metaPath, JSON.stringify(meta, null, 2));

  // R5 verdict:
  //   - PROBE: timeout, cleanup.ok === true, audit1/2 closed === true,
  //            TCP not connectable, dataDir cleaned.
  //   - HAPPY: natural exit, audit1/2 closed === true, TCP not
  //            connectable, dataDir cleaned.
  //   - ORPHAN: root exited cleanly; cleanup must have detected the
  //             orphan listener, refreshed PID, killed it, and
  //             cleaned up the data dir + port.
  const auditClean = (r) =>
    cleanup &&
    cleanup.audit1 &&
    cleanup.audit1.closed === true &&
    cleanup.audit2 &&
    cleanup.audit2.closed === true &&
    cleanup.tcpClosed === true;
  const dataDirClean = dataDirCleanup === 'removed' || dataDirCleanup === 'absent';
  const probePass =
    timedOut && cleanup && cleanup.ok === true && auditClean(cleanup) && dataDirClean;
  const happyPass =
    !timedOut && exitCode === 0 && cleanup && cleanup.ok === true && auditClean(cleanup) && dataDirClean;
  const orphanPass =
    !timedOut &&
    exitCode === 0 &&
    cleanup &&
    cleanup.ok === true &&
    auditClean(cleanup) &&
    cleanup.portOwnerRefreshed === true &&
    dataDirClean;

  const verdict = ORPHAN_MODE
    ? orphanPass ? 'PROBE_PASS' : 'PROBE_FAIL'
    : HAPPY_MODE
      ? happyPass ? 'GATE_PASS' : 'GATE_FAIL'
      : probePass ? 'PROBE_PASS' : 'PROBE_FAIL';

  const summary = {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    happyMode: HAPPY_MODE,
    orphanMode: ORPHAN_MODE,
    timeoutMs: PROBE_TIMEOUT_MS,
    port,
    rootGone,
    childPidFileExistedAtEnd,
    dataDirCleanup,
    timedOut,
    exitCode,
    signal,
    cleanupOk: cleanup ? cleanup.ok : false,
    audit1Closed: cleanup && cleanup.audit1 ? cleanup.audit1.closed : null,
    audit2Closed: cleanup && cleanup.audit2 ? cleanup.audit2.closed : null,
    tcpClosed: cleanup ? cleanup.tcpClosed : null,
    portOwnerRefreshed: cleanup ? cleanup.portOwnerRefreshed : null,
    pgCtlAttempts: cleanup ? cleanup.pgCtlAttempts : null,
    failureStage: cleanup ? cleanup.failureStage : null,
    verdict,
    evidenceFiles: {
      meta: metaPath,
      stdout: stdoutPath,
      stderr: stderrPath,
      summary: summaryPath,
    },
  };
  await writeFile(summaryPath, JSON.stringify(summary, null, 2));
  console.log('[cleanup-probe] verdict=' + verdict);
  console.log(
    '[cleanup-probe] rootGone=' +
      rootGone +
      ' audit1Closed=' +
      summary.audit1Closed +
      ' audit2Closed=' +
      summary.audit2Closed +
      ' tcpClosed=' +
      summary.tcpClosed +
      ' portOwnerRefreshed=' +
      summary.portOwnerRefreshed +
      ' dataDir=' +
      dataDirCleanup +
      ' timedOut=' +
      timedOut +
      ' exit=' +
      exitCode +
      ' cleanupOk=' +
      summary.cleanupOk +
      ' failureStage=' +
      summary.failureStage,
  );
  console.log('[cleanup-probe] evidence: ' + evidenceRunDir);

  const code =
    verdict === 'GATE_PASS' ? 0 : verdict === 'PROBE_PASS' ? 2 : 1;
  // Drain net handles before exiting.
  process.exit(code);
}

main().catch((e) => {
  console.error('[cleanup-probe] FATAL: ' + (e && e.message ? e.message : String(e)));
  process.exit(1);
});
