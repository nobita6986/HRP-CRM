# HRP Connector — Contract tích hợp phân hệ Chatwoot/Zalo OA với HRP

**Phiên bản:** 1.1 — 13/09/2026. Đối chiếu Master-Plan.V2.6.md và HRP checkout; quyết định Owner tách ứng dụng CRM.
**Mục đích:** tài liệu bàn giao cho đội HRP để xây API và ghép phân hệ giao tiếp độc lập.
**Tình trạng:** đã đối chiếu `prisma/schema.prisma`, `app/api`, `docs/PLANNER_HANDOVER.md` và lộ trình V6/V7 của HRP ngày 13/09/2026. Tên routes, DTO, event, scope, command bổ sung và contract cross-app dưới đây vẫn là **đề xuất chưa triển khai**. Các constants Owner chốt ở Master §10.6 là **đích nghiệp vụ**, chưa phải enum/field runtime HRP. Không coi ví dụ là code đã chạy hoặc migration đã lên production.

### Trạng thái HRP tại thời điểm bàn giao

| Đã có trong source HRP | Chưa có / chưa xác nhận production |
|---|---|
| `ClientCompany`, `CrmLead`, `LaborProfile`, `LaborProfileIntake`, `EmploymentEpisode`, `PlacementCase`, `CandidateSubmission`, `Worker`, `ProjectAssignment` | `PlacementCase` N1 đã merge source nhưng Stage 3 trên Neon test branch còn chờ credential; chưa xác nhận migration trên `hrp-live` |
| `IdempotencyKey` scoped `(actorId, route, key)` với TTL 24 giờ; `OutboxEvent` dùng cho side effect nội bộ | Chưa có S2S idempotency theo `(organization, command, key)`, event envelope/dispatcher, replay retention và outbox contract để CRM consume; không dùng bảng cũ như thể protocol đã hoàn thành |
| `PlacementCaseStatus = OPEN | IN_PROGRESS | READY_TO_PLACE | CLOSED`; active set gồm ba trạng thái mở, partial unique index trong N1 migration | Stage `NEW`…`READY_TO_START`, 9 closeReason dạng catalog, Availability, CurrentRelationship chưa có trong schema; `closeReason` hiện là nullable String |
| Admin/JobPosting/Media Library (AV4) là các lát cắt riêng | Chưa có `ClientContact`, `SalesOpportunity`, `ClientInteraction`, `ClientNextAction`, `InteractionOutcome`, `NextAction`, `/api/integrations/*` hoặc các canonical command APIs của §4; AV4 không phải evidence gateway CCCD nội địa |

CRM xây Chat/CSKH trong repo và runtime riêng. HRP sở hữu canonical business data, permission/policy/commands, projection và outbox; CRM không được dùng DB URL/Prisma lõi. HRP vẫn giữ Ticket vận hành nhân sự hiện có và nhập tay tối thiểu khi CRM down; đó không phải sản phẩm CSKH thứ hai. Quyết định phạm vi đã ghi tại `docs/V7/HRP_CRM_INFRA_SPLIT.md` của HRP.

Lưu ý thứ tự quyết định: câu ở Master Plan v2.6 §0 bác bỏ một số **đề xuất CRM độc lập cũ** không còn đúng về nghiệp vụ; Owner ngày 13/09/2026 nay quyết định **tách hạ tầng CRM**. Chỉ tách runtime/UI Chat–CSKH; không trao quyền tạo case, đồng bộ chat assignee thành Handling hay để AI tự quyết. Đọc quyết định mới nhất cùng Master Plan, không dùng câu §0 để kéo Chat/CSKH trở lại repo HRP.

`/api/clients` và các API public/admin hiện hữu là API cho UI HRP, không phải connector S2S đã được cấp quyền cho CRM. Checkout không có model `Organization`/`Tenant` hoặc `organizationId` trong Prisma; trường `organizationId` trong envelope mẫu §5 chỉ là **đề xuất contract**, không được coi là tenant scope đã tồn tại. Trước PR API phải chốt mô hình scope thực tế, principal dịch vụ, delegated actor và mapping tới auth/RLS hiện hành (`getAuthContext`/`withDbContext`); không cho CRM tự khai scope đáng tin bằng body.

## 1. Ranh giới và chủ sở hữu

