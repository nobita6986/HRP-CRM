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
const validator = "Validate CRM AutomationRequest Shape";
// BFS downstream of validator
const reached = new Set();
const q = [validator];
while (q.length) {
  const cur = q.shift();
  if (reached.has(cur)) continue;
  reached.add(cur);
  for (const n of outgoing(cur)) if (!reached.has(n)) q.push(n);
}
const result = {
  validatorDownstream: Array.from(reached),
  reachesMockAck: reached.has("Mock CRM Gateway \u2014 acknowledgeReminder"),
  reachesMockSend: reached.has("Mock CRM Gateway \u2014 sendSyntheticReminder"),
  reachesMockAckCount: Array.from(reached).filter(n => n.startsWith("Mock CRM Gateway")).length,
};
process.stdout.write(JSON.stringify(result, null, 2));