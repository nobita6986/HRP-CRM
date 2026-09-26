/**
 * scripts/b02-cleanup.mjs -- T1-B round-5 (R5-02..R5-05) shared helper.
 *
 * Process-tree + suffix-port cleanup, audited, with bounded subprocesses.
 *
 * Design (per T0 R5-02 / R5-03 / R5-04 / R5-05):
 *   - killTreeScoped() uses ONLY:
 *       * taskkill /PID <rootPid> /T /F   (terminate the spawned test tree)
 *       * netstat -ano -p tcp             (parse exact suffix-port owner)
 *       * taskkill /PID <portOwner> /T /F (terminate ONLY that PID, after
 *         refreshing the PID if the prior owner is gone)
 *       * pg_ctl stop -m fast -D <dataDir> (R5-04 fallback when an orphan
 *         PostgreSQL still holds the port — only on data dirs whose
 *         basename starts with `.tmp_pgdata_worker_` and that resolve
 *         under the worktree).
 *       * net.createConnection() to 127.0.0.1:<port> (R5-03 connectability
 *         probe — the listener is only proven gone when the OS rejects
 *         the SYN).
 *   - No CIM, no WMI, no PowerShell enumeration. taskkill is bundled
 *     with Windows and has its own internal process-tree walk (/T) and
 *     force semantics (/F) without any script-host indirection.
 *   - Every subprocess has its own short timeout (NETSTAT_TIMEOUT_MS,
 *     TASKKILL_TIMEOUT_MS, PG_CTL_TIMEOUT_MS). On timeout the helper
 *     returns a fail-closed result and the runner records the failure.
 *   - Bounded port-close polling (R5-02): the helper polls the suffix
 *     port for up to PORT_CLOSE_POLL_TIMEOUT_MS (default 15 s) before
 *     triggering aggressive fallback. Two consecutive clean audits
 *     (netstat available=true && port closed=true && TCP connect fails)
 *     are required for PASS.
 *   - Best-effort cleanup (R5-05): killTreeScoped NEVER returns early.
 *     The full chain executes even on failure; the final filesystem
 *     and port audit always runs. Failure stages are recorded but the
 *     verdict remains GATE_FAIL (FAIL-closed).
 *   - PID-not-found semantics (R5-03): taskkill code 128 means the
 *     specified PID is no longer in the process table — it does NOT
 *     prove the listening socket is gone. If netstat still shows a
 *     listener, the helper refreshes the owner PID from netstat and
 *     retries exact-owner cleanup with bounds. Only when TCP connect
 *     also fails (in addition to netstat) is the listener declared
 *     gone.
 *
 * Output: same evidence directory used by the runner.
 */

import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createConnection } from 'node:net';

// Bounded subprocess budgets. These are intentionally short because we
// are probing already-known values (root PID, exact suffix port); if
// the probe hangs, the underlying state is broken and the runner
// should fail fast.
const NETSTAT_TIMEOUT_MS = 5_000;
const TASKKILL_TIMEOUT_MS = 8_000;
const PG_CTL_TIMEOUT_MS = 8_000;
const AUDIT_GAP_MS = 500;

// R5-02: bounded port-close polling budget. 15 s is the brief's
// recommended upper bound. The poll is exercised twice (after the
// initial taskkill burst and after the PostgreSQL fallback) so the
// TOTAL time the helper can spend waiting for a port to close is
// bounded by 2 * PORT_CLOSE_POLL_TIMEOUT_MS.
const PORT_CLOSE_POLL_TIMEOUT_MS = 15_000;
const PORT_CLOSE_POLL_INTERVAL_MS = 250;

// R5-03: TCP connect probe budget. A successful SYN+ACK must be
// negated within this budget to count as "connectable". 2 s is more
// than enough for a local 127.0.0.1 listener.
const TCP_PROBE_TIMEOUT_MS = 2_000;

// R5-04: maximum allowed PostgreSQL pg_ctl stop fallback attempts.
const PG_CTL_FALLBACK_MAX_ATTEMPTS = 2;

function classifyExecError(e) {
  if (!e) return 'unknown';
  const msg = (e && (e.message || String(e))) || '';
  const low = msg.toLowerCase();
  if (low.includes('timeout') || low.includes('timed out')) return 'timeout';
  if (low.includes('enoent') || low.includes('not found')) return 'missing_tool';
  if (low.includes('eperm') || low.includes('eacces') || low.includes('access is denied'))
    return 'access_denied';
  return 'spawn_error';
}

/**
 * Run netstat -ano -p tcp with a bounded budget. Returns:
 *   { available: true,  portHits: [{ pid, address }], durationMs }
 *   { available: false, errorCategory, errorMessage, durationMs }
 */
