# Kế hoạch áp dụng n8n cho CRM — ranh giới CRM / HRP

**Ngày lập:** 24/09/2026
**Trạng thái:** PLAN ONLY — chưa triển khai workflow, chưa kết nối credential thật, chưa bật production
**Phạm vi điều phối:** CRM-owned automation và Integration-owned orchestration
**Không thuộc phạm vi:** quyết định kiến trúc hoặc triển khai thay T0 HRP

## 1. Mục tiêu

Kế hoạch này xác định những phần CRM có thể giao cho n8n để giảm glue code,
giảm thao tác vận hành thủ công và giúp người dùng theo dõi workflow thuận tiện
hơn, trong khi giữ nguyên các ranh giới đã chốt:

- CRM/Integration giữ durable receipt, idempotency, outbox, provider ingress,
  mapping, UI và dữ liệu dẫn xuất thuộc CRM.
- HRP giữ canonical domain, authorization/RLS, canonical mutation, audit nghiệp
  vụ và các service do HRP sở hữu.
- n8n là orchestration/operations plane; n8n không trở thành system of record.
- Mọi write quan trọng phải gọi API có authorization, version và idempotency;
  workflow không ghi trực tiếp database CRM hoặc HRP.
- Phần HRP trong tài liệu chỉ là góp ý để T0 HRP tham khảo. T0 HRP tự quyết
  định có áp dụng hay không. Việc HRP không áp dụng n8n không chặn CRM.

## 2. Quy tắc phân loại ownership

Mọi ý tưởng n8n phải được gắn đúng một trong bốn nhãn sau:

### CRM_OWNED

CRM có thể thiết kế, triển khai và nghiệm thu độc lập nếu chỉ sử dụng CRM mock,
Integration DB, CRM APIs, dữ liệu dẫn xuất và các provider credentials thuộc
CRM. Không cần T0 HRP phê duyệt trừ khi workflow bắt đầu gọi real HRP path.

### SHARED_BOUNDARY

Workflow nằm phía CRM nhưng cần một API/event/contract song phương. CRM được
phép làm fixture, adapter mock và proposal; real path chỉ bật sau bilateral
acceptance. Không dùng n8n để né contract hoặc gọi HRP DB.

### HRP_ADVISORY_ONLY

Ý tưởng có thể hữu ích cho HRP nhưng CRM không triển khai, không giao task,
không đặt deadline và không dùng làm dependency. T0 HRP tự chọn công cụ, thiết
kế và cách nghiệm thu. HRP có thể dùng n8n, công cụ khác hoặc không dùng.

### PROHIBITED_FOR_N8N

Chức năng không được giao cho n8n vì thuộc system of record, ranh giới bảo mật,
transaction hoặc invariant nghiệp vụ.

## 3. Kiến trúc mục tiêu phía CRM

### 3.1 Inbound provider flow

```text
Chatwoot / Zalo / Form
        |
        v
Integration API receiver
  - verify protocol/signature
  - bind org/provider/connection from server-side route/config
  - durable receipt + payload digest + idempotency
        |
        v
Worker / Integration outbox
        |
        v
n8n webhook or polled automation event
        |
        +--> notification / approval / provider action / report
        |
        `--> CRM canonical API with idempotencyKey + correlationId
```

n8n không nhận provider webhook làm durable ingress chính. Nếu provider bắt
buộc gọi trực tiếp n8n cho một POC, path đó phải ghi rõ NON_CANONICAL_POC và
không được dùng để pass production receiver AC.

### 3.2 Scheduled automation flow

```text
n8n Schedule Trigger
        |
        v
CRM allowlisted read API
        |
        v
filter / group / wait / approval
        |
        +--> notification channel
        `--> CRM command API (nếu được phép)
              - server authorization
              - expectedVersion
              - idempotencyKey
              - audit/result
```

### 3.3 Required trace fields

Mỗi execution có tương tác CRM phải giữ tối thiểu:

