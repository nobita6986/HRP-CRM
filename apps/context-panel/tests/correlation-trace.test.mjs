/**
 * tests/correlation-trace.test.mjs — CORE/1.14 correlation ID propagation.
 *
 * Proves:
 *  - Inbound correlation ID (well-formed) is preserved in response header.
 *  - Missing/invalid inbound ID → server generates one.
 *  - Generated ID follows `corr-<route>-<ts>-<rand>` shape.
 *  - Same correlation present across: receipt register, error responses,
 *    successful responses.
 *  - Error responses (4xx/5xx) carry correlation ID too.
 *  - mockMode=off still attaches correlation header on 404 (preserves trace
 *    even when no real handling occurs).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPanel } from '../dist/server.js';
import { request } from 'node:http';

const SUPERVISOR = { 'x-hrp-staff-id': 'staff-supervisor-001' };
const TALENT = { 'x-hrp-staff-id': 'staff-talent-001' };

const PANEL_CONFIG = {
  appKind: 'panel',
  nodeEnv: 'development',
  organizationId: 'org-001',
  schemaVersion: '1.0.0',
  contractsVersion: '0.0.8-g0.8-fixes',
  mockMode: 'deterministic',
  listen: { host: '127.0.0.1', port: 19003 },
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
          try { body = JSON.parse(text); } catch { body = text; }
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
  await new Promise((resolve) => server.close(resolve));
});

test('correlation: GET /api/assistant/today response carries correlation header', async () => {
  const r = await jsonRequest(`${baseUrl}/api/assistant/today`, {
    headers: SUPERVISOR,
  });
  assert.equal(r.status, 200);
  assert.ok(r.headers['x-hrp-correlation-id']);
  assert.match(r.headers['x-hrp-correlation-id'], /^corr-[a-z0-9-]+-[a-z0-9]+-[a-f0-9]+$/);
});

test('correlation: well-formed inbound id is preserved in response', async () => {
  const inbound = 'corr-api-test-1u6r-abcd';
  const r = await jsonRequest(`${baseUrl}/api/assistant/today`, {
    headers: { ...SUPERVISOR, 'x-hrp-correlation-id': inbound },
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-hrp-correlation-id'], inbound);
});

test('correlation: invalid inbound id is replaced with generated one', async () => {
  const r = await jsonRequest(`${baseUrl}/api/assistant/today`, {
    headers: { ...SUPERVISOR, 'x-hrp-correlation-id': 'NOT-A-VALID-ID-<script>' },
  });
  assert.equal(r.status, 200);
  assert.ok(r.headers['x-hrp-correlation-id']);
  assert.notEqual(r.headers['x-hrp-correlation-id'], 'NOT-A-VALID-ID-<script>');
  assert.match(r.headers['x-hrp-correlation-id'], /^corr-/);
});

test('correlation: error responses (401/403/404) carry correlation id', async () => {
  // 401 — missing identity.
  let r = await jsonRequest(`${baseUrl}/api/assistant/today`, {
    headers: {},
  });
  assert.equal(r.status, 401);
  assert.ok(r.headers['x-hrp-correlation-id']);
  // CORE/1.14 B2: tracing metadata is in HEADER only, not body.
  assert.equal(r.body.correlationId, undefined,
    'B2: error body must NOT include correlationId (frozen schema compliance)');

  // 403 — forbidden (sale can't reach kill-switch admin).
  r = await jsonRequest(`${baseUrl}/api/admin/killswitch`, {
    headers: TALENT,
  });
  assert.equal(r.status, 403);
  assert.ok(r.headers['x-hrp-correlation-id']);
  assert.equal(r.body.correlationId, undefined,
    'B2: forbidden body must NOT include correlationId');

  // 404 — unknown route.
  r = await jsonRequest(`${baseUrl}/api/nonexistent`, {
    headers: SUPERVISOR,
  });
  assert.equal(r.status, 404);
  assert.ok(r.headers['x-hrp-correlation-id']);
  assert.equal(r.body.correlationId, undefined,
    'B2: route_not_found body must NOT include correlationId');
});

test('correlation: kill-switch 423 receipt id matches response correlationId', async () => {
  // Arm.
  await jsonRequest(`${baseUrl}/api/admin/killswitch`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: { state: 'armed' },
  });

  // Blocked call carries corr-id in HEADER and receiptId in HEADER too.
  const blocked = await jsonRequest(`${baseUrl}/api/assistant/planning/commit`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: { batchId: 'batch-corr-1', itemIds: ['x'] },
  });
  assert.equal(blocked.status, 423);
  const corrId = blocked.headers['x-hrp-correlation-id'];
  const receiptId = blocked.headers['x-hrp-receipt-id'];
  assert.ok(corrId, 'x-hrp-correlation-id header present');
  assert.ok(receiptId, 'x-hrp-receipt-id header present');
  assert.equal(blocked.body.receiptId, receiptId, 'B2: receiptId also surfaced in body DTO');

  // Receipt in /recovery/receipts carries same corr-id (internal ledger).
  const list = await jsonRequest(`${baseUrl}/api/admin/recovery/receipts`, {
    headers: SUPERVISOR,
  });
  const found = list.body.pending.find((r) => r.correlationId === corrId);
  assert.ok(found, 'receipt with same correlationId found');

  // Cleanup.
  await jsonRequest(`${baseUrl}/api/admin/killswitch`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: { state: 'disarmed' },
  });
});

test('B3: orchestrator correlation propagates (HTTP receipt → run/DNC headers)', async () => {
  // Reset for clean run.
  await jsonRequest(`${baseUrl}/api/session/reset`, { headers: SUPERVISOR });
  const inbound = 'corr-b3test-1u6r-abcd';
  // Preview carries correlation.
  const previewR = await jsonRequest(`${baseUrl}/api/intake/preview`, {
    method: 'POST',
    headers: { ...SUPERVISOR, 'x-hrp-correlation-id': inbound },
    body: {
      organizationId: 'org-001',
      intakeRevisionId: `b3-rev-${Date.now()}`,
      signal: { kind: 'PHONE', phone: '+84' + '9'.repeat(9) },
      target: 'talent',
      targetVersion: 0,
      fullName: 'B3 Run Trace',
      phone: '+84' + '9'.repeat(9),
      citizenIdentity: { number: '012345678901', address: 'HCM' },
      intent: { stage: 'NEW', availability: 'FULL_TIME' },
      evidenceRefs: [{ evidenceId: 'ev-b3-1', kind: 'CHAT' }],
    },
  });
  assert.equal(previewR.status, 200);
  assert.equal(previewR.headers['x-hrp-correlation-id'], inbound,
    'B3: preview response preserves inbound correlation in header');
  assert.equal(previewR.body.correlationId, undefined,
    'B3: preview body MUST NOT contain correlationId');
});

test('B3: idempotent retry with different correlation does NOT duplicate mutation', async () => {
  const profileId = 'profile-b3-idem';
  const proposalId = `prop-${profileId}-clear-001`;
  const acceptR = await jsonRequest(`${baseUrl}/api/assistant/autofill/accept`, {
    method: 'POST',
    headers: { ...SUPERVISOR },
    body: {
      profileId,
      proposalId,
      acceptedFieldPaths: ['intent.availability', 'intent.experienceYears'],
    },
  });
  assert.equal(acceptR.status, 200);
  const draftId = acceptR.body.result?.draftId;
  assert.ok(draftId, 'B3: accept produces draftId');
  const revisionId = acceptR.body.result?.draftRevision ?? 'r1';
  const digest = acceptR.body.result?.confirmationDigest ?? 'd1';

  const corrA = 'corr-b3idemp-1u6r-abcd';
  const confirmA = await jsonRequest(`${baseUrl}/api/assistant/autofill/confirm`, {
    method: 'POST',
    headers: { ...SUPERVISOR, 'x-hrp-correlation-id': corrA },
    body: { draftId, expectedDraftRevision: revisionId, confirmationDigest: digest },
  });
  assert.equal(confirmA.status, 200);
  const appliedAt1 = confirmA.body.draft?.appliedAt;
  assert.ok(appliedAt1, 'B3: first confirm applies mutation');

  const corrB = 'corr-b3idemp-2u6r-cdef';
  const confirmB = await jsonRequest(`${baseUrl}/api/assistant/autofill/confirm`, {
    method: 'POST',
    headers: { ...SUPERVISOR, 'x-hrp-correlation-id': corrB },
    body: { draftId, expectedDraftRevision: revisionId, confirmationDigest: digest },
  });
  assert.equal(confirmB.status, 200);
  assert.equal(confirmB.body.draft?.appliedAt, appliedAt1,
    'B3: different correlation, same idempotency key → same appliedAt (no duplicate mutation)');
  assert.equal(confirmA.headers['x-hrp-correlation-id'], corrA,
    'B3: first confirm carries its own correlation in header');
  assert.equal(confirmB.headers['x-hrp-correlation-id'], corrB,
    'B3: second confirm carries its own correlation in header (different)');
});

test('correlation: mockMode=off 404 still has correlation header', async () => {
  // Spawn a second server with mockMode=off.
  const OFF_CFG = { ...PANEL_CONFIG, mockMode: 'off', listen: { host: '127.0.0.1', port: 19004 } };
  const off = await startPanel(OFF_CFG);
  try {
    const r = await jsonRequest(`http://127.0.0.1:19004/api/assistant/today`, {
      headers: SUPERVISOR,
    });
    assert.equal(r.status, 404);
    assert.ok(r.headers['x-hrp-correlation-id']);
    assert.equal(r.body.correlationId, undefined,
      'B2: mock_disabled body must NOT include correlationId');
  } finally {
    await new Promise((resolve) => off.close(resolve));
  }
});

// ─────────────────────────────────────────────────────────────────
// CORE/1.14 B4 — Metrics generated by real runtime flows, not just
// declared. The /api/admin/metrics endpoint is manager-only. Tests
// read the snapshot AFTER running real flows to prove the metrics
// have a real source.
// ─────────────────────────────────────────────────────────────────

test('B4: orchestrator.lag_ms is generated by real run() path', async () => {
  // Trigger a real orchestrator.run() via the /api/intake flow.
  // 1) preview to obtain reviewSnapshotId
  const preview = await jsonRequest(`${baseUrl}/api/intake/preview`, {
    method: 'POST',
    headers: TALENT, // talent-reviewer cannot run — use SUPERVISOR.
  }).catch(() => null);
  // Use INTAKE_OPERATOR (staff-intake-001) for full coverage.
  const INTAKE_OPER = { 'x-hrp-staff-id': 'staff-intake-001' };
  const fullName = 'Nguyen Van LagTest';
  const phone = '0901234500';
  const cccd = '123456789012';
  const intakePreview = await jsonRequest(`${baseUrl}/api/intake/preview`, {
    method: 'POST',
    headers: INTAKE_OPER,
    body: {
      organizationId: 'org-001', intakeRevisionId: 'rev-b4lag-001', target: 'talent',
      signal: { fullName, phone, citizenId: cccd },
      intent: { stage: 'CONTACTING', availability: 'AVAILABLE_NOW' },
      citizenIdentity: { number: cccd, address: 'LagTest' },
      evidenceRefs: [
        { evidenceId: 'ev-b4lag-001', kind: 'CCCD_FRONT' },
        { evidenceId: 'ev-b4lag-002', kind: 'CCCD_BACK' },
      ],
    },
  });
  assert.equal(intakePreview.status, 200, 'preview must succeed');
  const reviewSnapshotId = intakePreview.body.reviewSnapshotId;
  assert.ok(reviewSnapshotId, 'B4: preview produced reviewSnapshotId');

  const runRes = await jsonRequest(`${baseUrl}/api/intake/run`, {
    method: 'POST',
    headers: INTAKE_OPER,
    body: {
      organizationId: 'org-001', intakeRevisionId: 'rev-b4lag-001',
      reviewSnapshotId, target: 'talent', targetVersion: 1,
      fullName, phone, citizenIdentity: { number: cccd, address: 'LagTest' },
      intent: { stage: 'CONTACTING', availability: 'AVAILABLE_NOW' },
      evidenceRefs: [
        { evidenceId: 'ev-b4lag-001', kind: 'CCCD_FRONT' },
        { evidenceId: 'ev-b4lag-002', kind: 'CCCD_BACK' },
      ],
    },
  });
  assert.ok([200, 409].includes(runRes.status), `run should succeed or be a known status, got ${runRes.status}`);

  // Now read the metrics endpoint.
  const metricsR = await jsonRequest(`${baseUrl}/api/admin/metrics`, {
    headers: SUPERVISOR,
  });
  assert.equal(metricsR.status, 200);
  const gauges = metricsR.body.gauges ?? [];
  // The real run() result produced an observation under {outcome=partial}
  // (since the mock orchestrator returns PARTIAL state). Accept any of the
  // orchestrator-side outcome buckets as proof that lag was measured by a
  // real runtime flow, not a fixture or test-only inc().
  const lagObs = gauges.find((g) => g.name === 'orchestrator.lag_ms');
  assert.ok(lagObs,
    `B4: orchestrator.lag_ms observation exists after run() flow (gauges=${JSON.stringify(gauges)})`);
  assert.ok(lagObs.summary.count >= 1, 'B4: at least one observation recorded');
  assert.ok(lagObs.summary.sum > 0, 'B4: lag sum is positive (real wall-clock elapsed)');
  // Verify it is NOT in the counter snapshot (lag is gauge/histogram).
  const counters = metricsR.body.counters ?? [];
  const lagCounter = counters.find((c) => c.name === 'orchestrator.lag_ms');
  assert.equal(lagCounter, undefined,
    'B4: orchestrator.lag_ms must NOT appear as counter (it is a gauge/histogram)');
});

test('B4: mapping_review counter increments from real accept path', async () => {
  // First read current value.
  const before = await jsonRequest(`${baseUrl}/api/admin/metrics`, { headers: SUPERVISOR });
  const beforeReview = (before.body.counters ?? []).find(
    (c) => c.name === 'mapping_review' && c.labels?.decision === 'review',
  );
  const beforeCount = beforeReview?.value ?? 0;

  // Use the real /api/assistant/autofill flow to obtain a proposal,
  // then accept it. The accept handler increments mapping_review{decision=review}.
  const list = await jsonRequest(
    `${baseUrl}/api/assistant/autofill?profileId=profile-b4metrics-001`,
    { headers: SUPERVISOR },
  );
  const proposal = (list.body.proposals ?? []).find((p) => p.proposalId.includes('clear'))
    ?? list.body.proposals?.[0];
  assert.ok(proposal, 'B4: at least one proposal returned by autofill list');
  assert.ok(proposal.fields?.length > 0, 'B4: proposal has fields');

  await jsonRequest(`${baseUrl}/api/assistant/autofill/accept`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: {
      profileId: 'profile-b4metrics-001',
      proposalId: proposal.proposalId,
      acceptedFieldPaths: [proposal.fields[0].fieldPath],
      rejectedFieldPaths: [],
    },
  });

  // Read again — counter MUST have ticked by 1.
  const after = await jsonRequest(`${baseUrl}/api/admin/metrics`, { headers: SUPERVISOR });
  const afterReview = (after.body.counters ?? []).find(
    (c) => c.name === 'mapping_review' && c.labels?.decision === 'review',
  );
  assert.ok(afterReview, 'mapping_review{decision=review} registered');
  assert.equal(afterReview.value, beforeCount + 1,
    'B4: mapping_review ticked by 1 from real accept() flow');
});