export function readSockets() {
  const startedAt = Date.now();
  let out = '';
  try {
    out = execFileSync('netstat', ['-ano', '-p', 'tcp'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: NETSTAT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      encoding: 'utf8',
    });
  } catch (e) {
    return {
      available: false,
      portHits: [],
      durationMs: Date.now() - startedAt,
      errorCategory: classifyExecError(e),
      errorMessage: (e && (e.message || String(e))) || 'netstat failed',
    };
  }
  const portHits = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/\s(127\.0\.0\.1|\[::\]):(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
    if (m) portHits.push({ address: m[1], port: Number(m[2]), pid: Number(m[3]) });
  }
  return { available: true, portHits, durationMs: Date.now() - startedAt };
}

/**
 * Audit a single port. Returns:
 *   { available: true,  closed: true | false, ownerPid?, address?, durationMs, portHits }
 *   { available: false, closed: null, errorCategory, durationMs, portHits, note }
 */
export function auditLeftovers(port) {
  const r = readSockets();
  if (!r.available) {
    return {
      available: false,
      closed: null, // null = unknown => fail-closed
      errorCategory: r.errorCategory,
      durationMs: r.durationMs,
      portHits: [],
      note: 'netstat unavailable: ' + r.errorCategory,
    };
  }
  const hits = r.portHits.filter((h) => h.port === port);
  if (hits.length === 0) {
    return { available: true, closed: true, durationMs: r.durationMs, portHits: [] };
  }
  return {
    available: true,
    closed: false,
    ownerPid: hits[0].pid,
    address: hits[0].address,
    durationMs: r.durationMs,
    portHits: hits,
  };
}

/**
 * Run a taskkill with bounded timeout. Returns:
 *   { ok: true,  code: number, stdout, stderr, durationMs }
 *   { ok: true,  alreadyGone: true, code: 128, stdout, stderr, durationMs }
 *   { ok: false, category, message, code, stdout, stderr, durationMs }
 *
 * Codes:
 *   0   = taskkill reported the process was terminated.
 *   128 = the PID was not found (we treat this as "already gone"; it
 *         does NOT prove the listening socket is gone — see R5-03).
 *   any other non-zero = real failure.
 */
export function runTaskkill(args, timeoutMs) {
  const startedAt = Date.now();
  let stdout = '';
  let stderr = '';
  let code = -1;
  try {
    const buf = execFileSync('taskkill', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: timeoutMs != null ? timeoutMs : TASKKILL_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
    });
    code = 0;
    stdout = buf || '';
  } catch (e) {
    code = (e && typeof e.status === 'number') ? e.status : -1;
    stderr = (e && e.stderr && e.stderr.toString()) || '';
    stdout = (e && e.stdout && e.stdout.toString()) || '';
    if (code === 128) {
      // R6-07: code 128 means the PID is no longer in the OS process
      // table — the OS reports it as not found. This is the
      // already-gone / stale-PID case the cleanup helper relies on.
      return {
        ok: true,
        alreadyGone: true,
        code,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      };
    }
    // R6-07: Windows taskkill /T /F exits 255 when at least one
    // descendant PID was already gone by the time the tree walk
    // reached it. The root tree may still be fully terminated — check
    // stdout for SUCCESS lines and consider the call a partial pass
    // (alreadyGone=false because the call itself errored, but
    // partialSuccess=true so the caller can avoid setting a failure
    // stage for the root kill when the tree actually died).
    const partialSuccess = /SUCCESS:\s+The process with PID \d+/.test(stdout);
    if (partialSuccess) {
      return {
        ok: true,
        alreadyGone: false,
        partialSuccess: true,
        code,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      };
    }
    return {
      ok: false,
      category: classifyExecError(e),
      message: (e && (e.message || String(e))) || 'taskkill failed',
      code,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt,
    };
  }
  return { ok: true, code, stdout, stderr, durationMs: Date.now() - startedAt };
}

/**
 * Verify a process still exists. Uses `tasklist /FI "PID eq <pid>"`.
 * Bounded. Returns:
 *   { exists: true | false, durationMs, errorCategory? }
 */
export function pidExists(pid) {
  if (pid == null || pid <= 0) return { exists: false, durationMs: 0 };
  const startedAt = Date.now();
  try {
    const out = execFileSync(
      'tasklist',
      ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        timeout: TASKKILL_TIMEOUT_MS,
        maxBuffer: 1 * 1024 * 1024,
        encoding: 'utf8',
      },
    );
    const stripped = (out || '').trim();
    if (/no tasks/i.test(stripped) || stripped.length === 0) {
      return { exists: false, durationMs: Date.now() - startedAt };
    }
    return { exists: true, durationMs: Date.now() - startedAt };
  } catch (e) {
    return {
      exists: null,
      durationMs: Date.now() - startedAt,
      errorCategory: classifyExecError(e),
      message: (e && (e.message || String(e))) || 'tasklist failed',
    };
  }
}

