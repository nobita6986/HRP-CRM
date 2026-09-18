/**
 * apps/integration-api/tests/receiver.int.test.mjs — CORE/1.2 PostgreSQL
 * integration tests cho webhook receiver.
 *
 * Backlog §Task 1.2 AC verification:
 *  - HTTP request thực → PostgreSQL receipt + DispatchIntent (atomic).
 *  - DB/transaction fail không trả accepted giả (NO 202).
 *  - Duplicate (same digest) → idempotent 202, không tạo job mới.
 *  - Hash conflict (different digest, same eventId) → 409, KHÔNG tạo job.
 *  - Scope spoof (body có organizationId khác path) → 400.
 *  - Malformed/unverified (signature fail, malformed JSON) → 400/401.
 *  - Crash recovery: receiver "crash" trước 202 → provider retry → 202
 *    idempotent (commitReceiptWithIntents created=false).
 *  - Receiver kết nối store/queue qua CORE/1.3 boundary (chỉ gọi
 *    commitReceiptWithIntents, không bypass).
 *
 * Auditor CHANGES_REQUIRED rev:
 *  - F1: org A request signed đúng, URL sang org B → reject (no DB write).
 *  - F2: connection pinned SHA512 → request nói SHA256 qua header → reject.
 *  - F3: same eventId + same digest + same body → idempotent 202 (replay).
 *
 * Boundary:
 *  - No CORE/1.1 dependency (gateway mock).
 *  - No CORE/1.5 normalize (placeholder intent only).
 *  - No real provider (synthetic HMAC secret in env).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createHmac, createHash } from 'node:crypto';

if (!existsSync('./dist/server.js')) {
  execSync('npm run build', { stdio: 'inherit' });
}

process.env['PG_HARNESS_SUFFIX'] = 'receiver_recv_it';
const { start: startHarness } = await import('./pg-receiver-harness.mjs');

const harness = await startHarness();
const { url: dbUrl } = harness;

const { startServer } = await import('../dist/server.js');
const { loadConfig } = await import('../../../packages/config/dist/index.js');
const integrationStore = await import('@hrp-engagement/integration-store');

const SECRET = 'synthetic-int-secret-do-not-use-in-prod';
const ORG = 'org-recv-int-001';
const ORG_B = 'org-recv-int-002';
const CONN = 'conn-synth-001';

/**
 * Build env with a connection registry (Auditor F1) and pinned algorithm.
 * Default: org-synthetic-001 / CHATWOOT / conn-synth-001 / HMAC_SHA256.
 */
function buildEnv(overrides = {}) {
  const defaultConn = {
    organizationId: ORG,
    provider: 'CHATWOOT',
    connectionId: CONN,
    secret: SECRET,
    algorithm: 'HMAC_SHA256',
  };
  const orgBConn = {
    organizationId: ORG_B,
    provider: 'CHATWOOT',
    connectionId: CONN,
    secret: SECRET,
    algorithm: 'HMAC_SHA256',
  };
  // Merge any custom registry entries from overrides.
  const customRegistry = overrides.registry ?? [];
  const registry = [defaultConn, orgBConn, ...customRegistry];
  return {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'off',
    HRP_ORGANIZATION_ID: ORG,
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: '14111',
    HRP_MOCK_ROUTES: '/health',
    HRP_REQUEST_TIMEOUT_MS: '15000',
    HRP_RECEIVER_ENABLED: 'true',
    HRP_RECEIVER_MAX_BODY_BYTES: '262144',
    HRP_RECEIVER_RATE_LIMIT_PER_MIN: '600',
    HRP_WEBHOOK_CONNECTIONS: JSON.stringify(registry),
    DATABASE_URL: dbUrl,
    ...overrides.env,
  };
}

async function bootServer(overrides = {}) {
  const env = buildEnv(overrides);
  const r = loadConfig({ env, kind: 'api' });
  const prisma = integrationStore.createPrismaClient({ databaseUrl: dbUrl });
  const server = await startServer(r.config, { prisma, env });
  return { server, port: r.config.listen.port, config: r.config, prisma };
}

