-- packages/integration-store/prisma/migrations/0006_automation_idempotency_authority/migration.sql
--
-- T1-B N8N/0.3 r1 -- RG-02 durable idempotency authority.
--
-- Replaces process-local map for the real gateway runtime with a
-- PostgreSQL-backed ledger. The first
--   (scopeKey, payloadDigest, correlationId)
-- claim and the terminal record() write must be atomic. Same triple replays
-- the recorded response. Digest mismatch or correlationId mismatch returns
-- IDEMPOTENCY_CONFLICT. Restart and two instances must preserve this.
--
-- Boundary:
--  - Idempotent: every CREATE/INDEX statement uses IF NOT EXISTS.
--  - No canonical HRP FKs. organizationId + connectionId are scalars.
--  - Bounded pending/lease: leaseOwner + leaseExpiresAt + fencingToken.
--  - First-writer-wins on boundCorrelationId: the server preserves the
--    original binding; subsequent record() calls DO NOT overwrite it.
--
-- Rollback: see rollback.sql -- DROP TABLE + DROP TYPE.

DO $$ BEGIN
  CREATE TYPE "integration"."AutomationIdempotencyState" AS ENUM (
    'PENDING',     -- claimed, processing in flight (lease held)
    'RECORDED'    -- terminal record committed; bindable by correlationId
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "integration"."AutomationIdempotencyRecord" (
  -- scopeKey = orgId|connId|serviceId|commandName|idempotencyKey (server-trusted).
  -- 32-byte NUL-delimited UTF-8 fits 256 chars for typical keys.
  "scopeKey"            VARCHAR(256) NOT NULL,

  -- SHA-256 hex of the canonicalized envelope (volatile tracking ids stripped).
  "payloadDigest"       VARCHAR(64) NOT NULL,

  -- The correlationId that FIRST recorded this row. Subsequent writes
  -- preserve this value (first-writer-wins) regardless of what the
  -- caller passes; the lookup path uses it to detect a retry that
  -- rotated correlationId.
  "boundCorrelationId"  VARCHAR(128) NOT NULL,
  "incomingCorrelationIdOnRecord" VARCHAR(128) NOT NULL,

  -- Idempotency key (echoed from the envelope for traceability).
  "idempotencyKey"      VARCHAR(256) NOT NULL,
  "commandName"         VARCHAR(64) NOT NULL,
  "organizationId"      VARCHAR(64) NOT NULL,
  "connectionId"        VARCHAR(128) NOT NULL,
  "serviceId"           VARCHAR(128) NOT NULL,
  "workflowId"          VARCHAR(128) NOT NULL,

  -- Atomic claim state: PENDING = lease held by `leaseOwner` until
  -- `leaseExpiresAt`. RECORDED = terminal response committed.
  "state"               "integration"."AutomationIdempotencyState" NOT NULL DEFAULT 'RECORDED',

  -- Bounded lease / fencing.
  "leaseOwner"          VARCHAR(128),
  "leaseExpiresAt"      TIMESTAMPTZ,
  "fencingToken"        VARCHAR(128),
  "leaseFencedAt"       TIMESTAMPTZ,

  -- Terminal wire response payload (jsonb). The shape is determined by
  -- AutomationWireResponse from automation/types.ts; the receiver does
  -- NOT log this verbatim -- the gateway redacts before serialization.
  "resultJson"          JSONB NOT NULL,

  -- Audit timestamps.
  "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "claimCount"          INTEGER NOT NULL DEFAULT 0,
  "hitCount"            INTEGER NOT NULL DEFAULT 0,

  PRIMARY KEY ("scopeKey"),

  -- Lookup hot path: scopeKey + payloadDigest + boundCorrelationId.
  -- The scope key is already the PK, so the only secondary index needed
  -- is on leaseExpiresAt (background reclaim sweep).
  CONSTRAINT "uq_idem_scope_state"
    CHECK ("scopeKey" <> '')
);

CREATE INDEX IF NOT EXISTS "ix_idem_record_lease_expiry"
  ON "integration"."AutomationIdempotencyRecord" ("leaseExpiresAt")
  WHERE "state" = 'PENDING';

CREATE INDEX IF NOT EXISTS "ix_idem_record_created_at"
  ON "integration"."AutomationIdempotencyRecord" ("createdAt" DESC);

CREATE INDEX IF NOT EXISTS "ix_idem_record_org_created"
  ON "integration"."AutomationIdempotencyRecord" ("organizationId", "createdAt" DESC);

-- updatedAt is bumped automatically by trigger to mimic @updatedAt.
CREATE OR REPLACE FUNCTION "integration"."set_updated_at_idem"()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_idem_record_updated_at" ON "integration"."AutomationIdempotencyRecord";
CREATE TRIGGER "trg_idem_record_updated_at"
  BEFORE UPDATE ON "integration"."AutomationIdempotencyRecord"
  FOR EACH ROW
  EXECUTE FUNCTION "integration"."set_updated_at_idem"();
