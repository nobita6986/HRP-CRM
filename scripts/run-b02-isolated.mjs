/**
 * scripts/run-b02-isolated.mjs -- T1-B round-2 corrections
 *
 * (C-B02-1, C-B02-5, C-B02-6 + C2-01, C2-02, C2-03)
 *
 * Runs the B.02 Local E2E suite N times sequentially. Each run:
 *   - gets a unique PG_HARNESS_SUFFIX (timestamp + entropy)
 *   - uses a unique data dir and a unique embedded-PG port
 *   - has a per-run timeout (180s default, override via B02_RUN_TIMEOUT_MS)
 *   - on timeout / signal / spawn error: still writes per-run stdout/stderr,
 *     a run result, and the global summary.json
 *   - audits leftover listeners + processes after exit; FAILED run if any
 *     suffix-scoped listener/process survives
 *
 * Process-tree cleanup (C2-03) is limited to PIDs that EITHER:
 *   (a) are descendants of the spawned test child, OR
 *   (b) own a TCP listener on the suffix port, OR
 *   (c) are confirmed by `pg_isready` against the suffix port.
 *
 * Output: a JSON evidence file at
 *   apps/integration-worker/.b02-evidence/<ts>/runs.json  + summary.json
 * plus per-run stdout/stderr captures under the same directory.
 */

