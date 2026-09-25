/**
 * automation-gateway.test.mjs — N8N/0.2 CRM Automation Gateway tests.
 *
 * Coverage (per Plan §N8N/0.2 + brief):
 *   - happy path for all 3 allowlisted operations
 *   - service identity: known/expired/unknown/mismatched signature
 *   - organization spoofing (body vs credential)
 *   - operation allowlist (authorized vs unauthorized)
 *   - idempotency: replay returns cached result
 *   - idempotency: same key + different payload -> 409
 *   - idempotency: same key + same payload + same correlationId -> replay
 *   - idempotency: same key + same payload + different correlationId -> 409
 *     (correlation_id_mismatch; n8nExecutionId may rotate without conflict)
 *   - payload size limit
 *   - rate limit per workflow
 *   - kill switch: workflow / connection / organization granularity
 *   - kill switch specificity (most specific wins)
 *   - provider offline (adapter reports offline)
 *   - timeout (adapter exceeds budget)
 *   - redaction (wire response never contains secrets/PII)
 *   - schema validation (command name mismatch)
 *   - internal codes never on wire
 *
 * No DB, no Docker, no HRP provider. Tests use the in-memory mock
 * adapter and a fixed clock.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AutomationGateway,
  AutomationServiceRegistry,
  AutomationIdempotencyStore,
  KillSwitchStore,
  TokenBucketRateLimiter,
  MockAutomationAdapter,
  canonicalJson,
  payloadDigestHex,
  hmacSha256Hex,
} from '../dist/automation/index.js';
import { SCHEMA_VERSION } from '@hrp-engagement/contracts';

const FIXED_NOW = 1_700_000_000_000;
const ORG_ID = 'org-n8n-001';
const OTHER_ORG_ID = 'org-evil-002';
const CONN_ID = 'conn-n8n-001';
const SERVICE_ID = 'svc-n8n-001';
const SECRET = 'shared-secret-do-not-leak-001';
const FUTURE_EXPIRY = FIXED_NOW + 24 * 60 * 60 * 1000;

function buildEntry(overrides = {}) {
  return {
    serviceId: SERVICE_ID,
    organizationId: ORG_ID,
    connectionId: CONN_ID,
    secret: SECRET,
    algorithm: 'HMAC_SHA256',
    expiresAt: FUTURE_EXPIRY,
    allowedOperations: ['listDueNextActions', 'acknowledgeReminder', 'getNextAction'],
    ...overrides,
  };
}

function fixtureItem(id, overrides = {}) {
  return {
    nextActionId: id,
    targetRedacted: '[talent-redacted]',
    targetKind: 'PLACEMENT_CASE',
    status: 'OPEN',
    snoozeMode: 'ACTIVE',
    dueAt: new Date(FIXED_NOW + 60 * 60 * 1000).toISOString(),
    scheduledAt: new Date(FIXED_NOW + 30 * 60 * 1000).toISOString(),
    timezone: 'Asia/Ho_Chi_Minh',
    assignedToRedacted: 'user-redacted-1',
    ...overrides,
  };
}

// Digest EXCLUDING correlationId, occurredAt, commandId, and n8nExecutionId
// (matches the gateway's internal logic).
function envelopeDigest(envelope) {
  const { correlationId, occurredAt, commandId, automationSource, ...rest } = envelope;
  void correlationId; void occurredAt; void commandId;
  if (automationSource && typeof automationSource === 'object') {
    const { n8nExecutionId, ...srcRest } = automationSource;
    void n8nExecutionId;
    return payloadDigestHex(canonicalJson({ ...rest, automationSource: srcRest }));
  }
  return payloadDigestHex(canonicalJson(rest));
}

function makeEnvelope(op, payloadOverrides = {}, envelopeOverrides = {}) {
  const opPayloads = {
    listDueNextActions: { schemaVersion: SCHEMA_VERSION, pageSize: 50 },
    acknowledgeReminder: {
      schemaVersion: SCHEMA_VERSION,
      nextActionId: 'na-001',
      notificationOutcome: 'SENT',
      reminderRevisionId: 'rev-001',
      channel: 'INTERNAL_TEST',
    },
    getNextAction: { schemaVersion: SCHEMA_VERSION, nextActionId: 'na-001' },
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    commandId: 'cmd-' + op + '-' + Math.random().toString(36).slice(2, 10),
    commandName: op,
    idempotencyKey: 'idem-' + op + '-' + Math.random().toString(36).slice(2, 10),
    correlationId: 'corr-' + op + '-' + Math.random().toString(36).slice(2, 10),
    organizationId: ORG_ID,
    source: { kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null },
    actor: { kind: 'SERVICE', serviceId: SERVICE_ID },
    automationSource: {
      kind: 'N8N_AUTOMATION',
      workflowId: 'wf-sla-reminder',
      workflowRevision: 1,
      n8nExecutionId: 'exec-' + Math.random().toString(36).slice(2, 10),
    },
    operation: { op, payload: { ...opPayloads[op], ...payloadOverrides } },
    ...envelopeOverrides,
  };
}

function sign(scopeKey, payloadDigest, secret) {
  return hmacSha256Hex(scopeKey + '\n' + payloadDigest, secret);
}

function buildArgs(envelope, opts = {}) {
  const raw = new TextEncoder().encode(JSON.stringify(envelope));
  const payloadDigest = envelopeDigest(envelope);
  const cred = opts.credential ?? {};
  const svcId = cred.serviceId ?? SERVICE_ID;
  const orgId = cred.organizationId ?? ORG_ID;
  const connId = cred.connectionId ?? CONN_ID;
  const secret = opts.secret ?? SECRET;
  const scopeKey = AutomationIdempotencyStore.scopeKey({
    organizationId: orgId,
    connectionId: connId,
    serviceId: svcId,
    commandName: envelope.commandName,
    idempotencyKey: envelope.idempotencyKey,
  });
  const sig = opts.signatureHex ?? sign(scopeKey, payloadDigest, secret);
  return {
    rawBody: raw,
    envelope,
    credential: {
      serviceId: svcId,
      organizationId: orgId,
      connectionId: connId,
      signatureHex: sig,
    },
    timeoutMs: opts.timeoutMs,
  };
}

function makeGateway(opts = {}) {
  const registry = new AutomationServiceRegistry(opts.entries ?? [buildEntry()], {
    now: () => FIXED_NOW,
  });
  const killSwitch = new KillSwitchStore({ now: () => FIXED_NOW });
  const rateLimiter = new TokenBucketRateLimiter({
    capacity: opts.rateCapacity ?? 60,
    perMinute: opts.perMinute ?? 60,
    now: () => FIXED_NOW,
  });
  const idempotency = new AutomationIdempotencyStore({
    maxRecords: 1000,
    retentionMs: 24 * 60 * 60 * 1000,
    now: () => FIXED_NOW,
  });
  const adapter = new MockAutomationAdapter({
    organizationId: ORG_ID,
    connectionId: CONN_ID,
    now: () => FIXED_NOW,
    initialListDue: opts.initialListDue ?? {
      items: [fixtureItem('na-001'), fixtureItem('na-002')],
    },
    initialGetById: opts.initialGetById ?? new Map([['na-001', fixtureItem('na-001')]]),
  });
  const gateway = new AutomationGateway({
    registry,
    killSwitch,
    rateLimiter,
    idempotency,
    adapter,
    config: opts.config,
    now: () => FIXED_NOW,
  });
  return { gateway, registry, killSwitch, rateLimiter, idempotency, adapter };
}

// ─────────────────────────────────────────────────────────────────────
// HAPPY PATH
// ─────────────────────────────────────────────────────────────────────

describe('happy path', () => {
  test('listDueNextActions returns APPLIED', async () => {
    const { gateway } = makeGateway();
    const r = await gateway.invoke(buildArgs(makeEnvelope('listDueNextActions')));
    assert.equal(r.httpStatus, 200, JSON.stringify(r.response));
    assert.equal(r.response.status, 'APPLIED');
    assert.equal(r.response.data.items.length, 2);
  });

  test('getNextAction returns APPLIED with single item', async () => {
    const { gateway } = makeGateway();
    const r = await gateway.invoke(
      buildArgs(makeEnvelope('getNextAction', { nextActionId: 'na-001' })),
    );
    assert.equal(r.httpStatus, 200);
    assert.equal(r.response.data.item.nextActionId, 'na-001');
  });

  test('acknowledgeReminder returns APPLIED with audit fields', async () => {
    const { gateway } = makeGateway();
    const r = await gateway.invoke(buildArgs(makeEnvelope('acknowledgeReminder')));
    assert.equal(r.httpStatus, 200);
    assert.equal(r.response.data.nextActionId, 'na-001');
    assert.ok(r.response.data.recordedAt);
  });
});

// ─────────────────────────────────────────────────────────────────────
// ORGANIZATION SPOOFING (body vs credential)
// ─────────────────────────────────────────────────────────────────────

describe('organization spoofing', () => {
  test('body organizationId != credential organizationId -> 403', async () => {
    // Registry has BOTH entries so the credential resolves.
    const evilEntry = buildEntry({
      serviceId: SERVICE_ID + '-evil',
      organizationId: OTHER_ORG_ID,
      connectionId: CONN_ID,
      secret: 'shared-secret-other-org',
    });
    const { gateway } = makeGateway({ entries: [buildEntry(), evilEntry] });
    const envelope = makeEnvelope('listDueNextActions');
    // Body still claims ORG_ID; credential claims OTHER_ORG_ID.
    const r = await gateway.invoke(
      buildArgs(envelope, {
        credential: { serviceId: SERVICE_ID + '-evil', organizationId: OTHER_ORG_ID },
        secret: 'shared-secret-other-org',
      }),
    );
    assert.equal(r.httpStatus, 403, JSON.stringify(r.response));
    assert.equal(r.response.errors[0].code, 'FORBIDDEN');
    assert.equal(r.internalCode, 'n8n_organization_mismatch');
    assert.equal(r.logEntry.organizationId, OTHER_ORG_ID);
  });

  test('unknown connection tuple -> 401 AUTHENTICATION_REQUIRED', async () => {
    // Only the original entry exists; credential claims a connectionId
    // the registry does not have, so resolve() returns unknown_service.
    const { gateway } = makeGateway();
    const envelope = makeEnvelope('listDueNextActions');
    const r = await gateway.invoke(
      buildArgs(envelope, { credential: { connectionId: 'conn-unknown' } }),
    );
    assert.equal(r.httpStatus, 401, JSON.stringify(r.response));
    assert.equal(r.response.errors[0].code, 'AUTHENTICATION_REQUIRED');
  });
});

// ─────────────────────────────────────────────────────────────────────
// IDEMPOTENCY
// ─────────────────────────────────────────────────────────────────────

describe('idempotency', () => {
  test('same key + same payload returns cached result', async () => {
    const { gateway } = makeGateway();
    const envelope = makeEnvelope('getNextAction', { nextActionId: 'na-001' });
    const r1 = await gateway.invoke(buildArgs(envelope));
    assert.equal(r1.httpStatus, 200);
    assert.equal(r1.logEntry.cacheHit, false);
    const r2 = await gateway.invoke(buildArgs(envelope));
    assert.equal(r2.httpStatus, 200);
    assert.equal(r2.response.status, 'APPLIED');
    assert.equal(r2.logEntry.cacheHit, true);
  });

  test('same key + different payload -> 409 IDEMPOTENCY_CONFLICT', async () => {
    const { gateway } = makeGateway();
    const e1 = makeEnvelope('getNextAction', { nextActionId: 'na-001' });
    const r1 = await gateway.invoke(buildArgs(e1));
    assert.equal(r1.httpStatus, 200);

    const e2 = makeEnvelope('getNextAction', { nextActionId: 'na-002' });
    e2.idempotencyKey = e1.idempotencyKey;
    e2.commandId = e1.commandId;
    const r2 = await gateway.invoke(buildArgs(e2));
    assert.equal(r2.httpStatus, 409, JSON.stringify(r2.response));
    assert.equal(r2.response.errors[0].code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(r2.internalCode, 'n8n_idempotency_conflict');
    assert.equal(r2.logEntry.idempotencyConflict, true);
  });

  test('same key + same payload + same correlationId -> 200 APPLIED (cached replay)', async () => {
    const { gateway } = makeGateway();
    const e1 = makeEnvelope('getNextAction', { nextActionId: 'na-001' });
    const r1 = await gateway.invoke(buildArgs(e1));
    assert.equal(r1.httpStatus, 200);
    assert.equal(r1.logEntry.cacheHit, false);

    // Re-run with the SAME correlationId (logical retry). May rotate
    // commandId and n8nExecutionId. Different commandId/n8nExecutionId
    // do NOT contribute to the digest, so digest still matches.
    const e2 = makeEnvelope('getNextAction', { nextActionId: 'na-001' });
    e2.idempotencyKey = e1.idempotencyKey;
    e2.correlationId = e1.correlationId;
    e2.commandId = 'cmd-rotated-on-purpose';
    e2.automationSource.n8nExecutionId = 'exec-rotated-on-purpose';
    const r2 = await gateway.invoke(buildArgs(e2));
    assert.equal(r2.httpStatus, 200);
    assert.equal(r2.response.status, 'APPLIED');
    assert.equal(r2.logEntry.cacheHit, true);
  });

  test('same key + same payload + different correlationId -> 409 IDEMPOTENCY_CONFLICT', async () => {
    const { gateway } = makeGateway();
    const e1 = makeEnvelope('getNextAction', { nextActionId: 'na-001' });
    const r1 = await gateway.invoke(buildArgs(e1));
    assert.equal(r1.httpStatus, 200);
    assert.equal(r1.logEntry.cacheHit, false);

    // Re-run with a rotated correlationId but same payload, same
    // idempotencyKey. Per N8N/0.3 r1, correlationId MUST stay the same
    // across the same logical flow; a different correlationId is treated
    // as a different logical flow reusing the same key -> 409 conflict.
    const e2 = makeEnvelope('getNextAction', { nextActionId: 'na-001' });
    e2.idempotencyKey = e1.idempotencyKey;
    e2.commandId = e1.commandId;
    e2.correlationId = 'corr-totally-different-on-purpose';
    e2.automationSource.n8nExecutionId = 'exec-totally-different-on-purpose';
    const r2 = await gateway.invoke(buildArgs(e2));
    assert.equal(r2.httpStatus, 409, JSON.stringify(r2.response));
    assert.equal(r2.response.errors[0].code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(r2.internalCode, 'n8n_idempotency_conflict');
    assert.equal(r2.logEntry.idempotencyConflict, true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// SERVICE CREDENTIAL LIFECYCLE
// ─────────────────────────────────────────────────────────────────────

describe('service credential lifecycle', () => {
  test('registry resolve rejects expired credential', () => {
    // Clock that we can advance between construction and resolve.
    let clockMs = FIXED_NOW;
    const futureEntry = buildEntry({
      serviceId: 'svc-soon',
      expiresAt: FIXED_NOW + 1_000,
    });
    const registry = new AutomationServiceRegistry([futureEntry], { now: () => clockMs });
    // Advance past the expiry.
    clockMs = FIXED_NOW + 2_000;
    const r = registry.resolve({
      serviceId: 'svc-soon',
      organizationId: ORG_ID,
      connectionId: CONN_ID,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'credential_expired');
  });

  test('registry resolve rejects unknown service id', () => {
    const registry = new AutomationServiceRegistry([buildEntry()]);
    const r = registry.resolve({
      serviceId: 'svc-unknown',
      organizationId: ORG_ID,
      connectionId: CONN_ID,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'unknown_service');
  });

  test('mismatched HMAC signature -> 401 AUTHENTICATION_REQUIRED', async () => {
    const { gateway } = makeGateway();
    const envelope = makeEnvelope('listDueNextActions');
    const args = buildArgs(envelope);
    args.credential.signatureHex = 'deadbeef'.repeat(8);
    const r = await gateway.invoke(args);
    assert.equal(r.httpStatus, 401);
    assert.equal(r.response.errors[0].code, 'AUTHENTICATION_REQUIRED');
    assert.equal(r.internalCode, 'n8n_signature_mismatch');
  });

  test('unknown service id -> 401 AUTHENTICATION_REQUIRED', async () => {
    const { gateway } = makeGateway();
    const envelope = makeEnvelope('listDueNextActions');
    const args = buildArgs(envelope, { credential: { serviceId: 'svc-unknown' } });
    const r = await gateway.invoke(args);
    assert.equal(r.httpStatus, 401);
    assert.equal(r.response.errors[0].code, 'AUTHENTICATION_REQUIRED');
  });
});

// ─────────────────────────────────────────────────────────────────────
// OPERATION ALLOWLIST
// ─────────────────────────────────────────────────────────────────────

describe('operation allowlist', () => {
  test('commandName != operation.op -> 422 VALIDATION_ERROR', async () => {
    const { gateway } = makeGateway();
    const envelope = makeEnvelope('listDueNextActions');
    envelope.commandName = 'adminDropAllTables';
    envelope.operation = {
      op: 'listDueNextActions',
      payload: { schemaVersion: SCHEMA_VERSION, pageSize: 1 },
    };
    const r = await gateway.invoke(buildArgs(envelope));
    assert.equal(r.httpStatus, 422, JSON.stringify(r.response));
    assert.equal(r.response.errors[0].code, 'VALIDATION_ERROR');
    assert.equal(r.internalCode, 'n8n_command_name_mismatch');
  });

  test('operation not in registry allowedOperations -> 403', async () => {
    const restrictedEntry = buildEntry({ allowedOperations: ['listDueNextActions'] });
    const { gateway } = makeGateway({ entries: [restrictedEntry] });
    const envelope = makeEnvelope('getNextAction'); // not in allowed list
    const r = await gateway.invoke(buildArgs(envelope));
    assert.equal(r.httpStatus, 403);
    assert.equal(r.response.errors[0].code, 'FORBIDDEN');
    assert.equal(r.internalCode, 'n8n_operation_not_allowed');
  });
});

// ─────────────────────────────────────────────────────────────────────
// PROVIDER OFFLINE + TIMEOUT
// ─────────────────────────────────────────────────────────────────────

describe('provider offline + timeout', () => {
  test('adapter offline -> 503 DEPENDENCY_UNAVAILABLE', async () => {
    const { gateway, adapter } = makeGateway();
    adapter.simulateOffline(FIXED_NOW + 10_000);
    const r = await gateway.invoke(buildArgs(makeEnvelope('listDueNextActions')));
    assert.equal(r.httpStatus, 503);
    assert.equal(r.response.errors[0].code, 'DEPENDENCY_UNAVAILABLE');
    assert.equal(r.internalCode, 'n8n_dependency_offline');
  });

  test('adapter times out -> 503 DEPENDENCY_UNAVAILABLE', async () => {
    const { gateway, adapter } = makeGateway();
    adapter.simulateTimeoutOnce();
    const r = await gateway.invoke(
      buildArgs(makeEnvelope('listDueNextActions'), { timeoutMs: 50 }),
    );
    assert.equal(r.httpStatus, 503);
    assert.equal(r.response.errors[0].code, 'DEPENDENCY_UNAVAILABLE');
    assert.equal(r.internalCode, 'n8n_timeout');
  });
});

// ─────────────────────────────────────────────────────────────────────
// KILL SWITCH
// ─────────────────────────────────────────────────────────────────────

describe('kill switch', () => {
  test('workflow-specific kill switch -> 503', async () => {
    const { gateway, killSwitch } = makeGateway();
    killSwitch.setRule({
      target: { workflowId: 'wf-sla-reminder', connectionId: CONN_ID, organizationId: ORG_ID },
      active: true,
      reason: 'INCIDENT',
      note: 'test',
      issuedBy: 'test',
    });
    const r = await gateway.invoke(buildArgs(makeEnvelope('listDueNextActions')));
    assert.equal(r.httpStatus, 503);
    assert.equal(r.response.errors[0].code, 'DEPENDENCY_UNAVAILABLE');
    assert.equal(r.internalCode, 'n8n_kill_switch_active');
    assert.ok(r.logEntry.killSwitchRuleId);
  });

  test('connection-wide kill switch affects all workflows', async () => {
    const { gateway, killSwitch } = makeGateway();
    killSwitch.setRule({
      target: { connectionId: CONN_ID, organizationId: ORG_ID },
      active: true,
      reason: 'POLICY',
      note: 'test',
      issuedBy: 'test',
    });
    const envelope = makeEnvelope('listDueNextActions');
    envelope.automationSource.workflowId = 'wf-different';
    const r = await gateway.invoke(buildArgs(envelope));
    assert.equal(r.httpStatus, 503);
  });

  test('organization-wide kill switch', async () => {
    const { gateway, killSwitch } = makeGateway();
    killSwitch.setRule({
      target: { organizationId: ORG_ID },
      active: true,
      reason: 'DEPENDENCY',
      note: 'test',
      issuedBy: 'test',
    });
    const r = await gateway.invoke(buildArgs(makeEnvelope('listDueNextActions')));
    assert.equal(r.httpStatus, 503);
  });

  test('most specific active rule wins', async () => {
    const { gateway, killSwitch } = makeGateway();
    killSwitch.setRule({
      target: { organizationId: ORG_ID },
      active: false,
      reason: 'TEST',
      note: 'org inactive',
      issuedBy: 'test',
    });
    killSwitch.setRule({
      target: { workflowId: 'wf-sla-reminder', connectionId: CONN_ID, organizationId: ORG_ID },
      active: true,
      reason: 'INCIDENT',
      note: 'workflow ACTIVE',
      issuedBy: 'test',
    });
    const r = await gateway.invoke(buildArgs(makeEnvelope('listDueNextActions')));
    assert.equal(r.httpStatus, 503);
    assert.ok(r.logEntry.killSwitchRuleId);
  });

  test('inactive rule does not block', async () => {
    const { gateway, killSwitch } = makeGateway();
    killSwitch.setRule({
      target: { workflowId: 'wf-sla-reminder', connectionId: CONN_ID, organizationId: ORG_ID },
      active: false,
      reason: 'TEST',
      note: 'inactive',
      issuedBy: 'test',
    });
    const r = await gateway.invoke(buildArgs(makeEnvelope('listDueNextActions')));
    assert.equal(r.httpStatus, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────
// RATE LIMIT
// ─────────────────────────────────────────────────────────────────────

describe('rate limit', () => {
  test('burst above per-minute budget -> 429 RATE_LIMITED', async () => {
    const { gateway } = makeGateway({ rateCapacity: 2, perMinute: 2 });
    for (let i = 0; i < 2; i += 1) {
      const r = await gateway.invoke(buildArgs(makeEnvelope('listDueNextActions')));
      assert.equal(r.httpStatus, 200, 'call ' + i);
    }
    const r3 = await gateway.invoke(buildArgs(makeEnvelope('listDueNextActions')));
    assert.equal(r3.httpStatus, 429);
    assert.equal(r3.response.errors[0].code, 'RATE_LIMITED');
    assert.equal(r3.internalCode, 'n8n_rate_limited');
  });
});

// ─────────────────────────────────────────────────────────────────────
// PAYLOAD SIZE
// ─────────────────────────────────────────────────────────────────────

describe('payload size', () => {
  test('request body > maxPayloadBytes -> 422 VALIDATION_ERROR', async () => {
    const { gateway } = makeGateway({ config: { maxPayloadBytes: 1024 } });
    const envelope = makeEnvelope('listDueNextActions');
    const args = buildArgs(envelope);
    const oversized = new Uint8Array(2048);
    oversized.fill(0x20);
    args.rawBody = oversized;
    const r = await gateway.invoke(args);
    assert.equal(r.httpStatus, 422);
    assert.equal(r.response.errors[0].code, 'VALIDATION_ERROR');
    assert.equal(r.internalCode, 'n8n_payload_too_large');
  });
});

// ─────────────────────────────────────────────────────────────────────
// SCHEMA VALIDATION
// ─────────────────────────────────────────────────────────────────────

describe('schema validation', () => {
  test('missing automationSource -> fails', async () => {
    const { gateway } = makeGateway();
    const envelope = makeEnvelope('listDueNextActions');
    delete envelope.automationSource;
    const r = await gateway.invoke(buildArgs(envelope));
    assert.equal(r.httpStatus, 503);
    assert.equal(r.response.errors[0].code, 'UNKNOWN_COMMAND_OUTCOME');
    assert.equal(r.internalCode, 'n8n_internal_error');
  });

  test('extra unknown field on envelope -> fails closed', async () => {
    const { gateway } = makeGateway();
    const envelope = makeEnvelope('listDueNextActions');
    envelope.unknownField = 'should fail';
    const r = await gateway.invoke(buildArgs(envelope));
    assert.equal(r.httpStatus, 503);
    assert.equal(r.response.errors[0].code, 'UNKNOWN_COMMAND_OUTCOME');
  });
});

// ─────────────────────────────────────────────────────────────────────
// REDACTION
// ─────────────────────────────────────────────────────────────────────

describe('redaction', () => {
  test('wire response never includes secret, signature, or actor kind', async () => {
    const { gateway } = makeGateway();
    const envelope = makeEnvelope('listDueNextActions');
    const args = buildArgs(envelope);
    const r = await gateway.invoke(args);
    const wire = JSON.stringify(r.response);
    assert.ok(!wire.includes(SECRET), 'wire contains secret');
    assert.ok(!wire.includes(args.credential.signatureHex), 'wire contains signature');
    assert.ok(!wire.includes('SERVICE'), 'wire contains actor kind');
    assert.ok(!wire.includes('SENT'), 'wire contains notification outcome');
  });

  test('redacted log entry contains no secret, signature, or PII', async () => {
    const { gateway } = makeGateway();
    const envelope = makeEnvelope('listDueNextActions');
    const args = buildArgs(envelope);
    const r = await gateway.invoke(args);
    const logJson = JSON.stringify(r.logEntry);
    assert.ok(!logJson.includes(SECRET), 'log contains secret');
    assert.ok(!logJson.includes(args.credential.signatureHex), 'log contains signature');
  });
});

// ─────────────────────────────────────────────────────────────────────
// INTERNAL CODE ISOLATION
// ─────────────────────────────────────────────────────────────────────

describe('internal codes isolation', () => {
  test('wire response never contains n8n_* internal codes', async () => {
    const { gateway } = makeGateway();
    const envelope = makeEnvelope('listDueNextActions');
    const args = buildArgs(envelope, { signatureHex: 'bad' });
    const r = await gateway.invoke(args);
    const wire = JSON.stringify(r.response);
    assert.ok(!/n8n_/i.test(wire), 'wire contains n8n_* code: ' + wire);
  });

  test('log entry contains internal code (for audit)', async () => {
    const { gateway } = makeGateway();
    const envelope = makeEnvelope('listDueNextActions');
    const args = buildArgs(envelope, { signatureHex: 'bad' });
    const r = await gateway.invoke(args);
    assert.equal(r.internalCode, 'n8n_signature_mismatch');
  });
});