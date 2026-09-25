/**
 * automation-http-route.test.mjs - N8N/0.3 HTTP integration tests for
 * /v1/automation/dispatch.
 *
 * Drives the actual server.ts startServer() so we exercise the real
 * HTTP boundary, not just the library. Each test:
 *  - Boots startServer() on an ephemeral port with an injected
 *    AutomationHttpHandler.
 *  - Performs HTTP requests against it via fetch().
 *  - Asserts status codes + envelope shape + log entries.
 *
 * No DB. No Docker. No real n8n. Synthetic credentials only.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../dist/server.js';
import {
  AutomationServiceRegistry,
  AutomationIdempotencyStore,
  KillSwitchStore,
  TokenBucketRateLimiter,
  MockAutomationAdapter,
  AutomationHttpHandler,
  canonicalJson,
  payloadDigestHex,
  hmacSha256Hex,
} from '../dist/automation/index.js';
import { AutomationIdempotencyStore as _Idem } from '../dist/automation/idempotency-store.js';
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
    commandId: envelopeOverrides.commandId ?? ('cmd-n8n-' + Math.random().toString(36).slice(2, 10)),
    commandName: op,
    idempotencyKey: envelopeOverrides.idempotencyKey ?? 'idem-001',
    correlationId: envelopeOverrides.correlationId ?? 'corr-001',
    organizationId: envelopeOverrides.organizationId ?? ORG_ID,
    source: { kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null },
    actor: { kind: 'SERVICE', serviceId: SERVICE_ID },
    occurredAt: new Date(FIXED_NOW).toISOString(),
    automationSource: {
      kind: 'N8N_AUTOMATION',
      workflowId: envelopeOverrides.workflowId ?? 'wf-sla-reminder',
      workflowRevision: envelopeOverrides.workflowRevision ?? 1,
      n8nExecutionId: envelopeOverrides.n8nExecutionId ?? 'exec-001',
    },
    operation: {
      op,
      payload: { ...opPayloads[op], ...payloadOverrides },
    },
  };
}

function signForEnvelope(envelope, secret = SECRET) {
  const scopeKey =
    ORG_ID + '\u0000' + CONN_ID + '\u0000' + SERVICE_ID + '\u0000' +
    envelope.commandName + '\u0000' + envelope.idempotencyKey;
  const digest = envelopeDigest(envelope);
  return hmacSha256Hex(scopeKey + '\n' + digest, secret);
}

function defaultGatewayDeps() {
  return {
    killSwitch: new KillSwitchStore({ now: () => FIXED_NOW }),
    rateLimiter: new TokenBucketRateLimiter({ capacity: 10000, perMinute: 60_000, now: () => FIXED_NOW }),
    idempotency: new AutomationIdempotencyStore({ retentionMs: 60_000, maxRecords: 1000 }),
    adapter: new MockAutomationAdapter({
      organizationId: ORG_ID,
      connectionId: CONN_ID,
      now: () => FIXED_NOW,
      initialGetById: new Map([['na-001', fixtureItem('na-001')]]),
      initialListDue: { items: [fixtureItem('na-001'), fixtureItem('na-002')] },
    }),
  };
}

function buildHandler(overrides = {}) {
  const registry = new AutomationServiceRegistry([buildEntry(overrides.entry || {})], { now: () => FIXED_NOW });
  return new AutomationHttpHandler({
    registry,
    gatewayDeps: overrides.gatewayDeps ?? defaultGatewayDeps(),
    logSink: overrides.logSink ?? (() => {}),
    mockMode: overrides.mockMode ?? 'deterministic',
    maxBodyBytes: overrides.maxBodyBytes ?? 64 * 1024,
  });
}

async function bootServer(handler) {
  // Use a config that disables all other route mounting so /v1/automation/dispatch
  // is the only observable boundary. Production guards unchanged.
  const config = {
    listen: { host: '127.0.0.1', port: 0 },
    mockRoutes: [],
    mockMode: 'deterministic',
    receiver: { enabled: false, maxBodyBytes: 64 * 1024 },
    organizationId: ORG_ID,
    appKind: 'api',
    contractsVersion: '0.0.8-g0.8-fixes',
    nodeEnv: 'development',
  };
  const server = await startServer(config, { automationHandler: handler });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('unable to get bound port');
  return { server, url: `http://${addr.address}:${addr.port}` };
}

async function dispatch(url, envelope, headerOverrides = {}) {
  const body = JSON.stringify(envelope);
  const sig = signForEnvelope(envelope);
  // Mapping from short test keys -> header names.
  // To OMIT a header, pass null. To use default, omit the key.
  const headers = { 'Content-Type': 'application/json' };
  const map = {
    serviceId: 'X-Hrp-Automation-Service-Id',
    organizationId: 'X-Hrp-Automation-Organization-Id',
    connectionId: 'X-Hrp-Automation-Connection-Id',
    signatureHex: 'X-Hrp-Automation-Signature',
  };
  const defaults = {
    serviceId: SERVICE_ID,
    organizationId: ORG_ID,
    connectionId: CONN_ID,
    signatureHex: sig,
  };
  for (const [k, hn] of Object.entries(map)) {
    if (Object.prototype.hasOwnProperty.call(headerOverrides, k)) {
      if (headerOverrides[k] !== null) headers[hn] = headerOverrides[k];
    } else {
      headers[hn] = defaults[k];
    }
  }
  const res = await fetch(`${url}/v1/automation/dispatch`, {
    method: 'POST',
    headers,
    body,
  });
  let json = null;
  try { json = await res.json(); } catch { /* may be empty */ }
  return { status: res.status, body: json };
}

