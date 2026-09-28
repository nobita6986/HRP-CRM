import assert from 'node:assert/strict';
import test from 'node:test';
import { createVerifier, expectedSignature } from './server.mjs';

const identity = {
  serviceId: 'svc-crm-n8n-signer-test',
  organizationId: 'org-synthetic-signer',
  connectionId: 'conn-synthetic-signer',
};
const secret = 'synthetic-test-secret-that-is-longer-than-thirty-two';
const envelope = {
  schemaVersion: '1',
  commandId: 'cmd-synthetic-1',
  commandName: 'sendSyntheticReminder',
  idempotencyKey: 'idem-synthetic-1',
  correlationId: 'corr-synthetic-1',
  organizationId: identity.organizationId,
  source: { kind: 'CRM', provider: 'CRM', connectionId: identity.connectionId },
  actor: { kind: 'SERVICE', serviceId: identity.serviceId },
  occurredAt: '2026-09-28T00:00:00.000Z',
  automationSource: { kind: 'N8N', workflowId: 'synthetic', n8nExecutionId: '1' },
  operation: { op: 'sendSyntheticReminder', payload: { nextActionId: 'na-synthetic' } },
};

async function withServer(run) {
  const server = createVerifier({ identity, secret });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function signedHeaders(value = envelope) {
  return {
    'content-type': 'application/json',
    'x-hrp-automation-service-id': identity.serviceId,
    'x-hrp-automation-organization-id': identity.organizationId,
    'x-hrp-automation-connection-id': identity.connectionId,
    'x-hrp-automation-signature': expectedSignature(value, identity, secret).signature,
  };
}

test('accepts a correctly signed envelope and caches an exact replay', async () => withServer(async (base) => {
  const first = await fetch(`${base}/v1/automation/dispatch`, { method: 'POST', headers: signedHeaders(), body: JSON.stringify(envelope) });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {
    status: 'APPLIED', mode: 'SYNTHETIC_SIGNER_RUNTIME_VERIFIER', cached: false,
    payloadDigest: expectedSignature(envelope, identity, secret).digest,
  });
  const replay = await fetch(`${base}/v1/automation/dispatch`, { method: 'POST', headers: signedHeaders(), body: JSON.stringify(envelope) });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).cached, true);
}));

test('rejects wrong signatures without reflecting sensitive input', async () => withServer(async (base) => {
  const headers = signedHeaders();
  headers['x-hrp-automation-signature'] = '0'.repeat(64);
  const response = await fetch(`${base}/v1/automation/dispatch`, { method: 'POST', headers, body: JSON.stringify(envelope) });
  assert.equal(response.status, 401);
  const body = await response.text();
  assert.equal(body.includes(secret), false);
  assert.equal(body.includes(headers['x-hrp-automation-signature']), false);
}));

test('rejects header and body identity mismatches', async () => withServer(async (base) => {
  const headers = signedHeaders();
  headers['x-hrp-automation-service-id'] = 'svc-other';
  assert.equal((await fetch(`${base}/v1/automation/dispatch`, { method: 'POST', headers, body: JSON.stringify(envelope) })).status, 401);
  const changed = structuredClone(envelope);
  changed.organizationId = 'org-other';
  assert.equal((await fetch(`${base}/v1/automation/dispatch`, { method: 'POST', headers: signedHeaders(changed), body: JSON.stringify(changed) })).status, 403);
}));

test('rejects an idempotency collision', async () => withServer(async (base) => {
  await fetch(`${base}/v1/automation/dispatch`, { method: 'POST', headers: signedHeaders(), body: JSON.stringify(envelope) });
  const changed = structuredClone(envelope);
  changed.operation.payload.nextActionId = 'na-changed';
  const response = await fetch(`${base}/v1/automation/dispatch`, { method: 'POST', headers: signedHeaders(changed), body: JSON.stringify(changed) });
  assert.equal(response.status, 409);
}));

test('health endpoint exposes only verifier mode', async () => withServer(async (base) => {
  const response = await fetch(`${base}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', mode: 'SYNTHETIC_SIGNER_RUNTIME_VERIFIER' });
}));
