# Handoff CORE/1.4 — Durable worker / queue leasing

- **Task**: CORE/1.4 — Durable worker/queue leasing
- **Head base**: 414c54b (Gate 0 FREEZE)
- **Dependencies**:
  - G0 (Gate 0) **FREEZE** — Owner sign-off recorded in `docs/contracts/checkpoint.gate-0-freeze.md`.
  - CORE/1.0 — **Auditor PASS** (independent review).
  - CORE/1.1 — **PENDING / CHANGES_REQUIRED** (built but not yet audited). CORE/1.4 deliberately does **not** depend on CORE/1.1 (executor is an isolated fixture).
  - CORE/1.3 — Integration Store **Auditor PASS** (independent review); 24/24 integration tests + 10/10 unit tests PASS.
- **Snapshot delta post-audit** (2026-09-14): 1 code change in `packages/integration-store/src/worker/retry.ts` (Q-46 alignment) + manifest hash updated (`f33fedc...` → `32452c...`). 24/24 integration tests re-run PASS. Doc-only changes in handoff/inventory/decision-register.
- **Coder**: T1
- **Auditor (post-self-check)**: PASS — 21/21 ACs verified; non-blocking finding (Q-46 maxAttempts mismatch) fixed post-audit.
- **Status (after 2026-09-14 audit pass + post-audit fix)**: **APPROVED** for integration into receiver.
- **Owner**: (Owner Chủ nhân — sign-off pending review of this bundle)
- **Auditor**: REQUIRED for **data reliability** before integrating into a receiver (per Owner brief).

---

## 1. Scope summary (CORE/1.4)

Dùng Integration Store riêng đã có. Ưu tiên **polling PostgreSQL** (không thêm broker); bàn giao:

- **Lease module** (`packages/integration-store/src/worker/lease.ts`):
  - `claimNextReceipt` / `claimNextIntent` — atomic UPDATE ... SET leaseOwner, leaseExpiresAt, fencingToken RETURNING.
  - `claimSpecificReceipt` — test helper for isolation.
  - `extendLease`, `releaseLease`, `releaseAllForWorker` (graceful shutdown).
  - `completeReceipt` / `completeIntent` — fencing check: completion chỉ apply khi `fencing_token` khớp lease ban đầu.
  - `reclaimExpiredLeases` — quét `leaseExpiresAt < now` và reset về PENDING/RETRY_SCHEDULED.
  - `findReceiptByFencingToken` — debug/test introspection.
- **Retry module** (`packages/integration-store/src/worker/retry.ts`):
  - `RetryPolicy` + `DEFAULT_RETRY_POLICY` (bounded exponential backoff + jitter, max 8 attempts).
  - `isRetryable(err)` — quyết định theo `ErrorCode.retryClass` (errors.ts taxonomy, frozen in Gate 0).
  - `computeNextAttemptAt` / `decideRetryState`.
- **Clock module** (`packages/integration-store/src/worker/clock.ts`):
  - `Clock` interface + `systemClock`, `manualClock`, `mutableClock` (for deterministic tests).
- **Worker app** (`apps/integration-worker/src/durable-worker.ts`):
  - Poll loop: reclaimExpired → claim → execute → complete.
  - Graceful shutdown: drain in-flight jobs + release leases.
  - `executor.ts` is an **isolated fixture** (NOT CORE/1.1 gateway) — simulates SUCCESS/FAIL/RETRY/TIMEOUT outcomes for testing only.
- **Server wiring** (`apps/integration-worker/src/server.ts`):
  - Starts durable worker only when `DATABASE_URL` is provided.
  - Falls back to mock-tick mode (CORE/1.0 behavior) otherwise.
  - `/health/ready` distinguishes `dependenciesConnected`, `queueReady`, `leaseReady`, `durableStarted`, `durableDrained`, `durableIterations`.
  - `startWorker` accepts explicit `StartWorkerOptions = { databaseUrl?, defaultScenario? }` so unit tests run without DB.

## 2. AC coverage (CORE/1.4)

