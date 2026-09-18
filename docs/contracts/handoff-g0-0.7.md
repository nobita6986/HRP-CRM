# G0/0.7 — Handoff

HEAD: 414c54bfa2e227ec1a25694310e48908e0d67abe
Branch: main
Date: 2026-09-13 13:00 (UTC+7)
Package version: 0.0.7-g0.7
Coder: T1
Owner: Chủ nhân (review bundle trước Gate 0 freeze)
Auditor: PENDING — gom bundle Gate 0 trước freeze (Auditor review tổng
0.3a–0.7).

Nguồn: Backlog Gate0 §Task 0.7, Master V2.6 §13, hrp-connector v1.1
HEAD 414c54b.
Dependency 0.1–0.6 có self-check (313/313 fixtures PASS); chưa freeze /
chưa independent audit PASS.

## AC & evidence

| AC (Backlog §0.7) | Trạng thái | Evidence |
|---|---|---|
| Typecheck strict và runtime positive/negative fixtures chạy được; unknown fields và prohibited fields reject theo DTO, không silently strip mutation nguy hiểm | DONE self-check | `tsc --noEmit` strict PASS; **372/372 fixtures PASS** runtime; `.strict()` reject unknown keys trên toàn bộ command/event/input schema (đã enforce 0.1–0.6 + verify trong fixtures mới). |
| Fixture coverage: three match outcomes, CLOSED/reasons, date condition, read-only relationship, malformed envelopes, evidence URL, raw transcript, no-op update, retry errors | DONE self-check | `fixtures-coverage-0.7.test.mjs` 59 fixtures mới cover §1–§14: 3 match outcomes (EXACT/POSSIBLE/NEW), CLOSED + 9 closeReason, AVAILABLE_FROM_DATE future + leap year (Feb 29 2028), read-only CurrentRelationship (mutation reject), malformed envelopes (actor/source/version), evidence URL/base64 reject, raw transcript reject, no-op update (UpdateLaborProfile NOOP/APPLIED, batch APPLIED/SKIPPED/FAILED/ACCEPTED), retry errors (IDEMPOTENCY_CONFLICT NEVER, VERSION_CONFLICT REFRESH_AND_REVIEW), cross-aggregate leak, Q-32 pendingReference canonical, BoD aggregate, secret read reject, marker consistency. |
| Không secrets/PII; constants/types/runtime schemas không lệch; compatibility/version policy và consumers pin version | DONE self-check | `README.md` viết lại theo 0.3a–0.7 public surface; ghi rõ `Không có raw secret / API key / PII trong fixtures / public API`; `CHANGELOG.md` ghi version bump 0.0–0.7 (0.0.1→0.0.7); consumers pin policy ghi explicit (`@hrp-engagement/contracts@^0.0.x` hoặc exact); `PACKAGE_VERSION` bumped `0.0.6-g0.5` → `0.0.7-g0.7`. |
| Test không dùng schema pass làm bằng chứng policy runtime đã thực thi | DONE self-check | Matrix 0.6 + README + CHANGELOG đều phân biệt **Schema validation (AC CONFIRMED)** vs **Runtime gate (PROPOSED HRP-owned, PENDING)**; fixtures chỉ chứng minh schema strict + superRefine; marker (`*_PATCH_FORBIDDEN`) chỉ audit (Q-30 nguyên tắc). |

## Source files

**Mới (Gate 0/0.7):**
- `packages/contracts/tests/fixtures-coverage-0.7.test.mjs` — 59 fixtures
  mới cho §0.7 AC (313 → **372**, tổng +59).
- `packages/contracts/README.md` — viết lại theo 0.3a–0.7 public
  surface; status, scripts, compatibility, "Không có".
- `packages/contracts/CHANGELOG.md` — version bumps 0.0–0.7; breaking
  change Q-32 (pendingId → pendingReference) tại 0.5; compatibility
  policy cho consumer pin.
- `docs/contracts/handoff-g0-0.6.md` + `handoff-g0-0.6.manifest.txt`
  (bổ sung hình thức 0.6 song song).

**Sửa (Gate 0/0.7):**
- `packages/contracts/src/index.ts` — `PACKAGE_VERSION` bump
  `0.0.6-g0.5` → `0.0.7-g0.7`.
- `packages/contracts/package.json` — `version` bump
  `0.0.1-g0.1` → `0.0.7-g0.7`.

**Không đụng**:
- `packages/contracts/src/commands/**` — schema đã đóng 0.1–0.6; 0.7 chỉ
  test/coverage, KHÔNG sửa contract.
- `docs/contracts/authorization-policy-matrix.md` — đã đóng 0.6; 0.7
  chỉ tham chiếu, KHÔNG sửa.
- `docs/contracts/decision-register.md` — KHÔNG mở Q mới; 0.7 không
  phát hiện mismatch bắt buộc phải sửa contract.
- `packages/contracts/package.json` dependencies — không thêm dep mới
  (vitest/node test runner đã có, zod 3.24.2 + typescript 5.7.3 đủ).

## Versions

| Component | Trước | Sau |
|---|---|---|
| PACKAGE_VERSION | `0.0.6-g0.5` | `0.0.7-g0.7` |
| package.json version | `0.0.1-g0.1` | `0.0.7-g0.7` |
| Tests | 313 | **372** (+59 fixtures mới trong `fixtures-coverage-0.7.test.mjs`) |
| Files added | — | README.md (viết lại), CHANGELOG.md, fixtures-coverage-0.7.test.mjs, handoff-g0-0.6.md, handoff-g0-0.6.manifest.txt |
| Files modified | — | index.ts (PACKAGE_VERSION), package.json (version) |

