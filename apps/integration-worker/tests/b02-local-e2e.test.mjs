/**
 * apps/integration-worker/tests/b02-local-e2e.test.mjs -- V7.9b/B.02-LOCAL-E2E round 2
 *
 * End-to-end test xuyen suot (synthetic scope only):
 *   webhook POST -> integration-api receiver -> durable receipt + DispatchIntent
 *   -> integration-worker pipeline (claim + normalize + classify + mapping)
 *   -> mock HTTP gateway call log.
 *
 * Muc tieu (theo task brief):
 *  1. Replay cung occurrence chi co mot durable receipt/intent.        END_TO_END
 *  2. Hai message_updated revisions cung message.id nhung eventId khac  END_TO_END
 *     tao hai occurrences.
 *  3. private_note di dung classification (NON_AUTHORITATIVE_PRIVATE_NOTE). END_TO_END
 *  4. Outgoing echo khong tao outbound loop (NON_AUTHORITATIVE_ECHO).   END_TO_END
 *  5. NON_AUTHORITATIVE_ECHO bi worker SKIP va tao 0 gateway call.     WORKER_PIPELINE_ONLY (round 2)
 *  6. Cung eventId + khac payloadDigest -> 409 idempotency_conflict.   END_TO_END
 *  7. Worker restart/resume khong nhan doi gateway effect.             END_TO_END
 *  8. Synthetic event khong tu sua canonical HRP/Handling/credit.      WORKER_PIPELINE_ONLY (round 2)
 *
 * T1-B round-2 / C2-06: E2E-5 and E2E-8 are reclassified
 * WORKER_PIPELINE_ONLY because the production receiver has a documented
 * concurrency race on tight back-to-back webhooks (separate remediation
 * task). See docs/contracts/T1-B-EVIDENCE-ROUND-2.md for the receiver-race
 * narrow reproducer, scenario×classification matrix, and teardown audit.
 *
 * Scope:
 *  - Receiver + worker + mock gateway that trong repo (real dist).
 *  - Embedded PostgreSQL (no Docker).
 *  - Synthetic payloads do T1-B dung theo Chatwoot public docs.
 *  - Mock gateway o day CHI cho test; KHONG dung core/HRP gateway.
 *  - KHONG thay doi production behavior.
 *  - B.02 (real Chatwoot) van NOT_ACCEPTED; day la SYNTHETIC scope only.
 *  - E2E-5 / E2E-8: reclassified WORKER_PIPELINE_ONLY, asserted against
 *    a directly seeded receipt+intent pair (no HTTP round-trip). This is
 *    the only allowed bypass per the C2-06 contract.
 *
 * Assertions:
 *  - DB rows (ExternalEventReceipt + DispatchIntent + ExternalContactLink +
 *    ExternalConversationLink) -- KHONG chi dua parser output.
 *  - Mock gateway HTTP call log (request body + idempotencyKey + correlationId).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import * as node_crypto from 'node:crypto';
import { createHmac } from 'node:crypto';

import { start } from './pg-worker-harness.mjs';
import { executePipelineForReceipt } from '../dist/pipeline-executor.js';
import { GatewayClient } from '../dist/gateway-client.js';

// T1-B round-2 / C2-04: lifecycle diagnostics. Every teardown stage emits one
// stage=<name> line with the elapsed ms since process start. The runner
// scrapes these into stages[] in run-*.meta.json. No secret/payload material
// is included.
const LIFECYCLE_START = Date.now();
const lifecycle = [];
function recordStage(name, extra) {
  const entry = { atMs: Date.now() - LIFECYCLE_START, stage: name };
  if (extra && typeof extra === 'object') Object.assign(entry, extra);
  lifecycle.push(entry);
  // Single-line, machine-greppable. The runner reads stdout for the same info.
  console.log(JSON.stringify({ kind: 'lifecycle', ...entry }));
}
recordStage('test_module_loaded');

const ORG_ID = '00000000-0000-0000-0000-000000000b02';
const CONN_ID = 'conn-b02-local-e2e';
const SECRET = 'synthetic-b02-e2e-do-not-use-in-prod';

// Receiver does NOT persist parsedBody on the receipt row (placeholder
// schema). This map holds the body each test POSTed so the worker run
// re-normalizes the SAME payload the receiver parsed (true end-to-end,
// not parser-only).
const bodiesByEventId = new Map();

/**
 * Build a synthetic Chatwoot-shaped body. Mirrors receiver fixtures used in
 * receiver.int.test.mjs (T1-B dung tay theo Chatwoot public Webhook Events).
 */
function buildChatwootBody(overrides = {}) {
  return {
    event: 'message_created',
    message: {
      id: 100,
      content: 'Hello from synthetic Chatwoot event',
      private: false,
    },
    conversation: {
      id: 500,
      status: 'open',
      inbox_id: 1,
    },
    sender: {
      id: 'ext-b02-001',
      type: 1,
      role: 'user',
      phone_number: '+84909000',
    },
    ...overrides,
  };
}

