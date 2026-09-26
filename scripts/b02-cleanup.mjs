/**
 * scripts/b02-cleanup.mjs -- T1-B round-4 (R4-02..R4-04) shared helper.
 *
 * Process-tree + suffix-port cleanup, audited, with bounded subprocesses.
 *
 * Design (per T0 R4-02 / R4-03 / R4-04):
 *   - killTreeScoped() uses ONLY:
 *       * taskkill /PID <rootPid> /T /F   (terminate the spawned test tree)
 *       * netstat -ano -p tcp             (parse exact suffix-port owner)
 *       * taskkill /PID <portOwner> /T /F (terminate ONLY that PID)
 *   - No CIM, no WMI, no PowerShell enumeration. taskkill is bundled
 *     with Windows and has its own internal process-tree walk (/T) and
 *     force semantics (/F) without any script-host indirection.
 *   - Every subprocess has its own short timeout (NETSTAT_TIMEOUT_MS,
 *     TASKKILL_TIMEOUT_MS). On timeout the helper returns a fail-closed
 *     result and the runner records the failure.
 *
 * PASS criteria (R4-03):
 *   1. root process no longer exists (`tasklist` probe or exit code from
 *      a follow-up taskkill /PID <root> /T /F that reports "could not find").
 *   2. suffix port has no listener in TWO consecutive audit probes
 *      (audit1 + audit2, with a small delay between them).
 *   3. data dir can be removed (or is already absent).
 *
 *   Any of: netstat unavailable/timeout, root still alive, port still
 *   listening in either audit, data dir un-removable => cleanup FAIL.
 *   The helper returns an object describing exactly which step failed
 *   and the runner makes the gate verdict GATE_FAIL.
 *
 * Output: same evidence directory used by the runner.
 */

import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';

// Bounded subprocess budgets. These are intentionally short because we
// are probing already-known values (root PID, exact suffix port); if
// the probe hangs, the underlying state is broken and the runner
// should fail fast.
const NETSTAT_TIMEOUT_MS = 5_000;
const TASKKILL_TIMEOUT_MS = 8_000;
const AUDIT_GAP_MS = 500;

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
 *   { available: true,  closed: true | false, ownerPid?, address?, durationMs }
 *   { available: false, closed: null, errorCategory, durationMs, note }
 */
