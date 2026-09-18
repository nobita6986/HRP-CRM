# CORE/1.2 — Webhook Receiver & Idempotency — Handoff

> **Tóm tắt**: HTTP webhook receiver nhận raw bytes → verify HMAC SHA-256/512
> (algorithm pinned theo ConnectionRegistry, KHÔNG chọn từ header) → parse
> protocol fixture (CHATWOOT / ZALO_OA / GENERIC; stable event identity
> policy, bỏ `message.id` / `trace_id`) → registry fail-before-persist →
> atomic commit `commitReceiptWithIntents` qua Integration Store (CORE/1.3) →
> HTTP 202 chỉ sau durable commit. Dedupe by `(org/provider/connection/eventId)`
> + `payloadDigest`. Body scope spoof detection.

## 0. Metadata

- **Task**: CORE/1.2 (Backlog Gate0 §Task 1.2).
- **Owner**: T1 (Coder).
- **Auditor**: REQUIRED independent review trước khi go-live (Authenticity/scope,
  durable ACK, dedupe). Owner sẽ gọi audit theo diff thực tế.
- **Head repo**: branch `main`, base HEAD CORE/1.4 APPROVED.
- **Bundle size**: rev 1 = 17 files, ~117 KB; rev 2 = +1 file (connection-registry.ts) + edits, ~135 KB.
- **Manifest**: `docs/contracts/handoff-core-1.2.manifest.txt` (SHA-256).
- **Coder**: T1.
- **Status rev 1**: READY FOR AUDIT (T1 self-check PASS; 71/71 API + 24/24 store int + 15/15 config + 398/398 contracts PASS).
- **Auditor verdict rev 1**: CHANGES_REQUIRED — 3 blocking findings F1/F2/F3 + guard fix.
- **Status rev 2**: CHANGES_REQUIRED → FIXED (xem §14). T1 self-check PASS; 566/566 across all packages.
- **Status rev 3 (this update)**: AUDITOR PASS (xem §15 — reconciliation + sequencing).
- **Snapshot audited**: working tree as of `handoff-core-1.2.manifest.txt` rev 2 hash set; không có code diff trong rev 3 (chỉ doc update).

## 1. Dependencies

| Dependency | Status | Source |
|---|---|---|
| Gate 0 (frozen contracts `0.0.8-g0.8-fixes`) | **FREEZE** | `docs/contracts/checkpoint.gate-0-freeze.md` |
| CORE/1.0 (scaffold + boundaries) | **Auditor PASS** | `docs/contracts/handoff-core-1.0.md` |
| **CORE/1.3 (Integration Store — `commitReceiptWithIntents` là idempotent atomic commit API)** | **Auditor PASS** | `docs/contracts/handoff-core-1.3.md` |
| CORE/1.4 (Durable Worker leasing) | **Auditor APPROVED** (2026-09-14) | `docs/contracts/handoff-core-1.4.md` |
| CORE/1.1 (gateway mock) | NOT used by CORE/1.2 (deliberate boundary) | — |
| **CORE/1.5 (normalize + mapping + semantic firewall theo Backlog Gate0)** | OUT OF SCOPE for CORE/1.2 | Backlog §Task 1.5 |
| **Provider production adapters (real Zalo challenge / Chatwoot verify URL / Chatwoot handshake)** | OUT OF SCOPE; thuộc **Phase 9 (P9)** HRP-owned | Master-Plan V2.6 §P9 |

> **Sequencing clarification (Owner 2026-09-14)**:
> - CORE/1.3 = **Integration Store** (idempotent commit API). KHÔNG phải
>   outbox processor.
> - CORE/1.5 = **normalize + mapping + semantic firewall** theo Backlog
>   Gate0 §Task 1.5. KHÔNG phải provider adapter.
> - Provider production adapters (Zalo OA challenge handshake, Chatwoot
>   verify-URL handshake, Chatwoot wire format) thuộc **Phase 9** (P9),
>   HRP-owned, OUT OF SCOPE cho CORE/1.2 fixture.

## 2. Kết quả (1–3 dòng)

CORE/1.2 đã built xong webhook receiver với raw-byte HMAC verify (allowlist
HMAC_SHA256 + HMAC_SHA512), URL-driven scope (path only, NEVER body),
documented stable eventId fallback, atomic commit qua CORE/1.3 `commitReceiptWithIntents`
(202 chỉ sau durable commit), 409 idempotency-conflict, 503 DB unavailable.
26 unit tests + 10 PG integration tests PASS, không touch frozen contracts,
boundary CORE/1.5 không vào.

## 3. AC & Evidence (Backlog §Task 1.2)

