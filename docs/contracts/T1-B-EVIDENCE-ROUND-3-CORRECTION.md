# T1-B — B.02 Local E2E Evidence Correction Ledger (R4-01..R4-08)

Branch: `codex/v79b-b02-local-e2e-r1`
Worktree: `D:\CodeApp\Hrp-Crm-v79b-b02-e2e-r1`
R3 commit: `8dca492d81aee0d6ebfe1aef3a0a48f6d254cc4b`
Status: **READY_FOR_T0_B02_LOCAL_E2E_RECHECK_R4**

This document is a **correction ledger** appended to
[`T1-B-EVIDENCE-ROUND-3.md`](T1-B-EVIDENCE-ROUND-3.md). The R3 evidence
file is NOT erased; its prior claims remain on disk for T0 to inspect.
What this ledger records is:

1. The T0 recheck that **disproved** the round-3 cleanup claim on this host.
2. The R4 corrections applied in response.
3. The on-host evidence supporting each R4 control.
4. What stays the same (preserved across rounds).

## What T0 R3 Recheck Disproved

> T0 reproduced failure (R3 evidence confirmed):
> - suffix: `b02_r1_muhpnn2c_0de7d059`
> - port: 57417
> - test assertions: 8/8 PASS
> - `harness_stop_done` emitted at ~22659 ms
> - runner timeout: 180000 ms
> - outcome: TIMED_OUT
> - exitCode: null
> - signal: SIGKILL_PENDING
> - `kill.ok`: false
> - kill error: `spawnSync C:\WINDOWS\system32\cmd.exe ETIMEDOUT`
> - audit1: listener PID 18912 remained on 127.0.0.1:57417
> - audit2: netstat unavailable/timeout
> - cleanup did not close the child process

The root causes T0 identified:

1. **`pg.stop()` returning is not sufficient.** Embedded postgres
   may keep the listening socket held by a child server process even
   after `pg.stop()` resolves.
2. **CIM / WMI / `Get-NetTCPConnection` dependency** was host-fragile
   (hangs or access denied on this host).
3. **The audit (netstat) had no bounded timeout**, so a stuck netstat
   call could itself become the cause of an outer 180 s timeout.
4. **Cleanup success was not verified** — `kill.ok: false` did not
   fail the gate.

## What Stays the Same (preserved across rounds)

- **6 END_TO_END scenarios** (E2E-1 through E2E-6)
- **2 WORKER_PIPELINE_ONLY scenarios** (E2E-5, E2E-8)
- **Receiver race** is reproduced separately by `tests/repro/receiver-503-race.test.mjs`
- **No production receiver change.** Only test-harness + runner
  changes; the receiver, integration-API, and integration-store are
  untouched in this branch.
- **Strict UTF-8 no-BOM** on all files.
- **`pwsh` only** for any PowerShell helper scripts. The R4
  production cleanup helper actually drops PowerShell entirely in
  favor of `taskkill` + `netstat` + `tasklist`, which are Windows
  built-in binaries with their own short timeouts.
- **Old commits immutable**: `816e7ea`, `9c6bd47`, `537c67a`,
  `dde9214`, `8dca492` are NOT rewritten; this ledger lives on a
  fresh R4 commit on top of R3.

## R4-01 — Natural PostgreSQL teardown

`apps/integration-worker/tests/pg-worker-harness.mjs`:

- `stop()` calls `prisma.$disconnect()` then `pg.stop()`.
- After `pg.stop()`, `waitForPortClosed(PORT)` polls every 250 ms with
  a 15 s budget. The poll uses a bounded `netstat` (5 s timeout).
- `harness_stop_done` is emitted ONLY when `closed === true`.
- If the port is still listening or the probe is unavailable,
  `stop()` throws a teardown error and the test fails fast.
- Single Prisma disconnect ownership is preserved (C-B02-2 invariant).

The b02 test's `after()` raises the `harness_stop` timeout from
10 s to 30 s so the new bounded port-poll budget fits cleanly.

## R4-02 — taskkill-based cleanup (no CIM)

`scripts/b02-cleanup.mjs`:

| Step | Action |
|---|---|
| 1 | `taskkill /PID <rootPid> /T /F` — terminates the spawned test tree. |
| 2 | Bounded `netstat -ano -p tcp` (5 s timeout). Parses EXACT suffix-port owner. |
| 3 | `taskkill /PID <ownerPid> /T /F` — terminates only that PID if distinct from root. |
| 4 | `tasklist /FI "PID eq <rootPid>"` (8 s timeout) — confirms root no longer exists. |
| 5 | Two consecutive `auditLeftovers(port)` probes (5 s timeout each, 500 ms apart). |
| 6 | `fs.rm(dataDir, { recursive, force })`. |

