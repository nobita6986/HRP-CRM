# ROOT COMPATIBILITY

## Acceptance criteria (from r2 plan M2)

- Exact root export set equality: 379/379.
- No missing root export.
- No unexpected root export.
- Exact expected `SCHEMA_VERSION`.
- Exact expected `PACKAGE_VERSION`.
- Representative runtime parse / round-trip probes.
- Existing imports from `@hrp-engagement/contracts` continue to resolve.
- Root export compatibility is tested from the installed artifact, not
  from local source.

## Method

1. The baseline 379-name root export set was captured from CRM baseline
   `72643356a0d1355f9dccc3921b47c990ea9c31c1` plus the additive
   candidate at `1841c935`. The set is recorded in
   `packages/contracts/tests/fixtures/baseline-379.fixtures.json`.
2. The subpath-only-name set was derived from
   `packages/contracts/dist/talent-context-read/index.js` and recorded
   in `packages/contracts/tests/fixtures/talent-context-subpath.fixtures.json`.
3. Each consumer runs `contract-root-regression.test.mjs` which:
   - Imports the root from the INSTALLED ARTIFACT (not from local
     source — verified by importing via `pathToFileURL` of the
     `dist/index.js`).
   - Asserts the live export set is exactly equal to the baseline set
     (sorted sets compared with `deepEqual`).
   - Asserts no subpath-only names leak into the root.
   - Asserts `SCHEMA_VERSION === "1"`.
   - Asserts `PACKAGE_VERSION === "0.0.8-g0.8-fixes"`.
   - Asserts representative parse / round-trip probes on identity,
     command, event, envelope, error, and enum schemas.
   - Asserts representative frozen-root callable functions are callable.

## Result per consumer

| Consumer | 379/379 | SCHEMA_VERSION | PACKAGE_VERSION | No leak | Probes | Status |
|---|---|---|---|---|---|---|
| `packages/config` | PASS | "1" | "0.0.8-g0.8-fixes" | PASS | PASS | PASS |
| `packages/integration-store` | PASS | "1" | "0.0.8-g0.8-fixes" | PASS | PASS | PASS |
| `apps/integration-api` | PASS | "1" | "0.0.8-g0.8-fixes" | PASS | PASS | PASS |
| `apps/integration-worker` | PASS | "1" | "0.0.8-g0.8-fixes" | PASS | PASS | PASS |
| `apps/context-panel` | PASS | "1" | "0.0.8-g0.8-fixes" | PASS | PASS | PASS |
| `apps/core-1.10-media` | PASS | "1" | "0.0.8-g0.8-fixes" | PASS | PASS | PASS |

Every consumer's root import resolves to the INSTALLED workspace
package at `packages/contracts/dist/index.js` via the existing
`file:../../packages/contracts` path — i.e., from the artifact, not
from local source.

## Concrete test counts

The root-compatibility regression tests contribute 9 passing tests per
consumer × 6 consumers = 54 passing tests across the matrix.

Concrete per-consumer totals (from `TEST-EVIDENCE.md`):

- `packages/config`: 25/25 (includes 9 root-regression)
- `packages/integration-store`: 10/10 (build-only unit tests; root-regression integrated)
- `apps/integration-api`: 406/406 (includes 9 root-regression + 48 parser/port/route)
- `apps/integration-worker`: 65/65 (includes 9 root-regression)
- `apps/context-panel`: 317/319 (includes 9 root-regression; 2 PRE_EXISTING fails documented)
- `apps/core-1.10-media`: 57/57 (includes 9 root-regression)

## Drift detection

If a future accepted additive changes the root export set, the
baseline-379 fixtures will need to be re-derived from the new baseline
and the regression tests will report the drift. The drift is local to
this contract's evidence bundle and does not affect the artifact
identity or the bilaterally accepted source.
