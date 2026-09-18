# Implementation Backlog — Gate 0 & V7.9a

**Baseline:** Master-Plan.V2.6.md và hrp-connector.md v1.1.  
**Loại bàn giao:** task code cho Coding Agents; tài liệu này không triển khai code.  
**Nguyên tắc:** Contract trước backend; Gate 0 cần Owner review/xác nhận trước chuyển implementation phụ thuộc. V7.9a chỉ Integration Core, Mock Gateway và mock UI theo phạm vi dưới đây. Chưa HRP-owned backend, chưa Chatwoot/Zalo production, chưa gọi model hoặc gửi khách thật.

## A. Quy tắc chung cho Coding Agent

1. Đọc baseline, AGENTS.md và AI_CODING_GUARDRAILS.md thực tế nếu repo cung cấp. Không tuyên bố đã đọc tài liệu chưa có; ghi missing input và chỉ dừng task phụ thuộc, vẫn làm phần độc lập.
2. HRP SoR; Chatwoot SoE. Không import Prisma core, không nhận HRP DB credential, không cross-database FK. Prisma riêng của Integration chỉ triển khai ở Task 1.3 sau Gate 0.
3. Enum đã được Owner chốt dùng ngay. Không chờ dictionary API để làm UI; chưa biết transition policy không được tự giả định là mọi transition đều hợp lệ.
4. Assignment chat không thành HandlingAssignment; giữ SLA HRP 7 ngày; không tự quyết định Beneficiary/Referral/Worker/EFFECTIVE.
5. CURRENT_RELATIONSHIP chỉ đọc; stage, status, closeReason và Availability là các trường/ngữ nghĩa riêng.
6. Fixtures synthetic, không CCCD/keys/transcript thật. Schema hợp lệ không chứng minh actor đã xác thực hoặc mutation được policy cho phép.
7. Mock chỉ chứng minh contract/orchestration. Kết quả mock không chứng minh DB concurrency, provider authenticity hoặc production readiness.
8. Mỗi PR chỉ rõ Task IDs, output paths, AC pass/fail, tests và limitations. Không mở rộng sang production hoặc viết HRP logic vì thấy thiếu API.

### Cách đánh dấu AC

- Mỗi AC là một mục pass/fail có test, fixture hoặc review evidence tương ứng.
- Không dùng “build thành công” thay bằng chứng nghiệp vụ.
- PR thiếu AC hoặc có placeholder cho output bắt buộc chưa được tính Done.
- Đường dẫn dưới đây là layout đề xuất; nếu repo hiện tại có convention khác phải ghi mapping, không tạo hai cấu trúc song song.

## B. Dependency và thứ tự triển khai

| Đợt | Tasks | Gate |
|---|---|---|
| 0A | 0.0–0.2 | Đọc nguồn, constants, envelope |
| 0B | 0.3a–0.3h, 0.4–0.7 | DTO, interfaces, events/queries, scope và fixtures |
| 0C | 0.8 | Owner review và đóng băng Gate 0 |
| 1A | 1.0, 1.1, 1.3 | Scaffold riêng, gateway mock và Integration store |
| 1B | 1.2, 1.4–1.8 | Receiver, durable jobs, orchestration, review, retry/DLQ |
| 1C | 1.9–1.14 | Mock UI, routing, BoD, assistant và observability |
| 1D | 1.15 | Demo/tổng nghiệm thu V7.9a |

Có thể chia task độc lập cho nhiều Coding Agents nhưng một owner duy trì contracts/version; không tự thay shared DTO để làm test riêng pass. Task 1.2 phụ thuộc 1.3/1.4 để ACK sau durability đúng, không triển khai receiver in-memory rồi coi xong.

# 1. Phase GATE 0 — Contracts, DTOs, schemas và interfaces

**Mục tiêu:** đóng băng hợp đồng Phase 9 trước implementation; mô tả ports/DTO cần cho V2.6 mock UI. Phần KPI/HRP-review/AI tương lai còn quyết định domain phải đánh dấu proposed/experimental, không quảng bá là canonical API đã được duyệt. Không viết Prisma schema, SQL migration, receiver hoặc Route Handler tại phase này.

## Task 0.0 — Inventory và ownership của contract

