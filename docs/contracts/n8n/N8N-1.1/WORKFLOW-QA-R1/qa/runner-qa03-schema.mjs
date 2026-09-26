import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AutomationRequestSchema,
} from "../apps/integration-api/dist/automation/types.js";

const SRC = resolve(process.argv[2]);
const j = JSON.parse(readFileSync(SRC, "utf8"));
const item = Array.isArray(j) ? j[0] : j;
const rem = item.reminders || [];
const ack = item.acknowledgements || [];

const envelopes = [];
for (const r of rem) envelopes.push({ kind: "reminder", nextActionId: r.nextActionId, env: r.envelope });
for (const a of ack) envelopes.push({ kind: "ack", nextActionId: a.nextActionId, env: a.envelope });

let pass = 0, fail = 0;
const results = [];
for (const e of envelopes) {
  const parsed = AutomationRequestSchema.safeParse(e.env);
  let ok = parsed.success;
  let cn = null, op = null;
  if (ok) { cn = parsed.data.commandName; op = parsed.data.operation.op; if (cn !== op) ok = false; }
  if (ok) pass++; else fail++;
  results.push({
    kind: e.kind,
    nextActionId: e.nextActionId,
    commandId: e.env.commandId,
    commandName: cn || e.env.commandName,
    operationOp: op || (e.env.operation && e.env.operation.op),
    commandNameMatchesOp: cn === op,
    pass: ok,
    errors: ok ? null : parsed.error.issues.map(i => ({ path: i.path.join("."), code: i.code, message: i.message })),
  });
}

const na005 = ack.find(a => a.nextActionId === "na-005");
const na005Invariants = na005 ? {
  routingFALLBACK: na005.routing === "FALLBACK",
  notificationOutcomeSKIPPED: na005.notificationOutcome === "SKIPPED",
  reminderRevisionIdIsNone: na005.envelope.operation.payload.reminderRevisionId === "rev-20260926-na-005-NONE-r3",
  reasonIsNoOwnerOrSupervisor: na005.reason === "no_owner_or_supervisor",
  reasonNotInEnvelope: !("reason" in (na005.envelope.operation.payload || {})) && !("reason" in na005.envelope),
} : null;

const out = { total: envelopes.length, pass, fail, results, na005Invariants };
process.stdout.write(JSON.stringify(out, null, 2));