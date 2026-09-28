# Synthetic signer verifier deployment

Date: 2026-09-28 (Asia/Bangkok)

## Disposition

- Verifier container: `running`, `healthy`
- Verifier host binding: `127.0.0.1:18081`
- Public health: HTTP 200, mode `SYNTHETIC_SIGNER_RUNTIME_VERIFIER`
- Unsigned dispatch: HTTP 401
- Unknown path under verifier prefix: HTTP 404
- nginx configuration test: PASS before each reload
- CRM n8n: `running`, `healthy`
- HRP n8n: `running`, `healthy`; start timestamp unchanged
- Temporary credential JSON: absent after import
- Verifier environment file: mode 0600, owner root:root

## Credential

- Name: `T0 Synthetic Signer Runtime R1`
- Type: `hrpAutomationLegacySignature`
- ID: `f08ecd1a-2b1c-46cd-8dba-10ab93ddcd6e`
- Import result: `Successfully imported 1 credential`
- Secret storage: encrypted by the live n8n instance after CLI import
- Secret value in repository, command line or evidence: none

The Public API key named `T0 CRM Evidence Reader` returned HTTP 403 for
credential creation, which confirms its read-only boundary. T0 used the n8n
administrative CLI inside the CRM container instead. The plaintext import
file was removed immediately after successful import.

## Boundary

This verifier is a separate synthetic receiver. It validates the exact legacy
signature independently, checks credential-to-envelope identity binding and
provides an in-memory idempotency check. It is not a CRM endpoint and does not
authorize runtime, migration, workflow activation or production use.
