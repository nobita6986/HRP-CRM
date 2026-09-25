# N8N/0.3 — CRM Automation HTTP Boundary

Status: READY_FOR_T0_N8N_0_3_REVIEW

## Summary

Phase 2 of the CRM Automation workstream. Adds the HTTP boundary that
exposes the N8N/0.2 local AutomationGateway as a real POST endpoint.

The route is mounted into `apps/integration-api` (no new microservice) and
delegates ALL security, idempotency, kill switch, rate limit, and
adapter-call logic to the existing `AutomationGateway` class. The HTTP
handler exists only to:

  1. Enforce the route-level guard (registry configured + mockMode != off).
  2. Pre-check body size.
  3. Parse credential headers (serviceId / organizationId / connectionId
     / signature).
  4. Hand off to `AutomationGateway.invoke()`.
  5. Map the gateway's `(httpStatus, response)` to the HTTP envelope.
  6. Emit a redacted log entry.

Service identity (`serviceId`, `organizationId`, `connectionId`) is
resolved SERVER-SIDE from the credential registry. Body claims are
treated as identifiers only; the gateway compares them against the
registry-resolved values.

## Deliverables

- Route implementation: `apps/integration-api/src/automation/http-handler.ts`
- Server wiring: `apps/integration-api/src/server.ts`
- Barrel export: `apps/integration-api/src/automation/index.ts`
- Integration tests: `apps/integration-api/tests/automation-http-route.test.mjs`
- Frozen contracts: `docs/contracts/n8n/N8N-0.3/CONTRACT.md`
- HTTP route contract: `docs/contracts/n8n/N8N-0.3/HTTP-ROUTE.md`
- Security evidence: `docs/contracts/n8n/N8N-0.3/SECURITY-EVIDENCE.md`
- Test evidence: `docs/contracts/n8n/N8N-0.3/TEST-EVIDENCE.md`
- Limitations: `docs/contracts/n8n/N8N-0.3/LIMITATIONS.md`
- Next gate: `docs/contracts/n8n/N8N-0.3/NEXT-GATE.md`
- SHA256 manifest: `docs/contracts/n8n/N8N-0.3/manifest.sha256`

## Boundary (what N8N/0.3 does NOT do)

- Does NOT import/activate a workflow on the real n8n server.
- Does NOT connect to HRP, Chatwoot, Zalo, or any real provider.
- Does NOT modify the frozen `@hrp-engagement/contracts` package.
- Does NOT add a microservice.
- Does NOT introduce a DB migration.
- Does NOT push to production.
- Does NOT use real credentials; all credentials are synthetic.

## Test status (in this worktree)

- N8N/0.2: 30/30 PASS (N8N/0.2 suite grew by 1 C-06 case)
- N8N/0.3 HTTP: 34/34 PASS (N8N/0.3 suite grew by 14 C-02..C-06 cases)
- Combined: 64/64 PASS
- typecheck/build: clean