/**
 * scripts/run-b02-isolated.mjs -- T1-B round-3 corrections
 *
 * (C3-01 .. C3-09) Fail-closed B.02 Local E2E isolated gate.
 *
 * Each run:
 *   - gets a unique PG_HARNESS_SUFFIX (timestamp + entropy)
 *   - uses a unique data dir and a unique embedded-PG port
 *   - has a per-run timeout (180 s default, override via B02_RUN_TIMEOUT_MS)
 *   - on timeout / signal / spawn error: still writes per-run
 *     stdout/stderr (REDACTED), meta, and the global summary.json
 *   - audits leftover listeners after exit; FAILS the run if any
 *     suffix-scoped listener persists
 *
 * Process-tree cleanup (C3-03) is limited to PIDs that EITHER:
 *   (a) are descendants of the spawned test child, OR
 *   (b) own a TCP listener on the suffix port.
 * Root child PID is always included. Descendants are collected BEFORE
 * any kill, and killed leaf-first so the Win32_Process tree stays
 * walkable. After kill we audit the listener TWICE.
 *
 * GATE_PASS (C3-01) requires ALL of:
 *   - runsCompleted === runsRequested
 *   - allExitZero === true
 *   - allTimedOutFalse === true
 *   - allPass === true
 *   - allEightScenarios === true  (each run has 8 subtests, 0 notOk)
 *   - allTeardownClean === true   (each audit1 && audit2 ok === true)
 *   - allDataDirClean === true
 *   - no run had forcedExit / noSpawnError / noExit / spawnError
 *
 * Anything else => GATE_FAIL. The fields allExitZero, allTimedOutFalse,
 * allPass, allEightScenarios, allTeardownClean, allDataDirClean are
 * included in summary.json for T0 inspection; they are NOT used as a
 * fallback "verdict when convenient".
 *
 * Output:
 *   apps/integration-worker/.b02-evidence/<ts>/
 *     run-N.stdout.txt   (REDACTED)
 *     run-N.stderr.txt   (REDACTED)
 *     run-N.meta.json    (REDACTED)
 *     summary.json
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
// Negative-probe flag (C3-07). When true, the runner expects every run
// to be a controlled timeout and produces GATE_FAIL accordingly.
const NEGATIVE_PROBE = process.env['B02_NEGATIVE_PROBE'] === '1';

function deriveSuffix(idx) {
  const ts = Date.now().toString(36);
  const rand = randomBytes(4).toString('hex');
  return 'b02_r' + idx + '_' + ts + '_' + rand;
}

function derivePort(suffix) {
  return 53000 + (Math.abs([...suffix].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 5000);
}

/**
 * Redact any accidental payload material BEFORE persisting. The test
 * itself does not log secrets; this is defense in depth (C3-06).
 *   - signature=<hex>
 *   - Bearer <token>
 *   - X-Chatwoot-Signature: <hex>
 *   - X-Zalo-Oa-Signature: <hex>
 *   - Authorization: <scheme> <token>
 *   - HMAC=...
 */
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

/**
 * Parse netstat -ano -p tcp and return listening sockets on the given
 * port. Returns { available, lineHits }.
 *
 * C3-02: netstat unavailable is reported as `available: false`. Callers
 * MUST treat that as a FAIL, never as a clean pass.
 */
function readSockets() {
  let out = '';
  try {
    out = execSync('netstat -ano -p tcp', {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 8 * 1024 * 1024,
    }).toString('utf8');
  } catch (e) {
    return {
      available: false,
      lineHits: [],
      toolError: (e && e.message) || 'netstat failed',
    };
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
    return {
      ok: null, // null = unknown => C3-02 fail-closed semantics
      available: false,
      portHits: [],
      note: 'netstat unavailable: ' + r.toolError,
    };
  }
  const portHits = r.lineHits
    .filter((h) => h.port === port)
    .map((h) => ({ pid: h.pid, address: h.address }));
  return {
    ok: portHits.length === 0,
    available: true,
    portHits,
    note: portHits.length === 0 ? 'no listener on harness port' : 'listener still alive',
  };
}

