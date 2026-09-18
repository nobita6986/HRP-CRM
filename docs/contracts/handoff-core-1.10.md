# CORE/1.10 — Media/Secret/Storage ports mock + policy harness

**Status:** READY FOR AUDIT (mock-only slice, no production claim)
**Frozen Contracts:** 0.0.8-g0.8-fixes (no changes; references Gate 0.3a/h)
**Gate 0:** FREEZE (this slice does not unfreeze)
**Date:** 2026-09-17
**Scope:** Backlog §Task 1.10 — Media/secret/storage ports và policy harness
**Dependency:** 0.3a/h (evidence.ts, ports.ts), 1.0 (config + scaffold)

---

## 1. AC Coverage

### AC1: Synthetic evidence READY/QUARANTINED/REJECTED/REVOKED scenarios; chưa nhận CCCD thật

**Implementation:** `apps/core-1.10-media/src/evidence-store.ts`

- Lifecycle states: `QUARANTINED`, `READY`, `REJECTED`, `REVOKED`
  (`EVIDENCE_LIFECYCLE_STATES`).
- New evidence upload transitions `QUARANTINED → READY` or
  `QUARANTINED → REJECTED` based on fixture scan (`defaultScanFixture`).
- READY → REVOKED via `evidenceStore.revoke(evidenceId, reason)`.
- Only READY evidence is consumable; `evidenceStore.requireReady()` throws
  `EVIDENCE_NOT_READY` for any other state.
- No real CCCD bytes; input is random `Uint8Array` or empty (for the
  REJECTED-empty test fixture). No real PII.

**Evidence:** `tests/evidence-store.test.mjs` — 12/12 ✔

### AC2: Fake secret provider dùng secret references; không đưa key vào browser; logs redacted

**Implementation:** `apps/core-1.10-media/src/secret-provider.ts`

- `accessSecret(req)` returns ONLY `SecretPortHandle` (opaque ID + TTL).
  The raw `secretValue` is never returned to the caller.
- `toBrowserSafePayload(handle)` produces a JSON-serializable object that
  contains the opaque handle and TTL — never the secret value.
- `redactPayload(payload)` recursively replaces any field whose key is in
  `SECRET_PORT_FORBIDDEN_FIELDS` (from contracts Gate 0.3h:
  `secretValue`, `rawSecret`, `plaintextSecret`, `passwordRaw`,
  `apiKeyRaw`, `tokenRaw`) with `[REDACTED]`. Also scrubs registered
  synthetic secret values from any string content (defense-in-depth).
- `assertNoSecretLeak(jsonString)` throws if any registered secret value
  appears in the string — proves logs/payloads do not leak.

**Evidence:** `tests/secret-provider.test.mjs` — 8/8 ✔

### AC3: Policy harness kiểm tra URL SSRF, public evidence, evidence thuộc organization khác. Dùng mocks/fixtures, không gọi mạng thật

**Implementation:** `apps/core-1.10-media/src/url-policy.ts` + `policy-harness.ts`

- URL SSRF: `evaluateUrl(url)` rejects non-`https:` scheme, loopback
  (127.0.0.0/8, ::1), private RFC1918 (10/8, 172.16/12, 192.168/16),
  link-local / cloud metadata (169.254/16, fe80::/10), ULA (fc00::/7),
  hostnames `localhost`/`.local`/`.internal`, explicit deny list.
  No DNS lookup, no HEAD request, no fetch.
- Public evidence: signed URL TTL ≤ 60 sec for CCCD (per contracts
  `ObjectStorageReadRequestSchema.ttlSec ≤ 60`); non-READY evidence
  cannot be read.
- Foreign org: `harness()` rejects `CROSS_ORG` if `evidenceId.organizationId`
  ≠ `input.organizationId`; rejects `EVIDENCE_NOT_FOUND` for missing IDs.
- Harness fires rules in order: SSRF → read TTL → cross-org/READY gate.

**Evidence:** `tests/url-policy.test.mjs` — 14/14 ✔ + `tests/policy-harness.test.mjs` — 14/14 ✔

### AC4: Bàn giao rõ ADR-MEDIA-01-VN, dependencies về nơi lưu dữ liệu, TTL/cleanup, UNKNOWN behavior cho V7.9c

**Implementation:** `docs/contracts/adr-media-01-vn.md`

- ADR §1–§10 covers: context, decision matrix (mock vs production),
  scope, NOT-in-scope, residency dependencies, TTL/cleanup UNKNOWN,
  UNKNOWN behaviors for V7.9c, self-check criteria, production
  migration checklist.
- The ADR explicitly enumerates UNKNOWN behaviors (e.g. antivirus engine,
  bucket region, KMS rotation, DSR deletion, retention window) and
  states that the mock does NOT decide business policy — only the
  mechanism.