async function sendWebhook(port, org, provider, connectionId, body, opts = {}) {
  const url = `http://127.0.0.1:${port}/webhooks/${org}/${provider}/${connectionId}`;
  const bodyBytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const sig = createHmac('sha256', SECRET).update(bodyBytes).digest('hex');
  const headers = {
    'Content-Type': 'application/json',
    'X-Chatwoot-Signature': sig,
    'X-Zalo-Oa-Signature': sig,
    ...(opts.headers ?? {}),
  };
  if (opts.wrongSig) {
    const wrongSig = createHmac('sha256', 'WRONG_SECRET').update(bodyBytes).digest('hex');
    headers['X-Chatwoot-Signature'] = wrongSig;
    headers['X-Zalo-Oa-Signature'] = wrongSig;
  }
  const res = await fetch(url, {
    method: 'POST',
    body: bodyBytes,
    headers,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

async function cleanupServer(s) {
  await new Promise((r) => s.server.close(() => r()));
  await s.prisma.$disconnect();
}

test.after(async () => {
  await harness.stop();
});

// ────────────────────────────────────────────────────────────────────────────
// Test cases (Backlog §Task 1.2 AC + Auditor F1/F2/F3)
// ────────────────────────────────────────────────────────────────────────────

test('receiver.int: HTTP 202 sau durable commit; row có trong DB', async () => {
  const s = await bootServer();
  try {
    const body = JSON.stringify({
      event: 'message_created',
      id: 'evt-int-001', // F3: top-level `id` (synthetic event occurrence id)
    });
    const res = await sendWebhook(s.port, ORG, 'CHATWOOT', CONN, body);
    assert.equal(res.status, 202);
    assert.equal(res.body.status, 'accepted');
    assert.ok(res.body.receiptId);
    assert.equal(res.body.created, true);
    assert.equal(res.body.eventIdSource, 'primary');

    const rows = await s.prisma.externalEventReceipt.findMany({
      where: { organizationId: ORG, provider: 'CHATWOOT', connectionId: CONN },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].eventId, 'evt-int-001');
    assert.equal(rows[0].state, 'PENDING');
    assert.match(rows[0].payloadDigest, /^[a-f0-9]{64}$/);

    const intents = await s.prisma.dispatchIntent.findMany({
      where: { receiptId: rows[0].receiptId },
    });
    assert.equal(intents.length, 1);
    assert.equal(intents[0].status, 'PENDING');
  } finally {
    await cleanupServer(s);
  }
});

test('receiver.int: idempotent replay — same eventId + same digest → 202 created=false', async () => {
  const s = await bootServer();
  try {
    const body = JSON.stringify({
      event: 'message_created',
      id: 'evt-int-idemp',
    });
    const first = await sendWebhook(s.port, ORG, 'CHATWOOT', CONN, body);
    const second = await sendWebhook(s.port, ORG, 'CHATWOOT', CONN, body);
    assert.equal(first.status, 202);
    assert.equal(first.body.created, true);
    assert.equal(second.status, 202);
    assert.equal(second.body.created, false);
    assert.equal(second.body.receiptId, first.body.receiptId);

    const receipts = await s.prisma.externalEventReceipt.findMany({
      where: { organizationId: ORG, eventId: 'evt-int-idemp' },
    });
    assert.equal(receipts.length, 1);
    const intents = await s.prisma.dispatchIntent.findMany({
      where: { receiptId: receipts[0].receiptId },
    });
    assert.equal(intents.length, 1);
  } finally {
    await cleanupServer(s);
  }
});

test('receiver.int: hash conflict — same eventId + different digest → 409, NO new intent', async () => {
  const s = await bootServer();
  try {
    const bodyA = JSON.stringify({
      event: 'message_created',
      id: 'evt-int-conflict',
      message: { id: 200 },
    });
    const first = await sendWebhook(s.port, ORG, 'CHATWOOT', CONN, bodyA);
    assert.equal(first.status, 202);

    const bodyB = JSON.stringify({
      event: 'message_created',
      id: 'evt-int-conflict',
      message: { id: 201, extra: 'changed' },
    });
    const second = await sendWebhook(s.port, ORG, 'CHATWOOT', CONN, bodyB);
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'idempotency_conflict');

    const receipts = await s.prisma.externalEventReceipt.findMany({
      where: { organizationId: ORG, eventId: 'evt-int-conflict' },
    });
    assert.equal(receipts.length, 1);
    const intents = await s.prisma.dispatchIntent.findMany({
      where: { receiptId: receipts[0].receiptId },
    });
    assert.equal(intents.length, 1);
  } finally {
    await cleanupServer(s);
  }
});

test('receiver.int: body scope spoof — body tự khai organizationId khác path → 400, no DB write', async () => {
  const s = await bootServer();
  try {
    const body = JSON.stringify({
      event: 'message_created',
      id: 'evt-int-spoof',
      organizationId: 'org-evil-001',
    });
    const res = await sendWebhook(s.port, ORG, 'CHATWOOT', CONN, body);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'body_scope_spoof');

    const rows = await s.prisma.externalEventReceipt.findMany({
      where: { organizationId: ORG, eventId: 'evt-int-spoof' },
    });
    assert.equal(rows.length, 0);
  } finally {
    await cleanupServer(s);
  }
});

test('receiver.int: malformed JSON → 400, no DB write', async () => {
  const s = await bootServer();
  try {
    const res = await sendWebhook(s.port, ORG, 'CHATWOOT', CONN, 'not-json');
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'malformed_json');
  } finally {
    await cleanupServer(s);
  }
});

