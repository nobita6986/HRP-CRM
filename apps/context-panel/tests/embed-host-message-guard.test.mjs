/**
 * tests/embed-host-message-guard.test.mjs — B.03-PREP focused unit tests.
 *
 * Covers parseEnvelope / assertOrigin / isWindowLike from
 * src/embed/message-protocol.ts. All cases run browser-free so they
 * can execute as part of `npm test`.
 *
 * Acceptance mapping:
 *   - allowlisted parent origin       -> assertOrigin
 *   - reject foreign origin           -> assertOrigin
 *   - reject malformed JSON           -> parseEnvelope
 *   - reject oversized payload        -> parseEnvelope
 *   - reject admin/service tokens     -> parseEnvelope (FIELD_DENYLIST)
 *   - reject unknown type/version     -> parseEnvelope
 *   - reject missing sessionRef       -> parseEnvelope
 *   - accept canonical envelope       -> parseEnvelope
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  parseEnvelope,
  assertOrigin,
  isWindowLike,
  HOST_ALLOWED_ORIGINS,
  MAX_PAYLOAD_BYTES,
  FIELD_DENYLIST,
  MESSAGE_PROTOCOL_VERSION,
} from '../dist/embed/message-protocol.js';

function buildValidEnvelope(overrides = {}) {
  return {
    type: 'talent-context-read/request',
    version: MESSAGE_PROTOCOL_VERSION,
    sentAt: '2026-09-26T07:00:00.000Z',
    sessionRef: 'sg_' + 'A'.repeat(43),
    correlationId: 'corr-12345678',
    body: {
      schemaVersion: '1',
      correlationId: 'corr-12345678',
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
    ...overrides,
  };
}

describe('B.03-PREP — assertOrigin (parent origin allowlist)', () => {
  it('accepts allowlisted origin (http://localhost:15501)', () => {
    assert.strictEqual(assertOrigin('http://localhost:15501'), true);
  });
  it('accepts allowlisted origin (http://127.0.0.1:15502)', () => {
    assert.strictEqual(assertOrigin('http://127.0.0.1:15502'), true);
  });
  it('rejects foreign origin (evil.example)', () => {
    assert.strictEqual(assertOrigin('https://evil.example'), false);
  });
  it('rejects file:// origin', () => {
    assert.strictEqual(assertOrigin('file:///tmp/x'), false);
  });
  it('rejects null / undefined / empty string', () => {
    assert.strictEqual(assertOrigin(null), false);
    assert.strictEqual(assertOrigin(undefined), false);
    assert.strictEqual(assertOrigin(''), false);
  });
  it('rejects origin not in allowlist even if similar (case sensitive)', () => {
    assert.strictEqual(assertOrigin('http://LOCALHOST:15501'), false);
  });
  it('allowlist has at least 2 origins for synthetic harness', () => {
    assert.ok(HOST_ALLOWED_ORIGINS.size >= 2);
  });
});

describe('B.03-PREP — isWindowLike (source window sanity)', () => {
  it('accepts an object with a postMessage function', () => {
    assert.strictEqual(isWindowLike({ postMessage: () => {} }), true);
  });
  it('rejects null', () => {
    assert.strictEqual(isWindowLike(null), false);
  });
  it('rejects a plain object', () => {
    assert.strictEqual(isWindowLike({}), false);
  });
  it('rejects a string', () => {
    assert.strictEqual(isWindowLike('window'), false);
  });
});

describe('B.03-PREP — parseEnvelope (size, JSON, schema)', () => {
  it('rejects undefined / null', () => {
    assert.strictEqual(parseEnvelope(undefined).ok, false);
    assert.strictEqual(parseEnvelope(null).ok, false);
  });

  it('rejects a non-object primitive', () => {
    const r = parseEnvelope(42);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, 'NOT_OBJECT');
  });

  it('rejects an array', () => {
    const r = parseEnvelope([1, 2, 3]);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, 'NOT_OBJECT');
  });

  it('rejects malformed JSON (when passed as string)', () => {
    const r = parseEnvelope('{not json');
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, 'INVALID_JSON');
  });

  it('rejects oversized payload (rawSizeBytes)', () => {
    const envelope = buildValidEnvelope();
    const r = parseEnvelope(envelope, MAX_PAYLOAD_BYTES + 1);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, 'PAYLOAD_TOO_LARGE');
  });

  it('rejects oversize JSON serialization (string input)', () => {
    const big = 'x'.repeat(MAX_PAYLOAD_BYTES + 1);
    const r = parseEnvelope(big);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, 'PAYLOAD_TOO_LARGE');
  });

  it('rejects unknown message type', () => {
    const r = parseEnvelope(buildValidEnvelope({ type: 'admin/exec' }));
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, 'SCHEMA_FAILED');
  });

  it('rejects wrong message version', () => {
    const r = parseEnvelope(buildValidEnvelope({ version: '2' }));
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, 'SCHEMA_FAILED');
  });

  it('rejects envelope with missing sessionRef', () => {
    const env = buildValidEnvelope();
    delete env.sessionRef;
    const r = parseEnvelope(env);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, 'SCHEMA_FAILED');
  });

  it('rejects envelope with missing correlationId', () => {
    const env = buildValidEnvelope();
    delete env.correlationId;
    const r = parseEnvelope(env);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, 'SCHEMA_FAILED');
  });

  it('rejects sessionRef that does not match canonical grammar', () => {
    const env = buildValidEnvelope({ sessionRef: 'sg_short' });
    const r = parseEnvelope(env);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, 'SCHEMA_FAILED');
  });

  it('rejects envelope with extra unknown top-level field (strict)', () => {
    const env = buildValidEnvelope({ extraField: 'forbidden' });
    const r = parseEnvelope(env);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, 'SCHEMA_FAILED');
  });

  it('accepts a valid canonical envelope', () => {
    const env = buildValidEnvelope();
    const r = parseEnvelope(env);
    assert.strictEqual(r.ok, true);
    if (r.ok) {
      assert.strictEqual(r.envelope.sessionRef, env.sessionRef);
      assert.strictEqual(r.envelope.correlationId, env.correlationId);
      assert.strictEqual(r.envelope.type, 'talent-context-read/request');
    }
  });

  it('accepts a serialized JSON envelope', () => {
    const env = buildValidEnvelope();
    const r = parseEnvelope(JSON.stringify(env));
    assert.strictEqual(r.ok, true);
  });
});

describe('B.03-PREP — parseEnvelope (field denylist for browser messages)', () => {
  for (const denied of FIELD_DENYLIST) {
    it(`rejects envelope that smuggles "${denied}" at top level`, () => {
      const env = buildValidEnvelope({ [denied]: 'leaked' });
      const r = parseEnvelope(env);
      assert.strictEqual(r.ok, false, `should reject ${denied}`);
      if (!r.ok) assert.strictEqual(r.code, 'FORBIDDEN_FIELD');
    });
    it(`rejects envelope that smuggles "${denied}" inside body`, () => {
      const env = buildValidEnvelope();
      env.body = { ...env.body, [denied]: 'leaked' };
      const r = parseEnvelope(env);
      assert.strictEqual(r.ok, false, `should reject body.${denied}`);
      if (!r.ok) assert.strictEqual(r.code, 'FORBIDDEN_FIELD');
    });
    it(`rejects envelope that smuggles "${denied}" inside actor`, () => {
      const env = buildValidEnvelope();
      env.body.actor = { ...env.body.actor, [denied]: 'leaked' };
      const r = parseEnvelope(env);
      assert.strictEqual(r.ok, false, `should reject actor.${denied}`);
      if (!r.ok) assert.strictEqual(r.code, 'FORBIDDEN_FIELD');
    });
  }
});

describe('B.03-PREP — parseEnvelope (body shape)', () => {
  it('rejects when actor.kind is not DELEGATED_USER', () => {
    const env = buildValidEnvelope();
    env.body.actor.kind = 'ADMIN';
    const r = parseEnvelope(env);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, 'SCHEMA_FAILED');
  });

  it('rejects when target.kind is not TALENT', () => {
    const env = buildValidEnvelope();
    env.body.target.kind = 'CLIENT';
    const r = parseEnvelope(env);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, 'SCHEMA_FAILED');
  });

  it('rejects when fieldAllowlist contains unsupported fields', () => {
    const env = buildValidEnvelope();
    env.body.fieldAllowlist = ['identitySummary', 'phone'];
    const r = parseEnvelope(env);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, 'SCHEMA_FAILED');
  });

  it('rejects empty fieldAllowlist', () => {
    const env = buildValidEnvelope();
    env.body.fieldAllowlist = [];
    const r = parseEnvelope(env);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, 'SCHEMA_FAILED');
  });
});