| Thành phần | Sở hữu | Không được làm |
|---|---|---|
| HRP | Canonical LaborProfile, Client CRM, PlacementCase, Placement, Worker/Assignment, Handling/Referral/Beneficiary; policy/approval | Ủy quyền cho Chatwoot labels/AI quyết định nghiệp vụ |
| Chatwoot | Raw transcript, inbox, chat assignments | Ghi Prisma core hoặc quyết định Handling/hoa hồng |
| ACL / Integration | Verify/normalize, mappings, receipts, routing, checkpoints, delivery/reconciliation | Tạo kho canonical thay HRP hoặc nhận credentials core DB |
| Evidence service nội địa | Quarantine/scan/encrypted object storage, authorized retrieval | Cấp public URL, coi opaque ID là quyền đọc hoặc tự xác minh danh tính |
| Analytics/AI | Dữ liệu dẫn xuất, KPI có definition/version, gợi ý | Auto-merge, auto-EFFECTIVE, quyết định nhân sự/Beneficiary |

HRP hiện dùng TypeScript 5.7, Next.js 15, React 19, Prisma 5.22, PostgreSQL; Vercel/Neon hiện tại cần đánh giá residency cho CCCD trước production. Tích hợp server-to-server qua Route Handlers/domain services. Server Actions của HRP UI dùng cùng domain services, không là giao thức RPC cho ACL. Worker/storage/scheduler qua ports chạy được trên VPS.

## 2. Dữ liệu trao đổi hai chiều

| Chiều / Khi nào | Dữ liệu tối thiểu | Xử lý |
|---|---|---|
| App → HRP, sau review intake | Submission metadata, họ tên/SĐT, CCCD/địa chỉ theo phạm vi residency, evidenceRef[], intent/stage/availability | createOrMatch; resolve/review; fill-missing qua updateLaborProfile; bước nghiệp vụ riêng |
| App → HRP, tương tác Talent | laborProfileId, placementCaseId nếu có, channel/direction/occurredAt/actorUserId/outcome/summary/externalConversationId | recordInteraction; không raw transcript |
| App → HRP, tương tác Client | ClientCompany/ClientContact/SalesOpportunity context hợp lệ + metadata tương tác | recordClientInteraction; không ép thành Talent |
| App → HRP, cập nhật/đóng case | caseId, stage hoặc closeReason theo action, expectedVersion và reason/evidence theo policy | Canonical update/close; không arbitrary Prisma patch |
| App → HRP, lịch/sẵn sàng | NextAction context hoặc availability + availableFromDate | Domain commands; DO_NOT_CONTACT cần suppression transaction |
| HRP → App, context panel | Canonical IDs, display fields được phép, stage/status/closeReason, availability, CurrentRelationship projection, next action, version | Projection đọc; Chatwoot attrs chỉ context tối thiểu |
| HRP → App, event thay đổi | IDs, aggregateVersion, eventId, occurredAt, correction/source reference, payload tối thiểu | Verify/dedupe rồi cập nhật mapping/projection; không chạy lại mutation nguồn |
| HRP → App, outbound | Intent ID, recipient/destination reference, nội dung được duyệt hoặc template params, policy references | Handoff bền, kiểm tra suppression trước gửi, delivery riêng |
| HRP → App, review hồ sơ tương lai | submissionId, revision, trạng thái HRP có thẩm quyền, lý do/fields cần bổ sung | Hiển thị riêng với trạng thái đã gửi/đã áp dụng |
| HRP → Analytics | Outcomes, attribution đã duyệt, case/assignment history và watermark | Facts/KPI; không trực tiếp query Prisma core |

Không gửi full hồ sơ mặc định cho mọi request. API đọc dùng field allowlist và object-level auth; raw CCCD không đi qua Chatwoot attributes/analytics/model. Staff-assisted review checkbox không thay đồng ý/căn cứ xử lý dữ liệu của NLD.

## 3. Constants đích Owner đã chốt — chưa phải schema HRP hiện hành

Khi HRP triển khai contract tương ứng, pin trong package contract dùng chung rồi import vào CRM/HRP; không cần dictionary API riêng. **Chưa import các giá trị dưới đây như enum runtime HRP** trước khi có migration/command và fixtures contract được hai repo chấp nhận. Backend vẫn validate transitions/permissions/context. Enum membership không đồng nghĩa quyền thực thi. Hiện `PlacementCaseStatus` chỉ có `OPEN | IN_PROGRESS | READY_TO_PLACE | CLOSED`; stage và Availability chưa có.

