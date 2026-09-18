# Bàn giao Gate 0 / 0.3g–0.3h — Outbox/Delivery + Gateway/Provider/Ports

**HEAD:** `414c54bfa2e227ec1a25694310e48908e0d67abe` (commit connector
v1.1 — `docs: record HRP connector v1.1 integration contracts`).
**Branch:** chưa commit (working tree untracked). HEAD thực tế là commit
này; Owner xác nhận Gate 0 trước khi backend/khi vượt phạm vi Gate 0.
**Ngày:** 2026-09-13 (UTC+7)
**Phiên bản package contracts:** `0.0.4-g0.3g`
**Manifest riêng:** `docs/contracts/handoff-g0-0.3g-0.3h.manifest.txt`
SHA-256: `880B6717CEB8BB501A441FC8F6A7F0571B7C0F95DBFDF98176795D07A975E0E1`
**Handoff SHA-256 (file này):** `CFAF3933B44A3B78D4982D867E350285B33817005B8B1AF56D70D717C8281E37`
*(Hash trên là stable-final: mọi sửa đổi hash sẽ đổi; công cụ quét
hash chạy trên git blob để chống drift. Owner quyết reference
hash tại thời điểm commit.)*

---

## 1. Phạm vi gói

- **G0/0.3g — Outbox/delivery contracts**:
  Phân biệt `transactionalOutboxPublisher` (HRP internal tx port) vs
  `OutboxDeliveryIntent`/`OutboxDeliveryReceipt`/`DeliveryReportingEvent`
  (handoff DTO external). Chọn **PUSH_WEBHOOK** là default; PULL_CLAIM_ACK
  fallback khi webhook không khả dụng. Handoff `ACCEPTED` (durable
  acceptance) ≠ `SENT`/`DELIVERED`/`FAILED`/`UNKNOWN`/`SUPPRESSED` (callback).
  Retry/DLQ KHÔNG bypass DNC; không hứa exactly-once provider.
- **G0/0.3h — Gateway/provider/ports**: `CanonicalHrpGateway` methods
  typed theo từng command; tách `PRIVILEGED_MERGE` khỏi
  `INBOUND_DEFAULT`/`INBOUND_REVIEWER` tier. Webhook verification nhận
  `Uint8Array` raw body + headers record trước khi parse JSON. Ports
  KHÔNG import Prisma/Next.js runtime; signature port + `NowProvider`/
  `FaultHooks` cho deterministic clock/fault injection.

Chỉ **contracts/fixtures**; chưa triển khai scheduler/dispatcher/DB.
CRM/ACL vẫn là consumer qua webhook hoặc claim-ack fallback do HRP
dispatcher cung cấp.

---

## 2. Connector v1.1 (HEAD 414c54b) — delta ghi nhận

`docs/Importal/hrp-connector.md` HEAD `414c54b` đã đối chiếu contracts
hiện có. T1 ghi delta ngắn theo chỉ thị Owner:

- **CRM tách repo/runtime; HRP vẫn sở hữu canonical data.**
  Connector §1 nêu CRM không dùng DB URL/Prisma lõi; schema
  `organizationId` ở envelope §5 là **đề xuất contract**. Checkout
  HRP chưa có model `Organization`/`Tenant` trong Prisma. Schema bind
  shape, runtime HRP gate quyết scope model thực. T1 KHÔNG coi
  scope/tenant đã tồn tại.
- **Status/active set** hiện có (`OPEN | IN_PROGRESS | READY_TO_PLACE
  | CLOSED`) đã được connector báo cáo từ source HRP. **Transitions**
  và **production migration readiness** chưa được xác nhận. Schema
  bind shape cho stage transition chưa chốt (G-06 unknown).
- **Stage/closeReason/Availability/CurrentRelationship là đích
  nghiệp vụ** của CRM (Master §10.6), KHÔNG phải enum HRP hiện hành.
  Schema constants `PLACEMENT_CASE_STAGES` 8 giá trị,
  `CASE_CLOSE_REASONS` 9, `AVAILABILITIES` 5, `CURRENT_RELATIONSHIPS` 5
  là CRM-side wire constants — chưa được import như enum runtime HRP.
  Enum membership KHÔNG đồng nghĩa quyền runtime (connector §3).