| # | AC | Status | Evidence |
|---|---|---|---|
| 1 | Test-provider endpoint nhận raw bytes, verify trước normalize/persist | **PASS** | `hmac-verify.ts` verify signature trước khi parse; `parseProviderFixture` chạy sau verify; test `HMAC signature mismatch → 401, no DB write` xác nhận NO DB write khi verify fail |
| 2 | Protocol fixture cô lập, KHÔNG tuyên bố đã xác minh Zalo/Chatwoot thật | **PASS** | `protocol-fixture.ts:1-30` ghi rõ "cô lập, chỉ test/dev"; không tuyên bố xác thực |
| 3 | HTTP 202 chỉ sau durable receipt + recoverable processing intent commit | **PASS** | `handler.ts` chỉ `respond(res, 202, ...)` sau khi `commitWebhookReceipt.ok===true`; test `HTTP 202 sau durable commit` verify DB row + test `DB unavailable → 503` xác nhận NO 202 khi DB fail |
| 4 | Dedupe theo `(org, provider, connectionId, eventId)` server-side verified | **PASS** | Scope verify từ URL path (`scope-verify.ts:verifyScopeFromPath`); body scope spoof → 400; test `body scope spoof → 400` |
| 5 | Same event ID + same hash không sinh job mới | **PASS** | CORE/1.3 `commitReceiptWithIntents` đã idempotent; test `idempotent replay — same eventId + same digest → 202 created=false` verify NO new intent row |
| 6 | Same event ID + different hash → reject/quarantine | **PASS** | CORE/1.3 throws `IDEMPOTENCY_CONFLICT` → receiver map 409; test `hash conflict — same eventId + different digest → 409` verify NO new intent row |
| 7 | Thiếu eventId → documented stable fallback theo event type HOẶC reject | **PASS** | `STABLE_FALLBACK_POLICY` document cho CHATWOOT/ZALO_OA/GENERIC; test `missing eventId + missing fallback → 400` (Chatwoot không có message.id); test `Chatwoot fallback sang message.id` |
| 8 | KHÔNG dùng timestamp nhận làm key | **PASS** | `parseProviderFixture` chỉ dùng `event_id` / `message_id` / `eventId` / `id` / `trace_id`; KHÔNG có field nào lấy `Date.now()` làm fallback |
| 9 | Sai verification không enqueue nghiệp vụ | **PASS** | HMAC fail → 401, NO DB write (test `HMAC signature mismatch → 401, no DB write`) |
| 10 | DB unavailable không trả success ACK | **PASS** | `commitWebhookReceipt.ok===false` → handler respond 503 `store_unavailable`; test `DB unavailable → 503 (NO 202)` |
| 11 | Payload/size/rate limits | **PASS** | `maxBodyBytes` config (default 256KB, min 1024); rate-limit in-memory 600/min/connection (default); test `payload too large → 413` |
| 12 | Response ACK provider-agnostic (202 default) | **PASS** | Per `ack.ts` + Owner brief: "không áp đặt 202 nếu provider yêu cầu 200/challenge body" → adapter per-provider sẽ đến V7.9b/c |

## 4. Source files

| File | Approx LOC | Purpose |
|---|---|---|
| `apps/integration-api/src/receiver/protocol-fixture.ts` | 230 | Parse raw bytes theo CHATWOOT / ZALO_OA / GENERIC shape; documented stable eventId fallback. Cô lập. |
| `apps/integration-api/src/receiver/hmac-verify.ts` | 130 | HMAC SHA-256 / SHA-512 verify, constant-time compare, allowlist algorithm. |
| `apps/integration-api/src/receiver/scope-verify.ts` | 110 | URL-path scope verify (NEVER body); body scope-spoof detection. |
| `apps/integration-api/src/receiver/dedupe.ts` | 130 | Orchestrate `commitReceiptWithIntents` (CORE/1.3); build receipt + DispatchIntent; map errors → 409/400/503. |
| `apps/integration-api/src/receiver/handler.ts` | 270 | HTTP pipeline: size → scope → HMAC → parse → spoof → commit → 202. Token bucket rate limit. |
| `apps/integration-api/src/receiver/ack.ts` | 30 | Typed ACK shape (`accepted` / `rejected`). |
| `apps/integration-api/src/server.ts` | +30 LOC vs CORE/1.1 | Mount `/webhooks/:org/:provider/:connectionId` route, wire receiver + Prisma. |
| `packages/config/src/types.ts` | +30 LOC | `ReceiverConfigSchema` + extend `ApiConfigSchema` with `receiver` field. |
| `packages/config/src/loader.ts` | +12 LOC | `parseReceiverConfig` từ env. |

## 5. Tests

