# N8N/1.1 — Contract Mapping

Each workflow dispatch maps to one of the three frozen N8N/0.3 gateway
operations added for N8N/1.1.

## listDueNextActions

| Aspect          | Value                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| Operation name  | `listDueNextActions`                                                  |
| Payload         | `{ schemaVersion, statusFilter, pageSize }`                            |
| Response data   | `{ schemaVersion, items[], serverNow, envelope }`                      |
| Items shape     | `{ nextActionId, targetRedacted, targetKind, status, snoozeMode, dueAt, scheduledAt, timezone, assignedToRedacted }` |
| Idempotency key | `sla-<window>` (per minute) so retries dedupe                          |

## sendSyntheticReminder

| Aspect          | Value                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| Operation name  | `sendSyntheticReminder`                                               |
| Payload         | `{ schemaVersion, nextActionId, audienceKind, redactedRecipientId, channel, reminderRevisionId }` |
| Response data   | `{ schemaVersion, nextActionId, audienceKind, redactedRecipientId, channel, sentAt, envelope }` |
| Channel         | `DASHBOARD_ONLY` (no real email/SMS/Zalo/Chatwoot)                   |
| Audience        | `OWNER` or `SUPERVISOR` — only redacted recipient ids ever leave the workflow |
| Idempotency key | `rem-<dayKey>-<nextActionId>-<audience>-r<rev>` so 15-min tick + daily digest converge and one envelope is sent per `nextActionId` |

## acknowledgeReminder

| Aspect          | Value                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| Operation name  | `acknowledgeReminder`                                                 |
| Payload         | `{ schemaVersion, nextActionId, notificationOutcome, reminderRevisionId, channel }` |
| Outcome enum    | `SENT` / `FAILED` / `SKIPPED` (no other values on the wire)         |
| Response data   | `{ schemaVersion, nextActionId, reminderRevisionId, recordedAt, envelope }` |
| Idempotency key | `ack-<dayKey>-<nextActionId>-<audience>-r<rev>` (per logical reminder, deterministic across runs and replays) |

## Frozen boundary fields used

The workflow envelopes always include:

- `schemaVersion: '1'`
- `source: { kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null }`
- `actor: { kind: 'SERVICE', serviceId: <from env> }`
- `automationSource.kind: 'N8N_AUTOMATION'` with workflowId,
  workflowRevision, n8nExecutionId.

The gateway rejects envelopes whose body `organizationId` does not
match the registry-resolved org. The body is a claim, NEVER authority.

## What is NOT in this mapping

- No new shared contract. The workflow reuses the N8N/0.3 frozen
  envelope contract verbatim.
- No new error code. The workflow reuses the frozen `n8n_*` internal
  codes that the gateway already emits to the log only.
- No new channel. The only channel this workflow emits is
  `DASHBOARD_ONLY`. The mock adapter's `sendSyntheticReminder` never
  leaves the process.