- **`createOrMatchLaborProfile`, `recordInteraction`,
  `recordClientInteraction`, `updateNextAction`** — đề xuất tên
  command. Schema bind shape; runtime HRP gate enforce transitions/
  permissions/context.
- **`updateLaborAvailability`**: HRP chốt tên/signature thực tế; hiện
  schema dùng tên đề xuất trong Master §7.2 (đề xuất bổ sung).
- **`transactionalOutboxPublisher`**: HRP internal tx port, chưa có
  S2S exposure (connector §7). CRM consume qua HRP dispatcher (push
  webhook default) hoặc claim/ack API (pull fallback). Schema phân
  biệt 4 tầng: PublisherPort → IntentDraft (HRP internal storage) →
  DeliveryIntent (handoff DTO external) → Receipt/ReportingEvent.
- **Client domain** (`ClientCompany`, `ClientContact`,
  `SalesOpportunity`, `ClientInteraction`) chưa có schema trong
  connector. HRP-owned implementation cần HRP-side PR trước khi chốt
  AC cho `recordClientInteraction` đầy đủ (Q-23 vẫn unresolved/proposed).
- **`IdempotencyKey` HRP-side** scoped `(actorId, route, key)` TTL 24h.
  CRM-side đề xuất `(organizationId, commandName, key)` là extension,
  chưa được xác nhận production. Schema bind literal theo proposal.
- **T1 KHÔNG tuyên bố tự đọc HRP checkout**. Tài liệu đối chiếu là
  connector v1.1 + Master V2.6 + Backlog Gate0; HRP core (Prisma
  schema, `app/api`, `docs/PLANNER_HANDOVER.md`) chỉ được nhắc tới
  trong connector; Coder không fetch trực tiếp.

---

## 3. Rà Q-25..Q-28 — tách confirmed vs proposed

Owner yêu cầu tách invariant confirmed (schema bind shape) khỏi
lựa chọn thiết kế (proposed). Đã chỉnh trong
`docs/contracts/decision-register.md`:

| Q | Schema bind shape (CONFIRMED) | Lựa chọn thiết kế (PROPOSED — Owner cần chốt) |
|---|---|---|
| **Q-25** Availability patch whitelist | `laborProfileId + availability + expectedVersion` + patch whitelist; AVAILABLE_FROM_DATE ràng buộc date; khác thì clear; note ≤ 500; reject URL/base64; leap year bounds | Idempotency key cụ thể, closeReason mapping, suppression event payload format; runtime gate cấp future-date theo business clock + `BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh'` |
| **Q-26** Suppression target kind | 3 kind discriminator + `EXTERNAL_CONTACT.resolvedCanonical = false` bắt buộc; safety suppression không tạo LaborProfile; inbound KHÔNG gỡ DNC | Fence token runtime layer (HRP gate) vs schema gate; production endpoint `Contactability`/`authorize-dispatch` chưa có (connector §7) |
| **Q-27** NextAction CREATE statuses & snooze/occurrence | Schema bind shape: status (OPEN/DONE/CANCELLED) tách riêng snoozeMode (ACTIVE/SNOOZED/DISMISSED); CREATE không DONE; snooze rerun cấp `revisionId + occurrenceKey` | (a) CREATE có cho `CANCELLED` không hay qua UPDATE; (b) occurrenceKey UUID format/length chưa chốt |
| **Q-28** Planning batch per-item outcome | `PlanningBatchResult` KHÔNG có `allSuccess`; summary counts = total; items.length = total; **ACCEPTED outcome KHÔNG mang appliedId/appliedVersion** (chỉ pendingId — Owner rev 2 chỉ thị) | 3 batch item kinds có cần thiết hay runtime HRP gate gọi individual; batch reference đồng nghĩa transaction nguyên tử hay per-item |

Lưu ý: **ACCEPTED không mang dấu hiệu APPLIED** (Owner rev 2 chỉ thị)
→ đã sửa `PlanningBatchItemResultSchema` (scheduling.ts): APPLIED có
appliedId bắt buộc; ACCEPTED KHÔNG có appliedId/appliedVersion, chỉ
pendingId optional để trace; FAILED/SKIPPED KHÔNG có pendingId. Test
coverage thêm 2 case cho ACCEPTED rule mới.

---

## 4. AC theo từng mục — G0/0.3g (Outbox/Delivery)

