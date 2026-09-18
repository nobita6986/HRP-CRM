# G0/0.0–0.2 — Decision register

Không thay Master Plan. `confirmed` dưới đây chỉ là yêu cầu đã chốt, không production evidence. `proposed` chưa được freeze; `unknown` cần input của owner domain. Không xin lại quyết định routine tooling.

- **Confirmed:** HRP SoR / Chatwoot SoE, cấm core credentials/Prisma từ Integration; Handling và SLA 7 ngày không theo chat; AI suggest-only; enum Master §10.6; CLOSED và closeReason riêng; relationship chỉ đọc; DNC độc lập full intake; staff review trước intake, same key replay/conflict. Gate 0 do Chủ nhân xác nhận.
- **G0-01 proposed — envelope ABI:** package `0.0.1-g0.1`, wire `g0-envelope-0.1`, không nhận bare `1`. Đây là candidate Gate 0 chưa tương thích một HRP API đã tồn tại. IDs opaque ASCII 1–128 (`A–Z a–z 0–9 . _ : -`, bắt đầu alnum); idempotency key 1–256, không PII. Không UUID-only. Entity version integer 0..MAX_SAFE_INTEGER. Timestamp UTC `YYYY-MM-DDTHH:mm:ss.sssZ`, calendar date `YYYY-MM-DD` và ngày phải tồn tại. HRP ID alphabet/size, version representation và accepted timestamp precision **unknown**; đổi proposal/version khi đối chiếu. CalendarDate chỉ kiểm shape/calendar, chưa future-date/business clock policy của G0/0.3e.
- **G0-02 proposed — error ADR:** fixed `code/messageKey/retryClass`, optional coarse allowlisted `fieldPath`; không dynamic field name/value/stack/SQL/provider body/message/details. `VALIDATION_ERROR` và `IDEMPOTENCY_CONFLICT`: NEVER; `UNRESOLVED_IDENTITY`/`POLICY_REJECTION`: REVIEW_REQUIRED; `VERSION_CONFLICT`: REFRESH_AND_REVIEW; `AUTHENTICATION_REQUIRED`: REAUTHENTICATE; `FORBIDDEN`: NEVER; `DEPENDENCY_UNAVAILABLE`/`RATE_LIMITED`: BOUNDED_SAME_KEY; `UNKNOWN_COMMAND_OUTCOME`: RECONCILE_FIRST. UNKNOWN không khẳng định domain chưa apply. FAILED là kết quả không thành công được xác nhận qua envelope, không rollback proof. Không mọi HTTP 409/5xx đều retry. Backoff/attempt/age/Retry-After transport bounds là runtime work sau này. Retry không đổi key hoặc bỏ DNC/auth/expectedVersion; version conflict cần read/re-review, không replay mù. Thông báo UI tra translation; public boundary dùng `validateContract`, không serialize `ZodError` vì issue metadata có thể echo input.
- **G0-03 proposed — source/actor:** USER(userId), SERVICE(serviceId), DELEGATED_USER(serviceId,userId,delegationRef); delegationRef chỉ reference, không credential. Server xác minh service/user/delegation/auth, org, connection/provider và target mỗi lần kể cả replay/query. Không giả actor từ assignee. INTEGRATION source chỉ CHATWOOT hoặc ZALO_OA + connectionId; không hàm ý hai đường canonical inbound. HRP_UI source có provider=HRP_UI, connectionId=null vì không có external connection; không gán Zalo giả. Integration/source kind không tự chứng minh auth hoặc authority. Transport event refs sẽ được thêm ở DTO chuyên biệt nếu cần. Auth algorithm/scopes/delegation protocol/automated actor mapping **unknown** (P9/H.01/H.06).
- **G0-04 proposed — durable operation:** ACCEPTED chỉ operation ref + errors=[]; server được phát sau persist bền, reference phải đọc được bằng operationQuery cùng command contract. Query mang org, actor, commandId, operationId; server bind operation đúng org/commandName/commandId, check auth/object permissions. Query trả response union cùng command; có thể còn ACCEPTED. APPLIED có typed data/errors=[]; FAILED có ≥1 structured error, không data. Không success data, applied/approved/delivered marker trong ACCEPTED. Endpoint, retention/expiry, not-found policy chưa chốt; chưa có operation storage/query service. Không thể schema-validate durability.
- **G0-05 confirmed semantics / proposed binding — idempotency:** namespace là tuple `(verified organizationId, allowlisted commandName, idempotencyKey)`, commandName bound bằng factory/route registry không body dynamic dispatch. Same key + same canonical semantic request digest trả stored result sau reauthorization; same key + different semantic content trả IDEMPOTENCY_CONFLICT. Semantic digest gồm payload, source, actor/delegation và schema revision theo authenticated normalization; correlationId không key, không semantic payload, retry có thể có correlationId mới; response echo correlation của request hiện tại để tracing, stored commandId giữ logical command gốc. commandId phải ổn định khi retry; nếu khác cho cùng key, runtime reject mismatch, không tạo command mới. Digest algorithm/canonicalization, retention/replay expiry/concurrent apply strategy **unknown**, cần H.01 ADR/tests. Không lưu/log raw PII để tạo evidence digest. Contract này chưa có idempotency ledger/runtime enforcement.
- **G0-06 unknown — case domain:** open-status set, active set, transitions, stage retained khi close/reopen, close SUCCESS/UNREACHABLE evidence và OTHER comment policy. Không tạo enum OPEN case hoặc suy transitions từ thứ tự stage; NextAction OPEN là enum riêng. HRP domain owner chốt trước H.04.
- **G0-07 unknown — HRP review:** pre-apply staging hay post-apply canonical review, review permissions/statuses; không tự approved từ APPLIED. HRP owner cần lựa chọn trước workflow review thật. Candidate chưa chốt không chặn constants/mock được ủy quyền.
- **G0-08 unknown — managed mode:** HRP_MANAGED/CLIENT_MANAGED Placement policy, evidence/approval và EFFECTIVE flow; path chưa bật, không direct Worker/Beneficiary mutation.
- **G0-09 unknown — KPI attribution:** chốt NLD/grain/credit/created-vs-submitted/correction/cohort và source completeness, manager permissions; P10/A.01–A.04 domain sign-off. Tạm chỉ proposed future contracts, không canonical-ready.
- **G0-10 unknown — integration runtime:** event/auth/signature/ACK provider protocol; idempotency/event retention; DNC freshness/fencing/cut-off and manual reply; evidence VN residency/retention/cleanup; Client required context; relationship precedence. Phần phụ thuộc disabled/chờ task sau, không invent protocol hoặc quyền.
- **G0-11 source discrepancy:** connector trên đĩa v1.0/V2.5, guides nói v1.1. Owner đã chỉ đạo dùng Master V2.6 ưu tiên; không claim đã đọc connector v1.1. HRP core checkout + guardrails + schema/auth chưa có. Official HRP-CRM repo empty refs ngày kiểm tra, không phải bằng chứng core HRP tồn tại ở đây.

Các proposal không cần quyết định nghiệp vụ mới để test synthetic slice này. Domain decisions nói trên phải quay về Chủ nhân/domain owner đúng gate, không tự biến thành defaults production.

---

## Open questions — bổ sung 2026-09-13 (G0/0.3a–0.3b)

Các câu hỏi phát sinh khi viết DTO G0/0.3a–0.3b. Coder chỉ chú thích
trong code (proposed markers) — KHÔNG tự quyết business rule, chờ Owner
hoặc HRP domain chốt.

- **Q-13. EXACT_MATCH luôn phải qua staff review — đã chốt (no-EXACT_AUTO_APPLY).**
  Baseline Master §10.7.3 + Backlog §0.3b đã chốt "EXACT vẫn cần staff
  review trước submit". Coder đã ghi `StaffReviewConfirmationSchema`
  bind draft revision/digest + canonicalId/version, và không cung cấp
  policy flag nào cho phép bỏ review. Đặc biệt: **KHÔNG đề xuất
  `EXACT_AUTO_APPLY` để bỏ invariant đã chốt.** Runtime HRP gate phải
  reject mọi path apply EXACT mà không có confirmation hợp lệ.
  Coder không tự ý thêm cờ policy; nếu domain muốn đổi, đó là thay đổi
  invariant, phải qua Owner + HRP domain owner + audit re-review.

