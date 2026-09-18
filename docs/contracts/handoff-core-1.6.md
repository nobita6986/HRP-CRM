# CORE/1.6 — Intake Orchestration and Checkpoints

**Status:** Auditor findings B1–B4 FIXED (2026-09-15); awaiting Auditor recheck.
Verdict: `CHANGES_REQUIRED` (Owner confirmed 2026-09-15).
**Contracts Pin:** 0.0.8-g0.8-fixes (unchanged — no contract changes)
**Gate 0:** FREEZE (CORE/1.1, 1.3, 1.4, 1.5 = Auditor PASS)
**Date:** 2026-09-14
**Scope:** Backlog §Task 1.6 — Intake Orchestration with durable checkpoints, confirmation binding, partial-failure resume, DNC decoupling

---

## 1. Phases

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Design: orchestrator architecture (preview/run/resume), step state machine, checkpoint schema, confirmation binding semantics | DONE |
| Phase 2 | Implement `IntakeOrchestrator` + 5-step state machine (CONFIRM_VALIDATE → IDENTITY → PROFILE → CASE → AVAILABILITY) | DONE |
| Phase 3 | Add `IntakeCheckpoint` PG table + `IntakeCheckpointState` enum + repository (`createIntakeCheckpoint`, `findIntakeCheckpoint`, `updateIntakeCheckpoint`) | DONE |
| Phase 4 | Canonical draft digest (`digest.ts`) — SHA-256 hex of order-stable JSON for confirmation binding | DONE |
| Phase 5 | Confirmation binding (`isConfirmationValid`) — server-side validation, stale confirmation → DUPLICATE_KEY | DONE |
| Phase 6 | Resume / partial-failure handling — skip applied steps, retry only failed step + remaining, preserve per-step idempotency keys | DONE |
| Phase 7 | DNC decoupling (`dnc-handler.ts`) — standalone handler, no intake checkpoint, no HRP review dependency | DONE |
| Phase 8 | Unit tests (`orchestrator.test.mjs`) — 33/33 covering AC1–AC9, digest, idempotency, partial failure, confirmation binding, DNC | DONE |
| Phase 9 | PG-E2E tests (`orchestrator.pg-e2e.test.mjs`) — 6/6 covering RUNNING/COMPLETED/REVIEW_PENDING/PARTIAL persistence, stale confirmation, partial-fail resume, idempotency, DNC | DONE |
| Phase 10 | Build + typecheck + full regression | DONE |
| Phase 11 | Snapshot/manifest + handoff | DONE |

---

## 2. AC Coverage

### AC1: Preview chỉ đọc, KHÔNG gọi mutation

**Implementation:**
- `IntakeOrchestrator.preview()` uses `IdentityPreviewCaller.resolveIdentityCandidates()` — read-only resolver port.
- No `createOrMatchLaborProfile`, no `updateLaborProfile`, no `openPlacementCase`, no `updateLaborAvailability` calls in preview path.
- Returns `PreviewResult` with candidates + TTL (`previewExpiresAt = now + 5 minutes`).
- **Verification:** `orchestrator.test.mjs`:
  - `AC1: preview() KHÔNG gọi createOrMatchLaborProfile` — verifies gateway call log is empty after preview.
  - `AC1: preview trả STRONG/WEAK/PARTIAL + hasStrongMatch` — verifies candidate strength classification.
  - `AC1: preview TTL = 5 phút` — verifies `previewExpiresAt - now = 5 * 60 * 1000` ms.

### AC2: Confirmed revision → state machine với durable checkpoint

**Implementation:**
- `IntakeOrchestrator.run()` calls `createIntakeCheckpoint` (PG transaction) before any gateway call.
- State machine: `[CONFIRM_VALIDATE, IDENTITY, PROFILE, CASE, AVAILABILITY]`.
- After each step, `safeUpdateCheckpoint` persists `appliedSteps` + `stepResults` + state transition.
- Final state: `COMPLETED` (all 5 steps OK), `PARTIAL` (some steps applied, one failed), `FAILED` (first step failed), `REVIEW_PENDING` (IDENTITY = POSSIBLE or result=null), `RUNNING` (mid-flight, only seen if process crashes).
- **Verification:** `orchestrator.test.mjs` AC2 tests + `orchestrator.pg-e2e.test.mjs`:
  - `checkpoint persists RUNNING then COMPLETED in PG` — verifies state=RUNNING at create, state=COMPLETED after run, all 5 stepResults persisted in PG.
  - `run() idempotent — gọi lại cùng draftDigest không tạo checkpoint mới` — second run returns same checkpoint row.

