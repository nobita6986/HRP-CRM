# THREAT-BOUNDARY — N8N/0.2 CRM Automation Gateway

## 1. Trust zones

```
+--------------+        +------------------------+       +----------------+
|  n8n CRM     |  TLS   |  integration-api       |       |  CRM adapter   |
|  workflow    | -----> |  AutomationGateway     | ----> |  (mock N8N/0.2)|
|  (UNTRUSTED  |        |  (server of record)    |       |                |
|   caller)    |        |                        |       |                |
+--------------+        +------------------------+       +----------------+
                              |       ^
                              v       |
                        +------------------------+
                        |  Service credential    |
                        |  registry (server-     |
                        |  resolved; NEVER read  |
                        |  from request body)    |
                        +------------------------+
```

- **UNTRUSTED CALLER zone:** the n8n workflow. Only its public-key /
  signed envelope is trusted, after the server resolves and verifies
  the credential.
- **SERVER-OF-RECORD zone:** `AutomationGateway`. Server-side org /
  conn binding is enforced here. No body claim is trusted.
- **SERVER-ONLY CONFIG:** credential secrets, kill switch rules,
  rate-limit budget, idempotency retention. Never exposed in logs.

## 2. Threat model

### T-1: Organization spoofing
**Threat:** caller posts `organizationId: "ORG_HRPSUBSIDIARY_X"`
in the envelope but the credential was issued for `ORG_HRPSUBSIDIARY_Y`.
**Plan reference:** §3.2.
**Mitigation:**
1. Credential registry returns the bound `entry.organizationId`.
2. Gateway compares body `envelope.organizationId` against
   `entry.organizationId` (byte-exact). Mismatch -> 403
   `FORBIDDEN`, internal `n8n_organization_mismatch`.
3. The HMAC scope key is computed using the **resolved** org (not the
   body claim), so an attacker cannot forge a valid signature for an
   org they do not hold.

Test: `automation-gateway.test.mjs` "spoofed organization id" -> 403.

### T-2: Connection spoofing
**Threat:** caller has a credential for `(org=O, conn=C1)` and tries
to call with `envelope.organizationId=O` + body-injected
`connectionId=C2`. (N8N/0.2 has no envelope `connectionId` field;
this is a future risk if N8N/0.3 adds one.)
**Mitigation today:** `connectionId` is purely resolved from the
credential registry and is never read from the request body. A
future envelope addition MUST keep this property; the registry
remains the sole source.

### T-3: Operation not in allowlist
**Threat:** caller invokes `acknowledgeReminder` even though their
credential only allows `listDueNextActions`.
**Mitigation:** registry entry has `allowedOperations`. Mismatch ->
403 `FORBIDDEN`, internal `n8n_operation_not_allowed`.

Test: `automation-gateway.test.mjs` "operation not allowed".

### T-4: Credential expiry / signature forgery
**Threat:** credential expires, or attacker forges HMAC.
**Mitigation:**
- `expiresAt` enforced on every call (server clock).
- HMAC verified with `crypto.timingSafeEqual` over equal-length hex
  strings (no early-reject length leak).
- Failure modes return 401 `AUTHENTICATION_REQUIRED`. No body
  payload, no clock skew info, no signature fragment echoed back.

Test: "credential expired", "signature mismatch", "unknown service".

### T-5: Replay with mutated payload
**Threat:** attacker intercepts a successful envelope, mutates a
field, retries with same `idempotencyKey`.
**Mitigation:** digest is computed over the canonical envelope. On
hit-with-different-digest -> 409 `IDEMPOTENCY_CONFLICT`, internal
`n8n_idempotency_conflict`.

Test: "idempotent replay vs conflicting payload".

### T-6: Retry that should dedupe (volatile tracking ids)

**Threat:** n8n retries the same logical command with rotated
`commandId` / `n8nExecutionId` and we wrongly 409.

**Mitigation (current — C-06 binding):**
- `stripNonDigestFields` removes `correlationId`, `occurredAt`,
  `commandId`, and `n8nExecutionId` BEFORE digest computation.
  `commandId` is stripped because command-id allocation is
  allowed to vary per execution as long as it pairs with the
  SAME logical intent.
