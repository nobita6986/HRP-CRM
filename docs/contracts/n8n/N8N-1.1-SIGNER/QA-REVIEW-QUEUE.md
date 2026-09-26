# QA-REVIEW-QUEUE.md -- T0 -> T1-A handoff (N8N workflow QA)

## Status

READY_FOR_T0_N8N_WORKFLOW_QA_REVIEW. T1-A is in **receive / verify
only** mode for this round: it does not author or modify workflow
JSON. The previous N8N/1.1-SIGNER round is reference-only
(PROTOTYPE_NOT_N8N_RUNTIME_ACCEPTED); its commits stay immutable.

## T1-A role (current)

T1-A is **n8n workflow QA / conformance reviewer**. T1-A receives
the artefacts below from T0, runs deterministic checks against them,
produces a verdict document, and writes an explicit correction
prompt when the workflow fails a check. T1-A never imports,
publishes, activates, or edits a workflow on the VPS. T1-A never
edits gateway / business code.

## Artefacts T0 must deliver to T1-A for every QA round

For each candidate workflow, T0 must hand T1-A a single tarball or
folder under `docs/contracts/n8n/N8N-X.Y/QA-REVIEW-INBOX/` with:

1. **Exported workflow JSON** -- the canonical workflow shape
   produced by the n8n AI Assistant on n8n-crm, exported via the
   n8n `GET /workflows/:id` endpoint. Name pattern:
   `workflow-<shortId>.v<n>.json`. Must be `UTF-8 no BOM` and
   parse with strict JSON (RFC 8259). T0 must verify these on
   handoff.
2. **Execution evidence** -- a folder `evidence/` with:
   - `last-execution.json` (or `.txt`) from the n8n AI Assistant
     dry-run / manual execution. Must include the resolved
     workflow snapshot id, started/finished ISO timestamps,
     node-by-node input/output snippets (redacted of any secret),
     and `data.resultData.error` if present.
   - Optional `screenshot-*.png` if the workflow is UI-driven.
   - Any `execution-stderr.txt` / `execution-stdout.txt` the
     assistant produced, again redacted.
3. **Schema reference** -- pointer to which N8N version the export
   is supposed to satisfy (e.g. N8N/1.1 SLA Reminder). T0 must
   indicate the exact N8N-X.Y spec doc the AI Assistant targeted.
4. **Free-form notes** -- any constraints the AI Assistant was
   given (env vars, fixtures, dry-run vs real call), so T1-A can
   reproduce the inputs.

## What T1-A checks

For every received export, T1-A runs these checks (in order):

1. **`active` flag.** Top-level `active` MUST be `false`. Any
   export with `active: true` is an immediate FAIL; T1-A returns
   a correction prompt asking T0 to re-export with the workflow
   paused.
2. **Graph topology.** Read every `connections` entry, walk the
   DAG from each `*Trigger` node, confirm every node has the
   expected `inputs` / `outputs` arity and that no node is
   orphaned. T1-A reports the node count, edge count, and the
   longest path length. T1-A does NOT edit the graph; it only
   flags missing/extra edges.
3. **Branch semantics.** For every `Switch`, `IF`, or filter node,
   T1-A enumerates the conditions, the value expressions
   (`leftValue` / `rightValue`), and asserts that each branch has
   at least one consumer in the DAG.
4. **Input / output schema.** For each `function` /
   `functionItem` node, T1-A reads `functionCode` and documents
   the produced `json` shape (key set, types) and the expected
   `json` shape on input. T1-A checks every downstream node's
   `$node["..."].json.<path>` expression against that
   documented shape.
5. **Deterministic idempotency.** T1-A scans every key derivation
   expression (`idempotencyKey`, `correlationId`, `commandId`,
   `ackBase`, `reminderRevisionId`, `window key`, etc.) and
   confirms each one is derived from stable fields only. T1-A
   flags any expression that calls `Date.now()`, `Math.random()`,
   `$now` (when used as a key source), or unstated environment
   variables.
