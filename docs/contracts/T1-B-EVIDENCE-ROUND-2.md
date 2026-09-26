# T1-B Correction Round 2 Evidence — B.02-LOCAL-E2E

**Branch**: `codex/v79b-b02-local-e2e-r1`
**Worktree**: `D:\CodeApp\Hrp-Crm-v79b-b02-e2e-r1`
**HEAD**: `537c67a` (round 1 corrections) → correction round 2 HEAD
**Node**: v24.19.0 | npm 11.17.0 | Windows 10.0.26200
**Date**: 2026-09-25

---

## Prior T0 Execution Evidence (that triggered round 2)

| Run | Outcome | Exit | Signal | Timeout | Note |
|-----|---------|------|--------|---------|------|
| Run 1 | HUNG | — | — | ∞ | No summary.json written; PG still LISTENING on port 56649 |
| Narrow repro (12 bursts) | NOT_CONFIRMED | 0 | — | — | storeUnavailable=0 across 3 runs |

Root cause identified by T0:
- `run-b02-isolated.mjs` had **no per-run timeout**, no signal handler, no tree-kill.
- Child `node --test` could hang on `child.on('close')` if any handle (embedded-PG subprocess, undici keep-alive socket, or open stdio pipe from a verbose PG child process) prevented clean exit.
- Runner blocked indefinitely; `summary.json` never written; run 2 and 3 never started.
- **Prior round**: `hard_exit` timer was armed at **module load** time (3-second default), not after `after()` completed. This caused the test to be force-killed at 3s on every run (before it even finished setup), producing a misleading "exit 0 / 1 ok".

---

## Round-2 Corrections Applied

### C2-01 — Per-run Timeout

**File**: `scripts/run-b02-isolated.mjs`

- Added `Promise.race` between `child.on('close')` and a `setTimeout(RUN_TIMEOUT_MS)` watchdog.
- Default 180 s; overridable via `B02_RUN_TIMEOUT_MS` env var.
- On timeout: `timedOut=true`, calls `killTreeScoped(child, port)`, waits 5 s for final close, records outcome as `TIMED_OUT`.

### C2-02 — Evidence on Every Outcome

**File**: `scripts/run-b02-isolated.mjs`

Per-run evidence is now written for:
- ✅ PASS (exit 0)
- ✅ EXIT_NONZERO (test failure)
- ✅ TIMED_OUT (timeout)
- ✅ SPAWN_ERROR (could not fork)
- ✅ NO_EXIT (child killed but did not close)

Each `run-*.meta.json` contains: `exitCode`, `signal`, `timedOut`, `elapsedMs`, `suffix`, `port`, `dataDir`, `tap.{ok,notOk,total,subtests}`, `teardownAudit`, `stages[]`, `stdout` (redacted), `stderr`.

### C2-03 — Process-Tree Cleanup

**File**: `scripts/run-b02-isolated.mjs` — `killTreeScoped(child, port)`

On Windows, uses PowerShell to:
1. Enumerate descendants of `child.pid` via `Win32_Process`.
2. Also find PIDs owning a TCP LISTEN socket on the suffix port (`Get-NetTCPConnection`).
3. Force-kill all with `Stop-Process -Force`.

Cleanup is **scoped to the current suffix**; unrelated Node/PostgreSQL processes are never killed.

Audit runs ≥2× with 500 ms between checks. If listener persists after cleanup, run `outcome` is `EXIT_NONZERO` with `teardownAudit.ok=false`.

### C2-04 — Find the Hang

**Root Cause** (identified in smoke testing before corrections):

The hang was **not at the test level** — the b02 test completes and exits naturally within ~12 s. The hang was **at the runner level**: `run-b02-isolated.mjs` had no timeout on `child.on('close')`, so if any open handle in the child Node process (embedded-PG child, undici keep-alive socket, verbose stdout from `pg_ctl start` command that never drains) prevented `process.exit`, the runner's `await` on the close promise blocked indefinitely.

Additionally, the prior round had `hard_exit` timer armed at module load time (3 s default), killing the test process prematurely before it finished `before()` setup.

**Fixes applied**:

1. **Runner timeout** (C2-01): never block more than `RUN_TIMEOUT_MS`.
2. **Test lifecycle diagnostics**: every stage emits `{"kind":"lifecycle","stage":"<name>","atMs":...}` to stdout and to `stages[]` in meta.json.
3. **Per-step timeout in `after()`**: each teardown step (`close_receiver_server`, `close_mockGateway`, `harness_stop`) runs with an 8 s / 5 s / 10 s hard timeout.
4. **Hard-exit guard**: `setTimeout(30 s)` armed only after `after_complete` is recorded; fires only if `beforeExit` never fires (i.e. undici keep-alive prevents natural exit).
5. **Single disconnect owner**: `harness.stop()` owns both `prisma.$disconnect()` and `pg.stop()`; no other code calls `$disconnect`.

