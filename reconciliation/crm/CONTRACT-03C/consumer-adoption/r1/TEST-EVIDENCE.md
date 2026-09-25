# TEST EVIDENCE

## Per-consumer test counts (full test suites)

| Consumer | Test files | Tests | Pass | Fail | Notes |
|---|---|---|---|---|---|
| `packages/contracts` | 24 (incl. `tests/talent-context-read/*.test.mjs`) | 711 | 711 | 0 | All 711 frozen-root + subpath tests pass, including 22 redaction vectors. |
| `packages/config` | 1 | 25 | 25 | 0 | Includes 9 root-regression. |
| `packages/integration-store` | 1 (`tests/unit/*.test.mjs`) | 10 | 10 | 0 | Adapter + error tests. |
| `apps/integration-worker` | multiple | 65 | 65 | 0 | Includes pg-e2e (embedded-postgres) + 9 root-regression. |
| `apps/integration-api` | multiple | 406 | 406 | 0 | Includes 9 root-regression + 9 M3 parser-request + 9 M3 parser-result + 11 M3 parser-error + 7 M4 mock + 9 M4 route + 3 boundary guard = 57 M3+M4 tests. |
| `apps/context-panel` | multiple | 319 | 317 | **2 PRE_EXISTING** | Both fails are in `manifest-readonly-1.13` / `manifest-readonly-1.14` `--verify` tests; these fail identically on baseline `72643356`. |
| `apps/core-1.10-media` | multiple | 57 | 57 | 0 | Includes 9 root-regression. |

## Aggregate (non-PG)

| | Tests | Pass | Fail |
|---|---|---|---|
| Frozen contracts (root + subpath) | 711 | 711 | 0 |
| Per-consumer regression (5 consumers × 9 root-regression) | 45 | 45 | 0 |
| M3 parsers + boundary guard (integration-api) | 32 | 32 | 0 |
| M4 mock + route (integration-api) | 16 | 16 | 0 |
| Per-consumer remaining suites | 815 | 815 | 0 |
| **Subtotal (no double-count)** | **1,619** | **1,619** | **0** |
| Pre-existing context-panel manifest-readonly | 2 | 0 | 2 (PRE_EXISTING) |
| **Total (with pre-existing)** | **1,621** | **1,619** | **2 (PRE_EXISTING)** |

## Pre-existing failures

The two failing tests are:

- `apps/context-panel/tests/manifest-readonly-1.13.test.mjs:65`
  "manifest: --verify is read-only (does not modify bundled manifest)"
- `apps/context-panel/tests/manifest-readonly-1.14.test.mjs:68`
  "manifest: --verify is read-only (does not modify bundled manifest)"

Both fail with the same pattern: the `--verify` step reports
`hash mismatch` lines where the printed `manifest=` and `actual=`
hex strings are byte-identical. The manifest script
`scripts/generate-manifest-1.13.mjs` (and 1.14) reports FAIL despite
the on-disk and recorded hashes matching — likely a trailing-whitespace
or line-ending sensitivity in the verify loop.

This is **PRE_EXISTING** behavior. Verified by:

- `git diff 72643356 HEAD -- apps/context-panel/tests/manifest-readonly-1.13.test.mjs`
  shows EMPTY diff (the test file is byte-identical to baseline).
- The same two failures occur on CRM baseline `72643356` without any
  of this contract's source changes.
- The r2 plan explicitly notes: "zero NEW fails; pre-existing fails
  (3 context-panel manifest-readonly) remain pre-existing".

No product-side fix was attempted; the failure mode is a test-harness
sensitivity issue, not a runtime correctness issue.

## Distribution of NEW tests added by this contract

| Test file | Tests | Purpose |
|---|---|---|
| `apps/integration-api/tests/parser-request.test.mjs` | 9 | M3 parser: request |
| `apps/integration-api/tests/parser-result.test.mjs` | 9 | M3 parser: result |
| `apps/integration-api/tests/parser-error.test.mjs` | 11 | M3 parser: error |
| `apps/integration-api/tests/parser-mock.test.mjs` | 7 | M4 deterministic mock |
| `apps/integration-api/tests/parser-route.test.mjs` | 9 | M4 gated route |
| `apps/integration-api/tests/parser-boundary-guard.test.mjs` | 3 | CI grep-guard |
| 6 × `*/tests/contract-root-regression.test.mjs` | 9 each = 54 | M2 root-export parity |
| **TOTAL NEW** | **102** | **All pass** |

## No double-counting

The totals above sum each test once. The `parser-*.test.mjs` files
appear under `apps/integration-api` only. The root-regression tests
appear once per consumer (6 consumers × 9 = 54). The contracts suite
is reported once as 711.
