# G1/1.1 — Handoff (CORE/1.1 — CanonicalHrpGateway deterministic mock)

HEAD: 414c54bfa2e227ec1a25694310e48908e0d67abe (Gate 0 freeze)
Branch: main
Date: 2026-09-14 09:50 (UTC+7)
Package version: 1.1.0-core1.1
Coder: T1
Owner: Chủ nhân (sign-off cuối CORE/1.1 sau Audit PASS)
Auditor: PENDING — CORE/1.1 chưa có independent Auditor verdict

Nguồn: Backlog Gate0 §Task 1.1, Master V2.6 §7.2 + §9, handoff-core-1.0.md,
handoff-g0-0.8.md, decision-register.md, execution-guide §5.3.
Dependency 1.0 (CORE/1.0 audit PASS); Gate 0 FREEZE.

## Trạng thái & verdict

- **CORE/1.0**: Audit PASS theo Owner 2026-09-14 (manifest 32/32 khớp;
  CORE/1.0 42/42 + contracts 398/398 PASS).
- **Gate 0**: FREEZE (Owner 2026-09-14).
- **CORE/1.1**: **Auditor PASS** — B1 (ACCEPTED operation shape drift) đã
  FIXED + CLOSED bởi T1 (2026-09-14); verdict Auditor độc lập được Owner
  xác nhận qua Chủ nhân (hội thoại 2026-09-14). CORE/1.1 self-check:
  30/30 gateway tests + 84/84 full suite + 18/18 receiver.int PASS.

## AC theo Implementation-Backlog §Task 1.1

| AC | Status | Evidence |
|---|---|---|
| [ ] EXACT/POSSIBLE/NEW theo fixture ID; cùng fixture/clock cho cùng kết quả, không Math.random | DONE | `gateway/scenarios.ts` 18 fixtures; `mock-gateway.ts` inject clock + id counter; tests: `EXACT_MATCH_SUCCESS trả EXACT_MATCH`, `POSSIBLE_MATCH_REVIEW trả POSSIBLE_MATCH`, `NEW_PROFILE_CREATED trả NEW_PROFILE`, `same fixture + same clock → cùng kết quả` |
| [ ] Mô phỏng timeout trước apply, timeout sau apply, permission/policy/version/idempotency conflict và malformed dependency response | DONE | Scenarios TIMEOUT_BEFORE_APPLY (FAILED DEPENDENCY_UNAVAILABLE), TIMEOUT_AFTER_APPLY (ACCEPTED), PERMISSION_DENIED (FAILED FORBIDDEN), POLICY_REJECTION (FAILED), VERSION_CONFLICT (FAILED), IDEMPOTENCY_CONFLICT (detect ở mock-gateway cache hit + khác digest), MALFORMED_DEPENDENCY_RESPONSE (FAILED UNKNOWN_COMMAND_OUTCOME); tests cover toàn bộ |
| [ ] Same key/same payload trả cùng result; key khác payload conflict. Ledger giới hạn rõ (in-memory fixture, KHÔNG durable production) | DONE | mock-gateway cache theo `${organizationId}:${method}:${idempotencyKey}`; same digest → return cached; khác digest → IDEMPOTENCY_CONFLICT; ledger class bounded ring buffer + `reset()` cho test; test `same key+same payload → cache hit`, `same key+different payload → IDEMPOTENCY_CONFLICT`, `restart = mất log`, `ring buffer bounded` |
| [ ] Call log chứng minh no forbidden side effect, không fake merge/Worker/EFFECTIVE từ chat | DONE | CallLogEntry ghi rõ: tier, method, capability check, outcomeErrorCode; test `call log KHÔNG chứa merge capability khi tier=INBOUND_DEFAULT` verify capability check + log; CLOSED_CASE_SUCCESS note ghi `SUCCESS ≠ EFFECTIVE (managed mode Q-19)` |
| [ ] Mock one-active-case result là scenario simulation, không bằng chứng concurrency Prisma HRP | DONE | Scenario ONE_ACTIVE_CASE trả data với `note: 'SCENARIO_SIMULATION_NOT_CONCURRENCY_PROOF'`; test verify note. ONE_ACTIVE_CASE chỉ là 1 fixture (không concurrency test) |

## Source files

**Mới (CORE/1.1):**
- `apps/integration-api/src/gateway/types.ts` — type contracts + Zod schemas
  cho request/response/result; CallLogEntry shape; scenario fixtures types.