### AC3: EXACT profile no-op, KHÔNG tính created

**Implementation:**
- IDENTITY step's `extractMatchingOutcome` returns `EXACT_MATCH_SUCCESS` → PROFILE step enters `fill-missing patch` path.
- `buildStepIdempotencyKey(intakeRevisionId, 'PROFILE')` = same key across retries.
- Mock gateway ledger caches APPLIED response by idempotencyKey → second call returns cached result.
- Profile step returns `ProfileStepResult { kind: 'NOOP', isNoOp: true, ... }` if no patch needed.
- `isNoOp: true` flag prevents `created` counting in `IntakeRunResult.actedOnAnyStep` accounting.
- **Verification:** `orchestrator.test.mjs`:
  - `AC3: EXACT profile step trả isNoOp flag`.

### AC4: POSSIBLE_MATCH dừng để review

**Implementation:**
- IDENTITY step returns `IdentityStepResult { kind: 'POSSIBLE_MATCH', gatewayResponse, reviewRef }`.
- `executeFromCheckpoint` checks `if (idResult.kind === 'POSSIBLE_MATCH') { terminalState = 'REVIEW_PENDING'; break; }`.
- PROFILE/CASE/AVAILABILITY NOT executed.
- `reviewRef` persisted in `stepResults.IDENTITY.reviewRef` for UI to retrieve review entry.
- **Verification:** `orchestrator.test.mjs` + `orchestrator.pg-e2e.test.mjs`:
  - `AC4: POSSIBLE_MATCH → REVIEW_PENDING, KHÔNG chạy PROFILE/CASE/AVAILABILITY`.
  - `AC4: POSSIBLE reviewRef được ghi vào checkpoint`.
  - PG-E2E: `POSSIBLE_MATCH scenario → REVIEW_PENDING in PG, no PROFILE/CASE/AVAILABILITY applied`.

### AC5: NEW_PROFILE scenario theo fixture policy

**Implementation:**
- IDENTITY step's `buildCreateOrMatchPayload(ctx, policy)` uses `policy: 'ALLOW_NEW'` (mock scenario policy).
- `selectIdentityScenario(outcome, policy)` routes NEW outcome to ACCEPTED/APPLIED depending on policy.
- Mock gateway returns `APPLIED` with `data.laborProfileId` for NEW outcome.
- Profile step sees `ctx.canonicalId` defined → EXACT fill-missing patch path (or skips if already complete).
- **Verification:** `orchestrator.test.mjs`:
  - `AC5: NEW_PROFILE scenario được accept (APPLIED)`.

### AC6: Profile applied + case fail → PARTIAL + idempotent resume

**Implementation:**
- CASE step throws `OrchestratorError(errorCode, message, retryable)` on `result.status === 'FAILED'`.
- `executeFromCheckpoint` catches, sets `partialFailure = { failedStep, errorCode, errorMessage, retryable }`, sets `terminalState = 'PARTIAL'`, breaks loop.
- Profile step's `appliedSteps.push('PROFILE')` already executed; DB row updated to state=PARTIAL with lastError.
- On `resumeWithPayload(req)`: `findIntakeCheckpoint` returns row with `appliedSteps = ['CONFIRM_VALIDATE', 'IDENTITY', 'PROFILE']`, `state = 'PARTIAL'`.
- `executeFromCheckpoint` builds `appliedSet = new Set(row.appliedSteps)`, skips those, retries CASE only.
- `buildStepIdempotencyKey(intakeRevisionId, 'CASE')` = SAME key as first attempt → mock gateway ledger returns cached FAILED (if not cleared) OR fresh call → if success, AVAILABILITY runs.
- Final state: `COMPLETED`.
- **Verification:** `orchestrator.test.mjs` + `orchestrator.pg-e2e.test.mjs`:
  - `AC6: CASE step fail → PARTIAL với partialFailure ghi rõ step/code/retryable`.
  - `AC6: resumeWithPayload() skip appliedSteps, chỉ chạy remaining steps` — verifies CASE called exactly 2 times (1 fail + 1 retry success), no duplicate PROFILE call.
  - `AC6: resume KHÔNG tạo duplicate profile (idempotency key preserved)`.
  - PG-E2E: `CASE step fail → PARTIAL persisted in PG; resumeWithPayload completes` — verifies PG row state transition PARTIAL → COMPLETED with CASE in appliedStepsJson.