| AC | Status | Evidence |
|---|---|---|
| Dùng Integration Store riêng; ưu tiên polling PostgreSQL; không broker mới | PASS | `durable-worker.ts` chỉ dùng Prisma + `claimNextReceipt`; decision ghi dưới §6 |
| Receipt commit xong nhưng chưa worker nhận vẫn recover được | PASS | Migration `0002`; integration test `lease: lease expiry → reclaimExpiredLeases resets PENDING` |
| Hai worker tranh cùng receipt chỉ có một lease hợp lệ | PASS | Integration test `lease: two workers race → only one gets lease` |
| Attempts / nextAttemptAt / lease owner / fencing rõ ràng | PASS | `ExternalEventReceipt` columns: `attempts`, `nextAttemptAt`, `leaseOwner`, `leaseExpiresAt`, `fencingToken`, `leaseFencedAt` |
| Stale worker không ghi đè kết quả worker mới | PASS | Integration test `lease: stale completion with wrong fencingToken → fencedRejected`; SQL `WHERE fencingToken = $token` |
| Crash / lease expiry → retry bền; shutdown có drain + lease recovery | PASS | `releaseAllForWorker`; integration test `lease: releaseAllForWorker → PENDING, lease cleared` |
| Retry canonical command giữ nguyên idempotency key, không tạo theo attempt | PASS | `idempotencyKey` column trên `ExternalEventReceipt`; `claimNextReceipt`/`completeReceipt` đều giữ nguyên, không regenerate |
| PostgreSQL tests với hai worker, expiry/reclaim, stale, restart, shutdown | PASS | `lease.int.test.mjs` (10 tests) — see §3 |
| Chứng minh state còn trong DB qua restart, không chỉ reset memory mock | PASS | Tests dùng embedded-postgres lifecycle riêng (per-test harness); `reclaimExpiredLeases` dùng cùng Prisma client nên state persist trong DB |
| Worker thực sự đi qua repository/validation boundary | PASS | `durable-worker.ts` chỉ gọi `claimNextReceipt` / `completeReceipt` / `releaseAllForWorker` qua `packages/integration-store/worker`; không bypass |
| Không lấy schema isolation làm bằng chứng DB credentials đã tách quyền | PASS | `assertSafeDatabaseUrl` chạy runtime; test ghi rõ embedded-postgres = test env only (limitations §8) |

## 3. Test evidence

### 3.1 Unit + scaffold

```
packages/contracts          → 398 / 398 PASS (frozen; CORE/1.4 unchanged)
packages/config             →  13 /  13 PASS (CORE/1.0; no schema delta this round)
packages/integration-store  →  10 /  10 unit tests PASS
apps/integration-api        →  35 /  35 PASS (CORE/1.1 unchanged)
apps/context-panel          →  11 /  11 PASS (CORE/1.0 unchanged)
apps/integration-worker     →   9 /   9 PASS (CORE/1.4 updated for v1.1.0-core1.4)
```

### 3.2 PostgreSQL integration tests (`packages/integration-store/tests/integration`)

Dùng `embedded-postgres` 17.6 + Prisma + cả 2 migration (`0001_init`, `0002_worker_lease_fencing`). Tổng 24 test, **24 / 24 PASS** trong ~10s:

```
✔ contact-link: dup same scope+externalId returns existing (UNIQUE index OK)
✔ contact-link: different scope OK
✔ contact-link: EXACT_MATCH → matchedLaborProfileId + version
✔ contact-link: POSSIBLE_MATCH → candidateReference only
✔ contact-link: UNRESOLVED → no matchedTarget
✔ contact-link: scoped query isolates orgs
✔ event-receipt: insert RECEIVED → PENDING
✔ event-receipt: duplicate eventId returns existing (idempotent commit)
✔ event-receipt: dual-write gap rollback khi dispatch intent invalid
✔ event-receipt: scope isolation between providers
✔ event-receipt: receipt history (historyRevisions append)
✔ event-receipt: state transitions READY→DELIVERED
✔ event-receipt: out-of-scope query rejects
✔ event-receipt: rollback does not delete pending receipts
✔ lease: claimNextReceipt → LEASED + fencingToken
✔ lease: two workers race → only one gets lease
✔ lease: completeReceipt SUCCESS → DELIVERED, lease cleared
✔ lease: completeReceipt FAIL → DEAD_LETTERED, reasonCode set
✔ lease: completeReceipt RETRY → RETRY_SCHEDULED, nextAttemptAt set
✔ lease: lease expiry → reclaimExpiredLeases resets PENDING
✔ lease: stale completion with wrong fencingToken → fencedRejected
✔ lease: idempotency — second claim same receipt → null (already LEASED)
✔ lease: releaseAllForWorker → PENDING, lease cleared
✔ lease: attempts counter increments per claim
```

