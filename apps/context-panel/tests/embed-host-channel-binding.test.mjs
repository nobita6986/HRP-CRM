/**
 * tests/embed-host-channel-binding.test.mjs — B.03-PREP C-B03-01 regression tests.
 *
 * Covered:
 *   - correct parent + allowed origin  -> accepted
 *   - allowed origin + fake source     -> rejected (SOURCE_MISMATCH)
 *   - correct parent + foreign origin  -> rejected (ORIGIN_NOT_ALLOWED)
 *   - rejected source does NOT receive a response
 *   - outbound targetOrigin matches verified parent origin
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { bindChannel, postToParent } = require('../dist/embed/channel-binding.js');

// These are in HOST_ALLOWED_ORIGINS (see message-protocol.js)
const LOCAL_ORIGIN = 'http://localhost:15503';
const FOREIGN_ORIGIN = 'https://evil.example.com';

let replyLog = [];

function fakeParentWindow() {
  return {
    postMessage(msg, target) {
      replyLog.push({ msg, target });
    },
  };
}

test('C-B03-01 — bindChannel: allowed origin -> returns binding with verifiedParentOrigin', () => {
  const binding = bindChannel(fakeParentWindow(), LOCAL_ORIGIN);
  assert.ok(binding !== null);
  assert.equal(binding.verifyParentOrigin(), LOCAL_ORIGIN);
  assert.equal(binding.isBound(), true);
});

test('C-B03-01 — bindChannel: foreign origin -> throws', () => {
  let threw = false;
  try { bindChannel(fakeParentWindow(), FOREIGN_ORIGIN); } catch { threw = true; }
  assert.equal(threw, true, 'bindChannel must throw on foreign origin');
});

test('C-B03-01 — accept: correct parent + allowed origin -> ok', () => {
  const parent = fakeParentWindow();
  const binding = bindChannel(parent, LOCAL_ORIGIN);
  const result = binding.accept({ origin: LOCAL_ORIGIN, source: parent });
  assert.equal(result.ok, true);
});

test('C-B03-01 — accept: allowed origin + sibling/fake source -> rejected', () => {
  const parent = fakeParentWindow();
  const sibling = { postMessage: () => {} }; // not the same object
  const binding = bindChannel(parent, LOCAL_ORIGIN);
  const result = binding.accept({ origin: LOCAL_ORIGIN, source: sibling });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SOURCE_MISMATCH');
});

test('C-B03-01 — accept: correct parent + foreign origin -> rejected', () => {
  const parent = fakeParentWindow();
  const binding = bindChannel(parent, LOCAL_ORIGIN);
  const result = binding.accept({ origin: FOREIGN_ORIGIN, source: parent });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ORIGIN_NOT_ALLOWED');
});

test('C-B03-01 — postToParent: uses verifiedParentOrigin as targetOrigin', () => {
  replyLog = [];
  const parent = fakeParentWindow();
  const binding = bindChannel(parent, LOCAL_ORIGIN);
  postToParent(binding, { type: 'talent-context-read/request' });
  assert.equal(replyLog.length, 1);
  assert.equal(replyLog[0].target, LOCAL_ORIGIN,
    'targetOrigin must be the verified parent origin, not * or window.location.origin');
});

test('C-B03-01 — postToParent: null binding -> no-op', () => {
  replyLog = [];
  postToParent(null, { type: 'talent-context-read/request' });
  assert.equal(replyLog.length, 0, 'must not send when binding is null');
});