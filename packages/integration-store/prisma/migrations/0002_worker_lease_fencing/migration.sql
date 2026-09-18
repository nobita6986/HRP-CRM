-- packages/integration-store/prisma/migrations/0002_worker_lease_fencing/migration.sql
--
-- CORE/1.4 -- Durable worker leasing. Add fencing columns to support
-- atomic claim/complete with stale-worker rejection.
--
-- Boundary:
--  - Reuse existing leaseOwner/leaseExpiresAt columns (CORE/1.3 placeholder).
--  - Add fencingToken (opaque scalar) for atomic state-transition guard:
--      * claimReceipt writes a fresh fencingToken.
--      * completeReceipt/extendLease/reclaimLease check fencingToken.
--      * stale worker with expired/old token rejected.
--  - Add leaseFencedAt (last fence time) for audit + recovery observability.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS so migration can re-run on
-- pre-existing DB without breaking (Postgres 9.6+).
--
-- Rollback: see rollback.sql -- DROP COLUMN.

BEGIN;

SET search_path TO integration, public;

-- ExternalEventReceipt -- fencing + idempotencyKey columns
ALTER TABLE integration."ExternalEventReceipt"
  ADD COLUMN IF NOT EXISTS "fencingToken"   VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "leaseFencedAt"  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "nextAttemptAt"  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "idempotencyKey" VARCHAR(256);

-- DispatchIntent -- fencing columns
ALTER TABLE integration."DispatchIntent"
  ADD COLUMN IF NOT EXISTS "fencingToken"   VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "leaseFencedAt"  TIMESTAMP;

-- Indexes for lease-scan + fencing-token lookup
-- Existing indexes already cover state + leaseExpiresAt on both tables.
-- Fencing-token index for direct lookup by token (claim verification):
CREATE INDEX IF NOT EXISTS "ix_receipt_fencing_token"
  ON integration."ExternalEventReceipt" ("fencingToken");

CREATE INDEX IF NOT EXISTS "ix_intent_fencing_token"
  ON integration."DispatchIntent" ("fencingToken");

COMMIT;
