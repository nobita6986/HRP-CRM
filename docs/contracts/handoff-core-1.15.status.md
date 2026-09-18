# CORE/1.15 - V7.9a Acceptance - Status (Phase Close)

**Phase**: CORE/1.15 - Final V7.9a Acceptance & Handoff
**Status**: **READY FOR OWNER ACCEPT - V7.9a CLOSED**
**Accept date**: 2026-09-18
**Acceptance authority**: Owner ACCEPT per Independent Auditor Round 3 PASS
**Baseline**: CORE/1.14 CLOSED - Auditor PASS

> **Final V7.9a audit snapshot (immutable - DO NOT mutate after accept):**
> - Manifest SHA-256 of file: `B9217F9201DCABA0CE85E43E15D449F899FBDD14F0BD7CEF7E18A259D11EEE8A`
> - Manifest bundle hash: `3BFF88A67EA22CFAD6C2DFB1F5583EC94AC736B976CE3592B4AD5D17E2FC9F72`
> - Manifest: `docs/contracts/handoff-core-1.15.manifest.txt`
> - Handoff doc: `docs/contracts/handoff-core-1.15.md`
> - Acceptance harness: `apps/integration-api/tests/acceptance-1.15-demo.mjs`

> Snapshot **frozen at auditor Round 3 acceptance**. Any post-accept change must
> be done in a follow-up CORE phase (V7.9b-f or later) with its own manifest.

---

## 1. Auditor Verdict

**Round 3 verdict**: `CONDITIONAL PASS / CẦN SỬA 4 FILE .SH TRƯỚC KHI MERGE`
**Round 3 follow-up applied**: 4 bash files re-encoded UTF-8 (no BOM, 0 null bytes).
**Owner ACCEPT**: V7.9a closed.

The auditor (Round 3) confirmed:
- Blocker 1 (Acceptance Harness): **FIXED & VERIFIED** - 15/15 PASS in 11.35s.
- Blocker 2 (Encoding): **PARTIAL then FIXED in follow-up** - all 17 files now clean UTF-8.
- Blocker 3 (Manifest Read-Only modes): **FIXED & VERIFIED** - `--verify` and `--check`
  return exit 0, do not mutate manifest.
- System test suite: **843/843 PASS (100%)** in the auditors matrix.

Per Owner instruction, the **audited snapshot is frozen**. No manifest regeneration,
no source mutation, no manifest hash update after this point.

---

## 2. Test Suite Acceptance Matrix (Auditor Verified)

| Suite | Path | Tests | Pass | Fail | Time |
|---|---|---:|---:|---:|---:|
| Core Contracts | `packages/contracts` | 398 | 398 | 0 | 0.72s |
| UI Context Panel | `apps/context-panel` | 310 | 310 | 0 | 2.28s |
| Orchestrator Unit | `apps/integration-api/tests/orchestrator.test.mjs` | 42 | 42 | 0 | 0.15s |
| Retry & Backoff | `apps/integration-api/tests/retry.test.mjs` | 42 | 42 | 0 | 8.33s |
| Transactional Outbox (PG) | `apps/integration-api/tests/outbox.test.mjs` | 12 | 12 | 0 | 30.11s |
| Orchestrator PG-E2E | `apps/integration-api/tests/orchestrator.pg-e2e.test.mjs` | 6 | 6 | 0 | 13.78s |
| Receiver Integration (PG) | `apps/integration-api/tests/receiver.int.test.mjs` | 18 | 18 | 0 | 15.42s |
| **CORE/1.15 Acceptance Demo** | `apps/integration-api/tests/acceptance-1.15-demo.mjs` | **15** | **15** | **0** | **11.35s** |
| **TOTAL** | - | **843** | **843** | **0** | ~82s |

### CORE/1.15 Acceptance Demo - A01..A15 Evidence

| ID | Scenario | Evidence |
|---|---|---|
| A01 | Concurrent duplicate events -> idempotent dedupe | 2x 202, second `created=false`, 1 PG row |
| A02 | Config validates DATABASE_URL; invalid URL -> VALIDATION_ERROR | 4 invalid URLs all rejected |
| A03 | Receipt persisted after webhook accepted | 1 PG row in `integration.ExternalEventReceipt` |
| A04 | Mock gateway endpoint accessible | `/mock/gateway` -> 200 |
| A05 | Same eventId different payload -> 409 | `idempotency_conflict` code |
| A06 | POSSIBLE_MATCH -> REVIEW_PENDING; stale review guard | orchestrator -> `OrchestratorError` on stale |
| A07 | CASE fail -> PARTIAL; resume skips applied steps | `failedStep=CASE`, resume -> `COMPLETED` |
| A08 | Preview does NOT mutate - confirm required for write | gateway `createOrMatchLaborProfile` not called |
| A09 | AVAILABILITY applied after CASE - full pipeline | `appliedSteps.includes("AVAILABILITY")` |
| A10 | DNC action independent of intake | 0 DNC intake checkpoints |
| A11 | Cross-org connection not registered -> 4xx | `unknown_connection` |
| A12 | Spoofed body attributes ignored - URL scope used | receipt.org = URL scope, not body |
| A13 | Review list accessible; nonexistent entry -> non-200 | 200/404 on real vs nonexistent |
| A14 | Webhook accepted with gateway offline; receipt survives | receipt persisted despite HRP_MOCK_MODE |
| A15 | Worker recovery, reconciler, DLQ routes accessible | all 3 mock routes -> 200 |