/**
 * R5-03: active TCP connectability probe.
 *
 * The OS kernel is the source of truth: if `127.0.0.1:<port>` accepts
 * a SYN within TCP_PROBE_TIMEOUT_MS, the port IS listening regardless
 * of what netstat claims. This is the secondary proof required by R5-03
 * to declare a listener gone.
 *
 * Returns:
 *   { connectable: true,  durationMs }  -- SYN accepted (port LISTENING)
 *   { connectable: false, durationMs, errorCategory }  -- RST/timeout
 */
export function tcpProbeConnect(port, timeoutMs) {
  const budget = timeoutMs != null ? timeoutMs : TCP_PROBE_TIMEOUT_MS;
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve({ ...result, durationMs: Date.now() - startedAt });
    };
    let sock;
    try {
      sock = createConnection({ host: '127.0.0.1', port });
    } catch (e) {
      settle({
        connectable: false,
        errorCategory: classifyExecError(e),
        note: 'createConnection threw: ' + ((e && e.message) || String(e)),
      });
      return;
    }
    const timer = setTimeout(() => {
      try { sock.destroy(); } catch {}
      settle({
        connectable: false,
        errorCategory: 'timeout',
        note: 'TCP probe timed out after ' + budget + 'ms',
      });
    }, budget);
    sock.once('connect', () => {
      clearTimeout(timer);
      try { sock.end(); } catch {}
      settle({ connectable: true });
    });
    sock.once('error', (err) => {
      clearTimeout(timer);
      settle({
        connectable: false,
        errorCategory: classifyExecError(err),
        note: 'TCP probe rejected: ' + ((err && err.message) || String(err)),
      });
    });
  });
}

/**
 * R5-02: bounded wait for a port to become closed.
 *
 * Polls `auditLeftovers(port)` and `tcpProbeConnect(port)` until BOTH
 * report closed/connectable=false, or the deadline expires. Records
 * the inter-observation gap on every iteration.
 *
 * Returns:
 *   { ok: true,  iterations, elapsedMs, finalAudit, finalProbe }
 *   { ok: false, iterations, elapsedMs, finalAudit, finalProbe, reason }
 */
/**
 * R6-05 fix: bounded port-close polling.
 *
 *   - `startedAt` is captured ONCE at function entry.
 *   - `elapsedMs` is always `Date.now() - startedAt` — never reset per
 *     loop iteration, so a `deadline_exceeded` reports the full budget
 *     used, not just the last poll cycle.
 *   - Every return carries `timeoutBudgetMs`, `pollIntervalMs`,
 *     `iterations`, `elapsedMs`, `finalAudit`, `finalProbe`, `reason`.
 *
 * Returns:
 *   {
 *     ok: true|false,
 *     iterations,
 *     elapsedMs,
 *     timeoutBudgetMs,
 *     pollIntervalMs,
 *     finalAudit,
 *     finalProbe,
 *     reason,
 *   }
 */
