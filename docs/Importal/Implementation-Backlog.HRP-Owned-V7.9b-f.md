# Implementation Backlog — HRP-Owned PRs & V7.9b–f

**Ngày:** 13/09/2026. **Baseline:** Master-Plan.V2.6.md, hrp-connector.md v1.1 và Implementation-Backlog.Gate0-V7.9a.md.  
**Phạm vi:** kế hoạch giao Coding Agents; không code/deploy trong tài liệu này. Tiếp nối Gate 0 và Integration Core/mock. Phase 10 AI/BoD production là backlog riêng; mock UI đã có không được coi là feature production.

## 1. Dependency và nguyên tắc nghiệm thu

| Đợt | Workstream | Điều kiện |
|---|---|---|
| A | H.01–H.09: HRP-owned APIs | Gate 0 Owner xác nhận, mock/shared fixtures V7.9a đủ cho command đang làm |
| B | B.01–B.06: Chatwoot POC | V7.9a nghiệm thu; có thể dùng mock với nhãn rõ, canonical integration cần H tasks tương ứng |
| C | C.01–C.09: OA production | POC đạt; commands đúng luồng đã pass staging, security/residency gates theo dữ liệu sử dụng |
| D | D.01–D.06: HRP outbound/broadcast | H.07 atomic outbox đạt; OA transport ổn định, suppression gate đạt |
| E | E.01–E.04: reconciliation/DLQ | Receipt/command/outbox contracts ổn định, dữ liệu vận hành có nguồn đối soát |
| F | F.01–F.05: hardening/pilot | Gates của các paths định bật đã đạt; không bật path chưa đủ dependencies |

- H tasks thực thi trong repo HRP, đọc AGENTS.md/AI_CODING_GUARDRAILS.md thực tế. Thiếu command phải HRP-owned PR, không SQL từ ACL.
- B/C/D/E tasks trong Integration/Chatwoot extension/config; DB connections và credentials không vượt ownership.
- DTO đã freeze cần change proposal/version nếu sửa, không sửa interface cục bộ để bỏ test thất bại.
- AC phải có evidence staging/synthetic, không lấy mock pass làm provider/HRP DB proof.
- Chưa triển khai provider/API chưa kiểm chứng. Command/route names đề xuất cần map chính xác với code được HRP duyệt.
- Mỗi PR: task IDs, dependencies, change list, AC PASS/FAIL/BLOCKED, tests, migration/rollback, limits. Production rollout/gửi khách thật chỉ trong phạm vi Owner cho phép.

# 2. Gate HRP-Owned PRs — Canonical implementation

## H.01 — Canonical command infrastructure

**Output:** HRP domain command services + Next.js 15 Route Handlers, TS 5.7/Prisma 5.22 theo repo; auth/audit/result infrastructure. **Dependency:** Gate 0 0.2/0.6/0.8, mock fixtures.

**AC:**
- [ ] Request/version/schema validate trước domain execution; actor/service/delegation và organization/object scopes xác thực server-side.
- [ ] Mutation, idempotency result, success audit và outbox khi có intent cùng transaction. Same key/different digest conflict, same key/same payload replay không tạo rác.
- [ ] Timeout sau commit truy/retry cùng key; response ACCEPTED/APPLIED/FAILED không lẫn review approval.
- [ ] Audit effectiveAt/recordedAt/actor/source đúng; denied attempts không tạo success audit giả; logs không raw PII.
- [ ] Concurrent idempotency request và transaction rollback được test trên HRP staging DB; không chỉ mock.

## H.02 — Identity resolution và staff-assisted profile completion

**Output:** createOrMatchLaborProfile/updateLaborProfile, read-only preview nếu cần; evidence claim authorization. **Dependency:** H.01, Gate 0 identity/intake contracts.

