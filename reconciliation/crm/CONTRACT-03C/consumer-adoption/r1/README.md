# CONTRACT-03C.2 — CRM Consumer Adoption Evidence Bundle (r1)

Status: READY_FOR_T0_CRM_CONSUMER_ADOPTION_REVIEW

This bundle records the evidence required to certify that the CRM
consumer repository (`nobita6986/HRP-CRM`) has adopted the bilaterally
accepted `@hrp-engagement/contracts@0.0.0-r2-candidate.0` artifact
without breaking root compatibility, without producing candidate-induced
regressions, and without opening any HRP runtime surface.

The CRM implementation is on branch `codex/contract03c2-consumer-adoption-r1`
pinned to CRM baseline `72643356a0d1355f9dccc3921b47c990ea9c31c1`.

The neutral evidence/plan source-of-truth is on branch
`codex/contract03c2-consumer-adoption-r1` (separate repo,
`nobita6986/hrp-integration-contracts`) with authoritative references
to:

- CONTRACT-03C.1 (artifact pinning): `df73b2098a5058f31186981209f4eacd5edac9d8`
- CONTRACT-03C.2 r2 migration plan: `89e73c3b2b29fdcbc18eee76ca29c256629eea50`
- Bilateral packaging/compatibility acceptance: `1841c9354f361c4ac2bdb70a325c739c264262de`
- CRM baseline: `72643356a0d1355f9dccc3921b47c990ea9c31c1`

## Distribution strategy

LOCAL_IMMUTABLE_ARTIFACT_RECONSTRUCTION (per T0 CRM CONSUMER ADOPTION
acceptance). Specifically:

- No npm publish.
- No Git tag release.
- No `.tgz` committed to the repo.
- The artifact is reconstructed from the bilaterally accepted source
  pinned at `1841c9354f361c4ac2bdb70a325c739c264262de`, verified by
  SHA-256, and only THEN used to install / build / test.
- See `ARTIFACT-VERIFICATION.md` for the per-byte verification record.

## Bundle index

- `AUTHORITY-AND-LINEAGE.md` — full authority / lineage pin table.
- `ARTIFACT-VERIFICATION.md` — artifact reconstruction + verification
  evidence.
- `DEPENDENCY-PINNING.md` — repository-relative dependency pinning.
- `ROOT-COMPATIBILITY.md` — 379/379 root export parity + versions.
- `PARSER-EVIDENCE.md` — M3 parser tests.
- `PORT-MOCK-ROUTE-EVIDENCE.md` — M4 port + mock + route tests.
- `CONSUMER-BUILD-MATRIX.md` — six-consumer build matrix.
- `TEST-EVIDENCE.md` — full per-consumer test counts.
- `BROWSER-EVIDENCE.md` — Playwright browser run results.
- `LIMITATIONS.md` — NOT_EXECUTED + pre-existing items.
- `ROLLBACK.md` — package/consumer rollback procedure.
- `manifest.sha256` — SHA-256 of every committed byte in this bundle.

## Handoff status

READY_FOR_T0_CRM_CONSUMER_ADOPTION_REVIEW.

All M1..M5 slices are PASSING (with documented PRE_EXISTING
context-panel manifest-readonly test anomalies that are unchanged from
baseline). M6 is DEFERRED_SEPARATE_TASK and remains untouched.
