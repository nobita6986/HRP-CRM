# LIMITATIONS

## NOT_EXECUTED

The following items are NOT_EXECUTED by this contract (per the r2 plan
M6 deferral and N8N boundary clauses):

- HRP HTTP runtime.
- JWT signer/verifier runtime.
- Key provisioning for HRP signing.
- Replay/delegation store.
- Audit DB store.
- Migration adding any new DB tables.
- Callable production stub for the talent-context-read boundary.
- Feature flag implying a real HRP path exists.
- M6 production source files.
- N8N server inspection, dependency injection, or workflow creation.
- N8N redesign of CONTRACT-03C.2.

M6 remains DEFERRED_SEPARATE_TASK and awaits HRP runtime
specification, H.09 / Tier 3 sign-off, and the owner runtime gate
(G-03C.6, not yet defined).

## PRE_EXISTING

Two unit-test failures in `apps/context-panel/tests/manifest-readonly-1.13.test.mjs`
and `manifest-readonly-1.14.test.mjs` are PRE_EXISTING. The `--verify`
step reports `hash mismatch` despite the printed `manifest=` and
`actual=` hex strings being byte-identical — this is a
test-harness/manifest-script sensitivity issue. The r2 plan explicitly
preserves these as pre-existing.

The contract did NOT modify these tests or the manifest scripts. Both
files are byte-identical to CRM baseline `72643356`.

## Drift detection

The 379-baseline fixtures and the subpath-only fixtures are pinned at
this contract's commit. A future accepted additive that changes the
root export set will cause the `contract-root-regression.test.mjs`
tests in every consumer to fail with an exact-set mismatch; the
fixtures would then need to be re-derived from the new bilaterally
accepted baseline. This is an explicit design constraint, not a
limitation.

## Windows path encoding hygiene

Several newly-written `.ts` and `.md` files were initially emitted by
the Write tool as UTF-16LE. A reusable `fix-utf16.cjs` script (extended
in this contract to also process `.md` and `.txt` files) was used to
convert them back to UTF-8 no BOM, LF, as required by the r2 plan
encoding rules. The script is part of the T1-B toolbox, not part of
the committed evidence bundle.

## No NPM publish / No tag / No main merge / No deploy

- No npm publish was performed.
- No Git tag was created.
- No merge into main / master.
- No force-push.
- No deploy.
- No HRP runtime opening.
- No N8N work performed.
