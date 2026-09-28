# Prompt for n8n AI Assistant

Paste this into the AI Assistant on `n8n-crm.hrpartner.vn` as a new workflow
task. Do not paste it into the accepted N8N/1.2 product workflow session.

```text
Create a NEW, separate workflow named:
T0 — N8N/1.2 Signer Runtime Conformance R1

Purpose: prove the installed private node "HRP Automation Dispatch" can sign
and dispatch one synthetic AutomationRequest through the already provisioned
credential. This is conformance evidence only, not a product workflow.

Hard constraints:
- Keep active=false. Do not schedule, publish or activate.
- Do not modify workflow CiWYL3CwKkl83Fx0 or any other workflow.
- Use credential exactly: "T0 Synthetic Signer Runtime R1".
- Never print, expose, copy or export credential fields, secret or signature.
- Do not use an HTTP Request node, Code node for signing, expression-built
  headers, or any alternate signer.
- Use the installed custom node "HRP Automation Dispatch" for signing and
  dispatch.
- Run exactly one manual execution after saving.

Build this graph:
1. Manual Trigger.
2. One Set/Edit Fields node that emits exactly one envelope object with:
   schemaVersion: "1"
   commandId: "cmd-signer-conformance-r1"
   commandName: "sendSyntheticReminder"
   idempotencyKey: "idem-signer-conformance-r1"
   correlationId: "corr-signer-conformance-r1"
   organizationId: "org-synthetic-signer"
   source: { kind: "CRM", provider: "CRM", connectionId: "conn-synthetic-signer" }
   actor: { kind: "SERVICE", serviceId: "svc-crm-n8n-signer-test" }
   occurredAt: a valid current UTC ISO timestamp
   automationSource: { kind: "N8N", workflowId: the current workflow ID,
     n8nExecutionId: the current execution ID }
   operation: { op: "sendSyntheticReminder", payload: {
     nextActionId: "na-signer-conformance-r1",
     reminderRevisionId: "rev-signer-conformance-r1"
   } }
3. HRP Automation Dispatch, timeout 5000 ms, using the credential above and
   the whole envelope from step 2.
4. A final Set/Edit Fields node named "Build Signed Runtime Evidence" that
   retains only: statusCode, body.status, body.mode, body.cached,
   body.payloadDigest, commandId, correlationId, idempotencyKey,
   payloadDigest and signatureProfile.

Acceptance for the single manual run:
- execution status succeeded;
- custom node statusCode = 200;
- body.status = "APPLIED";
- body.mode = "SYNTHETIC_SIGNER_RUNTIME_VERIFIER";
- signatureProfile = "LEGACY_SHA256_INPUT_SECRET";
- both digest fields are 64 lowercase hexadecimal characters and equal;
- final output contains no secret, signature or credential data;
- workflow remains active=false.

If the custom node or credential is not visible, STOP and report the exact
missing item. Do not substitute another node or recreate the credential.

Return only:
instance, workflowId, versionId, executionId, finalNode, executionStatus,
statusCode, bodyStatus, bodyMode, digestAgreement, expectedActive.
```
