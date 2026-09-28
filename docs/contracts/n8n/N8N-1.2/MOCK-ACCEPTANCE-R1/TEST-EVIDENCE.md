# Test evidence

## Server evidence

The verifier fetched the workflow and execution using separate requests to the
n8n Public API and required all of the following:

- requested workflow ID equals saved workflow ID;
- execution workflow ID equals requested workflow ID;
- current workflow version equals the expected version;
- execution workflow version equals the same expected version;
- execution finished with `success`;
- workflow is inactive;
- final node output exists;
- all seven CRM automation envelopes pass the built
  `AutomationRequestSchema` from the signed-local gateway worktree.

Result: `N8N_EVIDENCE=PASS`, 7/7 envelopes valid.

## N8N/1.2 profile

`validate-n8n12-mock.mjs` verified 21 independent conditions, including:

- exact 7/4/3/1/4/3/0 count matrix;
- set equality between SEND IDs and reminder IDs;
- set equality between eligible IDs and acknowledgement IDs;
- seven unique handled IDs across acknowledgements and dropped records;
- three reminder and four acknowledgement contract validations;
- all six declared workflow invariants are true;
- signer remains explicitly blocked;
- no HTTP Request nodes or credential references.

Result: `N8N12_MOCK=PASS checks=21 failures=0`.

## Automated tests

Command:

```text
node --test scripts/n8n-evidence/pull-evidence.test.mjs scripts/n8n-evidence/validate-n8n12-mock.test.mjs
```

Result: 7/7 PASS. Negative probes reject count drift, activation with an HTTP
credential node, and workflow/execution version mismatch.

Additional gates:

- PowerShell parser: PASS
- Strict UTF-8 no-BOM gate: PASS
- `git diff --check`: PASS
- Exact API-key scan of local evidence: 0 matches
