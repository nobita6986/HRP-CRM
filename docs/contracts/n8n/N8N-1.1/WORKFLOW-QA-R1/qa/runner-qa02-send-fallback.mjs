import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const SRC = resolve(process.argv[2]);
const w = JSON.parse(readFileSync(SRC, "utf8"));
const conns = w.connections || {};
function outgoing(nodeName) {
  const c = conns[nodeName];
  if (!c) return [];
  return Object.values(c).flatMap(arr => (arr || []).flatMap(group => (group || []).map(c => c.node)));
}
// Build Reminder Envelope -> what next?
const builder = "Build Reminder Envelope";
const sendDownstream = outgoing(builder);
const fbDownstream = outgoing("Build Fallback Acknowledgement");
const result = {
  sendBuilderOutgoing: sendDownstream,
  fbBuilderOutgoing: fbDownstream,
  // Validate that Build Reminder Envelope flows into a node whose output reaches Mock CRM Gateway (sendSyntheticReminder)
};
// BFS from Build Reminder Envelope to find if Mock CRM Gateway (sendSyntheticReminder) is downstream
const visited = new Set();
const q = [builder];
while (q.length) {
  const cur = q.shift();
  if (visited.has(cur)) continue;
  visited.add(cur);
  for (const n of outgoing(cur)) if (!visited.has(n)) q.push(n);
}
result.buildReminderEnvelopedownstream = Array.from(visited);
result.buildReminderReachesMockSend = visited.has("Mock CRM Gateway \u2014 sendSyntheticReminder");
// BFS from Build Fallback Acknowledgement
const v2 = new Set();
const q2 = ["Build Fallback Acknowledgement"];
while (q2.length) {
  const cur = q2.shift();
  if (v2.has(cur)) continue;
  v2.add(cur);
  for (const n of outgoing(cur)) if (!v2.has(n)) q2.push(n);
}
result.buildFallbackAckdownstream = Array.from(v2);
result.buildFallbackReachesMockAck = v2.has("Mock CRM Gateway \u2014 acknowledgeReminder");
process.stdout.write(JSON.stringify(result, null, 2));