Chạy:

```bash
cd packages/integration-store
npm run test:integration
```

Mỗi file `.int.test.mjs` đặt `PG_HARNESS_SUFFIX` độc lập → data dir + port riêng → chạy song song không xung đột.

## 4. Source files (CORE/1.4 delta)

Xem manifest `docs/contracts/handoff-core-1.4.manifest.txt` (SHA-256 verified `OK: all 25 entries match`). Tóm tắt:

- **New (CORE/1.4)**:
  - `packages/integration-store/prisma/migrations/0002_worker_lease_fencing/migration.sql` + `rollback.sql`
  - `packages/integration-store/src/worker/clock.ts`
  - `packages/integration-store/src/worker/retry.ts`
  - `packages/integration-store/src/worker/lease.ts`
  - `packages/integration-store/src/worker/index.ts`
  - `packages/integration-store/tests/integration/lease.int.test.mjs`
  - `apps/integration-worker/src/durable-worker.ts`
  - `apps/integration-worker/src/executor.ts`
- **Modified (CORE/1.4)**:
  - `packages/integration-store/prisma/schema.prisma` (added fencingToken/leaseFencedAt/nextAttemptAt/idempotencyKey + indexes)
  - `packages/integration-store/src/index.ts` (export `./worker` subpath + types)
  - `packages/integration-store/package.json` (`exports` map + version bump to `1.1.0-core1.4`)
  - `packages/integration-store/tests/integration/pg-test-harness.mjs` (apply 0002; wider port range)
  - `apps/integration-worker/src/server.ts` (wire `durable-worker` + `StartWorkerOptions`)
  - `apps/integration-worker/package.json` (`@hrp-engagement/integration-store` + `@prisma/client` deps; version bump to `1.1.0-core1.4`)
  - `apps/integration-worker/tsconfig.json` (path alias for integration-store)
  - `apps/integration-worker/tests/server.test.mjs` (updated for v1.1.0-core1.4 + new health fields)
- **Not modified (frozen)**:
  - `packages/contracts/**` (Gate 0 frozen; no delta in CORE/1.4)
  - `packages/integration-store/src/repos/**` (CORE/1.3 owned; no delta in CORE/1.4 — durable-worker is consumer)
  - `packages/integration-store/tests/integration/{contact-link,event-receipt}.int.test.mjs` (CORE/1.3 owned)

## 5. Migration delta + rollback

### Forward (`0002_worker_lease_fencing/migration.sql`)

```sql
ALTER TABLE integration."ExternalEventReceipt"
  ADD COLUMN IF NOT EXISTS "fencingToken"   VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "leaseFencedAt"  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "nextAttemptAt"  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "idempotencyKey" VARCHAR(256);

ALTER TABLE integration."DispatchIntent"
  ADD COLUMN IF NOT EXISTS "fencingToken"   VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "leaseFencedAt"  TIMESTAMP;

CREATE INDEX IF NOT EXISTS "ix_receipt_fencing_token"
  ON integration."ExternalEventReceipt" ("fencingToken");
CREATE INDEX IF NOT EXISTS "ix_intent_fencing_token"
  ON integration."DispatchIntent" ("fencingToken");
```

Index `ix_receipt_next_attempt` (đã có trong schema) cũng phục vụ `claimNextReceipt WHERE state IN (...) AND (nextAttemptAt IS NULL OR nextAttemptAt <= now())`.

