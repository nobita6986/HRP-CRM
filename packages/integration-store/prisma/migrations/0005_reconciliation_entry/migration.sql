-- Migration 0005: ReconciliationEntry (CORE/1.8 AC4)
-- Adds ReconciliationEntry table for UNKNOWN delivery reconciliation.
-- Also extends IntentStatus enum with INVESTIGATION_PENDING.

-- Extend IntentStatus enum
ALTER TYPE "IntentStatus" ADD VALUE 'INVESTIGATION_PENDING';

CREATE TYPE "ReconciliationStatus" AS ENUM (
  'PENDING_INVESTIGATION',
  'INVESTIGATING',
  'RESOLVED_CONFIRMED',
  'RESOLVED_FAILED',
  'RESOLVED_RETRY'
);

CREATE TABLE "ReconciliationEntry" (
  "entryId" VARCHAR(64) NOT NULL,
  "schemaVersion" VARCHAR(8) NOT NULL,
  "organizationId" VARCHAR(64) NOT NULL,
  "intentId" VARCHAR(128) NOT NULL,
  "receiptId" VARCHAR(128) NOT NULL,
  "status" "ReconciliationStatus" NOT NULL DEFAULT 'PENDING_INVESTIGATION',
  "reasonCode" VARCHAR(64) NOT NULL,
  "investigationNote" VARCHAR(1024),
  "investigatorActor" VARCHAR(128) NOT NULL,
  "investigatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedByActor" VARCHAR(128),
  "resolvedAt" TIMESTAMP(3),
  "resolution" VARCHAR(32),
  "resolutionNote" VARCHAR(1024),
  "retryIdempotencyKey" VARCHAR(256),
  "aggregateVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReconciliationEntry_pkey" PRIMARY KEY ("entryId")
);

CREATE UNIQUE INDEX "uq_reconciliation_intent" ON "ReconciliationEntry"("intentId");
CREATE INDEX "ReconciliationEntry_organizationId_status_idx" ON "ReconciliationEntry"("organizationId", "status");
CREATE INDEX "ReconciliationEntry_reasonCode_idx" ON "ReconciliationEntry"("reasonCode");
CREATE INDEX "ReconciliationEntry_investigatedAt_idx" ON "ReconciliationEntry"("investigatedAt");