Evidence from smoke run (single isolated, before reclassification):

```
# {"kind":"lifecycle","atMs":10795,"stage":"harness_started"}
# {"kind":"lifecycle","atMs":10806,"stage":"mockGateway_listening"}
# {"kind":"lifecycle","atMs":11053,"stage":"receiver_listening"}
[tests 1-8 run...]
# {"kind":"lifecycle","atMs":12181,"stage":"close_receiver_server_begin"}
# {"kind":"lifecycle","atMs":12183,"stage":"close_receiver_server_done","ok":true}
# {"kind":"lifecycle","atMs":12184,"stage":"close_mockGateway_begin"}
# {"kind":"lifecycle","atMs":12185,"stage":"close_mockGateway_done","ok":true}
# {"kind":"lifecycle","atMs":12185,"stage":"harness_stop_begin"}
# {"kind":"lifecycle","atMs":12516,"stage":"harness_stop_done","ok":true}
# {"kind":"lifecycle","atMs":12517,"stage":"after_complete","errors":0}
# {"kind":"lifecycle","atMs":12518,"stage":"before_exit","code":0}
# {"kind":"process_exit","code":0,"elapsedMs":12519,"stage_count":13}
```

All 13 lifecycle stages recorded. PG database system cleanly shut down (confirmed by PG log line: `LOG: database system was shut down`).

### C2-05 — Honest Reproducer

**File**: `apps/integration-worker/tests/repro/receiver-503-race.test.mjs`

Prior reproducer asserted `okCount >= 1` and always passed, even when storeUnavailable=0.

**New classification**:

| Classification | Condition | Test outcome |
|---------------|-----------|-------------|
| `REPRO_CONFIRMED` | ≥1 response has status=503 AND body.code=`store_unavailable` | PASS |
| `REPRO_NOT_CONFIRMED` | No exact signature in this run | PASS (honest — no race this run) |

The `kind=repro_result` JSON line in stdout carries the classification:

```json
{"kind":"repro_result","run":"3","classification":"REPRO_NOT_CONFIRMED",
 "signature":"status=503 AND body.code=store_unavailable",
 "observed":{"n":12,"okCount":12,"storeUnavailable":0,"otherCount":0}}
```

The test does NOT assert that the race must occur. A run with 0 races is not a test failure — it is honest evidence that the race did not surface in that specific run.

### C2-06 — Receiver-Path Integrity

**File**: `apps/integration-worker/tests/b02-local-e2e.test.mjs`

| Scenario | Classification | Path | HTTP 202 asserted? |
|----------|---------------|------|---------------------|
| E2E-1 | END_TO_END | Real HTTP receiver | Yes |
| E2E-2 | END_TO_END | Real HTTP receiver | Yes |
| E2E-3 | END_TO_END | Real HTTP receiver | Yes |
| E2E-4 | END_TO_END | Real HTTP receiver | Yes |
| E2E-5 | WORKER_PIPELINE_ONLY | Direct seed (no HTTP) | N/A |
| E2E-6 | END_TO_END | Real HTTP receiver | Yes (first webhook 202, second 409) |
| E2E-7 | END_TO_END | Real HTTP receiver | Yes |
| E2E-8 | WORKER_PIPELINE_ONLY | Direct seed (no HTTP) | N/A |

**E2E-5 and E2E-8** were reclassified to `WORKER_PIPELINE_ONLY` because the **production receiver has a documented concurrency race** on tight back-to-back webhooks to the same connection (separate task: `receiver-concurrency-race-fix`). When routed through the real HTTP receiver, these two scenarios fail with `webhook terminal 503 after 12 attempts (eventId=evt-b02e2e-echo-002 / evt-b02e2e-canon-002)` in approximately 6/10 runs.

Per C2-06 contract: "Nếu scenario vẫn direct-seed, đổi classification thành WORKER_PIPELINE_ONLY và loại khỏi B.02 end-to-end acceptance count."

These two scenarios are **excluded from the END_TO_END acceptance count**. The acceptance contract is now:
- **6/6 END_TO_END** (E2E-1, E2E-2, E2E-3, E2E-4, E2E-6, E2E-7)
- **2/2 WORKER_PIPELINE_ONLY** (E2E-5, E2E-8)
- **8/8 total tests PASS**

