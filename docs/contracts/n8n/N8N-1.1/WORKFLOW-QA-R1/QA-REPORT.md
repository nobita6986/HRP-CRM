# QA-REPORT.md -- N8N/1.1 workflow QA verdict

## STATUS

**READY_FOR_T0_N8N11_MOCK_WORKFLOW_ACCEPTANCE**

T1-A has independently verified the static workflow export and the
final-output evidence against the actual CRM
AutomationRequestSchema imported from
pps/integration-api/dist/automation/types.js. Every gate passed.

## Identity

| Field | Value | Source |
| --- | --- | --- |
| Base SHA | 7d48bf84b5602ed087dd21f24fc9ac12095fa9da | worktree HEAD at task start |
| Branch | codex/n8n-11-workflow-qa-r1 | isolated worktree |
| Worktree | D:/CodeApp/Hrp-Crm-n8n11-qa-r1 | isolated |
| Workflow ID | TmNxnx8zMLgqMIcZ | export (T0 provided) |
| Draft version (versionId) | 90c36da2-f9af-49da-8aac-096001710471 | export (T0 provided) |
| Source pin -- workflow | f1afa2b9c152a709e4c4db150cf2631bd6cff28665d31f95be274e0ee31dfef0 | T0 source SHA-256, MATCH |
| Source pin -- final-output | 5a3f07e89a0d27a1e41a055fbde9d7646d9d74fd7eb438ede7d6cfb51859d9dd | T0 source SHA-256, MATCH |

## Gate table

| Gate | Expected | Observed | Result |
| --- | --- | --- | --- |
| **QA-01 Artifact identity** | 2/2 MATCH | 2/2 MATCH | **PASS** |
| **QA-02 Graph review** | 3 triggers; 21-node manual path; SEND-then-ack; FALLBACK-only-ack; validator gates all 4 ack items before mock gateway; MOCK; inactive | 3 triggers; manual path = 22 nodes (1 trigger + 21 business); SEND builds reminder then ack via Mock CRM Gateway (sendSyntheticReminder) -> Build Acknowledgement -> Combine -> Validate -> Mock CRM Gateway (acknowledgeReminder); FALLBACK builds ack-only ack that converges into the same validator; validator's only downstream edge is the mock acknowledgement gateway; MOCK; ctive=false | **PASS** |
| **QA-03 Actual CRM schema validation** | 7/7 PASS; no unknown fields; commandName === operation.op;
a-005 has
otificationOutcome=SKIPPED and
eminderRevisionId=rev-20260926-na-005-NONE-r3;
eason lives only in metadata, never in envelope or payload | 7/7 PASS; per-envelope issues=null; all 7 satisfy commandName === operation.op;
a-005 ack payload has
eminderRevisionId=rev-20260926-na-005-NONE-r3 and
otificationOutcome=SKIPPED;
eason: "no_owner_or_supervisor" is only on the outer metadata object, absent from envelope and payload | **PASS** |
| **QA-04 Independent invariants** | seen 7 / eligible 4 / send 3 / fallback 1 / acknowledged 4 / dropped 3 / errors 0; reminder keys unique; ack keys unique; command ids unique;
a-001 and
a-006 separate;
a-002 routes SUPERVISOR;
a-005 has no reminder envelope; no raw PII / secret / token / Authorization / external URL | All 9 invariants satisfied; recomputed eligible = send + fallback and seen = send + fallback + dropped both match counts exactly; leak scan clean (no email, no phone, no Authorization header, no Bearer token, no apiKey/secret literal, no external URL) | **PASS** |
| **QA-05 Negative probes via actual schema** | 3/3 REJECT_EXPECTED (no commandId; unknown top-level field;
eminderRevisionId: null) | 3/3 REJECT_EXPECTED; the unknown-field probe explicitly demonstrates .strict() (unrecognized_keys); the commandId-missing probe triggers Required on commandId; the
ull reminderRevisionId probe triggers Expected string, received null at operation.payload.reminderRevisionId | **PASS** |
| **QA-06 Provenance honesty** | executionId / ersionId / lastNodeExecuted are OWNER/N8N_REPORT_PROVIDED, not derivable from raw final-output JSON | Final-output does not contain these top-level fields. Workflow ersionId and id are recorded from the export (owner-supplied); envelope
8nExecutionId is exec-synthetic-001 reused across all 7 envelopes (AI Assistant synthetic dry-run placeholder, not a real n8n execution). Scope-of-acceptance is artifact content + static workflow + actual-schema validation. | **PASS** |
| **Encoding gate** | strict UTF-8 no BOM, LF-only | All committed bundle files pass erify-encoding.ps1 (encoding gate: PASS) | **PASS** |
| **git diff --check** | clean (no whitespace / tab / trailing issues) | clean (only Windows LF-CRLF informational warnings, no whitespace violations) | **PASS** |
| **Secret / credential / URL scan** | no secret, no credential reference, no external URL | workflow has no HTTP node, no credential reference; final-output has no Authorization, no Bearer, no apiKey / secret literal, no external URL | **PASS** |
| **Manifest** | N/N MATCH from committed blobs | manifest reproduces hash-for-hash from committed blobs (see manifest.sha256) | **PASS** |

