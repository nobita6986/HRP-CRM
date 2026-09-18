# CORE/1.11 — Routing config UI và simulator

**Status:** READY FOR OWNER REVIEW (mock-only slice)
**Date:** 2026-09-17
**Dependency:** Gate 0.5 (routing.ts), 1.0 (scaffold), 1.3 (persistence)
**Scope:** Backlog §Task 1.11

---

## 1. AC Coverage

### AC1: Phân biệt source assignment vs weighted distribution + simulation 3:2:1:4

**Implementation:**
- `src/routing/types.ts` — `makeWeightedFixturePool` (3:2:1:4 ratio) +
  `makeSourceAllocationFixturePool` (1 fixed owner per source).
- `src/routing/simulator.ts` — TWO algorithms (per Master V2.6 §10.2.3
  PROPOSED):
  - **BATCH** (largest remainder / Hamilton) — `quota_i = N × weight_i / totalWeight`
    with floor + fractional remainder distributed by largest fractions.
    Deterministic; no PRNG.
  - **REALTIME** (smooth weighted round-robin / Nginx) — accumulator-based
    streaming algorithm. Deterministic given stable tie-break order.
- `tests/routing-simulator.test.mjs` covers:
  - SOURCE_ALLOCATION: 50 customers all → fixed owner (1 ✔)
  - BATCH 100 customers: EXACT 30:20:10:40 (largest remainder) (1 ✔)
  - BATCH 10 customers: EXACT 3:2:1:4 (1 ✔)
  - BATCH deterministic across calls (1 ✔)
  - REALTIME 100 customers: 30:20:10:40 (±2 per slot) (1 ✔)
  - REALTIME deterministic across calls (1 ✔)
  - BATCH and REALTIME match when N is divisible by totalWeight (1 ✔)

**Expected distribution for 3:2:1:4 (total weight 10):**

| N | A=30% | B=20% | C=10% | D=40% |
|---:|---:|---:|---:|---:|
| 10 | 3 | 2 | 1 | 4 |
| 100 | 30 | 20 | 10 | 40 |
| 1000 | 300 | 200 | 100 | 400 |

**Measurement method:**
- For batch mode, ratio is EXACT (largest remainder guarantee).
- For realtime mode, ratio is within ±2 per slot for N=100 due to
  tie-break semantics; approaches exact as N→∞.
- Sum invariant: `assigned + fallback = customerCount` always holds.
- Capacity/quota constraints reduce the assignable count; reduced N
  applies largest remainder over remaining eligible staff.

**No business rule replacement:**
- Master V2.6 §10.2.3 names these as PROPOSED algorithms needing
  benchmark/simulation. CORE/1.11 implements both as MOCK proposals.
- Production runtime gate will pick one (or hybrid) per Owner decision.
- HYBRID strategy (Q-34) NOT implemented; runtime gate decides.

### AC2: Offline/capacity/quota eligibility, fallback queue, config revision, no catch-up burst

**Implementation:**
- `simulator.ts` — eligibility filter: online=true, capacity not full,
  quota not exhausted. Staff who fail any filter → fallback queue.
- `config-store.ts` — `update()` enforces optimistic concurrency with
  `expectedVersion` check; VERSION_CONFLICT on stale.
- Fallback reasons enum: ALL_STAFF_OFFLINE / ALL_STAFF_AT_CAPACITY /
  ALL_STAFF_QUOTA_EXHAUSTED / WEIGHT_ZERO / NO_ELIGIBLE_WEIGHT.
- "No catch-up burst" invariant: simulator is per-customer with shared
  mutable fixture state; staff state changes between calls do NOT
  retroactively reassign earlier customers.

**Evidence (`tests/routing-simulator.test.mjs`):**
- Scenario: staff B offline → redistribute A,C,D (1 ✔)
- Scenario: staff A capacity full → A gets 0, B+C+D absorb (1 ✔)
- Scenario: staff C quota exhausted → C gets 0 (1 ✔)
- Scenario: all staff offline → fallback (50/50) with ALL_STAFF_OFFLINE (1 ✔)
- Scenario: zero weight → fallback (20/20) with WEIGHT_ZERO (1 ✔)
- config update increments version v1→v2 (1 ✔)
- config stale update throws VERSION_CONFLICT (1 ✔)
- chained offline→online in batch — no catch-up burst (1 ✔)
- staff coming online does NOT retro-fill earlier fallback (1 ✔)
- Sum invariant: `assigned + fallback = customerCount` always (8 ✔ via scenario tests)