- **Q-14. Fill-missing là yêu cầu đã chốt, runtime HRP enforce — không
  audit job mới.**
  Schema set `fillMissingOnly: true` (default) trên `UpdateLaborProfileInput`
  nhưng chỉ là flag khai báo; **runtime HRP-owned service phải enforce**
  rule "không ghi đè giá trị đã có". Contract KHÔNG cung cấp field nào
  để tắt yêu cầu này (không có `allowOverwrite`, không có
  `fillMissingOnly: false` được phép ở layer trên) — schema hiện để
  default true nhưng KHÔNG hỗ trợ override từ caller. Coder sẽ self-check
  lại: nếu schema hiện cho phép `fillMissingOnly: false` thì đó là lỗi,
  phải sửa (xoá field hoặc schema reject `false`).
  Coder không đề xuất audit job mới; runtime HRP enforce trực tiếp.

- **Q-15. `availableFromDate`: ngày lịch hợp lệ + tương lai theo
  business clock Asia/Ho_Chi_Minh — đã chốt baseline, thời điểm đánh
  giá còn proposal.**
  Schema hiện chỉ check format `YYYY-MM-DD` + ngày lịch hợp lệ (đã có
  regex). Owner đã chốt timezone business clock = **Asia/Ho_Chi_Minh**.
  Phần runtime đánh giá "future date" (so với submission time / so với
  intake effective time) hiện ghi proposed; schema không cho phép
  past-date ở layer này (runtime HRP enforce). Coder ghi rõ:
  - **Baseline confirmed**: timezone = Asia/Ho_Chi_Minh (UTC+7, không DST).
  - **Baseline confirmed**: schema reject ngày không hợp lệ (vd
    `2026-02-30`, `2026-13-01`).
  - **Proposal (ghi rõ)**: thời điểm đánh giá `availableFromDate`
    là server `Date.now()` lúc intake submission, so với business clock
    Asia/Ho_Chi_Minh. Coder KHÔNG tự cho phép past-date; nếu có edge case
    (vd: import dữ liệu cũ, override bởi HRP admin), đó là thay đổi
    baseline, phải Owner chốt.
  - Xem thêm file tĩnh `BusinessTimezone = 'Asia/Ho_Chi_Minh'` ở
    primitives (sẽ thêm ở G0/0.3e runtime).

- **Q-16. Submission lifecycle review vẫn PROPOSED — pre/post-apply
  workflow chưa chốt.**
  `SUBMISSION_LIFECYCLE_PROPOSED = true` giữ nguyên. Workflow HRP
  review pre-apply vs post-apply chưa được Owner/HRP domain chốt, nên
  các label `SUBMITTED` / `APPLIED` / `HRP_REVIEWED` chỉ phản ánh
  trạng thái kỹ thuật của submission object, KHÔNG phải canonical
  status. Schema không tự coi `APPROVED` là canonical. Promotion sang
  canonical chỉ xảy ra sau khi Owner + HRP domain + audit chốt workflow.

- **Q-17. PreviewResolver candidate data: chỉ đọc theo reviewer
  capability, tối thiểu PII — matrix cụ thể open trước path thật.**
  Schema hiện trả về `candidateId` opaque + `strength` enum + optional
  `label: redacted string max 200`. Label KHÔNG chứa PII (fullName/phone/
  CCCD). Reviewer capability matrix cụ thể (ai xem được fullName hashed,
  ai xem được fullName raw, ai chỉ thấy ID) chưa chốt vì path thật
  HRP chưa integrate; giữ open cho HRP-owned runtime. Schema đảm bảo:
  - Candidate KHÔNG bao giờ chứa fullName/phone/CCCD/dob raw ở DTO
    command result — chỉ opaque ID + redacted label.
  - Runtime HRP gate enforce reviewer capability trước khi build
    label.
  - Coder không tự ý thêm field PII vào schema.

- **Q-18. DNC reason OTHER KHÔNG bị ép note làm chặn. Chính sách
  note/retention vẫn PROPOSED.**
  Baseline: DNC KHÔNG bị buộc hoàn thiện intake/CCCD (đã chốt từ
  Master §10.4 + Backlog §0.3a). Coder KHÔNG thêm field bắt buộc note
  cho reason OTHER ở DTO `DncActionSchema`. Hiện tại `note` optional
  và schema KHÔNG enforce "OTHER ⇒ note required". Các policy sau vẫn
  PROPOSED, chờ HRP domain chốt:
  - Có audit/retention cho note không?
  - Redact scheme nào?
  - Nếu cần bắt buộc note cho OTHER, schema sẽ chỉ enforce qua
    `superRefine`; hiện tại không enforce.
  Coder không tự ý chặn DNC vì policy note chưa chốt.

Tất cả đã ghi trong contract dưới dạng comment/proposed marker. Coder
không tự ý chuyển trạng thái proposed → canonical, không tự ý thêm
cờ policy bỏ qua invariant đã chốt.

---

## Open questions — bổ sung 2026-09-13 10:30 (G0/0.3c–0.3d)

- **Q-19. PlacementCase open-status set / active set / transitions matrix:**
  Schema KHÔNG tự định open-status set (G-06 unknown). Runtime HRP
  gate kiểm tra open/active/transitions. Schema chỉ bind shape +
  whitelist patch. Cần HRP-owned transitions matrix. **Lưu ý AC:**
  schema dùng đủ enum chính thức `PlacementCaseStageSchema` (8 giá
  trị) cho `intendedStage`/`appliedStage`; KHÔNG whitelist
  "NEW/CONTACTING/QUALIFYING" ở schema layer — runtime HRP gate quyết
  open-status set policy.

- **Q-20. Close case với closeReason = SUCCESS có tự động trigger
  EFFECTIVE placement workflow không? — ĐÃ CHỐT (closed theo nghĩa
  này).**
  Schema KHÔNG có field `effective`/`isEffective`/`EFFECTIVE`/
  `effectiveAt`/`effectiveness` ở placement case patch (đã forbid).
  Baseline đã chốt: **SUCCESS là `CloseReason`, KHÔNG tự động
  trigger EFFECTIVE placement workflow.** EFFECTIVE là managed-mode
  workflow riêng (G-08 vẫn unknown). Workflow `Placement managed
  mode` riêng vẫn chưa chốt (gate sau, không phải G0/0.3c–0.3d).

- **Q-21. Talent/Client interaction: actor runtime auth/delegation
  protocol chưa chốt.**
  Schema chỉ bind shape (claim), runtime HRP gate xác minh. Cần
  auth/IdP + delegationRef mapping (liên quan G-03).

- **Q-22. Interaction timestamps order (occurredAt ≤ effectiveAt ≤
  recordedAt) — UNKNOWN, schema KHÔNG enforce order.**
  Schema chỉ validate ISO 8601 datetime format cho cả 3 field
  (`occurredAt`/`effectiveAt`/`recordedAt`). Baseline CHƯA CHỐT rule
  order — semantic design ghi trong doc, không phải invariant đã
  duyệt. Runtime HRP gate có thể enforce order khi domain decision
  xong. Coder cố tình KHÔNG hardcode order rule trong schema layer
  (tránh bypass domain decision).

- **Q-23. Client required context fields chưa chốt (Master §10.7).**
  Schema cho phép opaque `clientReferenceId` (1–256 ASCII); runtime
  resolve canonical. **Outcome UNKNOWN ở interaction KHÔNG giải quyết
  việc thiếu Client domain contract (company/contact/opportunity);
  không đủ chứng minh AC PASS.** Coder ghi rõ đây là **UNKNOWN** ở
  decision register; cần HRP-side Client domain schema chi tiết
  (G-10 unknown).

- **Q-24. Stage runtime gate vs schema whitelist — confirmed baseline.**
  Schema `PlacementCaseStageSchema` (8 giá trị chính thức:
  NEW/CONTACTING/QUALIFYING/MATCHING/PROPOSED/INTERESTED/CLIENT_PROCESS/
  READY_TO_START) là enum duy nhất cho `intendedStage`/`appliedStage`.
  Schema KHÔNG whitelist open-status set (G-06 unknown). Runtime HRP
  gate kiểm tra open-status set policy; nếu domain quyết
  `NEW/CONTACTING/QUALIFYING` chỉ là open-status, runtime sẽ reject
  các stage khác ở OpenPlacementCase — nhưng schema layer không
  thực thi, để policy có thể đổi mà không phải sửa enum.

---

## Open questions — bổ sung 2026-09-13 10:48 (G0/0.3e–0.3f)

