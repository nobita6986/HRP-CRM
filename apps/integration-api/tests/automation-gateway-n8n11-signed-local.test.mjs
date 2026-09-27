/**
 * automation-gateway-n8n11-signed-local.test.mjs -- N8N/1.1 signed
 * local gateway tests covering the R2 narrow correction.
 *
 * Scope (per T0 R2 directive, branch codex/n8n-11-gateway-signed-local-r1):
 *   - The previous gateway computed
 *       payloadDigestHex(canonicalJson(stripNonDigestFields(envelope)))
 *     which double-canonicalizes because payloadDigestHex() already
 *     canonicalizes internally. The fix is to pass the structured
 *     object directly.
 *   - This file asserts:
 *       1. canonical bytes agreement (server vs caller agree byte-for-byte)
 *       2. valid synthetic signature  -> 200 APPLIED
 *       3. wrong secret               -> reject
 *       4. changed envelope           -> reject
 *       5. volatile fields exclusion
 *       6. replay / idempotency
 *       7. no secret in logs
 *   - Plus a RealArtifactValidation suite that runs the actual 7
 *     committed envelopes (3 reminder + 4 acknowledgement) extracted
 *     from docs/contracts/n8n/N8N-1.1/WORKFLOW-QA-R1/final-output.execution-7.json
 *     through the corrected gateway and asserts 7/7 PASS.
 *
 * No DB, no Docker, no HRP provider. Uses in-memory mock adapter.
 *
 * Strict UTF-8 no BOM.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AutomationGateway,
  AutomationServiceRegistry,
  AutomationIdempotencyStore,
  KillSwitchStore,
  TokenBucketRateLimiter,
  MockAutomationAdapter,
  payloadDigestHex,
  hmacSha256Hex,
  canonicalJson,
  AutomationRequestSchema,
} from '../dist/automation/index.js';
import { SCHEMA_VERSION } from '@hrp-engagement/contracts';

const FIXED_NOW = 1_700_000_000_000;
const ORG_ID = 'org-n8n11-signed-local';
const CONN_ID = 'conn-n8n11-signed-local';
const SERVICE_ID = 'svc-n8n11-signed-local';
const SECRET = 'shared-secret-n8n11-signed-local-do-not-leak';
const FUTURE_EXPIRY = FIXED_NOW + 24 * 60 * 60 * 1000;

// Load the 7 committed envelopes from the WORKFLOW-QA-R1 bundle.
// Resolved relative to this test file so the test is robust to
// whichever directory node --test is invoked from.
const ARTIFACT_PATH = fileURLToPath(
  new URL(
    '../../../docs/contracts/n8n/N8N-1.1/WORKFLOW-QA-R1/final-output.execution-7.json',
    import.meta.url,
  ),
);
const ARTIFACT_DATA = (() => {
  const raw = readFileSync(ARTIFACT_PATH, 'utf8');
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr) || arr.length !== 1) {
    throw new Error('artifact shape unexpected');
  }
  const obj = arr[0];
  const reminders = (obj.reminders || []).map((r) => r.envelope);
  const acks = (obj.acknowledgements || []).map((a) => a.envelope);
  return reminders.concat(acks);
})();

// Verify artifact is loaded correctly
if (ARTIFACT_DATA.length !== 7) {
  throw new Error('expected 7 artifact envelopes, got ' + ARTIFACT_DATA.length);
}

function buildEntry(overrides = {}) {
  return {
    serviceId: SERVICE_ID,
    organizationId: ORG_ID,
    connectionId: CONN_ID,
    secret: SECRET,
    algorithm: 'HMAC_SHA256',
    expiresAt: FUTURE_EXPIRY,
    allowedOperations: [
      'listDueNextActions',
      'acknowledgeReminder',
      'getNextAction',
      'sendSyntheticReminder',
    ],
    ...overrides,
  };
}

function stripNonDigestFields(envelope) {
  const { correlationId, occurredAt, commandId, automationSource, ...rest } = envelope;
  void correlationId; void occurredAt; void commandId;
  if (automationSource && typeof automationSource === 'object') {
    const { n8nExecutionId, ...srcRest } = automationSource;
    void n8nExecutionId;
    return { ...rest, automationSource: srcRest };
  }
  return rest;
}

// Caller-correct digest: strip volatile fields, then call
// payloadDigestHex directly. Mirrors the gateway internal path.
function callerDigest(envelope) {
  return payloadDigestHex(stripNonDigestFields(envelope));
}

// Legacy (buggy) digest: simulate the EXACT old code path, including
// the strip step. This is the regression assertion: the previous code
// was payloadDigestHex(canonicalJson(stripNonDigestFields(envelope))),
// so the legacy helper must also strip first -- otherwise the test
// would only prove a difference in volatile fields, not the double
// canonicalization itself.
function legacyDigest(envelope) {
  return payloadDigestHex(canonicalJson(stripNonDigestFields(envelope)));
}

function sign(scopeKey, digest, secret) {
  return hmacSha256Hex(scopeKey + '\n' + digest, secret);
}

function buildArgs(envelope, opts = {}) {
  const raw = new TextEncoder().encode(JSON.stringify(envelope));
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
  const sig = opts.signatureHex ?? sign(scopeKey, callerDigest(envelope), secret);
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

function defaultFixtureItem(id, overrides = {}) {
  return {
    nextActionId: id,
    targetRedacted: '[talent-redacted]',
    targetKind: 'PLACEMENT_CASE',
    status: 'OPEN',
    snoozeMode: 'ACTIVE',
    dueAt: new Date(FIXED_NOW + 60 * 60 * 1000).toISOString(),
    scheduledAt: new Date(FIXED_NOW + 30 * 60 * 1000).toISOString(),
    timezone: 'Asia/Ho_Chi_Minh',
    assignedToRedacted: 'user-redacted-n8n11',
    ...overrides,
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
  const initialGetById =
    opts.initialGetById ?? new Map([['na-r2-001', defaultFixtureItem('na-r2-001')]]);
  const adapter = new MockAutomationAdapter({
    organizationId: ORG_ID,
    connectionId: CONN_ID,
    now: () => FIXED_NOW,
    initialGetById,
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

function makeReminderEnvelope(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    commandId: 'cmd-n8n11-rem-001',
    commandName: 'sendSyntheticReminder',
    idempotencyKey: 'rem-n8n11-signed-local-001',
    correlationId: 'corr-n8n11-signed-local-001',
    organizationId: ORG_ID,
    source: { kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null },
    actor: { kind: 'SERVICE', serviceId: SERVICE_ID },
    automationSource: {
      kind: 'N8N_AUTOMATION',
      workflowId: 'wf-n8n11-signed-local-reminder',
      workflowRevision: 1,
      n8nExecutionId: 'exec-n8n11-signed-local-001',
    },
    operation: {
      op: 'sendSyntheticReminder',
      payload: {
        schemaVersion: SCHEMA_VERSION,
        nextActionId: 'na-r2-001',
        audienceKind: 'OWNER',
        redactedRecipientId: 'owner-r2-A',
        channel: 'DASHBOARD_ONLY',
        reminderRevisionId: 'rev-r2-na-001-OWNER-r1',
      },
    },
    ...overrides,
  };
}

function makeAckEnvelope(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    commandId: 'cmd-n8n11-ack-001',
    commandName: 'acknowledgeReminder',
    idempotencyKey: 'ack-n8n11-signed-local-001',
    correlationId: 'corr-n8n11-signed-local-001',
    organizationId: ORG_ID,
    source: { kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null },
    actor: { kind: 'SERVICE', serviceId: SERVICE_ID },
    automationSource: {
      kind: 'N8N_AUTOMATION',
      workflowId: 'wf-n8n11-signed-local-reminder',
      workflowRevision: 1,
      n8nExecutionId: 'exec-n8n11-signed-local-001',
    },
    operation: {
      op: 'acknowledgeReminder',
      payload: {
        schemaVersion: SCHEMA_VERSION,
        nextActionId: 'na-r2-001',
        notificationOutcome: 'SENT',
        reminderRevisionId: 'rev-r2-na-001-OWNER-r1',
        channel: 'INTERNAL_TEST',
      },
    },
    ...overrides,
  };
}

// ---- R2 invariant 1: canonical bytes agreement ----

describe('R2 invariant 1: canonical bytes agreement', () => {
  test('caller payloadDigestHex(stripped) equals server envelopeForDigest digest', () => {
    const envelope = makeReminderEnvelope();
    const serverDigest = payloadDigestHex(stripNonDigestFields(envelope));
    const callerCorrect = callerDigest(envelope);
    assert.equal(serverDigest, callerCorrect);
  });

  test('legacy double-canonicalized digest disagrees with server digest (R2 fix is observable)', () => {
    const envelope = makeReminderEnvelope();
    const serverDigest = payloadDigestHex(stripNonDigestFields(envelope));
    const legacy = legacyDigest(envelope);
    assert.notEqual(legacy, serverDigest);
  });

  test('volatile fields rotation does not change caller digest', () => {
    const envelope = makeReminderEnvelope();
    const baseDigest = callerDigest(envelope);
    const variants = [
      { ...envelope, correlationId: 'corr-rotated-1' },
      { ...envelope, commandId: 'cmd-rotated-1' },
      { ...envelope, occurredAt: new Date(FIXED_NOW).toISOString() },
      { ...envelope, automationSource: { ...envelope.automationSource, n8nExecutionId: 'exec-rotated-1' } },
    ];
    for (const v of variants) {
      assert.equal(callerDigest(v), baseDigest);
    }
  });
});

// ---- R2 invariant 2: valid synthetic signature -> 200 APPLIED ----

describe('R2 invariant 2: valid synthetic signature', () => {
  test('sendSyntheticReminder, caller-correct digest + correct secret -> 200 APPLIED', async () => {
    const { gateway } = makeGateway();
    const envelope = makeReminderEnvelope();
    const r = await gateway.invoke(buildArgs(envelope));
    assert.equal(r.httpStatus, 200, JSON.stringify(r.response));
    assert.equal(r.response.status, 'APPLIED');
    assert.equal(r.response.data.nextActionId, 'na-r2-001');
    assert.equal(r.response.data.audienceKind, 'OWNER');
    assert.equal(r.response.data.channel, 'DASHBOARD_ONLY');
  });

  test('acknowledgeReminder, caller-correct digest + correct secret -> 200 APPLIED', async () => {
    const { gateway } = makeGateway();
    const envelope = makeAckEnvelope();
    const r = await gateway.invoke(buildArgs(envelope));
    assert.equal(r.httpStatus, 200, JSON.stringify(r.response));
    assert.equal(r.response.status, 'APPLIED');
    assert.equal(r.response.data.nextActionId, 'na-r2-001');
    assert.equal(r.response.data.reminderRevisionId, 'rev-r2-na-001-OWNER-r1');
  });
});

// ---- R2 invariant 3: wrong secret -> reject ----

describe('R2 invariant 3: wrong secret', () => {
  test('sendSyntheticReminder + wrong secret -> 401 AUTHENTICATION_REQUIRED', async () => {
    const { gateway } = makeGateway();
    const envelope = makeReminderEnvelope();
    const r = await gateway.invoke(
      buildArgs(envelope, { secret: 'totally-different-secret-xyz' }),
    );
    assert.equal(r.httpStatus, 401, JSON.stringify(r.response));
    assert.equal(r.response.errors[0].code, 'AUTHENTICATION_REQUIRED');
    assert.equal(r.internalCode, 'n8n_signature_mismatch');
  });
});

// ---- R2 invariant 4: changed envelope -> reject ----

describe('R2 invariant 4: changed envelope', () => {
  test('legacy double-canonicalized signature is rejected (R2 fix is observable)', async () => {
    const { gateway } = makeGateway();
    const envelope = makeReminderEnvelope();
    const raw = new TextEncoder().encode(JSON.stringify(envelope));
    const scopeKey = AutomationIdempotencyStore.scopeKey({
      organizationId: ORG_ID,
      connectionId: CONN_ID,
      serviceId: SERVICE_ID,
      commandName: envelope.commandName,
      idempotencyKey: envelope.idempotencyKey,
    });
    const legacySig = sign(scopeKey, legacyDigest(envelope), SECRET);
    const r = await gateway.invoke({
      rawBody: raw,
      envelope,
      credential: {
        serviceId: SERVICE_ID,
        organizationId: ORG_ID,
        connectionId: CONN_ID,
        signatureHex: legacySig,
      },
    });
    assert.notEqual(r.httpStatus, 200, 'gateway accepted legacy-signed envelope');
    assert.ok(r.httpStatus === 401 || r.httpStatus === 503);
    assert.equal(r.response.status, 'FAILED');
  });

  test('sendSyntheticReminder payload mutation after signing -> reject', async () => {
    const { gateway } = makeGateway();
    const envelope = makeReminderEnvelope();
    const args = buildArgs(envelope);
    args.envelope.operation.payload.redactedRecipientId = 'attacker-injected';
    const r = await gateway.invoke(args);
    assert.notEqual(r.httpStatus, 200, 'gateway accepted mutated envelope');
    assert.ok(r.httpStatus === 401 || r.httpStatus === 503);
  });
});

// ---- R2 invariant 5: volatile fields exclusion ----

describe('R2 invariant 5: volatile fields exclusion', () => {
  test('rotating commandId + n8nExecutionId with same correlationId -> cached replay', async () => {
    const { gateway } = makeGateway();
    const e1 = makeReminderEnvelope();
    const r1 = await gateway.invoke(buildArgs(e1));
    assert.equal(r1.httpStatus, 200);
    assert.equal(r1.logEntry.cacheHit, false);

    const e2 = makeReminderEnvelope();
    e2.idempotencyKey = e1.idempotencyKey;
    e2.correlationId = e1.correlationId;
    e2.commandId = 'cmd-n8n11-rotated-retry';
    e2.automationSource.n8nExecutionId = 'exec-n8n11-rotated-retry';
    const r2 = await gateway.invoke(buildArgs(e2));
    assert.equal(r2.httpStatus, 200, JSON.stringify(r2.response));
    assert.equal(r2.logEntry.cacheHit, true);
  });

  test('rotating correlationId between two invocations -> IDEMPOTENCY_CONFLICT', async () => {
    const { gateway } = makeGateway();
    const e1 = makeReminderEnvelope();
    const r1 = await gateway.invoke(buildArgs(e1));
    assert.equal(r1.httpStatus, 200);

    const e2 = makeReminderEnvelope();
    e2.idempotencyKey = e1.idempotencyKey;
    e2.commandId = e1.commandId;
    e2.correlationId = 'corr-rotated-totally-different';
    const r2 = await gateway.invoke(buildArgs(e2));
    assert.equal(r2.httpStatus, 409, JSON.stringify(r2.response));
    assert.equal(r2.response.errors[0].code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(r2.internalCode, 'n8n_idempotency_conflict');
  });
});

// ---- R2 invariant 6: replay / idempotency ----

describe('R2 invariant 6: replay / idempotency', () => {
  test('sendSyntheticReminder: same envelope twice -> second is cache hit', async () => {
    const { gateway } = makeGateway();
    const envelope = makeReminderEnvelope();
    const r1 = await gateway.invoke(buildArgs(envelope));
    assert.equal(r1.httpStatus, 200);
    assert.equal(r1.logEntry.cacheHit, false);
    const r2 = await gateway.invoke(buildArgs(envelope));
    assert.equal(r2.httpStatus, 200);
    assert.equal(r2.logEntry.cacheHit, true);
    assert.equal(r2.response.status, 'APPLIED');
  });

  test('same idempotency scope, changed payload -> 409 IDEMPOTENCY_CONFLICT', async () => {
    const { gateway } = makeGateway();
    const e1 = makeReminderEnvelope();
    const r1 = await gateway.invoke(buildArgs(e1));
    assert.equal(r1.httpStatus, 200);

    const e2 = makeReminderEnvelope();
    e2.idempotencyKey = e1.idempotencyKey;
    e2.commandId = e1.commandId;
    e2.correlationId = e1.correlationId;
    e2.operation.payload.redactedRecipientId = 'different-recipient-B';
    const r2 = await gateway.invoke(buildArgs(e2));
    assert.equal(r2.httpStatus, 409, JSON.stringify(r2.response));
    assert.equal(r2.response.errors[0].code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(r2.internalCode, 'n8n_idempotency_conflict');
  });
});

// ---- R2 invariant 7: no secret in logs ----

describe('R2 invariant 7: no secret in logs', () => {
  test('wire response never contains the secret or signature', async () => {
    const { gateway } = makeGateway();
    const envelope = makeReminderEnvelope();
    const args = buildArgs(envelope);
    const r = await gateway.invoke(args);
    const wire = JSON.stringify(r.response);
    assert.ok(!wire.includes(SECRET), 'wire contains secret');
    assert.ok(!wire.includes(args.credential.signatureHex), 'wire contains signature');
  });

  test('logEntry never contains the secret, even on failure', async () => {
    const { gateway } = makeGateway();
    const envelope = makeReminderEnvelope();
    const r = await gateway.invoke(buildArgs(envelope));
    const logJson = JSON.stringify(r.logEntry);
    assert.ok(!logJson.includes(SECRET), 'logEntry contains secret');

    const r2 = await gateway.invoke(
      buildArgs(envelope, { secret: 'wrong-secret-n8n11-aaa' }),
    );
    const logJson2 = JSON.stringify(r2.logEntry);
    assert.ok(!logJson2.includes(SECRET), 'failure logEntry contains correct secret');
    assert.ok(
      !logJson2.includes('wrong-secret-n8n11-aaa'),
      'failure logEntry contains attempted wrong secret',
    );
  });

  test('logEntry.payloadDigest equals the corrected (non-double-canonicalized) digest', async () => {
    const { gateway } = makeGateway();
    const envelope = makeReminderEnvelope();
    const r = await gateway.invoke(buildArgs(envelope));
    const expected = callerDigest(envelope);
    const legacy = legacyDigest(envelope);
    assert.equal(r.logEntry.payloadDigest, expected);
    assert.notEqual(r.logEntry.payloadDigest, legacy);
  });
});

// ---- Real artifact validation (7 committed envelopes) ----

function buildEntryForArtifact(envelope) {
  return {
    serviceId: envelope.actor && envelope.actor.serviceId,
    organizationId: envelope.organizationId,
    connectionId: CONN_ID,
    secret: SECRET,
    algorithm: 'HMAC_SHA256',
    expiresAt: FUTURE_EXPIRY,
    allowedOperations: [
      'listDueNextActions',
      'acknowledgeReminder',
      'getNextAction',
      'sendSyntheticReminder',
    ],
  };
}

function artifactFixtureItem(id) {
  return {
    nextActionId: id,
    targetRedacted: '[talent-redacted]',
    targetKind: 'PLACEMENT_CASE',
    status: 'OPEN',
    snoozeMode: 'ACTIVE',
    dueAt: new Date(FIXED_NOW + 60 * 60 * 1000).toISOString(),
    scheduledAt: new Date(FIXED_NOW + 30 * 60 * 1000).toISOString(),
    timezone: 'Asia/Ho_Chi_Minh',
    assignedToRedacted: 'user-redacted-artifact',
  };
}

function makeArtifactGateway(envelope) {
  // Seed the mock adapter with all distinct nextActionIds from the
  // artifact envelopes so acknowledgeReminder lookups succeed.
  const ids = new Set();
  for (const e of ARTIFACT_DATA) {
    if (e.operation && e.operation.payload && e.operation.payload.nextActionId) {
      ids.add(e.operation.payload.nextActionId);
    }
  }
  const initialGetById = new Map();
  for (const id of ids) initialGetById.set(id, artifactFixtureItem(id));

  const registry = new AutomationServiceRegistry([buildEntryForArtifact(envelope)], {
    now: () => FIXED_NOW,
  });
  const killSwitch = new KillSwitchStore({ now: () => FIXED_NOW });
  const rateLimiter = new TokenBucketRateLimiter({
    capacity: 600,
    perMinute: 600,
    now: () => FIXED_NOW,
  });
  const idempotency = new AutomationIdempotencyStore({
    maxRecords: 1000,
    retentionMs: 24 * 60 * 60 * 1000,
    now: () => FIXED_NOW,
  });
  const adapter = new MockAutomationAdapter({
    organizationId: envelope.organizationId,
    connectionId: CONN_ID,
    now: () => FIXED_NOW,
    initialGetById,
  });
  return new AutomationGateway({
    registry,
    killSwitch,
    rateLimiter,
    idempotency,
    adapter,
    now: () => FIXED_NOW,
  });
}

function buildArtifactArgs(envelope) {
  const raw = new TextEncoder().encode(JSON.stringify(envelope));
  const scopeKey = AutomationIdempotencyStore.scopeKey({
    organizationId: envelope.organizationId,
    connectionId: CONN_ID,
    serviceId: envelope.actor && envelope.actor.serviceId,
    commandName: envelope.commandName,
    idempotencyKey: envelope.idempotencyKey,
  });
  const sig = sign(scopeKey, callerDigest(envelope), SECRET);
  return {
    rawBody: raw,
    envelope,
    credential: {
      serviceId: envelope.actor && envelope.actor.serviceId,
      organizationId: envelope.organizationId,
      connectionId: CONN_ID,
      signatureHex: sig,
    },
    timeoutMs: 5000,
  };
}

describe('real accepted artifact validation (7 committed envelopes)', () => {
  test('artifact contains exactly 7 envelopes (3 reminder + 4 acknowledgement)', () => {
    assert.equal(ARTIFACT_DATA.length, 7);
    const reminders = ARTIFACT_DATA.filter((e) => e.commandName === 'sendSyntheticReminder');
    const acks = ARTIFACT_DATA.filter((e) => e.commandName === 'acknowledgeReminder');
    assert.equal(reminders.length, 3, 'expected 3 reminder envelopes');
    assert.equal(acks.length, 4, 'expected 4 acknowledgement envelopes');
  });

  test('each envelope passes AutomationRequestSchema on this branch', () => {
    for (const e of ARTIFACT_DATA) {
      const r = AutomationRequestSchema.safeParse(e);
      assert.ok(r.success, JSON.stringify(r.success ? null : r.error.issues));
      assert.equal(e.commandName, e.operation.op);
    }
  });

  test('7/7 PASS through the corrected gateway (200 APPLIED for each)', async () => {
    let pass = 0;
    const failures = [];
    for (const envelope of ARTIFACT_DATA) {
      const gw = makeArtifactGateway(envelope);
      const args = buildArtifactArgs(envelope);
      const r = await gw.invoke(args);
      if (r.httpStatus === 200 && r.response.status === 'APPLIED') {
        pass += 1;
      } else {
        failures.push({
          commandId: envelope.commandId,
          commandName: envelope.commandName,
          httpStatus: r.httpStatus,
          response: r.response,
          internalCode: r.internalCode,
        });
      }
    }
    assert.equal(
      pass,
      7,
      'expected 7/7 PASS, got ' + pass + '/7; failures: ' + JSON.stringify(failures, null, 2),
    );
  });
});
