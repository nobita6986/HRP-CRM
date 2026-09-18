# Authorization Policy Matrix — Gate 0 (G0/0.6)

> Tài liệu permission / error / policy boundary matrix cho toàn bộ
> command/query đã khai báo trong `packages/contracts/src/commands/`.
> Theo Backlog Gate0 §Task 0.6.
>
> **HEAD:** `414c54bfa2e227ec1a25694310e48908e0d67abe` (chưa commit mới)
> **Date:** 2026-09-13
> **Coder:** T1 — Owner: Chủ nhân (review bundle trước Gate 0 freeze)
> **Auditor:** REQUIRED — matrix chạm auth/cross-org/data reliability.

## 0. Nguyên tắc & giới hạn

- Matrix này **mô tả** permission/error/policy boundary cho từng
  command/query; KHÔNG chạm schema hay shared contracts (routing/
  analytics/kpi/ai-* vừa đóng ở 0.5).
- Phân biệt rõ:
  - **Schema validation (AC CONFIRMED — 0.1–0.5)**: shape, enum
    allowlist, regex, length bound, discriminator, strict reject,
    superRefine. Đã enforce qua 313/313 fixtures PASS.
  - **Runtime gate (PROPOSED — HRP-owned, PENDING)**: capability
    check, principal binding, attestation, organizationId scope,
    delegation chain, object permission (target canonical +
    `expectedVersion`), one-active-case, merge approval, CCCD
    residency, HRP review pre/post-apply, signature/JWT/webhook
    algorithm (Q-33), idempotency retention, fencing, DNC cut-off,
    retention cleanup.
- **BoD aggregate** KHÔNG mặc định transcript/evidence (Master
  §13.5–8 + Backlog §0.5); secret operator KHÔNG mặc định đọc
  CCCD/transcript (Master §13.5 + Backlog §0.3h).
