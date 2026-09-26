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

10. **Embed a real secret in the workflow JSON.** The credential helper
    is referenced by ID only; no secret value is ever written to the
    workflow, fixtures, or evidence files.

## Signature profile (C-N11-04)

The N8N/0.3 signature profile is `sha256(input || secret)` (a plain
double-canonical SHA-256 digest of two concatenated buffers), **not**
a cryptographic HMAC. Do not document or configure it as "real HMAC".

The workflow JSON declares `signerProfile.kind =
'BLOCKED_BY_N8N_SIGNER_DECISION'` because n8n `httpRequest` v4.2 has
no built-in HMAC credential type. The only n8n-valid
`authentication.type` values are `none`, `genericCredentialType`,
`httpHeaderAuth`, `httpQueryAuth`, `httpBasicAuth`, `oAuth1Api`, and
`oAuth2Api`; none of these produce the N8N/0.3 signature profile.

### Unblock criteria

The workflow is unblocked when the operator either:

(a) installs a custom n8n node that signs each HTTP request using the
    legacy SHA-256(input || secret) profile and updates the workflow
    JSON to reference it (instead of `authentication.type = 'none'`);
    OR

(b) provides a custom credential type bound to the same algorithm and
    configures each `httpRequest` node to use it.

Until then:

- The runner refuses to inject an HMAC. It signs HTTP envelopes ONLY
  when the caller passes a `secret` argument, and tags the trace
  entry with `signerSubstituted: true` so the substitution is
  explicit.
- The committed workflow JSON carries `signerProfile.kind =
  'BLOCKED_BY_N8N_SIGNER_DECISION'` and `validateStructure` rejects any
  candidate whose signerProfile.kind is anything else.

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

The local runner signs envelopes with the legacy plain-SHA scheme used
by the frozen `digest.ts` (sha256(input || secret), NOT cryptographic
HMAC). This is intentional — it makes the local simulator and the
frozen gateway agree without modifying frozen baseline code.

In production, a custom signer node or custom credential type injects
`X-Hrp-Automation-Signature` declaratively via the n8n workflow JSON.
The runner does NOT add a signature to outgoing requests when the
workflow declares `authentication.type = 'none'`. The committed
workflow JSON carries the BLOCKED_BY_N8N_SIGNER_DECISION marker so
this state cannot be silently re-introduced.