export async function boundedWaitPortClosed(port, timeoutMs) {
  const budget = timeoutMs != null ? timeoutMs : PORT_CLOSE_POLL_TIMEOUT_MS;
  const interval = PORT_CLOSE_POLL_INTERVAL_MS;
  const startedAt = Date.now();
  const deadline = startedAt + budget;
  let iterations = 0;
  let lastAudit = null;
  let lastProbe = null;
  while (Date.now() < deadline) {
    iterations += 1;
    const audit = auditLeftovers(port);
    lastAudit = audit;
    if (audit.available === false) {
      lastProbe = null;
      return {
        ok: false,
        iterations,
        elapsedMs: Date.now() - startedAt,
        timeoutBudgetMs: budget,
        pollIntervalMs: interval,
        finalAudit: audit,
        finalProbe: lastProbe,
        reason: 'netstat_unavailable',
      };
    }
    if (audit.closed === true) {
      const probe = await tcpProbeConnect(port);
      lastProbe = probe;
      if (probe.connectable === false) {
        return {
          ok: true,
          iterations,
          elapsedMs: Date.now() - startedAt,
          timeoutBudgetMs: budget,
          pollIntervalMs: interval,
          finalAudit: audit,
          finalProbe: probe,
          reason: 'port_closed',
        };
      }
    } else {
      // Still listening — periodically cross-check TCP so the deadline
      // path reflects both netstat AND TCP evidence.
      if (iterations % 4 === 1) {
        lastProbe = await tcpProbeConnect(port);
      }
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  return {
    ok: false,
    iterations,
    elapsedMs: Date.now() - startedAt,
    timeoutBudgetMs: budget,
    pollIntervalMs: interval,
    finalAudit: lastAudit,
    finalProbe: lastProbe,
    reason: 'deadline_exceeded',
  };
}

/**
 * R5-04: locate a `pg_ctl.exe` shipped by the embedded-postgres
 * windows-x64 native package.
 *
 * Search roots (first hit wins):
 *   - <worktree>/apps/integration-worker/node_modules/@embedded-postgres/windows-x64/native/bin
 *   - <worktree>/apps/integration-api/node_modules/@embedded-postgres/windows-x64/native/bin
 *   - <worktree>/node_modules/@embedded-postgres/windows-x64/native/bin
 *
 * Returns the absolute path string or null if not found. Does NOT
 * verify the binary exists on disk — caller should `existsSync` before
 * invoking.
 */
export function findEmbeddedPgCtl({ worktreeCwd }) {
  const roots = [
    path.resolve(worktreeCwd, 'apps/integration-worker/node_modules/@embedded-postgres/windows-x64/native/bin'),
    path.resolve(worktreeCwd, 'apps/integration-api/node_modules/@embedded-postgres/windows-x64/native/bin'),
    path.resolve(worktreeCwd, 'node_modules/@embedded-postgres/windows-x64/native/bin'),
  ];
  for (const root of roots) {
    const candidate = path.join(root, 'pg_ctl.exe');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * R5-04: invoke `pg_ctl stop -m fast -D <dataDir>` with a bounded
 * timeout.
 *
 * Returns:
 *   { ok: true,  code, stdout, stderr, durationMs, method }
 *   { ok: false, category, message, durationMs, method }
 *
 * Callers MUST validate `dataDir` is rooted under the worktree and
 * matches the `.tmp_pgdata_worker_*` naming convention before calling
 * — that guard is intentionally NOT done here so this function stays
 * composable for tests that pass synthetic dirs.
 */
export function runPgCtlStop({ pgCtlPath, dataDir, timeoutMs }) {
  const startedAt = Date.now();
  const method = 'pg_ctl_stop';
  let stdout = '';
  let stderr = '';
  let code = -1;
  try {
    const buf = execFileSync(
      pgCtlPath,
      ['stop', '-m', 'fast', '-D', dataDir, '-w'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        timeout: timeoutMs != null ? timeoutMs : PG_CTL_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf8',
      },
    );
    code = 0;
    stdout = buf || '';
  } catch (e) {
    code = (e && typeof e.status === 'number') ? e.status : -1;
    stderr = (e && e.stderr && e.stderr.toString()) || '';
    stdout = (e && e.stdout && e.stdout.toString()) || '';
    return {
      ok: false,
      category: classifyExecError(e),
      message: (e && (e.message || String(e))) || 'pg_ctl stop failed',
      code,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt,
      method,
    };
  }
  return { ok: true, code, stdout, stderr, durationMs: Date.now() - startedAt, method };
}

/**
 * R6-03: validate that a dataDir belongs to the worktree AND is usable
 * by `pg_ctl stop`.
 *
 * Two-stage answer:
 *   - safe     : path grammar + worktree location + `.tmp_pgdata_worker_*`
 *                prefix are correct.
 *   - usable   : safe AND the directory exists on disk AND contains a
 *                PostgreSQL marker (PG_VERSION or postmaster.pid).
 *
 * Returns:
 *   {
 *     safe: boolean,
 *     usable: boolean,
 *     reason: string,
 *     dataDir?: string,
 *     markers?: string[],
 *   }
 *
 * Callers MUST NOT pass an unsafe / unusable directory to `pg_ctl stop`.
 * Use safe=true but usable=false to classify a missing directory after
 * `pg.stop()` deleted it (the legacy `persistent: false` failure mode).
 */
export function validateWorkerDataDir({ dataDir, worktreeCwd }) {
  if (!dataDir || typeof dataDir !== 'string') {
    return { safe: false, usable: false, reason: 'dataDir_not_a_string' };
  }
  const base = path.basename(dataDir).replace(/\\/g, '/');
  if (!base.startsWith('.tmp_pgdata_worker_')) {
    return {
      safe: false,
      usable: false,
      reason: 'dataDir_does_not_match_prefix',
      basename: base,
    };
  }
  let resolved = null;
  if (worktreeCwd) {
    resolved = path.resolve(dataDir);
    const root = path.resolve(worktreeCwd);
    const rel = path.relative(root, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return {
        safe: false,
        usable: false,
        reason: 'dataDir_outside_worktree',
        dataDir: resolved,
        worktreeCwd: root,
      };
    }
  } else {
    resolved = path.resolve(dataDir);
  }
  // Safe = path passes the prefix + worktree guard.
  if (!existsSync(resolved)) {
    return {
      safe: true,
      usable: false,
      reason: 'safe_but_missing',
      dataDir: resolved,
    };
  }
  // R6-03: check for PostgreSQL markers.
  const markers = [];
  if (existsSync(path.join(resolved, 'PG_VERSION'))) markers.push('PG_VERSION');
  if (existsSync(path.join(resolved, 'postmaster.pid'))) markers.push('postmaster.pid');
  if (markers.length === 0) {
    return {
      safe: true,
      usable: false,
      reason: 'safe_but_no_pg_marker',
      dataDir: resolved,
    };
  }
  return {
    safe: true,
    usable: true,
    reason: 'ok',
    dataDir: resolved,
    markers,
  };
}

/**
 * killTreeScoped (R5-02 / R5-03 / R5-04 / R5-05).
 *
 *   1. taskkill /PID <root> /T /F
 *   2. bounded netstat; if the EXACT suffix-port owner is gone,
 *      log that and proceed to step 3. Otherwise taskkill the
 *      exact-port owner once.
 *   3. REFRESH owner PID from netstat; if the port still has a
 *      listener, retry exact-port-owner taskkill bounded (R5-03).
 *      "alreadyGone" is NEVER declared unless the TCP probe also
 *      confirms the port is no longer connectable.
 *   4. R5-04 PostgreSQL fallback: validate dataDir against the
 *      `.tmp_pgdata_worker_*` prefix and the worktree, then run
 *      `pg_ctl stop -m fast -D <dataDir>` with a bounded timeout.
 *   5. R5-02 bounded port-close polling (≤15 s). Two consecutive
 *      netstat-closed AND tcp-not-connectable audits are required
 *      for PASS. Inter-audit gap is recorded.
 *   6. dataDir removal.
 *   7. Final filesystem + port audit (always runs even on failure).
 *
 * Returns:
 *   {
 *     ok: true | false,
 *     failureStage: <string> | null,
 *     steps: [<step records>],
 *     rootGone, portOwner,
 *     audit1, audit2,
 *     tcpClosed, tcpProbe,
 *     dataDirRemoved,
 *     durationMs,
 *     ...
 *   }
 */
export async function killTreeScoped({
  rootPid,
  suffixPort,
  dataDir,
  worktreeCwd,
}) {
  const startedAt = Date.now();
  const steps = [];
  const result = {
    ok: false,
    failureStage: null,
    steps,
    rootGone: null,
    portOwner: null,
    portOwnerRefreshed: false,
    exactOwnerKill: null,
    pgCtlValidation: null,
    pgCtlStop: null,
    pgCtlAttempts: 0,
    boundedWait: null,
    audit1: null,
    audit2: null,
    tcpClosed: null,
    tcpProbe: null,
    dataDirRemoved: null,
    finalAudit: null,
    finalTcpProbe: null,
    durationMs: 0,
  };

  function pushStep(step) {
    steps.push(step);
    return step;
  }

  // Step 1: terminate the spawned test tree.
  // R6-07: a non-zero taskkill exit is NOT a failure stage when
  // partialSuccess=true (the root tree was actually terminated,
  // Windows taskkill /T /F returned 255 only because one descendant
  // PID was already gone).
  if (rootPid != null && rootPid > 0) {
    const tk = runTaskkill(['/PID', String(rootPid), '/T', '/F']);
    pushStep({ step: 'taskkill_root', ...tk });
    if (!tk.ok && !tk.alreadyGone && !tk.partialSuccess) {
      result.failureStage = 'taskkill_root';
      result.taskkillRoot = tk;
    }
  } else {
    pushStep({ step: 'taskkill_root', skipped: 'no_root_pid' });
  }

  // Step 2: bounded netstat for the EXACT suffix-port owner.
  const r = readSockets();
  pushStep({ step: 'netstat_port', ...r });
  if (!r.available) {
    result.failureStage = result.failureStage || 'netstat_port';
    result.netstat = r;
  }
  const portHits = (r.available ? r.portHits : []).filter((h) => h.port === suffixPort);
  const owners = Array.from(
    new Set(portHits.map((h) => h.pid).filter((p) => p > 0 && p !== rootPid)),
  );
  result.portOwner = owners[0] != null ? owners[0] : null;

  // Step 3: exact-port-owner termination (R5-03). We always attempt
  // this if netstat reports any owner at all. We DO NOT short-circuit
  // on `alreadyGone` because that only proves the PID is not in the
  // process table — the listening socket may have been inherited by
  // another process.
  if (owners.length > 0) {
    for (const pid of owners) {
      const tk = runTaskkill(['/PID', String(pid), '/T', '/F']);
      pushStep({ step: 'taskkill_port_owner', pid, ...tk });
      if (!tk.ok && !tk.alreadyGone) {
        result.failureStage = result.failureStage || 'taskkill_port_owner';
      }
    }
  } else {
    pushStep({ step: 'taskkill_port_owner', skipped: 'no_owner_or_owned_by_root' });
  }

  // Step 3b: R5-03 / R6-07 PID refresh + retry. If the port still has a
  // listener after the initial taskkill, re-read netstat and try
  // again with the FRESH owner PID. Bounded to 3 refresh iterations,
  // and CRITICALLY: track the set of PIDs we have already seen so that
  // if netstat keeps returning the same stale PID (taskkill code 128
  // means the OS process is gone but the listener is still reported
  // against that PID), we stop retrying instead of looping.
  const seenRefreshPids = new Set();
  if (result.portOwner) seenRefreshPids.add(result.portOwner);
  for (let refreshIter = 0; refreshIter < 3; refreshIter += 1) {
    const reAudit = auditLeftovers(suffixPort);
    if (reAudit.closed === true) {
      pushStep({
        step: 'pid_refresh',
        iter: refreshIter,
        skipped: 'port_already_closed',
        audit: reAudit,
      });
      result.portOwnerRefreshed = true;
      break;
    }
    if (reAudit.available === false) {
      pushStep({
        step: 'pid_refresh',
        iter: refreshIter,
        skipped: 'netstat_unavailable',
        audit: reAudit,
      });
      break;
    }
    const freshPid = reAudit.ownerPid;
    if (!freshPid || freshPid === rootPid) {
      pushStep({
        step: 'pid_refresh',
        iter: refreshIter,
        skipped: 'no_distinct_owner',
        audit: reAudit,
      });
      break;
    }
    if (seenRefreshPids.has(freshPid)) {
      pushStep({
        step: 'pid_refresh',
        iter: refreshIter,
        skipped: 'stale_pid_repeated',
        pid: freshPid,
        audit: reAudit,
      });
      result.failureStage = result.failureStage || 'pid_refresh_stale';
      break;
    }
    seenRefreshPids.add(freshPid);
    const tk = runTaskkill(['/PID', String(freshPid), '/T', '/F']);
    pushStep({
      step: 'pid_refresh',
      iter: refreshIter,
      pid: freshPid,
      ...tk,
    });
    result.portOwnerRefreshed = true;
    result.exactOwnerKill = tk;
    if (!tk.ok && !tk.alreadyGone) {
      result.failureStage = result.failureStage || 'pid_refresh';
    }
  }

  // Step 3c: R5-03 TCP connectability probe RIGHT AFTER the taskkill
  // burst. This is the source-of-truth check: even if taskkill
  // returned "already gone", we still need to know whether the port
  // actually accepts connections.
  const tcpAfterKill = await tcpProbeConnect(suffixPort);
  pushStep({ step: 'tcp_probe_after_kill', ...tcpAfterKill });
  result.tcpProbe = tcpAfterKill;
  if (tcpAfterKill.connectable === true) {
    // Port still listening despite taskkill — fall through to
    // pg_ctl stop fallback (R5-04).
  }

  // Step 4: R5-04 / R6-03 PostgreSQL-aware fallback. Validate dataDir
  // first; never run pg_ctl stop on an unvalidated or unusable
  // directory. R6-03 distinguishes `safe` (path passes the prefix +
  // worktree guard) from `usable` (safe AND directory exists AND has
  // a PG marker). pg_ctl only runs when usable=true.
  if (dataDir && tcpAfterKill.connectable === true) {
    const validation = validateWorkerDataDir({ dataDir, worktreeCwd });
    result.pgCtlValidation = validation;
    pushStep({ step: 'pg_ctl_validation', ...validation });
    if (validation.usable === true) {
      const pgCtlPath = findEmbeddedPgCtl({ worktreeCwd });
      if (pgCtlPath) {
        pushStep({ step: 'pg_ctl_path', path: pgCtlPath });
        for (let attempt = 1; attempt <= PG_CTL_FALLBACK_MAX_ATTEMPTS; attempt += 1) {
          result.pgCtlAttempts = attempt;
          const stop = runPgCtlStop({
            pgCtlPath,
            dataDir: validation.dataDir,
            timeoutMs: PG_CTL_TIMEOUT_MS,
          });
          pushStep({ step: 'pg_ctl_stop', attempt, ...stop });
          result.pgCtlStop = stop;
          if (stop.ok) break;
        }
      } else {
        pushStep({
          step: 'pg_ctl_path',
          skipped: 'not_found',
          searchRoots: [
            path.resolve(worktreeCwd || '', 'apps/integration-worker/node_modules/@embedded-postgres/windows-x64/native/bin'),
            path.resolve(worktreeCwd || '', 'apps/integration-api/node_modules/@embedded-postgres/windows-x64/native/bin'),
            path.resolve(worktreeCwd || '', 'node_modules/@embedded-postgres/windows-x64/native/bin'),
          ],
        });
        result.failureStage = result.failureStage || 'pg_ctl_path_missing';
      }
    } else {
      // R6-03: safe_but_missing or safe_but_no_pg_marker. Fail closed.
      result.failureStage = result.failureStage || 'pg_ctl_validation_' + validation.reason;
    }
  }

  // Step 5: R5-02 bounded port-close polling. After the taskkill
  // burst and the pg_ctl fallback, wait up to PORT_CLOSE_POLL_TIMEOUT_MS
  // for the port to become BOTH netstat-closed AND TCP-not-connectable.
  const bounded = await boundedWaitPortClosed(suffixPort, PORT_CLOSE_POLL_TIMEOUT_MS);
  pushStep({ step: 'bounded_wait_port_closed', ...bounded });
  result.boundedWait = bounded;

  // Step 6: TWO consecutive audit probes (R5-02 audit1 + audit2)
  // after the bounded wait. Both must report closed=true AND the TCP
  // probe must confirm non-connectability.
  const audit1 = auditLeftovers(suffixPort);
  const interGapAt = Date.now();
  pushStep({ step: 'audit1', ...audit1 });
  result.audit1 = audit1;

  let audit2 = null;
  if (audit1.closed === true) {
    await new Promise((r) => setTimeout(r, AUDIT_GAP_MS));
    audit2 = auditLeftovers(suffixPort);
    pushStep({
      step: 'audit2',
      interAuditGapMs: Date.now() - interGapAt,
      ...audit2,
    });
    result.audit2 = audit2;
  } else {
    pushStep({
      step: 'audit2',
      skipped: 'audit1_not_closed',
      audit1,
    });
  }

  // Step 6b: TCP connectability confirmation (R5-03). After the two
  // netstat audits pass, run a final TCP probe so the verdict reflects
  // kernel-level proof that the port is no longer listening.
  const tcpFinal = await tcpProbeConnect(suffixPort);
  pushStep({ step: 'tcp_probe_final', ...tcpFinal });
  result.finalTcpProbe = tcpFinal;
  result.tcpClosed = tcpFinal.connectable === false;
  if (!result.tcpClosed) {
    result.failureStage = result.failureStage || 'tcp_probe_final';
  }

  // Step 7: data dir removal — only attempt once the port is closed
  // AND the TCP probe also confirms it (so we never delete files for
  // a still-listening instance).
  let dataDirRemoved = 'absent';
  if (dataDir && existsSync(dataDir)) {
    if (!result.tcpClosed) {
      dataDirRemoved = 'skipped_port_still_listening';
      result.failureStage = result.failureStage || 'data_dir_remove_skipped';
    } else {
      try {
        await rm(dataDir, { recursive: true, force: true });
        dataDirRemoved = 'removed';
      } catch (e) {
        dataDirRemoved = 'failed: ' + ((e && e.message) || String(e));
        result.failureStage = result.failureStage || 'data_dir_remove';
      }
    }
  }
  result.dataDirRemoved = dataDirRemoved;

  // Step 8: final filesystem + port audit (R5-05). Always runs.
  // Netstat + TCP probe for the suffix port + a filesystem check.
  const finalAudit = auditLeftovers(suffixPort);
  const finalTcp = await tcpProbeConnect(suffixPort);
  result.finalAudit = finalAudit;
  result.finalTcpProbe = finalTcp;
  pushStep({ step: 'final_audit', ...finalAudit });
  pushStep({ step: 'final_tcp_probe', ...finalTcp });

  // Verify root no longer alive (informational; root may already have
  // been reaped by the OS after taskkill).
  if (rootPid != null && rootPid > 0) {
    const r1 = pidExists(rootPid);
    pushStep({ step: 'verify_root_gone', ...r1 });
    result.rootGone = r1.exists === false;
  } else {
    result.rootGone = true;
  }

  // Verdict: PASS requires audit1.closed=true AND audit2.closed=true
  // AND tcpClosed=true AND dataDirRemoved in {removed,absent} AND no
  // failureStage set during the chain.
  const auditClean = audit1.closed === true && audit2 && audit2.closed === true;
  const dataDirClean = dataDirRemoved === 'removed' || dataDirRemoved === 'absent';
  result.ok =
    auditClean &&
    result.tcpClosed === true &&
    dataDirClean &&
    (result.failureStage == null);
  if (!result.ok && result.failureStage == null) {
    if (!auditClean) result.failureStage = audit1.closed !== true ? 'audit1' : 'audit2';
    else if (dataDirRemoved === 'skipped_port_still_listening') {
      result.failureStage = 'data_dir_remove_skipped';
    } else if (!dataDirClean) {
      result.failureStage = 'data_dir_remove';
    }
  }

  result.durationMs = Date.now() - startedAt;
  return result;
}

/**
 * Wait for a child process to emit `close`, with a bounded timeout.
 *
 * R4-03: this is one of the cleanup PASS criteria. The runner awaits
 * child close after taskkill; if close does not fire within
 * `timeoutMs`, the runner records the failure (the child handle is
 * still attached).
 *
 * The setTimeout is NOT unref'd so it keeps the event loop alive
 * during the wait.
 */
export function awaitChildClose(child, timeoutMs) {
  let resolved = false;
  return new Promise((resolve) => {
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
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ kind: 'timeout' });
      }
    }, timeoutMs);
  });
}