### C2-07 — Rerun Gate

**3-run isolated gate** (C2-07): see §Full 3-Run Gate Results below.

**Narrow reproducer** (C2-07): see §Narrow Reproducer Results below.

---

## Full 3-Run Gate Results

**Command**: `node scripts/run-b02-isolated.mjs` (defaults: 3 runs, 180 s timeout)
**Evidence dir**: `apps/integration-worker/.b02-evidence/1790352547462/`

| Run | Suffix | Port | DataDir | Outcome | Exit | Signal | TimedOut | ok | notOk | elapsed | teardown | verdict |
|-----|--------|------|---------|---------|------|--------|----------|----|----|---------|----------|---------|
| 1 | b02_r1_muh5oivc_f828a636 | 55678 | — | PASS | 0 | null | false | 8 | 0 | 11620 ms | ok | GATE_PASS |
| 2 | b02_r2_muh5osc8_80604eab | 55113 | — | PASS | 0 | null | false | 8 | 0 | 12335 ms | ok | GATE_PASS |
| 3 | b02_r3_muh5p2cp_bde62c28 | 55182 | — | PASS | 0 | null | false | 8 | 0 | 12779 ms | ok | GATE_PASS |

**Overall**: `verdict=GATE_PASS allExitZero=true allTimedOutFalse=true allTeardownClean=true allDataDirClean=true`

### Per-run Subtest Breakdown

| Subtest | Run 1 | Run 2 | Run 3 |
|---------|-------|-------|-------|
| E2E-1: replay idempotent | PASS | PASS | PASS |
| E2E-2: 2 receipts, 2 intents | PASS | PASS | PASS |
| E2E-3: NON_AUTHORITATIVE_PRIVATE_NOTE | PASS | PASS | PASS |
| E2E-4: NON_AUTHORITATIVE_ECHO | PASS | PASS | PASS |
| E2E-5 [WORKER_PIPELINE_ONLY]: NON_AUTHORITATIVE_ECHO parity | PASS | PASS | PASS |
| E2E-6: 409 idempotency_conflict | PASS | PASS | PASS |
| E2E-7: worker restart/resume | PASS | PASS | PASS |
| E2E-8 [WORKER_PIPELINE_ONLY]: canonical integrity | PASS | PASS | PASS |

### Post-run Leftover Audit

After each run, netstat checked port 53000-59999 on 127.0.0.1:

```
Run 1: immediatelyAfterExit.ok=true afterDelay.ok=true  (no port hits)
Run 2: immediatelyAfterExit.ok=true afterDelay.ok=true  (no port hits)
Run 3: immediatelyAfterExit.ok=true afterDelay.ok=true  (no port hits)
```

No `postgres.exe` processes owned by test runs remained. All `.tmp_pgdata_worker_*` data dirs removed by runner.

---

## Narrow Reproducer Results

**Command**: `node scripts/run-b02-repro.mjs` (3 sequential runs, each with unique suffix, 90 s timeout)
**Evidence dir**: `apps/integration-worker/.b02-repro/1790352703445/`

| Run | Suffix | Port | Classification | okCount | storeUnavailable | OtherCount | Exit | elapsed |
|-----|--------|------|---------------|---------|-----------------|-----------|------|---------|
| 1 | repro_v2_muh5rv87_039644 | 54707 | REPRO_NOT_CONFIRMED | 12 | 0 | 0 | 0 | 10687 ms |
| 2 | repro_v2_muh5s3h7_d82781 | 55187 | REPRO_NOT_CONFIRMED | 12 | 0 | 0 | 0 | 11371 ms |
| 3 | repro_v2_muh5sc95_a5214a | 53936 | REPRO_NOT_CONFIRMED | 12 | 0 | 0 | 0 | 12157 ms |

All 3 runs: 12/12 requests returned 202, 0 terminal 503.

**Observation**: The race is non-deterministic in isolation (12 concurrent POSTs to a clean embedded PG produce no race). The race is **context-dependent**: it was observed when E2E-5/E2E-8 run **after** ~6 prior webhooks in the same connection, within a tight window. The narrow reproducer confirms that a fresh-connection burst alone does not reproduce the race. See §Receiver-Concurrency-Race for next steps.

---

## Receiver-Concurrency-Race

**Classification**: Production receiver defect (separate task).
**Severity**: Non-deterministic, manifests when ~6+ webhooks fire at the same connection within ~500 ms.
**Signature**: `status=503 + body.code=store_unavailable`.
**Impact**: Blocks receipt durability for the affected webhook; subsequent webhooks may also fail until PG transaction visibility settles (~80 ms).

