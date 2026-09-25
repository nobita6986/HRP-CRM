# LIMITATIONS.md

## In-scope limits (by design for N8N/0.3)

1. **In-memory state**: rate limiter, idempotency store, and kill
   switch are in-memory. A process restart wipes state. This is
   acceptable because N8N/0.3 runs in mock/local mode; see NEXT-GATE.md
   for the production migration plan.

2. **Single-process only**: the HTTP handler assumes a single
   integration-api process. Horizontal scaling would require a
   distributed idempotency store (Redis / Postgres) and a distributed
   rate limiter.

3. **No persistent audit log**: redacted log entries are emitted to
   stdout only. No integration with a log aggregator.

4. **Mock adapter only**: N8N/0.3 ships the in-memory `MockAutomationAdapter`.
   The real CRM adapter (HRP store, Chatwoot, Zalo OA, etc.) is a
   follow-up workstream.

5. **No persistent service credential store**: the registry is built
   from env (`HRP_AUTOMATION_SERVICES` JSON or numbered entries) at
   process start. Rotation requires a process restart.

6. **No admin API**: there is no HTTP endpoint to add/remove registry
   entries or kill-switch rules at runtime.

7. **No request signing replay window check**: the gateway does NOT
   validate a `timestamp` header to defend against replay. The
   implementation deliberately defers this to a later gate because
   the synthetic HMAC over `scopeKey + digest` is sufficient for the
   mock/local boundary. See SECURITY-EVIDENCE.md for what is and is not
   covered.

8. **Body size cap is configurable, not negotiated**: the handler
   applies a fixed `maxBodyBytes` per process; clients cannot request
   a different limit per call.

## Frozen contracts (NOT changed by N8N/0.3)

- `@hrp-engagement/contracts@0.0.8-g0.8-fixes` is frozen.
- N8N/0.2 wire envelope (`AutomationRequestSchema`, frozen error codes)
  is reused as-is.

## Out of scope for this gate

- Activation of any real workflow on the n8n VPS.
- Connection to HRP Prisma client.
- Connection to Chatwoot, Zalo OA, or any other provider.
- Deployment to staging or production.
- TLS / mTLS / IP allowlist (deployment concern).