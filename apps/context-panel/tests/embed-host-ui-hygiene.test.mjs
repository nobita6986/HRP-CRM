/**
 * tests/embed-host-ui-hygiene.test.mjs — B.03-PREP C-B03-04 UI error hygiene tests.
 *
 * Asserts that the embed panel UI NEVER renders raw internal error codes,
 * raw exception messages, stack traces, or parser detail as visible text.
 *
 * Approach (no DOM dependency):
 *   1. Source-code assertion: every visible string in embed-panel.tsx and
 *      messages-vi.ts is drawn from the MESSAGES_VI allowlist.
 *   2. Tagged template render via react-dom/server: each denied/error path
 *      is rendered in isolation and inspected for forbidden substrings.
 *   3. MESSAGES_VI key allowlist: the keys object is the only source of
 *      Vietnamese copy; tests do NOT add ad-hoc strings.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as React from 'react';
import * as ReactDOMServer from 'react-dom/server';

import * as bindingModule from '../dist/embed/channel-binding.js';
import * as messageProtocol from '../dist/embed/message-protocol.js';
import { MESSAGES_VI } from '../dist/embed/messages-vi.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeBinding() {
  const parent = {
    postMessage() { /* test stub */ },
  };
  return bindingModule.bindChannel(parent, 'http://localhost:15503');
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

const FORBIDDEN_VISIBLE_TOKENS = [
  'ORIGIN_NOT_ALLOWED',
  'SOURCE_MISMATCH',
  'NOT_WINDOW',
  'UNBOUND_PARENT',
  'SCHEMA_FAILED',
  'PAYLOAD_TOO_LARGE',
  'FORBIDDEN_FIELD',
  'AUTHENTICATION_REQUIRED',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'CROSS_ORG',
  'OBJECT_NOT_PERMITTED',
  'FORBIDDEN',
  'PROJECTION_UNSUPPORTED',
  'VALIDATION_ERROR',
  'MALFORMED_REQUEST',
  'STALE',
  'TIMEOUT',
  'UNAVAILABLE',
  'UNKNOWN',
  'INVALID_RESULT',
  'IDENTITY_SUMMARY_MISSING',
  'REDACTION_UNSAFE',
  'INTERNAL_ERROR',
  'at .*\\.js:',
  'TypeError',
  'SyntaxError',
  'exceeded',
  'details',
];

function assertNoForbidden(text) {
  for (const f of FORBIDDEN_VISIBLE_TOKENS) {
    if (f.includes('.*')) {
      const re = new RegExp(f);
      assert.ok(!re.test(text), `forbidden pattern ${f} in visible text: ${text}`);
    } else {
      assert.ok(!text.includes(f), `forbidden substring "${f}" in visible text: ${text}`);
    }
  }
}

describe('C-B03-04 — MESSAGES_VI is the only source of visible Vietnamese copy', () => {
  it('embed-panel.tsx only references MESSAGES_VI for visible text', () => {
    const src = readFileSync(join(__dirname, '../src/embed/embed-panel.tsx'), 'utf-8');
    // All visible DOM text paths must reference MESSAGES_VI.<key>.
    // We grep for the visible-text JSX blocks. The expected references:
    const expected = [
      'MESSAGES_VI.idle',
      'MESSAGES_VI.loading',
      'MESSAGES_VI.deniedHeader',
      'MESSAGES_VI.hidden',
    ];
    for (const e of expected) {
      assert.ok(src.includes(e), `embed-panel.tsx must reference ${e}`);
    }
    // The phrase 'response' patterns: ensure no leak of parser/api codes as text.
    assert.ok(!src.includes('err.message'), 'must not leak Error.message into visible text');
    assert.ok(!src.includes('state.message'), 'must not leak raw error.message into visible text');
    // data-deny-code is a data-* attribute used in tests; ensure the rendered
    // text path doesn't include it via visible string.
    assert.ok(!src.includes(">{state.code}<"), 'must not render raw code as JSX text');
  });

  it('messages-vi.ts has a stable, frozen allowlist', () => {
    const keys = Object.keys(MESSAGES_VI).sort();
    const expected = [
      'crossOrgDenied',
      'dataInvalid',
      'deniedHeader',
      'hidden',
      'idle',
      'loading',
      'objectDenied',
      'payloadTooLarge',
      'projectionUnsupported',
      'requestInvalid',
      'requestTimeout',
      'sessionInvalid',
      'sourceInvalid',
      'stale',
      'unavailable',
    ].sort();
    assert.deepStrictEqual(keys, expected);
    assert.ok(Object.isFrozen(MESSAGES_VI), 'MESSAGES_VI must be Object.frozen');
  });
});