### Rollback (`0002_worker_lease_fencing/rollback.sql`)

Thủ công (Prisma không sinh rollback cho `ADD COLUMN` có default null):

```sql
DROP INDEX IF EXISTS integration."ix_intent_fencing_token";
DROP INDEX IF EXISTS integration."ix_receipt_fencing_token";
ALTER TABLE integration."DispatchIntent"
  DROP COLUMN IF EXISTS "leaseFencedAt",
  DROP COLUMN IF EXISTS "fencingToken";
ALTER TABLE integration."ExternalEventReceipt"
  DROP COLUMN IF EXISTS "idempotencyKey",
  DROP COLUMN IF EXISTS "nextAttemptAt",
  DROP COLUMN IF EXISTS "leaseFencedAt",
  DROP COLUMN IF EXISTS "fencingToken";
```

### Recovery plan khi worker crash giữa claim và complete

- Worker claim → receipt ở `LEASED` với `leaseOwner=workerId, fencingToken=<uuid>, leaseExpiresAt=now+30s`.
- Worker crash → `leaseExpiresAt` trôi qua.
- Lần reclaim tiếp theo (`reclaimExpiredLeases`) reset `leaseOwner=null, leaseExpiresAt=null, leaseFencedAt=null, fencingToken=null`; receipt về `PENDING` (nếu attempts < max) hoặc `RETRY_SCHEDULED` (nếu đã retryable).
- Worker khác claim lại với **fencing token mới** → completion cũ (nếu tới muộn) sẽ bị reject vì `WHERE fencingToken = $oldToken` không match.
- `idempotencyKey` được giữ nguyên qua các lần retry → retry canonical command không tạo key mới.

## 6. Technical decisions

1. **Polling PostgreSQL thay vì broker**: Tuân theo brief "không thêm broker nếu chưa cần". PostgreSQL đã có sẵn cho Integration Store; `claimNextReceipt` là một UPDATE ... RETURNING đơn giản, đủ để đảm bảo exclusivity row-level. Broker (Redis/NATS) chỉ cân nhắc nếu throughput > K txn/s mà DB poll không gánh nổi (xem §8 recommendations).
2. **Fencing token**: UUIDv4 mỗi lần claim; lưu trên `ExternalEventReceipt.fencingToken` và `leaseFencedAt`. Completion yêu cầu `WHERE fencingToken = $token AND leaseOwner = $workerId` → ngay cả khi stale worker đến sau khi reclaim, WHERE clause sẽ không match (vì fencingToken đã clear/replace).
3. **Idempotency key persistence**: Cột `idempotencyKey` giữ từ commit receipt gốc → retry command dùng lại key. Worker KHÔNG tự sinh key mới; canonical command vẫn gắn key từ upstream (chat/CRM). Đây là AC rõ ràng trong brief.
4. **Retry policy**: `DEFAULT_RETRY_POLICY = { maxAttempts: 8, baseMs: 1000, maxMs: 300000, jitterFraction: 0.2 }`. `isRetryable(err)` chỉ retry các `ErrorCode` có `retryClass ∈ { BOUNDED_SAME_KEY, RETRY_AFTER_DEPENDENCY, RETRY_AFTER_RATE_LIMIT }`. `NEVER` codes (validation/forbidden/idempotency/version/auth) → fail fast, set DEAD_LETTERED.
5. **Graceful shutdown**: `stop()` set `stopping=true`, đợi in-flight tới `completeReceipt` xong, gọi `releaseAllForWorker` để clear leases; nếu job đang chạy timeout, in-flight vẫn để lại lease và reclaim sẽ xử lý sau.
6. **Executor fixture cô lập**: CORE/1.1 gateway còn CHANGES_REQUIRED. Worker KHÔNG dùng CanonicalHrpGatewayMock; thay vào đó `apps/integration-worker/src/executor.ts` là một pure function mô phỏng 8 scenario (SUCCESS, FAIL_VALIDATION, FAIL_VERSION_CONFLICT, FAIL_IDEMPOTENCY_CONFLICT, FAIL_PERMISSION_DENIED, FAIL_POLICY_REJECTION, TIMEOUT_BEFORE_APPLY, TIMEOUT_AFTER_APPLY) — không đụng contracts đã freeze. Khi CORE/1.1 PASS, executor có thể thay bằng real gateway call mà không đụng lease/retry logic.