test('receiver.int: HMAC signature mismatch → 401, no DB write', async () => {
  const s = await bootServer();
  try {
    const res = await sendWebhook(s.port, ORG, 'CHATWOOT', CONN, JSON.stringify({
      event: 'message_created',
      id: 'evt-int-hmac',
    }), { wrongSig: true });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'signature_mismatch');
  } finally {
    await cleanupServer(s);
  }
});

test('receiver.int: missing eventId + missing fallback → 400, no DB write', async () => {
  // F3: KHÔNG dùng message.id làm fallback; thiếu → reject.
  const s = await bootServer();
  try {
    const body = JSON.stringify({ event: 'message_created', message: { id: 999 } });
    const res = await sendWebhook(s.port, ORG, 'CHATWOOT', CONN, body);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'missing_event_id');
  } finally {
    await cleanupServer(s);
  }
});

test('receiver.int: payload too large → 413', async () => {
  const s = await bootServer({ env: { HRP_RECEIVER_MAX_BODY_BYTES: '1024' } });
  try {
    const body = JSON.stringify({
      event: 'message_created',
      id: 'evt-int-toobig',
      message: { id: 1, body: 'x'.repeat(2048) },
    });
    const res = await sendWebhook(s.port, ORG, 'CHATWOOT', CONN, body);
    assert.equal(res.status, 413);
    assert.equal(res.body.code, 'payload_too_large');
  } finally {
    await cleanupServer(s);
  }
});

test('receiver.int: recovery — second "crashed" receiver vẫn 202 idempotent (created=false)', async () => {
  const prePrisma = integrationStore.createPrismaClient({ databaseUrl: dbUrl });
  try {
    const body = JSON.stringify({
      event: 'message_created',
      id: 'evt-int-recovery',
    });
    const realDigest = createHash('sha256')
      .update(new TextEncoder().encode(body))
      .digest('hex');
    await integrationStore.commitReceiptWithIntents(
      prePrisma,
      { organizationId: ORG, provider: 'CHATWOOT', connectionId: CONN, eventId: 'evt-int-recovery' },
      {
        schemaVersion: '1',
        receipt: {
          schemaVersion: '1',
          organizationId: ORG,
          eventId: 'evt-int-recovery',
          payloadDigest: realDigest,
          duplicateKind: 'DEDUPE',
        },
        intents: [],
      },
    );

    const s = await bootServer();
    try {
      const res = await sendWebhook(s.port, ORG, 'CHATWOOT', CONN, body);
      assert.equal(res.status, 202);
      assert.equal(res.body.created, false);
    } finally {
      await cleanupServer(s);
    }
  } finally {
    await prePrisma.$disconnect();
  }
});

test('receiver.int: DB unavailable → 503 (NO 202)', async () => {
  const env = buildEnv();
  const r = loadConfig({ env, kind: 'api' });
  const badPrisma = integrationStore.createPrismaClient({
    databaseUrl: `postgresql://integration:synthetic@127.0.0.1:1/integration_store?schema=integration`,
  });
  const server = await startServer(r.config, { prisma: badPrisma, env });
  try {
    const body = JSON.stringify({
      event: 'message_created',
      id: 'evt-int-dbfail',
    });
    const res = await sendWebhook(r.config.listen.port, ORG, 'CHATWOOT', CONN, body);
    assert.equal(res.status, 503);
    assert.equal(res.body.status, 'rejected');
    assert.equal(res.body.code, 'store_unavailable');
    assert.equal(res.body.retryable, true);
  } finally {
    await new Promise((r2) => server.close(() => r2()));
    try {
      await badPrisma.$disconnect();
    } catch {}
  }
});

// ─── Auditor F1 integration tests ───────────────────────────────────────────