### AC7: draftDigest/evidence/intent thay đổi → confirmation cũ invalid

**Implementation:**
- `digestCanonical(buildCanonicalDraft(draft))` computes SHA-256 hex of canonical JSON (order-stable).
- `buildCanonicalDraft(ctx)` includes `fullName, phone, citizenIdentity, intent, evidenceRefs, organizationId, intakeRevisionId`.
- Two edits change digest → `createIntakeCheckpoint` throws `DUPLICATE_KEY` (same revision, different digest).
- `isConfirmationValid(confirmation, currentContext)` validates `draftRevisionId`, `draftDigest`, `canonicalId`, `canonicalVersion` all match the saved checkpoint.
- **Server never trusts client checkbox alone** — even if `confirmed: true`, mismatch on any of 4 fields throws.
- **Verification:** `orchestrator.test.mjs`:
  - `AC7: digest khác → OrchestratorError DUPLICATE_KEY`.
  - `AC7: edit field → digest đổi → server chặn`.
  - `AC7: evidence đổi → digest đổi → confirmation cũ invalid`.

### AC8: draftRevisionId/canonicalVersion khác → confirmation invalid

**Implementation:**
- After first run with `rev-001`, checkpoint row stores `intakeRevisionId='rev-001'`, `canonicalVersion=1`.
- Second run with `confirmation.context.draftRevisionId='rev-CHANGED'`:
  - `createIntakeCheckpoint`: existing row found with same `intakeRevisionId='rev-001'` → row returned (or DUPLICATE_KEY if digest differs).
  - If digest same → row returned.
  - `executeFromCheckpoint`: `isConfirmationValid` fails because `confirmation.context.draftRevisionId='rev-CHANGED' !== row.intakeRevisionId='rev-001'`.
  - Throws `OrchestratorError(DUPLICATE_KEY, 'STALE_CONFIRMATION: ...')`.
- Same logic for `canonicalVersion` mismatch.
- **Verification:** `orchestrator.test.mjs`:
  - `AC8: draftRevisionId khác → confirmation invalid`.
  - `AC8: canonicalVersion khác → confirmation invalid (version drift)`.
  - `AC8: confirmed:true không đủ — cần digest binding`.

### AC9: DNC action tách khỏi full intake

**Implementation:**
- `dnc-handler.ts` provides `executeDncAction(input, gatewayCall)` — standalone function.
- Calls `commitSuppression` gateway method directly; no `createIntakeCheckpoint`, no HRP review token, no CCCD requirement.
- `buildCommitSuppressionPayload` includes `target`, `reason`, `note` only — KHÔNG bao gồm CCCD/PII.
- `DncActionInput` does not require `intakeRevisionId`, `draftDigest`, or `confirmation`.
- **Verification:** `orchestrator.test.mjs` + `orchestrator.pg-e2e.test.mjs`:
  - `AC9: DNC hoạt động khi intake chưa đủ` — calls executeDncAction without draft context.
  - `AC9: DNC payload không chứa CCCD` — verifies payload keys.
  - `AC9: DNC + intake chạy song song (independent path)`.
  - PG-E2E: `DNC handler chạy độc lập, không cần intake context` — verifies no checkpoint row created with 'dnc' revision.

---

## 3. Files Changed / Created

### packages/integration-store/
- `prisma/schema.prisma` — added `IntakeCheckpointState` enum + `IntakeCheckpoint` model
- `prisma/migrations/0003_intake_checkpoint/migration.sql` — CREATE TYPE + CREATE TABLE + 3 indexes
- `prisma/migrations/0003_intake_checkpoint/rollback.sql` — DROP TABLE + DROP TYPE
- `src/repos/intake-checkpoint.ts` — **NEW** — `createIntakeCheckpoint`, `findIntakeCheckpoint`, `updateIntakeCheckpoint`, `IntakeCheckpointStateWire`
- `src/index.ts` — re-export intake-checkpoint repo

