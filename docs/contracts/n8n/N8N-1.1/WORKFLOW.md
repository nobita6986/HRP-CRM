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
- `idempotencyKey` is `sla-<triggerLabel>-<minute>` where minute = ISO
  minute. The trigger label is included so the 15-min tick and the
  daily digest never collide on the same minute.
- `correlationId` is generated once from stable fields
  (`workflow.id`, `workflow.revision`, `execution.id`, trigger,
  minute) and rides the entire flow.
- `workflowId`, `workflowRevision`, `n8nExecutionId` come from the
  n8n host; the simulator substitutes them via globals.

### 2. POST /v1/automation/dispatch (listDueNextActions)

POST to the gateway. The workflow declares
`authentication.type = 'none'`; the runner substitutes the legacy
SHA-256(input || secret) signature for SIMULATION ONLY and tags the
trace with `signerSubstituted: true`. The committed workflow carries
`signerProfile.kind = 'BLOCKED_BY_N8N_SIGNER_DECISION'` because n8n
`httpRequest` v4.2 has no built-in HMAC credential type.

### 3. Filter + Group (snooze, slaBucket, per-nextActionId)

Pure function node. Filters, buckets, and emits ONE item per
`nextActionId` (C-N11-02):

- DROPs `status !== 'OPEN'`.
- DROPs `snoozeMode === 'SNOOZED'` — snooze affects ONLY notification,
  not SLA / canonical state.
- Buckets by time-to-dueAt:
  - `DUE_SOON`: 0 < dt <= 60 min
  - `OVERDUE`:  dt <= 0
- Sorts items by `(dueAt, nextActionId)` so reorder is safe.
- Routes each item as `SEND` or `FALLBACK` based on whether an owner
  or supervisor recipient exists.

organizationId is sourced from the request envelope (server-resolved),
NOT from the item payload. Supervisor lookup uses
`$env.N8N_FIXTURE_SUPERVISOR_MAP` which maps `assignedToRedacted` to
`supervisorRedacted` (redacted ids only).

### 4. Build sendSyntheticReminder batches

Builds one envelope per surviving `nextActionId`:

- If `slaBucket === 'OVERDUE'` AND a supervisor is present: audience =
  SUPERVISOR (escalation).
- Otherwise: audience = OWNER.
- If neither owner nor supervisor is present: emit a `kind = fallback`
  item (no notification, no misroute).
- `idempotencyKey` is `rem-<day>-<nextActionId>-<audience>-r<rev>` so
  15-min tick + daily digest converge to the same key per logical
  reminder (no duplicate notify).
- `ackBase` is `ack-<day>-<nextActionId>-<audience>-r<rev>` and is
  stable across replays.
- No `Date.now()` / `Math.random()` anywhere in the key derivation.

### 5. Switch routing (SEND vs FALLBACK)

A `n8n-nodes-base.switch` node splits by the `kind` field emitted
above. C-N11-01 mandates exactly one downstream branch per item:

- `kind = send`     → output index 0 → `POST /v1/automation/dispatch
  (sendSyntheticReminder)` → `Build ack from send`
- `kind = fallback` → output index 1 → `Build ack from fallback`

The two ack-builders both feed into `Build acknowledgement batches` on
different input indices; the runner's `Build acknowledgement batches`
node dedupes by `ackBase` so a single logical reminder produces
exactly one ack envelope per run.

### 6. POST /v1/automation/dispatch (sendSyntheticReminder)

POST per `nextActionId` envelope. Timeout 5 s. Same key + same payload
returns cached APPLIED (gateway idempotency). Same key + different
payload returns 409 IDEMPOTENCY_CONFLICT. The runner detects
duplicate send/ack across the trace and flags `duplicates.send[]` /
`duplicates.ack[]` in the result.

### 7. Build ack from send / Build ack from fallback

Two separate function nodes, one per Switch branch. Each builds an
`acknowledgeReminder` envelope whose `idempotencyKey = ackBase` (no
`Date.now()` / `Math.random()`). Both converge on `Build
acknowledgement batches`.

### 8. Build acknowledgement batches

Pure function node with a `seen[ackBase]` dedupe guard. Emits exactly
ONE ack envelope per `ackBase`. Partial failures maintain correlation
with the originating input item via `correlationId` + `n8nExecutionId`.

### 9. POST /v1/automation/dispatch (acknowledgeReminder)

POST per ack envelope. The gateway records the ack; no canonical state
mutation. Timeout 5 s.

## Connection graph

```
TICK_15M   ─┐
            ├─► Build list env ─► POST listDue ─► Filter+Group ─► Build send ─► Switch ─┬─► POST send ─► Build ack from send ─┐
DAILY_DIGEST ┘                                                                       │                                                       │
                                                                                    └─► Build ack from fallback ─────────────────────┤
                                                                                                                                                  │
                                                                                                                                                  ▼
                                                                                                                              Build acknowledgement batches
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
- `blocked-signer`

## Active

`"active": false` on disk. The workflow MUST NOT be activated in any
n8n instance by anyone other than the operator after T0 issues an
explicit import command AND a signer node / custom credential type
has been wired (see SECURITY-BOUNDARY.md).