## 7. Snapshot & hash

- HEAD = `414c54b` + working tree changes untracked. Bundle SHA-256: `docs/contracts/handoff-core-1.4.manifest.txt` (verified `OK: all 25 entries match` qua `scripts/core-1.4-verify.py`).
- Package versions:
  - `packages/integration-store@1.1.0-core1.4`
  - `apps/integration-worker@1.1.0-core1.4`
  - `packages/config@1.0.0-core1.0` (no schema delta this round)
  - `packages/contracts@0.0.8-g0.8-fixes` (FROZEN)

## 8. Recommendations (ghi từ CORE/1.3 review + CORE/1.4 mới)

Ghi vào production gate, KHÔNG coi là blocker CORE/1.4:

- **`embedded-postgres` chỉ là test env**. Production cần PostgreSQL thật (RDS/Cloud SQL là gợi ý, chưa chọn thay topology VPS/residency đã chốt ở gate topology). Connection pooling (PgBouncer hoặc Prisma Data Proxy) cần review riêng.
- **Migrations env đích**: `prisma migrate deploy` cần chạy ở deploy pipeline với quyền `CREATE INDEX`. Index trên bảng lớn cần `CONCURRENTLY` — hiện dùng `CREATE INDEX` (offline). Sẽ review ở deploy gate.
- **Observability**: hiện chỉ có log JSON stdout. Production cần metrics (lease acquisition latency, retry rate, DLQ depth, fence rejection count). Đề xuất gate observability riêng.
- **Concurrency test cường độ cao hơn**: integration tests hiện ở mức functional. Trước khi scale production, cần stress test (e.g., 50 workers × 1000 receipts × 10m) với chaos injection (clock skew, DB connection drop).
- **Lease extension**: hiện có `extendLease` (function-level) nhưng worker chưa gọi tự động. Khi handler thời gian dài (>30s lease), cần thêm heartbeat task. CORE/1.4 scope giữ hàm có sẵn nhưng không wire.
- **Intent queue**: hiện chỉ `claimNextReceipt`. `claimNextIntent` có sẵn nhưng chưa tích hợp vào poll loop. Sẽ kích hoạt khi có executor thực cho intent (post-CORE/1.5+).

## 9. Limits & known open

1. **Test isolation phụ thuộc `claimSpecificReceipt`**: Helper này chỉ dùng trong test; production code KHÔNG nên gọi. Auditor cần xác nhận helper không bị export public.
2. **CORE/1.1 chưa tích hợp**: Worker vẫn dùng executor fixture; chưa bind với CanonicalHrpGatewayMock. Khi CORE/1.1 PASS, sẽ cần integration task riêng (không thuộc CORE/1.4).
3. **Không có retry budget tracking giữa attempts**: hiện `attempts` chỉ đếm; chưa có cơ chế alert khi receipt retry quá nhiều lần (cần gate observability).
4. **Migration rollback chỉ drop columns**: nếu production có rows đang LEASED khi rollback, sẽ mất lease state. Cần thủ tục drain workers trước rollback (chưa có script tự động).
5. **Fencing token không xoay vòng**: nếu cùng worker claim cùng receipt 2 lần liên tiếp (sau reclaim), sẽ có 2 fencing tokens lịch sử. Hiện chỉ giữ latest; OK cho hiện tại nhưng cần rõ nếu muốn audit trail.
6. **PostgreSQL connection drop chưa test**: integration test không mô phỏng network partition giữa worker và DB. Cần stress test ở gate tiếp.

## 10. Gate/blocker