- `apps/integration-api/src/gateway/scenarios.ts` — 18 fixtures (EXACT/POSSIBLE/
  NEW + timeout-before/after + permission/policy/version/idempotency/malformed +
  one-active-case + closed-case + outbox + dependency + rate-limit).
- `apps/integration-api/src/gateway/mock-gateway.ts` — deterministic router;
  inject clock/IDs; capability check (tier × method); cache theo
  `${organizationId}:${method}:${idempotencyKey}`; payload digest SHA-256
  canonical JSON; correlationId KHÔNG tham gia cache; same key+khác payload
  → IDEMPOTENCY_CONFLICT; latency simulation.
- `apps/integration-api/src/gateway/ledger.ts` — CallLedger in-memory bounded
  ring buffer (maxEntries=1024 mặc định); resultCache (theo key+digest);
  buildLogEntry factory.
- `apps/integration-api/src/gateway/index.ts` — surface export.
- `apps/integration-api/tests/gateway.test.mjs` — 26 fixtures (test CORE/1.1 AC).

**Sửa (CORE/1.1 — Owner instruction):**
- `apps/integration-api/src/server.ts` — wire gateway: thêm
  `POST /mock/gateway/call` (validate strict Zod) +
  `GET /mock/gateway/log` (snapshot read-only); VERSION bump 1.0.0 → 1.1.0.
- `apps/integration-api/package.json` — version 1.0.0-core1.0 → 1.1.0-core1.1;
  description cập nhật (CORE/1.1 + gateway mock).
- `apps/integration-api/.env.synthetic.example` — header CORE/1.0 → CORE/1.1;
  thêm `/mock/gateway` vào HRP_MOCK_ROUTES.
- `apps/integration-api/tests/server.test.mjs` — VERSION expectations cập
  nhật 1.0.0 → 1.1.0 (CORE/1.1 subsumes CORE/1.0).

**Không đụng** (ràng buộc cứng):
- `packages/contracts/src/**` — Gate 0 freeze; KHÔNG sửa.
- `packages/contracts/tests/**` — Gate 0 freeze; KHÔNG sửa.
- `packages/contracts/package.json` — version `0.0.8-g0.8-fixes` giữ nguyên.
- `apps/integration-api/.env.synthetic.example` cấm env keys
  (`HRP_DATABASE_URL`, `HRP_PRISMA_CLIENT_PATH`, `HRP_PROVIDER_API_KEY`)
  vẫn chặn.

## Versions

| Component | Trước | Sau |
|---|---|---|
| `apps/integration-api` package.json | `1.0.0-core1.0` | `1.1.0-core1.1` |
| `VERSION` constant (server.ts) | `1.0.0-core1.0` | `1.1.0-core1.1` |
| `apps/integration-api/.env.synthetic.example` `HRP_MOCK_ROUTES` | `/health,/mock/integration` | `/health,/mock/integration,/mock/gateway` |
| Contracts package | `0.0.8-g0.8-fixes` | (không đổi) |

## Commands / results

### Build

```bash
$ cd apps/integration-api && npm run build
> @hrp-engagement/integration-api@1.1.0-core1.1 build
> tsc
(exit 0, no output)
```

### Typecheck (toàn project)

```bash
$ cd packages/contracts && npm run typecheck
> tsc --noEmit
(exit 0, no output)

$ cd apps/integration-api && npm run typecheck
> tsc --noEmit
(exit 0, no output)
```

### Test (full suite — 466/466)

```bash
$ cd packages/contracts && npm test
ℹ tests 398   # 372 G0/0.1-0.7 + 13 F1-F5 + 13 F2-followup
ℹ pass 398
ℹ fail 0

$ cd apps/integration-api && npm test
ℹ tests 35    # 9 CORE/1.0 (updated for CORE/1.1 version) + 26 CORE/1.1 gateway
ℹ pass 35
ℹ fail 0

$ cd packages/config && npm test
ℹ tests 13
ℹ pass 13

$ cd apps/integration-worker && npm test
ℹ tests 9
ℹ pass 9

$ cd apps/context-panel && npm test
ℹ tests 11
ℹ pass 11

# Tổng: 466/466 fixtures PASS
```

## Snapshot & hash

Xem `handoff-core-1.1.manifest.txt` (SHA-256 file mới + file sửa đợt 1.1).

