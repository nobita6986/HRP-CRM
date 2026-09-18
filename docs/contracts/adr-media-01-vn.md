# ADR-MEDIA-01-VN — Media / Secret / Storage policy (synthetic slice)

**Status:** PROPOSED (CORE/1.10 mock) — Owner/HRP-owned PR required before any
production deployment.
**Date:** 2026-09-17
**Scope:** Media intake, secret access, object storage, URL policy, evidence
lifecycle for CORE/1.10 mock + V7.9c follow-ups.

---

## 1. Context

Per Master-Plan.V2.6.md §11 + §7.1, hrp-connector.md v1.1, and decision
register §G0-10, the integration of real CCCD, antivirus, VN storage, and
secret access has the following unresolved dependencies:

- **VN residency** — actual region, retention window, deletion policy not
  confirmed.
- **Real antivirus** — engine selection (ClamAV, Kaspersky, Windows
  Defender, etc.) + integration mode (in-process vs cloud) not chosen.
- **Real storage** — bucket region, encryption-at-rest provider, signed URL
  TTL production policy not confirmed.
- **Secret store** — Vault / AWS Secrets Manager / native choice not made.
- **Cleanup / retention** — explicit policy for QUARANTINED retention,
  REJECTED audit retention, READY → REVOKED transition rules not set.

CORE/1.10 is the **synthetic slice** that produces:
- In-memory evidence store with lifecycle (READY/QUARANTINED/REJECTED/REVOKED).
- Fake secret provider returning only opaque handles.
- URL/SSRF policy harness (string-based, no real network calls).
- Cross-org + public-evidence policy gates.

**Mock pass does NOT prove antivirus/storage VN production-ready.**

---

## 2. Decision

CORE/1.10 ships a **fixture-only** implementation labeled
`FIXTURE_POLICY_Core_1_10_MOCK_VN` so production code can grep for it
and replace it with HRP-owned runtime policy before any deployment that
receives real CCCD.

| Component | Mock (CORE/1.10) | Production target |
|---|---|---|
| Evidence scan | `defaultScanFixture(bytes)` (deterministic pass/fail on size + custom override) | Real antivirus integration (engine TBD), fail-closed |
| Evidence storage | `InMemoryEvidenceStore` (process-local, lost on restart) | VN-resident encrypted object store (region TBD), KMS-managed keys |
| Signed URL TTL | 60 sec bound (Gate 0.3h contracts) | 60 sec or less (final TTL TBD by HRP gate) |
| Secret provider | `FakeSecretProvider` returning `SecretPortHandle` only | HRP-owned secret adapter (Vault/AWS/etc., TBD) |
| URL SSRF policy | String-based: scheme=`https:`, deny RFC1918 + loopback + link-local + cloud metadata + `.local`/`.internal` | String policy + DNS pre-resolution + redirect-chain check + size/MIME limit |
| Cross-org gate | In-process evidence store rejects mismatched `organizationId` | Same gate at HRP runtime + DB row-level scope |
| Cleanup | None (in-memory, no TTL) | TTL by evidence state per §6 (UNKNOWN) |
| Logging redaction | `redactPayload` + `assertNoSecretLeak` (synthetic only) | Same logic in production logger + PII scrubber per Master §11 |

---

## 3. Scope (CORE/1.10 mock)

1. **Synthetic evidence lifecycle states** —
   `QUARANTINED → READY` (scan pass) or `QUARANTINED → REJECTED` (scan fail)
   or `READY → REVOKED` (operator/revoke) or `REJECTED → REVOKED` (retention).
   Only READY evidence is consumable; QUARANTINED / REJECTED / REVOKED are
   explicitly blocked.

2. **Fake secret provider** — `accessSecret(req)` returns ONLY
   `SecretPortHandle` (opaque ID + TTL). The raw `secretValue` is never
   returned, never logged, never sent to the browser. A `redactPayload`
   helper replaces forbidden field keys (per contracts
   `SECRET_PORT_FORBIDDEN_FIELDS`) with `[REDACTED]` and scrubs registered
   synthetic secret values from any string content.

