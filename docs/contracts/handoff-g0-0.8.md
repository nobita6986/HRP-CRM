# G0/0.8 — Handoff

HEAD: 414c54bfa2e227ec1a25694310e48908e0d67abe
Branch: main
Date: 2026-09-13 14:30 (UTC+7)
Package version: 0.0.8-g0.8-fixes (bumped đợt F1–F5)
Coder: T1
Owner: Chủ nhân (sign-off cuối Gate 0)
Auditor: **INDEPENDENT AUDIT PENDING** — chưa có nguồn Auditor độc lập
(người/agent, phạm vi, snapshot, verdict) cho claim `7/7 PASS` /
`READY-TO-FREEZE` đợt trước. T1 self-check 372/372 PASS xem §Self-check
dưới. Owner có 2 lựa chọn: yêu cầu independent audit trước FREEZE, hoặc
sign-off điều kiện.

Nguồn: Backlog Gate0 §Task 0.8, Master V2.6 §13, hrp-connector v1.1
HEAD 414c54b, Execution Guide §5.3, decision-register.md (Q-1..Q-37),
authorization-policy-matrix.md (0.6), inventory.md, handoff 0.3a–0.7.
Dependency 0.1–0.7 có self-check (372/372 fixtures PASS); audit gom
trước Gate 0 freeze.

## AC & evidence

| AC (Backlog §0.8) | Trạng thái | Evidence |
|---|---|---|
| AC1 [ ] Owner có bảng command-by-command: fields, results, permissions, invariants, error/retry, files để review | DONE self-check | `docs/reviews/gate-0-checklist.md` §2 có **23 section** (identity, evidence, profile, intake, placement-case, interactions, availability, suppression, next-action, scheduling, outbox, gateway, providers, ports, queries, events, mappings, routing, analytics, kpi, ai-proposals, ai-provider-config) + 1 section phụ envelopes/errors/primitives/enums. Mỗi section có bảng 7 cột (Command/Query \| Fields \| Result \| Permission (tier) \| Invariants \| Error/Retry \| Files + matrix ref). |
| AC2 [ ] Critical Phase 9 decisions đã chốt hoặc path bị disable rõ ràng; proposed Phase 10 không bị công bố canonical-ready | DONE self-check | `gate-0-checklist.md` §3 có bảng đầy đủ G0-01..G0-11 + Q-13..Q-37 với cột Status / Phase / Áp lên bundle / Notes. §3.1 liệt kê Phase 10 module disable rõ: `kpi.ts` namespace `phase10-experimental` (Q-35); `analytics.ts` `EXPERIMENTAL → UNAVAILABLE` (Q-9); `ai-proposals.ts` strict reject `commandPayload` / `embedCommandPayload` (Q-37). |
| AC3 [ ] Không Prisma/Route Handler/domain backend trong PR Gate 0 | DONE self-check | `gate-0-checklist.md` §4.1 xác nhận working tree KHÔNG có `prisma/`, `app/api`, `apps/`, `packages/integration-store/`, Route Handler, `migration/`, `src/backend`, `src/server`. §4.2 verify `packages/contracts/package.json` chỉ có `zod@3.24.2` (dep) + `typescript@5.7.3` (devDep); KHÔNG có `@prisma/client` / `next` / `express` / `hono` / `fastify` / `koa` / `@nestjs/*` / `@hapi/*`. §4.3 liệt kê 3 file mới + 2 file sửa. |
| AC4 [ ] Ghi nhận Owner xác nhận Gate 0 trước V7.9a implementation phụ thuộc; chưa tự chuyển HRP-owned PR | DONE self-check | `gate-0-checklist.md` §5 có bảng Owner sign-off để trống; §5.2 tuyên bố "Gate 0 chưa FREEZE cho đến khi Owner chính thức xác nhận; mọi implementation phụ thuộc (1.0–1.15) phải chờ". §5.3 liệt kê 9 downstream items chờ HRP-owned PR (V7.9a 1.0–1.15, Q-19/33/34/37/23, Q-32 runtime API, Phase 10 module, OrgScope). |

## Source files

