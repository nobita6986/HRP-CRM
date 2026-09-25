# ROLLBACK

This is a **package/consumer rollback**. There is no HRP runtime to
rollback (none was opened). The rollback restores the CRM source tree
to its pinned baseline state and removes the M3 / M4 boundary.

## Steps

### 1. Identify the implementation commit on the implementation branch

```
git rev-parse HEAD   # capture the implementation SHA on codex/contract03c2-consumer-adoption-r1
```

### 2. Revert M1 (workspace replacement)

`packages/contracts/` was augmented with the additive
`talent-context-read/` source. To revert M1:

```
git checkout <baseline-sha> -- packages/contracts/src/talent-context-read/ packages/contracts/tests/talent-context-read/ packages/contracts/tests/fixtures/baseline-379.fixtures.json packages/contracts/tests/fixtures/talent-context-subpath.fixtures.json packages/contracts/package.json packages/contracts/tsconfig.json packages/contracts/package-lock.json
git clean -fdx packages/contracts/src/talent-context-read/ packages/contracts/tests/talent-context-read/
```

Then re-install:

```
npm ci
```

### 3. Revert M2 (root-export regression tests)

```
git checkout <baseline-sha> -- \
  apps/context-panel/tests/contract-root-regression.test.mjs \
  apps/core-1.10-media/tests/contract-root-regression.test.mjs \
  apps/integration-api/tests/contract-root-regression.test.mjs \
  apps/integration-worker/tests/contract-root-regression.test.mjs \
  packages/integration-store/tests/contract-root-regression.test.mjs \
  packages/config/tests/contract-root-regression.test.mjs
```

### 4. Revert M3 + M4 (parser / port / mock / route)

```
git clean -fdx apps/integration-api/src/orchestrator/talent-context-read/
git checkout <baseline-sha> -- apps/integration-api/tests/parser-*.test.mjs
```

The `parser-boundary-guard.test.mjs` is removed by the same
`git clean` because the directory containing it does not exist in
baseline.

### 5. Revert evidence bundle

```
git clean -fdx reconciliation/crm/CONTRACT-03C/consumer-adoption/
```

(The `reconciliation/crm/CONTRACT-03C/` directory does not exist in
baseline, so this removes the entire bundle.)

### 6. Rebuild + retest baseline

```
cd packages/contracts && npm run build && npm test
cd ../config && npm run build && npm test
cd ../integration-store && npm run build && npm run test:unit
cd ../../apps/integration-worker && npm run build && npm test
cd ../integration-api && npm run build && npm test
cd ../context-panel && npm run build && npm test
cd ../core-1.10-media && npm run build && npm test
```

All consumers return to the baseline 379/379 root parity, baseline
test counts, and the two PRE_EXISTING manifest-readonly failures.

### 7. Confirm prohibited items NOT affected

This rollback does NOT:

- Roll back any HRP runtime (none was opened).
- Restore any deleted n8n server / workflow / dependency (none was
  touched).
- Delete any DB row, table, or schema (no migrations were applied).
- Force-push or rewrite history.

### 8. Branch discipline

The branch `codex/contract03c2-consumer-adoption-r1` is preserved
unchanged. The rollback is achieved by checking out the implementation
files to baseline bytes — not by deleting the branch. The branch can
later be force-deleted (only by explicit user request) or retained for
audit.