/**
 * C3-03: Scoped process-tree cleanup.
 *
 * - Uses `pwsh` (not `powershell.exe`) so the same script works in
 *   minimal environments without the legacy Windows PowerShell host.
 * - Adds the root child PID (`-1` if no pid available) into the set.
 * - Collects the full descendant set BEFORE killing so we never walk
 *   a tree that we just broke.
 * - Removes the root PID from the descendant list (descendant set
 *   contains only non-root PIDs) and kills in REVERSE order so the
 *   deepest leaves die first.
 * - Includes any PID that owns a LISTEN socket on the suffix port.
 * - Reports the kill set back to the runner for evidence.
 */
async function killTreeScoped(child, suffixPort) {
  const rootPid = child && child.pid ? child.pid : -1;
  // ps1 written to a temp file to avoid quoting issues with -Command.
  const psPath = path.join(
    process.env['TEMP'] || process.env['TMP'] || '.',
    'b02-kill-' + rootPid + '-' + randomBytes(3).toString('hex') + '.ps1',
  );
  const psBody =
    `$ErrorActionPreference = 'SilentlyContinue'\n` +
    `$root = ${rootPid}\n` +
    `$port = ${suffixPort}\n` +
    `$descendants = New-Object System.Collections.Generic.List[int]\n` +
    `$visited = New-Object System.Collections.Generic.HashSet[int]\n` +
    `function Collect($id) {\n` +
    `  if ($visited.Contains([int]$id)) { return }\n` +
    `  $visited.Add([int]$id) | Out-Null\n` +
    `  $kids = Get-CimInstance Win32_Process -Filter "ParentProcessId=$id" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessId\n` +
    `  foreach ($k in $kids) { if ($k -ne $null) { $descendants.Add([int]$k); Collect $k } }\n` +
    `}\n` +
    `if ($root -gt 0) { Collect $root }\n` +
    `$portOwners = New-Object System.Collections.Generic.List[int]\n` +
    `$conns = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq $port }\n` +
    `foreach ($c in $conns) { $portOwners.Add([int]$c.OwningProcess) }\n` +
    `# Build leaf-first kill order: descendants deepest first, then port owners, then root.\n` +
    `$killOrder = @()\n` +
    `foreach ($d in $descendants) { $killOrder += $d }\n` +
    `foreach ($p in $portOwners) { if (-not $killOrder.Contains([int]$p) -and [int]$p -ne $root) { $killOrder += $p } }\n` +
    `if ($root -gt 0) { $killOrder += $root }\n` +
    `$killed = @()\n` +
    `foreach ($p in $killOrder) {\n` +
    `  if ($p -le 0) { continue }\n` +
    `  $ok = Stop-Process -Id $p -Force -ErrorAction SilentlyContinue\n` +
    `  if ($?) { $killed += $p }\n` +
    `}\n` +
    `Write-Output ('KILLED=' + ($killed -join ','))\n` +
    `Write-Output ('DESCENDANTS=' + ($descendants -join ','))\n` +
    `Write-Output ('PORTOWNERS=' + ($portOwners -join ','))\n` +
    `Write-Output ('ROOT=' + $root)\n`;
  const fs = await import('node:fs/promises');
  await fs.writeFile(psPath, psBody, 'utf8');
  try {
    const out = execSync(`pwsh -NoProfile -NonInteractive -File "${psPath}"`, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: TREE_KILL_BUDGET_MS,
    }).toString('utf8');
    let killed = [];
    let descendants = [];
    let portOwners = [];
    let root = -1;
    for (const line of out.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('KILLED=')) {
        killed = trimmed.slice(7).split(',').filter(Boolean).map((s) => Number(s));
      } else if (trimmed.startsWith('DESCENDANTS=')) {
        descendants = trimmed.slice(12).split(',').filter(Boolean).map((s) => Number(s));
      } else if (trimmed.startsWith('PORTOWNERS=')) {
        portOwners = trimmed.slice(11).split(',').filter(Boolean).map((s) => Number(s));
      } else if (trimmed.startsWith('ROOT=')) {
        root = Number(trimmed.slice(5));
      }
    }
    return { ok: true, root, descendants, portOwners, killed };
  } catch (e) {
    return { ok: false, killed: [], error: (e && e.message) || 'killTree failed' };
  } finally {
    await fs.rm(psPath, { force: true }).catch(() => {});
  }
}

