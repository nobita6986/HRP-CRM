# Next gate

Status: `SIGNED_RUNTIME_CONFORMANCE_PASS`

The real CRM gateway remains blocked until T0 provides or approves one
registered tuple:

- HTTPS CRM automation gateway base URL;
- service ID;
- organization ID;
- connection ID;
- shared secret of at least 32 characters.

The secret must be entered directly into the n8n credential store and must
never be sent to the n8n AI Assistant.

The synthetic workflow completed successfully and is pinned in
`N8N-1.2-SIGNED-RUNTIME-R1`. The next gate is a separate real CRM gateway and
registry task. Do not reuse the synthetic credential for that gate.

`SIGNED_RUNTIME_CONFORMANCE` is PASS. Real gateway, product workflow
conversion and production activation remain separate closed gates.