- **Signature provider và API auth là hai ranh giới riêng** (Backlog
  §0.6 AC #4 + Q-33). T1 KHÔNG tự đặt JWT algorithm / signature
  protocol cho Zalo khi chưa xác minh; cần Auditor review shared
  contracts ở bundle cuối.
- **Không tự PASS matrix = freeze Gate 0**; Owner xác nhận Gate 0
  trước backend.

## 1. Cột matrix (theo Backlog §0.6 AC #1)

| Cột | Ý nghĩa |
|---|---|
| Kind | `command` (state-changing) / `query` (read-only) / `event` / `internal`. |
| Tier (HRP_GATEWAY_TIERS) | `INBOUND_DEFAULT` / `INBOUND_REVIEWER` / `PRIVILEGED_MERGE` / `N/A` (query/event/internal). |
| Actor kind required | `USER` / `SERVICE` / `DELEGATED_USER` / `ANY` (schema accepts; runtime bind). |
| Required scope | `organizationId` + (optional) `delegationRef`; runtime gate bind principal/scope. |
| Object permission (target) | Canonical id + `expectedVersion` (optimistic concurrency); runtime gate verify authority. |
| Audit fields | `effectiveAt` / `recordedAt` / `actor` / `source` / `target` / `command` / `version` / `result` (subset). |
| Retry class (errors.ts) | Default retry class theo taxonomy. |
| Schema validation status | `CONFIRMED` (AC) / `PROPOSED` (runtime). |
| Q refs | Cross-reference Q-1..Q-37 trong `decision-register.md` mà matrix chạm tới. |

## 2. Retry class mapping (taxonomy errors.ts)

| ErrorCode | Retry class | Note |
|---|---|---|
| `VALIDATION_ERROR` | `NEVER` | schema reject; client fix. |
| `UNRESOLVED_IDENTITY` | `REVIEW_REQUIRED` | chờ reviewer. |
| `POLICY_REJECTION` | `REVIEW_REQUIRED` | chờ reviewer. |
| `VERSION_CONFLICT` | `REFRESH_AND_REVIEW` | read/re-review. |
| `IDEMPOTENCY_CONFLICT` | `NEVER` | same key + different payload. |
| `AUTHENTICATION_REQUIRED` | `REAUTHENTICATE` | reauth. |
| `FORBIDDEN` | `NEVER` | privilege deny. |
| `DEPENDENCY_UNAVAILABLE` | `BOUNDED_SAME_KEY` | retry với cùng idempotency key. |
| `RATE_LIMITED` | `BOUNDED_SAME_KEY` | retry với Retry-After. |
| `UNKNOWN_COMMAND_OUTCOME` | `RECONCILE_FIRST` | reconcile. |

## 3. Matrix — Commands (HRP_GATEWAY_METHODS + scheduling batch)

Tier theo `gateway.ts HRP_GATEWAY_METHODS`; actor/schema bound là
schema-validation CONFIRMED; object permission + capability + scope
là runtime gate PROPOSED.

| # | Command | Kind | Tier | Actor kind required | Required scope | Object permission (target) | Audit fields | Retry class (default) | Schema status | Q refs |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `createOrMatchLaborProfile` | command | INBOUND_DEFAULT | USER / SERVICE / DELEGATED_USER | `organizationId` + actor; nếu DELEGATED_USER: `delegationRef` opaque | `laborProfileId` (kết quả) + `version` (kết quả) — input chỉ signals + evidence; KHÔNG target mutation với POSSIBLE_MATCH | effectiveAt / recordedAt / actor / source / commandId / version / result (matching outcome) | `NEVER` nếu VALIDATION/IDEMPOTENCY; `REVIEW_REQUIRED` nếu UNRESOLVED_IDENTITY/POLICY_REJECTION; `REFRESH_AND_REVIEW` nếu VERSION_CONFLICT | CONFIRMED (signals + evidence + outcome EXACT/POSSIBLE/NEW — Q-13) | Q-1, Q-2, Q-3, Q-7, Q-13, Q-30, Q-31 |
| 2 | `updateLaborProfile` | command | INBOUND_DEFAULT | USER / DELEGATED_USER | `organizationId` + actor | `laborProfileId` + `expectedVersion` (AC Q-14) | effectiveAt / recordedAt / actor / source / target / commandId / version / patch / result (APPLIED/NOOP) | `NEVER` nếu VALIDATION; `REFRESH_AND_REVIEW` nếu VERSION_CONFLICT | CONFIRMED (patch whitelist, NOOP/APPLIED, no CurrentRelationship/Handling/Beneficiary) | Q-1, Q-2, Q-14, Q-30 |
| 3 | `mergeLaborProfiles` | command | PRIVILEGED_MERGE | USER (manager capability — runtime gate) | `organizationId` + actor + privilege tier | **PROPOSED/UNAVAILABLE placeholder** (F1/G0/0.8): không bind `sourceLaborProfileId/targetLaborProfileId/expectedVersion` typed; yêu cầu `proposedAuditRef ∈ {Q-19,Q-23,Q-37}` qua `MERGE_REVIEW_PROPOSED_DEPENDENCIES`. Runtime gate PRIVILEGED_MERGE | `NEVER` luôn (placeholder); `REVIEW_REQUIRED` nếu POLICY_REJECTION | **PROPOSED/UNAVAILABLE** (F1 — chờ HRP-owned PR Q-19 + Q-23 + Q-37; merge approval/duplicate detection/workflow chưa chốt) | Q-19, Q-23, Q-30, Q-37, Q-38 |
| 4 | `openPlacementCase` | command | INBOUND_DEFAULT | USER / DELEGATED_USER | `organizationId` + actor; optional `laborProfileId` (mở case chưa có profile) | n/a (tạo mới) — runtime HRP gate one-active-case (Q-19) | effectiveAt / recordedAt / actor / source / target / commandId / version / result | `REVIEW_REQUIRED` nếu POLICY_REJECTION (one-active-case); `NEVER` nếu VALIDATION | CONFIRMED shape; runtime gate Q-19 unknown | Q-3, Q-6, Q-19, Q-24, Q-30 |
| 5 | `updatePlacementCase` | command | INBOUND_DEFAULT | USER / DELEGATED_USER | `organizationId` + actor | `placementCaseId` + `expectedVersion` (Q-19) | effectiveAt / recordedAt / actor / source / target / commandId / version / patch / result | `NEVER` nếu VALIDATION; `REFRESH_AND_REVIEW` nếu VERSION_CONFLICT; `REVIEW_REQUIRED` nếu POLICY_REJECTION | CONFIRMED shape; runtime gate Q-19 unknown | Q-3, Q-6, Q-19, Q-24 |
| 6 | `closePlacementCase` | command | INBOUND_DEFAULT | USER / DELEGATED_USER | `organizationId` + actor | `placementCaseId` + `expectedVersion` (Q-19) + `closeReason` (9 giá trị Master §10.6.1) | effectiveAt / recordedAt / actor / source / target / commandId / version / closeReason / result (appliedStatus = CLOSED) | `NEVER` nếu VALIDATION; `REVIEW_REQUIRED` nếu POLICY_REJECTION | CONFIRMED shape; runtime gate Q-20 SUCCESS không tự EFFECTIVE; Q-19 transitions unknown | Q-3, Q-6, Q-19, Q-20, Q-24 |
| 7 | recordInteraction (Talent) | command | INBOUND_DEFAULT | USER / SERVICE / DELEGATED_USER | organizationId + actor; source: CommandSourceSchema (F2/G0/0.8) - HRP_UI discriminator connectionId: null; INTEGRATION provider: CHATWOOT|ZALO_OA + connectionId | laborProfileId + optional placementCaseId + occurredAt / effectiveAt / recordedAt (Q-22) | effectiveAt / recordedAt / actor / source / target / commandId / version / result | NEVER nếu VALIDATION; REVIEW_REQUIRED nếu UNRESOLVED_IDENTITY | CONFIRMED shape (F2 source discriminator đồng bộ primitives/envelope); runtime auth/delegation Q-21 unknown | Q-3, Q-21, Q-22, Q-40 |
| 8 | recordClientInteraction | command | INBOUND_DEFAULT | USER / SERVICE / DELEGATED_USER | organizationId + actor; clientReferenceId opaque (Q-23 unresolved); source: CommandSourceSchema (F2) | n/a (Client domain context) - occurredAt/effectiveAt/recordedAt | effectiveAt / recordedAt / actor / source / target / commandId / version / result (UNKNOWN OK cho Client) | NEVER nếu VALIDATION; REVIEW_REQUIRED nếu POLICY_REJECTION | CONFIRMED shape (F2 source discriminator đồng bộ primitives); runtime Client domain Q-23 unresolved/proposed; UNKNOWN KHÔNG đủ chứng minh AC PASS | Q-3, Q-21, Q-22, Q-23, Q-40 |
| 9 | `updateLaborAvailability` | command | INBOUND_DEFAULT | USER / DELEGATED_USER | `organizationId` + actor | `laborProfileId` + `expectedVersion` (Q-15) | effectiveAt / recordedAt / actor / source / target / commandId / version / result (appliedAvailability) | `NEVER` nếu VALIDATION; `REFRESH_AND_REVIEW` nếu VERSION_CONFLICT | CONFIRMED shape (AVAILABLE_FROM_DATE yêu cầu ngày, future-date business clock Q-15); DO_NOT_CONTACT đi kèm suppression event | Q-3, Q-15, Q-30 |
| 10 | commitSuppression | command | INBOUND_DEFAULT | USER / SERVICE / DELEGATED_USER | organizationId + actor | target canonical (LABOR_PROFILE/EXTERNAL_CONTACT/SUPPRESSED_RECIPIENT_FENCE) + version (LABOR_PROFILE) + 
eason: DncReasonSchema (F4/G0/0.8 canonical 4 giá trị) | effectiveAt / recordedAt / actor / source / target / commandId / version / fenceToken / result | NEVER nếu VALIDATION; REVIEW_REQUIRED nếu POLICY_REJECTION; NEVER nếu FORBIDDEN (no removeSuppression) | CONFIRMED shape (3 target kinds Q-26 + F4 canonical DNC reasons 4 giá trị; safety suppression không tạo LaborProfile; inbound KHÔNG tự gỡ DNC; HRP_POLICY không tự cấp authority - runtime gate Q-37) | Q-3, Q-26, Q-30, Q-37, Q-42 |
| 11 | `dispatchAuthorizationCheck` | query | INBOUND_DEFAULT | SERVICE | `organizationId` + actor (audit) | n/a (gate read) | recordedAt / actor / source / commandId / result (AUTHORIZED/SUPPRESSED/UNKNOWN) | `BOUNDED_SAME_KEY` (read query có thể retry nhẹ); fail closed nếu UNKNOWN | CONFIRMED shape; runtime gate stale cache fail closed (Q-26) | Q-26, Q-30 |
| 12 | `createNextAction` | command | INBOUND_DEFAULT | USER / DELEGATED_USER | `organizationId` + actor | target canonical (placementCaseId/clientOpportunityId/standalone) + `expectedVersion` (case/opportunity) | effectiveAt / recordedAt / actor / source / target / commandId / version / result | `NEVER` nếu VALIDATION; `REVIEW_REQUIRED` nếu POLICY_REJECTION | CONFIRMED shape (Q-27: CREATE statuses ⊆ {OPEN, CANCELLED}, snooze tách riêng status) | Q-3, Q-27, Q-30 |
| 13 | `updateNextAction` | command | INBOUND_DEFAULT | USER / DELEGATED_USER | `organizationId` + actor | `nextActionId` + `expectedVersion` + revisionId (Q-27) | effectiveAt / recordedAt / actor / source / target / commandId / version / patch / result (appliedRevision) | `NEVER` nếu VALIDATION; `REFRESH_AND_REVIEW` nếu VERSION_CONFLICT | CONFIRMED shape (Q-27 snooze/dismiss khác DONE; occurrenceKey cho reminder dedupe) | Q-3, Q-27, Q-30 |
| 14 | `queryOutboxDelivery` | query | INBOUND_DEFAULT | SERVICE | `organizationId` + actor (audit) | n/a (read) | recordedAt / actor / source / commandId / result (state + reasonCode) | `BOUNDED_SAME_KEY` (read retry nhẹ) | CONFIRMED shape (delivery reporting state PUSH_WEBHOOK default + PULL_CLAIM_ACK fallback — Q-31) | Q-31, Q-33 |
| 15 | commitReviewDecision | command | INBOUND_REVIEWER | USER (reviewer capability - runtime gate) | organizationId + actor + reviewer capability | **PROPOSED/UNAVAILABLE placeholder** (F1/G0/0.8): yêu cầu proposedAuditRef ∈ {Q-19,Q-23,Q-37}. Runtime HRP-owned review workflow chưa chốt | NEVER luôn (placeholder); REVIEW_REQUIRED nếu POLICY_REJECTION | **PROPOSED/UNAVAILABLE** (F1) - StaffReviewConfirmation (Q-13 draftDigest) vẫn CONFIRMED cho updateLaborProfile/intake/case context; chỉ commitReviewDecision riêng là placeholder. Runtime gate reviewer capability Q-7 unknown | Q-7, Q-13, Q-19, Q-30, Q-37, Q-38 |
| 16 | resolvePossibleMatch | command | INBOUND_REVIEWER | USER (reviewer capability - runtime gate) | organizationId + actor + reviewer capability | **PROPOSED/UNAVAILABLE placeholder** (F1/G0/0.8): yêu cầu proposedAuditRef ∈ {Q-19,Q-23,Q-37}. matchings.ts EXACT_MATCH/POSSIBLE_MATCH/UNRESOLVED ở mappings.ts vẫn CONFIRMED; chỉ lệnh terminal resolve thuộc placeholder | NEVER luôn (placeholder); REFRESH_AND_REVIEW nếu VERSION_CONFLICT | **PROPOSED/UNAVAILABLE** (F1) - Q-13 POSSIBLE_MATCH vẫn giữ review reference; runtime gate Q-7 unknown | Q-7, Q-13, Q-19, Q-30, Q-37, Q-38 |
| 17 | supersedeReviewStatus | command | PRIVILEGED_MERGE | USER (privileged capability - runtime gate) | organizationId + actor + privilege tier | **PROPOSED/UNAVAILABLE placeholder** (F1/G0/0.8): yêu cầu proposedAuditRef ∈ {Q-19,Q-23,Q-37}. Q-19 transitions matrix chưa chốt | NEVER luôn (placeholder); REFRESH_AND_REVIEW nếu VERSION_CONFLICT | **PROPOSED/UNAVAILABLE** (F1) - Q-19 transitions matrix vẫn PROPOSED; runtime gate Q-7 unknown | Q-7, Q-16, Q-19, Q-30, Q-37, Q-38 |
| 18 | Planning batch (multi-item) | command | INBOUND_DEFAULT | USER / DELEGATED_USER | `organizationId` + actor | per-item target + version (mixed kinds) | effectiveAt / recordedAt / actor / source / commandId / version / per-item result + OperationReference cho ACCEPTED (Q-32) | `NEVER` nếu VALIDATION/IDEMPOTENCY; `REFRESH_AND_REVIEW` nếu VERSION_CONFLICT | CONFIRMED shape (Q-28 + Q-32: per-item outcome APPLIED/ACCEPTED/FAILED/SKIPPED; ACCEPTED có pendingReference canonical OperationReference — implementation query API để V7.9a) | Q-28, Q-30, Q-32 |

## 4. Matrix — Queries (0.4)

| # | Query | Kind | Tier | Actor kind required | Required scope | Object permission (target) | Audit fields | Retry class (default) | Schema status | Q refs |
|---|---|---|---|---|---|---|---|---|---|---|
| Q1 | `ContextQuery` | query | N/A (read) | USER / SERVICE / DELEGATED_USER | `organizationId` + actor; provider/connectionId optional | target canonical (Talent/Client) HOẶC external (provider ref) | recordedAt / actor / source / commandId / snapshotVersion / result (field allowlist) | `NEVER` (read thường không retry; cache stale không dùng canonical — Q-30) | CONFIRMED shape (10 fields optional + unavailableFields marker) | Q-3, Q-30 |
| Q2 | `ReadOnlyIdentityPreview` | query | N/A (read) | USER / SERVICE | `organizationId` + actor | signals — KHÔNG ép NEW | recordedAt / actor / source / commandId / result (candidates ≤ 16) | `NEVER` | CONFIRMED shape (preview read-only; không gọi createOrMatch) | Q-13, Q-30 |
| Q3 | `AllowedActionsQuery` | query | N/A (read) | USER / SERVICE | `organizationId` + actor + target optional | target canonical (Talent/Client) | recordedAt / actor / source / commandId / result (tier + privileged) | `NEVER` | CONFIRMED shape (privilege tách riêng tier) | Q-30 |
| Q4 | `ContactabilityCheck` | query | N/A (read) | SERVICE | `organizationId` + actor + channel | target canonical | recordedAt / actor / source / commandId / freshnessAt / result (AUTHORIZED/SUPPRESSED/UNKNOWN) | `BOUNDED_SAME_KEY` (read retry nhẹ); fail closed nếu UNKNOWN | CONFIRMED shape (UNKNOWN = fail closed; fenceToken + fenceCutOffAt) | Q-26, Q-30 |
| Q5 | `ConstantsSnapshot` | query | N/A (read) | USER / SERVICE | `organizationId` + actor | n/a (snapshot enum package) | recordedAt / actor / source / commandId / snapshotVersion | `NEVER` | CONFIRMED shape (enum package + label tables đầy đủ; UI/dev KHÔNG phụ thuộc dictionary API) | Q-30 |
| Q6 | `ResolveContactByExternal` | query | N/A (read) | USER / SERVICE | `organizationId` + actor + provider/connectionId | external ref (provider) | recordedAt / actor / source / commandId / result (link + conversation) | `BOUNDED_SAME_KEY` (read retry nhẹ) | CONFIRMED shape (mutation target lấy canonical; KHÔNG từ Chatwoot/Zalo attributes) | Q-29, Q-30 |
| Q7 | `ListExternalContactLinks` | query | N/A (read) | USER / SERVICE | `organizationId` + actor | provider/connectionId optional | recordedAt / actor / source / commandId / cursor / pageSize (≤ 100) | `NEVER` | CONFIRMED shape (paging + version) | Q-30 |

## 5. Matrix — Events (0.4)

| # | Event / Receipt | Kind | Tier | Actor kind required | Required scope | Object permission (target) | Audit fields | Retry class (default) | Schema status | Q refs |
|---|---|---|---|---|---|---|---|---|---|---|
| E1 | `EventEnvelope` (canonical event emit) | event | N/A | SYSTEM / PROVIDER / HRP-side source | `organizationId` + sourceSystem | aggregate canonical + version | eventId / organizationId / aggregateType/id/version / occurredAt / recordedAt / correlationId / sourceSystem / deliveryChannel / watermark | n/a (emit, không retry ở schema) | CONFIRMED shape (10 aggregate types; PUSH_WEBHOOK default — Q-31; correction + watermark) | Q-3, Q-30, Q-31, Q-33 |
| E2 | `EventReceipt` (duplicate/out-of-order/correction) | event | N/A | SYSTEM | `organizationId` | eventId + payloadDigest | eventId / payloadDigest / duplicateKind / reasonCode (nếu GAP/CORRECTION) | n/a (reconcile) | CONFIRMED shape (5 duplicate kinds; GAP yêu cầu reasonCode) | Q-30 |
| E3 | `ProfileCreationEvent` | event | N/A | SYSTEM | `organizationId` + submittedBy/executingActor/creditedCreator/source | laborProfileId + version | envelope + attribution (4 fields PHÂN BIỆT) + creationLabel (SUBMITTED/APPLIED/HRP_REVIEWED) | n/a | CONFIRMED shape (Q-16: 3 label tách biệt marker proposed; UNAVAILABLE attribution KHÔNG đoán) | Q-3, Q-7, Q-13, Q-16, Q-30 |
| E4 | `PlacementCaseCreationEvent` | event | N/A | SYSTEM | `organizationId` + attribution | placementCaseId + version | envelope + attribution + creationLabel + optional reviewReference | n/a | CONFIRMED shape | Q-3, Q-7, Q-16, Q-30 |
| E5 | `DeliveryReportingEvent` (outbox handoff) | event | N/A | PROVIDER / SYSTEM | `organizationId` + provider/connectionId | target canonical (Talent/Client) | eventId / state (SENT/DELIVERED/FAILED/UNKNOWN/SUPPRESSED) / reasonCode | n/a (callback) | CONFIRMED shape (5 states; UNKNOWN KHÔNG đoán) | Q-30, Q-31, Q-33 |

## 6. Matrix — Mapping DTOs (0.4)

| # | Mapping DTO | Kind | Tier | Actor kind required | Required scope | Object permission (target) | Audit fields | Retry class (default) | Schema status | Q refs |
|---|---|---|---|---|---|---|---|---|---|---|
| M1 | `ExternalContactLink` | mapping (state) | N/A | USER / SERVICE | `organizationId` + provider/connectionId | aggregate canonical (Talent/Client) — KHÔNG dùng external attr value | organizationId / provider / connectionId / external / state / aggregateVersion / evidenceRefs | `NEVER` (mutation) | CONFIRMED shape (3 states: EXACT/POSSIBLE/UNRESOLVED; NEW_PROFILE KHÔNG mapping state) | Q-29, Q-30 |
| M2 | `ConversationLink` | mapping (state) | N/A | USER / SERVICE | `organizationId` + provider/connectionId | conversationId canonical | organizationId / conversationId/version / externalRefs[] / currentRevision / historyRevisions | `NEVER` (mutation) | CONFIRMED shape (externalRefs[] + historyRevisions; mutation target lấy canonical, KHÔNG Chatwoot attributes) | Q-29, Q-30 |

## 7. Matrix — Routing / Analytics / KPI / AI (0.5)

| # | DTO | Kind | Tier | Actor kind required | Required scope | Object permission (target) | Audit fields | Retry class (default) | Schema status | Q refs |
|---|---|---|---|---|---|---|---|---|---|---|
| R1 | `RoutingPool` (SOURCE_ALLOCATION) | config (write) | N/A | USER (manager capability — runtime gate) | `organizationId` + actor | n/a (config) | version / updatedAt / updatedBy | `NEVER` (config) | CONFIRMED shape (Q-34: SOURCE_ALLOCATION yêu cầu fixedOwner; KHÔNG weights) | Q-3, Q-30, Q-34 |
| R2 | `RoutingPool` (WEIGHTED_DISTRIBUTION) | config (write) | N/A | USER (manager capability — runtime gate) | `organizationId` + actor | n/a (config) | version / updatedAt / updatedBy | `NEVER` | CONFIRMED shape (Q-34: weights ≥ 1; KHÔNG fixedOwner; total weight > 0) | Q-3, Q-30, Q-34 |
| R3 | `RoutingPool` (HYBRID) | config (write) | N/A | USER (manager capability — runtime gate) | `organizationId` + actor | n/a (config) | version / updatedAt / updatedBy | `NEVER` | CONFIRMED shape (Q-34: yêu cầu cả fixedOwner + weights); runtime gate HYBRID policy unknown | Q-3, Q-30, Q-34 |
| R4 | `RoutingDecision` | internal (trace) | N/A | SYSTEM | `organizationId` + actor (audit) | poolId + poolVersion | selectedRecipient / selectionReason / reservation / decisionAt | n/a | CONFIRMED shape (selectionReason 3 giá trị; reservation fence) | Q-30, Q-34 |
| A1 | `MetricDefinition` (read) | query | N/A | USER / SERVICE | `organizationId` + actor | metricId | version / asOf / attributionState / attributionReasonCode (UNAVAILABLE) | `NEVER` | CONFIRMED shape (Q-9: 3 metricId `profile.created/updated/submitted` PHẢI khác nhau; Q-30: UNAVAILABLE yêu cầu reasonCode) | Q-9, Q-30 |
| A2 | `MetricValue` | query | N/A | USER / SERVICE | `organizationId` + actor | metricId | value / asOf / version / attributionState (UNAVAILABLE value = 0 placeholder) | `NEVER` | CONFIRMED shape (UNAVAILABLE value KHÔNG đoán số — Q-30) | Q-30 |
| K1 | `KPIAssignment` | config (write) | N/A | USER (manager capability — runtime gate) | `organizationId` + actor (manager) | assignmentId + targetType + period + targetValue | appliedRevision / appliedAt / operationReference | `NEVER` (manager-only) | CONFIRMED shape (cohort periodStart ≤ periodEnd; manager marker) | Q-3, Q-30, Q-35 |
| K2 | `KPIRevision` | config (write) | N/A | USER (manager capability — runtime gate) | `organizationId` + actor (manager) | assignmentId + expectedRevision | revisionId + reasonCode (audit) | `NEVER` | CONFIRMED shape (manager-only; new target value/rate required) | Q-3, Q-30, Q-35 |
| K3 | `KPIPropose` | propose-only | N/A | USER (sale) / SERVICE (AI) | `organizationId` + actor | assignmentId | proposalId + proposedAt | `NEVER` (propose-only, không mutate target) | CONFIRMED shape (strict reject `mutateTarget`; rationale no URL/base64) | Q-3, Q-30, Q-35 |
| AI1 | `AIProposal` (read) | propose (read) | N/A | USER / SERVICE | `organizationId` + actor | proposalId + revisionId (canonical) | fields[] / uncertainty / providerRef / createdBy / createdAt | `NEVER` (proposal) | CONFIRMED shape (strict reject `commandPayload`/`embedCommandPayload`; Q-37) | Q-3, Q-30, Q-37 |
| AI2 | `ApplyAIProposal` | command | INBOUND_DEFAULT | USER (manager capability — runtime gate) | `organizationId` + actor (manager) | proposalId + revisionId + acceptedFieldPaths[] + expectedTargetVersion | per-field outcome APPLIED/REJECTED/SKIPPED / appliedVersion / reasonCode | `NEVER` nếu VALIDATION; `REVIEW_REQUIRED` nếu POLICY_REJECTION | CONFIRMED shape (Q-37: acceptedFieldPaths subset-of-proposal runtime enforce) | Q-3, Q-30, Q-37 |
| AI3 | `AIProviderConfig` (read) | query | N/A | USER (operator capability — runtime gate) | `organizationId` + actor | providerId | version / createdAt / updatedAt | `NEVER` (read) | CONFIRMED shape (Q-36: read DTO strict reject apiKey/accessKey/bearerToken/.../rawSecret) | Q-30, Q-36 |

## 8. Matrix — Ports / Provider / Gateway interfaces (0.3h)

| # | Interface / DTO | Kind | Tier | Actor kind required | Required scope | Object permission (target) | Audit fields | Retry class (default) | Schema status | Q refs |
|---|---|---|---|---|---|---|---|---|---|---|
| P1 | `WorkerPort.enqueue` | port (internal) | N/A | SERVICE | `organizationId` + actor (audit) | n/a (port contract) | recordedAt / actor / commandId / queueName | n/a (port abstract) | CONFIRMED shape (PORTS_FORBIDDEN_IMPORTS Prisma/Next) | Q-30 |
| P2 | `SchedulerPort.enqueue` | port (internal) | N/A | SERVICE | `organizationId` + actor (audit) | n/a | recordedAt / actor / commandId / scheduledAt | n/a | CONFIRMED shape | Q-30 |
| P3 | `QueuePort.enqueue` | port (internal) | N/A | SERVICE | `organizationId` + actor (audit) | n/a | recordedAt / actor / commandId / queueName | n/a | CONFIRMED shape | Q-30 |
| P4 | `SecretPort.get` (handle) | port (internal) | N/A | SERVICE | `organizationId` + actor (audit) | secretId + secretVersion | recordedAt / actor / commandId / secretRef | n/a | CONFIRMED shape (SecretRef opaque + tier; KHÔNG rawSecret) | Q-30 |
| P5 | `ObjectStoragePort.upload` | port (internal) | N/A | SERVICE | `organizationId` + actor (audit) | evidenceId + ttl (≤ 60s cho PII) | recordedAt / actor / commandId / handle | n/a | CONFIRMED shape (signed URL TTL ≤ 60s cho PII/CCCD) | Q-30 |
| G1 | `HrpGatewayCallContext` (3 tiers) | gateway (internal) | INBOUND_DEFAULT / INBOUND_REVIEWER / PRIVILEGED_MERGE | USER / SERVICE / DELEGATED_USER (tier-specific) | `organizationId` + actor + (tier-specific) | n/a (gateway context) | recordedAt / actor / commandName / tier | n/a | CONFIRMED shape (Q-3: actor + source; tier-specific rules) | Q-3, Q-30 |
| G2 | `WebhookReceiver` (rawBody) | provider (inbound) | N/A | SYSTEM (provider side) | `organizationId` + provider/connectionId | rawBody + headers + expectedAlgorithms | recordedAt / actor / commandId / provider / connectionId | n/a (verify before parse) | CONFIRMED shape (raw Uint8Array + raw headers; WEBHOOK_SIGNATURE_ALGORITHMS 3 allowlist) | Q-30, Q-33 |
| PR1 | `ProviderConnectionRef` (capabilityToken) | provider (ref) | N/A | SERVICE | `organizationId` + provider/connectionId | capabilityToken opaque | recordedAt / actor / commandId / provider | n/a | CONFIRMED shape (capabilityToken opaque) | Q-30, Q-33 |
| PR2 | `ChatwootNormalizedWebhook` | provider (normalized) | N/A | SYSTEM | `organizationId` + provider/connectionId | accountId/inboxId/conversationId/... | recordedAt / actor / commandId / provider | n/a | CONFIRMED shape (Q-33: provider KHÔNG giữ policy tuyển dụng) | Q-30, Q-33 |
| PR3 | `ZaloOaNormalizedWebhook` | provider (normalized) | N/A | SYSTEM | `organizationId` + provider/connectionId | oaId/userId | recordedAt / actor / commandId / provider | n/a | CONFIRMED shape (Q-33: Zalo protocol chưa xác minh; runtime gate bind signature) | Q-30, Q-33 |
| PR4 | `ProviderProbe` | provider (health) | N/A | SERVICE | `organizationId` + provider/connectionId | n/a | recordedAt / actor / commandId / outcome | `BOUNDED_SAME_KEY` (probe retry) | CONFIRMED shape | Q-30 |

## 9. Audit requirements — trục riêng (tổng quát)

Mọi command/query/event đều cần audit sau (subset tối thiểu):

- **effectiveAt**: timestamp nghiệp vụ — `occurredAt` cho interaction (Q-22);
  `availableFromDate` cho AVAILABLE_FROM_DATE (Q-15). Schema
  `IsoTimestampSchema` bind ISO 8601 với offset; runtime HRP gate
  quyết business clock anchor (`Asia/Ho_Chi_Minh`).
- **recordedAt**: server-set timestamp — schema
  `IsoTimestampSchema`; audit log có bound retention.
- **actor**: USER / SERVICE / DELEGATED_USER (Q-3); runtime gate
  bind principal + delegationRef; KHÔNG giả actor từ assignee.
- **source**: HRP_UI / INTEGRATION (CHATWOOT/ZALO_OA) / HRP_INTERNAL
  / PROVIDER / SYSTEM; runtime gate bind principal/source.
- **target**: canonical id (LaborProfile/PlacementCase/ClientContact)
  + `expectedVersion` (optimistic concurrency); mutation KHÔNG tin
  Chatwoot attributes (Q-29).
- **commandId** + **commandName** (allowlist `HRP_GATEWAY_METHODS`).
- **version**: aggregate version server-set, monotonic; runtime gate
  chốt `recordedVersion` audit.
- **result**: APPLIED/ACCEPTED/FAILED/SKIPPED + outcome-specific
  fields. ACCEPTED kèm `pendingReference: OperationReferenceSchema`
  (Q-32).

## 10. Runtime gate (PROPOSED — HRP-owned) — PENDING

Matrix này **KHÔNG quyết** runtime policy. Các item sau thuộc HRP
gate, chưa có schema hay implementation:

- **Capability check**: tier (INBOUND_DEFAULT/INBOUND_REVIEWER/
  PRIVILEGED_MERGE) mapping per `HRP_GATEWAY_METHODS` (Q-3 + Q-7).
- **Principal binding**: IdP/JWT mapping; delegationRef opaque (Q-3).
- **organizationId scope**: tenant/RLS policy (Q-1 + Q-29).
- **Object permission**: target canonical id + `expectedVersion`
  verify trước khi apply mutation.
- **One-active-case**: per LaborProfile (Q-19); runtime HRP gate
  chốt active set.
- **Merge approval**: privileged tier + dual-control (Q-7).
- **CCCD residency + scan**: VN storage, retention, TTL (Q-7 +
  Master §10.4); gate riêng.
- **HRP review pre/post-apply**: workflow chưa chốt (Q-7 +
  Q-16); phase 10.
- **Signature/JWT/webhook algorithm**: Q-33 — KHÔNG tự chọn; cần
  Auditor review shared contracts ở bundle cuối.
- **Idempotency retention**: digest algorithm/canonicalization,
  retention/replay expiry (Q-5).
- **Fencing**: stale worker/lease expiry, fenceToken (Q-26).
- **DNC cut-off**: dispatch authorization/fencing + stale cache
  fail closed (Q-26).
- **Retention cleanup**: receipt/job/outbox; VN residency cho CCCD.

## 11. BoD aggregate & secret operator (Backlog §0.6 AC #3)

- **BoD aggregate**: KHÔNG mặc định transcript/evidence; schema
  `analytics.ts MetricValue` + `analytics.ts MetricAggregateRead`
  bind shape giá trị (count/rate/duration/currency). Nếu metric cần
  transcript/evidence, schema KHÔNG tự đề xuất — runtime HRP gate
  quyết (Master §13.5–8).
- **Secret operator** (`SecretPort` 0.3h): KHÔNG mặc định đọc CCCD/
  transcript. SecretPort.get chỉ trả handle theo tier; caller muốn
  raw secret phải qua SecretPort + capability check. Schema bind
  opaque ref + tier (PLATFORM/TENANT/OPERATOR); schema strict reject
  rawSecret.

## 12. Cross-reference Q (decision-register.md)

Matrix chạm tới các Q sau trong `docs/contracts/decision-register.md`
(Q-1..Q-37). Q còn open vẫn ghi PROPOSED; KHÔNG tự biến thành
CONFIRMED ở matrix.

- **Q-1** (confirmed): HRP SoR, cấm core credentials/Prisma từ
  Integration. Matrix: mọi command có audit core-org/scope.
- **Q-2** (proposed): envelope ABI v1; matrix: schema bind literal
  `schemaVersion: '1'`.
- **Q-3** (proposed): source/actor (USER/SERVICE/DELEGATED_USER);
  matrix: actor kind + scope + required delegationRef.
- **Q-4** (proposed): durable operation ACCEPTED; matrix: ACCEPTED
  outcome có OperationReference (Q-32) + audit `operationReference`.
- **Q-5** (confirmed semantics / proposed binding): idempotency
  namespace + same-key replay/conflict; matrix: `NEVER` nếu
  IDEMPOTENCY_CONFLICT.
- **Q-6** (unknown): case domain open-status/transitions; matrix:
  Q-19 unknown — runtime gate.
- **Q-7** (unknown): HRP review pre/post-apply; matrix: reviewer
  capability PROPOSED.
- **Q-8** (unknown): managed mode (HRP_MANAGED/CLIENT_MANAGED);
  matrix: EFFECTIVE workflow PROPOSED.
- **Q-9** (unknown): KPI attribution; matrix: 3 metricId
  `profile.created/updated/submitted` schema bind distinct
  (CONFIRMED AC), nhưng attribution policy runtime HRP-owned.
- **Q-10** (unknown): integration runtime (auth/signature/ACK);
  matrix: Q-33 protocol chưa xác minh — Auditor review.
- **Q-11** (source discrepancy): connector v1.1 vs source HRP;
  matrix: ClientContact/SalesOpportunity/ClientInteraction ghi
  PROPOSED (Q-23 unresolved).
- **Q-13** (đã chốt): EXACT_MATCH qua staff review; matrix: REVIEW
  required.
- **Q-14** (đã chốt): fill-missing only; matrix: patch whitelist
  (CONFIRMED AC); runtime gate enforce (PROPOSED).
- **Q-15** (đã chốt baseline timezone): `Asia/Ho_Chi_Minh`; matrix:
  AVAILABLE_FROM_DATE yêu cầu ngày lịch + future-date business
  clock PROPOSED.
- **Q-16** (PROPOSED): submission lifecycle review pre/post; matrix:
  SUBMITTED/APPLIED/HRP_REVIEWED 3 label marker PROPOSED.
- **Q-17** (PROPOSED): PreviewResolver redacted PII; matrix: read
  query reviewer capability PROPOSED.
- **Q-18** (PROPOSED): DNC reason OTHER + note/retention; matrix:
  DNC command schema tách riêng intake (CONFIRMED AC).
- **Q-19** (unknown): open-status set/active/transitions; matrix:
  runtime gate.
- **Q-20** (đã chốt): CLOSED/SUCCESS KHÔNG tự EFFECTIVE; matrix:
  closeReason 9 giá trị CONFIRMED; EFFECTIVE workflow PROPOSED.
- **Q-21** (unknown): auth/delegation protocol Talent/Client;
  matrix: actor runtime auth/delegation PROPOSED.
- **Q-22** (UNKNOWN): occurredAt ≤ effectiveAt ≤ recordedAt order
  schema KHÔNG enforce; matrix: 3 timestamp fields PHÂN BIỆT
  (CONFIRMED AC).
- **Q-23** (UNRESOLVED): Client required context; matrix:
  recordClientInteraction có `UNKNOWN` outcome nhưng KHÔNG đủ
  chứng minh AC PASS.
- **Q-24** (CONFIRMED): PlacementCaseStageSchema 8 giá trị;
  matrix: schema enum allowlist CONFIRMED.
- **Q-25** (CONFIRMED shape / PROPOSED binding): Availability schema;
  matrix: AVAILABLE_FROM_DATE yêu cầu ngày; future-date business
  clock PROPOSED.
- **Q-26** (PROPOSED): suppression target kind 3 + dispatch fencing;
  matrix: 3 target kinds schema CONFIRMED; runtime gate
  (Q-26) PROPOSED.
- **Q-27** (PROPOSED): NextAction CREATE statuses + snooze/occurrence;
  matrix: CREATE status ⊆ {OPEN, CANCELLED}; snoozeMode tách riêng
  status (CONFIRMED AC); occurrenceKey schema bind.
- **Q-28** (PROPOSED): planning batch per-item outcome; matrix:
  4 outcome schema bind CONFIRMED (AC); per-item schema enforced.
- **Q-29** (đã chốt): ClientCompany đã có schema HRP (connector
  §0); matrix: `clientCompanyId` opaque qua ClientTargetRef.
- **Q-30** (nguyên tắc): schema validation AC; marker audit; runtime
  gate HRP-owned. Matrix phân biệt rõ cột "Schema status"
  (CONFIRMED AC) vs runtime gate (PROPOSED).
- **Q-31** (đề xuất kỹ thuật): transport `PUSH_WEBHOOK default`;
  matrix: event deliveryChannel default + `EVENT_PATCH_FORBIDDEN`
  marker `dualChannelWithoutFencing`/`dualChannelWithoutDedupe`.
- **Q-32** (đóng): contract ACCEPTED bind canonical
  OperationReference; matrix: ACCEPTED outcome có `pendingReference:
  OperationReferenceSchema` (CONFIRMED AC); implementation query
  API để V7.9a.
- **Q-33** (signature provider protocol chưa xác minh): matrix:
  signature provider VÀ API auth là 2 ranh giới riêng; KHÔNG tự
  đặt JWT/signature cho Zalo khi chưa xác minh; Auditor review
  shared contracts ở bundle cuối.
- **Q-34** (schema bind CONFIRMED): routing strategy phân biệt;
  matrix: SOURCE_ALLOCATION vs WEIGHTED_DISTRIBUTION vs HYBRID
  schema bind.
- **Q-35** (schema bind CONFIRMED): KPI namespace
  `phase10-experimental`; matrix: reject `canonical-ready`.
- **Q-36** (schema bind CONFIRMED): AI provider config read DTO
  strict reject raw secret; matrix: read DTO CONFIRMED AC.
- **Q-37** (schema bind CONFIRMED): AI proposal không arbitrary
  payload/direct write; matrix: schema strict reject
  `commandPayload`/... + apply via envelope command.

## 13. Kết luận

- **Schema validation (CONFIRMED — AC đã đạt 0.1–0.5)**: 313/313
  fixtures PASS, typecheck strict PASS. Matrix này KHÔNG thay schema.
- **Runtime gate (PROPOSED — HRP-owned)**: tất cả item ở §10 thuộc
  runtime gate; HRP-owned PR quyết + audit bundle Gate 0 trước freeze.
- **Không tự PASS matrix = freeze Gate 0**: Owner xác nhận Gate 0
  trước backend.

## 14. Audit & bàn giao

- **Audit REQUIRED**: matrix chạm auth/cross-org/data reliability +
  signature/JWT/webhook (Q-33). Gom bundle Gate 0 trước freeze.
- **Coder self-check**: matrix không build; chỉ markdown.
- **Head**: `414c54bfa2e227ec1a25694310e48908e0d67abe` (chưa commit).
