// credential.test.mjs -- credential field-shape tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertHrpAutomationLegacyCredentialFields,
  HrpAutomationLegacySignatureCredential,
} from '../dist/credential.mjs';

test('credential: accepts the canonical four-field shape', () => {
  const cred = {
    serviceId: 'svc-1',
    organizationId: 'org-1',
    connectionId: 'conn-1',
    secret: 'correct horse battery staple',
  };
  const r = assertHrpAutomationLegacyCredentialFields(cred);
  assert.equal(r.ok, true);
});

test('credential: rejects secret shorter than 8 chars (SHORT_SECRET)', () => {
  const cred = {
    serviceId: 'svc-1',
    organizationId: 'org-1',
    connectionId: 'conn-1',
    secret: 'short',
  };
  const r = assertHrpAutomationLegacyCredentialFields(cred);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, 'SHORT_SECRET');
});

test('credential: rejects missing serviceId', () => {
  const cred = {
    organizationId: 'org-1',
    connectionId: 'conn-1',
    secret: 'correct horse battery staple',
  };
  const r = assertHrpAutomationLegacyCredentialFields(cred);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, 'MISSING_SERVICEID');
});

test('credential: rejects missing connectionId', () => {
  const cred = {
    serviceId: 'svc-1',
    organizationId: 'org-1',
    secret: 'correct horse battery staple',
  };
  const r = assertHrpAutomationLegacyCredentialFields(cred);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, 'MISSING_CONNECTIONID');
});

test('credential: rejects extra unknown fields', () => {
  const cred = {
    serviceId: 'svc-1',
    organizationId: 'org-1',
    connectionId: 'conn-1',
    secret: 'correct horse battery staple',
    extraField: 'oops',
  };
  const r = assertHrpAutomationLegacyCredentialFields(cred);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, 'UNKNOWN_FIELD');
});

test('credential description: NEVER contains HMAC (algorithm honesty)', () => {
  // The human-readable description must not present this as HMAC.
  const desc = HrpAutomationLegacySignatureCredential.description;
  const displayName = HrpAutomationLegacySignatureCredential.displayName;
  // Both are allowed to MENTION HMAC as part of the negation
  // ("NOT HMAC"), but NEVER present the function as HMAC positively.
  // Heuristic: lowercase description without the explicit "not hmac"
  // negation must not start with "hmac".
  const lower = desc.toLowerCase();
  // Either "not hmac" or "sha-256(input || secret)" must appear.
  const saysNotHmac = lower.includes('not hmac');
  const saysLegacy = lower.includes('sha-256(input || secret)') || lower.includes('legacy');
  assert.ok(saysNotHmac && saysLegacy, 'description must say NOT HMAC and use legacy phrase');
  assert.ok(!/^hmac/.test(displayName.toLowerCase()), 'displayName must not start with HMAC');
});