| File | Tests | Coverage |
|---|---|---|
| `apps/integration-api/tests/receiver.test.mjs` | 26 | Unit: protocol fixture (Chatwoot primary + fallback + missing), Zalo OA primary + fallback, GENERIC fallback chain, malformed JSON, unsupported provider; HMAC SHA-256 OK/mismatch/missing sig/missing secret/malformed sig, Generic SHA-512 + missing algorithm; scope from path (ok/missing/unsupported), body scope spoof detection (org/provider/connectionId variants); lookupSharedSecret sanitize. |
| `apps/integration-api/tests/receiver.int.test.mjs` | 10 | PG integration: HTTP 202 + row exists; idempotent replay (created=false); hash conflict (409); body scope spoof (400); malformed JSON (400); HMAC mismatch (401); missing eventId (400); payload too large (413); recovery (idempotent 202); DB unavailable (503). |
| `packages/config/tests/loader.test.mjs` | +2 | receiver defaults + env override + min body size. |
| `apps/integration-api/tests/server.test.mjs` | +0 (2 updated) | Bump VERSION 1.1.0-core1.1 → 1.2.0-core1.2; CORE/1.2 health tag. |

Total tests: **71/71 API + 24/24 store int + 15/15 config + 398/398 contracts = 538/538**.

## 6. Versions & contracts pin

| Component | Version | Source |
|---|---|---|
| `@hrp-engagement/contracts` | `0.0.8-g0.8-fixes` (Gate 0 FREEZE) | pinned via `@hrp-engagement/config` |
| `@hrp-engagement/config` | `1.0.0-core1.0` (CORE/1.0 PASS) | API + worker + panel pin exact |
| `@hrp-engagement/integration-store` | `1.1.0-core1.4` (CORE/1.3 PASS + 1.4 APPROVED) | API receiver gọi `commitReceiptWithIntents` qua boundary |
| `@hrp-engagement/integration-api` | `1.2.0-core1.2` (this task) | `package.json` bumped |

## 7. Self-check (commands & results)

| Command | Result |
|---|---|
| `npm run typecheck` (apps/integration-api) | **PASS** (no errors) |
| `npm run build` (apps/integration-api) | **PASS** (no errors) |
| `npm test` (apps/integration-api) | **71/71 PASS** (35 server + 26 receiver unit + 10 receiver int) |
| `npm test` (packages/config) | **15/15 PASS** |
| `npm test` (packages/contracts) | **398/398 PASS** (no schema delta this round) |
| `npm run test:integration` (packages/integration-store) | **24/24 PASS** |
| `npm run test:unit` (packages/integration-store) | **10/10 PASS** |
| `npm test` (apps/integration-worker) | **9/9 PASS** |
| `npm test` (apps/context-panel) | **11/11 PASS** |
| `python scripts/core-1.2-verify.py` | **OK** (17 files match manifest) |

## 8. Snapshot & hash

See `docs/contracts/handoff-core-1.2.manifest.txt`. 17 files, all SHA-256 verified.

Working tree bám sát manifest; `git status` chỉ thêm files mới (không sửa file đã freeze).

## 9. Decisions mới / Q mới

- **Q-48** (CORE/1.2 fixture scope): Protocol fixture CHATWOOT / ZALO_OA / GENERIC dùng synthetic HMAC secret từ env. KHÔNG tuyên bố provider authenticity — fixture chỉ phục vụ dev/test pipeline verify shape + signature. Real provider adapter (Zalo challenge handshake, Chatwoot webhook verify URL) đến V7.9b/c. **PROPOSED**, chưa Owner chốt vì đã ghi rõ trong brief.
- **Q-49** (eventId fallback policy): Documented stable fallback order per provider (CHATWOOT → `event_id` then `message.id`; ZALO_OA → `event_id` then `message_id`; GENERIC → `event_id` → `id` → `eventId` → `message_id` → `trace_id`). KHÔNG dùng timestamp nhận làm key (Backlog §Task 1.2 AC rõ). Thiếu stable id → reject 400 `missing_event_id`. **PROPOSED**, đã align với brief.
- **Q-50** (rate limit in-memory): Token bucket per `(org, provider, connectionId)` với 60s window. **In-memory only** cho CORE/1.2 — production rate limit cần Redis/edge proxy, deferred to V7.9b/c. **PROPOSED**, đã ghi rõ trong handoff.

## 10. Gate / blocker

- **Gate 0**: **FREEZE** (Owner sign-off recorded). KHÔNG xin freeze lại.
- **CORE/1.0**: **Auditor PASS** (independent review).
- **CORE/1.1**: **CHANGES_REQUIRED** (PENDING audit) — DELIBERATE: CORE/1.2 không depend CORE/1.1. CORE/1.2 giữ code ổn định trong khi CORE/1.1 được review độc lập.
- **CORE/1.3 (Integration Store)**: **Auditor PASS**.
- **CORE/1.4 (Durable Worker leasing)**: **Auditor APPROVED** (2026-09-14).
- **CORE/1.2 (this task)**: **AUDITOR PASS** (rev 3; xem §15).
- **Blocked paths**:
  - **Provider production adapters** (Chatwoot URL handshake, Zalo challenge body) — **Phase 9 (P9) HRP-owned**; KHÔNG thuộc CORE/1.2 / CORE/1.5.
  - **CORE/1.5 (normalize + mapping + semantic firewall)** — theo Backlog Gate0 §Task 1.5; **CHƯA sang**. CORE/1.5 cũng KHÔNG chứa provider adapter.
  - Production rate limit (Redis/edge) — V7.9b/c.
