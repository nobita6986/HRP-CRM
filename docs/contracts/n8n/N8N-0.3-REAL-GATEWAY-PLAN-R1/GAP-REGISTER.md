# Gap register

| ID | Current local behavior | Required before real gateway |
| --- | --- | --- |
| RG-01 | Function/registry label says HMAC while bytes use legacy concatenated SHA-256 | Rename profile everywhere; preserve bytes; regression vector |
| RG-02 | Idempotency uses process-local Map with TTL/LRU | PostgreSQL atomic claim/result authority; restart and concurrency evidence |
| RG-03 | Registry supports environment JSON/pipe entries containing plaintext secret | Restricted server-side provisioning, rotation and disable runbook |
| RG-04 | Mock adapter is the proven downstream | Explicit CRM-owned real adapter and fail-closed dependency behavior |
| RG-05 | Local tests prove boundary behavior | Clean checkout, DB integration, two-instance and restart evidence |
| RG-06 | Synthetic credential/verifier are live | Keep isolated; never promote them into product traffic |
| RG-07 | Product workflow remains MOCK/inactive | Convert only after real gateway acceptance and provisioned real credential |

All seven gaps are blocking for real gateway deployment. They do not revoke
the completed synthetic signed-runtime conformance result.
