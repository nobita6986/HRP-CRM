# CONTRACT.md -- N8N/1.1-SIGNER (private custom n8n signer node + credential type)

## 1. Scope

Sibling task to N8N/1.1. It supplies the BLOCKED_BY_N8N_SIGNER_DECISION
unblock without touching the N8N/0.3 frozen gateway, the
integration-api server, the mocked adapter, or any of the frozen
N8N/0.3 contract files in packages/contracts. The product is a
private n8n node package called n8n-nodes-hrp-signer plus its
installation notes so that an operator can install it on the n8n
CRM instance once T0 issues the import command.

The package is NOT installed on any VPS in this round. The package
is NOT imported into a live n8n instance. The signed-by-node import
candidate is committed with active=false and offered to T0 for
review.

This round delivers:

1. A packaged, locally-runnable signer node + credential type.
2. A strict negative test surface (missing cred, malformed envelope,
   signature mismatch, secret/log leakage).
3. An inactive import candidate (active=false, workflowRevision=3)
   that wires the HTTP nodes to the signer via parameterized header
   computation and references the hrpAutomationLegacySignature
   credential by id.
4. An updated T0-facing STOP status:
   READY_FOR_T0_N8N_11_SIGNER_LOCAL_REVIEW.

## 2. Surface

### 2.1 Credential: hrpAutomationLegacySignature

Field-set (declared by the credential test, validated at workflow
import time):

- serviceId      (opaque) -- bound to one entry in the automation registry
- organizationId (opaque) -- server-trusted organization id
- connectionId   (opaque) -- bound to one connection tuple
- secret         (opaque) -- shared secret for the legacy SHA-256(input || secret) profile

The credential test refuses any other field. The credential type is
named with the hrpAutomation prefix so n8n credential loader
recognises it as a project-local credential mechanism (no shared
contract is added to packages/contracts).

The secret is held only by the n8n credential store and the running
signer-node closure at execution time. The workflow JSON contains a
reference object but never the literal secret value, and the secret
is not exposed on the node output channel, in execution data, in
webhook payloads, in trace data, or in any log.

### 2.2 Node: hrpAutomationSigner

Parameters:

- envelope (JSON object, required) -- the canonical AutomationRequest
  envelope (frozen shape).
- credentialName (string, required) -- name of the
  hrpAutomationLegacySignature credential to consult.

Output (one item per input item):

    {
      "headers": {
        "X-Hrp-Automation-Service-Id":      "<from credential.serviceId>",
        "X-Hrp-Automation-Organization-Id": "<from credential.organizationId>",
        "X-Hrp-Automation-Connection-Id":   "<from credential.connectionId>",
        "X-Hrp-Automation-Signature":       "<64-char lowercase hex>"
      },
      "envelope": { ... },
      "signerProfile": {
        "kind": "LEGACY_SHA256_INPUT_SECRET",
        "algorithm": "sha256(signingInput || secret)",
        "version": 1
      }
    }

The downstream httpRequest node reads headers from
{ $node["HrpAutomationSigner"].json.headers } and forwards them to
/v1/automation/dispatch. The signer node output NEVER contains
secret, raw bytes of the input, or any partial digest of the
envelope (only the final 64-char hex).

### 2.3 Algorithm (C-N11-04 legacy profile)

The accepted legacy signature profile carried forward from
N8N/0.3. It is NOT cryptographic HMAC. The exact function:

    payloadDigest = sha256_hex(canonical_json(envelope
                                            MINUS correlationId
                                            MINUS occurredAt
                                            MINUS commandId
                                            MINUS n8nExecutionId))
    scopeKey      = organizationId + NUL + connectionId + NUL
                    + serviceId + NUL + commandName + NUL + idempotencyKey
    signingInput  = scopeKey + LF + payloadDigest
    signatureHex  = sha256_hex(signingInput || secret)

canonical_json is the deterministic key-sorted, no-whitespace JSON
serialisation used by digest.ts in the gateway
(apps/integration-api/src/automation/digest.ts). The signer
re-implements this algorithm verbatim so the gateway and the signer
agree on bytes.