### AC3: UI preview 10/100 khách; không gọi Chatwoot assignment API thật

**Implementation:**
- `src/ui/components/routing-panel.tsx` — React UI with pool selector,
  count selector (10/100), mode selector (batch/realtime), scenario
  selector (6 scenarios), preview button.
- `/api/routing/pools/:id/simulate` endpoint calls `simulate()` which
  uses in-memory fixture only — NO Chatwoot API calls.
- No Handling/credit mutation: simulator never mutates the staff state
  beyond synthetic `currentCapacity` increments in the local fixture.

**Evidence (`tests/routing-api.test.mjs`):**
- simulate endpoint returns 10/100 customer results (3 ✔)
- 404 on unknown pool (1 ✔)
- response schema includes `mode`, `assignments[]`, `fallbackQueue[]` (1 ✔)

**Browser evidence (`tests/routing-browser-evidence.mjs`):**
- Click preview 10 → button works in batch mode, summary shows 10/10 (1 ✔)
- Click preview 100 → button works in realtime mode, summary shows 100/100 (1 ✔)
- 7 screenshots saved as tests/evidence/routing-*.png

### AC4: AI/sale không tự sửa weights nếu thiếu manager capability

**Implementation:**
- `config-store.ts` `requireManagerRole(role)` — accepts only
  `SUPERVISOR` / `SYSTEM`. Throws `RoutingConfigError(MANAGER_REQUIRED)`.
- `service.ts` `updatePool()` and `createPool()` call `requireManagerRole`
  before any mutation.
- `/api/routing/pools PUT` and `POST` endpoints also call
  `requireManagerRole` server-side, returning HTTP 403 on non-manager.

**Evidence (server + browser):**
- `tests/routing-simulator.test.mjs`: 5 ✔ for manager-only enforcement
- `tests/routing-api.test.mjs`: PUT by INTAKE_OPERATOR → 403 ✔;
  PUT by TALENT_REVIEWER → 403 ✔; POST by INTAKE_OPERATOR → 403 ✔
- `tests/routing-browser-evidence.mjs`:
  - Sale edit blocked at server boundary (403 MANAGER_REQUIRED) ✔
  - Sale edit did NOT mutate description (verify side-effect) ✔
  - Sale sees "no permission" hint in Routing tab ✔
  - Manager does NOT see the hint ✔
  - Stale revision returns VERSION_CONFLICT 409 ✔
  - Manager edit increments version v1→v2 ✔

---

## 2. Architecture (REUSE existing modules)

Per task constraint "Tái sử dụng UI/runtime và contracts hiện có":

| Reuse | Where | Why |
|---|---|---|
| `@hrp-engagement/contracts/routing` | Gate 0.5 | RoutingPool/RoutingDecision/ROUTING_STRATEGIES/ROUTING_PATCH_FORBIDDEN schemas |
| `orchestrator-wire.ts` resolveMockIdentity | CORE/1.7 | Same X-HRP-Staff-Id → MockIdentity mapping (SUPERVISOR/SYSTEM/SALE/TALENT_REVIEWER) |
| `panel.config` loadConfig | CORE/1.0 | Same panel config loader |
| `app.tsx` shell | CORE/1.9 | Existing React app shell + panel width slider + keyboard nav (extended with Alt+4) |
| `dist/ui/index.html` | CORE/1.9 build-ui.mjs | Same build pipeline |

**No parallel implementation.** No demo HTML.

### Files added

