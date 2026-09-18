-- 0003_intake_checkpoint/migration.sql — CORE/1.6
-- IntakeCheckpoint table for orchestrator durable workflow.
--
-- Boundaries (Backlog Task 1.6):
--  - Checkpoint durable in Integration DB (schema integration).
--  - Each intake submission has 1 checkpoint row, bound draftDigest/intakeRevisionId.
--  - appliedSteps[] records APPLIED steps; resume skips them.
--  - Do NOT copy LaborProfile/PlacementCase canonical tables.
--  - Idempotency key per-step; dedupe but NOT used to merge.
--  - No PII outside opaque references (similar to ContactLink).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t
                 JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'IntakeCheckpointState'
                   AND n.nspname = 'integration') THEN
    CREATE TYPE integration."IntakeCheckpointState" AS ENUM (
      'RUNNING',
      'PARTIAL',
      'COMPLETED',
      'FAILED',
      'REVIEW_PENDING'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS integration."IntakeCheckpoint" (
  "checkpointId"        VARCHAR(128) PRIMARY KEY,
  "schemaVersion"       VARCHAR(8) NOT NULL,
  "organizationId"      VARCHAR(64) NOT NULL,
  "intakeRevisionId"    VARCHAR(128) NOT NULL,
  "draftDigest"         VARCHAR(64) NOT NULL,
  "canonicalId"         VARCHAR(128),
  "canonicalVersion"    INTEGER,
  "currentStep"         VARCHAR(64),
  "state"               integration."IntakeCheckpointState" NOT NULL DEFAULT 'RUNNING',
  "appliedStepsJson"    JSONB NOT NULL DEFAULT '[]'::jsonb,
  "stepResultsJson"     JSONB NOT NULL DEFAULT '{}'::jsonb,
  "lastErrorJson"       JSONB,
  "correlationId"       VARCHAR(128),
  "idempotencyKey"      VARCHAR(256),
  "createdAt"           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "uq_intake_checkpoint_org_revision"
    UNIQUE ("organizationId", "intakeRevisionId")
);

CREATE INDEX IF NOT EXISTS "ix_intake_checkpoint_state"
  ON integration."IntakeCheckpoint" ("state");
CREATE INDEX IF NOT EXISTS "ix_intake_checkpoint_org_state"
  ON integration."IntakeCheckpoint" ("organizationId", "state");
CREATE INDEX IF NOT EXISTS "ix_intake_checkpoint_idempotency"
  ON integration."IntakeCheckpoint" ("idempotencyKey");