/**
 * Spawn a Node child without inheriting stdio to a TTY.
 *
 * Used by the cleanup probe (R4-05 / R5-06).
 */
export function spawnNodeChild({ cwd, env, args, stdio }) {
  return spawn(process.execPath, args, {
    cwd,
    env,
    stdio: stdio || ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

/**
 * Compose a compact, REDACTED evidence summary from a killTreeScoped
 * result. Used by both runners so the on-disk evidence file has the
 * same shape across R5 rounds.
 */
export function summarizeCleanup(cleanup) {
  if (!cleanup) return null;
  return {
    ok: cleanup.ok,
    failureStage: cleanup.failureStage,
    rootGone: cleanup.rootGone,
    portOwner: cleanup.portOwner,
    portOwnerRefreshed: cleanup.portOwnerRefreshed,
    pgCtlAttempts: cleanup.pgCtlAttempts,
    pgCtlValidation: cleanup.pgCtlValidation,
    pgCtlStop: cleanup.pgCtlStop
      ? {
          ok: cleanup.pgCtlStop.ok,
          code: cleanup.pgCtlStop.code,
          durationMs: cleanup.pgCtlStop.durationMs,
        }
      : null,
    boundedWait: cleanup.boundedWait
      ? {
          ok: cleanup.boundedWait.ok,
          iterations: cleanup.boundedWait.iterations,
          elapsedMs: cleanup.boundedWait.elapsedMs,
          reason: cleanup.boundedWait.reason,
        }
      : null,
    audit1: cleanup.audit1 && {
      available: cleanup.audit1.available,
      closed: cleanup.audit1.closed,
      ownerPid: cleanup.audit1.ownerPid,
    },
    audit2: cleanup.audit2 && {
      available: cleanup.audit2.available,
      closed: cleanup.audit2.closed,
      ownerPid: cleanup.audit2.ownerPid,
    },
    tcpClosed: cleanup.tcpClosed,
    tcpProbe: cleanup.tcpProbe && {
      connectable: cleanup.tcpProbe.connectable,
      durationMs: cleanup.tcpProbe.durationMs,
    },
    finalTcpProbe: cleanup.finalTcpProbe && {
      connectable: cleanup.finalTcpProbe.connectable,
      durationMs: cleanup.finalTcpProbe.durationMs,
    },
    dataDirRemoved: cleanup.dataDirRemoved,
    durationMs: cleanup.durationMs,
  };
}

/**
 * Best-effort sweep helper: collect every `.tmp_pgdata_worker_*`
 * directory under the worktree that was created in this round.
 * Returns absolute paths. Caller is responsible for not touching
 * legacy directories from previous rounds.
 */
export async function listWorkerDataDirs({ worktreeCwd }) {
  const workerDir = path.resolve(worktreeCwd, 'apps/integration-worker');
  const out = [];
  try {
    const entries = await (await import('node:fs/promises')).readdir(workerDir);
    for (const entry of entries) {
      if (entry.startsWith('.tmp_pgdata_worker_')) {
        out.push(path.resolve(workerDir, entry));
      }
    }
  } catch {
    // ignore — caller treats empty list as "no leftovers".
  }
  return out;
}

/**
 * Helper used by tests/cleanup probe: ensure a directory exists
 * (mkdir -p semantics). Returns the absolute path.
 */
export async function ensureDir(absPath) {
  await mkdir(absPath, { recursive: true });
  return absPath;
}
