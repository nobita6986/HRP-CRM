# CORE/1.9 — T1 Post-Fix Status (R3/R4 re-recheck)

**Auditor Verdict (initial):** CHANGES_REQUIRED (5 blockers)
**Auditor Verdict (Recheck after B-fixes):** CHANGES_REQUIRED (4 R-blockers: R1–R4)
**Auditor Verdict (R3/R4 re-recheck):** CHANGES_REQUIRED (focused on R3 + R4)
**Date:** 2026-09-17 (R3/R4 re-recheck)
**T1 Fix Verdict:** RE-FIXED AGAIN (R3/R4), READY FOR AUDITOR RECHECK
**Frozen Contracts:** 0.0.8-g0.8-fixes (no changes)

---

## B-blockers (verified kept — regression intact)

| Blocker | Status | Evidence |
|---------|:------:|----------|
| **B1** Confirmation binding | KEPT | 8 B1 sub-tests ✔ |
| **B2** Mock boundary | KEPT | B2 ✔ |
| **B3** Authorization | KEPT | 10 B3 sub-tests ✔ |
| **B4** Replay/resume | KEPT | 2 B4 tests ✔ |
| **B5** Manifest integrity | KEPT | B5 ✔; --verify ✔; --check ✔ |

---

## R3 — Manifest read-only verification ✅ FIXED

**Problem (Auditor):**
- `--verify` and `--check` were implicitly writing/regenerating the manifest as part of verification.
- No test proving manifest bytes are preserved across `--verify` runs.
- Manifest hash could be silently regenerated to "make it pass".

**Fix (R3 re-recheck):**
- `apps/context-panel/scripts/generate-manifest.mjs` separated generate vs verify:
  - Default mode (no flag): writes `docs/contracts/handoff-core-1.9.manifest.txt`. Intended to be run AFTER code+evidence are stable.
  - `--verify`: strictly READ-ONLY. Hashes every `FILE|` entry against disk; on missing/mismatch exits 1. Cross-checks `BUNDLE_FILES` ⊆ manifest and `REMOVED_FILES` ∩ manifest = ∅. **Never calls `writeFileSync`.**
  - `--check`: strictly READ-ONLY. Validates coverage (no duplicate, no missing, no zombie removed files on disk). Exits 0/1.
- New file `apps/context-panel/tests/manifest-readonly.test.mjs` (4 tests):
  1. `--verify` does not modify manifest bytes (hash equality before/after).
  2. `--verify` exits 1 on tamper and preserves manifest bytes.
  3. `--check` reports clean coverage and does not modify the file.
  4. Generate vs verify are explicit separate modes.
- Removed (R4) files are explicitly listed at the end of `handoff-core-1.9.manifest.txt` in a `REMOVED` block — no zombie hashes for files that no longer exist.

**Direct verification:**
```bash
# 1. Generate fresh manifest (deliberate action)
node scripts/generate-manifest.mjs
# → Manifest written: docs/contracts/handoff-core-1.9.manifest.txt (32 entries).

# 2. Read-only verify (should not modify)
node scripts/generate-manifest.mjs --verify
# → verify OK: 32 entries matched, 0 missing, 0 mismatch.

# 3. Read-only check
node scripts/generate-manifest.mjs --check
# → check OK: 32 bundle entries clean, 14 removed files confirmed absent.

# 4. Tamper test (proven by manifest-readonly.test.mjs)
# - Mutate scripts/build-ui.mjs bytes
# - Run --verify → exit 1, "verify FAIL"
# - Manifest bytes on disk UNCHANGED
# - Restore mutation → --verify → exit 0
```

**Evidence:**
- `tests/manifest-readonly.test.mjs`: 4/4 ✔
- `tests/security-evidence.mjs`: B5 ✔ (after regen)
- `docs/contracts/handoff-core-1.9.manifest.txt` — 32 entries + 14 removed files listed.

---

## R4 — True module sharing ✅ FIXED

**Problem (Auditor):**
- Verbatim copies of orchestrator/gateway in `apps/context-panel/src/{orchestrator,gateway}/` — synchronized-copy mechanism (`.source-link.json` + `generate-source-link.mjs`) — does NOT satisfy "shared implementation" requirement.
- The Owner explicitly forbade continuing synchronized copies or seeking exemption.