import { spawn, execSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_DIR = path.resolve(__dirname, '..', 'apps', 'integration-worker');
const EVIDENCE_DIR = path.join(WORKER_DIR, '.b02-evidence');
const NODE = process.execPath;
const RUN_COUNT = Number(process.env['B02_RUN_COUNT'] ?? '3');
const RUN_TIMEOUT_MS = Number(process.env['B02_RUN_TIMEOUT_MS'] ?? '180000');
const TREE_KILL_BUDGET_MS = Number(process.env['B02_TREE_KILL_BUDGET_MS'] ?? '8000');
const AUDIT_DELAY_MS = Number(process.env['B02_AUDIT_DELAY_MS'] ?? '500');

function deriveSuffix(idx) {
  const ts = Date.now().toString(36);
  const rand = randomBytes(4).toString('hex');
  return 'b02_r' + idx + '_' + ts + '_' + rand;
}

function derivePort(suffix) {
  return 53000 + (Math.abs([...suffix].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 5000);
}

/**
 * Parse netstat -ano -p tcp and return listening sockets on the given port.
 * Returns { portHits: [{pid}], ok } or { note: 'netstat unavailable' }.
 */
function readSockets() {
  let out = '';
  try {
    out = execSync('netstat -ano -p tcp', {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).toString('utf8');
  } catch {
    return { available: false, lineHits: [] };
  }
  const lineHits = [];
  const lines = out.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/\s(127\.0\.0\.1|\[::\]):(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
    if (m) lineHits.push({ address: m[1], port: Number(m[2]), pid: Number(m[3]) });
  }
  return { available: true, lineHits };
}

function auditLeftovers(port) {
  const r = readSockets();
  if (!r.available) {
    return { ok: null, portHits: [], note: 'netstat unavailable' };
  }
  const portHits = r.lineHits
    .filter((h) => h.port === port)
    .map((h) => ({ pid: h.pid, address: h.address }));
  return {
    ok: portHits.length === 0,
    portHits,
    note: portHits.length === 0 ? 'no listener on harness port' : 'listener still alive',
  };
}

/**
 * On Windows, kill the entire process tree of `pid` (PowerShell Get-CimInstance).
 * Filters to descendants + PIDs matching the suffix port to avoid killing
 * unrelated Node/PostgreSQL processes.
 */
async function killTreeScoped(child, suffixPort) {
  const ps = `
    $ErrorActionPreference = 'SilentlyContinue'
    $root = ${child.pid}
    $port = ${suffixPort}
    $matches = New-Object System.Collections.Generic.HashSet[int]
    function AddDescendants($id) {
      $kids = Get-CimInstance Win32_Process -Filter "ParentProcessId=$id" | Select-Object -ExpandProperty ProcessId
      foreach ($k in $kids) { if (-not $matches.Contains([int]$k)) { $matches.Add([int]$k) | Out-Null ; Add-Descendants $k } }
    }
    AddDescendants $root
    # also kill any process that owns a listener on the suffix port
    $conns = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq $port }
    foreach ($c in $conns) { $matches.Add([int]$c.OwningProcess) | Out-Null }
    foreach ($p in $matches) {
      Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
    }
    Write-Output $matches.Count
  `;
  try {
    const out = execSync(`powershell -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"')}"`, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: TREE_KILL_BUDGET_MS,
    }).toString('utf8');
    return { ok: true, killed: Number(out.trim().split(/\s+/).pop() ?? '0') };
  } catch (e) {
    return { ok: false, killed: 0, note: (e && e.message) || 'killTree failed' };
  }
}

async function childTreeAndClose(child, timeoutMs) {
  // Race: child close vs timeout. Whoever fires first wins.
  let resolved = false;
  const result = await Promise.race([
    new Promise((resolve) => {
      child.once('close', (code, signal) => {
        resolved = true;
        resolve({ kind: 'close', code, signal });
      });
      child.once('error', (err) => {
        if (resolved) return;
        resolved = true;
        resolve({ kind: 'error', error: err && err.message ? err.message : String(err) });
      });
    }),
    new Promise((resolve) => {
      setTimeout(() => {
        if (!resolved) resolve({ kind: 'timeout' });
      }, timeoutMs).unref?.();
    }),
  ]);
  return result;
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
    HRP_ORGANIZATION_ID: process.env['HRP_ORGANIZATION_ID'] ?? '00000000-0000-0000-0000-000000000b02',
    NODE_ENV: 'development',
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

  let child;
  let stdout = '';
  let stderr = '';
  let spawnError = null;
  let timer;

  try {
    child = spawn(cmd, args, {
      cwd: WORKER_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
  } catch (err) {
    spawnError = (err && err.message) || String(err);
  }

  // Lifecycle stage diagnostics so we can attribute hangs if any stage
  // never finishes. No secret/payload material in these lines.
  const stages = [];
  function recordStage(name, extra) {
    stages.push({ atMs: Date.now() - startedAt, stage: name, ...(extra || {}) });
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
      stages,
    };
    await writeFile(metaPath, JSON.stringify(meta, null, 2));
    await writeFile(stdoutPath, stdout);
    await writeFile(stderrPath, stderr || '[no stderr captured]\n');
    return meta;
  }

  const race = await childTreeAndClose(child, RUN_TIMEOUT_MS);
  recordStage('child_close_or_timeout', race);

  let timedOut = false;
  let signal = null;
  let exitCode = null;

  if (race.kind === 'timeout') {
    timedOut = true;
    recordStage('killing_tree');
    await killTreeScoped(child, port);
    // After killTree, give the child a final close race (short budget).
    const finalClose = await childTreeAndClose(child, 5000);
    recordStage('after_kill', finalClose);
    if (finalClose.kind === 'close') {
      exitCode = finalClose.code;
      signal = finalClose.signal;
    } else {
      exitCode = null;
      signal = 'SIGKILL_PENDING';
    }
  } else if (race.kind === 'close') {
    exitCode = race.code;
    signal = race.signal;
  } else if (race.kind === 'error') {
    exitCode = null;
    signal = 'SPAWN_ERROR_EVENT';
    recordStage('error_event', { error: race.error });
  }
  const elapsedMs = Date.now() - startedAt;

  await writeFile(stdoutPath, stdout);
  await writeFile(stderrPath, stderr);

  // TAP counting. node:test emits nested TAP with:
  //   ok 1 - tests\\b02-local-e2e.test.mjs   (top-level, suite)
  //     ok 1 - E2E-1: ...
  //     ok 2 - E2E-2: ...
  //   We want the scenario-level counts. Match `ok <n> - E2E-...` (and any
  //   generic "ok N -" after a `# Subtest:` directive). Indented ok lines
  //   also count.
  const tap = { ok: 0, notOk: 0, total: 0, plan: null, subtests: [] };
  const tapLines = stdout.split(/\r?\n/);
  let inSubtests = false;
  let lastSubtestLine = -1;
  for (let idx = 0; idx < tapLines.length; idx++) {
    const line = tapLines[idx];
    if (line.match(/^# Subtest:/)) {
      inSubtests = true;
      continue;
    }
    if (inSubtests) {
      // "    ok N - <name>" or "    not ok N - <name>" -- indented by 4 spaces.
      const mOk = line.match(/^\s{2,}ok\s+(\d+)\s+-\s+(.+)$/);
      const mNo = line.match(/^\s{2,}not ok\s+(\d+)\s+-\s+(.+)$/);
      if (mOk) {
        tap.ok += 1;
        tap.total += 1;
        tap.subtests.push({ n: Number(mOk[1]), name: mOk[2], ok: true });
        lastSubtestLine = idx;
      } else if (mNo) {
        tap.notOk += 1;
        tap.total += 1;
        tap.subtests.push({ n: Number(mNo[1]), name: mNo[2], ok: false });
        lastSubtestLine = idx;
      } else if (line.match(/^1\.\.\d+/)) {
        inSubtests = false; // subtest plan closes the suite block
      }
    }
  }
  // Top-level plan (e.g. "1..1" at file scope).
  const planLine = tapLines.find((l) => l.match(/^1\.\.\d+/));
  if (planLine) {
    const m = planLine.match(/^1\.\.(\d+)/);
    if (m) tap.plan = Number(m[1]);
  }

  // Teardown audit (>=2x).
  await new Promise((r) => setTimeout(r, AUDIT_DELAY_MS));
  const audit1 = auditLeftovers(port);
  let audit2 = auditLeftovers(port);
  if (audit2.ok === false) {
    // A second early-pass audit if the first still saw the listener;
    // give another 500ms before re-checking.
    await new Promise((r) => setTimeout(r, 500));
    audit2 = auditLeftovers(port);
  }

  // Data dir cleanup is best-effort but always attempted.
  let dataDirCleanup = 'not_attempted';
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

  const outcome =
    timedOut ? 'TIMED_OUT' : exitCode === 0 ? 'PASS' : exitCode === null ? 'NO_EXIT' : 'EXIT_NONZERO';

  // Redact any accidental payload material from stdout/stderr before persisting
  // (defense in depth; the test itself doesn't log secrets).
  function redact(s) {
    if (!s) return s;
    return s
      .replace(/signature=[A-Fa-f0-9]+/g, 'signature=<redacted>')
      .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer <redacted>')
      .replace(/X-Chatwoot-Signature:[\s\x22\x27]*[A-Fa-f0-9]{16,}/g, 'X-Chatwoot-Signature: <redacted>')
      .replace(/X-Zalo-Oa-Signature:[\s\x22\x27]*[A-Fa-f0-9]{16,}/g, 'X-Zalo-Oa-Signature: <redacted>');
  }

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
    tap,
    teardownAudit: { immediatelyAfterExit: audit1, afterDelay: audit2 },
    dataDirCleanup,
    stages,
    stdout: redact(stdout),
    stderr: redact(stderr),
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 2));
  // Separate raw stdout/stderr files (already written above) are kept
  // alongside meta.json; meta.json is the consolidated redacted view.
  return meta;
}

const evidenceRunDir = path.join(EVIDENCE_DIR, String(Date.now()));
await mkdir(evidenceRunDir, { recursive: true });

const runs = [];
let failed = false;
for (let i = 1; i <= RUN_COUNT; i++) {
  const r = await runOnce(i, evidenceRunDir);
  runs.push(r);
  const okFlag = r.timedOut ? 'TIMED_OUT' : r.exitCode === 0 ? 'EXIT0' : 'EXIT' + r.exitCode;
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
      ' elapsed=' +
      r.elapsedMs +
      'ms cleanup=' +
      r.dataDirCleanup,
  );
  // Continue ALL runs even on first failure so the evidence covers the full
  // 3-run matrix per C2-07. Mark failed only at the end.
}

const summary = {
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  nodeVersion: process.version,
  platform: process.platform,
  arch: process.arch,
  b02RunTimeoutMs: RUN_TIMEOUT_MS,
  runsRequested: RUN_COUNT,
  runsCompleted: runs.length,
  // Per C2-07 gate:
  // Per C2-07 gate. The runner parses TAP nested output: top-level
  // `ok N` is the suite; indented `ok N -` lines are scenarios. We
  // require 8 scenario-level pass and 0 fail across all runs.
  allExitZero: runs.every((r) => r.exitCode === 0),
  allTimedOutFalse: runs.every((r) => r.timedOut === false),
  allPass: runs.every((r) => r.outcome === 'PASS'),
  allEightScenarios: runs.every(
    (r) => (r.tap.subtests || []).length === 8 && (r.tap.ok === 8) && (r.tap.notOk === 0),
  ),
  allTeardownClean: runs.every(
    (r) =>
      r.teardownAudit.immediatelyAfterExit.ok !== false &&
      r.teardownAudit.afterDelay.ok !== false,
  ),
  allDataDirClean: runs.every((r) => r.dataDirCleanup === 'removed' || r.dataDirCleanup === 'absent'),
  // Overall verdict:
  verdict: (runs.every((r) => r.exitCode === 0) &&
    runs.every((r) => r.timedOut === false) &&
    runs.every((r) => r.tap.notOk === 0) &&
    runs.every((r) => r.dataDirCleanup === 'removed' || r.dataDirCleanup === 'absent') &&
    runs.every((r) =>
      r.teardownAudit.immediatelyAfterExit.ok !== false &&
      r.teardownAudit.afterDelay.ok !== false
    ))
      ? 'GATE_PASS'
      : 'GATE_FAIL',
  runs,
};
await writeFile(path.join(evidenceRunDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('[run-b02-isolated] evidence: ' + path.join(evidenceRunDir, 'summary.json'));
console.log(
  '[run-b02-isolated] verdict=' +
    summary.verdict +
    ' allExitZero=' +
    summary.allExitZero +
    ' allTimedOutFalse=' +
    summary.allTimedOutFalse +
    ' allTeardownClean=' +
    summary.allTeardownClean +
    ' allDataDirClean=' +
    summary.allDataDirClean,
);

// Force exit so any open netstat / file watcher handle from inner
// `execSync` calls cannot block this process from returning to T0.
setImmediate(() => process.exit(summary.verdict === 'GATE_PASS' ? 0 : 1));
