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
  process.stdout.write(JSON.stringify({ kind: 'child_listening', port }) + '\\n');
  setTimeout(() => {
    process.stdout.write(JSON.stringify({ kind: 'child_exiting' }) + '\\n');
    s.close(() => process.exit(0));
  }, keepaliveMs).unref();
});
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
  await wfSync(tmpChildPath, CHILD_SOURCE, 'utf8');

  const keepaliveMs = HAPPY_MODE ? 200 : 60_000; // happy: short so natural exit; probe: long so runner times out
  const markFile = path.join(evidenceRunDir, 'child.pid');
  const dataDir = path.join(evidenceRunDir, 'data');
  await mkdir(dataDir, { recursive: true });

  const child = spawn(
    process.execPath,
    [tmpChildPath, String(port), String(keepaliveMs), markFile],
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
  recordStage('spawned', { pid: child.pid });

  // Wait for the child to log `child_listening` (best-effort, short).
  const listenDeadline = Date.now() + 5000;
  while (Date.now() < listenDeadline) {
    if (stdoutRaw.includes('"child_listening"')) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  recordStage('child_listening', {
    saw: stdoutRaw.includes('"child_listening"'),
    pidFileExists: existsSync(markFile),
  });

  let race;
  if (HAPPY_MODE) {
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
    const audit1 = auditLeftovers(port);
    await new Promise((r) => setTimeout(r, 500));
    const audit2 = auditLeftovers(port);
    cleanup = {
      ok: audit1.closed === true && audit2.closed === true,
      rootGone: true,
      portOwner: null,
      audit1,
      audit2,
      dataDirRemoved: 'pending_outer_cleanup',
      steps: [
        { step: 'taskkill_root', skipped: 'natural_exit' },
        { step: 'netstat_port', available: audit1.available, portHits: audit1.portHits || [] },
        { step: 'audit1', ...audit1 },
        { step: 'audit2', ...audit2 },
      ],
      failureStage:
        audit1.closed !== true || audit2.closed !== true
          ? audit1.closed !== true
            ? 'audit1'
            : 'audit2'
          : null,
    };
  } else if (race.kind === 'error') {
    exitCode = null;
    signal = 'SPAWN_ERROR_EVENT';
    noExit = true;
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
  // We have two independent signals:
  //   (a) the helper's tasklist probe (cleanup.rootGone)
  //   (b) whether the markFile written by the child is still present
  //       (it is only written by the child and is a static file, so
  //       its existence is not a signal of the child still being
  //       alive — it is just a record of the PID it started with).
  // Therefore we trust (a). The markFile existence is recorded as
  // a separate diagnostic.
  const rootGone = cleanup ? cleanup.rootGone : null;
  const childPidFileExistedAtEnd = existsSync(markFile);

  const meta = {
    port,
    happyMode: HAPPY_MODE,
    timeoutMs: PROBE_TIMEOUT_MS,
    startedAt,
    finishedAt: Date.now(),
    elapsedMs: Date.now() - startedAt,
    timedOut,
    exitCode,
    signal,
    noExit,
    rootGone,
    cleanup,
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

  // Verdict:
  //   - PROBE: timeout, cleanup.ok === true, audit1/2 closed === true,
  //            dataDir cleaned.
  //   - HAPPY: natural exit, audit1/2 closed === true, dataDir cleaned.
  const probePass =
    timedOut &&
    cleanup &&
    cleanup.ok === true &&
    cleanup.audit1 &&
    cleanup.audit1.closed === true &&
    cleanup.audit2 &&
    cleanup.audit2.closed === true &&
    (dataDirCleanup === 'removed' || dataDirCleanup === 'absent');
  const happyPass =
    !timedOut &&
    exitCode === 0 &&
    cleanup &&
    cleanup.ok === true &&
    cleanup.audit1 &&
    cleanup.audit1.closed === true &&
    cleanup.audit2 &&
    cleanup.audit2.closed === true &&
    (dataDirCleanup === 'removed' || dataDirCleanup === 'absent');

  const verdict = HAPPY_MODE ? (happyPass ? 'GATE_PASS' : 'GATE_FAIL') : probePass ? 'PROBE_PASS' : 'PROBE_FAIL';

  const summary = {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    happyMode: HAPPY_MODE,
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