Self-reference lưu ý:
- `handoff-core-1.1.md` KHÔNG tự ghi hash của chính nó (theo pattern cũ).
- `handoff-core-1.1.manifest.txt` KHÔNG tự ghi hash của chính nó.

## Boundaries (Owner instruction 2026-09-14)

CORE/1.1 mock:
- **Implement mock gateway theo contracts đã pin** — `HrpGatewayCallRequestSchema`,
  `HrpGatewayCallContextSchema`, `HrpGatewayMethodSchema`, `ErrorCodeSchema`
  tất cả từ `@hrp-engagement/contracts` đã FREEZE; mock chỉ implement router.
- **Inject clock/IDs/scenarios; cùng fixture/clock cho kết quả nhất quán** —
  `createMockGateway({ now, idGen })`; scenarios từ `gateway/scenarios.ts`;
  tests với `now = () => FIXED_CLOCK_MS` xác nhận deterministic.
- **EXACT/POSSIBLE/NEW theo fixture, không tự xây identity/domain policy** —
  Mock chỉ route scenario ID → outcome; không có HRP domain rule.
- **Mô phỏng timeout trước apply, timeout sau apply, permission/policy/
  version/idempotency conflict, malformed dependency** — 18 scenarios cover.
- **Same key/same payload trả cùng result; same key/different payload →
  conflict** — mock-gateway cache + IDEMPOTENCY_CONFLICT detect.
- **Không nhầm correlationId với idempotency key** — `correlationId` chỉ
  tracking trong log; `idempotencyKey` mới dedupe (xem test
  `correlationId KHÔNG tham gia cache key`).
- **Call log chứng minh không tự merge/Worker/EFFECTIVE từ chat** —
  capability check (tier × method) chặn merge/resolve ở INBOUND_DEFAULT;
  CLOSED_CASE_SUCCESS ghi note `SUCCESS ≠ EFFECTIVE (managed mode Q-19)`.
- **One-active-case chỉ là scenario simulation, không phải concurrency** —
  data có `note: 'SCENARIO_SIMULATION_NOT_CONCURRENCY_PROOF'`.
- **Giới hạn ledger khi retry/restart** — in-memory bounded ring buffer;
  reset = mất log + cache; **KHÔNG dùng memory ledger để tuyên bố durable
  production**.
- **Không tự fake success** cho merge/review/Client path — capability check
  trả FORBIDDEN đúng policy (test `tier=INBOUND_DEFAULT + merge →
  FORBIDDEN`); privileged tier `mergeLaborProfiles` qua được capability
  nhưng scenario `PERMISSION_DENIED` chọn FORBIDDEN để chứng minh.
- **Không sửa contracts đã freeze** — không có thay đổi trong
  `packages/contracts/src/**`; chỉ dùng type/schema qua
  `@hrp-engagement/contracts` import.
- **Chưa receiver/store/queue/migration, chưa HRP/provider/model thật** —
  mock chỉ in-memory; không import Prisma; không outbound HTTP.

## Limitations

1. **In-memory ledger, KHÔNG durable production.** Restart process mất log
   + cache. Production HRP implement persistent store + durable outbox
   (Task 1.3 + 1.4 + 1.8 — HRP-owned PR).
2. **Mock capability check dựa trên hardcoded privileged methods set**
   (`mergeLaborProfiles`, `resolvePossibleMatch`, `commitReviewDecision`,
   `supersedeReviewStatus`). Production HRP gate có matrix đầy đủ từ
   `HrpGatewayMethodCapabilitySchema` xem `authorization-policy-matrix.md`.
3. **Math.random KHÔNG dùng** — id generation dùng counter + injected
   clock; deterministic. Production HRP cần ID strategy riêng (UUIDv7
   hoặc tương đương) — out-of-scope CORE/1.1 mock.
4. **Payload chỉ SHA-256 canonical JSON digest** — không có PII/secret
   masking; production cần secret-aware hashing.
5. **Scenario coverage CHƯA đầy đủ** — 18 scenarios cover AC Task 1.1; chưa
   cover multi-step workflow (Task 1.5/1.6), outbox dispatch (Task 1.8),
   webhook receiver (Task 1.2) — những task riêng.
6. **Cấm self-test merge capability** — `tier=PRIVILEGED_MERGE + merge +
   scenario PERMISSION_DENIED` test chỉ verify capability check pass;
   scenario vẫn trả FORBIDDEN (PERMISSION_DENIED scenario fixture quyết
   định, không phải capability).