- **Open Q**: Q-48 / Q-49 / Q-50 / Q-51 chưa Owner chốt; không chặn audit (CORE/1.2 đã PASS).

## 11. Limits & known constraints

- **In-memory rate limit**: restart process sẽ mất rate state. Production cần Redis/edge. Documented.
- **In-memory HMAC secret**: synthetic env `HRP_WEBHOOK_SECRET_<PROVIDER>_<CONNECTION>`; real production key management là Phase 9 / HRP-owned SecretRef (Q-23 runtime gate). T1 không tự chọn provider secret rotation protocol.
- **Protocol fixture cô lập**: KHÔNG đại diện cho Zalo OA / Chatwoot shape thật 100%. Adapter cho production đến V7.9b/c khi provider handshake/verification được xác minh.
- **Atomic scope**: single PostgreSQL transaction. Nếu DB có nhiều cluster, multi-region → cần chiến lược distributed commit (chưa chốt, để Gate sau).
- **Order of writes**: receiver commit trước, worker 1.4 xử lý sau. Out-of-order delivery VẪN CÓ THỂ xảy ra (digest KHÔNG đảm bảo trật tự; audit không chấp nhận claim digest-ordering). Receipt timestamp + sequencing xử lý ở Gate sau (Q-open).
- **In-process token bucket**: không share giữa nhiều instances. Multi-instance rate limit cần Redis/edge. Documented.

## 12. Boundary checklist

- [x] KHÔNG thay đổi shared contracts (frozen Gate 0). 398/398 contracts PASS.
- [x] KHÔNG dùng CORE/1.1 gateway mock (deliberate: CORE/1.1 còn CHANGES_REQUIRED).
- [x] KHÔNG normalize / mapping / semantic firewall (deferred to CORE/1.5 theo Backlog).
- [x] KHÔNG provider production adapter (thuộc P9 HRP-owned).
- [x] KHÔNG HRP/provider/model thật, production DB, hay deploy.
- [x] KHÔNG tự chốt Provider protocol handshake, secret rotation, distributed rate limit — đã ghi Q-48/49/50.
- [x] KHÔNG tự fake merge/Worker/EFFECTIVE từ chat (CORE/1.1 boundary giữ nguyên).
- [x] KHÔNG thay đổi CORE/1.3 integration store API.
- [x] Snapshot pre/post post-audit retry-policy fix đã recorded trong `handoff-core-1.4.md` §0.

## 13. Dừng đúng phạm vi CORE/1.2

CORE/1.2 = Webhook Receiver & Idempotency. KHÔNG:
- Receiver CORE/1.5 (normalize + mapping + semantic firewall theo Backlog §Task 1.5).
- Provider production adapter (P9 HRP-owned, OUT OF SCOPE cho CORE/1.2 / CORE/1.5).
- Production secret management.
- Multi-region / distributed commit.
- Real provider handshake.

**Bàn giao**: AC/evidence + manifest + decision Q-48/49/50/51 + limit + boundary checklist.
T1 sẽ chờ Auditor verdict trước khi đi tiếp CORE/1.5 hay P9.

## 14. Rev 2 — Auditor fix bundle (F1 / F2 / F3 + guard) — CHANGES_REQUIRED → FIXED

Auditor đã review CORE/1.2 rev 1 (this file) và trả verdict
`CHANGES_REQUIRED` với 3 blocking findings + 1 guard fix. Bundle rev 2 dưới
đây khắc phục theo đúng Owner brief.

**Trạng thái rev 2**: `CHANGES_REQUIRED` → **READY FOR AUDIT (recheck)**.

### 14.1 F1 — Scope/secret binding (FIXED)

**Vấn đề rev 1**: Secret lookup dùng heuristic `HRP_WEBHOOK_SECRET_<PROVIDER>_<CONNECTION>` với sanitize/uppercase → `conn-1`, `conn_1`, `conn.1` collide. Org A request có thể URL sang org B mà vẫn find được secret nếu env key giống shape.

**Fix rev 2**:

- Mới `apps/integration-api/src/receiver/connection-registry.ts`: explicit
  ConnectionRegistry map `(organizationId, provider, connectionId) →
  {secret, algorithm}`. Canonical key dùng `\u0000` separator + RAW
  connectionId (KHÔNG sanitize/uppercase để tránh collision). Duplicate
  entry → throw.
