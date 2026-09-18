# G0/0.0 — Inventory nguồn và ownership

Ngày 2026-09-13. T1 là writer. Chỉ inventory và shared contracts G0/0.0–0.2; chưa API/backend.

Nguồn thực: `docs/Importal/Master-Plan.V2.6.md`, `hrp-connector.md`, `Execution-Guide.HRP-Engagement.md` và ba `Implementation-Backlog.*.md` cùng thư mục. Master ưu tiên hơn connector và AC theo guide §1. Connector trên đĩa ghi **v1.0 / Master V2.5**, không phải v1.1 mà guide/backlogs dẫn. Không sửa nguồn baseline để che discrepancy. Nội dung V2.6 (KPI/planning/creation attribution) vẫn là baseline hiện hành.

Trạng thái kiểm chứng: workspace ban đầu chỉ sáu tài liệu `docs/Importal`, không Git/code. Repo chính thức Chủ nhân cung cấp là `https://github.com/nobita6986/HRP-CRM.git`; `git ls-remote` ngày này exit 0, không refs. Git local được khởi tạo branch `main` và origin kết nối đúng repo, chưa có commit/HEAD. Không clone đè docs. Chưa có checkout core HRP, schema/domain, `AGENTS.md`, `AI_CODING_GUARDRAILS.md`, auth specification hoặc endpoint thực để đối chiếu. Không có bằng chứng implementation ở remote; contracts mới tại workspace không làm API thành implemented.

Confirmed là yêu cầu/invariant đã chốt; proposed là thiết kế cần review, unknown là thiếu nguồn. **Mọi mục API dưới đây đều cần xây hoặc xác minh trong HRP-owned PR; không mục nào được đánh dấu API implemented.** Tên capability chưa có chữ ký là tên mô tả, không route đã tồn tại.

## Commands / workflows

Mỗi mục ghi owner → consumer, trạng thái yêu cầu, nguồn và dependency implementation:

- `createOrMatchLaborProfile`: HRP → Integration intake; confirmed cần xây; Master §7.2.1/10.3/10.7, connector §4; P9/H.01–H.02. EXACT/POSSIBLE/NEW là kết quả khác mapping state.
- `updateLaborProfile`: HRP → Integration intake; confirmed cần xây, chữ ký whitelist proposed; Master §7.2.1/10.3, connector §4; P9/H.02.
- `mergeLaborProfiles`: HRP → privileged HRP reviewer; confirmed cần xây, không cấp inbound default; Master §7.2.1, connector §4; P9/H.03.
- `openPlacementCase`: HRP → Integration action đã review / HRP UI; confirmed cần xây; Master §7.2.1/10.6, connector §4; P9/H.04.
- `updatePlacementCase`: HRP → Integration action đã review / HRP UI; confirmed cần xây; cùng nguồn; P9/H.04.
- `closePlacementCase`: HRP → Integration action đã review / HRP UI; proposed command riêng, confirmed CLOSED + 9 reasons; Master §10.6.1, connector §4; P9/H.04 có thể cùng domain service update.
- `recordInteraction`: HRP → Integration Talent / HRP UI; confirmed cần xây; Master §7.2.1, connector §2/4; P9/H.06. Actor tự động unknown.
- `recordClientInteraction`: HRP → Integration Client / HRP UI; confirmed cần xây, context required fields unknown; Master §7.2.1, connector §2/4; P9/H.06.
- `updateNextAction`: HRP → Integration / HRP UI; confirmed cần xây, create/update/transition semantics unknown; Master §7.2.1, connector §4; P9/H.06.
- `updateLaborAvailability`: HRP → Integration action / HRP UI; proposed tên, confirmed availability/DNC semantics; Master §10.6.2/4/5, connector §4; P9/H.05.
- `transactionalOutboxPublisher`: HRP → HRP domain transaction ONLY; confirmed cần xây, proposed signature; Master §7.2.1/9.1, connector §4/7; P9/H.07. Không HTTP command của ACL.
- Outbox claim/ack, delivery reporting: HRP (claim/ack/report API), Integration (durable handoff receipt) → respective dispatcher/consumer; proposed protocol cần xây; Master §9, connector §7; P9/H.07, P9/D.01/D.05. Handoff ACCEPTED khác delivered.
- Submission receive/review/request-changes: HRP → Integration staff/reviewer UI; proposed tương lai, pre/post-apply unknown; Master §10.7, connector §9; HRP-owned review PR sau domain decision, G0/0.3b/0.4.
- Placement EFFECTIVE workflow theo managed mode: HRP → HRP-authorized workflow; confirmed ownership, tên/policy unknown; Master §10.3.3, connector §4; HRP-owned PR riêng. Không integration direct Worker/Beneficiary writes.
- Campaign audience/approve/pause/cancel: HRP → authorized campaign UI/dispatcher; proposed cần xây; Master ADR-BROADCAST-01, connector §4; P9/D.02–D.03.
- KPI assign/revise/correction: HRP-owned module proposed → manager UI; confirmed manager-only targets, chưa canonical module; Master §13.10.3, P10/A.04; P10/A.01 + H.01 và domain sign-off.
- Work-plan commit/reschedule/cancel + reminder preferences: HRP-owned planning module proposed → staff planning UI; Master §13.10.1/7, P10/B.07; reuse NextAction, domain decision cần có. In-app notification snooze/dismiss do notification service, không DONE canonical.
- Routing config/override: Integration → manager UI/router; proposed commands, không HRP Handling/credit writes; Master §10.2, G0/0.5, CORE/1.11, P9/C.07.
- AI config/proposal/autofill: AI orchestration/config service → operator/staff UI; proposed, suggest-only; Master §13.10.2/5/6, G0/0.5, P10/B.01–B.06. Không model domain writes.
- Quality review/dispute/coaching: Analytics review service → authorized QA/staff UI; proposed; Master §13.5, P10/C.01–C.05. Không AI verdict quản trị tự động.

## Queries

- Canonical Talent/Client context by trusted target/mapping: HRP → Integration panel; proposed API cần xây, read-only confirmed; connector §6, P9/H.08.
- Read-only identity preview / Client resolver: HRP → intake preview/reviewer; proposed API cần xây; Master §10.7.2, connector §6; P9/H.02/H.08; không createOrMatch ở preview.
- Command operation/result/submission result: HRP → Integration recovery/staff UI; proposed API cần xây; connector §5/6; P9/H.01/H.08. G0/0.2 chỉ có operation-query schema đi cùng envelope.
- Allowed transitions/capabilities: HRP → panel; proposed API cần xây; connector §6, Master §10.6; P9/H.04/H.08. Không chặn render constants.
- Contactability/authorize-dispatch: HRP → dispatcher; proposed API cần xây, DNC fail closed confirmed; connector §6/7; P9/H.05.
- Facts/outcomes/attribution/baseline/backfill: HRP → Analytics/reconciler; proposed API cần xây; connector §6, Master §13.7/13.10.4; P9/H.08, P10/A.02.
- Submission review state/history: HRP → staff UI/Analytics; proposed, workflow unknown; connector §6/9, Master §10.7; HRP-owned review PR.
- KPI target/revisions and canonical plan/NextAction reads: HRP → staff/manager UI/notification scheduler; proposed modules, chưa APIs; Master §13.10.3/7, P10/A.04/B.07.
- Allowlisted metrics/drill-down/export/report snapshot: Analytics → BoD/team/staff, each scope separate; proposed; Master §13.3/4, P10/A.05–A.07/E.01–E.03.
- Authorized transcript/message evidence: Chatwoot → authorized panel/QA/Copilot; capability/version unknown until real POC; Master §13.5–8, P9/B.01/B.03, P10/B.03/C.02. Không mirror raw transcripts vào HRP.
- Evidence upload/claim/read metadata/authorized retrieval: evidence service nội địa + HRP claim → intake/reviewer; proposed API cần xây; connector §8, Master §10.4; P9/H.02/C.04–C.05. Opaque refs không chứng minh quyền hoặc scan.
- Routing decisions/config/eligibility and unresolved/receipt/DLQ reads: Integration → scoped operator/manager UI; proposed; Master §6/10.2, CORE/1.3/1.7/1.8; không truy core.

## Events

Các canonical events sau owner HRP, consumer Integration projections/reconciler và Analytics khi đủ quyền; tất cả proposed wire names/schema, chưa implementation. Nguồn connector §7, Master §7/10.6/10.7/13.7, dependency P9/H.08 và domain producer tương ứng:

- Profile created/updated (no-op không creation): P9/H.02, P10/A.02; creation credit unknown, submittedBy/executingActor/credit tách biệt.
- Profile/mapping correction, privileged canonical merge: P9/H.03; chỉ confirmed event mới remap, không auto-merge.
- Case updated/closed: P9/H.04; CLOSED/SUCCESS khác EFFECTIVE.
- Availability/contactability changed: P9/H.05/H.07; transaction/freshness/fencing phải implement thật.
- CurrentRelationship projection changed: P9/H.08; read-only derived, precedence unknown.
- NextAction changed: P9/H.06; schedule version khác notification dismissal.
- Outcome/attribution confirmed/corrected: P9/H.08/P10/A.02; source/credit policy chưa chốt.
- Submission reviewed/needs changes: HRP-owned future workflow; chưa enum approved canonical.
- KPI assignment/revision: P10/A.04; manager-owned, target history giữ.
- Planning/reschedule/cancel: P10/B.07; proposed HRP planning events, scheduler consumer.

Other event ownership: HRP outbound intent → Integration durable consumer (P9/H.07/D.01, connector §7); Integration delivery report → HRP reporting consumer (P9/D.05); Chatwoot/OA inbound/message/assignment/resolve/echo/private note → Integration (P9/B.02/C.02–C.03, Master §8). Provider protocol chưa xác minh, không coi body actor/signature giả lập là proof. Routing decisions, notifications và AI/QA proposals là Integration/Analytics-owned derived technical events (Master §10.2/13, P10 tasks), không canonical outcome.

## Storage / gates

Integration được phép DB riêng cho receipts, links, checkpoints, leases, delivery và derived analytics; chỉ scalar canonical references, không cross-DB FK. Database/schema implementation chưa có và không thuộc G0/0.0–0.2. HRP core SoR chỉ HRP domain services/commands; Integration không nhận core DB credentials/import Prisma core. Chatwoot giữ transcript; evidence service nội địa giữ encrypted/private evidence theo gate riêng.

Confirmed constants có tại `packages/contracts/src/enums.ts`; envelope/error/format constraints là proposal version `g0-envelope-0.1`. Domain DTO 0.3+, gateways, provider mocks, CORE và backend chưa triển khai. Chủ nhân phải xác nhận toàn Gate 0 trước backend. Quyết định mở xem `decision-register.md`; AC/evidence xem `g0-0.0-0.2-handoff.md`.

## Trạng thái workspace và bảo toàn thay đổi

Workspace khi Coder chính thức nhận đã có sẵn package `packages/contracts/`
(đã cài node_modules, dist build cũ) cùng hai tài liệu `docs/contracts/{inventory,
decision-register}.md` do agent nội bộ trước viết. Coder KHÔNG xóa, KHÔNG reset;
bảo toàn đầy đủ và đối chiếu với baseline.

