# LIMITATIONS.md -- N8N/1.1 workflow QA scope and known limits

This document enumerates what T1-A did and did NOT verify in this
QA round, and what the artifact pins imply. It is part of the
acceptance evidence. T0 must read this before authorizing the
workflow for production use.

## Scope verified (within this bundle)

- **Static workflow export** (`workflow.json`). T1-A did not modify
  the workflow; T1-A only parsed it, walked its DAG, and verified
  the structural invariants listed in `QA-REPORT.md`.
- **Final-output artifact** (`final-output.execution-7.json`). T1-A
  parsed it, extracted the 3 reminder envelopes and 4 acknowledgement
  envelopes, and ran each through the actual `AutomationRequestSchema`
  imported from
  `apps/integration-api/dist/automation/types.js`.
- **Schema strictness.** The negative probes demonstrate that the
  schema enforces `.strict()` (unknown field reject) and that
  required fields such as `commandId` and `reminderRevisionId`
  cannot be omitted or set to `null`.
- **Provenance.** The workflow `id` (`TmNxnx8zMLgqMIcZ`) and
  `versionId` (`90c36da2-f9af-49da-8aac-096001710471`) match the
  pins; the raw-byte SHA-256 of the source export and the source
  final-output match the pins exactly. The final-output is the
  fresh `execution-7` artifact T0 delivered; the older
  `final-output.execution-1.json` was deliberately NOT used as
  evidence for this round.

## Out of scope (NOT verified in this bundle)

- **n8n runtime execution.** T1-A did NOT execute the workflow on
  an n8n instance. The final-output is the AI Assistant-reported
  dry-run summary, NOT a real n8n execution log.
- **Signer / HMAC / signed headers.** The signer package remains
  in `PROTOTYPE_NOT_N8N_RUNTIME_ACCEPTED` (see
  `docs/contracts/n8n/N8N-1.1-SIGNER/HANDOFF.md`). All envelopes
  carry `signatureStatus: "BLOCKED_BY_N8N_SIGNER_DECISION"`. T1-A
  did NOT verify the gateway-side signature check; that round is
  owned by T0 -> n8n AI Assistant per the QA-REVIEW-QUEUE.
- **Production HTTP calls.** All envelopes are sent to "Mock CRM
  Gateway" nodes inside the workflow. No external HTTP boundary
  was touched.
- **Real HRP / Chatwoot / Zalo calls.** None occurred.
- **VPS deploy / systemd / nginx.** None.
- **Custom signer node install.** The signer package is committed
  in `tools/n8n-nodes-hrp-signer/` but is NOT installed on n8n-crm.
- **Gateway / schema edits.** None.

## Provenance honesty (per QA-06)

The final-output artifact does NOT itself contain execution metadata
fields such as top-level `executionId`, `status`, `versionId`, or
`lastNodeExecuted`. The workflow-level `versionId`
`90c36da2-f9af-49da-8aac-096001710471` and the envelope-level
`n8nExecutionId` (`exec-synthetic-001`) are reported by the n8n AI
Assistant on the dry-run, not derived from the raw JSON of the
final-output artifact.

- `workflow.id`, `workflow.versionId`, `workflow.name`:
  `OWNER/N8N_REPORT_PROVIDED` -- recorded from the export, not
  derived from the final-output.
- `envelope.automationSource.n8nExecutionId` (the value
  `exec-synthetic-001` reused across all 7 envelopes):
  `OWNER/N8N_REPORT_PROVIDED`. The fact that the same value appears
  in every envelope indicates the AI Assistant generated the
  identifier as a synthetic placeholder for the dry-run; this is
  NOT a real n8n execution id and should not be treated as one in
  any downstream system.
- The final-output reports `signatureStatus:
  "BLOCKED_BY_N8N_SIGNER_DECISION"` for every reminder and every
  acknowledgement. T1-A confirmed that no envelope ever crosses the
  schema gate by accident; this flag is a UI signal of the dry-run,
  not a runtime outcome.

T0 must NOT interpret any of the values above as having been
"proven" from the raw final-output JSON. They are accepted as
`OWNER/N8N_REPORT_PROVIDED` and the acceptance scope of this
bundle is limited to:

- the workflow artifact content (static, parsed, walked);
- the actual-schema validation (7/7 PASS, 3/3 REJECT);
- the invariant checks (counts, ids, routing, leak scan);
- the encoding / manifest / git diff gates.

## Final-output bytes normalization

The source final-output T0 delivered used CRLF line endings
(Windows-pasted). The committed `final-output.execution-7.json`
uses LF only, per the strict UTF-8 / LF policy. The byte SHA-256 of
the committed file therefore differs from the source pin by
exactly the number of removed CR bytes. This is recorded in
`ARTIFACT-PINS.md`.

The QA-01 artifact-identity check was performed against the **raw
source bytes** (CRLF) and matched the expected pin 2/2. The
manifest hash is computed against the **committed LF-only** bytes.

## Acceptance gate dependency

A `READY_FOR_T0_N8N11_MOCK_WORKFLOW_ACCEPTANCE` verdict in this
bundle implies:

- The workflow is structurally correct against the directives in
  QA-01 / QA-02 / QA-04.
- Every envelope the workflow would send to the gateway passes the
  actual CRM `AutomationRequestSchema`.
- The workflow is still MOCK and inactive.

It does NOT imply that the workflow is safe to activate, install on
n8n-crm, import, publish, or send against the real CRM gateway. All
of those require T0 to re-open the custom-node / signer task and
schedule a separate QA round (see `docs/contracts/n8n/N8N-1.1-SIGNER/QA-REVIEW-QUEUE.md`).
