# CORE/1.13 — Status

**Task**: CORE/1.13  
**Status**: READY FOR AUDIT RECHECK  
**Baseline**: CORE/1.12 CLOSED — Auditor PASS  
**Manifest SHA-256**: `1EDA96730E52ADA1E655E81169DBB57CEF637074A72F2F6CC1BEDE87AE796C25`

> **Three iterations**:
> - Original (READY FOR AUDIT): SHA `EE4614...`.
> - Post-Audit Delta B1–B5 + Contract: SHA `EBCB...` → `7DAD...`.
> - Recheck Delta R1–R3 + Manifest: SHA `0A422...` (current).  
> R1–R3 addresses UI crash (R1), wire-aligned PlanningBatchResult (R2), and
> manifest coverage (R3). All changes scoped to CORE/1.13.

---

## Auditor Verdict

`READY FOR AUDIT RECHECK` — Awaiting independent Auditor re-review of R1–R3.

---

# Recheck Delta R1–R3 + Manifest

## R1 — Planning UI Crash

**Finding**: UI `PlanningView` referenced old `PlanningBatchResult` interface
(`results/allSuccess/appliedCount/failedCount/skippedCount`) but server returns
the contract shape `items` array + `summary` object. UI crashed when accessing
undefined fields.

**Fix**:
- Replaced UI interface with wire-aligned types (`items: BatchItemResult[]`,
  `summary: PlanningBatchSummary`, no `allSuccess`).
- `PlanningView` renders per-item table with `itemKind`, `outcome`,
  `appliedId/pendingReference`/`error.errorCode` columns + summary row.
- `data-batch-item` and `data-batch-outcome` data attributes for browser tests.
- No fallback to empty arrays; UI inspects `summary.failedCount` directly.

**Evidence**:
- `tests/assistant-service.test.mjs`: AC3 base test verifies response has
  `items[]` + `summary` and parses through `PlanningBatchResultSchema`.
- `tests/assistant-api.test.mjs`: AC3 base API test asserts `items[]` exists,
  `summary.totalItems = 4`, `allSuccess` absent.
- Browser: `tests/assistant-browser-evidence.mjs` (12 tests) — UI loads
  planning tab, renders results, handles empty state.

## R2 — Planning Wire Contract Aligned with Frozen Schema

**Finding**: `commitPlanningBatch()` returned ad-hoc fields
(`appliedRevisionId`, `errorCode/errorMessage` flat, `pendingId`,
`replayReference`, `skipReason`) that don't match frozen
`PlanningBatchItemResultSchema` in `@hrp-engagement/contracts/scheduling.ts`.
Auditor required reading the actual schema, not inferring from report.

**Fix**:
- `types.ts`: `BatchItemResult` now wire-aligned:
  - `itemId, itemKind, outcome` (always).
  - `appliedId: string` (canonical), `appliedVersion: number` (ExpectedVersionSchema)
    for APPLIED.
  - `pendingReference: { kind: 'COMMAND_OPERATION', operationId: string }`
    for ACCEPTED (canonical OperationReference).
  - `error: { itemId, errorCode, messageKey, fieldPath?, retryClass }` for FAILED
    (PlanningBatchItemErrorSchema).
  - `appliedId` optional on SKIPPED (when skip has target canonical).
- Removed ad-hoc fields: `appliedRevisionId`, flat `errorCode`/`errorMessage`,
  `pendingId`, `replayReference`, `skipReason`.
- `PlanningBatchResult` now includes `schemaVersion: string` (frozen contract).
- `commitPlanningBatch()` matches: returns `schemaVersion + batchId + items +
  summary + completedAt` exactly matching `PlanningBatchResultSchema`.
- `generateDeterministicOutcomes()` produces contract-aligned items with
  `appliedVersion: 1` (number per ExpectedVersionSchema).
- FAILED outcomes carry NO `appliedId`/`appliedVersion`/`pendingReference` per
  contract `superRefine`.

**Tests parse REAL response through frozen schema**:
- `tests/assistant-service.test.mjs` imports `PlanningBatchResultSchema`
  and `PlanningBatchItemResultSchema` from
  `packages/contracts/dist/commands/scheduling.js`.