**Evidence:** ADR doc + this handoff.

---

## 2. Architecture

### Reuse of contracts (no duplication)

This slice does NOT add new schemas. It consumes:

- `SecretPortHandleSchema`, `SecretPortGetRequestSchema`,
  `SECRET_PORT_FORBIDDEN_FIELDS` (from `commands/ports.ts` Gate 0.3h).
- `ObjectStorageHandleSchema`, `ObjectStorageReadRequestSchema`
  (from `commands/ports.ts` Gate 0.3h; `ttlSec ≤ 60` enforced).
- `OrganizationIdSchema`, `SchemaVersionSchema` (primitives).
- `EvidenceKind` from `enums.ts` (Gate 0).

### Files added

```
apps/core-1.10-media/
  package.json                                 # 1.0.0-core1.10
  tsconfig.json
  README.md
  src/
    evidence-store.ts                          # lifecycle + scan fixture
    secret-provider.ts                         # fake provider + redaction
    url-policy.ts                              # SSRF allowlist
    policy-harness.ts                          # combined enforcement
    index.ts                                   # public surface + fixture labels
  tests/
    evidence-store.test.mjs
    secret-provider.test.mjs
    url-policy.test.mjs
    policy-harness.test.mjs
  scripts/
    generate-manifest.mjs                      # split generate/verify/check (READ-ONLY verify)

docs/contracts/
  adr-media-01-vn.md                           # ADR-MEDIA-01-VN
  handoff-core-1.10.md                         # this file
  handoff-core-1.10.manifest.txt               # SHA-256 manifest (generated)
```

### Dependencies (existing packages)

- `@hrp-engagement/contracts` (file: `../../packages/contracts`) — schemas
- `zod` — schema validation in evidence-store + policy-harness

### Frozen contracts unchanged

`packages/contracts/src/**` is untouched. All schemas referenced are
existing (Gate 0.3a + Gate 0.3h).

---

## 3. Lifecycle / Policy semantics

### Evidence lifecycle (synthetic only)

```
                    ┌─────────────┐
                    │ QUARANTINED │ (initial, before scan)
                    └──────┬──────┘
                           │ fixture scan
              ┌────────────┴────────────┐
              ▼                         ▼
        ┌────────┐               ┌──────────┐
        │ READY  │               │ REJECTED │
        └───┬────┘               └─────┬────┘
            │ revoke(id, reason)       │ retention/cleanup (UNKNOWN)
            ▼                          ▼
        ┌──────────────────────────────┐
        │           REVOKED            │ (audit-trail state; bytes
        └──────────────────────────────┘  policy UNKNOWN)
```

- **QUARANTINED** is the initial synthetic state. The fixture scan runs
  synchronously in `upload()` and finalizes to READY or REJECTED. In
  production, this is a separate async scan step.
- **READY** evidence can be consumed via `requireOrgScope()` + `requireReady()`.
- **REJECTED** evidence cannot be consumed (throws `EVIDENCE_NOT_READY`).
- **REVOKED** evidence cannot be consumed (throws `EVIDENCE_NOT_READY`).
  Audit trail (`stateReason`) is kept per UNKNOWN retention policy.

### URL SSRF policy (string-based, no network)

```typescript
// Examples:
evaluateUrl('https://example.com/')             // allow (public https)
evaluateUrl('http://example.com/')              // deny (BAD_SCHEME)
evaluateUrl('https://127.0.0.1/')               // deny (PRIVATE_HOST)
evaluateUrl('https://169.254.169.254/')         // deny (PRIVATE_HOST — cloud metadata)
evaluateUrl('https://10.0.0.1/')                // deny (PRIVATE_HOST — RFC1918)
evaluateUrl('https://[::1]/')                   // deny (PRIVATE_HOST — IPv6 loopback)
evaluateUrl('https://service.local/')           // deny (PRIVATE_HOST — .local)
evaluateUrl('file:///etc/passwd')               // deny (BAD_SCHEME)
```

### Secret provider contract (per Gate 0.3h)

```typescript
accessSecret({
  schemaVersion: '1',
  organizationId: 'org-001',
  capability: 'webhook.signature',
  accessorTier: 'INTEGRATION_BOUND', // 'PRIVILEGED_HRP_GATE' | 'INTEGRATION_BOUND' | 'REVIEWER_BOUND'
}) → {
  schemaVersion: '1',
  secretHandle: 'opaque-<uuid>', // never the secret value
  expiresInSec: 600,
}
```

### Re-redaction (synthetic + production-shape)

```typescript
redactPayload({
  apiKeyRaw: 'plain-text',
  secretValue: 'plain-text',
  nested: { secretValue: 'plain-text', ok: 'kept' },
  msg: `error connecting with token super-secret-DO-NOT-LEAK-XYZ-42`,
}) → {
  apiKeyRaw: '[REDACTED]',
  secretValue: '[REDACTED]',
  nested: { secretValue: '[REDACTED]', ok: 'kept' },
  msg: 'error connecting with token [REDACTED]',
}
```

