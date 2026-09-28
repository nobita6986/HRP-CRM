# N8N/0.3 real CRM automation gateway — implementation gate R1

Status: `READY_FOR_IMPLEMENTATION_TASK`

This task productionizes the existing local automation gateway for CRM. It
does not deploy, activate a workflow or authorize production traffic.

## Authority and proven inputs

- Private node runtime load: PASS.
- Synthetic signed runtime conformance: PASS.
- Live evidence: workflow `J02Z2ytL5tNsT64e`, version
  `e87ac600-f115-43e6-811e-86559fdf1f14`, execution `12`.
- Product workflow `CiWYL3CwKkl83Fx0` remains unchanged and inactive.

## Required implementation slices

### G1 — Signature profile honesty

The existing function named `hmacSha256Hex` computes
`SHA-256(signingInput || secret)`, not HMAC. Rename the executable profile,
registry discriminator, comments, errors and tests to
`LEGACY_SHA256_INPUT_SECRET`. Do not change accepted bytes in this slice.

### G2 — Durable idempotency authority

Replace the process-local map for real runtime with a PostgreSQL-backed store.
The first `(scopeKey, payloadDigest, correlationId)` claim and terminal result
must be atomic. Same scope/same digest/same correlation returns the recorded
response. Digest or correlation mismatch returns conflict. Restart and two
API instances must preserve this behavior.

The in-memory store may remain only as an explicitly injected test adapter.

### G3 — Registry and secret provisioning

Real credentials must be loaded from a server-side restricted source. Do not
put plaintext secret values in workflow JSON, repository files, command-line
arguments, logs or evidence. Registry identity owns organization, connection,
allowed operations, expiry and kill-switch state. Request body values remain
claims and must match the resolved entry.

Document initial provisioning, overlap rotation, emergency disable and
rollback. The synthetic credential must never be promoted or reused.

### G4 — Runtime route

Mount only `POST /v1/automation/dispatch`. Fail closed when registry,
idempotency authority or adapter is unavailable. Enforce request size,
timeout, allowlist, rate limit and redacted response/logging. Health endpoints
must not reveal registry contents or secrets.

### G5 — Verification

Run clean build and focused tests covering valid signature, wrong signature,
identity spoof, expired/disabled credential, unauthorized operation, replay,
payload conflict, correlation conflict, process restart, two-instance race,
dependency timeout, kill switch and secret/log redaction.

## Stop condition

Stop at `READY_FOR_T0_REAL_GATEWAY_REVIEW`. Do not deploy the gateway, create
a real n8n credential, edit the product workflow, publish, activate, schedule
or enable production traffic.