**AC:**
- [ ] EXACT/POSSIBLE/NEW theo policy HRP, SĐT không bằng chứng auto-merge; concurrent submission không duplicate do retries.
- [ ] Preview không mutation; staff confirmation ràng buộc revision/target/payload; change sau review phải xác nhận lại.
- [ ] EXACT fill-missing whitelist/version; không overwrite dữ liệu đã xác minh hoặc nhận CurrentRelationship field từ client.
- [ ] evidenceRef opaque IDs đúng scope/scan/ownership; không tin scanPassed client hoặc URL bất kỳ.
- [ ] Source/submittedBy/executingActor/creation credit không lẫn; update/no-op không tạo creation metric.

## H.03 — Privileged identity review/merge integration

**Output:** HRP-owned merge workflow/command và read capabilities cho review. **Dependency:** H.01–H.02, mapping review contracts.

**AC:**
- [ ] Link review khác merge; webhook default principal không có merge scope.
- [ ] Approval/version/lý do/evidence kiểm tra khi execute; hồ sơ có conflicting active cases/attribution không tự chọn bên thắng.
- [ ] Canonical merge/correction có audit và event cho ACL remap; không replay mutations lịch sử vào target mới một cách mù quáng.
- [ ] Mất quyền reviewer/stale approval/cross-org target bị từ chối; không leak candidate fields ngoài quyền.

## H.04 — PlacementCase open/update/close

**Output:** domain commands theo contracts và DB concurrency guards. **Dependency:** H.01–H.02.

**AC:**
- [ ] Tập active/transition/reopen dựa domain thực tế được ghi lại, không suy diễn từ enum order.
- [ ] Hai request mở đồng thời vẫn tối đa một active case/profile, có bằng chứng DB constraint/locking/transaction.
- [ ] Close ghi status=CLOSED và một trong 9 closeReason cùng transaction; review staff/expectedVersion/idempotency đạt.
- [ ] SUCCESS không tự EFFECTIVE/Worker; UNREACHABLE không tự kích hoạt từ một lần không nghe máy; reject một Application không tự đóng toàn case.
- [ ] Case change không tự Availability/Handling/Referral; reopen giữ audit closure trước.

## H.05 — Availability và contactability enforcement

**Output:** availability command, contactability query/dispatch authorization và suppression event. **Dependency:** H.01–H.02; H.07 transaction publisher khi phát event.

**AC:**
- [ ] AVAILABLE_FROM_DATE validate date/business clock, xử lý ngày cũ khi đổi enum; relationship projection chỉ đọc.
- [ ] DO_NOT_CONTACT cùng suppression event/outbox transaction; không chờ đầy đủ CCCD/intake review để dừng tin.
- [ ] Protocol freshness/fencing xác định cut-off với send đồng thời; stale cache không cấp phép gửi.
- [ ] Recontact permission/căn cứ/audit riêng; inbound mới không tự gỡ DNC.
- [ ] Command/consumer outage tests fail closed cho gửi tự động, không mất yêu cầu opt-out.

## H.06 — Interaction Talent/Client và NextAction

**Output:** recordInteraction, recordClientInteraction, updateNextAction và queries/events. **Dependency:** H.01, identity/context contracts.

**AC:**
- [ ] Payload summary/ref only, target/case/company relationships validate; reject raw transcript/fields không cho phép.
- [ ] Human/technical actor có mapping đã duyệt, không lấy chat assignee giả actor.
- [ ] NextAction OPEN/DONE/CANCELLED có version/transition; snooze notification không DONE, không reset Handling SLA.
- [ ] Schema/authorization failures không retry vô tận; deadline/date và occurredAt/audit time không lẫn.

## H.07 — Transactional outbox publisher và handoff

**Output:** HRP outbox schema/migration, tx-aware publisher và HRP-side push hoặc claim/ack API theo ADR. **Dependency:** H.01, Gate 0 outbox contract. H.05/H.07 cùng release nếu cần tránh dependency vòng.

