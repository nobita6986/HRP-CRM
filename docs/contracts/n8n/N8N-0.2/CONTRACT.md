# CONTRACT — N8N/0.2 CRM Automation Gateway

## 1. Surface

n8n calls the gateway by POSTing an `Automation Request Envelope`
(JSON). The gateway verifies service identity, applies allowlist +
rate-limit + kill-switch + idempotency checks, dispatches to a CRM
adapter (mock for now), and returns a FROZEN `ACCEPTED | APPLIED |
FAILED` envelope.

Until N8N/0.3 lands a real HTTP boundary, N8N/0.2 ships only the
**library contract** — `AutomationGateway.invoke(args)` in
`apps/integration-api/src/automation/`. Tests exercise the library
directly without HTTP.

## 2. Request envelope (what n8n sends)

Reuses the FROZEN `RequestEnvelopeBase` from
`@hrp-engagement/contracts@0.0.8-g0.8-fixes` (NOT modified), plus
two locally-defined extensions:

```
{
  schemaVersion: "1",                              # frozen SCHEMA_VERSION literal
  commandId: "<commandId>",                        # frozen primitive
  commandName: "listDueNextActions | acknowledgeReminder | getNextAction",
  idempotencyKey: "<key>",                         # frozen primitive (server-trusted scope)
  correlationId: "<correlationId>",               # frozen primitive (tracking only)
  organizationId: "<organizationId>",             # CLAIM; verified server-side
  source: <CommandSourceClaim>,                    # frozen discriminator (HRP_UI | INTEGRATION)
  actor: <ActorClaim>,                             # frozen; claims only, not used for authz
  occurredAt: "<iso8601 with offset>",            # optional
  automationSource: {                              # NEW; locally-defined
    kind: "N8N_AUTOMATION",
    workflowId: "<workflowId>",
    workflowRevision: <int>,
    n8nExecutionId: "<execId>",
    sourceEventId: "<eventId>?",                   # optional; opaque ref to upstream receipt
    workflowLabel: "<label>?"                      # optional; never trusted
  },
  operation: {                                     # NEW; discriminated union
    op: "listDueNextActions | acknowledgeReminder | getNextAction",
    payload: <operation-specific shape>
  }
}
```

### 2.1 commandName vs operation.op

`commandName` MUST equal `operation.op`. The schema superRefine enforces
this. Mismatch -> wire `VALIDATION_ERROR (422)`, internal code
`n8n_command_name_mismatch`.

### 2.2 Operation payloads (initial allowlist)

- `listDueNextActions.payload`:
  - `schemaVersion: "1"`
  - `dueAfter?: "YYYY-MM-DD"` (UTC+7 calendar)
  - `dueBefore?: "YYYY-MM-DD"` (UTC+7 calendar)
  - `statusFilter?: "OPEN" | "OPEN_OR_DUE" | "OVERDUE_ONLY"` (default: OPEN_OR_DUE)
  - `pageSize?: 1..200` (default: adapter default)
  - `cursor?: string`
- `acknowledgeReminder.payload`:
  - `schemaVersion: "1"`
  - `nextActionId: <opaque>`
  - `notificationOutcome: "SENT" | "FAILED" | "SKIPPED"`
  - `reminderRevisionId: <opaque>`
  - `channel: "INTERNAL_TEST" | "EMAIL_INTERNAL" | "DASHBOARD_ONLY"`
- `getNextAction.payload`:
  - `schemaVersion: "1"`
  - `nextActionId: <opaque>`

### 2.3 Service credential (separate from envelope)

The gateway receives a credential triplet from the HTTP layer (not
on the wire from n8n itself):

- `serviceId` (logical identity of the n8n instance/project)
- `organizationId` (resolved scope)
- `connectionId` (resolved scope)
- `signatureHex` = `HMAC_SHA256(secret, scopeKey || "\n" || payloadDigestHex)`

where:
- `scopeKey` = `orgId || "\u0000" || connId || "\u0000" || serviceId || "\u0000" || commandName || "\u0000" || idempotencyKey`
- `payloadDigestHex` = `SHA-256(canonicalJson(envelopeWithoutDigestVolatile))`
- `envelopeWithoutDigestVolatile` = envelope with
  `correlationId`, `occurredAt`, `n8nExecutionId`, and `commandId`
  stripped — these are per-execution tracking ids and MUST NOT
  contribute to the digest (Plan §3.3 + N8N/0.2 AC).

## 3. Wire response (frozen envelope)

`ACCEPTED (202)`, `APPLIED (200)`, `FAILED (4xx/5xx)`.

`ACCEPTED` is reserved for future async operations; N8N/0.2 currently
produces only `APPLIED` or `FAILED`.

### 3.1 APPLIED data shapes