- `workflowId` và version/revision của workflow.
- `n8nExecutionId`.
- `organizationId` lấy từ server-side connection/config, không tin body spoof.
- `correlationId` cho logical flow.
- `idempotencyKey` riêng cho từng command attempt theo contract.
- Source event/receipt/intent ID nếu có.
- Result status và redacted error code.
- Không ghi raw secrets, auth headers, CCCD, ảnh nhạy cảm hoặc raw transcript
  vào execution history.

## 4. Backlog CRM được giữ để triển khai

Các task dưới đây thuộc CRM. Chúng có thể chạy local/mock trước; real provider
hoặc real HRP path vẫn tuân theo gate riêng.

### N8N/0.1 — Server inventory và security baseline

**Ownership:** CRM_OWNED
**Mục tiêu:** biết chính xác server n8n đang có gì trước khi import workflow.

Phạm vi:

- Ghi version, edition/license, deployment mode, database, queue mode và public
  ingress của n8n.
- Kiểm tra user/project roles, MFA/SSO nếu có, credential sharing và quyền xem
  execution data.
- Chạy security audit hỗ trợ bởi phiên bản hiện tại; lập danh sách unprotected
  webhook, community nodes, risky nodes và unused credentials.
- Xác định retention/pruning cho execution logs và binary data.
- Tách credential dev/mock khỏi credential staging/production.
- Chốt hostname, TLS, backup và upgrade/rollback runbook của riêng n8n.

Điểm dừng:

- Chỉ inventory/read-only và hardening được Owner cho phép.
- Chưa nhập CRM/HRP/provider secret thật.
- Chưa mở webhook public phục vụ khách hàng.

### N8N/0.2 — CRM automation gateway contract

**Ownership:** CRM_OWNED; chuyển SHARED_BOUNDARY chỉ khi payload chứa HRP result
hoặc gọi real HRP API.
**Mục tiêu:** không để từng workflow tự phát minh cách gọi CRM.

Đầu ra dự kiến:

- Allowlisted automation endpoints hoặc adapter nội bộ của CRM.
- Authentication riêng cho n8n service identity.
- Organization/connection binding phía server.
- Idempotency, correlation, request size, timeout và retry rules.
- Redacted response/error envelope.
- Kill switch theo workflow/connection/organization.
- Fixtures local và negative tests: spoof org, replay, changed payload, expired
  credential, unauthorized command, provider offline.

### N8N/1.1 — Follow-up và SLA reminder POC

**Ownership:** CRM_OWNED
**Độ ưu tiên:** cao; workflow đầu tiên được khuyến nghị.

Flow:

1. Schedule mỗi 15 phút và bản tổng hợp đầu ngày.
2. Gọi CRM API lấy task/next action đến hạn hoặc quá hạn.
3. Nhóm theo owner/supervisor và organization.
4. Gửi notification synthetic hoặc internal test channel.
5. Escalate sau ngưỡng cấu hình.
6. Ghi acknowledgement bằng API với execution/correlation ID.

Ranh giới:

- Không tự đánh dấu NextAction DONE.
- Snooze notification không thay Handling SLA hoặc canonical state.
- Nếu nguồn HRP chưa có, dùng CRM fixture và ghi rõ mock coverage.

### N8N/1.2 — Operational alert và DLQ notification

**Ownership:** CRM_OWNED

Use cases:

- Worker/receiver/reconciliation failure.
- DLQ có item mới hoặc vượt ngưỡng.
- Provider connection offline.
- Queue age hoặc pending review vượt SLA.
- Kill switch thay đổi trạng thái.

n8n chỉ thông báo và tạo operator action link. Replay/redrive phải gọi CRM API
có authorization; workflow không sửa trực tiếp receipt/outbox/DLQ tables.

### N8N/1.3 — Reconciliation operations workflow

**Ownership:** CRM_OWNED cho Integration data; SHARED_BOUNDARY nếu đối chiếu
canonical HRP result.

Use cases:

