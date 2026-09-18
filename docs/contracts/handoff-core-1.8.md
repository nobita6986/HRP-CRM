# CORE/1.8 — Retry, DLQ, Reconciliation & Outbound Handoff Mock

**Status:** READY FOR AUDIT (post-blocker-fix recheck pending)
**Contracts Pin:** 0.0.8-g0.8-fixes (unchanged)
**Dependencies:** CORE/1.3 (Integration Store), CORE/1.4 (Lease/Retry/Clock), CORE/1.7 (Review service)
**Date:** 2026-09-15
**Blocker Fix Date:** 2026-09-15 (round 2: 2026-09-16 — outbox assertion bug)

---

## 0. Task Overview

CORE/1.8 implements the retry, dead-letter queue, reconciliation, and outbound handoff mock per 5 AC:

| AC | Description | Files |
|---|---|---|
| AC1 | Retryable errors with bounded exponential backoff + jitter | `retry.ts`, `lease.ts`, `pipeline-executor.ts` |
| AC2 | DLQ with safe metadata, redrive scope, DNC guards | `dlq/`, `event-receipt.ts` |
| AC3 | Outbound intent simulation → durable receipt → ACK | `outbox/dispatcher.ts`, `outbox/delivery-receipt.ts`, `outbox/delivery-reporting.ts` |
| AC4 | UNKNOWN reconcile scenario, no fake success | `outbox/reconciliation.ts`, `outbox/unknown-handler.ts` |
| AC5 | Reconciler for stuck receipts/jobs/mappings | `reconciler/`, `reconciliation.ts` |

---

## 1. Architecture

### 1.1 Retry (AC1)

```
Gateway error → classifyGatewayError(err)
  → VALIDATION_ERROR/VERSION_CONFLICT/... → DEAD_LETTERED immediately
  → TRANSACTION_FAILED/RATE_LIMITED/...   → computeNextAttemptAt(policy, attempts, clock)
       → RETRY_SCHEDULED (attempts < maxAttempts=8)
       → DEAD_LETTERED (attempts >= maxAttempts)
```

**Key components:**
- `computeNextAttemptAt(policy, currentAttempts, clock)` — bounded exponential backoff + jitter
- `decideRetryState(policy, currentAttempts, err)` — RETRY_SCHEDULED or DEAD_LETTERED
- `classifyGatewayError(err)` — maps gateway errors to retry/non-retry
- `PipelineExecutorOptions.completeReceiptFn` — injectable so worker owns transaction boundary

### 1.2 DLQ (AC2)

```
ExternalEventReceipt.state = DEAD_LETTERED
  → listDeadLetteredReceipts(orgId, filters?) — safe metadata only
  → redriveReceipt(receiptId, actor, clock)
       → DNC guard check
       → MAX_ATTEMPTS cap check
       → OUTBOX_PATCH_FORBIDDEN validation
       → Reset DEAD_LETTERED → PENDING
       → Audit trail in evidenceRefsJson
```

**HTTP routes:**
- `GET /mock/dlq/list` — list dead letters
- `GET /mock/dlq/stats` — DLQ statistics
- `GET /mock/dlq/preview/:receiptId` — redrive preview (dry-run)
- `POST /mock/dlq/redrive` — redrive with DNC guard

### 1.3 Outbound (AC3)

```
HRP Outbox Intent → DispatchIntent (PENDING)
  → OutboxDispatcher.poll() → claimNextIntent() → LEASED
  → Mock provider call (gateway)
  → completeIntent(DELIVERED|FAILED)
```

**Delivery receipt flow:**
```
OutboxDeliveryReceipt (outcome: ACCEPTED only)
  → DeliveryReceiptHandler.handle()
  → DispatchIntent.status → ACK_RECEIVED
```

**Delivery reporting flow:**
```
DeliveryReportingEvent (SENT/DELIVERED/FAILED/UNKNOWN/SUPPRESSED)
  → DeliveryReportingHandler.handle()
  → IntentStatus transition
```

**HTTP routes:**
- `POST /mock/outbox/intent` — submit outbound intent
- `POST /mock/outbox/receipt` — record durable receipt
- `POST /mock/outbox/report` — receive delivery report

### 1.4 UNKNOWN Reconciliation (AC4)