**Root cause hypothesis**: `ON CONFLICT DO NOTHING ... RETURNING` returns `[]` when Transaction B runs the upsert concurrently before Transaction A's commit is visible to B's snapshot. The receiver interprets `[]` as "record not found after ON CONFLICT" and throws `store_unavailable`.

**This batch**: production receiver NOT modified. E2E-5 and E2E-8 reclassified `WORKER_PIPELINE_ONLY` per C2-06.

**Next step**: Separate task `receiver-concurrency-race-fix` (not in this batch).

---

## Changed Files

| File | C2 | Change |
|------|----|--------|
| `scripts/run-b02-isolated.mjs` | C2-01, C2-02, C2-03 | Complete rewrite: per-run timeout via `Promise.race`, process-tree kill via PowerShell, evidence on every outcome, 2× netstat audit, TAP subtest parser |
| `apps/integration-worker/tests/b02-local-e2e.test.mjs` | C2-04, C2-06 | Added lifecycle diagnostics, per-step timeouts in after(), hard-exit guard armed post-teardown, reclassified E2E-5 and E2E-8 as WORKER_PIPELINE_ONLY, added seedReceiptAndIntentWorkerOnly helper, sha256Hex via `node:crypto` |
| `apps/integration-worker/tests/repro/receiver-503-race.test.mjs` | C2-05 | Complete rewrite: honest classification, REPRO_CONFIRMED vs REPRO_NOT_CONFIRMED, no false-positive PASS |
| `scripts/run-b02-repro.mjs` | C2-07 | NEW — reproducer runner with 3× sequential isolated runs and structured evidence |

---

## Commands and Versions

```bash
node --version          # v24.19.0
npm --version           # 11.17.0
node scripts/run-b02-isolated.mjs          # 3 sequential isolated runs
node scripts/run-b02-repro.mjs              # 3 narrow reproducer runs
```

**Override env vars**:
- `B02_RUN_TIMEOUT_MS` — per-run timeout (default 180000 ms)
- `B02_RUN_COUNT` — number of runs (default 3)
- `B02_TREE_KILL_BUDGET_MS` — Windows tree kill budget (default 8000 ms)
- `B02_AUDIT_DELAY_MS` — delay before first netstat audit (default 500 ms)
- `B02_HARD_EXIT_DELAY_MS` — test process hard-exit guard (default 30000 ms)
- `PG_HARNESS_SUFFIX` — auto-derived per run by runner scripts

---

## Git Status

```bash
# Branch: codex/v79b-b02-local-e2e-r1
git status --short | grep -v "^ M .gitignore" | grep -v "^ M apps/context-panel" | grep -v "^ M packages/contracts" | grep -v "^ M apps/integration-api" | grep -v "^ M apps/integration-worker" | grep -v "^ M scripts/v7.9a" | grep -v "^ M docs/contracts"
```

**Changed files in this correction**:
- `scripts/run-b02-isolated.mjs` (modified)
- `apps/integration-worker/tests/b02-local-e2e.test.mjs` (modified)
- `apps/integration-worker/tests/repro/receiver-503-race.test.mjs` (modified)
- `scripts/run-b02-repro.mjs` (new)

**Prior immutable commits** (round 1, NOT modified):
- `816e7ea` — test(b02-local-e2e): add 8 end-to-end scenarios
- `9c6bd47` — docs(b02-local-e2e): assessment with classification, evidence, GAPS
- `537c67a` — fix(t1-b/b02-e2e): correction bundle per T0 verdict

---

## Target Status

**READY_FOR_T0_B02_LOCAL_E2E_RECHECK**

- 3/3 isolated runs exit 0, 8/8 tests PASS, no hang.
- No terminal 503 in isolated runs (E2E-5/E2E-8 reclassified WORKER_PIPELINE_ONLY).
- Teardown clean: no leftover listeners/processes/data dirs.
- Reproducer honestly reports REPRO_NOT_CONFIRMED × 3.
- Lifecycle diagnostics confirm: `close_receiver_server_done`, `close_mockGateway_done`, `harness_stop_done`, `after_complete` for every run.
- `before_exit` and `process_exit` emitted for every run.
- No production receiver source modified.
- `run-b02-isolated.mjs` writes `summary.json` on every outcome (including timeout/signal).

**Next task for T0**: Assess `receiver-concurrency-race-fix` — the race is a real production defect but is excluded from this batch per C2-06 contract.