- Chạy scheduled read-only reconciliation.
- Tạo báo cáo missing link, unknown delivery và stale checkpoint.
- Chờ operator phê duyệt trước redrive.
- Theo dõi redrive tới terminal result.
- Gửi báo cáo chênh lệch đã redact.

### N8N/1.4 — Scheduled CRM reports

**Ownership:** CRM_OWNED

Use cases:

- BoD digest từ metric/query API đã cho phép.
- Báo cáo backlog, SLA, review queue và provider delivery.
- CSV/PDF/email/internal storage distribution.
- Snapshot ID, as-of, coverage và source label bắt buộc.

n8n không tính canonical KPI từ raw chat và không được quảng bá chat-only data
thành số liệu toàn công ty.

### N8N/1.5 — Human approval workflow

**Ownership:** CRM_OWNED cho CRM action; SHARED_BOUNDARY nếu approval dẫn tới
HRP canonical command.

Use cases:

- Duyệt outbound campaign.
- Duyệt nội dung AI đề xuất.
- Duyệt autofill hoặc planning proposal có conflict/stale evidence.
- Duyệt operator redrive có ảnh hưởng bên ngoài.

Approval trong n8n không thay server-side authorization. CRM API phải kiểm tra
actor, scope, target/version và policy lại tại thời điểm apply.

### N8N/2.1 — Outbound channel orchestration

**Ownership:** CRM_OWNED cho provider delivery plane.

Flow dự kiến:

- Nhận approved delivery intent từ CRM outbox/API.
- Chọn connection/channel/template đã allowlist.
- Rate limit, bounded retry và provider call.
- Trả delivery result về CRM.
- Escalate UNKNOWN/permanent failure.

Gate bắt buộc:

- Effective suppression/DNC check đã được authoritative service xác nhận.
- Không gửi khi suppression authority unavailable nếu policy yêu cầu fail closed.
- Không render raw PII vào execution logs.
- n8n không tự tạo campaign policy hoặc target audience canonical.

### N8N/2.2 — Chatwoot convenience automation

**Ownership:** CRM_OWNED cho integration convenience; real capabilities vẫn
phụ thuộc B.01/B.02 evidence.

Use cases phù hợp:

- Internal note và notification.
- Tag/label kỹ thuật không có authority nghiệp vụ.
- Tạo operator link về Context Panel.
- Follow-up reminders và assignment alert.
- Outbound action sau approval.

Không dùng Chatwoot tag/assignee/custom attribute làm canonical HRP target,
Handling, credit hoặc authorization evidence.

### N8N/2.3 — Import/review assistant

**Ownership:** CRM_OWNED

Use cases:

- Nhận file/form từ nguồn đã duyệt.
- Chuẩn hóa sơ bộ và gọi preview API.
- Hiển thị validation errors.
- Chờ người có quyền xác nhận.
- Gọi command API theo từng item với partial outcomes.

Không ghi DB trực tiếp; không auto-merge identity; không biến validation tại
workflow thành bằng chứng canonical.

### N8N/3.1 — AI proposal orchestration

**Ownership:** CRM_OWNED cho orchestration; model/data policy có gate riêng.

Use cases:

- Lấy context đã field-filter qua CRM API.
- Gọi model/provider được duyệt.
- Validate structured proposal.
- Chờ human review.
- Gửi proposal hoặc approved command về CRM.

AI/n8n không tự gửi khách, tự merge, tự sửa KPI, tự tạo Worker/Beneficiary,
chuyển EFFECTIVE hoặc bỏ qua DNC.

## 5. Phần chỉ góp ý cho T0 HRP

Mục này là HRP_ADVISORY_ONLY. Không item nào dưới đây là CRM deliverable,
dependency của CRM hay yêu cầu T0 HRP phải dùng n8n.

T0 HRP có thể cân nhắc n8n cho:

- Thông báo nội bộ khi canonical command/outbox/reconciliation thất bại.
- Scheduled audit digest hoặc báo cáo vận hành đã field-filter.
- Human approval UX phụ trợ cho quy trình chưa yêu cầu transaction nguyên tử.
- Nhắc việc nội bộ dựa trên API HRP được phép.
- Đồng bộ tài liệu hoặc operational metadata không phải canonical domain state.
- Non-authoritative export/report distribution.