`packages/contracts/tests/contracts.synthetic.mjs` (đổi tên từ
`contracts.test.mjs` của agent nội bộ trước) chứa test giả định một API
surface mở rộng, một số yêu cầu mâu thuẫn baseline. File được đổi extension
để không bị runner glob load; lý do chi tiết ở
`packages/contracts/tests/_synthetic-pending.md`. Trạng thái: BLOCKED-OWNER.

---

## Cập nhật 2026-09-13 — G0/0.3a–0.3b đã ghi

Theo Backlog Gate0 §Task 0.3a + 0.3b, các contracts sau đã được thêm vào
`packages/contracts/src/commands/` (chỉ DTO + enums, chưa API/backend):

- **G0/0.3a — Identity & evidence**:
  - `evidence.ts`: `CommandEvidenceRefSchema`, `EvidenceRefListSchema`,
    `EvidenceClaimSchema`, `EVIDENCE_FORBIDDEN_CLIENT_FLAGS`.
  - `identity.ts`: `IdentitySignalSchema`, `IdentityProvenanceSchema`,
    `CreateOrMatchLaborProfileInputSchema`, `MatchingOutcomeResultSchema`
    (3 outcomes: `EXACT_MATCH` / `POSSIBLE_MATCH` / `NEW_PROFILE`),
    `DncActionSchema`.
- **G0/0.3b — Profile completion, staff review, preview**:
  - `profile.ts`: `PROFILE_PATCH_WHITELIST`, `PROFILE_PATCH_FORBIDDEN_FIELDS`,
    `ProfilePatchSchema`, `ProfilePatchSafeSchema`,
    `UpdateLaborProfileInputSchema`, `UpdateLaborProfileResultSchema`.
  - `intake.ts`: `IntakeContextRefSchema`, `BusinessIntentSchema`,
    `CitizenIdentitySchema`, `IntakeSubmissionPayloadSchema`,
    `StaffReviewContextSchema`, `StaffReviewConfirmationSchema`,
    `PreviewResolverRequestSchema`, `PreviewResolverResultSchema`,
    `SUBMISSION_LIFECYCLE` (SUBMITTED / APPLIED / HRP_REVIEWED — proposed),
    `isConfirmationValid()`, `isDncActionValid()`.

Trạng thái AC: xem `docs/contracts/handoff-g0-0.3a-0.3b.md` (sẽ viết khi bàn giao).
Các nguồn mở trong decision-register Q-13..Q-18 đã được annotate trong
contracts (đánh dấu proposed, không tự quyết business rule).

Trạng thái các task chưa bắt đầu (theo Owner chỉ thị, **dừng** sau G0/0.3a–0.3b):

| Backlog task | Trạng thái |
|---|---|
| G0/0.3a | DONE — xem evidence 18 fixtures |
| G0/0.3b | DONE — xem profile-intake fixtures 25 fixtures |
| G0/0.3c–h | chưa bắt đầu — chờ Owner review bundle |
| G0/0.4–0.7 | chưa bắt đầu — sau Gate 0 freeze |
| G0/0.8 | chưa bắt đầu — đợt review Owner |

---

## Cập nhật 2026-09-13 10:30 — G0/0.3c–0.3d đã ghi

Theo Backlog Gate0 §Task 0.3c + 0.3d:

- **G0/0.3c — PlacementCase** (`packages/contracts/src/commands/placement-case.ts`):
  - `OpenPlacementCaseInputSchema` — không đòi caseId (chưa tạo); có
    `intendedStage`, optional `laborProfileId`, `initialAvailability`,
    `availableFromDate`, `confirmationDigest` (SHA-256 hex).
  - `UpdatePlacementCaseInputSchema` — target `placementCaseId` +
    `expectedVersion` + `patch` whitelist.
  - `ClosePlacementCaseInputSchema` — target + `expectedVersion` +
    `closeReason` (9 giá trị CASE_CLOSE_REASONS).
  - `PLACEMENT_CASE_PATCH_WHITELIST` (6 fields), `PATCH_FORBIDDEN`
    (24 fields), strict mode reject currentRelationship/status/closeReason/
    placementCaseId/handling/beneficiary/worker/effectiveness/transcript/
    attachment/rawUrl/arbitraryPatch.
  - Result schemas: `OpenPlacementCaseResultSchema`,
    `UpdatePlacementCaseResultSchema` (APPLIED/NOOP),
    `ClosePlacementCaseResultSchema` (appliedStatus = CLOSED server-owned).
  - `PLACEMENT_CASE_INTENDED_STAGE_ALLOWED` chỉ là gợi ý runtime
    (NEW/CONTACTING/QUALIFYING); schema KHÔNG enum hóa vì G-06 chưa chốt
    open-status set.
- **G0/0.3d — Interactions** (`packages/contracts/src/commands/interactions.ts`):
  - `INTERACTION_KINDS` (5 giá trị) + `INTERACTION_OUTCOMES`
    (5 giá trị, gồm UNKNOWN cho thiếu Client input).
  - `RecordTalentInteractionInputSchema` (gắn LaborProfile canonical),
    `RecordClientInteractionInputSchema` (clientReferenceId opaque).
  - `InteractionContextRefSchema` (HRP_UI vs external provider).
  - `InteractionAssigneeRefSchema` (assignee RIÊNG với actor).
  - `InteractionTimestampsSchema` (occurredAt ≤ effectiveAt ≤ recordedAt).
  - `INTERACTION_PAYLOAD_FORBIDDEN_FIELDS` (14 fields cấm).

Tests: 32 fixtures mới ở `placement-case-interactions.test.mjs`.
Bundle tổng: 137/137 fixtures PASS, typecheck strict PASS.

Trạng thái:
- G0/0.3a–0.3d: DONE self-check (rev 2 + AC đối chiếu), 143/143 fixtures
  PASS, typecheck strict PASS. PENDING independent audit.
- Còn lại G0/0.3e–h, G0/0.4–0.7, G0/0.8: chưa bắt đầu (sau đợt này
  đã xong 0.3e–0.3f).

---

## Cập nhật 2026-09-13 10:48 — G0/0.3e–0.3f đã ghi

Theo Backlog Gate0 §Task 0.3e + 0.3f:

- **G0/0.3e — Availability** (`packages/contracts/src/commands/availability.ts`):
  - `AvailabilityPatchSchema` — whitelist `availability` + `availableFromDate`;
    AVAILABLE_FROM_DATE yêu cầu ngày, khác AVAILABLE_FROM_DATE clear
    availableFromDate; leap year bounds; KHÔNG hardcode clock (Q-15).
  - `UpdateLaborAvailabilityInputSchema` — `laborProfileId` +
    `availability` + `expectedVersion` + `context` + `note` (≤ 500,
    no URL/base64); patch forbid currentRelationship/placementCaseId/
    intendedStage/status/closeReason/handling/createLaborProfile/...
  - `UpdateLaborAvailabilityResultSchema` — `appliedAvailability` +
    `appliedAvailableFromDate` (nullable); `previousAvailability` echo;
    `suppressionEventId` marker cho DO_NOT_CONTACT (transaction với
    suppression event ở runtime).
  - `AVAILABILITY_PATCH_FORBIDDEN` (16 fields) — không auto-create/
    merge LaborProfile; không đổi trục riêng.
