/**
 * scripts/run-b02-isolated.mjs -- T1-B round-4 (R4-01..R4-08).
 *
 * Fail-closed B.02 Local E2E isolated gate.
 *
 * Each run:
 *   - unique PG_HARNESS_SUFFIX (timestamp + entropy)
 *   - unique data dir and embedded-PG port
 *   - per-run timeout (180 s default, override via B02_RUN_TIMEOUT_MS)
 *   - on timeout: production-cleanup helper (`b02-cleanup.mjs`)
 *     terminates root + suffix-port owner via bounded `taskkill`,
 *     audits the port twice, throws on any failure
 *
 * Gate verdict (`GATE_PASS`) requires ALL of:
 *   - runsCompleted === runsRequested
 *   - allExitZero === true
 *   - allTimedOutFalse === true
 *   - allPass === true
 *   - allEightScenarios === true
 *   - allTeardownClean === true   (audit1 && audit2 closed === true)
 *   - allCleanupResult === true   (killTreeScoped.ok === true)
 *   - allDataDirClean === true
 *   - noForcedExit / noSpawnError / noNoExit / noExitNonzero / noPassForced
 *
 * Anything else => GATE_FAIL. Negative-probe mode inverts to
 * PROBE_PASS / PROBE_FAIL with exit code 2 on pass.
 *
 * Output: apps/integration-worker/.b02-evidence/<ts>/
 *   run-N.stdout.txt   (REDACTED)
 *   run-N.stderr.txt   (REDACTED)
 *   run-N.meta.json    (REDACTED)
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
const EVIDENCE_DIR = path.join(WORKER_DIR, '.b02-evidence');
const NODE = process.execPath;
const RUN_COUNT = Number(process.env['B02_RUN_COUNT'] ?? '3');
const RUN_TIMEOUT_MS = Number(process.env['B02_RUN_TIMEOUT_MS'] ?? '180000');
const FINAL_CLOSE_BUDGET_MS = Number(process.env['B02_FINAL_CLOSE_BUDGET_MS'] ?? '5000');
const AUDIT_GAP_MS = Number(process.env['B02_AUDIT_GAP_MS'] ?? '500');
const NEGATIVE_PROBE = process.env['B02_NEGATIVE_PROBE'] === '1';

function deriveSuffix(idx) {
  const ts = Date.now().toString(36);
  const rand = randomBytes(4).toString('hex');
  return 'b02_r' + idx + '_' + ts + '_' + rand;
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

async function runOnce(idx, evidenceRunDir) {
  const suffix = deriveSuffix(idx);
  const port = derivePort(suffix);
  const dataDir = path.join(WORKER_DIR, '.tmp_pgdata_worker_' + suffix);
  const stdoutPath = path.join(evidenceRunDir, 'run-' + idx + '.stdout.txt');
  const stderrPath = path.join(evidenceRunDir, 'run-' + idx + '.stderr.txt');
  const metaPath = path.join(evidenceRunDir, 'run-' + idx + '.meta.json');

  const env = {
    ...process.env,
    PG_HARNESS_SUFFIX: suffix,
    HRP_ORGANIZATION_ID:
      process.env['HRP_ORGANIZATION_ID'] ?? '00000000-0000-0000-0000-000000000b02',
    NODE_ENV: 'development',
    B02_RUN_TIMEOUT_MS: String(RUN_TIMEOUT_MS),
  };

  const cmd = NODE;
  const args = ['--test', '--test-reporter=tap', 'tests/b02-local-e2e.test.mjs'];
  const startedAt = Date.now();
  console.log(
    '[run-b02-isolated] run ' +
      idx +
      '/' +
      RUN_COUNT +
      ' suffix=' +
      suffix +
      ' port=' +
      port +
      ' dataDir=' +
      dataDir +
      ' timeoutMs=' +
      RUN_TIMEOUT_MS,
  );

  const stages = [];
  function recordStage(name, extra) {
    stages.push({ atMs: Date.now() - startedAt, stage: name, ...(extra || {}) });
  }

  let child = null;
  let stdoutRaw = '';
  let stderrRaw = '';
  let spawnError = null;

  try {
    child = (await import('node:child_process')).spawn(cmd, args, {
      cwd: WORKER_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.on('data', (d) => (stdoutRaw += d.toString()));
    child.stderr.on('data', (d) => (stderrRaw += d.toString()));
  } catch (err) {
    spawnError = (err && err.message) || String(err);
  }
  recordStage('spawned', spawnError ? { error: spawnError } : { pid: child && child.pid });

  if (spawnError) {
    const meta = {
      idx,
      suffix,
      port,
      dataDir,
      command: cmd + ' ' + args.join(' '),
      startedAt,
      finishedAt: Date.now(),
      elapsedMs: Date.now() - startedAt,
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
    await writeFile(stdoutPath, meta.stdout);
    await writeFile(stderrPath, meta.stderr);
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
    // R4-02/R4-03 + R5-02..R5-05: production cleanup helper
    // (taskkill-based, bounded port-close polling, pg_ctl fallback,
    // TCP connectability confirmation).
    cleanup = await killTreeScoped({
      rootPid: child && child.pid ? child.pid : -1,
      suffixPort: port,
      dataDir,
      worktreeCwd: WORKER_DIR,
    });
    recordStage('cleanup_result', { ok: cleanup.ok, failureStage: cleanup.failureStage });
    // After taskkill, give the child a bounded final-close race.
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
    // Happy path: the test process exited naturally. We still want to
    // verify the port is gone (R4-03 + R5-02 + R5-03) and the data dir
    // cleaned. Use bounded polling + a TCP connectability probe so
    // netstat-stale-but-TCP-live cannot sneak through.
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
    recordStage('error_event', { error: race.error });
  }
  const elapsedMs = Date.now() - startedAt;

  // TAP counting (subtest-level).
  const tap = { ok: 0, notOk: 0, total: 0, plan: null, subtests: [] };
  const tapLines = stdoutRaw.split(/\r?\n/);
  let inSubtests = false;
  for (let tlineIdx = 0; tlineIdx < tapLines.length; tlineIdx++) {
    const line = tapLines[tlineIdx];
    if (line.match(/^# Subtest:/)) {
      inSubtests = true;
      continue;
    }
    if (inSubtests) {
      const mOk = line.match(/^\s{2,}ok\s+(\d+)\s+-\s+(.+)$/);
      const mNo = line.match(/^\s{2,}not ok\s+(\d+)\s+-\s+(.+)$/);
      if (mOk) {
        tap.ok += 1;
        tap.total += 1;
        tap.subtests.push({ n: Number(mOk[1]), name: mOk[2], ok: true });
      } else if (mNo) {
        tap.notOk += 1;
        tap.total += 1;
        tap.subtests.push({ n: Number(mNo[1]), name: mNo[2], ok: false });
      } else if (line.match(/^1\.\.\d+/)) {
        inSubtests = false;
      }
    }
  }
  const planLine = tapLines.find((l) => l.match(/^1\.\.\d+/));
  if (planLine) {
    const m = planLine.match(/^1\.\.(\d+)/);
    if (m) tap.plan = Number(m[1]);
  }

  // Data dir cleanup is part of the killTreeScoped path on the timeout
  // branch. On the happy-path branch the test process owns its own
  // data dir cleanup via pg-worker-harness; we still sweep here as
  // a final safety net (best-effort).
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

  // C3-05: forcedExit detection (hard_exit_guard markers in stdout).
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
    idx,
    suffix,
    port,
    dataDir,
    command: cmd + ' ' + args.join(' '),
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
    tap,
    dataDirCleanup,
    stages,
    stdout: redact(stdoutRaw),
    stderr: redact(stderrRaw),
  };

  await writeFile(stdoutPath, meta.stdout);
  await writeFile(stderrPath, meta.stderr);
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
    '[run-b02-isolated] run ' +
      i +
      ' outcome=' +
      r.outcome +
      ' exit=' +
      r.exitCode +
      ' signal=' +
      (r.signal || 'none') +
      ' ok=' +
      r.tap.ok +
      ' notOk=' +
      r.tap.notOk +
      ' forcedExit=' +
      r.forcedExit +
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
const allPass = runs.every((r) => r.outcome === 'PASS');
const allEightScenarios = runs.every(
  (r) => (r.tap.subtests || []).length === 8 && r.tap.ok === 8 && r.tap.notOk === 0,
);
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
const allCleanupResult = runs.every(
  (r) => r.cleanup && r.cleanup.ok === true,
);
const allDataDirClean = runs.every(
  (r) => r.dataDirCleanup === 'removed' || r.dataDirCleanup === 'absent',
);
const noForcedExit = runs.every((r) => r.forcedExit === false);
const noSpawnError = runs.every((r) => r.outcome !== 'SPAWN_ERROR');
const noNoExit = runs.every((r) => r.noExit !== true);
const noExitNonzero = runs.every((r) => r.outcome !== 'EXIT_NONZERO');
const noPassForced = runs.every((r) => r.outcome !== 'PASS_FORCED_EXIT');

const allClean =
  allRunsCompleted &&
  allExitZero &&
  allTimedOutFalse &&
  allPass &&
  allEightScenarios &&
  allTeardownClean &&
  allTcpClosed &&
  allCleanupResult &&
  allDataDirClean &&
  noForcedExit &&
  noSpawnError &&
  noNoExit &&
  noExitNonzero &&
  noPassForced;

const verdict = NEGATIVE_PROBE
  ? allTimedOutFalse === false &&
    runs.some((r) => r.timedOut === true) &&
    runs.every((r) => r.outcome === 'TIMED_OUT') &&
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
  allPass,
  allEightScenarios,
  allTeardownClean,
  allTcpClosed,
  allCleanupResult,
  allDataDirClean,
  noForcedExit,
  noSpawnError,
  noNoExit,
  noExitNonzero,
  noPassForced,
  verdict,
  runs,
};
await writeFile(path.join(evidenceRunDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('[run-b02-isolated] evidence: ' + path.join(evidenceRunDir, 'summary.json'));
console.log(
  '[run-b02-isolated] verdict=' +
    summary.verdict +
    ' allRunsCompleted=' +
    allRunsCompleted +
    ' allExitZero=' +
    allExitZero +
    ' allTimedOutFalse=' +
    allTimedOutFalse +
    ' allPass=' +
    allPass +
    ' allEightScenarios=' +
    allEightScenarios +
    ' allTeardownClean=' +
    allTeardownClean +
    ' allTcpClosed=' +
    allTcpClosed +
    ' allCleanupResult=' +
    allCleanupResult +
    ' allDataDirClean=' +
    allDataDirClean +
    ' noForcedExit=' +
    noForcedExit +
    ' noSpawnError=' +
    noSpawnError +
    ' noNoExit=' +
    noNoExit +
    ' noExitNonzero=' +
    noExitNonzero +
    ' noPassForced=' +
    noPassForced,
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
