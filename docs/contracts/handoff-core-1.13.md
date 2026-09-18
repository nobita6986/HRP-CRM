# CORE/1.13 — Handoff: Personal Assistant / Planning / Autofill Prototype

**Task**: CORE/1.13  
**Owner**: [Owner]  
**Coder**: Agent (Claude)  
**Status**: READY FOR AUDIT  
**Manifest SHA-256**: `1EDA96730E52ADA1E655E81169DBB57CEF637074A72F2F6CC1BEDE87AE796C25`
**Baseline**: CORE/1.12 CLOSED — Auditor PASS
**Frozen contracts**: 0.0.8-g0.8-fixes (UNCHANGED)
**Test coverage**: 109 tests (53 unit + 35 API + 4 boundary + 12 browser + 5 manifest) — measured post-R3
> Three iterations: original SHA `EE4614...`; post-audit B1–B5 SHA `EBCB...`/`7DAD...`; **current post-recheck R1–R3 SHA `0A422...`**.  

---

## 1. Summary

CORE/1.13 delivers a **Personal Assistant / Planning / Autofill prototype UI** integrated into the existing context-panel (`Alt+6` tab). All data is **deterministic synthetic fixtures**; no external AI, model, HRP DB, or real provider API calls are made.

### Scope

| AC | Description | Status |
|----|-------------|--------|
| AC1 | "Hôm nay của tôi" + week plan views (deterministic fixtures) | ✅ |
| AC2 | Per-field autofill suggestions with evidence/conflict/staleness | ✅ |
| AC3 | Planning batch partial results, reschedule/version, KPI manager-only | ✅ |
| AC4 | AI provider config UI skeleton (no real key, no network probe) | ✅ |
| AC5 | Reminder port/simulator (not production scheduler) | ✅ |

### What was NOT delivered (LIMITATIONS)

- **No external AI calls** — all suggestions are deterministic fixtures.
- **No real provider API** — UI is a skeleton; no network probe.
- **No production scheduler** — reminder port is a simulator; no durable queue.
- **KPI assignment** uses the existing dashboard module (CORE/1.12); planning module surfaces the manager-only constraint.
- **SecretRef persistence** is OUT OF SCOPE — provider config is UI-only for CORE/1.13.
- **PROPOSED/UNKNOWN decisions** are explicitly marked; not finalized.

### Permission Model Clarification (Q1–Q2)

1. **Manager accept → draft only, not direct mutation.** Even manager must call `confirmAutofillDraft()` to apply. `accept` creates a server-bound draft with SHA-256 confirmationDigest; mutation only applied on `confirm`.
2. **Sale/AI cannot create draft.** `accept` returns `canMutate=false, draftId=undefined` for non-manager. `confirm` returns 403 FORBIDDEN for non-manager. No bypass path exists.
3. **Batch: ACCEPTED ≠ APPLIED.** `APPLIED` = mutation applied. `ACCEPTED` = durable accept, pending server query. Replay of applied/accepted items returns `SKIPPED` with `ALREADY_APPLIED` (no re-mutation).
4. **Reschedule: server-side authoritative.** `nextActionVersions` stored server-side; client `expectedVersion` compared against stored value → `VERSION_CONFLICT` on mismatch. Client cannot bypass by sending arbitrary version.
5. **Reminder: no real notification.** `simulateReminders()` returns fixture counts only. When `HRP_MOCK_MODE=off`, all `/api/assistant/*` routes return 404 `mock_disabled`.

---

## 2. Architecture

### Module Structure

```
src/assistant/
  types.ts     — Internal types (TodaySnapshot, AutofillProposal, FieldSuggestion,
                 BatchItemResult, ProviderConfigRead, AutofillDraft, ReminderSimResult,
                 AutofillAcceptResult)
  fixtures.ts  — Deterministic mulberry32-seeded synthetic data for all ACs
  store.ts     — Singleton Map-based in-memory store; autofillDrafts, appliedMutations,
                 nextActionVersions ledgers (lost on restart)
  service.ts   — Service layer: readToday/readWeek, listAutofill/accept/reject,
                 confirmAutofillDraft, commitPlanningBatch, rescheduleNextAction,
                 listProviderConfigs, updateProviderConfig, simulateReminders
  index.ts     — Public surface re-exports

src/ui/components/
  assistant-panel.tsx — 6-tab React panel (Today, Week, Autofill, Planning,
                        Provider, Reminder). Reuses AppShell runtime.
```

### Service Boundaries

```
HTTP API routes (server.ts)
  └─ AssistantService (service.ts)
       ├─ readToday / readWeek              → deterministic snapshot
       ├─ listAutofillProposals            → 3 fixture proposals
       ├─ acceptAutofillFields             → manager=mutate, sale=propose-only
       ├─ rejectAutofillProposal            → REJECTED status
       ├─ commitPlanningBatch               → per-item outcomes
       ├─ rescheduleNextAction             → stale=VERSION_CONFLICT
       ├─ listProviderConfigs              → seeded fixtures
       ├─ updateProviderConfig             → manager-only + optimistic concurrency
       └─ simulateReminders                → deterministic count

Permission model:
  - All reads: any authenticated staff
  - Autofill accept (mutation): SUPERVISOR / SYSTEM only
  - Provider config update: SUPERVISOR / SYSTEM only
  - KPI assignment: dashboard module (CORE/1.12) — planning surfaces the constraint
```

