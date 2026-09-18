#!/usr/bin/env python3
"""Append CORE/1.4 section to inventory.md (UTF-8 safe)."""
import os

REPO = r"D:\CodeApp\Hrp-Crm"
INV = os.path.join(REPO, "docs/contracts/inventory.md")

section = """
---

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
- **Q-46** (retry policy defaults): `maxAttempts=8`, `initialDelayMs=1s`, `maxDelayMs=5m`, `jitterFactor=0.2`, `backoffMultiplier=2`. `isRetryable` theo `ErrorCode.retryClass` (Gate 0 errors.ts taxonomy). **PROPOSED**, Owner chốt khi production gate.
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
"""

with open(INV, "a", encoding="utf-8") as f:
    if not section.endswith("\n\n"):
        section += "\n"
    f.write(section)

print(f"Appended {len(section)} chars to {INV}")
