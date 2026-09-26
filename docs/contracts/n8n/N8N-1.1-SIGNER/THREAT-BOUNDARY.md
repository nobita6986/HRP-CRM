# THREAT-BOUNDARY.md -- N8N/1.1-SIGNER

## A. Threat model

The custom n8n signer node is a client-side signer. Its job is
to produce a 64-char hex signature that the frozen
/v1/automation/dispatch gateway will accept. The threat surface
is therefore the n8n workflow execution itself, not the gateway.

### A.1 Threats out of scope (gateway is frozen)

- Replay at the gateway: handled by idempotencyKey -- unchanged
  from N8N/0.3.
- Server-side signature bypass: out of scope; the gateway is
  frozen.
- TLS termination: handled by the HAPR reverse proxy; out of
  scope here.

### A.2 Threats in scope

1. Secret exfiltration from n8n -- workflow JSON export, log
   file, trace data, or HTTP node output.
2. Secret leakage via node execution channel -- the secret
   accidentally appearing under the json field of the
   downstream httpRequest node.
3. Signing-input leakage -- the payloadDigest or signingInput
   strings appearing in trace.
4. Algorithm mis-naming -- the function being labelled HMAC when
   it is in fact a legacy SHA-256(input || secret) composition.
   This confuses auditors.
5. HTTP node authentication drift -- someone re-enabling n8n
   built-in HMAC type, double-signing the envelope.

### A.3 Mitigations

1. The n8n credential store handles at-rest encryption. Operators
   ARE required to enable credential encryption via
   N8N_CREDENTIALS_OVERWRITE_DATA rotation; the README restates
   this requirement.
2. The signer node execute() returns ONLY the four headers, a
   mirror of the envelope (without secret), and the
   signerProfile kind marker. A scanner test asserts this.
3. The signer params has no secret-related keys. The headers
   field emits only the four required names. The trace channel
   receives only the signerProfile.kind string and the public
   signature hex.
4. README + code comments + credential label + openAPI label all
   explicitly use "legacy SHA-256(input || secret)" or "legacy
   signature profile". No source file exports a class named
   Hmac* without a preceding Legacy qualifier (enforced by
   credential.test.mjs#no_hmac_export).
5. The inactive import candidate uses authentication.type=none
   on every HTTP node. A test asserts none of the HTTP nodes in
   the workflow declares an authentication type. The active=false
   flag means n8n will not run the workflow until T0 flips it.

## B. Boundary claims (formal)

- Claim: secret never written to workflow JSON.
  Enforcement: credential test refuses any field shape lacking
  a secret; workflow JSON holds the credential by name and id,
  never the value.

- Claim: secret never written to node output, params, headers,
  trace.
  Enforcement: negative.test.mjs scans the execute() return
  value and a mock executionData collector.

- Claim: signature bytes deterministically equal between signer
  and gateway.
  Enforcement: signer.test.mjs asserts exact byte agreement with
  digest.ts for a fixed envelope.

- Claim: HTTP node never re-authenticates.
  Enforcement: round-trip.test.mjs asserts authentication.type
  is none.

- Claim: workflow inactive by default.
  Enforcement: static JSON inspection asserts active=false.

- Claim: payloadDigest never appears in output.
  Enforcement: output schema lacks that key; leak scanner
  asserts.

- Claim: signingInput never appears in output.
  Enforcement: output schema lacks that key; leak scanner
  asserts.

- Claim: correlationId, occurredAt, commandId, n8nExecutionId
  not in payload digest input.
  Enforcement: canonicaliser deletes them before hashing.

## C. What this round does NOT do

- Install the package on a live n8n instance.
- Run the workflow (the JSON has active=false).
- Modify any frozen surface in N8N/0.3.
- Deploy to the crm/api/worker servers.
- Add n8n-hrp as a product name.

## D. STOP

Status code: READY_FOR_T0_N8N_11_SIGNER_LOCAL_REVIEW.

T0 may, at its own discretion, advance to:

- READY_FOR_T0_N8N_CRM_INSTALL (operator action on n8n-crm VPS).
- READY_FOR_T0_N8N_CRM_IMPORT.
- READY_FOR_T0_N8N_CRM_ACTIVATE.

None of those statuses are produced by this round.