```
DeliveryReportingEvent.state = UNKNOWN
  → UnknownDeliveryHandler.handleUnknownDelivery(event, actor)
  → Intent.status → INVESTIGATION_PENDING
  → ReconciliationEntry created (PENDING_INVESTIGATION)
  → NO auto-transition to DELIVERED or FAILED
```

**Resolution workflow:**
```
ReconciliationEntry (PENDING_INVESTIGATION)
  → resolveReconciliation(entryId, CONFIRMED/FAILED/RETRY, actor, note)
      → CONFIRMED: Intent → DELIVERED
      → FAILED:    Intent → FAILED
      → RETRY:     Intent → PENDING (with new idempotency key)
```

**HTTP routes:**
- `GET /mock/outbox/reconciliation/list` — list entries
- `GET /mock/outbox/reconciliation/detail/:id` — single entry
- `POST /mock/outbox/reconciliation/investigate/:id` — mark investigating
- `POST /mock/outbox/reconciliation/resolve` — resolve with evidence

### 1.5 Reconciler (AC5)

```
ReconciliationScheduler.runScan()
  → StuckReceiptReconciler.findStuckReceipts()
      → createRecoveryAction() [idempotent via unique constraint]
      → resetStuckReceipt() [LEASED + expired → PENDING]
  → StuckIntentReconciler.findStuckIntents()
      → createRecoveryAction() [idempotent via unique constraint]
      → resetStuckIntent() [LEASED + expired → PENDING]
```

**HTTP routes:**
- `GET /mock/reconciler/stuck` — list stuck items
- `POST /mock/reconciler/recover` — manual recovery
- `GET /mock/reconciler/recovery-actions` — list recovery actions
- `POST /mock/reconciler/scan` — trigger scan
- `GET /mock/reconciler/stats` — scheduler stats

---

## 2. AC Coverage

### AC1: Retry bounds

| Requirement | Status | Evidence |
|---|---|---|
| Retryable errors use bounded exponential backoff + jitter | ✅ | `computeNextAttemptAt` with injected clock; jitter ±20%; exponential capped at 5min |
| Policy/validation errors do NOT retry indefinitely | ✅ | `classifyGatewayError` → DEAD_LETTERED for VALIDATION_ERROR/VERSION_CONFLICT/IDEMPOTENCY_CONFLICT/SCOPE_MISMATCH/TENANT_SCOPE_REQUIRED |
| Max 8 attempts → DEAD_LETTERED | ✅ | `DEFAULT_RETRY_POLICY.maxAttempts = 8`; `decideRetryState` enforces |
| Clock injected for deterministic tests | ✅ | `manualClock`/`mutableClock` in tests; `systemClock` in production |
| Duplicate/concurrent receipt → fenced | ✅ | `completeReceipt` with fencingToken check; stale worker → fencedRejected |

**Test evidence:** 42/42 tests pass (`retry.test.mjs`)

### AC2: DLQ

| Requirement | Status | Evidence |
|---|---|---|
| DLQ stores safe error metadata (no stack/PII) | ✅ | `DlqEntry.safeErrorMetadata` — no raw error field |
| DLQ stores attempts count and redrive scope | ✅ | `DlqEntry.attempts`, `DlqEntry.redriveScope` |
| Redrive preserves event/command keys, actor audit | ✅ | `evidenceRefsJson.dlqAudit` records actor, timestamp, reason |
| Redrive does NOT bypass DNC guard | ✅ | `MockDncGuard.checkDnc()` called before redrive |
| Redrive does NOT allow arbitrary payload modification | ✅ | `DlqRedriveInput` only has receiptId + reason fields |
| Redrive respects maxAttempts cap | ✅ | `MAX_REDRIVE_ATTEMPTS = 5` config; check in `redriveReceipt` |
| Redrive blocked by OUTBOX_PATCH_FORBIDDEN fields | ✅ | `OUTBOX_PATCH_FORBIDDEN` check in redrive path |

**Test evidence:** 12/12 tests pass (`dlq.test.mjs`)

### AC3: Outbound ACK

