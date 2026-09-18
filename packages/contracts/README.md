# @hrp-engagement/contracts

Shared, versioned contracts (TypeScript types + Zod schemas) cho phân hệ
HRP Engagement — Chatwoot / Zalo OA / HRP UI.

## Status

Phase 9 / Gate 0 (đã chốt 0.3a–0.7 self-check). Phiên bản hiện tại:
`0.0.7-g0.7`. Bundle Gate 0: **372/372 fixtures PASS**, `tsc --noEmit`
strict PASS, runtime ~575ms.

## Public surface (Gate 0)

> Toàn bộ export public qua `src/index.ts`. KHÔNG import file con trực
> tiếp — luôn dùng `@hrp-engagement/contracts`.

### Enums / primitives / envelopes / errors (đợt 0A — 0.1–0.2)
- `src/enums.ts` — placement case stages, CLOSED status + closeReason,
  availability, current relationship (read-only), next-action, matching
  outcomes, evidence kind.
- `src/primitives.ts` — actor (claim), source, organization, schema
  version, idempotency key, correlation id, canonical id, ISO timestamp,
  calendar date, evidence ref.
- `src/errors.ts` — error taxonomy 10 codes + retry defaults + HTTP hint
  + helper `makeError`.
- `src/envelopes.ts` — request base, ACCEPTED/APPLIED/FAILED response
  shapes, operation reference, idempotency digest helper.

### Commands (đợt 0B/0C — 0.3a–0.5)
- `src/commands/identity.ts` — `createOrMatchLaborProfile`,
  `MatchingOutcomeResult` (EXACT_MATCH / POSSIBLE_MATCH / NEW_PROFILE).
- `src/commands/evidence.ts` — EvidenceRef opaque.
- `src/commands/profile.ts` — `updateLaborProfile`, patch whitelist,
  fill-missing only.
- `src/commands/intake.ts` — intake payload + StaffReviewConfirmation.
- `src/commands/placement-case.ts` — open / update / close, closeReason
  9 giá trị, status server-owned.
- `src/commands/interactions.ts` — RecordTalentInteraction /
  RecordClientInteraction (Q-23 UNRESOLVED cho Client domain).
- `src/commands/availability.ts` — AVAILABLE_FROM_DATE yêu cầu
  availableFromDate; CalendarDate reject ngày không tồn tại.
- `src/commands/suppression.ts` — DNC 3 target kinds (Q-26), no
  auto-remove, no inbound-removes-DNC.
- `src/commands/next-action.ts` — NextAction create / update (Q-27),
  snooze/dismiss tách DONE; occurrenceKey cho reminder dedupe.
- `src/commands/scheduling.ts` — planning batch per-item outcome
  (APPLIED / ACCEPTED / FAILED / SKIPPED); ACCEPTED có
  `pendingReference: OperationReferenceSchema` canonical (Q-32 đóng).
- `src/commands/outbox.ts` — internal transactional outbox; handoff
  DTO; transport `PUSH_WEBHOOK default` (Q-31 đề xuất kỹ thuật).
- `src/commands/gateway.ts` — HRP_GATEWAY_METHODS (17) +
  HrpGatewayCallContext 3 tiers; webhook signature algorithms allowlist
  (Q-33 protocol chưa xác minh).
- `src/commands/providers.ts` — Chatwoot / Zalo OA normalized
  webhook; KHÔNG policy tuyển dụng trong provider payload.
- `src/commands/ports.ts` — WorkerPort / SchedulerPort / QueuePort /
  SecretPort / ObjectStoragePort; PORTS_FORBIDDEN_IMPORTS
  Prisma/Next.js runtime.

### Queries / events / mappings (0.4)
- `src/commands/queries.ts` — ContextQuery / ReadOnlyIdentityPreview /
  AllowedActionsQuery / ContactabilityCheck / ConstantsSnapshot /
  ResolveContactByExternal / ListExternalContactLinks.
- `src/commands/events.ts` — EventEnvelope + EventReceipt +
  ProfileCreationEvent / PlacementCaseCreationEvent + DeliveryReportingEvent.
- `src/commands/mappings.ts` — ExternalContactLink (EXACT_MATCH /
  POSSIBLE_MATCH / UNRESOLVED), ConversationLink (historyRevisions +
  currentRevision), MAPPING_PATCH_FORBIDDEN (Q-30 marker audit).

### Routing / analytics / KPI / AI (0.5)
- `src/commands/routing.ts` — ROUTING_STRATEGIES (SOURCE_ALLOCATION /
  WEIGHTED_DISTRIBUTION / HYBRID), RoutingPool, RoutingReservation,
  RoutingDecision (Q-34 schema bind).
- `src/commands/analytics.ts` — MetricGrain / Unit / Period /
  AttributionState, MetricDefinition, MetricValue, AggregateRead,
  ProfileLifecycleMetricBinding (Q-9: 3 lifecycle metricId khác nhau).
