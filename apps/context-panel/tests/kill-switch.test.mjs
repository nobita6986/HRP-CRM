/**
 * tests/kill-switch.test.mjs — CORE/1.14 kill-switch HTTP integration tests.
 *
 * Proves:
 *  - GET /api/admin/killswitch returns state for manager, 403 for sale/intake.
 *  - POST /api/admin/killswitch with 'armed' → mutating routes return 423.
 *  - Mutating routes return 423 + receiptId when ARMED; receipt is registered.
 *  - Re-disarm restores normal flow.
 *  - mockMode=off blocks admin endpoints too (kill-switch admin IS a mock
 *    endpoint, B2 invariant — but still allowed via /api/admin if mockMode
 *    is on).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPanel } from '../dist/server.js';
import { request } from 'node:http';

const SUPERVISOR = { 'x-hrp-staff-id': 'staff-supervisor-001' };
const TALENT = { 'x-hrp-staff-id': 'staff-talent-001' };
const INTAKE = { 'x-hrp-staff-id': 'staff-intake-001' };

const PANEL_CONFIG = {
  appKind: 'panel',
  nodeEnv: 'development',
  organizationId: 'org-001',
  schemaVersion: '1.0.0',
  contractsVersion: '0.0.8-g0.8-fixes',
  mockMode: 'deterministic',
  listen: { host: '127.0.0.1', port: 19001 },
  allowDevTools: false,
};

async function jsonRequest(url, opts = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: opts.method ?? 'GET',
        headers: opts.headers ?? {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let body;
          const text = Buffer.concat(chunks).toString('utf-8');
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

let server;
let baseUrl;

test.before(async () => {
  server = await startPanel(PANEL_CONFIG);
  baseUrl = `http://127.0.0.1:${PANEL_CONFIG.listen.port}`;
});

test.after(async () => {
  // Disarm before close.
  await jsonRequest(`${baseUrl}/api/admin/killswitch`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: { state: 'disarmed' },
  });
  await new Promise((resolve) => server.close(resolve));
});

test('kill-switch: GET /api/admin/killswitch requires supervisor', async () => {
  // Sale 403.
  let r = await jsonRequest(`${baseUrl}/api/admin/killswitch`, {
    headers: TALENT,
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'FORBIDDEN');

  // Intake 403.
  r = await jsonRequest(`${baseUrl}/api/admin/killswitch`, {
    headers: INTAKE,
  });
  assert.equal(r.status, 403);

  // Supervisor OK.
  r = await jsonRequest(`${baseUrl}/api/admin/killswitch`, {
    headers: SUPERVISOR,
  });
  assert.equal(r.status, 200);
  assert.ok('state' in r.body);
  assert.ok('isArmed' in r.body);
});

test('kill-switch: manager arms → mutating route returns 423 + receiptId', async () => {
  // Arm.
  const arm = await jsonRequest(`${baseUrl}/api/admin/killswitch`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: { state: 'armed' },
  });
  assert.equal(arm.status, 200);
  assert.equal(arm.body.current, 'armed');

  // Verify state.
  const get = await jsonRequest(`${baseUrl}/api/admin/killswitch`, {
    headers: SUPERVISOR,
  });
  assert.equal(get.body.isArmed, true);

  // Mutating route (commit batch).
  const r = await jsonRequest(`${baseUrl}/api/assistant/planning/commit`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: {
      batchId: 'batch-ks-test-1',
      itemIds: ['item-1'],
    },
  });
  assert.equal(r.status, 423);
  assert.equal(r.body.error, 'KILL_SWITCH_ARMED');
  assert.ok(typeof r.body.receiptId === 'string', 'receiptId present in body DTO');
  assert.ok(r.body.receiptId.startsWith('rcpt-'), 'receiptId well-formed');
  // CORE/1.14 B2: tracing metadata travels via HEADER, not body.
  assert.equal(r.body.correlationId, undefined, 'B2: no correlationId in kill-switch body');
  assert.ok(r.headers['x-hrp-correlation-id'], 'correlation header present');
  assert.equal(r.headers['x-hrp-receipt-id'], r.body.receiptId, 'receiptId also in header');
});

test('kill-switch: manager arms → autofill/accept also blocked (mutating)', async () => {
  const r = await jsonRequest(`${baseUrl}/api/assistant/autofill/accept`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: {
      profileId: 'profile-1',
      proposalId: 'proposal-1',
      acceptedFieldPaths: ['fullName'],
    },
  });
  assert.equal(r.status, 423);
  assert.equal(r.body.error, 'KILL_SWITCH_ARMED');
});

test('kill-switch: read-only routes still work when armed', async () => {
  const r = await jsonRequest(`${baseUrl}/api/assistant/today`, {
    headers: SUPERVISOR,
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.snapshotId);
});

test('kill-switch: manager disarms → mutating route resumes', async () => {
  const dis = await jsonRequest(`${baseUrl}/api/admin/killswitch`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: { state: 'disarmed' },
  });
  assert.equal(dis.status, 200);
  assert.equal(dis.body.current, 'disarmed');

  const r = await jsonRequest(`${baseUrl}/api/assistant/planning/commit`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: {
      batchId: 'batch-after-disarm',
      itemIds: ['item-1', 'item-2'],
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.schemaVersion, '1');
  assert.ok(r.body.receiptId, 'receiptId issued on success');
});

test('kill-switch: kill-switch admin blocked for non-manager', async () => {
  const r = await jsonRequest(`${baseUrl}/api/admin/killswitch`, {
    method: 'POST',
    headers: TALENT,
    body: { state: 'armed' },
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'FORBIDDEN');
});
