# Next gate

Status: `BLOCKED_BY_CRM_GATEWAY_AND_REGISTRY_CREDENTIAL`

To continue, T0 must provide or approve one registered tuple:

- HTTPS CRM automation gateway base URL;
- service ID;
- organization ID;
- connection ID;
- shared secret of at least 32 characters.

The secret must be entered directly into the n8n credential store and must
never be sent to the n8n AI Assistant.

After the credential exists, send the following task to the n8n AI Assistant:

```text
Update workflow CiWYL3CwKkl83Fx0 as a new saved version. Keep active=false.

Preserve the accepted MOCK branch byte-for-byte in behavior. In the
SIGNED_HTTP branch, replace the fail-closed placeholder with the installed
"HRP Automation Dispatch" custom node. Select the Owner-provisioned
"HRP Automation Gateway Signature" credential. Pass each already validated
AutomationRequest envelope to the node; do not construct identity headers,
signatures, URLs or secrets in workflow expressions.

Route the sanitized response into the existing acknowledgement aggregation.
Do not activate, publish or schedule the workflow. Do not print or export the
credential. Run one manual SIGNED_HTTP execution only after T0 confirms the
gateway is reachable.

Return only:
instance, workflowId, versionId, executionId, finalNode, expectedStatus,
expectedActive.
```

T0 then uses the server-authoritative evidence pull to validate the exact
saved version and execution. Production activation remains a separate gate.
