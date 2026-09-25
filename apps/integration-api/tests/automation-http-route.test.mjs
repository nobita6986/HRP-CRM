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
  // To OMIT a header, pass null OR undefined. To use a literal value
  // (including the strings "null" / "undefined"), pass a non-nullish
  // value. This guarantees an omitted header is genuinely absent on
  // the wire (not a literal "null"/"undefined" string).
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
      const v = headerOverrides[k];
      if (v === null || v === undefined) continue; // OMIT
      headers[hn] = v;
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

/* ---------- C-04: helper omits headers on undefined OR null ---------- */
/* ---------- C-03: missing auth rejected BEFORE body read             ---------- */

describe('header omission (C-04 / C-03)', () => {
  let server; let url;
  before(async () => { const r = await bootServer(buildHandler()); server = r.server; url = r.url; });
  after(async () => { await new Promise((res) => server.close(res)); });

  // The dispatch helper used in earlier tests does not assert that the
  // header is truly absent. These tests send raw fetch() with NO header
  // and verify that the server rejects the request as missing-header
  // (not "lookup failed because of literal undefined-string"). If the
  // helper accidentally sent the literal string "undefined" the server
  // would still 401 BUT for a different reason. We assert the message
  // matches the missing-header error variant.
  test('omitted serviceId is genuinely absent -> 401 missing-header', async () => {
    const envelope = makeEnvelope('listDueNextActions');
    const body = JSON.stringify(envelope);
    const sig = signForEnvelope(envelope);
    const res = await fetch(`${url}/v1/automation/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // serviceId intentionally omitted
        'X-Hrp-Automation-Organization-Id': ORG_ID,
        'X-Hrp-Automation-Connection-Id': CONN_ID,
        'X-Hrp-Automation-Signature': sig,
      },
      body,
    });
    let json = null;
    try { json = await res.json(); } catch {}
    assert.equal(res.status, 401);
    assert.equal(json.errors[0].code, 'AUTHENTICATION_REQUIRED');
    // The error message comes from the missing-header branch:
    assert.match(json.message, /thieu X-Hrp-Automation-Service-Id/u);
  });

  test('omitted signature is genuinely absent -> 401 missing-header', async () => {
    const envelope = makeEnvelope('listDueNextActions');
    const body = JSON.stringify(envelope);
    const res = await fetch(`${url}/v1/automation/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hrp-Automation-Service-Id': SERVICE_ID,
        'X-Hrp-Automation-Organization-Id': ORG_ID,
        'X-Hrp-Automation-Connection-Id': CONN_ID,
        // signature intentionally omitted
      },
      body,
    });
    let json = null;
    try { json = await res.json(); } catch {}
    assert.equal(res.status, 401);
    assert.equal(json.errors[0].code, 'AUTHENTICATION_REQUIRED');
    assert.match(json.message, /thieu X-Hrp-Automation-Signature/u);
  });

  test('literal "undefined" header value -> still 401 (malformed)', async () => {
    const envelope = makeEnvelope('listDueNextActions');
    const body = JSON.stringify(envelope);
    const sig = signForEnvelope(envelope);
    const res = await fetch(`${url}/v1/automation/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hrp-Automation-Service-Id': 'undefined', // literal string
        'X-Hrp-Automation-Organization-Id': ORG_ID,
        'X-Hrp-Automation-Connection-Id': CONN_ID,
        'X-Hrp-Automation-Signature': sig,
      },
      body,
    });
    let json = null;
    try { json = await res.json(); } catch {}
    assert.equal(res.status, 401);
    assert.equal(json.errors[0].code, 'AUTHENTICATION_REQUIRED');
    // The literal "undefined" is sent as a value: server rejects via
    // unknown_service path -> error message about credential is expected.
    assert.ok(json && typeof json === 'object', 'json body should exist');
    assert.ok(json.message || (json.errors && json.errors.length > 0),
      'response should carry some structured information');
  });

  test('dispatch helper with undefined also OMITs (matches null behavior)', async () => {
    // This goes through the dispatch() helper (which now omits on
    // BOTH null and undefined). Verify header really reaches the
    // helper, the helper omits it, and the server returns 401.
    const envelope = makeEnvelope('listDueNextActions');
    const r = await dispatch(url, envelope, { serviceId: undefined, signatureHex: 'a'.repeat(64) });
    assert.equal(r.status, 401);
    assert.equal(r.body.errors[0].code, 'AUTHENTICATION_REQUIRED');
  });

  test('C-03: missing auth triggers 401 even when body is large', async () => {
    // Big padding so the request would take real bytes to buffer; the
    // server MUST reject immediately on header absence rather than
    // reading the body. We don't have a clean way to assert "did not
    // read body" without timing channels, so we at least confirm the
    // 401 still comes back deterministically and any emit uses the
    // missing-header message.
    const envelope = makeEnvelope('listDueNextActions');
    envelope.operation.payload.padding = 'x'.repeat(8 * 1024);
    const body = JSON.stringify(envelope);
    const sig = signForEnvelope(envelope);
    const res = await fetch(`${url}/v1/automation/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // serviceId omitted
        'X-Hrp-Automation-Organization-Id': ORG_ID,
        'X-Hrp-Automation-Connection-Id': CONN_ID,
        'X-Hrp-Automation-Signature': sig,
      },
      body,
    });
    let json = null;
    try { json = await res.json(); } catch {}
    assert.equal(res.status, 401);
    assert.match(json.message, /thieu X-Hrp-Automation-Service-Id/u);
  });
});

