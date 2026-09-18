#!/usr/bin/env python3
"""Compute SHA-256 hashes for CORE/1.4 manifest."""
import hashlib
import os

REPO = r"D:\CodeApp\Hrp-Crm"

files = [
    # Schema + migration delta
    "packages/integration-store/prisma/schema.prisma",
    "packages/integration-store/prisma/migrations/0002_worker_lease_fencing/migration.sql",
    "packages/integration-store/prisma/migrations/0002_worker_lease_fencing/rollback.sql",
    # Store worker modules (CORE/1.4 new)
    "packages/integration-store/src/worker/clock.ts",
    "packages/integration-store/src/worker/retry.ts",
    "packages/integration-store/src/worker/lease.ts",
    "packages/integration-store/src/worker/index.ts",
    # Store package surface
    "packages/integration-store/src/index.ts",
    "packages/integration-store/src/client.ts",
    "packages/integration-store/package.json",
    "packages/integration-store/tsconfig.json",
    "packages/integration-store/.env.synthetic.example",
    # Test harness + new lease tests
    "packages/integration-store/tests/integration/pg-test-harness.mjs",
    "packages/integration-store/tests/integration/lease.int.test.mjs",
    # Worker app (CORE/1.4 new + modified)
    "apps/integration-worker/src/durable-worker.ts",
    "apps/integration-worker/src/executor.ts",
    "apps/integration-worker/src/server.ts",
    "apps/integration-worker/package.json",
    "apps/integration-worker/tsconfig.json",
    "apps/integration-worker/tests/server.test.mjs",
    "apps/integration-worker/.env.synthetic.example",
    # Config package (used by worker)
    "packages/config/src/types.ts",
    "packages/config/src/loader.ts",
    "packages/config/src/index.ts",
    "packages/config/package.json",
]

results = []
for rel in files:
    full = os.path.join(REPO, rel)
    if not os.path.exists(full):
        print(f"MISSING: {rel}")
        continue
    with open(full, "rb") as fp:
        h = hashlib.sha256(fp.read()).hexdigest()
    results.append((h, rel))

for h, rel in results:
    print(f"{h}  {rel}")

print(f"\n# Total: {len(results)} files")
