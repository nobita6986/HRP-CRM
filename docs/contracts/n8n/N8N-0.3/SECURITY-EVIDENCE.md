# SECURITY-EVIDENCE.md

## Fail-closed behavior (test-backed)

Every negative case below is exercised by
`apps/integration-api/tests/automation-http-route.test.mjs` (20/20 PASS).
Each test maps to a security control.

| Control                                         | Test                                   | Outcome  |
|-------------------------------------------------|----------------------------------------|----------|
| Missing X-Hrp-Automation-Service-Id             | missing/bad auth / missing service-id  | 401      |
| Missing X-Hrp-Automation-Signature              | missing/bad auth / missing signature   | 401      |
| Non-hex signature                               | missing/bad auth / non-hex signature   | 401      |
| Mismatched HMAC signature                       | missing/bad auth / mismatched sig      | 401      |
| Unknown serviceId in registry                   | unknown service / unknown svc          | 401      |
| Body organizationId != credential               | org spoof / body spoofs org            | 403      |
| Header organizationId != credential             | org spoof / header spoofs org          | 401      |
| Operation not in registry allowlist             | op allowlist / outside allowlist       | 403      |
| Same idemKey + same payload + same correlationId   | idempotency / replay                    | 200      |
| Same idemKey + different payload                  | idempotency / payload_digest_mismatch   | 409      |
| Same idemKey + same payload + different correlationId | idempotency / correlation_id_mismatch | 409      |
| Content-Length > maxBodyBytes                   | payload size / CL over limit           | 422      |
| Adapter offline                                 | provider offline                       | 503      |
| Adapter timeout                                 | adapter timeout                        | 503      |
| Kill switch active                              | kill switch / blocked workflow         | 503      |
| Kill switch inactive for non-matching workflow  | kill switch / non-blocked passes       | 200      |
| Route disabled when registry unconfigured       | route disabled / unconfigured          | 404      |
| Route unmounted when handler not injected       | route unmounted                        | 404      |

## Log redaction

The default log sink emits a single-line JSON object. The
`RedactedLogEntry` shape (see gateway.ts) does NOT carry:

- `secret`
- `signature` (the value; the field name "scopeKey" and "payloadDigest"
  are derived metadata)
- raw body bytes
- actor raw fields

The integration test `redacted logs / log entry contains no secret,
signature, or PII` asserts:

- The shared secret string is not present in the entry.
- The actor.systemId is not present.

## No information leak

- All "missing credential" or "unknown service" outcomes return
  `AUTHENTICATION_REQUIRED` (401). The response does NOT distinguish
  "service unknown" from "signature invalid" or "credential expired".
- All kill-switch / dependency / timeout outcomes return
  `DEPENDENCY_UNAVAILABLE` (503). The response does NOT leak the
  matched rule id; the rule id is logged only for audit.

## Bounded blast radius

- Route disabled (404) when:
  - `mockMode === 'off'`, OR
  - Registry has no non-expired entries.
- Server-side `automationHandler` injection is required (opt-in); the
  default `startServer()` invocation does NOT mount the route.
- `maxBodyBytes` defaults to 64 KiB, capped by the gateway's
  `HARD_MAX_PAYLOAD_BYTES` (1 MiB).

## Out of scope (NOT addressed by N8N/0.3)

- Distributed rate limiting (token bucket is in-memory only).
- Distributed idempotency store (in-memory only).
- Distributed kill switch (in-memory only).
- Persistent audit log of redacted entries (stdout only).
- TLS termination (deployment concern).
- IP allowlist / mTLS (deployment concern).