---

## 4. Self-check

| Self-check item | Status | Evidence |
|---|:---:|---|
| Evidence REJECTED/QUARANTINED/REVOKED cannot be used as READY | ✔ | `tests/evidence-store.test.mjs` (3 tests: REJECTED, QUARANTINED synthetic, REVOKED) |
| Cross-org/unauthorized access blocked, no sensitive metadata leak | ✔ | `tests/policy-harness.test.mjs` cross-org test + secret-provider tests |
| Secret NOT in browser payload/log/error | ✔ | `tests/secret-provider.test.mjs` (8 tests: handle JSON, toBrowserSafePayload, forbid-key redaction, value inclusion scrub, leak assertion, schema rejection) |
| TTL/cleanup/UNKNOWN has evidence per policy fixture | ✔ | ADR §6 + §7 enumerate UNKNOWN; mock provides mechanism only |
| Build/typecheck pass | ✔ | `tsc --noEmit` clean |
| Regression tests pass | ✔ | 48/48 unit tests pass; no regression on contracts (Gate 0 untouched) |

---

## 5. Tests (current snapshot)

| Suite | Count | Status |
|---|---:|:---:|
| `tests/evidence-store.test.mjs` | 12 | 12/12 ✔ |
| `tests/secret-provider.test.mjs` | 8 | 8/8 ✔ |
| `tests/url-policy.test.mjs` | 14 | 14/14 ✔ |
| `tests/policy-harness.test.mjs` | 14 | 14/14 ✔ |
| **Total** | **48** | **48/48 ✔** |

**Run:** `cd apps/core-1.10-media && npm test`

---

## 6. Manifest

Manifest at `docs/contracts/handoff-core-1.10.manifest.txt` covers 16 files
(source + tests + scripts + config + docs). Generated by
`apps/core-1.10-media/scripts/generate-manifest.mjs`.

### Verification commands

```bash
cd apps/core-1.10-media

# Generate (deliberate; only after code+evidence stable)
node scripts/generate-manifest.mjs

# Read-only verify
node scripts/generate-manifest.mjs --verify

# Read-only coverage check
node scripts/generate-manifest.mjs --check
```

### Removed (none)

This slice adds new files only. No files removed.

---

## 7. Limitations / Decisions

### What this slice does NOT claim

- Not production-ready antivirus. The "scan" is a deterministic policy
  fixture (size + custom override). ClamAV/Kaspersky/Defender are NOT
  invoked.
- Not production-ready VN storage. In-memory only; lost on restart.
  No S3, no VPS S3, no CDN, no bucket region.
- Not production-ready secret store. `FakeSecretProvider` returns
  handles only; raw secret value is in-process for tests only.
- Not production-ready URL policy. String-based only; no DNS pre-resolution,
  no redirect-chain check, no size/MIME limit.
- Not production-ready retention/cleanup. UNKNOWN per ADR §6; mock
  provides mechanism only.
- Not production-ready residency. `vnResidency: true` is a marker, not
  a real region constraint.

### Mock pass does NOT prove antivirus/storage VN production-ready

Per Backlog AC#3 explicit text. See ADR §1 + §10.

### Unknown behaviors (for V7.9c follow-ups)

Per ADR §7 — all 14 items are Owner/HRP-owned PR territory.

---

## 8. Risk classification (per Execution Guide §5.3)

| Nhóm | Status | Ghi chú |
|---|---|---|
| Shared contract | NONE | Frozen contracts untouched |
| HRP core/domain writes | NONE | No DB, no real backend |
| Auth/permissions/PII | LOW | Synthetic only; no real CCCD |
| Data reliability | NONE | In-memory, lost on restart |
| AI có quyền/dữ liệu | NONE | Mock |
| UI trình bày | NONE | No UI in this slice |
| Mock/read-only prototype | YES | CORE/1.10 belongs to this group |
| Docs/copy/refactor | LOW | ADR + handoff + README |

---

## 9. Verdict

**T1 Self-Verdict:** READY FOR AUDIT (mock-only slice). Verdict held at
READY FOR AUDIT, NOT self-certifying PASS. Independent Auditor review
required to elevate to PASS.

**Constraints honored:**

- No commit / push / merge / deploy (working tree untracked).
- No CORE/1.11+ scope expansion.
- No real PII, no real CCCD, no real HRP core, no real storage, no real
  antivirus, no real secrets, no real network calls.
- Frozen contracts unchanged (Gate 0.3a/h schemas referenced).
- No Docker / deploy.
- Self-check items: ✔ (per §4 above).

---

**POST-FIX — READY FOR AUDIT**
