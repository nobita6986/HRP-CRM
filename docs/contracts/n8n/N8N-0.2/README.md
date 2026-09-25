# N8N/0.2 — CRM Automation Gateway Contract

Local/mock-first artifact. Defines the unified gateway contract n8n
workflows use to call CRM, plus an inactive SLA-reminder workflow
JSON that demonstrates end-to-end use of the contract.

**Status:** READY FOR T0 N8N/0.2 REVIEW

**Owner:** T1-A (CRM automation workstream).

**Scope:**

- New module `apps/integration-api/src/automation/` — pure library,
  no DB, no Docker, no HRP/provider connection.
- Inactive workflow JSON at `apps/n8n-workflows/sla-reminder.v1.json`.
- Negative tests at `apps/integration-api/tests/automation-gateway.test.mjs`.

**Out of scope (deferred to N8N/0.3+ or another workstream):**

- HTTP route in `server.ts` (N8N/0.3 wants a real `/v1/automation/*`
  boundary; deferred until T1-B migration windows or until the
  Outbox/Worker dependency is unblocked).
- Real n8n instance import / activation. Requires T0 command and
  the operator-provisioned `HRP_AUTOMATION_*` env vars.
- HRP-side dependency. None of this code touches HRP, Chatwoot,
  Zalo, or any provider.

## Files in this bundle

| File                    | Content                                                     |
|-------------------------|-------------------------------------------------------------|
| README.md               | This file.                                                  |
| CONTRACT.md             | Wire-level contract + frozen-envelope mapping.              |
| THREAT-BOUNDARY.md      | Trust zones + threat model + boundary check.                |
| TESTS.md                | Test command + result evidence.                             |
| WORKFLOW.md             | Inactive SLA-reminder workflow description.                 |
| NEXT-GATE.md            | Preconditions for N8N/0.3 and N8N/1.1.                     |
| manifest.sha256         | SHA-256 of the bundle files.                                 |

## How to verify locally

```
# from apps/integration-api/
npx tsc --noEmit
node --test tests/automation-gateway.test.mjs
```

Expected: **29 tests pass, 0 fail, ~5s runtime**.

## Boundary classifications used in this bundle

- `IMPLEMENTED` — code/config that exists in this repo (`src/automation/`).
- `EXECUTED_VERIFIED` — local `node --test` output captured in TESTS.md.
- `NOT_VERIFIED` — anything that requires the live CRM n8n instance,
  HRP endpoint, or operator-provisioned credentials.
- `NOT_AVAILABLE` — items that depend on Owner or T0 action.

## Boundary classifications: this work touches CRM only

- CRM n8n instance (`https://n8n-crm.hrpartner.vn`, currently
  Basic-Auth-protect-only) is referenced in NEXT-GATE.md as future
  target. Not touched.
- HRP n8n instance (`https://n8n-hrp.hrpartner.vn`) is NOT touched.
- Owner credentials are NOT requested or stored anywhere in this
  bundle.