3. **SSRF policy harness** — `evaluateUrl(url)` rejects:
   - non-`https:` scheme (`http:`, `file:`, `gopher:`, …)
   - loopback (127.0.0.0/8, ::1)
   - private (RFC1918: 10/8, 172.16/12, 192.168/16)
   - link-local / cloud metadata (169.254/16, fe80::/10)
   - ULA (fc00::/7)
   - hostnames: `localhost`, `.local`, `.internal`
   - explicit deny list (configurable)

   No DNS lookup, no HEAD request, no fetch — purely string-based.

4. **Cross-org + public-evidence policy** —
   - Cross-org access: `evidenceStore.requireOrgScope(eId, orgId)` throws
     `CROSS_ORG` if `eId.organizationId !== orgId`.
   - READY gate: `evidenceStore.requireReady(eId, orgId)` throws
     `EVIDENCE_NOT_READY` if state is not READY.
   - Read TTL gate: `ObjectStorageReadRequestSchema.ttlSec ≤ 60` per
     contracts Gate 0.3h; > 60 sec rejected for CCCD.

---

## 4. NOT in scope (deliberately)

- Real antivirus engine integration (ClamAV, Kaspersky, Defender, etc.)
- Real object storage (S3, VPS S3, GCS, Azure Blob)
- Real secret store (Vault, AWS Secrets Manager, native HRP store)
- DNS pre-resolution for SSRF (this fixture uses string parsing only)
- Redirect-chain SSRF protection (out of scope; V7.9c follow-up)
- Network egress firewall (production infra concern)
- Encryption at rest (KMS integration)
- DSR (data subject request) deletion flow — production policy UNKNOWN
- Real PII handling — no real CCCD in this slice; bytes are random

---

## 5. Residencies / Dependencies (production dependencies)

These MUST be answered by HRP-owned PRs before production:

| Dependency | Owner | UNKNOWN impact |
|---|---|---|
| VN bucket region (HN/SG/DN/etc.) | infra / Owner | residency fail → policy violation |
| Encryption-at-rest KMS key rotation cadence | infra / Owner | rotation gap → audit risk |
| Antivirus engine + signature update cadence | infra / Owner | stale signatures → scan gap |
| Secret store backend + IAM least-privilege | infra / Owner | broad IAM → privilege escalation |
| Egress firewall rules (which hosts allowed for media download) | infra / Owner | overly broad → SSRF risk |
| DNS resolver pinning (no /etc/resolv.conf override) | infra / Owner | DNS rebinding risk |
| DSR deletion policy (what fields, what proof) | Owner / Legal | non-compliance |
| Retention window per state (QUARANTINED / REJECTED / READY) | Owner / Legal | over-retention → privacy risk |
| Cleanup on REVOKED (purge bytes vs keep audit trail) | Owner / Legal | ambiguity |

If any of the above remain UNKNOWN, CORE/1.10 mock MUST NOT be promoted
to production.

---

## 6. TTL / Cleanup behavior (explicit UNKNOWN)

Per Master §11 + decision register G0-10, the following behaviors are
**UNKNOWN** and require Owner/HRP-owned PR:

| Question | Status | Mock default |
|---|---|---|
| How long is QUARANTINED evidence kept before auto-purge? | UNKNOWN | none (in-memory) |
| How long is REJECTED evidence kept for audit? | UNKNOWN | none (in-memory) |
| How long is READY evidence kept (retention window)? | UNKNOWN | none (in-memory) |
| On REVOKED, are bytes purged immediately or kept with audit-only? | UNKNOWN | mock keeps `stateReason` only |
| On DSR (data subject request), which fields are scrubbed? | UNKNOWN | n/a |
| Cross-org evidence in audit logs: keep with redacted owner? | UNKNOWN | n/a |

The CORE/1.10 mock does NOT make business policy decisions for any of
the above. It provides the **mechanism** (`evidenceStore.revoke(id,
reason)`) but the **policy** (when, why, by whom) is owned by Owner.

---

## 7. UNKNOWN behaviors (production follow-ups)

Per G0-10 + Master §11.3, the following are UNKNOWN and need explicit
decisions:

| UNKNOWN | Production question |
|---|---|
| Antivirus engine | ClamAV / Kaspersky / Defender / other; in-process vs cloud; signature cadence |
| Bucket region | HN-1 / SG-1 / DN-1 / other; cross-region replication allowed? |
| KMS key rotation | 90-day / 180-day / annual; audit trail for rotations |
| Secret backend | Vault / AWS / native HRP store; IAM scope |
| Egress firewall | Allow-list for media hostnames; block all RFC1918 + metadata |
| DNS resolver | Pin to internal resolver; prevent /etc/hosts override |
| DSR deletion | Fields to scrub; proof-of-deletion artifact |
| Retention window | Per-state retention (QUARANTINED/REJECTED/READY); auto-purge job |
| Cross-org audit | Redact owner / keep with proof; audit scope |
| Lifecycle automation | Manual revoke only? Auto-revoke on retention expiry? Cron? |
| Storage class | Hot / cold / archive for READY evidence; cost vs SLA |
| Signed URL format | Pre-signed S3 / pre-signed CDN / custom HMAC; max TTL 60 sec for CCCD |
| Browser preview | Thumbnail generation policy; preview storage; signed URL for preview |
| OCR pipeline | If needed: in-VN OCR only; no cloud OCR for CCCD |
| Quarantine UI | Hidden from UI? Visible to operator only? No UI at all? |

The mock implementation does NOT decide any of these.

---

## 8. Self-check (mock pass criteria)

The CORE/1.10 mock satisfies the following self-check:

- [x] Evidence in REJECTED / QUARANTINED / REVOKED state CANNOT be used
      as READY (lifecycle gate enforced in `evidenceStore.requireReady`).
- [x] Cross-org evidence access blocked (`CROSS_ORG` thrown).
- [x] Foreign-org read attempts blocked at harness level.
- [x] `secretValue` NEVER appears in `SecretPortHandle` JSON.
- [x] `secretValue` NEVER appears in `redactPayload` output for keys in
      `SECRET_PORT_FORBIDDEN_FIELDS`.
- [x] `secretValue` NEVER appears in browser payload (`toBrowserSafePayload`).
- [x] Forbidden keys in payload are replaced with `[REDACTED]`.
- [x] `assertNoSecretLeak` throws if a registered value appears in a string.
- [x] SSRF URL policy rejects `https://127.0.0.1`,
      `https://169.254.169.254`, `https://[::1]`, non-`https:` schemes,
      `.local`/`.internal` hostnames.
- [x] Read TTL > 60 sec rejected for CCCD (per contracts Gate 0.3h).
- [x] No real network calls (string-based SSRF only).
- [x] No real antivirus call (deterministic fixture scan).
- [x] No real storage (in-memory only).
- [x] No real secrets (fake provider returns handles only).
- [x] No real PII (random bytes + non-PII note).

---

## 9. Production migration checklist

Before promoting any CORE/1.10 mock path to production:

1. Replace `defaultScanFixture` with real antivirus integration (fail-closed).
2. Replace `InMemoryEvidenceStore` with VN-resident encrypted object store.
3. Replace `FakeSecretProvider` with HRP-owned secret adapter.
4. Add DNS pre-resolution + redirect-chain checks to `evaluateUrl`.
5. Add egress firewall rules per §5.
6. Add KMS key rotation cadence.
7. Add DSR deletion flow (UNKNOWN §7) + audit log proof.
8. Add retention auto-purge job per state.
9. Replace mock-pass self-check with real engine integration tests on
   isolated test corpus (no real CCCD).
10. Owner sign-off + HRP-owned PR review per Master §11.

---

## 10. References

- Master-Plan.V2.6.md §7.1, §11, §11.2, §11.3, §10.6
- hrp-connector.md v1.1 §3, §7
- decision-register.md G0-10, Q-19..Q-23, Q-32, Q-37, Q-39
- Backlog Gate0-V7.9a.md §Task 1.10
- contracts `commands/ports.ts` (Gate 0.3h) — `SecretPortHandleSchema`,
  `ObjectStorageHandleSchema`, `ObjectStorageReadRequestSchema`,
  `SECRET_PORT_FORBIDDEN_FIELDS`
- contracts `commands/evidence.ts` (Gate 0.3a) — `CommandEvidenceRefSchema`,
  `EVIDENCE_FORBIDDEN_CLIENT_FLAGS`