```ts
export const PLACEMENT_CASE_STAGES = [
  'NEW', 'CONTACTING', 'QUALIFYING', 'MATCHING',
  'PROPOSED', 'INTERESTED', 'CLIENT_PROCESS', 'READY_TO_START',
] as const;
// Chỉ status đóng đã được cung cấp; không suy diễn các status mở khác.
export const CLOSED_CASE_STATUS = 'CLOSED' as const;
export const CASE_CLOSE_REASONS = [
  'SUCCESS', 'NO_LONGER_LOOKING', 'UNREACHABLE', 'NO_SUITABLE_JOB',
  'CANDIDATE_WITHDREW', 'CLIENT_REJECTED', 'DUPLICATE_CASE', 'INVALID', 'OTHER',
] as const;
export const AVAILABILITIES = [
  'AVAILABLE_NOW', 'AVAILABLE_FROM_DATE', 'NOT_AVAILABLE',
  'DO_NOT_CONTACT', 'UNKNOWN',
] as const;
export const CURRENT_RELATIONSHIPS = [
  'NEVER_WORKED', 'WORKING_VIA_HRP', 'FORMER_HRP_WORKER',
  'WORKING_EXTERNAL', 'UNKNOWN',
] as const;
```

- Đóng thành công/thất bại đều status=CLOSED; closeReason bắt buộc. Không dùng CLOSED_SUCCESS hoặc SUCCESS_HRP_WORKFORCE/SUCCESS_DIRECT_HIRE trong wire contract mới.
- Stage cuối khi đóng, open statuses, reopen và tập active đầy đủ do HRP chốt từ domain; không tự bổ sung enum.
- Một lần không nghe máy vẫn CONTACTING + interaction outcome; không thêm stage.
- CurrentRelationship là read-only projection; reject mutation field này.
- AVAILABLE_FROM_DATE yêu cầu ngày lịch tương lai YYYY-MM-DD theo Asia/Ho_Chi_Minh; đổi availability xử lý ngày cũ rõ ràng.
- SUCCESS/READY_TO_START không tự tạo EFFECTIVE. Case closed, Availability và CurrentRelationship không tự thay nhau.

## 4. Inventory command HRP cần xây (chưa có endpoint S2S)

Tên endpoint ở §5 là đề xuất. Các commands dùng auth, runtime validation, policy, version/concurrency, idempotency, audit và canonical transaction.

| Command | Input trọng tâm | Output / Ràng buộc |
|---|---|---|
| createOrMatchLaborProfile | Identity signals + evidenceRef[], provenance; chỉ sau staff confirmation nếu là intake | EXACT_MATCH / POSSIBLE_MATCH / NEW_PROFILE; NEW chỉ sau creation policy; phone không unique-person proof |
| updateLaborProfile | Canonical target, whitelist patch, evidenceRef[], expectedVersion | Fill missing; không overwrite trường đã có/xác minh; conflict → review |
| mergeLaborProfiles | Source/target, review approval, versions, lý do | Privileged HRP-only workflow; webhook service không có merge scope |
| openPlacementCase | profileId, requested stage/context, approval nếu cần | Tối đa một active case/profile, enforce DB/transaction |
| updatePlacementCase | caseId, allowed patch/stage, expectedVersion | Domain transition hợp lệ; không direct arbitrary update |
| closePlacementCase (bổ sung đề xuất) | caseId, closeReason, comment/evidence theo policy, expectedVersion | Atomic status=CLOSED + closeReason; HRP có thể dùng update command chung nếu bảo đảm cùng invariants |
| recordInteraction | Payload Talent ở §2 | Summary/ref only; actor kỹ thuật/human theo policy, không dùng assignee để giả actor |
| recordClientInteraction | Company/contact/opportunity context + interaction | Client semantics riêng; kiểm tra quan hệ cùng company |
| updateNextAction | Target/action, lịch và OPEN/DONE/CANCELLED | Transition/version, không reset Handling |
| updateLaborAvailability (bổ sung đề xuất) | profileId, availability/date, expectedVersion | HRP chọn tên/signature thực; DO_NOT_CONTACT cùng suppression event/outbox transaction |
| transactionalOutboxPublisher | tx context + intent | Hàm nội bộ HRP, không HTTP call sau commit; cùng transaction với domain change |

Command/workflow Placement đạt EFFECTIVE theo HRP_MANAGED/CLIENT_MANAGED, Campaign approval/audience và review hồ sơ tương lai cần PR riêng sau domain review; chưa có tên chuẩn. Không giả định command tạo Worker/Beneficiary được cấp cho integration.