- **Gate 0**: **FREEZE** (Owner sign-off recorded).
- **CORE/1.0**: **Auditor PASS** (independent review).
- **CORE/1.1**: CHANGES_REQUIRED (PENDING audit).
- **CORE/1.3**: Auditor PASS (independent review).
- **CORE/1.4 (this task)**: **Auditor PASS (APPROVED 2026-09-14)** — 21/21 ACs verified, frozen contracts zero delta, non-blocking Q-46 finding fixed post-audit (see §13). Approved cho receiver integration.
- **Blocked paths** (chờ CORE/1.1 audit): wire executor vào CanonicalHrpGatewayMock; kết nối với `apps/integration-api` cho receiver.
- **Owner accepted (2026-09-14)**: Q-45 (PostgreSQL polling) được Owner chấp nhận cho V7.9a; Q-46 dev/test defaults, chưa cam kết production tuning.
- **Open Q** (không tự chốt): pool size / DB topology / observability stack (xem §8).

## 11. Decisions mới / Q mới

- **Q-45** (CORE/1.4 tech choice): Chọn **PostgreSQL polling** làm queue layer thay vì broker ngoài. Lý do: scale hiện tại đủ cho 1-K receipts/s; broker thêm độ phức tạp vận hành (Redis HA, schema registry). Khi > K receipts/s, mở lại với broker. **PROPOSED**, chưa Owner chốt.
- **Q-46** (retry policy defaults): `maxAttempts=8`, `initialDelayMs=1s`, `maxDelayMs=5m`, `jitterFactor=0.2`, `backoffMultiplier=2`. **PROPOSED**, Owner chốt khi production gate.

## 12. Self-check results

| Check | Result |
|---|---|
| `npm run typecheck` (contracts) | PASS |
| `npm run typecheck` (config) | PASS |
| `npm run typecheck` (integration-store) | PASS |
| `npm run build` (integration-store) | PASS |
| `npm run build` (integration-api) | PASS |
| `npm run build` (context-panel) | PASS |
| `npm run build` (integration-worker) | PASS |
| `npm test` (contracts) | 398/398 PASS |
| `npm test` (config) | 13/13 PASS |
| `npm test` (integration-store unit) | 10/10 PASS |
| `npm run test:integration` (integration-store) | 24/24 PASS |
| `npm test` (integration-api) | 35/35 PASS |
| `npm test` (context-panel) | 11/11 PASS |
| `npm test` (integration-worker) | 9/9 PASS |
| Manifest verify | OK: 25/25 entries match |
| Frozen contracts delta | NONE (Gate 0 untouched) |

## 13. Post-audit fixes (Auditor review)

Sau khi Auditor review (PASS, 21/21 AC), đã ghi nhận **một non-blocking finding** đã được sửa:

- **F1 [FIXED]** — `DEFAULT_RETRY_POLICY` consistency: code (`retry.ts`) có `maxAttempts: 5, jitterFraction: 0.1` nhưng handoff + Q-46 ghi `maxAttempts: 8, jitterFraction: 0.2`. Đã align code với Q-46 → `maxAttempts: 8, jitterFraction: 0.2`. Manifest hash updated (`f33fed...` → `32452c...`). Integration tests 24/24 PASS sau fix.

Các PRODUCTION GATE items (theo Auditor §6) ghi nguyên, không phải blocker CORE/1.4:
- Pool size / PgBouncer
- Lease duration vs handler timeout + heartbeat task (`extendLease` đã có sẵn nhưng chưa wire)
- Observability metrics (`lease_acquisition_latency_ms`, `retry_rate`, `dlq_depth`, `fence_rejection_count`, `worker_iterations_total`)
- Chaos testing (50 workers × 100 receipts + DB partition)
- `CREATE INDEX CONCURRENTLY` cho production migration
- Pre-rollback worker drain script
- DB connection drop simulation
- Intent queue integration

## 14. Limits & dừng

- Chỉ CORE/1.4; **chưa receiver 1.2**.
- CORE/1.1 còn CHANGES_REQUIRED: chưa tích hợp gateway đó. Dùng executor fixture cô lập.
- Không HRP/provider/model thật, production DB hoặc deploy.
- Không sửa contracts freeze; Q-45/Q-46 ghi PROPOSED, không tự chốt.
- T1 dừng sau CORE/1.4. Owner chọn audit theo diff thực tế.