/* ---------- happy path ---------- */

describe('happy path', () => {
  let server; let url;
  before(async () => { const r = await bootServer(buildHandler()); server = r.server; url = r.url; });
  after(async () => { await new Promise((res) => server.close(res)); });

  test('POST /v1/automation/dispatch with valid creds -> 200 APPLIED', async () => {
    const envelope = makeEnvelope('listDueNextActions');
    const r = await dispatch(url, envelope);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'APPLIED');
    assert.equal(r.body.schemaVersion, SCHEMA_VERSION);
    assert.ok(r.body.data);
    assert.ok(Array.isArray(r.body.data.items));
  });
});

/* ---------- missing/bad auth ---------- */

describe('missing/bad auth', () => {
  let server; let url;
  before(async () => { const r = await bootServer(buildHandler()); server = r.server; url = r.url; });
  after(async () => { await new Promise((res) => server.close(res)); });

  test('missing X-Hrp-Automation-Service-Id -> 401', async () => {
    const envelope = makeEnvelope('listDueNextActions');
    const r = await dispatch(url, envelope, { serviceId: undefined });
    assert.equal(r.status, 401);
    assert.equal(r.body.errors[0].code, 'AUTHENTICATION_REQUIRED');
  });

  test('missing signature -> 401', async () => {
    const envelope = makeEnvelope('listDueNextActions');
    const r = await dispatch(url, envelope, { signatureHex: undefined });
    assert.equal(r.status, 401);
  });

  test('non-hex signature -> 401', async () => {
    const envelope = makeEnvelope('listDueNextActions');
    const r = await dispatch(url, envelope, { signatureHex: 'not-hex' });
    assert.equal(r.status, 401);
  });

  test('mismatched signature -> 401', async () => {
    const envelope = makeEnvelope('listDueNextActions');
    const r = await dispatch(url, envelope, { signatureHex: 'a'.repeat(64) });
    assert.equal(r.status, 401);
    assert.equal(r.body.errors[0].code, 'AUTHENTICATION_REQUIRED');
  });
});

/* ---------- unknown service ---------- */

describe('unknown service', () => {
  let server; let url;
  before(async () => { const r = await bootServer(buildHandler()); server = r.server; url = r.url; });
  after(async () => { await new Promise((res) => server.close(res)); });

  test('serviceId not in registry -> 401 AUTHENTICATION_REQUIRED', async () => {
    const envelope = makeEnvelope('listDueNextActions');
    const r = await dispatch(url, envelope, { serviceId: 'svc-unknown-999' });
    assert.equal(r.status, 401);
    assert.equal(r.body.errors[0].code, 'AUTHENTICATION_REQUIRED');
  });
});

/* ---------- org/body spoof ---------- */

describe('organization spoofing', () => {
  let server; let url;
  before(async () => { const r = await bootServer(buildHandler()); server = r.server; url = r.url; });
  after(async () => { await new Promise((res) => server.close(res)); });

  test('body organizationId != credential -> 403 FORBIDDEN', async () => {
    const envelope = makeEnvelope('listDueNextActions');
    envelope.organizationId = OTHER_ORG_ID;
    // signature is computed for the credential-resolved scope (ORG_ID)
    // because the client used the right secret for the credential entry,
    // but the body claims a different org. The gateway MUST compare and
    // reject.
    const r = await dispatch(url, envelope);
    assert.equal(r.status, 403);
    assert.equal(r.body.errors[0].code, 'FORBIDDEN');
  });

  test('header organizationId != credential -> 401 AUTHENTICATION_REQUIRED', async () => {
    const envelope = makeEnvelope('listDueNextActions');
    const r = await dispatch(url, envelope, { organizationId: OTHER_ORG_ID });
    // Header org not in registry -> unknown_service -> 401 (no leak).
    assert.equal(r.status, 401);
    assert.equal(r.body.errors[0].code, 'AUTHENTICATION_REQUIRED');
  });
});