Nếu HRP chọn áp dụng, HRP tự quyết định:

- Repo, deployment, secrets, service identity và network boundary.
- Có cho n8n gọi HRP API hay chỉ nhận sanitized events.
- Authorization, RLS, delegation, audit, retention và recovery.
- Các command/query/event nào được phép.
- Test, rollback, H.09/Tier 3 và production enablement.

CRM chỉ góp ý các nguyên tắc tương thích:

- Không cấp HRP DB credentials cho n8n thuộc CRM.
- Không dùng body actor hoặc organizationId làm authority.
- Không để workflow bypass service authorization/domain policy.
- Không coi n8n approval là HRP canonical approval nếu chưa có contract.
- Không đưa HRP raw PII sang CRM n8n execution history.
- Nếu hai hệ thống trao đổi, dùng accepted contract/version và scalar refs.

T0 HRP có thể từ chối toàn bộ đề xuất này mà không ảnh hưởng roadmap CRM.

## 6. Shared boundary cần bilateral gate

Các trường hợp sau không được CRM tự bật real path:

- n8n gọi một HRP canonical query hoặc command.
- HRP event/outbox kích hoạt CRM workflow có business meaning.
- CRM workflow dùng HRP suppression, authorization, KPI hoặc audit result.
- Workflow mang identity/delegation token giữa CRM và HRP.
- Workflow thực hiện redrive/reconcile có thể thay đổi HRP state.

Trước khi bật cần tối thiểu:

1. Accepted contract/version và exact endpoint/event mapping.
2. Service/user/org/object authorization do server kiểm tra.
3. Idempotency/retry/timeout/UNKNOWN semantics.
4. Field filtering, PII classification và log policy.
5. Revocation/expiry và failure behavior.
6. Synthetic conformance hai phía; real path theo H.09/Tier 3 nếu áp dụng.

Nếu gate chưa đạt, CRM workflow dùng fixture/mock và mang nhãn
`SHARED_PATH_NOT_ENABLED`.

## 7. Những việc cấm giao cho n8n

Các item sau mang nhãn PROHIBITED_FOR_N8N:

- Provider ingress security authority: signature/challenge verification, durable
  ACK, receipt digest và concurrent idempotency.
- Transactional outbox, lease/fencing và replay authority.
- HRP canonical identity, Intake, PlacementCase, Availability/DNC, Handling,
  assignment/outcome, credit/KPI và planning state.
- HRP authorization, RLS, delegation issuance/verification và object permission.
- Canonical merge/review decision hoặc privileged mutation.
- Direct SQL/Prisma access vào CRM/Integration/HRP production database.
- Secrets/key rotation authority hoặc raw auth-header logging.
- DNC/suppression ownership resolution và việc gỡ suppression.
- Arbitrary SQL/HTTP tools do model hoặc end-user điều khiển.
- High-throughput synchronous request path mà workflow engine làm tăng latency
  hoặc tạo single point of failure cho core.

## 8. Mapping vào roadmap hiện tại

### V7.9b — Chatwoot

- Giữ B.01/B.02 real-provider evidence như backlog hiện tại.
- n8n có thể hỗ trợ notification, internal notes, follow-up và outbound sau
  approval.
- n8n không thay Chatwoot runtime POC, webhook trust-boundary hoặc receiver.

### V7.9c — Zalo/media/intake

- n8n có thể orchestration template, approval, delivery và failure alerts.
- Media evidence/storage/residency, provider verification và canonical intake
  vẫn theo core/API gates.

### V7.9d–f — Outbound/reconciliation/operations

- Đây là vùng ưu tiên lớn nhất cho N8N/1.2, 1.3, 2.1.
- CRM giảm glue code nhưng không thay H.07/outbox, suppression hoặc security.

### V7.10 — Reporting/assistant/reminders