- The idempotency record BINDS the **first-seen**
  `correlationId` for a given `(scopeKey, idempotencyKey,
  payloadDigest)` tuple. Same key + same digest + SAME
  `correlationId` -> cached `APPLIED` (200). Same key + same
  digest + DIFFERENT `correlationId` -> 409
  `IDEMPOTENCY_CONFLICT` with internal
  `correlation_id_mismatch`. Rationale: a rotated
  `correlationId` means the caller is no longer the same
  logical workflow run, so the gateway cannot silently
  replay the cached execution.

Tests: "idempotent retry with new correlationId + new
executionId" (N8N/0.2) — updated to assert 409
`correlation_id_mismatch`; "same key + same payload + same
correlationId" (N8N/0.3) — asserts 200 APPLIED cached replay.

### T-7: Adapter offline
**Threat:** downstream adapter (HRP, Chatwoot, Zalo, ...) is
unavailable.
**Mitigation:** `simulateOffline()` causes the mock to throw;
gateway maps to 503 `DEPENDENCY_UNAVAILABLE`, internal
`n8n_dependency_offline`.

Test: "adapter offline -> DEPENDENCY_UNAVAILABLE".

### T-8: Adapter timeout
**Threat:** adapter hangs.
**Mitigation:** timeout race (`Promise.race` against
`setTimeout(reject, ms)`); success path cancels the timer.
`simulateTimeoutOnce` triggers it in tests. Mapped to 503
`DEPENDENCY_UNAVAILABLE` per FROZEN `ERROR_POLICIES`.

Test: "adapter timeout -> DEPENDENCY_UNAVAILABLE".

### T-9: Payload oversize
**Threat:** attacker posts a 50 MiB JSON to OOM the process.
**Mitigation:** `maxPayloadBytes = 64 KiB` (default) checked BEFORE
schema validation; over -> 422 `VALIDATION_ERROR`, internal
`n8n_payload_too_large`.

Test: "payload too large".

### T-10: Rate limit abuse
**Threat:** compromised credential floods the gateway.
**Mitigation:** per-workflow token bucket (60 tokens/minute default,
burst 5). Exhausted -> 429 `RATE_LIMITED`, internal
`n8n_rate_limited`. Retry class `BOUNDED_SAME_KEY` so n8n backs off
with the SAME idempotency key, NOT a new one.

Test: "rate limited -> RATE_LIMITED".

### T-11: Kill switch override
**Threat:** a global org kill switch must be overridable by a
more-specific rule (e.g. one workflow left running while others are
shut down). Equally, a malicious admin rule with `workflowId + connectionId`
must NOT shadow a more-specific `workflowId + organizationId` rule
with higher specificity.
**Mitigation:** `KillSwitchStore` sorts rules by specificity weight
(workflow=100, connection=10, organization=1, **all-scope**=0).
First match wins.

Test: "kill switch: workflow+conn > workflow > conn > org".

### T-12: PII / secret leakage in logs
**Threat:** an internal exception echoes `secret`, raw envelope
body, or PII fields into a log line.
**Mitigation:**
- `redactString` matches `secret=`, `password=`, `token=`,
  `signature=`, `Bearer ...`, hex strings > 32 chars.
- `redactJson` walks objects, redacts PII keys (`email`, `phone`,
  `cccd`, `displayName`) and credential keys (`secret`, `signature`).
- All wire responses carry FROZEN error envelopes; never raw
  internal messages.
- The gateway catches and remaps; tests verify that
  "internal error" maps to `UNKNOWN_COMMAND_OUTCOME` and that
  the response body does NOT contain the secret literal.

Test: "redacted envelope keeps secret out".

## 3. Boundary properties preserved

| Property                | N8N/0.2 | Frozen package | Provider tier |
|-------------------------|---------|----------------|---------------|
| Wire envelope shape     | Reuses  | Yes            | n/a           |
| Error envelope          | Reuses  | Yes            | n/a           |
| `organizationId` trust  | Server  | n/a            | Server-resolved from registry |
| `connectionId` source   | Server  | n/a            | Registry      |
| IdempotencyKey          | Client  | Yes            | n/a           |
| Retry class wiring      | Mapping | Yes            | `ERROR_POLICIES` table |
| Actor authz claim       | Reuse   | Yes            | Never enforced server-side for automation gateway (Plan §3.2) |

## 4. Out-of-scope (deferred)

- HRP n8n instance interaction (N8N/0.3+)
- Real HTTP route / WAF / IP allowlist (N8N/0.3)
- KMS / HSM for secret storage (production hardening)
- Audit log sink (centralized SIEM)
- Per-org kill switch override UI (T0 OPS work)