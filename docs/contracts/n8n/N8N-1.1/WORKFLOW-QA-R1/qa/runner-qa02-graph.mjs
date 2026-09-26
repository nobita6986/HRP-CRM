import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const SRC = resolve(process.argv[2]);
const w = JSON.parse(readFileSync(SRC, "utf8"));
const nodes = w.nodes;
const conns = w.connections || {};
const byName = {};
const byId = {};
for (const n of nodes) { byName[n.name] = n; byId[n.id] = n; }
const triggers = nodes.filter(n => n.type && n.type.endsWith("Trigger"));
function outgoing(nodeName) {
  const c = conns[nodeName];
  if (!c) return [];
  return Object.values(c).flatMap(arr => (arr || []).flatMap(group => (group || []).map(c => c.node)));
}
const manual = nodes.find(n => n.type === "n8n-nodes-base.manualTrigger");
const visited = new Set();
const queue = [manual.name];
while (queue.length) {
  const cur = queue.shift();
  if (visited.has(cur)) continue;
  visited.add(cur);
  for (const n of outgoing(cur)) if (!visited.has(n)) queue.push(n);
}
const validators = nodes.filter(n => /Validate CRM AutomationRequest Shape/.test(n.name));
const validatorName = validators[0]?.name;
const validatorReachedFrom = {};
for (const t of triggers) {
  const tReaches = new Set();
  const q = [t.name];
  while (q.length) {
    const cur = q.shift();
    if (tReaches.has(cur)) continue;
    tReaches.add(cur);
    for (const n of outgoing(cur)) if (!tReaches.has(n)) q.push(n);
  }
  validatorReachedFrom[t.name] = tReaches.has(validatorName);
}
const mockAckNode = nodes.find(n => /Mock Acknowledgement Gateway/.test(n.name));
const pathToMockAck = new Set();
const q2 = [validatorName];
while (q2.length) {
  const cur = q2.shift();
  if (pathToMockAck.has(cur)) continue;
  pathToMockAck.add(cur);
  for (const n of outgoing(cur)) if (!pathToMockAck.has(n)) q2.push(n);
}
const validatorToMockAck = pathToMockAck.has(mockAckNode?.name);
const switches = nodes.filter(n => n.type === "n8n-nodes-base.switch");
const switchOutputs = {};
for (const sw of switches) {
  const c = conns[sw.name];
  switchOutputs[sw.name] = c ? Object.entries(c).map(([k,v]) => ({ output: k, targets: (v||[]).flatMap(g => (g||[]).map(cc=>cc.node)) })) : [];
}
const result = {
  triggerCount: triggers.length,
  triggers: triggers.map(t => ({ name: t.name, type: t.type })),
  manualTriggerPathLength: visited.size,
  manualTriggerPath: Array.from(visited),
  nodeTypes: Object.fromEntries(Object.entries(Object.fromEntries(nodes.map(n => [n.type, 0]))).map(([k,v]) => [k, nodes.filter(n => n.type === k).length])),
  validatorNodeName: validatorName,
  validatorReachedFromTriggers: validatorReachedFrom,
  mockAckNode: mockAckNode?.name,
  validatorToMockAckReachable: validatorToMockAck,
  switchesCount: switches.length,
  switchOutputs,
};
process.stdout.write(JSON.stringify(result, null, 2));