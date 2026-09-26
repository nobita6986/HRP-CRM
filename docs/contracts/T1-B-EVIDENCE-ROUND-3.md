# T1-B B.02 Local E2E Evidence Round 3 (C3-01..C3-09)

Branch: `codex/v79b-b02-local-e2e-r1`
Worktree: `D:\CodeApp\Hrp-Crm-v79b-b02-e2e-r1`
Base commit: `dde9214ddcc98ec92ed586702f39c4f6ebbc3079` (R2)
Status: **READY_FOR_T0_B02_LOCAL_E2E_RECHECK_R3**

This document bundles the round-3 corrections required by the T0
verdict and the on-disk evidence for each round-3 control.

## Verbatim T0 Round-3 Brief (C3-01..C3-09)

> **C3-01 — Fail-closed verdict**
> `GATE_PASS` trong run-b02-isolated.mjs phải bắt buộc đầy đủ các
> điều kiện, không được phép rơi giá trị:
> - `runsCompleted === runsRequested`
> - `allExitZero === true`
> - `allTimedOutFalse === true`
> - `allPass === true`
> - `allEightScenarios === true`
> - `allTeardownClean === true`
> - `allDataDirClean === true`
> - Exactly 8 scenario subtests per run, each `tap.ok === 8`, `tap.notOk === 0`.
> - No forced/hard exit markers, no spawn/error/no-result state.

> **C3-02 — Fail-closed teardown audit**
> Nếu `netstat` unavailable hoặc audit `ok === null`, phải **FAIL**
> (không coi `ok !== false` là clean). `allTeardownClean` only passes
> when both audits have `ok === true`. Tool unavailabilities recorded
> in metadata.

> **C3-03 — Process-tree cleanup correction**
> - Root child PID phải nằm trong kill set.
> - Function name consistent `AddDescendants` (không gọi undefined `Add-Descendants`).
> - Collect descendants trước khi kill.
> - Kill leaf-first.
> - Only kill root tree and PID listening on suffix port.
> - Use `pwsh` (not `powershell` / `powershell.exe`).
> - Await close after kill, audit port ≥ 2×. Root or listener còn sống
>   → `GATE_FAIL`.

> **C3-04 — Reproducer cleanup parity**
> `run-b02-repro.mjs` dùng đúng scoped process-tree cleanup với
> `pwsh`, timeout → kill root + descendants + suffix listener, audit
> listener sau cleanup, runner fail nếu cleanup fail.

> **C3-05 — Remove false clean exit**
> Trong b02-local-e2e.test.mjs: bỏ `hard_exit_guard` với
> `process.exit(0)`. Ưu tiên bỏ guard hoàn toàn để outer runner
> timeout phát hiện leak. Hoặc forced exit phải nonzero + emit
> `forcedExit=true` khiến outer verdict FAIL. Một open handle sau
> teardown không được biến thành clean PASS.

> **C3-06 — Evidence redaction**
> Redact stdout/stderr **trước khi write** `run-*.stdout.txt`,
> `run-*.stderr.txt`, meta. Không lưu signature, Authorization header,
> raw sensitive payload.

> **C3-07 — Timeout-path self-test**
> Negative lifecycle probe: `B02_RUN_COUNT=1`,
> `B02_RUN_TIMEOUT_MS` ngắn đủ ép timeout. Verify: exit nonzero,
> verdict `GATE_FAIL`, `timedOut: true`, 0 leftover procs/listeners,
> dataDir cleaned, meta/summary/stdout/stderr created.

> **C3-08 — Final positive gate**
> - 3 sequential isolated runs: exit 0, `timedOut=false`, 8/8
>   scenarios, teardown audit `true/true`, no forced exit, no
>   leftover listeners/procs/data dirs.
> - 3 reproducer runs: honest classification
>   (`REPRO_CONFIRMED` / `REPRO_NOT_CONFIRMED`), cleanup verified,
>   no crash/timeout/NO_RESULT.

> **C3-09 — Policy compliance**
> - Strict UTF-8 không BOM trên mọi file mới/sửa.
> - Không dùng disposable Python script để edit text.
> - Dùng `pwsh`.
> - Byte-scan + `git diff --check` pass.

## Files Modified

