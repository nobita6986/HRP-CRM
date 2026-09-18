# G0/0.4 — Handoff

HEAD: 414c54bfa2e227ec1a25694310e48908e0d67abe
Branch: main
Date: 2026-09-13 12:00 (UTC+7)
Package version: 0.0.5-g0.4
Coder: T1
Owner: Chủ nhân (review bundle trước Gate 0 freeze)
Auditor: PENDING — gom bundle Gate 0 trước freeze.

Nguồn: Backlog Gate0 §Task 0.4, Master V2.6, hrp-connector v1.1 HEAD 414c54b.
Dependency 0.2–0.3 có self-check; chưa freeze / chưa independent audit PASS.

## AC & evidence

| AC | Trạng thái | Evidence |
|---|---|---|
| Queries context/result/read-only identity/allowed actions/contactability có scope/paging/version; constants UI KHÔNG phụ thuộc dictionary API | DONE self-check | `queries.ts` (ContextPanelResult, ReadOnlyIdentityPreviewResult, AllowedActionsQueryResult, ContactabilityCheckResult, ConstantsSnapshot). Tests: `queries-events-mappings.test.mjs` 43 fixtures. |
| Events có organization/eventId/aggregate/version/time/source; out-of-order/correction/duplicate semantics + watermark | DONE self-check | `events.ts` (EventEnvelope, EventReceipt, EventWatermark, EventDuplicateKind). Tests cover. |
| ExternalContactLink states EXACT_MATCH/POSSIBLE_MATCH/UNRESOLVED; NEW_PROFILE KHÔNG mapping state | DONE self-check | `mappings.ts` (ExternalContactLinkStateSchema, EXTERNAL_CONTACT_LINK_STATES, MatchingOutcome không chứa NEW_PROFILE ở mapping). |
| Talent/Client target union, scope provider/connection/account rõ; Client thiếu contract giữ proposed, KHÔNG thay bằng Talent | DONE self-check | `mappings.ts` (TalentTargetRef + ClientTargetRef discriminated union; ClientTargetRef.clientContactId opaque — Q-23 marker). |
| Conversation link giữ history/context revision; mutation target lấy mapping tin cậy, KHÔNG tin Chatwoot attributes | DONE self-check | `mappings.ts` (ConversationLink.externalRefs[] + currentRevision + historyRevisions + primaryTarget optional; mutation target lấy conversationId canonical). |
| Creation events phân biệt submittedBy/executingActor/creditedCreator/source; thiếu trả unavailable, KHÔNG đoán | DONE self-check | `events.ts` (CreationActorAttributionSchema — 4 trường PHÂN BIỆT; AttributionState = AVAILABLE/UNAVAILABLE; UNAVAILABLE yêu cầu unavailableReasonCode). |

## Source files added

- `packages/contracts/src/commands/queries.ts` (ConstantsSnapshot, CursorPagination, QueryScope, ContextPanel, ReadOnlyIdentity, AllowedActions, ContactabilityCheck, QUERIES_PATCH_FORBIDDEN).
- `packages/contracts/src/commands/events.ts` (EventAggregateType, EventEnvelope, EventReceipt, EventWatermark, AttributionState, CreationActorAttribution, CreationEventLabel, ProfileCreationEvent, PlacementCaseCreationEvent, EVENT_PATCH_FORBIDDEN).
- `packages/contracts/src/commands/mappings.ts` (ExternalContactRef, ExternalContactLinkStateSchema, ExternalContactLinkTarget, ExternalContactLink, TalentTargetRef, ClientTargetRef, CanonicalTargetRef, ExternalConversationRef, ConversationLink, ResolveContactByExternal, ListExternalContactLinks, MAPPING_PATCH_FORBIDDEN).
- `packages/contracts/src/index.ts` — re-export + PACKAGE_VERSION bump `0.0.4-g0.3g` → `0.0.5-g0.4`.
- `packages/contracts/tests/queries-events-mappings.test.mjs` — 43 tests mới.

## Đối chiếu connector v1.1 (HEAD 414c54b)

Theo Owner chỉ thị rev 2:

- **ClientCompany đã có schema HRP** (connector §0 bảng "Có trong source
  HRP"). Schema hiện chỉ bind opaque ID `clientCompanyId` qua
  `ClientTargetRef`. HRP-owned PR quyết field đầy đủ khi Client domain
  chốt.
- **ClientContact / SalesOpportunity / ClientInteraction**: vẫn CHƯA
  CÓ schema HRP đầy đủ (Q-23 unresolved/proposed). T1 chỉ bind opaque
  ID + marker proposed.
- **ClientContactQuery / recordClientInteraction**: capability còn
  thiếu ở production endpoint S2S (connector §2 + §6).

## Đối chiếu các điểm Owner chỉ thị rev 2

1. **Connector xác nhận ClientCompany đã có** — ghi trong
   `decision-register.md` Q-29.
2. **Tách invariant confirmed vs proposed** — đã cập nhật Q-29..Q-33
   trong `decision-register.md`. Marker/forbidden-list CHỈ là audit,
   runtime HRP gate enforce (Q-30).
3. **Push/claim-ack: chọn một đường mặc định** — Q-31: đề xuất
   `PUSH_WEBHOOK` default với lý do (ACL không cần DB credentials core;
   fallback `PULL_CLAIM_ACK`). `EVENT_PATCH_FORBIDDEN` có
   `dualChannelWithoutFencing` / `dualChannelWithoutDedupe`.
4. **Batch ACCEPTED cần pending operation reference/query semantics** —
   Q-32: schema bind `pendingId` opaque; PROPOSED chốt format =
   canonical OperationReference (`envelopes.ts`
   OperationReferenceSchema) + query API contract ở backend Phase
   V7.9a.
5. **Signature provider protocol chưa xác minh** — Q-33:
   `EVENT_PATCH_FORBIDDEN` có `useUnverifiedSignatureProtocol` /
   `useUnverifiedJwtAlgorithm` / `useUnverifiedWebhookAlgorithm`. T1
   KHÔNG tự chọn. Thay đổi shared contracts (signature/JWT/webhook
   algo) cần Auditor kiểm ở bundle cuối.

## Versions

| Component | Trước | Sau |
|---|---|---|
| PACKAGE_VERSION | `0.0.4-g0.3g` | `0.0.5-g0.4` |
| Tests | 237 | 280 (+43) |
| Files added | — | queries.ts, events.ts, mappings.ts, queries-events-mappings.test.mjs |

## Self-check kết quả

- `npm run build` (tsc): PASS.
- `npm run typecheck` (tsc --noEmit): PASS.
- `node --test tests/*.test.mjs`: **280/280 PASS**, 0 FAIL.
- Thời gian chạy: ~470ms.

## Snapshot & hash

HEAD git: `414c54bfa2e227ec1a25694310e48908e0d67abe` (chưa commit mới).

Hash các file mới/chính trong bundle (xem thêm
`handoff-g0-0.4.manifest.txt`):

```
4BFA1FE623244698442470D4498521EC154B6C830E937E234CD72C58113B2C0E  packages/contracts/src/commands/queries.ts
A94EBFA53D29F3036C2D3965817CF86FA8B638E66A2DB3F24DD46EEC192E188A  packages/contracts/src/commands/events.ts
1365EAD406B60C670A4F03708318F18405CE1FBE855CC5580CC79B41429055DB  packages/contracts/src/commands/mappings.ts
9D895DB14E58CD1FFC1B362C123628D0D31089EAC57501985CC34C2EB3F34EC4  packages/contracts/tests/queries-events-mappings.test.mjs
```

## Decisions mới / thay đổi trong bundle

Mở trong `decision-register.md` (Q-29..Q-33):

- Q-29. ClientCompany schema (PROPOSED field) + ClientContact/SalesOpportunity/ClientInteraction (UNRESOLVED).
- Q-30. Marker/forbidden-list không tự chứng minh AC enforce (runtime HRP gate).
- Q-31. Push/claim-ack đề xuất PUSH_WEBHOOK default.
- Q-32. Batch ACCEPTED pending operation reference/query semantics.
- Q-33. Signature provider protocol chưa xác minh.

## Gate bị ảnh hưởng

- Gate 0 freeze: thêm 3 contracts mới + 43 fixtures; bundle tổng 280/280.
- V7.9a (CORE 1.x): chưa triển khai — chờ Gate 0 freeze.

## Blockers / open questions

- Owner cần chốt Q-29..Q-33 trước khi freeze Gate 0.
- Independent audit Gate 0 bundle vẫn PENDING; T1 self-check không thay Auditor.
- `organizationId` scope model chưa chốt — schema bind literal
  (`envelopes.ts`, `OrganizationIdSchema`); runtime HRP-owned PR quyết
  full tenant scope khi production migration sẵn sàng.

## Limits / risk

- Schema bind shape CONFIRMED; runtime policy PROPOSED.
- Marker không tự chứng minh AC enforce.
- Signature protocol, JWT algorithm, webhook algorithm CHƯA tự chọn.
- Client domain contract (Company/Contact/Opportunity/Interaction) vẫn
  PROPOSED — HRP-owned PR riêng.
- T1 không đọc HRP checkout; đối chiếu qua connector v1.1 + Master V2.6.

## Dừng

Đúng phạm vi G0/0.4. Chưa sang 0.5–0.8 hoặc backend.
Owner xác nhận Gate 0 trước khi tiếp tục.