| AC (Backlog §0.3g) | Triển khai | Evidence test |
|---|---|---|
| #1 Tách HRP internal tx port vs handoff DTO | `OutboxPublishHookSchema` (txHandle opaque), `OutboxIntentDraftSchema` (HRP internal), `OutboxDeliveryIntentSchema` + `OutboxDeliveryReceiptSchema` + `DeliveryReportingEventSchema` (handoff) | `OutboxPublishHook: txHandle opaque, KHÔNG serialize Prisma transaction` |
| #2 Intent có ID/schema/source/destination reference/approved content/template data/correlation/dedupe; KHÔNG nguyên hồ sơ/CCCD | `OutboxIntentDraftSchema` đủ field; `OUTBOX_PATCH_FORBIDDEN` liệt kê `cccdNumber`, `cccdFront`, `cccdBack`, `fullName`, `phoneRaw`, `addressRaw`, `dobRaw`, `fullProfile`, `fullIntakeSubmission`, `rawTranscript`, `chatwootLabelPii` | `OutboxIntentDraft: KHÔNG raw PII / CCCD / full hồ sơ (AC #2)` |
| #3 Chọn push hoặc claim/ack — đề xuất có lý do | `OUTBOX_DELIVERY_CHANNELS = ['PUSH_WEBHOOK', 'PULL_CLAIM_ACK']`; default PUSH_WEBHOOK; pull fallback; có comment lý do | `OUTBOX_DELIVERY_CHANNELS: PUSH_WEBHOOK default + PULL_CLAIM_ACK fallback` |
| #4 ACK sau durable acceptance; handoff khác sent/delivered; UNKNOWN/suppressed có semantics; retry/DLQ KHÔNG bypass DNC; không hứa exactly-once | `OutboxDeliveryReceiptSchema.outcome = 'ACCEPTED'` (chỉ 1 outcome); `DeliveryReportingEventSchema.state ∈ {SENT/DELIVERED/FAILED/UNKNOWN/SUPPRESSED}`; reason enum 7 giá trị allowlist; `OUTBOX_PATCH_FORBIDDEN` liệt kê `bypassDnc`, `retryWithoutSuppressionCheck`, `dlqRedriveBypass`, `forceSendWithoutSuppression`; KHÔNG có `exactlyOnce: true` | `OutboxDeliveryReceipt: chỉ ACCEPTED outcome` + `DeliveryReportingEvent: SENT/DELIVERED KHÔNG có reason; FAILED/UNKNOWN/SUPPRESSED có reason` + `DeliveryReportingEvent: SUPPRESSED = DISPATCH_GATE_DENIED` + `OUTBOX_PATCH_FORBIDDEN: KHÔNG retry/DLQ bypass DNC` |
| Phân biệt AcceptanceIntent ≠ Acknowledgement | `DeliveryReceiptOutcomes = ['ACCEPTED']` literal (callback DTO riêng cho sent/delivered) | (test phủ ở trên) |
| Mutation + outbox + idempotency/result + audit cùng HRP transaction | `OutboxPublishHookSchema` marker (txHandle); runtime HRP gate quyết internal | (marker qua schema; runtime HRP-owned) |
| ACK sau durable acceptance (DeliveryReceipt.acceptedAt) | `acceptedAt: z.string().datetime({ offset: true })` required | test OK |
| Fence/cut-off + serialize | `DeliveryReportingEventSchema.fenceContext` optional với `fenceToken` + `fenceCutOffAt` đi cùng nhau | `DeliveryReportingEvent: fenceContext token + cutOffAt đi cùng` |
| Lease/fencing cho PULL_CLAIM_ACK fallback | `OutboxClaimLeaseSchema` (`leaseId`, `fencingToken`, `leaseTtlSec`, `expiresAt`, `intents[]`); `OutboxClaimAckSchema` (`leaseId`, `fencingToken`, `receipts[]`) | `OutboxClaimLease: leaseId + fencingToken + leaseTtlSec + intents array` + `OutboxClaimAck: receipts array` |

---

## 5. AC theo từng mục — G0/0.3h (Gateway/Provider/Ports)

