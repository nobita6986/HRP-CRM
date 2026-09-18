# Checkpoint — GATE 0 FREEZE (đã Owner xác nhận)

**Ngày**: 2026-09-14.
**T1 (Coder)** đối chiếu working tree với snapshot đã audit trước khi
ghi checkpoint. Bundle đã đạt điều kiện freeze theo Execution Guide §5.3.

> Checkpoint này **KHÔNG** cấp quyền push/deploy/provider thật; chỉ xác
> nhận bundle contracts đã freeze cho V7.9a implementation phụ thuộc.
> Mọi quyết định nghiệp vụ còn thiếu (xem §Blocked paths) vẫn chưa chốt
> và phải qua Owner-owned PR.

## 1. Verdict / snapshot / version / Owner xác nhận

| Mục | Giá trị |
|---|---|
| Verdict | `Auditor PASS` (Owner xác nhận theo snapshot 2026-09-14) |
| Bundle HEAD | `414c54bfa2e227ec1a25694310e48908e0d67abe` (Importal docs) |
| Working tree | untracked; `git status --porcelain` không tracked modified |
| Snapshot manifest | `docs/contracts/handoff-g0-0.8.manifest.txt` (85 file) |
| Snapshot checksum | SHA-256 của manifest — xác minh tại thời điểm ghi checkpoint |
| Package version | `0.0.8-g0.8-fixes` (`packages/contracts/package.json` + `PACKAGE_VERSION`) |
| Test count | `npm test` 398/398 fixtures PASS (385 F1–F5 + 13 F2 follow-up) |
| Typecheck | `npm run typecheck` PASS |
| Audit status | **GATE 0 FREEZE** (Owner confirm) |
| Owner | Chủ nhân (sign-off cuối) |
| Coder | T1 |
| Independent audit | đã có verdict PASS cho snapshot trước F2 follow-up; F2 follow-up được áp dụng theo báo cáo Auditor recheck |

## 2. Đối chiếu working tree ↔ snapshot đã audit

Trước khi ghi checkpoint, T1 đối chiếu working tree với snapshot đã audit:

- HEAD `414c54b` không đổi; chỉ Importal docs là tracked tại HEAD.
- Source/tests/config/lockfile code untracked tại working tree (đúng
  với mọi đợt trước — Owner/Chủ nhân cung cấp repo chưa commit code).
- `git diff --stat HEAD`: rỗng (không có tracked file bị modify).
- `git status --porcelain`: chỉ untracked (`docs/Importal/`, `docs/contracts/`,
  `docs/reviews/`, `packages/contracts/`, `.gitignore`) — đúng pattern
  cũ.
- Manifest 85 entry đối chiếu với file trên disk: 117 hash occurrences,
  0 mismatch, 0 missing (verify bằng Python script sau khi sửa — xem
  `_verify_manifest.py` ad-hoc; script đã xóa).

Sau khi đối chiếu pass, T1 update 2 dòng trong
`docs/contracts/handoff-g0-0.8.manifest.txt`:
- Header: `Trạng thái hiện tại: CHANGES_REQUIRED` → `**GATE 0 FREEZE**`
  + ghi CHECKPOINT ref.
- §M.9 footer: `Audit status: CHANGES_REQUIRED` → `**GATE 0 FREEZE**` +
  thêm note "Checkpoint KHÔNG cấp push/deploy/provider thật".

Không sửa bất kỳ contract/test/file schema nào ngoài 2 dòng header/footer
manifest.

## 3. Path bị chặn bởi quyết định chưa chốt

Vẫn giữ nguyên path bị chặn — không mở quyết định nghiệp vụ mới trong
đợt này (xem `docs/contracts/decision-register.md` + `inventory.md`):

- **G0-06 (Q-6)** Case domain transitions — `OPEN_STATUS_TRANSITIONS`
  chưa chốt; `PlacementCase.stage` open set chỉ có enum chính thức, không
  tự giới hạn NEW/CONTACTING/QUALIFYING.
- **G0-07 (Q-7)** HRP review pre/post-apply — workflow review chưa chốt;
  `merge-review.ts` placeholder schemas (F1) dùng `PROPOSED/UNAVAILABLE`
  marker.
- **G0-08 (Q-8)** Managed mode — placement EFFECTIVE workflow unknown;
  Owner-owned PR riêng.
- **Q-19** PlacementCase open-status/transitions — chưa chốt transitions
  matrix.
- **Q-21** Talent/Client interaction auth/delegation — auth design chưa
  xác minh; schema bind shape, runtime gate HRP-owned.
- **Q-22** `occurredAt/effectiveAt/recordedAt` order — không enforce rule
  chưa duyệt (Q-22 đã chốt invariant baseline).