The signer MUST refuse to run if any of commandName,
idempotencyKey, organizationId, connectionId, or serviceId is
missing, or if canonicalisation throws a non-finite-number error.
These become a node-level error branch that produces no headers.

### 2.4 Downstream wiring (HTTP node)

The httpRequest node that follows the signer MUST:

- use method=POST,
- use url equal to the gateway /v1/automation/dispatch endpoint
  resolved from $env.HRP_AUTOMATION_GATEWAY_URL,
- declare authentication.type='none' (no built-in n8n HMAC type),
- forward the four headers verbatim from the signer node headers
  JSON,
- forward the body verbatim from the upstream node envelope shape.

This is the same wire as N8N/0.3. The signer is purely a
client-side addition that produces the four required headers; the
gateway is untouched.

## 3. Boundary invariants

1. No secret leak. A test scans the signer node output, params,
   headers, and execution data for any of: the literal secret, a
   truncated (<32 char) prefix of the secret, the SHA-256 digest of
   the secret alone, or any base64/hex-encoded variant. Any leak =
   test fails.
2. No signing-input leak. The trace shows only signerProfile.kind,
   the four header names, and the 64-char signature hex (which is
   the public surface anyway). The signing input, payload digest,
   and secret MUST NOT appear in trace.
3. Algorithm honesty. The package does NOT label its function
   "HMAC". README, code comments, openAPI surface, and credential
   label all use "legacy SHA-256(input || secret)" or "legacy
   signature profile". A test asserts no source file in the package
   declares an HMAC class name without a preceding legacy- qualifier.
4. No N8N/0.3 contract edit. This task does NOT modify
   packages/contracts, digest.ts, the HTTP boundary, or the
   registry. The signer REPLICATES the signing algorithm in its
   own source.
5. No n8n-hrp footprint. apps/integration-hrp, HRP-side workflows,
   and the HRP UI are NOT touched. n8n-hrp does not exist as a node
   product; this task does not create one.
6. No VPS / no import / no activation. The package builds and
   tests locally. The package is NOT installed on the n8n-crm
   instance. The import candidate is committed with active=false.

## 4. Failure matrix (negative tests)

- envelope param missing or non-object  -> error kind MALFORMED_ENVELOPE; no headers emitted.
- credentialName blank or unresolved    -> error kind MISSING_CREDENTIAL; no headers emitted.
- Required field missing (any)          -> error kind INCOMPLETE_IDENTITY; no headers emitted.
- secret empty or below 8 chars         -> error kind BAD_CREDENTIAL; no headers emitted.
- canonical_json throws                 -> error kind CANONICAL_FAILED; no headers emitted.
- Wrong secret supplied                 -> Downstream returns 401 + n8n_signature_mismatch.
- Secret value present in trace/output  -> Test fails (secret-leakage assertion).

## 5. Test surface

- tools/n8n-nodes-hrp-signer/test/signer.test.ts -- unit tests
  for signingInput, signatureHex, header layout, canonical_json
  byte-equality with digest.ts.
- tools/n8n-nodes-hrp-signer/test/credential.test.ts -- credential
  test asserts field shape and rejects unknown fields.
- tools/n8n-nodes-hrp-signer/test/negative.test.ts -- covers every
  row of section 4, including the secret-leakage scanners.
- tools/n8n-nodes-hrp-signer/test/round-trip.test.ts -- boots a
  fake HTTP boundary matching
  apps/integration-api/src/automation/http-handler.ts, signs an
  envelope with the node logic, sends it through the fake boundary,
  and asserts APPLIED.
- All tests run via node --test against the compiled package; no
  n8n engine required for the local review.

## 6. Acceptance status

READY_FOR_T0_N8N_11_SIGNER_LOCAL_REVIEW:

- n8n RUNTIME / IMPORT / ACTIVATION status: NOT_EXECUTED.
- Live sign against /v1/automation/dispatch is permitted ONLY
  against the local integration-api test server (mocks enabled),
  not against a CRM/HRP VPS.
- T0 must validate all eight bullets in HANDOFF.md before
  authorising import.