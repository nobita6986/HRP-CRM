# Test evidence

## Server-authoritative pull

```text
N8N_EVIDENCE=PASS workflow=J02Z2ytL5tNsT64e execution=12 envelopes=0
```

The attestation pins raw workflow SHA-256
`2681d97c94eb3ecd38ab2851431d0942aba05bbb06007a1551a70bf565759215`,
raw execution SHA-256
`9e5d1b8480283eba69d198f2b473d0355599fb8a9372bd9c9402aca6bb84642c`
and final output SHA-256
`a4e6a56c3e56e96cc91c95ef815d9cd70c7f0fee4c1ff221fe41cd57bced4837`.

## Validator

```text
N8N12_SIGNED_RUNTIME=PASS checks=22 failures=0
```

Unit and negative probes:

```text
tests 4
pass 4
fail 0
```

The negative probes reject digest disagreement, activation or replacement by
a generic HTTP Request node, and extra final-output fields such as a raw
signature.