- **Nhiệm vụ:** đối chiếu baseline với repo/schema/domain có thể đọc; tạo danh sách confirmed/proposed/unknown và dependency HRP-owned PR.
- **Output:** `docs/contracts/inventory.md`, `docs/contracts/decision-register.md`.
- **Dependency:** không có.
- **Ràng buộc:** API chưa tồn tại không được đánh dấu implemented; close enum mới thay định nghĩa cũ.
- **AC:**
  - [ ] Mỗi command/query/event có owner, consumer, trạng thái hiện có/cần xây và nguồn yêu cầu.
  - [ ] Ghi rõ open-status set, transitions, HRP review pre/post-apply, managed-mode policy, KPI attribution là những quyết định cần domain review, không tự bịa.
  - [ ] Inventory phân biệt Integration DB được phép với HRP core không được truy cập.

## Task 0.1 — Enums và constants chính thức

- **Nhiệm vụ:** khai báo trong `packages/contracts/src/enums.ts`; nhãn tiếng Việt tách wire values.
- **Dependency:** 0.0.
- **AC:**
  - [ ] PlacementCase stages đúng: NEW, CONTACTING, QUALIFYING, MATCHING, PROPOSED, INTERESTED, CLIENT_PROCESS, READY_TO_START.
  - [ ] Status đóng duy nhất đã xác nhận là CLOSED; closeReason đúng 9 giá trị: SUCCESS, NO_LONGER_LOOKING, UNREACHABLE, NO_SUITABLE_JOB, CANDIDATE_WITHDREW, CLIENT_REJECTED, DUPLICATE_CASE, INVALID, OTHER.
  - [ ] Availability đúng AVAILABLE_NOW, AVAILABLE_FROM_DATE, NOT_AVAILABLE, DO_NOT_CONTACT, UNKNOWN.
  - [ ] CurrentRelationship đúng NEVER_WORKED, WORKING_VIA_HRP, FORMER_HRP_WORKER, WORKING_EXTERNAL, UNKNOWN; chỉ trong read result.
  - [ ] Không nhận CLOSED_SUCCESS, không dùng closeReason như stage; không phát minh status “không nghe máy”.
  - [ ] NextAction OPEN/DONE/CANCELLED và matching outcomes được khai báo riêng, không lẫn enum mapping.

## Task 0.2 — Request/response envelopes và error taxonomy

- **Nhiệm vụ:** `envelopes.ts`, `errors.ts`, `primitives.ts`; TypeScript types khớp runtime schemas nếu dùng Zod, ưu tiên infer type từ schema để tránh drift.
- **Dependency:** 0.1.
- **Request:** schemaVersion, commandId, idempotencyKey, correlationId, organizationId, source(provider, connectionId), actor và payload typed theo command.
- **Actor:** phân biệt USER/SERVICE và delegated actor nếu có; field là claim cần auth layer kiểm chứng, không phải proof. Connection/provider cho command từ HRP UI phải có semantics tường minh, không gán Zalo giả.
- **Response:** status ACCEPTED/APPLIED/FAILED, commandId/correlationId, data và errors theo discriminated union.
- **AC:**
  - [ ] ACCEPTED có durable operation reference/query contract, không chứa dấu hiệu applied giả; APPLIED có data đúng command và errors rỗng; FAILED có ≥1 structured error và không chứa success data.
  - [ ] Taxonomy tối thiểu VALIDATION_ERROR, UNRESOLVED_IDENTITY, POLICY_REJECTION, VERSION_CONFLICT, IDEMPOTENCY_CONFLICT; bổ sung auth/forbidden/dependency/rate-limit theo ADR, có retryability rules.
  - [ ] Không raw stack/SQL/provider body hoặc secrets; field paths không echo giá trị PII. UI dùng message key/translation, không hiển thị code thô.
  - [ ] Validate format/size/version của IDs/timestamps; không ép canonical IDs là UUID khi chưa xác minh HRP.
  - [ ] Quy định same key/same payload và same key/different payload; scope bao gồm organization/command. CorrelationId không thay idempotency key.
  - [ ] Malformed actor/source, unknown version, inconsistent response status bị reject trong fixtures.

## Task 0.3a — Identity và evidence DTOs

