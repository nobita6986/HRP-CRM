-- 0003_intake_checkpoint/rollback.sql — CORE/1.6
-- Manual rollback for migration 0003.

DROP INDEX IF EXISTS integration."ix_intake_checkpoint_idempotency";
DROP INDEX IF EXISTS integration."ix_intake_checkpoint_org_state";
DROP INDEX IF EXISTS integration."ix_intake_checkpoint_state";
DROP TABLE IF EXISTS integration."IntakeCheckpoint";
DROP TYPE IF EXISTS integration."IntakeCheckpointState";