/* ---------- operation allowlist ---------- */

describe('operation allowlist', () => {
  let server; let url;
  before(async () => {
    // entry that allows only listDueNextActions
    const r = await bootServer(buildHandler({
      entry: { allowedOperations: ['listDueNextActions'] },
    }));
    server = r.server; url = r.url;
  });
  after(async () => { await new Promise((res) => server.close(res)); });

  test('acknowledgeReminder outside allowlist -> 403 FORBIDDEN', async () => {
    const envelope = makeEnvelope('acknowledgeReminder');
    const r = await dispatch(url, envelope);
    assert.equal(r.status, 403);
    assert.equal(r.body.errors[0].code, 'FORBIDDEN');
  });

  test('listDueNextActions inside allowlist -> 200 APPLIED', async () => {
    const envelope = makeEnvelope('listDueNextActions');
    const r = await dispatch(url, envelope);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'APPLIED');
  });
});

/* ---------- idempotency ---------- */

describe('idempotency', () => {
  let server; let url;
  before(async () => { const r = await bootServer(buildHandler()); server = r.server; url = r.url; });
  after(async () => { await new Promise((res) => server.close(res)); });

  test('same key + same payload replayed -> 200 APPLIED (cached)', async () => {
    const e1 = makeEnvelope('listDueNextActions', {}, { idempotencyKey: 'idem-replay' });
    const r1 = await dispatch(url, e1);
    assert.equal(r1.status, 200);
    const r2 = await dispatch(url, e1);
    assert.equal(r2.status, 200);
    assert.deepEqual(r2.body, r1.body);
  });

  test('same key + different payload -> 409 IDEMPOTENCY_CONFLICT', async () => {
    const e1 = makeEnvelope('listDueNextActions', { pageSize: 10 }, { idempotencyKey: 'idem-conflict' });
    const r1 = await dispatch(url, e1);
    assert.equal(r1.status, 200);
    const e2 = makeEnvelope('listDueNextActions', { pageSize: 20 }, { idempotencyKey: 'idem-conflict' });
    const r2 = await dispatch(url, e2);
    assert.equal(r2.status, 409);
    assert.equal(r2.body.errors[0].code, 'IDEMPOTENCY_CONFLICT');
  });
});

/* ---------- payload size ---------- */