- **Output:** `commands/identity.ts`, `evidence.ts`.
- **Dependency:** 0.1–0.2.
- **Nhiệm vụ:** createOrMatchLaborProfile input identity/provenance/evidenceRef[] và outcome EXACT_MATCH/POSSIBLE_MATCH/NEW_PROFILE.
- **AC:**
  - [ ] EXACT/NEW có canonical ID/version; POSSIBLE có review reference, không có target đã được phép mutation. Candidate details chỉ read theo reviewer capability.
  - [ ] NEW_PROFILE là command result, không thành matching state thứ tư của ExternalContactLink.
  - [ ] SĐT normalized là signal, không unique-person proof hoặc idempotency key duy nhất; thiếu evidence không ép tạo NEW.
  - [ ] EvidenceRef opaque ID + kind front/back, không base64/raw Zalo URL/public URL; scan/ownership do server xác minh, không tin client flags.
  - [ ] Tách identity signal DTO tối thiểu với complete-intake DTO yêu cầu họ tên/SĐT/CCCD/địa chỉ/2 mặt/intent. DNC action không bị buộc đủ intake.

## Task 0.3b — Profile completion, staff review và read-only preview

- **Output:** `commands/profile.ts`, `intake.ts`.
- **Nhiệm vụ:** updateLaborProfile có laborProfileId, whitelist patch, evidenceRef[], expectedVersion; submission/review revision DTO.
- **Dependency:** 0.3a.
- **AC:**
  - [ ] Fill-missing semantics được ghi rõ; patch không có CurrentRelationship/Handling/Beneficiary hoặc arbitrary fields.
  - [ ] Review confirmation ràng buộc draft revision/digest, actor/time/context; thay field/evidence/intent/target làm confirmation cũ invalid.
  - [ ] Preview chỉ dùng read-only resolver port; không dùng createOrMatch mutation.
  - [ ] EXACT vẫn qua staff review trước submit; profile target/version khác bản review yêu cầu xem lại.
  - [ ] Submission received, canonical applied và HRP reviewed là ba ý nghĩa tách biệt; review enum tương lai đánh dấu proposed, không tự approved.

## Task 0.3c — PlacementCase open/update/close

- **Output:** `commands/placement-case.ts`.
- **Dependency:** 0.1–0.2.
- **AC:**
  - [ ] Open nhận laborProfileId và requested stage/context; không bắt caller gửi placementCaseId của đối tượng chưa tạo. Update/close yêu cầu placementCaseId và expectedVersion.
  - [ ] Close yêu cầu closeReason; status=CLOSED là tác động server-owned, không dropdown stage đóng mới.
  - [ ] Schema chỉ validate shape/enum; one-active-case, allowed transition, close-success evidence và concurrent updates ghi rõ là HRP runtime gates.
  - [ ] OTHER explanation policy được ghi tường minh là đề xuất cần chốt; một job bị reject không tự đóng toàn case.
  - [ ] Không có direct EFFECTIVE/Worker/Beneficiary mutation; CLOSED/SUCCESS không tương đương EFFECTIVE.

## Task 0.3d — Interaction Talent và Client

- **Output:** `commands/interactions.ts`.
- **Dependency:** 0.2.
- **AC:**
  - [ ] Talent có laborProfileId, placementCaseId optional, channel, direction, occurredAt, actorUserId, outcome, summary, externalConversationId.
  - [ ] Client context là company/contact/opportunity đúng loại; không ép LaborProfile/PlacementCase. Fields bắt buộc chưa xác nhận phải là decision register, không giấu optional tùy tiện.
  - [ ] Không rawTranscript/messages dump/attachment bytes; strict payload reject unknown fields và giới hạn summary. Tài liệu nói rõ schema không thể chứng minh nội dung summary không phải transcript ngắn, cần policy minimization.
  - [ ] actorUserId khớp auth/delegation policy tại runtime; tự động inbound cần technical actor mapping được duyệt, không lấy assignee giả user.
  - [ ] effectiveAt/recordedAt và nguồn audit xác định tách occurredAt do caller cung cấp.

## Task 0.3e — Availability và suppression contracts

- **Output:** `commands/availability.ts`, `suppression.ts`.
- **Dependency:** 0.1–0.2.
- **AC:**
  - [ ] Input có laborProfileId, availability, expectedVersion; AVAILABLE_FROM_DATE bắt buộc ngày lịch hợp lệ, validation “tương lai” dùng business clock/runtime context, không ngày hiện tại hardcode.
  - [ ] Các state khác xử lý ngày cũ rõ ràng; không tự đổi CurrentRelationship/case.
  - [ ] DNC event/dispatch authorization/fencing contracts mô tả actor/version/cut-off; cache stale không được cấp phép gửi.
  - [ ] Unresolved contact có local safety suppression reference không tạo canonical profile, không đòi CCCD.
  - [ ] Inbound không tự gỡ DNC; automatic delivery fail closed khi không xác minh contactability.

