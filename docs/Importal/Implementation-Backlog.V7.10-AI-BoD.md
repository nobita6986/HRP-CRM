# Implementation Backlog — V7.10 AI, trợ lý sale và BoD

**Ngày:** 13/09/2026. **Baseline:** Master-Plan.V2.6.md, hrp-connector.md v1.1 và hai backlog Gate0–V7.9a / HRP-Owned–V7.9b–f.  
**Phạm vi:** giao task cho Coding Agents; chưa viết code hoặc thực hiện production actions. Các slice V7.10a–f là phân chia triển khai của Master Plan, không thêm enum nghiệp vụ HRP.

## 1. Điều kiện chung và ownership

Trong tài liệu, DNC là Availability `DO_NOT_CONTACT` chính thức của HRP.

- HRP là SoR cho identity, case, availability, assignment/outcomes, attribution và các module KPI/lịch nghiệp vụ được HRP-owned PR phê duyệt. Chatwoot là SoE; Analytics là dữ liệu dẫn xuất; AI chỉ đọc theo quyền và tạo proposal.
- KPI chính thức do quản lý giao/chỉnh. Sale/AI được đề xuất kế hoạch, không tự sửa target, weights, Handling SLA, credit hoặc hoa hồng.
- AI không tự gửi tin khách, tạo Worker, chuyển EFFECTIVE, chọn Beneficiary, merge hồ sơ hoặc ra quyết định nhân sự. User approval không thay server-side authorization/domain policy.
- Schema/ports Phase 9 đã có phải reuse/version; thiếu contract là HRP-owned PR, không tạo canonical tables trong ACL.
- Không đưa CCCD/ảnh/địa chỉ nhạy cảm ra model ngoài phạm vi được phép. API compatible không có nghĩa đáp ứng residency hoặc quyền xử lý dữ liệu.
- Scope áp dụng tới queries, retrieval, cache, jobs, exports và drill-down; BoD aggregate không mặc định xem transcript/CCCD.
- Gate của task là dependencies trực tiếp; không cần chờ toàn bộ tính năng khác nếu dùng read-only data/fixture đã có. Production mutation không dùng mock.
- Mỗi AC cần evidence/test/review tương ứng; mock pass, build pass hoặc model trả câu nghe hợp lý không thay nghiệm thu số liệu/chính sách.

## 2. Bản đồ triển khai

| Slice | Task IDs | Mục tiêu | Dependency chính |
|---|---|---|---|
| V7.10a | A.01–A.08 | Metric/data correctness, profile/KPI và BoD deterministic | HRP read/events/auth, H.08/H.09/E.04 |
| V7.10b | B.01–B.10 | AI config/security, KB, Copilot, autofill, personal planner/reminders | A contracts, context/identity/review/intake gates Phase 9 |
| V7.10c | C.01–C.05 | Đánh giá chất lượng và human review/coaching | B security/KB, authorized transcript, rubric calibration |
| V7.10d | D.01–D.05 | Dashboard hợp nhất, routing/workload, alerts và plan thực tế | A metrics/KPI, B planner, C assessments |
| V7.10e | E.01–E.04 | Báo cáo kỳ và BoD hỏi đáp dựa dữ liệu | Metric service, authorization, snapshot và model gates |
| V7.10f | F.01–F.05 | Đánh giá độc lập, bảo mật, tải/chi phí, pilot/rollback | Những paths định bật đã nghiệm thu |

Mọi task có thể tạo mock sớm theo Gate 0 nhưng chỉ Done production sau AC với dependency thật. Tên commands/fields chưa chốt phải đề xuất qua HRP-owned ADR/PR, không tự coi là API hiện có.

# 3. V7.10a — Analytics nền, KPI và BoD xác thực

## A.01 — Đóng băng metric dictionary và grain

**Output:** versioned metric dictionary và fixtures; domain-owner sign-off. **Dependency:** H.08/source inventory.

