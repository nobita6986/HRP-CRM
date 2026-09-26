# N8N/1.1 — Workflow Specification

## File

`apps/n8n-workflows/sla-reminder.v1.json`

## Triggers

| Trigger                              | When                | Trigger label      |
| ------------------------------------ | ------------------- | ------------------ |
| Schedule Trigger (every 15m)          | every 15 minutes    | `TICK_15M`         |
| Schedule Trigger (daily digest 09:00 ICT) | cron `0 0 9 * * *`  | `DAILY_DIGEST`     |

Both triggers converge into the same downstream flow so the
idempotency key stays stable per logical reminder.

## Nodes (in execution order)

### 1. Build envelope (listDueNextActions)

Builds the gateway request envelope for `listDueNextActions`:

- `organizationId` is read from `$env.HRP_AUTOMATION_ORG_ID`.
- `idempotencyKey` is `sla-<window>` where window = ISO minute. Stable
  for the same wall-clock window so retries dedupe at the gateway.
- `correlationId` is generated once and rides the entire flow.
- `workflowId`, `workflowRevision`, `n8nExecutionId` come from the
  n8n host; the simulator substitutes them via globals.

### 2. POST /v1/automation/dispatch (listDueNextActions)

HMAC-signed POST to the gateway. Reads the envelope from the previous
node. In n8n, an HMAC credential helper injects the signature; in the
simulator, `local-runner.mjs` computes the signature locally so the
request is accepted by the integration-api gateway.

### 3. Filter + Group (snooze, slaBucket)

Pure function node. Filters and buckets the items:

- DROPs `status !== 'OPEN'`.
- DROPs `snoozeMode === 'SNOOZED'` — snooze affects ONLY notification,
  not SLA / canonical state.
- Buckets by time-to-dueAt:
  - `DUE_SOON`: 0 < dt <= 60 min
  - `OVERDUE`:  dt <= 0
- Groups by `(organizationId, assignedToRedacted, supervisorRedacted, slaBucket)`.

organizationId is sourced from the request envelope (server-resolved),
NOT from the item payload. Supervisor lookup uses `$env.N8N_FIXTURE_SUPERVISOR_MAP`
which maps `assignedToRedacted` to `supervisorRedacted` (redacted ids only).

### 4. Build sendSyntheticReminder batches

Builds one envelope per group:

- If `slaBucket === 'OVERDUE'` AND a supervisor is present: audience =
  SUPERVISOR (escalation).
- Otherwise: audience = OWNER.
- If neither owner nor supervisor is present: emit a FALLBACK item
  (no notification, no misroute).
- `idempotencyKey` is `rem-<day>-<groupKey>` so 15-min tick + daily
  digest converge to the same key (no duplicate notify).

### 5. POST /v1/automation/dispatch (sendSyntheticReminder)

HMAC-signed POST per group envelope. Timeout 5 s. Same key + same
payload returns cached APPLIED (gateway idempotency). Same key +
different payload returns 409 IDEMPOTENCY_CONFLICT.

### 6. Build acknowledgement batches

For each send (or fallback):

- Extracts the original `correlationId` and `n8nExecutionId`.
- Maps wire status to a redacted outcome enum: SENT / FAILED / SKIPPED.
- Fallback items emit a SKIPPED ack so the bucket's idempotency key is
  bound at the gateway (audit-only).

### 7. POST /v1/automation/dispatch (acknowledgeReminder)

HMAC-signed POST per acknowledgement envelope. The gateway records the
ack; no canonical state mutation.

## Connection graph

```
TICK_15M ─┐
          ├─► Build list env ─► POST listDue ─► Filter+Group ─► Build send ─┬─► POST send ──┐
DAILY ────┘                                                              │                                │
                                                                         └──► Build ack ◄────────────┘
                                                                                │
                                                                                ▼
                                                                       POST acknowledge
```

## Tags

- `n8n-1.1`
- `crm-automation`
- `local-mock`
- `no-import-without-T0`
- `sla-reminder`
- `follow-up`

## Active

`"active": false` on disk. The workflow MUST NOT be activated in any
n8n instance by anyone other than the operator after T0 issues an
explicit import command.