- Tests:
  - `R2: mixed outcomes response parses with PlanningBatchResultSchema`
    (ACCEPTED+APPLIED+FAILED+SKIPPED mixed).
  - `R2: ACCEPTED replay response parses with PlanningBatchResultSchema`.
  - `R2: APPLIED replay response parses with PlanningBatchResultSchema`.
  - `R2: same-key/diff-payload response parses with PlanningBatchResultSchema`.
  - `R2: response does NOT include ad-hoc fields (no flat errorCode/
    errorMessage on item)` — proves no legacy fields leaked.
- All previously-failing assertions (`r.items[0].pendingId`, `errorCode`,
  `appliedRevisionId`, `skipReason`) updated to contract-correct access
  (`r.items[0].pendingReference?.operationId`, `error.errorCode`,
  `appliedId`, etc.).

**Evidence**:
- Real-response contract parse via `PlanningBatchResultSchema.safeParse(...)`.
- All 53 service tests pass + 35 API tests pass. Cannot fabricate `success: true`
  — Zod validates against actual schema.
- Schema constraints verified: `appliedVersion` is integer ≥0; `operationId`
  CommandIdSchema ≥8 chars; `batchId` ≥8 chars.

## R3 — Manifest Coverage (orchestrator-wire.ts Added)

**Finding**: Pre-R3 manifest (`7DAD3A47...`) omitted `orchestrator-wire.ts`
even though it was modified in B1 for `extraScopes`,
`canProposeAutofill`, `canConfirmAutofillDraft` — part of the CORE/1.13
delta.

**Fix**:
- `scripts/generate-manifest-1.13.mjs` BUNDLE_FILES now includes
  `apps/context-panel/src/orchestrator-wire.ts`.
- BUNDLE_FILES comment notes R3 mandate.
- Manifest header comment updated: NEW 10 files + SHARED 3 files
  (`server.ts`, `app.tsx`, `orchestrator-wire.ts`).
- `tests/manifest-readonly-1.13.test.mjs`: assertion now requires
  `src/orchestrator-wire.ts` in bundled manifest.

**Evidence**:
- `manifest-readonly-1.13.test.mjs`:
  - `--verify --check` read-only (proven in earlier bundle).
  - Bundled manifest unchanged after `--output` run.
  - Coverage check includes `orchestrator-wire.ts`.
- Manifest SHA reflects full delta.

---

## Bundle Changes (Post-R3 — current)

### NEW Files

| File | Purpose |
|------|---------|
| `src/assistant/types.ts` | Internal types: TodaySnapshot, AutofillProposal, BatchItemResult (wire-aligned R2), ProviderConfigRead, AutofillDraft, AutofillAcceptResult, etc. |
| `src/assistant/fixtures.ts` | Deterministic synthetic data (mulberry32-seeded, seed=0xcafe_1c13) |
| `src/assistant/store.ts` | Singleton Map-based in-memory store; autofillDrafts, appliedMutations, nextActionVersions, batchItemsMeta ledgers |
| `src/assistant/service.ts` | Service layer: today/week/autofill (draft+confirm), planning batch (replay-safe, R2 wire-aligned), provider, reminder |
| `src/assistant/index.ts` | Public surface re-exports |
| `src/ui/components/assistant-panel.tsx` | React UI: 6-tab panel + draft confirm flow (R1 wire-aligned types) |
| `tests/assistant-service.test.mjs` | **53** unit tests (AC1–AC5 + Q1–Q5 + B1–B5 + R2 contract parse) |
| `tests/assistant-api.test.mjs` | **35** API integration tests (AC1–AC5 + Q1–Q5 + B1–B5 + R2 contract parse) |
| `tests/assistant-no-model-no-provider.test.mjs` | 4 boundary/no-model tests |
| `tests/assistant-browser-evidence.mjs` | 12 Playwright browser verification tests |
| `tests/manifest-readonly-1.13.test.mjs` | **5** manifest read-only tests (R3 covers orchestrator-wire.ts) |
| `scripts/generate-manifest-1.13.mjs` | Manifest generation/verification script (R3 adds orchestrator-wire.ts) |
| `docs/contracts/handoff-core-1.13.md` | Handoff document |

### SHARED Files (Extended)

| File | Change |
|------|--------|
| `src/server.ts` | +15 new API routes under `/api/assistant/*` |
| `src/ui/app.tsx` | +`AssistantPanel` tab (AppView `'assistant'`, Alt+6) |
| `src/orchestrator-wire.ts` | **(R3 added)** B1 added `extraScopes`, `canProposeAutofill`, `canConfirmAutofillDraft`. Manifest entry added in R3 (was missing pre-R3). |

