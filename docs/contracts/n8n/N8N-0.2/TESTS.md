# TESTS — N8N/0.2 CRM Automation Gateway

## 1. How to run

```
# from apps/integration-api/
npx tsc --noEmit
node --test tests/automation-gateway.test.mjs
```

No Docker. No DB. No HRP provider connection. Pure Node.js
`node:test` runner.

## 2. Test matrix (29 cases)

Each row is a unit test. The "Status" column reflects the
2026-09-25 run captured at `tests/evidence/automation-gateway.test.stdout.txt`.

| #   | Test name                                                            | AC ref | Expected wire code         | Status |
|-----|----------------------------------------------------------------------|--------|----------------------------|--------|
| 01  | listDueNextActions happy path                                        | §3.2.1 | APPLIED (200)              | pass   |
| 02  | getNextAction happy path                                              | §3.2.1 | APPLIED (200)              | pass   |
| 03  | acknowledgeReminder happy path                                        | §3.2.1 | APPLIED (200)              | pass   |
| 04  | spoofed organization id (HMAC valid for evil org) -> 403              | §3.2   | FORBIDDEN                  | pass   |
| 05  | unknown service id -> 401                                            | §3.2   | AUTHENTICATION_REQUIRED    | pass   |
| 06  | signature mismatch -> 401                                            | §3.2   | AUTHENTICATION_REQUIRED    | pass   |
| 07  | credential expired -> 401                                            | §3.2   | AUTHENTICATION_REQUIRED    | pass   |
| 08  | operation not allowed -> 403                                          | §3.2   | FORBIDDEN                  | pass   |
| 09  | idempotent replay returns cached result                              | §3.3   | APPLIED (same data)        | pass   |
| 10  | idempotent replay vs conflicting payload -> 409                      | §3.3   | IDEMPOTENCY_CONFLICT       | pass   |
| 11  | idempotent retry with new correlationId + new executionId dedupes    | §3.3   | APPLIED (cached)           | pass   |
| 12  | payload too large -> 422                                             | §3.2   | VALIDATION_ERROR           | pass   |
| 13  | rate limited -> 429                                                  | §3.2   | RATE_LIMITED               | pass   |
| 14  | adapter offline -> 503                                               | §3.2   | DEPENDENCY_UNAVAILABLE     | pass   |
| 15  | adapter timeout -> 503                                               | §3.2   | DEPENDENCY_UNAVAILABLE     | pass   |
| 16  | kill switch (org) -> 503                                             | §3.3   | DEPENDENCY_UNAVAILABLE     | pass   |
| 17  | kill switch (workflow+org beats workflow)                            | §3.3   | (specificity ordering)     | pass   |
| 18  | kill switch (workflow+conn+org beats workflow+org)                   | §3.3   | (specificity ordering)     | pass   |
| 19  | kill switch (connection+org beats organization)                      | §3.3   | (specificity ordering)     | pass   |
| 20  | kill switch (org override beats default)                             | §3.3   | (specificity ordering)     | pass   |
| 21  | redacted envelope keeps secret out                                   | §3.4   | (no secret literal)        | pass   |
| 22  | response data shape is strict + versioned                            | §3.4   | APPLIED w/ schemaVersion 1 | pass   |
| 23  | commandName vs operation.op mismatch -> 422                          | §3.2   | VALIDATION_ERROR           | pass   |
| 24  | future schemaVersion rejected -> 422                                 | §3.2   | VALIDATION_ERROR           | pass   |
| 25  | unknown operation rejected -> 422                                   | §3.2   | VALIDATION_ERROR           | pass   |
| 26  | frozen CommandError wire code uses frozen policy                     | §3.4   | (no internal code leaks)   | pass   |
| 27  | registry resolves credential with strict allowlist                   | §3.2   | (registry contract)        | pass   |
| 28  | rate limit does not consume tokens on validation failure             | §3.2   | (budget isolation)         | pass   |
| 29  | operation allowlist (additional op succeeds when allowed)            | §3.2   | APPLIED (200)              | pass   |

## 3. Raw captured output

File: `apps/integration-api/tests/evidence/automation-gateway.test.stdout.txt`

Snippet (line counts elided):

```
TAP version 13
# Subtest: listDueNextActions happy path
ok 1 - listDueNextActions happy path
...
ok 29 - operation allowlist (additional op succeeds when allowed)
# tests 29
# pass 29
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms ~5000
```

The full file is the canonical evidence; this document is a summary
suitable for T0 review.

## 4. Boundary classifications

- `EXECUTED_VERIFIED`: tests 01..29 all green.
- `NOT_VERIFIED`: HTTP boundary (N8N/0.3).
- `NOT_AVAILABLE`: integration with real n8n instance.