### apps/integration-api/
- `src/orchestrator/digest.ts` — **NEW** — `digestCanonical`, `buildCanonicalDraft` (order-stable SHA-256)
- `src/orchestrator/steps.ts` — **NEW** — `STEP_ORDER`, step context types, `buildStepIdempotencyKey`, `extractMatchingOutcome`, `selectIdentityScenario`
- `src/orchestrator/intake-orchestrator.ts` — **NEW** — `IntakeOrchestrator` class (`preview`, `run`, `resume`, `resumeWithPayload`), `OrchestratorError`
- `src/orchestrator/dnc-handler.ts` — **NEW** — `executeDncAction`, `buildCommitSuppressionPayload`, `isDncActionCallable`
- `src/orchestrator/index.ts` — **NEW** — public surface

### apps/integration-api/tests/
- `tests/orchestrator.test.mjs` — **NEW** — 33 unit tests with in-memory mocks
- `tests/orchestrator.pg-e2e.test.mjs` — **NEW** — 6 PG-E2E tests with embedded PostgreSQL
- `tests/pg-orchestrator-harness.mjs` — **NEW** — embedded PG harness with UTF-8 client encoding
- `tests/pg-receiver-harness.mjs` — added `0003_intake_checkpoint/migration.sql` + UTF-8 client encoding
- `tests/pg-worker-harness.mjs` (apps/integration-worker/) — added `0003_intake_checkpoint/migration.sql` + UTF-8 client encoding
- `tests/integration/pg-test-harness.mjs` (packages/integration-store/) — added `0003_intake_checkpoint/migration.sql` + UTF-8 client encoding

---

## 4. Test Evidence

### Unit tests (`apps/integration-api/tests/orchestrator.test.mjs`)
- **33/33 PASS**
- Coverage:
  - AC1 (preview): 3 tests
  - AC2 (run + checkpoint state machine): 4 tests
  - AC3 (EXACT no-op): 1 test
  - AC4 (POSSIBLE review): 2 tests
  - AC5 (NEW profile): 1 test
  - AC6 (partial failure + resume): 3 tests
  - AC7 (digest invalidation): 3 tests
  - AC8 (revision/version binding): 3 tests
  - AC9 (DNC decoupled): 3 tests
  - Digest utilities: 3 tests
  - Step utilities: 2 tests
  - Retry / idempotency: 2 tests
  - Error taxonomy: 2 tests
  - Checkpoint durability: 1 test

### PG-E2E tests (`apps/integration-api/tests/orchestrator.pg-e2e.test.mjs`)
- **6/6 PASS** (in clean environment; 11.9s duration)
- Embedded PostgreSQL 17.6 + real Prisma client + mock HTTP gateway.
- Coverage:
  - `checkpoint persists RUNNING then COMPLETED in PG` — verifies row state, draftDigest (SHA-256 hex 64 chars), appliedStepsJson, stepResultsJson, canonicalId/canonicalVersion persisted.
  - `POSSIBLE_MATCH scenario → REVIEW_PENDING in PG` — verifies only IDENTITY applied, reviewRef in stepResults.
  - `stale confirmation (different draftRevisionId) → DUPLICATE_KEY` — verifies confirmation rejection against saved context.
  - `CASE step fail → PARTIAL persisted in PG; resumeWithPayload completes` — verifies PARTIAL state + retry behavior + state transition to COMPLETED in PG.
  - `idempotency: same draftDigest retry → không tạo row mới` — verifies `prisma.intakeCheckpoint.count` unchanged.
  - `DNC handler chạy độc lập, không cần intake context` — verifies no intake checkpoint row created.

### Full regression (other suites unaffected)
- `packages/contracts`: **398/398 PASS** (no contract changes in CORE/1.6)
- `packages/config`: tests OK
- `packages/integration-store`: **10/10 unit + 24/24 integration = 34/34 PASS**
- `apps/integration-api`: **143/143 PASS** (35 orchestrator unit + 6 PG-E2E + 102 cũ).
- `apps/integration-worker`: **56/56 PASS** (no changes in worker for CORE/1.6)
- `apps/context-panel`: tests OK

---

## 5. Build Evidence

