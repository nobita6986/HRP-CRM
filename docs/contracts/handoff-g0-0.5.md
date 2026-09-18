# G0/0.5 — Handoff

HEAD: 414c54bfa2e227ec1a25694310e48908e0d67abe
Branch: main
Date: 2026-09-13 12:25 (UTC+7)
Package version: 0.0.6-g0.5
Coder: T1
Owner: Chủ nhân (review bundle trước Gate 0 freeze)
Auditor: PENDING — gom bundle Gate 0 trước freeze.

Nguồn: Backlog Gate0 §Task 0.5, Master V2.6 §13.10.3 + §13.10.5–6,
hrp-connector v1.1 HEAD 414c54b.
Dependency 0.2 + 0.4 có self-check; chưa freeze / chưa independent audit PASS.

## AC & evidence

| AC | Trạng thái | Evidence |
|---|---|---|
| Routing source allocation khác weighted recipient distribution; pool/eligible/weight/cap/version/decision/reservation | DONE self-check | `routing.ts`: 3 strategy (SOURCE_ALLOCATION/WEIGHTED_DISTRIBUTION/HYBRID), RoutingPoolSchema superRefine ràng buộc shape từng strategy; RoutingDecision + RoutingReservation fence. Tests: `routing-analytics-kpi-ai.test.mjs` 5 fixtures cho routing. |
| MetricDefinition có grain/unit/period/cohort/source/as-of/version/attribution; profile created/updated/submitted khác nhau; thiếu nguồn không đoán | DONE self-check | `analytics.ts`: 4 allowlist (grain/unit/period/attribution), MetricAttributionState AVAILABLE/UNAVAILABLE + reasonCode, ProfileLifecycleMetricBindingSchema superRefine 3 metricId PHẢI khác nhau. Tests cover. |
| KPI assign/revise manager-owned; sale/AI chỉ read/propose | DONE self-check | `kpi.ts`: KPIAssignmentInput (manager assignedBy), KPIRevision (manager revisedBy), KPIPropose (sale/AI proposedBy; schema strict reject `mutateTarget`), KPIReadResult (attribution rule Q-30). Tests cover. |
| AI proposal có revision/fields/evidence/uncertainty/context; không arbitrary command payload hoặc direct writes | DONE self-check | `ai-proposals.ts`: AIProposalSchema strict reject `commandPayload`/`embedCommandPayload`/..., AIProposalKind allowlist 5 giá trị, ApplyAIProposalInput (acceptedFieldPaths + expectedTargetVersion), ApplyAIProposalResult per-field outcome. Tests cover. |
| Provider config: base URL/model/apiStyle/secretRef/capabilities/budget/data policy; read DTO không chứa API key | DONE self-check | `ai-provider-config.ts`: AIProviderConfigWrite + Read schema; SecretRef opaque + tier; AIProviderConfigReadSchema strict reject apiKey/accessKey/bearerToken/.../rawSecret; dataPolicy semantics (SANDBOX + INTERNAL_ONLY xung đột, NO_PII + PII_REDACTED xung đột). Tests cover. |
| Phase 10 chưa đủ domain decision được tách namespace experimental/version; không chặn đóng Gate 0 Phase 9 | DONE self-check | `kpi.ts`: KPI_MODULE_NAMESPACE = 'phase10-experimental' literal; schema reject 'canonical-ready'. `analytics.ts`: EXPERIMENTAL source mặc định UNAVAILABLE. KHÔNG chặn Gate 0 — Phase 9 contracts bind shape; Phase 10 module enable sau domain sign-off. |

## Source files

**Mới (Gate 0/0.5):**
- `packages/contracts/src/commands/routing.ts` — ROUTING_STRATEGIES, RoutingEligibleSet, RoutingFixedOwner, RoutingWeightEntry, RoutingPool, RoutingReservation, RoutingDecision, UpdateRoutingPoolInput, ROUTING_PATCH_FORBIDDEN.
- `packages/contracts/src/commands/analytics.ts` — METRIC_GRAINS/UNITS/PERIODS/ATTRIBUTION_STATES, MetricDefinitionInput/Schema, ProfileLifecycleMetricBinding, MetricValue, MetricAggregateRead, ANALYTICS_PATCH_FORBIDDEN.
- `packages/contracts/src/commands/kpi.ts` — KPI_TARGET_TYPES/PERIODS, KPI_MODULE_NAMESPACE, KPIAssignmentInput/Result, KPIRevisionInput, KPIProposeInput/Result, KPIReadResult, KPI_PATCH_FORBIDDEN.
- `packages/contracts/src/commands/ai-proposals.ts` — AI_PROPOSAL_KINDS, AIProposalUncertainty, AIProposalField, AIProposalContext, AIProposal, ApplyAIProposalInput/Result, AI_PROPOSAL_PATCH_FORBIDDEN.
- `packages/contracts/src/commands/ai-provider-config.ts` — AI_PROVIDER_API_STYLES/CAPABILITIES/DATA_POLICIES, SecretRef, AIProviderBudget, AIProviderConfigWrite, AIProviderConfigRead, AI_PROVIDER_FORBIDDEN_RAW_SECRET_FIELDS.