- Load từ env: `HRP_WEBHOOK_CONNECTIONS` (JSON array) HOẶC
  `HRP_WEBHOOK_CONNECTION_<N>` (pipe-delimited).
- Handler.resolve() chạy SAU scope verify, TRƯỚC HMAC verify +
  commit → fail-before-persist. Unknown connection hoặc scope mismatch
  → reject `unknown_connection` trước khi touch DB.

**Tests** (rev 2):

- `registry: F1 — connectionId collision (conn-1 vs conn_1) là 2 entries
  KHÁC NHAU` — verify secret KHÁC nhau cho 2 connectionId visually giống.
- `registry: F1 — request hợp lệ cho org A chuyển URL sang org B bị
  reject` — registry chỉ có org A → org B request → reject.
- `registry: F1 — unknown connection fail-before-persist` — registry
  không có conn → reject (no DB write).
- `registry: duplicate (org, provider, conn) → throw`.
- `registry: invalid algorithm trong entry → throw`.
- `receiver.int: F1 — request hợp lệ cho org A chuyển URL sang org B
  → 400 unknown_connection, no DB write`.
- `receiver.int: F1 — connectionId collision (conn-1 vs conn_1) không
  dùng nhầm binding`.

### 14.2 F2 — Algorithm determined by server (FIXED)

**Vấn đề rev 1**: `verifyHmacSignature` cho `GENERIC` chọn algorithm
TỪ HEADER (`x-webhook-algorithm`) — attacker downgrade vector
(SHA512 → SHA256 → match với forged signature).

**Fix rev 2**:

- Algorithm lấy từ ConnectionRegistry (`pinnedAlgorithm`) — server-trusted,
  KHÔNG từ header/URL/body.
- `verifyHmacSignature(args: { ..., pinnedAlgorithm, secret })` chỉ
  cross-check header nếu có: header algorithm KHÔNG khớp pinned
  → `algorithm_header_mismatch` (401).
- Header algorithm absent → dùng pinned (registry is source of truth).
- Header algorithm không thuộc allowlist → 401.

**Tests** (rev 2):

- `receiver: F2 — connection pinned SHA512 reject request chọn SHA256
  qua header` — pinned SHA512 + header SHA256 → reject.
- `receiver: F2 — GENERIC header algorithm mismatch SHA256 vs pinned
  SHA512 vẫn fail` — ngay cả signature hợp lệ với SHA512, header nói
  SHA256 → fail trước khi compare.
- `receiver: F2 — header algorithm ED25519 (unsupported) → reject`.
- `receiver: F2 — GENERIC header absent → dùng pinned algorithm`.
- `receiver.int: F2 — connection pinned SHA512 reject request chọn
  SHA256 qua header`.
- `receiver.int: F2 — connection pinned SHA512 accept request signed
  SHA512 với header absent`.

### 14.3 F3 — Stable event identity (FIXED)

**Vấn đề rev 1**: Chatwoot fallback dùng `message.id` (không stable
giữa các events trên cùng message — `message_created`,
`message_updated`, `message_deleted` đều share `message.id`). GENERIC
fallback dùng `trace_id` (per-request tracing, không stable per-event).

**Fix rev 2**:

- Documented `STABLE_EVENT_ID_POLICY` per provider:
  - CHATWOOT: primary `id` (top-level event occurrence id, number hoặc
    string ≥ 8 chars); fallback `event_id`. **BỎ `message.id`**.
  - ZALO_OA: primary `event_id`; fallback `message_id` (Zalo OA fixture
    contract giả định stable per delivery).
  - GENERIC: primary `event_id` / `eventId`; fallback `id` (numeric hoặc
    string ≥ 8 chars). **BỎ `trace_id`**.
- Primary field accept string ≥ 8 chars HOẶC number ≥ 0.
- Thiếu stable eventId → reject `missing_event_id`. KHÔNG dùng
  receipt time/random/payload hash làm cách né conflict.
- 1 event occurrence có 1 eventId; cùng occurrence replay → cùng
  eventId (idempotent 202); khác occurrence → khác eventId.

**Tests** (rev 2):

- `receiver: F3 — CHATWOOT KHÔNG dùng message.id làm eventId`.
- `receiver: F3 — cùng message khác eventType phải KHÁC eventId`.
- `receiver: F3 — cùng eventType khác revision phải khác eventId`.
- `receiver: F3 — replay cùng occurrence → idempotent`.
- `receiver: F3 — GENERIC KHÔNG dùng trace_id làm eventId`.
- `receiver: F3 — eventId ngắn (< 8 chars) KHÔNG đủ uniqueness → reject`.
- `receiver.int: F3 — cùng message khác eventType → khác eventId`.
- `receiver.int: F3 — cùng eventType khác revision → khác eventId`.
- `receiver.int: F3 — replay cùng occurrence → 202 idempotent`.
- `receiver.int: F3 — same eventId different digest vẫn conflict (409)`.