```
apps/context-panel/src/routing/
  types.ts              # FixturePool, StaffState, AssignmentSlot, SimulationResult
  simulator.ts          # Weighted distribution + LCG PRNG (deterministic)
  config-store.ts       # In-memory store + requireManagerRole
  service.ts            # Service boundary with manager-only enforcement
apps/context-panel/src/ui/components/
  routing-panel.tsx     # 4th tab UI: pool selector, scenarios, results
apps/context-panel/tests/
  routing-simulator.test.mjs    # 19 unit tests
  routing-api.test.mjs          # 14 integration tests (boots real server)
```

### Files modified (additive, NOT replacing)

```
apps/context-panel/src/server.ts       # +4 routes (list/simulate/update/create)
apps/context-panel/src/ui/app.tsx      # +1 tab + Alt+4 keyboard + manager hint
apps/context-panel/scripts/generate-manifest.mjs  # +6 bundle entries
docs/contracts/handoff-core-1.9.manifest.txt      # regenerated (39 entries)
```

---

## 3. Simulation semantics

### Weighted distribution algorithm

Per customer (index 0..n-1):
1. Filter eligible staff: `online=true` AND `currentCapacity<maxCapacity` AND `periodAssignments<periodCap`.
2. If no eligible staff → fallback queue (reason = highest priority reason).
3. Else: weighted random pick using LCG PRNG seeded with `seed`.
   - Eligible staff = subset whose weight > 0 in `pool.weights`.
   - Cumulative weight = sum of weights; pick by `rng() * cumulative`.

### Determinism

- Same `seed` → identical assignment sequence (proven by 1 ✔ test).
- Different `seed` → different sequence (proven by 1 ✔ test).
- The 3:2:1:4 ratio is achieved **in expectation** over 100 customers:
  A=30±15, B=20±15, C=10±15, D=40±15. Smaller samples (n=10) may deviate.

### No catch-up burst invariant

The simulator is purely **per-customer**. If staff B was offline at
customer index 0 and comes online by customer index 5, the simulator
does NOT retroactively assign earlier customers to B. Each simulation
call is independent; cross-simulation retroactive assignment is NOT
implemented (and is not a production requirement per Master §10.2).

---

## 4. Server API

| Method | Path | Role required | Returns |
|---|---|---|---|
| GET | `/api/routing/pools` | Any authenticated | `{ pools: RoutingPool[] }` |
| POST | `/api/routing/pools` | SUPERVISOR / SYSTEM | `201 { pool }` / `403 MANAGER_REQUIRED` |
| PUT | `/api/routing/pools/:poolId` | SUPERVISOR / SYSTEM | `200 { pool }` / `403` / `409 VERSION_CONFLICT` / `404` |
| POST | `/api/routing/pools/:poolId/simulate?count=10\|100&scenario=...` | Any authenticated | `{ result: SimulationResult, pool }` |

Mock mode: all endpoints subject to `guardMockMode` (mockMode !== 'off').
No PII in requests/responses. No secret values in responses. No external
network calls.

---

## 5. UI behavior

### Routing tab (`Alt+4`)

- **Pool selector** — dropdown of seeded pools. If pool weights change,
  the selector reflects updated `version`.
- **Tỷ trọng hiện tại** — chips showing each staff + weight.
- **Số khách** — 10 or 100.
- **Chế độ** — Batch (largest remainder / Hamilton) or Realtime
  (smooth weighted round-robin / Nginx). Tooltip shows algorithm name.
- **Tình huống** — 6 scenarios (visual hint only; data driven server-side).
- **Mô phỏng** button (POST request).
- **Kết quả:**
  - Algorithm info bar (Vietnamese label + algorithm name)
  - Summary bar: assigned / total / fallback / weight / version
  - Phân bổ theo nhân viên (visual bars per staff)
  - Fallback queue (reason labels in Vietnamese + counts)
  - Per-customer detail (collapsible `<details>`)
- **Manager hint** — visible only when current staff is NOT supervisor.

### Keyboard navigation

- Alt+1 / Alt+2 / Alt+3 / Alt+4 cycles tabs (extended for routing).
- Tab key cycles focusable controls inside the routing panel.

### Narrow panel (< 480px)

- Per-staff distribution bars hidden in narrow mode (Test 10 ✔).
- Per-customer detail hidden in narrow mode.
- Pool selector + buttons remain functional.

