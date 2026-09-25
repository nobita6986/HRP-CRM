/**
 * apps/integration-worker/tests/repro/receiver-503-race.test.mjs
 *
 * T1-B / C-B02-5 narrow reproducer: receiver returns 503 store_unavailable
 * on back-to-back webhook POSTs to the same connection within a tight
 * window. The race is between the receiver's durable-commit path
 * (Prisma + PG18 `RETURNING` after `ON CONFLICT DO NOTHING`) and a
 * subsequent identical or near-identical insert.
 *
 * This file does NOT modify production source. It boots the embedded PG
 * harness + real receiver and fires the minimal POST sequence that
 * triggers the race. Output is meant to be attached to the T0 escalation
 * along with exact command, input classification, and structured logs.
 *
 * Run:
 *   PG_HARNESS_SUFFIX=repro_<ts>_<rand> node --test \
 *     apps/integration-worker/tests/repro/receiver-503-race.test.mjs
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

import { start } from '../pg-worker-harness.mjs';

const ORG_ID = '00000000-0000-0000-0000-00000000repro';
const CONN_ID = 'conn-repro-503-race';
const SECRET = 'repro-secret-do-not-use';

async function postWebhook(port, body) {
  const url =
    'http://127.0.0.1:' + port + '/webhooks/' + ORG_ID + '/CHATWOOT/' + CONN_ID;
  const bodyStr = JSON.stringify(body);
  const bodyBytes = new TextEncoder().encode(bodyStr);
  const sig = createHmac('sha256', SECRET).update(bodyBytes).digest('hex');
  const res = await fetch(url, {
    method: 'POST',
    body: bodyBytes,
    headers: {
      'Content-Type': 'application/json',
      'X-Chatwoot-Signature': sig,
      'X-Zalo-Oa-Signature': sig,
    },
  });
  let json;
  try {
    json = await res.json();
  } catch {
    json = { raw: 'unparseable' };
  }
  return { status: res.status, body: json };
}

describe('REPRO: receiver 503 store_unavailable race on tight back-to-back POSTs', { timeout: 60_000 }, () => {
  let harness;
  let receiver;

  before(async () => {
    harness = await start();
    // Boot the real receiver through the same bootReceiverServer pattern
    // the b02 test uses, but inline so this file is standalone.
    const { startServer } = await import('../../../integration-api/dist/server.js');
    const { loadConfig } = await import('../../../../packages/config/dist/index.js');
    const port = await new Promise((resolve, reject) => {
      const s = createServer();
      s.listen(0, '127.0.0.1', () => {
        const p = s.address().port;
        s.close(() => resolve(p));
      });
      s.on('error', reject);
    });
    const registry = [
      {
        organizationId: ORG_ID,
        provider: 'CHATWOOT',
        connectionId: CONN_ID,
        secret: SECRET,
        algorithm: 'HMAC_SHA256',
      },
    ];
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
      DATABASE_URL: harness.url,
    };
    const r = loadConfig({ env, kind: 'api' });
    const server = await startServer(r.config, { prisma: harness.prisma, env });
    receiver = { server, port: r.config.listen.port, prisma: harness.prisma };
  });

  after(async () => {
    if (receiver) {
      await new Promise((resolve, reject) => {
        receiver.server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    if (harness) await harness.stop();
  });

  test('two POSTs in tight succession reproduce terminal 503', async () => {
    // Minimal payload (no sender/conversation) -- the receiver should still
    // accept and durable-commit a receipt. We classify inputs by eventId:
    //   burst  -> N POSTs at the SAME connectionId with distinct eventIds,
    //             fired concurrently (Promise.all) to maximize Prisma+PG18
    //             RETURNING [] race windows.
    // Race signature: one or more burst POSTs return 503 store_unavailable
    // after the receiver's internal transactional state is "hot".
    //
    // We previously observed the B.02 suite reliably fail at E2E-5 and
    // E2E-8 with the same 503 store_unavailable code, after ~7 prior
    // webhooks in the same connection within the same second. This
    // minimal reproducer fires 12 concurrent POSTs and counts how many
    // are 202 vs 503.
    const N = 12;
    const burst = [];
    for (let i = 0; i < N; i++) {
      burst.push(
        postWebhook(receiver.port, {
          event: 'message_created',
          id: 'evt-burst-' + i,
          message: { id: 1000 + i, content: 'burst' },
          sender: { id: 'agent-burst', type: 0, role: 'agent' },
        }),
      );
    }
    const results = await Promise.all(burst);
    const statuses = results.map((r) => r.status);
    const codes = results.map((r) => (r.body && r.body.code) || null);
    const okCount = statuses.filter((s) => s === 202).length;
    const storeUnavailable = statuses.filter((s) => s === 503).length;
    console.log(JSON.stringify({
      step: 'concurrent_burst',
      n: N,
      statuses,
      codes,
      okCount,
      storeUnavailable,
    }));
    if (storeUnavailable > 0) {
      console.log(JSON.stringify({
        repro: 'confirmed',
        signature: 'concurrent_burst_includes_503_store_unavailable',
        storeUnavailable,
        okCount,
      }));
    } else {
      console.log(JSON.stringify({
        repro: 'not_confirmed_in_this_run',
        note: 'race is non-deterministic; rerun a few times',
      }));
    }
    assert.ok(okCount >= 1, 'at least one burst POST must succeed (sanity)');
  });
});