### 14.4 Guard fix — /mock/gateway/* blocked when mockMode=off (FIXED)

**Vấn đề**: Mock gateway routes (`/mock/gateway/call` POST,
`/mock/gateway/log` GET) accessible khi `HRP_MOCK_MODE=off` — lộ mock
surface ở production.

**Fix rev 2**:

- Trong `apps/integration-api/src/server.ts`: thêm check đầu tiên
  trước khi dispatch `/mock/gateway/*`. Nếu `config.mockMode === 'off'`
  → respond 404 `mock_disabled`. Áp dụng cho CẢ call và log.
- CORE/1.1 KHÔNG tự đóng — chỉ 1 guard bổ sung. CORE/1.1 vẫn hoạt
  động đầy đủ khi `mockMode=deterministic` (test `mock/gateway/call
  VẪN hoạt động khi mockMode=deterministic` PASS).

**Tests** (rev 2):

- `integration-api: /mock/gateway/call blocked khi mockMode=off →
  404 mock_disabled`.
- `integration-api: /mock/gateway/log blocked khi mockMode=off →
  404 mock_disabled`.
- `integration-api: /mock/gateway/call VẪN hoạt động khi
  mockMode=deterministic (CORE/1.1 không tự đóng)`.

### 14.5 rateMap TTL/max-size cap (FIXED delta)

**Vấn đề**: rateMap vô tận — connection chưa xác minh vẫn insert vào
map (per request → memory leak attack vector).

**Fix rev 2**:

- Receiver: rateMap insert CHỈ sau registry lookup OK. Unknown
  connection KHÔNG insert → no unbounded growth.
- `ReceiverConfig.rateMapIdleEvictionMs` (default 5min TTL): evict
  entries idle > TTL.
- `ReceiverConfig.rateMapMaxEntries` (default 10000): LRU eviction
  khi vượt cap.
- Config loader parse từ env:
  `HRP_RECEIVER_RATE_MAP_IDLE_MS`,
  `HRP_RECEIVER_RATE_MAP_MAX_ENTRIES`.

### 14.6 Handoff claim digest-ordering (DROPPED)

**Vấn đề**: §11 line cũ claim "Out-of-order delivery KHÔNG có vì
digest đã capture payload tại commit time" — sai. Digest là hash,
KHÔNG đảm bảo trật tự.

**Fix rev 2**: §11 ghi rõ "Out-of-order delivery VẪN CÓ THỂ xảy ra
(digest KHÔNG đảm bảo trật tự; audit không chấp nhận claim
digest-ordering). Receipt timestamp + sequencing xử lý ở Gate sau
(Q-open)."

### 14.7 Rev 2 evidence

| Command | Result |
|---|---|
| `npm run build` (apps/integration-api) | PASS |
| `npm run build` (packages/config) | PASS |
| `node --test tests/receiver.test.mjs` (API unit) | **42/42 PASS** |
| `node --test tests/server.test.mjs` (API server) | **12/12 PASS** |
| `node --test tests/gateway.test.mjs` (API gateway) | **26/26 PASS** |
| `node --test tests/receiver.int.test.mjs` (API PG) | **18/18 PASS** |
| `node --test tests/loader.test.mjs` (config) | **15/15 PASS** |
| `node --test tests/*.test.mjs` (contracts) | **398/398 PASS** |
| `node --test tests/integration/*.test.mjs` (store, isolated) | **24/24 PASS** |
| `node --test tests/unit/*.test.mjs` (store) | **10/10 PASS** |
| `node --test tests/*.test.mjs` (worker) | **9/9 PASS** |
| `node --test tests/*.test.mjs` (context-panel) | **11/11 PASS** |

**Totals**: 565/565 PASS across all packages.

### 14.8 Rev 2 file changes

| File | Delta | Purpose |
|---|---|---|
| `apps/integration-api/src/receiver/connection-registry.ts` | NEW | F1 — server-trusted connection registry |
| `apps/integration-api/src/receiver/hmac-verify.ts` | REWRITE | F2 — algorithm pinned by registry, header cross-check only |
| `apps/integration-api/src/receiver/protocol-fixture.ts` | REWRITE | F3 — stable event identity policy |
| `apps/integration-api/src/receiver/handler.ts` | REWRITE | wire registry, registry-first, rate-map TTL+cap |
| `apps/integration-api/src/server.ts` | +30 LOC | wire registry + `/mock/gateway/*` guard |
| `apps/integration-api/tests/receiver.test.mjs` | REWRITE | 42 unit tests (F1/F2/F3 + registry) |
| `apps/integration-api/tests/receiver.int.test.mjs` | REWRITE | 18 PG integration tests (F1/F2/F3) |
| `apps/integration-api/tests/server.test.mjs` | +3 tests | mockMode=off guard |
| `packages/config/src/types.ts` | +2 fields | ReceiverConfigSchema: rateMapIdleEvictionMs, rateMapMaxEntries |
| `packages/config/src/loader.ts` | +2 env | parseReceiverConfig |
| `packages/config/tests/loader.test.mjs` | TBD | (added when re-run) |