- N8N/1.1, 1.4, 1.5 và 3.1 hỗ trợ reminder, reporting và AI proposals.
- Metric truth, KPI mutation, model data policy và canonical planning vẫn do
  service owner tương ứng kiểm soát.

## 9. Trình tự triển khai đề xuất

### Wave N0 — Guardrails

1. N8N/0.1 inventory/security baseline.
2. N8N/0.2 automation gateway contract.
3. Tạo project/credentials riêng cho local/mock.
4. Chốt execution retention và redaction.

### Wave N1 — Low-risk local/mock value

1. N8N/1.1 follow-up/SLA reminder.
2. N8N/1.2 operational alerts.
3. N8N/1.4 scheduled synthetic report.

Các workflow chạy với local CRM/mock APIs trước, không phụ thuộc HRP.

### Wave N2 — Controlled operations

1. N8N/1.3 reconciliation operations.
2. N8N/1.5 human approval.
3. N8N/2.2 Chatwoot convenience sau khi có evidence phù hợp.

### Wave N3 — External delivery và AI

1. N8N/2.1 outbound channels.
2. N8N/2.3 import/review.
3. N8N/3.1 AI proposal orchestration.

Mỗi real path có gate riêng; không dùng thành công của local/mock để suy ra
production readiness.

## 10. Tiêu chí nghiệm thu chung cho workflow CRM

Một workflow chỉ được coi là đạt khi có bằng chứng cho các điểm áp dụng:

- Workflow JSON/version được lưu có kiểm soát, không chỉ tồn tại trên server.
- Không chứa credential hoặc environment-specific secret trong artifact.
- Idempotent replay không tạo logical action trùng.
- Same key/different payload bị conflict hoặc review theo contract.
- Organization/connection binding không tin request body.
- Timeout/provider failure tạo trạng thái rõ; không retry vô hạn.
- Logs/execution data đã redact và có retention.
- Operator biết xem SUCCESS/FAILED/WAITING/CANCELLED và cách retry an toàn.
- Kill switch hoạt động không cần sửa workflow thủ công.
- Local/mock test tái hiện được mà không cần Docker, nếu workflow không phụ
  thuộc real provider.
- Real provider/HRP dependency được ghi `NOT_VERIFIED` cho tới khi có evidence.
- Rollback là disable/version rollback workflow; không tự rollback canonical DB.

## 11. Quản trị artifact và môi trường

- Export workflow definition và credential references; không export secret value.
- Pin n8n version/edition trước khi dựa vào feature cụ thể.
- Tách dev/mock và production bằng project/instance/environment phù hợp với
  edition thực tế; không giả định source-control feature có sẵn.
- Không sửa trực tiếp cùng một workflow production từ nhiều nơi nếu chưa có
  quy trình version/ownership rõ.
- Community nodes mặc định bị cấm; chỉ mở sau security review và version pin.
- Workflow import phải review webhook exposure và credential binding trước khi
  activate.

## 12. Quyết định hiện tại

- **Được giữ trong CRM backlog:** N8N/0.1–0.2, N8N/1.1–1.5,
  N8N/2.1–2.3 và N8N/3.1 theo gate của từng task.
- **Task mở đầu khuyến nghị:** N8N/0.1, sau đó N8N/0.2 và N8N/1.1.
- **HRP:** chỉ nhận mục §5 như đề xuất tham khảo; không có task HRP được mở từ
  tài liệu này.
- **Shared path:** giữ disabled cho tới bilateral gate.
- **Không ảnh hưởng công việc T1-A/T1-B hiện tại:** plan này chưa giao code,
  chưa đổi contracts, package, consumer migration hoặc roadmap ownership.

## 13. Điểm dừng của tài liệu

Đây là plan và ownership boundary. Tài liệu không:

- Kết nối vào server n8n.
- Tạo/import/activate workflow.
- Nhập credentials.
- Gọi HRP hoặc provider thật.
- Sửa contracts hoặc mở ACCEPTED_SHARED mới.
- Cho phép production/pilot/deploy.

