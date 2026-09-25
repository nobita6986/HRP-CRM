# TEST-EVIDENCE.md

## Environment

- Worktree: `D:\CodeApp\Hrp-Crm-n8n03-r1`
- Branch: `codex/n8n-03-http-boundary-r1`
- Baseline: `main @ 72643356a0d1355f9dccc3921b47c990ea9c31c1`
- Node.js: v24.19.0
- TypeScript: 5.7.3
- Integration store: prisma generate + tsc build executed locally for the
  isolated worktree.

## N8N/0.2 anchor (Phase A)

```
$ node --test tests/automation-gateway.test.mjs
ℹ tests 29
ℹ suites 12
ℹ pass 29
ℹ fail 0
```

29/29 PASS — covers happy path (3 ops), organization spoofing,
idempotency (replay/conflict/replay-with-different-exec-ids), service
credential lifecycle (expired/unknown/mismatched sig/unknown svc),
operation allowlist (commandName mismatch + outside allowlist),
provider offline + timeout, kill switch (workflow/connection/org
granularity + most-specific wins), rate limit, payload size, schema
validation, redaction, internal codes isolation.

## N8N/0.3 HTTP boundary (Phase B)

```
$ node --test tests/automation-http-route.test.mjs
ℹ tests 20
ℹ suites 13
ℹ pass 20
ℹ fail 0
```

20/20 PASS — covers:

- happy path: POST /v1/automation/dispatch -> 200 APPLIED
- missing/bad auth: missing service-id (401), missing signature (401),
  non-hex signature (401), mismatched signature (401)
- unknown service: serviceId not in registry (401)
- organization spoofing: body org != credential (403), header org != credential (401)
- operation allowlist: outside allowlist (403), inside allowlist (200)
- idempotency: same key + same payload (200 cached), same key + diff payload (409)
- payload size: Content-Length over maxBodyBytes (422)
- provider offline: adapter offline (503)
- adapter timeout: adapter exceeds budget (503)
- kill switch: workflow blocked (503), non-matching workflow (200)
- redacted logs: log entry contains no secret/signature/PII
- route disabled when registry unconfigured (404)
- route unmounted at server level (404)

## TypeScript build

```
$ npx tsc --noEmit
exit=0

$ npx tsc
exit=0
```

## Combined totals

| Suite                                  | Tests | Pass |
|----------------------------------------|-------|------|
| automation-gateway.test.mjs (N8N/0.2)  | 29    | 29   |
| automation-http-route.test.mjs (N8N/0.3)| 20    | 20   |
| TOTAL                                  | 49    | 49   |

## Notes on test isolation

- Tests inject a fixed clock (`now: () => FIXED_NOW`) so the synthetic
  registry entries (which expire `FIXED_NOW + 24h`) are valid.
- Rate limiter is configured with `capacity: 10000, perMinute: 60_000`
  in tests to avoid accidentally tripping the bucket. Production uses
  the gateway's defaults (60/min with burst 5).
- Each test boots its own `startServer()` instance on an ephemeral
  port; `before` / `after` hooks manage server lifecycle.