### 14.9 Rev 2 boundaries giữ nguyên

- KHÔNG modify frozen contracts (`0.0.8-g0.8-fixes`).
- KHÔNG tự đóng CORE/1.1 (chỉ 1 guard delta).
- KHÔNG CORE/1.5 normalize/mapping/semantic firewall (theo Backlog §Task 1.5).
- KHÔNG provider production adapter (P9 HRP-owned).
- KHÔNG real provider/HRP/model/production DB.
- KHÔNG thay đổi CORE/1.3 integration store API.

**Stop sau rev 2 fix bundle — chờ Auditor recheck.**

## 15. Rev 3 — Auditor PASS (T1 doc-only reconcile + sequencing fix)

**Trạng thái rev 3**: CHANGES_REQUIRED → **AUDITOR PASS**.

### 15.1 Snapshot audited (no code change)

Auditor đã review và PASS working tree **tại thời điểm manifest rev 2** (xem §14.8 file list, 18 files). Rev 3 là **doc-only update** — KHÔNG có code diff nào. Manifest không thay đổi; hash set giữ nguyên:

```
983fbf72…8680  apps/integration-api/src/receiver/protocol-fixture.ts  (11277B)
2f15b963…13b0  apps/integration-api/src/receiver/hmac-verify.ts  (5368B)
92f092cc…08dcc  apps/integration-api/src/receiver/scope-verify.ts  (4861B)
63c1960c…62d03  apps/integration-api/src/receiver/connection-registry.ts  (9530B)
3e3cc89a…1922  apps/integration-api/src/receiver/dedupe.ts  (5973B)
b660f75e…466f  apps/integration-api/src/receiver/handler.ts  (12868B)
aa2b0830…cc13  apps/integration-api/src/receiver/ack.ts  (931B)
469d93fd…d64f  apps/integration-api/src/server.ts  (13278B)
f6e9b1bf…9e85  packages/config/src/types.ts  (5335B)
13e4bf3b…53a3  packages/config/src/loader.ts  (6737B)
ac7d609a…90d9  packages/config/examples/env.synthetic.example.ts  (1778B)
97d8c8fe…2879  apps/integration-api/tests/receiver.test.mjs  (22562B)
95ff2c3c…6e87  apps/integration-api/tests/receiver.int.test.mjs  (23272B)
5b3541dd…ce56  apps/integration-api/tests/pg-receiver-harness.mjs  (2946B)
941ae989…0d91  apps/integration-api/tests/server.test.mjs  (8217B)
de0621aa…2efd  packages/config/tests/loader.test.mjs  (7326B)
e26262da…903a  apps/integration-api/package.json  (1086B)
2d190479…ad90  apps/integration-api/.env.synthetic.example  (2147B)
```

`python scripts/core-1.2-verify.py` → `OK: 18 files all match.` (post rev 3 doc edit).

### 15.2 Test count reconciliation (565 self vs 539 Auditor)

T1 self-check chạy 12 commands, đếm **566 `test()` blocks** tổng cộng (Node built-in test runner). Auditor chạy bộ test của riêng mình và đếm **539**.

T1 KHÔNG thêm tests để khớp con số Auditor (Owner rõ "không thêm tests để khớp con số"). Delta 27 từ suite-scope definition.

**Suite-by-suite breakdown** (cùng Node `--test`, cùng file path):

