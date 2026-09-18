# CORE/1.11 — Routing config UI & simulator — Status

**Date:** 2026-09-17
**Verdict:** READY FOR OWNER REVIEW
**Independent Auditor:** PENDING (Owner reviews after delta applied)

## Summary

CORE/1.11 implements routing config UI + simulator inside the existing
`context-panel` application. It reuses the React AppShell + Alt+1/2/3/4
keyboard navigation. The Routing tab exposes batch/realtime simulation
over two PROPOSED algorithms (largest remainder, smooth WRR) per
Master V2.6 §10.2.3.

## Bundle

- `apps/context-panel/src/routing/` (4 NEW files: types, simulator,
  config-store, service)
- `apps/context-panel/src/ui/components/routing-panel.tsx` (NEW)
- `apps/context-panel/src/server.ts` (SHARED — added routing routes)
- `apps/context-panel/src/ui/app.tsx` (SHARED — added routing tab)
- `apps/context-panel/tests/routing-*.test.mjs` (3 NEW)
- `apps/context-panel/tests/routing-browser-evidence.mjs` (NEW)
- `apps/context-panel/scripts/generate-manifest-1.11.mjs` (NEW)
- `docs/contracts/handoff-core-1.11.md` (NEW)
- `docs/contracts/handoff-core-1.11.manifest.txt` (NEW — 14 entries)

## Test counts

| Suite | Top-level | Pass |
|---|---:|---:|
| server.test.mjs | 11 | 11/11 |
| panel-ui.test.mjs | 21 | 21/21 |
| manifest-readonly.test.mjs | 4 | 4/4 |
| manifest-readonly-1.11.test.mjs | 4 | 4/4 |
| routing-simulator.test.mjs | 23 | 23/23 |
| routing-api.test.mjs | 14 | 14/14 |
| **Total** | **77** | **77/77** |

Evidence scripts (separate, runs against live server + browser):

| Script | Checks | Pass |
|---|---:|---:|
| security-evidence.mjs (CORE/1.9) | 23 | 23/23 |
| browser-evidence.mjs (CORE/1.9) | 27 | 27/27 |
| routing-browser-evidence.mjs (CORE/1.11) | 13 | 13/13 |

Contracts regression (gate-0 contracts unchanged):

| Suite | Count | Pass |
|---|---:|---:|
| `packages/contracts/tests/*.test.mjs` | 398 | 398/398 |

## AC coverage

- **AC1** (source vs weighted distribution + 3:2:1:4 ratio):
  - BATCH (largest remainder) → EXACT 30:20:10:40 ✔ (1 test)
  - BATCH 10 customers → EXACT 3:2:1:4 ✔ (1 test)
  - BATCH deterministic ✔ (1 test)
  - REALTIME (smooth WRR) → 30:20:10:40 ±2 ✔ (1 test)
  - REALTIME deterministic ✔ (1 test)
  - BATCH and REALTIME match when N divisible by totalWeight ✔ (1 test)
- **AC2** (offline/capacity/quota eligibility, fallback, config revision,
  no catch-up burst):
  - 8 scenario tests covering all eligibility filters ✔
  - VERSION_CONFLICT on stale ✔
  - chained offline→online test (no catch-up burst) ✔
  - Sum invariant: assigned + fallback = customerCount ✔
- **AC3** (UI preview 10/100, no Chatwoot API, no Handling/credit):
  - API endpoint tests ✔ (3 ✔ in routing-api.test.mjs)
  - Browser: 10/100 customers preview ✔ (2 ✔ in routing-browser-evidence)
- **AC4** (manager-only config edit):
  - Service-layer `requireManagerRole` ✔ (5 ✔ in routing-simulator.test.mjs)
  - HTTP boundary: PUT/POST by sale/talent-reviewer → 403 ✔ (3 ✔ in routing-api.test.mjs)
  - Browser: server-side block + UI hint + side-effect check ✔ (3 ✔ in routing-browser-evidence)

## Browser evidence

`tests/evidence/routing-{01..07}-*.png` (7 PNG screenshots):
- routing-01-tab-loaded.png (Alt+4 routing tab)
- routing-02-batch-10-config.png (Batch mode + 10 customers selected)
- routing-03-batch-10-result.png (Batch 10/10 result + algorithm label)
- routing-04-realtime-100-result.png (Realtime 100/100 result + smooth WRR label)
- routing-05-sale-no-permission.png (Sale sees "no permission" hint)
- routing-06-narrow-panel.png (Narrow panel <480px — no per-staff distribution)
- routing-07-wide-panel.png (Wide panel ≥480px — per-staff distribution)

`tests/evidence/routing-summary.json` — pass/fail summary (13/13).

## Manifest

Two separate manifests (CORE/1.9 + CORE/1.11):

| Manifest | Entries | Verify | Check |
|---|---:|---|---|
| `handoff-core-1.9.manifest.txt` | 39 | ✔ | ✔ |
| `handoff-core-1.11.manifest.txt` | 14 | ✔ | ✔ |

CORE/1.9 manifest covers the post-delta bundle (server.ts, app.tsx
modified). CORE/1.11 manifest covers the CORE/1.11 delta explicitly.

## Limitations (per task scope)

- **Mock-only** — no real Chatwoot, no real HRP runtime, no persistence.
- **Both algorithms PROPOSED** per Master V2.6 §10.2.3 — runtime gate
  decides between batch (largest remainder) and realtime (smooth WRR).
  HYBRID not implemented.
- **In-memory state** — pool store and staff fixtures reset on restart.
- **No catch-up burst logic** — per-customer simulation only; production
  recovery semantics undefined (G-08 UNKNOWN).
- **Quota period reset** — fixture uses fixed daily period; production
  timezone-aware reset is Owner decision.

## Risks

- **Algorithm choice PROPOSED** — runtime gate may pick different.
  CORE/1.11 ships both so verification can prove behavior under either.
- **HRP gate integration** — currently the simulator's assignments are
  synthetic. Production runtime needs to call HRP gate for real
  assignment with reservation/counter.
- **Identity / role mapping** — reuses CORE/1.7 mock identity; production
  needs real permission mapping per Server §10.2.

## Decision register (NEW for CORE/1.11)

| ID | Topic | Status | Note |
|---|---|---|---|
| Q-34 | HYBRID strategy policy | PROPOSED | Not implemented; runtime gate decides |
| G-08 | Catch-up burst semantics | UNKNOWN | Mock does NOT retro-fill |
| R-NEW | Algorithm selection (batch vs realtime) | PROPOSED | Owner chốt in V7.9c |
| R-NEW | Tie-break semantics for stable sort | DECIDED | actorId ascending |
| R-NEW | Quota period reset cadence | PROPOSED | Daily at HCM midnight |

## What is NOT changed (per scope)

- Frozen contracts unchanged.
- CORE/1.10 (media/secret/storage) not touched.
- No CORE/1.12+ work.
- No Docker/deploy/provider integration.
- No commit/push/merge.
