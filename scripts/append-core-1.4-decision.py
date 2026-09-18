#!/usr/bin/env python3
"""Append CORE/1.4 decisions Q-45/46/47 to decision-register.md (UTF-8 safe)."""
import os

REPO = r"D:\CodeApp\Hrp-Crm"
F = os.path.join(REPO, "docs/contracts/decision-register.md")

section = """

---

# CORE/1.4 — Decisions Q-45 / Q-46 / Q-47

Ngày 2026-09-14. T1 writer. Addendum cho CORE/1.4 — Durable worker/queue leasing.

## Q-45 — Queue layer choice: PostgreSQL polling

**Question**: Queue/lease layer cho CORE/1.4 nên dùng broker ngoài (Redis/NATS/SQS) hay PostgreSQL polling?

**Status**: **PROPOSED** (Owner chốt khi production gate; không chặn CORE/1.4 self-check).

**Decision / delta**:
- Chọn **PostgreSQL polling** (claimNextReceipt = atomic UPDATE ... RETURNING với fencing token).
- Không thêm broker. Lý do:
  - Scale hiện tại (≤1K receipts/s) chưa cần broker.
  - Broker thêm vận hành: HA setup, schema registry, observability riêng.
  - PostgreSQL đã có sẵn cho Integration Store; row-level UPDATE đủ để đảm bảo exclusivity.
- Threshold để mở lại: nếu throughput vượt K receipts/s và DB poll không gánh nổi (p95 claim latency > X ms), mở lại với broker.
- **Tác động**: chỉ giới hạn queue layer của Integration Store; KHÔNG động tới HRP canonical queue/idempotency (vẫn thuộc HRP-owned PR Phase 9).

**Where recorded**:
- `packages/integration-store/src/worker/lease.ts` (`claimNextReceipt`, `claimNextIntent`)
- `apps/integration-worker/src/durable-worker.ts` (poll loop)
- `docs/contracts/handoff-core-1.4.md` §6
- `docs/contracts/inventory.md` (CORE/1.4 section, Q-45)

## Q-46 — Retry policy defaults

**Question**: `RetryPolicy` defaults nào cho CORE/1.4 worker?

**Status**: **PROPOSED** (Owner chốt khi production gate; không chặn CORE/1.4 self-check).

**Decision / delta**:
- `DEFAULT_RETRY_POLICY = { maxAttempts: 8, initialDelayMs: 1000, maxDelayMs: 300000, jitterFactor: 0.2, backoffMultiplier: 2 }`.
- `isRetryable(err)` chỉ retry các `ErrorCode.retryClass ∈ { BOUNDED_SAME_KEY, RETRY_AFTER_DEPENDENCY, RETRY_AFTER_RATE_LIMIT }`.
- Codes `NEVER` (validation/forbidden/idempotency/version/auth) → fail fast, set DEAD_LETTERED.
- `computeNextAttemptAt(policy, attempts, clock)` trả về `min(initialDelayMs * backoffMultiplier^(attempts-1), maxDelayMs)` × jitter.
- `decideRetryState(policy, attempts, err)` → `{ action: 'retry', nextAttemptAt } | { action: 'dead-letter', reasonCode }`.
- Bounded: `attempts >= maxAttempts` → dead-letter ngay cả khi retryable.

**Where recorded**:
- `packages/integration-store/src/worker/retry.ts`
- `packages/integration-store/src/worker/index.ts` (export)
- `docs/contracts/handoff-core-1.4.md` §6.4
- `docs/contracts/inventory.md` (CORE/1.4 section, Q-46)

## Q-47 — Fencing model

**Question**: Fencing token semantics và enforcement ntn để stale worker không ghi đè kết quả worker mới?

**Status**: **PROPOSED** (Auditor xác nhận trong CORE/1.4 audit).

**Decision / delta**:
- `fencingToken` UUIDv4 sinh per claim, lưu trên `ExternalEventReceipt.fencingToken` (VARCHAR(128)) + `leaseFencedAt` (timestamp).
- `claimNextReceipt` UPDATE: `SET leaseOwner=$workerId, leaseExpiresAt=now()+$leaseDurationMs, fencingToken=$uuid, leaseFencedAt=now() WHERE state IN (...) AND leaseExpiresAt IS NULL OR leaseExpiresAt < now() RETURNING *`.
- `completeReceipt` SQL:
  ```sql
  UPDATE integration."ExternalEventReceipt"
  SET state=$newState,
      resolvedAt=...,
      reasonCode=...,
      -- lease clear on success
      leaseOwner=NULL,
      leaseExpiresAt=NULL,
      fencingToken=NULL,
      leaseFencedAt=NULL,
      updateCount=updateCount+1
  WHERE id=$receiptId
    AND "leaseOwner"=$workerId
    AND "fencingToken"=$fencingToken
    AND state=$expectedCurrentState
  RETURNING *
  ```
- Nếu `rowCount=0` → trả `fencedRejected=true`. Worker coi như stale; KHÔNG retry trên cùng receipt (vì lease đã thuộc worker khác hoặc đã reclaim).
- T1 self-check: chỉ `completeReceipt` trong `lease.ts` là UPDATE state path. `repos/event-receipt.ts` (CORE/1.3) chỉ INSERT receipt mới + atomic dispatch intent insert; không UPDATE state của receipt hiện hữu. **Pass**.
- Auditor cần xác nhận KHÔNG có code path nào bypass fencing check (ví dụ: future `repos/intent.ts` không được UPDATE receipt state).

**Where recorded**:
- `packages/integration-store/src/worker/lease.ts` (claim + complete paths)
- `packages/integration-store/prisma/migrations/0002_worker_lease_fencing/migration.sql`
- `apps/integration-worker/src/durable-worker.ts` (fencing check before complete)
- `docs/contracts/handoff-core-1.4.md` §6.2
- `docs/contracts/inventory.md` (CORE/1.4 section, Q-47)

---

# CORE/1.4 — Self-check deltas

- Migration `0002_worker_lease_fencing`: PASS (apply + rollback có script).
- `npm run typecheck` (contracts/config/integration-store/integration-worker): PASS.
- `npm test` (contracts 398 + config 13 + integration-store unit 10 + integration-api 35 + context-panel 11 + integration-worker 9 = 476 unit/scaffold PASS).
- `npm run test:integration` (integration-store): 24/24 PASS (10 contact-link + 4 event-receipt + 10 lease mới).
- Manifest `handoff-core-1.4.manifest.txt`: 25/25 verified.
- Frozen contracts: ZERO delta.
"""

with open(F, "a", encoding="utf-8") as fp:
    if not section.endswith("\n\n"):
        section += "\n"
    fp.write(section)

print(f"Appended {len(section)} chars to {F}")
