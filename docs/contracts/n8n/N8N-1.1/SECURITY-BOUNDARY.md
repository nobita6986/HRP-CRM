# N8N/1.1 — Security Boundary

## What the workflow MUST NOT do

1. **Mark NextAction DONE.** Acknowledgement is audit-only. The
   workflow emits an `acknowledgeReminder` call to the gateway but
   the gateway does NOT mutate canonical NextAction state.

2. **Modify Handling SLA.** SLA bucket assignment is purely a
   workflow-side computation; no write back to the SLA store.

3. **Touch canonical state.** No calls to HRP API, no DB access, no
   direct write to any task/customer/talent row.

4. **Use body `organizationId` as authority.** The body is a claim.
   The server-resolved binding from the registry wins. Mismatch =>
   403 FORBIDDEN envelope.

5. **Leak raw PII into logs or notifications.** All recipient ids are
   the redacted opaque ids from the wire (`userId` opaque). Email,
   phone, CCCD, and raw names are NEVER present in the workflow
   output.

6. **Send email / SMS / Zalo / Chatwoot.** The only channel is
   `DASHBOARD_ONLY` via the in-process mock adapter.

7. **Infinite-retry on gateway timeout.** Each HTTP node has a 5 s
   timeout. The workflow does not retry. Idempotency-key dedupe at
   the gateway handles replay.

8. **Bypass the kill switch.** If a kill-switch rule matches
   (workflowId / connectionId / organizationId), the gateway returns
   a frozen `n8n_kill_switch_active` envelope. The workflow logs the
   outcome and stops the chain.

9. **Persist any state outside the process.** The mock adapter's
   reminder log is in-memory only. No file writes, no DB writes, no
   external storage.

10. **Embed a real secret in the workflow JSON.** The HMAC credential
    helper is referenced by ID only; no secret value is ever written
    to the workflow, fixtures, or evidence files.

## Snooze semantics

Snooze (`snoozeMode === 'SNOOZED'`) DROPs the item from this
workflow's notification set. The canonical SLA bucket and the
orchestrator's bucket assignment are unchanged — snooze affects
NOTIFICATION ONLY, never SLA, never canonical state.

## Body organizationId mismatch

If the workflow somehow constructed an envelope with a body
`organizationId` that disagrees with the registry, the gateway
returns 403 `FORBIDDEN` `fieldPath: 'organizationId'`. The workflow
MUST treat this as a fail-closed outcome: log the redacted wire
envelope, do NOT retry, do NOT escalate.

## Test evidence

See TEST-EVIDENCE.md for the redacted log inspection (AC #13) that
proves:

- no HMAC secret in any log entry;
- no raw email/CCCD/phone in any log entry;
- only redacted recipient ids present.

## Run signature handling

The local runner signs envelopes with the same broken-gateway
plain-SHA scheme used by the frozen `digest.ts` (NOT real HMAC). This
is intentional — it makes the local simulator and the frozen gateway
agree without modifying frozen baseline code. Real HMAC signing is the
credential helper's job at runtime.

In production, the HMAC credential helper injects the real
`X-Hrp-Automation-Signature`. The workflow JSON carries no secret.