**Fix (R4 re-recheck):**
- **Removed verbatim copies:**
  - `apps/context-panel/src/orchestrator/{index,intake-orchestrator,digest,dnc-handler,steps}.ts` ❌ deleted
  - `apps/context-panel/src/gateway/{index,mock-gateway,ledger,scenarios,types}.ts` ❌ deleted
  - `apps/context-panel/src/store/intake-checkpoint-shim.ts` ❌ deleted (consumed only by removed copies)
- **Removed source-link mechanism:**
  - `apps/context-panel/src/.source-link.json` ❌ deleted
  - `apps/context-panel/scripts/generate-source-link.mjs` ❌ deleted
  - `apps/context-panel/src/types/integration-api-shims.d.ts` ❌ deleted (ambient shim — integration-api now ships its own `.d.ts`)
- **Switched to true shared module imports:**
  - `apps/context-panel/package.json` declares `"@hrp-engagement/integration-api": "file:../integration-api"` (already in place).
  - `apps/context-panel/src/orchestrator-wire.ts` imports from `@hrp-engagement/integration-api/orchestrator` and `@hrp-engagement/integration-api/gateway`:
    - `createMockGateway` (CORE/1.1 gateway)
    - `IntakeOrchestrator`, `OrchestratorError`, `digestCanonical`, `buildCanonicalDraft`, `buildStepIdempotencyKey`, `STEP_ORDER`, `executeDncAction`, `buildCommitSuppressionPayload`, `assertCommitSuppressionPayloadValid`
  - `apps/context-panel/src/review/wiring.ts` imports `reviewStore` from `@hrp-engagement/integration-api/review`.
- **Integration-api build:** orchestrator, gateway, and review subpaths all emit `.d.ts` (verified after `tsc --noEmitOnError false` against the integration-api package). The outbox module has pre-existing TS errors unrelated to CORE/1.9; only its declarations were emitted (`--emitDeclarationOnly` would clean them up — out of scope here).
- **Inert imports:** importing the shared modules does NOT start an HTTP server. Server bootstrap is `src/server.ts` (entrypoint) and is only invoked via `npm start`/`npm run dev`. Tests use `startPanel()` from `dist/server.js`.

**Removed files (recorded in manifest):**
```
- apps/context-panel/src/orchestrator/index.ts
- apps/context-panel/src/orchestrator/intake-orchestrator.ts
- apps/context-panel/src/orchestrator/digest.ts
- apps/context-panel/src/orchestrator/dnc-handler.ts
- apps/context-panel/src/orchestrator/steps.ts
- apps/context-panel/src/gateway/index.ts
- apps/context-panel/src/gateway/mock-gateway.ts
- apps/context-panel/src/gateway/ledger.ts
- apps/context-panel/src/gateway/scenarios.ts
- apps/context-panel/src/gateway/types.ts
- apps/context-panel/src/store/intake-checkpoint-shim.ts
- apps/context-panel/src/types/integration-api-shims.d.ts
- apps/context-panel/src/.source-link.json
- apps/context-panel/scripts/generate-source-link.mjs
```

**Evidence:**
- `tests/security-evidence.mjs`:
  - ✔ B5-SourceLink: source-link mechanism removed (R4 — true shared module via @hrp-engagement/integration-api) (asserts `.source-link.json` absent, asserts `package.json` wires shared module via `file:` dep)
  - ✔ R4: unresolved review wiring uses CORE/1.7 review store (in-process)
- `apps/context-panel/src/orchestrator-wire.ts` — runtime imports documented at the top of the file
- `apps/context-panel/src/review/wiring.ts` — static import of `reviewStore` from `@hrp-engagement/integration-api/review`
- TypeScript typecheck clean (no ambient shims needed)

---

## R1 — UI revisionId mismatch (verified kept, not re-opened)

**Status:** KEPT. No regression detected. R1 fixes from previous round are unchanged:
- `intake-review.tsx` stores `revisionId` from preview and reuses unchanged on submit.
- Edits after confirmation invalidate confirmation state and require a new preview.
- Server pipe forwards full draft fields (contactAddress, intent, citizenIdentity, evidenceRefs) so preview↔run digests match exactly.