## Task 0.3f — NextAction và lịch

- **Output:** `commands/next-action.ts`, `scheduling.ts`.
- **Dependency:** 0.1–0.2.
- **AC:**
  - [ ] Define create/update intent rõ: target context, actionId khi update, expectedVersion khi sửa, OPEN/DONE/CANCELLED, due/scheduled time và timezone.
  - [ ] Runtime transition và target ownership thuộc HRP, không suy ra chỉ vì schema pass.
  - [ ] Snooze/dismiss notification khác DONE; schedule revision/occurrence có key cho dedupe reminder.
  - [ ] DTO planning batch có per-item outcome, không báo all success khi một mục lỗi.

## Task 0.3g — Outbox và delivery contract

- **Output:** `outbox.ts`, `delivery.ts`.
- **Dependency:** 0.2, 0.3e.
- **AC:**
  - [ ] Phân biệt transactionalOutboxPublisher là HRP internal tx port với dispatcher handoff DTO; không serialize Prisma transaction object hoặc gọi HTTP sau commit để giả atomicity.
  - [ ] Intent có ID/schema/source/destination reference/approved content hoặc template data/correlation/dedupe; không nguyên hồ sơ/CCCD.
  - [ ] Chọn ADR HRP-side push hoặc claim/ack API; thiết kế lease/fencing/ACK sau durable acceptance, không cần core DB credentials.
  - [ ] Handoff accepted khác provider sent/delivered; UNKNOWN/suppressed có semantics, không hứa exactly-once provider.
  - [ ] Retry/DLQ re-drive không bypass DNC; missing API là HRP-owned PR.

## Task 0.3h — Interfaces Gateway, Provider và các ports

- **Output:** `gateway.ts`, `providers.ts`, `ports.ts`.
- **Dependency:** 0.3a–g.
- **AC:**
  - [ ] CanonicalHrpGateway methods typed request/result theo từng command; tách privileged merge capability khỏi inbound default gateway.
  - [ ] Provider có verifyWebhook, normalizeInboundEvent, resolveExternalIdentity, mapConversation; verification nhận raw bytes/headers, không JSON đã reserialize.
  - [ ] Interfaces ReceiptRepository, MappingRepository, Queue, Clock, SecretProvider, Storage, Notification và IdGenerator không import Prisma/Next.js runtime vào contracts.
  - [ ] Interface mock injection hỗ trợ clock/faults deterministic; contract dùng được từ repo HRP và app độc lập.

## Task 0.4 — Queries/events và mapping models

- **Output:** `queries.ts`, `events.ts`, `mappings.ts`.
- **Dependency:** 0.2–0.3.
- **AC:**
  - [ ] Queries context/result/readonly identity/allowed actions/contactability có scope/paging/version; constants UI không phụ thuộc dictionary API.
  - [ ] Events có organization/eventId/aggregate/version/time/source; out-of-order/correction/duplicate semantics và watermark.
  - [ ] ExternalContactLink states EXACT_MATCH/POSSIBLE_MATCH/UNRESOLVED; Talent/Client target union, scope provider/connection/account rõ.
  - [ ] Conversation link giữ history/context revision; mutation target lấy mapping tin cậy, không Chatwoot attributes.
  - [ ] Creation events phân biệt submittedBy/executingActor/creditedCreator/source; chưa có review/attribution nguồn thì trả unavailable, không đoán.

## Task 0.5 — Contracts cho routing, BoD, KPI và AI mock UI

- **Output:** `routing.ts`, `analytics.ts`, `kpi.ts`, `ai-proposals.ts`, `ai-provider-config.ts`.
- **Dependency:** 0.2, 0.4.
- **AC:**
  - [ ] Routing source allocation khác weighted recipient distribution; pool/eligible set/weight/cap/version/decision/reservation có DTO.
  - [ ] Metric definition có grain/unit/period/cohort/source/as-of/version/attribution; profile created/updated/submitted khác nhau.
  - [ ] KPI assign/revise claims manager-owned; sale/AI read/propose không tự mutate target. HRP module chưa xác nhận đánh dấu proposed.
  - [ ] AI proposal có revision/fields/evidence/uncertainty/context; không arbitrary command payload hoặc direct writes.
  - [ ] Provider config gồm base URL/model/apiStyle Responses hoặc Chat Completions/secretRef/capabilities/budget/data policy. Read DTO không chứa API key.
  - [ ] Phần Phase 10 chưa đủ domain decision được tách namespace experimental/version, không chặn đóng Gate 0 Phase 9 nhưng không dùng production mutation.