**Sửa (đóng Q-32 contract bind canonical OperationReference):**
- `packages/contracts/src/commands/scheduling.ts` — `PlanningBatchItemResultSchema.pendingReference: OperationReferenceSchema` (canonical) thay `pendingId: z.string()` opaque. SuperRefine enforce: pendingReference chỉ ở ACCEPTED; APPLIED/FAILED/SKIPPED KHÔNG có.
- `packages/contracts/src/index.ts` — re-export 5 file mới + PACKAGE_VERSION bump `0.0.5-g0.4` → `0.0.6-g0.5`.

**Tests mới + sửa:**
- `packages/contracts/tests/routing-analytics-kpi-ai.test.mjs` — 33 tests mới.
- `packages/contracts/tests/scheduling.test.mjs` — sửa `pendingId` → `pendingReference` (4 test cũ + 1 test mới cho APPLIED không có pendingReference).

**Docs:**
- `docs/contracts/decision-register.md` — bổ sung Q-32 (đóng), Q-30 (nguyên tắc), Q-34..Q-37 (5 mục cho 0.5).
- `docs/contracts/inventory.md` — cập nhật 0.5 + đối chiếu Owner chỉ thị.

## Đối chiếu các điểm Owner chỉ thị (0.5)

1. **Q-32 (đóng)** — contract ACCEPTED có reference/query semantics
   thuộc Gate 0:
   - `pendingReference: OperationReferenceSchema` (canonical
     `{ kind: 'COMMAND_OPERATION', operationId: CommandIdSchema }`).
   - Caller có thể dùng `envelopes.ts OperationQuerySchema` (schema đã
     có) với operationId để poll result.
   - **Implementation query API runtime để Phase V7.9a backend**
     (HRP-owned; schema bind sẵn — không hoãn toàn bộ sang backend).
   - Breaking change: `pendingId: z.string()` opaque → `pendingReference`
     canonical. Consumers cũ cần cập nhật payload.

2. **Q-30 (nguyên tắc, không cần Chủ nhân phê duyệt)** — phân biệt:
   - Schema validation (CONFIRMED AC): shape, enum allowlist, regex,
     length bound, discriminator, strict reject, superRefine (cohort
     order, attribution AVAILABLE vs UNAVAILABLE, 3 metricId khác nhau
     v.v.).
   - Marker/forbidden-list: chỉ audit runtime gate.
   - Runtime gate (PROPOSED HRP-owned): capability check, manager
     privilege, attestation, fencing, retention, retry policy.
   Bundle 0.5 ghi rõ từng marker `*_PATCH_FORBIDDEN` thuộc audit; AC
   thực sự enforce qua schema strict + superRefine + tests (313/313 PASS).

3. **Q-29** — ClientCompany đã có schema HRP (theo connector v1.1).
   T1 ghi marker PROPOSED cho field chưa chốt (`clientCompanyId` qua
   `ClientTargetRef`); ClientContact/SalesOpportunity/ClientInteraction
   ghi CHƯA CÓ (Q-23 unresolved/proposed).

4. **Q-31** — transport `PUSH_WEBHOOK default` giữ là đề xuất kỹ
   thuật có lý do (ACL không cần DB credentials core; fallback
   `PULL_CLAIM_ACK`). `EVENT_PATCH_FORBIDDEN` có
   `dualChannelWithoutFencing`/`dualChannelWithoutDedupe`.

5. **Q-33** — signature protocol chưa xác minh; KHÔNG biến thành câu
   hỏi nghiệp vụ chung. `EVENT_PATCH_FORBIDDEN` marker audit
   (`useUnverifiedSignatureProtocol` / `JwtAlgorithm` /
   `WebhookAlgorithm`). Thay đổi shared contracts (signature/JWT/
   webhook algo) cần Auditor kiểm ở bundle cuối.

## Decisions mới / thay đổi trong bundle

Mở trong `decision-register.md` (Q-32 đóng, Q-30 nguyên tắc, Q-34..Q-37):

- **Q-32 (đóng)**: `pendingReference` canonical OperationReference;
  implementation query API để Phase V7.9a.
- **Q-30 (nguyên tắc)**: schema validation AC; marker audit; runtime
  gate HRP-owned.
- **Q-34**: Routing strategy phân biệt (SOURCE_ALLOCATION vs
  WEIGHTED_DISTRIBUTION vs HYBRID); HYBRID policy runtime chưa chốt.
- **Q-35**: KPI module namespace 'phase10-experimental'; reject
  canonical-ready.
