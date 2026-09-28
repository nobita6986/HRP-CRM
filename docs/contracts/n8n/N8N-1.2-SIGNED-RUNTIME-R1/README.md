# N8N/1.2 signed runtime conformance R1

Status: `SIGNED_RUNTIME_CONFORMANCE_PASS`

T0 CRM pulled the saved workflow and execution directly from the n8n Public
API with the read-only Evidence Reader. The evidence does not rely on the AI
Assistant's report.

## Pinned identity

- Instance: `n8n-crm.hrpartner.vn`
- Workflow: `J02Z2ytL5tNsT64e`
- Version: `e87ac600-f115-43e6-811e-86559fdf1f14`
- Execution: `12`
- Final node: `Build Signed Runtime Evidence`
- Workflow active: false
- Active version: null

## Verdict

The independent validator passed 22/22 checks. The live manual execution
finished successfully through all four nodes. The private dispatch node
returned HTTP 200 with `APPLIED`, mode
`SYNTHETIC_SIGNER_RUNTIME_VERIFIER`, matching 64-character lowercase digest
values and profile `LEGACY_SHA256_INPUT_SECRET`.

The final output has only the accepted evidence fields. It contains no
signature, secret or credential data. The graph contains one private dispatch
node and no generic HTTP Request node.

## Boundary

- `SIGNED_RUNTIME_CONFORMANCE`: PASS
- `REAL_CRM_GATEWAY`: NOT_EXECUTED
- Product workflow `CiWYL3CwKkl83Fx0`: unchanged
- Workflow activation: NOT_AUTHORIZED
- Production enablement: NOT_AUTHORIZED
- HRP runtime: untouched

This result proves the installed node can sign and dispatch through the live
n8n CRM runtime to the independent synthetic verifier. It does not establish
real CRM gateway registration, production compatibility or deployment
authorization.
