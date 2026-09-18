/**
 * tests/secret-provider.test.mjs — Fake secret provider (CORE/1.10).
 *
 * Proves:
 *  - accessSecret returns ONLY SecretPortHandle (schema-compliant).
 *  - secretValue NEVER appears in the handle.
 *  - secretValue NEVER appears in JSON.stringify(handle).
 *  - secretValue NEVER appears in a redacted log payload.
 *  - browser-safe payload only contains opaque secretHandle.
 *  - Forbidden keys in payload are replaced by [REDACTED].
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerSecret,
  clearSecrets,
  assertSecretValue,
  accessSecret,
  redactPayload,
  assertNoSecretLeak,
  toBrowserSafePayload,
} from '../dist/index.js';

function reset() {
  clearSecrets();
}

test('secret-provider: accessSecret returns only SecretPortHandle (no value)', () => {
  reset();
  const handle = accessSecret({
    schemaVersion: '1',
    organizationId: 'org-001',
    capability: 'webhook.signature',
    accessorTier: 'INTEGRATION_BOUND',
  });
  assert.match(handle.secretHandle, /^opaque-[0-9a-f-]+$/u);
  assert.ok(handle.expiresInSec > 0 && handle.expiresInSec <= 3600);
  assert.equal(handle.schemaVersion, '1');
  // The handle must NOT contain 'value', 'secret', 'token', etc.
  const keys = Object.keys(handle);
  for (const k of keys) {
    assert.notEqual(k.toLowerCase(), 'secretvalue');
    assert.notEqual(k.toLowerCase(), 'secret');
    assert.notEqual(k.toLowerCase(), 'token');
  }
});

test('secret-provider: JSON.stringify(handle) does NOT leak secret value', () => {
  reset();
  const FAKE_VALUE = 'super-secret-DO-NOT-LEAK-XYZ-42';
  registerSecret('webhook.secret.test', FAKE_VALUE);

  const handle = accessSecret({
    schemaVersion: '1',
    organizationId: 'org-001',
    capability: 'webhook.signature',
    accessorTier: 'INTEGRATION_BOUND',
  });

  const serialized = JSON.stringify(handle);
  assert.equal(
    serialized.includes(FAKE_VALUE),
    false,
    'serialized handle MUST NOT contain the secret value',
  );
  // Sanity: opaque handle IS present (so the test is actually meaningful).
  assert.ok(serialized.includes(handle.secretHandle));
});

test('secret-provider: toBrowserSafePayload does not leak value', () => {
  reset();
  const FAKE_VALUE = 'browser-leak-test-ABC-99';
  registerSecret('chatwoot.token.test', FAKE_VALUE);

  const handle = accessSecret({
    schemaVersion: '1',
    organizationId: 'org-001',
    capability: 'chatwoot.api',
    accessorTier: 'INTEGRATION_BOUND',
  });

  const safe = toBrowserSafePayload(handle);
  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes(FAKE_VALUE), false);
});

test('secret-provider: forbid-key redaction replaces forbidden keys with [REDACTED]', () => {
  reset();
  const FAKE_VALUE = 'redact-test-QQQ-77';
  registerSecret('redact.test', FAKE_VALUE);

  const payload = {
    apiKeyRaw: 'plain-text-key-should-be-redacted',
    passwordRaw: 'plain-text-password-should-be-redacted',
    normalField: 'kept-as-is',
    nested: {
      secretValue: 'nested-secret-should-be-redacted',
      publicField: 'public-nested',
    },
  };

  const redacted = redactPayload(payload);
  const r = /** @type {Record<string, any>} */ (redacted);
  assert.equal(r.apiKeyRaw, '[REDACTED]');
  assert.equal(r.passwordRaw, '[REDACTED]');
  assert.equal(r.normalField, 'kept-as-is');
  assert.equal(r.nested.secretValue, '[REDACTED]');
  assert.equal(r.nested.publicField, 'public-nested');

  const serialized = JSON.stringify(redacted);
  assert.equal(serialized.includes('plain-text-key-should-be-redacted'), false);
  assert.equal(serialized.includes('plain-text-password-should-be-redacted'), false);
  assert.equal(serialized.includes('nested-secret-should-be-redacted'), false);
});

test('secret-provider: registered value appearing in payload is also redacted', () => {
  reset();
  const FAKE_VALUE = 'leak-by-inclusion-PPP-13';
  registerSecret('inclusion.test', FAKE_VALUE);

  // Even if a caller accidentally embeds the secret value into a string,
  // the redaction helper scrubs it.
  const payload = {
    logMessage: `error connecting with token ${FAKE_VALUE}`,
  };

  const redacted = redactPayload(payload);
  const serialized = JSON.stringify(redacted);
  assert.equal(serialized.includes(FAKE_VALUE), false);
  assert.match(serialized, /\[REDACTED\]/u);
});

test('secret-provider: assertNoSecretLeak passes when no leak; throws on leak', () => {
  reset();
  const FAKE_VALUE = 'leak-detection-RRR-55';
  registerSecret('leak.detect', FAKE_VALUE);

  const safe = JSON.stringify({ ok: true, msg: 'no leak here' });
  assertNoSecretLeak(safe); // should not throw

  const unsafe = JSON.stringify({ msg: `contains ${FAKE_VALUE}` });
  assert.throws(() => assertNoSecretLeak(unsafe), /secret leak detected/u);
});

test('secret-provider: assertSecretValue round-trip works (synthetic only)', () => {
  reset();
  registerSecret('round.trip', 'value-A');
  assertSecretValue('round.trip', 'value-A'); // ok
  assert.throws(() => assertSecretValue('round.trip', 'value-B'), /value mismatch/u);
  assert.throws(() => assertSecretValue('unknown.id', 'value-A'), /not registered/u);
});

test('secret-provider: schema validation rejects missing accessorTier', () => {
  reset();
  assert.throws(
    () =>
      accessSecret(
        /** @type {any} */ ({
          schemaVersion: '1',
          organizationId: 'org-001',
          capability: 'webhook.signature',
        }),
      ),
    /accessorTier/u,
  );
});