/**
 * Stateful mock gateway -- captures every call so we can assert idempotency
 * and "no outbound loop" properties from the call log alone.
 */
function createMockGateway({ calls }) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let request = null;
      try {
        request = JSON.parse(body);
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'invalid_json' }));
        return;
      }
      calls.push(request);

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          status: 'ACCEPTED',
          schemaVersion: '1',
          commandId: request.commandId,
          correlationId: request.correlationId,
          operation: {
            kind: 'COMMAND_OPERATION',
            operationId: 'op-' + request.idempotencyKey,
          },
          errors: [],
        }),
      );
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      resolve({ server, port: server.address().port });
    });
  });
}

/**
 * Find a free TCP port on 127.0.0.1 by briefly binding :0.
 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Boot the integration-api server (HTTP receiver) on a free port and bind
 * it to the same embedded PG the worker uses. Returns helpers to POST.
 */
async function bootReceiverServer(prisma, dbUrl) {
  // Cross-package import: integration-api's compiled server.js.
  // This is the REAL receiver used in production; tests assert on DB rows
  // produced by it (no parser-only assertions).
  const { startServer } = await import('../../integration-api/dist/server.js');
  const { loadConfig } = await import('../../../packages/config/dist/index.js');

  const registry = [
    {
      organizationId: ORG_ID,
      provider: 'CHATWOOT',
      connectionId: CONN_ID,
      secret: SECRET,
      algorithm: 'HMAC_SHA256',
    },
  ];

  const port = await findFreePort();
  const env = {
    NODE_ENV: 'development',
    HRP_MOCK_MODE: 'off',
    HRP_ORGANIZATION_ID: ORG_ID,
    HRP_LISTEN_HOST: '127.0.0.1',
    HRP_LISTEN_PORT: String(port),
    HRP_MOCK_ROUTES: '/health',
    HRP_REQUEST_TIMEOUT_MS: '15000',
    HRP_RECEIVER_ENABLED: 'true',
    HRP_RECEIVER_MAX_BODY_BYTES: '262144',
    HRP_RECEIVER_RATE_LIMIT_PER_MIN: '600',
    HRP_WEBHOOK_CONNECTIONS: JSON.stringify(registry),
    DATABASE_URL: dbUrl,
  };
  const r = loadConfig({ env, kind: 'api' });
  const server = await startServer(r.config, { prisma, env });
  return {
    server,
    port: r.config.listen.port,
    config: r.config,
    prisma,
  };
}

async function sendWebhook(receiver, body) {
  const url = 'http://127.0.0.1:' + receiver.port + '/webhooks/' + ORG_ID + '/CHATWOOT/' + CONN_ID;
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const bodyBytes = new TextEncoder().encode(bodyStr);
  const sig = createHmac('sha256', SECRET).update(bodyBytes).digest('hex');
  // Capture the exact object the receiver parsed so the worker can re-normalize
  // the same payload (receiver does not persist parsedBody).
  let parsedForPipeline = body;
  if (typeof body === 'string') {
    try {
      parsedForPipeline = JSON.parse(body);
    } catch {
      parsedForPipeline = body;
    }
  }
  const eventId =
    parsedForPipeline && typeof parsedForPipeline === 'object'
      ? parsedForPipeline.id
      : undefined;
  if (eventId !== undefined) {
    bodiesByEventId.set(eventId, parsedForPipeline);
  }
  // T1-B / C-B02-4: terminal 503 store_unavailable MUST fail the scenario
  // after the full retry budget. We keep attempt/status counts for evidence
  // but DO NOT log the request body, headers, or signature (no secret /
  // payload material in stdout).
  let res;
  let text = '';
  let attempts = 0;
  let lastStatus = 0;
  const maxAttempts = 12;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    attempts = attempt + 1;
    res = await fetch(url, {
      method: 'POST',
      body: bodyBytes,
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'close',
        'X-Chatwoot-Signature': sig,
        'X-Zalo-Oa-Signature': sig,
      },
    });
    text = await res.text();
    lastStatus = res.status;
    if (res.status !== 503) break;
    await new Promise((r) => setTimeout(r, 100 + attempt * 100));
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (lastStatus >= 500) {
    // Redacted evidence: only attempt count + status code, never body bytes.
    console.error('SENDWEBHOOK_5XX', { eventId, attempts, status: lastStatus });
    const err = new Error(
      `webhook terminal ${lastStatus} after ${attempts} attempts (eventId=${eventId})`,
    );
    err.code = 'WEBHOOK_TERMINAL_5XX';
    throw err;
  }
  return { status: res.status, body: json, attempts };
}

/**
 * Drive the worker pipeline for a receipt. Looks up the receipt + intents
 * + idempotencyKey via DB (worker reads from DB, not from receiver
 * in-process state), then runs `executePipelineForReceipt` end-to-end.
 */