export function auditLeftovers(port) {
  const r = readSockets();
  if (!r.available) {
    return {
      available: false,
      closed: null, // null = unknown => R4-04 fail-closed
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
 *   { ok: false, category, message, durationMs }
 *
 * Codes:
 *   0   = taskkill reported the process was terminated.
 *   128 = the PID was not found (we treat this as "already gone" for
 *         R4-03 purposes: the root is no longer alive).
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
      // taskkill convention: "process not found". This is success for
      // our cleanup semantics (the PID is already gone). The runner
      // audits the port separately.
      return {
        ok: true,
        alreadyGone: true,
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
    // tasklist CSV output looks like:
    //   "node.exe","12345","Console","1","12,345 K"
    // When the PID does not exist the output is:
    //   INFO: No tasks are running which match the specified criteria.
    const stripped = (out || '').trim();
    if (/no tasks/i.test(stripped) || stripped.length === 0) {
      return { exists: false, durationMs: Date.now() - startedAt };
    }
    return { exists: true, durationMs: Date.now() - startedAt };
  } catch (e) {
    return {
      exists: null, // null = unknown; runner treats as fail-closed
      durationMs: Date.now() - startedAt,
      errorCategory: classifyExecError(e),
      message: (e && (e.message || String(e))) || 'tasklist failed',
    };
  }
}

/**
 * killTreeScoped (R4-02 / R4-03).
 *
 *   1. taskkill /PID <root> /T /F
 *   2. bounded netstat; parse the EXACT suffix port owner PID
 *   3. ONLY if the netstat owner PID is a single number > 0, and that
 *      PID is NOT the same as `rootPid`, taskkill /PID <owner> /T /F
 *   4. Two consecutive audit probes (audit1 + audit2) for the port;
 *      both must report closed === true for cleanup to PASS.
 *
 * Returns:
 *   { ok: true,  steps, rootGone, portOwner, audit1, audit2, dataDirRemoved }
 *   { ok: false, failureStage, steps, rootGone, portOwner, audit1, audit2, dataDirRemoved }
 *
 * failureStage in { 'taskkill_root', 'netstat_port', 'taskkill_port_owner',
 *                  'audit1', 'audit2', 'data_dir_remove' }.
 */
export async function killTreeScoped({ rootPid, suffixPort, dataDir }) {
  const steps = [];
  let result = {
    ok: false,
    steps,
    rootGone: null,
    portOwner: null,
    audit1: null,
    audit2: null,
    dataDirRemoved: null,
  };

  // Step 1: terminate the spawned test tree.
  if (rootPid != null && rootPid > 0) {
    const tk = runTaskkill(['/PID', String(rootPid), '/T', '/F']);
    steps.push({ step: 'taskkill_root', ...tk });
    if (!tk.ok && !tk.alreadyGone) {
      return { ...result, failureStage: 'taskkill_root', taskkillRoot: tk };
    }
  } else {
    steps.push({ step: 'taskkill_root', skipped: 'no_root_pid' });
  }

  // Step 2: bounded netstat to find the EXACT suffix-port owner.
  const r = readSockets();
  steps.push({ step: 'netstat_port', ...r });
  if (!r.available) {
    return {
      ...result,
      failureStage: 'netstat_port',
      netstat: r,
    };
  }
  const portHits = r.portHits.filter((h) => h.port === suffixPort);
  // Distinct owner PIDs (ignore own root; we already terminated it).
  const owners = Array.from(
    new Set(portHits.map((h) => h.pid).filter((p) => p > 0 && p !== rootPid)),
  );
  result.portOwner = owners[0] != null ? owners[0] : null;

  // Step 3: ONLY if a distinct owner exists, terminate it.
  if (owners.length > 0) {
    for (const pid of owners) {
      const tk = runTaskkill(['/PID', String(pid), '/T', '/F']);
      steps.push({ step: 'taskkill_port_owner', pid, ...tk });
      if (!tk.ok && !tk.alreadyGone) {
        return { ...result, failureStage: 'taskkill_port_owner', taskkillPortOwner: tk };
      }
    }
  } else {
    steps.push({ step: 'taskkill_port_owner', skipped: 'no_owner_or_owned_by_root' });
  }

  // Step 4: confirm root no longer alive.
  if (rootPid != null && rootPid > 0) {
    const r1 = pidExists(rootPid);
    steps.push({ step: 'verify_root_gone', ...r1 });
    result.rootGone = r1.exists === false;
    if (r1.exists !== false) {
      return { ...result, failureStage: 'verify_root_gone' };
    }
  } else {
    result.rootGone = true; // nothing to verify
  }

  // Step 5: two consecutive audit probes (R4-03).
  const audit1 = auditLeftovers(suffixPort);
  result.audit1 = audit1;
  steps.push({ step: 'audit1', ...audit1 });
  if (audit1.closed !== true) {
    return { ...result, failureStage: 'audit1' };
  }
  await new Promise((r) => setTimeout(r, AUDIT_GAP_MS));
  const audit2 = auditLeftovers(suffixPort);
  result.audit2 = audit2;
  steps.push({ step: 'audit2', ...audit2 });
  if (audit2.closed !== true) {
    return { ...result, failureStage: 'audit2' };
  }

  // Step 6: data dir cleanup.
  let dataDirRemoved = 'absent';
  if (dataDir && existsSync(dataDir)) {
    try {
      await rm(dataDir, { recursive: true, force: true });
      dataDirRemoved = 'removed';
    } catch (e) {
      dataDirRemoved = 'failed: ' + ((e && e.message) || String(e));
      result.dataDirRemoved = dataDirRemoved;
      return { ...result, failureStage: 'data_dir_remove' };
    }
  }
  result.dataDirRemoved = dataDirRemoved;
  result.ok = true;
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
 * Used by the cleanup probe (R4-05).
 */
export function spawnNodeChild({ cwd, env, args, stdio }) {
  return spawn(process.execPath, args, {
    cwd,
    env,
    stdio: stdio || ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}
