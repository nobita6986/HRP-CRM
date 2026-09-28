import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildSignedRequest,
  canonicalJson,
  payloadDigestHex,
  signLegacy,
  stripNonDigestFields,
} = require('../dist/lib/signer.js');

const credential = {
  gatewayUrl: 'https://crm-api.example.vn/',
  serviceId: 'svc-crm-n8n',
  organizationId: 'org-synthetic',
  connectionId: 'conn-synthetic',
  secret: 'synthetic-secret-at-least-32-characters-long',
};

const envelope = {
  schemaVersion: '1',
  commandId: 'cmd-1',
  commandName: 'sendSyntheticReminder',
  idempotencyKey: 'idem-1',
  correlationId: 'corr-1',
  organizationId: 'org-synthetic',
  source: { kind: 'CRM', provider: 'CRM', connectionId: 'conn-synthetic' },
  actor: { kind: 'SERVICE', serviceId: 'svc-crm-n8n' },
  occurredAt: '2026-09-28T00:00:00.000Z',
  automationSource: { kind: 'N8N', workflowId: 'wf', n8nExecutionId: '10' },
  operation: { op: 'sendSyntheticReminder', payload: { nextActionId: 'na-1' } },
};

test('canonical JSON sorts object keys recursively', () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}');
});

test('tracking fields do not affect payload digest', () => {
  const changed = {
    ...envelope,
    commandId: 'cmd-2',
    correlationId: 'corr-2',
    occurredAt: '2026-09-28T00:01:00.000Z',
    automationSource: { ...envelope.automationSource, n8nExecutionId: '11' },
  };
  assert.deepEqual(Object.keys(stripNonDigestFields(changed)).sort(), Object.keys(stripNonDigestFields(envelope)).sort());
  assert.equal(payloadDigestHex(changed), payloadDigestHex(envelope));
});

test('builds exactly four identity/signature headers and hides the secret', () => {
  const request = buildSignedRequest(envelope, credential);
  assert.equal(request.url, 'https://crm-api.example.vn/v1/automation/dispatch');
  assert.deepEqual(Object.keys(request.headers).sort(), [
    'Content-Type',
    'X-Hrp-Automation-Connection-Id',
    'X-Hrp-Automation-Organization-Id',
    'X-Hrp-Automation-Service-Id',
    'X-Hrp-Automation-Signature',
  ]);
  assert.match(request.headers['X-Hrp-Automation-Signature'], /^[a-f0-9]{64}$/u);
  assert.ok(!JSON.stringify(request).includes(credential.secret));
});

test('signature agrees with independent input reconstruction', () => {
  const request = buildSignedRequest(envelope, credential);
  const scope = [
    credential.organizationId,
    credential.connectionId,
    credential.serviceId,
    envelope.commandName,
    envelope.idempotencyKey,
  ].join('\0');
  assert.equal(
    request.headers['X-Hrp-Automation-Signature'],
    signLegacy(`${scope}\n${payloadDigestHex(envelope)}`, credential.secret),
  );
});

for (const [label, mutate] of [
  ['organization mismatch', (value) => { value.organizationId = 'org-other'; }],
  ['connection mismatch', (value) => { value.source.connectionId = 'conn-other'; }],
  ['service mismatch', (value) => { value.actor.serviceId = 'svc-other'; }],
]) {
  test(`rejects ${label}`, () => {
    const changed = structuredClone(envelope);
    mutate(changed);
    assert.throws(() => buildSignedRequest(changed, credential), /does not match credential/u);
  });
}

test('rejects unsafe gateway URLs and short secrets', () => {
  assert.throws(
    () => buildSignedRequest(envelope, { ...credential, gatewayUrl: 'http://crm-api.example.vn' }),
    /HTTPS URL/u,
  );
  assert.throws(
    () => buildSignedRequest(envelope, { ...credential, secret: 'short' }),
    /at least 32/u,
  );
});