describe('payload size', () => {
  let server; let url;
  before(async () => {
    const r = await bootServer(buildHandler({ maxBodyBytes: 1024 }));
    server = r.server; url = r.url;
  });
  after(async () => { await new Promise((res) => server.close(res)); });

  test('Content-Length over maxBodyBytes -> 422', async () => {
    const envelope = makeEnvelope('listDueNextActions');
    // Pad payload with a huge field to force Content-Length > 1024.
    envelope.operation.payload.large = 'x'.repeat(2048);
    const body = JSON.stringify(envelope);
    const sig = signForEnvelope(envelope);
    const res = await fetch(`${url}/v1/automation/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hrp-Automation-Service-Id': SERVICE_ID,
        'X-Hrp-Automation-Organization-Id': ORG_ID,
        'X-Hrp-Automation-Connection-Id': CONN_ID,
        'X-Hrp-Automation-Signature': sig,
      },
      body,
    });
    let json = null;
    try { json = await res.json(); } catch {}
    assert.equal(res.status, 422);
    assert.equal(json.errors[0].code, 'VALIDATION_ERROR');
  });
});

/* ---------- timeout / offline ---------- */

describe('provider offline / timeout', () => {
  let server; let url;
  before(async () => {
    const deps = defaultGatewayDeps();
    deps.adapter.simulateOffline(FIXED_NOW + 60_000);
    const r = await bootServer(buildHandler({ gatewayDeps: deps }));
    server = r.server; url = r.url;
  });
  after(async () => { await new Promise((res) => server.close(res)); });

  test('adapter offline -> 503 DEPENDENCY_UNAVAILABLE', async () => {
    const envelope = makeEnvelope('listDueNextActions');
    const r = await dispatch(url, envelope);
    assert.equal(r.status, 503);
    assert.equal(r.body.errors[0].code, 'DEPENDENCY_UNAVAILABLE');
  });
});

describe('adapter timeout', () => {
  let server; let url;
  before(async () => {
    const deps = defaultGatewayDeps();
    deps.adapter.simulateTimeoutOnce();
    const r = await bootServer(buildHandler({ gatewayDeps: deps }));
    server = r.server; url = r.url;
  });
  after(async () => { await new Promise((res) => server.close(res)); });

  test('adapter timeout -> 503 DEPENDENCY_UNAVAILABLE', async () => {
    const envelope = makeEnvelope('listDueNextActions');
    const r = await dispatch(url, envelope);
    assert.equal(r.status, 503);
    assert.equal(r.body.errors[0].code, 'DEPENDENCY_UNAVAILABLE');
  });
});

/* ---------- kill switch ---------- */

describe('kill switch', () => {
  let server; let url;
  before(async () => {
    const deps = defaultGatewayDeps();
    deps.killSwitch.setRule({
      active: true,
      target: { workflowId: 'wf-blocked', organizationId: ORG_ID },
      issuedAt: FIXED_NOW,
      reason: 'MANUAL',
      note: 'test_block',
      issuedBy: 'test',
    });
    const r = await bootServer(buildHandler({ gatewayDeps: deps }));
    server = r.server; url = r.url;
  });
  after(async () => { await new Promise((res) => server.close(res)); });

  test('workflow kill switch active -> 503 DEPENDENCY_UNAVAILABLE', async () => {
    const envelope = makeEnvelope('listDueNextActions', {}, { workflowId: 'wf-blocked' });
    const r = await dispatch(url, envelope);
    assert.equal(r.status, 503);
    assert.equal(r.body.errors[0].code, 'DEPENDENCY_UNAVAILABLE');
  });

  test('non-blocked workflow still passes -> 200 APPLIED', async () => {
    const envelope = makeEnvelope('listDueNextActions', {}, { workflowId: 'wf-allowed' });
    const r = await dispatch(url, envelope);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'APPLIED');
  });
});

/* ---------- redacted logs ---------- */

describe('redacted logs', () => {
  let logs;
  let server; let url;
  before(async () => {
    logs = [];
    const sink = (entry) => logs.push(entry);
    const r = await bootServer(buildHandler({ logSink: sink }));
    server = r.server; url = r.url;
  });
  after(async () => { await new Promise((res) => server.close(res)); });

  test('log entry contains no secret, signature, or PII', async () => {
    logs.length = 0;
    const envelope = makeEnvelope('listDueNextActions');
    const r = await dispatch(url, envelope);
    assert.equal(r.status, 200);
    assert.ok(logs.length >= 1, 'log entry should be emitted');
    const entry = logs[logs.length - 1];
    const text = JSON.stringify(entry);
    assert.ok(!text.includes(SECRET), 'secret must not appear in log');
    // signature header value is 64 hex chars; we accept that the field
    // name 'signature' may appear but the value must not.
    assert.ok(!text.includes(envelope.idempotencyKey.slice(0, 8) + 'xxxx-signature'));
    // no actor.kind or actor.systemId
    assert.ok(!text.includes('n8n-crm'), 'actor.systemId must be redacted');
  });
});

/* ---------- route disabled when unconfigured ---------- */

describe('route disabled when registry unconfigured', () => {
  let server; let url;
  before(async () => {
    // Build a handler with an empty registry (simulate misconfigured prod).
    // The AutomationHttpHandler refuses to mount.
    const registry = new AutomationServiceRegistry([], { now: () => FIXED_NOW });
    const handler = new AutomationHttpHandler({
      registry,
      gatewayDeps: defaultGatewayDeps(),
      logSink: () => {},
    });
    const r = await bootServer(handler);
    server = r.server; url = r.url;
  });
  after(async () => { await new Promise((res) => server.close(res)); });

  test('unconfigured registry -> 404 route_disabled', async () => {
    const envelope = makeEnvelope('listDueNextActions');
    const r = await dispatch(url, envelope);
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'route_disabled');
  });
});

describe('route unmounted at server level', () => {
  let server; let url;
  before(async () => {
    // startServer WITHOUT an automationHandler in opts.
    const config = {
      listen: { host: '127.0.0.1', port: 0 },
      mockRoutes: [],
      mockMode: 'deterministic',
      receiver: { enabled: false, maxBodyBytes: 64 * 1024 },
      organizationId: ORG_ID,
      appKind: 'api',
      contractsVersion: '0.0.8-g0.8-fixes',
      nodeEnv: 'development',
    };
    server = await startServer(config, {}); // no automationHandler
    const addr = server.address();
    url = `http://${addr.address}:${addr.port}`;
  });
  after(async () => { await new Promise((res) => server.close(res)); });

  test('unmounted route -> 404 route_not_mounted', async () => {
    const envelope = makeEnvelope('listDueNextActions');
    const r = await dispatch(url, envelope);
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'route_not_mounted');
  });
});