# CONTRACT.md — N8N/0.3 HTTP Boundary (frozen for T0 review)

## 1. Surface

### 1.1 Endpoint

```
POST /v1/automation/dispatch
```

Single canonical route. Other paths under `/v1/automation/*` return 404.

### 1.2 Request

Headers (all REQUIRED; missing or malformed -> 401 AUTHENTICATION_REQUIRED):

| Header                          | Type   | Notes                                        |
|---------------------------------|--------|----------------------------------------------|
| `X-Hrp-Automation-Service-Id`   | opaque | Must exist in the registry                    |
| `X-Hrp-Automation-Organization-Id` | opaque | Must match the resolved credential org      |
| `X-Hrp-Automation-Connection-Id`   | opaque | Must match the resolved credential conn     |
| `X-Hrp-Automation-Signature`    | hex64  | HMAC-SHA256 hex (64 chars) of the signing input |

Body: a single JSON envelope of shape `AutomationRequest`
(see `apps/integration-api/src/automation/types.ts`). The envelope MUST
include:

- `schemaVersion`, `commandId`, `commandName`, `idempotencyKey`,
  `correlationId`, `organizationId`, `source`, `actor`,
  `automationSource` (kind = `N8N_AUTOMATION`), `operation`
  (discriminated union with `op` and `payload`).

### 1.3 Signing

`signingInput = scopeKey + "\n" + payloadDigest`

```
scopeKey = organizationId + \u0000 + connectionId + \u0000 + serviceId + \u0000 + commandName + \u0000 + idempotencyKey
payloadDigest = SHA-256 hex digest of the canonical-JSON-encoded envelope
                EXCLUDING correlationId, occurredAt, commandId,
                n8nExecutionId (per Plan §3.3)
signature = HMAC-SHA256(signingInput, registry.entry.secret)
```

### 1.4 Response

Success (`APPLIED`):

```json
{
  "status": "APPLIED",
  "schemaVersion": "1.0.0",
  "commandId": "<echoed>",
  "correlationId": "<echoed>",
  "data": { /* operation-specific, see types.ts */ }
}
```

Failure (`FAILED`):

```json
{
  "status": "FAILED",
  "schemaVersion": "1.0.0",
  "commandId": "<echoed or cmd-unknown>",
  "correlationId": "<echoed or corr-unknown>",
  "errors": [
    { "code": "<FROZEN>", "messageKey": "errors.<...>", "retryClass": "<...>", "fieldPath": "<...>" }
  ],
  "message": "<opaque label>"
}
```

Wire-level `code` is ALWAYS one of the FROZEN contract codes:
`VALIDATION_ERROR`, `AUTHENTICATION_REQUIRED`, `FORBIDDEN`,
`RATE_LIMITED`, `DEPENDENCY_UNAVAILABLE`, `IDEMPOTENCY_CONFLICT`,
`UNKNOWN_COMMAND_OUTCOME`. The internal `n8n_*` codes are NEVER on the
wire.

## 2. Failure-closed matrix

| Condition                          | HTTP | Wire code                  |
|------------------------------------|------|----------------------------|
| Missing required header            | 401  | AUTHENTICATION_REQUIRED     |
| Non-hex signature                  | 401  | AUTHENTICATION_REQUIRED     |
| Unknown service                    | 401  | AUTHENTICATION_REQUIRED     |
| Expired credential                 | 401  | AUTHENTICATION_REQUIRED     |
| Mismatched HMAC                    | 401  | AUTHENTICATION_REQUIRED     |
| Body organization != credential    | 403  | FORBIDDEN                   |
| Operation outside allowlist        | 403  | FORBIDDEN                   |
| Schema invalid                     | 422  | VALIDATION_ERROR            |
| Body > maxPayloadBytes             | 422  | VALIDATION_ERROR            |
| Same idempotencyKey + diff payload | 409  | IDEMPOTENCY_CONFLICT        |
| Rate limit exceeded                | 429  | RATE_LIMITED                |
| Kill switch active                 | 503  | DEPENDENCY_UNAVAILABLE      |
| Adapter offline                    | 503  | DEPENDENCY_UNAVAILABLE      |
| Adapter timeout                    | 503  | DEPENDENCY_UNAVAILABLE      |
| Registry unconfigured (no entries) | 404  | route_disabled              |
| Route not mounted                  | 404  | route_not_mounted           |
| Non-POST method                    | 405  | method_not_allowed          |
| Unknown path under /v1/automation  | 404  | route_not_found             |

## 3. Trust boundaries

- Server-trusted: `serviceId`, `organizationId`, `connectionId` are
  ONLY used as identifier-lookup keys. The authoritative org/conn come
  from the registry entry that the credential authenticates against.
- Body claim: envelope `organizationId` is checked against the
  registry-resolved org. Mismatch -> 403.
- `correlationId` is OUT of the business payload digest
  (canonicalization excludes it). However, the idempotency
  record BINDS the first-seen correlationId for a given
  (idempotencyKey, payloadDigest) tuple. Replay with the
  SAME correlationId returns the cached result (200 APPLIED);
  a DIFFERENT correlationId with the same key + same digest
  is rejected with 409 IDEMPOTENCY_CONFLICT
  (`correlation_id_mismatch`) because the caller is no longer
  the same logical flow.
- `n8nExecutionId` is tracking-only; it does NOT participate in
  the digest or the idempotency record. It may rotate freely.
- `commandId` is per-execution tracking; it does NOT participate
  in the digest. It IS echoed in responses and logs. It may
  rotate freely.

## 4. Frozen surfaces (NOT modified by N8N/0.3)

- `@hrp-engagement/contracts` (0.0.8-g0.8-fixes) — frozen.
- The N8N/0.2 envelope schema (`AutomationRequestSchema`,
  `N8nSourceSchema`, `AutomationServiceEntrySchema`, etc.) — unchanged.
- The N8N/0.2 error table (`AUTOMATION_GATEWAY_ERROR_CODES`,
  `getAutomationGatewayError`) — unchanged.

## 5. Log redaction contract

Every successful or failed invocation emits ONE redacted log entry of
shape `RedactedLogEntry` (see gateway.ts). The entry MUST NOT contain:

- The shared secret.
- The raw signature value.
- The raw body bytes (digest only).
- Actor raw fields (systemId, userId, etc).
- Phone numbers / CCCD / emails (PII).

The handler's default `logSink` emits a single-line JSON object to
stdout with prefix `component: 'automation-http'`. Tests inject a
capturing sink.