- **Q-36**: AI provider config — read DTO strict reject raw secret;
  SANDBOX + INTERNAL_ONLY xung đột; NO_PII + PII_REDACTED xung đột.
- **Q-37**: AI proposal — strict reject `commandPayload`/...; apply
  via envelope command.

## Versions

| Component | Trước | Sau |
|---|---|---|
| PACKAGE_VERSION | `0.0.5-g0.4` | `0.0.6-g0.5` |
| Tests | 280 | 313 (+33) |
| Files added | — | routing.ts, analytics.ts, kpi.ts, ai-proposals.ts, ai-provider-config.ts, routing-analytics-kpi-ai.test.mjs |
| Files modified | — | scheduling.ts (Q-32 pendingReference), scheduling.test.mjs, index.ts, decision-register.md, inventory.md |

## Self-check kết quả

- `npm run build` (tsc): PASS.
- `npm run typecheck` (tsc --noEmit): PASS.
- `node --test tests/*.test.mjs`: **313/313 PASS**, 0 FAIL.
- Thời gian chạy: ~545ms.

## Snapshot & hash

HEAD git: `414c54bfa2e227ec1a25694310e48908e0d67abe` (chưa commit mới).

Hash các file chính (xem thêm `handoff-g0-0.5.manifest.txt`):

```
92D05D9106625326222BBC7CE9D2CC5C09375D8B642ADEA3FC74D24E38D8F326  packages/contracts/src/commands/routing.ts
824A4E149C13968CF2E2F6CDE360DB32854333798205594A86B9D268B77F592F  packages/contracts/src/commands/analytics.ts
3DA1B2D45320810B5F3B8EF91A5BDD3F77463C8D38E0BED843F2ED1D6F36E029  packages/contracts/src/commands/kpi.ts
81545BAA52CFF7A5AF9C4E0CC2801FF9BBCABDFBB6EF9293AEFA32AB7BA47C3A  packages/contracts/src/commands/ai-proposals.ts
7C9CBDE564A0A406AB4C6606A9B71188213F6BE46AE46A5CCEFD2B88B6922BAE  packages/contracts/src/commands/ai-provider-config.ts
2ECCF4260D69DDA0E71FA7C33BDF874CECB47C21C48297A1B8A83CAE60BAB2D3  packages/contracts/tests/routing-analytics-kpi-ai.test.mjs
6486D3A3D87703230510111E0CD7E8F1C2CA9C0E2CDD70B8C81A3407A5576914  packages/contracts/src/commands/scheduling.ts
5876F0B8CAC80B6021800533ADD295AB50E0AB34AD1C40E80F860BC69ABF5EA4  packages/contracts/tests/scheduling.test.mjs
B909C0E26D6B49F69A823BF9F78B7817DD8FDB096DBBCEFF2E0ADDADF25FE23C  docs/contracts/decision-register.md
3D91DE59BF960EDEE889BE6B52912C3A8FEDA9055E78EBAF0F7CEDE77D3CC3A4  docs/contracts/inventory.md
```

## Gate bị ảnh hưởng

- Gate 0 freeze: thêm 5 contracts + 33 fixtures + 1 breaking change
  (scheduling pendingReference); bundle tổng 313/313.
- V7.9a (CORE 1.x): chưa triển khai — chờ Gate 0 freeze.
- Implementation query API runtime: để Phase V7.9a (HRP-owned).

## Blockers / open questions

- Q-32 đã đóng ở contract; implementation query API runtime để
  V7.9a HRP-owned.
- Q-30 nguyên tắc — không cần Chủ nhân phê duyệt.
- Q-29 ClientCompany field bindings cần HRP-owned PR quyết khi chốt.
- Q-31/Q-33 giữ đề xuất kỹ thuật; KHÔNG biến thành câu hỏi nghiệp
  vụ chung.
- Independent audit Gate 0 bundle vẫn PENDING; T1 self-check không
  thay Auditor.
- `organizationId` scope model chưa chốt — schema bind literal;
  runtime HRP-owned PR quyết.

## Limits / risk

- Schema bind shape CONFIRMED; runtime policy PROPOSED.
- Marker không tự chứng minh AC enforce (Q-30 nguyên tắc).
- Signature protocol, JWT algorithm, webhook algorithm CHƯA tự chọn.
- Client domain contract (Company/Contact/Opportunity/Interaction)
  vẫn PROPOSED.
- HYBRID routing policy chưa chốt (HRP-owned).
- Dual-control AI proposal (manager + reviewer) chưa chốt
  (HRP-owned).
- Phase 10 modules (KPI, attribution) namespace experimental;
  reject canonical-ready.

## Dừng

Đúng phạm vi G0/0.5. Chưa sang 0.6–0.8 hoặc backend.
Owner xác nhận Gate 0 trước khi tiếp tục.
