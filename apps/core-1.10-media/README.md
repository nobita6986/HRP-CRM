# @hrp-engagement/core-1.10-media

CORE/1.10 — Media/secret/storage ports mock + policy harness.

## Scope

Synthetic-only mock. No real CCCD intake. No antivirus integration. No real
VN production storage. Mock pass is **NOT** proof that antivirus/storage VN
is production-ready.

What this task delivers:

1. **Synthetic evidence lifecycle** — `READY` / `QUARANTINED` / `REJECTED` /
   `REVOKED` transitions with policy fixture that proves quarantined,
   rejected, or revoked evidence is never used as READY.
2. **Fake secret provider** — returns opaque `SecretPortHandle` only;
   `secretValue` is **never** returned to callers, **never** logged,
   **never** sent to the browser. A redaction test proves no secret value
   leaks into logs or payloads.
3. **Policy harness** — three fixtures (no real network calls):
   - SSRF: scheme/host allowlist rejects `http://127.0.0.1`,
     `http://169.254.169.254`, `file:///`, etc.
   - Public evidence: signed URL TTL ≤ 60 sec (CCCD); signed URL not
     exposed in evidenceRefs JSON; `quarantined: true` evidence cannot be
     read.
   - Foreign organization: cross-org evidence access blocked; foreign-org
     signed URL request returns `CROSS_ORG`.
4. **ADR-MEDIA-01-VN** — documented in
   `docs/contracts/adr-media-01-vn.md`. Covers residency dependencies,
   TTL/cleanup behavior, and explicit UNKNOWN behaviors that need
   HRP-owned PRs (no fake defaults).

## Run

```bash
cd apps/core-1.10-media
npm install
npm run build      # tsc
npm test           # unit + policy harness
npm run policy-test
```

## Boundaries

- **No real antivirus** — the "scan" step is a deterministic policy
  fixture (pass/fail based on bytes hash + size). ClamAV, Kaspersky,
  Windows Defender, etc. are NOT invoked.
- **No real storage** — `InMemoryEvidenceStore` keeps evidence in
  process memory. Lost on restart. No S3, no VN bucket, no CDN.
- **No real network** — `UrlPolicy` rejects URLs via string parsing +
  host allowlist only. No DNS lookup, no HEAD request, no fetch.
- **No real secrets** — `FakeSecretProvider` only stores the secret
  value internally for verification (it never returns or logs the
  value). Callers always get `SecretPortHandle` only.
- **No real PII** — evidence bytes are random Uint8Array (not CCCD,
  not chat). The `note` is bounded to ≤ 500 chars and not PII.
- **No policy chốt** — retention, residency, deletion business policy
  is **UNKNOWN** (per ADR §6). Fixture policy is labeled
  `FIXTURE_POLICY_Core_1_10_MOCK_VN` so production must replace it
  with HRP-owned PRs.

## Files

- `src/evidence-store.ts` — lifecycle + states
- `src/secret-provider.ts` — fake provider
- `src/url-policy.ts` — SSRF allowlist
- `src/policy-harness.ts` — combined policy enforcement
- `src/index.ts` — public surface
- `tests/evidence-store.test.mjs`
- `tests/secret-provider.test.mjs`
- `tests/url-policy.test.mjs`
- `tests/policy-harness.test.mjs`
- `scripts/generate-manifest.mjs` — split generate/verify/check (read-only verify)
- `docs/contracts/adr-media-01-vn.md`
- `docs/contracts/handoff-core-1.10.md`

## Frozen contracts

No changes to `packages/contracts/src/**`. Schemas referenced:
`SecretPortHandleSchema`, `ObjectStorageHandleSchema`, `EVIDENCE_KINDS`
from `commands/ports.ts` and `commands/evidence.ts` (Gate 0.3a/h).
