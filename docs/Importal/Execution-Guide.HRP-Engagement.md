# Hướng dẫn điều phối HRP — OWNER / CODER / AUDITOR

**Ngày:** 13/09/2026. **Phiên bản điều phối:** 2.1 — mô hình 3 Agent theo chỉ thị Chủ nhân. **Baseline nghiệp vụ:** Master-Plan.V2.6.md.  
**Trạng thái:** hướng dẫn bàn giao và sequencing; chưa thực thi Coding Agents, chưa tạo GitHub issues/PR hoặc deploy. Không thay thế AC trong backlog.

## ĐỌC TRƯỚC — Chỉ dùng 3 Agent

**Bản này thay thế file Execution-Guide.HRP-Engagement.md đã gửi trước.** Tên file mới: `Execution-Guide.V2.1.Owner-Coder-Auditor.md`. Quy trình chỉ có ba Agent sau; không còn các vai kỹ thuật nhỏ phải gọi riêng.

| Agent | Vai trò chính | Giới hạn |
|---|---|---|
| **OWNER** | Cấp điều phối cao nhất trong ba Agent, đại diện Chủ nhân; canh giữ mục tiêu/invariants, giao việc, theo dõi kết quả, gỡ blocker và quyết định khi nào gọi Auditor | **Không viết plan, tài liệu, code, tests; không audit** |
| **CODER** | Một Agent làm toàn bộ kỹ thuật: contracts, backend HRP, integration, UI, analytics/AI; tự plan ngắn cho task, code, self-check/test, cập nhật tài liệu cần thiết, sửa findings | Không tự thay invariant, phê duyệt nghiệp vụ hoặc vượt phạm vi được giao |
| **AUDITOR** | Gate nhỏ, review nhanh các task quan trọng về lõi HRP, bảo mật, toàn vẹn dữ liệu và quyền tác động của AI | Không review mọi task; không chặn vì style hoặc refactor ngoài phạm vi |

**Chủ nhân là bạn**, có quyền quyết định cuối cùng; không phải một Agent thứ tư cần vận hành.

**Luồng nhanh cho task nhẹ:** Owner giao → Coder thực hiện và tự kiểm tra → Owner căn cứ AC/kết quả cho đi tiếp.

**Luồng cho task quan trọng:** Owner giao → Coder thực hiện và tự kiểm tra → Auditor review → Coder sửa nếu cần → Owner cho đi tiếp sau kết luận đạt.

Một Coder là writer chính; Owner không sửa repo. Auditor xem commit/diff ổn định, chỉ cần workspace review riêng khi cần chạy kiểm tra. Không phải tạo ba worktree ghi code chỉ vì có ba Agent.

**Chi tiết áp dụng:** mục 5 quy định vai trò và tiêu chí audit; mục 7 là prompt Owner, mục 8 là prompt Coder, mục 9 là prompt Auditor. Các mục 1–4 giữ lại bản đồ tài liệu/task để Owner biết giao việc theo thứ tự nào.

---

## 1. Bộ tài liệu chính thức

| Tài liệu | Công dụng |
|---|---|
| Master-Plan.V2.6.md | Kiến trúc, invariants, phạm vi và các quyết định Owner |
| hrp-connector.md v1.1 | Giao tiếp app–HRP, commands/queries/events, ownership |
| Implementation-Backlog.Gate0-V7.9a.md | Contracts, mock core và mock UI |
| Implementation-Backlog.HRP-Owned-V7.9b-f.md | Canonical implementation, Chatwoot/Zalo OA và production gates |
| Implementation-Backlog.V7.10-AI-BoD.md | Metrics/KPI, AI assistant, QA, reporting và pilot |
| Execution-Guide.HRP-Engagement.md | Thứ tự giao việc, phân công, checkpoint và prompt template |

Ưu tiên chỉ thị Chủ nhân mới nhất → Master Plan hiện hành → connector → task AC. Guide này thay thế cách chia vai và yêu cầu audit mọi task trong các mô tả điều phối cũ; không thay đổi AC nghiệp vụ hoặc guardrails bắt buộc của repo. Nếu phát hiện mâu thuẫn, ghi decision/change request; không tự chọn cách dễ để bypass invariant. Các bản Master Plan cũ là lịch sử, không dùng enum đóng cũ.