---

## 3. Scope of Acceptance - What PASSED

CORE/1.15 V7.9a delivers the **Integration Core (CORE/1.0 -> CORE/1.15) for Mock/HRP-replica**:

- **Webhook receiver** (CORE/1.2): HMAC verification, rate limit, dedupe, idempotency, payload digest 409.
- **Orchestrator** (CORE/1.6-1.7): full step pipeline CONFIRM_VALIDATE -> IDENTITY -> PROFILE -> CASE -> AVAILABILITY, with POSSIBLE_MATCH branching, partial failure recovery, resume.
- **Outbox / DLQ / Reconciler** (CORE/1.8): lease fencing, retry classes, recovery actions, reconciliation entry log.
- **Worker** (CORE/1.5): pipeline executor -> Mock HRP gateway -> delivery confirmation.
- **Review service** (CORE/1.7): POSSIBLE_MATCH queue with optimistic concurrency + version guard.
- **DNC / Suppression** (CORE/1.6): independent path from intake, idempotent commit.
- **Cross-org boundary** (CORE/1.1-1.2): URL scope canonical; spoofed body attributes ignored.
- **Contracts frozen** (CORE/1.0-1.10): 398/398 contract tests pass.

All of the above runs against:
- **Embedded PostgreSQL 17.6** (real schema, real migrations, real constraints).
- **Mock HRP Gateway** (deterministic scenarios EXACT_MATCH / POSSIBLE_MATCH / POLICY_REJECTION).
- **Synthetic fixtures** (no real Chatwoot/Zalo, no real CCCD, no real HRP DB).

---

## 4. Out-of-Scope (NOT Verified - Explicit Limits)

The following **were NOT verified** in V7.9a and remain **HRP-owned** for follow-up phases:

### 4.1. Real provider integration
- **Real Chatwoot webhook** signature verification (HMAC-SHA256 live): deferred to **V7.9b**.
- **Real Zalo OA** webhook signature verification: deferred to **V7.9b**.
- **Real provider routing rules**: deferred to **V7.9b**.

### 4.2. Real HRP production integrations
- Real HRP DB integration tests (canonical production schema): deferred to **V7.9b**.
- HRP real placement case open/update/close: deferred to **V7.9b**.
- HRP real availability update: deferred to **V7.9b**.
- HRP real DNC commit: deferred to **V7.9b**.

### 4.3. AI production (BoD - Board-of-Directors grade)
- AI provider real key + network probe: deferred to **V7.10-AI-BoD**.
- Production-scale load (100+ concurrent events): not benchmarked in V7.9a.

### 4.4. Beneficiary / Referral
- Beneficiary/Referral schema activation: deferred to **V7.9c** (post-residency review).
- CCCD scan integration: deferred to **V7.9c** (after residency review).

### 4.5. Operational durability
- EFFECTIVE/Worker mutations durability: deferred to **V7.9c**.
- Kill-switch durable persistence (CORE/1.14 limitation carried over): deferred to **V7.9b**.
- Notification scheduler production: deferred to **V7.9b**.

### 4.6. Cross-platform execution verification
- V7.9a tests executed on **Windows + PowerShell** only.
- UTF-8 clean is **necessary** for cross-platform but **not sufficient evidence** that
  scripts run correctly on Linux/macOS. Bash syntax/behavior on POSIX sh was **NOT**
  independently re-verified by the V7.9a auditor. Cross-platform verification remains
  a follow-up HRP-owned item.

---

## 5. Dependencies and Constraints for Follow-up

- **No real provider keys** (Chatwoot/Zalo) were used or stored in V7.9a.
- **No real HRP credentials** were used or stored.
- **No real CCCD data** was used.
- All `.env.synthetic.example` files remain the only credential templates.
- **Embedded PostgreSQL** data dirs (`.tmp_pgdata_*`) are local-only, not committed.
- **Manifest is content-addressed**: any post-V7.9a change to a tracked file invalidates
  the bundle hash and must trigger a new CORE phase.
- **No HRP-owned item was implemented**: Q-25..Q-37 in the handoff doc remain HRP-owned.

---

## 6. Git Read-Only Status (as of accept)

**Branch**: `main`
**HEAD commit**: `414c54b docs: record HRP connector v1.1 integration contracts`
**Remote**: `origin https://github.com/nobita6986/HRP-CRM.git` (fetch + push)

**Tracked status**: HEAD contains only the README/seed commit; all V7.9a content
(`apps/`, `packages/`, `scripts/`, `docs/contracts/`, `docs/Importal/`,
`docs/reviews/`, `.gitignore`) is **untracked**.