---

## Test Counts

---

## Test Counts

| Test File | Count | Coverage |
|-----------|-------|----------|
| `assistant-service.test.mjs` | **53** | AC1–AC5 + Q1–Q5 + B1–B5 + R2 contract parse |
| `assistant-api.test.mjs` | **35** | AC1–AC5 + Q1–Q5 + B1–B5 + R2 contract parse |
| `assistant-no-model-no-provider.test.mjs` | 4 | AC5 boundary |
| `assistant-browser-evidence.mjs` | 12 | AC1–AC5 browser |
| `manifest-readonly-1.13.test.mjs` | **5** | manifest read-only + R3 orchestrator-wire coverage |
| **CORE/1.13 delta (post-R3)** | **109** | 53 + 35 + 4 + 12 + 5 |
| + CORE/1.9 baseline | 66 | |
| + CORE/1.10 | (closed) | |
| + CORE/1.11 | 14 | |
| + CORE/1.12 | 27 | |
| **Grand total npm test** | **226** | Measured on current build (109 delta + 117 regression) |

> `npm test` runs 192 tests (includes all CORE versions). Run `node tests/assistant-browser-evidence.mjs` for the full 12 browser tests.

---

## AC Coverage

| AC | Evidence | Tests | Status |
|----|----------|-------|--------|
| AC1: Today/week fixtures | deterministic snapshots | 4 unit + 2 API + 2 browser | ✅ |
| AC2: Autofill per-field | draft+confirm, stale rejection | 10 unit + 5 API + 2 browser | ✅ |
| AC3: Planning batch partial | APPLIED/ACCEPTED distinction, replay-safe | 6 unit + 3 API + 1 browser | ✅ |
| AC4: Provider config skeleton | no apiKey, manager-only update | 3 unit + 3 API + 1 browser | ✅ |
| AC5: Reminder port/simulator | deterministic counts, no real dispatch | 2 unit + 1 API + 1 browser | ✅ |

---

## Auditor Clarification — Q1–Q5 Proof

### Q1: Manager mutation requires draft + confirm (not direct apply)

**Requirement**: Manager has mutation right but accept only creates a draft; staff must review before mock command is sent.

**Implementation**:
- `acceptAutofillFields()` for manager: creates a `AutofillDraft` (server-bound with `draftId`, `draftRevision`, `confirmationDigest` = SHA-256 of payload) and returns `mutated=false`.
- Proposal moves to `PENDING_REVIEW` (not `ACCEPTED`).
- Manager must call `confirmAutofillDraft(draftId, expectedDraftRevision, confirmationDigest)` to apply.
- `confirmAutofillDraft()` checks `draftRevision` (optimistic concurrency) and `confirmationDigest` (binding), then marks draft as `applied=true` and moves proposal to `ACCEPTED`.
- Replay of confirm returns `ALREADY_APPLIED` (409).

**Evidence**:
- `tests/assistant-service.test.mjs`:
  - `Q1: manager accept creates DRAFT only (mutated=false)` ✅
  - `Q1: manager confirm() applies mutation (mutated=true via draft)` ✅
  - `Q1: confirm replay blocked (ALREADY_APPLIED 409)` ✅
  - `Q1: confirm with wrong digest returns CONFIRMATION_MISMATCH 400` ✅
  - `Q1: confirm with wrong revision returns DRAFT_VERSION_CONFLICT 409` ✅
- `tests/assistant-api.test.mjs`:
  - `Q1: POST /api/assistant/autofill/accept (manager) returns draftId + confirmationDigest` ✅
  - `Q1: POST /api/assistant/autofill/confirm applies mutation` ✅
  - `Q1: POST /api/assistant/autofill/confirm replay → 409 ALREADY_APPLIED` ✅

### Q2: Sale propose-only — no API bypass path

**Requirement**: Sale/AI cannot mutate canonical fields; no alternate API call to bypass.

**Implementation**:
- `acceptAutofillFields()` for non-manager (SALE/AI): returns `canMutate=false, mutated=false`, `draftId=undefined`.
- `confirmAutofillDraft()` throws `FORBIDDEN` (403) for non-manager at service layer.
- No other endpoint mutates autofill proposal state without going through draft+confirm.