**AC:**
- [ ] Provider call không nằm trong DB transaction; rollback xóa cả domain change/intent, commit giữ cả hai.
- [ ] ACL không có core DB credentials; consumer receipt durable trước handoff ACK.
- [ ] Lease/owner/fencing khi polling, retry cùng intent ID; crash trước/sau ACK không tạo hai logic deliveries.
- [ ] ACCEPTED handoff không hiện delivered; UNKNOWN/delivery report separate; retention/re-drive policy documented.

## H.08 — Context/events/analytics source APIs

**Output:** read-only context/results/events, paginated source export/backfill. **Dependency:** H.02/H.04–H.07.

**AC:**
- [ ] Context fields theo permissions, CurrentRelationship từ HRP projection; custom attrs không nguồn authorization.
- [ ] Events có stable IDs/version/time/correction semantics; queries có cursor/watermark/as-of/rate/size limits.
- [ ] Profile created toàn nguồn/manual/import/chat phân biệt updates/submissions; missing source coverage không giả tổng công ty.
- [ ] Outcome attribution từ policy HRP, không chat assignee; events không tự quyết định credit còn thiếu.
- [ ] BoD aggregate permission không ngầm mở transcript/CCCD/export toàn bộ.

## H.09 — Gateway thật và canonical readiness gate

**Output:** Integration HTTP gateway + shared fixture validation/report. **Dependency:** các H tasks của luồng bật.

**AC:**
- [ ] Pin contracts/version/auth endpoints; tests fixture mock/real tương thích result/error semantics.
- [ ] Synthetic end-to-end identity→completion→case/availability→interaction, timeout recovery và scope denial đạt staging.
- [ ] HRP down không mất receipt hoặc làm core nhập tay/điện thoại phụ thuộc provider.
- [ ] Thiếu API trả capability unavailable có lý do, không fallback Prisma.

**Chưa mặc định triển khai:** HRP submission-review pre/post-apply, Placement EFFECTIVE managed-mode workflow và KPI/planning modules cần domain decisions/PR riêng. Nếu chưa có, UI không giả approved/EFFECTIVE hoặc KPI canonical-ready.

# 3. V7.9b — Chatwoot POC thật

## B.01 — Pin release/edition và triển khai POC cô lập

**Output:** ADR release/license/capabilities, isolated deployment/config/runbook. **Dependency:** V7.9a.

**AC:**
- [ ] Một account công ty, API inbox test, ít nhất hai agents/test roles; secrets không commit, DB/Redis không mở public.
- [ ] Xác minh edition hỗ trợ scopes/panel/assignment/branding thực tế; unsupported features không được hứa sẵn.
- [ ] Backup/restore cơ bản và upgrade/rollback thử ở POC; chưa dữ liệu khách/CCCD thật.

## B.02 — Chatwoot adapter và event authority

**Dependency:** B.01, receiver/worker V7.9a.

**AC:**
- [ ] Verify/ACK đúng protocol khả dụng và trust boundary đã chốt; không giả signature provider chưa có.
- [ ] Chọn authoritative event path, dedupe account webhook/API-inbox echo/private note.
- [ ] Replay/resolve/reopen/assign không tự case/Handling/Beneficiary hoặc outbound loop.
- [ ] Rate limit/token expiration/malformed callbacks/retry được test với Chatwoot thật.

## B.03 — Context Panel nhúng và authorization

**Dependency:** B.01–B.02, mock UI; H.09 cho canonical data thật.

**AC:**
- [ ] Embedding/auth phù hợp edition; iframe origin/source/session/delegation kiểm tra, không browser admin token.
- [ ] Talent/Client layout, permissions và field masking đúng; attributes bị sửa không đổi canonical target.
- [ ] User revoke chặn API/context/search/media/realtime theo boundary hệ thống kiểm soát được; limitations documented.
- [ ] Errors/timeout/stale data tiếng Việt, keyboard/panel hẹp đạt pilot; mock mode có nhãn rõ.

## B.04 — Intake Form và Unresolved Queue POC

**Dependency:** B.03; H.02/H.03/H.04 khi test canonical thực.

