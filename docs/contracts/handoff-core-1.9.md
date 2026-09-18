# CORE/1.9 — Context Panel + Intake Review Mock UI

**Status:** CHANGES_REQUIRED → RE-FIXED (B1–B5) → RE-FIXED AGAIN (R1–R4) → RE-FIXED AGAIN (R3/R4 re-recheck) → ALL TESTS PASSING, READY FOR AUDITOR RECHECK
**Contracts Pin:** 0.0.8-g0.8-fixes (frozen, no changes)
**Gate 0:** FREEZE
**Date:** 2026-09-17 (post R3/R4 re-recheck)
**Scope:** Backlog §Task 1.9 — Context Panel + Intake Review mock UI

---

## 1. Phases

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Design: Talent/Client layouts, component inventory, mock API surface | DONE |
| Phase 2 | Implement React UI components (AppShell, TalentPanel, ClientPanel, IntakeReviewPanel) | DONE |
| Phase 3 | Context Panel components (PlacementCaseCard, AvailabilityCard, StatusBadge, etc.) | DONE |
| Phase 4 | Error states (loading/empty/forbidden/unresolved/stale/timeout/partial) — all Vietnamese | DONE |
| Phase 5 | Close reason dropdown using exactly 9 values from contracts | DONE |
| Phase 6 | CurrentRelationship badge — read-only | DONE |
| Phase 7 | Confirmation invalidation logic — edit → checkbox reset | DONE |
| Phase 8 | Mock API layer — proxies to in-process CORE/1.6 orchestrator with mock gateway | DONE |
| Phase 9 | esbuild bundler (minimal: tsc + esbuild → dist/ui/bundle.js, dist/ui/index.html) | DONE |
| Phase 10 | HTTP API endpoints (/api/context, /api/intake/preview, /api/intake/run, /api/intake/dnc, /api/review/unresolved) | DONE |
| Phase 11 | Unit tests | DONE |
| Phase 12 | Browser verification via Playwright | DONE |

---

## 2. AC Coverage

### AC1: React UI mounted, using developed components, no separate HTML demo

**Implementation:**
- `src/ui/app.tsx` — React AppShell with Talent/Client/Intake Review views; auto-mounts to `#root`.
- `src/ui/components/*.tsx` — Modular components used by AppShell.
- `scripts/build-ui.mjs` — esbuild bundler compiles `src/ui/app.tsx` → `dist/ui/bundle.js`.
- `src/server.ts` — Node.js HTTP server serves `dist/ui/index.html` at `/`, NOT an inline HTML mock.
- **Evidence:** Browser tests ✔.

### AC2: Talent/Client separate layouts, PlacementCase/Availability controls separate, CurrentRelationship read-only, close reason 9 values

**Implementation:** Per component as documented in prior handoff. Client panel remains UNAVAILABLE. **Evidence:** Browser tests ✔.

### AC3: Intake review — diff + evidence mock; checkbox not prechecked; edit invalidates confirmation; preview non-mutating; confirm via server binding

**Implementation:** `intake-review.tsx` stores `revisionId` returned from preview (R1) and reuses it unchanged on submit. Edits after confirmation invalidate the confirmation state and require a new preview to resynchronize. `orchestrator-wire.ts` forwards the full draft field set (contactAddress, intent, citizenIdentity, evidenceRefs) into `ctxForDigest` so preview↔run digests match exactly. **Evidence:** Browser tests ✔ + 8 B1 security sub-tests ✔.

### AC4: Loading/empty/forbidden/unresolved/stale/timeout/partial success → user-friendly Vietnamese; no raw errors; no false success

**Implementation:** Vietnamese error states per contracts. **Evidence:** Browser tests ✔.

### AC5: Keyboard-operable, narrow panel, focus/contrast, NOT claim embedded Chatwoot

**Implementation:** Keyboard shortcuts (Alt+1/2/3), narrow panel layout, branding note. **Evidence:** Browser tests ✔.

---

## 3. Architecture (R3/R4 re-recheck delta)

### Shared module wiring (R4 — true module sharing)

The Coder no longer maintains verbatim copies of CORE/1.6 orchestrator or CORE/1.1 gateway inside the context-panel. After R4, the runtime imports are:

| Surface | Runtime import | Source |
|---------|---------------|--------|
| `IntakeOrchestrator`, `OrchestratorError` | `@hrp-engagement/integration-api/orchestrator` | `apps/integration-api/dist/orchestrator/index.js` |
| `digestCanonical`, `buildCanonicalDraft` | `@hrp-engagement/integration-api/orchestrator` | same |
| `buildStepIdempotencyKey`, `STEP_ORDER` | `@hrp-engagement/integration-api/orchestrator` | same |
| `executeDncAction`, `buildCommitSuppressionPayload`, `assertCommitSuppressionPayloadValid` | `@hrp-engagement/integration-api/orchestrator` | same |
| `createMockGateway` | `@hrp-engagement/integration-api/gateway` | `apps/integration-api/dist/gateway/index.js` |
| `reviewStore`, `ReviewService`, `ReviewServiceError` | `@hrp-engagement/integration-api/review` | `apps/integration-api/dist/review/index.js` (used in `src/review/wiring.ts`) |

Wired via `package.json` (`file:../integration-api`) — the panel is a true package consumer of the shared module.

### Importing modules do NOT auto-start servers

`@hrp-engagement/integration-api/orchestrator`, `/gateway`, and `/review` only export data-plane and business-logic functions. None of them starts an HTTP server on import. Server bootstrap is `src/server.ts` (entrypoint), which is only invoked through `npm start` (or `npm run dev`/`tsx/esm`). Tests start the panel server via `startPanel()` in `dist/server.js`, which is independent of integration-api's runtime imports.

### Files REMOVED in R4 re-recheck

These files were removed from the working tree; they are NOT hashed in the final manifest (listed explicitly in `handoff-core-1.9.manifest.txt` `REMOVED` block):

- `apps/context-panel/src/orchestrator/index.ts`
- `apps/context-panel/src/orchestrator/intake-orchestrator.ts`
- `apps/context-panel/src/orchestrator/digest.ts`
- `apps/context-panel/src/orchestrator/dnc-handler.ts`
- `apps/context-panel/src/orchestrator/steps.ts`
- `apps/context-panel/src/gateway/index.ts`
- `apps/context-panel/src/gateway/mock-gateway.ts`
- `apps/context-panel/src/gateway/ledger.ts`
- `apps/context-panel/src/gateway/scenarios.ts`
- `apps/context-panel/src/gateway/types.ts`
- `apps/context-panel/src/store/intake-checkpoint-shim.ts` (was only consumed by removed copies)
- `apps/context-panel/src/types/integration-api-shims.d.ts` (R4 ambient shim superseded; integration-api ships its own `.d.ts`)
- `apps/context-panel/src/.source-link.json` (synchronized-copy drift guard superseded by true shared module)
- `apps/context-panel/scripts/generate-source-link.mjs` (companion to the removed mechanism)

### CORE/1.7 review wiring (R4)

The `/api/review/unresolved` endpoint calls `listUnresolvedReviews()` from `src/review/wiring.ts`, which statically imports `reviewStore` from `@hrp-engagement/integration-api/review`. The query passes `{ organizationId, status: 'UNRESOLVED', pageSize }` to the shared store. Authorization uses `canIdentityListUnresolved()` mirroring CORE/1.7 `canListReviews()` (RBAC: `INTAKE_OPERATOR`, `SUPERVISOR`, `SYSTEM`). Review version, audit, and scope are preserved by the upstream `ReviewService` surface. **ReviewSnapshot remains a separate preview/confirmation binding; it does NOT replace review business logic.**

### Manifest (R3 — read-only verification)

The manifest script `apps/context-panel/scripts/generate-manifest.mjs` separates generate from verify:

- **Generate (default, no flag):** writes `docs/contracts/handoff-core-1.9.manifest.txt` after code+evidence are stable.
- **`--verify`:** READ-ONLY. Hashes all `FILE|` entries against disk; on missing/mismatch, exits 1 and emits `verify FAIL` to stderr. **Never writes the manifest file.** Cross-checks every `BUNDLE_FILES` entry is present and every `REMOVED_FILES` entry is absent.
- **`--check`:** READ-ONLY. Validates coverage: no duplicate bundle entries, no missing files, no zombie removed files on disk.

