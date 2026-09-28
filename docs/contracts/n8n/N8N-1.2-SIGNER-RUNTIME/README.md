# N8N/1.2 signer runtime R1

Status: `READY_FOR_T0_N8N12_SIGNER_RUNTIME_REVIEW`

The private `n8n-nodes-hrp-automation-dispatch` package is installed and
loaded on `n8n-crm` 2.40.6. It is not installed on `n8n-hrp`.

## Runtime disposition

- Package build and unit tests: PASS
- Reproducible tarball: PASS
- Isolated n8n 2.40.6 package load: PASS
- Isolated n8n 2.40.6 startup: PASS
- Live CRM package install: PASS
- Live CRM health after restart: PASS
- Live credential schema registration: PASS
- HRP restart or package installation: NOT PERFORMED
- Credential provisioning: NOT EXECUTED
- Workflow conversion to `SIGNED_HTTP`: NOT EXECUTED
- Signed execution: NOT EXECUTED
- Workflow activation: NOT AUTHORIZED

## Package identity

- Name: `n8n-nodes-hrp-automation-dispatch`
- Version: `0.1.0-private.1`
- Tarball size: 3,502 bytes
- SHA-256: `a80fe6fc03a573e144ef3e05ebe33cbf0e5964a30b1c4ee50e7f8198e313649e`
- npm shasum: `83e49e9ef9e38be2ada69acc12c2a6856cd7f9af`
- Tarball committed: no
- npm publication: not executed

## Security design

The custom node signs and dispatches in one runtime boundary. It never emits
the shared secret or the signature header into node output. Its credential
owns the gateway URL and all three identity values, and the node rejects any
envelope whose organization, connection or service identity differs.

The signature profile is the accepted legacy
`SHA-256(signingInput || secret)` construction. It is deliberately not named
or represented as HMAC.