```bash
packages/contracts           typecheck OK, tests 398/398
packages/config             typecheck OK, tests OK
packages/integration-store  typecheck OK, tests 10/10 unit + 24/24 integration
apps/integration-api         typecheck OK, build OK, tests 141/141
  - orchestrator.test.mjs       33/33 (in-memory mocks)
  - orchestrator.pg-e2e.test.mjs 6/6 (embedded PostgreSQL)
  - existing tests              102/102 (preserved)
apps/integration-worker      typecheck OK, build OK, tests 56/56 (no changes)
apps/context-panel          typecheck OK, build OK, tests 11/11 (no changes)
```

---

## 6. Architecture Decisions

### Decision 1: Confirmation binding → DUPLICATE_KEY (not VALIDATION_ERROR)

When client sends a confirmation whose `context.{draftRevisionId, draftDigest, canonicalId, canonicalVersion}` does not match the saved checkpoint, the orchestrator throws `OrchestratorError(DUPLICATE_KEY, 'STALE_CONFIRMATION: ...')`. Rationale: this is exactly the case where the client's claim is invalidated by an intervening edit. `VALIDATION_ERROR` would imply "you sent garbage"; `DUPLICATE_KEY` implies "your earlier claim is no longer valid — re-review the draft and submit a fresh confirmation". Owner said: *"đổi field/evidence/intent/target làm confirmation cũ mất hiệu lực"* — old confirmation loses validity. `DUPLICATE_KEY` matches this semantic; UI can branch on it to trigger re-review workflow.

### Decision 2: `confirmed: true` is necessary but not sufficient

The orchestrator's `isConfirmationValid` checks 4 fields against the saved checkpoint context. Client sending `confirmed: true` alone is meaningless; only when all 4 fields bind correctly does the orchestrator proceed. Tests `AC8: confirmed:true không đủ` verify this.

### Decision 3: Step idempotency keys derived from `(intakeRevisionId, stepName)` — NOT including attempt number

`buildStepIdempotencyKey(intakeRevisionId, step)` = `${intakeRevisionId}:${step}`. Same key across retries → mock gateway ledger (and production gateway) returns cached response. This means:
- Profile step with same input → cached APPLIED → no double-write.
- CASE step retry after PARTIAL → same key as first attempt. If gateway is idempotent (real gateway should be), the second attempt returns the same APPLIED. If mock returns different responses (test fixture), the test uses a counter to simulate "first call fail, second call success".

### Decision 4: DNC handler is fully independent

`executeDncAction(input, gatewayCall)` does NOT touch `intakeCheckpoint` table. It directly invokes `commitSuppression` gateway method. No HRP review token, no CCCD, no confirmation binding. Owner spec: *"DNC action tách khỏi full intake, không chờ CCCD hoặc HRP-review hồ sơ"*.

### Decision 5: PG migration 0003 uses `IntakeCheckpointState` enum, not VARCHAR

Prisma generates `state` column as enum type (`integration."IntakeCheckpointState"`). Migration uses `DO $$ ... CREATE TYPE` to make it idempotent (does not fail if already applied). Application-side repo uses `IntakeCheckpointStateWire` string union to avoid circular type dep on Prisma's generated enum.

### Decision 6: Orchestrator translation layer maps store errors → OrchestratorError

`translateStoreError(err, op)` converts raw `StoreError` objects (e.g., `DUPLICATE_KEY`, `VALIDATION_ERROR`) to `OrchestratorError` with consistent code/message. Caller never sees raw store errors. This is necessary because store uses plain object errors (no `Error` instance) for serialization safety.

---

## 7. Limitations

1. **PG harness Windows shmem constraint** (inherited from CORE/1.5). Embedded PG harness can leave orphan `postgres.exe` + `.tmp_pgdata_*` dirs on Windows if previous test run was killed mid-cleanup. Workaround documented in CORE/1.5 handoff §7.1; T1 had to cleanup orphan processes once during CORE/1.6 development. Owner may need to re-grant cleanup permission if re-run fails.

2. **No real durable worker integration**. CORE/1.6 orchestrator is synchronous — `run()` executes all 5 steps in-process. Production integration with CORE/1.4 durable worker (which already supports lease acquire → process → release) requires wiring `run()` as a task handler in `durable-worker.ts`. Deferred to CORE/1.7+.