**AC:**
- [ ] Form→review/diff→confirm→result; checkbox không prechecked; sửa revision invalidates confirm.
- [ ] EXACT fill-missing, POSSIBLE reviewer, NEW canonical flow; currentRelationship badge read-only.
- [ ] Hai trục/status CLOSED+reason đúng; target/version conflict re-review; partial profile success không tạo lại.
- [ ] Evidence synthetic trước residency gate; chưa HRP review API thì không hiển thị approved giả.

## B.05 — Routing authority POC

**Dependency:** B.01–B.02, V7.9a simulator.

**AC:**
- [ ] Native auto-assignment và custom router không tranh nhau; config/ADR một authority mỗi pool.
- [ ] Assignment API, manual override/reopen và limits compare-and-set được xác minh; UNKNOWN reconcile thay retry mù.
- [ ] Eligibility theo inbox permissions/ca/capacity; không nới quyền để đủ tỷ lệ.
- [ ] Routing không tạo Handling hoặc sửa creation/outcome credit.

## B.06 — POC exit review

**Dependency:** B.01–B.05.

**AC:**
- [ ] Bằng chứng flow Chatwoot thật, matrix permissions/security và known gaps; canonical mock/real chỉ rõ từng path.
- [ ] Nhân viên thử xem context, review, ghi interaction; blocker usability/quyền được xử lý.
- [ ] Checklist cho OA production có dependencies cụ thể, không “POC chạy được = production-ready”.

# 4. V7.9c — ZALO_OA production đầu tiên

## C.01 — DEPLAO_FEATURE: snapshot inventory và ADR chọn tính năng

**Output:** commit SHA, capability/evidence/license/dependency table. **Dependency:** source snapshot được cung cấp hoặc truy cập hợp lệ.

**AC:**
- [ ] Broadcast/media/subscription có file/function evidence hoặc đánh dấu không tìm thấy/chưa xác minh.
- [ ] Phân biệt Zalo cá nhân/API OA và backend đóng; không port bypass/session auth.
- [ ] Mỗi feature chọn có keep/rewrite/reject rationale, official OA capability và security tests; không coi cảnh báo cũ là exploit đã tái hiện.

## C.02 — OA official adapter/auth/subscription

**Dependency:** B.06, OA/app quyền test được cấp.

**AC:**
- [ ] Xác minh OAuth/token/refresh/signature/challenge/ACK/subscription theo tài liệu hiện hành, không đoán API.
- [ ] Secret rotation concurrent an toàn, chỉ một refresh hợp lệ hoặc cơ chế provider tương ứng; không ghi đè token mới bằng token cũ.
- [ ] Subscription desired/observed state/audit/reconcile; không có API automation thì runbook dashboard rõ.
- [ ] Wrong OA/connection/callback/replay rejected; credentials tách business admin.

## C.03 — Inbound text và Chatwoot bridge

**Dependency:** C.02, B.02, H.09 cho canonical mutations.

**AC:**
- [ ] OA→durable receipt→Chatwoot API inbox→ACL mapping đúng authority, không echo loop.
- [ ] Unknown identity vẫn tiếp nhận chat; canonical interaction chỉ khi target/actor/policy hợp lệ.
- [ ] Duplicate/out-of-order/provider/HRP outage recovery đạt; counters không nhân vì replay.
- [ ] UI lỗi tự nhiên, không giả đã lưu/chốt.

## C.04 — DEPLAO_FEATURE/MEDIA: quarantine→scan→VN storage

**Dependency:** C.01/C.02, storage ADR và residency task C.05.

**AC:**
- [ ] Streaming download chống SSRF/DNS rebinding/redirect/private IPv4/IPv6; max bytes/time/type/decompression guards.
- [ ] Scan fail closed, quarantine private; clean object/preview mới được tham chiếu sau kiểm tra.
- [ ] Evidence IDs/claim ownership/scopes/hash/provenance kiểm tra, không public ACL/raw Zalo URL/CCCD attrs.
- [ ] Signed URL TTL hoặc auth proxy; revoked/expired/foreign-scope access bị chặn; backup/keys được bảo vệ.