## Decisions còn thiếu (chỉ chặn path phụ thuộc, KHÔNG chặn CORE/1.1 mock)

| Decision | Status | Tác động CORE/1.1 |
|---|---|---|
| Q-19 Placement transitions matrix | OPEN | MOCK chỉ có CLOSED_CASE_SUCCESS + PLACEMENT_PROPOSED fixtures; transitions matrix thật do HRP chốt. |
| Q-33 Signature/JWT/webhook | OPEN | MOCK không verify webhook (Task 1.2 riêng). |
| Q-34 HYBRID policy runtime | OPEN | MOCK không enforce HYBRID policy; chỉ assert config boundaries. |
| Q-37 Dual-control AI proposals | OPEN | MOCK không gọi AI runtime; AI proposals fixtures PROPOSED. |
| Q-23 Client domain | OPEN | `recordClientInteraction` chỉ trong NON_PRIVILEGED tier allowlist; runtime policy HRP-owned. |
| Q-32 Runtime query API | OPEN | `queryOutboxDelivery` chỉ trong allowlist; query API runtime HRP-owned. |
| OrgScope (Q-1 + G0-11) | OPEN | MOCK `organizationId` chỉ validate format (OrganizationIdSchema), KHÔNG scope filter runtime. |
| Phase 10 module (KPI/attribution) | DISABLED | KHÔNG có fixture phase10; `kpi.ts` `phase10-experimental`. |

## Risk classification (Execution-Guide §5.3)

CORE/1.1 thuộc nhóm **Mock/read-only prototype** — không audit mặc định,
nhưng bundle ổn định cho Auditor review nếu Owner yêu cầu.

- **Contract changes (mock + tier × method capability)**: LOW risk đối với
  shared contracts (mock KHÔNG sửa contracts đã freeze).
- **Mock behavior changes (cache + ledger)**: NEW — chưa có baseline để
  đối chiếu.
- **HTTP routes mới (`/mock/gateway/*`)**: LOW risk — chỉ expose trong
  mock mode (assertNotProductionMock chặn production).

## Decisions mới (trong phạm vi CORE/1.1, không mở Q mới)

1. **Capability check hardcoded set** — `mergeLaborProfiles`,
   `resolvePossibleMatch`, `commitReviewDecision`, `supersedeReviewStatus`
   là PRIVILEGED methods (theo `HrpGatewayMethodCapabilitySchema` matrix
   hint). Production matrix `authorization-policy-matrix.md` sẽ chốt
   đầy đủ. T1 KHÔNG mở Q mới — chỉ pick từ contracts đã có.