**Mới (Gate 0/0.8):**
- `docs/reviews/gate-0-checklist.md` — checklist chính 0.8; §1 scope &
  authority, §2 command-by-command (23 sections + 1 section phụ
  envelopes/errors/primitives/enums), §3 Phase 9 vs 10 (§3.0 critical
  decisions còn open + path bị chặn + phương án đề xuất; §3.1 tổng hợp
  Phase 9/10; §3.2 Phase 10 module disable), §4 out-of-scope, §5 Owner
  sign-off, §6 manifests & hashes (80 file thủ công: §6.1 source TS 27;
  §6.2 tests 23; §6.3 config+lockfile 3; §6.4 Importal docs 6; §6.5
  contracts docs 21; §6.6 package docs 3; §6.7 self-reference), §7 limits
  & known open (7 risks), §8 sign-off statement.
- `docs/contracts/handoff-g0-0.8.md` (file này).
- `docs/contracts/handoff-g0-0.8.manifest.txt` — SHA-256 của file mới +
  file sửa.

**Sửa (Gate 0/0.8 — Owner review doc-only, không ảnh hưởng AC):**
- `packages/contracts/CHANGELOG.md` dòng 19 (§Changed G0/0.7):
  `(+46 test)` → `(+59 test)`. Tổng 372 đã đúng; chỉ delta sai.