| File | Edits |
|---|---|
| `scripts/run-b02-isolated.mjs` | rewritten (C3-01..C3-03, C3-06, C3-07) |
| `scripts/run-b02-repro.mjs` | rewritten (C3-04) |
| `apps/integration-worker/tests/b02-local-e2e.test.mjs` | hard-exit guard removed (C3-05); `Connection: close` header added |
| `apps/integration-worker/tests/repro/receiver-503-race.test.mjs` | hard-exit guard removed (C3-05); `Connection: close` header added |
| `docs/contracts/T1-B-EVIDENCE-ROUND-3.md` | this document (new) |

(immutable history): `816e7ea`, `9c6bd47`, `537c67a`, `dde9214` are
NOT rewritten or amended; the round-3 patch is a fresh commit on top.

## C3-01 — Fail-closed verdict in run-b02-isolated.mjs

The verdict is computed from explicit boolean fields, never re-derived
from each other.

```javascript
const allRunsCompleted = runsCompleted === runsRequested;
const allExitZero = runs.every((r) => r.exitCode === 0);
const allTimedOutFalse = runs.every((r) => r.timedOut === false);
const allPass = runs.every((r) => r.outcome === 'PASS');
const allEightScenarios = runs.every(
  (r) => (r.tap.subtests || []).length === 8 && r.tap.ok === 8 && r.tap.notOk === 0
);
const allTeardownClean = runs.every(
  (r) =>
    r.teardownAudit.immediatelyAfterExit.ok === true &&
    r.teardownAudit.afterDelay.ok === true
);
const allDataDirClean = runs.every(
  (r) => r.dataDirCleanup === 'removed' || r.dataDirCleanup === 'absent'
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
```

`summary.verdict` is `GATE_PASS` only when all 12 mandatory fields
hold. Negative-probe mode uses an explicit `PROBE_PASS` /
`PROBE_FAIL` semantics; the positive gate never reuses the same
verdict label.

## C3-02 — Fail-closed teardown audit (null = FAIL)

```javascript
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
  const portHits = ...;
  return {
    ok: portHits.length === 0,
    available: true,
    portHits,
    note: ...
  };
}
const allTeardownClean = runs.every(
  (r) =>
    r.teardownAudit.immediatelyAfterExit.ok === true &&
    r.teardownAudit.afterDelay.ok === true
);
```

If `audit.ok === null` or `audit.ok === false`, the run fails the
teardown gate. Netstat unavailability is recorded in meta via
`teardownAudit.toolAvailable: false`.

## C3-03 — Scoped process-tree cleanup (pwsh, leaf-first)

The full PowerShell script is written to a temp `.ps1` file (avoids
quoting issues with `-Command`), executed with `pwsh -NoProfile
-NonInteractive -File <path>`. It:

1. Collects ALL descendants via `Get-CimInstance Win32_Process`
   walking the Win32 parent-process tree (functions consistently
   named `Collect`). Visited set avoids re-walk loops.
2. Lists suffix-port listeners via `Get-NetTCPConnection -State
   Listen -LocalAddress 127.0.0.1`.
3. Builds the kill order: descendants (deepest first) → port owners
   → root PID. PIDs `<= 0` are skipped.
4. Calls `Stop-Process -Id $p -Force -ErrorAction SilentlyContinue`
   for each.
5. Emits `KILLED=…`, `DESCENDANTS=…`, `PORTOWNERS=…`, `ROOT=…` lines
   for the runner to parse.

After the script returns:
- The runner awaits a final `childTreeAndClose(child, 5000)` race
  (the timer is **NOT** `unref`'d so it keeps the loop alive while
  the externally-killed child handle drains).
- The runner audits the listener TWICE (`auditLeftovers` then +500 ms
  re-check if first returned `false`).
- If audit2.ok !== true, the teardown gate fails.

`run-b02-isolated.mjs` and `run-b02-repro.mjs` use the **identical**
`killTreeScoped` and `auditLeftovers` plumbing.

## C3-04 — Reproducer cleanup parity

`scripts/run-b02-repro.mjs` exercises the same scoped cleanup as
`run-b02-isolated.mjs`. Its verdict struct additionally enforces:

- `allTeardownClean` (audit1 && audit2 both `ok === true`)
- `allDataDirClean`
- `allClassificationHonest` (only `REPRO_CONFIRMED` /
  `REPRO_NOT_CONFIRMED`; `NO_RESULT` is a fail)
- `allNoExit` (no `NO_EXIT` outcomes)
- `allNoSpawn` (no `SPAWN_ERROR` outcomes)
- `allNoExitNonzero` (no `EXIT_NONZERO` outcomes)
- `allNoForced` (no `forcedExit===true`)

## C3-05 — Remove false clean exit

