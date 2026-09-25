# PARSER EVIDENCE (M3)

## Implementation

Per the r2 plan MIGRATION-SEQUENCE.md M3 section, three isolated parsers
were created in `apps/integration-api/src/orchestrator/talent-context-read/`:

- `parser-request.ts` — exports `parseTalentContextReadRequest(raw)`.
- `parser-result.ts` — exports `parseTalentContextReadResult(raw)`.
- `parser-error.ts` — exports `parseTalentContextReadError(raw)`.

Each parser:

- Imports ONLY the schema by name from
  `@hrp-engagement/contracts/talent-context-read/v1`. No `dist/`,
  `src/`, or `internal/` path imports; no local schema duplication; no
  broadening of the seven-code query parser; no acceptance of
  command-only error codes.
- Returns a discriminated result with shape
  `{ ok: true; value: T }` or
  `{ ok: false; reason: "local-validation-failure"; issues: [...] }`.
- Never fabricates an HRP wire error envelope.

The three parsers are re-exported by the directory's `index.ts`
barrel file along with the M4 port + mock + route. The
`parser-boundary-guard.test.mjs` test asserts that no source line in
`intake-orchestrator.ts` or `steps.ts` references
`talent-context-read/`, and that no new parser/port/route file imports
a forbidden contracts path.

## Test files

- `apps/integration-api/tests/parser-request.test.mjs`
- `apps/integration-api/tests/parser-result.test.mjs`
- `apps/integration-api/tests/parser-error.test.mjs`
- `apps/integration-api/tests/parser-boundary-guard.test.mjs`

## Test results

```
parseTalentContextReadRequest: 9/9 PASS
  ✔ valid input parses with ok=true
  ✔ missing actor returns local-validation-failure
  ✔ unknown field is rejected (strict mode)
  ✔ empty fieldAllowlist returns local-validation-failure
  ✔ invalid field name returns local-validation-failure
  ✔ invalid delegationRef rejected (corrupt byte base64url)
  ✔ non-object input returns local-validation-failure
  ✔ never fabricates an HRP wire error envelope
  ✔ invalid moduleSchemaVersion rejects

parseTalentContextReadResult: 9/9 PASS
  ✔ valid input parses with ok=true
  ✔ preserves unavailableFields semantics
  ✔ missing target returns local-validation-failure
  ✔ unknown field rejected (strict mode)
  ✔ identitySummary with displayOnly=false rejected
  ✔ identitySummary present and marked unavailable is rejected
  ✔ invalid moduleSchemaVersion rejects
  ✔ non-object input returns local-validation-failure
  ✔ never fabricates an HRP wire error envelope

parseTalentContextReadError: 11/11 PASS
  ✔ valid HRP error envelope parses with ok=true
  ✔ another valid seven-code (FORBIDDEN)
  ✔ status != FAILED returns local-validation-failure
  ✔ missing errors returns local-validation-failure
  ✔ errors.length != 1 returns local-validation-failure
  ✔ command-only frozen error codes are rejected
  ✔ unknown error code rejected
  ✔ messageKey/retryClass mismatch rejected
  ✔ unknown field rejected (strict mode)
  ✔ non-object input returns local-validation-failure
  ✔ never fabricates an HRP wire error envelope

boundary guard: 3/3 PASS
  ✔ M4 boundary: intake-orchestrator and steps never reference talent-context-read
  ✔ M4 boundary: no new parser/port/route file imports forbidden contracts paths
  ✔ M4 boundary: parsers/ports/routes use only the public subpath import

TOTAL: 32/32 PARSER + BOUNDARY TESTS PASS
```

## Failure-mode taxonomy

- `local-validation-failure` — parser-returned; NOT a wire error.
- `valid-hrp-error-envelope` — successful parse of an actual HRP error
  payload via `parseTalentContextReadError`.
- `transport-runtime-failure` — raised exception; never fabricated by
  the parsers themselves.

The seven-code parser is intentionally narrow and rejects any
command-only frozen error code (e.g. an attempted `GATEWAY_TIMEOUT`
injection is rejected as `local-validation-failure`).

## Imports

Each parser imports the exact exported schema by name:

```ts
import { TalentContextReadQueryRequestSchema } from
  "@hrp-engagement/contracts/talent-context-read/v1";
import { TalentContextReadResultSchema } from
  "@hrp-engagement/contracts/talent-context-read/v1";
import { TalentContextReadErrorResponseSchema } from
  "@hrp-engagement/contracts/talent-context-read/v1";
```

No `dist/`, `src/`, or `internal/` path. No schema/type duplication.
The `parser-boundary-guard.test.mjs` test enforces these constraints.