## C.05 — CCCD residency và intake data readiness

**Output:** data flow/region/retention inventory + sign-off của owner dữ liệu. **Dependency:** hạ tầng thực tế và H.02 evidence contract.

**AC:**
- [ ] Kiểm tra cả ảnh/số/địa chỉ/temps/logs/backups/scanner/preview; không chỉ chọn bucket Việt Nam.
- [ ] Vercel/Neon region gap được giải quyết bằng HRP-owned phương án nội địa trước nhận CCCD thật; không tạo ACL canonical PII store.
- [ ] Secure upload nội địa ưu tiên; không promise xóa bản Zalo ngoài capability; existing Chatwoot copies cleanup có audit/retention/restore policy.
- [ ] Không OCR/AI cloud CCCD nếu chưa được phép; threat/processing-purpose/retention quyết định được ghi nhận, không tuyên bố VPS nội địa đủ mọi nghĩa vụ pháp lý.

## C.06 — Staff-assisted Intake production path

**Dependency:** B.04, C.04–C.05, H.02/H.04–H.06/H.09.

**AC:**
- [ ] Review dữ liệu thật theo quyền, confirm binding server-side; preview không mutation.
- [ ] Evidence được claim, canonical completion và business steps có checkpoint; timeout không mất profile/tệp.
- [ ] Các trạng thái gửi/applied/HRP-reviewed tách; chưa review backend thì nhãn unavailable/pending phù hợp, không approved.
- [ ] EFFECTIVE path disable/chờ nếu workflow chưa có; không dùng dropdown làm bypass.

## C.07 — Weighted routing production

**Dependency:** B.05/C.03, V7.9a config/store.

**AC:**
- [ ] Atomic decision/reservation; 3:2:1:4 phân bổ theo eligible set, caps/quota/fallback/sticky rõ.
- [ ] Concurrent workers, timeout external assignment, manual override và worker restart test đạt.
- [ ] Config version/time/audit, no catch-up burst khi agent quay lại; weight update không reassign khách cũ âm thầm.
- [ ] Dedupe intake/conversation generation, unresolved multi-channel không auto-merge.

## C.08 — Manual sending và DNC boundary

**Dependency:** C.02–C.03, H.05, delivery ports.

**AC:**
- [ ] Manual text/media đúng capability đã kiểm tra, only-clean refs; durable send intent/tracking, lỗi/UNKNOWN rõ.
- [ ] AI draft không tự gửi; reply khi DNC phải policy cụ thể, không ngầm coi inbound là gỡ opt-out.
- [ ] Policy gates có cả Chatwoot native/adapter route; đường direct không enforce phải disable.
- [ ] Không bật HRP-triggered broadcast chỉ vì manual transport đạt.

## C.09 — OA pilot exit gate

**Dependency:** các C tasks của path bật, B.06/H.09.

**AC:**
- [ ] Synthetic/test-recipient end-to-end trước, pilot thực tế chỉ khi Owner cho phép và phạm vi dữ liệu rõ.
- [ ] Đo latency/lag/errors/recovery với tải đại diện 5–10 sale; không suy capacity từ số login.
- [ ] Canonical/manual core vẫn chạy khi provider down; receipts và audit truy được.
- [ ] Intake CCCD chưa đủ C.05 phải disable riêng, không quảng bá path đã hoàn thành.

# 5. V7.9d — Outbound & Broadcast

## D.01 — HRP-to-ACL durable dispatch

**Dependency:** H.07, C.02/C.08.

**AC:**
- [ ] Push/claim-ack đúng ADR; stable intent IDs, acceptance/delivery tách.
- [ ] Crash từng hop và ack loss không duplicate logic; UNKNOWN đối soát, không cam kết exactly-once external.
- [ ] No core DB credential, tenant/connection scoping và payload limits đạt.