## Task 0.6 — Permission/error/policy boundary matrix

- **Output:** `docs/contracts/authorization-policy-matrix.md`.
- **Dependency:** 0.3–0.5.
- **AC:**
  - [ ] Mỗi command/query có service/user/delegation/scopes/object authorization, audit requirements và retry class.
  - [ ] Phân biệt schema validation với runtime auth/concurrency/one-active-case/merge approval/CCCD scan/HRP review.
  - [ ] BoD aggregate không mặc định transcript/evidence; secret operator không mặc định đọc hồ sơ.
  - [ ] Không tự đặt auth JWT algorithm/signature protocol cho Zalo khi chưa xác minh; signature provider và API auth là hai ranh giới riêng.

## Task 0.7 — Shared fixtures, package validation và versioning

- **Output:** `packages/contracts` package exports, fixture tests, README và changelog.
- **Dependency:** 0.1–0.6.
- **AC:**
  - [ ] Typecheck strict và runtime positive/negative fixtures chạy được; unknown fields và prohibited fields reject theo DTO, không silently strip mutation nguy hiểm.
  - [ ] Fixture coverage: three match outcomes, CLOSED/reasons, date condition, read-only relationship, malformed envelopes, evidence URL, raw transcript, no-op update, retry errors.
  - [ ] Không secrets/PII; constants/types/runtime schemas không lệch; compatibility/version policy và consumers pin version.
  - [ ] Test không dùng schema pass làm bằng chứng policy runtime đã thực thi.

## Task 0.8 — Gate 0 review bundle và freeze

- **Output:** `docs/reviews/gate-0-checklist.md` kèm contracts manifest/version và open decisions.
- **Dependency:** tất cả 0.x.
- **AC:**
  - [ ] Owner có bảng command-by-command: fields, results, permissions, invariants, error/retry và files để review.
  - [ ] Critical Phase 9 decisions đã chốt hoặc path bị disable rõ ràng; proposed Phase 10 không bị công bố canonical-ready.
  - [ ] Không Prisma/Route Handler/domain backend trong PR Gate 0.
  - [ ] Ghi nhận Owner xác nhận Gate 0 trước bắt đầu V7.9a implementation phụ thuộc; chưa tự chuyển HRP-owned PR.

# 2. Phase V7.9a — Integration Core, Mock Gateway và Mock UI

**Mục tiêu:** chứng minh receipt bền, dedupe, retry/review và UI orchestration bằng mock; HRP core không bị truy cập. Webhook receiver dưới đây là API của Integration, không phải Canonical HRP Route Handler.

## Task 1.0 — Scaffold và boundaries

- **Output:** `apps/integration-api`, `apps/integration-worker`, `apps/context-panel` và packages theo ADR.
- **Dependency:** Gate 0 được xác nhận.
- **AC:**
  - [ ] Runtime/API/worker config tách, contracts version pinned; không import HRP Prisma client hoặc đặt HRP core DSN.
  - [ ] Chế độ mock hiển thị rõ; startup chặn mock bị gắn nhãn production.
  - [ ] Dependencies có lockfile, synthetic env example, health/readiness phân biệt service alive/dependencies ready.

## Task 1.1 — CanonicalHrpGateway deterministic mock

- **Nhiệm vụ:** implement typed gateway, injectable clock/IDs/scenarios, mock command result ledger; không viết logic domain thật.
- **Dependency:** 0.3h, 0.7, 1.0.
- **AC:**
  - [ ] EXACT/POSSIBLE/NEW theo fixture ID; cùng fixture/clock có cùng kết quả, không Math.random ảnh hưởng assertion.
  - [ ] Mô phỏng timeout trước apply, timeout sau apply, permission/policy/version/idempotency conflict và malformed dependency response.
  - [ ] Same key/same payload trả cùng result; key khác payload conflict. Result ledger test đủ bền qua worker retry/restart scenario hoặc nêu rõ limitation của fixture runtime.
  - [ ] Call log chứng minh no forbidden side effect, không fake merge/Worker/EFFECTIVE từ chat.
  - [ ] Mock one-active-case result là scenario simulation, không bằng chứng concurrency Prisma HRP.

## Task 1.2 — Webhook Receiver & Idempotency

