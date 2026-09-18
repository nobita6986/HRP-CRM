# Đối chiếu `contracts.synthetic.mjs` với baseline Gate 0

File `contracts.synthetic.mjs` là bộ test do agent nội bộ đặt trước khi
Coder chính thức nhận workspace. Theo chỉ thị Owner:

> Test do agent nội bộ để lại không mặc định BLOCKED-OWNER.
> Bạn được đối chiếu baseline, hợp nhất phần hợp lệ và loại phần
> sai/trùng khỏi suite chính với lý do rõ. Không loại kiểm tra
> rủi ro hợp lệ chỉ để tests pass. Báo rõ coverage bị loại.

Tài liệu này ghi rõ phần đã hợp nhất, phần bị loại, lý do, và
coverage còn lại cần Owner/HRP-side quyết.

---

## Phần đã hợp nhất vào suite chính

| # | Nội dung test trong synthetic | Vị trí hợp nhất | Lý do hợp nhất |
|---|---|---|---|
| 1 | `ExternalContactMatchStateSchema` accept `EXACT_MATCH`/`POSSIBLE_MATCH`/`UNRESOLVED`; reject `NEW_PROFILE` (Backlog §0.3a: NEW_PROFILE không là mapping state thứ tư) | `enums-extra.test.mjs` (4 fixtures mới) | Schema mới `ExternalContactMatchStateSchema` được thêm vào `enums.ts`. Phân biệt với `MatchingOutcomeSchema` (command result, có NEW_PROFILE). |
| 2 | `MatchingOutcomeSchema` (alias `IdentityMatchOutcomeSchema`) reject `UNRESOLVED` (UNRESOLVED là mapping state, không phải command result) | `enums-extra.test.mjs` (2 fixtures) | Hai schema khác nhau rõ ràng; Backlog §0.3a chốt phân biệt. |
| 3 | `CalendarDateSchema` reject `2026-02-29` (không leap), `2026-04-31`, `2026-13-01`, accept `2024-02-29` | `enums-extra.test.mjs` (4 fixtures) | Bảo vệ chống ngày không hợp lệ. Áp dụng cho `availableFromDate` (Q-15). |
| 4 | `IdempotencyKeySchema` boundary 256 chars OK / 257 reject | `enums-extra.test.mjs` (2 fixtures) | Đã có max=256; test boundary rõ. |
| 5 | `ExpectedVersionSchema` non-negative integer; reject -1, 1.5, Infinity | `enums-extra.test.mjs` (2 fixtures) | Schema hiện `z.number().int().min(0)`. |

Tổng: **14 fixtures** đã hợp nhất vào suite chính (ngoài 75 hiện có
từ các đợt trước → bundle Gate 0 hiện có 89 fixtures).

---

## Phần bị loại — LÝ DO RÕ

Các phần sau bị loại vì mâu thuẫn baseline Master V2.6 / Backlog Gate 0
hoặc nằm ngoài phạm vi Gate 0 contracts:

### A. API surface chưa có trong baseline

| API trong synthetic | Baseline Gate 0 | Lý do loại |
|---|---|---|
| `c.defineCommandContract(name, request, response)` | chưa có factory trong package | Tự ý thêm factory sẽ mở rộng public API ngoài Backlog; Gate 0 chỉ DTO + envelope + enum, chưa có command factory. Giữ nguyên: caller build envelope thủ công. |
| `c.OpaqueIdSchema` | tách thành `CanonicalIdSchema`, `CommandIdSchema`, `CorrelationIdSchema`, `OrganizationIdSchema`, `ConnectionIdSchema` (primitives) | Baseline đã chốt opaque id per-purpose với size/regex riêng; alias `OpaqueIdSchema` chung sẽ lỏng invariant per-id. |
| `c.EntityVersionSchema` | `ExpectedVersionSchema = z.number().int().min(0)` | Cùng logic; alias `EntityVersionSchema` sẽ trùng tên. |
| `c.UtcTimestampSchema` (strict UTC, reject offset) | `IsoTimestampSchema = z.string().datetime({ offset: true })` | Baseline chấp nhận offset (ISO 8601 đầy đủ); reject offset làm payload của connector events fail. Giữ baseline. |
| `c.OperationQuery` (query operation bằng org/cmd/op) | chưa có | Backlog §0.2 chỉ ràng buộc envelope + idempotency; operationQuery schema là G0/0.7 dependent. |
| `c.ERROR_POLICIES`, `c.errorMessagesVi`, `c.validateContract()` | `ErrorCodeSchema`, `StructuredErrorSchema`, `ERROR_RETRYABLE_DEFAULT`, `ERROR_HTTP_HINT` (errors.ts) | Baseline tách policy vs message; không gộp helper `validateContract` (Gate 0 chưa có boundary helper, để cho HRP-owned runtime tự build). |
| `c.ContractErrorSchema` | `StructuredErrorSchema` | Same schema; alias thừa. |
| `fixture.request/response` do `defineCommandContract` trả về | caller ghép envelope thủ công | Baseline đã cho `RequestEnvelopeBase` + `AcceptedResponseSchema`/`AppliedResponseBaseSchema`/`FailedResponseSchema`. |