## 2. Task ID phải có namespace

Hai backlog Phase 9 và Phase 10 cùng dùng B.01/C.01… Khi giao task hoặc tạo issue phải ghi cả namespace để tránh nhầm:

| Namespace | Ví dụ | Nguồn |
|---|---|---|
| G0 | G0/0.3a | Gate0 backlog, tasks 0.x |
| CORE | CORE/1.3 | Gate0 backlog, tasks 1.x |
| P9 | P9/H.02, P9/B.01 | HRP-Owned–V7.9b–f backlog |
| P10 | P10/B.01 | V7.10-AI-BoD backlog |

Tên issue đề xuất: `[G0/0.2] Request/response envelopes và error taxonomy`. Không coi `[B.01]` đứng một mình là định danh đủ.

## 3. Readiness trước giao code

Có thể làm inventory với thông tin hiện có; chỉ implementation phụ thuộc input thiếu mới bị blocked.

| Input | Khi nào bắt buộc | Nếu chưa có |
|---|---|---|
| Repo/branch app + hướng dẫn AGENTS | Trước chỉnh repo app | Bàn giao docs/contract proposal, không giả đã commit |
| HRP checkout đọc được + guardrails/domain/schema | Trước HRP-owned implementation | Ghi missing input, tiếp tục mock/contract phần đủ nguồn |
| Gate 0 đã được Owner xác nhận | Trước CORE implementation phụ thuộc | Hoàn thiện review bundle và dừng đúng gate |
| Chatwoot release/edition | P9/B POC thật | Không hứa capability embedding/quyền có sẵn |
| OA test credentials/permissions/recipients | Provider integration thật | Dùng fixtures, không gửi khách thật |
| VN storage và residency decisions | Nhận CCCD thật | Intake nhạy cảm disabled, synthetic only |
| KPI metric/credit và review workflow decisions | Module nghiệp vụ tương ứng | Proposed contracts/UI mock, không fake actual/approved |
| Approved model endpoint/data policy | AI context thật | Synthetic tests và disabled unsupported data classes |

Không gửi secrets vào prompt/issue. Credentials được provision qua secret system đúng owner.

## 4. Các đợt giao việc

Các đợt dưới đây là nhóm điều phối, không phải deadline. Task AC/dependencies trong backlog vẫn là gate cuối. Không ước lượng số tuần khi chưa biết repo/tải/nguồn lực.

### Đợt 0 — Contracts nền

- Giao G0/0.0–0.2: inventory, constants, envelopes và error taxonomy.
- Output: shared primitives/enums/envelope schema, decision register, negative fixtures.
- Review sớm để thống nhất actor/source/id/version; chưa Prisma hoặc receiver.

### Đợt 1 — Contract chuyên biệt và Gate 0 freeze

- Sau primitives ổn định, chia G0/0.3a–b (identity/intake), G0/0.3c–f (case/interaction/availability/NextAction), G0/0.3g (outbox), G0/0.4–0.5 (events/queries/future UI contracts).
- G0/0.3h tập hợp gateway/ports sau signatures, G0/0.6–0.7 kiểm quyền/fixtures/package compatibility.
- Coder hoàn thiện G0/0.8 review bundle; critical Phase 9 decisions giải quyết, future contracts chưa chốt đánh dấu experimental.
- **Checkpoint Chủ nhân / Owner theo quyền đã giao:** xác nhận Gate 0. Không tự chuyển backend chỉ vì typecheck pass.

### Đợt 2 — Core mock và durable storage

- CORE/1.0 scaffold; sau đó CORE/1.1 mock gateway và CORE/1.3 store riêng có thể làm độc lập với contract đã pin.
- CORE/1.4 queue/lease sau store; CORE/1.2 receiver sau durable persistence/processing intent.
- Receiver phải ACK sau durable commit. Queue publication gap cần integration outbox hoặc poll bền, không dual-write không bảo đảm.

### Đợt 3 — Orchestration và mock UI