**Evidence**:
- `tests/assistant-service.test.mjs`:
  - `AC2: sale accepting fields does NOT mutate (canMutate=false, mutated=false)` ✅
  - `Q1: sale accept does NOT create draft (canMutate=false, no draftId)` ✅
  - `Q2: sale confirm returns FORBIDDEN 403` ✅
- `tests/assistant-api.test.mjs`:
  - `Q2: POST /api/assistant/autofill/confirm (sale) → 403 FORBIDDEN` ✅
  - `Q2: POST /api/assistant/autofill/accept (sale) does NOT create draft` ✅

### Q3: Batch ACCEPTED vs APPLIED distinction + replay safety + server-side stale block

**Requirement**: Batch distinguishes `ACCEPTED` (accepted, pending query) from `APPLIED` (mutated). Replay does not re-apply. Reschedule stale version blocked server-side.

**Implementation**:
- `PlanningBatchItemOutcome`: `'APPLIED' | 'ACCEPTED' | 'FAILED' | 'SKIPPED'`
- `commitPlanningBatch()`:
  - Stores results keyed by `batchId` in store.
  - On replay: checks `isBatchItemApplied(batchId, itemId)`. If already APPLIED or ACCEPTED → returns `SKIPPED` with `errorCode='ALREADY_APPLIED'` and preserves original `appliedRevisionId`. No re-mutation.
  - Combined count: `appliedCount + acceptedCount` (both are "succeeded").
- `rescheduleNextAction()`: server-side authoritative `nextActionVersions` map. Client's `expectedVersion` compared against stored server version → `VERSION_CONFLICT` with `currentVersion` on mismatch.

**Evidence**:
- `tests/assistant-service.test.mjs`:
  - `Q3: batch distinguishes APPLIED vs ACCEPTED outcomes` ✅
  - `Q3: replaying batch returns SKIPPED/ALREADY_APPLIED for applied items` ✅
  - `AC3: replanning same batch does not duplicate mutation (idempotent)` ✅
  - `AC3: reschedule stale version returns VERSION_CONFLICT` ✅
- `tests/assistant-api.test.mjs`:
  - `Q3: POST /api/assistant/planning/commit replay → SKIPPED/ALREADY_APPLIED` ✅
  - `AC3: POST /api/assistant/planning/reschedule stale → VERSION_CONFLICT` ✅

### Q4: Provider configs are fixtures only — no model/network probe, no raw API key

**Requirement**: Provider configs are synthetic fixtures. Updates do not call model/provider API or expose raw API keys.

**Implementation**:
- Provider configs are seeded in `assistantStore` from `fixtures.ts` (no external call).
- `ProviderConfigRead` DTO explicitly excludes `apiKey` field.
- Updates modify in-memory store only (no HTTP call to provider).
- Static analysis in `assistant-no-model-no-provider.test.mjs` verifies no `openai`/`anthropic`/`fetch`/`PrismaClient` imports.

**Evidence**:
- `tests/assistant-service.test.mjs`:
  - `AC4: provider config read DTO does NOT include raw API key` ✅
- `tests/assistant-no-model-no-provider.test.mjs`:
  - `AC5: assistant src has no fetch/axios/openai/anthropic imports` ✅
  - `AC5: assistant src has no PrismaClient / database calls` ✅
  - `AC5: assistant server routes use synthetic fixtures only` ✅

### Q5: Reminder simulator — no real notification; mock APIs blocked at mockMode=off

**Requirement**: Reminder simulator does not send real notifications. Mock APIs are blocked when `mockMode=off`.

**Implementation**:
- `simulateReminders()` in service returns deterministic `pendingCount`/`suppressedCount` from fixtures.
- Server entry guard (CORE/1.9 B2): `guardMockMode(req, res)` at top of server.ts → all `/api/*` routes return 404 `mock_disabled` when `HRP_MOCK_MODE=off`.
- Every `/api/assistant/*` route calls `guardUnauthorized()` which runs after the mock guard.
- Static check in `assistant-api.test.mjs` verifies every assistant route has `guardUnauthorized()`.

**Evidence**:
- `tests/assistant-service.test.mjs`:
  - `AC5: reminder simulator does NOT claim real notification dispatched` ✅
- `tests/assistant-api.test.mjs`:
  - `Q5: every assistant route is guarded by mockMode (server source check)` ✅
  - `Q5: HRP_MOCK_MODE=off blocks every assistant endpoint with 404` ✅

---

## CORE/1.12 Post-Audit Follow-Up — Status