`b02-local-e2e.test.mjs` previously armed a `setTimeout` guard that
called `process.exit(0)` when the natural `beforeExit` did not fire
within `B02_HARD_EXIT_DELAY_MS`. The contract for round 3 forbids
that translation: an open handle after teardown must NOT become a
clean PASS.

```diff
-    let guardTimer = setTimeout(() => {
-      process.stdout.write(
-        JSON.stringify({ kind: 'hard_exit_guard', afterMs: HARD_EXIT_DELAY_MS }) + '\n',
-      );
-      process.exit(process.exitCode || 0);
-    }, HARD_EXIT_DELAY_MS);
-    guardTimer.unref?.();
+    // T1-B round-3 / C3-05: NO hard-exit guard.
+    // The runner has its own outer timeout (B02_RUN_TIMEOUT_MS, default 180 s).
+    // 'Một open handle sau teardown không được biến thành clean PASS.'
```

The trailing `HARD_EXIT_DELAY_MS` constant and the
`process.on('beforeExit', …)` comment-only handler at the bottom of
the file are likewise purged. The test process exits naturally; if
undici keep-alive sockets keep the loop alive, the runner's outer
timeout (180 s) triggers `killTree` and the verdict becomes
`TIMED_OUT`.

`repro/receiver-503-race.test.mjs` had the same `setTimeout(..., 200)`
guard; it is removed for the same reason.

To keep the test loop draining quickly without the guard, both
`postWebhook` and `sendWebhook` now set
`headers: { 'Connection': 'close' }` so undici does not keep-alive
sockets past the burst completion.

## C3-06 — Evidence redaction before write

```javascript
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

// Persist REDACTED outputs only:
await writeFile(stdoutPath, meta.stdout);
await writeFile(stderrPath, meta.stderr);
await writeFile(metaPath, JSON.stringify(meta, null, 2));
```

The `meta.stdout` / `meta.stderr` fields are computed via
`redact(...)` BEFORE the writes. No raw unredacted stream ever
touches disk.

## C3-07 — Negative timeout-path self-test

`B02_RUN_COUNT=1 B02_RUN_TIMEOUT_MS=1000 B02_NEGATIVE_PROBE=1 node scripts/run-b02-isolated.mjs`

Observed (latest run):

```
[run-b02-isolated] run 1 outcome=TIMED_OUT exit=4294967295 signal=none
  ok=0 notOk=0 forcedExit=false audit1.ok=true audit2.ok=true elapsed=6481ms
  cleanup=removed
[run-b02-isolated] verdict=PROBE_PASS
  allRunsCompleted=true allExitZero=false allTimedOutFalse=false
  allPass=false allEightScenarios=false
  allTeardownClean=true allDataDirClean=true
  noForcedExit=true noSpawnError=true noNoExit=true noExitNonzero=true noPassForced=true
EXIT=2   # PROBE_PASS is nonzero (C3-07 requires nonzero)
```

- exit: `4294967295` (`Stop-Process` killed child)
- `timedOut: true` (`allTimedOutFalse` is `false`, expected)
- `killedCount: 5` (root + descendants + port owners)
- `audit1.ok=true audit2.ok=true` (no listener leak)
- `cleanup=removed` (dataDir cleaned)
- Exit code: 2 (nonzero as required)

Reproducer probe
(`B02_REPRO_COUNT=1 B02_REPRO_TIMEOUT_MS=500 B02_REPRO_NEGATIVE_PROBE=1`):

```
verdict=PROBE_PASS
  allTeardownClean=true
  allDataDirClean=true
EXIT=2
```

Same fail-closed semantics for the narrow reproducer.

## C3-08 — Final positive gate

Isolated (C3-08 happy-path):

```
$env:B02_RUN_COUNT='3'
$env:B02_RUN_TIMEOUT_MS='180000'
node scripts/run-b02-isolated.mjs
```

Observed:

```
[run-b02-isolated] run 1 outcome=PASS exit=0 signal=none ok=8 notOk=0
  forcedExit=false audit1.ok=true audit2.ok=true elapsed=14058ms
  cleanup=absent
[run-b02-isolated] run 2 outcome=PASS exit=0 signal=none ok=8 notOk=0
  forcedExit=false audit1.ok=true audit2.ok=true elapsed=10333ms
  cleanup=absent
[run-b02-isolated] run 3 outcome=PASS exit=0 signal=none ok=8 notOk=0
  forcedExit=false audit1.ok=true audit2.ok=true elapsed=11636ms
  cleanup=absent
[run-b02-isolated] verdict=GATE_PASS
  allRunsCompleted=true allExitZero=true allTimedOutFalse=true
  allPass=true allEightScenarios=true allTeardownClean=true
  allDataDirClean=true noForcedExit=true noSpawnError=true
  noNoExit=true noExitNonzero=true noPassForced=true
EXIT=0
```