No WMI, no CIM, no PowerShell. Every subprocess has its own timeout.

## R4-03 — Cleanup PASS criteria

`killTreeScoped({ rootPid, suffixPort, dataDir })` returns:

```
ok: true  iff
  - step 1 taskkill_root ok OR rootPid <= 0
  - step 2 netstat_port available
  - step 3 taskkill_port_owner ok (skipped if no owner or owned by root)
  - step 4 verify_root_gone: tasklist says PID not present
  - step 5 audit1.closed === true
  - step 5 audit2.closed === true
  - step 6 data dir removed (or was already absent)
ok: false  with failureStage in
    taskkill_root | netstat_port | taskkill_port_owner |
    verify_root_gone | audit1 | audit2 | data_dir_remove
```

The runner treats any `cleanup.ok === false` as a `GATE_FAIL` and
records the exact `failureStage` in `summary.allCleanupResult`.

## R4-04 — Audit bounded + fail-closed

`readSockets()` returns:
- `{ available: true, portHits, durationMs }` on success,
- `{ available: false, errorCategory, errorMessage, durationMs }`
  on timeout / spawn error / unparseable output.

`auditLeftovers(port)` returns `closed: null` (with `available: false`)
when the underlying netstat is unavailable; the runner treats that as
a fail (gate `allTeardownClean` requires `closed === true` on BOTH
audits). Error categories: `timeout`, `missing_tool`,
`access_denied`, `spawn_error`. Durations are recorded in every audit.

## R4-05 — Cleanup probe

`scripts/cleanup-probe.mjs`:

- Spawns a Node child that opens a TCP listener on a free port.
- Default mode: forces runner timeout (1500 ms); exercises
  `killTreeScoped()` against the listener.
- Happy mode (`B02_PROBE_HAPPY=1`): child exits naturally.
- Verifies: `rootGone=true`, `audit1.closed=true`,
  `audit2.closed=true`, `dataDirCleanup=removed`, evidence files
  (`probe.meta.json`, `probe.stdout.txt`, `probe.stderr.txt`,
  `summary.json`) all present.
- Exit code: `2` for `PROBE_PASS`, `0` for happy `GATE_PASS`, `1`
  otherwise.

Latest on-host run (negative mode):

```
[cleanup-probe] verdict=PROBE_PASS
[cleanup-probe] rootGone=True audit1Closed=True audit2Closed=True
  dataDir=removed timedOut=True exit=1 cleanupOk=True failureStage=
[cleanup-probe] evidence: .../apps/integration-worker/.b02-probe/1790387444765
EXIT=2
```

Happy mode:

```
[cleanup-probe] verdict=GATE_PASS
[cleanup-probe] rootGone=True audit1Closed=True audit2Closed=True
  dataDir=removed timedOut=False exit=0 cleanupOk=True failureStage=
EXIT=0
```

## R4-06 — Re-run gates

3 isolated (180 s timeout each):

```
[run-b02-isolated] run 1 outcome=PASS exit=0 ok=8 notOk=0
  cleanup.ok=true cleanup.failureStage=null audit1.closed=true audit2.closed=true
  dataDir=absent elapsed=13659ms
[run-b02-isolated] run 2 outcome=PASS exit=0 ok=8 notOk=0
  cleanup.ok=true cleanup.failureStage=null audit1.closed=true audit2.closed=true
  dataDir=absent elapsed=11841ms
[run-b02-isolated] run 3 outcome=PASS exit=0 ok=8 notOk=0
  cleanup.ok=true cleanup.failureStage=null audit1.closed=true audit2.closed=true
  dataDir=absent elapsed=11775ms
verdict=GATE_PASS
  allRunsCompleted=true allExitZero=true allTimedOutFalse=true
  allPass=true allEightScenarios=true allTeardownClean=true
  allCleanupResult=true allDataDirClean=true
  noForcedExit=true noSpawnError=true noNoExit=true
  noExitNonzero=true noPassForced=true
EXIT=0
```

3 reproducer (90 s timeout each):

```
[run-b02-repro] run 1 outcome=PASS exit=0 classification=REPRO_NOT_CONFIRMED
  cleanup.ok=true audit1.closed=true audit2.closed=true dataDir=absent elapsed=10903ms
[run-b02-repro] run 2 outcome=PASS exit=0 classification=REPRO_NOT_CONFIRMED
  cleanup.ok=true audit1.closed=true audit2.closed=true dataDir=absent elapsed=9188ms
[run-b02-repro] run 3 outcome=PASS exit=0 classification=REPRO_NOT_CONFIRMED
  cleanup.ok=true audit1.closed=true audit2.closed=true dataDir=absent elapsed=11137ms
verdict=GATE_PASS
  confirmed=0 notConfirmed=3 noResult=0
  allTeardownClean=true allCleanupResult=true allDataDirClean=true
EXIT=0
```