### Browser evidence (real Chromium)

`tests/routing-browser-evidence.mjs` boots panel + Playwright Chromium
and exercises 13 checks against the live UI:

| # | Check | Status |
|---|---|:---:|
| 1 | Page loads, Alt+4 routing tab reachable | ✔ |
| 2 | Preview 10 customers (batch) → 10/10 + batch label | ✔ |
| 3 | Preview 100 customers (realtime) → 100/100 + smooth WRR label | ✔ |
| 4 | Manager edit increments version (v1→v2) | ✔ |
| 5 | Sale edit blocked at server (403 MANAGER_REQUIRED) | ✔ |
| 6 | Sale edit did NOT mutate description (side-effect check) | ✔ |
| 7 | Stale revision returns 409 VERSION_CONFLICT | ✔ |
| 8 | Sale sees "no permission" hint in UI | ✔ |
| 9 | Manager does NOT see hint | ✔ |
| 10 | Narrow panel (<480px) hides per-staff distribution | ✔ |
| 11 | Wide panel (>=480px) shows per-staff distribution | ✔ |
| 12 | API simulation returns expected schema (mode/assignments/fallbackQueue) | ✔ |
| 13 | Alt+1/2/3/4 cycles through 4 tabs (keyboard nav) | ✔ |

Screenshots: `tests/evidence/routing-{01..07}-*.png` (7 PNG files).
Summary: `tests/evidence/routing-summary.json`.

---

## 6. Self-check items (per user)

| Self-check item | Status | Evidence |
|---|:---:|---|
| Phân bổ trọng số, tổng số khách, giới hạn capacity/quota và fallback | ✔ | simulator.ts (batch + realtime) + tests/routing-simulator.test.mjs (9 ✔ covering both modes + scenarios + sum invariant) |
| Đổi config revision, stale update và nhân viên offline/quay lại | ✔ | config-store.ts optimistic concurrency + 3 ✔ (VERSION_CONFLICT + chained offline→online + version increment) |
| Gọi trực tiếp mock service để kiểm tra manager-only | ✔ | tests/routing-simulator.test.mjs (5 ✔) + tests/routing-api.test.mjs (3 ✔ HTTP 403) + tests/routing-browser-evidence.mjs (3 ✔ server + UI hint) |
| **Browser thật: preview 10/100, chỉnh config theo quyền, keyboard, layout hẹp** | ✔ | tests/routing-browser-evidence.mjs (13 ✔ real Chromium + 7 screenshots: routing-{01..07}-*.png) |
| Build/typecheck pass | ✔ | `tsc --noEmit` clean |
| Regression phù hợp | ✔ | contracts 398/398 ✔, context-panel 77/77 ✔, security 23/23 ✔, browser 27+13 ✔ |

Browser evidence does NOT replace API tests — both run independently.

`tests/security-evidence.mjs` (CORE/1.9 B4/B5 BLOCKER FIX) — 23/23 ✔.
`tests/browser-evidence.mjs` (CORE/1.9 browser verification) — 27/27 ✔.
`tests/routing-browser-evidence.mjs` (CORE/1.11 browser verification) — 13/13 ✔.

---

## 7. Manifest

Two separate manifests, distinct paths:

- `docs/contracts/handoff-core-1.9.manifest.txt` — 39 entries (CORE/1.9
  bundle). Modified since baseline (server.ts, app.tsx gained routing
  routes/tab). This proves the CORE/1.9 audit-PASS bundle has changed.
- `docs/contracts/handoff-core-1.11.manifest.txt` — 15 entries
  (CORE/1.11 delta). Lists NEW + SHARED + DOCS files; SHA-256 reflects
  the current (post-delta) state.

**CORE/1.9 baseline evidence (audit-PASS) is preserved** — the CORE/1.9
manifest hash mismatch is EXPECTED, since server.ts and app.tsx were
modified for CORE/1.11 routing routes. The CORE/1.9 manifest is
re-generated to record the new hashes. The CORE/1.9 bundle content
(including R4 re-recheck) remains in place.