## 5. Giao thức request/result đề xuất

Route pattern: `POST /api/integrations/v1/commands/<allowlisted-command>` hoặc routes tường minh tương đương. Không dispatch bằng tên function tùy ý từ body. Queries dùng GET/read routes có allowlist. Chốt route naming trước implementation; hiện chưa có endpoint được xác nhận.

Envelope ví dụ cho command đóng (không phải request đang thực thi):

```json
{
  "schemaVersion": "1",
  "commandId": "<uuid>",
  "idempotencyKey": "<submission-id>:close-case:<revision>",
  "correlationId": "<trace-id>",
  "organizationId": "<verified-scope>",
  "source": {
    "system": "HRP_ENGAGEMENT",
    "connectionId": "<connection-id>",
    "externalConversationId": "<conversation-id>"
  },
  "payload": {
    "placementCaseId": "<canonical-case-id>",
    "expectedVersion": 7,
    "closeReason": "NO_LONGER_LOOKING",
    "comment": "<staff-reviewed-reason>"
  }
}
```

Credentials/delegated actor đi qua giao thức auth được HRP duyệt, không bí mật trong JSON. organizationId/source/actor khai trong request phải khớp authenticated principal và mappings server-side. Payload digest ràng buộc revision được staff xác nhận, không raw PII trong logs.

Result cần commandId, correlationId, completion status, canonical IDs/resultVersion khi có và errors có cấu trúc. Phân biệt transport ACCEPTED với command APPLIED và business review status. createOrMatch dùng discriminated outcome riêng; POSSIBLE_MATCH là kết quả nghiệp vụ, không retry error. Validation thiếu identity có thể trả lỗi/chờ bổ sung thay vì ép NEW_PROFILE.

HTTP mapping đề xuất: 200 result/replay, 202 accepted pending chỉ nếu đã persist bền và có query status, 400/422 invalid request, 401/403 auth, 409 version/idempotency/policy conflict có error discriminator, 429/503 lỗi tạm thời có retry hints. Không mọi 409 đều retry. UI ánh xạ lỗi thành tiếng Việt, không raw code/stack.

Idempotency key scoped organization + command; same key/same digest trả kết quả cũ, same key/different payload reject conflict. Mutation + idempotency/result + success audit + domain outbox cùng HRP transaction. Timeout sau commit tra kết quả hoặc retry cùng key. Recheck authorization trước trả dữ liệu kết quả cũ; receipt retention/replay quá hạn phải có policy.

## 6. Queries HRP cần cung cấp

| Query capability đề xuất | Mục đích |
|---|---|
| Read canonical context by verified target/conversation mapping | Panel Talent/Client, allowed fields, version, projection relationship |
| Read-only identity resolution (nếu cần preview trước submit) | Không dùng createOrMatch để tra cứu vì command có thể tạo NEW_PROFILE |
| Read command/submission result | Recovery timeout/partial success, tránh double creation |
| Read allowed transitions/capabilities | Kiểm tra trường/evidence/quyền/managed mode, không phải blocker để render constants |
| Read contactability / authorize dispatch | DNC gating với version/fencing khi cần; stale cache không cấp phép gửi |
| Read analytics facts/outcomes/attribution với cursor | Read model/exports được cấp, không DB credentials |
| Read submission review state tương lai | Cần chọn pre-apply/post-apply mô hình HRP trước khi chốt contract |

Tất cả query phải kiểm tra tenant/organization/object-level permission và field-level PII visibility. Cursor paging, max page size, watermark/as-of/version và filter allowlists để không xuất toàn bộ dữ liệu không giới hạn.

## 7. Events HRP → ACL và outbox handoff

Event envelope đề xuất: eventId, eventType, schemaVersion, organizationId, aggregateType/id/version, occurredAt, recordedAt, correlationId, sourceCommandId, payload tối thiểu. Nhóm event cần hỗ trợ: profile/mapping correction hoặc canonical merge đã duyệt; case updated/closed; availability/contactability changed; relationship projection changed; NextAction changed; outcome/attribution confirmed/corrected; submission reviewed/needs changes khi workflow có thật.

Webhook receive: verify signature/service auth theo protocol chốt, timestamp/replay policy → persist receipt unique (org, source, eventId) → ACK → process async. Duplicate cùng ID khác payload hash phải cảnh báo/reject theo protocol. Out-of-order so aggregateVersion; gap thì query/reconcile, không lờ mọi event cũ nếu đó là correction hợp lệ. Không tạo vòng lặp command từ projection echo.