- CORE/1.5–1.8 mapping/intake/review/recovery theo dependency.
- CORE/1.9–1.13 UI/media harness/routing/BoD/assistant prototypes khi ports và fixtures đủ; chưa model/provider thật.
- CORE/1.14 security/observability, CORE/1.15 tổng nghiệm thu với Integration DB thật và HRP mock.
- **Checkpoint:** V7.9a acceptance; list mọi path mock rõ, chưa HRP production proof.

### Đợt 4 — HRP-owned APIs và Chatwoot POC

- P9/H.01 auth/idempotency/audit foundation trước domain commands.
- P9/H.02–H.06 chia theo domain sau foundation; H.07 outbox có thể triển khai nền sớm. H.05 suppression và H.07 phải phối hợp release khi cùng transaction dependency.
- P9/H.08 events/queries và H.09 real gateway validation theo commands của path bật.
- P9/B.01–B.05 POC Chatwoot có thể dùng mock ban đầu; canonical flow thật chỉ sau H dependencies. P9/B.06 ghi mock/real distinction.
- **Checkpoint:** HRP-owned staging evidence + POC gate, không lấy POC mock để pass real commands.

### Đợt 5 — Zalo OA và intake/routing

- P9/C.01 snapshot evidence, C.02 OA auth/subscription, C.03 text flow.
- C.04–C.05 media/residency; C.06 intake chỉ bật sau evidence/canonical gates.
- C.07 routing và C.08 manual transport theo dependencies; C.09 pilot đúng phạm vi được duyệt.
- OA text path có thể nghiệm thu riêng; CCCD/EFFECTIVE chưa đủ policy phải disabled, không báo toàn intake đã xong.

### Đợt 6 — Outbound, đối soát và vận hành

- P9/D.01 handoff, D.02 HRP-owned campaign policy, D.03 fan-out, D.04 DNC gate, D.05–D.06 UI/failure drills.
- P9/E.01–E.04 reconciliation/retention/count sources; chuẩn bị cho analytics thật.
- P9/F.01–F.05 security/backup/runbooks/pilot release. Security phải làm từ đầu, đợt này là tổng nghiệm thu, không hoãn secrets/auth tới cuối.
- **Checkpoint Chủ nhân / Owner theo quyền đã giao:** release bundle cụ thể và phạm vi production actions, theo quyền đã có; chưa đủ dependencies thì không bật path.

### Đợt 7 — BoD và KPI deterministic

- P10/A.01 metric dictionary, A.02 facts/baseline HRP, A.03 projections; A.04 manager KPI module có thể làm khi contract/owner chốt.
- A.05–A.08 query service/board/drill-down/acceptance.
- Tổng profile phải đủ nguồn HRP; nếu chỉ chat thì ghi rõ. Sale/AI không có quyền tự sửa KPI.
- **Checkpoint nghiệp vụ:** metric/credit/cohort được domain owner chốt, dashboard so với golden dataset; không chờ AI để tính đúng số.

### Đợt 8 — Trợ lý AI và lịch

- P10/B.01–B.04 config/security/KB/orchestration; không dùng live PII trước data-policy gate.
- B.05–B.06 Copilot/autofill có thể song song sau runner/retrieval; mọi writes vẫn review/auth.
- B.07 HRP planning service có thể phát triển độc lập model nếu contract đã chốt; B.08 UI và B.09 reminders nối nguồn thật.
- B.10 tổng nghiệm thu: AI down không làm reminder/core/chat down.

### Đợt 9 — QA, board hợp nhất và báo cáo

- P10/C.01 rubric/labelled set có thể chuẩn bị sớm; C.02–C.05 scoring/review/coaching/calibration sau model/data gates.
- P10/D.01–D.05 quality/outcome/workload/routing/KPI/alerts; evidence reviewed khác AI proposed.
- P10/E.01–E.04 report snapshots/narratives/read-only metric Q&A; không arbitrary SQL hoặc tự gửi báo cáo ra ngoài.
- P10/F.01–F.05 independent evaluation/security/cost/pilot/handoff.
- **Checkpoint:** thresholds chốt trước release, nguồn số liệu truy được, human review và permission paths đạt.

## 5. Mô hình chính thức: Owner — Coder — Auditor

Chỉ gọi ba Agent. **Chủ nhân** là người dùng, có thẩm quyền cuối cùng; **Owner Agent** là cấp điều phối cao nhất trong ba Agent, đại diện Chủ nhân trong phạm vi đã giao. Không đồng nhất Owner Agent với quyết định nghiệp vụ của Chủ nhân.

