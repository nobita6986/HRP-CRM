-- packages/integration-store/prisma/migrations/0006_automation_idempotency_authority/rollback.sql
--
-- T1-B N8N/0.3 r1 -- RG-02 rollback.
--
-- Drops the durable idempotency table and enum. Restoring the legacy
-- in-memory store is the responsibility of the caller (the gateway
-- integration change is a SEPARATE slice, see
-- docs/contracts/n8n/N8N-0.3-REAL-GATEWAY-PLAN-R1/GATEWAY-AUTHORITY-INTEGRATION.md).

BEGIN;

DROP TRIGGER IF EXISTS "trg_idem_record_updated_at" ON "integration"."AutomationIdempotencyRecord";
DROP FUNCTION IF EXISTS "integration"."set_updated_at_idem"();
DROP TABLE IF EXISTS "integration"."AutomationIdempotencyRecord";
DROP TYPE IF EXISTS "integration"."AutomationIdempotencyState";

COMMIT;