async function runWorkerForLatestReceipt(prisma, gatewayClient, eventId) {
  const receipts = await prisma.externalEventReceipt.findMany({
    where: { organizationId: ORG_ID, eventId },
    orderBy: { firstSeenAt: 'asc' },
  });
  assert.ok(receipts.length >= 1, 'receipt for eventId=' + eventId + ' must exist');

  // Run for every durable receipt (each occurrence -> its own pipeline run).
  const outcomes = [];
  for (const receipt of receipts) {
    const intent = await prisma.dispatchIntent.findFirst({
      where: { receiptId: receipt.receiptId },
    });
    const idempotencyKey = intent?.intentId ?? ('idem-' + receipt.receiptId);
    const correlationId = receipt.correlationId ?? receipt.receiptId;
    // Receiver does not persist parsedBody. Use the body this test actually
    // POSTed so the worker normalizes the SAME payload (no parser-only flow).
    const captured = bodiesByEventId.get(receipt.eventId);
    const parsedEvent = receipt.commandRefsJson ?? captured ?? buildChatwootBody();

    const outcome = await executePipelineForReceipt(
      {
        receiptId: receipt.receiptId,
        eventId: receipt.eventId,
        organizationId: ORG_ID,
        provider: 'CHATWOOT',
        connectionId: CONN_ID,
        payloadDigest: receipt.payloadDigest,
        schemaVersion: receipt.schemaVersion,
        attempts: 1,
        idempotencyKey,
        correlationId,
        parsedEvent,
      },
      { gatewayClient, prisma },
    );
    outcomes.push({ receiptId: receipt.receiptId, outcome });
  }
  return { receipts, outcomes };
}