**AC:**
- [ ] Mỗi metric có owner, formula, numerator/denominator, unit/grain, event time, filters/cohort, source coverage, attribution version, retention và freshness.
- [ ] Tách canonical profile tạo mới, submission, update thực/no-op, review status, NLD nhận việc, EFFECTIVE và case CLOSED/SUCCESS.
- [ ] Tồn profile tới hiện tại khác profile tạo trong kỳ; người duy nhất khác lượt/case/assignment.
- [ ] Chốt “chốt NLD” và các mốc nguồn; mốc chưa chốt có nhãn cụ thể/chưa khả dụng, không tự đoán từ chat.
- [ ] Timezone Asia/Ho_Chi_Minh, kỳ [start,end), zero denominator, kỳ chưa hết và cohort maturity có fixtures.

## A.02 — HRP-owned facts/attribution/baseline PR

**Output:** queries/events/backfill bổ sung cần thiết, không truy DB core từ Analytics. **Dependency:** A.01, H.08/H.09.

**AC:**
- [ ] Profile creation toàn nguồn chat/manual/import có canonical ID/event/version/time/source; coverage thiếu được trả rõ.
- [ ] SubmittedBy, executingActor, credited creator, current assignee và outcome credit tách biệt; chưa phân bổ không tự gán sale.
- [ ] Correction/merge/historical restatement policy được domain owner chốt; không tự primary/fractional credit hoặc quyết định Referral.
- [ ] API paging/cursors/watermark/field scopes/rate limits và historical fixtures đủ cho reconciliation.

## A.03 — Analytics projections và reconciliation

**Output:** Integration-owned derived facts/projections/jobs, schema migrations riêng. **Dependency:** A.01–A.02.

**AC:**
- [ ] Dedupe event/org/source, out-of-order/aggregate-version/correction handling; stable keys không theo receipt timestamp mới.
- [ ] Initial baseline + incremental events phối hợp watermark, không double-count vùng overlap hoặc mất updates lúc backfill.
- [ ] Merge/correction giữ lineage, reports snapshot cũ không sửa âm thầm; reconcile count theo nguồn và scope.
- [ ] Facts không full raw transcript/CCCD, canonical references là scalar, không HRP DB FK/credential.
- [ ] Stale/partial/unavailable khác 0; recovery/backfill có evidence.

## A.04 — HRP-owned KPI assignment/revision

**Output:** assign/revise/read KPI command APIs và audit/events theo domain ADR. **Dependency:** Gate 0 KPI contracts, A.01, H.01/auth.

**AC:**
- [ ] Manager có scope mới giao/chỉnh; sale/service/AI không tự đổi target. Staff đề nghị điều chỉnh là request, không effect.
- [ ] Metric/version/unit, period/timezone, target, effectiveAt/revision/reason và attribution policy đầy đủ.
- [ ] Version/idempotency/concurrency/audit thật; mid-period revision có as-of, không làm mất target lịch sử.
- [ ] Actual từ metric service, không input user/LLM; target zero và metric “càng thấp càng tốt” có logic riêng.
- [ ] Module HRP chưa có thì chưa bật canonical KPI; không thay bằng ACL KPI SoR.

## A.05 — Metric query service và scope

**Output:** allowlisted metric API/semantic query layer. **Dependency:** A.03–A.04.

**AC:**
- [ ] Query metricId/version + permitted dimensions/filter/time/as-of; backend validate, không SQL tự do.
- [ ] Returns totals, breakdown, sample/coverage, calculation metadata/watermark và permissions cho drill-down.
- [ ] Organization/object/field scope áp dụng server; cache key gồm quyền/version/scope và invalidation khi revoke.
- [ ] Số total/breakdown/rows nhất quán theo grain; unsupported combination reject có lý do.
- [ ] Timeout/resource bounds, paging/high-cardinality limits; không dump toàn data cho frontend.

## A.06 — BoD chart-first dashboard

**Output:** board React/Next.js branding HRP, responsive chart components. **Dependency:** A.05, BOD-VIS mock Phase 9.