HRP outbox giao bằng HRP-side dispatcher hoặc claim/ack API có scope riêng; ACL không đọc SQL core. Receipt phía ACL bền rồi ACK, không chờ provider delivered. Claim lease/owner/attempt và fencing được định nghĩa nếu dùng polling; retry cùng intentId. Delivery tracking (sent/delivered/failed/UNKNOWN/suppressed) tách trạng thái handoff. Callback delivery về HRP nếu cần là reporting endpoint có auth/idempotency, không direct-write outbox từ ACL.

DNC được enforce cả enqueue và ngay trước gửi cho campaign, follow-up, retries/DLQ và automation/native routes. HRP offline/không xác minh freshness thì giữ gửi tự động chờ. HRP commit availability + suppression event cùng transaction; serialize/fence recipient dispatch để xác định cut-off và xử lý race. Không hứa thu hồi tin provider đã accepted. Inbound không tự gỡ DNC; unresolved contact vẫn có local safety suppression, không buộc CCCD mới dừng liên hệ.

## 8. Evidence và residency

**Khoảng cách hiện tại:** AV4 Media Library dùng hạ tầng media của HRP, không chứng minh luồng scan/quarantine/lưu trữ CCCD nội địa. `LaborProfile.cccdNumber` hiện tồn tại trong core schema; việc dùng số/ảnh CCCD production qua CRM phải qua quyết định pháp lý, residency, quyền truy cập và gateway riêng. Không lấy AV4 hoặc Chatwoot attachment làm evidence service mặc định.

`evidenceRef[]` là array references tới tệp sạch được mã hóa, không base64/raw URL. Đề xuất item: evidenceId opaque + kind CCCD_FRONT/CCCD_BACK; server tự lấy hash/scan status/owner/connection từ metadata tin cậy. Không tin client gửi scanPassed=true. HRP kiểm tra evidence được phép gắn với submission/profile, cross-organization refs bị chặn.

VPS/object storage S3-compatible, quarantine, scanner, preview, temp buffers và backup CCCD tại Việt Nam theo yêu cầu Owner. Không lưu ảnh vĩnh viễn trong Chatwoot; không đi qua Vercel upload proxy/Neon blob. Raw CCCD fields cũng cần đánh giá residency; nếu core hiện tại không đáp ứng, giải quyết bằng HRP-owned migration/service nội địa, không kho canonical riêng của ACL.

Canonical core lưu opaque reference ổn định. Gateway cấp signed URL TTL ngắn sau auth, hoặc authenticated proxy để thu hồi tức thời. Chatwoot custom attrs tối đa refs/context IDs, không số CCCD/địa chỉ/public URL. PII không vào AI, telemetry, vector stores. Reference không tự là quyền xem.

Storage không cùng DB transaction: upload/scan → evidence ready → canonical claim; partial failure/retry giữ cùng evidenceId. Orphan cleanup có TTL và reconciliation, không xóa tệp khi command UNKNOWN. Retention/delete/restore lifecycle cần owner, audit và xử lý bản sao. Zalo có thể đã lưu ảnh khách gửi: kiểm tra capability, không hứa xóa ngoài quyền; secure upload nội địa là đường thu chủ động ưu tiên.

## 9. Submission review và identity flow

1. Nhân viên nhập/sửa, xem diff/evidence/intent và chủ động xác nhận revision; checkbox không prechecked. Preview không mutation.
2. ACL validate actor/scope/review digest, persist checkpoint; gọi createOrMatch chỉ sau confirmation.
3. EXACT_MATCH → fill-missing qua updateLaborProfile; target/version hoặc tác động khác bản đã xem thì re-review. POSSIBLE_MATCH → Unresolved Queue không auto-merge. NEW_PROFILE → canonical ID bền theo HRP policy.
4. Thực hiện case/availability/intent commands từng step, mỗi step idempotent. Lỗi case sau profile commit không xóa/tạo lại profile. CurrentRelationship luôn read-only.
5. HRP sẽ có workflow kiểm soát submissions. Chưa chốt pre-apply staging hay post-apply canonical review: đây là quyết định HRP-owned, không giả lập approved trong ACL. UI tách submitted/applied/reviewed; labels review tương lai chưa phải enum chính thức.
6. HRP yêu cầu bổ sung → revision mới → staff review lại; provenance người gửi/thời điểm/conversation/source/version được giữ theo retention. Submission review không đổi ba trục trạng thái nghiệp vụ.

