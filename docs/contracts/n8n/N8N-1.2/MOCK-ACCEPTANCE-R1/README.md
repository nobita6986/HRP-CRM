# N8N/1.2 MOCK acceptance R1

Status: `READY_FOR_T0_N8N12_MOCK_ACCEPTANCE`

T0 CRM retrieved the saved workflow and exact execution directly from
`n8n-crm.hrpartner.vn` through the n8n Public API. The n8n AI Assistant did
not export or supply evidence files.

## Pinned identity

- Workflow ID: `CiWYL3CwKkl83Fx0`
- Workflow version: `6cef48af-3615-4445-b9b2-52db9696088b`
- Execution ID: `10`
- Execution version: `6cef48af-3615-4445-b9b2-52db9696088b`
- Execution status: `success`
- Workflow active: `false`

## Verdict

- Server-authoritative pull: PASS
- CRM `AutomationRequestSchema`: 7/7 PASS
- N8N/1.2 MOCK invariant validator: 21/21 PASS
- Expected count matrix: 7/4/3/1/4/3/0 PASS
- HTTP Request nodes: 0
- Credential references: 0
- Exact API-key leak matches in local raw evidence: 0

Raw workflow, execution and final-output responses remain outside Git in the
local temporary evidence directory. This bundle contains only derived hashes,
counts, checks and boundary declarations.

## Boundary

This acceptance covers the inactive MOCK workflow only. `SIGNED_HTTP`, custom
signer installation, workflow activation, deployment and production effects
remain `NOT_EXECUTED`.
