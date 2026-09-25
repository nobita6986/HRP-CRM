# PORT / MOCK / ROUTE EVIDENCE (M4)

## Implementation

Per the r2 plan MIGRATION-SEQUENCE.md M4 section, the isolated read
port + deterministic mock + gated route were created in
`apps/integration-api/src/orchestrator/talent-context-read/`:

- `port.ts` — exports `TalentContextReadPort` interface.
- `port-mock.ts` — exports
  `createDeterministicTalentContextReadPort(config)`.
- `route.ts` — exports `registerTalentContextReadRouteMock(options)`.
- `index.ts` — barrel re-export.

### Port interface

```ts
type TalentContextReadPort = {
  read(req: unknown): Promise<
    | { ok: true; result: TalentContextReadResult }
    | { ok: false; reason: "local-validation-failure"; issues: [...] }
    | { ok: false; reason: "valid-hrp-error-envelope"; error: TalentContextReadErrorResponse }
    | { ok: false; reason: "transport-runtime-failure"; cause: unknown }
  >;
};
```

### Deterministic mock

- Deterministic — same input → same output.
- Every name goes through `redactFullName` from the accepted subpath
  BEFORE being placed in any result envelope.
- Result envelope never contains a raw PII string.
- Never fabricates a `valid-hrp-error-envelope`; HRP errors are only
  returned when the `forceErrorCode` configuration is set.
- Unsafe seed (control chars, etc.) yields WHOLE-PROJECTION omission
  (`identitySummary: undefined`, `unavailableFields: ['identitySummary']`)
  per the redaction contract's "NEVER truncate" rule.

### Gated route

- NOT registered at startup.
- Registered ONLY when `HRP_MOCK_MODE=deterministic` OR when the
  caller passes `force: true` (intended for tests only).
- The default `assertOrgBinding` hook REJECTS all requests, so the
  route refuses to call the port without explicit caller authorization.
- Authorization and org binding NEVER trust the request body; the
  route only uses `callContext.assertedOrganizationId`.
- Defense in depth: the route overrides the body's `organizationId`
  with `callContext.assertedOrganizationId` before invoking the port.

## Test files

- `apps/integration-api/tests/parser-mock.test.mjs`
- `apps/integration-api/tests/parser-route.test.mjs`

## Test results

```
M4 mock (parser-mock.test.mjs): 7/7 PASS
  ✔ deterministic — same input produces same output
  ✔ full name is redacted in identitySummary
  ✔ never fabricates HRP error envelope when forceErrorCode is absent
  ✔ forceErrorCode=NOT_FOUND returns valid-hrp-error-envelope
  ✔ invalid input returns local-validation-failure
  ✔ unsafe seed (control chars) yields WHOLE-PROJECTION omission
  ✔ result envelope re-parses (no drift from schema)

M4 route (parser-route.test.mjs): 9/9 PASS
  ✔ NOT registered when HRP_MOCK_MODE is unset
  ✔ read returns mock-disabled when not registered
  ✔ registered under HRP_MOCK_MODE=deterministic
  ✔ registered under HRP_MOCK_MODE=deterministic + force flag (test override)
  ✔ default org binding rejects (no body trust)
  ✔ org binding accepts when hook returns true
  ✔ invalid request returns local-validation-failure
  ✔ org binding derived from callContext, not request body
  ✔ returned result has organizationId from callContext (not body)

TOTAL: 16/16 PORT / MOCK / ROUTE TESTS PASS
```

## Files NEVER touched

- `apps/integration-api/src/orchestrator/intake-orchestrator.ts`
- `apps/integration-api/src/orchestrator/steps.ts`
- `apps/integration-api/src/orchestrator/index.ts`

The CI grep-guard `parser-boundary-guard.test.mjs` asserts no source
line in `intake-orchestrator.ts` or `steps.ts` references
`talent-context-read/`. The grep-guard test PASSES.

## No PII leakage

No phone, CCCD, raw LaborProfile DTO, or internal HRP field appears in
the M4 boundary. Projection is always
`identitySummary.fullNameRedacted` with `displayOnly: true`. The mock
output is re-parsed through `parseTalentContextReadResult` to guard
against accidental envelope drift.

## No runtime opening

- No HRP HTTP runtime.
- No JWT signer/verifier runtime.
- No replay/delegation/audit DB stores.
- No migrations.
- No direct HRP database access.
- No key provisioning.
- No callable production stub.

M6 remains DEFERRED_SEPARATE_TASK.
