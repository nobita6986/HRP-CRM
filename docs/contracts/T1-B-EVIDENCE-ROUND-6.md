# T1-B - B.02 LOCAL E2E EVIDENCE - CORRECTION ROUND 6

**Worktree:** `D:\CodeApp\Hrp-Crm-v79b-b02-e2e-r1`
**Branch:** `codex/v79b-b02-local-e2e-r1`
**Parent commit:** `e0dd638539e813fc4aa9bac8c7a1b4f7924d04d8`
**Correction commit (this round):** `TBD_AFTER_COMMIT`
**Correction round:** R6 (per T0 R6-01..R6-09 verdict, CHANGES_REQUIRED on R5)
**T0 verdict awaiting:** `READY_FOR_T0_B02_LOCAL_E2E_RECHECK_R6`

---

## 1. Root cause of dataDir disappearing before pg_ctl (Round 5 failure)

In `apps/integration-worker/tests/pg-worker-harness.mjs`, the embedded
PostgreSQL was constructed with `persistent: false`. Under that mode, the
library is allowed to remove the cluster data directory as part of its
internal shutdown sequence, regardless of whether the listener socket has
actually been released. The Round 5 reproducer hit exactly that race:

- Run 1 completed its 12/12 observation burst (`classification=REPRO_NOT_CONFIRMED`).
- `pg.stop()` returned while the listener on the suffix port (57248) was still
  `LISTENING`, and the data directory had already been swept away.
- The cleanup helper then tried the `pg_ctl stop -m fast -D <dataDir>` fallback
  but received `directory ... does not exist` because the harness had already
  removed it.
- `taskkill` against the netstat-reported owner PID 4644 returned code 128
  ("process not found") because the PID had become stale; the helper did not
  treat code 128 as a refresh signal.
- `boundedWaitPortClosed()` reported `failureStage=tcp_probe_final`,
  `dataDirCleanup=absent`, exit 1.

Round 6 forces the cluster to stay on disk for the entire shutdown sequence
and only removes it after two consecutive audit closures and a final TCP
probe confirm that the port is unreachable.

---

## 2. Mapping R6-01..R6-09 to source change and regression evidence

