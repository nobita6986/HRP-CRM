/**
 * scripts/run-b02-repro.mjs -- T1-B round-4 / R4-04 + R4-06.
 *
 * Fail-closed narrow reproducer runner.
 *
 * Per-run:
 *   - unique PG_HARNESS_SUFFIX
 *   - per-run timeout (60 s default, override via B02_REPRO_TIMEOUT_MS)
 *   - on timeout: production cleanup helper (`b02-cleanup.mjs`)
 *     with the same taskkill-based path; bounded audits
 *
 * Runner exit code:
 *   0 = GATE_PASS  (each run completed, classification
 *                   CONFIRMED or NOT_CONFIRMED; cleanup verified;
 *                   no crash/timeout/NO_RESULT)
 *   1 = GATE_FAIL
 *
 * Output: apps/integration-worker/.b02-repro/<ts>/
 *   repro-N.stdout.txt   (REDACTED)
 *   repro-N.stderr.txt   (REDACTED)
 *   repro-N.meta.json    (REDACTED)
 *   summary.json
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  killTreeScoped,
  awaitChildClose,
  auditLeftovers,
  summarizeCleanup,
  tcpProbeConnect,
} from './b02-cleanup.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_DIR = path.resolve(__dirname, '..', 'apps', 'integration-worker');
const EVIDENCE_DIR = path.join(WORKER_DIR, '.b02-repro');
const NODE = process.execPath;
const RUN_COUNT = Number(process.env['B02_REPRO_COUNT'] ?? '3');
const RUN_TIMEOUT_MS = Number(process.env['B02_REPRO_TIMEOUT_MS'] ?? '60000');
const FINAL_CLOSE_BUDGET_MS = Number(process.env['B02_REPRO_FINAL_CLOSE_BUDGET_MS'] ?? '5000');
const AUDIT_GAP_MS = Number(process.env['B02_REPRO_AUDIT_GAP_MS'] ?? '500');
const NEGATIVE_PROBE = process.env['B02_REPRO_NEGATIVE_PROBE'] === '1';

function deriveSuffix(i) {
  return 'repro_v2_' + Date.now().toString(36) + '_' + randomBytes(3).toString('hex');
}

function derivePort(suffix) {
  return 53000 + (Math.abs([...suffix].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 5000);
}

function redact(s) {
  if (!s) return s;
  return s
    .replace(/signature=[A-Fa-f0-9]{16,}/g, 'signature=<redacted>')
    .replace(/HMAC=[A-Fa-f0-9]{16,}/g, 'HMAC=<redacted>')
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/g, 'Bearer <redacted>')
    .replace(/Authorization:\s*[A-Za-z]+\s+[A-Za-z0-9._\-+/=]+/g, 'Authorization: <redacted>')
    .replace(/X-Chatwoot-Signature:[\s"\x27]*[A-Fa-f0-9]{16,}/g, 'X-Chatwoot-Signature: <redacted>')
    .replace(/X-Zalo-Oa-Signature:[\s"\x27]*[A-Fa-f0-9]{16,}/g, 'X-Zalo-Oa-Signature: <redacted>')
    .replace(/secret=[A-Za-z0-9._\-+/=]+/g, 'secret=<redacted>');
}

async function runOnce(i, evidenceRunDir) {
  const suffix = deriveSuffix(i);
  const port = derivePort(suffix);
  const dataDir = path.join(WORKER_DIR, '.tmp_pgdata_worker_' + suffix);
  const outPath = path.join(evidenceRunDir, 'repro-' + i + '.stdout.txt');
  const errPath = path.join(evidenceRunDir, 'repro-' + i + '.stderr.txt');
  const metaPath = path.join(evidenceRunDir, 'repro-' + i + '.meta.json');

  const env = {
    ...process.env,
    PG_HARNESS_SUFFIX: suffix,
    B02_REPRO_RUN: String(i),
    NODE_ENV: 'development',
  };
  const startedAt = Date.now();
  console.log(
    '[run-b02-repro] run ' +
      i +
      '/' +
      RUN_COUNT +
      ' suffix=' +
      suffix +
      ' port=' +
      port +
      ' timeoutMs=' +
      RUN_TIMEOUT_MS,
  );

  let child = null;
  let spawnError = null;
  let stdoutRaw = '';
  let stderrRaw = '';
  let stages = [];

  try {
    child = (await import('node:child_process')).spawn(
      NODE,
      ['tests/repro/receiver-503-race.test.mjs'],
      { cwd: WORKER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    child.stdout.on('data', (d) => (stdoutRaw += d.toString()));
    child.stderr.on('data', (d) => (stderrRaw += d.toString()));
  } catch (err) {
    spawnError = (err && err.message) || String(err);
  }

  function recordStage(name, extra) {
    stages.push({ atMs: Date.now() - startedAt, stage: name, ...(extra || {}) });
  }

  recordStage('spawned', spawnError ? { error: spawnError } : { pid: child && child.pid });

  if (spawnError) {
    const meta = {
      idx: i,
      suffix,
      port,
      dataDir,
      outcome: 'SPAWN_ERROR',
      spawnError,
      exitCode: null,
      signal: null,
      timedOut: false,
      noExit: true,
      forcedExit: false,
      stages,
      stdout: redact(stdoutRaw),
      stderr: redact(stderrRaw || '[no stderr captured]\n'),
    };
    await writeFile(outPath, meta.stdout);
    await writeFile(errPath, meta.stderr);
    await writeFile(metaPath, JSON.stringify(meta, null, 2));
    return meta;
  }

  const race = await awaitChildClose(child, RUN_TIMEOUT_MS);
  recordStage('child_close_or_timeout', race);

  let timedOut = false;
  let signal = null;
  let exitCode = null;
  let noExit = false;
  let cleanup = null;

  if (race.kind === 'timeout') {
    timedOut = true;
    recordStage('killing_tree');
    cleanup = await killTreeScoped({
      rootPid: child && child.pid ? child.pid : -1,
      suffixPort: port,
      dataDir,
      worktreeCwd: WORKER_DIR,
    });
    recordStage('cleanup_result', { ok: cleanup.ok, failureStage: cleanup.failureStage });
    const finalClose = await awaitChildClose(child, FINAL_CLOSE_BUDGET_MS);
    recordStage('final_close', finalClose);
    if (finalClose.kind === 'close') {
      exitCode = finalClose.code;
      signal = finalClose.signal;
    } else if (finalClose.kind === 'error') {
      exitCode = null;
      signal = 'SPAWN_ERROR_EVENT';
      noExit = true;
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
    await new Promise((r) => setTimeout(r, AUDIT_GAP_MS));
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
  const elapsedMs = Date.now() - startedAt;

  // Extract structured repro_result JSON line.
  let reproResult = null;
  for (const line of stdoutRaw.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('{"kind":"repro_result"')) {
      try {
        reproResult = JSON.parse(t);
        break;
      } catch {}
    }
  }

  // Outer data-dir cleanup (happy path only — killTreeScoped handles it
  // on the timeout branch).
  let dataDirCleanup = cleanup && cleanup.dataDirRemoved ? cleanup.dataDirRemoved : 'not_attempted';
  if (dataDirCleanup === 'pending_outer_cleanup') {
    const { existsSync } = await import('node:fs');
    const { rm } = await import('node:fs/promises');
    if (existsSync(dataDir)) {
      try {
        await rm(dataDir, { recursive: true, force: true });
        dataDirCleanup = 'removed';
      } catch (e) {
        dataDirCleanup = 'failed: ' + ((e && e.message) || String(e));
      }
    } else {
      dataDirCleanup = 'absent';
    }
  }

  const forcedExit = /\{"kind":"hard_exit_guard"/.test(stdoutRaw);

  const outcome =
    timedOut
      ? 'TIMED_OUT'
      : exitCode === 0
        ? forcedExit
          ? 'PASS_FORCED_EXIT'
          : 'PASS'
        : exitCode === null
          ? 'NO_EXIT'
          : 'EXIT_NONZERO';

  const meta = {
    idx: i,
    suffix,
    port,
    dataDir,
    command: NODE + ' tests/repro/receiver-503-race.test.mjs',
    node: NODE,
    timeoutMs: RUN_TIMEOUT_MS,
    startedAt,
    finishedAt: Date.now(),
    elapsedMs,
    outcome,
    exitCode,
    signal,
    timedOut,
    noExit,
    forcedExit,
    cleanup,
    classification: reproResult ? reproResult.classification : 'NO_RESULT',
    observed: reproResult ? reproResult.observed : null,
    signature: reproResult ? reproResult.signature : null,
    dataDirCleanup,
    stages,
    stdout: redact(stdoutRaw),
    stderr: redact(stderrRaw),
  };

  await writeFile(outPath, meta.stdout);
  await writeFile(errPath, meta.stderr);
  await writeFile(metaPath, JSON.stringify(meta, null, 2));
  return meta;
}

const evidenceRunDir = path.join(EVIDENCE_DIR, String(Date.now()));
await mkdir(evidenceRunDir, { recursive: true });

const runs = [];
for (let i = 1; i <= RUN_COUNT; i++) {
  const r = await runOnce(i, evidenceRunDir);
  runs.push(r);
  console.log(
    '[run-b02-repro] run ' +
      i +
      ' outcome=' +
      r.outcome +
      ' exit=' +
      r.exitCode +
      ' classification=' +
      r.classification +
      ' okCount=' +
      (r.observed ? r.observed.okCount : '?') +
      ' storeUnavailable=' +
      (r.observed ? r.observed.storeUnavailable : '?') +
      ' cleanup.ok=' +
      (r.cleanup && r.cleanup.ok) +
      ' cleanup.failureStage=' +
      (r.cleanup && r.cleanup.failureStage) +
      ' audit1.closed=' +
      (r.cleanup && r.cleanup.audit1 && r.cleanup.audit1.closed) +
      ' audit2.closed=' +
      (r.cleanup && r.cleanup.audit2 && r.cleanup.audit2.closed) +
      ' dataDir=' +
      r.dataDirCleanup +
      ' elapsed=' +
      r.elapsedMs +
      'ms',
  );
}

const runsCompleted = runs.length;
const runsRequested = RUN_COUNT;
const allRunsCompleted = runsCompleted === runsRequested;
const allExitZero = runs.every((r) => r.exitCode === 0);
const allTimedOutFalse = runs.every((r) => r.timedOut === false);
const allNoExit = runs.every((r) => r.noExit !== true);
const allNoSpawn = runs.every((r) => r.outcome !== 'SPAWN_ERROR');
const allNoExitNonzero = runs.every((r) => r.outcome !== 'EXIT_NONZERO');
const allNoForced = runs.every((r) => r.forcedExit === false);
const allTeardownClean = runs.every(
  (r) =>
    r.cleanup &&
    r.cleanup.audit1 &&
    r.cleanup.audit1.closed === true &&
    r.cleanup.audit2 &&
    r.cleanup.audit2.closed === true,
);
const allTcpClosed = runs.every(
  (r) => r.cleanup && r.cleanup.tcpClosed === true,
);
const allCleanupResult = runs.every((r) => r.cleanup && r.cleanup.ok === true);
const allDataDirClean = runs.every(
  (r) => r.dataDirCleanup === 'removed' || r.dataDirCleanup === 'absent',
);
const allClassificationHonest = runs.every(
  (r) => r.classification === 'REPRO_CONFIRMED' || r.classification === 'REPRO_NOT_CONFIRMED',
);
const allClean =
  allRunsCompleted &&
  allExitZero &&
  allTimedOutFalse &&
  allNoExit &&
  allNoSpawn &&
  allNoExitNonzero &&
  allNoForced &&
  allTeardownClean &&
  allTcpClosed &&
  allCleanupResult &&
  allDataDirClean &&
  allClassificationHonest;

const verdict = NEGATIVE_PROBE
  ? runs.every((r) => r.outcome === 'TIMED_OUT') &&
    allTeardownClean &&
    allCleanupResult &&
    allDataDirClean
    ? 'PROBE_PASS'
    : 'PROBE_FAIL'
  : allClean
    ? 'GATE_PASS'
    : 'GATE_FAIL';

const summary = {
  startedAt: new Date(evidenceRunDir.split(path.sep).pop() * 1).toISOString(),
  finishedAt: new Date().toISOString(),
  nodeVersion: process.version,
  platform: process.platform,
  arch: process.arch,
  b02RunTimeoutMs: RUN_TIMEOUT_MS,
  negativeProbe: NEGATIVE_PROBE,
  runsRequested,
  runsCompleted,
  allRunsCompleted,
  allExitZero,
  allTimedOutFalse,
  allNoExit,
  allNoSpawn,
  allNoExitNonzero,
  allNoForced,
  allTeardownClean,
  allTcpClosed,
  allCleanupResult,
  allDataDirClean,
  allClassificationHonest,
  classifications: {
    confirmed: runs.filter((r) => r.classification === 'REPRO_CONFIRMED').length,
    notConfirmed: runs.filter((r) => r.classification === 'REPRO_NOT_CONFIRMED').length,
    noResult: runs.filter((r) => r.classification === 'NO_RESULT').length,
  },
  verdict,
  runs,
};
await writeFile(path.join(evidenceRunDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('[run-b02-repro] evidence: ' + path.join(evidenceRunDir, 'summary.json'));
console.log(
  '[run-b02-repro] verdict=' +
    summary.verdict +
    ' confirmed=' +
    summary.classifications.confirmed +
    ' notConfirmed=' +
    summary.classifications.notConfirmed +
    ' noResult=' +
    summary.classifications.noResult +
    ' allTeardownClean=' +
    allTeardownClean +
    ' allTcpClosed=' +
    allTcpClosed +
    ' allCleanupResult=' +
    allCleanupResult +
    ' allDataDirClean=' +
    allDataDirClean,
);

const exitCode =
  summary.verdict === 'GATE_PASS'
    ? 0
    : summary.verdict === 'PROBE_PASS'
      ? 2
      : 1;
import('node:process').then(({ default: proc }) => {
  proc.exit(exitCode);
});
