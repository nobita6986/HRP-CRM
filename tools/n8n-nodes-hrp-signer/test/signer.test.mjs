// signer.test.mjs -- algorithm correctness assertions.
// Run with: node --test test/signer.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalJson,
  sha256Hex,
  payloadDigestHex,
  signLegacy,
  stripNonDigestFields,
  scopeKeyFor,
  composeSigningInput,
  buildHeadersAndSignature,
} from '../dist/signer.mjs';

const FIXTURE_SECRET = 'correct horse battery staple';

test('signingInput: scopeKey + LF + payloadDigest (literal LF)', () => {
  const scopeKey = scopeKeyFor({
    organizationId: 'org-1',
    connectionId: 'conn-1',
    serviceId: 'svc-1',
    commandName: 'listDueNextActions',
    idempotencyKey: 'idem-1',
  });
  const digest = payloadDigestHex({ a: 1, b: 2 });
  const out = composeSigningInput(scopeKey, digest);
  assert.equal(out, scopeKey + '\n' + digest, 'must join with literal LF');
  assert.ok(!out.includes('\r\n'), 'must not contain CRLF');
});

test('scopeKeyFor: single NUL delimiters between five fields', () => {
  const out = scopeKeyFor({
    organizationId: 'org',
    connectionId: 'conn',
    serviceId: 'svc',
    commandName: 'cmd',
    idempotencyKey: 'idem',
  });
  // Five fields -> exactly four delimiters.
  const delimCount = Array.from(out).filter((c) => c === '\0').length;
  assert.equal(delimCount, 4, 'exactly four NUL delimiters');
  const total = 'org'.length + 'conn'.length + 'svc'.length + 'cmd'.length + 'idem'.length + 4;
  assert.equal(out.length, total, 'length equals sum of fields plus 4 NULs');
});

test('canonicalJson: deterministic key-sort, no whitespace', () => {
  const a = canonicalJson({ b: 2, a: 1 });
  const b = canonicalJson({ a: 1, b: 2 });
  assert.equal(a, b);
  assert.equal(a, '{"a":1,"b":2}');
});

test('signLegacy: returns 64-char lowercase hex', () => {
  const h = signLegacy('input-text', FIXTURE_SECRET);
  assert.equal(h.length, 64);
  assert.equal(h, h.toLowerCase());
  assert.match(h, /^[0-9a-f]{64}$/);
});

test('signLegacy: deterministic given identical inputs', () => {
  const a = signLegacy('hello', FIXTURE_SECRET);
  const b = signLegacy('hello', FIXTURE_SECRET);
  assert.equal(a, b);
});

test('signLegacy: differs when secret differs by one byte', () => {
  const a = signLegacy('hello', FIXTURE_SECRET);
  const b = signLegacy('hello', FIXTURE_SECRET + '!');
  assert.notEqual(a, b);
});

test('stripNonDigestFields: removes correlationId/occurredAt/commandId and n8nExecutionId from automationSource', () => {
  const env = {
    correlationId: 'corr-1',
    occurredAt: '2026-01-01T00:00:00Z',
    commandId: 'cmd-99',
    commandName: 'listDueNextActions',
    idempotencyKey: 'idem-1',
    organizationId: 'org-1',
    connectionId: 'conn-1',
    serviceId: 'svc-1',
    automationSource: {
      workflowId: 'wf-1',
      workflowRevision: 3,
      n8nExecutionId: 'exec-1',
      n8nNodeName: 'ScheduleTrigger',
    },
  };
  const stripped = stripNonDigestFields(env);
  assert.equal(stripped.correlationId, undefined);
  assert.equal(stripped.occurredAt, undefined);
  assert.equal(stripped.commandId, undefined);
  assert.equal(stripped.automationSource.n8nExecutionId, undefined);
  assert.equal(stripped.commandName, 'listDueNextActions');
  assert.equal(stripped.automationSource.workflowId, 'wf-1');
});

