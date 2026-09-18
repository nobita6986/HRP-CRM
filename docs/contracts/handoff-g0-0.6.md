# G0/0.6 — Handoff

HEAD: 414c54bfa2e227ec1a25694310e48908e0d67abe
Branch: main
Date: 2026-09-13 12:30 (UTC+7)
Package version: 0.0.6-g0.5 (chưa bump; matrix là tài liệu, không
chạm schema).
Coder: T1
Owner: Chủ nhân (review bundle trước Gate 0 freeze)
Auditor: PENDING — gom bundle Gate 0 trước freeze.

Nguồn: Backlog Gate0 §Task 0.6, Master V2.6 §13,
hrp-connector v1.1 HEAD 414c54b.
Dependency 0.1–0.5 có self-check; chưa freeze / chưa independent audit
PASS.

## AC & evidence

| AC | Trạng thái | Evidence |
|---|---|---|
| Mỗi command/query có: required actor kind (USER/SERVICE/DELEGATED_USER), required scope (organizationId + actor delegation ref), required object permission (target canonical id + version), audit requirements (effectiveAt/recordedAt/actor/source/target/command/version/result), retry class (theo errors.ts taxonomy) | DONE self-check | `authorization-policy-matrix.md` bảng markdown 1 dòng/command-query; **48 dòng matrix** (§3 Commands 18 + §4 Queries 7 + §5 Events 5 + §6 Mapping DTOs 2 + §7 Routing/Analytics/KPI/AI 12 + §8 Ports/Provider/Gateway 4) cho 23 file contracts (identity, evidence, profile, intake, placement-case, interactions, availability, next-action, scheduling, suppression, outbox, gateway, providers, ports, queries, events, mappings, routing, analytics, kpi, ai-proposals, ai-provider-config) + cột theo AC. Cross-reference Q-1..Q-37. |
| Phân biệt rõ schema validation (AC đã đạt 0.1–0.5) vs runtime gate (PENDING HRP-owned): auth, capability check, one-active-case, merge approval, CCCD residency, HRP review, signature/JWT/webhook algorithm (Q-33 marker), idempotency retention, fencing, DNC cut-off | DONE self-check | Cột `Schema validation status` ∈ {CONFIRMED (AC), PROPOSED (runtime)}; mỗi dòng ghi rõ "CONFIRMED shape; runtime gate X unknown". §0 nguyên tắc phân biệt schema (313/313 PASS) vs runtime gate HRP-owned PENDING. |
| BoD aggregate KHÔNG mặc định transcript/evidence; secret operator KHÔNG mặc định đọc CCCD/transcript | DONE self-check | Matrix ghi chú Master §13.5–8 + Backlog §0.5 cho BoD; Master §13.5 + Backlog §0.3h cho secret operator. Audit fields cho BoD không bao gồm transcript. |
| KHÔNG tự đặt JWT algorithm/signature protocol cho Zalo khi chưa xác minh; ghi nhận signature provider và API auth là hai ranh giới riêng | DONE self-check | §0 ghi rõ (Backlog §0.6 AC #4 + Q-33); matrix ghi `WEBHOOK_SIGNATURE_ALGORITHMS` allowlist marker; cảnh báo "T1 KHÔNG tự đặt"; `Q-33` refs. |
| Cross-reference tới từng Q trong decision-register (Q-1..Q-37) mà matrix chạm tới; Q còn open vẫn ghi PROPOSED, KHÔNG biến thành confirmed | DONE self-check | Cột `Q refs` cross-reference Q-1..Q-37. Q còn open (Q-19, Q-31, Q-33) ghi `runtime gate X PROPOSED` / `unknown`. |
| Matrix bằng bảng markdown, 1 dòng/command-query; cột theo AC trên | DONE self-check | `authorization-policy-matrix.md` 48 dòng matrix (§3 Commands 18 + §4 Queries 7 + §5 Events 5 + §6 Mapping DTOs 2 + §7 Routing/Analytics/KPI/AI 12 + §8 Ports/Provider/Gateway 4) + 2 bảng support (Tier + Retry class mapping). |

## Source files

**Mới (Gate 0/0.6 — chỉ tài liệu, không chạm schema):**
- `docs/contracts/authorization-policy-matrix.md` — 330 dòng; 48 dòng
  matrix cho 23 file contracts; §0 nguyên tắc, §1 cột matrix,
  §2 retry class mapping, §3 matrix commands (HRP_GATEWAY_METHODS +
  scheduling batch), §4 matrix queries/events/mappings,
  §5 matrix configs/ports/providers/gateways, §6 BoD / secret rules,
  §7 cross-aggregate leak rules, §8 signature provider vs API auth,
  §9 audit fields minimum, §10 references.

**Không sửa**:
- `packages/contracts/src/**` — schema đã đóng 0.1–0.5; matrix mô tả
  policy boundary, KHÔNG sửa contract.
- `docs/contracts/decision-register.md` — matrix tham chiếu Q-1..Q-37;
  KHÔNG tự mở Q mới; Q còn open giữ nguyên `unknown` / `PROPOSED`.

## Versions

| Component | Trước | Sau |
|---|---|---|
| PACKAGE_VERSION | `0.0.6-g0.5` | `0.0.6-g0.5` (matrix là tài liệu) |
| Tests | 313 | 313 (không thêm) |
| Files added | — | authorization-policy-matrix.md |

## Self-check kết quả

- `npm run build` (tsc): PASS.
- `npm run typecheck` (tsc --noEmit): PASS.
- `node --test tests/*.test.mjs`: **313/313 PASS**, 0 FAIL.
- Matrix markdown render OK; cross-reference Q-1..Q-37 đầy đủ.
- **Matrix là tài liệu mô tả, KHÔNG phải runtime test** — Owner chỉ thị
  "không test runtime matrix"; markdown self-check.

## Snapshot & hash

HEAD git: `414c54bfa2e227ec1a25694310e48908e0d67abe` (chưa commit mới).

Hash file chính (xem `handoff-g0-0.6.manifest.txt`):

```
134A0E879F1E21C2DE5B5F8AB067AAB9FD8B2DCC3BAE505D9AA2177C07E50EB5  docs/contracts/authorization-policy-matrix.md
```

Hash các file đã đóng 0.1–0.5 tham chiếu trong matrix (xem manifest
0.5 và 0.6). Bundle Gate 0 tổng cộng 313/313 fixtures PASS tại HEAD
414c54b.

## Decisions mới / thay đổi trong bundle

- **KHÔNG mở Q mới**: matrix mô tả policy boundary đã có trong Q-1..Q-37;
  cross-reference mà không chuyển trạng thái.
- **Q còn open** giữ nguyên:
  - Q-19 (open-status set / transitions) → PROPOSED.
  - Q-20 (SUCCESS không trigger EFFECTIVE) → CONFIRMED trong schema
    (CLOSED-only), workflow placement riêng chưa chốt.
  - Q-31 (transport PUSH_WEBHOOK default) → PROPOSED.
  - Q-33 (signature/JWT/webhook algorithm) → PROPOSED; không tự đặt.

## Gate bị ảnh hưởng

- Gate 0 freeze: matrix thêm tài liệu mô tả; KHÔNG thay schema; bundle
  tổng 313/313 fixtures PASS.
- V7.9a (CORE 1.x): chưa triển khai — chờ Gate 0 freeze.
- Runtime gate HRP-owned: matrix là ranh giới mô tả — implementation
  runtime chờ Auditor review bundle tổng.

## Blockers / open questions

- Audit Gate 0 bundle PENDING; T1 self-check không thay Auditor.
- Matrix là tài liệu mô tả, KHÔNG tự PASS = freeze Gate 0. Owner
  xác nhận Gate 0 trước backend.
- Signature provider / JWT / webhook algorithm (Q-33) chưa tự đặt;
  cần Auditor kiểm ở bundle cuối.
- Client domain contract (Company/Contact/Opportunity/Interaction) vẫn
  PROPOSED.
- Open-status set / transitions matrix (Q-19) chưa chốt.
- Implementation query API runtime cho Q-32 để Phase V7.9a HRP-owned.

## Limits / risk

- Matrix dựa trên schema contracts 0.1–0.5 + Q-1..Q-37; nếu schema
  thay, matrix phải đối chiếu lại.
- Runtime gate PROPOSED mô tả chính sách HRP-owned; implementation
  runtime là HRP-owned PR, KHÔNG thuộc Gate 0.
- Một số command có `Schema status = PROPOSED` (e.g.,
  `mergeLaborProfiles`) do runtime gate PRIVILEGED_MERGE chưa cụ thể;
  schema bind shape CONFIRMED nhưng gate authority PROPOSED.
- BoD / secret rules mô tả ranh giới nghiệp vụ; runtime policy cần
  HRP-owned PR quyết.

## Dừng

Đúng phạm vi G0/0.6. Chưa sang 0.7 hoặc 0.8.
Owner xác nhận Gate 0 trước khi tiếp tục.
