# HANDOFF.md -- T1-A -> T0 (N8N/1.1-SIGNER)

## Status

READY_FOR_T0_N8N_11_SIGNER_LOCAL_REVIEW

## What changed since N8N/1.1 Round 1

The Round 1 commit 5418378 left a literal NUL byte inside the
scopeKeyFor join delimiter of apps/n8n-workflows/local-runner.mjs.
That commit is now amended by a standalone hygiene commit
(see "Hygiene commit" below). The signer capability Round 1
declared as BLOCKED_BY_N8N_SIGNER_DECISION is now implemented in
this round as the private custom n8n node package
n8n-nodes-hrp-signer.

## What this round delivers

- A new directory tools/n8n-nodes-hrp-signer/ containing:
  - package.json -- npm-style package skeleton with a prepare
    script that compiles the TypeScript to dist/.
  - src/signer.ts -- sign() and canonicalizeEnvelope(); uses only
    node:crypto, no third-party deps.
  - src/credential.ts -- field shape test plus
    HrpAutomationLegacySignatureCredential description.
  - src/node.ts -- HrpAutomationSigner description.
  - src/index.ts -- re-exports of the public surface.
  - test/signer.test.mjs, test/credential.test.mjs,
    test/negative.test.mjs, test/round-trip.test.mjs --
    locally-runnable via node --test, no n8n engine required.
  - README.md -- install + operator notes.
- A new inactive import candidate
  apps/n8n-workflows/import-candidates/sla-reminder.signed.v1.json.
  active=false, workflowRevision=3. It uses the
  hrpAutomationSigner node type and references the
  hrpAutomationLegacySignature credential by id.
- A new manifest under
  docs/contracts/n8n/N8N-1.1-SIGNER/manifest.sha256 listing every
  committed blob of the round.

## Hygiene commit

A standalone hygiene commit
"chore(n8n-1.1): hygiene amendment - replace byte NUL in
scopeKeyFor join delimiter" was added before this round's work.
It replaces a literal NUL byte in scopeKeyFor with the source
escape "\\0", regenerates the N8N/1.1 manifest entry for the
runner, and adds no functional change. The branch history is
immutable: no amend, no force push, no rewrite of any prior
commit.

## Eight bullets T0 must validate

1. Algorithm honesty. Source comments, README, and credential
   label all use the phrase "legacy SHA-256(input || secret)" or
   "legacy signature profile". The function name is signLegacy,
   never hmac. A test asserts no hmac-prefixed identifier exists
   in the package without a legacy- prefix.
2. Header set. The signer emits exactly the four headers
   X-Hrp-Automation-Service-Id, X-Hrp-Automation-Organization-Id,
   X-Hrp-Automation-Connection-Id, X-Hrp-Automation-Signature. No
   other header appears.
3. Byte agreement. The signer unit test in
   test/round-trip.test.mjs demonstrates that an envelope signed
   with our package verifies against an independently-recomputed
   canonical digest and signature. The live round-trip in
   test/round-trip-live.test.mjs is gated on the env var
   HRP_N8N11_SIGNER_EXPECT_APPLIED=1 and is currently SKIPPED
   pending a gateway alignment fix (see item 6 below).
4. Wire agreement. The canonical JSON bytes used by the signer
   equal those produced by digest.ts for the same envelope
   (stripNonDigestFields produces the same UTF-8 byte sequence).
5. Secret confinement. A leak scanner runs over the node output,
   params, headers, and execution data looking for the literal
   secret, the first 16 chars of the secret, and the SHA-256 of
   the secret alone. None of these are present.
6. Inactive import. The JSON is committed with active=false.
   n8n-crm will not start the workflow until T0 approves the
   import command and an operator performs the manual import
   (this round does not run that command).
7. No frozen surfaces changed. A pre-commit guard diffs
   packages/contracts/, the gateway source, the registry, the
   HTTP boundary against HEAD^. Any change here is a stop-the-line
   failure.
8. Tests pass. node --test tools/n8n-nodes-hrp-signer/test
   returns exit 0 with at least 30 passing assertions
   (signer.test, credential.test, negative.test, round-trip.test).

## Local reproduction

    cd tools/n8n-nodes-hrp-signer
    npm install
    npm test
    npm run build

Tests use node:test; building uses tsc if installed; both
also work with bare node from Node 20 onward.

## Known divergence between signer and gateway (item 6)

The N8N/0.2 CONTRACT.md §1 specifies the digest as
`SHA-256(canonicalJson(envelopeWithoutDigestVolatile))` -- a single
canonicalisation. Our signer follows that contract literally.

The current build of `apps/integration-api/src/automation/gateway.ts`
computes the digest as
`payloadDigestHex(canonicalJson(envelopeForDigest))`. Because
`payloadDigestHex(value)` is implemented as
`sha256Hex(canonical(value))`, the gateway actually computes
`SHA-256(canonical(canonical(envelopeForDigest)))`, i.e. two
canonicalisation layers.

The diagnostic test `diagnostic: signer digest vs gateway-computed
digest` (test/round-trip-live.test.mjs) demonstrates this with a
concrete pair of digests for the standard envelope shape:

    signer   = b91ccae0c3dc4ee2fa7daf177ac72d27bb7ffc37a3746cf8f29a2407c7e10862  (contract-compliant)
    gateway  = 3931d009efb1556162cdf2255235c430213814944bbe452231df1d432b76c07d  (current gateway build)

Per the round's scope constraints, this handoff does NOT modify the
gateway. A future N8N/0.3 patch should either:

  - align the gateway call to `payloadDigestHex(envelopeForDigest)`
    (single canonical), which is what N8N/0.2 CONTRACT §1 mandates, OR

  - introduce an explicit `digestProfile` field in the credential
    record and have the signer choose the matching variant at
    runtime.

When that fix lands, the live round-trip can be re-enabled by setting
`HRP_N8N11_SIGNER_EXPECT_APPLIED=1` and the test will assert a
`200 APPLIED` response from `POST /v1/automation/dispatch`. The
signer package itself is contract-correct now; only the gateway
consumption of the digest diverges.

## Out of scope

- Installing the package on the n8n-crm VPS.
- Importing the inactive JSON into a live n8n instance.
- Activating the workflow.
- Modifying packages/contracts, the gateway, or the
  integration-api server.
- Deploying the crm/api/worker systemd units.