# n8n signer runtime verifier

This narrow synthetic receiver independently verifies requests produced by the
private `HRP Automation Dispatch` n8n node. It is test infrastructure, not a
CRM gateway implementation.

It accepts only `POST /v1/automation/dispatch`, binds the credential identity
to the envelope, reconstructs the accepted legacy
`SHA-256(signingInput || secret)` signature, and keeps an in-memory
idempotency map. It never logs request bodies, signatures or the shared
secret.

Successful execution proves `SIGNED_RUNTIME_CONFORMANCE`. It does not prove
`REAL_CRM_GATEWAY`, production compatibility or authorization to activate a
workflow.

The deployment binds the verifier to host loopback on port `18081`. nginx
exposes only the exact health and dispatch paths under
`/__t0/n8n12-signer/`; request access logging is disabled for both paths.