## D.02 — HRP-owned audience/campaign approval PR

**Dependency:** C.01, contracts bổ sung Owner/domain review, H.01/H.07.

**AC:**
- [ ] Recipients lấy HRP query/snapshot có quyền/source/version/eligibility; không upload danh sách trực tiếp vào adapter để bỏ HRP.
- [ ] Approved content/template/purpose/audience revision có audit; sửa audience/nội dung sau duyệt phải reapproval theo policy.
- [ ] Campaign chưa có domain API thì feature chưa bật, không tạo DB bypass.
- [ ] Talent/Client đúng semantics; không tăng KPI/chốt chỉ từ send hoặc click.

## D.03 — Fan-out batching/rate limits/pause/cancel

**Dependency:** D.01–D.02.

**AC:**
- [ ] Từng batch HRP transaction ghi intents/audit/outbox; không transaction khổng lồ hoặc provider call trong transaction.
- [ ] Dedupe key campaign revision/recipient/message; resume partial batch không nhân intents.
- [ ] Provider quotas verified, fair scheduling/backpressure, pause/cancel chặn chưa gửi; không hứa thu hồi đã accepted.

## D.04 — DNC end-to-end release gate

**Dependency:** H.05/D.01–D.03/C.08.

**AC:**
- [ ] Recheck contactability trước send, không chỉ audience snapshot; HRP offline/stale authorization giữ chờ.
- [ ] Suppression sau enqueue, redrive, native automation/n8n path đều block; cancel/suppression có audit.
- [ ] Concurrent opt-out/send có fencing/cut-off bằng chứng và giới hạn provider acceptance được nêu rõ.
- [ ] Unknown identity có local suppression; không yêu cầu CCCD hoặc auto reactivation từ former worker badge.

## D.05 — Outbound UI và delivery reporting

**Dependency:** D.01–D.04.

**AC:**
- [ ] Preview recipients/exclusions/content/policy trước xác nhận có quyền; campaign status không lẫn sent/delivered.
- [ ] Filters/export/report scope; lỗi tự nhiên và reason suppression rõ, không provider raw payload.
- [ ] Retry/cancel actions server authorization; delivery callback idempotent, không direct-write HRP DB.

## D.06 — Outbound failure drills

**AC:**
- [ ] Provider offline/429/token expired, timeout sau accepted, HRP outbox retry và restore scenarios có evidence.
- [ ] Không gửi lặp mù, không gỡ DNC, không khóa core transaction; runbook manual resolution rõ.

# 6. V7.9e — Reconciliation & DLQ

## E.01 — Source cursors và reconciliation jobs

**Dependency:** H.08, C/D receipts/delivery state.

**AC:**
- [ ] Cursors/watermark/overlap + dedupe cho receipt gaps/UNKNOWN/mapping/projection, respect provider quota.
- [ ] Chỉ backfill lịch sử API cho phép; report coverage gap thay hứa đầy đủ.
- [ ] Corrections/version/history giữ được, không auto-merge/open case để chữa mismatch.

## E.02 — DLQ/unresolved operations UI

**AC:**
- [ ] Review queue khác technical DLQ; re-drive scopes/audit/keys và DNC đúng.
- [ ] Bulk retry có preview/phạm vi/limit, không blind replay stale target/context.
- [ ] Error details redacted và quyền riêng; sale chỉ thấy hướng xử lý, không secrets/stack.

## E.03 — Evidence orphan/retention/restore reconciliation

**Dependency:** C.04–C.06.

**AC:**
- [ ] Orphan cleanup không xóa evidence còn canonical claim hoặc command UNKNOWN; TTL và quarantine lifecycle rõ.
- [ ] Object deletion/version/backup policy cùng audit; restore không làm sống lại tệp đã xóa trái policy hoặc tự phát lại tin.
- [ ] Runbook provider copies limitations và verified cleanup outcome.