async function childTreeAndClose(child, timeoutMs) {
  let resolved = false;
  const result = await Promise.race([
    new Promise((resolve) => {
      const onClose = (code, signal) => {
        if (resolved) return;
        resolved = true;
        resolve({ kind: 'close', code, signal });
      };
      const onError = (err) => {
        if (resolved) return;
        resolved = true;
        resolve({ kind: 'error', error: (err && err.message) ? err.message : String(err) });
      };
      child.once('close', onClose);
      child.once('error', onError);
      // If child already exited before we attached, synthesize 'close'.
      if (child.exitCode !== null && child.exitCode !== undefined) {
        onClose(child.exitCode, child.signalCode);
      } else if (child.killed || child.signalCode !== null) {
        onClose(null, child.signalCode);
      }
    }),
    new Promise((resolve) => {
      // NOT unref'd: we need this timer to keep the event loop alive
      // while we wait for the child handle to fire close after an
      // external kill. Without ref, Node may exit prematurely when
      // only the timer is keeping us going (uncommon but seen on
      // Windows after Stop-Process).
      setTimeout(() => {
        if (!resolved) resolve({ kind: 'timeout' });
      }, timeoutMs);
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
    HRP_ORGANIZATION_ID:
      process.env['HRP_ORGANIZATION_ID'] ?? '00000000-0000-0000-0000-000000000b02',
    NODE_ENV: 'development',
    B02_RUN_TIMEOUT_MS: String(RUN_TIMEOUT_MS),
    B02_HARD_EXIT_DELAY_MS: process.env['B02_HARD_EXIT_DELAY_MS'] ?? '5000',
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
    child = spawn(cmd, args, {
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
    // C3-06: redact BEFORE writing. No raw stdout/stderr files on disk.
    await writeFile(stdoutPath, meta.stdout);
    await writeFile(stderrPath, meta.stderr);
    await writeFile(metaPath, JSON.stringify(meta, null, 2));
    return meta;
  }

  const race = await childTreeAndClose(child, RUN_TIMEOUT_MS);
  recordStage('child_close_or_timeout', race);

  let timedOut = false;
  let signal = null;
  let exitCode = null;
  let noExit = false;
  let killResult = null;

  if (race.kind === 'timeout') {
    timedOut = true;
    recordStage('killing_tree');
    killResult = await killTreeScoped(child, port);
    recordStage('after_kill', { killedCount: killResult.killed ? killResult.killed.length : 0 });
    // After killTree, give the child a final close race (short budget).
    const finalClose = await childTreeAndClose(child, 5000);
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

  // C3-03: audit listener TWICE after the child closes/kills.
  await new Promise((r) => setTimeout(r, AUDIT_DELAY_MS));
  const audit1 = auditLeftovers(port);
  let audit2 = auditLeftovers(port);
  if (audit2.ok === false && audit2.available) {
    // Listener still alive after first audit; give OS another 500 ms
    // before re-checking.
    await new Promise((r) => setTimeout(r, 500));
    audit2 = auditLeftovers(port);
  }

  // Data dir cleanup.
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

  // C3-05: forcedExit detection. The test process can only emit a
  // hard-exit guard (kind=hard_exit_guard) when something kept the
  // event loop alive after teardown. That is NOT a clean exit.
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
    kill: killResult,
    tap,
    teardownAudit: {
      immediatelyAfterExit: audit1,
      afterDelay: audit2,
      toolAvailable: audit1.available,
    },
    dataDirCleanup,
    stages,
    // C3-06: redacted at source. No raw stdout/stderr persisted.
    stdout: redact(stdoutRaw),
    stderr: redact(stderrRaw),
  };

  // C3-06: write REDACTED outputs, never the raw bytes.
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
      ' audit1.ok=' +
      r.teardownAudit.immediatelyAfterExit.ok +
      ' audit2.ok=' +
      r.teardownAudit.afterDelay.ok +
      ' elapsed=' +
      r.elapsedMs +
      'ms cleanup=' +
      r.dataDirCleanup,
  );
}

// C3-01: each condition computed explicitly, never re-derived from
// each other. The verdict is the conjunction of all required fields.
const runsCompleted = runs.length;
const runsRequested = RUN_COUNT;
const allRunsCompleted = runsCompleted === runsRequested;
const allExitZero = runs.every((r) => r.exitCode === 0);
const allTimedOutFalse = runs.every((r) => r.timedOut === false);
const allPass = runs.every((r) => r.outcome === 'PASS');
const allEightScenarios = runs.every(
  (r) => (r.tap.subtests || []).length === 8 && r.tap.ok === 8 && r.tap.notOk === 0,
);
// C3-02: teardown audit must be ok === true on BOTH passes. ok === null
// (netstat unavailable) is a FAIL, not a clean pass.
const allTeardownClean = runs.every(
  (r) =>
    r.teardownAudit.immediatelyAfterExit.ok === true &&
    r.teardownAudit.afterDelay.ok === true,
);
const allDataDirClean = runs.every(
  (r) => r.dataDirCleanup === 'removed' || r.dataDirCleanup === 'absent',
);
const noForcedExit = runs.every((r) => r.forcedExit === false);
const noSpawnError = runs.every((r) => r.outcome !== 'SPAWN_ERROR');
const noNoExit = runs.every((r) => r.noExit !== true);
const noExitNonzero = runs.every((r) => r.outcome !== 'EXIT_NONZERO');
const noPassForced = runs.every((r) => r.outcome !== 'PASS_FORCED_EXIT');

// C3-01 + C3-07: gate verdict. NEGATIVE_PROBE mode inverts: every
// condition that says "clean" must FAIL (timedOut, exitCode, etc).
const allClean =
  allRunsCompleted &&
  allExitZero &&
  allTimedOutFalse &&
  allPass &&
  allEightScenarios &&
  allTeardownClean &&
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
  // C3-01: every field a separate boolean; all are part of the verdict.
  allRunsCompleted,
  allExitZero,
  allTimedOutFalse,
  allPass,
  allEightScenarios,
  allTeardownClean,
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
console.log(
  '[run-b02-isolated] evidence: ' + path.join(evidenceRunDir, 'summary.json'),
);
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

// Force exit so any open netstat / file watcher handle from inner
// `execSync` calls cannot block this process from returning to T0.
// We DO NOT use a non-zero exit here; the verdict is already computed.
// Negative probe convention:
//   PROBE_PASS => exit 2 (nonzero, signals "timeout path was exercised")
//   PROBE_FAIL => exit 1 (nonzero, signals "timeout path did not work")
//   GATE_PASS  => exit 0
//   GATE_FAIL  => exit 1
// Per C3-07: expected runner exit is nonzero when negative-probe mode
// is on (PROBE_PASS is still nonzero so T0's automation can detect a
// successful negative probe distinctly from a positive gate pass).
const exitCode =
  summary.verdict === 'GATE_PASS'
    ? 0
    : summary.verdict === 'PROBE_PASS'
      ? 2
      : 1;
setImmediate(() => process.exit(exitCode));