6. **Replay and multi-item behaviour.** T1-A writes a Node-based
   harness (or `node:test` script) that replays the workflow's
   `functionCode` snippets against:
   - the documented input (single-item happy path),
   - the same input re-submitted with the same `idempotencyKey`
     (must produce the same logical id set; the actual
     `commandId` may differ as long as the dedupe key matches),
   - a multi-item input where `items.length > 1` to confirm the
     downstream `Switch` / `IF` fans out per item, not per
     batch.
   T1-A compares the replay outputs against the AI Assistant's
   recorded `last-execution.json`.
7. **Secret / credential / endpoint leakage.** T1-A scans the
   exported JSON for any of:
   - a literal `secret` / `password` / `token` / `apiKey` field
     with a non-empty value,
   - any 16+-char hex / base64 string that looks like a key,
   - any URL pointing to an external host that is not in the
     `HRP_AUTOMATION_GATEWAY_URL` allowlist (default:
     `http://127.0.0.1`, `https://api.hrp-internal`, anything
     under `localhost`),
   - any environment-variable reference `$env.SOMETHING_SECRET`
     not in the documented allowlist.
   Any match is a FAIL with the offending line quoted.
8. **No real HTTP in MOCK mode.** If the workflow declares
   `mockMode` or is annotated as MOCK, T1-A asserts no node
   actually opens a non-loopback HTTP connection. The harness
   above runs without `--experimental-network` so any attempt
   to reach the gateway is observable.
9. **CRM `AutomationRequestSchema` compatibility.** T1-A parses
   every envelope built by the workflow and runs it through
   `apps/integration-api/dist/automation/types.js`'s
   `AutomationRequestSchema.safeParse`. Any zod issue is
   reported with the offending path + message key.

## Verdict document T1-A produces

For each QA round T1-A writes
`docs/contracts/n8n/N8N-X.Y/QA-VERDICT-<shortId>.md` with:

- header: `STATUS: PASS | FAIL | PASS_WITH_CORRECTIONS`,
- summary table of all 9 checks above with PASS/FAIL per row,
- the deterministic replay script T1-A ran (committed under
  `evidence/replay/<shortId>.mjs`),
- a `Correction prompt` block T0 forwards verbatim to the n8n AI
  Assistant when any row is FAIL or PASS_WITH_CORRECTIONS. The
  prompt lists, in priority order, the smallest set of edits the
  AI Assistant must make to the export. T1-A does NOT write the
  edits; T1-A only describes the constraint violated.

When the verdict is PASS, T1-A also writes an
**immutable evidence bundle**:

- `evidence-bundle-<shortId>.manifest.sha256` listing every
  artefact (export JSON, execution evidence, replay script,
  verdict document, supporting fixtures) by SHA-256,
- the bundle is sealed: T1-A tags it with the T0-supplied
  workflow id and the AI Assistant export timestamp, and
  declares it READ_ONLY_FOR_REPRODUCTION_ONLY. No member of the
  bundle may be edited after the manifest is committed, except
  by an explicit `T0_APPROVED_CORRECTION_ROUND` follow-up that
  produces a brand-new bundle.

## Hard constraints upheld by T1-A

- No code path in any QA round modifies
  `apps/integration-api/src/automation/*` or
  `packages/contracts/src/**` or any frozen surface.
- No import, publish, or activate call to n8n.
- No edits to a workflow the AI Assistant produced; T1-A only
  flags and prompts.
- No amend / delete / force-push on prior commits
  (`1e25f98`, `5e02aa8`, `5418378`, or earlier). They are
  immutable.

## Current queue

- N8N/1.1 SLA Reminder (signed variant, `workflowRevision=3`)
  -- awaiting T0 handoff of an AI Assistant export + execution
  evidence. Prototype reference: see
  `apps/n8n-workflows/import-candidates/sla-reminder.signed.v1.json`
  (the prototype, NOT a deliverable).
- N8N/1.1 SLA Reminder (blocked variant, `workflowRevision=2`)
  -- awaiting T0 handoff if T0 wants T1-A to QA the original
  BLOCKED_BY_N8N_SIGNER_DECISION version too. Reference:
  `apps/n8n-workflows/sla-reminder.v1.json`.

When T0 drops a workflow under `QA-REVIEW-INBOX/`, T1-A picks it
up immediately and emits a `QA-VERDICT-<shortId>.md` plus the
supporting replay / manifest.