- **G0/0.3e — Suppression** (`packages/contracts/src/commands/suppression.ts`):
  - 3 target kinds: `LABOR_PROFILE` (resolvedCanonical: bool),
    `EXTERNAL_CONTACT` (resolvedCanonical: false bắt buộc —
    Master §10.6.5 #4 safety suppression không tự tạo LaborProfile),
    `SUPPRESSED_RECIPIENT_FENCE` (fenceToken + cutOffAt cho
    recipient-level fencing Master #5).
  - `DNC_REASONS` (4 giá trị: CANDIDATE_REQUEST / PRIVACY_REQUEST /
    HRP_POLICY / OTHER).
  - `CommitSuppressionInputSchema` / `CommitSuppressionResultSchema`
    — ghi suppression projection; `fenceToken` + `fenceCutOffAt`
    đi cùng nhau.
  - `DispatchAuthorizationCheckInputSchema` /
    `DispatchAuthorizationCheckResultSchema` — gate AUTHORIZED/
    SUPPRESSED/UNKNOWN; stale cache fail closed (Master #3).
  - `DISPATCH_DENY_REASONS` (6 giá trị: DNC_ACTIVE / DNC_FENCE_EXPIRED
    / HRP_OFFLINE / CACHE_STALE / TARGET_UNRESOLVED / OK).
  - `SUPPRESSION_PATCH_FORBIDDEN` (12 fields) — không removeSuppression/
    optBackIn/forceSend/bypassDnc/ignoreStaleCache/inboundOptOutRemoval/
    autoClearOnInbound/bypassRetrySuppression/dlqRedriveBypass/
    createLaborProfile/mergeLaborProfile/autoMapExternalContact.
- **G0/0.3f — NextAction** (`packages/contracts/src/commands/next-action.ts`):
  - `NEXT_ACTION_KINDS` (CREATE / UPDATE) + `NEXT_ACTION_TARGET_KINDS`
    (PLACEMENT_CASE / CLIENT_OPPORTUNITY / STANDALONE).
  - `NextActionTargetRefSchema` — discriminated union với
    `expectedVersion` cho case/opportunity; CLIENT_OPPORTUNITY
    `clientReferenceId` opaque (Q-23 unresolved).
  - `NextActionScheduleSchema` — ISO 8601 + Asia/Ho_Chi_Minh literal;
    `dueAt >= scheduledAt`.
  - `SnoozeModeSchema` (ACTIVE / SNOOZED / DISMISSED) tách riêng
    status — snooze/dismiss KHÁC DONE (Backlog §0.3f).
  - `CreateNextActionInputSchema` — target + `initialStatus` (OPEN/
    CANCELLED, không DONE) + intentSummary + schedule +
    confirmationDigest; reject URL trong intentSummary.
  - `UpdateNextActionInputSchema` — `actionId` + `expectedVersion`
    + patch whitelist (status/snoozeMode/schedule/intentSummary/revisionId).
  - `NextActionRevisionRefSchema` — `revisionId` + `occurrenceKey`
    cho dedupe reminder (Backlog §0.3f AC).
  - `NEXT_ACTION_PATCH_FORBIDDEN` — không đổi handling/placementCase/
    currentRelationship/actor.
- **G0/0.3f — Scheduling** (`packages/contracts/src/commands/scheduling.ts`):
  - 3 batch item kinds: NEXT_ACTION / AVAILABILITY / SUPPRESSION.
  - `PlanningBatchItemOutcomeSchema` (APPLIED / ACCEPTED / FAILED /
    SKIPPED) — KHÔNG có `ALL_SUCCESS`.
  - `PlanningBatchItemResultSchema` — FAILED phải có error; APPLIED/
    ACCEPTED phải có appliedId.
  - `PlanningBatchSummarySchema` — appliedCount + acceptedCount +
    failedCount + skippedCount = totalItems.
  - `PlanningBatchResultSchema` — KHÔNG có field `allSuccess`; items.
    length = summary.totalItems. AVAILABILITY batch item KHÔNG cho
    DO_NOT_CONTACT (cần suppression.ts).

Tests mới:
- `availability.test.mjs` — 13 fixtures (enums, AVAILABLE_FROM_DATE
  rules, no-clock, leap year, note safe, forbidden).
- `suppression.test.mjs` — 17 fixtures (3 target kinds, safety suppression
  không tạo profile, fencing, dispatch authorization outcomes, no
  bypass).
- `next-action.test.mjs` — 16 fixtures (kind discriminator, OPEN/DONE
  status, snoozeMode tách riêng, schedule timezone, dedupe reminder,
  patch forbidden).
- `scheduling.test.mjs` — 11 fixtures (3 item kinds, per-item outcome,
  KHÔNG có allSuccess, AVAILABILITY không DO_NOT_CONTACT).

Bundle tổng: **200/200 fixtures PASS**, typecheck strict PASS, runtime
≈ 348ms.

Trạng thái:
- G0/0.3a–0.3f: DONE self-check (200/200 fixtures PASS), PENDING
  independent audit, gom bundle Gate 0 trước freeze.
- Còn lại G0/0.3g–h, G0/0.4–0.7, G0/0.8: chưa bắt đầu.

---

## Cập nhật 2026-09-13 11:30 — G0/0.3g–0.3h đã ghi

Theo Backlog Gate0 §Task 0.3g + 0.3h:

- **G0/0.3g — Outbox/Delivery** (`packages/contracts/src/commands/outbox.ts`):
  - Phân biệt 4 tầng: `transactionalOutboxPublisher` (HRP internal tx
    port — `txHandle` opaque, KHÔNG serialize Prisma tx) vs
    `OutboxIntentDraft` (HRP internal) vs `OutboxDeliveryIntent` +
    `OutboxDeliveryReceipt` (handoff DTO) vs `DeliveryReportingEvent`
    (callback).
  - `OUTBOX_DELIVERY_CHANNELS = [PUSH_WEBHOOK, PULL_CLAIM_ACK]`; default
    PUSH_WEBHOOK (đề xuất: ACL không cần DB credentials core; fallback
    PULL_CLAIM_ACK).
  - `OutboxDeliveryReceipt.outcome = 'ACCEPTED'` (chỉ 1 outcome;
    CRM durable accept ≠ sent/delivered).
  - `DELIVERY_REPORTING_STATES = [SENT, DELIVERED, FAILED, UNKNOWN,
    SUPPRESSED]`; `DELIVERY_FAILURE_REASONS` 7 giá trị allowlist.
  - `OutboxClaimLease`/`OutboxClaimAck` (fallback PULL_CLAIM_ACK):
    leaseId + fencingToken + leaseTtlSec + intents[] + receipts[].
  - `OUTBOX_PATCH_FORBIDDEN` (23 fields): `bypassDnc`,
    `dlqRedriveBypass`, `prismaTx`, `cccdNumber`, `fullProfile`, v.v.
- **G0/0.3h — Gateway/Provider/Ports** (3 file):
  - `gateway.ts`: `HRP_GATEWAY_TIERS` (INBOUND_DEFAULT/
    INBOUND_REVIEWER/PRIVILEGED_MERGE), `HRP_GATEWAY_METHODS`
    (17 methods); `HrpGatewayCallContext` superRefine enforce tier +
    provider/connectionId. `WebhookReceiverRequest.rawBody: Uint8Array` +
    raw headers; `WEBHOOK_SIGNATURE_ALGORITHMS = [HMAC_SHA256,
    HMAC_SHA512, ED25519]` (KHÔNG NONE/MD5/SHA1 — chống downgrade).
    `NowProvider` + `FaultHooks` signature port.
  - `providers.ts`: `HRP_PROVIDER_CAPABILITIES` (12 capability),
    `PROVIDER_PAYLOAD_FORBIDDEN` (15 fields — Provider KHÔNG giữ
    policy tuyển dụng per Master §7.1).
  - `ports.ts`: Worker/Scheduler/Queue/Secret/ObjectStorage port
    contracts; `PORTS_FORBIDDEN_IMPORTS` (Prisma/Next.js); Object
    Storage signed URL TTL ≤ 60 sec cho CCCD.

Tests mới:
- `outbox.test.mjs` — 16 fixtures.
- `gateway-providers-ports.test.mjs` — 19 fixtures.

Bundle tổng: **237/237 fixtures PASS**, typecheck strict PASS, runtime
≈ 415ms. PACKAGE_VERSION `0.0.4-g0.3g`.

Trạng thái:
- G0/0.3a–0.3h: DONE self-check (237/237), PENDING independent audit,
  gom bundle Gate 0 trước freeze.
- Còn lại G0/0.4–0.7, G0/0.8: chưa bắt đầu.

---

## Cập nhật 2026-09-13 11:55 — G0/0.4 đã ghi

Theo Backlog Gate0 §Task 0.4:

- **G0/0.4 — Queries** (`packages/contracts/src/commands/queries.ts`):
  - `CursorPaginationInput` / `CursorPaginationOutput` — pageSize
    1..200, default 20; opaque cursor.
  - `QueryScope` — organizationId + actor + asOfVersion + provider/
    connectionId optional.
  - `ContextQueryRequest` — phải có target HOẶC external.
  - `ContextPanelResult` (10 fields optional theo allowlist): identity
    summary (displayOnly=true), placementCase (CLOSED+closeReason
    invariant Q-20), availability (+ contactabilityVersion freshness
    marker), currentRelationship (readonly=true BẮT BUỘC), nextAction
    (status + snoozeMode tách riêng Q-27), recentInteractions
    (summaryRedacted URL/base64 reject), contactability (UNKNOWN =
    fail closed), suppressionSummary (fenceCutOffAt optional),
    unavailableFields marker.
  - `ReadOnlyIdentityPreviewRequest/Result` — signals KHÔNG ép NEW.
  - `AllowedActionsQuery` — tier + privileged marker (privilege tách
    riêng inbound default).
  - `ContactabilityCheck` — AUTHORIZED/SUPPRESSED/UNKNOWN;
    fenceToken + fenceCutOffAt.
  - `ConstantsSnapshot` — enum package + label tables đầy đủ; UI/dev
    KHÔNG phụ thuộc dictionary API (Backlog §0.4 AC #1).
  - `QUERIES_PATCH_FORBIDDEN` (15 fields) — marker audit.
- **G0/0.4 — Events** (`packages/contracts/src/commands/events.ts`):
  - `EVENT_AGGREGATE_TYPES` (10 giá trị allowlist).
  - `EventEnvelope` — organizationId + eventId + aggregateType/id/
    version + occurredAt + recordedAt + correlationId + sourceCommandId
    + sourceSystem (5 giá trị) + deliveryChannel (PUSH_WEBHOOK default)
    + deliveryScope + isCorrection + watermark.
  - `EventDuplicateKind` (5 giá trị: DEDUPE/OUT_OF_ORDER/CORRECTION/
    GAP/UNKNOWN); `EventReceipt` payloadDigest SHA-256 hex 64 + reason
    rule per kind.
  - `CreationActorAttribution` — 4 trường PHÂN BIỆT
    (submittedBy/executingActor/creditedCreator/source); thiếu trả
    `UNAVAILABLE` + `unavailableReasonCode` (KHÔNG đoán).
  - `CreationEventLabel` (SUBMITTED / APPLIED / HRP_REVIEWED) — 3 label
    tách biệt (Q-16 marker).
  - `ProfileCreationEvent` / `PlacementCaseCreationEvent`.
  - `EVENT_PATCH_FORBIDDEN` (20 fields) — bao gồm
    `useUnverifiedSignatureProtocol` / `useUnverifiedJwtAlgorithm` /
    `useUnverifiedWebhookAlgorithm` (Owner rev 2: signature provider
    protocol chưa xác minh).
- **G0/0.4 — Mappings** (`packages/contracts/src/commands/mappings.ts`):
  - `ExternalContactRef` — provider + connection + external refs
    (account/inbox/conversation/contact/message opaque).
  - `EXTERNAL_CONTACT_LINK_STATES = [EXACT_MATCH, POSSIBLE_MATCH,
    UNRESOLVED]` (KHÔNG có NEW_PROFILE — đó là command result).
  - `ExternalContactLinkTarget` — discriminated union Talent/Client.
  - `TalentTargetRef` / `ClientTargetRef` / `CanonicalTargetRef` —
    Client branch marker PROPOSED (Q-23); schema KHÔNG ép về Talent.
  - `ExternalContactLink` superRefine: EXACT_MATCH có matchedTarget;
    POSSIBLE_MATCH có candidateReference (KHÔNG matchedTarget);
    UNRESOLVED KHÔNG có cả hai.
  - `ConversationLink` — externalRefs[] (min 1, max 64) + currentRevision
    + historyRevisions (max 64, note KHÔNG URL/base64) + primaryTarget
    optional; mutation target lấy canonical conversationId, KHÔNG từ
    Chatwoot/Zalo raw attribute.
  - `ResolveContactByExternalRequest/Result`, `ListExternalContactLinks`
    (pageSize ≤ 100).
  - `MAPPING_PATCH_FORBIDDEN` (22 fields) — bao gồm
    `useChatwootAttributesAsCanonical` / `collapseClientToTalent` /
    `autoMerge` / `forceUnresolvedToExact` / `writeBackToChatwootAttributes`.

Tests mới:
- `queries-events-mappings.test.mjs` — 43 fixtures.

Bundle tổng: **280/280 fixtures PASS**, typecheck strict PASS, runtime
≈ 470ms. PACKAGE_VERSION `0.0.5-g0.4`.

Trạng thái:
- G0/0.3a–0.4: DONE self-check (280/280), PENDING independent audit,
  gom bundle Gate 0 trước freeze.
- Còn lại G0/0.5–0.7, G0/0.8: chưa bắt đầu (Owner xác nhận Gate 0
  trước khi sang V7.9a).

Đối chiếu connector v1.1 (HEAD `414c54b`) theo chỉ thị Owner rev 2:
- ClientCompany đã có schema HRP (connector §0 bảng "Có trong source
  HRP"). T1 ghi marker PROPOSED cho field chưa chốt; chỉ các
  model/capability Client còn thiếu (ClientContact/SalesOpportunity/
  ClientInteraction) mới ghi chưa có (Q-23 unresolved/proposed).
- Marker/forbidden-list không tự chứng minh AC được enforce (Q-30):
  schema bind shape + audit marker; runtime HRP gate enforce qua
  code review + lint + integration test.
- Push/claim-ack đề xuất PUSH_WEBHOOK default (Q-31); runtime HRP
  gate chọn đường mặc định; KHÔNG xử lý cùng intent qua 2 channel
  thiếu authority/dedupe.
- Batch ACCEPTED cần pending operation reference/query semantics
  (Q-32): schema bind `pendingId` opaque; PROPOSED chốt format = canonical
  OperationReference (`envelopes.ts` OperationReferenceSchema) + query
  API contract ở backend Phase V7.9a.
- Signature provider protocol chưa xác minh (Q-33): KHÔNG tự chọn;
  `EVENT_PATCH_FORBIDDEN` marker audit.

---

## Cập nhật 2026-09-13 12:25 — G0/0.5 đã ghi

Theo Backlog Gate0 §Task 0.5:

- **G0/0.5 — Routing** (`packages/contracts/src/commands/routing.ts`):
  - `ROUTING_STRATEGIES = [SOURCE_ALLOCATION, WEIGHTED_DISTRIBUTION,
    HYBRID]`. Phân biệt rõ — schema reject nếu strategy không khớp.
  - `RoutingPoolSchema`: SOURCE_ALLOCATION yêu cầu `fixedOwner` +
    KHÔNG weights; WEIGHTED_DISTRIBUTION yêu cầu `weights ≥ 1` +
    KHÔNG fixedOwner; HYBRID yêu cầu cả hai; total weight > 0.
  - `RoutingEligibleSet`: roles/regions/providers/capacityGate.
  - `RoutingWeightEntry`: weight + cap + capPeriod (DAILY/WEEKLY/
    MONTHLY).
  - `RoutingDecision` (audit): selectionReason (FIXED_OWNER/
    WEIGHTED_PICK/HYBRID_RULE) + reservation fence.
  - `RoutingReservation`: fenceToken + fenceCutOffAt.
  - `UpdateRoutingPoolInput`: optimistic concurrency +
    `updatedBy: ActorSchema` (manager marker).
  - `ROUTING_PATCH_FORBIDDEN` — marker audit (Q-30).
- **G0/0.5 — Analytics** (`packages/contracts/src/commands/analytics.ts`):
  - `METRIC_GRAINS` (ACTOR/TEAM/COHORT/ORGANIZATION/CONVERSATION/
    TARGET), `METRIC_UNITS` (COUNT/RATE/DURATION_MS/USD_MICRO/
    CURRENCY_VND/RATIO), `METRIC_PERIODS` (DAILY/WEEKLY/MONTHLY/
    QUARTERLY).
  - `MetricAttributionState` = AVAILABLE/UNAVAILABLE — UNAVAILABLE
    yêu cầu reasonCode (Q-30 thiếu nguồn KHÔNG đoán).
  - `MetricDefinitionInput/Schema`: shape + version + asOf.
  - `ProfileLifecycleMetricBinding`: 3 metricId `profile.created`/
    `profile.updated`/`profile.submitted` PHẢI khác nhau (Q-9) —
    schema superRefine reject nếu trùng.
  - `MetricValue`: UNAVAILABLE value phải = 0 (placeholder; KHÔNG
    đoán số).
  - `MetricAggregateRead`: cursor + periodStart <= periodEnd.
  - `ANALYTICS_PATCH_FORBIDDEN` — marker audit.
- **G0/0.5 — KPI** (`packages/contracts/src/commands/kpi.ts`):
  - `KPI_TARGET_TYPES` (PROFILE_CREATED/UPDATED/SUBMITTED +
    CASE_OPENED/CLOSED + INTERACTIONS_LOGGED + CONVERSATIONS_*
    + ASSIGNMENTS_COMPLETED) — schema enum allowlist.
  - `KPIAssignmentInput`: cohort periodStart/End + attributionSource.
  - `KPIRevision`: manager capability (marker); expectedRevision
    optimistic concurrency.
  - `KPIPropose`: sale/AI propose-only; schema strict reject field
    `mutateTarget`; rationale no URL/base64.
  - `KPIReadResult`: attribution AVAILABLE/UNAVAILABLE — UNAVAILABLE
    yêu cầu reasonCode (Q-30).
  - `KPI_MODULE_NAMESPACE = 'phase10-experimental'` — schema literal;
    reject canonical-ready.
  - `KPI_PATCH_FORBIDDEN` — marker audit.
- **G0/0.5 — AI Proposals** (`packages/contracts/src/commands/ai-proposals.ts`):
  - `AI_PROPOSAL_KINDS` (AUTOFILL/SUGGESTED_ACTION/SUMMARY/
    DRAFT_REPLY/SCORE) — schema enum allowlist.
  - `AIProposalField`: fieldPath + proposedValue/currentValue +
    evidenceRefs (opaque) + rationale (reject URL/base64).
  - `AIProposalUncertainty`: confidence [0,1] + reasonCodes +
    fieldBreakdown optional.
  - `AIProposalContext`: organizationId + targetCanonicalId +
    conversationId + operationId.
  - `AIProposalSchema`: schema strict reject `commandPayload`/
    `embedCommandPayload`/... (Backlog §0.5 AC #4).
  - `ApplyAIProposalInput`: proposalId + revisionId +
    acceptedFieldPaths[] + expectedTargetVersion.
  - `ApplyAIProposalResult`: per-field outcome APPLIED/REJECTED/SKIPPED
    + appliedVersion + reasonCode (audit).
  - `AI_PROPOSAL_PATCH_FORBIDDEN` — marker audit.
- **G0/0.5 — AI Provider Config** (`packages/contracts/src/commands/ai-provider-config.ts`):
  - `AI_PROVIDER_API_STYLES` (RESPONSES/CHAT_COMPLETIONS/CUSTOM).
  - `AI_PROVIDER_CAPABILITIES` (CHAT/EMBEDDINGS/FUNCTION_CALLING/
    STRUCTURED_OUTPUT/STREAMING/VISION/TOOLS/FILE_REFERENCES).
  - `AI_PROVIDER_DATA_POLICIES` (NO_PII/PII_REDACTED/INTERNAL_ONLY/
    SANDBOX).
  - `SecretRefSchema`: opaque secretId + secretVersion + tier
    (PLATFORM/TENANT/OPERATOR); schema strict reject rawSecret.
  - `AIProviderBudgetSchema`: maxRequestsPerDay + maxTokensPerDay +
    maxCostPerDayUsdMicro (≥ 0; 0 = disabled).
  - `AIProviderConfigWriteSchema`: baseUrl + model + apiStyle +
    secretRef + capabilities + budget + dataPolicy.
  - `AIProviderConfigReadSchema`: schema strict reject apiKey/
    accessKey/bearerToken/authorization/openaiApiKey/rawSecret/token/
    password (Backlog §0.5 AC #5).
  - `dataPolicy` semantics: SANDBOX + INTERNAL_ONLY xung đột;
    NO_PII + PII_REDACTED xung đột — schema reject.
  - `AI_PROVIDER_FORBIDDEN_RAW_SECRET_FIELDS` — marker audit.
- **G0/0.5 — Đóng Q-32 (ACCEPTED contract bind)**:
  `PlanningBatchItemResultSchema.pendingReference: OperationReferenceSchema`
  (canonical `{ kind: 'COMMAND_OPERATION', operationId: CommandIdSchema }`).
  Schema reject field cũ `pendingId: z.string()` opaque. Caller có
  thể dùng `envelopes.ts OperationQuerySchema` với operationId để
  poll result; implementation query API runtime để Phase V7.9a
  backend (HRP-owned).

Tests mới:
- `routing-analytics-kpi-ai.test.mjs` — 33 fixtures.

Bundle tổng: **313/313 fixtures PASS**, typecheck strict PASS,
runtime ≈ 545ms. PACKAGE_VERSION `0.0.6-g0.5`.

Trạng thái:
- G0/0.3a–0.5: DONE self-check (313/313), PENDING independent audit,
  gom bundle Gate 0 trước freeze.
- Còn lại G0/0.6, G0/0.7, G0/0.8: chưa bắt đầu.

Đối chiếu Owner chỉ thị (Q-32/Q-30/Q-29/Q-31/Q-33):
- **Q-32 (đóng)**: contract ACCEPTED bind canonical OperationReference;
  implementation query API để Phase V7.9a.
- **Q-30 (nguyên tắc)**: schema validation AC enforce; marker chỉ audit;
  runtime gate HRP-owned. Phân biệt rõ trong từng file.
- **Q-29**: ClientCompany đã có schema HRP; field bindings PROPOSED.
- **Q-31**: transport (PUSH_WEBHOOK default) đề xuất kỹ thuật có lý do.
- **Q-33**: protocol chưa xác minh — KHÔNG biến thành câu hỏi nghiệp
  vụ chung; `EVENT_PATCH_FORBIDDEN` marker audit.

---

## Cập nhật 2026-09-13 12:35 — G0/0.6 đã ghi

Theo Backlog Gate0 §Task 0.6: permission/error/policy boundary matrix.

- **Output**: `docs/contracts/authorization-policy-matrix.md` (file mới,
  330 dòng).
- **Dependency**: 0.3–0.5 (đã DONE self-check 313/313 fixtures).
- **Nội dung matrix**:
  - §0 Nguyên tắc & giới hạn (schema vs runtime gate; BoD; secret
    operator; Q-33 signature).
  - §1 Cột matrix (9 cột theo Backlog §0.6 AC #1).
  - §2 Retry class mapping theo `errors.ts` taxonomy (10 ErrorCode
    ↔ 6 RetryClass).
  - §3 Matrix Commands: 18 dòng (17 `HRP_GATEWAY_METHODS` + planning
    batch multi-item — Q-32).
  - §4 Matrix Queries 0.4: 7 dòng (ContextQuery /
    ReadOnlyIdentityPreview / AllowedActionsQuery / ContactabilityCheck /
    ConstantsSnapshot / ResolveContactByExternal /
    ListExternalContactLinks).
  - §5 Matrix Events 0.4: 5 dòng (EventEnvelope / EventReceipt /
    ProfileCreationEvent / PlacementCaseCreationEvent /
    DeliveryReportingEvent).
  - §6 Matrix Mapping DTOs 0.4: 2 dòng (ExternalContactLink /
    ConversationLink).
  - §7 Matrix Routing/Analytics/KPI/AI 0.5: 12 dòng.
  - §8 Matrix Ports/Provider/Gateway 0.3h: 12 dòng (Worker/Scheduler/
    Queue/Secret/ObjectStorage + WebhookReceiver/ProviderConnectionRef/
    Chatwoot/Zalo normalized/ProviderProbe + HrpGatewayCallContext).
  - §9 Audit requirements — trục riêng (effectiveAt/recordedAt/actor/
    source/target/command/version/result + Q-32 OperationReference).
  - §10 Runtime gate (PROPOSED — HRP-owned) — capability check,
    principal binding, organizationId scope, one-active-case, merge
    approval, CCCD residency, HRP review, signature/JWT/webhook
    algorithm Q-33, idempotency retention, fencing, DNC cut-off.
  - §11 BoD aggregate & secret operator (Backlog §0.6 AC #3) — metric
    bind shape count/rate/duration/currency; SecretPort.get handle
    theo tier.
  - §12 Cross-reference Q-1..Q-37 — Q còn open giữ PROPOSED; KHÔNG tự
    biến thành CONFIRMED.
  - §13 Kết luận — không tự PASS matrix = freeze Gate 0.
  - §14 Audit & bàn giao.
- **KHÔNG sửa shared contracts** (routing/analytics/kpi/ai-* vừa đóng
  ở 0.5); KHÔNG sửa decision-register.md (Owner ràng buộc); KHÔNG mở
  Q mới.
- **Self-check**: 313/313 fixtures PASS, typecheck strict PASS (matrix
  là markdown, không build). Hash file:
  `134A0E879F1E21C2DE5B5F8AB067AAB9FD8B2DCC3BAE505D9AA2177C07E50EB5`.

Trạng thái:
- G0/0.3a–0.6: DONE self-check (313/313 fixtures + matrix), PENDING
  independent audit, gom bundle Gate 0 trước freeze.
- Còn lại G0/0.7, G0/0.8: chưa bắt đầu.

---

## Cập nhật 2026-09-13 13:00 — G0/0.7 đã ghi

Theo Backlog Gate0 §Task 0.7: shared fixtures, package validation, versioning.

- **Output**: 1 file test mới + README viết lại + CHANGELOG.md + PACKAGE_VERSION bump.
- **Dependency**: 0.3a–0.6 (DONE self-check 313/313 fixtures; matrix markdown PASS).
- **Nội dung**:
  - `tests/fixtures-coverage-0.7.test.mjs` — 59 fixtures mới cover Backlog §0.7 AC:
    - §1: 3 match outcomes (EXACT/POSSIBLE/NEW).
    - §2: CLOSED + 9 closeReason.
    - §3: Date condition (AVAILABLE_FROM_DATE future + leap year Feb 29 2028).
    - §4: Read-only CurrentRelationship (mutation reject).
    - §5: Malformed envelopes (actor/source/version qua RequestEnvelopeBaseSchema).
    - §6: Evidence URL/base64 reject, raw transcript reject, summary URL reject.
    - §7: No-op update (UpdateLaborProfile NOOP/APPLIED; batch APPLIED/SKIPPED/FAILED/ACCEPTED).
    - §8: Retry errors (IDEMPOTENCY_CONFLICT NEVER, VERSION_CONFLICT REFRESH_AND_REVIEW); SHA-256 hex digest; OperationReference canonical (Q-32).
    - §9: Cross-aggregate leak (RecordTalentInteraction / RecordClientInteraction / ExternalContactLink matchedTarget TALENT / ConversationLink historyRevisions + currentRevision + updatedAt).
    - §10: EventEnvelope + ProfileCreationEvent (Q-16 attribution 4 fields).
    - §11: MetricDefinition 3 lifecycle metricId (Q-9) + MetricValue UNAVAILABLE (Q-30) + AIProviderConfigRead (Q-36).
    - §12: ContactabilityCheckRequest shape required (Q-26).
    - §13: Forbidden marker exports consistency (PLACEMENT_CASE_PATCH_FORBIDDEN, MAPPING_PATCH_FORBIDDEN).
    - §14: Q-32 pendingReference canonical (ACCEPTED có reference, APPLIED/FAILED/SKIPPED KHÔNG).
  - `packages/contracts/README.md` — viết lại theo 0.3a–0.7 public surface; status, scripts, compatibility policy, không Prisma/migration/route handler/secrets/PII/runtime auth/cross-aggregate leak.
  - `packages/contracts/CHANGELOG.md` — version bumps 0.0–0.7; breaking change Q-32 (pendingId → pendingReference ở 0.5); compatibility policy cho consumer pin (^0.0.x hoặc exact).
  - `packages/contracts/src/index.ts` — `PACKAGE_VERSION` bump `0.0.6-g0.5` → `0.0.7-g0.7`.
  - `packages/contracts/package.json` — `version` bump `0.0.1-g0.1` → `0.0.7-g0.7`.
- **KHÔNG sửa shared contracts** (đã đóng 0.1–0.6); KHÔNG sửa matrix (đã đóng 0.6); KHÔNG mở Q mới trong decision-register.md (0.7 không phát hiện mismatch bắt buộc).
- **Test runner KHÔNG đổi** (Node `--test` + Zod runtime); KHÔNG thêm dep mới (zod 3.24.2 + typescript 5.7.3 đủ).
- **Self-check**: **372/372 fixtures PASS** (313 + 59), typecheck strict PASS, runtime ~576ms.
- **Hash file mới**:
  - `BB50A62712DA78877E86FB370A3824332D259015AF0741C5E68299D615C8291F  packages/contracts/tests/fixtures-coverage-0.7.test.mjs`
  - `B08A271AC1085344E82CC2D8060F0C2BE2AEB556D30D2720EB33A35E1AE3D5AC  packages/contracts/README.md`
  - `B8DC89064AEF8A5D392D2522B25BA7ED3785A080103BAF504FACECAA4180D957  packages/contracts/CHANGELOG.md`
  - `B6446FE924E5502631414C72144434FCBA93FA324A3C245A070470CBE10F5E55  packages/contracts/src/index.ts`
  - `4DFC386FCA0BCF0D96737ED98C68C8916159524C838DBEC3D64440F72F4EAE7E  packages/contracts/package.json`
- **Bổ sung hình thức 0.6 song song**:
  - `735FA72F999706A1A4C622B8659365FFAF210CFC3633C4CC6498B3A21BBB020A  docs/contracts/handoff-g0-0.6.md`
  - `0D9D6B72608C953CE98582FEE5EBC0D69BF3164BCB40A9DE625D6438FCA9D188  docs/contracts/handoff-g0-0.6.manifest.txt` (manifest updated sau khi viết handoff 0.6; final hash `7F7851030BE68EDD1C3E6832958C2DC0A00EB97AE4A2790CEFCDE761A34551D6`)

Trạng thái:
- G0/0.3a–0.7: DONE self-check (**372/372 fixtures** + matrix + README + CHANGELOG), PENDING independent audit, gom bundle Gate 0 trước freeze.
- Còn lại G0/0.8: chưa bắt đầu.

Đối chiếu Owner chỉ thị (0.7):
- 0.7 cover đủ Backlog §0.7 AC: 3 match outcomes, CLOSED + 9 closeReason, date condition (AVAILABLE_FROM_DATE future + leap year), read-only CurrentRelationship (mutation reject), malformed envelopes (actor/source/version), evidence URL/base64 reject, raw transcript reject, no-op update, retry errors (IDEMPOTENCY_CONFLICT, VERSION_CONFLICT), cross-aggregate leak.
- README + CHANGELOG ghi version bumps 0.0–0.7; consumer pin policy (^0.0.x hoặc exact).
- Test runner KHÔNG đổi; KHÔNG thêm dep mới không có lý do.
- KHÔNG dùng schema pass làm bằng chứng policy runtime (Q-30 nguyên tắc) — phân biệt rõ schema validation AC vs runtime gate PROPOSED HRP-owned.
- KHÔNG tự coi "0.7 PASS" = freeze Gate 0; Owner xác nhận Gate 0 trước backend.
- KHÔNG thay schema contracts đã đóng 0.1–0.6; KHÔNG build backend/Prisma/migration/route handler.

## Cập nhật 2026-09-13 14:30 — G0/0.8 đã ghi

Theo Backlog Gate0 §Task 0.8: Gate 0 REVIEW BUNDLE + FREEZE.

- **Output**: 3 file mới + 2 file sửa (Owner review doc-only).
- **Dependency**: 0.3a–0.7 DONE self-check (372/372 fixtures PASS); matrix markdown PASS (48 dòng). Chưa có independent audit PASS; bundle ở trạng thái `READY FOR INDEPENDENT AUDIT`.
- **Nội dung**:
  - `docs/reviews/gate-0-checklist.md` — checklist chính 0.8 gồm:
    - §1 Scope & authority (Head 414c54b, bundle 0.3a–0.7 + matrix + fixtures + README + CHANGELOG, Auditor verdict, Master V2.6 + connector v1.1 + Backlog G0 + Execution Guide authority).
    - §2 Command-by-command review table (AC1): 23 section phủ 23 file `packages/contracts/src/commands/*.ts` + 1 section phụ envelopes/errors/primitives/enums; mỗi section có bảng 7 cột (Command/Query | Fields | Result | Permission (tier) | Invariants | Error/Retry | Files + matrix ref).
    - §3 Phase 9 CONFIRMED vs Phase 10 PROPOSED (AC2): bảng G0-01..G0-11 + Q-13..Q-37 với Status/Phase/Áp lên bundle/Notes; §3.1 liệt kê Phase 10 module disable rõ (`kpi.ts` `phase10-experimental` Q-35; `analytics.ts` `EXPERIMENTAL → UNAVAILABLE` Q-9; `ai-proposals.ts` strict reject `commandPayload`/`embedCommandPayload` Q-37).
    - §4 Out-of-scope verification (AC3): working tree KHÔNG có `prisma/`, `app/api`, `apps/`, `packages/integration-store/`, Route Handler, `migration/`, `src/backend`, `src/server`; `packages/contracts/package.json` chỉ có `zod@3.24.2` + `typescript@5.7.3`; §4.3 liệt kê 3 file mới + 2 file sửa.
    - §5 Owner sign-off (AC4): bảng để trống; tuyên bố "Gate 0 chưa FREEZE cho đến khi Owner chính thức xác nhận; mọi implementation phụ thuộc (1.0–1.15) phải chờ"; §5.3 liệt kê 9 downstream items chờ HRP-owned PR.
    - §6 Manifests & hashes: SHA-256 của 22 file (decision-register, inventory, matrix, 7 handoff + manifest, README, CHANGELOG, package.json, tsconfig.json); self-reference KHÔNG tự ghi.
    - §7 Limits & known open: 7 risks (Q-33 signature, Q-32 runtime query API, Q-34 HYBRID policy, Q-37 dual-control AI, Q-19 Placement transitions, Q-23 Client domain, OrgScope Q-1 + G0-11).
    - §8 Sign-off statement: Gate 0 hiện ở trạng thái `READY FOR INDEPENDENT AUDIT`; Owner có 2 lựa chọn (audit trước FREEZE hoặc sign-off điều kiện); T1 KHÔNG tự commit.
  - `docs/contracts/handoff-g0-0.8.md` — theo mẫu handoff 0.3a–0.7; Head 414c54b, package version `0.0.7-g0.7` (không bump).
  - `docs/contracts/handoff-g0-0.8.manifest.txt` — SHA-256 của 3 file mới + 2 file sửa; self-reference KHÔNG tự ghi.
- **Sửa (Owner review doc-only)**:
  - `packages/contracts/CHANGELOG.md` dòng 19 (§Changed G0/0.7): `(+46 test)` → `(+59 test)`. Tổng 372 đã đúng; chỉ delta sai.
  - `docs/contracts/handoff-g0-0.6.md` dòng 21 (AC #1 evidence): `56 dòng cho 23 file contracts` → `54 dòng cho 23 file contracts`.
- **KHÔNG sửa shared contracts / schema / fixture / matrix / inventory-cũ / package.json / tsconfig.json / decision-register / src/index.ts / README** (ràng buộc cứng).
- **KHÔNG mở Q mới** ngoài Q-1..Q-37 hiện có.
- **Self-check**: `npm run typecheck` PASS; `npm test` 372/372 PASS (duration 562.6ms); `git status --porcelain` không có tracked modified; untracked mới đúng 3 file (checklist + handoff 0.8 + manifest 0.8); working tree không có file ngoài docs/ + packages/contracts/ + .gitignore + .npm-cache/.
- **Hash file mới + sửa đợt 0.8**:
  - `83B7B704B8601EB41BB5FC5DA4DDA996A1BBF6B90B1251E2FAE1ED4CA0CA39E1  docs/reviews/gate-0-checklist.md`
  - `2EFEDC0842CA98B82C853E1F31224ACD51B3657EF18D66998D136DB9D6F7A13B  docs/contracts/handoff-g0-0.8.md`
  - `BB760320C85749E832C8E43AAB9C198F2508E02653F01138B85999B084873044  docs/contracts/handoff-g0-0.8.manifest.txt`
  - `110D328906E66685FFD5D3F47370623043EB85B0FC06173B819917930CEC0B91  packages/contracts/CHANGELOG.md` (đã sửa +46 → +59)
  - `7EDE33E02168574693201A21E3FC9517BD598EEE360FF0272727F57132F3CB6E  docs/contracts/handoff-g0-0.6.md` (đã sửa "56 dòng" → "54 dòng")

Trạng thái:
- G0/0.3a–0.8: DONE self-check (372/372 fixtures + matrix + README + CHANGELOG + Gate 0 checklist + handoff 0.8 + manifest 0.8), PENDING Owner sign-off cuối để FREEZE.
- Chưa có independent audit PASS (Auditor độc lập) — bundle ở trạng thái `READY FOR INDEPENDENT AUDIT`. Owner có 2 lựa chọn: (1) yêu cầu audit trước FREEZE, hoặc (2) sign-off điều kiện + commit/tag `Gate 0 FREEZE` + ghi CHECKPOINT.
- **V7.9a Task 1.0–1.15 chưa triển khai** — chờ Owner sign-off Gate 0.

Đối chiếu Owner chốt thêm (0.8):
- Checklist §2 (AC1) đủ 23 section command/query + 1 section phụ envelopes/errors/primitives/enums; mỗi section có bảng 7 cột theo task instruction.
- Checklist §3 (AC2) Phase 9 CONFIRMED vs Phase 10 PROPOSED rõ; Phase 10 module disable ghi marker (`kpi.ts phase10-experimental`, `analytics.ts EXPERIMENTAL → UNAVAILABLE`, `ai-proposals.ts strict reject commandPayload/embedCommandPayload`).
- Checklist §4 (AC3) working tree + package.json verify KHÔNG có Prisma/Route Handler/backend; KHÔNG có deps framework HTTP/SSR/ORM.
- Checklist §5 (AC4) Owner sign-off để trống; 9 downstream items chờ HRP-owned PR (V7.9a 1.0–1.15, Q-19/33/34/37/23, Q-32 runtime API, Phase 10, OrgScope).
- 2 sửa văn bản (a) (b) đã áp dụng đúng Owner instruction; không sửa file khác ngoài 2 mục đó.
- KHÔNG tự commit git; KHÔNG tự stamp CHECKPOINT FREEZE; KHÔNG sang V7.9a 1.0–1.15.


## Cập nhật 2026-09-13 19:00 — G0/0.8-fixes (F1–F5) đã ghi

Theo Auditor báo cáo: 5 finding cần khắc phục Gate 0 (không mở
backend/feature mới).

- **Status**: `CHANGES_REQUIRED` — T1 đã áp dụng đủ 5 fix; chờ verdict mới
  từ independent Auditor sau đợt F1–F5.
- **Fix status**:
  - **F1** Merge/Review contracts: FIXED. Tạo `src/commands/merge-review.ts`
    với placeholder schema `MergeLaborProfilesInputSchema`,
    `CommitReviewDecisionInputSchema`, `ResolvePossibleMatchInputSchema`,
    `SupersedeReviewStatusInputSchema` — tất cả dùng `ProposedUnavailableMarkerSchema`
    (proposedUnavailable: true + auditRef Q-19/Q-23/Q-37). Matrix rows 3/15/16/17
    cập nhật sang `PROPOSED/UNAVAILABLE placeholder`.
  - **F2** HRP_UI gateway context: FIXED. `IntakeContextRefSchema` và
    `InteractionContextRefSchema` dùng `CommandSourceSchema` discriminator.
    HRP_UI không cần connectionId; INTEGRATION yêu cầu provider+connectionId
    hợp lệ; tests cho cả 3 cases (HRP_UI valid, integration thiếu connection,
    conflict source/context). Helper `src()/ext()` trong
    `tests/test-helpers.mjs` để migrate fixtures.
  - **F3** Calendar dates reuse: FIXED. `CalendarDateSchema` dùng cho `dob`
    (identity, intake), `availableFromDate` (scheduling batch),
    `periodStart`/`periodEnd` (KPI). Tests cover leap year + invalid date
    (không thêm business clock policy mới).
  - **F4** DNC reasons canonical: FIXED. Tạo `src/commands/dnc.ts` với
    `DncReasonSchema` (canonical 4 giá trị: CANDIDATE_REQUEST,
    PRIVACY_REQUEST, HRP_POLICY, OTHER) + `LegacyDncReasonSchema` (3 giá trị
    legacy bao gồm PRIVACY) + `DncReasonAcceptAliasSchema` (union) +
    `normalizeDncReason` helper. Identity `DncActionSchema.reason` dùng
    alias schema; suppression import canonical. Authorization vẫn runtime gate
    (HRP_POLICY membership không tự cấp authority).
  - **F5** AI evidence refs reuse: FIXED. `ai-proposals.ts` dùng
    `CommandEvidenceRefSchema` (từ `evidence.ts`) cho `evidenceRefs` trong
    `AIProposalSchema` và `AIProposalFieldSchema`; bỏ inline shape.
- **File mới (5)**: `src/commands/dnc.ts` (F4), `src/commands/merge-review.ts`
  (F1), `tests/test-helpers.mjs` (F2), `tests/fixtures-fix-f1-f5.test.mjs`
  (F1–F5 coverage).
- **File sửa (12 src + 7 tests + 3 docs)**: identity/intake/interactions/
  analytics/kpi/scheduling/suppression/ai-proposals/placement-case/index.ts +
  package.json + CHANGELOG.md + 7 test files + decision-register.md +
  inventory.md + authorization-policy-matrix.md.
- **Version bump**: 0.0.7-g0.7 → 0.0.8-g0.8-fixes (breaking: context schema
  đổi `{provider, connectionId}` → `{source: CommandSourceSchema}`).
- **Q refs mới** (decision-register.md): Q-38 (F1), Q-39 (F2), Q-40 (F3),
  Q-41 (F4), Q-42 (F5), Q-43 (HRP_POLICY ≠ auto-authority).
- **Test results**: `npm test` 385/385 fixtures PASS (372 baseline + 13 net new
  F1–F5 fixtures); `npm run typecheck` PASS.
- **Out-of-scope từ chối**: KHÔNG build backend/Prisma/migration/route handler;
  KHÔNG gọi model/provider thật; KHÔNG tự commit/tag freeze; KHÔNG sang V7.9a
  1.0–1.15.
- **Manifest snapshot**: `docs/contracts/handoff-g0-0.8.manifest.txt` (§M.7 liệt
  kê F1–F5 delta). SHA-256 cập nhật tại thời điểm F1–F5 hoàn tất.


## Cáº­p nháº­t 2026-09-13 21:50 â G0/0.8-fixes-v2 (F2 follow-up recheck)

Theo Auditor recheck: F2 váº«n OPEN táº¡i `HrpGatewayCallContextSchema` á»
`gateway.ts` (khÃ´ng pháº£i `intake.ts`/`interactions.ts` â Äá»£t F1âF5 ÄÃ£ sá»­a
2 file ÄÃ³). T1 ÄÃ£ Ã¡p dá»¥ng F2 follow-up vá»i pháº¡m vi kháº¯c phá»¥c ÄÃºng finding.

- **Status**: `CHANGES_REQUIRED` â F2 follow-up ÄÃ£ Ã¡p dá»¥ng; chá» verdict
  má»i tá»« independent Auditor.
- **Finding**: `HrpGatewayCallContextSchema` chÆ°a parse ÄÆ°á»£c `HRP_UI` qua
  `INBOUND_DEFAULT` tier. `connectionId: ConnectionIdSchema.optional()` khÃ´ng
  cho phÃ©p `null`; superRefine cÅ© yÃªu cáº§u provider + connectionId mÃ  khÃ´ng
  phÃ¢n biá»t HRP_UI (internal, connectionId=null) vs integration external
  (connectionId báº¯t buá»c).
- **Fix location**: `packages/contracts/src/commands/gateway.ts`
  â `HrpGatewayCallContextSchema`.
- **Schema change**:
  - `connectionId: ConnectionIdSchema.nullable().optional()` (má» null cho HRP_UI).
  - `superRefine` 3 nhÃ¡nh:
    - `INBOUND_DEFAULT` + thiáº¿u provider â reject.
    - `INBOUND_DEFAULT` + `provider='HRP_UI'` â `connectionId` pháº£i null/undefined.
    - `INBOUND_DEFAULT` + provider external â `connectionId` báº¯t buá»c (string).
    - `INBOUND_REVIEWER`/`PRIVILEGED_MERGE` â KHÃNG provider/connectionId (regression).
- **Regression guard**: `gateway-providers-ports.test.mjs` (3 tier table
  test) pass; `INBOUND_REVIEWER`/`PRIVILEGED_MERGE` khÃ´ng provider/connectionId
  váº«n pass; external provider thiáº¿u connectionId váº«n reject.
- **Test má»i**: `packages/contracts/tests/fixtures-fix-f2-gateway-hrpui.test.mjs`
  (13 fixture).
- **Test count**: 385 â **398/398 PASS** (delta +13). `npm run typecheck` PASS.
- **Docs update**:
  - `docs/reviews/gate-0-checklist.md` Â§2.3 ÄÃ£ Äá»i tham chiáº¿u tá»« `profile.ts`
    sang `merge-review.ts` (F1). Ná»i dung merge-review placeholder schemas.
  - `docs/reviews/gate-0-checklist.md` Â§9.1 má»i thÃªm: F2 Follow-up Recheck
    (status, schema change, regression guard, before/after evidence table).
  - `docs/contracts/handoff-g0-0.8.manifest.txt` tÃ¡i táº¡o SAU má»i sá»­a Äá»i,
    tá»ng 85 file (delta +1: `fixtures-fix-f2-gateway-hrpui.test.mjs`).
- **Q refs**: KhÃ´ng má» Q má»i â F2 follow-up náº±m trong Q-39 (F2 source
  discriminator) má» rá»ng.
- **Version**: Giá»¯ `0.0.8-g0.8-fixes` (F2 follow-up khÃ´ng bump version â
  schema change tÆ°Æ¡ng thÃ­ch ngÆ°á»£c: external cáº§n connectionId â váº«n yÃªu cáº§u;
  reviewer/privileged khÃ´ng provider â váº«n cáº¥m; bá» sung HRP_UI path má»i).
- **Out-of-scope tá»« chá»i**: KhÃ´ng sá»­a F1/F3/F4/F5; khÃ´ng má» rá»ng quyá»n
  privileged/reviewer; khÃ´ng yÃªu cáº§u external connection cho HRP_UI; khÃ´ng
  má» Q má»i ngoÃ i Q-1..Q-43.

**TrÆ°á»c/sau evidence** (fixture `HrpGatewayCallContextSchema`):

| Fixture | TrÆ°á»c sá»­a | Sau sá»­a |
|---|---|---|
| `INBOUND_DEFAULT` + `provider='HRP_UI'` + `connectionId=null` | FAIL (superRefine reject vÃ¬ thiáº¿u connectionId) | PASS |
| `INBOUND_DEFAULT` + `provider='CHATWOOT'` + `connectionId='conn-1'` | PASS | PASS (regression) |
| `INBOUND_DEFAULT` + `provider='CHATWOOT'` (thiáº¿u connectionId) | FAIL | FAIL (regression) |
| `INBOUND_REVIEWER` + khÃ´ng provider | PASS | PASS (regression) |
| `PRIVILEGED_MERGE` + khÃ´ng provider | PASS | PASS (regression) |
| `PRIVILEGED_MERGE` + provider external | FAIL | FAIL (regression) |
| `INBOUND_DEFAULT` + provider khÃ´ng há»£p lá» (`INVALID PROVIDER`) | FAIL (regex) | FAIL (regression) |

**Manifest hash** (sau F2 follow-up): `docs/contracts/handoff-g0-0.8.manifest.txt`
SHA-256 = `a750ef3e7c8daa7bc578e43e0f92be5d3c59fec11424ba557f9efdeff87f9238`
(tÃ¡i táº¡o SAU má»i sá»­a Äá»i, Äá»i chiáº¿u toÃ n bá» entry khá»p vá»i file trÃªn disk).

---

## CORE/1.3 — Integration Store riêng (2026-09-14)

Task ID: **CORE/1.3** (Backlog Gate0-V7.9a §Task 1.3)
Owner: T1 (Coder) — implementation; Auditor review độc lập (data reliability).
Dependencies: G0/0.4 frozen, CORE/1.0 audit PASS (42/42). CORE/1.1 self-check READY FOR AUDIT (độc lập; không block 1.3).

### Output

- `packages/integration-store/` — package mới (zero modifications to existing contracts/configs/apps).
  - Source: src/client.ts, errors.ts, adapters.ts, types.ts, index.ts, repos/contact-link.ts, repos/conversation-link.ts, repos/event-receipt.ts.
  - Schema: prisma/schema.prisma (multiSchema + 4 models + 6 enums), prisma/migrations/0001_init/migration.sql.
  - Tests: tests/unit/adapters.test.mjs (10), tests/integration/pg-test-harness.mjs + contact-link.int.test.mjs + event-receipt.int.test.mjs (14 PG).
  - Config: package.json (pin contracts 0.0.8-g0.8-fixes), tsconfig.json, README.md, .env.synthetic.example, .gitignore.

### Boundaries

- **No cross-DB FK**: HRP canonical IDs (LaborProfileId, ClientContactId, ConversationId...) là scalar fields only. Verified bằng test `PG: store KHÔNG copy LaborProfile/PlacementCase canonical` (assert is_nullable=YES).
- **PostgreSQL schema isolation**: Schema `integration` riêng (không `public`). Sử dụng `previewFeatures = ["multiSchema"]` + `@@schema("integration")` cho models + enums.
- **Embedded Postgres tests**: `@embedded-postgres@17.6.0-beta.15` chạy real PG cluster trên Windows (cross-platform binary). KHÔNG dùng HRP/production DB.
- **Scope enforcement**: Mọi repository function require `organizationId + provider + connectionId`; cross-scope write attempt throws `SCOPE_MISMATCH`.
- **No deletes on receipts**: Repository không có delete operation; pending receipts KHÔNG bị âm thầm xóa bởi rollback tx khác (verified bằng test `PG: rollback-downgrade scenario`).

### AC alignment

- ✅ ExternalContactLink scoped target union / match state / evidence review / version
- ✅ ExternalConversationLink history + current context
- ✅ ExternalEventReceipt event hash / state / attempt / lease / correlation / command refs
- ✅ Canonical HRP IDs scalar only — không FK
- ✅ Unique indexes + transactional repository xử lý duplicate
- ✅ Receipt/job state + durable dispatch intent no gap (atomic Prisma `$transaction`)
- ✅ Payload tối thiểu; raw media không trong receipt (chỉ opaque refs JSON)
- ✅ Migration fresh DB + upgrade path (test harness init cluster mới mỗi lần)
- ✅ Rollback không âm thầm xóa pending receipts

### Evidence (commands + results)

| Suite | Pass | Total |
|---|---|---|
| packages/contracts | 398 | 398 |
| packages/config | 13 | 13 |
| apps/integration-api | 35 | 35 |
| apps/integration-worker | 9 | 9 |
| apps/context-panel | 11 | 11 |
| packages/integration-store unit | 10 | 10 |
| packages/integration-store PG integration | 14 | 14 |
| **Aggregate** | **490** | **490** |

### Đính chính ownership (CORE/1.3–1.4)

CORE/1.3–1.4 là **Integration store/queue**, **KHÔNG phải HRP canonical ledger**.

- HRP canonical ledger (LaborProfile, PlacementCase, ClientCompany canonical tables) thuộc HRP core DB — KHÔNG thuộc scope integration-store.
- HRP idempotency/outbox **thật** (Phase 9 / H.*) thuộc HRP-owned PR; integration-store là **mirror vật lý** của handoff DTO (`OutboxDeliveryIntent`) và receipt lifecycle, không phải source of truth.
- T1 chỉ lưu scalar reference (`matchedLaborProfileId String?`) — không FK. Integration runtime resolve canonical IDs qua HRP-owned service.

### Decisions (Q-44+)

- **Q-44**: CORE/1.3 dùng Postgres schema `integration` riêng + Prisma `multiSchema`. Cross-DB FK intentionally absent.
- **Q-45**: Atomic receipt + intent commit trong CÙNG PostgreSQL transaction (queue riêng deferred; Phase 9 chưa chốt queue choice).
- **Q-46**: Embedded Postgres cho integration tests (`@embedded-postgres@17.6.0-beta.15`). Production cluster Owner-managed.

### Gate / blockers

- **Gate 0 freeze**: PASS — CORE/1.3 chỉ thêm `packages/integration-store/**`; không sửa contracts đã freeze.
- **CORE/1.0 audit**: PASS (referenced).
- **CORE/1.1 audit**: độc lập — CORE/1.3 không chờ audit CORE/1.1.
- **CORE/1.4 (Worker leasing)**: BLOCKED until CORE/1.3 audit PASS. Schema có sẵn (`leaseOwner`, `leaseExpiresAt`).
- **Store/migration/data reliability**: REQUIRED audit trước tích hợp (Backlog §1.3 explicit).

### Audit status

**READY FOR AUDIT** (T1 self-check). T1 KHÔNG tự ghi PASS/FREEZE cho store/migration/data reliability. Auditor review độc lập.

# CORE/1.4 — Durable worker/queue leasing (Inventory addendum)

Ngày 2026-09-14. T1 writer. Snapshot sau khi CORE/1.3 audit PASS. CORE/1.4 chỉ thêm queue leasing layer trên Integration Store đã freeze; không sửa contracts đã freeze, không copy canonical HRP tables, không bridge tới HRP-owned queue.

## Scope delta so với CORE/1.3

- **Mới**: lease module (`packages/integration-store/src/worker/lease.ts`), retry module (`retry.ts`), clock module (`clock.ts`), worker poll loop (`apps/integration-worker/src/durable-worker.ts`), executor fixture cô lập (`apps/integration-worker/src/executor.ts`).
- **Schema delta**: migration `0002_worker_lease_fencing` — thêm `fencingToken`, `leaseFencedAt`, `nextAttemptAt`, `idempotencyKey` trên `ExternalEventReceipt`; `fencingToken`, `leaseFencedAt` trên `DispatchIntent`. Indexes tương ứng.
- **Backward compat**: CORE/1.3 receipt rows (chưa có fencing token) vẫn insert OK; chỉ lease/complete path mới cần fencing token. Migration `IF NOT EXISTS` an toàn.
- **Không đụng**: Gate 0 contracts (FROZEN), CORE/1.3 receipt schema cho happy path, CORE/1.1 gateway (vẫn CHANGES_REQUIRED; worker dùng executor fixture cô lập để test queue).

## Source files

- Schema/migration: `packages/integration-store/prisma/schema.prisma`, `prisma/migrations/0002_worker_lease_fencing/{migration,rollback}.sql`.
- Worker modules (mới): `packages/integration-store/src/worker/{clock,retry,lease,index}.ts`.
- Worker app (mới + sửa): `apps/integration-worker/src/{durable-worker,executor,server}.ts`, `tests/server.test.mjs`.
- Config (WorkerConfig mở rộng): `packages/config/src/{types,loader,index}.ts`.

## Boundaries

- **No broker**: Worker chỉ poll PostgreSQL (`claimNextReceipt` = atomic UPDATE ... RETURNING). Không thêm Redis/NATS/SQS. Lý do: scale hiện tại (≤1K receipts/s) chưa cần broker; thêm broker = thêm vận hành. Khi scale yêu cầu >K receipts/s, mở lại với broker (xem Q-45 dưới).
- **Fencing token**: UUIDv4 sinh per claim; completion yêu cầu `WHERE fencingToken = $token AND leaseOwner = $workerId`. Stale worker (sau reclaim) tự bị reject ngay cả khi race với fresh worker.
- **Idempotency key persistence**: Cột `idempotencyKey` giữ từ commit receipt gốc → retry canonical command giữ key, không sinh key mới. Đây là AC rõ từ Owner brief.
- **No cross-DB FK**: Giữ như CORE/1.3. Worker không có quyền đụng HRP canonical; chỉ mirror receipt + dispatch intent.
- **Executor fixture cô lập**: CORE/1.1 gateway còn CHANGES_REQUIRED; worker KHÔNG gọi CanonicalHrpGatewayMock. `apps/integration-worker/src/executor.ts` là pure function simulate 8 outcome (SUCCESS, FAIL_VALIDATION, FAIL_VERSION_CONFLICT, FAIL_IDEMPOTENCY_CONFLICT, FAIL_PERMISSION_DENIED, FAIL_POLICY_REJECTION, TIMEOUT_BEFORE_APPLY, TIMEOUT_AFTER_APPLY).
- **PostgreSQL credentials**: Worker dùng `DATABASE_URL` riêng; không share với HRP core. `assertSafeDatabaseUrl` chạy runtime; integration test dùng embedded-postgres với port riêng (xem `pg-test-harness.mjs`).
- **embedded-postgres** chỉ là test env, KHÔNG phải deployment production. RDS/Cloud SQL gợi ý, chưa chọn thay topology VPS/residency.

## AC alignment

- ✅ Polling PostgreSQL ưu tiên; không broker mới
- ✅ Receipt commit xong chưa worker nhận vẫn recover (reclaimExpiredLeases)
- ✅ Hai worker tranh cùng receipt → chỉ một lease (UPDATE ... WHERE leaseOwner IS NULL)
- ✅ Attempts / nextAttemptAt / leaseOwner / fencingToken rõ (schema + indexes)
- ✅ Stale worker không ghi đè (fencing check)
- ✅ Crash / lease expiry → retry bền (reclaim + retry policy)
- ✅ Shutdown có drain + lease recovery (releaseAllForWorker)
- ✅ Retry canonical command giữ idempotency key (idempotencyKey column)
- ✅ Two-worker / expiry / stale / shutdown tests (lease.int.test.mjs, 10 tests)
- ✅ State persists in DB across "restart" (tests dùng new Prisma client per test → DB state persists across instances)
- ✅ Worker đi qua repository/validation boundary (chỉ gọi `claimNextReceipt` / `completeReceipt` qua `packages/integration-store/worker`)
- ✅ Schema isolation KHÔNG dùng làm proof credentials tách (ghi rõ embedded-postgres = test only)

## Evidence (commands + results)

| Suite | Pass | Total |
|---|---|---|
| packages/contracts (Gate 0 frozen) | 398 | 398 |
| packages/config | 13 | 13 |
| apps/integration-api | 35 | 35 |
| apps/integration-worker | 9 | 9 |
| apps/context-panel | 11 | 11 |
| packages/integration-store unit | 10 | 10 |
| packages/integration-store PG integration (CORE/1.3 + CORE/1.4 lease) | 24 | 24 |
| **Aggregate** | **500** | **500** |

## Decisions (Q mới cho CORE/1.4)

- **Q-45** (CORE/1.4 tech): Chọn **PostgreSQL polling** làm queue layer thay vì broker ngoài. Lý do + scale threshold ghi ở §6 handoff. **PROPOSED**, Owner chốt khi production gate.
- **Q-46** (retry policy defaults): `maxAttempts=8`, `baseMs=1s`, `maxMs=5m`, `jitterFraction=0.2`. `isRetryable` theo `ErrorCode.retryClass` (Gate 0 errors.ts taxonomy). **PROPOSED**, Owner chốt khi production gate.
  - **Post-audit fix (2026-09-14)**: code aligned về `maxAttempts=8, jitterFraction=0.2` sau khi Auditor phát hiện sai lệch với `maxAttempts=5, jitterFraction=0.1`. 24/24 integration tests PASS.
- **Q-47** (fencing model): `fencingToken` UUIDv4 per claim; completion strict check `WHERE fencingToken = $token`. Audit cần xác nhận KHÔNG có code path nào bypass (T1 self-check: chỉ `completeReceipt` là update path; các repo khác (`repos/event-receipt.ts`, future `repos/intent.ts`) chỉ INSERT state mới).

## Gate / blockers

- **Gate 0**: FREEZE (Owner sign-off).
- **CORE/1.0**: READY FOR AUDIT (T1 self-check PASS).
- **CORE/1.1**: CHANGES_REQUIRED (PENDING audit; CORE/1.4 không phụ thuộc — dùng executor fixture cô lập).
- **CORE/1.3**: Auditor PASS (independent review).
- **CORE/1.4 (this task)**: PASS T1 self-check; **REQUIRED independent Auditor review** trước khi integrate vào receiver (Owner brief: "CORE/1.4 bắt buộc Auditor review data reliability trước khi tích hợp vào receiver").
- **Blocked paths**: wire executor vào CanonicalHrpGatewayMock; kết nối `apps/integration-api` cho receiver.
- **Open Q**: pool size / DB topology / observability stack (xem §8 handoff-core-1.4.md).

## Audit status

**READY FOR AUDIT** (T1 self-check: 500/500 PASS; manifest 25/25 verified). T1 KHÔNG tự ghi PASS/FREEZE cho data reliability. Auditor review độc lập là bước tiếp theo trước khi receiver integration.


## CORE/1.2 — Webhook Receiver & Idempotency (2026-09-14, rev 3 AUDITOR PASS)

**Status rev 1**: READY FOR AUDIT (T1 self-check PASS; 71/71 API + 24/24 store int + 15/15 config + 398/398 contracts).

**Auditor verdict rev 1**: CHANGES_REQUIRED — 3 blocking findings (F1 scope/secret binding, F2 algorithm pinning, F3 stable event identity) + 1 guard fix (mockMode=off).

**Status rev 2**: CHANGES_REQUIRED → FIXED. T1 self-check PASS; 42 unit + 18 PG int + 12 server + 26 gateway = 98 API; 24 store int + 10 store unit; 15 config; 398 contracts; 9 worker; 11 context-panel = **566/566**.

**Auditor verdict rev 2**: **PASS** (539 tests run trong suite scope Auditor; 27-test delta từ T1 self-check là do suite-scope khác nhau — xem `handoff-core-1.2.md` §15.2).

**Status rev 3 (this update)**: **AUDITOR PASS**. Doc-only reconcile — không code diff. Manifest hash set giữ nguyên rev 2.

### Files (rev 2 — snapshot đã audit)

| File | Approx LOC | Purpose |
|---|---|---|
| `apps/integration-api/src/receiver/protocol-fixture.ts` | 280 | Parse CHATWOOT/ZALO_OA/GENERIC + STABLE_EVENT_ID_POLICY (F3: bỏ message.id, trace_id) |
| `apps/integration-api/src/receiver/hmac-verify.ts` | 130 | HMAC SHA-256/512 + constant-time compare (F2: algorithm pinned by registry) |
| `apps/integration-api/src/receiver/scope-verify.ts` | 110 | URL-path scope (NEVER body) + body scope-spoof detection |
| `apps/integration-api/src/receiver/connection-registry.ts` | 200 NEW | F1: server-trusted registry `(org, provider, conn) → {secret, algorithm}` |
| `apps/integration-api/src/receiver/dedupe.ts` | 130 | Orchestrate `commitReceiptWithIntents` (CORE/1.3) |
| `apps/integration-api/src/receiver/handler.ts` | 290 | HTTP pipeline: registry → HMAC → parse → spoof → commit; rate map TTL+cap |
| `apps/integration-api/src/receiver/ack.ts` | 30 | Typed ACK shape |
| `apps/integration-api/src/server.ts` | +50 LOC | Wire registry + `/webhooks/...` route + `/mock/gateway/*` guard |
| `packages/config/src/types.ts` | +50 LOC | `ReceiverConfigSchema` extend `ApiConfigSchema` (rateMap params) |
| `packages/config/src/loader.ts` | +20 LOC | `parseReceiverConfig` từ env (rateMap params + registry env) |

### Tests (rev 2)

| File | Tests | Coverage |
|---|---|---|
| `apps/integration-api/tests/receiver.test.mjs` | 42 | Unit: protocol fixture (F3 stable identity), HMAC verify (F2 algorithm pinned), connection registry (F1), scope, body spoof, dedupe |
| `apps/integration-api/tests/receiver.int.test.mjs` | 18 | PG integration: HTTP 202, idempotent replay, hash conflict, scope spoof, malformed JSON, HMAC mismatch, missing eventId, payload too large, recovery, DB unavailable, F1/F2/F3 |
| `apps/integration-api/tests/server.test.mjs` | 12 | +3 mockMode=off guard tests (call + log blocked; deterministic vẫn OK) |
| `apps/integration-api/tests/gateway.test.mjs` | 26 | CORE/1.1 regression (không tự đóng) |
| `packages/config/tests/loader.test.mjs` | 15 | receiver defaults + env override + rateMap params |

### Boundaries

- NO CORE/1.1 dependency (deliberate; mockMode=off guard chỉ là 1 delta, KHÔNG tự đóng toàn CORE/1.1).
- NO CORE/1.5 normalize / mapping / semantic firewall (deferred per Backlog §Task 1.5).
- NO provider production adapter (P9 HRP-owned, OUT OF SCOPE cho CORE/1.2/CORE/1.5).
- NO shared contracts delta (Gate 0 frozen 0.0.8-g0.8-fixes).
- NO HRP/provider/model thật, production DB, deploy.
- NO thay đổi CORE/1.3 integration store API.

### Open (rev 3)

- Q-48 fixture scope (synthetic HMAC, no real Zalo/Chatwoot verification — production adapter thuộc P9).
- Q-49 stable eventId policy (F3 rev 2: bỏ message.id, trace_id).
- Q-50 in-memory rate limit + Q-51 rev 2 TTL/cap.
- Provider production adapter (Zalo challenge, Chatwoot handshake) thuộc **P9** HRP-owned, deferred.

## CORE/1.6 � Intake Orchestration and Checkpoints (2026-09-14)

Task ID: **CORE/1.6** (Backlog Gate0-V7.9a �Task 1.6)
Owner: T1 (Coder) � implementation; Auditor review d?c l?p (review-binding, checkpoint/partial failure, idempotent resume).
Dependencies: CORE/1.1, 1.3, 1.4, 1.5 = Auditor PASS. G0/0.3b frozen. Gate 0 contracts 0.0.8-g0.8-fixes unchanged.

### Output

- IntakeOrchestrator class in pps/integration-api/src/orchestrator/: preview (read-only), run (5-step state machine), resume, resumeWithPayload.
- 5-step state machine: CONFIRM_VALIDATE -> IDENTITY -> PROFILE -> CASE -> AVAILABILITY. Each step idempotent via uildStepIdempotencyKey(intakeRevisionId, stepName).
- PG IntakeCheckpoint table (schema integration) + IntakeCheckpointState enum (RUNNING/PARTIAL/COMPLETED/FAILED/REVIEW_PENDING). 3 indexes (state, org+state, idempotencyKey).
- Repository functions: createIntakeCheckpoint (with DUPLICATE_KEY on digest mismatch), indIntakeCheckpoint, updateIntakeCheckpoint.
- Canonical draft digest (digestCanonical + uildCanonicalDraft): SHA-256 hex of order-stable JSON for confirmation binding.
- Confirmation binding (isConfirmationValid): server-side validation of draftRevisionId/draftDigest/canonicalId/canonicalVersion against saved checkpoint. Mismatch -> OrchestratorError(DUPLICATE_KEY, STALE_CONFIRMATION).
- DNC handler (executeDncAction in dnc-handler.ts): standalone, no intake checkpoint, no CCCD, no HRP review.

### Tests

| File | Tests | Coverage |
|---|---|---|
| pps/integration-api/tests/orchestrator.test.mjs | 33 | Unit (in-memory mocks): AC1 (preview no-mut), AC2 (run+checkpoint state machine), AC3 (EXACT no-op), AC4 (POSSIBLE review), AC5 (NEW profile), AC6 (partial failure + resume), AC7 (digest invalidation), AC8 (revision/version binding), AC9 (DNC decoupled), digest utilities, step idempotency, error taxonomy |
| pps/integration-api/tests/orchestrator.pg-e2e.test.mjs | 6 | PG-E2E (embedded PostgreSQL 17.6 + mock HTTP gateway): RUNNING->COMPLETED persistence, POSSIBLE->REVIEW_PENDING, stale confirmation -> DUPLICATE_KEY, partial failure resume with state PARTIAL->COMPLETED in PG, idempotency (no row duplication), DNC decoupled (no checkpoint) |

### Boundaries

- NO contract changes (Gate 0 frozen 0.0.8-g0.8-fixes).
- NO HRP review workflow pre/post-apply (deferred to CORE/1.7).
- NO Client domain paths, transitions, managed modes (return UNAVAILABLE per Owner instruction).
- NO review service / UI (CORE/1.7).
- NO real HRP / provider / model integration, production DB, deploy.
- NO confirmation token signing (HMAC/RSA deferred to CORE/1.7).
- NO integration with CORE/1.4 durable worker as task handler (orchestrator is synchronous in CORE/1.6; production wiring deferred).

### Status

T1 implementation COMPLETE � awaiting Auditor review of review-binding, checkpoint/partial failure, idempotent resume.

### Open

- Q-52: confirmation token signing strategy (HMAC/RSA) deferred to CORE/1.7.
- Q-53: client domain intake paths (ClientContact) deferred to CORE/1.7+; returns UNAVAILABLE in CORE/1.6.
- Q-54: orchestrator integration with CORE/1.4 durable worker loop (lease acquire -> run -> release) deferred to production wiring.