3. **No real confirmation token signing**. `StaffReviewConfirmation.confirmed: true` is a boolean field; not signed or signed-against-hrp-key. Production needs HMAC/RSA signature on confirmation payload to prevent client forgery. Deferred to CORE/1.7 review service.

4. **Mock gateway ledger is in-memory**. Production gateway must persist idempotency-key → response mapping across restarts. CORE/1.6 mock uses `Map`; real gateway contract (`HrpGatewayMethod`) requires persistence — not implemented here.

5. **No HRP review workflow pre/post-apply**. CORE/1.6 confirmation binding validates that the client's confirmation matches the saved context, but does NOT validate that HRP itself reviewed the draft. Owner said: *"Không tự chốt HRP review pre/post-apply"*. CORE/1.7 review service will own this.

6. **No canonical target schema versioning for `canonicalId` + `canonicalVersion`**. The orchestrator passes `ctx.canonicalId` to `openPlacementCase` payload but doesn't check that the labor profile version matches what the IDENTITY step used. Race condition: between IDENTITY and CASE, profile could be updated by HRP. CORE/1.7+ will use `expectedVersion` checks via `updateLaborProfile`.

7. **No client domain support**. Paths in client domain (e.g., creating ClientContact) return UNAVAILABLE — not implemented in CORE/1.6. Owner said: *"Client domain, transitions hoặc managed modes. Paths chưa có contract giữ UNAVAILABLE"*.

8. **Mock scenario policy is hardcoded to ALLOW_NEW**. Real policy decision comes from caller (UI) — `preview` may suggest MATCH_ONLY, but caller chooses at submit time. CORE/1.6 only implements ALLOW_NEW path; MATCH_ONLY and REVIEW_REQUIRED scenarios are placeholders for CORE/1.7 review workflow.

---

## 8. Out-of-Scope (CORE/1.7+)

- HRP review workflow (pre-apply + post-apply review with reviewer signing)
- Client domain paths (ClientContact create/update, transitions, managed modes)
- Cross-tenant isolation hardening for intake orchestrator
- Outbox dispatch to provider API for placement case lifecycle events
- Real confirmation token signing (HMAC/RSA)
- Review service / UI (CORE/1.7 backlog §Task 1.7)
- Docker / VPS / deploy (CORE/1.7+)
- Real HRP / provider / model integration (CORE/1.7+)

---

## 9. Auditor Checklist (CORE/1.6)

Required audit areas:
- [ ] Preview path does NOT call any gateway mutation method
- [ ] Run path creates checkpoint (RUNNING) before any gateway call
- [ ] Resume path skips appliedSteps and only retries failed step + remaining
- [ ] EXACT profile no-op is correctly detected and `isNoOp: true` propagated
- [ ] POSSIBLE_MATCH stops orchestrator at IDENTITY, persists reviewRef, does NOT run PROFILE/CASE/AVAILABILITY
- [ ] NEW_PROFILE scenario uses ALLOW_NEW policy by default (mock), no NEW for MATCH_ONLY policy
- [ ] CASE step failure → PARTIAL state with `partialFailure.{failedStep, errorCode, retryable}` populated
- [ ] resumeWithPayload skip IDENTITY/PROFILE/CASE in appliedSet; CASE retry succeeds → state COMPLETED
- [ ] `createOrMatchLaborProfile` called exactly once across run+resume (idempotency key preserved)
- [ ] Stale `draftRevisionId` in confirmation context → DUPLICATE_KEY (not VALIDATION_ERROR)
- [ ] Stale `canonicalVersion` (version drift) → DUPLICATE_KEY
- [ ] `confirmed: true` alone is rejected when other 3 fields don't bind
- [ ] DNC handler does NOT touch intake checkpoint table
- [ ] DNC payload does NOT contain CCCD or other intake-only fields
- [ ] PG migration 0003 creates `IntakeCheckpointState` enum + `IntakeCheckpoint` table + 3 indexes
- [ ] `digestCanonical` is order-stable (different key order → same digest)
- [ ] Mock-only claim: no real HRP call, no production DB, no deploy

---

## 10. Commands & Results (executed)