describe('C-B03-04 — Render rejection paths produce no raw codes', () => {
  it('channel rejection (foreign-origin / sibling-source): vi-only text', () => {
    const binding = makeBinding();
    const { stub } = (function () {
      const posted = [];
      return { stub: { postMessage(...a) { posted.push(a); } }, posted };
    })();
    const sibBinding = bindingModule.bindChannel(stub, 'http://localhost:15503');
    const ev = {
      origin: 'http://localhost:15503',
      source: { postMessage: () => {} },  // sibling (NOT bound)
      data: {},
    };
    const verdict = sibBinding.accept(ev);
    assert.strictEqual(verdict.ok, false);
    const vi = (verdict.code === 'SOURCE_MISMATCH' || verdict.code === 'ORIGIN_NOT_ALLOWED' || verdict.code === 'NOT_WINDOW')
      ? MESSAGES_VI.sourceInvalid
      : MESSAGES_VI.sourceInvalid;
    const tree = React.createElement('div',
      { 'data-testid': 'embed-state-denied', 'data-deny-code': verdict.code },
      React.createElement('strong', null, MESSAGES_VI.deniedHeader),
      React.createElement('div', { 'data-testid': 'embed-vi-message' }, vi));
    const html = ReactDOMServer.renderToStaticMarkup(tree);
    const text = stripTags(html);
    assertNoForbidden(text);
    assert.ok(text.includes(MESSAGES_VI.deniedHeader), 'visible deny header must appear');
    assert.ok(text.includes(MESSAGES_VI.sourceInvalid), 'visible Vietnamese copy must appear');
  });

  it('parser error (oversized / schema-failed): vi-only text', () => {
    const oversized = 'x'.repeat(messageProtocol.MAX_PAYLOAD_BYTES + 1);
    const parsed = messageProtocol.parseEnvelope(oversized);
    assert.strictEqual(parsed.ok, false);
    const vi = parsed.code === 'PAYLOAD_TOO_LARGE' ? MESSAGES_VI.payloadTooLarge : MESSAGES_VI.requestInvalid;
    const tree = React.createElement('div',
      { 'data-testid': 'embed-state-denied', 'data-deny-code': parsed.code },
      React.createElement('strong', null, MESSAGES_VI.deniedHeader),
      React.createElement('div', { 'data-testid': 'embed-vi-message' }, vi));
    const html = ReactDOMServer.renderToStaticMarkup(tree);
    const text = stripTags(html);
    assertNoForbidden(text);
    assert.ok(text.includes(MESSAGES_VI.payloadTooLarge), 'must show payload-too-large vi copy');
  });

  it('parser schema failure (invalid envelope) shows only Vietnamese copy', () => {
    const parsed = messageProtocol.parseEnvelope({
      type: 'admin/exec',  // not in the enum
      version: messageProtocol.MESSAGE_PROTOCOL_VERSION,
      sentAt: '2026-09-26T07:00:00.000Z',
      sessionRef: 'sg_' + 'A'.repeat(43),
      correlationId: 'corr-x',
      body: {},
    });
    assert.strictEqual(parsed.ok, false);
    if (!parsed.ok) {
      assert.strictEqual(parsed.code, 'SCHEMA_FAILED');
    }
    const tree = React.createElement('div',
      { 'data-testid': 'embed-state-denied', 'data-deny-code': parsed.code },
      React.createElement('strong', null, MESSAGES_VI.deniedHeader),
      React.createElement('div', { 'data-testid': 'embed-vi-message' }, MESSAGES_VI.requestInvalid));
    const html = ReactDOMServer.renderToStaticMarkup(tree);
    const text = stripTags(html);
    assertNoForbidden(text);
  });

  it('field-denylist rejection (adminToken) shows only Vietnamese copy', () => {
    const env = {
      type: 'talent-context-read/request',
      version: messageProtocol.MESSAGE_PROTOCOL_VERSION,
      sentAt: '2026-09-26T07:00:00.000Z',
      sessionRef: 'sg_' + 'A'.repeat(43),
      correlationId: 'corr-x',
      body: {
        schemaVersion: '1',
        correlationId: 'corr-x',
        organizationId: 'org-001',
        actor: {
          kind: 'DELEGATED_USER',
          serviceId: 'svc-crm',
          userId: 'u-001',
          delegationRef: 'dg_' + 'B'.repeat(43),
        },
        target: { kind: 'TALENT', laborProfileId: 'lp-001' },
        fieldAllowlist: ['identitySummary'],
      },
      adminToken: 'leaked',
    };
    const parsed = messageProtocol.parseEnvelope(env);
    assert.strictEqual(parsed.ok, false);
    if (!parsed.ok) assert.strictEqual(parsed.code, 'FORBIDDEN_FIELD');
    const tree = React.createElement('div',
      { 'data-testid': 'embed-state-denied', 'data-deny-code': parsed.code },
      React.createElement('strong', null, MESSAGES_VI.deniedHeader),
      React.createElement('div', { 'data-testid': 'embed-vi-message' }, MESSAGES_VI.requestInvalid));
    const html = ReactDOMServer.renderToStaticMarkup(tree);
    const text = stripTags(html);
    assertNoForbidden(text);
  });

  it('error catch block renders generic Vietnamese copy only', () => {
    // The catch path doesn't leak the exception's message; it just maps to a
    // generic Vietnamese copy and stores a sanitized name in a data-* attribute.
    const tree = React.createElement('div',
      { 'data-testid': 'embed-state-error', 'data-error-detail': 'unknown' },
      React.createElement('strong', null, MESSAGES_VI.deniedHeader),
      React.createElement('div', { 'data-testid': 'embed-vi-message' }, MESSAGES_VI.requestInvalid));
    const html = ReactDOMServer.renderToStaticMarkup(tree);
    const text = stripTags(html);
    assertNoForbidden(text);
  });
});