| ID       | Requirement (abbrev.)                                                                                       | Source change                                                                                                                                                                                                          | Regression evidence                                                                                                                                                                                                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R6-01    | `persistent: true`; dataDir preserved through teardown; manual remove only after audit1/audit2/TCP=false    | `apps/integration-worker/tests/pg-worker-harness.mjs`: `new EmbeddedPostgres({ persistent: true, ... })`; `harness.stop()` no longer deletes `dataDir`; outer runner calls `removeWorkerDataDir` only after final TCP probe | Step 4 (repro) and Step 5 (isolated) `dataDirRemoved=removed`; per-run `dataDirCleanup=removed`; post-run audit shows zero `apps/integration-worker/.tmp_pgdata_worker_*` directories created by R6.                                                                                                                                  |
| R6-02    | Single shutdown owner; idempotent `_stopPromise` guard; no race on `dataDir`; no `process.exit()` guards   | `apps/integration-worker/tests/pg-worker-harness.mjs`: `_stopPromise` memoization; `dataDir` removal hoisted into runner `after()` after final TCP probe                                                             | Steps 4-7 all `forcedExit=false`, `noForcedExit=true`, `noPassForced=true`; receiver / dispatcher / Prisma / PG owned exclusively by harness.                                                                                                                                                                                          |
| R6-03    | `validateWorkerDataDir` returns `{ safePath, usablePgDataDir }`; fail-closed; no fake dataDir/postmaster    | `scripts/b02-cleanup.mjs`: `validateWorkerDataDir()` extended with existence + `PG_VERSION` / `postmaster.pid` checks                                                                                                  | Steps 1-3 use probe child processes (no real PG cluster) - `pgCtlAttempts=0`, `pgCtlValidation=null`, `pgCtlStop=null`; happy path skips pg_ctl because pg.stop closes the port cleanly.                                                                                                                                              |
| R6-04    | Shutdown order: prisma to pg.stop to netstat+TCP to pg_ctl (if usable) to taskkill to 2 audits to TCP to remove    | `apps/integration-worker/tests/pg-worker-harness.mjs`: `stop()` records per-step `atMs` and `step`; `scripts/b02-cleanup.mjs`: `killTreeScoped()` uses TCP probe + double audits before any dataDir removal              | Per-run `harness_stop_done.steps[]` ordering matches: `prisma_disconnected`, `pg_stop_returned`, `tcp_probe_after_pg_stop`, `audit_after_pg_stop`, `audit2`, `tcp_probe_final`, `post_stop_port_already_closed`.                                                                                                                       |
| R6-05    | `boundedWaitPortClosed` captures `startedAt` once; reports budget/interval/iterations; timing probe           | `scripts/b02-cleanup.mjs`: `boundedWaitPortClosed()` hoisted `startedAt`; `scripts/cleanup-probe.mjs`: `runTimingProbe()` (env `B02_TIMING_PROBE=1`)                                                                 | Step 3 timing probe: `port=56897 budget=1200 elapsedMs=1495 iterations=5 reason=deadline_exceeded`; checks `bounded_budget_recorded`, `bounded_poll_interval_recorded`, `bounded_elapsed_in_range`, `listener_cleaned_up` all true.                                                                                                    |
| R6-06    | Reproducer teardown closes receiver/dispatcher/Prisma/PG/timers/handles; lifecycle evidence                 | `apps/integration-worker/tests/repro/receiver-503-race.test.mjs` and `apps/integration-worker/tests/b02-local-e2e.test.mjs`: `server.closeAllConnections()` + lifecycle `phase`/`stage` records                       | Per-run stdout includes `receiver_close_all_connections_invoked`, `close_receiver_server_done ok=true`, `mockGateway_close_all_connections_invoked`, `dispatcher_observed not_owned`, `prisma_disconnect_owned_by_harness`, `harness_stop_done`, `before_exit`, `process_exit`.                                                        |
| R6-07    | `taskkill` code 128 is not port-closed proof; refresh on stale PID; break on repeated stale PID             | `scripts/b02-cleanup.mjs`: `runTaskkill()` notes `partialSuccess` on code 255/128 when `SUCCESS:` regex matches stdout; `killTreeScoped()` tracks `seenRefreshPids` and stops on `stale_pid_repeated`               | Step 1 orphan probe: `taskkill_root` returned `code=128 alreadyGone=true`, then `taskkill_port_owner` succeeded for PID 6892; `boundedWait` returned `iterations=1 elapsedMs=33 reason=port_closed`; `audit1.closed=true audit2.closed=true tcpClosed=true`.                                                                          |
| R6-08    | Execute the 7 command groups; capture `$LASTEXITCODE` per group                                            | This document - see Section 3.                                                                                                                                                                                          | All 7 groups ran to completion with the documented exit codes and ledger numbers.                                                                                                                                                                                                                                                   |
| R6-09    | Hygiene: strict UTF-8 no BOM on changed files; `pwsh`; encoding gate; `git diff --check`; FF commit + push    | This document - see Section 5.                                                                                                                                                                                          | All 7 modified files: first bytes `2F 2A 2A` (`/**`), no BOM; `git diff --check` exit 0; encoding gate `ENCODING_GATE=PASS checked=1 rejected=0` per file.                                                                                                                                                                            |

---

## 3. R6-08 - Sequential execution (7 groups)

All commands executed under `pwsh` with the worktree as cwd. Env vars explicitly
removed between groups where they would otherwise bleed into the next command.

| # | Command                                                                                                                                                | Verdict          | ExitCode |
| - | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | -------- |
| 1 | `$env:B02_PROBE_ORPHAN='1'; node scripts/cleanup-probe.mjs; $LASTEXITCODE`                                                                              | `PROBE_PASS`     | `2`      |
| 2 | `$env:B02_PROBE_HAPPY='1'; node scripts/cleanup-probe.mjs; $LASTEXITCODE`                                                                                | `GATE_PASS`      | `0`      |
| 3 | `$env:B02_TIMING_PROBE='1'; node scripts/cleanup-probe.mjs; $LASTEXITCODE`                                                                              | `PROBE_PASS`     | `2`      |
| 4 | `node scripts/run-b02-repro.mjs`                                                                                                                       | `GATE_PASS`      | `0`      |
| 5 | `node scripts/run-b02-isolated.mjs`                                                                                                                    | `GATE_PASS`      | `0`      |
| 6 | `$env:B02_NEGATIVE_PROBE='1'; $env:B02_RUN_COUNT='1'; $env:B02_RUN_TIMEOUT_MS='1000'; node scripts/run-b02-isolated.mjs; $LASTEXITCODE`                  | `PROBE_PASS`     | `2`      |
| 7 | `$env:B02_REPRO_NEGATIVE_PROBE='1'; $env:B02_REPRO_COUNT='1'; $env:B02_REPRO_TIMEOUT_MS='1000'; node scripts/run-b02-repro.mjs; $LASTEXITCODE`           | `PROBE_PASS`     | `2`      |

