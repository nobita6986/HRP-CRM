# WORKFLOW — Inactive Follow-up / SLA Reminder

**File:** `apps/n8n-workflows/sla-reminder.v1.json`

**Status:** INACTIVE on disk. Must NOT be imported or activated
on the VPS until T0 gives the explicit command. This JSON is a
precursor artifact for N8N/1.1 (deferred).

## 1. Purpose

Demonstrates end-to-end use of the N8N/0.2 gateway contract by
walking a representative SLA-reminder pipeline:

1. Schedule trigger (every 15 min).
2. Build an envelope matching the contract.
3. Compute payload digest.
4. Sign with HMAC using `CRM_AUTOMATION_HMAC` credential reference.
5. POST to the gateway (placeholder URL until N8N/0.3 lands).
6. Branch on the FROZEN error envelope.
7. On APPLIED: log `correlationId` + `commandId`.
8. On rate-limit: schedule retry with the same `idempotencyKey`.
9. On dependency-unavailable: schedule retry with same key.
10. On IDEMPOTENCY_CONFLICT: escalate to ops (NEVER retry blindly).
11. On FORBIDDEN / AUTHENTICATION_REQUIRED / VALIDATION_ERROR:
    escalate (NEVER retry).

## 2. Node graph

| Step | Node type                       | Notes                                                              |
|------|---------------------------------|--------------------------------------------------------------------|
| 1    | Schedule Trigger                | every 15 min                                                       |
| 2    | Code: build envelope            | picks `dueAfter = now - 1 day`, `dueBefore = now + 1 day`           |
| 3    | Code: canonical JSON + digest   | SHA-256 hex                                                        |
| 4    | Code: HMAC sign                 | scopeKey = org | conn | serviceId | commandName | idempotencyKey    |
| 5    | HTTP Request (placeholder)      | disabled in inactive JSON; URL placeholder clearly marked           |
| 6    | Code: branch on wire envelope   | `makeError` policy table lookup                                    |
| 7    | Code: log APPLIED                | structured log, correlationId + commandId + n8nExecutionId         |
| 8    | Code: schedule retry (rate-limited)| `idempotencyKey` preserved                                       |
| 9    | Code: schedule retry (dependency)| `idempotencyKey` preserved                                        |
| 10   | Code: escalate conflict          | notification to ops queue                                          |
| 11   | Code: escalate terminal          | notification to ops queue                                          |

## 3. Credentials referenced (NOT embedded)

The JSON references the following n8n credential IDs, which MUST
already exist in the n8n CRM instance:

- `CRM_AUTOMATION_HMAC` — HMAC secret shared with the gateway
  registry entry.

The JSON does NOT embed any raw secrets. This is per Plan §10.

## 4. Why this is a precursor only

N8N/0.2 ships the **gateway contract + library** + tests + this
JSON. It does NOT:

- Bind the JSON to a real n8n instance.
- Define a runtime for `node-Code` execution.
- Wire the JSON to a real CRM adapter.

These are N8N/1.1 work.

## 5. Boundary classification

- `IMPLEMENTED`: workflow JSON validated as parseable JSON.
- `NOT_VERIFIED`: it has not been imported into the n8n CRM
  instance.
- `NOT_AVAILABLE`: T0 has not authorized import.