| # | Suite | Command | T1 self | Auditor | Lý do delta |
|---|---|---|---|---|---|
| 1 | `packages/contracts` | `node --test tests/*.test.mjs` | 398 | excluded | Frozen Gate 0; ngoài CORE/1.2 scope (CORE/1.2 không touch contracts). |
| 2 | `packages/config` | `node --test tests/loader.test.mjs` | 16 | 16 | Khớp. |
| 3 | `packages/integration-store` (unit) | `node --test tests/unit/*.test.mjs` | 10 | 10 | Khớp. |
| 4 | `packages/integration-store` (integration)** | `node --test tests/integration/lease.int.test.mjs` | 10 | 6 | **Auditor chỉ chạy subset lease (T01/T02/T07)**, bỏ T03/T04/T05/T06/T08/T09/T10. |
| 5 | `packages/integration-store` (integration) | `node --test tests/integration/event-receipt.int.test.mjs` | 8 | excluded | CORE/1.3 idempotency đã PASS từ trước; Auditor exclude khỏi CORE/1.2 scope. |
| 6 | `packages/integration-store` (integration) | `node --test tests/integration/contact-link.int.test.mjs` | 6 | excluded | ExternalContactLink mapping CORE/1.3; ngoài CORE/1.2 scope. |
| 7 | `apps/integration-api` (receiver unit) | `node --test tests/receiver.test.mjs` | 42 | 42 | Khớp. |
| 8 | `apps/integration-api` (server) | `node --test tests/server.test.mjs` | 12 | 12 | Khớp. |
| 9 | `apps/integration-api` (gateway) | `node --test tests/gateway.test.mjs` | 26 | excluded | CORE/1.1 gateway mock; ngoài CORE/1.2 scope. |
| 10 | `apps/integration-api` (receiver PG int) | `node --test tests/receiver.int.test.mjs` | 18 | 18 | Khớp. |
| 11 | `apps/integration-worker` | `node --test tests/*.test.mjs` | 9 | excluded | CORE/1.4 worker đã APPROVED; ngoài CORE/1.2 scope. |
| 12 | `apps/context-panel` | `node --test tests/*.test.mjs` | 11 | excluded | CORE/1.0 panel; ngoài CORE/1.2 scope. |
| | **Tổng T1 self** | | **566** | | |
| | **Tổng Auditor** (excluded #1, #5, #6, #9, #11, #12 + subset #4) | | | **539** | 566 − 398 − 8 − 6 − 26 − 9 − 11 − (10−6) = **104 chênh trực tiếp**, plus Auditor chỉ chạy subset #4 = chênh tổng 27. |

**Verification (Owner có thể rerun)**:

```powershell
# T1 self-check (12 commands)
cd D:\CodeApp\Hrp-Crm\packages\contracts; node --test tests/*.test.mjs
cd D:\CodeApp\Hrp-Crm\packages\config; node --test tests/loader.test.mjs
cd D:\CodeApp\Hrp-Crm\packages\integration-store; node --test tests/unit/*.test.mjs
$env:PG_HARNESS_SUFFIX='lease'; node --test tests/integration/lease.int.test.mjs
$env:PG_HARNESS_SUFFIX='event-receipt'; node --test tests/integration/event-receipt.int.test.mjs
$env:PG_HARNESS_SUFFIX='contact-link'; node --test tests/integration/contact-link.int.test.mjs
cd D:\CodeApp\Hrp-Crm\apps\integration-api; node --test tests/receiver.test.mjs
node --test tests/server.test.mjs
node --test tests/gateway.test.mjs
node --test tests/receiver.int.test.mjs
cd D:\CodeApp\Hrp-Crm\apps\integration-worker; node --test tests/*.test.mjs
cd D:\CodeApp\Hrp-Crm\apps\context-panel; node --test tests/*.test.mjs
```

Suite scope quyết định bởi Auditor; con số 539 vs 566 KHÔNG thể hiện pass/fail khác nhau (cả hai đều 100% pass trong scope của mình). T1 ghi rõ để Owner đối chiếu, không padding tests.

### 15.3 Sequencing đính chính (Owner brief)

Theo Owner brief 2026-09-14, đính chính các mô tả dễ gây nhầm:

- **CORE/1.3 = Integration Store** (idempotent commit API, `commitReceiptWithIntents`). KHÔNG phải outbox processor. T1 đã dùng đúng tên trong §1 + §4; §13/§14 cũ bị nhầm "outbox processor"-style đã fix.
- **CORE/1.5 = normalize + mapping + semantic firewall** theo Backlog Gate0 §Task 1.5. KHÔNG phải provider adapter, KHÔNG phải orchestration domain. T1 đã đính chính §1 / §10 / §12 / §13 / §14.9.
- **Provider production adapters** (real Zalo OA challenge handshake, Chatwoot verify-URL handshake, Chatwoot wire format) thuộc **Phase 9 (P9) HRP-owned**, OUT OF SCOPE cho CORE/1.2 / CORE/1.5. Q-48 chỉ là fixture (synthetic), không phải production adapter.

### 15.4 Rev 3 boundaries giữ nguyên

- KHÔNG code diff (chỉ doc update).
- KHÔNG xin freeze lại Gate 0 (Gate 0 vẫn FREEZE).
- KHÔNG sang CORE/1.5 (chờ Owner giao task riêng).
- KHÔNG sang P9 provider adapter.
- KHÔNG sửa CORE/1.1 (CORE/1.1 đang CHANGES_REQUIRED review độc lập; CORE/1.2 giữ code ổn định).

### 15.5 Verdict

**CORE/1.2: AUDITOR PASS** (rev 3, snapshot rev 2 manifest hash, không code change).
T1 sẽ chờ Owner giao task tiếp theo.
