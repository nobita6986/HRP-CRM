-- Migration: 0004_recovery_action
-- CORE/1.8 AC5
-- RecoveryAction model for stuck receipt/intent reconciliation.
-- Idempotency: unique (itemType + itemId) constraint prevents duplicate recovery.
-- Rollback: DROP TABLE IF EXISTS integration."RecoveryAction";

DO $$ BEGIN
  CREATE TYPE "integration"."RecoveryStatus" AS ENUM (
    'PENDING',
    'APPLIED',
    'SKIPPED',
    'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "integration"."RecoveryItemType" AS ENUM (
    'RECEIPT',
    'INTENT',
    'MAPPING'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "integration"."RecoveryActionKind" AS ENUM (
    'RESET_TO_PENDING',
    'RECLAIM_LEASE',
    'DEAD_LETTER',
    'SKIP'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "integration"."RecoveryAction" (
  "recoveryId"         VARCHAR(128) NOT NULL,
  "itemType"           "integration"."RecoveryItemType" NOT NULL,
  "itemId"             VARCHAR(128) NOT NULL,
  "action"             "integration"."RecoveryActionKind" NOT NULL,
  "actor"              VARCHAR(256) NOT NULL,
  "snapshotJson"       JSONB,
  "status"             "integration"."RecoveryStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completedAt"        TIMESTAMPTZ,
  "reason"             VARCHAR(512),
  PRIMARY KEY ("recoveryId"),
  CONSTRAINT "uq_recovery_idem_key" UNIQUE ("itemType", "itemId")
);

CREATE INDEX IF NOT EXISTS "ix_recovery_status"   ON "integration"."RecoveryAction" ("status");
CREATE INDEX IF NOT EXISTS "ix_recovery_actor"    ON "integration"."RecoveryAction" ("actor");
CREATE INDEX IF NOT EXISTS "ix_recovery_created_at" ON "integration"."RecoveryAction" ("createdAt" DESC);
