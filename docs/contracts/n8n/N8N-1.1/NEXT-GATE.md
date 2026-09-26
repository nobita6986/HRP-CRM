# N8N/1.1 — Next Gate (T0)

This document describes what T0 must validate and what T0 must NOT
yet authorise. The current stop status is:

`READY_FOR_T0_N8N_1_1_LOCAL_REVIEW`

## What T0 MUST validate before authorising import

1. **Workflow JSON structure** — re-confirm
   `apps/n8n-workflows/sla-reminder.v1.json` parses, the graph is
   consistent, no real secrets are embedded.

2. **Mock adapter delta** — confirm the adapter adds
   `listDueNextActions`, `sendSyntheticReminder`, and
   `acknowledgeReminder` only. No new shared contract. No canonical
   state mutation.

3. **Test evidence** — re-run
   `node --test apps/integration-api/tests/automation-n8n11-sla-reminder.test.mjs`
   and confirm 22 / 22 pass.

4. **Baseline regression** — re-run the N8N/0.3 baseline suites
   (automation-gateway.test.mjs, automation-http-route.test.mjs) and
   confirm 64 / 64 pass.

5. **Security boundary** — re-confirm SECURITY-BOUNDARY.md is honoured
   by the workflow JSON.

6. **Snooze semantics** — confirm AC #12 still applies: snooze is
   notification-only.

7. **Idempotency keys** — confirm AC #15 still applies: the 15-min
   tick and the daily digest converge to the same logical key.

8. **Encoding** — confirm all files in this bundle are strict UTF-8
   no BOM (the `manifest.sha256` over committed blobs is the proof).

## What T0 MUST NOT yet do

- Import the workflow into any n8n instance.
- Activate the workflow on any CRM or HRP n8n.
- Promote production readiness.
- Open a PR that merges to main.
- Publish a package, tag, or deploy anything.

## Operator pre-flight (only after T0 authorises import)

When T0 issues an explicit import command, the operator must:

- Provision `HRP_AUTOMATION_GATEWAY_URL`,
  `HRP_AUTOMATION_ORG_ID`, `HRP_AUTOMATION_SERVICE_ID`,
  `HRP_AUTOMATION_CONNECTION_ID`, and `N8N_FIXTURE_SUPERVISOR_MAP`
  in the n8n environment.
- Provision the `CRM_AUTOMATION_HMAC` credential helper with the
  real HMAC secret bound to `svc-n8n11-1` in the automation
  registry.
- Confirm the kill-switch store has no active rule against
  workflowId `wf-sla-reminder`.
- Confirm `schemaVersion` and `contractsVersion` of the target
  n8n-crm match this PoC.

## Stop status

`READY_FOR_T0_N8N_1_1_LOCAL_REVIEW` — until T0 issues the import
command, the workflow is local-only / mock-only.