- **Q-23** Client required context — ClientCompany đã có theo connector;
  field bindings còn PROPOSED, không thay bằng Talent.
- **Q-33** Signature/JWT/webhook algorithm — schema allowlist, runtime
  algorithm chưa xác minh.
- **Q-34** HYBRID policy — đề xuất kỹ thuật; chưa chốt authority.
- **Q-37** Dual-control AI — runtime HRP gate; `commitReviewDecision`/
  `mergeLaborProfiles` workflow PROPOSED.

Các Q trên **KHÔNG mở** trong đợt này; V7.9a Task 1.0+ implementation
phải chờ Owner-owned PR cho từng Q.

## 4. Scope đã đóng (Gate 0)

Đã chốt và đối chiếu đầy đủ tại Gate 0 bundle:

- G0/0.0 — Inventory nguồn & ownership (`docs/contracts/inventory.md`).
- G0/0.1 — Enums & constants (`src/enums.ts`).
- G0/0.2 — Envelopes + error taxonomy (`src/envelopes.ts`, `src/errors.ts`,
  `src/primitives.ts`).
- G0/0.3a–0.3h — Identity/evidence/profile/intake/case/interactions/
  availability/suppression/nextAction/scheduling/outbox/gateway/providers/
  ports.
- G0/0.4 — Queries/events/mappings.
- G0/0.5 — Routing/analytics/KPI/AI mock UI.
- G0/0.6 — Authorization/policy matrix (`docs/contracts/authorization-policy-matrix.md`).
- G0/0.7 — Shared fixtures + README + CHANGELOG.
- G0/0.8 — Review bundle + F1–F5 + F2 follow-up remediation.

## 5. F1–F5 + F2 follow-up status

| Fix | Status | File |
|---|---|---|
| F1 Merge/Review contracts | CLOSED | `src/commands/merge-review.ts` |
| F2 HRP_UI gateway context (đợt 1) | CLOSED | `src/commands/intake.ts`, `src/commands/interactions.ts` |
| F2 follow-up HRP_UI gateway context (đợt 2) | CLOSED | `src/commands/gateway.ts` (`HrpGatewayCallContextSchema`) |
| F3 Calendar dates reuse | CLOSED | `identity.ts`, `intake.ts`, `analytics.ts`, `kpi.ts`, `scheduling.ts` |
| F4 DNC reasons canonical | CLOSED | `src/commands/dnc.ts` + `identity.ts`, `suppression.ts` |
| F5 AI evidence refs reuse | CLOSED | `src/commands/ai-proposals.ts` |

Tất cả F1–F5 + F2 follow-up đã áp dụng đúng theo báo cáo Auditor;
không sửa gì thêm sau đợt F2 follow-up.

## 6. Constraints đã giữ (Gate 0)

- KHÔNG build Prisma/migration/route handler/domain service backend.
- KHÔNG gọi model/provider thật.
- KHÔNG tự commit git (HEAD vẫn `414c54b`).
- KHÔNG tự stamp CHECKPOINT FREEZE trước Owner xác nhận.
- KHÔNG tự chuyển sang V7.9a Task 1.0+ trước khi ghi CHECKPOINT FREEZE.
- KHÔNG mở Q mới ngoài Q-1..Q-44 (Q-44 chỉ ghi nhận F2 follow-up, không
  mở rộng scope).
- KHÔNG tự chốt review workflow/transitions/Client domain/managed mode.

## 7. Snapshot manifest verification

| File | SHA-256 (working tree tại thời điểm ghi) |
|---|---|
| `docs/contracts/handoff-g0-0.8.manifest.txt` | xác minh bằng `Get-FileHash` |
| `docs/reviews/gate-0-checklist.md` | xác minh bằng `Get-FileHash` |
| `packages/contracts/package.json` | version `0.0.8-g0.8-fixes` |

Owner verify lại bằng:

```bash
Get-FileHash docs/contracts/handoff-g0-0.8.manifest.txt -Algorithm SHA256
Get-FileHash docs/reviews/gate-0-checklist.md -Algorithm SHA256
```

## 8. Limitations & known open

- 7 critical Phase 9 decisions cần Owner chốt trước V7.9a implementation
  phụ thuộc (xem §Blocked paths).
- Checkpoint này chỉ là bundle contracts freeze — không phải runtime/
  infrastructure freeze.
- HRP-owned runtime (canonical Prisma, auth provider, signature protocol,
  Client domain) vẫn chưa triển khai.
- V7.9a Task 1.0+ (scaffold/mock/receiver/store/queue) là implementation
  mới dựa trên Gate 0 contracts; sẽ chạy sau checkpoint này.