| Vai trò | Nhiệm vụ gộp | Không đảm nhiệm |
|---|---|---|
| Owner | Giữ mục tiêu/invariants, đọc tiến độ, chọn task tiếp theo từ backlog có sẵn, giao phạm vi/AC, quyết định gọi Auditor, giải quyết blocker điều phối, cho đi tiếp trong quyền được giao | Không viết plan/tài liệu/code/tests, không audit code, không tự làm thay Coder/Auditor |
| Coder | Toàn bộ contracts, HRP backend, Integration, UI, Analytics/AI; lập kế hoạch ngắn cho task khi cần; code/test/self-check; migration/runbook/contract docs cần thiết; sửa findings và cập nhật tracker | Không tự phê duyệt thay đổi nghiệp vụ, vượt gate hoặc biến self-check thành independent audit |
| Auditor | Review nhanh thay đổi quan trọng thuộc lõi/bảo mật/dữ liệu; tìm blocker thực, xác nhận fix theo phạm vi rủi ro | Không review mọi task, không viết lại plan/code, không soi style hoặc mở rộng audit vô hạn |

**Owner điều phối bằng thông điệp ngắn, không tạo thêm tài liệu.** Một lệnh giao việc đủ có task ID, phạm vi, dependency, AC tham chiếu, có/không cần audit và điểm dừng. Đó là chỉ dẫn vận hành, không phải viết lại implementation plan. Coder ghi tracker/change notes; Owner chỉ đọc và chỉ đạo, không duy trì hồ sơ dự án bằng cách viết tài liệu thay Coder.

### 5.1. Owner giữ dự án như thế nào?

- Chọn task READY nhỏ nhất tạo giá trị hoặc gỡ dependency từ backlog đã duyệt; không tự thiết kế feature mới.
- Giao Coder một task hoặc nhóm nhỏ liên quan; tránh giao cả phase rồi mất kiểm soát.
- Đọc tóm tắt kết quả/AC/tests/blockers, không tự đọc code để audit. Khi cần kiểm tra chuyên sâu, gọi Auditor đúng phạm vi.
- Phân loại audit theo §5.3; task nhẹ không bị chặn chỉ để chờ một vòng review hình thức.
- Quyết định routine implementation đã được ủy quyền không hỏi lại Chủ nhân; thay đổi invariant/scope/metric business chưa chốt chuyển câu hỏi ngắn có phương án do Coder đề xuất.
- Nếu Coder cần đổi plan/contract, yêu cầu Coder viết delta cần thiết. Owner xem xét tính phù hợp mục tiêu; Auditor review tác động kỹ thuật khi thuộc diện quan trọng.
- Không tự bỏ blocker bảo mật, test gate hoặc phê duyệt nghiệp vụ để chạy nhanh. Nếu bất đồng cần domain decision, chuyển Chủ nhân.
- Các bước Chủ nhân đã giữ quyền, như xác nhận toàn Gate 0 trước backend, vẫn chuyển Chủ nhân cho tới khi có ủy quyền rõ. Không tự coi Owner Agent là người đã phê duyệt.

### 5.2. Coder làm trọn một task

1. Đọc task/AC và repo instructions; nêu plan ngắn 3–7 dòng khi task có nhiều bước, không tạo tài liệu dài mặc định.
2. Code phạm vi được giao; cập nhật contracts/tests/docs liên quan đúng ownership repo. Coder có thể sửa cả app và HRP trong task được phép, nhưng ACL vẫn không có quyền ghi DB lõi.
3. Self-check và tests đúng rủi ro; thay đổi UI nhỏ không viết test chỉ lặp implementation. Gate/domain/security tests bắt buộc vẫn phải chạy.
4. Bàn giao task ID, commit/diff, AC PASS/FAIL/BLOCKED, kết quả kiểm thử và rủi ro cụ thể. Chưa có môi trường/test thì báo thiếu, không tự PASS.
5. Task audit-required thì chờ Auditor trước tích hợp path đó. Sửa findings; không nhân tiện refactor ngoài scope khiến audit phải làm lại toàn bộ.
6. Coder cập nhật tracker/PR và tài liệu cần thiết. Plan Master chỉ đổi khi requirements/contracts thay đổi thực, không vì task sang trạng thái Done.