### B. Actor API mâu thuẫn baseline

| Synthetic | Baseline | Lý do loại |
|---|---|---|
| `actor.kind = 'DELEGATED_USER' { serviceId, userId, delegationRef }` | `ActorKind = USER \| SERVICE` + `principalId` + optional `delegatedBy` | Baseline đơn giản; `delegatedBy` (string optional) đủ cho delegation reference; thêm kind thứ 3 là mở rộng API. G-03 trong decision-register xác nhận baseline hiện tại. |

### C. Schema version

| Synthetic | Baseline | Lý do loại |
|---|---|---|
| `rejects(fixture.request, {schemaVersion: '1'})` | `SchemaVersionSchema = z.literal('1')` (hiện SCHEMA_VERSION='1') | Synthetic muốn wire version 'g0-envelope-0.1' style; baseline đang dùng simple literal '1'. Tạm giữ baseline để khớp với Master §7.2.2. Khi Owner/HRP-side chốt wire version cụ thể (vd: 'g0-envelope-0.1') sẽ bump literal. Test trùng cũ với baseline hiện. |

### D. UI/i18n layer

| Synthetic | Baseline | Lý do loại |
|---|---|---|
| `c.placementCaseStageLabelsVi`, `c.caseCloseReasonLabelsVi`, `c.availabilityLabelsVi`, `c.currentRelationshipLabelsVi` | enum values đã có trong `enums.ts` (đã có label maps cho vài enum: AVAILABILITY_LABELS_VI, CURRENT_RELATIONSHIP_LABELS_VI, …); đầy đủ label map là UI/i18n layer | Gate 0 scope chỉ DTO + contracts; label maps thuộc UI/i18n. Đã có sẵn label maps cho 3 enum; thiếu label map cho PlacementCaseStage và CaseCloseReason. Coder sẽ thêm trong G0/0.6 (nếu thuộc scope) hoặc đẩy sang UI/i18n task. |

### E. Rủi ro hợp lệ KHÔNG bị loại — đã cover ở suite chính

| Synthetic | Suite chính | Status |
|---|---|---|
| Error taxonomy không leak stack/SQL/providerBody/message/secret/details | `errors.test.mjs` `makeError cấm chứa raw stack/provider body` + `field path phải là JSON pointer` | Đã cover |
| Field path không echo PII / JSON pointer format | `errors.test.mjs` `field path phải là JSON pointer, không chứa giá trị` | Đã cover |
| messageKey bắt buộc, retryClass enum | `errors.test.mjs` `retry defaults: validation/forbidden/version conflict không retry` + `timeout/http hint` | Đã cover |
| ACCEPTED/APPLIED/FAILED discriminate | `envelopes.test.mjs` `ACCEPTED response có operation reference, không có data` + `APPLIED response yêu cầu data, errors rỗng` + `FAILED response không được có data hữu dụng` | Đã cover |
| 8 placementCaseStage values + 9 closeReason + 5 availability + 5 current relationship + 3 next action | `enums.test.mjs` (9 fixtures) | Đã cover |
| FORBIDDEN_CLOSED_VARIANTS reject | `enums.test.mjs` `closed_variants cấm luôn bị reject` | Đã cover |

Coder không loại phần nào có rủi ro hợp lệ chỉ để tests pass; mọi
test rủi ro (error taxonomy, envelope invariants, id bounds, enum
values, FORBIDDEN variants) đều có trong suite chính.

---

## Coverage còn lại cần Owner/HRP-side quyết

Các coverage sau KHÔNG có trong cả synthetic lẫn suite chính, cần
Owner/HRP domain quyết trước khi thêm vào Gate 0:

1. **`PlacementCaseStage` + `CaseCloseReason` Vietnamese labels** —
   UI/i18n task. Đề xuất: thêm vào G0/0.6 hoặc đẩy sang UI repo.
2. **Wire schema version cụ thể** (`'g0-envelope-0.1'`?) — Master
   chưa chốt. Hiện baseline dùng literal `'1'`; bump cần audit.
3. **`OperationQuery` DTO** — query operation durable ref. Backlog
   §0.7; chưa thuộc Gate 0 contracts.
4. **Actor kind DELEGATED_USER vs baseline `delegatedBy`** —
   decision-register G-03 ghi "unknown". Cần HRP-side auth spec.
5. **Operation storage/query service** — runtime; Gate 0 không build.
6. **`validateContract` boundary helper** — có thể thêm nếu HRP-side
   cần, nhưng đó là utility, không thuộc DTO contracts.

---

## Trạng thái hiện tại

- File `contracts.synthetic.mjs`: giữ nguyên nội dung, vẫn exclude
  khỏi `node --test tests/*.test.mjs` (extension không phải
  `.test.mjs`).
- Phần hợp lệ đã được hợp nhất: 14 fixtures mới ở
  `enums-extra.test.mjs`.
- Trạng thái: **HỢP NHẤT MỘT PHẦN** — không BLOCKED-OWNER mặc định;
  còn lại coverage cần Owner/HRP quyết theo mục trên.