| Requirement | Status | Evidence |
|---|---|---|
| Simulate accepted intent → durable receipt | ✅ | `DeliveryReceiptHandler` → ACK_RECEIVED state |
| Duplicate intent → idempotent | ✅ | `claimNextIntent` with `FOR UPDATE SKIP LOCKED`; idempotency via receiptId+intentId |
| ACK only after durable commit | ✅ | Transaction boundary via Prisma |
| UNKNOWN ≠ success | ✅ | Maps to FAILED, not DELIVERED |

**Test evidence:** 11/11 tests pass (`outbox.test.mjs`)

### AC4: UNKNOWN Reconciliation

| Requirement | Status | Evidence |
|---|---|---|
| UNKNOWN → INVESTIGATION_PENDING (NOT DELIVERED) | ✅ | `IntentStatus.INVESTIGATION_PENDING` enum; handler transitions there |
| UNKNOWN creates ReconciliationEntry | ✅ | `reconciliationService.createReconciliationEntry()` in `handleUnknownDelivery` |
| System does NOT mark DELIVERED or resend blindly | ✅ | Handler only creates entry; explicit resolution required |
| Failed handoff does NOT fake success | ✅ | FAILED state recorded with reason; UNKNOWN state requires investigation |
| UNKNOWN never auto-resolves to DELIVERED | ✅ | Explicit resolution (CONFIRMED/FAILED/RETRY) required |

**Test evidence:** 15/15 tests pass (`outbox-reconcile.test.mjs`)

### AC5: Reconciler

| Requirement | Status | Evidence |
|---|---|---|
| Detects stuck receipts (LEASED + expired) | ✅ | `findStuckReceipts()` in `stuck-receipt-reconciler.ts` |
| Detects stuck intents (LEASED + expired) | ✅ | `findStuckIntents()` in `stuck-intent-reconciler.ts` |
| Recovery actions with dedupe | ✅ | `RecoveryAction` with `@@unique([itemType, itemId])`; P2002 → returns existing |
| No SQL against HRP core DB | ✅ | All reads/writes use `integration` schema only |
| No outbound to real providers | ✅ | Mock gateway; no real provider calls |

**Test evidence:** 20/20 tests pass (`reconciler.test.mjs`)

---

## 3. Test Results

### CORE/1.8 specific
```
retry.test.mjs           : 42/42 ✅
dlq.test.mjs            : 12/12 ✅
outbox.test.mjs          : 12/12 ✅
outbox-reconcile.test.mjs: 15/15 ✅
reconciler.test.mjs     : 20/20 ✅
Total CORE/1.8          : 101/101 ✅
```

### Full regression
```
integration-api: 338/338 ✅
integration-worker: 56/56 ✅ (unchanged)
contracts: 398/398 ✅ (unchanged)
config: 16/16 ✅ (unchanged)
context-panel: 11/11 ✅ (unchanged)
Total: 819/819 ✅
```

---

## 4. Files Changed