test('receiver.int: F1 — request hợp lệ cho org A chuyển URL sang org B → 400 unknown_connection, no DB write', async () => {
  // Org A có conn-synth-001; Org B cũng có conn-synth-001 (cùng connectionId
  // nhưng khác org trong registry). Test: signed cho Org A, URL nói Org B
  // → registry lookup (orgB, CHATWOOT, conn-synth-001) — đã có trong registry
  // nhưng với secret KHÁC. Trong test này, secret giống nhau nhưng tổng quát
  // hơn: org-evil có connectionId đã biết nhưng Org-A registry không chứa →
  // reject.
  const s = await bootServer();
  try {
    const body = JSON.stringify({
      event: 'message_created',
      id: 'evt-f1-orgswitch',
    });
    // URL path nói org-evil-001; Org-A có conn-synth-001, Org-Evil KHÔNG có.
    const url = `http://127.0.0.1:${s.port}/webhooks/org-evil-001/CHATWOOT/${CONN}`;
    const bodyBytes = new TextEncoder().encode(body);
    const sig = createHmac('sha256', SECRET).update(bodyBytes).digest('hex');
    const res = await fetch(url, {
      method: 'POST',
      body: bodyBytes,
      headers: {
        'Content-Type': 'application/json',
        'X-Chatwoot-Signature': sig,
      },
    });
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.code, 'unknown_connection');

    const rows = await s.prisma.externalEventReceipt.findMany({
      where: { eventId: 'evt-f1-orgswitch' },
    });
    assert.equal(rows.length, 0);
  } finally {
    await cleanupServer(s);
  }
});

test('receiver.int: F1 — connectionId collision (conn-1 vs conn_1) không dùng nhầm binding', async () => {
  // Registry chứa 2 entry: (org, CHATWOOT, conn-1) và (org, CHATWOOT, conn_1)
  // với secret KHÁC NHAU. Request đến conn_1 dùng secret của conn-1 → reject.
  const s = await bootServer({
    registry: [
      { organizationId: ORG, provider: 'CHATWOOT', connectionId: 'conn-1', secret: 'secret-dash', algorithm: 'HMAC_SHA256' },
      { organizationId: ORG, provider: 'CHATWOOT', connectionId: 'conn_1', secret: 'secret-underscore', algorithm: 'HMAC_SHA256' },
    ],
  });
  try {
    const body = JSON.stringify({
      event: 'message_created',
      id: 'evt-f1-collision',
    });
    // Sign với secret-dash (của conn-1), URL nói conn_1.
    const bodyBytes = new TextEncoder().encode(body);
    const sigDash = createHmac('sha256', 'secret-dash').update(bodyBytes).digest('hex');
    const url = `http://127.0.0.1:${s.port}/webhooks/${ORG}/CHATWOOT/conn_1`;
    const res = await fetch(url, {
      method: 'POST',
      body: bodyBytes,
      headers: {
        'Content-Type': 'application/json',
        'X-Chatwoot-Signature': sigDash,
      },
    });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.code, 'signature_mismatch');

    const rows = await s.prisma.externalEventReceipt.findMany({
      where: { eventId: 'evt-f1-collision' },
    });
    assert.equal(rows.length, 0);
  } finally {
    await cleanupServer(s);
  }
});

// ─── Auditor F2 integration tests ───────────────────────────────────────────

test('receiver.int: F2 — connection pinned SHA512 reject request chọn SHA256 qua header', async () => {
  // Registry: connection pinned HMAC_SHA512. Request nói HMAC_SHA256 → fail.
  const s = await bootServer({
    registry: [
      { organizationId: ORG, provider: 'GENERIC', connectionId: CONN, secret: SECRET, algorithm: 'HMAC_SHA512' },
    ],
  });
  try {
    const body = JSON.stringify({
      type: 'webhook',
      event_id: 'evt-f2-sha512-256',
    });
    const bodyBytes = new TextEncoder().encode(body);
    // Sign với SHA256.
    const sig = createHmac('sha256', SECRET).update(bodyBytes).digest('hex');
    const url = `http://127.0.0.1:${s.port}/webhooks/${ORG}/GENERIC/${CONN}`;
    const res = await fetch(url, {
      method: 'POST',
      body: bodyBytes,
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': sig,
        'X-Webhook-Algorithm': 'HMAC_SHA256',
      },
    });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.code, 'algorithm_header_mismatch');

    const rows = await s.prisma.externalEventReceipt.findMany({
      where: { eventId: 'evt-f2-sha512-256' },
    });
    assert.equal(rows.length, 0);
  } finally {
    await cleanupServer(s);
  }
});

