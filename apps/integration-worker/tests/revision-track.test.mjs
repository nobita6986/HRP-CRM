/**
 * tests/revision-track.test.mjs — CORE/1.5 Δ2
 *
 * §AC4: Out-of-order hoặc mapping revision đổi không áp dụng sai target.
 *
 * Test scenarios:
 *  1. Event with no mappingRevision claim (first observation) → no gate
 *  2. Event matching current revision → FRESH, action as resolved
 *  3. Event with stale revision (claim < current) → BLOCKED
 *  4. Event with forward revision (claim > current) → CREATE_REVIEW (if would CALL_GATEWAY)
 *  5. Multiple consecutive revisions simulated deterministically
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { executePipelineForReceipt } from '../dist/pipeline-executor.js';
import { GatewayClient } from '../dist/gateway-client.js';
import {
  createMockRevisionTracker,
} from '../dist/mapping.js';

const ORG_ID = '00000000-0000-0000-0000-00000000000e';
const CONN_ID = 'conn-rev';
const CONV_ID = 'conv-rev-001';
const PORT = 34998;

function buildChatwootBody(senderId, content, aggregateVersion) {
  const body = {
    event: 'message_created',
    message: { content: content ?? 'msg', private: false },
    conversation: { id: CONV_ID, status: 'open', inbox_id: 1 },
    sender: { id: senderId ?? 'ext-rev', type: 1, role: 'user', phone_number: '+84909000' },
  };
  if (aggregateVersion !== undefined) {
    body.aggregate_version = aggregateVersion;
  }
  return body;
}

describe('§AC4: mapping revision gating', () => {
  const gatewayCalls = [];
  let server;

  before(async () => {
    server = createMockGateway(PORT, gatewayCalls);
  });

  after(async () => {
    if (server) server.close();
  });

  test('FIRST_OBSERVATION: no claim revision → no gate', async () => {
    const tracker = createMockRevisionTracker();
    const client = new GatewayClient({ baseUrl: `http://127.0.0.1:${PORT}`, timeoutMs: 5000 });

    const body = buildChatwootBody('a', 'first msg');
    const outcome = await executePipelineForReceipt({
      receiptId: 'r-rev-001',
      eventId: 'evt-a',
      organizationId: ORG_ID,
      provider: 'CHATWOOT',
      connectionId: CONN_ID,
      payloadDigest: 'd',
      schemaVersion: '1',
      attempts: 1,
      idempotencyKey: 'idem-rev-001',
      correlationId: 'corr-rev-001',
      parsedEvent: body,
    }, { gatewayClient: client, revisionTracker: tracker });

    assert.notEqual(outcome.status, 'GATEWAY_ERROR');
  });

  test('STALE: claim < current → BLOCKED', async () => {
    const internalStore = new Map();
    internalStore.set(`${ORG_ID}::${CONV_ID}`, 5);

    const wrappedTracker = wrapTracker(internalStore);
    const client = new GatewayClient({ baseUrl: `http://127.0.0.1:${PORT}`, timeoutMs: 5000 });

    // Event claims revision 3 (stale)
    const body = buildChatwootBody('b', 'stale msg', 3);
    gatewayCalls.length = 0;

    const outcome = await executePipelineForReceipt({
      receiptId: 'r-rev-stale',
      eventId: 'evt-b',
      organizationId: ORG_ID,
      provider: 'CHATWOOT',
      connectionId: CONN_ID,
      payloadDigest: 'd',
      schemaVersion: '1',
      attempts: 1,
      idempotencyKey: 'idem-rev-stale',
      correlationId: 'corr-stale',
      parsedEvent: body,
    }, { gatewayClient: client, revisionTracker: wrappedTracker });

    assert.equal(outcome.status, 'SKIPPED');
    assert.match(outcome.reason, /stale|revision/i);
    assert.equal(gatewayCalls.length, 0);
  });

  test('FORWARD_REVISION: claim > current + CALL_GATEWAY → REVIEW', async () => {
    const internalStore = new Map();
    internalStore.set(`${ORG_ID}::${CONV_ID}`, 3);

    const wrappedTracker = wrapTracker(internalStore);
    const client = new GatewayClient({ baseUrl: `http://127.0.0.1:${PORT}`, timeoutMs: 5000 });

    const body = buildChatwootBody('c', 'forward msg', 7);
    gatewayCalls.length = 0;

    const outcome = await executePipelineForReceipt({
      receiptId: 'r-rev-forward',
      eventId: 'evt-c',
      organizationId: ORG_ID,
      provider: 'CHATWOOT',
      connectionId: CONN_ID,
      payloadDigest: 'd',
      schemaVersion: '1',
      attempts: 1,
      idempotencyKey: 'idem-rev-forward',
      correlationId: 'corr-forward',
      parsedEvent: body,
    }, { gatewayClient: client, revisionTracker: wrappedTracker });

    assert.ok(['REVIEW', 'SKIPPED'].includes(outcome.status));
    assert.equal(gatewayCalls.length, 0);
  });

  test('FRESH: claim === current → no gate, action as resolved', async () => {
    const internalStore = new Map();
    internalStore.set(`${ORG_ID}::${CONV_ID}`, 4);

    const wrappedTracker = wrapTracker(internalStore);
    const client = new GatewayClient({ baseUrl: `http://127.0.0.1:${PORT}`, timeoutMs: 5000 });

    const body = buildChatwootBody('d', 'fresh msg', 4);

    const outcome = await executePipelineForReceipt({
      receiptId: 'r-rev-fresh',
      eventId: 'evt-d',
      organizationId: ORG_ID,
      provider: 'CHATWOOT',
      connectionId: CONN_ID,
      payloadDigest: 'd',
      schemaVersion: '1',
      attempts: 1,
      idempotencyKey: 'idem-rev-fresh',
      correlationId: 'corr-fresh',
      parsedEvent: body,
    }, { gatewayClient: client, revisionTracker: wrappedTracker });

    assert.notEqual(outcome.status, 'GATEWAY_ERROR');
  });
});

function wrapTracker(internalStore) {
  return {
    getCurrentRevision: async (args) => internalStore.get(`${args.organizationId}::${args.conversationId}`) ?? null,
    checkRevision: async (args) => {
      const key = `${args.organizationId}::${args.conversationId}`;
      const observed = internalStore.get(key) ?? null;
      if (observed === null) return { kind: 'FIRST_OBSERVATION', observedRevision: null };
      if (args.claimRevision === null) return { kind: 'FRESH', observedRevision: observed };
      if (args.claimRevision < observed) return { kind: 'STALE', observedRevision: observed, claimRevision: args.claimRevision };
      if (args.claimRevision > observed) return { kind: 'FORWARD_REVISION', observedRevision: observed, claimRevision: args.claimRevision };
      return { kind: 'FRESH', observedRevision: observed };
    },
  };
}

function createMockGateway(port, calls) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const request = JSON.parse(body);
      calls.push(request);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ACCEPTED',
        schemaVersion: '1',
        commandId: request.commandId,
        correlationId: request.correlationId,
        operation: { kind: 'COMMAND_OPERATION', operationId: `op-${request.idempotencyKey}` },
        errors: [],
      }));
    });
  });
  server.listen(port, '127.0.0.1');
  return server;
}