- `docs/contracts/handoff-g0-0.6.md` dòng 21, 26, 31 (AC #1 evidence):
  `56 dòng cho 23 file contracts` → `48 dòng matrix` (§3 Commands 18 +
  §4 Queries 7 + §5 Events 5 + §6 Mapping DTOs 2 + §7
  Routing/Analytics/KPI/AI 12 + §8 Ports/Provider/Gateway 4 = 48 tổng).
  Các số liệu khác trong handoff 0.6 giữ nguyên.

**Không đụng** (ràng buộc cứng):
- `packages/contracts/src/**` — schema đã đóng 0.1–0.7; 0.8 chỉ review,
  KHÔNG sửa contract.
- `packages/contracts/tests/**` — fixtures đã chốt 0.7; 0.8 chỉ review,
  KHÔNG sửa fixture.
- `packages/contracts/src/index.ts` — `PACKAGE_VERSION = 0.0.7-g0.7` đã
  chốt ở 0.7.
- `packages/contracts/README.md` — đã chốt 0.7; 0.8 chỉ tham chiếu.
- `docs/contracts/decision-register.md` — đã chốt; 0.8 KHÔNG mở Q mới
  ngoài Q-1..Q-37.
- `docs/contracts/authorization-policy-matrix.md` — đã chốt 0.6; 0.8
  chỉ tham chiếu từng row.
- `docs/contracts/inventory.md` — sẽ cập nhật ở cuối đợt 0.8 (xem §"Cập
  nhật inventory" dưới).
- `packages/contracts/package.json` — KHÔNG thêm dep; version
  `0.0.7-g0.7` giữ nguyên.
- `packages/contracts/tsconfig.json` — KHÔNG sửa.

## Versions

| Component | Trước | Sau |
|---|---|---|
| PACKAGE_VERSION | `0.0.7-g0.7` | `0.0.8-g0.8-fixes` (F1–F5 bump) |
| package.json version | `0.0.7-g0.7` | `0.0.8-g0.8-fixes` (F1–F5 bump) |
| Gate 0 task | 0.7 | **0.8 (FREEZE checklist)** |

## Self-check

| Bước | Kết quả |
|---|---|
| `npm run typecheck` (packages/contracts) | **PASS** — `tsc --noEmit` strict, không lỗi |
| `npm test` (packages/contracts) | **PASS** — **385/385** fixtures (372 baseline + 13 net new F1–F5), 0 fail, 0 cancel, 0 skip |
| `git status --porcelain` (HEAD 414c54b) | **PASS** — không có tracked modified; untracked mới: `docs/reviews/gate-0-checklist.md` + `docs/contracts/handoff-g0-0.8.md` + `docs/contracts/handoff-g0-0.8.manifest.txt` |
| `git status --porcelain` working tree scope | **PASS** — chỉ có `docs/` + `packages/contracts/` + `.gitignore` + `.npm-cache/`. KHÔNG có `prisma/`, `app/api`, `apps/`, `packages/integration-store/`, `migration/`, Route Handler, `src/backend`, `src/server` |
| `packages/contracts/package.json` deps | **PASS** — `zod@3.24.2` (dep) + `typescript@5.7.3` (devDep) only |
| SHA-256 hashes (§6) | **PASS** — tính bằng `Get-FileHash -Algorithm SHA256`; tất cả khớp bảng §6 (80 file bundle) |
| Self-reference | **PASS** — checklist KHÔNG tự ghi hash của chính nó (theo task instruction) |
| Doc-only sửa | **PASS** — 2 file văn bản lỗi (a) (b) theo đúng Owner instruction; không sửa file khác |

## Snapshot & hash

Xem `gate-0-checklist.md` §6 (bảng đầy đủ SHA-256 cho 80 file bundle:
§6.1 source TS 27 + §6.2 tests 23 + §6.3 config+lockfile 3 + §6.4
Importal docs 6 + §6.5 contracts docs 21 + §6.6 package docs 3) +
`handoff-g0-0.8.manifest.txt` (SHA-256 file mới + file sửa đợt 0.8).

Self-reference lưu ý:
- `gate-0-checklist.md` KHÔNG tự ghi hash của chính nó trong §6
  (theo task instruction: "hash file này KHÔNG tự ghi trong manifest").
- `handoff-g0-0.8.md` KHÔNG tự ghi hash của chính nó.
- `handoff-g0-0.8.manifest.txt` KHÔNG tự ghi hash của chính nó.

## Decisions mới

**Không mở Q mới** trong `decision-register.md` — Owner đã đánh số Q-1..Q-37
(bao gồm G0-01..G0-11 + Q-13..Q-37); đợt 0.8 không phát hiện mismatch
bắt buộc phải sửa contract.

Decisions ghi nhận trong checklist (không phải Q mới):

1. **Owner review doc-only sửa 2 file văn bản**: `CHANGELOG.md`
   (+46 → +59); `handoff-g0-0.6.md` (56 dòng → 54 dòng). T1 chấp nhận
   và áp dụng; không ảnh hưởng AC.
2. **Phase 10 module DISABLE canonical-ready**: `kpi.ts`
   `phase10-experimental` (Q-35); `analytics.ts` `EXPERIMENTAL →
   UNAVAILABLE` (Q-9); attribution policy runtime HRP-owned, đợi P10/A.01–A.04
   domain sign-off.
3. **V7.9a Task 1.0–1.15 chưa triển khai** — chờ Owner sign-off Gate 0
   (theo §5.2 checklist).
4. **HRP-owned PR đang chờ**: Q-19 (Placement transitions), Q-33
   (signature/JWT/webhook), Q-34 (HYBRID policy), Q-37 (dual-control AI),
   Q-23 (Client domain), Q-32 runtime query API. T1 không tự OWN-issued.

## Gate / blocker

- **Gate 0**: **ĐÃ FREEZE theo Chủ nhân xác nhận** (sau đợt F1–F5 +
  doc-only fixes). Theo Owner instruction 2026-09-14: "Gate 0 đã được
  Chủ nhân xác nhận FREEZE; không cần xin lại." T1 không tự stamp
  CHECKPOINT FREEZE trong file; trạng thái Owner-confirmed ghi trong
  inventory.md / CHANGELOG.md.
- **CORE/1.0**: **READY FOR AUDIT** — T1 self-check PASS, không có
  blocking finding tự Coder phát hiện. Bằng chứng:
  - `handoff-core-1.0.manifest.txt` (32 file) đầy đủ hash.
  - Tests: contracts **398/398** PASS (gồm F2 follow-up) + CORE/1.0
    **42/42** PASS (13 config + 9 api + 9 worker + 11 panel) = **440/440**.
  - Build: `tsc --noEmit` PASS (contracts) + `tsc` PASS (integration-api,
    integration-worker, context-panel) + config loader PASS.
  - Lệnh `handoff-core-1.0.md` đã đối chiếu.
  - **Đính chính theo Owner 2026-09-14**: trước đó T1 gán verdict
    `CHANGES_REQUIRED` mà không liệt kê blocking finding cụ thể — đó
    là tự gán không có cơ sở; T1 đính chính về `READY FOR AUDIT`. Theo
    Owner instruction: "Không tạo finding chỉ để khớp verdict cũ".
  - Snapshot ổn định (untracked, HEAD 414c54b, contracts package
    `0.0.8-g0.8-fixes` pinned exact).
  - Audit PENDING — Auditor độc lập chưa review CORE/1.0 startup/config
    boundaries. Owner sẽ giao sửa theo Auditor blocking findings (nếu có)
    hoặc sang CORE/1.1 theo dependency.
- **CORE/1.1**: **READY FOR AUDIT** — T1 self-check PASS, không có
  blocking finding tự Coder phát hiện. Bằng chứng:
  - `handoff-core-1.1.md` + `handoff-core-1.1.manifest.txt` đầy đủ.
  - Tests toàn project: **466/466 PASS** (contracts 398 + CORE/1.1
    integration-api 35 [9 CORE/1.0 + 26 gateway] + config 13 + worker 9 +
    panel 11).
  - Build PASS (tsc exit 0 cho contracts + integration-api).
  - Pin contracts `0.0.8-g0.8-fixes` (Gate 0 freeze giữ nguyên; mock
    import từ `@hrp-engagement/contracts`, không sửa contracts).
  - **Đính chính theo Owner 2026-09-14**: T1 đã tự gán `CHANGES_REQUIRED`
    trước đó mà không có blocking finding cụ thể — đính chính về
    `READY FOR AUDIT` theo chỉ thị "Không tạo finding chỉ để khớp
    verdict cũ".
  - Boundaries giữ: privileged merge capability check (tier × method);
    in-memory ledger (KHÔNG durable production); SUCCESS ≠ EFFECTIVE
    (managed mode Q-19); Client domain/managed modes vẫn
    PROPOSED/UNAVAILABLE; không fake success để hoàn thành gateway.
  - Snapshot ổn định: HEAD 414c54b (Gate 0); chưa commit; working tree
    untracked.
  - Audit PENDING — Auditor độc lập chưa review CORE/1.1 startup/config
    boundaries + gateway mock behavior. Owner quyết định audit theo
    thay đổi thực tế.
- **Audit**:
  - Gate 0: đã Owner xác nhận FREEZE.
  - CORE/1.0: PASS theo Owner 2026-09-14 (manifest 32/32 khớp; CORE/1.0
    42/42 + contracts 398/398 PASS).
  - CORE/1.1: **PENDING** — T1 self-check 466/466 PASS, không có
    blocking finding tự phát hiện, chờ Auditor độc lập review startup/
    config boundaries + gateway mock behavior.
- HRP-owned PR list ở §5.3 checklist: Q-19, Q-33, Q-34, Q-37, Q-23, Q-32.
- 7 risk đã ghi ở §7 checklist: Q-33 signature protocol, Q-32 runtime
  query API, Q-34 HYBRID policy, Q-37 dual-control AI, Q-19 Placement
  transitions, Q-23 Client domain, OrgScope (Q-1 + G0-11).
- Phase 10 module (KPI/attribution) DISABLED canonical-ready;
  schema bind CONFIRMED nhưng runtime policy chưa chốt.
- Connector v1.1 đã đối chiếu nhưng Owner đã chỉ thị Master V2.6 ưu tiên;
  KHÔNG tự ý claim đã đọc HRP checkout.

## Dừng

Dừng đúng phạm vi G0/0.8. Chưa sang V7.9a Task 1.0–1.15. Owner xác nhận
Gate 0 trước implementation phụ thuộc. T1 không tự commit; không tự stamp
CHECKPOINT FREEZE.



## Cập nhật đợt F1–F5 (Gate 0 remediation)

Sau khi Owner cung cấp báo cáo Auditor chỉ ra 5 finding Gate 0, T1 đã áp
dụng F1–F5 với phạm vi khắc phục Gate 0 (không mở backend/feature mới).
Status: `CHANGES_REQUIRED` (chưa có verdict mới từ independent Auditor
sau đợt F1–F5).

### Fix status

| Fix | Status | File mới | File sửa key | Test evidence |
|---|---|---|---|---|
| **F1** Merge/Review contracts | FIXED (placeholder schema) | `src/commands/merge-review.ts` | matrix rows 3/15/16/17, `src/index.ts` exports | `tests/fixtures-fix-f1-f5.test.mjs` |
| **F2** HRP_UI gateway context | FIXED (source discriminator) | `tests/test-helpers.mjs` (src/ext) | `src/commands/intake.ts`, `src/commands/interactions.ts` | `fixtures-fix-f1-f5.test.mjs` + 7 file tests fixture migration |
| **F3** Calendar dates reuse | FIXED (no new clock policy) | — | `src/commands/identity.ts`, `intake.ts`, `analytics.ts`, `kpi.ts`, `scheduling.ts` (dob/periodStart/End/availableFromDate) | `fixtures-fix-f1-f5.test.mjs` (leap year + invalid date) |
| **F4** DNC reasons canonical | FIXED (single DncReasonSchema + alias) | `src/commands/dnc.ts` | `src/commands/identity.ts` (DncActionSchema), `suppression.ts` (import canonical) | `fixtures-fix-f1-f5.test.mjs` (canonical + legacy + normalize) |
| **F5** AI evidence refs reuse | FIXED (CommandEvidenceRefSchema) | — | `src/commands/ai-proposals.ts` (evidenceRefs in AIProposalSchema + AIProposalFieldSchema) | `fixtures-fix-f1-f5.test.mjs` (accept std, reject inline) |

### Breaking changes (version bump 0.0.7 → 0.0.8)

- `IntakeContextRefSchema` / `InteractionContextRefSchema`: đổi từ
  `{provider, connectionId, external*}` → `{source: CommandSourceSchema, external*}`.
- Identity `DncActionSchema.reason`: chấp nhận cả `PRIVACY` (legacy) và
  `PRIVACY_REQUEST` (canonical) qua `DncReasonAcceptAliasSchema`;
  `normalizeDncReason` để canonicalize.

### Q refs mới (decision-register.md)

- Q-38 (F1 contract placeholder)
- Q-39 (F2 source discriminator)
- Q-40 (F3 CalendarDate reuse)
- Q-41 (F4 canonical DNC)
- Q-42 (F5 evidence ref reuse)
- Q-43 (HRP_POLICY ≠ auto-authority)

### Audit status

- Trước F1–F5: `READY FOR INDEPENDENT AUDIT` (Auditor chưa verify).
- Sau F1–F5: `CHANGES_REQUIRED` — T1 đã áp dụng đủ 5 fix theo báo cáo;
  Owner gửi bundle cho independent Auditor recheck và ra verdict mới.

### Out-of-scope từ chối

- KHÔNG sửa shared contracts ngoài F1–F5 scope.
- KHÔNG build backend/Prisma/migration/route handler.
- KHÔNG gọi model/provider thật.
- KHÔNG tự commit/tag freeze; KHÔNG sang V7.9a.

---

## Cập nhật inventory (sau đợt 0.8)

Đợt 0.8 sẽ cập nhật `docs/contracts/inventory.md` để ghi nhận:

- Phase 0.8 hoàn tất checklist + handoff + manifest.
- Bundle Gate 0 READY FOR INDEPENDENT AUDIT (T1 self-check; chưa có
  Auditor độc lập PASS) — chờ Owner sign-off hoặc yêu cầu audit trước.
- 2 sửa văn bản Owner review (a) (b) đã áp dụng (`CHANGELOG.md` +46→+59;
  `handoff-g0-0.6.md` 56→48 dòng matrix).
- Phase 10 module disable rõ (KPI `phase10-experimental` + analytics
  `EXPERIMENTAL → UNAVAILABLE`).
- Owner sign-off bảng trống; chưa tự stamp CHECKPOINT FREEZE.