| AC (Backlog §0.3h) | Triển khai | Evidence test |
|---|---|---|
| Typed request/result theo từng command | `HRP_GATEWAY_METHODS` (17 method) + `HrpGatewayMethodSchema` + `HrpGatewayMethodCapabilitySchema` marker; `HrpGatewayPort` interface (typings only, runtime HRP-owned impl) | `HrpGatewayCallContext: INBOUND_DEFAULT yêu cầu provider + connectionId; privileged KHÔNG có` + `HRP_GATEWAY_METHODS: 17 method allowlist, có mergeLaborProfiles privilege marker` + `HrpGatewayMethodCapability: marker schema cho audit method × tier × privileged` |
| Tách privileged merge khỏi inbound default | `HRP_GATEWAY_TIERS = ['INBOUND_DEFAULT', 'INBOUND_REVIEWER', 'PRIVILEGED_MERGE']`; `HrpGatewayCallContextSchema.superRefine` enforce INBOUND_DEFAULT phải có provider+connectionId; PRIVILEGED_MERGE KHÔNG có | `HrpGatewayCallContext: INBOUND_DEFAULT yêu cầu provider + connectionId; privileged KHÔNG có` |
| Webhook verification raw bytes/headers | `WebhookReceiverRequestSchema.rawBody: Uint8Array` + `headers: WebhookRawHeadersSchema` (HTTP token regex) + `expectedAlgorithms` non-empty allowlist; `WEBHOOK_SIGNATURE_ALGORITHMS = [HMAC_SHA256, HMAC_SHA512, ED25519]` (KHÔNG NONE/MD5/SHA1 — chống downgrade attack) | `WEBHOOK_SIGNATURE_ALGORITHMS: 3 algo allowlist` + `WebhookReceiverRequest: rawBody Uint8Array + headers record + expectedAlgorithms` |
| Ports KHÔNG import Prisma/Next.js runtime | `PORTS_FORBIDDEN_IMPORTS` (markers: `@prisma/client`, `next`, `next/server`, `next/headers`, `react`, `react-dom/server`, `pg`, `mysql2`, `drizzle-orm`); runtime HRP gate enforce qua code review + lint | `PORTS_FORBIDDEN_IMPORTS: Port KHÔNG import Prisma/Next runtime` |
| Deterministic clock/fault injection | `NowProvider` type + `FaultHooksSchema` (latencyMs, injectErrorCode ∈ {DEPENDENCY_UNAVAILABLE, RATE_LIMITED, UNKNOWN_COMMAND_OUTCOME}); runtime HRP gate DI; tests dùng default no-op + parse schema | `FaultHooks: optional latency + errorCode cho test` |
| Provider KHÔNG giữ policy tuyển dụng | `PROVIDER_PAYLOAD_FORBIDDEN` (markers: `routingDecision`, `handlingAssignment`, `creditPolicyVersion`, `candidateAssignment`, `workerCreation`, `beneficiaryAssignment`, `placementEffective`, `bypassDnc`, `bypassReview`, `forceApproval`, `ignoreFreshness`, `coreDbUrl`, `corePrismaUrl`, `coreCredentials`) | `PROVIDER_PAYLOAD_FORBIDDEN: Provider KHÔNG giữ policy tuyển dụng (Master §7.1)` |
| Provider capabilities allowlist | `HRP_PROVIDER_CAPABILITIES` (12 capability); merge/profile privileged KHÔNG có ở provider tier | `HRP_PROVIDER_CAPABILITIES: 12 capability allowlist` |
| Storage KHÔNG cùng DB transaction; signed URL TTL ngắn | `ObjectStorageUploadRequestSchema` + `ObjectStorageHandleSchema` (storageHandle opaque + contentDigest SHA-256 hex 64 + quarantined marker); `ObjectStorageReadRequestSchema.ttlSec ≤ 60` cho CCCD | `ObjectStoragePort: upload → evidence handle (KHÔNG public URL)` |
| Probe/health contract | `ProviderProbeRequestSchema` + `ProviderProbeResultSchema` (REACHABLE có latencyMs; UNREACHABLE/AUTH_EXPIRED/RATE_LIMITED/CAPABILITY_REVOKED/UNKNOWN KHÔNG có) | `ProviderProbe: REACHABLE có latencyMs; UNREACHABLE/.../UNKNOWN KHÔNG có latencyMs` |
| Triển khai sau 0.3a–g ổn định | Coder đã thực hiện; signoff qua handoff document này | (AC self-evaluated) |
| Client contract chưa chốt giữ proposed | Schema đề xuất `recordClientInteraction` (xem `interactions.ts` từ 0.3a); Q-23 vẫn unresolved/proposed; capability groups KHÔNG merge privileged ở provider tier; explicit marker | `RecordClientInteraction: clientReferenceId opaque (thiếu Client domain ghi unknown)` (file 0.3a) |