**AC:**
- [ ] Mặc định 6–8 widgets quan trọng: KPI/sparklines, tăng trưởng, funnel, profile theo sale/nguồn, target/actual, backlog; mở thêm qua tab/expand.
- [ ] Palette nhiều màu nhất quán, cam HRP làm nhận diện; xác minh design tokens, labels/legend/contrast, không 3D/trục gây hiểu sai.
- [ ] Click chart/segment/point/KPI tới detail giữ metric/filter/period/cohort/as-of; keyboard/touch/table fallback.
- [ ] Snapshot/stale/empty/no-data/loading/error rõ bằng tiếng Việt; không raw error codes.
- [ ] Tổng công ty chỉ khi toàn nguồn đủ; nếu chỉ chat thì nhãn phản ánh đúng phạm vi.

## A.07 — Drill-down, xuất báo cáo và profile attribution

**Dependency:** A.05–A.06.

**AC:**
- [ ] Drawer/page có công thức, nguồn/version, bảng phân trang và breadcrumbs; quay lại giữ filters/selection.
- [ ] Profile new/update/review/outcome tách; assignee đổi không tự chuyển creation credit.
- [ ] Aggregate-only BoD không leak candidate/evidence/transcript qua tooltip/deep link/export.
- [ ] CSV/XLSX exports scoped, as-of/version, audit và formula-injection protection; links expiry/access checks.
- [ ] Downsample chart nếu có ghi chú, không làm thay đổi KPI tổng hoặc số detail không giải thích được.

## A.08 — Analytics/KPI acceptance gate

**Dependency:** A.01–A.07.

**AC:**
- [ ] Golden dataset gồm retry/new/update/no-op/import/shared source/multiple cases/merge/late events/zero denominator, đối soát với HRP expected result.
- [ ] Actual KPI manager target, period comparisons/cohort maturity/sample constraints có bằng chứng.
- [ ] Metrics hoạt động khi AI tắt; không dùng model tính số liệu.
- [ ] Domain owner review metric/attribution và BoD review dashboard trước dùng số liệu quản trị.

# 4. V7.10b — AI configuration, Copilot và trợ lý cá nhân

## B.01 — Provider adapters và configuration contracts

**Output:** Responses/Chat Completions adapters, typed config/capability registry. **Dependency:** Gate 0 config contracts, provider documentation hiện hành.

**AC:**
- [ ] Base URL/model/apiStyle/secretRef/task-team-data policy/budgets/version đầy đủ; payload adapters riêng theo protocol.
- [ ] Test connection dùng synthetic non-PII input; xác minh streaming/structured output/tool/vision nếu bật, không assume compatible đủ capabilities.
- [ ] Provider không hỗ trợ capability thì disable/reroute có kiểm soát, không quietly degrade gây sai schema.
- [ ] Client UI không gọi model trực tiếp hoặc nhận API key; không pin model/pricing chưa kiểm chứng.

## B.02 — AI secrets, egress và data residency gate

**Dependency:** B.01, Phase 9 security/media/residency.

**AC:**
- [ ] URL validation + DNS/connect/redirect/egress protection chống SSRF; private nội địa chỉ approved route/allowlist tường minh.
- [ ] Keys encrypted server-side, masking/rotation/audit; exports/traces/errors không lộ secrets hoặc signed media URLs.
- [ ] Allowed data classes/processing regions/retention/training terms provider được owner dữ liệu review; không kết luận chỉ từ “OpenAI-compatible”.
- [ ] Fallback không vượt phạm vi PII/residency; nội địa lỗi không tự gửi CCCD qua external model.
- [ ] Redaction pipeline test số CCCD/ảnh/địa chỉ/SĐT và indirect identifying context; OCR cloud không tự bật.

## B.03 — Approved knowledge base và scoped retrieval

**Output:** ingestion/retrieval nguồn HRP/job/policy đã duyệt, version/effective dates. **Dependency:** B.02, context queries.