```bash
# Integration-store
cd packages/integration-store && npx prisma generate  # OK
cd packages/integration-store && npm run build        # OK
cd packages/integration-store && npm run test:unit    # 10/10 PASS
cd packages/integration-store && npm run test:integration  # 24/24 PASS

# API
cd apps/integration-api && npm run build  # OK
cd apps/integration-api && node --test tests/orchestrator.test.mjs  # 33/33 PASS
cd apps/integration-api && node --test tests/orchestrator.pg-e2e.test.mjs  # 6/6 PASS
cd apps/integration-api && npm test  # 141/141 PASS

# Worker (no changes)
cd apps/integration-worker && npm test  # 56/56 PASS

# Contracts (no changes)
cd packages/contracts && npm test  # 398/398 PASS
```

---

## 11. CORE/1.1 → CORE/1.6 Status Chain

| Track | Status | Note |
|-------|--------|------|
| CORE/1.0 | Auditor PASS | |
| CORE/1.1 | Auditor PASS, B1 CLOSED | |
| CORE/1.2 | Auditor PASS, rev 2 | mock guard closed |
| CORE/1.3 | Auditor PASS | |
| CORE/1.4 | Auditor PASS | |
| CORE/1.5 | Auditor PASS | DEFECT-1 + DEFECT-2 fixed + 566/566 re-run clean |
| **CORE/1.6** | **Auditor CHANGES_REQUIRED; B1–B4 FIXED — awaiting recheck** | Intake orchestrator + PG-E2E |

---

## 12. Handoff

This document is for **independent Auditor review** of CORE/1.6.

T1 does NOT claim PASS. T1 submits implementation + evidence + AC coverage + commands + results.
Owner / Owner-side Auditor (independent) decides PASS/CHANGES_REQUIRED.

After Auditor verdict:
- PASS → mark CORE/1.6 done, await CORE/1.7 brief (review service / UI).
- CHANGES_REQUIRED → fix per Auditor notes; do NOT proceed to CORE/1.7.

T1 is forbidden from self-closing audit (per Tier1 mandate).

T1 stops here. CORE/1.7 (review service / UI) requires fresh Owner brief.

---

## 13. Auditor findings — B1–B4 FIXED (2026-09-15)

Owner chuyển blocking findings; T1 đã xử lý trong phạm vi. Verdict vẫn `CHANGES_REQUIRED` đến khi Auditor recheck.

| Finding | Status | File | Evidence |
|---------|--------|------|----------|
| B1: Server-computed draft digest | **FIXED** | `src/orchestrator/digest.ts`, `src/orchestrator/intake-orchestrator.ts` | 35/35 unit + 6/6 PG-E2E PASS |
| B2: Canonical target/version persistence | **FIXED** | `src/orchestrator/intake-orchestrator.ts` | Tests B2 cover NEW/EXACT/version progression/resume |
| B3: Error taxonomy | **FIXED** | `src/orchestrator/intake-orchestrator.ts` | ErrorCodeSchema validation; tests assert qua `safeParse` |
| B4: DNC source/actor | **FIXED** | `src/orchestrator/dnc-handler.ts` | +1 B4 test (missing actor → ZodError) |
| N1: Rollback safety | **DONE** (doc-only) | `decision-register.md` | Operational guidance; không sửa code |

**Full regression**: 631/631 PASS (+2 tests vs 629 pre-fix).

---

## 14. B4 recheck — FIXED (2026-09-15)

Auditor yêu cầu sửa B4 độc lập:
- `buildCommitSuppressionPayload` trả `context: contextRef`, KHÔNG thêm actor vào `IntakeContextRef` strict.
- Giữ actor validation; actor truyền ở request envelope / gateway call context đúng contracts.
- Không sửa contracts freeze hoặc nới strict validation.

### Root cause (lần fix đầu)
Lần fix đầu gộp `actor` vào `context: { ...contextRef, actor }` → khi payload được parse
qua `CommitSuppressionInputSchema` (context: `IntakeContextRefSchema.strict()`),
field `actor` không thuộc IntakeContextRefSchema → reject. Đồng thời `actor` không nằm
ở envelope/gateway call context (đúng contracts) → mất audit actor.

### Fix (recheck)
- `buildCommitSuppressionPayload` chỉ trả `context: contextRef` (đúng strict shape).
  Không trộn actor.
