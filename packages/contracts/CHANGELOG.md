# Changelog — @hrp-engagement/contracts

Mọi thay đổi theo Gate 0 task (`G0/0.x`). Format theo
[Keep a Changelog](https://keepachangelog.com/) + semver.

## Compatibility policy

- **Major** bump = breaking contract (Gate 0 freeze → 0.1.x).
- **Minor** bump = thêm field optional, marker mới (audit).
  - **Patch** bump = fix schema binding, thêm marker `*_PATCH_FORBIDDEN`
  chỉ audit (Q-30 nguyên tắc).
- Consumers pin `@hrp-engagement/contracts@^0.0.x` hoặc exact
  `<version>` cho Gate 0. KHÔNG dùng `*` hay `latest`.

## [0.0.8-g0.8-fixes] — 2026-09-13

### Breaking change (F1–F5 fixes, Owner chỉ thị G0/0.8)

- **F2 (HRP_UI source discriminator)**: `IntakeContextRefSchema`
  + `InteractionContextRefSchema` đổi từ `{ provider, connectionId }`
  sang `{ source: CommandSourceSchema, externalConversationId?,
  externalAccountId?, externalMessageId? }`. Consumers cần wrap
  inline shape qua `CommandSourceSchema`:
  + HRP_UI → `{ kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null }`
  + INTEGRATION → `{ kind: 'INTEGRATION', provider: 'CHATWOOT' | 'ZALO_OA',
    connectionId }`.
  Tests đã migrate (test-helpers.mjs export `src()`/`ext()`).
- **F3 (CalendarDate reuse)**: 5 chỗ inline `z.string().regex(...)` →
  `CalendarDateSchema` (primitive từ 0.1; leap year/Feb 30 validate).
  + `identity.ts IdentitySignalSchema.dob`
  + `intake.ts IntakeSubmissionPayloadSchema.dob`
  + `analytics.ts MetricAggregateReadRequestSchema.periodStart/End`
  + `kpi.ts KPIAssignmentInputSchema.cohort.periodStart/End`
  + `scheduling.ts PlanningBatchAvailabilityItemSchema.availableFromDate`
- **F4 (DNC reasons canonical 4 + legacy PRIVACY alias)**:
  + `commands/dnc.ts` mới: `DncReasonSchema` canonical 4 giá trị
    (`CANDIDATE_REQUEST` / `PRIVACY_REQUEST` / `HRP_POLICY` / `OTHER`).
  + `LegacyDncReasonSchema` 3 giá trị (`CANDIDATE_REQUEST` / `PRIVACY` / `OTHER`).
  + `DncReasonAcceptAliasSchema` chấp nhận cả canonical + legacy
    (compatibility delta `PRIVACY` → `PRIVACY_REQUEST`).
  + `normalizeDncReason(input)` map legacy → canonical + `wasLegacy`
    audit marker.
  + `suppression.ts CommitSuppressionInputSchema.reason` giờ reuse
    `DncReasonSchema` (chỉ canonical 4 giá trị; suppression là đích
    runtime, không backward-compat).
  + `identity.ts DncActionSchema.reason` giờ dùng
    `DncReasonAcceptAliasSchema` (caller-side; staff form có thể nhận
    legacy alias).
- **F5 (AI evidence refs reuse CommandEvidenceRefSchema)**:
  + `ai-proposals.ts AIProposalSchema.evidenceRefs` +
    `AIProposalFieldSchema.evidenceRefs` đổi từ inline shape
    `{ evidenceId, evidenceSchemaVersion, kind }` →
    `CommandEvidenceRefSchema` (`{ evidenceId, kind, organizationId,
    connectionId? }`). Reference KHÔNG là quyền đọc; KHÔNG cấp phép
    gửi CCCD/PII tới model.

### Added (F1–F5 fixes)

- `src/commands/merge-review.ts` — F1 placeholder schemas
  PROPOSED/UNAVAILABLE:
  + `MergeLaborProfilesInput/ResultSchema`
  + `CommitReviewDecisionInput/ResultSchema`
  + `ResolvePossibleMatchInput/ResultSchema`
  + `SupersedeReviewStatusInput/ResultSchema`
  + Tất cả yêu cầu `proposedAuditRef ∈ {Q-19, Q-23, Q-37}` (HRP-owned
    dependencies) qua `MERGE_REVIEW_PROPOSED_DEPENDENCIES`. Privileged
    merge tách khỏi inbound default gateway (đã ở 0.3h).
- `src/commands/dnc.ts` — canonical + legacy DNC reasons.
- `src/index.ts` export `dnc.js`, `merge-review.js`. `PACKAGE_VERSION`
  bump `0.0.7-g0.7` → `0.0.8-g0.8-fixes`.
- `tests/fixtures-fix-f1-f5.test.mjs` — 33 fixtures mới (385 tổng).
- `tests/test-helpers.mjs` — helpers `src()` + `ext()` cho F2 test migration.

### Fixed
- F1: Tên method/proposed marker không bị hiểu là typed contract đã
  hoàn thiện; gate check + matrix §3 đồng bộ.
- F2: HRP_UI source KHÔNG nhận connectionId; INTEGRATION bắt buộc
  connectionId; source/context mâu thuẫn (external* ở HRP_UI) reject.
- F3: ngày không tồn tại (Feb 30, tháng 13) reject; leap year 2024-02-29
  OK; 2026-02-29 reject.
- F4: DNC payload đi xuyên identity DNC + suppression không lệch enum;
  HRP_POLICY membership KHÔNG tự cấp capability (runtime gate Q-37).
- F5: malformed inline AI evidence refs reject; standard refs nhận.

### Total fixtures
- 372 → **385** (+13 F1–F5).

## [0.0.7-g0.7] — 2026-09-13

### Changed (G0/0.7)
- Thêm fixtures coverage trong `tests/fixtures-coverage-0.7.test.mjs`
  (+59 test, tổng 313 → **372**).
- `tests/fixtures-coverage-0.7.test.mjs` cover AC §0.7:
  3 match outcomes (EXACT/POSSIBLE/NEW), CLOSED + 9 closeReason,
  date condition (AVAILABLE_FROM_DATE + leap year Feb 29),
  read-only CurrentRelationship (mutation reject), malformed envelopes
  (actor/source/version), evidence URL/base64 reject, raw transcript
  reject, no-op update (APPLIED/NOOP), retry errors
  (IDEMPOTENCY_CONFLICT, VERSION_CONFLICT), cross-aggregate leak,
  Q-32 pendingReference canonical, BoD aggregate, secret read reject,
  marker consistency.
- README viết lại theo 0.3a–0.7 public surface; status cập nhật;
  versioning & compatibility policy ghi rõ.
- `inventory.md` cập nhật 0.6 + 0.7 (markdown PASS, không test runtime).
- `handoff-g0-0.6.md` + `handoff-g0-0.7.md` + manifest files.

### Added
- `docs/contracts/authorization-policy-matrix.md` (G0/0.6) — permission /
  error / policy boundary matrix cho 23 file contracts (50+ dòng).
- `docs/contracts/handoff-g0-0.6.md` + `.manifest.txt`.
- `docs/contracts/handoff-g0-0.7.md` + `.manifest.txt`.
- `packages/contracts/README.md` (viết lại theo 0.3a–0.7).
- `packages/contracts/CHANGELOG.md` (file này).

### Fixed
- Fixtures cũ chưa cover Q-32 `pendingReference` chính xác; 0.7 thêm
  3 test riêng cho ACCEPTED có pendingReference canonical + APPLIED/
  FAILED/SKIPPED KHÔNG có pendingReference.

## [0.0.6-g0.5] — 2026-09-13

### Breaking change
- **`PlanningBatchItemResultSchema.pendingId: z.string()` → `pendingReference: OperationReferenceSchema`** (canonical `{ kind: 'COMMAND_OPERATION', operationId: CommandIdSchema }`). Consumers cũ phải cập nhật payload. Q-32 đóng — contract ACCEPTED có reference/query semantics thuộc Gate 0; implementation query API runtime để Phase V7.9a backend.

### Added (G0/0.5)
- `src/commands/routing.ts` — `ROUTING_STRATEGIES`
  (SOURCE_ALLOCATION / WEIGHTED_DISTRIBUTION / HYBRID), RoutingPool,
  RoutingReservation, RoutingDecision. (Q-34 schema bind.)
- `src/commands/analytics.ts` — MetricGrain / Unit / Period /
  AttributionState, MetricDefinition, MetricValue, AggregateRead,
  ProfileLifecycleMetricBinding (3 lifecycle metricId khác nhau,
  Q-9 + Q-30).
- `src/commands/kpi.ts` — KPIAssignment / Revision / Propose / Read;
  manager-owned write; sale/AI chỉ read/propose; namespace
  `phase10-experimental` (Q-35).
- `src/commands/ai-proposals.ts` — AIProposal (revision / fields /
  evidence / uncertainty / context), ApplyAIProposal per-field outcome;
  strict reject `commandPayload` (Q-37).
- `src/commands/ai-provider-config.ts` — SecretRef opaque + tier;
  AIProviderConfigRead strict reject apiKey / accessKey / bearerToken /
  rawSecret (Q-36); dataPolicy semantics (SANDBOX + INTERNAL_ONLY
  xung đột, NO_PII + PII_REDACTED xung đột).
- `tests/routing-analytics-kpi-ai.test.mjs` — 33 fixtures mới.

### Changed
- `tests/scheduling.test.mjs` — sửa `pendingId` → `pendingReference`
  (Q-32).
- `index.ts` — re-export 5 file mới + `PACKAGE_VERSION` bump
  `0.0.5-g0.4` → `0.0.6-g0.5`.

### Total fixtures
- 280 → **313** (+33).

## [0.0.5-g0.4] — 2026-09-13

### Added (G0/0.4)
- `src/commands/queries.ts` — ContextQuery / ReadOnlyIdentityPreview /
  AllowedActionsQuery / ContactabilityCheck / ConstantsSnapshot /
  ResolveContactByExternal / ListExternalContactLinks.
- `src/commands/events.ts` — EventEnvelope + EventReceipt +
  ProfileCreationEvent / PlacementCaseCreationEvent +
  DeliveryReportingEvent.
- `src/commands/mappings.ts` — ExternalContactLink
  (EXACT_MATCH / POSSIBLE_MATCH / UNRESOLVED) + ConversationLink.
- `tests/queries-events-mappings.test.mjs` — fixtures mới.

### Total fixtures
- 220 → **280** (+60).

## [0.0.4-g0.3g-3h] — 2026-09-13

### Added (G0/0.3g + 0.3h)
- `src/commands/outbox.ts` — internal transactional outbox;
  delivery reporting event (5 states: SENT / DELIVERED / FAILED /
  UNKNOWN / SUPPRESSED); transport `PUSH_WEBHOOK default` (Q-31).
- `src/commands/gateway.ts` — HRP_GATEWAY_METHODS (17) +
  HrpGatewayCallContext 3 tiers; WEBHOOK_SIGNATURE_ALGORITHMS
  allowlist 3 (Q-33 marker).
- `src/commands/providers.ts` — Chatwoot / Zalo OA normalized
  webhook; ProviderConnectionRef capabilityToken opaque.
- `src/commands/ports.ts` — WorkerPort / SchedulerPort / QueuePort /
  SecretPort / ObjectStoragePort; PORTS_FORBIDDEN_IMPORTS
  Prisma/Next.js runtime.
- `tests/gateway-providers-ports.test.mjs` + `tests/outbox.test.mjs`.

### Total fixtures
- 137 → **220** (+83).

## [0.0.3-g0.3e-3f] — 2026-09-13

### Added (G0/0.3e + 0.3f)
- `src/commands/availability.ts` — AvailabilityPatch, AVAILABLE_FROM_DATE
  yêu cầu availableFromDate; DO_NOT_CONTACT đi kèm suppression event.
- `src/commands/suppression.ts` — DNC 3 target kinds
  (LABOR_PROFILE / EXTERNAL_CONTACT / SUPPRESSED_RECIPIENT_FENCE);
  Q-26.
- `src/commands/next-action.ts` — NextAction create / update;
  CREATE statuses ⊆ {OPEN, CANCELLED} + snooze/dismiss tách DONE;
  occurrenceKey cho reminder dedupe (Q-27).
- `src/commands/scheduling.ts` — planning batch per-item outcome
  (APPLIED / ACCEPTED / FAILED / SKIPPED); Q-28.

### Total fixtures
- 32 → **137** (+105).

## [0.0.2-g0.3a-3d] — 2026-09-13

### Added (G0/0.3a–0.3d)
- `src/commands/identity.ts` — `createOrMatchLaborProfile`,
  MatchingOutcome (EXACT_MATCH / POSSIBLE_MATCH / NEW_PROFILE);
  Q-1, Q-13.
- `src/commands/evidence.ts` — EvidenceRef opaque.
- `src/commands/profile.ts` — `updateLaborProfile`, patch whitelist,
  fill-missing only; Q-14.
- `src/commands/intake.ts` — IntakeSubmissionPayload,
  StaffReviewConfirmation, PreviewResolver (read-only).
- `src/commands/placement-case.ts` — OpenPlacementCase /
  UpdatePlacementCase / ClosePlacementCase; Q-19 / Q-20 / Q-24.
- `src/commands/interactions.ts` — RecordTalentInteraction /
  RecordClientInteraction (Q-22 / Q-23).

### Total fixtures
- 32 → **137** (cộng dồn +105 qua 0.3a–0.3d).

## [0.0.1-g0.1] — 2026-09-13

### Added (G0/0.0–0.2)
- `src/enums.ts` — placement case stages, CLOSED status +
  closeReason (9 giá trị), availability, current relationship
  (read-only), next-action, matching outcomes, evidence kind.
- `src/primitives.ts` — actor (claim), source, organization, schema
  version, idempotency key, correlation id, canonical id, ISO
  timestamp, calendar date, evidence ref, command name allowlist.
- `src/errors.ts` — error taxonomy 10 codes + retry defaults + HTTP
  hint + helper `makeError`.
- `src/envelopes.ts` — request base, ACCEPTED / APPLIED / FAILED
  response shapes, operation reference, idempotency digest helper.
- 32 fixtures (`tests/enums.test.mjs`, `tests/envelopes.test.mjs`,
  `tests/errors.test.mjs`).

## Notes

- **Q-30** (nguyên tắc): schema validation AC, marker chỉ audit,
  runtime gate HRP-owned. Phân biệt rõ trong từng file.
- **Q-33**: protocol chưa xác minh — KHÔNG tự chọn; cần Auditor
  review ở bundle cuối.
- **Q-32** (đóng ở 0.5): contract ACCEPTED bind canonical
  OperationReference; implementation query API để Phase V7.9a.
- **Independent audit Gate 0**: vẫn PENDING; T1 self-check không
  thay Auditor. Bundle gom trước Gate 0 freeze.