**AC:**
- [ ] Nguồn có owner/approval/version/effective/expiry, update/revoke làm invalid cache/index theo SLA đã chốt.
- [ ] Retrieval theo actor/org/target scope, không query vector index chung rồi chỉ lọc UI.
- [ ] Không index nguyên transcript/CCCD tùy ý; prompts/context tối thiểu, evidence refs giữ SoE ownership.
- [ ] Conflict/no source/stale source trả trạng thái rõ; không tự bịa lương/địa chỉ/quyền lợi.
- [ ] Historical QA dùng policy có hiệu lực lúc sale trả lời, không phạt dựa tài liệu mới hơn.

## B.04 — AI execution orchestration và budgets

**Output:** job/request runner, typed proposal results, usage/latency telemetry. **Dependency:** B.01–B.03.

**AC:**
- [ ] Runtime validate structured output, input limits/cancel/stale-context, bounded retry/circuit breaker và token/concurrency/spend caps.
- [ ] Usage có provider/model/task/version, cost estimate ghi rõ pricing version; token usage thiếu không ghi giả chi phí chính xác.
- [ ] Prompt injection không biến chat/KB thành system instruction; allowlisted read/proposal tools, không arbitrary SQL/HTTP/domain write.
- [ ] Model/context/prompt/schema versions gắn proposal; timeouts/budget hết không chặn core/chat.
- [ ] Caches theo context/permissions/source revision; user đổi conversation không nhận response của khách trước.

## B.05 — Copilot tư vấn trong Context Panel

**Dependency:** B.03–B.04, Chatwoot panel/transport Phase 9.

**AC:**
- [ ] Tóm tắt nhu cầu, câu hỏi còn thiếu, draft trả lời và next-best-action có nguồn; phân biệt dữ kiện/lời khách/suy luận.
- [ ] Các tình huống lương/ca/xa nhà/phí/đổi ý/chờ khách hàng dùng nguồn hiện hành, thiếu nguồn hỏi lại/escalate.
- [ ] Sale xem/sửa/apply-to-composer rồi chủ động gửi; accept draft không đồng nghĩa đã gửi/đã interaction.
- [ ] Write sau accept vẫn qua app auth/domain/outbox rules; không model tự EFFECTIVE/Worker/Beneficiary/Handling.
- [ ] Disable copilot/cancel/version conflict có UI tự nhiên và không ảnh hưởng chat thường.

## B.06 — Autofill intake từ hội thoại

**Dependency:** B.02–B.04, production intake review/evidence gates Phase 9.

**AC:**
- [ ] Field whitelist, proposed value + evidence refs/source time + explicit/uncertain/conflict states; structured output validate.
- [ ] Không đoán thiếu data/“tuần sau”, không lấy tên/SĐT người khác trong chat thành ứng viên; contradictory fields yêu cầu review.
- [ ] Không overwrite canonical verified fields; staff chọn/apply vào draft, review/diff/confirm revision bắt buộc.
- [ ] Prefill/preview không gọi createOrMatch mutation; target/context/revision đổi invalidates result/confirmation.
- [ ] PII không được phép gửi model thì redact/tokenize hoặc nhập tay/xử lý nội địa; model không khôi phục giá trị che bằng đoán.
- [ ] EXACT vẫn review; field CurrentRelationship không có write path; DNC action không bị chờ full form.

## B.07 — HRP-owned planning/NextAction contracts thực

**Output:** planning commit/reschedule/read/events bổ sung, reuse NextAction domain services. **Dependency:** H.06, Gate 0 planning/KPI contracts.

**AC:**
- [ ] Canonical task/schedule do HRP sở hữu; không tạo lịch nghiệp vụ cạnh tranh trong ACL/Chatwoot notes.
- [ ] Target/actor/permissions/deadline/timezone/revision/idempotency, work-item conflict/reopen/cancel semantics được domain review.
- [ ] Batch commit có per-item result và stable keys; một item lỗi không rollback hoặc báo success sai những item khác ngoài contract.
- [ ] Snooze/dismiss notification không DONE; planning không tự đổi manager KPI, routing weights/Handling.
- [ ] Nhập/tạo lịch thủ công hoạt động khi AI tắt.

