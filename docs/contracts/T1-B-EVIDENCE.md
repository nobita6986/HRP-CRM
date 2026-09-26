# T1-B Correction Evidence — B.02-LOCAL-E2E

**Branch**: `codex/v79b-b02-local-e2e-r1`  
**Worktree**: `D:\CodeApp\Hrp-Crm-v79b-b02-e2e-r1`  
**HEAD**: `9c6bd4763c733a289893db6319792ea42e3ac172`  
**Node**: v24.19.0 | npm 11.17.0 | Windows 10.0.26200

---

## Corrections Applied

| ID | Summary |
|----|---------|
| C-B02-1 | `PG_HARNESS_SUFFIX` is now required (fails loud if missing); unique per run via env var |
| C-B02-2 | Teardown: `await receiver.server.close()` + `await mockGateway.close()` as Promises; harness.stop() is sole Prisma disconnect owner; double-disconnect removed |
| C-B02-3 | E2E-5 and E2E-8 now go through real receiver; HTTP 202 asserted before worker/DB checks; seedReceiptAndIntent() helper removed from end-to-end cases |
| C-B02-4 | Terminal 503 after full retry budget throws with `code=WEBHOOK_TERMINAL_5XX`; log is redacted (no body, no secret, no signature) |
| C-B02-5 | Isolation enforced; C-B02-5 gate triggered (see §Terminal-503 gate) |
| C-B02-6 | Evidence: this document |

---

## Scenario × Receiver Matrix

| Scenario | Goes through real receiver? | HTTP 202 asserted? | Classification |
|---------|---------------------------|-------------------|---------------|
| E2E-1 | Yes | Yes (both webhooks) | END_TO_END |
| E2E-2 | Yes | Yes (both webhooks) | END_TO_END |
| E2E-3 | Yes | Yes | END_TO_END |
| E2E-4 | Yes | Yes | END_TO_END |
| E2E-5 | Yes (was direct seed, now fixed) | Yes | END_TO_END |
| E2E-6 | Yes | Yes (first webhook 202, second 409) | END_TO_END |
| E2E-7 | Yes | Yes | END_TO_END |
| E2E-8 | Yes (was direct seed, now fixed) | Yes (all three webhooks) | END_TO_END |

---

## Teardown Verification

Evidence: `database system was shut down at 2026-09-25 22:31:17 +07` (PG log, after harness.stop()).

No leftover listener on harness port after test exit (netstat check confirmed 0 port hits).

No double-$disconnect: `after()` no longer calls `receiver.prisma.$disconnect()`; harness.stop() owns it.

---

## Smoke Run Result (single isolated run, unique suffix per run)

**Command**: `node --test tests/b02-local-e2e.test.mjs`  
**Suffix**: `b02_smoke_20260925223113_859316`  
**Port**: 56270  
**Data dir**: `.tmp_pgdata_worker_b02_smoke_20260925223113_859316`

```
tests 8 | pass 6 | fail 2 | cancelled 0 | skipped 0
```

| Scenario | Result | Notes |
|---------|--------|-------|
| E2E-1 | PASS | 1 receipt + 1 intent, 202×2 |
| E2E-2 | PASS | 2 receipts + 2 intents, 202×2 |
| E2E-3 | PASS | SKIP NON_AUTHORITATIVE_PRIVATE_NOTE |
| E2E-4 | PASS | SKIP NON_AUTHORITATIVE_ECHO |
| E2E-5 | FAIL | `webhook terminal 503 after 12 attempts (eventId=evt-b02e2e-echo-002)` |
| E2E-6 | PASS | 202+409 idempotency_conflict |
| E2E-7 | PASS | idempotent retry |
| E2E-8 | FAIL | `webhook terminal 503 after 12 attempts (eventId=evt-b02e2e-canon-002)` |

**Exit code**: 1 (correct — process exit matches test outcome)

---

## Terminal-503 Gate (C-B02-5)

### Trigger condition
E2E-5 and E2E-8 (now routed through real receiver) hit **terminal `503 store_unavailable`** after exhausting the 12-attempt retry budget in `sendWebhook()`. The race is between the receiver's durable-commit path (Prisma + PG18 `RETURNING` after `ON CONFLICT DO NOTHING`) and concurrent first-write transactions.

### Evidence from smoke run
```
SENDWEBHOOK_5XX { eventId: 'evt-b02e2e-echo-002', attempts: 12, status: 503 }
Error: webhook terminal 503 after 12 attempts (eventId=evt-b02e2e-echo-002)
  code: 'WEBHOOK_TERMINAL_5XX'
```

### Root cause (hypothesis, not confirmed — production receiver not modified)
Prisma + PG18 `ON CONFLICT DO NOTHING ... RETURNING` can return `[]` when Transaction A inserts a row and Transaction B runs the same upsert concurrently before Transaction A's commit is visible to Transaction B's snapshot. The receiver interprets `[]` as "record not found after ON CONFLICT" and may throw `store_unavailable` instead of proceeding.

### Classification
**Production receiver concurrency race** — not introduced by T1-B corrections. Same 503 pattern was observed in prior T0 review of the original (unmodified) B.02 suite on this branch (terminal 245091, 245092, 245099). Prior runs used direct DB seed for E2E-5/E2E-8 which masked this race from the test.

### Actions taken per C-B02-5
1. Harness isolation and teardown corrections (C-B02-1, C-B02-2) applied first. ✓
2. E2E-5 and E2E-8 routed through real receiver (C-B02-3). ✓
3. Terminal 503 throws so test correctly FAILS (C-B02-4). ✓
4. Narrow reproducer created at `apps/integration-worker/tests/repro/receiver-503-race.test.mjs`. Race is non-deterministic in isolation but confirmed in B.02 suite context.
5. **Production receiver source NOT modified** — this batch does not fix the race in production code.

### Next step
T0 to assess the race: determine if a production fix is warranted (isolation of Prisma transaction, retry-within-tx, or sequence lock). Until then, B.02-LOCAL-E2E is NOT READY_FOR_T0_REVIEW.

---

## Changed Files (vs HEAD 9c6bd47)

| File | Change |
|------|--------|
| `apps/integration-worker/tests/b02-local-e2e.test.mjs` | UTF-16→UTF-8; sendWebhook() 503→throw; after() teardown fix; seedReceiptAndIntent() removed; E2E-5/E2E-8 through real receiver |
| `apps/integration-worker/tests/pg-worker-harness.mjs` | PG_HARNESS_SUFFIX required (no fallback) |
| `apps/integration-worker/tests/repro/receiver-503-race.test.mjs` | NEW — narrow reproducer for terminal 503 race |
| `scripts/run-b02-isolated.mjs` | NEW — 3 sequential isolated runs with unique suffix, teardown audit |
| `.gitattributes` | NEW — `*.mjs text working-tree-encoding=UTF-8` |

### Final SHA
`b09cf9a31fa604afb6e79f02bf62ae1fb78355f3` (branch `codex/v79b-b02-local-e2e-r1`, pushed fast-forward)
