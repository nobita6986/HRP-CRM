# automation/ — N8N/0.2 CRM Automation Gateway

Internal module of `apps/integration-api` that defines the unified
contract an n8n workflow uses to call CRM commands. Local/mock-first;
no DB or Docker required for tests.

## Files

- `types.ts`            : All automation-specific schemas (frozen-contract
                          compatible; nothing added to packages/contracts).
- `digest.ts`           : Canonical JSON + SHA-256 + HMAC helpers.
- `connection-registry.ts`: Service-identity registry (separate from
                          webhook receiver's connection-registry).
- `kill-switch.ts`      : Granular per-workflow / per-connection /
                          per-organization kill switch.
- `rate-limiter.ts`     : Per-workflow token bucket.
- `idempotency-store.ts`: In-memory idempotency ledger (LRU + TTL).
- `mock-adapter.ts`     : Deterministic in-memory CRM adapter.
- `redact.ts`           : Log-side redaction helpers.
- `gateway.ts`          : `AutomationGateway` class — main entrypoint.
- `errors.ts`           : Internal error classes (never on the wire).
- `index.ts`            : Barrel.

## Pipeline order (in `AutomationGateway.invoke`)

1. Pre-flight: payload size limit.
2. Schema validation (`AutomationRequestSchema`).
3. Service identity resolve + HMAC verify + expiry check.
4. Organization binding (body org == registry org).
5. Operation allowlist (entry.allowedOperations intersect global allowlist).
6. Rate limit (per workflow token bucket).
7. Kill switch check (most specific match wins).
8. Idempotency lookup:
   - hit + same digest -> replay cached result
   - hit + diff digest -> IDEMPOTENCY_CONFLICT (409)
   - miss              -> continue
9. Adapter call with timeout.
10. Build wire response, record idempotency, return.

## Wire response

Always uses the FROZEN envelope shape:

- `ACCEPTED` (202) — reserved; not produced in N8N/0.2.
- `APPLIED` (200)   — operation data in `data`.
- `FAILED` (4xx/5xx) — `errors` array with frozen ContractError codes.
  - 401 AUTHENTICATION_REQUIRED
  - 403 FORBIDDEN
  - 409 IDEMPOTENCY_CONFLICT
  - 422 VALIDATION_ERROR
  - 429 RATE_LIMITED
  - 503 DEPENDENCY_UNAVAILABLE

The N8N-specific codes (`n8n_*`) are NEVER placed on the wire. They are
recorded in the `logEntry.internalCode` field for audit.

## Trust boundary (TL;DR)

| Claim                       | Trusted? | Source                            |
|-----------------------------|----------|-----------------------------------|
| workflowId, revision, exec  | claim    | body                              |
| idempotencyKey              | claim    | body                              |
| correlationId               | claim    | body                              |
| payloadDigest               | derived  | server-computed                   |
| organizationId              | trusted  | registry-resolved from credential |
| connectionId                | trusted  | registry-resolved from credential |
| serviceId                   | trusted  | registry-resolved from credential |
| secret (HMAC key)           | trusted  | server-side env                   |
| actor, role, permission     | NEVER    | (claim only; not used for authz)  |

## Config (env)

- `HRP_AUTOMATION_SERVICES` (JSON array) OR
- `HRP_AUTOMATION_SERVICE_<N>` (pipe-delimited single entry)

Pipe format: `serviceId|organizationId|connectionId|expiresAt|allowedOpsCsv|secret`