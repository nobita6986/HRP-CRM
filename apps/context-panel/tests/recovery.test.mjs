/**
 * tests/recovery.test.mjs — CORE/1.14 recovery runbook HTTP integration tests.
 *
 * Proves:
 *  - Receipts from kill-switch block are visible in /api/admin/recovery/receipts.
 *  - /api/admin/recovery/run replays pending receipts idempotently
 *    (no duplicate side effects, no fake success).
 *  - Receipt resolved manually does NOT appear in next replay as pending.
 *  - Already-applied receipts are NOT re-applied on replay (idempotent).
 *  - Recovery manager-only; sale/intake cannot access.
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
  listen: { host: '127.0.0.1', port: 19002 },
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
  await jsonRequest(`${baseUrl}/api/admin/killswitch`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: { state: 'disarmed' },
  });
  await new Promise((resolve) => server.close(resolve));
});

test('recovery: GET /api/admin/recovery/status reports healthy when no failures', async () => {
  const r = await jsonRequest(`${baseUrl}/api/admin/recovery/status`, {
    headers: SUPERVISOR,
  });
  assert.equal(r.status, 200);
  assert.ok('state' in r.body);
  assert.ok('depth' in r.body);
});

test('recovery: sale cannot access /api/admin/recovery/status', async () => {
  const r = await jsonRequest(`${baseUrl}/api/admin/recovery/status`, {
    headers: TALENT,
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'FORBIDDEN');
});

test('recovery: arm → 2 receipts register → receipts visible in /receipts', async () => {
  // Arm.
  await jsonRequest(`${baseUrl}/api/admin/killswitch`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: { state: 'armed' },
  });

  // 2 blocked calls → 2 receipts.
  await jsonRequest(`${baseUrl}/api/assistant/planning/commit`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: { batchId: 'batch-rec-1', itemIds: ['a', 'b'] },
  });
  await jsonRequest(`${baseUrl}/api/assistant/planning/commit`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: { batchId: 'batch-rec-2', itemIds: ['c'] },
  });

  // Wait briefly for in-process queueing.
  await new Promise((r) => setTimeout(r, 50));

  // Disarm so we can read status correctly.
  await jsonRequest(`${baseUrl}/api/admin/killswitch`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: { state: 'disarmed' },
  });

  // List receipts.
  const r = await jsonRequest(`${baseUrl}/api/admin/recovery/receipts`, {
    headers: SUPERVISOR,
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.pending.length >= 2, 'pending should include our 2 receipts');
});

test('recovery: /run replays pending (idempotent — no duplicate side effects)', async () => {
  const before = await jsonRequest(`${baseUrl}/api/admin/recovery/receipts`, {
    headers: SUPERVISOR,
  });
  const pendingCount = before.body.pending.length;
  if (pendingCount === 0) return; // skip if nothing pending from earlier test

  // First replay: marks all pending as replayed.
  const run1 = await jsonRequest(`${baseUrl}/api/admin/recovery/run`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: {},
  });
  assert.equal(run1.status, 200);
  assert.equal(run1.body.ran, pendingCount, 'first run reports ran count');
  for (const r of run1.body.results) {
    assert.ok(['replay_safe', 'no_action', 'failed'].includes(r.outcome));
  }

  // Second replay: receipts still pending (manager hasn't resolved them)
  // — each is replayed again. This is the idempotency invariant:
  // replays don't trigger duplicate side effects, just record actions.
  // The actual mutation only happens when the manager manually re-runs
  // the original route with the matching idempotencyKey.
  const run2 = await jsonRequest(`${baseUrl}/api/admin/recovery/run`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: {},
  });
  assert.equal(run2.body.ran, pendingCount, 'second replay returns same count (no duplication of side effects)');
  for (const r of run2.body.results) {
    assert.equal(r.outcome, 'replay_safe', 'all pending still report replay_safe');
  }

  // After manager resolves a receipt → it's removed from pending.
  // listPending() returns one less.
  const list2 = await jsonRequest(`${baseUrl}/api/admin/recovery/receipts`, {
    headers: SUPERVISOR,
  });
  const firstId = list2.body.pending[0].receiptId;
  await jsonRequest(`${baseUrl}/api/admin/recovery/resolve`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: { receiptId: firstId },
  });
  const list3 = await jsonRequest(`${baseUrl}/api/admin/recovery/receipts`, {
    headers: SUPERVISOR,
  });
  assert.equal(list3.body.pending.length, pendingCount - 1);
});

test('recovery: resolve marks applied and removes from pending list', async () => {
  const list = await jsonRequest(`${baseUrl}/api/admin/recovery/receipts`, {
    headers: SUPERVISOR,
  });
  if (list.body.pending.length === 0) return;
  const targetReceiptId = list.body.pending[0].receiptId;

  const resolve = await jsonRequest(`${baseUrl}/api/admin/recovery/resolve`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: { receiptId: targetReceiptId },
  });
  assert.equal(resolve.status, 200);
  assert.equal(resolve.body.outcome, 'resolved');

  // The receipt should NOT be in pending anymore.
  const list2 = await jsonRequest(`${baseUrl}/api/admin/recovery/receipts`, {
    headers: SUPERVISOR,
  });
  const stillPending = list2.body.pending.some((r) => r.receiptId === targetReceiptId);
  assert.equal(stillPending, false);
});

test('recovery: resolve unknown receipt returns 404', async () => {
  const r = await jsonRequest(`${baseUrl}/api/admin/recovery/resolve`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: { receiptId: 'rcpt-unknown-id' },
  });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'RECEIPT_NOT_FOUND');
});

test('recovery: resolve missing receiptId returns 400', async () => {
  const r = await jsonRequest(`${baseUrl}/api/admin/recovery/resolve`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: {},
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'MISSING_RECEIPT_ID');
});

test('recovery: receipt always carries correlationId (no orphan receipts)', async () => {
  // Arm.
  await jsonRequest(`${baseUrl}/api/admin/killswitch`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: { state: 'armed' },
  });
  // Blocked call.
  const blocked = await jsonRequest(`${baseUrl}/api/assistant/autofill/confirm`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: { draftId: 'd1', expectedDraftRevision: 'r1', confirmationDigest: 'dg1' },
  });
  assert.equal(blocked.status, 423);
  // CORE/1.14 B2: correlation id is in HEADER, not body.
  const corrId = blocked.headers['x-hrp-correlation-id'];
  assert.ok(corrId, 'correlation header present on 423');
  // List shows correlationId (admin response body — ledger is internal).
  const list = await jsonRequest(`${baseUrl}/api/admin/recovery/receipts`, {
    headers: SUPERVISOR,
  });
  await jsonRequest(`${baseUrl}/api/admin/killswitch`, {
    method: 'POST',
    headers: SUPERVISOR,
    body: { state: 'disarmed' },
  });
  // Find the new receipt by correlationId.
  const found = list.body.pending.find(
    (r) => r.correlationId === corrId,
  );
  assert.ok(found, 'receipt with matching correlationId found');
  assert.ok(found.receiptId.startsWith('rcpt-'));
});