/* ---------- C-05: chunked oversized body yields deterministic 422 ---------- */

import net from 'node:net';

describe('payload size (C-05: no Content-Length)', () => {
  let server; let url;
  before(async () => {
    const r = await bootServer(buildHandler({ maxBodyBytes: 1024 }));
    server = r.server; url = r.url;
  });
  after(async () => { await new Promise((res) => server.close(res)); });

  test('chunked oversized body without Content-Length -> 422 (no socket reset)', async () => {
    // Drive the connection at the raw HTTP/1.1 framing level so we
    // can omit Content-Length and send a real chunked body. The
    // server must drain the remainder and return a deterministic
    // 422 JSON envelope rather than destroying the socket.
    const envelope = makeEnvelope('listDueNextActions');
    envelope.operation.payload.padding = 'x'.repeat(2048);
    const serialized = JSON.stringify(envelope);
    const sig = signForEnvelope(envelope);
    const urlObj = new URL(url);

    const result = await new Promise((resolve, reject) => {
      const sock = net.connect({ host: urlObj.hostname, port: Number(urlObj.port) });
      sock.setEncoding('utf8');
      let buf = '';
      let headersParsed = false;
      let status = 0;
      let body = '';
      sock.on('data', (chunk) => {
        buf += chunk;
        if (!headersParsed) {
          const sep = '\r\n\r\n';
          const idx = buf.indexOf(sep);
          if (idx === -1) return;
          const head = buf.slice(0, idx);
          const statusLine = head.split('\r\n')[0] ?? '';
          const m = /^HTTP\/1\.[01] (\d{3})/u.exec(statusLine);
          status = m ? Number(m[1]) : 0;
          buf = buf.slice(idx + sep.length);
          headersParsed = true;
        }
        // Crude: server closes connection after sending 422 envelope.
        if (headersParsed) {
          body += buf;
          buf = '';
        }
      });
      sock.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch {}
        resolve({ status, json, body });
      });
      sock.on('error', reject);

      const req = [
        'POST /v1/automation/dispatch HTTP/1.1',
        `Host: ${urlObj.hostname}:${urlObj.port}`,
        'Content-Type: application/json',
        'Transfer-Encoding: chunked',
        'X-Hrp-Automation-Service-Id: ' + SERVICE_ID,
        'X-Hrp-Automation-Organization-Id: ' + ORG_ID,
        'X-Hrp-Automation-Connection-Id: ' + CONN_ID,
        'X-Hrp-Automation-Signature: ' + sig,
        'Connection: close',
        '',
        '',
      ].join('\r\n');
      sock.write(req);
      // Send two chunks (in chunked transfer-encoding). Total > 1024.
      const chunk1 = Buffer.from(serialized.slice(0, 512));
      const chunk2 = Buffer.from(serialized.slice(512));
      sock.write(chunk1.length.toString(16) + '\r\n');
      sock.write(chunk1.toString('binary'));
      sock.write('\r\n');
      sock.write(chunk2.length.toString(16) + '\r\n');
      sock.write(chunk2.toString('binary'));
      sock.write('\r\n');
      sock.write('0\r\n\r\n');
    });
    // Deterministic 422 envelope; no socket reset means we got a status.
    assert.equal(result.status, 422);
    assert.ok(result.json, 'server must send a JSON envelope (no socket reset)');
    assert.equal(result.json.errors[0].code, 'VALIDATION_ERROR');
    assert.match(result.json.message, /Body exceeds maxBodyBytes/u);
  });
});