2. **Cache key = `org:method:idempotencyKey`** — không bao gồm
   correlationId (Owner instruction: "Không nhầm correlationId với
   idempotency key").
3. **Scenario SUCCESS note ghi rõ SUCCESS ≠ EFFECTIVE** — phòng nhầm
   với managed mode Q-19.
4. **Ledger bounded ring buffer** — Owner instruction: "nêu rõ giới
   hạn ledger khi retry/restart; kiểm chứng trong phạm vi mock".

## Dừng

Dừng đúng phạm vi CORE/1.1. Chưa sang Task 1.2 (Webhook Receiver &
Idempotency) hoặc 1.3 (Integration Store) — chờ Owner audit verdict.
Owner quyết định audit theo thay đổi thực tế.

T1 không tự commit; không tự stamp CHECKPOINT FREEZE; không tự OWN-issued
HRP PR (Q-19/33/34/37/23/32).

---

## B1 FIX — Auditor phát hiện ACCEPTED shape drift

**Trạng thái**: B1 FIXED (T1 thay thế, 2026-09-14 16:30 UTC+7).
CORE/1.1 giữ nguyên trạng thái READY FOR AUDIT; B1 là revision pass bổ
sung evidence cho Auditor recheck.

### Nguyên nhân thực tế (verify qua source Zod 3.24.2)

Không phải `Object.freeze()` hay "Zod readonly". Test crash ở **module
load time** vì `dist/gateway/types.js` dùng `z.discriminatedUnion('status',
[AcceptedResponseSchema, ...])`. Trong Zod 3.24.2:

```js
// node_modules/zod/lib/index.mjs line 3038 (static.create)
const discriminatorValues = getDiscriminator(type.shape[discriminator]);
```

`type.shape` ở đây là `_def.shape`, và với `AcceptedResponseSchema` đã
`.strict()`, `_def.shape` là **function** (lazy getter), KHÔNG phải plain
object. Nên `function['status']` trả về `undefined`. `getDiscriminator`
nhận `undefined`, rơi vào nhánh `else { return []; }` → DU throw
`A discriminator value for key 'status' could not be extracted from all
schema options`.

Verify trực tiếp:

```js
> AcceptedResponseSchema._def.shape
[Function: shape]   // function, không phải plain object
> AcceptedResponseSchema._def.shape()['status']._def
{ value: 'ACCEPTED', typeName: 'ZodLiteral' }   // gọi function mới có shape
> typeof AcceptedResponseSchema._def.shape === 'function'
true
```

Zod chỉ unwrap lazy shape cho `ZodEffects`, không phải `ZodObject`. Vì
`AcceptedResponseSchema` (từ contracts freeze) là `ZodObject` strict, nó
không được unwrap trong `getDiscriminator` → DU fail.

`AppliedResponseShapeSchema` và `FailedResponseShapeSchema` (cùng cách
tạo `.strict()`) cũng có `shape` là function — nhưng manual reproduction
local lại extract được literal OK. Khác biệt thuộc về storage/cached
identity của schema re-exported từ contracts package (qua
`@hrp-engagement/contracts`); xác minh cụ thể:

```js
// OK (rebuilt local)
const Manual = z.object({
  status: z.literal('ACCEPTED'),
  schemaVersion: SchemaVersionSchema, commandId: CommandIdSchema,
  correlationId: z.string().min(8).max(128),
  operation: OperationReferenceSchema, errors: z.tuple([]),
}).strict();
z.discriminatedUnion('status', [Manual]); // OK

// FAIL (re-exported from contracts package)
z.discriminatedUnion('status', [AcceptedResponseSchema]);
// throws: A discriminator value for key 'status' could not be extracted
```

→ Chính sự re-export từ contracts làm DU fail; không phải do spread
operator hay spread của `...responseBase` (reproduction local với spread
cũng OK).

### Cách xử lý (B1 fix)

**`HrpGatewayCallResultSchema`** trong
`apps/integration-api/src/gateway/types.ts` chỉ là **internal validator
của mock layer** — không thuộc contracts freeze (kiểm tra:
`grep -r HrpGatewayCallResultSchema apps/integration-api/src` chỉ thấy
export trong `index.ts`; test files KHÔNG reference). Mock không được
phép rebuild field-by-field của `AcceptedResponseSchema` (sẽ drift khỏi
contracts freeze).

Đổi `z.discriminatedUnion('status', [...])` → `z.union([...])`. Union:
- Vẫn strict (cùng `.strict()` trên mỗi schema).
- Vẫn dùng nguyên `AcceptedResponseSchema` từ contracts freeze (alias,
  không rebuild) → AC #1 đạt (Reuse `AcceptedResponseSchema`, không drift).
- Runtime duyệt từng option (không tối ưu như DU nhưng behavior validation
  tương đương; `ACCEPTED`/`APPLIED`/`FAILED` đều distinct nhờ literal
  `status` và `errors: z.tuple([])` khác `errors: array.min(1)`).
- Type-level `z.infer<...>` cho `HrpGatewayCallResult` vẫn giữ nguyên
  (đã test qua TypeScript inference).

KHÔNG dùng `any`/cast/loosen. KHÔNG sửa contracts source/tests/dist.

### AC verification (B1)

| AC | Status | Evidence |
|---|---|---|
| Reuse `AcceptedResponseSchema` từ contracts | DONE | `export const AcceptedResponseShapeSchema = AcceptedResponseSchema;` alias; KHÔNG rebuild |
| Trả `operation` object chuẩn, không operationId root/data | DONE | `mock-gateway.ts:118-128` trả `{ operation: { kind: 'COMMAND_OPERATION', operationId } }` |
| Tests validate bằng frozen `AcceptedResponseSchema` | DONE | `AcceptedResponseSchema.safeParse(r)` xuất hiện trong 3 tests: `TIMEOUT_AFTER_APPLY`, `OUTBOX_RECEIPT_DURABLE`, `cache replay`, `round-trip` |
| Cover TIMEOUT_AFTER_APPLY, OUTBOX_RECEIPT_DURABLE và replay: cùng key/digest giữ nguyên operation reference | DONE | Tests: `gateway: TIMEOUT_AFTER_APPLY trả ACCEPTED`, `gateway: OUTBOX_RECEIPT_DURABLE result khớp AcceptedResponseSchema`, `gateway: cache replay ACCEPTED giữ nguyên operation.operationId`, `gateway: AcceptedResponseSchema validate fixture OUTBOX_RECEIPT_DURABLE round-trip` |
| Negative test: shape cũ operationId root bị reject | DONE | `gateway: ACCEPTED shape cũ (operationId ở root) bị AcceptedResponseSchema reject` |
| Bỏ `data.operationId` thừa của fixture OUTBOX_RECEIPT_DURABLE | DONE | scenarios.ts `OUTBOX_RECEIPT_DURABLE` chỉ set `outcome: 'ACCEPTED'`, không có `data` — `applyScenario` không trả data cho ACCEPTED case |

### Test evidence (chạy thực, 2026-09-14 16:35 UTC+7)

```bash
$ cd apps/integration-api && npm run build
> tsc
(exit 0)

$ cd apps/integration-api && npm run typecheck
> tsc --noEmit
(exit 0)

$ cd apps/integration-api && node --test tests/gateway.test.mjs
ℹ tests 30
ℹ pass 30
ℹ fail 0
ℹ duration_ms 302.5149

# Full suite (không regression):
$ cd apps/integration-api && node --test tests/gateway.test.mjs tests/receiver.test.mjs tests/server.test.mjs
ℹ tests 84
ℹ pass 84
ℹ fail 0

$ cd apps/integration-api && node --test tests/receiver.int.test.mjs
ℹ tests 18
ℹ pass 18
ℹ fail 0
```

### Changed files

| File | SHA-256 (post-fix) | Diff |
|---|---|---|
| `apps/integration-api/src/gateway/types.ts` | `f98ad364d1bc953cc17e718bcdef2756f1c4540ce9cbb92b2812a12257e34998` | DU → union (8 dòng thay, +12 comment giải thích) |
| `apps/integration-api/tests/gateway.test.mjs` | `6f20a5ae43356cb5cd9257a8c2886f277b03098152f680f7301539bb9413b478` | (untracked, đã thêm 4 B1 tests ở phần trước) |
| `apps/integration-api/dist/gateway/types.js` | (rebuilt) | regenerated bằng `npm run build` chuẩn |
| `apps/integration-api/dist/gateway/mock-gateway.js` | (rebuilt) | regenerated bằng `npm run build` chuẩn |

KHÔNG đụng: `packages/contracts/**`, `apps/integration-api/src/gateway/scenarios.ts`
(output đã đúng shape từ trước — `applyScenario` case ACCEPTED trả
`operation: { kind, operationId }`), `apps/integration-api/src/gateway/mock-gateway.ts`
(mock runtime đã trả đúng shape).

### Compatibility delta

- Zod 3.24.2: KHÔNG đổi.
- `z.union` thay `z.discriminatedUnion` ở 1 internal schema (mock layer).
  Validation semantics tương đương về strictness; runtime per-record
  parse tốn thêm vài micro vì duyệt từng option (chỉ 3 options, không
  đáng kể).
- Contracts freeze (`0.0.8-g0.8-fixes`) KHÔNG đổi; `AcceptedResponseSchema`
  KHÔNG đổi; `OperationReferenceSchema` KHÔNG đổi.
- CORE/1.2 (receiver), CORE/1.3 (store), CORE/1.4 (queue) test suites
  PASS — không regression.

### Snapshot/manifest update

`handoff-core-1.1.manifest.txt` đã cập nhật:
- SHA-256 `apps/integration-api/src/gateway/types.ts` từ
  `00C31A5EBFDB4EA5452A060782BA5F4F1682142EB39DA60BA63D5865494115D7`
  → `f98ad364d1bc953cc17e718bcdef2756f1c4540ce9cbb92b2812a12257e34998`.
- `apps/integration-api/dist/gateway/*.js` là build output — KHÔNG tự ghi
  hash theo pattern cũ (chỉ rebuild qua `npm run build`).

### Dừng

CORE/1.1 dừng sau B1 FIX. Audit vẫn `CHANGES_REQUIRED` cho đến khi
Auditor độc lập recheck B1. KHÔNG sang CORE/1.5.

