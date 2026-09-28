# Security boundary

## Credential authority

The n8n credential store is the sole authority for:

- gateway base URL;
- service ID;
- organization ID;
- connection ID;
- shared secret.

Workflow parameters cannot override these values. The package requires HTTPS
without URL credentials, query parameters or fragments. Secrets shorter than
32 characters are rejected.

## Envelope binding

Before signing, the node requires exact equality between:

- `envelope.organizationId` and credential `organizationId`;
- `envelope.source.connectionId` and credential `connectionId`;
- `envelope.actor.serviceId` and credential `serviceId`.

The digest excludes only the accepted tracking fields: `correlationId`,
`occurredAt`, `commandId`, and `automationSource.n8nExecutionId`.

## Output confinement

The node output contains the HTTP status, response body, selected tracking
IDs, payload digest and signature profile. It does not contain request
headers, the signature or the shared secret. Transport exceptions are replaced
with a fixed error message before reaching execution data.

## Remaining gate

No credential has been provisioned because no accepted HTTPS CRM automation
gateway and registry tuple has been supplied for this runtime. A signed
execution must remain blocked until those values exist and T0 approves their
use. A mock receiver cannot satisfy that gate.