## E.04 — Metrics/source count reconciliation

**Dependency:** H.08, analytics source contracts.

**AC:**
- [ ] Creation counts/source/submittedBy/credit và update/no-op phân biệt, merge corrections không double-count.
- [ ] Source partial không gọi company total; exported snapshots/as-of có lineage.
- [ ] Dashboard Phase 10 nhận facts đúng; không triển khai scoring/LLM để suy KPI thiếu.

# 7. V7.9f — Credentials, vận hành và rollout

## F.01 — Secret governance và quyền

**AC:**
- [ ] Business admin/routing manager không đọc provider keys; secret operator không mặc định đọc CCCD/transcripts.
- [ ] Rotation/revoke/recovery có audit, không browser/log/export secrets; least-privilege service identities.
- [ ] Cross-org/object/role tests qua API/UI/search/download/realtime theo capability thực tế; limitations không bị giấu.

## F.02 — Hạ tầng/backup/portability

**AC:**
- [ ] API/worker/scheduler/storage ports deploy được VPS, không file ephemeral hay Vercel request xử lý job dài.
- [ ] Internal DB/Redis/private object storage network isolation/TLS/access control; backup/restore test môi trường sạch.
- [ ] RPO/RTO và capacity mục tiêu Owner chốt sau measured baseline; không ghi số chưa đo là cam kết.

## F.03 — Security regression bundle

**AC:**
- [ ] JWT nếu dùng validate đúng issuer/audience/signature/expiry; REST authorization/SSRF/media unauth regression pass.
- [ ] Evidence refs, review bypass, transcript/AI PI leak, custom attrs spoof và DNC bypass có negative tests.
- [ ] Pin dependency/release/license/security findings, patch critical path trước enable; không dùng “Deplao có” thay review.

## F.04 — Monitoring, runbooks và kill switches

**AC:**
- [ ] Queue lag/DLQ age/token expiry/provider error/delivery UNKNOWN/unresolved/evidence health dashboards không PII labels.
- [ ] Flags riêng inbound/canonical mutation/intake/broadcast/media; disable không làm mất receipt hoặc tắt HRP manual core.
- [ ] Runbook outage/token compromise/wrong mapping/duplicate/restore/contract mismatch có người phụ trách và recovery steps.

## F.05 — Pilot, training và release checklist

**Dependency:** mọi path định bật đã qua gates tương ứng.

**AC:**
- [ ] Sale được hướng dẫn review intake, close reasons, assignment-vs-Handling, DNC, error/review/escalation.
- [ ] Pilot 5–10 sale có phạm vi/quyền dữ liệu, permission matrix, measured baseline và phản hồi UX.
- [ ] Rollback rehearsal và version/contract compatibility evidence; không rollback migration phá receipts hoặc canonical data.
- [ ] Owner review concrete release bundle trước production actions ngoài quyền đã giao; unfinished paths disable rõ, không declared done.

## 8. Bảng kiểm handoff sang Phase 10

| Nền tảng phải có | Ý nghĩa với AI/BoD sau này |
|---|---|
| Canonical creation/outcome/attribution facts | Số profile toàn thể/theo sale và nhận việc/EFFECTIVE không suy từ chat |
| Versioned NextAction/contactability | Lịch/nhắc việc đúng và không bypass DNC |
| Context/KB/evidence access boundaries | Copilot/autofill chỉ dùng dữ liệu được phép, staff review bắt buộc |
| Manager KPI contracts/HRP module decision | Không để AI hoặc sale tự giao/chỉnh KPI |
| Durable notification/scheduling ports | Reminder không phụ thuộc model/browser |
| Snapshot/metric definitions/authorization | Biểu đồ drill-down đúng số liệu và scope |

Phase 10 production còn cần backlog riêng cho KPI/AI providers/Copilot/autofill/planner/QA/BoD; việc chuẩn bị ports và mocks trong Phase 9 không có nghĩa đã xây xong các tính năng đó.
