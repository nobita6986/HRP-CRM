import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { HrpAutomationLegacySignature } = require('../dist/credentials/HrpAutomationLegacySignature.credentials.js');
const { HrpAutomationDispatch } = require('../dist/nodes/HrpAutomationDispatch/HrpAutomationDispatch.node.js');

const credential = {
  gatewayUrl: 'https://crm-api.example.vn',
  serviceId: 'svc-crm-n8n',
  organizationId: 'org-synthetic',
  connectionId: 'conn-synthetic',
  secret: 'synthetic-secret-at-least-32-characters-long',
};

const envelope = {
  commandId: 'cmd-1',
  commandName: 'sendSyntheticReminder',
  idempotencyKey: 'idem-1',
  correlationId: 'corr-1',
  organizationId: 'org-synthetic',
  source: { connectionId: 'conn-synthetic' },
  actor: { serviceId: 'svc-crm-n8n' },
  occurredAt: '2026-09-28T00:00:00.000Z',
  automationSource: { n8nExecutionId: '10' },
  operation: { op: 'sendSyntheticReminder', payload: {} },
};

test('exports loadable n8n credential and node classes', () => {
  const credentialType = new HrpAutomationLegacySignature();
  const nodeType = new HrpAutomationDispatch();
  assert.equal(credentialType.name, 'hrpAutomationLegacySignature');
  assert.equal(nodeType.description.name, 'hrpAutomationDispatch');
  assert.deepEqual(nodeType.description.credentials, [
    { name: 'hrpAutomationLegacySignature', required: true },
  ]);
});

test('dispatches signed request and emits no secret or signature', async () => {
  let observedRequest;
  const context = {
    getInputData: () => [{ json: { envelope } }],
    getCredentials: async () => credential,
    getNodeParameter: (name) => (name === 'envelope' ? envelope : 5000),
    helpers: {
      httpRequest: async (request) => {
        observedRequest = request;
        return { statusCode: 200, body: { status: 'APPLIED' } };
      },
    },
  };
  const [items] = await HrpAutomationDispatch.prototype.execute.call(context);
  assert.equal(items.length, 1);
  assert.equal(items[0].json.statusCode, 200);
  assert.equal(items[0].json.body.status, 'APPLIED');
  assert.match(observedRequest.headers['X-Hrp-Automation-Signature'], /^[a-f0-9]{64}$/u);
  const output = JSON.stringify(items);
  assert.ok(!output.includes(credential.secret));
  assert.ok(!output.includes(observedRequest.headers['X-Hrp-Automation-Signature']));
});

test('masks transport error details', async () => {
  const context = {
    getInputData: () => [{ json: { envelope } }],
    getCredentials: async () => credential,
    getNodeParameter: (name) => (name === 'envelope' ? envelope : 5000),
    helpers: {
      httpRequest: async () => {
        throw new Error(`request failed with secret ${credential.secret}`);
      },
    },
  };
  await assert.rejects(
    HrpAutomationDispatch.prototype.execute.call(context),
    (error) => error.message === 'HRP automation dispatch failed for item 0',
  );
});
