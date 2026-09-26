# N8N/1.1 — Next Gate (T0)

This document describes what T0 must validate and what T0 must NOT
yet authorise. The current stop status is:

`BLOCKED_BY_N8N_SIGNER_DECISION`

Reason: stock n8n `httpRequest` v4.2 has no built-in HMAC credential
type, so the workflow cannot construct the accepted legacy
`sha256(input || secret)` signature profile without either a custom
signer node or a custom credential mechanism. Until one of those
land, the workflow JSON declares `signerProfile.kind =
"BLOCKED_BY_N8N_SIGNER_DECISION"` and the runner never substitutes a
signature unless the caller passes an explicit `secret` argument.

## Unblock criteria (any one of)

1. **Custom signer node** — implement an n8n node (TypeScript or
   Python) that performs the legacy signature profile
   `sha256(input || secret)` and emits `X-Hrp-Automation-Signature`
   + `X-Hrp-Automation-Timestamp`. Wire it into the workflow
   between `Build sendSyntheticReminder batches` and `HTTP dispatch`
   and between `Build acknowledgement batches` and `HTTP ack`.
2. **Custom credential mechanism** — install a credential helper that
   exposes the legacy signature profile as a first-class credential
   type and select it on `HTTP dispatch` / `HTTP ack`.

After T0 implements one of these, the workflow JSON can switch
`signerProfile.kind` to `LEGACY_SHA256_INPUT_SECRET` and the runner
can drop the explicit `signerSubstituted` annotation.

## What T0 MUST validate before authorising import

1. **Workflow JSON structure** — re-confirm
   `apps/n8n-workflows/sla-reminder.v1.json` parses, the graph is
   consistent (`List` -> `Filter & 1:1 Item Builder` ->
   `Build sendSyntheticReminder batches` -> `Switch routing (SEND vs
   FALLBACK)` -> `HTTP dispatch` -> `Build ack from send` /
   `Build ack from fallback` -> `Build acknowledgement batches` ->
   `HTTP ack`), no real secrets are embedded, and
   `signerProfile.kind = "BLOCKED_BY_N8N_SIGNER_DECISION"` is set.
2. **Negative fixture** — confirm
   `apps/n8n-workflows/sla-reminder.negative.v1.json` is rejected by
   `validateStructure` and `validateGraphInvariants`.
3. **Mock adapter delta** — confirm the adapter adds
   `listDueNextActions`, `sendSyntheticReminder`, and
   `acknowledgeReminder` only. No new shared contract. No canonical
   state mutation.
4. **Test evidence** — re-run
   `node --test apps/integration-api/tests/automation-n8n11-sla-reminder.test.mjs`
   and confirm 36 / 36 pass.
5. **Baseline regression** — re-run the N8N/0.3 baseline suites
   (automation-gateway.test.mjs, automation-http-route.test.mjs) and
   confirm 64 / 64 pass.
6. **Security boundary** — re-confirm SECURITY-BOUNDARY.md is honoured
   by the workflow JSON (no secret embedded, no fake HMAC claims).
7. **C-N11-01..C-N11-05 invariants** — re-confirm
   Switch-routed SEND/FALLBACK, 1:1 envelope per `nextActionId`,
   deterministic ack, BLOCKED marker, event-driven runner semantics.
8. **Encoding** — confirm all files in this bundle are strict UTF-8
   no BOM (the `manifest.sha256` over committed blobs is the proof).
9. **`git diff --check`** — confirm clean.

## What T0 MUST NOT yet do

- Import the workflow into any n8n instance.
- Activate the workflow on any CRM or HRP n8n.
- Promote production readiness.
- Open a PR that merges to main.
- Publish a package, tag, or deploy anything.

## Operator pre-flight (only after T0 authorises import)

When T0 issues an explicit import command AND the signer decision is
unblocked, the operator must:

- Provision `HRP_AUTOMATION_GATEWAY_URL`,
  `HRP_AUTOMATION_ORG_ID`, `HRP_AUTOMATION_SERVICE_ID`,
  `HRP_AUTOMATION_CONNECTION_ID`, and `N8N_FIXTURE_SUPERVISOR_MAP`
  in the n8n environment.
- Provision the `CRM_AUTOMATION_HMAC` credential helper or custom
  signer node with the shared secret bound to `svc-n8n11-1` in the
  automation registry.
- Confirm the kill-switch store has no active rule against
  workflowId `wf-sla-reminder`.
- Confirm `schemaVersion` and `contractsVersion` of the target
  n8n-crm match this PoC.

## Stop status

`BLOCKED_BY_N8N_SIGNER_DECISION` — T0 must pick a signer unblock
strategy (custom signer node or custom credential mechanism) before
the workflow can leave local/mock.