### New files
| File | LOC | Purpose |
|---|---|---|
| `apps/integration-api/src/dlq/http-handler.ts` | ~120 | HTTP routes for DLQ |
| `apps/integration-api/src/dlq/index.ts` | ~180 | DlqService + MockDncGuard |
| `apps/integration-api/src/outbox/dispatcher.ts` | ~150 | OutboxDispatcher polling |
| `apps/integration-api/src/outbox/delivery-receipt.ts` | ~100 | DeliveryReceiptHandler |
| `apps/integration-api/src/outbox/delivery-reporting.ts` | ~130 | DeliveryReportingHandler |
| `apps/integration-api/src/outbox/reconciliation.ts` | ~420 | ReconciliationService |
| `apps/integration-api/src/outbox/unknown-handler.ts` | ~120 | UnknownDeliveryHandler |
| `apps/integration-api/src/outbox/http-handler.ts` | ~200 | HTTP routes for outbox |
| `apps/integration-api/src/outbox/index.ts` | ~30 | Barrel exports |
| `apps/integration-api/src/reconciler/http-handler.ts` | ~100 | HTTP routes for reconciler |
| `apps/integration-api/src/reconciler/reconciliation-scheduler.ts` | ~80 | ReconciliationScheduler |
| `apps/integration-api/src/reconciler/stuck-receipt-reconciler.ts` | ~120 | StuckReceiptReconciler |
| `apps/integration-api/src/reconciler/stuck-intent-reconciler.ts` | ~100 | StuckIntentReconciler |
| `apps/integration-api/src/reconciler/index.ts` | ~20 | Barrel exports |
| `apps/integration-api/tests/dlq.test.mjs` | ~350 | 12 AC2 tests |
| `apps/integration-api/tests/outbox.test.mjs` | ~530 | 11/12 AC3 tests (1 pre-existing assertion bug) |
| `apps/integration-api/tests/outbox-reconcile.test.mjs` | ~600 | 15 AC4 tests |
| `apps/integration-api/tests/reconciler.test.mjs` | ~700 | 20 AC5 tests |
| `apps/integration-api/tests/retry.test.mjs` | ~850 | 42 AC1 tests |
| `apps/integration-api/tests/pg-reconciler-harness.mjs` | ~90 | PG harness for AC5 tests |
| `apps/integration-api/tests/pg-reconcile-harness.mjs` | ~2,892 | PG harness for AC4 tests |
| `apps/integration-api/src/outbox/ac3-handler.ts` | ~380 | HTTP handler for AC3 intent/receipt/report routes |
| `packages/integration-store/src/repos/reconciliation.ts` | ~200 | RecoveryAction repository |
| `packages/integration-store/prisma/migrations/0004_recovery_action/` | ~60 | RecoveryAction migration |
| `packages/integration-store/prisma/migrations/0005_reconciliation_entry/` | ~40 | ReconciliationEntry migration |

