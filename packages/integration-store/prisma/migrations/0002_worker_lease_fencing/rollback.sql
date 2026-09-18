-- packages/integration-store/prisma/migrations/0002_worker_lease_fencing/rollback.sql
--
-- Manual rollback for migration 0002. Không dùng prisma migrate rollback
-- (CORE/1.3 thiếu tooling). Operations DBA chạy sau khi review ảnh hưởng:
--   1. Verify không có worker đang chạy.
--   2. Verify không có receipt/intent đang LEASED (leaseOwner non-null).
--   3. Run rollback script.
--   4. Notify integration worker restart.
--
-- IMPORTANT: Drop index trước khi drop column.

BEGIN;

SET search_path TO integration, public;

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

COMMIT;