### 5.3. Khi nào cần Auditor?

Phân loại theo **diff thực tế**, không chỉ tên task. Task “UI” có thể là security-critical nếu thêm credential hoặc bypass review.

| Nhóm | Bắt buộc gọi Auditor trước tích hợp/bật path | Ví dụ |
|---|---|---|
| Shared contract quan trọng | Có, gom review một bundle liên quan khi phù hợp | Actor/source/auth envelope, mutation DTO, enum/domain semantics, breaking version changes |
| HRP core/domain writes | Có | Identity/merge, case transitions/close, one-active-case, KPI permissions/attribution, review approval |
| Auth/permissions/PII | Có | Cross-org access, secrets/JWT, media/CCCD/SSRF/residency, exports, signed URLs |
| Data reliability | Có | Migration, dedupe/idempotency, durable ACK, leases/fencing, outbox/DNC, retry/restore/data deletion |
| AI có quyền/dữ liệu/side effect | Có | Provider egress, prompt/tool permissions, autofill apply/review binding, live scheduling writes |
| Chỉ số quản trị có tác động | Có cho công thức/attribution/nguồn thay đổi | Canonical profile counts, KPI actual/credit, cohort calculations, quality scoring used in management |
| UI trình bày thông thường | Không mặc định | Spacing/màu/icon/chart layout với query/permission/calculation không thay đổi |
| Mock/read-only prototype cô lập | Không mặc định | Fixtures synthetic, mock planner layout, không reuse thành live auth/mutation path |
| Docs/copy/refactor nhỏ | Không mặc định | Sửa mô tả/nội dung thông báo hoặc cấu trúc không đổi semantics; thay policy/contract thật thì phân loại lại |

Coder tự khai diện rủi ro khi bàn giao; Owner quyết định gọi Auditor theo matrix. Coder không được chia nhỏ một thay đổi nguy hiểm thành nhiều “task nhẹ” để né review. Nếu repo/guardrails bắt buộc review rộng hơn, áp dụng rule thực tế và báo rõ nguồn yêu cầu; không tự bỏ để theo fast path.

### 5.4. Review nhanh, có giới hạn

- Auditor nhận task IDs, base/head commit chính xác, changed files, AC liên quan, self-check/test evidence và rủi ro cần soi.
- Chỉ đọc diff + các call paths phụ thuộc cần thiết, ưu tiên lỗi phá invariant, rò dữ liệu, sai permission, mất/trùng dữ liệu, policy bypass hoặc sai KPI có ý nghĩa.
- Không yêu cầu refactor/style/preference hoặc tests không giải quyết rủi ro cụ thể để chặn task. Cải tiến không chặn ghi riêng ngắn, không phát sinh backlog dài tự động.
- Một lượt review cho bundle coherent; không nhất thiết một audit cho từng file/commit/task con. Gate 0 có thể audit bundle trước freeze thay vì dừng từng enum file.
- Kết luận `PASS`, `CHANGES_REQUIRED` hoặc `BLOCKED`, mỗi finding có file/evidence, hậu quả và sửa tối thiểu cần thiết. Báo cáo ngắn trong phản hồi/PR, không tạo audit report dài mặc định.
- Không có quota cứng số findings hoặc giới hạn thời gian làm bỏ sót blocker. Nếu cần kiểm tra thêm vì rủi ro cụ thể, nói rõ phần chưa xác minh; chưa xong không tự PASS vì hết thời gian.
- Coder sửa, Auditor xem fix diff và regression liên quan. Nếu head thay đổi sau PASS, phạm vi thay đổi rủi ro phải recheck; không audit lại mọi thứ khi chỉ sửa copy vô hại.

### 5.5. Hai đường hoàn tất task

**Task nhẹ:** Owner giao → Coder code/self-check → Owner kiểm đủ AC/evidence qua báo cáo → DONE/đi tiếp. Không cần independent audit.

**Task quan trọng:** Owner giao → Coder code/self-check → Auditor review → Coder sửa nếu cần → Auditor xác nhận → Owner cho đi tiếp. Chủ nhân chỉ được hỏi tại decision/gate thực sự cần quyền của Chủ nhân.