Tests in `apps/context-panel/tests/manifest-readonly.test.mjs` prove the contract:

1. `--verify` does not modify manifest bytes across runs (hash equality before/after).
2. `--verify` exits 1 on tamper and preserves manifest bytes unchanged.
3. `--check` reports clean coverage.
4. Generate vs verify are explicit separate modes.

### Environment variable correction (R4 follow-up)

- `HRP_MOCK_MODE=deterministic` (mock endpoints enabled in development) — used in `npm run dev`.
- `HRP_MOCK_MODE=off` (mock endpoints return 404; B2 guard).
- `HRP_PANEL_SCENARIO=forbidden|stale|timeout|partial|unresolved` (per-context query scenarios).

`HRP_PANEL_MOCK_MODE=on` is INVALID — it is NOT recognized. The schema is `MockMode = 'off' | 'deterministic'`. The mock-enabled state is `HRP_MOCK_MODE=deterministic`.

---

## 4. How to run locally

```bash
cd D:/CodeApp/Hrp-Crm/apps/context-panel

# Install deps
npm install

# Build (tsc + esbuild → dist/)
npm run build

# Start server (defaults to http://127.0.0.1:3000, HRP_MOCK_MODE=deterministic)
npm start

# Open browser → http://127.0.0.1:3000

# Run unit tests
npm test

# Run security/regression tests (B1–B5 + R4)
HRP_MOCK_MODE=deterministic node tests/security-evidence.mjs

# Run read-only manifest verification tests
node tests/manifest-readonly.test.mjs

# Run browser verification (against running server)
node tests/browser-evidence.mjs

# Generate manifest (only when code+evidence are stable)
node scripts/generate-manifest.mjs

# Verify manifest (READ-ONLY, no writes)
node scripts/generate-manifest.mjs --verify

# Check coverage (READ-ONLY)
node scripts/generate-manifest.mjs --check
```

Environment variables (all optional in dev):
- `HRP_MOCK_MODE` — `deterministic` | `off` (schema-enforced)
- `HRP_LISTEN_HOST` (default `127.0.0.1`)
- `HRP_LISTEN_PORT` (default `3000`)
- `HRP_NODE_ENV` (default `development`)
- `HRP_CONTRACTS_VERSION` (must be `0.0.8-g0.8-fixes` — frozen)

---

## 5. Manifest summary

The manifest at `docs/contracts/handoff-core-1.9.manifest.txt` covers:

- Server (`src/server.ts`), wire (`src/orchestrator-wire.ts`), gateway-call-log, review/wiring (R4).
- UI (`src/ui/mock-api.ts`, `src/ui/app.tsx`, `src/ui/components/*`).
- Build scripts (`scripts/build-ui.mjs`, `scripts/generate-manifest.mjs`).
- `package.json`.
- Tests (`tests/server.test.mjs`, `tests/panel-ui.test.mjs`, `tests/browser-evidence.mjs`, `tests/security-evidence.mjs`, `tests/manifest-readonly.test.mjs`).
- Evidence (`tests/evidence/summary.json`, `summary.r2.json`, `summary.r3.json`).
- Handoff docs (`docs/contracts/handoff-core-1.9.md`, `.status.md`, `docs/reviews/audit-core-1.9.md`).

Removed (R4 re-recheck — explicitly listed at the end of the manifest file):
- Verbatim orchestrator/gateway copies in `apps/context-panel/src/{orchestrator,gateway}/`
- `apps/context-panel/src/store/intake-checkpoint-shim.ts`
- `apps/context-panel/src/types/integration-api-shims.d.ts`
- `apps/context-panel/src/.source-link.json`
- `apps/context-panel/scripts/generate-source-link.mjs`

### Verification commands

```bash
# Read-only verification — exits 0 on clean, 1 on missing/mismatch
node scripts/generate-manifest.mjs --verify

# Coverage check — read-only
node scripts/generate-manifest.mjs --check
```

---

## 6. Tests (current snapshot — 2026-09-17)