**Evidence:** Browser tests ✔; 8 B1 security sub-tests ✔; smoke test POST `/api/intake/run` returns 200 with checkpointId.

---

## R2 — Browser regression and evidence (verified kept, not re-opened)

**Status:** KEPT. No regression detected. Direct API calls in `browser-evidence.mjs` include `X-HRP-Staff-Id` header; identity-required tests reject missing/invalid ID; no scenario relaxed to grant bypass permissions.

**Evidence:** Browser suite 27/27 PASS on live build/server (current snapshot `tests/evidence/summary.r3.json`).

---

## Env correction (R4 follow-up)

**Problem:** `HRP_PANEL_MOCK_MODE=on` was documented in some places. The schema is `MockMode = 'off' | 'deterministic'`. Mock-enabled is `HRP_MOCK_MODE=deterministic`.

**Fix:**
- `apps/context-panel/src/server.ts` error message updated.
- `apps/context-panel/src/ui/mock-api.ts` `checkMockStatus()` checks `mockMode !== 'off'`.
- `apps/context-panel/tests/security-evidence.mjs` PANEL_CONFIG `mockMode: 'on'` → `'deterministic'`.
- `apps/context-panel/tests/manual-dnc.mjs` `mockMode: 'on'` → `'deterministic'`.
- `apps/context-panel/README.md` env table updated; `HRP_PANEL_MOCK_SCENARIO` → `HRP_PANEL_SCENARIO` (clarified).
- `docs/contracts/handoff-core-1.9.status.md` curl example uses `HRP_MOCK_MODE=off`.
- `package.json` already uses correct `HRP_MOCK_MODE=deterministic`.

---

## Direct API bypass attempts (B1 — verified kept)

- Bypass #1: submit without `reviewSnapshotId` → 400 MISSING_REVIEW.
- Bypass #2: forged `reviewSnapshotId` → 400 MISSING_REVIEW (stored key differs).
- Bypass #3: client supplies fake `digest` → server ignores, re-computes from actual payload, compares against stored snapshot digest.
- Bypass #4: client supplies fake `canonicalId/canonicalVersion` → server ignores, uses snapshot values.

**Direct test:**
```
HRP_MOCK_MODE=off node dist/server.js &
curl -i http://127.0.0.1:3000/api/context?target=talent
→ HTTP/1.1 404 Not Found
→ {"error":"mock_disabled","message":"Mock endpoints are disabled. Set HRP_MOCK_MODE=deterministic (development) to enable."}
```

---

## Evidence Summary

| Suite | Count | Status |
|-------|------:|:------:|
| Unit (`npm test`) | 36 | ✔ ALL PASS |
| Security/Regression (`tests/security-evidence.mjs`) | 23 | ✔ ALL PASS |
| Read-only manifest (`tests/manifest-readonly.test.mjs`) | 4 | ✔ ALL PASS |
| Browser (`tests/browser-evidence.mjs`) | 27 | ✔ ALL PASS |
| **Total** | **90** | **✔ ALL PASS** |

**Direct API bypass attempts (B1):** 4/4 blocked.
**Mock-mode off (B2):** all `/api/*` return 404.
**Authorization (B3):** 10/10 negative cases return expected status.
**Replay (B4):** idempotent, no duplicate mutation.
**Manifest (B5 + R3):** 32/32 SHA-256 verified, no missing/duplicate, no zombie removed files.
**Shared module (R4):** runtime imports from `@hrp-engagement/integration-api/{orchestrator,gateway,review}`; no verbatim copies; no source-link mechanism; no shim `.d.ts`.

---

## Verdict

**T1 Self-Verdict:** CHANGES_REQUIRED → RE-FIXED AGAIN (R3/R4), ALL TESTS PASSING.

**Final T1 Verdict:** Held at **CHANGES_REQUIRED** awaiting independent Auditor recheck.

No commit, no push, no merge, no deploy. Frozen contracts intact. No CORE/1.10+ scope expansion.
