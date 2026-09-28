# Installation evidence

## Local and isolated verification

- Node tests: 11/11 PASS.
- Two independent `npm pack` runs produced byte-identical tarballs.
- Package contents: five runtime files; tests and source fixtures excluded.
- `require()` smoke test inside `docker.n8n.io/n8nio/n8n:2.40.6`: PASS.
- Isolated n8n startup with the package installed: PASS.
- Loader error scan for `Error loading`, `Failed to load`, and `Unknown node`:
  zero matches.

## Live CRM verification

- Container: `n8n-crm-n8n-1`.
- Image: `docker.n8n.io/n8nio/n8n:2.40.6`.
- Package installed under the persistent CRM n8n user volume.
- Installed version: `0.1.0-private.1`.
- CRM service restarted independently and returned `healthy`.
- Live loader error scan: zero matches.
- Public API credential schema request returned HTTP 200.
- Registered fields: `gatewayUrl`, `serviceId`, `organizationId`,
  `connectionId`, `secret`.

## Isolation verification

- `n8n-hrp-n8n-1` start timestamp was unchanged across the CRM restart.
- Result: `HRP_RESTARTED=false`.
- No HRP volume, workflow, credential or container was modified.

## Host trust

Every SSH operation pinned the Owner-approved TOFU fingerprint already
recorded by N8N/0.1 provisioning:

`SHA256:bijvhqFP33lBRhVyL9KDjwxz/gJHH9ZpELJjNT5Xu70`

The stale PuTTY cache entry for the former host key was not trusted or
overwritten.