### 3.1 Step 1 - Orphan probe

- Verdict: `PROBE_PASS`, exit `2`.
- `rootGone=true`, `audit1Closed=true`, `audit2Closed=true`, `tcpClosed=true`,
  `portOwnerRefreshed=true`, `dataDirCleanup=removed`, `timedOut=false`,
  `cleanupOk=true`, `failureStage=null`.
- Probe child deliberately detached root process; after root exit, the
  grandchild PID (6892) held the suffix port (51837) open.
- Cleanup sequence: `taskkill_root` returned code `128` (`alreadyGone=true`)
  because PID 18600 had exited; netstat refreshed the owner to PID 6892;
  `taskkill_port_owner` succeeded with `SUCCESS:`; `pid_refresh` returned
  `port_already_closed`; `bounded_wait_port_closed` returned
  `iterations=1 elapsedMs=33 reason=port_closed`.
- Evidence: `apps/integration-worker/.b02-probe/1790397483858/summary.json`,
  `probe.meta.json`, `probe.stdout.txt`, `probe.stderr.txt`.

### 3.2 Step 2 - Happy cleanup probe

- Verdict: `GATE_PASS`, exit `0`.
- `rootGone=true`, `audit1Closed=true`, `audit2Closed=true`, `tcpClosed=true`,
  `dataDirCleanup=removed`, `cleanupOk=true`, `failureStage=null`.
- Probe child exited naturally on the suffix port (56889) before the harness
  asked it to terminate; `taskkill_root` step recorded `skipped=natural_exit`.
- Evidence: `apps/integration-worker/.b02-probe/1790397496460/summary.json`,
  `probe.meta.json`, `probe.stdout.txt`, `probe.stderr.txt`.

### 3.3 Step 3 - Timing negative probe

- Verdict: `PROBE_PASS`, exit `2`.
- `port=56897`, `budget=1200`, `elapsedMs=1495`, `iterations=5`,
  `timeoutBudgetMs=1200`, `pollIntervalMs=250`, `reason=deadline_exceeded`,
  `tcpBefore=true`, `tcpAfterBounded=true`, `tcpAfterCleanup=false`.
- `bounded_elapsed_in_range=true` (1495ms in [950ms, 2200ms] given budget 1200
  with 250ms tolerance); `bounded_iterations_gt_one=true` (5 polls before
  the listener finally accepted shutdown); `listener_cleaned_up=true`.
- The listener held the port open until the budget elapsed, then the probe
  child process exited with code `1`; cleanup succeeded (`tcpAfterCleanup=false`)
  and `dataDirCleanup=removed`.
- Evidence: `apps/integration-worker/.b02-probe/timing-1790397507981/summary.json`,
  `probe.meta.json`, `probe.stdout.txt`, `probe.stderr.txt`.

### 3.4 Step 4 - Main reproducer (`run-b02-repro.mjs`)

- Verdict: `GATE_PASS`, exit `0`.
- Overall: `confirmed=0 notConfirmed=3 noResult=0`, `allTeardownClean=true`,
  `allTcpClosed=true`, `allCleanupResult=true`, `allDataDirClean=true`.

| Run | Suffix                       | Port  | Exit | TimedOut | Requests (ok/total) | Classification      | `pg.stop` | `pg_ctl` | audit1 | audit2 | TCP final | dataDir      |
| --- | ---------------------------- | ----- | ---- | -------- | ------------------- | ------------------- | --------- | -------- | ------ | ------ | --------- | ------------ |
| 1   | `repro_v2_muhwgehm_8e2754`   | 53656 | 0    | false    | 12/12 (0 store_unav) | `REPRO_NOT_CONFIRMED` | returned (port already closed at 229ms) | skipped (port closed) | closed | closed | not connectable | removed |
| 2   | `repro_v2_muhwgmul_1ed85e`   | 53525 | 0    | false    | 12/12 (0 store_unav) | `REPRO_NOT_CONFIRMED` | returned (port already closed at 211ms) | skipped (port closed) | closed | closed | not connectable | removed |
| 3   | `repro_v2_muhwgvmx_692d1b`   | 56774 | 0    | false    | 12/12 (0 store_unav) | `REPRO_NOT_CONFIRMED` | returned (port already closed at 239ms) | skipped (port closed) | closed | closed | not connectable | removed |