## Graph summary

3 triggers: Manual Trigger, Schedule Every 15 Minutes, Schedule
Daily 09:00 Bangkok. The manual execution path covers 22 nodes (1
trigger + 21 business nodes):

`
Manual Trigger -> Test Config -> Synthetic NextActions
  -> Reject Malformed Records -> Compute Due Window
  -> Drop Non-Open -> Merge Results -> Drop Snoozed
  -> Build Final Output -> Drop Not Due -> Sort Deterministically
  -> Keep One Item Per NextAction -> Resolve Audience and Routing
  -> Route SEND or FALLBACK
    [SEND]    -> Build Reminder Envelope
              -> SIGNER BLOCKED - DO NOT ACTIVATE
              -> Mock CRM Gateway - sendSyntheticReminder
    [FALLBACK]-> Build Fallback Acknowledgement
  -> Combine Acknowledgements
  -> Validate CRM AutomationRequest Shape
  -> Mock CRM Gateway - acknowledgeReminder
  -> Merge Results -> Build Final Output
`

Every acknowledgement item (4 of them: 3 SEND + 1 FALLBACK) passes
through Validate CRM AutomationRequest Shape before the mock
acknowledgement gateway. There is no bypass edge.

## Workflow static checks

- ctive: alse -- PASS.
- settings.timezone: Asia/Bangkok -- PASS.
- pinData: empty object {}, zero entries -- PASS
  (recorded as "no entries" -- the field exists per n8n export
  schema, but contains no data; nothing pinned).
- HTTP Request nodes: 0 -- PASS.
- Credential references on any node: 0 -- PASS.
- Node count: 24 -- PASS.

## Files in this bundle

`
docs/contracts/n8n/N8N-1.1/WORKFLOW-QA-R1/
  README.md
  QA-REPORT.md
  ARTIFACT-PINS.md
  SCHEMA-VALIDATION.json
  NEGATIVE-PROBES.json
  LIMITATIONS.md
  workflow.json
  final-output.execution-7.json
  manifest.sha256
  qa/
    qa02-graph.json
    qa02-validator-downstream.json
    qa02-send-fallback.json
    qa04-invariants.json
    runner-inspect.mjs
    runner-qa02-graph.mjs
    runner-qa02-validator-downstream.mjs
    runner-qa02-send-fallback.mjs
    runner-qa03-schema.mjs
    runner-qa04-invariants.mjs
    runner-qa05-negative.mjs
`

## Verdict

$verdict. T1-A stops here. T0 is now responsible for routing the
verdict back to the n8n AI Assistant and, if T0 wants to promote the
workflow past MOCK, scheduling a follow-up QA round that covers the
signer / activation path per the QA-REVIEW-QUEUE procedure.
