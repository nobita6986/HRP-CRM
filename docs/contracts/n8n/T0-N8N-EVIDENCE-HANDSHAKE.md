# T0–n8n evidence handshake

## Purpose

The n8n AI Assistant creates and edits workflows, but its chat output is not
acceptance evidence. T0 reads the saved workflow and execution directly from
the n8n Public API, computes hashes locally, and validates the result against
the applicable CRM or HRP contract.

This removes the manual export, paste, and download step.

## Trust split

- T0 CRM owns a dedicated API key for `n8n-crm.hrpartner.vn`.
- T0 HRP owns a different API key for `n8n-hrp.hrpartner.vn`.
- The API keys are never shared between organizations, committed to Git, put
  in workflow JSON, or sent through the AI Assistant.
- Each T0 sends only hashes and a disposition record to the other T0.
- Direct PostgreSQL reads are not part of the protocol. The n8n Public API is
  the authoritative supported read surface.

## Handshake

After completing a draft or a manual run, the AI Assistant returns only:

```text
instance: crm | hrp
workflowId: <n8n workflow id>
versionId: <saved draft version id>
executionId: <manual execution id>
expectedStatus: success
expectedActive: false
```

T0 then runs `scripts/n8n-evidence/pull-evidence.ps1`. The tool:

1. Fetches the workflow from `/api/v1/workflows/{workflowId}`.
2. Fetches the exact execution from
   `/api/v1/executions/{executionId}?includeData=true`.
3. Verifies workflow and execution binding.
   When `-ExpectedVersion` is supplied, both the current workflow and the
   version embedded in the execution must match it.
4. Extracts the final node output from n8n's `runData`.
5. Computes raw and canonical SHA-256 values.
6. Optionally validates CRM automation envelopes through the locally built
   `AutomationRequestSchema`.
7. Writes an attestation without the API key.

If an execution ID is omitted, the tool fetches the newest successful
execution for the workflow. Explicit execution IDs are preferred for review.

## CRM example

Build the CRM schema before using contract validation:

```powershell
cd D:\CodeApp\Hrp-Crm-n8n11-signed-local-r1\apps\integration-api
npm run build

cd D:\CodeApp\Hrp-Crm
pwsh scripts/n8n-evidence/pull-evidence.ps1 `
  -Instance crm `
  -BaseUrl https://n8n-crm.hrpartner.vn `
  -WorkflowId CiWYL3CwKkl83Fx0 `
  -ExecutionId <execution-id-from-ai> `
  -ExpectedVersion <version-id-from-ai> `
  -ExpectInactive `
  -FinalNode 'Build Final Output' `
  -ValidateCrmAutomation `
  -SchemaRoot D:\CodeApp\Hrp-Crm-n8n11-signed-local-r1 `
  -OutDir D:\n8n-evidence\crm\CiWYL3CwKkl83Fx0\<execution-id>
```

The wrapper prompts for the API key without echoing it, places it only in the
child process environment, and removes it immediately afterward.

For repeatable local use, save the key outside every repository, restrict the
file ACL to the T0 operator, `SYSTEM`, and local administrators, then pass
`-ApiKeyFile`. The key value remains absent from argv and evidence:

```powershell
pwsh scripts/n8n-evidence/pull-evidence.ps1 `
  -Instance crm `
  -BaseUrl https://n8n-crm.hrpartner.vn `
  -WorkflowId CiWYL3CwKkl83Fx0 `
  -ExecutionId 10 `
  -ExpectedVersion 6cef48af-3615-4445-b9b2-52db9696088b `
  -ExpectInactive `
  -ValidateCrmAutomation `
  -SchemaRoot D:\CodeApp\Hrp-Crm-n8n11-signed-local-r1 `
  -ApiKeyFile D:\CodeApp\n8n-api.txt `
  -OutDir "$env:TEMP\n8n-evidence\crm\CiWYL3CwKkl83Fx0\execution-10"
```

## HRP example

T0 HRP uses the same tool with its own key and output directory:

```powershell
pwsh scripts/n8n-evidence/pull-evidence.ps1 `
  -Instance hrp `
  -BaseUrl https://n8n-hrp.hrpartner.vn `
  -WorkflowId <hrp-workflow-id> `
  -ExecutionId <hrp-execution-id> `
  -ExpectedVersion <hrp-version-id> `
  -ExpectInactive `
  -OutDir D:\n8n-evidence\hrp\<workflow-id>\<execution-id>
```

CRM-specific schema validation is omitted unless HRP explicitly imports and
accepts that contract.

## API-key setup

Each Owner creates a separate key in the corresponding n8n instance under
**Settings → n8n API**. Use the narrowest scope the installed edition offers:

- read workflow;
- read execution.

If the installed edition cannot scope keys, create a dedicated audit user and
limit that user to the relevant project before creating its key. Where the
edition cannot provide either restriction, record the key as privileged,
store it outside the repository, rotate it regularly, and revoke it when the
review period ends.

## Evidence files

The output directory contains:

- `workflow.raw.json`: exact API response bytes;
- `execution.raw.json`: exact execution response bytes;
- `final-output.json`: extracted final-node items;
- `attestation.json`: hashes, bindings, checks, schema result and verdict.

Raw responses remain local and may contain workflow configuration or execution
data. Review and redact them before committing any evidence bundle.

## Status boundary

This handshake proves what the n8n server saved and executed. It does not by
itself authorize workflow activation, credentials, production HTTP calls,
deployment, or cross-organization access.