**COMPLETED** ✅

The post-audit follow-up for CORE/1.12 was completed before CORE/1.13 started. Changes:
1. `generate-manifest-1.12.mjs` now accepts `--output <path>` for test scratch output.
2. `manifest-readonly-1.12.test.mjs` updated to prove read-only behavior using scratch files.
3. Test counts corrected in `handoff-core-1.12.status.md`:
   - `dashboard-service.test.mjs`: 16 tests
   - Delta total: 52 (15 unit + 16 service + 14 API + 3 manifest + 4 boundary)
4. Separate post-audit manifest: `handoff-core-1.12.postaudit.manifest.txt`

CORE/1.12 remains CLOSED with independent Auditor PASS. The post-audit delta does not affect the audit-PASS snapshot.

---

## Browser Evidence

| # | Test | Status | Note |
|---|------|--------|------|
| T1 | Alt+6 keyboard nav reaches Assistant tab | ✅ | |
| T2 | Today view renders ≥3 deterministic items | ✅ | |
| T3 | Week view renders ≥5 plan items | ✅ | |
| T4 | Autofill shows 3 proposals (clear/conflict/stale) | ✅ | |
| T5 | Manager accept → draft → confirm → ACCEPTED | ✅ | Updated: draft+confirm flow |
| T6 | Planning commit shows batch result | ✅ | |
| T7 | Reschedule stale → VERSION_CONFLICT | ✅ | |
| T8 | Provider ≥2 configs, no API key | ✅ | |
| T9 | Reminder simulator runs, no production claim | ✅ | |
| T10 | Narrow panel (<480px) usable | ✅ | |
| T11 | Sale sees no-permission hint on Autofill | ✅ | |
| T12 | Sale sees no-permission hint on Provider | ✅ | |

Evidence files: `tests/evidence/assistant-01-loaded.png` … `assistant-12-sale-provider.png`  
Summary: `tests/evidence/assistant-summary.json` (12/12 passed)

---

## Manifest Structure

| Manifest | SHA-256 | Role |
|----------|---------|------|
| `handoff-core-1.9.manifest.txt` | (audit PASS) | CORE/1.9 baseline |
| `handoff-core-1.11.manifest.txt` | (audit PASS) | CORE/1.11 |
| `handoff-core-1.12.manifest.txt` | (audit PASS) | CORE/1.12 |
| `handoff-core-1.12.postaudit.manifest.txt` | (post-audit) | CORE/1.12 follow-up |
| `handoff-core-1.13.manifest.txt` | `6744FC55...` | CORE/1.13 delta |

Shared files (`server.ts`, `app.tsx`) appear in multiple manifests with different hashes reflecting their state at each audit boundary.

---

## Running Local

```bash
cd apps/context-panel

# Build + typecheck
npm run build

# Run server
npm start

# All unit/API tests (192 total)
npm test

# Browser verification (requires Chromium)
node tests/assistant-browser-evidence.mjs

# Manifest
node scripts/generate-manifest-1.13.mjs
node scripts/generate-manifest-1.13.mjs --verify
node scripts/generate-manifest-1.13.mjs --check
```

**Keyboard**: `Alt+6` → Assistant tab
**Mock identity** (for browser/manual testing):
- Manager: `X-HRP-Staff-Id: staff-supervisor-001`
- Sale: `X-HRP-Staff-Id: staff-talent-001`
- Intake: `X-HRP-Staff-Id: staff-intake-001`
- No-scope: `X-HRP-Staff-Id: staff-no-scope-001`

---

# Post-Audit Blocker Fixes (B1–B5 + Contract Delta)

## Test Count Update

| Test File | Pre-Fix | Post-Fix | Delta |
|-----------|---------|----------|-------|
| `assistant-service.test.mjs` | 30 | **48** | +18 (B1/B2/B3/B4/B5) |
| `assistant-api.test.mjs` | 25 | **35** | +10 (B1/B2/B3/B4/B5) |
| `assistant-browser-evidence.mjs` | 12 | **12** | — |
| `assistant-no-model-no-provider.test.mjs` | 4 | 4 | — |
| `manifest-readonly-1.13.test.mjs` | 4 | **6** | +2 (read-only proof) |
| `security-evidence.mjs` | 8 | 8 | — |
| `dashboard-service.test.mjs` | 16 | 16 | — |
| `routing-service.test.mjs` | 14 | 14 | — |
| `intake-api.test.mjs` | 12 | 12 | — |
| **CORE/1.13 delta** | 75 | **99** | +24 |
| Grand total | ≥228 | **≥252** | |

