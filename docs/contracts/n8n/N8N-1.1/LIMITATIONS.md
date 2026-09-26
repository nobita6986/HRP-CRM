# N8N/1.1 — Limitations

## Explicit non-coverage

### 1. The workflow has not been imported into n8n

`apps/n8n-workflows/sla-reminder.v1.json` is exercised only by the
local Node runner. No n8n instance has imported, validated, or
activated this workflow. n8n-specific features we have NOT verified:

- n8n expression evaluation at runtime (we implemented the small
  subset we use in `renderTemplate`).
- n8n's credential helper for HMAC signing (we sign locally to match
  the frozen gateway quirks).
- n8n's execution ordering, retry semantics, and error workflow.
- n8n's UI-visible fields, names, and node positions.

### 2. The mock adapter is not a real CRM connector

The mock adapter is an in-memory deterministic implementation. It
does NOT connect to:

- any real CRM system;
- any real database;
- any real provider API;
- any HRP system.

It only records synthetic-reminder deliveries to an in-process array.

### 3. The frozen gateway has known quirks we mirror

- `hmacSha256Hex(input, secret)` in `digest.ts` is plain
  `sha256(input || secret)`, an **accepted legacy signature profile
  carried forward from N8N/0.3**, NOT cryptographic HMAC.
- `payloadDigestHex` double-canonicalises the JSON.

Until C-N11-04 is unblocked, the runner signs HTTP envelopes ONLY when
the caller passes a `secret` argument; trace entries are tagged with
`signerSubstituted: true` so the substitution is explicit. The
committed workflow JSON itself remains `BLOCKED_BY_N8N_SIGNER_DECISION`
because stock n8n `httpRequest` v4.2 has no built-in HMAC credential
type. Real production signing must be done by the n8n signer node or
custom credential mechanism T0 chooses.

### 4. The supervisor map is a workflow-environment fixture

`$env.N8N_FIXTURE_SUPERVISOR_MAP` is a JSON string provided by the
n8n environment, mapping redacted owner ids to redacted supervisor
ids. The workflow does NOT derive supervisors from any database.
T0 must validate the fixture source before any real run.

### 5. There is no actual notification delivery

`sendSyntheticReminder` writes to an in-memory log only. No
dashboard record, no email, no SMS, no Zalo, no Chatwoot. The mock
adapter returns success; the workflow treats that as SENT.

### 6. The local runner has a small n8n-expression subset

The runner implements `$env.`, `$node["..."].json...`, `$json...`,
`$input.first().json...`. It does NOT implement loops, dates,
conditionals, or anything else beyond the small set used by this
workflow.

### 7. There is no replay-from-cron test

The runner does not simulate cron execution. It runs the workflow
graph once. Real cron scheduling is the n8n instance's
responsibility.

### 8. There is no live kill-switch UI test

The kill-switch store is exercised via `dispatch` directly in tests.
We did not drive the workflow through the kill-switch + send chain
via the local runner (only via direct dispatch). AC #9 is therefore
"kill switch fail-closed at the gateway" — proven — but the
workflow's reaction to a kill-switch failure on the send call is not
directly observed.

### 9. The runner does not process partial-batch failures from the
gateway.

If the gateway returns 503 for ONE sendSyntheticReminder call, the
runner continues with the next item. The workflow's build-ack
function maps that to a FAILED ack and the simulator records it. AC
#14 is therefore "all sendSyntheticReminder calls completed (or
all hit kill switch)" — the contract is satisfied. **Partial-batch
FUNCTIONAL retries are NOT exercised.**

### 10. The gateway idempotency retention is 60 s in tests.

Production retention is much longer, but tests use a short window
for determinism.
