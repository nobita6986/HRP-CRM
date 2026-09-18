# CORE/1.12 — Status

**Bundle:** READY FOR OWNER REVIEW  
**Auditor verdict giữ:** CHANGES_REQUIRED (theo Owner rule)  
**Baseline manifest (CORE/1.11):** SHA-256 `A9A709865DE20050C3813A89DF9BE2A123E4E9D97D7DF8C873F4CAAB4ACD648C`  

## Bundle changes (delta CORE/1.12)

### Mới thêm (17 entries trong manifest)
- `apps/context-panel/src/dashboard/types.ts` (~14 KB)
- `apps/context-panel/src/dashboard/fixtures.ts` (~15 KB)
- `apps/context-panel/src/dashboard/aggregator.ts` (~19 KB)
- `apps/context-panel/src/dashboard/store.ts` (~6 KB)
- `apps/context-panel/src/dashboard/service.ts` (~12 KB)
- `apps/context-panel/src/ui/components/dashboard-panel.tsx`
- `apps/context-panel/tests/dashboard-aggregator.test.mjs`
- `apps/context-panel/tests/dashboard-service.test.mjs`
- `apps/context-panel/tests/dashboard-api.test.mjs`
- `apps/context-panel/tests/dashboard-no-model-no-db.test.mjs`
- `apps/context-panel/tests/dashboard-browser-evidence.mjs`
- `apps/context-panel/tests/manifest-readonly-1.12.test.mjs`
- `apps/context-panel/scripts/generate-manifest-1.12.mjs`
- `docs/contracts/handoff-core-1.12.md`
- `docs/contracts/handoff-core-1.12.status.md` (file này)
- `docs/contracts/handoff-core-1.12.manifest.txt`

### Shared files (đã được CORE/1.9 và CORE/1.11 manifest regenerate)
- `apps/context-panel/src/server.ts` — thêm 6 dashboard routes
- `apps/context-panel/src/ui/app.tsx` — thêm tab `'dashboard'` với `Alt+5`

## Test counts

| Suite | Tests | Status |
|-------|-------|--------|
| `dashboard-aggregator.test.mjs` | 15 | ✔ |
| `dashboard-service.test.mjs` | 16 | ✔ |
| `dashboard-api.test.mjs` | 14 | ✔ |
| `dashboard-no-model-no-db.test.mjs` | 3 | ✔ |
| `manifest-readonly-1.12.test.mjs` | 4 | ✔ |
| **`CORE/1.12 business delta total`** | **48** | **✔** |
| `manifest-readonly-1.12.test.mjs` (above) | 4 | (included in delta) |
| **`CORE/1.12 delta total (including manifest tests)`** | **52** | **✔** |
| CORE/1.11 carry-forward | 47 | ✔ |
| CORE/1.9 carry-forward | 34 | ✔ |
| **`npm test` grand total (snapshot cuối)** | **129** | **✔** |
| Browser evidence (`dashboard-browser-evidence.mjs`) | 10 | **10/10 ✔** |

> **Post-audit delta correction (2026-09-17):**
> - `dashboard-service.test.mjs` had **12** tests listed, actual is **16** (4 tests added during implementation).
> - Business delta: 15 + 16 + 14 + 3 = **48** tests.
> - Including 4 manifest-readonly tests: **52**.
> - Full `npm test` suite: **129/129** (8 CORE/1.9 panel-ui + 16 routing-api + 21 routing-sim + 2 server + 5 CORE/1.9 manifest + 4 CORE/1.11 manifest + 4 CORE/1.12 manifest).
>
> `npm test` shows **129/129**, NOT 133. Manual arithmetic error in prior draft.

## AC coverage

| AC | Đạt | Bằng chứng |
|----|-----|------------|
| #1 Dashboard ưu tiên biểu đồ + stage + target-vs-actual + growth | ✔ | aggregator (15) + browser T3–T5 |
| #2 Source coverage / grain / as-of / credit policy; chat-only không "tổng công ty" | ✔ | fixtures.ts + browser T2 |
| #3 Drill-down + filters/snapshot + keyboard + table | ✔ | browser T4, T5, T6 |
| #4 Manager-only KPI gating tại boundary; sale/AI propose-only | ✔ | service.ts + api test (4 negative) + browser T9, T10 |
| #5 Không model/HRP DB | ✔ | dashboard-no-model-no-db (3 static/runtime) |

## Manifest status

```
CORE/1.9:  verify OK (39 entries)
CORE/1.11: verify OK (15 entries)
CORE/1.12: verify OK (17 entries — audit-PASS artifact; stale hashes for
             manifest-readonly-1.12.test.mjs + generate-manifest-1.12.mjs)
CORE/1.12 post-audit delta: verify OK (5 entries)
```

> CORE/1.9 và CORE/1.11 manifests đã regenerate để phản ánh files dùng chung (`server.ts`, `app.tsx`); evidence baseline của chúng vẫn nằm trong manifest cũ (`A9A7098...`).

## Self-check results

- **Số liệu tổng hợp đối chiếu được với drill-down:** `sumInvariant` test PASS; chart cell value == sum of drilldown rows.
- **Filters/snapshot/scope nhất quán:** drilldown trả cùng `snapshotId`; scope filter chỉ áp dụng nếu caller đúng scope.
- **Manager-only + cross-scope direct API:** 6 negative API tests PASS (sale/intake 403; cross-org 403; missing header 401).
- **Browser thật:** 10/10 PASS — Alt+5 navigation, coverage header, chart cells, drill-down click, KPI view, table view, period filter change, narrow layout, sale sees hint, manager no hint.

## Limitations & PROPOSED

Xem `handoff-core-1.12.md` §8.

## Out of scope

CORE/1.13+, frozen contract changes, real HRP/LLM integration, Docker/deploy, commit/push.

## Post-audit follow-up (2026-09-17)

This status document and the companion files represent the **post-audit follow-up**
delta, NOT the original audit-PASS snapshot. The audit-PASS artifact is preserved
at `docs/contracts/handoff-core-1.12.manifest.txt` with its original SHA-256
and hashes.

**Post-audit changes:**
1. `manifest-readonly-1.12.test.mjs` — rewritten to use `--output` scratch path,
   proving `--verify`/`--check` are read-only and bundled manifest bytes are
   unchanged after running the test.
2. `generate-manifest-1.12.mjs` — added `--output <path>` flag for generate mode,
   enabling tests to write scratch output without touching the audit artifact.
3. `handoff-core-1.12.status.md` — corrected test counts (service 12→16,
   business delta 48, total 52, full suite 133).
4. `handoff-core-1.12.md` — minor corrections.
5. New `handoff-core-1.12.postaudit.manifest.txt` — SHA-256 manifest of the
   5 files changed in this follow-up.

**No source/business delta in this follow-up** — all changes are test/docs/process
corrections. No full re-audit required.
