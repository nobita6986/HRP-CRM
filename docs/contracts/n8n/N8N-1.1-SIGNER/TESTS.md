# TESTS.md -- N8N/1.1-SIGNER coverage

The package ships four test files under
tools/n8n-nodes-hrp-signer/test/. All tests run under
node --test (Node 20+) and require no n8n engine.

## 1. signer.test.mjs -- algorithm correctness (8 assertions)

1. signingInput(scopeKeyArgs, payloadDigest) joins scopeKey + LF
   + payloadDigest in UTF-8 with a literal LF, not CRLF.
2. scopeKeyFor({ ... }) joins fields with single NUL bytes (no
   double NUL, no escape sequences).
3. canonicalJson(envelopeMINUS...) byte-for-byte matches the
   output of digest.ts for a fixed fixture envelope.
4. signLegacy(...) returns 64-char lowercase hex when secret is
   non-empty, signingInput is non-empty.
5. signLegacy(...) is deterministic given identical inputs.
6. signLegacy(...) differs when the secret differs by exactly
   one byte.
7. buildHeaders(cred, signatureHex) returns exactly four keys in
   the schema-defined order, all values non-empty strings.
8. The helper refuses non-canonical envelopes (those containing
   NaN, Infinity, undefined serialisations).

## 2. credential.test.mjs -- field shape (5 assertions)

1. assertHrpAutomationLegacyCredentialFields(obj) accepts
   { serviceId, organizationId, connectionId, secret } and
   returns { ok: true }.
2. Same with a four-char secret (below the 8-char minimum)
   returns { ok: false, kind: SHORT_SECRET }.
3. Missing serviceId returns { ok: false, kind: MISSING_SERVICE_ID }.
4. Missing connectionId returns { ok: false, kind: MISSING_CONNECTION_ID }.
5. Extra unknown fields return { ok: false, kind: UNKNOWN_FIELD }
   naming the extra key (and refusing to silently accept).

## 3. negative.test.mjs -- failure matrix (12 assertions)

1. node execute() with envelope=null -> MALFORMED_ENVELOPE.
2. node execute() with envelope=string -> MALFORMED_ENVELOPE.
3. node execute() with blank credentialName -> MISSING_CREDENTIAL.
4. node execute() with credentialName=ghost (not in store) ->
   MISSING_CREDENTIAL.
5. node execute() with envelope missing commandName ->
   INCOMPLETE_IDENTITY.
6. node execute() with envelope missing idempotencyKey ->
   INCOMPLETE_IDENTITY.
7. node execute() with envelope missing organizationId ->
   INCOMPLETE_IDENTITY.
8. node execute() with envelope missing connectionId ->
   INCOMPLETE_IDENTITY.
9. node execute() with envelope missing serviceId ->
   INCOMPLETE_IDENTITY.
10. node execute() with secret="" -> BAD_CREDENTIAL.
11. node execute() with secret=short -> BAD_CREDENTIAL.
12. node execute() with envelope containing NaN -> CANONICAL_FAILED.

Additional: scanner assertions (3) confirm no leak of the
literal secret, a 16-char prefix of the secret, or sha256(secret)
appears anywhere in the JSON output of node.execute() or its
executionData for a successful run.

## 4. round-trip.test.mjs -- gateway acceptance (3 assertions)

A local fake implements POST /v1/automation/dispatch, reusing
digest.ts and gateway.ts directly via dynamic import:

    const handler = await import(
      '../../apps/integration-api/src/automation/gateway.mjs');

(For this round the production gateway is shipped as .ts but is
compiled to .js by the integration-api build; if the build has
not run, the test imports the source via the same node --import
loader registered in tools/n8n-nodes-hrp-signer/test/ts-bootstrap.mjs.
Either way the test registers one allowed key, then dispatches
with the signer node output as the headers.)

1. APPLIED when headers come from the signer node.
2. 401 n8n_signature_mismatch when headers come from a different
   secret.
3. 401 n8n_envelope_canonical_failed when the envelope was
   stripped improperly.

## 5. Local reproduction

    cd tools/n8n-nodes-hrp-signer
    npm test
    # expected: 30+ assertions, exit 0