- `src/commands/kpi.ts` — KPIAssignment / Revision / Propose / Read;
  manager-owned write; sale/AI chỉ read/propose; namespace
  `phase10-experimental` (Q-35).
- `src/commands/ai-proposals.ts` — AIProposal (revision / fields /
  evidence / uncertainty / context), ApplyAIProposal per-field outcome;
  strict reject `commandPayload` (Q-37).
- `src/commands/ai-provider-config.ts` — SecretRef opaque + tier;
  AIProviderConfigRead strict reject apiKey / accessKey / bearerToken /
  rawSecret (Q-36).

## Quy tắc Gate 0

1. **Không** thêm enum tự ý. CLOSED là status đóng duy nhất;
   closeReason chỉ 9 giá trị đã chốt.
2. **Không** cho `currentRelationship` / `Handling` / `Beneficiary` /
   `Worker` / `Assignment` / `arbitraryPatch` / `rawPatch` /
   `noteInternal` / `EFFECTIVE` vào mutation DTO (read-only projection).
3. **Actor** là claim — auth layer phải xác minh; field này KHÔNG tự
   nó chứng minh authentication. Actor discriminator:
   `USER { userId }` / `SERVICE { serviceId }` /
   `DELEGATED_USER { userId, delegationRef }`.
4. **Source** thuộc envelope (CommandSourceSchema), KHÔNG nằm trong
   actor. Discriminator: HRP_UI / INTEGRATION / HRP_INTERNAL /
   PROVIDER / SYSTEM.
5. **Idempotency** scope = `(organization, command, caller)`. Same key
   + same digest = replay; same key + khác digest = IDEMPOTENCY_CONFLICT
   (retry class `NEVER`).
6. **Error** taxonomy KHÔNG leak raw stack / SQL / provider body /
   secret / message / details. Mỗi ErrorCode map sang RetryClass.
7. **Canonical ID** opaque; KHÔNG ép UUID khi chưa đọc schema HRP.
8. **DB boundary:** integration store ≠ HRP core; không cross-DB FK;
   không nhận HRP DB credential từ integration runtime.
9. **ACCEPTED outcome (Q-32)** bắt buộc có `pendingReference:
   OperationReferenceSchema` (canonical `{ kind: 'COMMAND_OPERATION',
   operationId: CommandIdSchema }`). Implementation query API để
   Phase V7.9a backend — schema bind đầy đủ ở Gate 0.
10. **Signature / JWT / webhook algorithm** chưa tự chọn (Q-33); cần
    Auditor review shared contracts ở bundle cuối.
11. **Marker / forbidden-list** chỉ audit (Q-30 nguyên tắc) — AC
    enforcement là schema `strict()` + `superRefine()` + tests, KHÔNG
    phải marker.
12. **Không** viết Prisma schema, migration, Route Handler, domain
    service ở Gate 0. Phase 10 modules (KPI, attribution) namespace
    `phase10-experimental` — reject `canonical-ready`.

## Scripts

```bash
npm run typecheck   # tsc --noEmit
npm run build       # emit to dist/
npm test            # build + node --test tests/*.test.mjs
```

Kết quả test hiện tại (Gate 0 bundle 0.3a–0.7): **372 / 372 pass**,
0 fail, runtime ≈ 575ms.

## Versioning & compatibility

- Package `version` pin theo semver (`0.0.x` cho Gate 0). Consumer
  pin `@hrp-engagement/contracts@^0.0.7` hoặc exact `0.0.7-g0.7`.
- Envelope `schemaVersion` riêng để runtime compat (`"1"` ở Gate 0).
- **Breaking change** = major bump (khi Gate 0 freeze → 0.1.x).
- **New optional field** = minor bump.
- **Bug fix** = patch bump.

Xem chi tiết trong `CHANGELOG.md` cùng package.

## Fixture runner

`npm test` chạy Node test runner `node --test tests/*.test.mjs`.
Coverage matrix ở `docs/contracts/authorization-policy-matrix.md`
và `docs/contracts/handoff-g0-0.7.md`.

## Nguồn thẩm quyền

- `docs/Importal/Master-Plan.V2.6.md` (§7.2, §10.6, §13).
- `docs/Importal/hrp-connector.md` v1.1 tại HEAD `414c54b` (§3, §5, §7).
- `docs/Importal/Implementation-Backlog.Gate0-V7.9a.md` (§0.0–§0.7).
- `docs/contracts/inventory.md`, `decision-register.md`,
  `authorization-policy-matrix.md`, `handoff-g0-*.md` (Coder cập nhật).

## Không có

- **Không có** Prisma schema, migration, Route Handler, domain service.
- **Không có** test live model / provider endpoint.
- **Không có** raw secret / API key / PII trong fixtures / public API.
- **Không có** runtime auth — Actor là claim, runtime gate HRP-owned.
- **Không có** cross-aggregate leak — schema bind qua canonical id
  opaque + version.