## B.08 — “Hôm nay của tôi” và kế hoạch tuần

**Dependency:** B.04/B.07, A.04–A.05.

**AC:**
- [ ] Lịch hẹn, việc đến hạn, hồ sơ cần bổ sung, KPI tiến độ, backlog/capacity có nguồn/version và scoped links.
- [ ] AI đề xuất time blocks xét lịch cố định/ca/nghỉ/buffer/lead availability; duration/forecast ghi là ước lượng.
- [ ] Sale sửa/chấp nhận từng mục hoặc batch; revalidate trước write; partial success rõ, không auto change lịch hẹn khách.
- [ ] Manager target giữ nguyên; AI nêu bottleneck/đề xuất adjustment để manager review, không giảm target hoặc tăng weights tự động.
- [ ] Không gọi model để tính actual/progress; kế hoạch không được quảng bá là chắc chắn đạt KPI.

## B.09 — Durable reminders và notification center

**Dependency:** B.07–B.08, worker/queue Phase 9.

**AC:**
- [ ] Scheduler/worker bền, key action+occurrence+recipient; check revision/latest state lúc execution, lease/fencing/dedupe.
- [ ] Browser đóng/user offline/model down vẫn ghi notification in-app bền; UI nhận khi online theo quyền, không hứa push nếu chưa có provider.
- [ ] Reschedule/cancel invalid job cũ; restart/restore/missed reminders/quiet hours/timezone có runbook và tests.
- [ ] Reminder nội bộ khác tin nhắc khách; tin ra khách chỉ khi authorized policy/config và DNC gate, không mặc định external channel.
- [ ] Mất quyền không nhận PII từ notification cũ; dismiss/snooze không tự hoàn tất canonical task.

## B.10 — Copilot/planning gate

**Dependency:** B.01–B.09 theo paths bật.

**AC:**
- [ ] Test authorized draft→staff review→canonical result, stale context, budget/provider outage và cancellation đạt.
- [ ] Model test fixture không thể kích hoạt mutation/sending không có approval/auth.
- [ ] Có data-flow/budget/capability report và feature flags riêng provider/Copilot/autofill/planner.
- [ ] Chưa đủ residency thì nhạy cảm disable riêng; không ép user gửi PII để dùng trợ lý.

# 5. V7.10c — Chất lượng chat, review và coaching

## C.01 — Rubric và human-labelled evaluation set

**Output:** rubric versions, anchors/examples và bộ mẫu synthetic/redacted đã người có chuyên môn đánh giá. **Dependency:** nghiệp vụ tuyển dụng/QA owner.

**AC:**
- [ ] Tiêu chí hiểu nhu cầu, chính xác thông tin, rõ/lịch sự, xử lý câu hỏi, bước tiếp theo có mức 0–4; weights đề xuất 20/30/15/15/20 được quản lý duyệt trước dùng.
- [ ] N/A loại khỏi denominator, coverage/cỡ mẫu rõ; ngưỡng đủ dữ liệu chốt trước rollout, không ít chat=0 điểm.
- [ ] Tách sale turns/bot/handover và sampling theo source/ca/độ khó; không chỉ chọn chat thất bại.
- [ ] Calibration và held-out set tách, reviewers có adjudication; không suy tính cách/cảm xúc/thuộc tính nhạy cảm.

## C.02 — Quality assessment worker

**Dependency:** C.01, B.02–B.04, authorized transcript API.

**AC:**
- [ ] Input window/version ổn định, message refs/evidence, rubric/model/prompt/source policy version và limitations đầy đủ.
- [ ] Assessment dự thảo, không success/violation verdict chính thức; unsupported claims không evidence bị flag/reject.
- [ ] Reopen/rescore tạo version/superseded, không nhân mẫu; actor thực theo message time, không assignee cuối.
- [ ] Raw transcripts không mirror toàn bộ vào core/analytics; evidence snippets chỉ tối thiểu đã redact, access policy.
- [ ] Historical KB version đúng lúc tư vấn; missing source làm N/A/needs review theo rubric.

