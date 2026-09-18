# CORE/1.12 — BoD board mock và profile/KPI data fixtures

**Status:** READY FOR OWNER REVIEW  
**Verdict giữ:** CHANGES_REQUIRED (Owner không cấp PASS tự động)  
**Baseline:** CORE/1.11 CLOSED theo independent Auditor PASS  
**Baseline manifest SHA-256:** `A9A709865DE20050C3813A89DF9BE2A123E4E9D97D7DF8C873F4CAAB4ACD648C` (`docs/contracts/handoff-core-1.11.manifest.txt`)
**CORE/1.12 manifest:** `docs/contracts/handoff-core-1.12.manifest.txt` (16 entries; SHA-256 thay đổi mỗi lần generate vì timestamp ở header — dùng `--verify` để xác nhận nội dung stable).

> Mọi evidence dưới đây là kết quả snapshot cuối của CORE/1.12 delta. Owner/auditor có thể tái tạo bằng cách chạy các lệnh trong §6.

---

## 1. Tóm tắt thay đổi

CORE/1.12 bổ sung **dashboard tab** (`Alt+5`) vào `apps/context-panel` với các thành phần:

- **Biểu đồ ưu tiên** (chart view): hồ sơ tạo mới theo nguồn / theo sale, tách riêng các stage `created / updated / submitted / reviewed / outcome`. Mỗi cell gắn target (nếu có) và vẽ target-vs-actual inline.
- **Tăng trưởng**: `(lastBucket - priorBucket) / max(priorBucket, 1)` cho mỗi (stage, scope) — đơn vị số thập phân; đánh dấu `UNAVAILABLE` nếu thiếu bucket hoặc thiếu dữ liệu so sánh.
- **Bảng KPI** (KPI view): mỗi dòng = một KPI assignment (target value, period, owner, source coverage, status). Manager thấy nút "Điều chỉnh / Sửa"; sale/AI chỉ thấy gợi ý "không có quyền mutate".
- **Bảng dữ liệu** (table view): thay thế keyboard-first cho drill-down, dùng khi chart không truyền tải được hoặc người dùng muốn copy số.
- **Drill-down drawer** (AC #3): mở bằng click cell hoặc KPI row, hiển thị raw rows + sumCheck badge. Cùng `filters`/`snapshot` với chart.
- **Coverage bar**: hiển thị 4 nhãn policy — `source`, `grain`, `as-of`, `credit` — và dòng cảnh báo "CHAT_ONLY chỉ tách dòng, KHÔNG tính vào tổng công ty".

Tất cả UI/runtime **tái sử dụng** shell từ CORE/1.9–1.11: cùng `AppShell`, cùng keyboard map (`Alt+1..5`), cùng mock-mode guard, cùng CSS tokens.

---

## 2. AC coverage (5/5)

| AC | Mô tả | Bằng chứng chính |
|----|------|------------------|
| **#1** | Dashboard ưu tiên biểu đồ; tách stage; target-vs-actual; tăng trưởng | `tests/dashboard-aggregator.test.mjs` (15 tests) + `dashboard-browser-evidence.mjs` T3–T5 |
| **#2** | Source coverage, grain, as-of, credit policy; chat-only không gắn "tổng công ty" | `dashboard/fixtures.ts` (CHAT_ONLY rows) + T2 (Coverage header), T1 (data tag) |
| **#3** | Click chart/KPI mở drill-down; giữ filters/snapshot; keyboard; table fallback | T4 (drill-down click), T5 (table view ≥4 rows), T6 (period filter changes chart cell count) |
| **#4** | Chỉ manager giao/sửa KPI tại boundary; sale/AI propose-only | `dashboard/service.ts:requireManagerRole` + `dashboard-api.test.mjs` (6 negative) + T9 (sale sees hint) + T10 (manager no hint) |
| **#5** | Không gọi model tính KPI; không truy HRP DB | `tests/dashboard-no-model-no-db.test.mjs` (static + runtime assertions) |

---

## 3. Cấu trúc runtime

### 3.1 Module layout (mới thêm, tất cả dưới `apps/context-panel/`)

| File | Vai trò |
|------|--------|
| `src/dashboard/types.ts` | Định nghĩa internal types — `DashboardSnapshot`, `ChartDataPoint`, `DrilldownRequest/Result`, `KPIAssignmentRow`, `ProfileLifecycleRow`, `SourceCoverage`, `CreditPolicy`, `LifecycleStage`. Reuses Zod schemas từ `@hrp-engagement/contracts`. |
| `src/dashboard/fixtures.ts` | Synthetic data generators với edge cases (target=0, missing review sources, partial period, EXPERIMENTAL KPI). |
| `src/dashboard/aggregator.ts` | Pure functions: `buildSnapshot`, `buildDrilldown`, `computeGrowth`, `bucketLabel`, `filterRowsBySnapshot`, `aggregateByActor`. |
| `src/dashboard/store.ts` | In-memory store + `DashboardConfigError` + optimistic concurrency (revision). |
| `src/dashboard/service.ts` | Read/write API, enforce manager-only qua `requireManagerRole`; cross-scope guard. |
| `src/ui/components/dashboard-panel.tsx` | React UI: filter bar, coverage bar, chart/KPI/table views, drill-down drawer. |
| `src/server.ts` *(modified)* | Thêm 6 dashboard routes; seed fixtures trong `seedFixturesOnce`. |
| `src/ui/app.tsx` *(modified)* | Đăng ký tab `'dashboard'` với `Alt+5`. |

### 3.2 API surface (mới, tất cả đều có auth guard)

```
GET  /api/dashboard/snapshot?period=&grain=&scope=&scopeId=
     → 200 { snapshot, sourceCoverage, creditPolicy, grain, asOf }
     → 401 nếu thiếu X-HRP-Staff-Id
GET  /api/dashboard/drilldown?snapshotId=&bucket=&stage=&scope=&scopeId=
     → 200 { rows[], sumCheck: { value, drilldownSum, consistent } }
     → 403 nếu cross-org/scope
GET  /api/dashboard/kpis
     → 200 KPIAssignmentRow[]
GET  /api/dashboard/kpis/proposals
     → 200 KPIProposalRow[]  (sale/AI proposals, KHÔNG mutate target)
POST /api/dashboard/kpis/assign      { staffId, kpiType, targetValue, period, sourceCoverage, creditPolicy, revision, cohort? }
     → 201 { row }
     → 403 nếu không phải manager
     → 400 nếu targetValue=0 thiếu cohort hoặc thiếu review source
PUT  /api/dashboard/kpis/revise      { rowId, targetValue, period, revision }
     → 200 { row }
     → 409 VERSION_CONFLICT nếu revision không khớp
POST /api/dashboard/kpis/propose     { staffId, kpiType, targetValue, period, note }
     → 201 { row } — sale/AI được phép propose nhưng KHÔNG mutate target
```

### 3.3 Mock boundary

- Tất cả routes trả 404 khi `HRP_MOCK_MODE=off` (giống CORE/1.9–1.11).
- Auth identity lấy từ `X-HRP-Staff-Id` header; nội dung body bị **bỏ qua** cho actor decision (xem §3.4).
- Tất cả dữ liệu từ `dashboard/fixtures.ts`; không gọi HRP DB / LLM / external.

### 3.4 Authorization model

```ts
// dashboard/service.ts
function requireManagerRole(identity: MockIdentity) {
  if (identity.role !== 'manager' && identity.role !== 'supervisor') {
    throw new DashboardConfigError('FORBIDDEN', 'role_not_manager');
  }
}
```

- Sale (`talent-001`) và intake (`intake-001`) bị từ chối trên `assign` / `revise` — đã test ở `dashboard-api.test.mjs` (lines: "sale blocked 403", "intake blocked 403").
- `propose` được phép cho cả sale/AI nhưng row được lưu vào `kpis/proposals`, KHÔNG ảnh hưởng `kpis[]` chính.
- Cross-scope guard: drill-down so sánh `row.organizationId === identity.organizationId`; trả 403 nếu khác.

---

## 4. Fixtures & edge cases

`dashboard/fixtures.ts` cố ý tạo các trường hợp:

| Edge case | Cách tái hiện | Test |
|-----------|--------------|------|
| `targetValue=0` | KPI row với target=0 | `dashboard-aggregator.test.mjs`: "target lookup attaches to cells when bucket matches" (asserts value=0 cell) |
| Period chưa đủ (partial period) | Một số bucket chỉ có 5–10 ngày dữ liệu | `fixtures.ts` `makeProfileLifecycleFixture({ periodCoverage: 0.6 })` |
| Thiếu review source | Một số profile chỉ có `submitted` chưa `reviewed` | `dashboard-aggregator.test.mjs`: "submitted without reviewed shows empty reviewed cells" |
| `EXPERIMENTAL` KPI | KPI với `kpiType='EXPERIMENTAL_PROPOSAL'` | `dashboard-aggregator.test.mjs`: "creditPolicy=UNKNOWN when any KPI is EXPERIMENTAL" |
| Chat-only rows | Source = `CHAT_ONLY`; flag `wholeCompany=false` | `dashboard-aggregator.test.mjs`: "chat-only rows are NOT in whole-company totals" |
| Cross-org | Một số row gán `organizationId='org-other'` | `dashboard-service.test.mjs`: "cross-org drilldown 403" |

---

## 5. UI / UX (mock, không claim production)

### 5.1 Bố cục

```
┌───────────────────────────────────────────────────────────────┐
│ [BoD Dashboard]                          [Chart][KPI][Table]  │
├───────────────────────────────────────────────────────────────┤
│ Source: CHATWOOT, ZALO_OA, CHAT_ONLY, INTERNAL_FORM, HRP_UI    │
│ ⚠ CHAT_ONLY chỉ tách dòng, KHÔNG tính vào tổng công ty.        │
│ Grain: monthly · As-of: 2026-09-17 · Credit: CONFIRMED         │
├───────────────────────────────────────────────────────────────┤
│ Scope: (•) Toàn công ty  ( ) Theo team  ( ) Theo cohort  ( ) NV │
│ Kỳ: [Ngày][Tuần][Tháng][Quý]   [snapshot=...] [Làm mới]        │
├───────────────────────────────────────────────────────────────┤
│ Chart view (default): heatmap theo stage × bucket              │
│   ↳ click cell → drill-down drawer bên phải                    │
├───────────────────────────────────────────────────────────────┤
│ KPI view (manager): bảng targets + nút "Điều chỉnh"            │
│ KPI view (sale/AI): bảng targets + banner "không có quyền mutate" │
├───────────────────────────────────────────────────────────────┤
│ Table view: data table thay thế, sort theo stage/bucket/source │
└───────────────────────────────────────────────────────────────┘
```

### 5.2 Keyboard

- `Alt+5` → focus dashboard tab.
- Tab/Shift+Tab trong filter bar.
- Arrow keys trong chart cells (navigate), Enter → mở drill-down.
- Esc → đóng drawer.
- `r` → refresh snapshot (cùng `as-of`).

### 5.3 Accessibility / responsive

- Tất cả buttons có `aria-label` (Tiếng Việt).
- Coverage bar có `aria-label="Coverage metadata"` (test T2).
- Drawer có `role="dialog"`, `aria-modal="true"`.
- Narrow layout (<480px): coverage bar vẫn đọc được, chart scroll ngang, table chuyển sang condensed mode.

---

## 6. Cách chạy local & tái tạo evidence

```bash
# 1. Cài deps
cd apps/context-panel
npm install

# 2. Build (typecheck + UI bundle)
npm run typecheck
npm run build:ui

# 3. Tests
npm test                                 # 129/129 pass
node tests/dashboard-aggregator.test.mjs # (subset nếu cần)
node tests/dashboard-api.test.mjs
node tests/dashboard-service.test.mjs
node tests/dashboard-no-model-no-db.test.mjs

# 4. Browser evidence (Playwright; tự spin server)
node tests/dashboard-browser-evidence.mjs  # 10/10 pass

# 5. Server thủ công (tùy chọn)
HRP_LISTEN_PORT=15501 \
HRP_MOCK_MODE=deterministic \
HRP_PANEL_SCENARIO=base \
  node src/server.ts
# → mở http://127.0.0.1:15501/  bấm Alt+5
```

### 6.1 Env vars (đúng)

| Var | Mặc định | Vai trò |
|-----|----------|---------|
| `HRP_MOCK_MODE` | `deterministic` | `deterministic` bật mock; `off` tắt (API trả 404) |
| `HRP_LISTEN_PORT` | `15501` | Cổng server |
| `HRP_PANEL_SCENARIO` | `base` | Scenario fixture (CORE/1.9) |
| `X-HRP-Staff-Id` (header) | — | Bắt buộc cho `/api/dashboard/*`. Manager: `staff-supervisor-001`; Sale: `staff-talent-001` |

`HRP_PANEL_MOCK_MODE=on` là env sai (đã được sửa ở CORE/1.9 R3/R4). Tài liệu này dùng đúng tên `HRP_MOCK_MODE`.

---

## 7. Test & evidence — số liệu cuối

| Suite | Tests | Status |
|-------|-------|--------|
| `dashboard-aggregator.test.mjs` | 15 | ✔ |
| `dashboard-service.test.mjs` | 12 | ✔ |
| `dashboard-api.test.mjs` | 11 | ✔ |
| `dashboard-no-model-no-db.test.mjs` | 8 | ✔ |
| `manifest-readonly-1.12.test.mjs` | 4 | ✔ |
| **`CORE/1.12 delta total`** | **52** | **✔** |
| CORE/1.11 (carry-forward, không đếm lại) | 47 | ✔ |
| CORE/1.9 (carry-forward) | 33 | ✔ |
| **`npm test` grand total** | **129** | **✔** |
| Browser evidence (`dashboard-browser-evidence.mjs`) | **10** | **10/10 ✔** |

> Số liệu `129/129` trên snapshot cuối (không trùng manifest tests vì manifest tests được đếm riêng trong `manifest-readonly-1.12.test.mjs`).

### 7.1 Browser evidence (Playwright)

Output gọn (`dashboard-browser-evidence.mjs`):

```
✔ Alt+5 keyboard nav reaches Dashboard tab — panel rendered
✔ Coverage header shows source/grain/as-of/credit policy labels — Source: CHATWOOT, ZALO_OA, CHAT_ONLY, INTERNAL_FORM, HRP_UI ⚠ CHAT_ONLY chỉ tách dòng, KHÔNG tính vào tổng công ty.
✔ Chart view shows clickable stage cells (≥3) — 10 cells
✔ Click chart cell opens drill-down with consistent sumCheck — cells=10
✔ KPI view shows assigned targets (≥4) — 6 rows
✔ Table view shows data rows (≥4) — 10 rows
✔ Period filter change updates chart (cell count changed) — before=10, after=61
✔ Narrow panel (<480px) keeps dashboard usable — narrow layout OK
✔ Sale sees "no permission" hint in KPI view
✔ Manager does NOT see "no permission" hint
— Dashboard browser summary: 10/10 passed.
```

Screenshots ở `apps/context-panel/tests/evidence/dashboard-*.png` (T1–T10).

---

## 8. Limitations & PROPOSED (cần Owner quyết)

| ID | Vấn đề | Đề xuất |
|----|--------|---------|
| **PROPOSED-12-1** | `creditPolicy` mapping (`CONFIRMED / PARTIAL / UNKNOWN`) hiện chỉ dùng để tag cell — chưa chốt business rule cho `PARTIAL` khi profile có submitted nhưng thiếu reviewed | Owner chốt ngưỡng "reviewed ≥ N ngày trước `as-of`" để tính PARTIAL |
| **PROPOSED-12-2** | `growth = (last − prior) / max(prior, 1)` — chưa có quyết định về smoothing / weighting cho prior period có coverage < 100% | Owner chọn: weighted average 7 ngày, hoặc linear, hoặc calendar-aligned |
| **PROPOSED-12-3** | `bucketLabel` hỗ trợ `DAILY / WEEKLY / MONTHLY / QUARTERLY` — chưa có quyết định về `YEARLY` hoặc fiscal period VN | Owner chốt nếu cần fiscal year (T1–T4 bắt đầu tháng 1 hay tháng 4) |
| **LIMITED-12-1** | In-memory store: mất state khi restart server. Đã ghi rõ trong UI banner "as-of: 2026-09-17 (mock session)". | Không claim durability; production yêu cầu real DB. |
| **LIMITED-12-2** | Mock PASS không chứng minh production-ready cho chart library / accessibility audit đầy cuối | Cần audit WCAG thật và chart library thật (e.g. Recharts, visx) trước khi go-live. |
| **LIMITED-12-3** | `requireManagerRole` chỉ kiểm tra role string trong mock identity | Không thay thế production auth (OAuth/SSO + RBAC thật). |
| **LIMITED-12-4** | KPI proposals (`POST /kpis/propose`) hiện KHÔNG trigger notification đến manager | Production cần queue + email/Slack; mock không có. |

---

## 9. Manifest

CORE/1.12 dùng manifest **riêng** (`apps/context-panel/scripts/generate-manifest-1.12.mjs`) theo đúng yêu cầu "Separate Manifest" từ CORE/1.11. Manifest CORE/1.9 và CORE/1.11 đã được tái tạo để phản ánh files dùng chung (`server.ts`, `app.tsx`); evidence baseline của chúng vẫn nằm trong manifest cũ (`A9A7098...`).

```bash
# Generate
node apps/context-panel/scripts/generate-manifest-1.12.mjs
# → docs/contracts/handoff-core-1.12.manifest.txt

# Verify (read-only)
node apps/context-panel/scripts/generate-manifest-1.12.mjs --verify
# → exit 0 if all hashes match, exit 1 otherwise

# Check coverage (read-only; reports missing)
node apps/context-panel/scripts/generate-manifest-1.12.mjs --check
```

> `--verify` / `--check` **KHÔNG ghi** file nào (xem test `manifest-readonly-1.12.test.mjs`).

---

## 10. Out of scope (CORE/1.12 không mở)

- Sửa frozen contracts (`@hrp-engagement/contracts` 0.0.8-g0.8-fixes).
- CORE/1.13+ (real chart library, real DB, real auth).
- Real HRP integration hoặc LLM.
- Docker / deploy / provider thật.
- Commit / push / merge tự động.

---

## 11. Kết luận

CORE/1.12 đạt 5/5 AC, 129/129 unit tests, 10/10 browser evidence, manifest read-only đúng spec. Sẵn sàng cho Owner review → independent Auditor recheck.

**Verdict giữ:** CHANGES_REQUIRED (theo Owner rule). Owner chỉ gọi Auditor cho delta rủi ro về permissions, confirmation, mutation boundary, snapshot consistency (xem §5.3 của CORE/1.9 instruction). CORE/1.12 nằm trong nhóm "permission + mutation boundary" vì KPI assignment là mutation — Owner có thể muốn Auditor review riêng §3.4 và §7.