### Modified files
| File | Change |
|---|---|
| `apps/integration-api/src/server.ts` | Wired /mock/dlq/*, /mock/outbox/*, /mock/reconciler/* routes |
| `packages/integration-store/src/worker/retry.ts` | Comment cleanup; return type narrowing |
| `packages/integration-store/src/worker/lease.ts` | Wired computeNextAttemptAt for RETRY_SCHEDULED |
| `packages/integration-store/src/repos/event-receipt.ts` | Added listDeadLetteredReceipts, redriveReceipt, findStuckReceipts, findStuckIntents, resetStuckReceipt, resetStuckIntent |
| `packages/integration-store/src/index.ts` | Export new reconciliation functions |
| `packages/integration-store/prisma/schema.prisma` | Added IntentStatus.INVESTIGATION_PENDING, RecoveryAction model, ReconciliationEntry model, RecoveryStatus/ReconciliationStatus enums |
| `packages/integration-store/tsconfig.json` | Path fix for dist declaration |
| `apps/integration-api/package.json` | Added @hrp-engagement/integration-worker devDep |
| `apps/integration-api/src/outbox/index.ts` | Export ReconciliationService, ReconciliationError |
| `packages/integration-store/src/worker/retry.ts` | Wired into completeReceipt for RETRY_SCHEDULED |

---

## 5. Auditor Blocker Fix Notes

### Blockers Fixed (2026-09-15)

**BLOCKER 1 — Harness `outbox.test.mjs` PG init failure**
- **Root cause:** `setupDatabase()` used `new EmbeddedPostgres({ portableVersion, pgVersion })` without `databaseDir` (defaulted to `./data/db`) and missing `await initialise()`.
- **Fix applied:** Rewrote `setupDatabase()` following `pg-reconciler-harness.mjs` / `pg-reconcile-harness.mjs` pattern: explicit `databaseDir`, `initialise()`, `start()`, `createDatabase()`, scoped port allocation, `createPrismaClient` from `@hrp-engagement/integration-store`, qualified enum type `integration."IntentStatus"` with `SET search_path`, and cleanup via `rmSync` in `teardownDatabase()`.
- **File changed:** `apps/integration-api/tests/outbox.test.mjs`
- **Evidence:** `node --test tests/outbox.test.mjs` → **11/12 PASS** (1 pre-existing assertion bug; see below).

**BLOCKER 2 — Manifest missing 2 files**
- **Root cause:** `apps/integration-api/src/outbox/ac3-handler.ts` and `apps/integration-api/tests/pg-reconcile-harness.mjs` were not listed in manifest.
- **Fix applied:** Added SHA-256 of both files to `handoff-core-1.8.manifest.txt`. Manifest now has 30 entries.
- **Files added to manifest:**
  - `apps/integration-api/src/outbox/ac3-handler.ts` — AC3 HTTP handler (imported by `server.ts:74`)
  - `apps/integration-api/tests/pg-reconcile-harness.mjs` — PG harness for AC4 tests
- **Evidence:** `30/30 SHA-256 verified, 0 duplicates, 0 missing`

### UNRESOLVED → FIXED — Test Assertion Bug (outbox.test.mjs:430)

**Test:** `outbox: concurrent dispatchers for same intent → only one acquires lease (no duplicate delivery)`
**File:** `apps/integration-api/tests/outbox.test.mjs:430`
**Previous error:** `AssertionError: Only one dispatcher should acquire the lease — 2 !== 1`

**Root cause (test logic, not production):**
- The test originally created 3 `DispatchIntent` rows with different `intentId` values (all `PENDING`) and ran 2 concurrent dispatchers.
- Each dispatcher calls `claimNextIntent()` → `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1`.
- With 3 distinct rows, both dispatchers lock different rows → both succeed → `successCount = 2`.
- The assertion `successCount === 1` only holds when there is **1 intent** — which is the actual AC3 invariant for "no duplicate delivery".

**Fix applied (test-only, no production changes):**
1. Renamed test from `concurrent intents for same target` to `concurrent dispatchers for same intent` to reflect correct semantics.
2. Setup reduced to **1 PENDING intent** (was 3).
3. Added assertion proving no duplicate processing: `attempts === 1` and `status === 'DELIVERED'` after race.

**Constraint compliance:**
- ✅ Assertion unchanged in intent — still demands exactly 1 successful claim.
- ✅ No skip / cancellation / test logic weakening — test now genuinely proves the invariant.
- ✅ No changes to `dispatcher.ts`, `lease.ts`, or any production source.
- ✅ No new serialize-by-target rule added.

**Final evidence:**
```
$ node --test tests/outbox.test.mjs
ℹ tests 12
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 42662.805
```

**Test list (all 12 ✔):**
- ✔ outbox: delivery report SENT → ACK_RECEIVED
- ✔ outbox: delivery report DELIVERED → DELIVERED
- ✔ outbox: delivery report FAILED → FAILED with reason
- ✔ outbox: delivery report UNKNOWN → FAILED (NOT success)
- ✔ outbox: delivery report validation rejects missing reason for FAILED state
- ✔ outbox: delivery report validation rejects reason for SENT state
- ✔ outbox: delivery receipt accepted → ACK_RECEIVED
- ✔ outbox: receipt for non-existent intent → NOT_FOUND
- ✔ outbox: intent processed by dispatcher → DELIVERED status
- ✔ outbox: concurrent dispatchers for same intent → only one acquires lease (no duplicate delivery)
- ✔ outbox: no pending intents → null result
- ✔ outbox: invalid state transition → rejected

**PG cleanup verified:** 0 leftover `.tmp_pgdata_outbox_*` dirs after run; process exit code 0.

---

## 6. Limitations

1. **In-memory reconciler scheduler**: `ReconciliationScheduler` uses `setInterval` — no real cron/queue. Production needs external scheduler.
2. **Mock DNC guard**: `MockDncGuard` always returns NOT_FOUND. Real DNC check requires HRP suppression service.
3. **In-memory outbox**: `OutboxDispatcher` polls from DB — no message queue. Production may need broker.
4. **No real provider calls**: Mock provider simulation only. Production needs Zalo OA/Chatwoot adapters.
5. **Embedded PostgreSQL for tests**: Tests use `embedded-postgres` portable binary. CI needs binary download/caching.
6. **No actual HRP core writes**: Reconciliation/scheduler only touches `integration` schema. Production needs HRP core for some recovery actions.
7. **No cross-org isolation in mock**: DNC guard mock doesn't verify organization. Production must enforce org scope.

---

## 6. Boundaries

- Frozen contracts (packages/contracts) — NOT modified
- CORE/1.3 Integration Store — extended (new migrations + new functions)
- CORE/1.4 lease/retry/clock — used as-is, wired end-to-end
- No CORE/1.9 or beyond
- No HRP/provider/model thật
- No production DB / Docker / deploy
- No commit/push
- Working tree preserved