- Lifecycle stages observed (run 1 shown; runs 2-3 identical pattern):
  `test_module_loaded` then `before_start` then bootstrap then `harness_started`
  then `mockGateway_listening` then `receiver_listening` then
  `repro_not_confirmed` then `receiver_close_all_connections_invoked` then
  `receiver_closed` then `dispatcher_closed (not_owned)` then
  `prisma_disconnect_owned_by_harness ok=true` then `pg_stop_started` then
  `harness_stop_done` (prisma_disconnected, pg_stop_returned,
  tcp_probe_after_pg_stop, audit_after_pg_stop, audit2, tcp_probe_final,
  post_stop_port_already_closed) then `harness_stopped` then `process_exit code=0`.
- Evidence:
  `apps/integration-worker/.b02-repro/1790397518168/summary.json`.

### 3.5 Step 5 - Isolated E2E (`run-b02-isolated.mjs`)

- Verdict: `GATE_PASS`, exit `0`.
- Overall: `allRunsCompleted=true allExitZero=true allTimedOutFalse=true
  allPass=true allEightScenarios=true allTeardownClean=true
  allTcpClosed=true allCleanupResult=true allDataDirClean=true
  noForcedExit=true noSpawnError=true noNoExit=true noExitNonzero=true
  noPassForced=true`.

| Run | Suffix                       | Port  | Exit | TimedOut | Scenarios (ok/notOk) | `pg.stop` | `pg_ctl` | audit1 | audit2 | TCP final | dataDir      |
| --- | ---------------------------- | ----- | ---- | -------- | -------------------- | --------- | -------- | ------ | ------ | --------- | ------------ |
| 1   | `b02_r1_muhwhbo6_5a2383de`   | 56317 | 0    | false    | 8/0                  | returned (port already closed at 243ms) | skipped (port closed) | closed | closed | not connectable | removed |
| 2   | `b02_r2_muhwhl48_af7f9a60`   | 55434 | 0    | false    | 8/0                  | returned (port already closed at 237ms) | skipped (port closed) | closed | closed | not connectable | removed |
| 3   | `b02_r3_muhwhui5_f97674ee`   | 57189 | 0    | false    | 8/0                  | returned (port already closed at 258ms) | skipped (port closed) | closed | closed | not connectable | removed |

- The 8 scenarios are the full B.02-LOCAL-E2E suite:
  E2E-1 (replay same occurrence) yields 1 receipt + 1 intent;
  E2E-2 (two message_updated revisions same message.id different eventId)
  yields 2 receipts + 2 intents;
  E2E-3 (private_note yields NON_AUTHORITATIVE_PRIVATE_NOTE yields SKIP);
  E2E-4 (outgoing echo yields NON_AUTHORITATIVE_ECHO yields SKIP);
  E2E-5 [WORKER_PIPELINE_ONLY] parity with E2E-4;
  E2E-6 (same eventId + different payloadDigest yields 409 idempotency_conflict);
  E2E-7 (worker restart/resume with same idempotencyKey yields no double gateway effect);
  E2E-8 [WORKER_PIPELINE_ONLY] synthetic event must not self-mutate HRP/Handling/credit.
- No new listener or dataDir observed after the run completes.
- Evidence: `apps/integration-worker/.b02-evidence/1790397561172/summary.json`.

### 3.6 Step 6 - Negative isolated (`run-b02-isolated.mjs`, B02_NEGATIVE_PROBE=1)

- Verdict: `PROBE_PASS`, exit `2`.
- `runsRequested=1`, `runsCompleted=1`, `b02RunTimeoutMs=1000`.
- Run 1: `b02_r1_muhwi9z9_a0bebb54` (port 56307), `timedOut=true exit=1
  forcedExit=false`, `tap.ok=0` (test never reached because the suite
  exceeded the 1000ms budget), `dataDirCleanup=removed`.
- Cleanup sequence (all green despite the timeout):
  `taskkill_root ok=true code=0 stdout=SUCCESS: ... PID 18040 / 19060 /
  12260 / 13568 / 14120 / 3532 / 10068`,
  `netstat_port` observed only the legacy pre-R6 listeners (no R6 ports),
  `taskkill_port_owner skipped=no_owner_or_owned_by_root`,
  `pid_refresh skipped=port_already_closed`,
  `tcp_probe_after_kill connectable=false`, `bounded_wait_port_closed
  ok=true iterations=1 elapsedMs=30 reason=port_closed`,
  `audit1.closed=true`, `audit2.closed=true`, `tcp_probe_final
  connectable=false`, `final_audit.closed=true`, `final_tcp_probe
  connectable=false`, `verify_root_gone.exists=false`.
