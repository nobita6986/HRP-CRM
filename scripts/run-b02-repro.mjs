/**
 * scripts/run-b02-repro.mjs -- T1-B round-3 / C3-04, C3-07, C3-08
 *
 * Fail-closed narrow reproducer runner.
 *
 * Each run:
 *   - uses a unique PG_HARNESS_SUFFIX
 *   - has a per-run timeout (60 s default, override via B02_REPRO_TIMEOUT_MS)
 *   - on timeout: scoped process-tree cleanup via pwsh (root + descendants
 *     + suffix-port listener, leaf-first kill), audit listener twice
 *   - emits structured evidence regardless of outcome
 *
 * Per-run exit code semantics for the underlying reproducer:
 *   0 = clean exit, repro_result JSON line emitted
 *   nonzero (incl. null on hang) = cleanup failure or crash
 *
 * Runner exit code:
 *   0 = GATE_PASS  (each run completed, classification CONFIRMED or NOT_CONFIRMED;
 *                   cleanup verified; no crash/timeout/NO_RESULT)
 *   1 = GATE_FAIL
 *
 * Output:
 *   apps/integration-worker/.b02-repro/<ts>/
 *     repro-N.stdout.txt   (REDACTED)
 *     repro-N.stderr.txt   (REDACTED)
 *     repro-N.meta.json    (REDACTED)
 *     summary.json
 */

import { spawn, execSync } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_DIR = path.resolve(__dirname, '..', 'apps', 'integration-worker');
const EVIDENCE_DIR = path.join(WORKER_DIR, '.b02-repro');
const NODE = process.execPath;
const RUN_COUNT = Number(process.env['B02_REPRO_COUNT'] ?? '3');
const RUN_TIMEOUT_MS = Number(process.env['B02_REPRO_TIMEOUT_MS'] ?? '60000');
const TREE_KILL_BUDGET_MS = Number(process.env['B02_REPRO_TREE_KILL_BUDGET_MS'] ?? '8000');
const AUDIT_DELAY_MS = Number(process.env['B02_REPRO_AUDIT_DELAY_MS'] ?? '500');
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
    return { available: false, lineHits: [], toolError: (e && e.message) || 'netstat failed' };
  }
  const lineHits = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/\s(127\.0\.0\.1|\[::\]):(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
    if (m) lineHits.push({ address: m[1], port: Number(m[2]), pid: Number(m[3]) });
  }
  return { available: true, lineHits };
}

function auditLeftovers(port) {
  const r = readSockets();
  if (!r.available) {
    return { ok: null, available: false, portHits: [], note: 'netstat unavailable: ' + r.toolError };
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

async function killTreeScoped(child, suffixPort) {
  const rootPid = child && child.pid ? child.pid : -1;
  const psPath = path.join(
    process.env['TEMP'] || process.env['TMP'] || '.',
    'repro-kill-' + rootPid + '-' + randomBytes(3).toString('hex') + '.ps1',
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
    `$killOrder = @()\n` +
    `foreach ($d in $descendants) { $killOrder += $d }\n` +
    `foreach ($p in $portOwners) { if (-not $killOrder.Contains([int]$p) -and [int]$p -ne $root) { $killOrder += $p } }\n` +
    `if ($root -gt 0) { $killOrder += $root }\n` +
    `$killed = @()\n` +
    `foreach ($p in $killOrder) {\n` +
    `  if ($p -le 0) { continue }\n` +
    `  Stop-Process -Id $p -Force -ErrorAction SilentlyContinue\n` +
    `  $killed += $p\n` +
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
      const t = line.trim();
      if (t.startsWith('KILLED=')) killed = t.slice(7).split(',').filter(Boolean).map(Number);
      else if (t.startsWith('DESCENDANTS='))
        descendants = t.slice(12).split(',').filter(Boolean).map(Number);
      else if (t.startsWith('PORTOWNERS='))
        portOwners = t.slice(11).split(',').filter(Boolean).map(Number);
      else if (t.startsWith('ROOT=')) root = Number(t.slice(5));
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
  return Promise.race([
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
      if (child.exitCode !== null && child.exitCode !== undefined) {
        onClose(child.exitCode, child.signalCode);
      } else if (child.killed || child.signalCode !== null) {
        onClose(null, child.signalCode);
      }
    }),
    new Promise((resolve) => {
      setTimeout(() => {
        if (!resolved) resolve({ kind: 'timeout' });
      }, timeoutMs);
    }),
  ]);
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
    child = spawn(NODE, ['tests/repro/receiver-503-race.test.mjs'], {
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

  // C3-03: audit listener TWICE after the child closes/kills.
  await new Promise((r) => setTimeout(r, AUDIT_DELAY_MS));
  const audit1 = auditLeftovers(port);
  let audit2 = auditLeftovers(port);
  if (audit2.ok === false && audit2.available) {
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
    kill: killResult,
    classification: reproResult ? reproResult.classification : 'NO_RESULT',
    observed: reproResult ? reproResult.observed : null,
    signature: reproResult ? reproResult.signature : null,
    teardownAudit: {
      immediatelyAfterExit: audit1,
      afterDelay: audit2,
      toolAvailable: audit1.available,
    },
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
      ' audit1.ok=' +
      r.teardownAudit.immediatelyAfterExit.ok +
      ' audit2.ok=' +
      r.teardownAudit.afterDelay.ok +
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
    r.teardownAudit.immediatelyAfterExit.ok === true &&
    r.teardownAudit.afterDelay.ok === true,
);
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
  allDataDirClean &&
  allClassificationHonest;

const verdict = NEGATIVE_PROBE
  ? runs.every((r) => r.outcome === 'TIMED_OUT') &&
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
  allRunsCompleted,
  allExitZero,
  allTimedOutFalse,
  allNoExit,
  allNoSpawn,
  allNoExitNonzero,
  allNoForced,
  allTeardownClean,
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
console.log(
  '[run-b02-repro] evidence: ' + path.join(evidenceRunDir, 'summary.json'),
);
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
    ' allDataDirClean=' +
    allDataDirClean,
);

const exitCode =
  summary.verdict === 'GATE_PASS'
    ? 0
    : summary.verdict === 'PROBE_PASS'
      ? 2
      : 1;
setImmediate(() => process.exit(exitCode));
