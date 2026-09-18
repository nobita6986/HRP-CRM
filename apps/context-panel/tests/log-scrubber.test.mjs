/**
 * tests/log-scrubber.test.mjs — CORE/1.14 log-scrubber unit tests.
 *
 * Proves:
 *  - Field-name blocklist removes blocked keys at any depth.
 *  - Secret value patterns (JWT/Bearer/API keys/CCCD/phone) are redacted.
 *  - Original input is NEVER mutated.
 *  - No-PII paths (routeName, outcome, killSwitchState) pass through unchanged.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrub, isBlockedFieldName } from '../dist/observability/log-scrubber.js';

test('scrub: blocks apiKey at root', () => {
  const input = { apiKey: 'sk-test1234567890123456', model: 'gpt-4' };
  const out = scrub(input);
  assert.equal(out.apiKey, '***');
  assert.equal(out.model, 'gpt-4');
});

test('scrub: blocks apiKey nested 3 levels deep', () => {
  const input = {
    outer: {
      middle: {
        inner: { apiKey: 'secret123', token: 't0k3n' },
      },
    },
  };
  const out = scrub(input);
  assert.equal(out.outer.middle.inner.apiKey, '***');
  assert.equal(out.outer.middle.inner.token, '***');
});

test('scrub: blocks fullName and phone and address and citizenIdentity', () => {
  const input = {
    fullName: 'Nguyen Van A',
    phone: '0901234567',
    address: '123 Le Loi',
    contactAddress: '456 Tran Hung Dao',
    citizenIdentity: { number: '012345678901', address: '789' },
    birthday: '1990-01-01', // not blocked, kept
  };
  const out = scrub(input);
  assert.equal(out.fullName, '***');
  assert.equal(out.phone, '***');
  assert.equal(out.address, '***');
  assert.equal(out.contactAddress, '***');
  // citizenIdentity as a key is fully blocked → value replaced.
  assert.equal(out.citizenIdentity, '***');
  assert.equal(out.birthday, '1990-01-01');
});

test('scrub: JWT token value is redacted', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const input = { header: `Bearer ${jwt}` };
  const out = scrub(input);
  assert.ok(!String(out.header).includes('eyJ'), 'JWT must be redacted');
  assert.ok(String(out.header).includes('***'), '*** must be present');
});

test('scrub: sk- API keys are redacted', () => {
  const input = { value: 'sk-12345678901234567890abcdef' };
  const out = scrub(input);
  assert.ok(!String(out.value).includes('sk-123456'), 'sk- keys must be redacted');
});

test('scrub: phone numbers in string values are redacted', () => {
  const input = { note: 'Contact 0901234567 for details' };
  const out = scrub(input);
  assert.ok(!String(out.note).includes('0901234567'));
});

test('scrub: CCCD 12-digit numbers are redacted in strings', () => {
  const input = { note: 'Citizen ID 012345678901 registered' };
  const out = scrub(input);
  assert.ok(!String(out.note).includes('012345678901'), 'CCCD digits must be redacted');
});

test('scrub: does NOT mutate original input', () => {
  const original = { apiKey: 'sk-12345678901234567890', nested: { token: 'secret' } };
  const originalJson = JSON.stringify(original);
  scrub(original);
  assert.equal(JSON.stringify(original), originalJson, 'scrub must not mutate original');
});

test('scrub: circular ref safe at depth limit', () => {
  const obj = { a: 1 };
  obj.self = obj;
  const out = scrub(obj);
  // depth limit returns string '***' for circular refs.
  assert.ok(out !== undefined);
});

test('scrub: passes through label keys (routeName/outcome)', () => {
  const input = {
    routeName: 'api-assistant-today',
    outcome: 'success',
    killSwitchState: 'disarmed',
    value: 42,
  };
  const out = scrub(input);
  assert.equal(out.routeName, 'api-assistant-today');
  assert.equal(out.outcome, 'success');
  assert.equal(out.killSwitchState, 'disarmed');
  assert.equal(out.value, 42);
});

test('isBlockedFieldName: returns true for blocked names', () => {
  assert.equal(isBlockedFieldName('apiKey'), true);
  assert.equal(isBlockedFieldName('API_KEY'), true);
  assert.equal(isBlockedFieldName('token'), true);
  assert.equal(isBlockedFieldName('password'), true);
  assert.equal(isBlockedFieldName('citizenId'), true);
  assert.equal(isBlockedFieldName('cccd'), true);
  assert.equal(isBlockedFieldName('fullName'), true);
  assert.equal(isBlockedFieldName('phone'), true);
});

test('isBlockedFieldName: returns false for safe names', () => {
  assert.equal(isBlockedFieldName('routeName'), false);
  assert.equal(isBlockedFieldName('outcome'), false);
  assert.equal(isBlockedFieldName('receiptId'), false);
  assert.equal(isBlockedFieldName('correlationId'), false);
});

test('scrub: array elements are scrubbed', () => {
  const input = {
    items: [
      { id: 1, apiKey: 'sk-12345678901234567890' },
      { id: 2, model: 'gpt-4' },
    ],
  };
  const out = scrub(input);
  assert.equal(out.items[0].apiKey, '***');
  assert.equal(out.items[1].model, 'gpt-4');
});
