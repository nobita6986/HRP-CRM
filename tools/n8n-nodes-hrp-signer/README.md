# n8n-nodes-hrp-signer

Private n8n custom node + credential type for the HRP-CRM
automation gateway. Emits the four `X-Hrp-Automation-*` headers
required by `/v1/automation/dispatch` using the **legacy
SHA-256(input || secret)** profile carried forward from N8N/0.3.

> **This is NOT HMAC.** Despite the historical variable name in
> `digest.ts`, the signing primitive is a single SHA-256 over the
> byte concatenation of (signingInput, secret). See
> `docs/contracts/n8n/N8N-1.1-SIGNER/THREAT-BOUNDARY.md` for the
> rationale and the audit-friendly terminology.

## What this package contains

```
n8n-nodes-hrp-signer/
  package.json         -- npm metadata + n8n plugin manifest
  dist/
    signer.mjs         -- pure byte-level helpers (canonicalJson,
                          sha256Hex, payloadDigestHex, signLegacy,
                          stripNonDigestFields, scopeKeyFor,
                          composeSigningInput, buildHeadersAndSignature)
    credential.mjs     -- field-shape test +
                          HrpAutomationLegacySignatureCredential
                          (displayName + properties + test hook)
    node.mjs           -- HrpAutomationSigner node description and
                          vanilla execute() helper for local tests
    index.mjs          -- public re-exports
  test/
    signer.test.mjs    -- algorithm correctness (10+ assertions)
    credential.test.mjs -- field-shape acceptance (6 assertions)
    negative.test.mjs  -- failure matrix coverage (13 assertions)
    round-trip.test.mjs -- bytes-level round-trip vs gateway
                          algorithm (3 assertions)
  README.md            -- this file
```

The package has zero runtime dependencies (it depends only on
`node:crypto`, which Node 20+ ships with). Tests run with `node
--test` against `dist/`, no transpilation, no n8n engine required.

## Install (operator notes)

1. Copy this directory to a path the n8n-crm instance's `N8N_CUSTOM_EXTENSIONS`
   or `EXTERNAL_SECRETS` can resolve.
2. Drop the package at `$N8N_USER_FOLDER/.n8n/custom/node-modules/n8n-nodes-hrp-signer`
   or scan it via the n8n `n8n --install` flow.
3. Restart n8n. The CRM instance now exposes two new resources:
   - Credential: `HRP Automation Legacy Signature (sha256(input || secret))`.
   - Node: `HRP Automation Signer (legacy SHA-256(input || secret))`.
4. In the n8n UI, on the `sla-reminder.signed.v1` workflow, open
   each HTTP node and confirm `authentication.type = 'none'`.
5. Create one credential per (organizationId, connectionId,
   serviceId) triple by selecting the credential type above and
   pasting the shared secret issued by the HRP registry
   administrator. **Do not paste the secret into a workflow
   parameter or an HTTP header** -- it must live only in the
   credential store.

## What this package does NOT do

- It does not install itself on any VPS automatically. Operators
  are the only ones who may install it on the CRM instance.
- It does not import any workflow JSON. Operators perform the
  import after T0 authorises it.
- It does not modify `packages/contracts`, the gateway
  (`gateway.ts`), or the integration-api HTTP boundary.
- It does not add `n8n-hrp` as a product name.

## Local developer quick-start

```
node --version       # must be >= 20
cd tools/n8n-nodes-hrp-signer
npm install          # no-op; package is dep-free
npm test             # runs node --test test/
# expected output: 32+ assertions, exit 0
```

## Audit-friendly labels

- Function name in code: `signLegacy`, NOT `hmac` (asserted by
  `signer.test.mjs#source: no hmac* identifier`).
- Credential display name: "HRP Automation Legacy Signature
  (sha256(input || secret))".
- Node display name: "HRP Automation Signer (legacy
  SHA-256(input || secret))".
- Algorithm label in code: "sha256(signingInput || secret)".
- README header: "legacy SHA-256(input || secret)".