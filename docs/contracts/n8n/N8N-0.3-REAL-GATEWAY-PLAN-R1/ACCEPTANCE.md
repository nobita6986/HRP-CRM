# Acceptance criteria

## Implementation gate

- `LEGACY_SHA256_INPUT_SECRET` is the only accepted name for the current
  signature bytes; no executable or documentation claim calls it HMAC.
- The signer node and gateway share pinned positive and negative vectors.
- Durable idempotency passes restart and two-instance race tests.
- Registry identity is authoritative for organization, connection, service,
  operation allowlist, expiry and disable state.
- No secret appears in Git diff, test output, logs, response or evidence.
- Gateway fails closed on registry, database or downstream unavailability.
- Existing synthetic conformance remains green.
- All changed text is strict UTF-8 without BOM; manifests match committed
  blobs; `git diff --check` passes.

## Explicitly excluded

- VPS deployment or nginx changes.
- Product workflow modification or activation.
- Real HRP, Chatwoot, Zalo or provider calls.
- CRM canonical business mutation beyond the allowlisted automation adapter.
- Pilot, production enablement and scheduling.