### Commands

```bash
cd apps/context-panel

# CORE/1.9 manifest (regenerated; reflects post-delta hashes)
node scripts/generate-manifest.mjs
node scripts/generate-manifest.mjs --verify
node scripts/generate-manifest.mjs --check

# CORE/1.11 manifest (separate)
node scripts/generate-manifest-1.11.mjs
node scripts/generate-manifest-1.11.mjs --verify
node scripts/generate-manifest-1.11.mjs --check
```

### Removed (none in CORE/1.11)

CORE/1.11 only adds files. CORE/1.9 manifest is regenerated to reflect
shared-file changes — this is EXPECTED delta behavior.

---

## 8. Algorithms — PROPOSED for runtime decision

Per Master V2.6 §10.2.3, CORE/1.11 implements **two PROPOSED algorithms**
as mock simulations. Owner chốt production gate before V7.9c.

### BATCH mode — Largest remainder (Hamilton)

**Definition** (from Master §10.2.3):

> quota = N × weight_i / totalWeight; floor + distribute largest
> fractional remainders with stable tie-break.

**Implementation:** `src/routing/simulator.ts computeQuotaPlan()`:
- For each eligible staff, compute `quota_i = N × weight_i / totalWeight`.
- Take `floor(quota_i)` as base count.
- Sum remainder = `N - Σfloor(quota_i)`.
- Distribute remainder by descending fractional part; tie-break by
  `actorId` ascending (stable sort).
- Capacity/quota constraints reduce eligible set; recompute on remaining.

**Properties:**
- Deterministic; no PRNG.
- Exact ratio when `N × weight_i % totalWeight == 0` for all i.
- Within ±1 per slot when not divisible.

**Verification (N=100, weights [3,2,1,4]):**

| | A | B | C | D |
|---|---:|---:|---:|---:|
| Expected | 30 | 20 | 10 | 40 |
| Actual | 30 | 20 | 10 | 40 |

Tests: `tests/routing-simulator.test.mjs` ✔

### REALTIME mode — Smooth weighted round-robin (Nginx)

**Definition** (from Master §10.2.3):

> accumulator-based: currentWeight[i] += weight_i; pick max;
> subtract totalWeight from chosen.

**Implementation:** `src/routing/simulator.ts initWrr() / wrrPick()`:
- Each staff has a `currentWeight` accumulator.
- On each customer, add `weight_i` to all eligible.
- Pick staff with highest `currentWeight`; tie-break by stable order
  (i.e., iteration order in `staffStates[]`).
- Subtract `totalWeight` from chosen.

**Properties:**
- Deterministic given stable tie-break order.
- Streaming approximation; converges to exact ratio as N→∞.
- Within ±2 per slot for N=100.

**Verification (N=100, weights [3,2,1,4]):**

| | A | B | C | D |
|---|---:|---:|---:|---:|
| Expected | 30 | 20 | 10 | 40 |
| Actual | 30 | 20 | 10 | 40 |

Tests: `tests/routing-simulator.test.mjs` ✔

### Owner decision pending

- Production gate quyết algorithm + tie-break policy.
- HYBRID strategy (Q-34 PROPOSED): runtime decides per-event.
- Catch-up burst semantics (G-08 UNKNOWN): no retro-fill in CORE/1.11.
- Reservation fencing tokens (Q-26 marker only): not exercised here.

### Limitations / Decisions

#### What CORE/1.11 does NOT do

- No real Chatwoot assignment API calls (synthetic only).
- No real HRP Handling/credit policy mutation.
- No persistence (in-memory store, lost on server restart).
- No catch-up burst logic (per-customer simulation only; production
  requires explicit recovery semantics — see Master §10.2.3 G-08 unknown).
- No DNS / SSO / auth integration (uses existing mock identity map).
- HYBRID strategy policy: PROPOSED, not implemented (Q-34 unknown).

---

## 9. Risk classification (per Execution Guide §5.3)

