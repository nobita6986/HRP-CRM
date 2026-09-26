# NEXT-GATE.md -- N8N/1.1-SIGNER -> next round

## Status

PROTOTYPE_NOT_N8N_RUNTIME_ACCEPTED (T1-A role change 2026-09-26
23:48 UTC+7).

The N8N/1.1-SIGNER prototype code remains in the branch as a
**reference implementation** of what the n8n AI Assistant should
produce when T0 re-opens the custom-node authoring task. T1-A does
NOT promote it; promotion must come through T0 -> n8n AI Assistant
on n8n-crm, and T1-A's role from here on is **workflow QA /
conformance review** of the resulting export.

See `QA-REVIEW-QUEUE.md` in this directory for the intake procedure
T0 uses to deliver a workflow export + execution evidence to T1-A.

## What T0 must approve (prototype only -- not promotion)

1. Algorithm honesty. The signer is named
   `LEGACY_SHA256_INPUT_SECRET` and labelled as
   `sha256(input || secret)` in source, README, and credential
   description. NOT HMAC.
2. Header set. Exactly four `X-Hrp-Automation-*` headers.
3. Canonicalization. `stripNonDigestFields` strips
   `correlationId`, `occurredAt`, `commandId`, and
   `automationSource.n8nExecutionId`.
4. Secret confinement. The literal secret and any of its substrings
   (>= 16 chars) NEVER appear in:
   - workflow JSON (`apps/n8n-workflows/import-candidates/sla-reminder.signed.v1.json`)
   - the signer node output items
   - execution data / trace
   - logs (the gateway redactor already masks hex >= 32 chars;
     the signer node does not emit logs)
5. Suite green. `node --test tools/n8n-nodes-hrp-signer/test/*`
   exits 0 with 35 pass + 1 skip + 1 diagnostic (the live
   round-trip is gated behind `HRP_N8N11_SIGNER_EXPECT_APPLIED=1`).
6. Manifest verified. `manifest.sha256` covers every committed blob;
   a re-run of the generation script reproduces the same hashes.

## Blocking items before T0 can lift this gate

- A future N8N/0.3 patch must align the gateway call from
  `payloadDigestHex(canonicalJson(stripped))` to
  `payloadDigestHex(stripped)` (single canonical, per N8N/0.2
  CONTRACT.md section 1). With that change, the live round-trip
  test (gated by env var) will pass at HTTP 200 with
  `response.status === "APPLIED"`.
- The signed workflow (`import-candidates/sla-reminder.signed.v1.json`)
  must remain `active=false`. n8n-crm must NOT start it until T0
  issues an explicit import command AND an operator provisions:
  - the `n8n-nodes-hrp-signer` npm package on the n8n-crm VPS,
  - the `hrpAutomationLegacySignature` credential in n8n,
  - the env vars `HRP_AUTOMATION_ORG_ID`, `HRP_AUTOMATION_CONN_ID`,
    `HRP_AUTOMATION_SERVICE_ID`, `HRP_AUTOMATION_GATEWAY_URL`.

## Explicit non-goals

- No code path in this round modifies
  `apps/integration-api/src/automation/gateway.ts`,
  `apps/integration-api/src/automation/types.ts`,
  `apps/integration-api/src/automation/connection-registry.ts`,
  `apps/integration-api/src/automation/digest.ts`, or
  `packages/contracts/src/**`.
- No VPS deployment, no systemd unit change, no nginx reload.
- No real import or activation against the n8n-crm runtime.