# N8N/1.1 — Follow-up / SLA Reminder (LOCAL/MOCK PoC)

## Scope

T1-A delivers the first functional n8n CRM reminder workflow for the
HRP-CRM system, local-only / mock-only, no VPS import, no real n8n
runtime activation, no HRP DB connection.

## What this PoC delivers

1. The first n8n workflow JSON that produces real reminder value from
   the frozen N8N/0.3 HTTP boundary: Next Action (due soon, due,
   overdue) and SLA escalation.
2. A mock adapter delta in `apps/integration-api` adding
   `listDueNextActions`, `sendSyntheticReminder`, and
   `acknowledgeReminder` operations on the existing frozen adapter
   interface. No new shared contract.
3. A deterministic Node.js local runner/simulator
   (`apps/n8n-workflows/local-runner.mjs`) that walks the workflow JSON
   graph node-by-node and exercises the real integration-api HTTP
   boundary. NOT the n8n engine.
4. Focused tests (22 acceptance cases) covering the 15 contract
   criteria plus boundary cases.

## Classification

| Aspect               | Status                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| JSON_STRUCTURE       | VERIFIED — workflow JSON parses, graph is consistent, tags include `local-mock` and `no-import-without-T0`.     |
| LOCAL_SIMULATOR      | VERIFIED — the Node runner drives the workflow against the real integration-api gateway; 22 tests pass.         |
| N8N_RUNTIME          | NOT EXECUTED — the workflow has NOT been imported into or activated on any n8n instance.                        |
| PRODUCTION READINESS | NOT PROMOTED — no PR, no merge, no deploy, no tag, no package publish.                                          |

## Stop status

READY_FOR_T0_N8N_1_1_LOCAL_REVIEW

T0 has the authority to:

- audit the workflow + mock adapter + simulator;
- request a follow-up gate;
- and only then authorise an n8n import command. Until that command is
  given, the workflow MUST NOT be imported, activated, or connected to
  a real provider.

## Boundary reminder

- body `organizationId` is a claim; the server registry's binding wins.
- The workflow is audit/notification only: it MUST NOT mark NextAction
  DONE, MUST NOT modify Handling SLA, MUST NOT touch canonical state,
  MUST NOT call HRP API, MUST NOT access any DB.
- Snooze affects notification only; SLA / canonical state are not
  modified.
- Logs are redacted: no secret, signature, raw body, or raw PII.
- All dispatches use the N8N/0.3 frozen HTTP boundary with HMAC, scope,
  idempotency, and kill switch.

## Bundle map

- WORKFLOW.md — node graph and per-node intent.
- CONTRACT-MAPPING.md — workflow JSON to frozen gateway operations.
- SECURITY-BOUNDARY.md — what the workflow MUST NOT do.
- TEST-EVIDENCE.md — per-AC test mapping and run output.
- LIMITATIONS.md — what this PoC does not cover.
- NEXT-GATE.md — what T0 must validate before authorising import.
- manifest.sha256 — raw-byte SHA-256 of committed bundle files.
