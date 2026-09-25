# HANDOFF — N8N/0.2 CRM Automation Gateway Contract

**Workstream:** T1-A (CRM automation).
**Task:** N8N/0.2 — CRM Automation Gateway Contract.
**Approach:** Local/mock-first. No Docker. No DB. No HRP/provider
connection. No publish, no deploy, no merge.
**Status:** **READY FOR T0 N8N/0.2 REVIEW.**
**Date:** 2026-09-25.

## 1. What changed (files added, in scope of N8N/0.2)

All paths relative to repo root.

### 1.1 Library (NEW)

`apps/integration-api/src/automation/`

- `types.ts` — frozen-schema re-exports, automation request envelope
  (Zod, `.strict()`), operation payloads, service registry entry,
  kill switch rule shape, internal error code table, default config.
- `digest.ts` — canonical JSON, SHA-256 hex, HMAC-SHA256 hex,
  constant-time equality.
- `connection-registry.ts` — service credential resolution +
  expiry check + operation allowlist. Env-driven.
- `kill-switch.ts` — multi-level kill switch (workflow,
  connection, organization, all) with specificity weighting.
- `rate-limiter.ts` — per-workflow token bucket.
- `idempotency-store.ts` — in-memory idempotency with TTL + LRU.
- `mock-adapter.ts` — deterministic CRM domain behavior for the
  three operations, with offline + timeout injection knobs.
- `redact.ts` — log/response secret + PII scrubbing.
- `gateway.ts` — orchestration pipeline (10 steps).
- `errors.ts` — internal error classification + frozen mapping.
- `index.ts` — public barrel.
- `README.md` — module-level README (developer-facing).

### 1.2 Tests (NEW)

- `apps/integration-api/tests/automation-gateway.test.mjs` —
  29 tests covering all required AC.
- `apps/integration-api/tests/evidence/automation-gateway.test.stdout.txt`
  — captured `node --test` output.
- `apps/integration-api/tests/evidence/automation-gateway.test.tsc-stdout.txt`
  — captured `tsc --noEmit` output (clean).

### 1.3 Inactive workflow (NEW)

- `apps/n8n-workflows/sla-reminder.v1.json` — N8N/1.1 precursor.
  Validated as parseable JSON. References
  `CRM_AUTOMATION_HMAC` credential id (no raw secret embedded).
  **NOT imported, NOT activated.**

### 1.4 Documentation bundle (NEW)

`docs/contracts/n8n/N8N-0.2/`

- `README.md` — overview + boundary classification.
- `CONTRACT.md` — wire contract, frozen envelope mapping, pipeline.
- `THREAT-BOUNDARY.md` — trust zones, 12-row threat model,
  boundary properties preserved.
- `TESTS.md` — 29-row test matrix + execution instructions.
- `WORKFLOW.md` — inactive workflow node graph + credential
  references.
- `NEXT-GATE.md` — preconditions for N8N/0.3 + N8N/1.1, carried
  risks.
- `manifest.sha256` — SHA-256 over bundle files (LF, UTF-8, no BOM,
  no self-hash) + transparency hashes for reference artifacts.

## 2. Contract / threat-boundary map

### 2.1 Authentication

- Service credential = `(serviceId, organizationId, connectionId,
  secret, expiresAt, allowedOperations)`. Server-resolved from
  env-bound registry. NEVER read from request body.
- HMAC scope key:
  `orgId || "\u0000" || connId || "\u0000" || serviceId ||
  "\u0000" || commandName || "\u0000" || idempotencyKey`.
- Signature = `HMAC-SHA256(secret, scopeKey || "\n" || payloadDigestHex)`.
- Digest is SHA-256 over canonical JSON of the envelope with
  `correlationId`, `occurredAt`, `n8nExecutionId`, `commandId`
  stripped (retry/dedupe invariant from Plan §3.3).

### 2.2 Authorization

- Body `organizationId` is compared byte-exact against the
  registry-resolved `entry.organizationId`. Mismatch -> 403.
- Operation in `entry.allowedOperations` intersect with global
  allowlist. Not allowed -> 403.

### 2.3 Idempotency

- Cache key: `(serviceId, organizationId, connectionId, commandName, idempotencyKey)`.
- Hit + same digest -> cached APPLIED.
- Hit + different digest -> 409 IDEMPOTENCY_CONFLICT.
- Miss -> adapter call, then record.
- TTL: 24h (in-memory; restart wipes; carries risk forward).

### 2.4 Resilience

- `maxPayloadBytes = 64 KiB` (default). Over -> 422.
- Per-call timeout race against `defaultTimeoutMs = 5_000` (default).
  Fires -> 503 `DEPENDENCY_UNAVAILABLE`.
- Per-workflow token bucket, 60/min, burst 5. Exhausted -> 429
  `RATE_LIMITED`.

### 2.5 Kill switch

Specificity order (most specific wins):
`workflowId + connectionId + organizationId` >
`workflowId + organizationId` >
`connectionId + organizationId` >
`organizationId`.
All-scope (`active=true` rule with no target) is the catch-all.
Active match -> 503.

### 2.6 Error envelope

Internal codes (`n8n_*`) are NEVER on the wire. They map to the
FROZEN `ContractError` envelope via `ERROR_POLICIES`:

| Internal                     | Wire                       | HTTP |
|------------------------------|----------------------------|------|
| n8n_payload_too_large        | VALIDATION_ERROR           | 422  |
| n8n_command_name_mismatch    | VALIDATION_ERROR           | 422  |
| n8n_credential_expired       | AUTHENTICATION_REQUIRED    | 401  |
| n8n_signature_mismatch       | AUTHENTICATION_REQUIRED    | 401  |
| n8n_unknown_service          | AUTHENTICATION_REQUIRED    | 401  |
| n8n_organization_mismatch    | FORBIDDEN                  | 403  |
| n8n_operation_not_allowed    | FORBIDDEN                  | 403  |
| n8n_idempotency_conflict     | IDEMPOTENCY_CONFLICT       | 409  |
| n8n_rate_limited             | RATE_LIMITED               | 429  |
| n8n_kill_switch_active       | DEPENDENCY_UNAVAILABLE     | 503  |
| n8n_dependency_offline       | DEPENDENCY_UNAVAILABLE     | 503  |
| n8n_timeout                  | DEPENDENCY_UNAVAILABLE     | 503  |
| n8n_internal_error           | UNKNOWN_COMMAND_OUTCOME    | 503  |

### 2.7 Redaction

- `redactString` masks `secret=`, `password=`, `token=`,
  `signature=`, `Bearer ...`, hex >= 32 chars.
- `redactJson` walks objects, masks PII keys (`email`, `phone`,
  `cccd`, `displayName`) and credential keys.
- Wire response: only FROZEN error envelope. No internal code,
  no envelope payload, no signature fragment.
- Test `redaction > wire response never includes secret, signature,
  or actor kind` asserts this.

## 3. Test output

### 3.1 Run command

```
cd apps/integration-api
npx tsc --noEmit
npx tsc
node --test tests/automation-gateway.test.mjs
```

### 3.2 Result

```
TAP version 13
...
tests 29
suites 12
pass 29
fail 0
cancelled 0
skipped 0
todo 0
duration_ms ~5175
```

Full output: `apps/integration-api/tests/evidence/automation-gateway.test.stdout.txt`.
tsc: clean (no errors).

### 3.3 Coverage map (29 tests)

| Plan §                  | Tests                                                           |
|-------------------------|-----------------------------------------------------------------|
| §3.2.1 happy paths      | 01-03                                                           |
| §3.2 authz             | 04-08, 23                                                       |
| §3.3 idempotency        | 09-11                                                           |
| §3.2 resilience         | 12-15, 28                                                       |
| §3.3 kill switch        | 16-20                                                           |
| §3.4 redaction          | 21, 26                                                          |
| §3.4 frozen error codes | 22, 24-26                                                       |
| §3.2 registry contract  | 27                                                              |
| §3.2 rate limit         | 13                                                              |
| additional AC coverage  | 29                                                              |

## 4. Inactive workflow

`apps/n8n-workflows/sla-reminder.v1.json` validates as JSON. It
references `CRM_AUTOMATION_HMAC` as the n8n credential id (no raw
secret embedded). The HTTP-Request node is intentionally pointed at
a placeholder URL marked `INACTIVE_UNTIL_N8N/0.3`. **NOT imported,
NOT activated.**

## 5. Manifest SHA-256

`docs/contracts/n8n/N8N-0.2/manifest.sha256` — LF, UTF-8, no BOM,
no self-hash, no trailing spaces.

Bundle hashes (LF-normalized):

```
347957b5a5057d7c61179d8fffa49f547882e87061759eafd6dd1683aaa3f251  CONTRACT.md
7bd7754fcec72ded9c3e160be044c07fbcd83dffe10d4c3187bbd0578bc31eed  NEXT-GATE.md
d8f36576d8a88fbf1ba6c3361bfa961f42663e72153c682ad59a06a8192eadb1  README.md
795e2ced717b4505f027b548a2b6e0ca9982450d8be1add44de3bd10fd0a47bf  TESTS.md
0d2289826bf0fd6ce66e66ddba32370fb54ec3e74b76b7906a88b6f4ea36c974  THREAT-BOUNDARY.md
c96b34ecbcb6676f7d7634334df753ae0e3da860c929eea52b0e644784289b01  WORKFLOW.md
```

The file also includes transparency hashes for reference artifacts
(workflow JSON, test file, captured stdout, two key source files).

## 6. Boundary classification summary

- `IMPLEMENTED` — `apps/integration-api/src/automation/`.
- `EXECUTED_VERIFIED` — 29 unit tests, `tsc --noEmit`, captured
  stdout.
- `NOT_VERIFIED` — HTTP boundary at `/v1/automation/*` (N8N/0.3).
- `NOT_AVAILABLE` — real n8n import, HRP/Chatwoot/Zalo provider
  binding (N8N/1.1+, N8N/2.x+).

## 7. Status

**READY FOR T0 N8N/0.2 REVIEW.**

No `npm publish`. No deploy. No merge to `main`. No secrets stored
or requested. No live connection to HRP, Chatwoot, Zalo, or the
CRM n8n instance. Workflow JSON is inactive on disk.