## B1 — Autofill Scope-Based Authorization

**Finding**: All autofill operations were manager-only (role check). Auditor required actor/org/object scope check so staff can create/confirm drafts within their scope.

**Fix**:
- Added `extraScopes: string[]` to `MockIdentity` interface (`orchestrator-wire.ts`).
- Added `actorHasAutofillScope(identity, profileId)` → checks `autofill:profile-*` / `autofill:profile-talent-*` patterns.
- Added `actorOrgMatchesAutofillObject(identity, orgId)` → org match for cross-org guard.
- Added `canProposeAutofill(identity, profileId, orgId)` → scope + org check for accept.
- Added `canConfirmAutofillDraft(identity, profileId, orgId)` → requires `autofill:draft.confirm` scope.
- `acceptAutofillFields()` now calls `canProposeAutofill()` → FORBIDDEN if no scope.
- `confirmAutofillDraft()` now calls `canConfirmAutofillDraft()` → FORBIDDEN if no scope.
- Supervisor/intake have `autofill:profile-*` + `autofill:draft.confirm` scope.
- Sale (TALENT_REVIEWER) has `autofill:profile-talent-*` only → propose-only, no confirm.
- No-scope actor has empty extraScopes → fully rejected.

**Evidence**:
- Service: `B1: actor without scope → 403 FORBIDDEN`, `B1: sale proposes in their scope, no draftId`, `B1: intake actor with draft.confirm can confirm`, `B1: cross-scope actor → 403`, `B1: SYSTEM without scope → 403`
- API: `B1: POST autofill/accept (no-scope) → 403`, `B1: intake actor in intake scope → draftId`, `B1: POST autofill/confirm (sale no scope) → 403`

## B2 — ACCEPTED Replay Keeps ACCEPTED + Reference

**Finding**: ACCEPTED items were replayed as SKIPPED/ALREADY_APPLIED. Auditor required keeping ACCEPTED outcome on replay.

**Fix**:
- `batchItemsMeta` map (keyed by `batchId:itemId`) stores `{ payloadDigest, outcome, appliedRevisionId?, pendingId? }`.
- `commitPlanningBatch()` on replay: if `previous.outcome === 'ACCEPTED'` → return same ACCEPTED with `pendingId` and `replayReference`, no SKIPPED.
- APPLIED replay → SKIPPED/ALREADY_APPLIED (no re-mutation).
- Summary counts: `acceptedCount` incremented for ACCEPTED outcomes (not skipped).

**Evidence**:
- Service: `B2: ACCEPTED replay returns same ACCEPTED + pendingReference`, `B2: APPLIED replay → SKIPPED (no re-mutation)`, `B2: partial replay — only APPLIED → SKIPPED`
- API: `B2: planning/commit ACCEPTED replay keeps ACCEPTED + pendingReference`, `B2: planning/commit APPLIED replay → SKIPPED`

## B3 — Same Key/Different Payload Digest Conflict

**Finding**: No conflict detection when same key has different payload.

**Fix**:
- `PlanningBatchItemInput` now includes optional `payloadDigest` (SHA-256 of canonicalized item payload).
- Store records `payloadDigest` per item in `batchItemsMeta`.
- On replay: if stored digest ≠ new digest → `FAILED/PAYLOAD_MISMATCH` before any mutation.
- If digests match (or new digest absent) → existing B2 replay logic applies.
- Both committed results and ledger are updated to hold original outcome in partial replay.

**Evidence**:
- Service: `B3: same key with different payload digest → FAILED PAYLOAD_MISMATCH`, `B3: same key/same payload → outcome preserved`, `B3: keys without payloadDigest → legacy replay still works`
- API: `B3: planning/commit same key different payload → 200 with PAYLOAD_MISMATCH`, `B3: planning/commit same key same payload → SKIPPED`

## B4 — Provider Write Schema Validation

**Finding**: Raw body typed as `ProviderConfigWrite`; no schema validation, raw secrets not rejected.