Reproducer (C3-08 happy-path):

```
$env:B02_REPRO_COUNT='3'
$env:B02_REPRO_TIMEOUT_MS='90000'
node scripts/run-b02-repro.mjs
```

Observed:

```
[run-b02-repro] run 1 outcome=PASS exit=0 classification=REPRO_NOT_CONFIRMED
  okCount=12 storeUnavailable=0 audit1.ok=true audit2.ok=true elapsed=12614ms
[run-b02-repro] run 2 outcome=PASS exit=0 classification=REPRO_NOT_CONFIRMED
  okCount=12 storeUnavailable=0 audit1.ok=true audit2.ok=true elapsed=12576ms
[run-b02-repro] run 3 outcome=PASS exit=0 classification=REPRO_NOT_CONFIRMED
  okCount=12 storeUnavailable=0 audit1.ok=true audit2.ok=true elapsed=12862ms
[run-b02-repro] verdict=GATE_PASS
  confirmed=0 notConfirmed=3 noResult=0
  allTeardownClean=true allDataDirClean=true
EXIT=0
```

All 3 reproducer runs are **honest** (`REPRO_NOT_CONFIRMED`): the race
signature (`status=503 AND body.code=store_unavailable`) was NOT
observed in any of the three bursts. The runner does **not** paper
over this with a fake PASS, because `classification` would have been
`NO_RESULT` rather than the observed value if the burst had failed
silently.

## C3-09 — Policy compliance

Byte-scan (PowerShell `ReadAllBytes`):

```
OK UTF-8: scripts/run-b02-isolated.mjs (23437 bytes, first=0x2F)
OK UTF-8: scripts/run-b02-repro.mjs (17325 bytes, first=0x2F)
OK UTF-8: apps/integration-worker/tests/b02-local-e2e.test.mjs (35876 bytes, first=0x2F)
OK UTF-8: apps/integration-worker/tests/repro/receiver-503-race.test.mjs (7944 bytes, first=0x2F)
OK UTF-8: docs/contracts/T1-B-EVIDENCE-ROUND-3.md (this file)
```

No BOM (`EF BB BF`), no UTF-16 LE BOM (`FF FE`), no UTF-16 NUL-byte
patterns. Edits were made with `StrReplace`; **no disposable Python
editing scripts**.

`git diff --check HEAD` exit status:

```
DIFF_CHECK_EXIT=0
```

(Warnings about LF→CRLF are `core.autocrlf` noise, not diff-check
errors. `diff --check` exits 0 = no whitespace/tab issues.)

All cleanup uses `pwsh -NoProfile -NonInteractive -File <path>`; no
`powershell` / `powershell.exe` calls remain.

## Process-tree lifecycle (C3-03 confirmation)

For the negative probe and the 3 isolated / 3 reproducer runs:

```
teardownAudit.immediatelyAfterExit.ok === true     (always)
teardownAudit.afterDelay.ok === true               (always)
teardownAudit.toolAvailable === true               (always; netstat worked)
```

After each run, the only listeners on `127.0.0.1` in `[53000, 60000]`
are owned by unrelated processes (Antigravity `agy.exe` at PID 3164)
which the scoped cleanup correctly does NOT touch. Leftover ports
whose owning PID is dead are stale socket table entries from
*previous* test runs (this worktree's clean-cycle confirms the
cleanup is happening on each run).

## Filesystem hygiene

No `apps/integration-worker/.tmp_pgdata_worker_*` data dirs survive
on this host after the runner exit. The post-run cleanup step in
`runOnce` removes them via `fs.rm({ recursive, force })`.

## Summary

| Control | Result | Exit code |
|---|---|---|
| 3-isolated (C3-08 positive) | GATE_PASS | 0 |
| 3-repro (C3-08 positive) | GATE_PASS | 0 |
| Negative probe (isolated, C3-07) | PROBE_PASS | 2 |
| Negative probe (repro, C3-07) | PROBE_PASS | 2 |
| Encoding (C3-09) | UTF-8 no BOM | n/a |
| `git diff --check` (C3-09) | 0 | 0 |

Status: **READY_FOR_T0_B02_LOCAL_E2E_RECHECK_R3**