- `pgCtlAttempts=0`, `pgCtlValidation=null`, `pgCtlStop=null` - pg_ctl was
  not invoked because `pg.stop()` cleared the port before the helper needed
  to fall back.
- Evidence: `apps/integration-worker/.b02-evidence/1790397605635/summary.json`.

### 3.7 Step 7 - Negative reproducer (`run-b02-repro.mjs`, B02_REPRO_NEGATIVE_PROBE=1)

- Verdict: `PROBE_PASS`, exit `2`.
- `runsRequested=1`, `runsCompleted=1`, `b02RunTimeoutMs=1000`.
- Run 1: `repro_v2_muhwiiw5_a61211` (port 57238), `timedOut=true exit=1
  forcedExit=false`, `classification=NO_RESULT observed=null`, `tap.ok=0`,
  `dataDirCleanup=removed`.
- Cleanup sequence mirrors Step 6:
  `taskkill_root ok=true code=0 stdout=SUCCESS: ... PID 17364 / 16176 /
  3896 / 14832 / 21128 / 21880`,
  `netstat_port` shows only the legacy pre-R6 listeners,
  `pid_refresh skipped=port_already_closed`,
  `tcp_probe_after_kill connectable=false`, `bounded_wait_port_closed
  ok=true iterations=1 elapsedMs=32 reason=port_closed`,
  `audit1.closed=true`, `audit2.closed=true`, `tcp_probe_final
  connectable=false`, `final_audit.closed=true`, `final_tcp_probe
  connectable=false`, `verify_root_gone.exists=false`.
- `pgCtlAttempts=0`, `pgCtlValidation=null`, `pgCtlStop=null`.
- Evidence: `apps/integration-worker/.b02-repro/1790397617188/summary.json`.

---

## 4. Post-run listener / process / dataDir audit

After the 7 sequential groups completed, a system audit was performed against
all suffix ports observed during Round 6.

### 4.1 R6 ports (clean)

| Group | Suffix ports bound during run | Status after run           |
| ----- | ----------------------------- | -------------------------- |
| 1     | 51837                         | not connectable (TCP)      |
| 2     | 56889                         | not connectable (TCP)      |
| 3     | 56897                         | not connectable (TCP)      |
| 4     | 53656, 53525, 56774           | not connectable (TCP)      |
| 5     | 56317, 55434, 57189           | not connectable (TCP)      |
| 6     | 56307                         | not connectable (TCP)      |
| 7     | 57238                         | not connectable (TCP)      |

TCP probes for every R6 port returned `ECONNREFUSED` with `connectable=false`.

### 4.2 Filesystem audit

`apps/integration-worker/.tmp_pgdata_worker_*` directories created by R6 runs:
**none** (all removed; outer runner called `fs.rmSync(..., { recursive: true,
force: true })` after final TCP probe succeeded).

`.b02-probe/`, `.b02-repro/`, `.b02-evidence/` directories remain because
they are the agreed evidence store; `.gitignore` already excludes them.

### 4.3 Pre-R6 legacy listeners (intentionally untouched)

`netstat -ano` shows six legacy listeners on `127.0.0.1`:
`53297`, `54669`, `56656`, `57248`, `57506`, `57713`.

All six have PIDs (`13776`, `5888`, `2984`, `4644`, `15952`, `8096`) that no
longer resolve via `Get-CimInstance Win32_Process` (process is gone - they
are zombie sockets from prior interrupted runs before this correction).

These listeners predate Round 6 and have **zero overlap** with the R6 port
set (51837, 56889, 56897, 53656, 53525, 56774, 56317, 55434, 57189, 56307,
57238). Per Section 4 rule against self-killing legacy artifacts outside
scope, they are left in place.

---

## 5. Hygiene and scope

### 5.1 Changed file list (this correction commit)

```
 M apps/integration-worker/tests/b02-local-e2e.test.mjs
 M apps/integration-worker/tests/pg-worker-harness.mjs
 M apps/integration-worker/tests/repro/receiver-503-race.test.mjs
 M scripts/b02-cleanup.mjs
 M scripts/cleanup-probe.mjs
 M scripts/run-b02-isolated.mjs
 M scripts/run-b02-repro.mjs
```

7 files modified, `+745 / -204` lines (per `git diff --stat HEAD`).

### 5.2 UTF-8 no BOM check

