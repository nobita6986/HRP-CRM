# N8N/0.3 r1 G2 — Gateway integration of PostgresIdempotencyAuthority



Status: PROPOSAL — NOT YET IMPLEMENTED IN GATEWAY



This document is the bridge plan from RG-02 (durable idempotency authority)

into the real automation gateway. The T1-B slice deliberately stopped short

of editing apps/integration-api/src/automation/gateway.ts because



  - gateway.ts calls the synchronous AutomationIdempotencyStore that

    backs the local mock gateway; the new

    PostgresIdempotencyAuthority is async.

  - The README for automation/idempotency-store.ts explicitly forbids

    resurrecting the in-memory store as production code (RG-02: The

    in-memory store may remain only as an explicitly injected test

    adapter).

  - Any gateway edit must respect the master RG-02 acceptance criteria

    and the no-deploy stop condition of the T1-B task.



This proposal is the only authoritative change request for the gateway.

It is intended to be reviewed and committed in a follow-up slice that

touches gateway.ts.



## 1. Scope



Adopt IdempotencyAuthority (async interface) at the gateway boundary:



  - lookup() call    : sync store.lookup(...) -> await authority.lookup(...)

  - record() call    : sync store.put(...)     -> await authority.record(...)

  - size() debug     : none                    -> optional await authority.size()

  - Wire response shape: unchanged (only call site changes)



The AutomationIdempotencyRecord shape is unchanged. Existing tests that

read cache-hit are updated by the new interface (only the union variants

differ; the success-path response is identical).



## 2. Wire contract diff (logic-only)



The gateway today does:



  1. Verify signature / scope / envelope schema.

  2. Derive scopeKey from the resolved connection registry.

  3. Compute payloadDigest = SHA-256(canonical envelope MINUS volatile).

  4. Call store.lookup(scopeKey, payloadDigest, correlationId).

  5. If returned cache-hit, return the recorded AutomationWireResponse.

  6. If returned conflict, return IDEMPOTENCY_CONFLICT with the reason

     code (no side effect).

  7. Otherwise invoke the adapter (mockAdapter.call(...)).

  8. Call store.put(record) with the terminal response.

  9. Return the response.



Proposed change: swap the lookup/put to await calls against the authority

adapter. No public surface change to consumers.



## 3. Concurrency invariants preserved



  - The atomic claim is provided by PostgresIdempotencyAuthority.lookup

    using SELECT ... FOR UPDATE plus ON CONFLICT DO NOTHING.

  - The terminal record is idempotent on the same triple, with

    first-writer-wins on boundCorrelationId.

  - The bounded pending/lease/recovery semantics mean that a crashed

    owner no longer stalls: reclaimExpiredLeases converts a lapsed

    PENDING row to a RECORDED lease-reclaimed row.



## 4. Failure mode mapping



  - { hit: false }                            -> proceed to adapter

  - { hit: true, cacheHit: true }             -> replay recorded response

  - { hit: true, reason: payload_digest_mismatch }

                                              -> 409 IDEMPOTENCY_CONFLICT (payload_digest_mismatch)

  - { hit: true, reason: correlation_id_mismatch }

                                              -> 409 IDEMPOTENCY_CONFLICT (correlation_id_mismatch)

  - { hit: true, leased: true, reason: lease_expired }

                                              -> 409 IDEMPOTENCY_CONFLICT (lease_expired)

  - DB transient error                        -> 503 DEPENDENCY_TIMEOUT (gateway stays fail-closed)



## 5. Wiring (NOT in this slice)



A new module apps/integration-api/src/automation/authority-wiring.ts will:



  - Construct a PostgresIdempotencyAuthority from the existing Prisma

    client used by the receiver (packages/integration-store).

  - Read HRP_IDEMPOTENCY_RETENTION_MS / HRP_IDEMPOTENCY_LEASE_MS env

    overrides with safe defaults.

  - Run a periodic reclaimExpiredLeases sweep (every leaseMs / 2).

  - Expose a single getAuthority() factory for the gateway.



The factory is registered via a typed setter in index.ts so tests can

still inject InMemoryIdempotencyAuthority.



## 6. Tests touched by this proposal



  - apps/integration-api/tests/gateway.test.mjs (sync -> async).

  - apps/integration-api/tests/idempotency-authority-unit.test.mjs

    (already covers the in-memory adapter; this proposal references the

    unit + integration result for the postgres adapter).

  - apps/integration-api/tests/postgres-idempotency.int.test.mjs

    (already covers the postgres adapter end-to-end).



The proposal author must NOT add new tests in this slice; the existing

unit (9) + integration (11) suites exercise the full authority surface.



## 7. Constraints (hard)



  1. gateway.ts MUST NOT be edited in T1-B.

  2. digest.ts, connection-registry.ts, and the named digestNames MUST NOT change.

  3. The legacy AutomationIdempotencyStore (in-memory map) is now an injected

     test adapter ONLY; the local mock gateway may continue to use it because

     the local mock has its own process boundary.

  4. No secret, no signature, no Idempotency-Key header value, and no

     correlationId may be logged under any authority-level reason code.

  5. The proposal change is conditional on READY_FOR_T0_REAL_GATEWAY_REVIEW

     being issued and on a fresh T2 review.



## 8. Evidence references



  - Unit suite: 9 / 9 PASS (see RG-02 acceptance).

  - Integration suite: 11 / 11 PASS against embedded PostgreSQL 17.6.

  - No new errors introduced in tsc --noEmit for the authority files.

  - Migration 0006_automation_idempotency_authority applied; rollback

    drops table + type + trigger.

  - SHA-256 manifest at docs/contracts/n8n/N8N-0.3-REAL-GATEWAY-PLAN-R1/manifest.sha256.



## 9. Open risks tracked in GAP-REGISTER.md



  - G2-RISK-1: gateway still imports the legacy synchronous store in the

    mock-mode code path; the follow-up T2 slice must switch the build

    target or remove the dependency.

  - G2-RISK-2: the integration test harness boots embedded-postgres on

    every CI run; this is the only blocking factor for CI today.

    Run on the existing plan-approved runner, not on a developer laptop.



-- END --