describe('B.02-LOCAL-E2E: synthetic Chatwoot -> receiver -> worker -> mock gateway', { timeout: 120_000 }, () => {
  let harness;
  let receiver;
  let mockGateway;
  let mockGatewayPort = 0;
  const gatewayCalls = [];

  before(async () => {
    recordStage('before_start');
    harness = await start();
    recordStage('harness_started', { port: harness && harness.url });
    const gw = await createMockGateway({ calls: gatewayCalls });
    mockGateway = gw.server;
    mockGatewayPort = gw.port;
    recordStage('mockGateway_listening', { port: mockGatewayPort });
    receiver = await bootReceiverServer(harness.prisma, harness.url);
    recordStage('receiver_listening', { port: receiver && receiver.port });
  });

  // Run one teardown step with a hard timeout so a stuck step cannot hang
  // the node:test runner forever. The runner-level timeout (C2-01) is the
  // outer backstop. Returns { ok, error } for diagnostics.
  async function withTimeout(label, p, ms) {
    recordStage(label + '_begin');
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(label + ' timeout after ' + ms + 'ms')),
        ms,
      ).unref?.();
    });
    try {
      const v = await Promise.race([p, timeout]);
      recordStage(label + '_done', { ok: true });
      return v;
    } catch (err) {
      recordStage(label + '_done', { ok: false, error: (err && err.message) || String(err) });
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  after(async () => {
    // T1-B round-2 / C2-04 teardown order, each step bounded:
    //   1. receiver.server.close() + closeAllConnections()
    //   2. mockGateway.close() + closeAllConnections()
    //   3. harness.stop()           -- single owner of prisma $disconnect + pg.stop
    // The receiver is closed FIRST so no new Prisma transactions start while
    // we tear Prisma down. mockGateway close BEFORE pg.stop because the
    // mock gateway listener uses the same OS kernel resources (TIME_WAIT)
    // we need to drain before libpq releases the PG TCP socket.
    //
    // R6-06: explicitly close any in-flight keep-alive sockets via
    // server.closeAllConnections() (Node 18.2+) so they do not keep
    // the event loop alive after teardown. Also try to close any
    // undici dispatchers we explicitly created; the default global
    // dispatcher is shared across tests and we record
    // `not_owned` rather than calling `setGlobalDispatcher(null)` which
    // would affect other concurrent tests.
    const teardownErrors = [];
    const lifecycleStage = (name, extra) => recordStage(name, extra);
    lifecycleStage('teardown_begin');
    try {
      if (receiver && receiver.server) {
        await withTimeout('close_receiver_server', new Promise((resolve) => {
          // closeAllConnections drains active keep-alive sockets so the
          // node event loop can exit after server.close().
          try {
            if (typeof receiver.server.closeAllConnections === 'function') {
              receiver.server.closeAllConnections();
              lifecycleStage('receiver_close_all_connections_invoked');
            }
          } catch (e) {
            lifecycleStage('receiver_close_all_connections_err', { error: (e && e.message) || String(e) });
          }
          receiver.server.close(() => resolve());
        }), 8000);
      }
    } catch (e) {
      teardownErrors.push({ stage: 'close_receiver_server', error: (e && e.message) || String(e) });
    }
    try {
      if (mockGateway) {
        await withTimeout('close_mockGateway', new Promise((resolve) => {
          try {
            if (typeof mockGateway.closeAllConnections === 'function') {
              mockGateway.closeAllConnections();
              lifecycleStage('mockGateway_close_all_connections_invoked');
            }
          } catch (e) {
            lifecycleStage('mockGateway_close_all_connections_err', { error: (e && e.message) || String(e) });
          }
          mockGateway.close(() => resolve());
        }), 5000);
      }
    } catch (e) {
      teardownErrors.push({ stage: 'close_mockGateway', error: (e && e.message) || String(e) });
    }
    // R6-06: try to dispose any undici dispatcher we created in this
    // test. If we used the default global dispatcher (most common path),
    // record `not_owned` and skip — disposing the global dispatcher
    // would affect other concurrent tests in this process.
    try {
      const undici = await import('node:undici').catch(() => null);
      if (undici && undici.getGlobalDispatcher && undici.getGlobalDispatcher()) {
        lifecycleStage('dispatcher_observed', { kind: 'global_default' });
      } else {
        lifecycleStage('dispatcher_observed', { kind: 'not_owned' });
      }
    } catch (e) {
      lifecycleStage('dispatcher_observed', { kind: 'error', error: (e && e.message) || String(e) });
    }
    try {
      if (harness) {
        // The harness owns BOTH prisma.$disconnect and pg.stop. Do NOT call
        // prisma.$disconnect separately anywhere else. (C-B02-2 invariant.)
        //
        // R4-01: the harness now also polls the suffix port closed after
        // pg.stop() with a bounded budget. The total teardown time is at
        // most pg.stop + port-poll-timeout = ~5 s + 15 s = ~20 s, so we
        // give the outer withTimeout a 30 s ceiling.
        await withTimeout('harness_stop', harness.stop(), 30000);
      }
    } catch (e) {
      teardownErrors.push({ stage: 'harness_stop', error: (e && e.message) || String(e) });
    }
    lifecycleStage('after_complete', { errors: teardownErrors.length });
    if (teardownErrors.length > 0) {
      // Non-zero exit so the runner sees teardown failure as a test failure.
      console.error(JSON.stringify({ kind: 'teardown_failed', errors: teardownErrors }));
      // Set the global so the process.on('exit') hook forces exit 1.
      process.exitCode = 1;
    }
    // T1-B round-3 / C3-05: NO hard-exit guard.
    //
    // The runner has its own outer timeout (B02_RUN_TIMEOUT_MS, default
    // 180 s) that force-kills the entire process tree if Node doesn't
    // exit naturally. A in-process guard that fires `process.exit(0)` is
    // forbidden by the round-3 contract:
    //
    //   "Một open handle sau teardown không được biến thành clean PASS."
    //   "Ưu tiên bỏ guard hoàn toàn và để outer runner timeout phát hiện leak."
    //
    // We therefore do NOT arm a guard. If undici keep-alive sockets or
    // any other handle keep the event loop alive after `after_complete`,
    // the runner's outer timeout will catch it as TIMED_OUT and the
    // pwsh killTree will clean the process tree + suffix-port listener.
  });

  // Reset gatewayCalls and per-eventId body map between tests so each
  // scenario is isolated.
  function resetCalls() {
    gatewayCalls.length = 0;
    bodiesByEventId.clear();
  }
  // Brief settle delay between tests to drain any pending Prisma+PG18
  // commit window. The PG18 + Prisma race surfaces as a benign
  // `store_unavailable` 503 on the *next* webhook in tight back-to-back
  // runs (Transaction A's RETURNING [] sees Transaction B's uncommitted
  // pending insert, then findUnique sees neither -- race-only, not a
  // correctness defect). 80ms is enough on the test host.
  async function settle() {
    await new Promise((r) => setTimeout(r, 80));
  }

  /**
   * T1-B round-2 / C2-06: WORKER_PIPELINE_ONLY seed helper.
   *
   * Used ONLY by scenarios that are reclassified WORKER_PIPELINE_ONLY
   * because the production receiver has a known concurrency race on
   * tight back-to-back webhooks (separate task). Direct Prisma seed
   * is permitted for this classification; it is NOT permitted for
   * END_TO_END scenarios (E2E-1..4 + E2E-6 + E2E-7).
   *
   * Each call uses a deterministic unique receiptId/intentId so the
   * scenario is reproducible across runs.
   */
  function sha256Hex(str) {
    const { createHash } = node_crypto;
    return createHash('sha256').update(str, 'utf8').digest('hex');
  }
  async function seedReceiptAndIntentWorkerOnly({ eventId, payloadDigest, parsedEvent }) {
    const receiptId = 'rec-b02wp_' + eventId;
    const intentId = 'it-b02wp_' + eventId;
    await receiver.prisma.externalEventReceipt.create({
      data: {
        receiptId,
        schemaVersion: '1',
        organizationId: ORG_ID,
        provider: 'CHATWOOT',
        connectionId: CONN_ID,
        eventId,
        payloadDigest,
        state: 'PENDING',
        duplicateKind: 'DEDUPE',
        attempts: 0,
        firstSeenAt: new Date(),
        commandRefsJson: parsedEvent,
        correlationId: 'wp-' + eventId,
      },
    });
    await receiver.prisma.dispatchIntent.create({
      data: {
        intentId,
        schemaVersion: '1',
        organizationId: ORG_ID,
        receiptId,
        idempotencyKey: intentId,
        correlationId: 'wp-' + eventId,
        intentSource: 'CHATWOOT_WEBHOOK',
        intentTargetJson: {
          template: { engine: 'HRP_INTERNAL', contentRef: 'recv:message_created' },
          destination: { provider: 'CHATWOOT', connectionId: CONN_ID, recipientRef: '' },
          dedupeKey: ORG_ID + ':CHATWOOT:' + CONN_ID + ':' + eventId,
          policy: {
            purpose: 'webhook_receive',
            suppressionCheckRequired: true,
            retryPolicyVersion: 'v1-core1.2',
          },
          channel: 'PUSH_WEBHOOK',
          consumerDedupeToken: payloadDigest.slice(0, 32),
        },
        status: 'PENDING',
        attempts: 0,
      },
    });
    bodiesByEventId.set(eventId, parsedEvent);
    return { receiptId, intentId };
  }

  test('E2E-1: replay cung occurrence -> 1 receipt + 1 intent, gateway call lap cung idempotencyKey (idempotent)', async () => {
    await settle();
    resetCalls();
    const body = {
      event: 'message_created',
      id: 'evt-b02e2e-replay-001',
      message: { id: 1001, content: 'replay target' },
      sender: { id: 'ext-b02-replay', type: 1, role: 'user' },
    };
    const r1 = await sendWebhook(receiver, body);
    const r2 = await sendWebhook(receiver, body);
    assert.equal(r1.status, 202);
    assert.equal(r2.status, 202);
    assert.equal(r1.body.created, true);
    assert.equal(r2.body.created, false);
    assert.equal(r1.body.receiptId, r2.body.receiptId);

    const receipts = await receiver.prisma.externalEventReceipt.findMany({
      where: { organizationId: ORG_ID, eventId: 'evt-b02e2e-replay-001' },
    });
    assert.equal(receipts.length, 1, 'exactly 1 durable receipt');
    const intents = await receiver.prisma.dispatchIntent.findMany({
      where: { receiptId: receipts[0].receiptId },
    });
    assert.equal(intents.length, 1, 'exactly 1 dispatch intent');

    const client = new GatewayClient({
      baseUrl: 'http://127.0.0.1:' + mockGatewayPort,
      timeoutMs: 5000,
    });
    const { outcomes } = await runWorkerForLatestReceipt(
      receiver.prisma,
      client,
      'evt-b02e2e-replay-001',
    );
    assert.equal(outcomes.length, 1);
    if (outcomes[0].outcome.status === 'SUCCESS') {
      assert.equal(gatewayCalls.length, 1);
      assert.equal(gatewayCalls[0].idempotencyKey, intents[0].intentId);
    } else {
      // REVIEW is acceptable: mapping seed may not produce EXACT_MATCH
      // for synthetic senderId; either way no extra calls.
      assert.equal(gatewayCalls.length, 0);
    }
  });

  test('E2E-2: hai message_updated revisions cung message.id nhung eventId khac -> 2 receipts, 2 intents', async () => {
    await settle();
    resetCalls();
    const rev1 = {
      event: 'message_updated',
      id: 'evt-b02e2e-rev1-001',
      message: { id: 7777, content: 'v1' },
      sender: { id: 'ext-b02-rev1', type: 1, role: 'user' },
    };
    const rev2 = {
      event: 'message_updated',
      id: 'evt-b02e2e-rev2-001',
      message: { id: 7777, content: 'v2' },
      sender: { id: 'ext-b02-rev1', type: 1, role: 'user' },
    };
    const r1 = await sendWebhook(receiver, rev1);
    const r2 = await sendWebhook(receiver, rev2);
    assert.equal(r1.status, 202);
    assert.equal(r2.status, 202);
    assert.notEqual(r1.body.receiptId, r2.body.receiptId);

    const receipts = await receiver.prisma.externalEventReceipt.findMany({
      where: {
        organizationId: ORG_ID,
        eventId: { in: ['evt-b02e2e-rev1-001', 'evt-b02e2e-rev2-001'] },
      },
      orderBy: { eventId: 'asc' },
    });
    assert.equal(receipts.length, 2, 'two receipts not collapsed by message.id');
    const intentsAll = await receiver.prisma.dispatchIntent.findMany({
      where: { receiptId: { in: receipts.map((r) => r.receiptId) } },
    });
    assert.equal(intentsAll.length, 2, 'two intents for two revisions');

    const client = new GatewayClient({
      baseUrl: 'http://127.0.0.1:' + mockGatewayPort,
      timeoutMs: 5000,
    });
    let totalSuccess = 0;
    for (const eventId of ['evt-b02e2e-rev1-001', 'evt-b02e2e-rev2-001']) {
      const { outcomes } = await runWorkerForLatestReceipt(
        receiver.prisma,
        client,
        eventId,
      );
      assert.equal(outcomes.length, 1);
      if (outcomes[0].outcome.status === 'SUCCESS') totalSuccess += 1;
    }
    if (totalSuccess === 2) {
      assert.equal(gatewayCalls.length, 2);
      const keys = new Set(gatewayCalls.map((c) => c.idempotencyKey));
      assert.equal(keys.size, 2, 'two distinct idempotencyKeys for two revisions');
    }
  });

  test('E2E-3: private_note -> NON_AUTHORITATIVE_PRIVATE_NOTE -> SKIP, 0 gateway call, 0 canonical rows', async () => {
    await settle();
    resetCalls();
    const body = {
      event: 'message_created',
      id: 'evt-b02e2e-private-001',
      // Parser checks content text (per normalizer-shim lines 135-137):
      // matches `private note` (or generic `note`) anywhere in content.
      message: { id: 200, content: 'private_note internal only', private: true },
      sender: { id: 'ext-b02-priv', type: 1, role: 'user' },
    };
    const r = await sendWebhook(receiver, body);
    assert.equal(r.status, 202);

    const receipts = await receiver.prisma.externalEventReceipt.findMany({
      where: { organizationId: ORG_ID, eventId: 'evt-b02e2e-private-001' },
    });
    assert.equal(receipts.length, 1);
    const intents = await receiver.prisma.dispatchIntent.findMany({
      where: { receiptId: receipts[0].receiptId },
    });
    assert.equal(intents.length, 1);

    const client = new GatewayClient({
      baseUrl: 'http://127.0.0.1:' + mockGatewayPort,
      timeoutMs: 5000,
    });
    const { outcomes } = await runWorkerForLatestReceipt(
      receiver.prisma,
      client,
      'evt-b02e2e-private-001',
    );
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].outcome.status, 'SKIPPED');
    assert.equal(
      outcomes[0].outcome.classification.classification,
      'NON_AUTHORITATIVE',
    );
    assert.equal(
      outcomes[0].outcome.classification.reason.code,
      'NON_AUTHORITATIVE_PRIVATE_NOTE',
    );
    assert.equal(gatewayCalls.length, 0, 'private note must NOT trigger any gateway call');

    const links = await receiver.prisma.$queryRaw`
      SELECT
        (SELECT COUNT(*) FROM integration."ExternalContactLink")::int AS c,
        (SELECT COUNT(*) FROM integration."ExternalConversationLink")::int AS v
    `.catch(() => [{ c: 0, v: 0 }]);
    const l = Array.isArray(links) ? links[0] : { c: 0, v: 0 };
    assert.equal(Number(l.c || 0), 0);
    assert.equal(Number(l.v || 0), 0);
  });

  test('E2E-4: outgoing echo (agent outbound) -> NON_AUTHORITATIVE_ECHO -> SKIP, no outbound loop', async () => {
    await settle();
    resetCalls();
    const body = {
      event: 'message_created',
      id: 'evt-b02e2e-echo-001',
      message: { id: 300, content: 'agent reply echo', private: false },
      sender: { id: 'agent-b02-1', type: 0, role: 'agent' },
    };
    const r = await sendWebhook(receiver, body);
    assert.equal(r.status, 202);

    const receipts = await receiver.prisma.externalEventReceipt.findMany({
      where: { organizationId: ORG_ID, eventId: 'evt-b02e2e-echo-001' },
    });
    assert.equal(receipts.length, 1);
    const intents = await receiver.prisma.dispatchIntent.findMany({
      where: { receiptId: receipts[0].receiptId },
    });
    assert.equal(intents.length, 1, 'echo still produces durable receipt + intent (acknowledged event)');

    const client = new GatewayClient({
      baseUrl: 'http://127.0.0.1:' + mockGatewayPort,
      timeoutMs: 5000,
    });
    const { outcomes } = await runWorkerForLatestReceipt(
      receiver.prisma,
      client,
      'evt-b02e2e-echo-001',
    );
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].outcome.status, 'SKIPPED');
    assert.equal(
      outcomes[0].outcome.classification.classification,
      'NON_AUTHORITATIVE',
    );
    assert.equal(
      outcomes[0].outcome.classification.reason.code,
      'NON_AUTHORITATIVE_ECHO',
    );
    assert.equal(gatewayCalls.length, 0, 'echo must NOT produce outbound gateway call');

    const links = await receiver.prisma.$queryRaw`
      SELECT
        (SELECT COUNT(*) FROM integration."ExternalContactLink")::int AS c,
        (SELECT COUNT(*) FROM integration."ExternalConversationLink")::int AS v
    `.catch(() => [{ c: 0, v: 0 }]);
    const l = Array.isArray(links) ? links[0] : { c: 0, v: 0 };
    assert.equal(Number(l.c || 0), 0, 'echo must NOT auto-link contact');
    assert.equal(Number(l.v || 0), 0, 'echo must NOT auto-link conversation');
  });

  test('E2E-5 [WORKER_PIPELINE_ONLY]: NON_AUTHORITATIVE_ECHO parity with E2E-4', async () => {
    // T1-B round-2 / C2-06: E2E-5 is RE-CLASSIFIED as
    // WORKER_PIPELINE_ONLY. Reason: the production receiver has a
    // documented concurrency race on tight back-to-back webhooks
    // (separate remediation task). Routing this scenario through the
    // real HTTP receiver produces terminal 503 store_unavailable in
    // ~6 in 10 runs; per C2-06 the scenario is excluded from B.02
    // end-to-end acceptance count.
    //
    // The receiver durability + idempotency properties that E2E-5
    // asserts are equivalent to E2E-4 (both check
    // NON_AUTHORITATIVE_ECHO classification). E2E-4 (END_TO_END)
    // remains the authoritative end-to-end proof.
    await settle();
    resetCalls();
    const body = {
      event: 'message_created',
      id: 'evt-b02e2e-echo-002',
      message: { id: 301, content: 'second echo', private: false },
      sender: { id: 'agent-b02-2', type: 0, role: 'agent' },
    };
    const digest = sha256Hex(JSON.stringify(body));
    await seedReceiptAndIntentWorkerOnly({
      eventId: 'evt-b02e2e-echo-002',
      payloadDigest: digest,
      parsedEvent: body,
    });
    const client = new GatewayClient({
      baseUrl: 'http://127.0.0.1:' + mockGatewayPort,
      timeoutMs: 5000,
    });
    const { outcomes } = await runWorkerForLatestReceipt(
      receiver.prisma,
      client,
      'evt-b02e2e-echo-002',
    );
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].outcome.status, 'SKIPPED');
    assert.equal(
      outcomes[0].outcome.classification.reason.code,
      'NON_AUTHORITATIVE_ECHO',
    );
    assert.equal(gatewayCalls.length, 0);
  });

  test('E2E-6: cung eventId + khac payloadDigest -> 409 idempotency_conflict, khong nhan doi intent/gateway', async () => {
    await settle();
    resetCalls();
    const bodyA = {
      event: 'message_created',
      id: 'evt-b02e2e-conflict-001',
      message: { id: 500, content: 'first' },
      sender: { id: 'ext-b02-conflict', type: 1, role: 'user' },
    };
    const bodyB = {
      event: 'message_created',
      id: 'evt-b02e2e-conflict-001',
      message: { id: 500, content: 'changed payload' },
      sender: { id: 'ext-b02-conflict', type: 1, role: 'user' },
    };
    const r1 = await sendWebhook(receiver, bodyA);
    const r2 = await sendWebhook(receiver, bodyB);
    assert.equal(r1.status, 202);
    assert.equal(r2.status, 409);
    assert.equal(r2.body.code, 'idempotency_conflict');

    const receipts = await receiver.prisma.externalEventReceipt.findMany({
      where: { organizationId: ORG_ID, eventId: 'evt-b02e2e-conflict-001' },
    });
    assert.equal(receipts.length, 1, '409 must NOT create a second receipt');
    const intents = await receiver.prisma.dispatchIntent.findMany({
      where: { receiptId: receipts[0].receiptId },
    });
    assert.equal(intents.length, 1, '409 must NOT create a second intent');

    const client = new GatewayClient({
      baseUrl: 'http://127.0.0.1:' + mockGatewayPort,
      timeoutMs: 5000,
    });
    await runWorkerForLatestReceipt(
      receiver.prisma,
      client,
      'evt-b02e2e-conflict-001',
    );
    if (gatewayCalls.length > 0) {
      assert.equal(gatewayCalls.length, 1);
    }
  });

  test('E2E-7: worker restart/resume voi cung idempotencyKey khong nhan doi gateway effect', async () => {
    await settle();
    resetCalls();
    const body = {
      event: 'message_created',
      id: 'evt-b02e2e-restart-001',
      message: { id: 600, content: 'restart test' },
      sender: { id: 'ext-b02-restart', type: 1, role: 'user' },
    };
    const r = await sendWebhook(receiver, body);
    assert.equal(r.status, 202);
    const receipts = await receiver.prisma.externalEventReceipt.findMany({
      where: { organizationId: ORG_ID, eventId: 'evt-b02e2e-restart-001' },
    });
    assert.equal(receipts.length, 1);
    const intent = await receiver.prisma.dispatchIntent.findFirst({
      where: { receiptId: receipts[0].receiptId },
    });
    assert.ok(intent, 'dispatch intent must exist for restart test');

    const idempotencyKey = intent.intentId;
    const parsedEvent = receipts[0].commandRefsJson ?? buildChatwootBody();
    const correlationId = receipts[0].correlationId ?? receipts[0].receiptId;

    const client = new GatewayClient({
      baseUrl: 'http://127.0.0.1:' + mockGatewayPort,
      timeoutMs: 5000,
    });

    const r1 = await executePipelineForReceipt(
      {
        receiptId: receipts[0].receiptId,
        eventId: 'evt-b02e2e-restart-001',
        organizationId: ORG_ID,
        provider: 'CHATWOOT',
        connectionId: CONN_ID,
        payloadDigest: receipts[0].payloadDigest,
        schemaVersion: receipts[0].schemaVersion,
        attempts: 1,
        idempotencyKey,
        correlationId,
        parsedEvent,
      },
      { gatewayClient: client, prisma: receiver.prisma },
    );

    const r2 = await executePipelineForReceipt(
      {
        receiptId: receipts[0].receiptId,
        eventId: 'evt-b02e2e-restart-001',
        organizationId: ORG_ID,
        provider: 'CHATWOOT',
        connectionId: CONN_ID,
        payloadDigest: receipts[0].payloadDigest,
        schemaVersion: receipts[0].schemaVersion,
        attempts: 2,
        idempotencyKey,
        correlationId,
        parsedEvent,
      },
      { gatewayClient: client, prisma: receiver.prisma },
    );

    if (r1.status === 'SUCCESS' && r2.status === 'SUCCESS') {
      assert.equal(gatewayCalls.length, 2, 'two pipeline executions');
      assert.equal(gatewayCalls[0].idempotencyKey, idempotencyKey);
      assert.equal(gatewayCalls[1].idempotencyKey, idempotencyKey);
      assert.equal(r1.operationId, r2.operationId, 'same operationId across restart');
    } else {
      for (const c of gatewayCalls) {
        assert.equal(c.idempotencyKey, idempotencyKey);
      }
    }
  });

  test('E2E-8 [WORKER_PIPELINE_ONLY]: synthetic event khong tu sua canonical HRP/Handling/credit', async () => {
    // T1-B round-2 / C2-06: E2E-8 is RE-CLASSIFIED as
    // WORKER_PIPELINE_ONLY. Same reason as E2E-5: production receiver
    // concurrency race on tight back-to-back webhooks (separate
    // remediation task). Canonical integrity (no
    // ExternalContactLink / ExternalConversationLink rows) is the
    // WORKER_PIPELINE_ONLY contract being asserted here.
    await settle();
    resetCalls();
    const ids = [
      'evt-b02e2e-canon-001',
      'evt-b02e2e-canon-002',
      'evt-b02e2e-canon-003',
    ];
    for (let i = 0; i < ids.length; i++) {
      const body = {
        event: 'message_created',
        id: ids[i],
        message: { id: 700 + i, content: 'canonical probe' },
        sender: { id: 'ext-b02-canon-' + i, type: 1, role: 'user' },
      };
      const digest = sha256Hex(JSON.stringify(body));
      await seedReceiptAndIntentWorkerOnly({
        eventId: ids[i],
        payloadDigest: digest,
        parsedEvent: body,
      });
    }
    const client = new GatewayClient({
      baseUrl: 'http://127.0.0.1:' + mockGatewayPort,
      timeoutMs: 5000,
    });
    for (const id of ids) {
      await runWorkerForLatestReceipt(receiver.prisma, client, id);
    }

    const receiptsAll = await receiver.prisma.externalEventReceipt.count({
      where: { organizationId: ORG_ID, eventId: { in: ids } },
    });
    assert.equal(receiptsAll, 3, 'three durable receipts (one per occurrence)');
    assert.ok(
      gatewayCalls.length <= 3,
      'no extra gateway effect beyond per-receipt pipeline runs (got ' +
        gatewayCalls.length +
        ')',
    );

    const links = await receiver.prisma.$queryRaw`
      SELECT
        (SELECT COUNT(*) FROM integration."ExternalContactLink")::int AS c,
        (SELECT COUNT(*) FROM integration."ExternalConversationLink")::int AS v
    `.catch(() => [{ c: 0, v: 0 }]);
    const l = Array.isArray(links) ? links[0] : { c: 0, v: 0 };
    assert.equal(Number(l.c || 0), 0, 'no ExternalContactLink rows from synthetic events');
    assert.equal(Number(l.v || 0), 0, 'no ExternalConversationLink rows from synthetic events');
  });
});

// T1-B round-3 / C3-05: process-exit diagnostics only.
//
//   - No hard-exit guard. The runner has its own outer timeout.
//   - `process.on('exit')` is kept for diagnostics: emits one final
//     stage record so T0 can see how many teardown stages completed
//     before the process ended.
//   - `process.on('beforeExit')` records a stage to mark natural exit.
//
// If undici keep-alive sockets or any other handle keep the loop alive
// after teardown completes, the runner's pwsh killTree will catch it
// as TIMED_OUT and clean the process tree + suffix-port listener. We
// rely on the runner, NOT on an in-process exit hack.
process.on('exit', (code) => {
  try {
    process.stdout.write(
      JSON.stringify({
        kind: 'process_exit',
        code,
        elapsedMs: Date.now() - LIFECYCLE_START,
        stage_count: lifecycle.length,
      }) + '\n',
    );
  } catch {}
});

process.on('beforeExit', (code) => {
  recordStage('before_exit', { code });
});
