# NEXT-GATE — N8N/0.2 -> N8N/0.3 / N8N/1.1

## 1. Definition of Done for N8N/0.2 (this work)

- [x] Gateway library implemented (`apps/integration-api/src/automation/`).
- [x] Frozen contracts reused, not modified.
- [x] Negative + boundary test suite (29 tests, 100% pass).
- [x] Inactive workflow JSON at `apps/n8n-workflows/sla-reminder.v1.json`.
- [x] Documentation bundle under `docs/contracts/n8n/N8N-0.2/`.
- [x] `manifest.sha256` of the bundle, raw bytes, UTF-8, LF.
- [x] No Docker, no DB, no HRP/provider connection.
- [x] No `npm publish`, no deploy, no merge to `main`.

**Status:** READY FOR T0 N8N/0.2 REVIEW.

## 2. Preconditions to unblock N8N/0.3 (HTTP boundary)

| Owner | Required before N8N/0.3 starts                                                      |
|-------|-----------------------------------------------------------------------------------|
| T0    | T0 approval of N8N/0.2                                                             |
| T0    | T1-B Outbox/Worker migration window (or attestation that N8N/0.3 will be a side-by-side deploy) |
| T0 OPS| Decide whether the gateway mounts on `apps/integration-api` (preferred) or a new microservice |
| T0 OPS| Provision `HRP_AUTOMATION_SERVICES` env var on integration-api deployment        |
| T0 OPS| Network policy: which IP/CIDR can reach `/v1/automation/*`                       |
| T0 OPS| WAF / rate-limit / mTLS at the reverse proxy                                      |
| T1-A  | Add HTTP route in `apps/integration-api/src/server.ts` (deferred)                 |
| T1-A  | Reuse `AutomationGateway.invoke` from the route                                   |
| T1-A  | Decision: how the route extracts `serviceId` from credential headers              |

## 3. Preconditions to unblock N8N/1.1 (workflow execution)

| Owner | Required                                                                          |
|-------|-----------------------------------------------------------------------------------|
| T0    | N8N/0.2 approved                                                                  |
| T0 OPS| Operator imports `apps/n8n-workflows/sla-reminder.v1.json` (only after explicit T0 command) |
| T0 OPS| Provision `CRM_AUTOMATION_HMAC` credential in the CRM n8n instance                |
| T0 OPS| Decide callback URL pattern for posting results back into n8n                    |
| T1-A  | Document the production env-var contract in a deployment runbook                  |
| T1-B  | Confirm the Outbox/Worker is no longer blocking CRM-side endpoint migrations      |

## 4. Preconditions to unblock N8N/2.x (provider-bound flows)

| Owner | Required                                                                          |
|-------|-----------------------------------------------------------------------------------|
| T0 OPS| HRP approval for chatwoot/zalo provider binding                                   |
| T1-A  | Implement concrete `CrmAutomationAdapter` (NOT mock) for `listDueNextActions` etc. |
| T1-A  | Map adapter exceptions to N8N/0.2 error envelope codes                            |
| T1-A  | Update TESTS.md boundary table (move from NOT_VERIFIED to EXECUTED_VERIFIED)      |

## 5. Risks carried forward

- `T1-B` migration window: if Outbox/Worker is still pinned,
  N8N/0.3 deploys as a side-car microservice. Higher operational
  burden; tracked as RISK-1.
- The mock adapter's data shapes are NOT yet validated against a
  real CRM adapter. Tracked as RISK-2.
- No operator-controlled kill switch UI yet. Tracked as RISK-3.
- Idempotency retention is in-memory. On integration-api restart,
  the cache rebuilds from zero; n8n retries will temporarily
  re-execute (not a 409). Tracked as RISK-4.

## 6. C-06 (N8N/0.3 recheck) — correlationId binding policy

The idempotency record binds the **first** correlationId seen for a
given (idempotencyKey, payloadDigest) tuple. Subsequent calls with
the SAME correlationId replay the cached result (200 APPLIED). A
different correlationId with the same key + same payload digest is
rejected as 409 IDEMPOTENCY_CONFLICT (`correlation_id_mismatch`)
because the caller is no longer the same logical flow.

| Component         | May rotate without conflict? |
|-------------------|------------------------------|
| `correlationId`   | NO — bound to the record     |
| `commandId`       | YES — tracking-only          |
| `n8nExecutionId`  | YES — tracking-only          |
| payload bytes     | NO — digest is part of key   |

Why: correlationId is the only signal n8n gives the gateway that
"this retry belongs to the same logical workflow run." If it
rotates, the gateway can no longer claim the retry is a true
replay; treating it as cached execution would silently mask a
genuinely different caller.

The previously-phrased claim "rotated correlationId is a valid
replay" is **removed**; the corresponding tests in
`automation-gateway.test.mjs` and `automation-http-route.test.mjs`
now assert `correlation_id_mismatch` -> 409 IDEMPOTENCY_CONFLICT.

## 7. Open questions for T0 review

- Q1: Confirm that `correlationId` MUST be preserved across retries
  while `commandId` may rotate. Plan §3.3 allows this; tests confirm.
- Q2: Confirm that the gateway will mount on integration-api
  (current recommendation) vs a side-car microservice.
- Q3: Confirm that the operator-provisioned `HRP_AUTOMATION_SERVICES`
  secret is acceptable for N8N/0.2 staging rehearsal (after T0
  approval).