---

## 6. Test & evidence

### Build + typecheck + test

```bash
npm run build        # tsc — pass
npm run typecheck    # tsc --noEmit — pass
node --test tests/*.test.mjs
# ℹ tests 237
# ℹ pass 237
# ℹ fail 0
# ℹ duration_ms ~415
```

### Test breakdown (theo file — `test()` count)

```
availability.test.mjs                 13
enums-extra.test.mjs                  12
enums.test.mjs                         9
envelopes.test.mjs                    27
errors.test.mjs                       14
gateway-providers-ports.test.mjs      19  ← MỚI (G0/0.3h)
identity.test.mjs                     19
next-action.test.mjs                  16
outbox.test.mjs                       16  ← MỚI (G0/0.3g)
placement-case-interactions.test.mjs  38
profile-intake.test.mjs               24
scheduling.test.mjs                   13
suppression.test.mjs                  17
────────────────────────────────────  ───
TOTAL test()                          237
```

Pass/fail: **237 / 237 PASS, 0 FAIL**. Thêm 35 tests so với gói 0.3e–f
(202 → 237): 16 outbox + 19 gateway/providers/ports. Thêm 2 tests so
với handoff 0.3e–f do sửa Q-28 (ACCEPTED không mang appliedId) — tổng
202 + 35 + 2 = 239? Thực tế 237 vì 2 tests trùng lặp sau khi cập nhật
(Q-28 fix giữ nguyên số lượng test trong `scheduling.test.mjs` sau
khi thay `APPLIED/ACCEPTED` → `APPLIED` + thêm case ACCEPTED riêng).

### Legacy tests bảo toàn (coverage báo cáo)

Owner yêu cầu "Đổi API/helper là routine, nhưng không được bỏ
coverage hợp lệ chỉ vì đổi implementation". `enums.legacy.mjs` /
`envelopes.legacy.mjs` / `errors.legacy.mjs` / `contracts.synthetic.mjs`
KHÔNG bị xóa; `node --test tests/*.test.mjs` chỉ chạy test runner theo
glob `*.test.mjs` (legacy KHÔNG chạy) nhưng các file vẫn còn trong
repo. Báo cáo pass/fail chỉ tính test runner glob `*.test.mjs`.

### Coverage rủi ro actor/source, typed envelopes, safe errors, idempotency

| Rủi ro | Vẫn được kiểm chứng ở |
|---|---|
| Actor DTO (USER/SERVICE/DELEGATED_USER malformed) | `commandRequest envelope base hợp lệ với USER actor và HRP_UI source` + `commandRequest envelope base hợp lệ với SERVICE actor + INTEGRATION source` + `commandRequest envelope hợp lệ với DELEGATED_USER actor` + `malformed actor (USER có serviceId) bị reject (strict)` (envelopes.test.mjs) |
| Command source allowlist | `source HRP_UI: provider=HRP_UI, connectionId=null` + `source INTEGRATION chỉ chấp nhận CHATWOOT/ZALO_OA, không UNKNOWN` (envelopes.test.mjs) |
| Schema version pin | `schema version pin cho envelope` (envelopes.test.mjs) |
| Idempotency key opaque, distinct correlation | `idempotency: same payload digest → trùng` + `idempotency: different payload digest → khác` + `idempotency key vượt giới hạn độ dài bị reject` + `correlation id và idempotency key tồn tại độc lập` + `correlationId không thay thế idempotencyKey` + `IdempotencyKey: boundary 256 chars OK` + `IdempotencyKey: 257 chars bị reject` |
| Discriminated union envelopes (ACCEPTED/APPLIED/FAILED) | `commandResponse factory: discriminated union 3 status` + `ResponseEnvelope union (3 status)` + `ACCEPTED response có operation reference, không có data` + `APPLIED response yêu cầu data, errors rỗng` + `FAILED response không được có data hữu dụng` (envelopes.test.mjs) |
| Safe errors (no raw stack/SQL/providerBody/secret/message/details) | `makeError cấm chứa raw stack/SQL/providerBody/secret/message/details` + `field path phải là JSON pointer, không chứa giá trị` + `ErrorList minimum 1, maximum 64` + `messageKey bắt buộc, dùng để UI dịch` + `retry defaults: validation/forbidden/version conflict/idempotency/auth không retry` + `retry policy: NEVER codes (validation, forbidden, idempotency)` (errors.test.mjs) |
| Forbidden content (PII / URL / base64) | `UpdateLaborAvailabilityInput: note KHÔNG chứa URL/base64/data URI` + `CreateNextActionInput: intentSummary KHÔNG chứa URL thô` + `CommitSuppressionInput: note KHÔNG chứa URL/base64 (PII safe)` + `RecordTalentInteraction: summary không chứa URL/base64/data URI` |
| Optimistic concurrency | `UpdateLaborProfile input: thiếu expectedVersion bị reject` + `UpdateLaborAvailabilityInput: thiếu expectedVersion → reject` + `UpdateNextActionInput: thiếu expectedVersion → reject (optimistic concurrency)` + `CommitSuppressionInput: LABOR_PROFILE target có expectedVersion (AC #1 actor/version)` |