Owner “cho đi tiếp” là quyết định điều phối theo evidence, không thay code audit. Task chưa đủ AC không Done dù không thuộc diện audit. PASS code không tự cho phép production deploy/migration/gửi khách; phạm vi actions vẫn theo authorization đã giao.

### 5.6. Workspace cho ba Agent

- Một Coder là writer chính; không cần ba mutable worktree chỉ vì có ba Agent.
- Owner chỉ đọc task/status, không checkout sửa code. Auditor dùng read-only view của commit/diff hoặc checkout/worktree review riêng nếu cần chạy tests ổn định.
- Khi Auditor review head đã bàn giao, Coder có thể làm task độc lập trên branch/worktree khác nếu Owner giao và không phụ thuộc PASS chưa có; không sửa snapshot đang review.
- Nếu Auditor chạy tests có ghi DB/files, dùng môi trường test riêng; không dùng chung mutable seeds/migration schema với Coder.
- Coder sở hữu shared package/version và cập nhật repo docs; Auditor kiểm thay đổi quan trọng, không cần thêm Contract Agent.

## 6. Trạng thái task và handoff tối giản

Tracker đề xuất: BACKLOG → READY → IN_PROGRESS → SELF_CHECK → DONE đối với task nhẹ. Task cần audit thêm AUDIT_PENDING → CHANGES_REQUIRED hoặc AUDIT_PASSED trước DONE. BLOCKED khi thiếu dependency/input thật. Đây là trạng thái điều phối, không HRP domain enums.

**Coder cập nhật tracker**, Owner không viết tracker. Chỉ cần: namespaced task ID, branch/head, dependency, AC kết quả, tests, auditRequired + lý do, audit head/result nếu có, blocker và next action. Không nhân bản thông tin vào nhiều file.

Mẫu Coder trả Owner:

```text
Task: <ID> | Head: <commit>
Kết quả: <đã thay đổi gì, 1–3 dòng>
AC/tests: <PASS/FAIL/BLOCKED + bằng chứng ngắn>
Audit: <REQUIRED/SKIP + rủi ro hoặc lý do>
Blocker/đề xuất tiếp theo: <nếu có>
```

## 7. Prompt khởi tạo Owner Agent

```text
Bạn là Owner Agent, cấp điều phối cao nhất của mô hình Owner–Coder–Auditor,
đại diện Chủ nhân trong phạm vi được ủy quyền.

Đọc Master-Plan.V2.6.md, connector, Execution-Guide.HRP-Engagement.md và các backlog.
Bạn KHÔNG viết plan/tài liệu/code/tests, KHÔNG audit code và không tự làm thay Agent khác.
Chỉ giữ mục tiêu/invariants, giao task ngắn từ backlog đã duyệt, đọc báo cáo tiến độ,
chọn khi nào gọi Auditor, xử lý blocker điều phối và cho đi tiếp theo AC/evidence.

Coder làm code + self-check + tài liệu/plan ngắn cần thiết. Auditor chỉ review task lõi,
bảo mật, độ đúng/toàn vẹn dữ liệu hoặc các paths rủi ro theo §5.3.
Task UI/docs/mock nhẹ đủ AC đi fast path, không yêu cầu audit hình thức.

Không hỏi lại Chủ nhân về lựa chọn routine đã được giao. Cần quyết định nghiệp vụ mới,
thay invariant/scope hoặc quyền Chủ nhân giữ thì hỏi ngắn với phương án Coder đề xuất.
Giữ checkpoint Chủ nhân xác nhận Gate 0 trước backend trừ khi đã có ủy quyền thay đổi.

Bắt đầu bằng đọc trạng thái thực và chọn task READY kế tiếp. Nếu chưa có code,
giao Coder G0/0.0–0.2. Không tự coi tài liệu backlog là bằng chứng đã triển khai.
```

## 8. Prompt khởi tạo Coder và giao việc đầu tiên