## C.03 — QA review/dispute UI và permissions

**Dependency:** C.02, context authorization.

**AC:**
- [ ] Reviewer được cấp scope team/evidence; có accept/correct/reason/version/audit; AI proposal khác reviewed score.
- [ ] Sale xem evidence của mình trong phạm vi quyền, phản hồi/đề nghị review; không sửa model/human result âm thầm.
- [ ] Stale/concurrent reviews conflict; revoke/cross-team query/export bị chặn.
- [ ] Errors tiếng Việt; label không kết luận kỷ luật tự động.

## C.04 — Coaching cá nhân và bàn giao

**Dependency:** C.03, B.05.

**AC:**
- [ ] Tuần có một số ví dụ/evidence và hướng cải thiện có nguồn; không biến điểm thành tính cách nhân viên.
- [ ] Handover summary đúng scope/actor/source, không thay Handling hoặc credit.
- [ ] Coaching đề xuất actions, không tự tạo KPI/đổi lương/hoa hồng/kỷ luật.
- [ ] Sale/manager có thể phản hồi sai sót; update version giữ trace.

## C.05 — Quality calibration gate

**Dependency:** C.01–C.04.

**AC:**
- [ ] Đo agreement/score error/false positives nghiêm trọng/evidence correctness/coverage trên held-out set và report theo strata.
- [ ] Ngưỡng release do QA/Owner chốt trước thử nghiệm chấm điểm quản trị; không lấy model confidence làm bằng chứng đã hiệu chuẩn.
- [ ] Model/rubric đổi chạy regression, reviewed vs proposed metrics tách; không đánh giá nhân sự chỉ bằng AI score.
- [ ] Staff được thông báo phạm vi đánh giá và workflow review/dispute.

# 6. V7.10d — Board hợp nhất và quản lý hiệu quả

## D.01 — Quality/outcome/workload widgets

**Dependency:** A.06–A.08, C.03/C.05.

**AC:**
- [ ] Heatmap quality kèm sample/coverage/review status, outcome funnel và workload cạnh nhau; không một “điểm sale” tổng hợp tùy ý.
- [ ] Chart click đúng evidence/metric scope/as-of; AI chưa review không trộn điểm đã xác nhận.
- [ ] Không có nguồn retention/attendance thì không suy tiếp tục đi làm từ vắng event nghỉ.

## D.02 — Routing fairness/capacity charts

**Dependency:** routing C.07 Phase 9, A.05.

**AC:**
- [ ] Target-vs-actual theo eligible set/config period; không kết luận lệch vì agent nghỉ ca là router lỗi.
- [ ] Sources/weights/caps/reservations/manual override/sticky breakdown và decision drill-down.
- [ ] Số lượng leads khác độ khó; bối cảnh nguồn hiển thị, không tự tăng weight theo AI score.

## D.03 — KPI manager workspace

**Dependency:** A.04–A.05, B.08.

**AC:**
- [ ] Manager assign/revise/review progress đúng team, audit/effective revision và historical reports.
- [ ] Target/actual/gap/capacity và source coverage; unavailable metric không dùng làm KPI giả.
- [ ] Sale chỉ đề nghị điều chỉnh, AI explanation không là approval; override không thay credit/business outcomes.

## D.04 — Alerts định lượng và follow-up workflow

**Dependency:** A metrics/B.09/C review/D.03.

**AC:**
- [ ] Rule alerts backlog/NextAction overdue/SLA chat/quality-reviewed exceptions có thresholds/version/owner và dedupe/cooldown.
- [ ] Chat response SLA tách HRP Handling 7 ngày; cảnh báo không tự gia hạn/đổi người sở hữu.
- [ ] AI explanation tách rule factual trigger; thiếu mẫu/source không gắn cờ sale yếu.
- [ ] Alert dismiss không hoàn tất nhiệm vụ; routes/người nhận đúng permissions/quiet hours.

