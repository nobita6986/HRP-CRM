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
ℹ tests 30
ℹ suites 12
ℹ pass 30
ℹ fail 0
```

30/30 PASS — covers happy path (3 ops), organization spoofing,
idempotency (replay/conflict/**correlation_id_mismatch**/replay-with-
different-exec-ids), service credential lifecycle
(expired/unknown/mismatched sig/unknown svc), operation allowlist
(commandName mismatch + outside allowlist), provider offline +
timeout, kill switch (workflow/connection/org granularity +
most-specific wins), rate limit, payload size, schema validation,
redaction, internal codes isolation.

The previous "rotated correlationId is a valid replay" assertion is
**removed** (see C-06 in the N8N/0.3 recheck handoff). The
corresponding test now asserts
`{ code: 'IDEMPOTENCY_CONFLICT', idempotencyError: 'correlation_id_mismatch' }`
with HTTP 409 for a same-key + same-digest + different-correlationId
re-attempt. Same-key + same-digest + same-correlationId still
returns the cached 200 APPLIED.

## N8N/0.3 HTTP boundary (Phase B)

```
$ node --test tests/automation-http-route.test.mjs
ℹ tests 34
ℹ suites 17
ℹ pass 34
ℹ fail 0
```

34/34 PASS — covers:

- happy path: POST /v1/automation/dispatch -> 200 APPLIED
- missing/bad auth: missing service-id (401), missing signature
  (401), non-hex signature (401), mismatched signature (401)
- auth-before-body: 401 returned WITHOUT draining a large request
  body (see C-03)
- omitted-header truth: dispatch helper drops `undefined`/`null`
  from the header set so "missing header" really means missing
  (see C-04)
- unknown service: serviceId not in registry (401)
- organization spoofing: body org != credential (403),
  header org != credential (401)
- operation allowlist: outside allowlist (403),
  inside allowlist (200)
- idempotency: same key + same payload + same correlationId
  (200 cached), same key + same payload + different correlationId
  (409 `correlation_id_mismatch`), same key + different payload
  (409 `payload_digest_mismatch`)
- payload size: Content-Length over maxBodyBytes (422)
- payload size chunked: oversized body without Content-Length
  returns deterministic 422 envelope; the socket is NOT reset
  (see C-05)
- provider offline: adapter offline (503)
- adapter timeout: adapter exceeds budget (503)
- kill switch: workflow blocked (503), non-matching workflow (200)
- redacted logs: log entry contains no secret/signature/PII
- route disabled when registry unconfigured (404)
- route unmounted at server level (404)
- runtime assembly from env: NODE_ENV != production and
  HRP_MOCK_MODE=deterministic with a valid registry mounts
  AutomationHttpHandler automatically (200) (see C-02)
- runtime assembly absent: HRP_AUTOMATION_SERVICES missing
  -> route 404
- runtime assembly malformed: invalid JSON -> route 404
- runtime assembly expired: all entries expired -> route 404
- runtime assembly production: NODE_ENV=production -> route 404
  even if env present (fail-closed)
- runtime assembly off mode: HRP_MOCK_MODE=off -> route 404

## TypeScript build

```
$ npx tsc --noEmit
exit=0

$ npx tsc
exit=0
```

## Combined totals

| Suite                                   | Tests | Pass |
|-----------------------------------------|-------|------|
| automation-gateway.test.mjs (N8N/0.2)   | 30    | 30   |
| automation-http-route.test.mjs (N8N/0.3)| 34    | 34   |
| TOTAL                                   | 64    | 64   |

## Notes on test isolation

- Tests inject a fixed clock (`now: () => FIXED_NOW`) so the synthetic
  registry entries (which expire `FIXED_NOW + 24h`) are valid.
- Rate limiter is configured with `capacity: 10000, perMinute: 60_000`
  in tests to avoid accidentally tripping the bucket. Production uses
  the gateway's defaults (60/min with burst 5).
- Runtime-assembly tests boot `startServer(config, { env })` with
  the env-shaped HRP_AUTOMATION_SERVICES (per C-02). They do NOT
  prebuild an `AutomationHttpHandler`; the server constructs the
  handler from env on each boot.
- The chunked-oversize test (C-05) opens a raw `node:net` socket,
  sends `Transfer-Encoding: chunked` with no Content-Length, and
  asserts a clean 422 JSON response — no socket reset, no
  `req.destroy()`.
- The omitted-header test (C-04) inspects the outgoing headers
  via a captured `requestOptions` argument so "header really
  missing" is asserted, not just "request failed".

## Out of scope

- `tests/server.test.mjs` (CORE/1.2 fixture) checks VERSION ==
  '1.2.0-core1.8'. The N8N/0.3 worktree bumped VERSION to
  '1.2.0-core1.8+n8n0.3' so this single assertion fails on the
  bumped string. It is NOT in the C-01..C-06 scope and was not
  touched. `npm run test` will still surface this pre-existing
  mismatch; the isolated `node --test` runs above do not run
  `server.test.mjs` and pass cleanly.