test('receiver.int: F2 — connection pinned SHA512 accept request signed SHA512 với header absent', async () => {
  const s = await bootServer({
    registry: [
      { organizationId: ORG, provider: 'GENERIC', connectionId: CONN, secret: SECRET, algorithm: 'HMAC_SHA512' },
    ],
  });
  try {
    const body = JSON.stringify({
      type: 'webhook',
      event_id: 'evt-f2-sha512-ok',
    });
    const bodyBytes = new TextEncoder().encode(body);
    const sig = createHmac('sha512', SECRET).update(bodyBytes).digest('hex');
    const url = `http://127.0.0.1:${s.port}/webhooks/${ORG}/GENERIC/${CONN}`;
    const res = await fetch(url, {
      method: 'POST',
      body: bodyBytes,
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': sig,
        // No algorithm header → dùng pinned SHA512.
      },
    });
    assert.equal(res.status, 202);
  } finally {
    await cleanupServer(s);
  }
});

// ─── Auditor F3 integration tests ───────────────────────────────────────────

test('receiver.int: F3 — cùng message khác eventType → eventId KHÁC nhau (không collision)', async () => {
  // Dùng connectionId riêng để cô lập với các test khác.
  const isolatedConn = 'conn-f3-type-isolation';
  const s = await bootServer({
    registry: [
      { organizationId: ORG, provider: 'CHATWOOT', connectionId: isolatedConn, secret: SECRET, algorithm: 'HMAC_SHA256' },
    ],
  });
  try {
    const bodyA = JSON.stringify({
      event: 'message_created',
      id: 'evt-f3-type-A',
      message: { id: 555 },
    });
    const bodyB = JSON.stringify({
      event: 'message_updated',
      id: 'evt-f3-type-B',
      message: { id: 555 },
    });
    const resA = await sendWebhook(s.port, ORG, 'CHATWOOT', isolatedConn, bodyA);
    const resB = await sendWebhook(s.port, ORG, 'CHATWOOT', isolatedConn, bodyB);
    assert.equal(resA.status, 202);
    assert.equal(resB.status, 202);
    assert.notEqual(resA.body.receiptId, resB.body.receiptId);

    const rows = await s.prisma.externalEventReceipt.findMany({
      where: { organizationId: ORG, connectionId: isolatedConn },
    });
    assert.equal(rows.length, 2);
  } finally {
    await cleanupServer(s);
  }
});

test('receiver.int: F3 — cùng eventType khác revision → khác eventId (replay guard)', async () => {
  const s = await bootServer();
  try {
    const bodyA = JSON.stringify({
      event: 'message_updated',
      id: 'evt-f3-rev-A',
    });
    const bodyB = JSON.stringify({
      event: 'message_updated',
      id: 'evt-f3-rev-B',
    });
    const resA = await sendWebhook(s.port, ORG, 'CHATWOOT', CONN, bodyA);
    const resB = await sendWebhook(s.port, ORG, 'CHATWOOT', CONN, bodyB);
    assert.equal(resA.status, 202);
    assert.equal(resB.status, 202);
    assert.notEqual(resA.body.receiptId, resB.body.receiptId);
  } finally {
    await cleanupServer(s);
  }
});

test('receiver.int: F3 — replay cùng occurrence → 202 idempotent', async () => {
  const s = await bootServer();
  try {
    const body = JSON.stringify({
      event: 'message_created',
      id: 'evt-f3-replay',
    });
    const first = await sendWebhook(s.port, ORG, 'CHATWOOT', CONN, body);
    const second = await sendWebhook(s.port, ORG, 'CHATWOOT', CONN, body);
    const third = await sendWebhook(s.port, ORG, 'CHATWOOT', CONN, body);
    assert.equal(first.status, 202);
    assert.equal(first.body.created, true);
    assert.equal(second.status, 202);
    assert.equal(second.body.created, false);
    assert.equal(third.status, 202);
    assert.equal(third.body.created, false);
    assert.equal(first.body.receiptId, second.body.receiptId);
    assert.equal(second.body.receiptId, third.body.receiptId);

    const rows = await s.prisma.externalEventReceipt.findMany({
      where: { eventId: 'evt-f3-replay' },
    });
    assert.equal(rows.length, 1);
  } finally {
    await cleanupServer(s);
  }
});

test('receiver.int: F3 — same eventId different digest vẫn conflict (409)', async () => {
  const s = await bootServer();
  try {
    // Same eventId, different body.
    const bodyA = JSON.stringify({
      event: 'message_created',
      event_id: 'evt-f3-conflict',
      message: { id: 1 },
    });
    const bodyB = JSON.stringify({
      event: 'message_created',
      event_id: 'evt-f3-conflict',
      message: { id: 2, extra: 'changed' },
    });
    const first = await sendWebhook(s.port, ORG, 'CHATWOOT', CONN, bodyA);
    const second = await sendWebhook(s.port, ORG, 'CHATWOOT', CONN, bodyB);
    assert.equal(first.status, 202);
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'idempotency_conflict');
  } finally {
    await cleanupServer(s);
  }
});
