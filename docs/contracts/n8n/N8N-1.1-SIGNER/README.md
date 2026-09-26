# N8N/1.1-SIGNER -- Private signer node + credential for HRP-CRM automation

This directory is the contract bundle for **N8N/1.1-SIGNER**, the
round that delivered a private n8n custom-node package
(`n8n-nodes-hrp-signer`) and an inactive import candidate for the
SLA reminder workflow.

**Status (as of 2026-09-26 23:48 UTC+7):** the round is now
classified **PROTOTYPE_NOT_N8N_RUNTIME_ACCEPTED**. The signing
capability was meant to be authored by the n8n AI Assistant on
n8n-crm, so T1-A is now in the **n8n workflow QA / conformance
reviewer** role and does not promote this prototype. See
`QA-REVIEW-QUEUE.md` for the new T0 -> T1-A intake procedure.

## Scope (historical, prototype)

- Private custom n8n signer node + credential type.
- Implements the accepted legacy profile `sha256(input || secret)`.
- Secret lives in the n8n credential store ONLY -- never in
  workflow JSON, output items, execution data, or logs.
- Canonicalizes the envelope per N8N/0.3:
  `stripNonDigestFields` drops `correlationId`, `occurredAt`,
  `commandId`, and the inner `automationSource.n8nExecutionId`.
- Emits exactly four headers:
  `X-Hrp-Automation-Service-Id`,
  `X-Hrp-Automation-Organization-Id`,
  `X-Hrp-Automation-Connection-Id`,
  `X-Hrp-Automation-Signature`.
- Negative tests for missing credential, malformed envelope,
  signature mismatch, and secret/log leakage.
- Local round-trip test (suite
  `tools/n8n-nodes-hrp-signer/test/`).
- Inactive import candidate: `active=false`, `workflowRevision=3`.

## Files

- `CONTRACT.md` -- header shape, canonicalization rule, scope key.
- `HANDOFF.md` -- T0 review checklist (8 items) + role-change
  banner.
- `TESTS.md` -- coverage outline.
- `THREAT-BOUNDARY.md` -- formal security claims.
- `NEXT-GATE.md` -- the gate T0 must clear to authorize production
  use; now points at the AI Assistant workflow.
- `QA-REVIEW-QUEUE.md` -- the new intake procedure for the T1-A QA
  role.
- `manifest.sha256` -- raw SHA-256 over committed blobs of the round.

## Layer boundary

The signer package is **read-only**. It does not modify
`apps/integration-api`, `packages/contracts`, the gateway source,
or the registry. There is one known divergence between the signer
and the current gateway build (see `HANDOFF.md` item 6); the signer
follows the N8N/0.2 contract literally and a one-line change in
`apps/integration-api/src/automation/gateway.ts` is needed for
production verification to pass.

## Out of scope

- Installing the package on the n8n-crm VPS.
- Importing the inactive JSON into a live n8n instance.
- Activating the workflow.
- Modifying `packages/contracts`, the gateway, or the
  integration-api server.
- Deploying the crm/api/worker systemd units.
- Authoring or editing workflow JSON (moved to the n8n AI
  Assistant on n8n-crm).