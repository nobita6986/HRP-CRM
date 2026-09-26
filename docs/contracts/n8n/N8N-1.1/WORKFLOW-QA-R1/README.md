# N8N/1.1 -- Workflow QA, R1

This bundle is the independent QA review of the N8N/1.1 SLA Reminder
workflow export produced by the n8n AI Assistant on n8n-crm. The
review ran on a separate worktree from the round that authored the
signer package. The signer package remains in
`PROTOTYPE_NOT_N8N_RUNTIME_ACCEPTED` and is NOT exercised by this QA.

## Status

`READY_FOR_T0_N8N11_MOCK_WORKFLOW_ACCEPTANCE`.

T1-A stopped after producing this evidence bundle. No runtime work,
no signer work, no VPS work, no production activation, no merge.

## Scope

- Static workflow export
  (`apps/n8n-workflows/import-candidates` -> here: `workflow.json`).
- Static final-output artifact
  (`Pasted text.txt` -> here: `final-output.execution-7.json`).
- Three reminder envelopes + four acknowledgement envelopes parsed
  through the actual CRM `AutomationRequestSchema`.
- Graph DAG walk: trigger coverage, validator coverage, branch
  semantics.
- Three negative probes against the schema (mutation, no workflow
  edit).

## What this bundle is NOT

- Not a runtime execution log.
- Not an import, activate, publish, or import-and-run artifact.
- Not a sign-off for production use.
- Not a sign-off for signer / HMAC / signed header wiring.
- Not a sign-off for any change to the gateway, schema, or
  contracts.

## How to reproduce

```
# from the QA worktree at D:/CodeApp/Hrp-Crm-n8n11-qa-r1
node qa/runner-qa03-schema.mjs <(path-to-final-output.execution-7.json)
node qa/runner-qa04-invariants.mjs <(path-to-final-output.execution-7.json) <(path-to-workflow.json)
node qa/runner-qa05-negative.mjs <(path-to-final-output.execution-7.json)
node qa/runner-qa02-graph.mjs <(path-to-workflow.json)
```

Each runner writes a JSON result to stdout. The committed
`SCHEMA-VALIDATION.json`, `NEGATIVE-PROBES.json`, and the
`qa/*.json` files are the captured outputs.

The schema runners depend on a compiled
`apps/integration-api/dist/automation/types.js` plus the actual
`@hrp-engagement/contracts` package. The committed state of this
worktree already has those artifacts available.

## Files

- `QA-REPORT.md` -- the per-gate PASS/FAIL table and verdict.
- `ARTIFACT-PINS.md` -- SHA-256 of source artifacts vs committed
  bundle blobs.
- `SCHEMA-VALIDATION.json` -- QA-03 raw output, 7 envelopes.
- `NEGATIVE-PROBES.json` -- QA-05 raw output, 3 probes.
- `LIMITATIONS.md` -- scope, provenance honesty, normalization
  notes.
- `workflow.json` -- the raw workflow export from T0.
- `final-output.execution-7.json` -- the new execution evidence
  (LF-normalized copy of T0's source).
- `manifest.sha256` -- raw SHA-256 over every committed blob in the
  bundle.
- `qa/` -- runners and intermediate JSON outputs used by T1-A to
  reach the verdict.