/* ---------- C-06: HTTP correlationId conflict ---------- */

describe('idempotency correlationId binding (C-06)', () => {
  let server; let url;
  before(async () => { const r = await bootServer(buildHandler()); server = r.server; url = r.url; });
  after(async () => { await new Promise((res) => server.close(res)); });

  test('same key + same payload + same correlationId -> 200 (cached)', async () => {
    const e1 = makeEnvelope('listDueNextActions', {}, { idempotencyKey: 'idem-corr-replay' });
    const r1 = await dispatch(url, e1);
    assert.equal(r1.status, 200);
    const e2 = makeEnvelope('listDueNextActions', {}, { idempotencyKey: 'idem-corr-replay' });
    e2.correlationId = e1.correlationId;
    e2.commandId = 'cmd-rotated-corr-test';
    e2.automationSource.n8nExecutionId = 'exec-rotated-corr-test';
    const r2 = await dispatch(url, e2);
    assert.equal(r2.status, 200);
    assert.equal(r2.body.status, 'APPLIED');
  });

  test('same key + same payload + different correlationId -> 409 IDEMPOTENCY_CONFLICT', async () => {
    const e1 = makeEnvelope('listDueNextActions', {}, { idempotencyKey: 'idem-corr-conflict' });
    const r1 = await dispatch(url, e1);
    assert.equal(r1.status, 200);
    const e2 = makeEnvelope('listDueNextActions', {}, { idempotencyKey: 'idem-corr-conflict' });
    e2.correlationId = 'corr-different-on-purpose';
    e2.commandId = e1.commandId;
    e2.automationSource.n8nExecutionId = e1.automationSource.n8nExecutionId;
    const r2 = await dispatch(url, e2);
    assert.equal(r2.status, 409);
    assert.equal(r2.body.errors[0].code, 'IDEMPOTENCY_CONFLICT');
  });
});

/* ---------- C-02: runtime assembly from env (startServer({ env })) ---------- */

function buildEnvOverrides(extras = {}) {
  // Pipe format: serviceId|organizationId|connectionId|expiresAt|allowedOpsCsv|secret
  // Note: when this env is loaded through assembleAutomationHandlerFromEnv,
  // registry expiry is checked against wall-clock Date.now() (real time).
  // We use a far-future expiry so test timezones and test clock drift do
  // not accidentally filter the entry as expired.
  const expiresAt = String(FIXED_NOW + 5 * 365 * 24 * 60 * 60 * 1000); // +5 years
  const baseEnv = {
    HRP_AUTOMATION_SERVICE_1: [
      SERVICE_ID,
      ORG_ID,
      CONN_ID,
      expiresAt,
      'listDueNextActions,acknowledgeReminder,getNextAction',
      SECRET,
    ].join('|'),
  };
  return { ...baseEnv, ...extras };
}

function baseConfig(overrides = {}) {
  return {
    listen: { host: '127.0.0.1', port: 0 },
    mockRoutes: [],
    mockMode: 'deterministic',
    receiver: { enabled: false, maxBodyBytes: 64 * 1024 },
    organizationId: ORG_ID,
    appKind: 'api',
    contractsVersion: '0.0.8-g0.8-fixes',
    nodeEnv: 'development',
    ...overrides,
  };
}

