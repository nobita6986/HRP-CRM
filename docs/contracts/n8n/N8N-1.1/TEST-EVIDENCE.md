# N8N/1.1 — Test Evidence

## Test file

`apps/integration-api/tests/automation-n8n11-sla-reminder.test.mjs`

22 tests covering all 15 acceptance criteria (AC #1..AC #15) plus
boundary cases.

## Run command

```
node --test apps/integration-api/tests/automation-n8n11-sla-reminder.test.mjs
```

## Last run summary

```
tests 22
suites 17
pass 22
fail 0
duration_ms ~5500
```

## AC -> test mapping

| AC | Criterion                                                              | Test(s)                                                                                                              |
| -- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1  | No item due -> no notification sent                                    | AC #1 — list returns empty -> workflow sends zero sendSyntheticReminder calls                                       |
| 2  | Item due soon -> reminder to owner                                     | AC #2 — sendSyntheticReminder audienceKind = OWNER, recipient = owner id                                             |
| 3  | Item overdue -> escalation to supervisor                               | AC #3 — overdue item sends to SUPERVISOR, not OWNER                                                                  |
| 4  | Two organizations not mixed                                            | AC #4 — cross-org envelope rejected; per-org fixture isolated + simulator with ORG_A never sees ORG_B data            |
| 5  | Missing owner/supervisor -> FALLBACK (no misroute)                     | AC #5 — no synthetic reminder recorded when both audience options are missing                                        |
| 6  | Replay same logical reminder -> no duplicate                           | AC #6 — same key + same payload returns cached APPLIED result                                                        |
| 7  | Changed payload same key -> conflict                                   | AC #7 — same key + different payload -> 409 IDEMPOTENCY_CONFLICT; same key + different correlationId -> 409           |
| 8  | Gateway timeout -> bounded failure, no infinite retry                 | AC #8 — bounded outcome expected (503 or 200 cached); wire does not leak internal codes                              |
| 9  | Kill switch -> no send, audit outcome                                  | AC #9 — list call fail-closed; reminder log empty                                                                    |
| 10 | Mock adapter offline -> frozen error envelope                          | AC #10 — send returns frozen FAILED DEPENDENCY_UNAVAILABLE envelope                                                  |
| 11 | Acknowledgement uses correlation / execution ID exact                  | AC #11 — ack envelope has same correlationId + n8nExecutionId as send                                                |
| 12 | Snooze does not modify canonical/SLA                                   | AC #12 — snoozed item filtered out; only ACTIVE notified                                                             |
| 13 | Notification / log contains no PII or secret                           | AC #13 — no log entry contains HMAC secret or raw signature; redacted recipient ids only, no raw email/CCCD/phone   |
| 14 | One item failure does not lose the whole batch                         | AC #14 — simulator sends N sendSyntheticReminder calls; all record or all fail closed                                |
| 15 | Daily digest and 15-min do not duplicate                               | AC #15 — same idempotencyKey + same payload + same correlationId = cached; reminder log records ONE entry            |

## Baseline regression

```
node --test apps/integration-api/tests/automation-gateway.test.mjs apps/integration-api/tests/automation-http-route.test.mjs
```

Result: 64 / 64 pass. No baseline test was broken by the N8N/1.1 delta.

## Boundary checks

- canonical state is read-only from workflow perspective — sendSyntheticReminder never returns a status mutation.

## What the tests do NOT prove

- The tests use the local Node runner; they do NOT exercise a real
  n8n runtime. See LIMITATIONS.md.
- The tests use the mock adapter; they do NOT exercise any live CRM
  provider. See LIMITATIONS.md.