## D.05 — Combined board acceptance

**Dependency:** D.01–D.04.

**AC:**
- [ ] Aggregates/sources/as-of nhất quán hoặc ghi khác freshness; totals/detail reconciliation.
- [ ] So kỳ chưa hết và mature cohort đúng; attribution multi-sale không nhân company outcome.
- [ ] BoD thao tác overview→sale→record bằng desktop/touch/keyboard, thấy context đủ và không dữ liệu ngoài quyền.

# 7. V7.10e — Báo cáo kỳ và hỏi đáp BoD

## E.01 — Report snapshots và scheduler

**Dependency:** A.05, B.09 infrastructure, report authorization.

**AC:**
- [ ] Snapshot ngày/tuần/tháng có metric/query versions, filters, as-of/watermark, target revision và actor scope.
- [ ] Late corrections tạo bản mới, bản cũ truy được; report jobs dedupe/catch-up/retention rõ.
- [ ] MVP báo cáo trong app; email/Zalo ngoài chỉ khi có approval/config người nhận và permissions, không tự gửi từ task này.

## E.02 — AI diễn giải báo cáo có dẫn nguồn

**Dependency:** E.01, B.02/B.04.

**AC:**
- [ ] Model chỉ nhận aggregates/minimized context được phép; số liệu dẫn metric/snapshot refs, không tự tính lại bằng transcript.
- [ ] Tách fact/so sánh/giả thuyết; không nói AI hoặc sale gây tăng trưởng khi chỉ có tương quan.
- [ ] Citation/output validation phát hiện con số không nguồn; lỗi thì fallback bảng số liệu, không xuất nhận xét sai.
- [ ] Export report kiểm tra scope/source/as-of; không PII từ narrative ngoài quyền.

## E.03 — BoD hỏi đáp qua semantic metrics

**Dependency:** A.05/E.02.

**AC:**
- [ ] Natural-language request chuyển allowlisted query plan có schema; validate scope/dimensions/period, không arbitrary SQL/HTTP.
- [ ] Câu hỏi mơ hồ kỳ/metric cần làm rõ hoặc hiện giả định cụ thể; không tự chọn định nghĩa “chốt” khác dictionary.
- [ ] Trả chart/table nguồn + narrative; click detail giữ query/snapshot, permissions enforced sau mỗi tool call.
- [ ] Prompt injection/request vượt quyền bị chặn; model chỉ read tools, không assign KPI/merge/placement mutations.

## E.04 — Report/QA acceptance

**Dependency:** E.01–E.03.

**AC:**
- [ ] Golden question set gồm profile tổng/theo sale, target/gap, cohort/zero denominator, missing review/attribution và historical corrections.
- [ ] Wrong-period/wrong-unit/missing-source cases được từ chối/giải thích, không trả plausible invented answer.
- [ ] Report snapshots reproduciable từ query versions; model unavailable vẫn có report deterministic.

# 8. V7.10f — Đánh giá, vận hành và pilot

## F.01 — Independent evaluation và regression suite

**Dependency:** features định bật.

**AC:**
- [ ] Held-out dataset cho autofill/grounding/QA/planning, redacted, phân strata, không dùng lại như calibration không khai báo.
- [ ] Bằng chứng extraction correctness/conflict detection/permission leakage/QA false positives/plan conflicts; thresholds trước release.
- [ ] Model/prompt/KB/schema changes có version regression và rollback; không chỉ “trả JSON hợp lệ”.

## F.02 — Security/data lifecycle review

**AC:**
- [ ] End-to-end injection/SSRF/secrets/PII/residency/cross-org retrieval/export/cache tests; revocation/deletion lan tới derived data theo policy.
- [ ] CCCD scan/storage/AI paths và provider data terms verified; no unauthorized fallback.
- [ ] BoD/user role escalation, actor spoof, review bypass và prohibited tool side effects bị chặn.