| Nhóm | Status | Ghi chú |
|---|---|---|
| Shared contract | NONE | Frozen contracts untouched (Gate 0.5 schemas referenced only) |
| HRP core/domain writes | NONE | Mock simulator + in-memory store; no DB |
| Auth/permissions/PII | LOW | Manager-only enforcement at server boundary; mock identity map |
| Data reliability | NONE | In-memory, lost on restart |
| AI có quyền/dữ liệu | NONE | Mock |
| UI trình bày | LOW | New tab + scenarios; reuses existing React shell |
| Mock/read-only prototype | YES | CORE/1.11 belongs to this group |
| Docs/copy/refactor | LOW | This handoff + manifest regeneration |

Boundary/security changes: **manager-only enforcement** at service
boundary + server route level. This is **LOW** risk (constraint
enforcement, not policy decision) but listed for Owner awareness.

---

## 10. Verdict

**T1 Self-Verdict:** READY FOR OWNER REVIEW (mock-only slice). Verdict
held at READY FOR OWNER REVIEW, NOT self-certifying Auditor PASS.

Per user: "Dừng ở READY FOR OWNER REVIEW, không tự cấp Auditor PASS."

**Constraints honored:**

- Frozen contracts unchanged (Gate 0.5 schemas referenced only; not modified).
- No CORE/1.12+ scope expansion.
- No real Chatwoot API calls; no real Handling/credit mutation.
- Manager-only enforced at server boundary, NOT just hidden in UI.
- No Docker / deploy / real provider.
- Working tree untracked (CORE/1.11 files added; CORE/1.9 manifest regenerated).
- No commit / push / merge.

---

## 11. Test counts (per snapshot — no duplicates)

`npm test` and `node --test tests/*.test.mjs` are run independently. Both
report `77/77 pass`. Breakdown by suite (top-level `test()` only):

| Suite | Top-level | Notes |
|---|---:|---|
| `tests/server.test.mjs` | 11 | Server boot + config |
| `tests/panel-ui.test.mjs` | 21 | UI contracts (describe+it) |
| `tests/manifest-readonly.test.mjs` | 4 | CORE/1.9 manifest |
| `tests/manifest-readonly-1.11.test.mjs` | 4 | CORE/1.11 manifest (NEW) |
| `tests/routing-simulator.test.mjs` | 23 | batch/realtime/offline/capacity/quota |
| `tests/routing-api.test.mjs` | 14 | API integration (boots real server) |
| **Total** | **77** | **77/77 pass** |

Evidence scripts (separate, not counted in 77):

| Script | Checks | Pass |
|---|---:|---:|
| `tests/security-evidence.mjs` | 23 | 23/23 |
| `tests/browser-evidence.mjs` (CORE/1.9) | 27 | 27/27 |
| `tests/routing-browser-evidence.mjs` (CORE/1.11) | 13 | 13/13 |

These evidence scripts boot a real server, exercise a real Chromium
browser, and capture screenshots + JSON summary. They are separate from
the unit tests to avoid Playwright dependency on the test runner.

**Total verification (mock-only):**

| | Tests | Status |
|---|---:|---:|
| CORE/1.11 unit | 23 + 14 + 4 = 41 | 41/41 ✔ |
| CORE/1.11 evidence | 23 + 13 = 36 | 36/36 ✔ |
| Context-panel regression (77 above) | 36 (server+ui+manifest) | 36/36 ✔ |
| Contracts regression | 398 | 398/398 ✔ |

---

## 12. References

- `docs/contracts/handoff-g0-0.5.md` — Gate 0.5 routing contracts baseline
- `docs/contracts/decision-register.md` — Q-32, Q-34..Q-37 routing decisions
- `packages/contracts/src/commands/routing.ts` — frozen routing schemas
- `packages/contracts/src/primitives.ts` — Actor schema, ExpectedVersion, OrganizationId
- `apps/context-panel/src/orchestrator-wire.ts` — MockIdentity map (resolved in CORE/1.7)
- `apps/context-panel/src/server.ts` — Panel server (extended with 4 routes)
- `apps/context-panel/src/ui/app.tsx` — React shell (extended with 4th tab)
- Master-Plan.V2.6.md §6, §10.2 (source allocation vs weighted distribution)