- **Dependency:** 1.0, 1.3, 1.4; provider interface Gate 0.
- **Nhiệm vụ:** Integration endpoint nhận raw bytes, verify, normalize minimal envelope, lưu receipt/job atomically.
- **AC:**
  - [ ] Test-provider endpoint trả HTTP 202 chỉ sau durable receipt + recoverable processing intent commit; không đợi mock HRP xử lý xong.
  - [ ] eventId/connectionId là nền dedupe nhưng unique scope gồm organization/provider/connection/eventId phù hợp uniqueness provider; connection scope xác minh server-side.
  - [ ] Retry webhook cùng ID/hash không sinh job logic mới; cùng ID khác hash bị reject/quarantine với audit.
  - [ ] Không có eventId phải dùng documented stable fallback theo event type hoặc reject có lý do; không dùng timestamp receipt mới làm key.
  - [ ] Sai verification không enqueue nghiệp vụ; DB unavailable không trả success ACK; payload/size/rate limits.
  - [ ] Response ACK của provider thật cần adapter protocol xác minh ở V7.9b/c; không áp đặt 202 nếu provider yêu cầu 200/challenge body. Mock verify không tuyên bố xác thực Zalo thật.

## Task 1.3 — Integration Store riêng

- **Output:** `packages/integration-store/prisma/schema.prisma`, migrations, repositories; PostgreSQL integration test riêng.
- **Dependency:** 0.4, 1.0.
- **AC:**
  - [ ] ExternalContactLink scoped target union/match state/evidence review/version; ExternalConversationLink history/current context; ExternalEventReceipt event hash/state/attempt/lease/correlation/command refs.
  - [ ] Canonical HRP IDs chỉ scalar references, không FK sang HRP, không copy LaborProfile/PlacementCase canonical tables.
  - [ ] Unique indexes và transactional repository xử lý duplicate; mọi query theo organization/scope.
  - [ ] Receipt/job state và durable dispatch intent không có gap dual-write; nếu queue riêng thì integration outbox cùng transaction hoặc poll receipt bền.
  - [ ] Payload lưu tối thiểu; raw media không trong receipt. Quarantine/PII path production deferred residency gate, fixtures synthetic.
  - [ ] Migration fresh DB và upgrade path kiểm tra; rollback không âm thầm xóa receipts pending.

## Task 1.4 — Durable worker/queue leasing

- **Dependency:** 1.3, Queue/Clock ports.
- **AC:**
  - [ ] Chọn ADR poll PostgreSQL hoặc queue + integration outbox; crash sau receipt commit trước queue publish vẫn được recover.
  - [ ] Hai worker claim cùng receipt chỉ một lease hợp lệ; attempts/nextAttemptAt/owner/fencing rõ; stale worker không commit kết quả ghi đè owner mới.
  - [ ] Crash/lease expiry → retry bền; worker shutdown có drain/lease recovery.
  - [ ] Retry command giữ idempotency key; không tạo key theo attempt.

## Task 1.5 — Normalize, mapping và semantic firewall

- **Dependency:** 1.1–1.4.
- **AC:**
  - [ ] Chỉ event authoritative tạo action; echo/private note/assign/resolve không tự tạo PlacementCase, Handling hoặc outbound loop.
  - [ ] UNKNOWN/POSSIBLE mapping giữ receipt có review, không ép target; raw chat tiếp nhận không cần tạo profile.
  - [ ] Talent/Client branches tách; spoof hrp_* attributes không thay target canonical.
  - [ ] Out-of-order/mapping revision đổi không áp dụng sai target; reconciliation/read mock xử lý hoặc chuyển review.
  - [ ] Chat-created event không gọi createOrMatch để tự tạo canonical profile ngoài creation policy; staff-assisted conversion cần review confirmation.

## Task 1.6 — Intake orchestration và checkpoints

- **Dependency:** 1.1, 1.3–1.5, 0.3b.
- **AC:**
  - [ ] Preview không gọi mutation; confirmed revision → identity → fill-missing/review/new → case/availability steps có checkpoint.
  - [ ] EXACT profile no-op không tính created; POSSIBLE dừng để review; NEW chỉ mock accepted policy.
  - [ ] Profile applied rồi case fail: partial result rõ, resume đúng step/key, không delete/recreate.
  - [ ] Target/version khác bản review yêu cầu re-review; frontend checkbox đơn thuần không bypass server binding.
  - [ ] DNC action tách khỏi full intake, không chờ CCCD/HRP-review hồ sơ.

## Task 1.7 — Unresolved review service skeleton