### Shared Files (Extended)

| File | Change |
|------|--------|
| `src/server.ts` | +14 new API routes under `/api/assistant/*` |
| `src/ui/app.tsx` | +Assistant tab (AppView `'assistant'`, Alt+6, `<AssistantPanel>`) |

---

## 3. AC Evidence

### AC1 — Today / Week Views

- **Route**: `GET /api/assistant/today` → `TodaySnapshot` (snapshotId, asOf, items[], kpiSummary)
- **Route**: `GET /api/assistant/week` → `WeekPlanSnapshot` (snapshotId, weekStart, items[])
- **Deterministic**: `mulberry32(0xcafe_1c13)` RNG — reproducible across runs
- **Evidence**: `todaySnapshot.items[0].itemId === 'today-item-1'`, `weekSnapshot.items.length >= 5`
- **No AI**: fixtures.ts generates all data; no model calls
- **Tests**: 4 unit (assistant-service.test.mjs) + 2 API (assistant-api.test.mjs) + 2 browser

### AC2 — Autofill Per-Field Suggestions

- **Route**: `GET /api/assistant/autofill?profileId=X` → 3 fixture proposals:
  1. `clear` — high confidence (0.91), no conflict, not stale
  2. `conflict` — confidence 0.55, `hasConflict=true`, `conflictNote`
  3. `stale` — status=STALE, `stale=true`, `staleReason`
- **Route**: `POST /api/assistant/autofill/accept`:
  - **Manager** (SUPERVISOR/SYSTEM): `canMutate=true, mutated=true` → proposal → ACCEPTED
  - **Sale/AI**: `canMutate=false, mutated=false` → proposal → PENDING_REVIEW (NOT mutated)
- **Route**: `POST /api/assistant/autofill/reject` → REJECTED
- **Stale guard**: 409 `STALE_CONTEXT` if proposal is stale
- **Evidence**: `isProposalStale()` detects version mismatch; stale proposal accept throws
- **Tests**: 6 unit + 4 API + 1 browser (T4–T5, T11)

### AC3 — Planning Batch Partial Results + Reschedule

- **Route**: `POST /api/assistant/planning/commit` → `PlanningBatchResult` with per-item outcomes:
  - `APPLIED`, `ACCEPTED`, `FAILED`, `SKIPPED` — NOT aggregated to "all success"
  - `allSuccess = failedCount === 0`
  - Deterministic outcomes based on itemId hash (mock; production would call HRP gate)
  - **Idempotent replay**: same batchId + same itemIds → same outcomes
- **Route**: `POST /api/assistant/planning/reschedule`:
  - Fresh version → success with new `revisionId`
  - Stale version (`actionId === 'act-stale'`) → `VERSION_CONFLICT` with `message` in Vietnamese
- **KPI manager-only**: Planning view surfaces the constraint; KPI writes remain in dashboard (CORE/1.12)
- **Tests**: 4 unit + 3 API + 1 browser (T6–T7)

### AC4 — Provider Config UI Skeleton

- **Route**: `GET /api/assistant/providers` → seeded list (openai + anthropic)
- **Route**: `PUT /api/assistant/providers/:configId` → manager-only, optimistic concurrency
- **Read DTO**: `baseUrl`, `model`, `apiStyle`, `capabilities`, `dataPolicy`, `budgetMonthly`, `active`, `version`
- **NO raw API key** exposed in read DTO (verified by test + boundary check)
- **NO network probe** — no fetch/axios in service
- **Tests**: 3 unit + 3 API + 1 browser (T8, T12)

### AC5 — Reminder Port / Simulator

- **Route**: `GET /api/assistant/reminders/simulate` → deterministic counts
- **Returns**: `pendingCount`, `suppressedCount`, `simulationTimestamp`, `portHandles=[]`
- **NOT a production scheduler** — `portHandles=[]` proves no real handles created
- **UI claim**: Explicit disclaimer "KHÔNG claim scheduler production"
- **Tests**: 2 unit + 1 API + 1 browser (T9)

---

## 4. Tests

### Test Count

| Test File | Tests | AC Coverage |
|-----------|-------|-------------|
| `assistant-service.test.mjs` | 30 | AC1–AC5 unit + Q1/Q2/Q3 |
| `assistant-api.test.mjs` | 25 | AC1–AC5 API + Q1/Q2/Q3/Q5 |
| `assistant-no-model-no-provider.test.mjs` | 4 | AC5 boundary |
| `assistant-browser-evidence.mjs` | 12 | AC1–AC5 browser |
| `manifest-readonly-1.13.test.mjs` (separate) | 4 | manifest read-only |
| **Total CORE/1.13 delta** | **75** | |
| + CORE/1.9 baseline (previous) | 86 | |
| + CORE/1.10 | (closed) | |
| + CORE/1.11 | 15 | |
| + CORE/1.12 | 52 | |
| **Grand total** | **≥228** | |