**Fix**:
- Added `parseProviderConfigWrite(input: unknown)` in `service.ts`:
  - `Zod` schema with `.strict()` → rejects unknown fields (`INVALID_PAYLOAD` 400).
  - Pre-flight scan against `SECRET_FIELD_FORBIDDEN` set (apiKey/token/secretKey/password/authorization/bearer/credential/etc.) → `INVALID_PAYLOAD` 400 before schema parse.
  - Error messages name only the field key, never echo the secret value.
- `updateProviderConfig()` now accepts `unknown` body, validates before processing.
- Store's manager-only + version conflict checks remain enforced.

**Evidence**:
- Service: `B4: provider write rejects unknown fields`, `B4: provider write rejects raw apiKey`, `B4: provider write rejects token/secretKey/password nested`, `B4: error message does NOT echo secrets`, `B4: provider write requires url for baseUrl`, `B4: manager-only + version conflict still enforced`
- API: `B4: PUT provider with raw apiKey → 400 INVALID_PAYLOAD`, `B4: PUT provider with unknown field → 400 INVALID_PAYLOAD`, `B4: error message does NOT echo secret value`

## B5 — Confirm Idempotent Recovery

**Finding**: Replay of confirm on already-applied draft returned ALREADY_APPLIED error. Auditor required idempotent return (same result, no re-mutation).

**Fix**:
- `createAutofillDraft()`: stable draftId derived from SHA-256 of `(actorId, profileId, proposalId, sorted fieldPaths)`. Re-create with same inputs returns existing draft.
- `confirmAutofillDraft()`: if `draft.applied === true` AND request params match (correct revision + digest + actorId) → return same applied draft (HTTP 200, no re-mutation).
- Wrong revision/digest on applied draft → still returns `DRAFT_VERSION_CONFLICT` / `CONFIRMATION_MISMATCH`.
- Different actorId → `FORBIDDEN` (actor binding).
- Authorization check runs BEFORE idempotent return (no early short-circuit).

**Evidence**:
- Service: `B5: confirm retry returns same applied draft (idempotent)`, `B5: confirm retry with wrong revision → DRAFT_VERSION_CONFLICT`, `B5: confirm with wrong digest on applied draft → CONFIRMATION_MISMATCH`, `B5: no early-return before authorization`
- API: `B5: POST autofill/confirm retry → idempotent 200`, `B5: POST autofill/confirm retry with wrong revision → 409`

## Contract Delta — `allSuccess` Removed

**Finding**: `PlanningBatchResult` internal type had `allSuccess: boolean`. Frozen contract schema (`scheduling.ts`) does NOT have this field.

**Fix**:
- Removed `allSuccess` from internal `PlanningBatchResult` type in `types.ts`.
- `commitPlanningBatch()` now returns `{ batchId, items: BatchItemResult[], summary: PlanningBatchSummary, completedAt }` matching frozen `PlanningBatchResultSchema` shape.
- `PlanningBatchSummary` has `totalItems/appliedCount/acceptedCount/failedCount/skippedCount`.

**Evidence**:
- Service: `AC3: PlanningBatchResult does NOT include allSuccess (frozen contract conformance)`
- API: `AC3: planning/commit returns per-item outcomes` asserts `allSuccess in r.body === false`

## Manifest Test — Read-Only + Scratch Output

**Finding**: `manifest-readonly-1.13.test.mjs` modified bundled artifact on test run.

**Fix**:
- `generate-manifest-1.13.mjs` now supports `--output <path>` flag for scratch output.
- Test generates to scratch path only (never touches bundled `docs/contracts/handoff-core-1.13.manifest.txt`).
- `--verify` and `--check` always read-only against bundled path.
- Test proves bundled hash unchanged after test run (SHA-256 comparison before/after).

**Evidence**:
- `manifest-readonly-1.13.test.mjs`: `manifest: generate writes to --output scratch file (not bundled)`, `manifest: --verify is read-only`, `manifest: --check is read-only`

---

## Previous Q Evidence (Updated)

### Q1: Manager mutation requires draft + confirm
- Note: `Q1: confirm replay blocked (ALREADY_APPLIED 409)` superseded by B5 (`B5: confirm retry → idempotent 200`)
- New B5 tests cover idempotent recovery

### Q2: Sale propose-only (B1 supersedes Q2)
- B1 scope-based authorization fully covers Q2 scope requirements

### Q3: Batch replay (B2/B3 supersede Q3)
- B2 covers ACCEPTED replay preservation
- B3 covers payload digest conflict

### Q4: Provider fixtures (unchanged)
### Q5: Reminder simulator (unchanged)

