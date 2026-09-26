# N8N/1.1 — Test Evidence

## Test file

`apps/integration-api/tests/automation-n8n11-sla-reminder.test.mjs`

36 tests covering all 15 acceptance criteria (AC #1..AC #15), the
C-N11-01..C-N11-05 correction-round invariants, and the negative
graph fixture.

## Run command

```
node --test apps/integration-api/tests/automation-n8n11-sla-reminder.test.mjs
```

## Last run summary (Round 1)

```
tests 36
suites 25
pass 36
fail 0
duration_ms ~6900
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
| 13 | Notification / log contains no PII or secret                           | AC #13 — no log entry contains the secret or raw signature; redacted recipient ids only, no raw email/CCCD/phone   |
| 14 | One item failure does not lose the whole batch                         | AC #14 — two triggers x two items = four envelopes; adapter records N unique reminders                              |
| 15 | Daily digest and 15-min do not duplicate                               | AC #15 — same idempotencyKey + same payload + same correlationId = cached; reminder log records ONE entry            |

## C-N11-01..C-N11-05 correction-round mapping (Round 1)

| Requirement          | Test(s)                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| C-N11-01 graph split | `Switch routing (SEND vs FALLBACK)` + `Build ack from send` + `Build ack from fallback` converge exactly once on `Build acknowledgement batches` |
| C-N11-02 one item per `nextActionId` | `C-N11-02 — multi-item: N items in one owner group produce N distinct reminders`; `C-N11-02 — reorder: same items in different order yield same keys`; `C-N11-02 — new-item`; `C-N11-02 — replay` |
| C-N11-03 ack idempotency            | `C-N11-03 — same nextActionId + same day + same audience -> same ackBase across runs`; `C-N11-03 — fallback ack key contains nextActionId and is deterministic` |
| C-N11-04 BLOCKED signer             | `C-N11-04 — workflow JSON declares BLOCKED_BY_N8N_SIGNER_DECISION` (4 tests)                                                              |
| C-N11-05 runner semantics + negative fixture | `C-N11-05 — negative fixture (the old candidate's bugs)`; `C-N11-05 — duplicate detection in runner trace`                                |

## Baseline regression

```
node --test apps/integration-api/tests/automation-n8n11-sla-reminder.test.mjs apps/integration-api/tests/automation-gateway.test.mjs apps/integration-api/tests/automation-http-route.test.mjs
```

Result: 100 / 100 pass (36 N8N/1.1 + 64 N8N/0.3 baseline). No baseline
test was broken by the N8N/1.1 delta.

## Negative fixture

`apps/n8n-workflows/sla-reminder.negative.v1.json` encodes the
C-N11-01..C-N11-04 violations that T0 caught in the previous
candidate. `validateStructure` and `validateGraphInvariants` reject
this fixture on every violation: `httpNodeCredential`, missing
`BLOCKED_BY_N8N_SIGNER_DECISION`, `Build sendSyntheticReminder batches`
fan-out, and `Date.now()` / `Math.random()` in `functionCode`.

## Boundary checks

- canonical state is read-only from workflow perspective — sendSyntheticReminder never returns a status mutation.
- `runner.duplicates.send[]` and `runner.duplicates.ack[]` flag any
  duplicate during a single execution.

## What the tests do NOT prove

- The tests use the local Node runner; they do NOT exercise a real
  n8n runtime. See LIMITATIONS.md.
- The tests use the mock adapter; they do NOT exercise any live CRM
  provider. See LIMITATIONS.md.
- Until C-N11-04 is unblocked by the signer decision, the runner
  signs HTTP envelopes ONLY when the caller passes a `secret`
  argument; trace entries are tagged with `signerSubstituted: true`
  so the substitution is explicit. The committed workflow JSON
  remains `BLOCKED_BY_N8N_SIGNER_DECISION`.