## Self-check kết quả

- `npm run typecheck` (tsc --noEmit strict): PASS.
- `npm run build` (tsc): PASS.
- `node --test tests/*.test.mjs`: **372/372 PASS**, 0 FAIL.
- Thời gian chạy: ~576ms.
- Markdown render OK cho README, CHANGELOG, handoff, manifest.

## Snapshot & hash

HEAD git: `414c54bfa2e227ec1a25694310e48908e0d67abe` (chưa commit mới).

Hash các file chính (xem `handoff-g0-0.7.manifest.txt`):

```
B6446FE924E5502631414C72144434FCBA93FA324A3C245A070470CBE10F5E55  packages/contracts/src/index.ts
BB50A62712DA78877E86FB370A3824332D259015AF0741C5E68299D615C8291F  packages/contracts/tests/fixtures-coverage-0.7.test.mjs
B08A271AC1085344E82CC2D8060F0C2BE2AEB556D30D2720EB33A35E1AE3D5AC  packages/contracts/README.md
B8DC89064AEF8A5D392D2522B25BA7ED3785A080103BAF504FACECAA4180D957  packages/contracts/CHANGELOG.md
4DFC386FCA0BCF0D96737ED98C68C8916159524C838DBEC3D64440F72F4EAE7E  packages/contracts/package.json
```

Hash docs/contracts (0.6 bổ sung + 0.7):

```
134A0E879F1E21C2DE5B5F8AB067AAB9FD8B2DCC3BAE505D9AA2177C07E50EB5  docs/contracts/authorization-policy-matrix.md
735FA72F999706A1A4C622B8659365FFAF210CFC3633C4CC6498B3A21BBB020A  docs/contracts/handoff-g0-0.6.md
0D9D6B72608C953CE98582FEE5EBC0D69BF3164BCB40A9DE625D6438FCA9D188  docs/contracts/handoff-g0-0.6.manifest.txt
```

## Decisions mới / thay đổi trong bundle

Mở trong `decision-register.md` (Q còn open giữ nguyên; không mở Q
mới ở 0.7):

- 0.7 không phát hiện mismatch bắt buộc giữa schema contracts 0.1–0.6
  và AC Backlog §0.7. Toàn bộ test fixtures 0.7 PASS với schema hiện
  có — không cần Q mới, không cần đề xuất sửa contract.
- Q-32 đã đóng ở 0.5 (`pendingReference` canonical); 0.7 thêm 3 test
  riêng (ACCEPTED có pendingReference, ACCEPTED KHÔNG có appliedId,
  FAILED/SKIPPED KHÔNG có pendingReference).
- Q-30 nguyên tắc — marker (`*_PATCH_FORBIDDEN`) chỉ audit; schema
  `strict()` + `superRefine()` mới là AC enforcement.
- Q-33 signature provider / JWT / webhook algorithm — KHÔNG tự đặt;
  cần Auditor review ở bundle cuối.

## Gate bị ảnh hưởng

- Gate 0 freeze: thêm 59 fixtures + 1 viết README + 1 CHANGELOG +
  PACKAGE_VERSION bump; bundle tổng **372/372 fixtures PASS** cho
  0.3a–0.7.
- V7.9a (CORE 1.x): chưa triển khai — chờ Gate 0 freeze.
- Implementation query API runtime cho Q-32 để Phase V7.9a HRP-owned
  (chưa làm).

## Blockers / open questions

- Independent audit Gate 0 bundle (0.3a–0.7) PENDING; T1 self-check
  không thay Auditor.
- Q-19 open-status set / transitions matrix chưa chốt (HRP-owned).
- Q-33 signature provider protocol chưa tự đặt (Auditor review).
- Client domain contract (Company/Contact/Opportunity/Interaction)
  vẫn PROPOSED; Q-23 unresolved.
- HYBRID routing policy (Q-34) chưa chốt; HYBRID là PROPOSED.
- Dual-control AI proposal (Q-37) chưa chốt; AI_PROPOSAL_PATCH_FORBIDDEN
  chỉ audit.
- Phase 10 modules (KPI, attribution) namespace experimental; chưa
  chốt enable.
- "0.7 PASS" KHÔNG tự coi = freeze Gate 0; Owner xác nhận Gate 0
  trước backend.

## Limits / risk

- Schema bind shape CONFIRMED 0.3a–0.7; runtime policy PROPOSED.
- Marker không tự chứng minh AC enforce (Q-30 nguyên tắc).
- Signature / JWT / webhook algorithm CHƯA tự chọn (Q-33).
- BoD / secret rules mô tả ranh giới; implementation runtime HRP-owned
  PR quyết.
- Implementation query API runtime cho Q-32 để Phase V7.9a — schema bind
  đầy đủ, runtime implementation chưa có.
- Test runner KHÔNG đổi (Node `--test` + Zod runtime); coverage matrix
  phụ thuộc fixtures tự kiểm chứng.

## Dừng

Đúng phạm vi G0/0.7 (+ 0.6 bổ sung). Chưa sang 0.8 hoặc backend.
Owner xác nhận Gate 0 trước khi tiếp tục.