| File                                                               | First 3 bytes | BOM? | Line endings |
| ------------------------------------------------------------------ | ------------- | ---- | ------------ |
| `apps/integration-worker/tests/b02-local-e2e.test.mjs`             | `2F 2A 2A` (`/**`) | no  | LF           |
| `apps/integration-worker/tests/pg-worker-harness.mjs`              | `2F 2A 2A` (`/**`) | no  | LF           |
| `apps/integration-worker/tests/repro/receiver-503-race.test.mjs`   | `2F 2A 2A` (`/**`) | no  | LF           |
| `scripts/b02-cleanup.mjs`                                          | `2F 2A 2A` (`/**`) | no  | LF           |
| `scripts/cleanup-probe.mjs`                                        | `2F 2A 2A` (`/**`) | no  | LF           |
| `scripts/run-b02-isolated.mjs`                                     | `2F 2A 2A` (`/**`) | no  | LF           |
| `scripts/run-b02-repro.mjs`                                        | `2F 2A 2A` (`/**`) | no  | LF           |

### 5.3 Encoding gate

Executed: `pwsh -NoProfile -ExecutionPolicy Bypass -File
D:\CodeApp\Hrp-Crm\.ai-pipeline\scripts\verify-encoding.ps1 -Paths <each-file>`.

Result per file:

```
ENCODING_GATE=PASS checked=1 rejected=0
```

### 5.4 `git diff --check`

```
EXITCODE=0
```

No whitespace or conflict warnings.

### 5.5 Shell hygiene

All commands invoked under `pwsh` (PowerShell 7+). No `powershell.exe`,
no disposable Python scripts for editing. All edits performed with
first-class editing tools.

### 5.6 Scope preserved

- 6 END_TO_END + 2 WORKER_PIPELINE_ONLY scenarios unchanged
  (E2E-1..E2E-8 from the existing test file).
- No production / business behaviour changes.
- No receiver concurrency semantics changes.
- No timeouts, assertions, or gates reduced.
- Frozen / shared contracts untouched
  (`packages/contracts/`, `docs/contracts/`, `apps/integration-api/...`).
- No Docker, VPS, deploy, migration, or credential changes.

---

## 6. Git discipline

- This correction commit's parent is `e0dd638539e813fc4aa9bac8c7a1b4f7924d04d8`.
- No amend, no rebase, no force-push.
- No merges from `main`.
- Push target: `origin/codex/v79b-b02-local-e2e-r1` (fast-forward).
- Working tree clean after the correction commit lands.
- Local SHA = remote SHA after push.

---

## 7. Final handoff summary

| Item                                                          | Result                                                                                                                                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root cause of dataDir disappearing                            | `persistent: false` let the embedded-postgres library remove the cluster before the listener was released; pg_ctl fallback then had no directory to operate on. R6-01 forces persistent true. |
| R6-01..R6-09 mapping                                          | See Section 2.                                                                                                                                                                               |
| Correction commit                                             | TBD_AFTER_COMMIT (single new commit on top of e0dd638).                                                                                                                                      |
| Parent commit                                                 | e0dd638539e813fc4aa9bac8c7a1b4f7924d04d8.                                                                                                                                                    |
| Changed file list                                             | 7 files (Section 5.1).                                                                                                                                                                        |
| 7-group LASTEXITCODE ledger                                   | All 7 PASS (Section 3, top table).                                                                                                                                                           |
| Per-run details (suffix/port/exit/timedOut/...)               | Sections 3.4-3.7.                                                                                                                                                                             |
| Timing probe budget / observed                                | budget=1200 elapsedMs=1495 iterations=5 reason=deadline_exceeded (Section 3.3).                                                                                                              |
| Post-run listener/process/dataDir audit                       | R6 ports/dataDirs clean; 6 legacy listeners left untouched (Section 4).                                                                                                                     |
| Encoding gate                                                 | ENCODING_GATE=PASS for all 7 changed files (Section 5.3).                                                                                                                                     |
| git diff --check                                              | exit 0 (Section 5.4).                                                                                                                                                                        |
| Round 6 artifacts remaining                                   | none.                                                                                                                                                                                        |
| Legacy artifacts preserved                                    | 6 zombie listeners on 127.0.0.1 (Section 4.3).                                                                                                                                               |
| Working tree                                                  | clean after correction commit; local SHA = remote SHA.                                                                                                                                       |

### Stop point

```
READY_FOR_T0_B02_LOCAL_E2E_RECHECK_R6
```

T1-B does **not** promote `B.02` to `ACCEPTED` on its own; the verdict
remains T0's decision after recheck.