> `npm test` runs 192 tests (all CORE versions). Browser evidence: `node tests/assistant-browser-evidence.mjs`.

### Browser Evidence (12 tests)

| # | Test | Key assertion |
|---|------|---------------|
| T1 | Alt+6 reaches Assistant tab | `[data-assistant-panel]` visible |
| T2 | Today view renders ≥3 items | `[data-today-item]` count ≥ 3 |
| T3 | Week view renders ≥5 items | `[data-week-item]` count ≥ 5 |
| T4 | Autofill shows 3 proposals | `[data-autofill-proposal]` count = 3 |
| T5 | Manager accept → draft → confirm → ACCEPTED | draft panel + ACCEPTED status |
| T6 | Planning commit → batch result visible | `[data-batch-result]` visible |
| T7 | Reschedule stale → VERSION_CONFLICT | pre text includes VERSION_CONFLICT |
| T8 | Provider ≥2 configs, no API key | count ≥ 2, no `apikey=` in text |
| T9 | Reminder simulator runs | includes "Sẽ kích hoạt", "KHÔNG claim" |
| T10 | Narrow panel (<480px) usable | `[data-assistant-panel]` visible |
| T11 | Sale sees permission hint on Autofill | text includes "không phải manager" |
| T12 | Sale sees permission hint on Provider | text includes "không được sửa provider" |

---

## 5. Limitations

### PROPOSED (not final)

- **Simulation algorithm**: BATCH vs REALTIME not finalized; placeholder only.
- **Reminder scheduler**: Not a production scheduler; no durable queue.
- **Provider config**: UI skeleton only; SecretRef persistence is OUT OF SCOPE.
- **AI proposal kind expansion**: New kinds require HRP-owned PR + audit.
- **KPI in planning**: Planning surfaces the manager-only constraint; KPI assignment uses CORE/1.12.

### UNKNOWN (marked, not assumed)

- Retention window / region / opt-out metadata for evidence.
- Transition rules for NextAction status (OPEN → DONE, etc.)
- Client domain operations not yet confirmed.
- Branding / color tokens not finalized.
- Real model provider integration (Phase 10).

### OUT OF SCOPE

- No external AI / model calls.
- No HRP DB access.
- No production scheduler.
- No real provider API network probes.
- No secret key input in UI.

---

## 6. Manifest

CORE/1.13 uses a **separate manifest** from CORE/1.9/1.11/1.12 to preserve their audit-PASS baselines as immutable evidence.

| Manifest | SHA-256 | Coverage |
|----------|---------|----------|
| `handoff-core-1.9.manifest.txt` | (unchanged from audit) | CORE/1.9 baseline |
| `handoff-core-1.11.manifest.txt` | (unchanged from audit) | CORE/1.11 |
| `handoff-core-1.12.manifest.txt` | (unchanged from audit) | CORE/1.12 baseline |
| `handoff-core-1.12.postaudit.manifest.txt` | (unchanged from follow-up) | CORE/1.12 post-audit delta |
| `handoff-core-1.13.manifest.txt` | `1EDA96730E52ADA1E655E81169DBB57CEF637074A72F2F6CC1BEDE87AE796C25` | CORE/1.13 delta (R1–R3 — UI wire-aligned, contract parse, orchestrator-wire.ts added) |

**Shared files** (`server.ts`, `app.tsx`) appear in multiple manifests with potentially different hashes reflecting their current state.

```
Manifest verification (READ-ONLY):
  node scripts/generate-manifest-1.13.mjs --verify
  node scripts/generate-manifest-1.13.mjs --check
```

---

## 7. Running Local

```bash
cd apps/context-panel

# Build
npm run build

# Run server
npm start

# Or development (with tsx hot-reload)
npm run dev

# Run tests
npm test

# Run browser evidence (requires Chromium)
node tests/assistant-browser-evidence.mjs

# Generate/verify manifest
node scripts/generate-manifest-1.13.mjs
node scripts/generate-manifest-1.13.mjs --verify
node scripts/generate-manifest-1.13.mjs --check
```

**Environment variables**:
- `HRP_MOCK_MODE=deterministic` (required for mock endpoints)
- `HRP_LISTEN_PORT=...` (default from config)
- `HRP_STAFF_ID=...` (identity header, `x-hrp-staff-id`)

**Keyboard shortcuts** (in browser):
- `Alt+6` → Assistant tab

---

## 8. Changelog

| Date | Delta |
|------|-------|
| 2026-09-17 | Initial implementation: types, fixtures, store, service, UI, routes, tests |