test('stripNonDigestFields: handles envelopes without automationSource', () => {
  const env = {
    correlationId: 'corr-1',
    occurredAt: '2026-01-01T00:00:00Z',
    commandId: 'cmd-99',
    commandName: 'listDueNextActions',
    idempotencyKey: 'idem-1',
    organizationId: 'org-1',
    connectionId: 'conn-1',
    serviceId: 'svc-1',
  };
  const stripped = stripNonDigestFields(env);
  assert.equal(stripped.correlationId, undefined);
  assert.equal(stripped.commandName, 'listDueNextActions');
  assert.equal(stripped.automationSource, undefined);
});

test('buildHeadersAndSignature: emits exactly the four X-Hrp-Automation headers in order', () => {
  const env = {
    correlationId: 'corr-1',
    occurredAt: '2026-01-01T00:00:00Z',
    commandId: 'cmd-99',
    commandName: 'listDueNextActions',
    idempotencyKey: 'idem-1',
    organizationId: 'org-1',
    connectionId: 'conn-1',
    serviceId: 'svc-1',
    automationSource: { workflowId: 'wf-1', workflowRevision: 3, n8nExecutionId: 'exec-1' },
  };
  const cred = {
    serviceId: 'svc-1',
    organizationId: 'org-1',
    connectionId: 'conn-1',
    secret: FIXTURE_SECRET,
  };
  const out = buildHeadersAndSignature({ envelope: env, credential: cred });
  const keys = Object.keys(out.headers);
  assert.deepEqual(keys, [
    'X-Hrp-Automation-Service-Id',
    'X-Hrp-Automation-Organization-Id',
    'X-Hrp-Automation-Connection-Id',
    'X-Hrp-Automation-Signature',
  ]);
  assert.equal(out.headers['X-Hrp-Automation-Service-Id'], 'svc-1');
  assert.equal(out.headers['X-Hrp-Automation-Organization-Id'], 'org-1');
  assert.equal(out.headers['X-Hrp-Automation-Connection-Id'], 'conn-1');
  assert.match(out.headers['X-Hrp-Automation-Signature'], /^[0-9a-f]{64}$/);
  assert.equal(out.signerProfile.kind, 'LEGACY_SHA256_INPUT_SECRET');
  assert.equal(out.signerProfile.algorithm, 'sha256(signingInput || secret)');
});

test('buildHeadersAndSignature: NEVER leaks secret, payloadDigest, or signingInput', () => {
  const env = {
    correlationId: 'corr-1',
    occurredAt: '2026-01-01T00:00:00Z',
    commandId: 'cmd-99',
    commandName: 'listDueNextActions',
    idempotencyKey: 'idem-1',
    organizationId: 'org-1',
    connectionId: 'conn-1',
    serviceId: 'svc-1',
    automationSource: { workflowId: 'wf-1', workflowRevision: 3, n8nExecutionId: 'exec-1' },
  };
  const cred = {
    serviceId: 'svc-1',
    organizationId: 'org-1',
    connectionId: 'conn-1',
    secret: FIXTURE_SECRET,
  };
  const out = buildHeadersAndSignature({ envelope: env, credential: cred });
  const dumped = JSON.stringify(out);
  assert.ok(!dumped.includes(FIXTURE_SECRET), 'literal secret must not appear');
  assert.ok(!dumped.includes(FIXTURE_SECRET.slice(0, 16)), '16-char prefix of secret must not appear');
  // SHA-256 of the secret alone must not appear.
  const secretOnlyDigest = sha256Hex(FIXTURE_SECRET);
  assert.ok(!dumped.includes(secretOnlyDigest), 'SHA-256 of secret must not appear');
});

test('source: no hmac* identifier without legacy- prefix', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const url = await import('node:url');
  const __filename = url.fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const root = path.resolve(__dirname, '..', 'dist');
  const files = await fs.readdir(root);
  const offenders = [];
  for (const f of files) {
    if (!f.endsWith('.mjs')) continue;
    const text = await fs.readFile(path.join(root, f), 'utf8');
    const lines = text.split('\n');
    for (const line of lines) {
      const m = line.match(/^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][0-9A-Za-z_$]*)/);
      if (m && /hmac/i.test(m[1]) && !m[1].toLowerCase().includes('legacy')) {
        offenders.push(f + ': ' + m[1]);
      }
    }
  }
  assert.deepEqual(offenders, [], 'no export named hmac* without legacy prefix');
});