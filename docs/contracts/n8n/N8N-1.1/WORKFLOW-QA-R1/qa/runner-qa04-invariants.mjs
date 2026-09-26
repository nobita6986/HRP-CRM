import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const SRC = resolve(process.argv[2]);
const WF = resolve(process.argv[3]);
const j = JSON.parse(readFileSync(SRC, "utf8"));
const w = JSON.parse(readFileSync(WF, "utf8"));
const item = Array.isArray(j) ? j[0] : j;
const rem = item.reminders || [];
const ack = item.acknowledgements || [];
const sentIds = (item.sentNextActionIds || []);
const fbIds = (item.fallbackNextActionIds || []);
const dropped = item.dropped || [];
const counts = item.counts || {};
const remKeys = rem.map(r => r.envelope.idempotencyKey);
const ackKeys = ack.map(a => a.envelope.idempotencyKey);
const cmdIds = rem.map(r => r.envelope.commandId).concat(ack.map(a => a.envelope.commandId));
const na001 = rem.find(r => r.nextActionId === "na-001");
const na006 = rem.find(r => r.nextActionId === "na-006");
const na002 = rem.find(r => r.nextActionId === "na-002");
const na005Reminder = rem.find(r => r.nextActionId === "na-005");
const na005Ack = ack.find(a => a.nextActionId === "na-005");
const rawText = readFileSync(SRC, "utf8");
const leakPatterns = [
  { name: "raw email", re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: "phone-like", re: /\+84[\s-]?\d{9,10}|0\d{9,10}/g },
  { name: "Authorization header", re: /\bAuthorization\s*:/gi },
  { name: "Bearer token literal", re: /Bearer\s+[A-Za-z0-9_\-\.=]{16,}/g },
  { name: "apiKey literal", re: /api[_-]?key\s*[:=]\s*[\"'\`]?[A-Za-z0-9_\-]{16,}/gi },
  { name: "secret literal", re: /secret\s*[:=]\s*[\"'\`]?[A-Za-z0-9_\-]{8,}/gi },
  { name: "external URL", re: /https?:\/\/(?!(127\.0\.0\.1|localhost|example\.com))[A-Za-z0-9.\-]+/gi },
];
const leaks = [];
for (const p of leakPatterns) {
  const m = rawText.match(p.re);
  if (m) leaks.push({ pattern: p.name, hits: m });
}
const wfNodeTypes = (w.nodes || []).map(n => n.type);
const hasHttp = wfNodeTypes.some(t => /httpRequest/i.test(t));
const hasCred = (w.nodes || []).some(n => n.credentials && Object.keys(n.credentials || {}).length > 0);
const hasPinDataEntries = w.pinData && Object.keys(w.pinData).length > 0;
const na005ReasonInPayload = na005Ack ? ("reason" in (na005Ack.envelope.operation.payload || {})) : false;
const na005ReasonInEnvelope = na005Ack ? ("reason" in na005Ack.envelope) : false;
const eligibleRecomputed = sentIds.length + fbIds.length;
const seenRecomputed = sentIds.length + fbIds.length + dropped.length;
const out = {
  countsCheck: {
    seenEq: counts.seen === 7,
    eligibleEq: counts.eligible === 4,
    sendEq: counts.send === 3,
    fallbackEq: counts.fallback === 1,
    acknowledgedEq: counts.acknowledged === 4,
    droppedEq: counts.dropped === 3,
    errorsEq: counts.errors === 0,
    eligibleRecomputedMatches: eligibleRecomputed === counts.eligible && eligibleRecomputed === counts.send + counts.fallback,
    seenRecomputedMatches: seenRecomputed === counts.seen,
  },
  uniqueness: {
    reminderKeysUnique: new Set(remKeys).size === remKeys.length,
    acknowledgementKeysUnique: new Set(ackKeys).size === ackKeys.length,
    commandIdsUnique: new Set(cmdIds).size === cmdIds.length,
    remKeyCount: remKeys.length, ackKeyCount: ackKeys.length, cmdIdCount: cmdIds.length,
  },
  routing: {
    na001Exists: !!na001,
    na006Exists: !!na006,
    na001And006Separate: !!(na001 && na006 && na001.envelope.commandId !== na006.envelope.commandId && na001.envelope.idempotencyKey !== na006.envelope.idempotencyKey),
    na002IsSupervisor: na002 ? na002.audienceKind === "SUPERVISOR" : false,
    na002AudienceKind: na002 ? na002.audienceKind : null,
    na005HasNoReminder: na005Reminder === undefined,
    na005HasFallbackAck: !!na005Ack,
    na005RoutingFALLBACK: na005Ack ? na005Ack.routing === "FALLBACK" : false,
    na005ReasonNotInPayload: !na005ReasonInPayload,
    na005ReasonNotInEnvelope: !na005ReasonInEnvelope,
  },
  leak: { clean: leaks.length === 0, findings: leaks },
  workflowStatic: {
    hasHttpRequestNode: hasHttp,
    hasCredential: hasCred,
    pinDataEntries: hasPinDataEntries,
    active: w.active,
    nodeCount: (w.nodes || []).length,
    timezone: w.settings && w.settings.timezone,
  },
};
process.stdout.write(JSON.stringify(out, null, 2));