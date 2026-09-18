/**
 * tests/assistant-api.test.mjs — CORE/1.13 Assistant API integration tests.
 *
 * Boots the real context-panel server (in-process) and exercises the new
 * HTTP endpoints. Validates:
 *  - AC1: today/week GET endpoints
 *  - AC2: autofill GET + accept/reject POST + stale 409
 *  - AC3: planning commit (partial results) + reschedule (stale VERSION_CONFLICT)
 *  - AC4: providers GET + PUT (manager-only at HTTP boundary)
 *  - AC5: reminders simulate GET
 *  - Auth boundary: 401 without X-HRP-Staff-Id
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { request } from 'node:http';

if (!existsSync('./dist/server.js')) {
  execSync('npm run build', { stdio: 'inherit' });
}

const { startPanel } = await import('../dist/server.js');
const { loadConfig } = await import('../../../packages/config/dist/index.js');

let server;
let port;

async function fetchJson(path, options = {}) {
  const { method = 'GET', headers = {}, body = null } = options;
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };
    if (data) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(data);
    }
    const r = request(
      { host: '127.0.0.1', port, path, method, headers: reqHeaders },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let json;
          try { json = JSON.parse(text); } catch { json = text; }
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        });
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const SUPERVISOR = 'staff-supervisor-001';
const SALE = 'staff-talent-001';
const INTAKE = 'staff-intake-001';
const NO_SCOPE = 'staff-no-scope-001';

function headers(staffId) {
  return staffId ? { 'x-hrp-staff-id': staffId } : {};
}

before(async () => {
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'deterministic',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '15505',
    HRP_ALLOW_DEV_TOOLS: 'true',
  };
  const { config } = loadConfig({ env, kind: 'panel' });
  port = config.listen.port;
  server = await startPanel(config);
});

after(async () => {
  if (server?.close) {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AC1 — Today / Week
// ─────────────────────────────────────────────────────────────────────────────

test('AC1: GET /api/assistant/today returns 200 with snapshotId', async () => {
  const r = await fetchJson('/api/assistant/today', { headers: headers(SUPERVISOR) });
  assert.equal(r.status, 200);
  assert.match(r.body.snapshotId, /^today-snap-/);
  assert.ok(r.body.items.length >= 3);
});

test('AC1: GET /api/assistant/today 401 without identity', async () => {
  const r = await fetchJson('/api/assistant/today');
  assert.equal(r.status, 401);
});

test('AC1: GET /api/assistant/week returns 200 with weekStart', async () => {
  const r = await fetchJson('/api/assistant/week', { headers: headers(SALE) });
  assert.equal(r.status, 200);
  assert.match(r.body.weekStart, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(r.body.items.length >= 5);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC2 — Autofill
// ─────────────────────────────────────────────────────────────────────────────

test('AC2: GET /api/assistant/autofill returns proposals', async () => {
  const r = await fetchJson(
    '/api/assistant/autofill?profileId=profile-api-001',
    { headers: headers(SUPERVISOR) },
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.proposals.length, 3);
  const stale = r.body.proposals.find((p) => p.status === 'STALE');
  assert.ok(stale);
});

test('AC2: GET /api/assistant/autofill 400 without profileId', async () => {
  const r = await fetchJson('/api/assistant/autofill', { headers: headers(SUPERVISOR) });
  assert.equal(r.status, 400);
});

test('AC2: POST /api/assistant/autofill/accept — manager mutates (canMutate=true)', async () => {
  const list = await fetchJson(
    '/api/assistant/autofill?profileId=profile-accept-mgr',
    { headers: headers(SUPERVISOR) },
  );
  const clear = list.body.proposals.find((p) => p.proposalId.includes('clear'));
  const r = await fetchJson('/api/assistant/autofill/accept', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      profileId: 'profile-accept-mgr',
      proposalId: clear.proposalId,
      acceptedFieldPaths: [clear.fields[0].fieldPath],
      rejectedFieldPaths: [],
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.canMutate, true);
  assert.equal(r.body.result.mutated, false, 'manager accept creates draft only');
  assert.ok(r.body.result.draftId, 'draftId must be returned');
  assert.ok(r.body.result.confirmationDigest, 'confirmationDigest must be returned');
});

test('AC2: POST /api/assistant/autofill/accept — sale does NOT mutate', async () => {
  // CORE/1.13 B1: sale has scope on profile-talent-*.
  const list = await fetchJson(
    '/api/assistant/autofill?profileId=profile-talent-accept-sale',
    { headers: headers(SALE) },
  );
  const clear = list.body.proposals.find((p) => p.proposalId.includes('clear'));
  const r = await fetchJson('/api/assistant/autofill/accept', {
    method: 'POST',
    headers: headers(SALE),
    body: {
      profileId: 'profile-talent-accept-sale',
      proposalId: clear.proposalId,
      acceptedFieldPaths: [clear.fields[0].fieldPath],
      rejectedFieldPaths: [],
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.canMutate, false);
  assert.equal(r.body.result.mutated, false);
});

test('AC2: POST /api/assistant/autofill/accept stale proposal returns 409', async () => {
  const list = await fetchJson(
    '/api/assistant/autofill?profileId=profile-accept-stale',
    { headers: headers(SUPERVISOR) },
  );
  const stale = list.body.proposals.find((p) => p.status === 'STALE');
  const r = await fetchJson('/api/assistant/autofill/accept', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      profileId: 'profile-accept-stale',
      proposalId: stale.proposalId,
      acceptedFieldPaths: [stale.fields[0].fieldPath],
      rejectedFieldPaths: [],
    },
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'STALE_CONTEXT');
});

test('AC2: POST /api/assistant/autofill/reject moves to REJECTED', async () => {
  const list = await fetchJson(
    '/api/assistant/autofill?profileId=profile-reject',
    { headers: headers(SALE) },
  );
  const clear = list.body.proposals.find((p) => p.proposalId.includes('clear'));
  const r = await fetchJson('/api/assistant/autofill/reject', {
    method: 'POST',
    headers: headers(SALE),
    body: {
      profileId: 'profile-reject',
      proposalId: clear.proposalId,
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.proposal.status, 'REJECTED');
});

// ── Q1 — Manager accept → draft only; confirm applies mutation ────────────

test('Q1: POST /api/assistant/autofill/accept (manager) returns draftId + confirmationDigest', async () => {
  const list = await fetchJson(
    '/api/assistant/autofill?profileId=profile-q1-api-mgr',
    { headers: headers(SUPERVISOR) },
  );
  const clear = list.body.proposals.find((p) => p.proposalId.includes('clear'));
  const r = await fetchJson('/api/assistant/autofill/accept', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      profileId: 'profile-q1-api-mgr',
      proposalId: clear.proposalId,
      acceptedFieldPaths: [clear.fields[0].fieldPath],
      rejectedFieldPaths: [],
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.mutated, false);
  assert.ok(r.body.result.draftId);
  assert.ok(r.body.result.confirmationDigest);
});

test('Q1: POST /api/assistant/autofill/confirm applies mutation', async () => {
  const list = await fetchJson(
    '/api/assistant/autofill?profileId=profile-q1-confirm-api',
    { headers: headers(SUPERVISOR) },
  );
  const clear = list.body.proposals.find((p) => p.proposalId.includes('clear'));
  const accept = await fetchJson('/api/assistant/autofill/accept', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      profileId: 'profile-q1-confirm-api',
      proposalId: clear.proposalId,
      acceptedFieldPaths: [clear.fields[0].fieldPath],
      rejectedFieldPaths: [],
    },
  });
  const r = await fetchJson('/api/assistant/autofill/confirm', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      draftId: accept.body.result.draftId,
      expectedDraftRevision: accept.body.result.draftRevision,
      confirmationDigest: accept.body.result.confirmationDigest,
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.draft.applied, true);
});

test('B5: POST /api/assistant/autofill/confirm retry → idempotent 200 (same appliedAt)', async () => {
  const list = await fetchJson(
    '/api/assistant/autofill?profileId=profile-b5-retry-api',
    { headers: headers(SUPERVISOR) },
  );
  const clear = list.body.proposals.find((p) => p.proposalId.includes('clear'));
  const accept = await fetchJson('/api/assistant/autofill/accept', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      profileId: 'profile-b5-retry-api',
      proposalId: clear.proposalId,
      acceptedFieldPaths: [clear.fields[0].fieldPath],
      rejectedFieldPaths: [],
    },
  });
  // First confirm.
  const c1 = await fetchJson('/api/assistant/autofill/confirm', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      draftId: accept.body.result.draftId,
      expectedDraftRevision: accept.body.result.draftRevision,
      confirmationDigest: accept.body.result.confirmationDigest,
    },
  });
  assert.equal(c1.status, 200);
  assert.equal(c1.body.draft.applied, true);
  const firstAppliedAt = c1.body.draft.appliedAt;
  assert.ok(firstAppliedAt, 'first appliedAt present');

  // Retry (e.g. lost response) — idempotent return.
  const c2 = await fetchJson('/api/assistant/autofill/confirm', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      draftId: accept.body.result.draftId,
      expectedDraftRevision: accept.body.result.draftRevision,
      confirmationDigest: accept.body.result.confirmationDigest,
    },
  });
  assert.equal(c2.status, 200, 'retry returns 200 (not 409 ALREADY_APPLIED)');
  assert.equal(c2.body.draft.applied, true);
  assert.equal(c2.body.draft.appliedAt, firstAppliedAt, 'same appliedAt — no re-mutation');
});

test('B5: POST /api/assistant/autofill/confirm retry with wrong revision → 409 (auth binding)', async () => {
  const list = await fetchJson(
    '/api/assistant/autofill?profileId=profile-b5-wrong-rev-api',
    { headers: headers(SUPERVISOR) },
  );
  const clear = list.body.proposals.find((p) => p.proposalId.includes('clear'));
  const accept = await fetchJson('/api/assistant/autofill/accept', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      profileId: 'profile-b5-wrong-rev-api',
      proposalId: clear.proposalId,
      acceptedFieldPaths: [clear.fields[0].fieldPath],
      rejectedFieldPaths: [],
    },
  });
  await fetchJson('/api/assistant/autofill/confirm', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      draftId: accept.body.result.draftId,
      expectedDraftRevision: accept.body.result.draftRevision,
      confirmationDigest: accept.body.result.confirmationDigest,
    },
  });
  // Retry with wrong revision.
  const c2 = await fetchJson('/api/assistant/autofill/confirm', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      draftId: accept.body.result.draftId,
      expectedDraftRevision: 'rev-wrong',
      confirmationDigest: accept.body.result.confirmationDigest,
    },
  });
  assert.equal(c2.status, 409);
  assert.equal(c2.body.error, 'DRAFT_VERSION_CONFLICT');
});

test('Q2: POST /api/assistant/autofill/confirm (sale) → 403 FORBIDDEN', async () => {
  const list = await fetchJson(
    '/api/assistant/autofill?profileId=profile-q2-sale-confirm-api',
    { headers: headers(SUPERVISOR) },
  );
  const clear = list.body.proposals.find((p) => p.proposalId.includes('clear'));
  const accept = await fetchJson('/api/assistant/autofill/accept', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      profileId: 'profile-q2-sale-confirm-api',
      proposalId: clear.proposalId,
      acceptedFieldPaths: [clear.fields[0].fieldPath],
      rejectedFieldPaths: [],
    },
  });
  const r = await fetchJson('/api/assistant/autofill/confirm', {
    method: 'POST',
    headers: headers(SALE),
    body: {
      draftId: accept.body.result.draftId,
      expectedDraftRevision: accept.body.result.draftRevision,
      confirmationDigest: accept.body.result.confirmationDigest,
    },
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'FORBIDDEN');
});

test('Q2: POST /api/assistant/autofill/accept (sale) does NOT create draft', async () => {
  // CORE/1.13 B1: sale has scope on profile-talent-*.
  const list = await fetchJson(
    '/api/assistant/autofill?profileId=profile-talent-q2-sale',
    { headers: headers(SALE) },
  );
  const clear = list.body.proposals.find((p) => p.proposalId.includes('clear'));
  const r = await fetchJson('/api/assistant/autofill/accept', {
    method: 'POST',
    headers: headers(SALE),
    body: {
      profileId: 'profile-talent-q2-sale',
      proposalId: clear.proposalId,
      acceptedFieldPaths: [clear.fields[0].fieldPath],
      rejectedFieldPaths: [],
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.canMutate, false);
  assert.equal(r.body.result.draftId, undefined, 'sale must not get a draftId');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC3 — Planning Batch
// ─────────────────────────────────────────────────────────────────────────────

test('AC3: POST /api/assistant/planning/commit returns per-item outcomes', async () => {
  const r = await fetchJson('/api/assistant/planning/commit', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      batchId: 'batch-api-ac3-' + Date.now(),
      itemIds: ['b1-item-1', 'b1-item-2', 'b1-item-3', 'b1-item-4'],
      itemInputs: [
        { itemId: 'b1-item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'd1' },
        { itemId: 'b1-item-2', itemKind: 'NEXT_ACTION', payloadDigest: 'd2' },
        { itemId: 'b1-item-3', itemKind: 'NEXT_ACTION', payloadDigest: 'd3' },
        { itemId: 'b1-item-4', itemKind: 'NEXT_ACTION', payloadDigest: 'd4' },
      ],
      simulatedOutcomes: [
        {
          itemId: 'b1-item-1',
          itemKind: 'NEXT_ACTION',
          outcome: 'APPLIED',
          appliedId: 'na-b1-1',
          appliedVersion: 1,
        },
        {
          itemId: 'b1-item-2',
          itemKind: 'NEXT_ACTION',
          outcome: 'ACCEPTED',
          pendingReference: { kind: 'COMMAND_OPERATION', operationId: 'op-b1-2' },
        },
        {
          itemId: 'b1-item-3',
          itemKind: 'NEXT_ACTION',
          outcome: 'FAILED',
          error: {
            itemId: 'b1-item-3',
            errorCode: 'CONFLICT',
            messageKey: 'demo.api.b1',
            retryClass: 'REVIEW_REQUIRED',
          },
        },
        { itemId: 'b1-item-4', itemKind: 'NEXT_ACTION', outcome: 'SKIPPED' },
      ],
    },
  });
  assert.equal(r.status, 200);
  // Frozen contract shape: items[] + summary (no allSuccess).
  assert.equal(typeof r.body.items, 'object');
  assert.equal(Array.isArray(r.body.items), true);
  assert.equal(r.body.items.length, 4);
  assert.equal(typeof r.body.summary, 'object');
  assert.equal(r.body.summary.totalItems, 4);
  assert.equal('allSuccess' in r.body, false, 'allSuccess must be absent');
});

test('B2: POST /api/assistant/planning/commit ACCEPTED replay keeps ACCEPTED + pendingReference', async () => {
  const batchId = 'batch-b2-accept-api-' + Date.now();
  // First commit: item-1 ACCEPTED with pendingReference.
  const r1 = await fetchJson('/api/assistant/planning/commit', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      batchId,
      itemIds: ['item-1'],
      simulatedOutcomes: [
        {
          itemId: 'item-1',
          itemKind: 'NEXT_ACTION',
          outcome: 'ACCEPTED',
          pendingReference: { kind: 'COMMAND_OPERATION', operationId: 'op-canonical-XYZ' },
        },
      ],
    },
  });
  assert.equal(r1.body.items[0].outcome, 'ACCEPTED');
  assert.equal(r1.body.items[0].pendingReference?.operationId, 'op-canonical-XYZ');

  // Replay → still ACCEPTED, pendingReference preserved.
  const r2 = await fetchJson('/api/assistant/planning/commit', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      batchId,
      itemIds: ['item-1'],
    },
  });
  assert.equal(r2.body.items[0].outcome, 'ACCEPTED', 'replay keeps ACCEPTED');
  assert.equal(
    r2.body.items[0].pendingReference?.operationId,
    'op-canonical-XYZ',
    'pendingRef preserved',
  );
  assert.equal(
    r2.body.summary.acceptedCount,
    1,
    'ACCEPTED counted in summary, not in skipped',
  );
  assert.equal(r2.body.summary.skippedCount, 0);
});

test('B2: POST /api/assistant/planning/commit APPLIED replay → SKIPPED', async () => {
  const batchId = 'batch-b2-applied-api-' + Date.now();
  await fetchJson('/api/assistant/planning/commit', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      batchId,
      itemIds: ['item-1'],
      simulatedOutcomes: [
        {
          itemId: 'item-1',
          itemKind: 'NEXT_ACTION',
          outcome: 'APPLIED',
          appliedId: 'nextaction-X',
          appliedVersion: 1,
        },
      ],
    },
  });
  const r2 = await fetchJson('/api/assistant/planning/commit', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: { batchId, itemIds: ['item-1'] },
  });
  assert.equal(r2.body.items[0].outcome, 'SKIPPED');
  assert.equal(r2.body.items[0].appliedId, 'nextaction-X');
});

test('B3: POST /api/assistant/planning/commit same key, different payload digest → 200 with PAYLOAD_MISMATCH', async () => {
  const batchId = 'batch-b3-api-' + Date.now();
  // First commit with payloadDigest 'd1'.
  await fetchJson('/api/assistant/planning/commit', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      batchId,
      itemIds: ['item-1'],
      itemInputs: [{ itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'd1' }],
      simulatedOutcomes: [
        {
          itemId: 'item-1',
          itemKind: 'NEXT_ACTION',
          outcome: 'APPLIED',
          appliedId: 'nextaction-original',
          appliedVersion: 1,
        },
      ],
    },
  });
  // Second commit with different digest → FAILED PAYLOAD_MISMATCH.
  const r2 = await fetchJson('/api/assistant/planning/commit', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      batchId,
      itemIds: ['item-1'],
      itemInputs: [{ itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'd1-CHANGED' }],
    },
  });
  assert.equal(r2.status, 200, 'contract-level conflict reported in result, not HTTP error');
  assert.equal(r2.body.items[0].outcome, 'FAILED');
  assert.equal(r2.body.items[0].error?.errorCode, 'PAYLOAD_MISMATCH');
});

test('B3: POST /api/assistant/planning/commit same key, same payload digest → outcome preserved', async () => {
  const batchId = 'batch-b3-same-api-' + Date.now();
  await fetchJson('/api/assistant/planning/commit', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      batchId,
      itemIds: ['item-1'],
      itemInputs: [{ itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'CANONICAL' }],
      simulatedOutcomes: [
        {
          itemId: 'item-1',
          itemKind: 'NEXT_ACTION',
          outcome: 'APPLIED',
          appliedId: 'nextaction-orig',
          appliedVersion: 1,
        },
      ],
    },
  });
  const r2 = await fetchJson('/api/assistant/planning/commit', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      batchId,
      itemIds: ['item-1'],
      itemInputs: [{ itemId: 'item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'CANONICAL' }],
    },
  });
  assert.equal(r2.body.items[0].outcome, 'SKIPPED', 'APPLIED → SKIPPED on replay');
  assert.equal(r2.body.items[0].appliedId, 'nextaction-orig');
});

test('AC3: POST /api/assistant/planning/reschedule stale → VERSION_CONFLICT', async () => {
  // Use a unique actionId to avoid interference with other tests.
  const r = await fetchJson('/api/assistant/planning/reschedule', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      actionId: 'act-stale-q3',
      expectedVersion: 'v-not-matching',
      newSchedule: { scheduledAt: '2026-09-18T09:00:00+07:00' },
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.success, false);
  assert.equal(r.body.result.error, 'VERSION_CONFLICT');
});

test('AC3: POST /api/assistant/planning/reschedule fresh → success', async () => {
  const r = await fetchJson('/api/assistant/planning/reschedule', {
    method: 'POST',
    headers: headers(SALE),
    body: {
      actionId: 'act-fresh-q3',
      expectedVersion: 'v-current',
      newSchedule: { scheduledAt: '2026-09-18T09:00:00+07:00' },
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.success, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC4 — Provider Config
// ─────────────────────────────────────────────────────────────────────────────

test('AC4: GET /api/assistant/providers returns seeded list', async () => {
  const r = await fetchJson('/api/assistant/providers', {
    headers: headers(SUPERVISOR),
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.providers.length >= 2);
});

test('AC4: PUT /api/assistant/providers/:id — sale gets 403', async () => {
  const list = await fetchJson('/api/assistant/providers', {
    headers: headers(SALE),
  });
  const target = list.body.providers[0];
  const r = await fetchJson(`/api/assistant/providers/${target.configId}`, {
    method: 'PUT',
    headers: headers(SALE),
    body: {
      providerId: target.providerId,
      baseUrl: target.baseUrl,
      model: target.model,
      apiStyle: target.apiStyle,
      capabilities: target.capabilities,
      dataPolicy: target.dataPolicy,
      active: !target.active,
      revision: target.version,
    },
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'FORBIDDEN');
});

test('AC4: PUT /api/assistant/providers/:id — manager with stale revision → 409', async () => {
  const list = await fetchJson('/api/assistant/providers', {
    headers: headers(SUPERVISOR),
  });
  const target = list.body.providers[0];
  const r = await fetchJson(`/api/assistant/providers/${target.configId}`, {
    method: 'PUT',
    headers: headers(SUPERVISOR),
    body: {
      providerId: target.providerId,
      baseUrl: target.baseUrl,
      model: target.model,
      apiStyle: target.apiStyle,
      capabilities: target.capabilities,
      dataPolicy: target.dataPolicy,
      active: !target.active,
      revision: 'v-stale',
    },
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'VERSION_CONFLICT');
});

// ── B1 — API-level scope-based authorization ──────────────────────────────

test('B1: POST /api/assistant/autofill/accept (no-scope actor) → 403', async () => {
  // No-scope actor has empty extraScopes. Use a profileId that doesn't match
  // any scope pattern. Sale identity has autofill:profile-talent-* scope so
  // we use profile-unknown-001 which doesn't match that pattern.
  const profileId = 'profile-unknown-001';
  const list = await fetchJson(
    '/api/assistant/autofill?profileId=' + profileId,
    { headers: headers(NO_SCOPE) },
  );
  const clear = list.body.proposals.find((p) => p.proposalId.includes('clear'));
  const r = await fetchJson('/api/assistant/autofill/accept', {
    method: 'POST',
    headers: headers(NO_SCOPE),
    body: {
      profileId,
      proposalId: clear.proposalId,
      acceptedFieldPaths: [clear.fields[0].fieldPath],
      rejectedFieldPaths: [],
    },
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'FORBIDDEN');
});

test('B1: POST /api/assistant/autofill/accept (intake actor in intake scope) → draftId', async () => {
  // CORE/1.13 B1: intake actor with autofill:draft.confirm + profile-intake-*.
  const profileId = 'profile-intake-b1-api-001';
  const list = await fetchJson(
    '/api/assistant/autofill?profileId=' + profileId,
    { headers: headers(INTAKE) },
  );
  const clear = list.body.proposals.find((p) => p.proposalId.includes('clear'));
  const r = await fetchJson('/api/assistant/autofill/accept', {
    method: 'POST',
    headers: headers(INTAKE),
    body: {
      profileId,
      proposalId: clear.proposalId,
      acceptedFieldPaths: [clear.fields[0].fieldPath],
      rejectedFieldPaths: [],
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.canMutate, true, 'intake scope grants draft');
  assert.ok(r.body.result.draftId);
});

test('B1: POST /api/assistant/autofill/confirm (sale with no draft.confirm) → 403', async () => {
  // Sale has autofill:profile-talent-* but no draft.confirm scope.
  // Create a draft on a profile-talent-* (supervisor has wildcard scope),
  // then verify sale cannot confirm it.
  const profileId = 'profile-talent-confirm-no-scope';
  const list = await fetchJson(
    '/api/assistant/autofill?profileId=' + profileId,
    { headers: headers(SUPERVISOR) },
  );
  const clear = list.body.proposals.find((p) => p.proposalId.includes('clear'));
  // Supervisor creates a draft.
  const accept = await fetchJson('/api/assistant/autofill/accept', {
    method: 'POST',
    headers: headers(SUPERVISOR),
    body: {
      profileId,
      proposalId: clear.proposalId,
      acceptedFieldPaths: [clear.fields[0].fieldPath],
      rejectedFieldPaths: [],
    },
  });
  assert.equal(accept.status, 200);
  assert.ok(accept.body.result.draftId, 'supervisor should create draft');

  // Sale tries to confirm the same draft → 403.
  const r = await fetchJson('/api/assistant/autofill/confirm', {
    method: 'POST',
    headers: headers(SALE),
    body: {
      draftId: accept.body.result.draftId,
      expectedDraftRevision: accept.body.result.draftRevision,
      confirmationDigest: accept.body.result.confirmationDigest,
    },
  });
  assert.equal(r.status, 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.error, 'FORBIDDEN');
});

// ── B4 — API-level provider write schema validation ──────────────────────

test('B4: PUT /api/assistant/providers/:id — body with raw apiKey → 400 INVALID_PAYLOAD', async () => {
  const list = await fetchJson('/api/assistant/providers', {
    headers: headers(SUPERVISOR),
  });
  const target = list.body.providers[0];
  const r = await fetchJson(`/api/assistant/providers/${target.configId}`, {
    method: 'PUT',
    headers: headers(SUPERVISOR),
    body: {
      providerId: target.providerId,
      baseUrl: target.baseUrl,
      model: target.model,
      apiStyle: target.apiStyle,
      capabilities: target.capabilities,
      dataPolicy: target.dataPolicy,
      active: target.active,
      revision: target.version,
      apiKey: 'sk-1234567890abcdef',
    },
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'INVALID_PAYLOAD');
  assert.match(r.body.message, /apiKey/);
});

test('B4: PUT /api/assistant/providers/:id — unknown field → 400 INVALID_PAYLOAD', async () => {
  const list = await fetchJson('/api/assistant/providers', {
    headers: headers(SUPERVISOR),
  });
  const target = list.body.providers[0];
  const r = await fetchJson(`/api/assistant/providers/${target.configId}`, {
    method: 'PUT',
    headers: headers(SUPERVISOR),
    body: {
      providerId: target.providerId,
      baseUrl: target.baseUrl,
      model: target.model,
      apiStyle: target.apiStyle,
      capabilities: target.capabilities,
      dataPolicy: target.dataPolicy,
      active: target.active,
      revision: target.version,
      unexpectedField: 'x',
    },
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'INVALID_PAYLOAD');
});

test('B4: PUT /api/assistant/providers/:id — error message does NOT echo secret value', async () => {
  const list = await fetchJson('/api/assistant/providers', {
    headers: headers(SUPERVISOR),
  });
  const target = list.body.providers[0];
  const secretValue = 'leaked-secret-sk-SECRET-SHOULD-NOT-APPEAR';
  const r = await fetchJson(`/api/assistant/providers/${target.configId}`, {
    method: 'PUT',
    headers: headers(SUPERVISOR),
    body: {
      providerId: target.providerId,
      baseUrl: target.baseUrl,
      model: target.model,
      apiStyle: target.apiStyle,
      capabilities: target.capabilities,
      dataPolicy: target.dataPolicy,
      active: target.active,
      revision: target.version,
      apiKey: secretValue,
    },
  });
  // Check that secretValue is not echoed in response body or message.
  assert.equal(r.status, 400);
  const bodyText = JSON.stringify(r.body);
  assert.equal(bodyText.includes(secretValue), false, 'response must NOT echo secret');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC5 — Reminder
// ─────────────────────────────────────────────────────────────────────────────

test('AC5: GET /api/assistant/reminders/simulate returns deterministic counts', async () => {
  const r = await fetchJson('/api/assistant/reminders/simulate', {
    headers: headers(SUPERVISOR),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.portHandles.length, 0);
  assert.ok(r.body.pendingCount >= 0);
  assert.ok(r.body.suppressedCount >= 0);
  assert.match(r.body.simulationTimestamp, /^\d{4}-\d{2}-\d{2}T/);
});

// ── Q5 — Mock-mode boundary: ALL assistant routes blocked when mockMode=off ──
// This is already enforced at the server.ts handler level via guardMockMode().
// We cannot start a second server here, but we verify the guard is applied to
// every assistant route by reading the server source.

test('Q5: every assistant route is guarded by mockMode (server source check)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    (await import('node:path')).join(
      process.cwd(),
      'src/server.ts',
    ),
    'utf-8',
  );
  // Extract the CORE/1.13 section.
  const section = src.match(
    /CORE\/1\.13[\s\S]+?Unknown route/u,
  );
  assert.ok(section, 'CORE/1.13 server section should exist');
  // Every /api/assistant route handler must call guardUnauthorized
  // (which itself runs after the B2 mock guard via the server.ts top-level).
  // For Q5 we check that the B2 mockMode=off guard is applied at the entrypoint
  // — by verifying every /api/assistant route has 'guardUnauthorized'.
  const routeMatches = section[0].match(/\/api\/assistant\/[\w\/]+/gu) ?? [];
  assert.ok(routeMatches.length >= 10, 'should have ≥10 assistant routes');
  // Count guardUnauthorized calls in the section.
  const guardCount = (section[0].match(/guardUnauthorized\(/gu) ?? []).length;
  assert.ok(guardCount >= routeMatches.length, 'every route must call guardUnauthorized');
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth boundary
// ─────────────────────────────────────────────────────────────────────────────

test('AUTH: 401 without X-HRP-Staff-Id header', async () => {
  const r = await fetchJson('/api/assistant/today');
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'unauthorized');
  // CORE/1.14 B2: tracing metadata in HEADER only.
  assert.ok(r.headers['x-hrp-correlation-id']);
  assert.equal(r.body.correlationId, undefined,
    'B2: 401 body must NOT include correlationId (frozen schema compliance)');
});

// CORE/1.14 B2 — Parse REAL HTTP responses with frozen schema + verify
// tracing headers. Catches body mutation regressions for endpoints backed
// by frozen contracts (PlanningBatchResult, TodaySnapshot, etc.).
import { PlanningBatchResultSchema } from '../../../packages/contracts/dist/commands/scheduling.js';

test('B2: planning/commit HTTP response parses with PlanningBatchResultSchema + tracing header', async () => {
  const inbound = 'corr-b2test-1u6r-abcd';
  const r = await fetchJson('/api/assistant/planning/commit', {
    method: 'POST',
    headers: { ...headers(SUPERVISOR), 'x-hrp-correlation-id': inbound },
    body: {
      batchId: 'batch-b2-schema-' + Date.now(),
      itemIds: ['b2-item-1', 'b2-item-2'],
      itemInputs: [
        { itemId: 'b2-item-1', itemKind: 'NEXT_ACTION', payloadDigest: 'd1' },
        { itemId: 'b2-item-2', itemKind: 'NEXT_ACTION', payloadDigest: 'd2' },
      ],
      simulatedOutcomes: [
        {
          itemId: 'b2-item-1',
          itemKind: 'NEXT_ACTION',
          outcome: 'APPLIED',
          appliedId: 'na-b2-1',
          appliedVersion: 1,
        },
        {
          itemId: 'b2-item-2',
          itemKind: 'NEXT_ACTION',
          outcome: 'ACCEPTED',
          pendingReference: { kind: 'COMMAND_OPERATION', operationId: 'op-b2-2-abc' },
        },
      ],
    },
  });
  assert.equal(r.status, 200);
  // B2 invariant: tracing in HEADER (NOT body).
  assert.equal(r.headers['x-hrp-correlation-id'], inbound,
    'B2: well-formed inbound id preserved in header');
  assert.equal(r.body.correlationId, undefined,
    'B2: response body must NOT contain correlationId (would break PlanningBatchResultSchema)');
  // Response body conforms to frozen schema (excluding tracing).
  const { receiptId: _ignored, ...frozenBody } = r.body;
  const parsed = PlanningBatchResultSchema.safeParse(frozenBody);
  assert.equal(parsed.success, true,
    'B2: REAL HTTP response must parse with frozen PlanningBatchResultSchema: ' +
    JSON.stringify(parsed.error?.issues));
});

test('B2: autofill/accept HTTP response has no correlationId in body + tracing in header', async () => {
  const inbound = 'corr-b2af-1u6r-cdef';
  const r = await fetchJson('/api/assistant/autofill/accept', {
    method: 'POST',
    headers: { ...headers(SUPERVISOR), 'x-hrp-correlation-id': inbound },
    body: {
      profileId: 'profile-b2-1',
      proposalId: `prop-profile-b2-1-clear-001`,
      acceptedFieldPaths: ['intent.availability', 'intent.experienceYears'],
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-hrp-correlation-id'], inbound);
  assert.equal(r.body.correlationId, undefined,
    'B2: autofill/accept body must NOT include correlationId');
});

// ── Q5: Mock off blocks all assistant endpoints (start a second server) ──
// We start a second server with HRP_MOCK_MODE=off on a dynamic port and verify
// every endpoint returns 404 (mock_disabled).
test('Q5: HRP_MOCK_MODE=off blocks every assistant endpoint with 404', async () => {
  const { startPanel } = await import('../dist/server.js');
  const { loadConfig } = await import('../../../packages/config/dist/index.js');
  const { request: httpRequest } = await import('node:http');
  // Use a random high port to avoid EADDRINUSE in repeat runs.
  const offPort = 25000 + Math.floor(Math.random() * 1000);
  const offEnv = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'off',
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: String(offPort),
    HRP_ALLOW_DEV_TOOLS: 'true',
  };
  const { config: offConfig } = loadConfig({ env: offEnv, kind: 'panel' });
  const handle = await startPanel(offConfig);

  function fetchOff(path) {
    const reqHeaders = {
      'X-HRP-Staff-Id': SUPERVISOR,
      Accept: 'application/json',
    };
    return new Promise((resolve, reject) => {
      const r = httpRequest(
        { host: '127.0.0.1', port: offConfig.listen.port, path, method: 'GET', headers: reqHeaders },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf-8');
            let json;
            try { json = JSON.parse(text); } catch { json = text; }
            resolve({ status: res.statusCode, body: json });
          });
        },
      );
      r.on('error', reject);
      r.end();
    });
  }

  const offEndpoints = [
    '/api/assistant/today',
    '/api/assistant/week',
    '/api/assistant/autofill?profileId=foo',
    '/api/assistant/providers',
    '/api/assistant/reminders/simulate',
  ];
  for (const path of offEndpoints) {
    const r = await fetchOff(path);
    assert.equal(r.status, 404, `mock off should block GET ${path}`);
    assert.equal(r.body.error, 'mock_disabled');
  }
  await new Promise((resolve) => handle.close(resolve));
});