- **Dependency:** 1.3, 1.5–1.6.
- **AC:**
  - [ ] List/detail/review qua permissions mock có server-side scope check; candidate PII không trả ngoài quyền.
  - [ ] Quyết định có reviewer/reason/version/audit; stale reviewer conflict, không overwrite.
  - [ ] Link/unlink/relink khác merge; review handler không có merge capability mặc định.
  - [ ] Replay sau review revalidate mappings/context; không lặp mutation đã applied.

## Task 1.8 — Retry, DLQ, reconciliation và outbox handoff mock

- **Dependency:** 1.1, 1.3–1.7.
- **AC:**
  - [ ] Lỗi retryable dùng bounded exponential backoff/jitter qua injected clock; policy/validation errors không retry vô tận.
  - [ ] DLQ có safe error metadata, attempts và redrive scope; redrive giữ event/command keys, actor audit, DNC guards.
  - [ ] Simulate accepted HRP outbound intent → durable receipt → ACK → mock provider; duplicate intent không sinh delivery logic trùng.
  - [ ] UNKNOWN cần reconcile scenario, không mark delivered hoặc gửi lại mù; failed handoff không fake success.
  - [ ] Reconciler tìm stuck receipt/job/mapping/result và tạo recovery có dedupe; không SQL HRP/outbound thật.

## Task 1.9 — Context Panel + Intake review mock UI

- **Dependency:** 1.1, 1.6–1.7, contracts.
- **AC:**
  - [ ] React/Next UI dùng mock API/gateway, tokens cam đề xuất có branding verification task; không tự nhận mã màu là chính thức nếu chưa kiểm tra.
  - [ ] Talent/Client layout riêng; PlacementCase/Availability controls tách; CurrentRelationship badge read-only; close reason dropdown đúng 9 giá trị.
  - [ ] Intake review/diff/evidence giả → checkbox không prechecked → confirm; edit làm mất confirmation cũ.
  - [ ] States loading/empty/forbidden/unresolved/stale/timeout/partial success có tiếng Việt tự nhiên; không raw errors.
  - [ ] Hỗ trợ keyboard, panel hẹp, focus/contrast; chưa claim embedded Chatwoot thật (V7.9b).

## Task 1.10 — Media/secret/storage ports và policy harness

- **Dependency:** 0.3a/h, 1.0.
- **AC:**
  - [ ] Synthetic evidence READY/QUARANTINED/REJECTED/REVOKED scenarios; chưa nhận CCCD thật.
  - [ ] Fake secret provider trả refs, không browser key; logs redacted.
  - [ ] Test policy chống URL SSRF/public evidence/foreign organization; không claim antivirus/storage VN đã production vì mock pass.
  - [ ] ADR-MEDIA-01-VN, residence dependencies, TTL/cleanup/UNKNOWN behavior được bàn giao rõ cho V7.9c.

## Task 1.11 — Routing config UI và simulator

- **Dependency:** 0.5, 1.0/1.3 khi cần persistence config.
- **AC:**
  - [ ] Source assignment khác weighted distribution; simulation 3:2:1:4 đạt mục tiêu theo định nghĩa batch/realtime.
  - [ ] Offline/capacity/quota eligibility, fallback queue, config revision và no catch-up burst scenarios.
  - [ ] UI preview 10/100 khách, không gọi Chatwoot assignment API thật, không thay Handling/credit.
  - [ ] AI/sale không tự sửa weights nếu thiếu manager capability.

## Task 1.12 — BoD board mock và profile/KPI data fixtures

- **Dependency:** 0.5, 1.0.
- **AC:**
  - [ ] Chart-first mock có profile created toàn nguồn/theo sale, update/submission/review/outcome riêng, target-vs-actual và tăng trưởng.
  - [ ] Nếu chỉ fixture chat-source thì không nhãn tổng công ty; source coverage/grain/as-of và credit policy rõ.
  - [ ] Click chart/KPI → scoped drill-down cùng filters/snapshot; keyboard/table fallback.
  - [ ] KPI chỉ manager giao/sửa trong mock auth flow, sale/AI không tự đổi; target zero/partial kỳ/thiếu review source hiển thị đúng.
  - [ ] Không gọi model để tính KPI hoặc truy HRP DB.

## Task 1.13 — Personal assistant/planning/autofill prototype

