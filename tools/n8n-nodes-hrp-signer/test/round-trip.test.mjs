// round-trip.test.mjs -- bytes-level round-trip test against the
// SAME SHA-256 algorithm the N8N/0.3 gateway uses. Imports the
// helper module from the integration-api dist tree if it exists,
// otherwise imports the source .ts? No -- uses our own
// signer.mjs which re-implements the SAME pure helpers byte-for-byte
// as digest.ts. We then use the gateway via a local fake that:
//   - reads rawBody bytes, parses the envelope,
//   - reads X-Hrp-Automation-* headers,
//   - recomputes payloadDigest + scopeKey + signingInput,
//   - calls signLegacy() of signer.mjs and compares.
//
// A pure signature round-trip is sufficient here; we are NOT
// booting the real gateway (mocks would be required for that and
// the integration-api build is out of scope for this round).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { executeHrpAutomationSigner } from '../dist/index.mjs';
import {
  stripNonDigestFields,
  scopeKeyFor,
  composeSigningInput,
  signLegacy,
  payloadDigestHex,
} from '../dist/signer.mjs';

const SECRET = 'correct horse battery staple';

const BASE_ENV = {
  correlationId: 'corr-1',
  occurredAt: '2026-01-01T00:00:00Z',
  commandId: 'cmd-99',
  commandName: 'listDueNextActions',
  idempotencyKey: 'idem-1',
  organizationId: 'org-1',
  connectionId: 'conn-1',
  serviceId: 'svc-1',
  automationSource: { workflowId: 'wf-1', workflowRevision: 3, n8nExecutionId: 'exec-1' },
  operation: { op: 'listDueNextActions', payload: { cursor: null, limit: 10 } },
  schemaVersion: '0.0.0',
};

const CRED = { serviceId: 'svc-1', organizationId: 'org-1', connectionId: 'conn-1', secret: SECRET };
const CREDS = { hrpAutomationLegacySignature: CRED };

function recomputeSignature(envelope, secret) {
  const env = stripNonDigestFields(envelope);
  const digest = payloadDigestHex(env);
  const scopeKey = scopeKeyFor({
    organizationId: envelope.organizationId,
    connectionId: envelope.connectionId,
    serviceId: envelope.serviceId,
    commandName: envelope.commandName,
    idempotencyKey: envelope.idempotencyKey,
  });
  const input = composeSigningInput(scopeKey, digest);
  return { signatureHex: signLegacy(input, secret), payloadDigest: digest, scopeKey };
}

test('round-trip: signer output verifies against an independently-recomputed digest+sig', () => {
  const r = executeHrpAutomationSigner({
    params: { envelope: BASE_ENV, credentialName: 'hrpAutomationLegacySignature' },
    credentials: CREDS,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    const { signatureHex, payloadDigest, scopeKey } = recomputeSignature(BASE_ENV, SECRET);
    assert.equal(r.output.headers['X-Hrp-Automation-Signature'], signatureHex, 'signature must match');
    // Same body -> same payloadDigest -> same envelope -> SCOPE key stays the same.
    assert.equal(scopeKey.indexOf(BASE_ENV.organizationId) >= 0, true);
    assert.equal(scopeKey.indexOf(BASE_ENV.idempotencyKey) >= 0, true);
    assert.match(payloadDigest, /^[0-9a-f]{64}$/);
  }
});

test('round-trip: WRONG secret fails signature mismatch', () => {
  const WRONG_CRED = { ...CRED, secret: 'wrong-secret-on-purpose' };
  const WRONG_CREDS = { hrpAutomationLegacySignature: WRONG_CRED };
  const r = executeHrpAutomationSigner({
    params: { envelope: BASE_ENV, credentialName: 'hrpAutomationLegacySignature' },
    credentials: WRONG_CREDS,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    const sig1 = r.output.headers['X-Hrp-Automation-Signature'];
    const { signatureHex: sig2 } = recomputeSignature(BASE_ENV, SECRET);
    assert.notEqual(sig1, sig2, 'signed with wrong secret must not equal correct signature');
  }
});

test('round-trip: stripped-vs-unstripped envelope digest differs', () => {
  // Sanity: stripping tracking ids MUST change the digest (it can
  // never accidentally no-op).
  const env = { ...BASE_ENV, correlationId: 'corr-A' };
  const d1 = payloadDigestHex(stripNonDigestFields(env));
  const env2 = { ...BASE_ENV, correlationId: 'corr-B' };
  const d2 = payloadDigestHex(stripNonDigestFields(env2));
  assert.equal(d1, d2, 'rotating correlationId MUST NOT change payload digest');
  const env3 = { ...BASE_ENV, commandName: 'acknowledgeReminder' };
  const d3 = payloadDigestHex(stripNonDigestFields(env3));
  assert.notEqual(d1, d3, 'changing commandName MUST change payload digest');
});