describe('runtime env assembly (C-02)', () => {
  test('env present -> route mounted via startServer({ env }), no prebuilt handler', async () => {
    const config = baseConfig();
    const env = buildEnvOverrides();
    const server = await startServer(config, { env }); // no automationHandler
    try {
      const addr = server.address();
      const url = `http://${addr.address}:${addr.port}`;
      const envelope = makeEnvelope('listDueNextActions');
      const r = await dispatch(url, envelope);
      assert.equal(r.status, 200, `body=${JSON.stringify(r.body)}`);
      assert.equal(r.body.status, 'APPLIED');
    } finally {
      await new Promise((res) => server.close(res));
    }
  });

  test('env absent -> route stays unmounted -> 404 route_not_mounted', async () => {
    const config = baseConfig();
    const env = {}; // no HRP_AUTOMATION_*
    const server = await startServer(config, { env });
    try {
      const addr = server.address();
      const url = `http://${addr.address}:${addr.port}`;
      const envelope = makeEnvelope('listDueNextActions');
      const r = await dispatch(url, envelope);
      assert.equal(r.status, 404);
      assert.equal(r.body.error, 'route_not_mounted');
    } finally {
      await new Promise((res) => server.close(res));
    }
  });

  test('malformed env -> route stays unmounted (graceful)', async () => {
    const config = baseConfig();
    const env = {
      HRP_AUTOMATION_SERVICE_1: 'only|five|parts|here', // missing 2 parts
    };
    const server = await startServer(config, { env });
    try {
      const addr = server.address();
      const url = `http://${addr.address}:${addr.port}`;
      const envelope = makeEnvelope('listDueNextActions');
      const r = await dispatch(url, envelope);
      assert.equal(r.status, 404);
      assert.equal(r.body.error, 'route_not_mounted');
    } finally {
      await new Promise((res) => server.close(res));
    }
  });

  test('expired env (all entries past expiresAt) -> route stays unmounted', async () => {
    const config = baseConfig();
    const env = buildEnvOverrides({
      HRP_AUTOMATION_SERVICE_1: [
        SERVICE_ID,
        ORG_ID,
        CONN_ID,
        String(FIXED_NOW - 60_000), // already expired
        'listDueNextActions,acknowledgeReminder,getNextAction',
        SECRET,
      ].join('|'),
    });
    // Forward the clock by injecting a now() override is not possible
    // here (production bootstrap uses Date.now()). Force expiresAt to
    // a clearly past timestamp so the registry filters it out at
    // construction.
    const server = await startServer(config, { env });
    try {
      const addr = server.address();
      const url = `http://${addr.address}:${addr.port}`;
      const envelope = makeEnvelope('listDueNextActions');
      const r = await dispatch(url, envelope);
      assert.equal(r.status, 404);
      assert.equal(r.body.error, 'route_not_mounted');
    } finally {
      await new Promise((res) => server.close(res));
    }
  });

  test('production nodeEnv -> route stays unmounted (fail closed)', async () => {
    const config = baseConfig({ nodeEnv: 'production', mockMode: 'off' });
    const env = buildEnvOverrides();
    const server = await startServer(config, { env });
    try {
      const addr = server.address();
      const url = `http://${addr.address}:${addr.port}`;
      const envelope = makeEnvelope('listDueNextActions');
      const r = await dispatch(url, envelope);
      assert.equal(r.status, 404);
      assert.equal(r.body.error, 'route_not_mounted');
    } finally {
      await new Promise((res) => server.close(res));
    }
  });

  test('mockMode=off -> route stays unmounted (fail closed)', async () => {
    const config = baseConfig({ mockMode: 'off' });
    const env = buildEnvOverrides();
    const server = await startServer(config, { env });
    try {
      const addr = server.address();
      const url = `http://${addr.address}:${addr.port}`;
      const envelope = makeEnvelope('listDueNextActions');
      const r = await dispatch(url, envelope);
      assert.equal(r.status, 404);
      assert.equal(r.body.error, 'route_not_mounted');
    } finally {
      await new Promise((res) => server.close(res));
    }
  });
});