**Untracked directories**:
- `apps/` (~420 MB, contains `node_modules/` for context-panel, integration-api, integration-worker, core-1.10-media)
- `packages/` (~409 MB, contains `node_modules/` for config, contracts, integration-store)
- `scripts/` (~60 KB, 11 files - V7.9a runbook scripts)
- `docs/contracts/` (~1.2 MB, includes handoff-core-1.15.md + .manifest.txt + 30+ CORE/1.x handoffs)
- `docs/Importal/` (5 planning docs)
- `docs/reviews/` (3 audit reviews)
- `.gitignore` (32 bytes: `node_modules/`, `dist/`, `.npm-cache/`)

**No merge conflicts** because no other branches exist locally or remotely.
**No commit has been made** for V7.9a - accept was logged at the docs level only.

---

## 7. Recommended Commit Scope (Suggested, NOT executed)

For Owner to consider when ready to commit V7.9a snapshot:

### 7.1. Should be committed (audit-PASS V7.9a core)
```
.gitignore                                    (must be tracked first)
docs/contracts/handoff-core-1.15.md           (handoff)
docs/contracts/handoff-core-1.15.manifest.txt (manifest, immutable post-accept)
docs/contracts/handoff-core-1.15.status.md    (this file)
apps/integration-api/tests/acceptance-1.15-demo.mjs  (acceptance harness)
apps/integration-api/dist/...                (BUILT OUTPUT - see 7.3)
apps/integration-worker/dist/...              (BUILT OUTPUT - see 7.3)
packages/config/dist/...                      (BUILT OUTPUT - see 7.3)
packages/contracts/dist/...                   (BUILT OUTPUT - see 7.3)
packages/integration-store/dist/...           (BUILT OUTPUT - see 7.3)
scripts/v7.9a/install.ps1 + .sh
scripts/v7.9a/start.ps1 + .sh
scripts/v7.9a/stop.ps1 + .sh
scripts/v7.9a/seed.mjs
scripts/v7.9a/test-integration.ps1 + .sh
scripts/v7.9a/generate-manifest-1.15.mjs
apps/integration-api/src/...                  (all source)
apps/integration-worker/src/...               (all source)
apps/context-panel/src/...                    (all source - UI panel code)
apps/core-1.10-media/...                     (all source - CORE/1.10 media handler)
packages/config/src/...                       (config package source)
packages/contracts/src/...                    (contracts package source)
packages/integration-store/src/...            (integration-store package source)
packages/integration-store/prisma/...         (schema + migrations)
docs/contracts/...                            (all prior handoffs that exist on disk)
docs/Importal/...                             (planning docs)
docs/reviews/...                              (audit reviews)
```

### 7.2. MUST be excluded by .gitignore (currently only excludes `node_modules/`, `dist/`, `.npm-cache/`)
- `node_modules/` (~820 MB across apps + packages) - already excluded
- `dist/` (build output) - currently excluded
- `.npm-cache/` - currently excluded
- `.tmp_pgdata_*` (embedded PG data dirs) - NEEDS new rule
- `.codegraph/` (Cursor cache) - NEEDS new rule
- `.vscode/` (IDE workspace settings) - NEEDS new rule (or per-developer)

### 7.3. Build outputs (`dist/`) - Owner decision required
Two options for `dist/`:
- **Option A (recommended for V7.9a snapshot)**: commit pre-built `dist/` for the
  5 buildable packages so that `node --test` works immediately after clone.
- **Option B**: exclude `dist/` (rebuild via `npm run build` in CI or post-clone).

For an audit-pass snapshot, **Option A** is preferred because it lets independent
auditors reproduce the harness without local build infrastructure.

### 7.4. Items that should NOT be committed
- `*.log`, `.env` (real secrets), `.env.local`
- `.tmp_pgdata_*` directories
- `coverage/` (if any test runners produce it)
- Embedded PostgreSQL data (already in `.tmp_pgdata_*` and excluded above)

---

## 8. Close Verdict

**CORE/1.15 - V7.9a Acceptance: CLOSED by Owner ACCEPT.**

- 843/843 tests in audit matrix PASS.
- A01..A15 acceptance demo PASS on Embedded PostgreSQL 17.6 + Mock Gateway.
- Manifest frozen at bundle hash `3BFF88A67EA22CFAD6C2DFB1F5583EC94AC736B976CE3592B4AD5D17E2FC9F72`.
- All V7.9a items are Integration Core/Mock-grade. Real-provider/HRP/AI items remain
  HRP-owned (V7.9b-V7.10).
- Cross-platform script execution (POSIX bash) was **not** independently re-verified
  by V7.9a auditor; UTF-8 encoding is necessary but not sufficient evidence.
- No commits, no merges, no deploys have been performed.

**Hand-off to next phase**: Owner to decide whether to commit the V7.9a snapshot
under the recommended scope (section 7) and whether to open V7.9b for HRP-owned items.

---

*This status file is the immutable record of V7.9a closure. Any further CORE work
must use a new manifest and a new status file.*