- Export `assertCommitSuppressionPayloadValid(input)` — validate payload qua
  `CommitSuppressionInputSchema` (evidence #1).
- `executeDncAction`:
  - Validate actor qua `ActorSchema.parse(input.actor)` ngay đầu hàm (evidence #3).
  - Validate payload qua `CommitSuppressionInputSchema.parse(payload)` (fail-closed).
  - Truyền `actor` xuống `GatewayCaller` qua field `actor` mới (envelope level).
- `GatewayCaller` type extended với `actor?: unknown` (optional, backward-compatible).
  Runtime HRP gate vẫn authorize.
- `buildGatewayCaller` test helper truyền `args.actor ?? defaultServiceActor`.

### Evidence (Auditor yêu cầu)

| # | Yêu cầu | Test | Kết quả |
|---|---------|------|---------|
| 1 | Payload do builder tạo parse PASS qua `CommitSuppressionInputSchema` | `B4-Evidence #1: buildCommitSuppressionPayload parse PASS qua CommitSuppressionInputSchema (contract freeze)` | PASS |
| 1b | `externalAccountId` parse được; DNC không cần CCCD/full intake | `B4-Evidence #1b: externalAccountId parse được; DNC không cần CCCD/full intake` | PASS |
| 2 | Gateway spy xác nhận actor ở envelope, KHÔNG trong `payload.context` | `B4-Evidence #2: actor truyền ở envelope, KHÔNG nằm trong payload.context` | PASS |
| 3a | Missing actor → ZodError trước gateway call | `B4-Evidence #3a: missing actor → ZodError trước gateway call` | PASS |
| 3b | Malformed actor → ZodError trước gateway call | `B4-Evidence #3b: malformed actor → ZodError trước gateway call` | PASS |
| 4 | DNC + actor + externalAccountId + reason chạy độc lập | `B4-Evidence #4: DNC không cần CCCD/full intake; actor + externalAccountId đủ` | PASS |
| 5 | Shape cũ `context.actor` bị reject qua `CommitSuppressionInputSchema` | `B4-Evidence #5: payload với context.actor (shape cũ) bị CommitSuppressionInputSchema reject` | PASS |

### Files changed (B4 recheck)
- `apps/integration-api/src/orchestrator/dnc-handler.ts` — payload.context = contextRef (strict), actor ở gateway call context.
- `apps/integration-api/src/orchestrator/steps.ts` — `GatewayCaller` extended với `actor?: unknown`.
- `apps/integration-api/src/orchestrator/index.ts` — export `assertCommitSuppressionPayloadValid`.
- `apps/integration-api/tests/orchestrator.test.mjs` — +7 evidence tests + sửa `buildGatewayCaller` + sửa DO_NOT_CONTACT → CANDIDATE_REQUEST (canonical).
- `apps/integration-api/tests/orchestrator.pg-e2e.test.mjs` — sửa `buildGatewayCaller` pass actor + sửa DNC test dùng canonical fields.

### Test delta
- `apps/integration-api/tests/orchestrator.test.mjs`: 35 → 42 (+7 evidence).
- `apps/integration-api/tests/orchestrator.pg-e2e.test.mjs`: 6/6 PASS (DNC test cập nhật payload).
- `apps/integration-api`: 141 → 150/150 PASS (was 141+33 orchestrator unit → 42 orchestrator unit; PG-E2E 6/6).
- **Full regression**: 150 (api) + 56 (worker) + 398 (contracts) + 16 (config) + 10 (store) + 11 (context-panel) = **641/641 PASS**.

### Boundaries respected
- Không sửa contracts freeze (CommitSuppressionInputSchema, IntakeContextRefSchema, ActorSchema, IntegrationCommandSourceSchema giữ nguyên).
- Không nới strict validation (vẫn `.strict()`).
- Không thêm field ngoài DTO vào payload context.
- N1 (rollback safety) giữ nguyên — doc-only, chỉ áp dụng test DB.
- B1–B3 không bị mở lại; delta không động đến `intake-orchestrator.ts` (chỉ đụng `dnc-handler.ts`, `steps.ts` (GatewayCaller extend), tests).

### Verdict
- **B4 recheck**: **FIXED** with evidence above.
- **CORE/1.6 overall**: vẫn `CHANGES_REQUIRED` đến khi Auditor recheck toàn bộ (B1–B4 + N1).
- Chờ Owner / Auditor recheck verdict. T1 dừng, không CORE/1.7, không Docker/deploy/provider thật.