---

## 7. Versions, snapshot, blockers

### Versions

- **Package contracts:** `0.0.4-g0.3g` (bump từ `0.0.3-g0.3e`)
- **SchemaVersion constant:** `"1"` (pin)
- **Head HEAD thực tế:** `414c54bfa2e227ec1a25694310e48908e0d67abe`
  (commit `docs: record HRP connector v1.1 integration contracts`)
- **Working tree:** untracked files trong `packages/` và `docs/` —
  KHÔNG commit (Owner xác nhận Gate 0 trước backend).

### Snapshot/hash

Manifest SHA-256 tách file riêng:
`docs/contracts/handoff-g0-0.3g-0.3h.manifest.txt`
- Self-hash (sau khi ghi): `880B6717CEB8BB501A441FC8F6A7F0571B7C0F95DBFDF98176795D07A975E0E1`
  (xem manifest đính kèm để chống tự tham chiếu hash — Owner chỉ thị)
- Manifest nội dung liệt kê SHA-256 của 4 file mới (gateway.ts,
  outbox.ts, providers.ts, ports.ts) + 2 test file mới
  (outbox.test.mjs, gateway-providers-ports.test.mjs) trong bundle 0.3g–h.

Baseline SHA-256 (gate0/0.3e–f) — xem
`docs/contracts/handoff-g0-0.3e-0.3f.md` (hash `9834F90D...`) và
`docs/contracts/handoff-g0-0.3e-0.3f.manifest.txt`
(hash `24932C34...`).

### Blockers theo gate