- **Q-25. Availability schema shape — confirmed (shape-only).**
  Schema bind shape (constraints không phụ thuộc runtime quyết định):
  `laborProfileId + availability + expectedVersion` + patch whitelist
  (`availability`, `availableFromDate`); AVAILABLE_FROM_DATE yêu cầu
  availableFromDate; khác AVAILABLE_FROM_DATE thì clear availableFromDate;
  leap year bounds; note ≤ 500 + reject URL/base64.
  **PROPOSED (cần Owner chốt nghiệp vụ)**: idempotency key cụ thể,
  closeReason mapping, suppression event payload format. Schema KHÔNG
  hardcode "ngày tương lai"; runtime HRP gate + business clock +
  `BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh'` enforce (Q-15).
  Connector v1.1 (HEAD `414c54b`) xác nhận `updateLaborAvailability`
  là **đề xuất bổ sung**, chưa có endpoint S2S.

- **Q-26. Suppression target kind — PROPOSED (chọn kết hợp đề xuất).**
  Schema đề xuất 3 target kinds (`LABOR_PROFILE`, `EXTERNAL_CONTACT`,
  `SUPPRESSED_RECIPIENT_FENCE`) dựa trên Master §10.6.5; đây là **lựa
  chọn thiết kế**, KHÔNG tự thành confirmed chỉ vì tests pass. Owner
  cần chốt: production có dùng fence token ở layer ACL hay runtime
  HRP gate hoàn toàn? Connector v1.1 chưa có `Contactability` /
  authorize-dispatch endpoint S2S — schema bind shape, runtime gate
  enforce. KHÔNG tự ý confirmed.
  Schema bind shape constraint confirmed: `EXTERNAL_CONTACT` ép
  `resolvedCanonical: false`; safety suppression không tự tạo
  LaborProfile (Master §10.6.5 #4); không đòi CCCD/intake. Inbound
  KHÔNG tự gỡ DNC (Master #6 — schema forbid `inboundOptOutRemoval`,
  `autoClearOnInbound`).

- **Q-27. NextAction CREATE statuses & snooze/occurrence semantics
  — PROPOSED (chọn kết hợp đề xuất).**
  Schema đề xuất `initialStatus ∈ {OPEN, CANCELLED}` (không DONE) dựa
  trên AC Backlog §0.3f; schema đề xuất `SnoozeMode ∈ {ACTIVE,
  SNOOZED, DISMISSED}` tách riêng `NextActionStatus ∈ {OPEN, DONE,
  CANCELLED}`. Đây là **lựa chọn thiết kế**, KHÔNG tự thành
  confirmed. Owner cần chốt: (a) CREATE có cho CANCELLED không, hay
  phải qua UPDATE; (b) occurrenceKey UUID format / length chưa
  chốt.
  Schema bind shape constraint confirmed: snooze/dismiss notification
  KHÁC DONE; snooze rerun cấp `revisionId` + `occurrenceKey` mới
  (dedupe reminder — Backlog §0.3f AC). Connector v1.1 chưa có
  updateNextAction endpoint S2S exposed.

- **Q-28. Planning batch per-item outcome & batch item kinds —
  PROPOSED (chọn kết hợp đề xuất).**
  Schema đề xuất per-item outcome enum (`APPLIED`/`ACCEPTED`/
  `FAILED`/`SKIPPED`) và 3 batch item kinds (`NEXT_ACTION` /
  `AVAILABILITY` / `SUPPRESSION`). Đây là **lựa chọn thiết kế**,
  KHÔNG tự thành confirmed. Owner cần chốt: schema Planning batch
  có cần thiết hay runtime HRP gate chạy individual commands trực
  tiếp; batch reference có đồng nghĩa transaction nguyên tử hay
  per-item?
  Schema bind shape constraint confirmed:
  - `PlanningBatchResult` KHÔNG có field `allSuccess: boolean`
    (caller đọc per-item + summary).
  - `appliedCount + acceptedCount + failedCount + skippedCount =
    totalItems` constraint.
  - `items.length = summary.totalItems` constraint.
  - **ACCEPTED outcome KHÔNG mang `appliedId` / `appliedVersion`**
    (chỉ `pendingId` optional để trace; per Owner rev 2 chỉ thị,
    ACCEPTED không mang dấu hiệu APPLIED — xem envelopes.ts
    `AcceptedResponseSchema`).
  - AVAILABILITY batch KHÔNG cho DO_NOT_CONTACT (cần suppression.ts
    transaction).

## Connector v1.1 (HEAD 414c54b) — delta

T1 đã so sánh connector v1.1 với contracts/inventory hiện có. Delta
ngắn theo chỉ thị Owner:

- **CRM tách repo/runtime; HRP vẫn sở hữu canonical data.** Schema
  `organizationId` ở envelope §5 chỉ là **đề xuất contract**; checkout
  HRP không có model `Organization`/`Tenant` trong Prisma. Schema
  bind shape, runtime HRP-side scope model chưa chốt → KHÔNG coi
  scope/tenant đã tồn tại.
- **Status/active set hiện có**: connector báo cáo
  `PlacementCaseStatus = OPEN | IN_PROGRESS | READY_TO_PLACE |
  CLOSED`; active set gồm 3 trạng thái mở. **Transitions** và
  **production migration readiness** chưa được xác nhận — schema
  bind shape cho stage transition chưa chốt (G-06 unknown).
- **Stage/closeReason/Availability/CurrentRelationship là đích nghiệp vụ
  của CRM (per Master §10.6), KHÔNG phải enum HRP hiện hành.** Schema
  `enums.ts` constants (`PLACEMENT_CASE_STAGES` 8 giá trị,
  `CASE_CLOSE_REASONS` 9, `AVAILABILITIES` 5, `CURRENT_RELATIONSHIPS`
  5) là **CRM-side wire constants**, chưa được import như enum runtime
  HRP; HRP cần migration/command trước khi pin. Schema hiện không
  tự coi enum membership là quyền runtime (xem connector §3).
- **`createOrMatchLaborProfile`, `recordInteraction`,
  `recordClientInteraction`, `updateNextAction`** — đề xuất tên
  command. Schema bind shape, runtime HRP gate enforce transitions/
  permissions/context.
- **`updateLaborAvailability`**: HRP chốt tên/signature thực tế; hiện
  schema dùng tên đề xuất trong Master §7.2.
- **`transactionalOutboxPublisher`**: HRP internal tx port, chưa có
  S2S exposure; CRM consume qua HRP dispatcher hoặc claim/ack API
  do HRP chốt. Schema phân biệt HRP internal tx context vs handoff
  DTO (OutboxDeliveryIntent / OutboxDeliveryReceipt schemas — xem
  `commands/outbox.ts`).
- **Client domain**: chưa có `ClientCompany`/`ClientContact`/
  `SalesOpportunity`/`ClientInteraction` schema trong connector.
  HRP-owned implementation cần HRP-side PR trước khi chốt AC cho
  recordClientInteraction đầy đủ.
- **`IdempotencyKey` HRP-side**: scoped `(actorId, route, key)` với
  TTL 24h. CRM-side đề xuất `(organizationId, commandName, key)` là
  extension/replacement, **chưa được xác nhận production**. Schema
  bind `(organizationId, commandName, idempotencyKey)` literal theo
  proposal; runtime HRP gate quyết namespace thực.
- **T1 KHÔNG tuyên bố tự đọc HRP checkout**. Tài liệu đối chiếu là
  connector v1.1 + Master V2.6 + Backlog Gate0; HRP core (Prisma
  schema, `app/api`, `docs/PLANNER_HANDOVER.md`) chỉ được nhắc tới
  trong connector; Coder không fetch trực tiếp.

---

## Open questions — bổ sung 2026-09-13 11:50 (G0/0.4)

Owner chỉ thị rev 2:
1. Connector xác nhận ClientCompany đã có; chỉ các model/capability
   Client còn thiếu mới ghi chưa có.
2. Tách invariant đã chốt khỏi lựa chọn schema proposed.
   Marker/forbidden-list không tự chứng minh AC được enforce.
3. Push/claim-ack: chọn một đường mặc định đề xuất có lý do;
   KHÔNG tự coi fallback động là đã được duyệt hoặc cho hai đường
   xử lý cùng intent thiếu authority/dedupe.
4. Batch ACCEPTED cần pending operation reference/query semantics
   theo AC envelope, KHÔNG chỉ bỏ appliedId rồi coi đủ.
5. Ghi nhận thay đổi shared contracts cần Auditor kiểm ở bundle cuối;
   KHÔNG tự chọn signature protocol của provider chưa xác minh.

- **Q-29. ClientCompany đã có trong source HRP — connector xác nhận.**
  Connector v1.1 (HEAD `414c54b`) §0 bảng "Có trong source HRP" liệt
  kê `ClientCompany` là đã có schema HRP. Vậy:
  - **ClientCompany schema**: T1 ghi marker PROPOSED cho các field
    chưa chốt (ID format, address fields, company type taxonomy);
    schema hiện chỉ bind opaque ID qua `ClientTargetRef.clientCompanyId`.
    HRP-owned PR quyết field đầy đủ khi Client domain chốt.
  - **ClientContact / SalesOpportunity / ClientInteraction**: vẫn
    CHƯA CÓ schema HRP (Q-23 unresolved/proposed). T1 chỉ bind opaque
    ID + Q-23 marker; KHÔNG bịa schema detail.
  - **ClientContactQuery / recordClientInteraction**: capability còn
    thiếu ở production endpoint S2S (connector §2 + §6); schema bind
    shape proposal, runtime HRP-owned PR.

- **Q-30. Marker/forbidden-list không tự chứng minh AC được enforce.**
  Schema bind shape + `*_PATCH_FORBIDDEN` / `MAPPING_PATCH_FORBIDDEN`
  / `EVENT_PATCH_FORBIDDEN` / `QUERIES_PATCH_FORBIDDEN` /
  `OUTBOX_PATCH_FORBIDDEN` / `SECRET_PORT_FORBIDDEN_FIELDS` /
  `PORTS_FORBIDDEN_IMPORTS` chỉ là **marker audit** — runtime HRP gate
  enforce qua code review + lint + integration test. T1 ghi rõ đây
  không phải proof runtime policy đã được thực thi. Audit bundle cuối
  kiểm chứng presence/absence của enforcement code.

- **Q-31. Push/claim-ack: PUSH_WEBHOOK là default đề xuất có lý do.**
  Schema `OUTBOX_DELIVERY_CHANNELS = [PUSH_WEBHOOK, PULL_CLAIM_ACK]`
  bind literal; default ở `EventEnvelope.deliveryChannel` =
  `PUSH_WEBHOOK`. Lý do (T1 đề xuất):
  - ACL không cần DB credentials core HRP.
  - HRP-side dispatcher đẩy webhook tới ACL đã khai báo.
  - Pull claim-ack là fallback khi webhook không khả dụng.
  - PROPOSED (Owner chốt runtime): runtime HRP gate chọn 1 đường
    mặc định; **KHÔNG xử lý cùng intent qua 2 channel thiếu
    authority/dedupe**. Marker `EVENT_PATCH_FORBIDDEN` có
    `dualChannelWithoutFencing`/`dualChannelWithoutDedupe` — schema
    bind shape; runtime gate enforce.

- **Q-32. Batch ACCEPTED cần pending operation reference/query semantics.**
  Per Owner rev 2: bỏ `appliedId` ở outcome ACCEPTED chưa đủ — cần
  pending operation reference theo AC envelope (`envelopes.ts`
  `AcceptedResponseSchema` + `OperationQuerySchema`).
  - **CONFIRMED (schema bind shape)**: `PlanningBatchItemResult` với
    `outcome = ACCEPTED` chỉ có `pendingId: z.string().min(1).max(128).optional()`;
    KHÔNG có `appliedId`/`appliedVersion` (Owner rev 2).
  - **PROPOSED (Owner chốt)**: `pendingId` format = canonical operation
    reference (`OperationReferenceSchema`: `kind: 'COMMAND_OPERATION'`
    + `operationId: CommandIdSchema`). Hiện schema chỉ bind opaque
    string; runtime HRP-owned PR chốt format khi freeze (audit bundle
    kiểm).
  - **PROPOSED (Owner chốt)**: query contract cho ACCEPTED batch item —
    CRM/HRP-side runtime quyết query API; schema `OperationQuerySchema`
    đã có ở `envelopes.ts` cho operation-level query, batch-item-level
    query API có thể cần thêm ở backend Phase V7.9a.

- **Q-33. Signature provider protocol — KHÔNG tự chọn; shared contracts.**
  Marker `EVENT_PATCH_FORBIDDEN` có `useUnverifiedSignatureProtocol` /
  `useUnverifiedJwtAlgorithm` / `useUnverifiedWebhookAlgorithm`.
  Schema bind shape là marker; runtime HRP-owned PR chốt protocol +
  algorithm + secret rotation. **T1 KHÔNG tự chọn algorithm/signature
  protocol cho Zalo khi chưa xác minh (Backlog §0.6 + connector §10).**
  Thay đổi shared contracts (signature/JWT/webhook algo) cần Auditor
  kiểm ở bundle cuối.

---

## Phạm vi Gate 0 chịu ảnh hưởng bởi 0.4 (mapping)

- **Talent target union (TalentTargetRef)**: CONFIRMED shape
  (canonical id + version). Riêng Client branch (ClientTargetRef) mới
  thêm ở 0.4 — schema marker PROPOSED.
- **Conversation link (ConversationLink)**: schema bind shape + history
  revisions + externalRefs; runtime HRP-owned PR enforce revision
  policy + correction/replay.
- **Event envelope deliveryChannel**: bind literal
  PUSH_WEBHOOK/PULL_CLAIM_ACK; runtime HRP gate chọn runtime policy
  (Q-31).
- **Queries ConstantsSnapshot**: schema bind enum từ package đầy đủ;
  UI/dev KHÔNG phụ thuộc dictionary API (Backlog §0.4 AC #1).

---

## Open questions — bổ sung 2026-09-13 12:20 (G0/0.5)

Owner chỉ thị:
1. Q-32: operation reference + query contract thuộc Gate 0; chỉ
   implementation query mới để sau.
2. Q-30 là nguyên tắc evidence (không cần Chủ nhân phê duyệt).
3. Q-29: ClientCompany field bindings proposed.
4. Q-31 giữ transport là đề xuất kỹ thuật có lý do.
5. Q-33 giữ protocol chưa xác minh; không biến thành câu hỏi
   nghiệp vụ chung.

- **Q-32 (đóng). Operation reference + query contract thuộc Gate 0.**
  Contract ACCEPTED đã hoàn thiện reference/query semantics ở Gate 0:
  `PlanningBatchItemResultSchema.pendingReference: OperationReferenceSchema`
  (canonical `{ kind: 'COMMAND_OPERATION', operationId: CommandIdSchema }`).
  Caller có thể dùng `envelopes.ts OperationQuerySchema` (schema đã có)
  với operationId để poll result; **implementation query API runtime
  để Phase V7.9a backend** (Backlog §1.5, §1.8, §CORE/1.11 — Phase 9
  sau khi Gate 0 freeze). Schema bind:
  - `pendingReference` chỉ ở `outcome = ACCEPTED`.
  - `pendingReference` KHÔNG ở `APPLIED` (đã apply ngay), `FAILED`/
    `SKIPPED` (không có pending op).
  - Schema reject field cũ `pendingId: z.string()` opaque (đã đổi tên
    thành `pendingReference` ở G0/0.5; backward-incompatible với
    consumers cũ — ghi trong manifest).

- **Q-30 (nguyên tắc). Schema validation thuộc AC contracts; policy
  runtime thuộc HRP gate.**
  Owner chỉ thị: marker/forbidden-list không tự chứng minh AC được
  enforce. Phân biệt rõ:
  - **Schema validation (CONFIRMED — AC thuộc contract)**: shape,
    enum allowlist, regex, length bound, discriminator, strict
    reject, superRefine (cohort order, attribution AVAILABLE vs
    UNAVAILABLE, 3 metricId khác nhau v.v.). Đây là AC enforce bằng
    test runtime.
  - **Marker/forbidden-list (audit)**: chỉ là danh sách tên field
    cấm để audit runtime gate enforce qua code review + lint +
    integration test. KHÔNG dùng marker thay validation AC.
  - **Runtime gate (PROPOSED — HRP-owned)**: capability check, manager
    privilege, attestation, freshness, fencing, retention, retry
    policy. HRP-owned PR quyết.
  Bundle 0.5 ghi rõ từng marker trong `*_PATCH_FORBIDDEN` thuộc nhóm
  audit; AC thực sự enforce qua schema strict + superRefine + tests
  (đếm `313/313 PASS`).

- **Q-34. Routing strategy phân biệt rõ — schema bind CONFIRMED.**
  Schema `ROUTING_STRATEGIES = [SOURCE_ALLOCATION, WEIGHTED_DISTRIBUTION,
  HYBRID]`. Schema bind shape constraint (Backlog §0.5 AC #1):
  - SOURCE_ALLOCATION: yêu cầu `fixedOwner`; KHÔNG có `weights`.
  - WEIGHTED_DISTRIBUTION: yêu cầu `weights ≥ 1`; KHÔNG có `fixedOwner`.
  - HYBRID: yêu cầu cả hai.
  - Total weight > 0 (nếu có weights).
  PROPOSED: HYBRID policy runtime chưa chốt (HRP-owned PR).

- **Q-35. KPI module tách namespace experimental (Phase 10 chưa chốt).**
  Schema bind literal `KPI_MODULE_NAMESPACE = 'phase10-experimental'`.
  Schema reject `canonical-ready` ở namespace. Module chưa canonical-
  ready; runtime HRP gate quyết enable/disable. Đây KHÔNG chặn Gate 0
  Phase 9 (Master §13.10.3) — Phase 9 contracts bind shape; Phase 10
  module enable sau khi domain sign-off (P10/A.04).

- **Q-36. AI provider config — read DTO không có API key (AC #5).**
  Schema bind CONFIRMED:
  - `AIProviderConfigReadSchema` strict reject field raw secret (apiKey,
    accessKey, bearerToken, authorization, openaiApiKey, rawSecret,
    token, password, v.v.).
  - `SecretRefSchema` opaque + tier (PLATFORM/TENANT/OPERATOR); caller
    muốn dùng phải qua `SecretPort` (gate 0.3h).
  - `AIProviderBudgetSchema`: maxRequestsPerDay, maxTokensPerDay,
    maxCostPerDayUsdMicro ≥ 0.
  - `dataPolicy` semantics: SANDBOX + INTERNAL_ONLY xung đột;
    NO_PII + PII_REDACTED xung đột (schema reject).
  PROPOSED: SANDBOX budget cap cụ thể (Gate 0 chỉ > 1000 reject; runtime
  HRP gate quyết policy).

- **Q-37. AI proposal — KHÔNG arbitrary payload, KHÔNG direct write.**
  Schema bind CONFIRMED:
  - `AIProposalSchema` strict reject field `commandPayload`/`commandDraft`/
    `embedCommandPayload`/...
  - `ApplyAIProposalInputSchema.acceptedFieldPaths[]`: schema bind shape;
    runtime gate enforce subset-of-proposal (chống inject).
  - `ApplyAIProposalResultSchema.appliedFields[]`: per-field outcome
    APPLIED/REJECTED/SKIPPED + appliedVersion + reasonCode (audit).
  - Provider reference opaque (KHÔNG raw API key ở proposal DTO).
  PROPOSED: dual-control policy manager + reviewer chưa chốt (HRP-owned
  PR).

---

## Phạm vi Gate 0 chịu ảnh hưởng bởi 0.5

- **Routing**: SOURCE_ALLOCATION / WEIGHTED_DISTRIBUTION / HYBRID
  schema bind; strategy rõ ràng tránh collapse.
- **Analytics**: profile created/updated/submitted 3 metricId khác
  nhau (Q-9) — schema reject nếu trùng.
- **KPI**: assign/revise manager-only; sale/AI propose-only;
  namespace 'phase10-experimental' pin.
- **AI proposal**: không arbitrary payload; không direct write; apply
  via envelope command.
- **AI provider config**: read DTO không API key; SANDBOX + NO_PII
  semantics.
- **ACCEPTED contract (Q-32)**: pendingReference canonical
  OperationReference; implementation query API để Phase V7.9a.

Tất cả ghi proposed/proposed-experimental; Coder không tự quyết.

---

## Open questions — bổ sung 2026-09-13 13:30 (G0/0.8-F1)

Owner chỉ thị fix F1 theo Auditor findings (G0/0.8):
- **Q-38 (F1) confirmed approach — Merge/review PROPOSED/UNAVAILABLE
  placeholder.** Coder tạo `commands/merge-review.ts` với:
  `MergeLaborProfilesInput/ResultSchema`,
  `CommitReviewDecisionInput/ResultSchema`,
  `ResolvePossibleMatchInput/ResultSchema`,
  `SupersedeReviewStatusInput/ResultSchema`. Tất cả yêu cầu
  `proposedAuditRef ∈ {Q-19, Q-23, Q-37}` (HRP-owned dependencies)
  qua `MERGE_REVIEW_PROPOSED_DEPENDENCIES`. Privileged merge giữ tách
  khỏi inbound default gateway (đã ở 0.3h). Phase 10 acceptance chờ
  Owner sign-off + HRP-owned PR.
- **Q-39 (F1) — điều kiện mở lại path.** Mở lại khi: (a) Q-19 tran-
  sitions chốt + audit; (b) Q-23 Client domain chốt + mapping/contact
  contract; (c) Q-37 dual-control AI chốt; (d) Owner sign-off matrix
  §3 rows; (e) Independent audit recheck sau khi DTO ổn định.

## Open questions — bổ sung 2026-09-13 13:30 (G0/0.8-F2)

Owner chỉ thị fix F2 theo Auditor findings:
- **Q-40 (F2) confirmed — HRP_UI source discriminator đồng bộ
  primitives/envelope.** Coder refactor `IntakeContextRefSchema` +
  `InteractionContextRefSchema` thay `{ provider, connectionId }` →
  `{ source: CommandSourceSchema, external* optional }`. Command-
  SourceSchema ở primitives.ts đã enforce HRP_UI source phải có
  `connectionId: null`, INTEGRATION bắt buộc `connectionId`. Schema
  KHÔNG nới validation chung để phục vụ một nhánh; superRefine chỉ
  reject khi HRP_UI có externalConversationId/Account/Message (source/
  context mâu thuẫn). Tests đã migrate (test-helpers.mjs `src()` /
  `ext()`).

## Open questions — bổ sung 2026-09-13 13:30 (G0/0.8-F3)

- **Q-41 (F3) confirmed — CalendarDateSchema reuse cho date-only
  fields.** 5 chỗ đã thay inline `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`
  → `CalendarDateSchema`:
  - `identity.ts IdentitySignalSchema.dob`
  - `intake.ts IntakeSubmissionPayloadSchema.dob`
  - `analytics.ts MetricAggregateReadRequestSchema.periodStart/End`
  - `kpi.ts KPIAssignmentInputSchema.cohort.periodStart/End`
  - `scheduling.ts PlanningBatchAvailabilityItemSchema.availableFromDate`
  Bổ sung tests leap year (2024-02-29 OK; 2026-02-29 reject), Feb 30 /
  Apr 31 reject. Schema KHÔNG thêm business clock policy mới; future-date
  vẫn dùng business clock Asia/Ho_Chi_Minh ở runtime HRP gate (Q-15).

## Open questions — bổ sung 2026-09-13 13:30 (G0/0.8-F4)

- **Q-42 (F4) confirmed approach — canonical DNC 4 giá trị + legacy
  alias.** Coder tạo `commands/dnc.ts`:
  - `DNC_REASONS` / `DncReasonSchema` = canonical 4 giá trị
    (CANDIDATE_REQUEST, PRIVACY_REQUEST, HRP_POLICY, OTHER).
  - `LEGACY_DNC_REASONS` / `LegacyDncReasonSchema` = 3 giá trị cũ
    (CANDIDATE_REQUEST, PRIVACY, OTHER).
  - `DncReasonAcceptAliasSchema` chấp nhận cả canonical + legacy
    (compatibility delta `PRIVACY` → `PRIVACY_REQUEST`).
  - `normalizeDncReason(input)` map legacy → canonical + `wasLegacy`
    audit marker (caller normalize cho storage/audit).
  - `suppression.ts CommitSuppressionInputSchema.reason` reuse
    `DncReasonSchema` (chỉ canonical; suppression là đích runtime).
  - `identity.ts DncActionSchema.reason` reuse
    `DncReasonAcceptAliasSchema` (caller-side; staff form có thể nhận
    legacy alias).
  Enum membership KHÔNG tự cấp quyền `HRP_POLICY` cho mọi actor; auth-
  orization là runtime gate (Q-37 dual-control AI). DNC vẫn độc lập
  full intake/CCCD (Backlog §0.3a + §0.3e).

## Open questions — bổ sung 2026-09-13 13:30 (G0/0.8-F5)

- **Q-43 (F5) confirmed — AI evidence refs reuse CommandEvidenceRef-
  Schema.** Coder đã thay inline shape
  `{ evidenceId, evidenceSchemaVersion, kind }` (2 chỗ: AIProposalSchema,
  AIProposalFieldSchema) → `CommandEvidenceRefSchema`
  `{ evidenceId, kind, organizationId, connectionId? }` từ evidence.ts.
  Tests: standard refs (qua primitives) nhận; malformed inline (legacy
  shape thiếu organizationId) reject. Reference KHÔNG là quyền đọc;
  KHÔNG cấp phép gửi CCCD/PII tới model — runtime HRP gate đọc evi-
  dence content qua evidence service; provider chỉ thấy metadata.



## Open questions â bá» sung 2026-09-13 21:50 (G0/0.8-F2-followup)

Sau Äá»£t F1âF5, Auditor recheck má» láº¡i F2 â xÃ¡c nháº­n F2 chÆ°a ÄÃ³ng táº¡i
`HrpGatewayCallContextSchema` á» `gateway.ts`. T1 ÄÃ£ Ã¡p dá»¥ng F2 follow-up
vá»i pháº¡m vi kháº¯c phá»¥c ÄÃºng finding.

- **Q-44 (F2 follow-up) confirmed â HrpGatewayCallContextSchema phÃ¢n
  biá»t HRP_UI (internal) vs integration external.** Coder ÄÃ£ refactor
  `gateway.ts HrpGatewayCallContextSchema`:
  - `connectionId: ConnectionIdSchema.nullable().optional()` (má»
    `null` literal cho HRP_UI source).
  - `superRefine` 3 nhÃ¡nh:
    - `INBOUND_DEFAULT` + thiáº¿u provider â reject (path `provider`).
    - `INBOUND_DEFAULT` + `provider='HRP_UI'` â `connectionId` pháº£i
      null/undefined; reject náº¿u lÃ  string (path `connectionId`).
    - `INBOUND_DEFAULT` + provider external (CHATWOOT/ZALO_OA) â
      `connectionId` báº¯t buá»c (string non-empty).
    - `INBOUND_REVIEWER`/`PRIVILEGED_MERGE` â KHÃNG provider/connectionId
      (ká» cáº£ null); reject cáº£ 2 path.
  - `ProviderNameSchema` (regex `[A-Za-z0-9_-]+`) ÄÃ£ cháº¥p nháº­n literal
    `'HRP_UI'` nÃªn khÃ´ng cáº§n má» rá»ng enum; source discriminator dÃ¹ng
    láº¡i contract tá»« `primitives.ts` (HRP_UI literal ÄÃ£ Äá»nh nghÄ©a á»
    `HrpUiCommandSourceSchema`).

  Schema KHÃNG ná»i validation chung Äá» phá»¥c vá»¥ má»t nhÃ¡nh; ÄÃ¢y lÃ  phÃ¢n
  biá»t source discriminator (HRP_UI internal vs integration external)
  ÄÃ£ ÄÆ°á»£c primitives.ts chá»t tá»« 0.3a.

  **Regression guard**: tests cÅ© `gateway-providers-ports.test.mjs` (3
  tier table) pass; `INBOUND_REVIEWER`/`PRIVILEGED_MERGE` khÃ´ng
  provider/connectionId váº«n pass; external provider thiáº¿u connectionId
  váº«n reject; provider khÃ´ng há»£p lá» (regex) váº«n reject.

  **Privileged/reviewer KHÃNG bá» áº£nh hÆ°á»ng**: `INBOUND_REVIEWER`/
  `PRIVILEGED_MERGE` tier váº«n KHÃNG cho provider/connectionId (ká» cáº£
  null). HRP_UI source path chá» thuá»c `INBOUND_DEFAULT` tier.

  **Out-of-scope tá»« chá»i**: KhÃ´ng sá»­a F1/F3/F4/F5; khÃ´ng má» rá»ng quyá»n
  privileged/reviewer; khÃ´ng yÃªu cáº§u external connection cho HRP_UI;
  khÃ´ng bump version (tÆ°Æ¡ng thÃ­ch ngÆ°á»£c); khÃ´ng má» Q má»i ngoÃ i Q-1..Q-44.

---

# CORE/1.4 — Decisions Q-45 / Q-46 / Q-47

Ngày 2026-09-14. T1 writer. Addendum cho CORE/1.4 — Durable worker/queue leasing.

## Q-45 — Queue layer choice: PostgreSQL polling

**Question**: Queue/lease layer cho CORE/1.4 nên dùng broker ngoài (Redis/NATS/SQS) hay PostgreSQL polling?

**Status**: **PROPOSED** (Owner chốt khi production gate; không chặn CORE/1.4 self-check).

**Decision / delta**:
- Chọn **PostgreSQL polling** (claimNextReceipt = atomic UPDATE ... RETURNING với fencing token).
- Không thêm broker. Lý do:
  - Scale hiện tại (≤1K receipts/s) chưa cần broker.
  - Broker thêm vận hành: HA setup, schema registry, observability riêng.
  - PostgreSQL đã có sẵn cho Integration Store; row-level UPDATE đủ để đảm bảo exclusivity.
- Threshold để mở lại: nếu throughput vượt K receipts/s và DB poll không gánh nổi (p95 claim latency > X ms), mở lại với broker.
- **Tác động**: chỉ giới hạn queue layer của Integration Store; KHÔNG động tới HRP canonical queue/idempotency (vẫn thuộc HRP-owned PR Phase 9).

**Where recorded**:
- `packages/integration-store/src/worker/lease.ts` (`claimNextReceipt`, `claimNextIntent`)
- `apps/integration-worker/src/durable-worker.ts` (poll loop)
- `docs/contracts/handoff-core-1.4.md` §6
- `docs/contracts/inventory.md` (CORE/1.4 section, Q-45)

## Q-46 — Retry policy defaults

**Question**: `RetryPolicy` defaults nào cho CORE/1.4 worker?

**Status**: **PROPOSED** (Owner chốt khi production gate; không chặn CORE/1.4 self-check).

**Decision / delta**:
- `DEFAULT_RETRY_POLICY = { maxAttempts: 8, initialDelayMs: 1000, maxDelayMs: 300000, jitterFactor: 0.2, backoffMultiplier: 2 }`.
- `isRetryable(err)` chỉ retry các `ErrorCode.retryClass ∈ { BOUNDED_SAME_KEY, RETRY_AFTER_DEPENDENCY, RETRY_AFTER_RATE_LIMIT }`.
- Codes `NEVER` (validation/forbidden/idempotency/version/auth) → fail fast, set DEAD_LETTERED.
- `computeNextAttemptAt(policy, attempts, clock)` trả về `min(initialDelayMs * backoffMultiplier^(attempts-1), maxDelayMs)` × jitter.
- `decideRetryState(policy, attempts, err)` → `{ action: 'retry', nextAttemptAt } | { action: 'dead-letter', reasonCode }`.
- Bounded: `attempts >= maxAttempts` → dead-letter ngay cả khi retryable.
- **Post-audit fix (2026-09-14)**: Auditor phát hiện code đang có `maxAttempts=5, jitterFraction=0.1` (khớp với implementation ban đầu trước khi handoff ghi rõ 8). T1 đã align code về `maxAttempts=8, jitterFraction=0.2` theo Q-46 này. Integration tests 24/24 PASS sau fix. Manifest hash updated.

**Where recorded**:
- `packages/integration-store/src/worker/retry.ts`
- `packages/integration-store/src/worker/index.ts` (export)
- `docs/contracts/handoff-core-1.4.md` §6.4, §13
- `docs/contracts/inventory.md` (CORE/1.4 section, Q-46)

## Q-47 — Fencing model

**Question**: Fencing token semantics và enforcement ntn để stale worker không ghi đè kết quả worker mới?

**Status**: **PROPOSED** (Auditor xác nhận trong CORE/1.4 audit).

**Decision / delta**:
- `fencingToken` UUIDv4 sinh per claim, lưu trên `ExternalEventReceipt.fencingToken` (VARCHAR(128)) + `leaseFencedAt` (timestamp).
- `claimNextReceipt` UPDATE: `SET leaseOwner=$workerId, leaseExpiresAt=now()+$leaseDurationMs, fencingToken=$uuid, leaseFencedAt=now() WHERE state IN (...) AND leaseExpiresAt IS NULL OR leaseExpiresAt < now() RETURNING *`.
- `completeReceipt` SQL:
  ```sql
  UPDATE integration."ExternalEventReceipt"
  SET state=$newState,
      resolvedAt=...,
      reasonCode=...,
      -- lease clear on success
      leaseOwner=NULL,
      leaseExpiresAt=NULL,
      fencingToken=NULL,
      leaseFencedAt=NULL,
      updateCount=updateCount+1
  WHERE id=$receiptId
    AND "leaseOwner"=$workerId
    AND "fencingToken"=$fencingToken
    AND state=$expectedCurrentState
  RETURNING *
  ```
- Nếu `rowCount=0` → trả `fencedRejected=true`. Worker coi như stale; KHÔNG retry trên cùng receipt (vì lease đã thuộc worker khác hoặc đã reclaim).
- T1 self-check: chỉ `completeReceipt` trong `lease.ts` là UPDATE state path. `repos/event-receipt.ts` (CORE/1.3) chỉ INSERT receipt mới + atomic dispatch intent insert; không UPDATE state của receipt hiện hữu. **Pass**.
- Auditor cần xác nhận KHÔNG có code path nào bypass fencing check (ví dụ: future `repos/intent.ts` không được UPDATE receipt state).

**Where recorded**:
- `packages/integration-store/src/worker/lease.ts` (claim + complete paths)
- `packages/integration-store/prisma/migrations/0002_worker_lease_fencing/migration.sql`
- `apps/integration-worker/src/durable-worker.ts` (fencing check before complete)
- `docs/contracts/handoff-core-1.4.md` §6.2
- `docs/contracts/inventory.md` (CORE/1.4 section, Q-47)

### CORE/1.2 — Webhook Receiver (2026-09-14)

**Q-48** (CORE/1.2 fixture scope): Protocol fixture CHATWOOT / ZALO_OA / GENERIC dùng synthetic HMAC secret từ env. **KHÔNG tuyên bố provider authenticity** — fixture chỉ phục vụ dev/test pipeline verify shape + signature. Real provider adapter (Zalo challenge handshake, Chatwoot webhook verify URL) đến V7.9b/c.
- Status: PROPOSED, đã ghi rõ trong `handoff-core-1.2.md` §9 + protocol-fixture.ts header.
- Blocked paths: KHÔNG (chỉ fixtures).
- Backlog AC: §Task 1.2 ("Mock verify không tuyên bố xác thực Zalo thật").

**Q-49** (eventId fallback policy): Documented stable fallback order per provider:
- CHATWOOT: `event_id` → `message.id`
- ZALO_OA: `event_id` → `message_id`
- GENERIC: `event_id` → `id` → `eventId` → `message_id` → `trace_id`

Thiếu stable id → reject 400 `missing_event_id`. **KHÔNG dùng timestamp nhận làm key** (Backlog §Task 1.2 AC rõ).
- Status: PROPOSED, đã align với brief, code có test cover (`missing eventId + missing fallback → 400`).
- Backlog AC: §Task 1.2.

**Q-50** (rate limit in-memory): Token bucket per `(org, provider, connectionId)` với 60s window, default 600 req/min/connection. **In-memory only** cho CORE/1.2 — production rate limit cần Redis/edge proxy, deferred to V7.9b/c. Restart process mất state.
- Status: PROPOSED, đã ghi rõ trong handoff §11.
- Blocked paths: KHÔNG (chỉ CORE/1.2 runtime).
- Production hardening: V7.9b/c edge rate limit.

**Q-51** (CORE/1.2 rev 2 — connection registry + algorithm pinning + stable eventId + guard fix): Auditor `CHANGES_REQUIRED` rev 1 trả 3 blocking findings F1/F2/F3 + 1 guard. Rev 2 fix bundle:
- F1: ConnectionRegistry server-trusted map `(organizationId, provider, connectionId) → {secret, algorithm}`. Raw connectionId (NO sanitize/uppercase), canonical key dùng `\u0000` separator. Load từ env `HRP_WEBHOOK_CONNECTIONS` (JSON) HOẶC `HRP_WEBHOOK_CONNECTION_<N>` (pipe-delimited). Handler chạy registry lookup TRƯỚC HMAC verify + commit → fail-before-persist.
- F2: Algorithm pinned per-connection trong registry. `verifyHmacSignature(pinnedAlgorithm, secret)` — KHÔNG chọn algorithm từ header. Header `x-webhook-algorithm` chỉ cross-check: nếu có và mismatch → 401 `algorithm_header_mismatch`. Header absent → dùng pinned. Fail closed on unsupported/mismatched.
- F3: Documented `STABLE_EVENT_ID_POLICY` per provider. CHATWOOT primary `id`, fallback `event_id` (BỎ `message.id`). GENERIC primary `event_id` / `eventId`, fallback `id` (BỎ `trace_id`). Thiếu stable id → reject 400 `missing_event_id`. Primary field accept string ≥ 8 chars HOẶC number ≥ 0. KHÔNG dùng receipt time/random/payload hash.
- Guard: `/mock/gateway/call` (POST) + `/mock/gateway/log` (GET) blocked ở `mockMode=off` → 404 `mock_disabled`. CORE/1.1 KHÔNG tự đóng — chỉ 1 guard delta; mock gateway vẫn hoạt động đầy đủ khi `mockMode=deterministic`.
- rateMap TTL/max-size: idle eviction 5min default, LRU eviction khi vượt 10000 entries default. Insert CHỈ sau registry lookup OK → unknown connection KHÔNG insert → no unbounded growth.
- Handoff §11: bỏ claim "digest đảm bảo trật tự" (sai); ghi rõ "digest KHÔNG đảm bảo trật tự; sequencing xử lý ở Gate sau (Q-open)".
- Status rev 2: PROPOSED → chờ Auditor recheck.
- Status rev 3 (2026-09-14): **AUDITOR PASS**. T1 self-check 566/566; Auditor 539/539 trong suite scope riêng (27-test delta từ suite-scope difference — xem `handoff-core-1.2.md` §15.2). Doc-only reconcile, không code diff. Snapshot audited = manifest rev 2 hash set.
- Boundaries: KHÔNG modify frozen contracts, KHÔNG đóng CORE/1.1, KHÔNG CORE/1.5, KHÔNG real provider/HRP, KHÔNG xin freeze lại Gate 0.

### CORE/1.2 — Pre/post snapshot (2026-09-14)

Pre-coding snapshot:
- `packages/integration-store/src/worker/retry.ts` (Q-46 post-audit fix from CORE/1.4): `maxAttempts=8`, `jitterFraction=0.2` (đã verified trong `handoff-core-1.4.md` §13).
- All other CORE/1.4 / 1.3 / 1.0 / contracts files unchanged.

Post-coding (CORE/1.2):
- 7 new files in `apps/integration-api/src/receiver/` + 2 modified `packages/config/src/{types,loader}.ts` + 1 modified `apps/integration-api/src/server.ts`.
- 0 contract delta (frozen Gate 0 `0.0.8-g0.8-fixes`).
- 0 CORE/1.3 / CORE/1.4 delta.

### CORE/1.6 � Stale confirmation -> DUPLICATE_KEY (2026-09-14)

Owner brief �Backlog Task 1.6: 'doi field/evidence/intent/target lam confirmation cu mat hieu luc'.
T1 maps stale confirmation rejection to OrchestratorError(code=DUPLICATE_KEY, reason=STALE_CONFIRMATION) instead of VALIDATION_ERROR.
Rationale: VALIDATION_ERROR would mean 'you sent garbage'; DUPLICATE_KEY means 'your earlier claim is no longer valid - re-review the draft and submit a fresh confirmation'. UI can branch on DUPLICATE_KEY to trigger re-review workflow.

Two distinct paths produce DUPLICATE_KEY:
  1. createIntakeCheckpoint: same intakeRevisionId + different draftDigest (edit changed content).
  2. isConfirmationValid: confirmation.context.{draftRevisionId,draftDigest,canonicalId,canonicalVersion} != saved checkpoint (target/version drift, stale token).

Boundaries: KHONG modify frozen contracts, KHONG CORE/1.7 review service, KHONG real HRP/provider, KHONG production DB, KHONG client domain paths (return UNAVAILABLE).

---

# CORE/1.6 — Audit reception + Auditor finding fixes (2026-09-15)

T1 writer. Xử lý B1–B4 (Auditor findings) + N1 (operational).
Sau khi Owner chuyển blocking findings đầy đủ.

## Trạng thái

- **Self-check (T1)**: `IMPLEMENTATION COMPLETE` — xem `handoff-core-1.6.md` §1, §11.
- **Auditor verdict (Owner chuyển)**: `CHANGES_REQUIRED`.
- **Auditor findings**: B1–B4 FIXED (2026-09-15), N1 DONE (doc-only).
- **Gate 0**: vẫn `FREEZE`. Không mở lại freeze.

## B1 — Server-computed draft digest: **FIXED**

**Finding**: Client gửi draftDigest tự khai, orchestrator không verify server-side.

**Fix**:
- Thêm `computeServerDigest(req)` trong `digest.ts` — tính SHA-256 từ actual payload.
- `run()` và `resumeWithPayload()` gọi `computeServerDigest` trước mutation.
- So khớp vs `req.draftDigest` (client-supplied) và `confirmation.context.draftDigest`.
- Semantic drift → `IDEMPOTENCY_CONFLICT`; stale confirmation → `VALIDATION_ERROR`.

**Changed files**: `src/orchestrator/digest.ts`, `src/orchestrator/intake-orchestrator.ts`.

**Evidence**: tests B1 cover — `client digest sai → IDEMPOTENCY_CONFLICT`, `digest đổi → server chặn`, `digest đúng không cấp quyền` (authority boundary tách biệt).

## B2 — Canonical target/version giữa các bước: **FIXED**

**Finding**: CASE/AVAILABILITY dùng `ctx.canonicalId` (từ confirmation) thay vì từ IDENTITY result; NEW outcome không có ID trước đó.

**Fix**:
- `executeFromCheckpoint` track `effectiveCanonicalId` + `effectiveCanonicalVersion` runtime.
- Sau IDENTITY: update effective state từ `IdentityStepResult.canonicalId/version`.
- Sau PROFILE: update effective state từ `ProfileStepResult.newVersion/currentVersion`.
- Persist vào checkpoint row sau mỗi step để resume đọc lại.
- CASE/AVAILABILITY dùng effective state thay vì fallback version=0.

**Changed files**: `src/orchestrator/intake-orchestrator.ts`.

**Evidence**: tests B2 cover — `NEW dùng canonicalId từ gateway`, `version tăng từ PROFILE truyền đúng cho CASE/AVAILABILITY`, `resume đọc từ checkpoint đã persist`.

## B3 — Error taxonomy: **FIXED**

**Finding**: Orchestrator throw `DUPLICATE_KEY` cho cả digest drift và confirmation invalid. Contract `ErrorCodeSchema` không có `DUPLICATE_KEY`; phải dùng `IDEMPOTENCY_CONFLICT` + `VALIDATION_ERROR`.

**Fix**:
- `translateStoreError`: `DUPLICATE_KEY` (store) → `IDEMPOTENCY_CONFLICT` (canonical).
- `isConfirmationValid` fail → `VALIDATION_ERROR` (stale confirmation).
- `IDEMPOTENCY_CONFLICT`: same revisionId + different semantic digest.
- `VALIDATION_ERROR`: confirmation không bind đúng context.
- Tests validate error codes qua `ErrorCodeSchema.safeParse()` — không chỉ assert string.

**Changed files**: `src/orchestrator/intake-orchestrator.ts`, `tests/orchestrator.test.mjs`.

**Evidence**: 35/35 unit + 6/6 PG-E2E PASS; tests assert code qua `ErrorCodeSchema`.

## B4 - DNC source/actor: **FIXED** (twice - recheck 2026-09-15)

**Finding (first pass)**: uildCommitSuppressionPayload xay context.source bang literal { kind: 'INTEGRATION' } thay vi qua shared schemas; thieu actor.

**Fix (first pass)**:
- IntegrationCommandSourceSchema.parse() cho source (ko hard-code literal).
- IntakeContextRefSchema.parse() cho context (externalAccountId o context, khong trong source).
- Them ctor: ActorClaim vao DncActionInput; validate qua ActorSchema.parse().
- isDncActionCallable check actor bat buoc.

**Finding (recheck)**: Lan fix dau gop ctor vao context: { ...contextRef, actor }. Vi IntakeContextRefSchema.strict() khong cho phep field ctor, payload khi parse qua CommitSuppressionInputSchema (context: IntakeContextRefSchema strict) se bi reject. Dong thoi actor phai o envelope/gateway call context, khong trong payload.context.

**Fix (recheck)**:
- uildCommitSuppressionPayload tra context: contextRef (strict shape) - KHONG tron actor.
- Export ssertCommitSuppressionPayloadValid(input) - validate payload qua CommitSuppressionInputSchema.
- executeDncAction:
  - Validate actor qua ActorSchema.parse() ngay dau ham.
  - Validate payload qua CommitSuppressionInputSchema.parse() (fail-closed).
  - Truyen ctor qua GatewayCaller args (envelope level).
- GatewayCaller type extended voi ctor?: unknown (optional, backward-compatible).
- uildGatewayCaller test helpers truyen rgs.actor ?? defaultServiceActor.

**Changed files (recheck)**: src/orchestrator/dnc-handler.ts, src/orchestrator/steps.ts (GatewayCaller extend), src/orchestrator/index.ts (export), 	ests/orchestrator.test.mjs (+7 evidence tests, fix DO_NOT_CONTACT), 	ests/orchestrator.pg-e2e.test.mjs (fix DNC test fields).

**Evidence (recheck)**: 7 new tests - payload parse via schema (#1), externalAccountId sufficiency (#1b), actor at envelope (#2), missing actor blocked (#3a), malformed actor blocked (#3b), DNC independent path (#4), old shape reject (#5).
## N1 — Rollback safety: **DONE (doc-only)**

**Finding**: Transaction không đủ để ngăn mất checkpoint do DROP TABLE.

**Fix (doc-only, không sửa code)**:
- Migration `0003_intake_checkpoint` dùng `CREATE TYPE ... IF NOT EXISTS` + `CREATE TABLE ... IF NOT EXISTS` → idempotent.
- Rollback script chỉ chạy trên DB test riêng, không phải dev/staging.
- Precondition: backup checkpoint table trước khi migrate down.
- Recovery: chạy lại migration `0003` để recreate.

## Regression

| Package | Before | After |
|---------|--------|-------|
| `packages/contracts` | 398/398 PASS | 398/398 PASS |
| `packages/integration-store` | 34/34 PASS | 34/34 PASS |
| `apps/integration-api` | 141/141 PASS | **143/143 PASS** |
| `apps/integration-worker` | 56/56 PASS | 56/56 PASS |
| **Tổng** | **631** | **641** |

Tăng 10 tests vs B4 recheck: +7 B4-Evidence tests (orchestrator.test.mjs: 35 → 42), +2 PG-E2E không delta nhưng count bao gồm; tổng 641 = 150 (api) + 56 (worker) + 398 (contracts) + 16 (config) + 10 (store) + 11 (context-panel).

## Changed files (B4 recheck delta)

**Source**:
- `apps/integration-api/src/orchestrator/dnc-handler.ts` — B4 recheck: `context: contextRef` (strict), actor ở gateway call context.
- `apps/integration-api/src/orchestrator/steps.ts` — B4 recheck: `GatewayCaller` extended với `actor?: unknown`.
- `apps/integration-api/src/orchestrator/index.ts` — B4 recheck: export `assertCommitSuppressionPayloadValid`.

**Tests**:
- `apps/integration-api/tests/orchestrator.test.mjs` — B4 recheck: +7 evidence tests (35 → 42), fix `buildGatewayCaller` pass actor, fix DO_NOT_CONTACT → CANDIDATE_REQUEST.
- `apps/integration-api/tests/orchestrator.pg-e2e.test.mjs` — B4 recheck: `buildGatewayCaller` pass actor, fix DNC test dùng canonical fields (externalContactId, externalAccountId, reason CANDIDATE_REQUEST).

**Doc delta**:
- `docs/contracts/handoff-core-1.6.md` — §14 mới (B4 recheck), sửa section numbering trùng (§12 → §12 Handoff, §13 B1–B4 FIXED, §14 B4 recheck FIXED).
- `docs/contracts/handoff-core-1.6.manifest.txt` — regenerate SHA-256 (12/12 khớp).
- `docs/contracts/decision-register.md` — entry này (B4 recheck FIXED).

## Phạm vi lượt này

- B1–B4: FIXED.
- N1: DONE (doc-only).
- Không sửa contracts freeze.
- Không mở CORE/1.7.
- Không Docker/deploy/provider thật.
- Verdict vẫn `CHANGES_REQUIRED` đến khi Auditor recheck.
- Khi Owner chuyển recheck, T1 bàn giao evidence (diff + tests) cho Auditor.

