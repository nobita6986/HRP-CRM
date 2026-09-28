# n8n-nodes-hrp-automation-dispatch

Private custom node for `n8n-crm` 2.40.6. It validates credential/envelope
identity binding, computes the accepted legacy
`SHA-256(signingInput || secret)` signature, sends the request to the fixed
credential-owned gateway URL, and returns a sanitized response.

The node deliberately combines signing and HTTP dispatch. Signature headers
and the shared secret never appear in node output or workflow JSON.

## Resources

- Credential: `hrpAutomationLegacySignature`
- Node: `hrpAutomationDispatch`
- Endpoint: `<credential.gatewayUrl>/v1/automation/dispatch`

## Boundary

- Private package; do not publish to npm.
- Install only on `n8n-crm`.
- Keep every workflow using it inactive until T0 accepts a signed execution.
- Provision the credential through the n8n credential store; never place the
  secret in workflow parameters, environment-visible Code nodes or evidence.