- **Dependency:** 0.5, 1.9.
- **AC:**
  - [ ] Hôm nay của tôi và tuần dùng deterministic suggestions/fixtures, không gọi external AI.
  - [ ] Autofill field có evidence/uncertainty/conflicts, stale context discarded; chỉ draft, vẫn staff review trước gửi mock command.
  - [ ] Planning accept partial per-item, reschedule/version và KPI manager-only scenarios.
  - [ ] Provider config UI skeleton có base URL/model/apiStyle/secretRef/budget; không nhập key thật hoặc bật network probe production.
  - [ ] Nhắc lịch chỉ port/simulator ở phase này; không tuyên bố scheduler production/notification ngoài đã hoàn thành.

## Task 1.14 — Observability và security regression

- **Dependency:** 1.2–1.8.
- **AC:**
  - [ ] Correlation xuyên receipt → decision → mock command → result; metrics lag/retries/DLQ/mapping review, không PII label.
  - [ ] Organization/object/actor spoof, unknown fields, error-leak và review bypass regression pass.
  - [ ] Scope service tối thiểu; logs không payload/CCCD/key; mocks không có route bypass auth ngoài test harness cô lập.
  - [ ] Kill-switch worker/provider-mock và recovery runbook; không expose raw DB admin/service internals vào UI sale.

## Task 1.15 — V7.9a acceptance demo và bàn giao

- **Dependency:** 1.0–1.14.
- **AC:**
  - [ ] Chạy checklist tích hợp ở §C với Integration PostgreSQL thật cho durability/concurrency, Mock Gateway cho HRP.
  - [ ] Demo mới từ clean environment, seed synthetic, start API/worker/UI; stop/restart worker recovery không mất receipt.
  - [ ] Có AC report, commands tái hiện, logs đã redact, known limitations và danh sách HRP-owned PR cần tiếp theo.
  - [ ] Nêu rõ chưa verify native Chatwoot/Zalo signatures/API, chưa scan CCCD thật, chưa canonical DB tests, chưa AI production.
  - [ ] Không tự chuyển sang HRP-owned backend hoặc rollout production nếu chưa có phạm vi/approval tiếp theo.

## C. Bộ scenario nghiệm thu tích hợp bắt buộc

| ID | Scenario | Pass khi |
|---|---|---|
| A01 | Cùng event gửi đồng thời từ nhiều request | Một receipt logic trong scope, không nhiều canonical side effects |
| A02 | DB lỗi trước persist | Không success ACK, request retry được |
| A03 | Crash sau persist trước enqueue/process | Job được khôi phục từ durable intent |
| A04 | Lease hết hạn, worker cũ quay lại | Fencing ngăn stale completion ghi đè |
| A05 | Mock HRP apply rồi mất response | Retry key cũ trả kết quả cũ, không tạo NEW lần hai |
| A06 | EventId trùng payload khác | Quarantine/reject có audit, không coi duplicate hợp lệ |
| A07 | POSSIBLE_MATCH và two-reviewer conflict | Không mutation candidate; review version guard |
| A08 | Profile applied, case fail | UI partial success; retry đúng step |
| A09 | Preview/autofill/macro trước confirm | Không canonical create/update call |
| A10 | Close case/Availability/Relationship | CLOSED+reason đúng, trục độc lập, relationship write reject |
| A11 | DNC + pending mock delivery + redrive | Không gửi tự động; unknown contactability giữ chờ |
| A12 | Cross-org query/command/evidence/BoD detail | Bị từ chối; không leak snippets/IDs ngoài quyền |
| A13 | Spoof custom attributes/assignee | Không đổi canonical target/Handling/hoa hồng |
| A14 | Routing/model/mock UI fixtures | Weight/caps/manager KPI/review invariants giữ nguyên |
| A15 | HRP mock/provider mock offline | Receipts còn bền, core không bị truy cập; UI lỗi tự nhiên |

## D. Mẫu bàn giao bắt buộc cho từng PR

- Task ID(s), baseline contract version và commit.
- Files changed + output mapping; task dependencies đã Done.
- AC từng dòng: PASS/FAIL/BLOCKED, evidence/test command và kết quả.
- Schema/migration/queue changes nếu là V7.9a; Gate 0 không có mục này.
- Security/privacy considerations cụ thể, không checklist giả định chung chung.
- Known limitations, unresolved decisions, migration/rollback và hướng chạy lại.

**Điểm dừng bàn giao:** Gate 0 được Owner review riêng. V7.9a được nghiệm thu bằng mock riêng. Cả hai không thay thế Gate HRP-Owned PRs hoặc cho phép truy cập Prisma core từ Integration.