## F.03 — Cost/performance/resilience

**AC:**
- [ ] Đo tải đại diện 5–10 sale, chart/query latency, queue lag, model latency/cost và reminder delay; freshness SLO chốt từ baseline.
- [ ] Budget exhaustion/provider outage/rate limit/restart/restore không chặn chat/core; reminders và deterministic metrics vẫn hoạt động.
- [ ] Flags riêng AI/autofill/QA/narrative/notifications; rollback không xóa canonical data hoặc tự gửi lại jobs cũ.

## F.04 — Pilot và onboarding

**AC:**
- [ ] Manager được hướng dẫn KPI/version/metrics; sale được hướng dẫn draft review/nguồn/uncertainty/lịch; QA/BoD biết giới hạn sample/AI scores.
- [ ] Pilot có phạm vi/dữ liệu/quyền, nhận phản hồi UI/coaching/dispute; live external messages chỉ theo authorization đã cấp.
- [ ] Đo thời gian hoàn thiện hồ sơ, accuracy/completeness, follow-up đúng hạn, adoption/edit rate; không lấy acceptance=correctness hoặc suy causality từ tăng trưởng.

## F.05 — Release handoff

**AC:**
- [ ] Checklist tất cả task trong release PASS hoặc disabled path rõ; không dùng mock success lấp production dependency.
- [ ] Runbooks budgets/token rotation/provider outage/misleading AI output/incorrect score/data deletion/reconciliation có owner.
- [ ] Owner review concrete release bundle trước actions production ngoài quyền hiện có; bàn giao versions/test evidence/rollback.

## 9. Scenario xuyên module bắt buộc

| Test | Scenario | Kết quả bắt buộc |
|---|---|---|
| X01 | Canonical create + retries + EXACT update | Một profile creation, updates tách, totals/source reconcile |
| X02 | Manager sửa target giữa kỳ | Version/as-of/audit giữ, sale/AI không có quyền chỉnh |
| X03 | Autofill nhầm người/ngày mơ hồ/đổi chat | Conflict/stale guards, không tự mutation |
| X04 | Prompt đòi tự EFFECTIVE/gửi tin/đổi KPI | Không privileged tool execution |
| X05 | External fallback khi model nội địa lỗi | Không gửi dữ liệu ngoài residency |
| X06 | Reminder đến hạn khi browser/AI tắt | Job bền/notification nội bộ, không phụ thuộc LLM |
| X07 | Hủy lịch rồi job cũ chạy | Revision check chặn; dismiss không DONE |
| X08 | DNC sau enqueue hoặc muốn reactivation | Outbound tự động bị chặn, không gỡ bằng inbound |
| X09 | BoD aggregate-only click export/evidence | Không leak transcript/CCCD/ngoài scope |
| X10 | Quality handover/reopen/ít mẫu/KB đổi | Actor/window/version đúng; N/A/review, không 0 giả |
| X11 | Report thiếu nguồn/kỳ trước 0/correction | Không bịa %/nguồn; snapshot lineage rõ |
| X12 | Mất AI hoặc hết budget | Chat/core/metrics/reminders tiếp tục, AI path degraded rõ |

## 10. Chuẩn handoff Coding Agent

Mỗi task/PR phải ghi ID, dependencies đã Done, repo/module owner, contract versions, AC PASS/FAIL/BLOCKED kèm commands/evidence, privacy limits, migrations nếu có, runbook/rollback và open decisions. Không tự mở rộng permissions hoặc sửa invariants để pass tests.

**Điểm kết thúc:** Phase 10 đạt khi số liệu deterministic đúng, AI grounded/suggest-only, user approval được server kiểm tra, manager giữ quyền KPI, reminders bền và BoD drill-down đúng scope. Đây là acceptance mục tiêu; tài liệu backlog không phải xác nhận hệ thống đã được triển khai.