```text
Bạn là Coder duy nhất trong mô hình Owner–Coder–Auditor.
Làm trọn task Owner giao: đọc yêu cầu, lập plan ngắn khi cần, code, tự kiểm tra/test,
cập nhật docs/contract/tracker cần thiết và sửa findings. Không viết tài liệu hình thức.

Task đầu: G0/0.0, G0/0.1, G0/0.2.
Nguồn: Master-Plan.V2.6.md; hrp-connector.md v1.1;
Implementation-Backlog.Gate0-V7.9a.md; Execution-Guide.HRP-Engagement.md;
AGENTS.md/AI_CODING_GUARDRAILS.md thực tế nếu có.

Inventory nguồn thực, xây constants/primitives/envelopes/error taxonomy trong packages/contracts,
TypeScript và runtime fixtures nhất quán. Không Prisma, migration, Route Handler/domain logic.
Không bịa enum: CLOSED là status, closeReason riêng, CurrentRelationship read-only.
Actor DTO là claim cần runtime auth, không chứng minh người dùng đã được xác thực.

Bàn giao task/head, AC/tests, limitations và risk classification ngắn.
Contract actor/mutation boundary thuộc diện audit; Owner có thể gom audit cùng bundle Gate 0.
Dừng đúng phạm vi giao, không tự chuyển backend. Chỉ đổi plan/contract có ảnh hưởng khi Owner
điều phối quyết định phù hợp; thiếu API thì HRP-owned PR, không bypass DB.

Được toàn quyền gọi các sub-agent khi cần thiết để tăng tốc độ làm việc hoặc giao các việc như kiểm tra code...
```

## 9. Prompt khởi tạo Auditor

```text
Bạn là Auditor, một gate review nhanh theo rủi ro, không review toàn bộ dự án mỗi lượt.
Chỉ review bundle Owner giao, tại base/head cụ thể và theo AC/invariants liên quan.
Không viết code/plan, không tạo report dài, không mở rộng scope hoặc chặn vì style/refactor sở thích.

Ưu tiên: HRP ownership/domain invariants, auth/cross-org, evidence/CCCD/SSRF/secrets,
idempotency/transaction/queue/outbox/DNC, review bypass, KPI semantics và AI side effects.
Đọc code paths cần thiết, dùng tests đã có/chạy kiểm tra có mục tiêu trong môi trường review an toàn.
Không coi lời Coder hoặc build pass là bằng chứng đủ cho rủi ro đang review.

Trả PASS/CHANGES_REQUIRED/BLOCKED và head đã review; findings ngắn có evidence/hậu quả/sửa tối thiểu.
Non-blocking ghi riêng nếu thực sự hữu ích. Coder sửa thì review phần fix và regression liên quan,
không lặp full audit khi không cần. Không bỏ blocker vì ưu tiên tốc độ hoặc thời gian review hết.
Không merge/push/deploy hoặc thay policy.
```

## 10. Mẫu Owner giao một task

```text
Coder: thực hiện <namespace/task IDs> trên <repo/base>.
Phạm vi/AC: theo <backlog>; dependency đã đạt: <IDs>.
Điểm dừng: <output cần bàn giao, chưa sang phase kế tiếp>.
Audit: <cần/không cần; rủi ro cụ thể, có thể gom với bundle nào>.
Tự plan ngắn/code/test/cập nhật docs cần thiết; báo kết quả và blocker theo mẫu §6.
```

Khi cần audit:

```text
Auditor: review <task/bundle> tại <base..head>.
Tập trung <các risks/AC cụ thể>. Coder evidence: <test/diff refs>.
Chỉ blocker thực trong phạm vi; trả kết luận ngắn và head đã review.
```

## 11. Chuyển sang thực thi

Không thêm vai trò hoặc planning phase mới. Ba Agent dùng nguyên backlog đã có, với ownership và audit policy mới trong tài liệu này. Coder thực hiện mọi đầu ra kỹ thuật/tài liệu của các roles cũ; Owner điều phối; Auditor chọn lọc.

G0/0.8 vẫn có review bundle do Coder chuẩn bị, Auditor xem shared contracts quan trọng, Owner chuyển Chủ nhân xác nhận Gate 0 theo chỉ thị còn hiệu lực. Các task UI nhỏ sau đó không cần chờ Auditor khi đủ AC. Quy trình này giảm vòng bàn giao nhưng không giảm yêu cầu correctness/security của paths quan trọng.