DNC action độc lập không chờ review hồ sơ đầy đủ hoặc thu CCCD. Đóng case có review reason/tác động và HRP policy riêng; SUCCESS không tự cấp approval EFFECTIVE.

## 10. Security và permissions

Chốt auth service-to-service với HRP (JWT audience/issuer/signature/expiry đúng hoặc cơ chế tương đương được duyệt), secret rotation và least privilege. Nếu JWT được chọn, không decode-only hoặc cho algorithms tùy ý. Delegated user được xác thực, không dùng Chatwoot assignee làm acting user.

Capability groups đề xuất: context.read, intake.submit, profile.complete, case.update/close, availability.update, interaction.record, next-action.update, analytics.read/export, outbox.consume. Merge, HRP review, credential management và xem CCCD cần quyền riêng; BoD aggregate không mặc định transcript/evidence access. Membership revocation áp dụng cả query, export, cached response, background job và signed links theo access model.

Không có core DB connection string trong ACL deployment. CSRF/session protection cho browser actions, origin/source validation cho iframe messages, SSRF egress constraints cho media. Audit effectiveAt/recordedAt/actor/source, target/command/version/result; log redaction, không full payload CCCD. rate/size limits và DLQ không rò PII. Khi HRP/Zalo/Chatwoot lỗi, Workbench nhập tay/điện thoại và dữ liệu đã có vẫn hoạt động.

## 11. Checklist PR cho đội HRP

| Thứ tự | PR/workstream | Nghiệm thu |
|---|---|---|
| 0 | Đọc AGENTS/AI_CODING_GUARDRAILS/domain; publish contracts v1 + constants | Phân biệt confirmed enums với proposed routes; fixtures runtime validation |
| 1 | Command infrastructure + queries/gateway mock | Auth, actor, idempotency/version, audit, error/result status |
| 2 | Identity/profile/evidence + submission provenance | EXACT fill-missing, POSSIBLE review, NEW policy; không mutation preview |
| 3 | Case update/open/close + availability/NextAction/interaction Talent/Client | CLOSED/reasons atomic; one-active-case; DNC; semantic isolation |
| 4 | HRP outbox/dispatcher + event/read contracts | Durable acceptance/retry/correction; không ACL DB credentials |
| 5 | Residency/evidence gateway integration | Scan/authorization, VN data path, orphan handling, retention/restore |
| 6 | Analytics outcome/attribution/read projections | Counts/cohorts/version/as-of đúng, không credit từ chat assignee |
| 7 | Review workflow tương lai + Placement/Campaign workflows theo phạm vi được giao | Chốt pre/post-apply, approval/managed mode; không invented semantics |

Chat app có thể xây UI/mock ngay; không production canonical mutation bằng mock. Gate 3/5 và intake review phải đạt trước bật thu CCCD/intake tương ứng. Không chặn các tác vụ độc lập vì dictionary API chưa có; enum constants đã chốt.

## 12. Acceptance và các quyết định còn cần HRP chốt

Tests tối thiểu: duplicate/timeout sau commit; same key khác payload; two-worker one-active-case race; close thiếu/sai reason; success/reopen trái policy; actor/organization/evidence spoof; stale version; profile success/case fail; DNC trước/sau enqueue và race dispatch; projection echo/out-of-order/corrections; review bypass; VN media path và fail-closed scan. Chạy fixtures chung cho mock và API staging thật; mock pass không chứng minh DB concurrency/auth production.

Đầu ra đội HRP cần bàn giao: routes/base URLs theo môi trường (không secrets trong tài liệu), pinned contracts version, auth/scopes/delegation, event signing protocol, examples đã redact, error taxonomy, query paging/cursors, migrations/rollback, test evidence, runbooks và owner mỗi command.

Cần chốt từ code/domain: status mở và active set; stage giữ lại khi đóng/reopen; policy SUCCESS/UNREACHABLE và application-vs-case rejection; OTHER comment; availability mutation name; actor cho automated interactions; reviewer permissions và pre/post-apply model; Placement managed modes; idempotency/event retention; deployment residency và deletion policy; DNC dispatch fencing. Không còn câu hỏi về enum status đóng hoặc 9 closeReason: Owner đã chốt ở §3.