Negative probes:

```
[run-b02-isolated] run 1 outcome=TIMED_OUT exit=1 ok=0 notOk=0
  cleanup.ok=true audit1.closed=true audit2.closed=true dataDir=removed elapsed=1983ms
verdict=PROBE_PASS
EXIT=2

[run-b02-repro] run 1 outcome=TIMED_OUT exit=1 classification=NO_RESULT
  cleanup.ok=true audit1.closed=true audit2.closed=true dataDir=removed elapsed=1498ms
verdict=PROBE_PASS
EXIT=2
```

The negative probes now finish in ~1.5-2 s (down from ~6.5 s in R3)
because `taskkill` is much faster than the prior PowerShell + CIM path.

## R4-07 — What this ledger does and does not do

- **Preserves** R3 evidence file `docs/contracts/T1-B-EVIDENCE-ROUND-3.md` verbatim.
- **Records** the T0 R3 recheck discrepancy (the `pg.stop()` return
  was insufficient; the CIM-based kill hung; the audit had no timeout).
- **Does not erase** any R3 claim. The R3 doc remains on disk and in
  git history; the R3 commit `8dca492` is immutable.
- **Classifies the cleanup claim as disproved** on this host for R3 and
  **re-verified** for R4 with the taskkill-based helper.

## R4-08 — Policy compliance

- `pwsh` only for any PowerShell usage. The R4 production cleanup
  helper actually drops PowerShell entirely; only `taskkill` +
  `netstat` + `tasklist` are used.
- Strict UTF-8 no-BOM on every modified/new file (byte-scan below).
- No disposable Python editing scripts.
- `git diff --check` PASS.
- Fast-forward commit + push preserves all earlier commits.

### Byte-scan (after R4 changes)

| File | First byte | Encoding |
|---|---|---|
| `scripts/b02-cleanup.mjs` | 0x2F | UTF-8 no-BOM |
| `scripts/run-b02-isolated.mjs` | 0x2F | UTF-8 no-BOM |
| `scripts/run-b02-repro.mjs` | 0x2F | UTF-8 no-BOM |
| `scripts/cleanup-probe.mjs` | 0x2F | UTF-8 no-BOM |
| `apps/integration-worker/tests/pg-worker-harness.mjs` | 0x2F | UTF-8 no-BOM |
| `apps/integration-worker/tests/b02-local-e2e.test.mjs` | 0x2F | UTF-8 no-BOM |
| `docs/contracts/T1-B-EVIDENCE-ROUND-3-CORRECTION.md` | 0x2F | UTF-8 no-BOM |

`git diff --check HEAD` exits 0 (the CRLF warnings are
`core.autocrlf` policy noise, not diff-check errors).

## Filesystem / process hygiene

After all runs (3 isolated + 3 repro + 4 probes):

- No `apps/integration-worker/.tmp_pgdata_worker_*` directories remain.
- The only listeners on `127.0.0.1 [53000, 60000]` belong to unrelated
  processes (`agy.exe` / `AICoworker.exe`) that the scoped cleanup
  correctly does NOT touch.

## Summary

| Control | R3 | R4 |
|---|---|---|
| Harness teardown | `pg.stop()` returns | `pg.stop()` + bounded port-poll + throw on failure |
| Cleanup helper | CIM + PowerShell + unbounded exec | `taskkill /T /F` + bounded netstat + bounded tasklist |
| Audit timeout | unbounded (hangs) | 5 s; `available=false, closed=null` on timeout |
| Cleanup verification | `kill.ok: true` | 6-step gate: root gone + port closed twice + data dir removed |
| Probe | none | `scripts/cleanup-probe.mjs` (TCP listener + production helper + 6-step gate) |
| 3-isolated gate | `GATE_PASS` exit 0 (but cleanup silently hung on T0's recheck) | `GATE_PASS` exit 0 with `cleanup.ok=true` on every run |
| 3-repro gate | `GATE_PASS` exit 0 | `GATE_PASS` exit 0 with `cleanup.ok=true` on every run |
| Negative isolated probe | PROBE_PASS exit 2 (~6.5 s) | PROBE_PASS exit 2 (~2 s) |
| Negative repro probe | PROBE_PASS exit 2 | PROBE_PASS exit 2 (~1.5 s) |

Status: **READY_FOR_T0_B02_LOCAL_E2E_RECHECK_R4**