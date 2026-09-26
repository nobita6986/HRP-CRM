import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AutomationRequestSchema } from "../apps/integration-api/dist/automation/types.js";
const SRC = resolve(process.argv[2]);
const j = JSON.parse(readFileSync(SRC, "utf8"));
const item = Array.isArray(j) ? j[0] : j;
const rem = item.reminders[0];
const ack = item.acknowledgements[3]; // na-005 fallback
const reminderEnvelope = rem.envelope;
const ackEnvelope = ack.envelope;

const out = {};

// Probe 1: drop commandId from reminder envelope
{
  const e = JSON.parse(JSON.stringify(reminderEnvelope));
  delete e.commandId;
  const r = AutomationRequestSchema.safeParse(e);
  out.probe1_commandIdMissing = {
    expectReject: true,
    passed: !r.success,
    issues: r.success ? null : r.error.issues.map(i => ({ path: i.path.join("."), code: i.code, message: i.message })),
  };
}

// Probe 2: add unknown top-level field
{
  const e = JSON.parse(JSON.stringify(reminderEnvelope));
  e.secret_top_level_field = "should_be_rejected_by_strict";
  const r = AutomationRequestSchema.safeParse(e);
  out.probe2_unknownTopLevelField = {
    expectReject: true,
    passed: !r.success,
    issues: r.success ? null : r.error.issues.map(i => ({ path: i.path.join("."), code: i.code, message: i.message })),
  };
}

// Probe 3: fallback reminderRevisionId = null (applied to a synthetic reminder envelope, but with null rev id)
{
  const e = JSON.parse(JSON.stringify(reminderEnvelope));
  e.operation.payload.reminderRevisionId = null;
  const r = AutomationRequestSchema.safeParse(e);
  out.probe3_reminderRevisionIdNull = {
    expectReject: true,
    passed: !r.success,
    issues: r.success ? null : r.error.issues.map(i => ({ path: i.path.join("."), code: i.code, message: i.message })),
  };
}

process.stdout.write(JSON.stringify(out, null, 2));