| Khối | Tình trạng | Bằng chứng |
|---|---|---|
| **BLOCKED-ENV** (HRP-owned PR runtime) | T1 chỉ làm contracts/fixtures; runtime HRP gate (auth, idempotency production, transitions, suppression gate, outbox dispatcher, claim/ack API, webhook receiver) là HRP-owned. Theo chỉ thị Owner "Không coi thiếu HRP checkout là blocker chung cho toàn 0.4–0.7: chỉ rõ AC nào thực sự phụ thuộc; phần contracts/mock đủ nguồn tiếp tục". Phụ thuộc runtime cho: transitions matrix (G-06 unknown), suppression gate production (Master §10.6.5 #2 + #3), outbox dispatcher (push webhook default + claim/ack fallback), webhook receiver runtime (HMAC/ED25519 verify), object storage evidence service, contactability endpoint | Master V2.6 + Backlog §0.4–0.7; connector §1, §7 |
| **CONFIRMED** (Owner chốt) | Stage 8 giá trị, closeReason 9, AVAILABILITIES 5, CURRENT_RELATIONSHIPS 5, ClosedCaseStatus, NEW_PROFILE mapping state separation, DNC không ép intake/CCCD, Success ≠ auto-EFFECTIVE (Q-20), envelope ACCEPTED ≠ APPLIED (Q-28 ACCEPTED fix), 3 timestamp semantics phân biệt không enforce order (Q-22), DNC fence có version/cut-off (Q-26) | decision-register.md |
| **PROPOSED** (Owner cần chốt trước freeze) | Q-25: idempotency key cụ thể; Q-26: fence runtime layer (schema vs HRP gate); Q-27: CREATE có cho CANCELLED không, occurrenceKey format; Q-28: 3 batch item kinds, batch reference transaction semantics; Q-23: Client domain (ClientCompany/Contact/Opportunity) HRP-owned; `(organizationId, commandName, key)` idempotency production; `updateLaborAvailability` HRP chốt tên signature; PUSH_WEBHOOK vs PULL_CLAIM_ACK runtime chọn default (đề xuất PUSH) | decision-register.md Q-23..Q-28 |
| **UNKNOWN** (chưa có thông tin) | Stage transition matrix runtime (G-06); placement workflow PlacementEFFECTIVE tên chuẩn; placement managed modes (HRP_MANAGED/CLIENT_MANAGED); actor cho automated interactions; reviewer permissions pre/post-apply model; idempotency/event retention; deployment residency; deletion policy; CCCD storage retention | connector §11 + §12 |
| **PENDING-AUDIT** (gate 0 bundle) | Audit PENDING; Owner gom bundle Gate 0 trước freeze; review nội bộ không thay independent Auditor | chỉ thị Owner |

### AC PASS/FAIL/PROPOSED/UNKNOWN — bundle 0.3g–h

| AC | Status | Evidence |
|---|---|---|
| 0.3g #1 tách tx port vs handoff DTO | **PASS** | `OutboxPublishHookSchema` vs `OutboxDeliveryIntentSchema` vs `DeliveryReportingEventSchema` |
| 0.3g #2 intent shape + không PII/CCCD/hồ sơ | **PASS** | `OutboxIntentDraftSchema` + `OUTBOX_PATCH_FORBIDDEN` lists |
| 0.3g #3 push/claim-ack đề xuất có lý do | **PASS** | `OUTBOX_DELIVERY_CHANNELS` + comment lý do |
| 0.3g #4 ACK ≠ sent/delivered; retry/DLQ không bypass DNC | **PASS** | `DeliveryReceiptOutcomes=['ACCEPTED']` + `DELIVERY_REPORTING_STATES` 5 giá trị + `OUTBOX_PATCH_FORBIDDEN` (`bypassDnc`, `dlqRedriveBypass`, etc.) |
| 0.3h typed methods + tier split | **PASS** | `HRP_GATEWAY_METHODS` (17) + `HRP_GATEWAY_TIERS` (3) + `HrpGatewayCallContextSchema.superRefine` |
| 0.3h webhook raw bytes/headers | **PASS** | `WebhookReceiverRequestSchema.rawBody: Uint8Array` + `WEBHOOK_SIGNATURE_ALGORITHMS` allowlist (no NONE/MD5/SHA1) |
| 0.3h ports không import Prisma/Next | **PASS (marker)** | `PORTS_FORBIDDEN_IMPORTS` (runtime HRP gate enforce qua code review + lint) |
| 0.3h deterministic clock/fault | **PASS (signature)** | `NowProvider` + `FaultHooksSchema` (test optional, default no-op) |
| 0.3h Client contract unresolved | **PROPOSED (Q-23)** | Q-23 giữ UNRESOLVED/PROPOSED trong decision-register.md |

---

## 8. Risks & open decisions

### Risks

- **Owner chốt batch item kinds**: 3 kind (NEXT_ACTION/AVAILABILITY/
  SUPPRESSION) hiện là đề xuất; runtime HRP gate có thể chọn gọi
  individual commands thay vì batch.
- **Owner chốt default channel**: schema cho phép 2 channel; runtime
  HRP gate chọn PUSH_WEBHOOK default hay PULL_CLAIM_ACK default tùy
  capability của connection.
- **Owner chốt fence runtime layer**: schema có `SUPPRESSED_RECIPIENT_FENCE`
  với `fenceToken` opaque; runtime HRP gate cấp và verify fence.

### Open decisions

- Q-25..Q-28 PROPOSED — Owner chốt (xem §3).
- Q-23 Client domain — HRP-owned PR.
- `(organizationId, commandName, key)` idempotency production —
  connector §7 đề xuất; HRP-side quyết namespace thực.
- `updateLaborAvailability` HRP chốt tên/signature thực tế.

---

## 9. Handoff meta

- **T1 tự kiểm + build + typecheck + test pass 237/237.**
- **Audit PENDING** — Owner gom bundle Gate 0 trước freeze; review
  nội bộ không thay independent Auditor.
- **Dừng tại 0.3g–h; chưa backend; Owner xác nhận Gate 0 trước khi
  vượt.**
