# HTTP-ROUTE.md — Wire Protocol for /v1/automation/dispatch

## Headers

### Required

```
Content-Type: application/json
X-Hrp-Automation-Service-Id:        <opaque>
X-Hrp-Automation-Organization-Id:  <opaque>
X-Hrp-Automation-Connection-Id:    <opaque>
X-Hrp-Automation-Signature:        <64-char hex>
```

`X-Hrp-Automation-Signature` MUST be 64 lowercase or uppercase
hexadecimal characters. Otherwise the route returns 401 with
`AUTHENTICATION_REQUIRED` (no leak).

## Body

The body MUST be a single JSON object conforming to `AutomationRequest`.
Top-level fields:

- `schemaVersion` (string, frozen)
- `commandId` (string, >= 8 chars)
- `commandName` (enum: `listDueNextActions`, `acknowledgeReminder`,
  `getNextAction`; MUST equal `operation.op`)
- `idempotencyKey` (string, frozen pattern)
- `correlationId` (string)
- `organizationId` (string; MUST match credential org)
- `source` (object; the frozen `CommandSourceSchema`)
- `actor` (object; the frozen `ActorSchema`)
- `occurredAt` (optional ISO-8601 datetime with offset)
- `automationSource` (object, kind = `N8N_AUTOMATION`)
- `operation` (discriminated union on `op`)

Any unknown top-level field -> 422 `VALIDATION_ERROR`.

## Signing

The client computes:

```
envelopeForDigest = envelope  // with these fields stripped:
                              //   correlationId, occurredAt, commandId,
                              //   automationSource.n8nExecutionId
payloadDigest = SHA-256-hex(canonicalJson(envelopeForDigest))
scopeKey = orgId + \u0000 + connId + \u0000 + serviceId + \u0000
           + commandName + \u0000 + idempotencyKey
signingInput = scopeKey + "\n" + payloadDigest
signature = HMAC-SHA256-hex(signingInput, sharedSecret)
```

Where:

- `orgId` and `connId` are the credential-resolved values (NOT body
  claims). The client knows these because it provisioned the credential
  with the gateway.
- `sharedSecret` is the credential's secret (synthetic in tests).

The client sends `signature` in the `X-Hrp-Automation-Signature` header.

## Response

### 200 OK (APPLIED)

```json
{
  "status": "APPLIED",
  "schemaVersion": "1.0.0",
  "commandId": "<echoed>",
  "correlationId": "<echoed>",
  "data": {
    "schemaVersion": "1.0.0",
    "items": [ /* listDueNextActions */ ],
    "serverNow": "2026-09-25T12:00:00.000Z"
  }
}
```

For `acknowledgeReminder` and `getNextAction`, `data` carries their
respective shapes (see types.ts).

### 202 Accepted (ACCEPTED)

If the gateway decides to defer (e.g., async ack), the wire `status`
becomes `ACCEPTED` and the HTTP status is 202. (Not exercised in N8N/0.3
tests; reserved for future operations.)

### 4xx / 5xx FAILED

```json
{
  "status": "FAILED",
  "schemaVersion": "1.0.0",
  "commandId": "<echoed or cmd-unknown>",
  "correlationId": "<echoed or corr-unknown>",
  "errors": [
    { "code": "<FROZEN>", "messageKey": "...", "retryClass": "...", "fieldPath": "..." }
  ],
  "message": "<opaque label>"
}
```

## Cache semantics (idempotency)

- Same `(scopeKey, payloadDigest, correlationId)` -> cached
  `APPLIED` is returned WITHOUT re-running the adapter.
- Same `idempotencyKey` but different payload digest -> 409
  `IDEMPOTENCY_CONFLICT` (`payload_digest_mismatch`).
- Same `idempotencyKey` + same payload digest + DIFFERENT
  `correlationId` -> 409 `IDEMPOTENCY_CONFLICT`
  (`correlation_id_mismatch`). The first-seen correlationId
  is bound to the idempotency record; rotating it means the
  caller is no longer the same logical workflow run, so the
  gateway cannot silently replay the cached execution.
- `commandId` and `n8nExecutionId` may rotate freely. They
  are tracking-only and do not participate in either the
  digest or the idempotency record.

## Body size limit

`maxBodyBytes` defaults to 64 KiB (configurable per handler). Exceeding
the limit returns 422 `VALIDATION_ERROR` BEFORE the body is fully read.

## Server-side guards (independent of client input)

1. Registry MUST be configured (at least one non-expired entry).
2. `mockMode` MUST be `deterministic`.
3. Method MUST be `POST`.
4. Body MUST parse as JSON.
5. Envelope MUST pass `AutomationRequestSchema`.

Any of these failing -> appropriate failure code in §2 of CONTRACT.md.

## Idempotency retention

In-memory only (N8N/0.3). Retention is governed by
`idempotencyRetentionMs` (default 24h) and capped at
`maxIdempotencyRecords` (default 100,000).