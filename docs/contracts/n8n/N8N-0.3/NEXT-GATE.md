# NEXT-GATE.md

## Status

READY_FOR_T0_N8N_0_3_REVIEW.

## Recommended next gate (N8N/0.4 — production hardening)

1. **Persistent credential registry**
   - Move `HRP_AUTOMATION_SERVICES` from env to a secrets manager
     (Vault, AWS Secrets Manager, or Kubernetes Secret).
   - Add rotation policy (90-day default).

2. **Distributed idempotency store**
   - Postgres-backed `automation_idempotency` table with
     `(scopeKey, idempotencyKey)` as primary key.
   - Retention sweep at `idempotencyRetentionMs`.

3. **Distributed rate limiter**
   - Redis-backed token bucket (Lua script for atomic refill).
   - Per-workflow key with consistent hashing.

4. **Distributed kill switch**
   - Postgres-backed `automation_kill_switch` table.
   - Admin HTTP endpoint to add/revoke rules (gated by HRP_UI admin
     role).

5. **Replay window**
   - Add `X-Hrp-Automation-Timestamp` header.
   - Reject requests with `|now - ts| > 5min` (skew-aware).

6. **Adapter implementations**
   - HRP store adapter (Prisma).
   - Chatwoot adapter (REST).
   - Zalo OA adapter (REST).
   - Each adapter MUST conform to `AutomationAdapter` and pass the
     N8N/0.3 negative tests with simulated offline/timeout.

7. **TLS / mTLS**
   - Deployment concern; the route does not negotiate transport.

8. **Monitoring / SLOs**
   - Metrics: per-route request count, error count by wire code,
     adapter latency p50/p95/p99.
   - Alert on `DEPENDENCY_UNAVAILABLE` rate above 1% for 5 min.

9. **Audit log persistence**
   - Stream `RedactedLogEntry` to a durable log (Kafka, CloudWatch,
     Loki) with trace id propagation.

## What N8N/0.3 DOES NOT promise

- Production readiness. N8N/0.3 is local/mock-first by design.
- The frozen contract codes are reused; N8N/0.3 does not introduce new
  codes.
- The HRP canonical database is NEVER touched by this route.