Task triển khai tiếp theo phải được giao riêng với snapshot, AC, secrets boundary
và điểm dừng cụ thể.

## 14. Trạng thái thực thi tại 2026-09-28

Tài liệu ban đầu là plan-only. Các trạng thái dưới đây cập nhật theo evidence
đã commit; chúng không tự mở runtime hoặc production gate.

### Wave N0 — Guardrails

- `N8N/0.1`: hạ tầng CRM/HRP tách stack, TLS, backup, Healthchecks, sandbox
  và SearXNG đã triển khai. Security baseline vẫn phải được rà lại khi đổi
  version hoặc topology.
- `N8N/0.2–0.3`: HTTP boundary/gateway đã có local implementation và tests.
  Real gateway chưa được deploy. Trước deployment phải đóng task
  `N8N/0.3-REAL-GATEWAY-PLAN-R1`.
- Private signer node đã load trên `n8n-crm`; synthetic credential đã được n8n
  mã hóa. Không cài node này trên `n8n-hrp`.
- Signed runtime conformance qua synthetic verifier: PASS, evidence tại
  `docs/contracts/n8n/N8N-1.2-SIGNED-RUNTIME-R1/`.

### Wave N1 — Low-risk local/mock

- SLA reminder MOCK và signed-runtime conformance: PASS trong phạm vi
  local/synthetic, workflow vẫn inactive.
- Product workflow `CiWYL3CwKkl83Fx0`: chưa chuyển sang real `SIGNED_HTTP`.
- Operational alert/DLQ, scheduled report: chưa mở implementation thật.

### Tên artifact và backlog

Artifact lịch sử dùng nhãn `N8N/1.2` cho signed revision của SLA reminder,
trong khi backlog §4 dùng `N8N/1.2` cho operational alerts. Không đổi tên
evidence đã đóng. Task mới phải ghi rõ một trong hai profile:

- `SLA_REMINDER_SIGNED_REVISION`; hoặc
- `OPERATIONAL_ALERT_DLQ`.

Không dùng nhãn `N8N/1.2` đứng một mình trong handoff mới.

### Gate đang mở

1. Sửa tên signature profile trong gateway/registry cho đúng thuật toán thực
   tế `LEGACY_SHA256_INPUT_SECRET`; không gọi là HMAC.
2. Thay idempotency ledger in-memory bằng authority bền vững có atomic claim.
3. Chốt registry/secret provisioning và rotation cho CRM service identity.
4. Deploy real CRM gateway ở gate riêng, workflow vẫn inactive.
5. Sau manual execution và server-authoritative evidence PASS mới xem xét
   activation/schedule ở task khác.

### V7.9b song song

- B.01 real Chatwoot: `BLOCKED_ENV`.
- B.02-PREP: accepted trong synthetic scope; B.02 real chưa accepted.
- B.02 Local E2E và PostgreSQL listener cleanup: chờ T0 closure.
- B.03-PREP Context Panel: chờ T0 closure; B.03 real chưa mở.

N8N không thay các gate Chatwoot trên và không được dùng synthetic signer PASS
để suy ra B.01/B.02/B.03 real-path readiness.

## 15. Tài liệu n8n cần kiểm tra khi mở task

Các capability và giới hạn phải được kiểm tra lại theo đúng version/edition của
server trước implementation:

- Execution history, filtering và retry failed execution:
  <https://docs.n8n.io/workflows/executions/all-executions/>
- Security audit và các nhóm rủi ro được kiểm tra:
  <https://docs.n8n.io/hosting/securing/security-audit/>
- Human approval / send-and-wait behavior:
  <https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.gmail/message-operations/>
- Workflow sharing và credential permissions:
  <https://docs.n8n.io/workflows/sharing/>
- Source-control/environments và giới hạn theo license:
  <https://docs.n8n.io/source-control-environments/create-environments/>

Các link trên là đầu vào discovery, không phải bằng chứng server hiện tại đã có
feature tương ứng.