| Suite | Count | Result | Log |
|-------|------:|:------:|-----|
| Unit (`npm test`) | 36 | 36/36 PASS | `tests/unit.log` |
| Security/regression (`tests/security-evidence.mjs`) | 23 | 23/23 PASS | `tests/security.log` |
| Read-only manifest (`tests/manifest-readonly.test.mjs`) | 4 | 4/4 PASS | `tests/readonly.log` |
| Browser (`tests/browser-evidence.mjs`) | 27 | 27/27 PASS | `tests/browser.log` + `tests/evidence/summary.r3.json` |
| **TOTAL current snapshot** | **90** | **90/90 PASS** | — |

### Historical evidence (differentiation)

- `tests/evidence/summary.r2.json` — R2 recheck snapshot (27/27).
- `tests/evidence/summary.r3.json` — current R3/R4 re-recheck snapshot (27/27).

### TypeScript typecheck

- `apps/context-panel`: `tsc --noEmit` clean.
- `apps/integration-api`: builds with `--noEmitOnError false` for outbox errors that are out of scope for this task; orchestrator/gateway/review modules typecheck cleanly. (Outbox issues predate this task and are tracked under CORE/1.10+.)

---

## 7. Limitations

1. **Branding tokens are PROPOSAL, not verified.** Header strip shows the proposal note.
2. **NOT embedded Chatwoot.** HTML comment and branding note explicitly state the panel is a standalone mock UI.
3. **Client domain UNAVAILABLE.** UI shows `UnavailableState` instead of fake success.
4. **Orchestrator step scenario limitation (CORE/1.6 pre-existing).** Run endpoint typically returns `state=PARTIAL` with `failedStep=PROFILE` — faithful to CORE/1.6 mock gateway semantics.
5. **In-memory state.** Checkpoints, gateway ledger, review store are lost on restart. Acceptable for mock UI.
6. **No external gateway / outbox / durable receipt / production auth.** Out of scope per task constraints.
7. **integration-api outbox module has pre-existing TS errors.** Out of scope; orchestrator/gateway/review modules used by the panel typecheck cleanly.

---

## 8. R-blockers (R3/R4 re-recheck)

| Blocker | Fix | Evidence |
|---------|-----|----------|
| **R3** Manifest verification must be read-only | `scripts/generate-manifest.mjs` splits generate from verify. `--verify` and `--check` are strictly read-only (no `writeFileSync`), exit nonzero on missing/mismatch. Removed files explicitly listed in `REMOVED` block. `tests/manifest-readonly.test.mjs` proves bytes-preservation on mismatch. | `scripts/generate-manifest.mjs`; `tests/manifest-readonly.test.mjs` (4/4 ✔); `docs/contracts/handoff-core-1.9.manifest.txt` |
| **R4** Module sharing thực sự | All verbatim copies removed from `apps/context-panel/src/{orchestrator,gateway,store}/`. `.source-link.json` and `generate-source-link.mjs` removed. `src/orchestrator-wire.ts` and `src/review/wiring.ts` import from `@hrp-engagement/integration-api/{orchestrator,gateway,review}` as a true shared package. Integration-api ships its own `.d.ts` (no ambient shim). Imports are inert (no server bootstrap). CORE/1.7 review wiring kept (Auditor ✔). | `src/orchestrator-wire.ts`; `src/review/wiring.ts`; `package.json` `file:../integration-api`; security test `R4: unresolved review wiring uses CORE/1.7 review store (in-process)` ✔ |
| Env correction | Replaced `HRP_PANEL_MOCK_MODE=on` with `HRP_MOCK_MODE=deterministic` in `src/server.ts`, `src/ui/mock-api.ts`, `tests/security-evidence.mjs`, `tests/manual-dnc.mjs`, `docs/contracts/handoff-core-1.9.status.md`, `README.md`. | grep clean |

---

## 9. B-blockers (verified kept — regression intact)

| Blocker | Status | Evidence |
|---------|:------:|----------|
| **B1** Confirmation binding | KEPT | 8 B1 sub-tests ✔ |
| **B2** Mock boundary | KEPT | B2 ✔ |
| **B3** Authorization | KEPT | 10 B3 sub-tests ✔ |
| **B4** Replay/resume | KEPT | 2 B4 tests ✔ |
| **B5** Manifest integrity | KEPT | B5 ✔; --verify ✔; --check ✔ |
| **R4** Unresolved review wiring | KEPT | 1 R4 test ✔ |

---

**POST-FIX — READY FOR AUDITOR RECHECK**