Each operation has its own data shape, versioned by `schemaVersion: "1"`.
`DueNextActionItem` is intentionally REDACTED — no raw PII, no display
name, no email/phone/CCCD. Only opaque ids (`nextActionId`,
`assignedToRedacted`, `targetRedacted`) and metadata.

### 3.2 FAILED error codes (FROZEN)

| Wire code               | HTTP | Retry class            | When                                           |
|-------------------------|------|------------------------|------------------------------------------------|
| VALIDATION_ERROR        | 422  | NEVER                  | Schema fail; payload-too-large; commandName mismatch |
| AUTHENTICATION_REQUIRED | 401  | REAUTHENTICATE         | Signature mismatch; credential expired; unknown service |
| FORBIDDEN               | 403  | NEVER                  | Body organizationId != credential-resolved; op not in allowed list |
| IDEMPOTENCY_CONFLICT    | 409  | NEVER                  | Same idempotencyKey replayed with different payload digest |
| RATE_LIMITED            | 429  | BOUNDED_SAME_KEY       | Per-workflow budget exhausted                  |
| DEPENDENCY_UNAVAILABLE  | 503  | BOUNDED_SAME_KEY       | Adapter offline; timeout; kill switch active   |
| UNKNOWN_COMMAND_OUTCOME | 503  | RECONCILE_FIRST        | Malformed envelope beyond schema validation    |

### 3.3 N8N-specific internal codes (NEVER on the wire)

These are for log audit only. They map to the FROZEN codes at the
response boundary:

`n8n_credential_expired`, `n8n_signature_mismatch`, `n8n_organization_mismatch`,
`n8n_operation_not_allowed`, `n8n_kill_switch_active`, `n8n_payload_too_large`,
`n8n_rate_limited`, `n8n_idempotency_conflict`, `n8n_timeout`,
`n8n_dependency_offline`, `n8n_command_name_mismatch`, `n8n_internal_error`.

The mapping table is in
`apps/integration-api/src/automation/types.ts`. Tests assert the
mapping: 12 unit tests verify that the right wire code comes out.

## 4. Pipeline order in `AutomationGateway.invoke`

1. Pre-flight payload size (reject > maxPayloadBytes).
2. Schema validation.
3. Registry resolve (service id + org + conn).
4. HMAC signature verify.
5. Organization binding (body org == resolved entry org).
6. Operation allowlist (entry.allowedOperations intersect global).
7. Rate limit (per workflow token bucket).
8. Kill switch (most-specific-match-wins).
9. Idempotency lookup:
   - hit + same digest -> return cached result
   - hit + diff digest -> IDEMPOTENCY_CONFLICT
   - miss -> proceed
10. Adapter call (with timeout race).
11. Build wire response; record idempotency.

## 5. Configuration

| Key                   | Default          | Hard ceiling          | Env var pattern                                  |
|-----------------------|------------------|------------------------|--------------------------------------------------|
| maxPayloadBytes       | 64 KiB           | 1 MiB                  | `HRP_AUTOMATION_MAX_PAYLOAD_BYTES` (future)      |
| defaultTimeoutMs      | 5_000            | 30_000                 | `HRP_AUTOMATION_DEFAULT_TIMEOUT_MS` (future)     |
| rateLimitPerMinute    | 60 per workflow  | 10_000                 | `HRP_AUTOMATION_RATE_PER_MIN` (future)           |
| idempotencyRetentionMs| 24h              | n/a                    | `HRP_AUTOMATION_IDEM_RETENTION_MS` (future)      |

For N8N/0.2, all of these are in-process constants. Per-deployment
env-driven configuration is part of N8N/0.3.

Service registry: `HRP_AUTOMATION_SERVICES` (JSON array) OR
`HRP_AUTOMATION_SERVICE_<N>` (pipe-delimited).

## 6. Frozen contracts

N8N/0.2 reuses FROZEN envelope shapes from
`@hrp-engagement/contracts@0.0.8-g0.8-fixes`:

- `RequestEnvelopeBase` (subset: organizationId, actor, source, idempotencyKey, correlationId, schemaVersion, commandId)
- `IdempotencyKeySchema`, `CorrelationIdSchema`, `OrganizationIdSchema`, `CommandIdSchema`, `SchemaVersionSchema`
- `ActorSchema` (discriminated union)
- `CommandSourceSchema` (discriminated union; the `INTEGRATION` variant is REQUIRED when source.provider is CHATWOOT/ZALO_OA, but for N8N automation the source claim remains a tracking claim, not an auth claim)
- `AcceptedResponseSchema`, `AppliedResponseBaseSchema`, `FailedResponseSchema`, `ErrorListSchema`, `ContractErrorSchema`, `makeError`, `makeAutomationError`
- `ErrorCodeSchema`, `RetryClassSchema`, `ErrorFieldPathSchema`, `ERROR_POLICIES`

**No changes to `@hrp-engagement/contracts`.** All new schemas live
in `apps/integration-api/src/automation/types.ts` and are `.strict()`.