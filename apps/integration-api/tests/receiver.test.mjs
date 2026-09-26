/**
 * integration-api/tests/receiver.test.mjs — CORE/1.2 unit tests.
 *
 * Test các pure-function layer sau Auditor CHANGES_REQUIRED rev:
 *  - protocol-fixture (Auditor F3 — stable event identity).
 *  - hmac-verify (Auditor F2 — algorithm pinned by registry).
 *  - connection-registry (Auditor F1 — scope/secret binding).
 *  - scope-verify (path scope + body scope spoof detection).
 *  - dedupe (parse + commit dispatch only — real DB via receiver.int.test.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createHmac } from 'node:crypto';

if (!existsSync('./dist/receiver/protocol-fixture.js')) {
  execSync('npm run build', { stdio: 'inherit' });
}

const protocol = await import('../dist/receiver/protocol-fixture.js');
const hmac = await import('../dist/receiver/hmac-verify.js');
const scope = await import('../dist/receiver/scope-verify.js');
const dedupe = await import('../dist/receiver/dedupe.js');
const reg = await import('../dist/receiver/connection-registry.js');

const SECRET = 'synthetic-test-secret-do-not-use-in-prod';

// ─── Connection registry tests (Auditor F1) ────────────────────────────────

function entry(overrides = {}) {
  return {
    organizationId: 'org-synthetic-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-synth-001',
    secret: SECRET,
    algorithm: 'HMAC_SHA256',
    ...overrides,
  };
}

test('registry: resolve exact (org, provider, connectionId) → ok', () => {
  const r = new reg.ConnectionRegistry([entry()]);
  const out = r.resolve({
    organizationId: 'org-synthetic-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-synth-001',
  });
  assert.equal(out.ok, true);
  if (out.ok) assert.equal(out.entry.algorithm, 'HMAC_SHA256');
});

test('registry: F1 — connectionId collision (conn-1 vs conn_1) là 2 entries KHÁC NHAU', () => {
  // Auditor F1: "conn-1/conn_1/conn.1 không dùng nhầm binding".
  // Phải là 2 entries hoàn toàn tách biệt.
  const r = new reg.ConnectionRegistry([
    entry({ connectionId: 'conn-1', secret: 'secret-for-dash' }),
    entry({ connectionId: 'conn_1', secret: 'secret-for-underscore' }),
  ]);
  assert.equal(r.size(), 2);
  const dash = r.resolve({
    organizationId: 'org-synthetic-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-1',
  });
  const underscore = r.resolve({
    organizationId: 'org-synthetic-001',
    provider: 'CHATWOOT',
    connectionId: 'conn_1',
  });
  assert.equal(dash.ok, true);
  assert.equal(underscore.ok, true);
  if (dash.ok && underscore.ok) {
    assert.equal(dash.entry.secret, 'secret-for-dash');
    assert.equal(underscore.entry.secret, 'secret-for-underscore');
    assert.notEqual(dash.entry.secret, underscore.entry.secret);
  }
});

test('registry: F1 — request hợp lệ cho org A chuyển URL sang org B bị reject', () => {
  // Org A có conn-1. Request signed đúng nhưng URL path nói org B → reject.
  const r = new reg.ConnectionRegistry([
    entry({ organizationId: 'org-A', connectionId: 'conn-1' }),
  ]);
  const out = r.resolve({
    organizationId: 'org-B',
    provider: 'CHATWOOT',
    connectionId: 'conn-1',
  });
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.equal(out.code, 'unknown_connection');
    assert.match(out.message, /KHÔNG có trong registry/);
  }
});

test('registry: F1 — unknown connection fail-before-persist (không có trong registry)', () => {
  const r = new reg.ConnectionRegistry([entry()]);
  const out = r.resolve({
    organizationId: 'org-synthetic-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-not-registered',
  });
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, 'unknown_connection');
});

test('registry: empty registry → registry_unconfigured', () => {
  const r = new reg.ConnectionRegistry([]);
  const out = r.resolve({
    organizationId: 'org-synthetic-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-synth-001',
  });
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, 'registry_unconfigured');
});

test('registry: loadConnectionRegistryFromEnv — JSON format', () => {
  const json = JSON.stringify([
    {
      organizationId: 'org-001',
      provider: 'CHATWOOT',
      connectionId: 'conn-001',
      secret: 's-001',
      algorithm: 'HMAC_SHA256',
    },
    {
      organizationId: 'org-001',
      provider: 'ZALO_OA',
      connectionId: 'conn-002',
      secret: 's-002',
      algorithm: 'HMAC_SHA512',
    },
  ]);
  const entries = reg.loadConnectionRegistryFromEnv({ HRP_WEBHOOK_CONNECTIONS: json });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].algorithm, 'HMAC_SHA256');
  assert.equal(entries[1].algorithm, 'HMAC_SHA512');
});

test('registry: loadConnectionRegistryFromEnv — pipe-delimited numbered', () => {
  const env = {
    HRP_WEBHOOK_CONNECTION_0: 'org-001|CHATWOOT|conn-001|HMAC_SHA256|s-001',
    HRP_WEBHOOK_CONNECTION_1: 'org-001|GENERIC|conn-002|HMAC_SHA512|s-002',
  };
  const entries = reg.loadConnectionRegistryFromEnv(env);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].secret, 's-001');
  assert.equal(entries[1].algorithm, 'HMAC_SHA512');
});

test('registry: loadConnectionRegistryFromEnv — JSON + numbered cùng nhau', () => {
  const env = {
    HRP_WEBHOOK_CONNECTIONS: JSON.stringify([
      entry({ connectionId: 'json-1', secret: 'json-secret' }),
    ]),
    HRP_WEBHOOK_CONNECTION_0: 'org-synthetic-001|ZALO_OA|num-conn-1|HMAC_SHA256|num-secret',
  };
  const entries = reg.loadConnectionRegistryFromEnv(env);
  assert.equal(entries.length, 2);
});

test('registry: duplicate (org, provider, conn) → throw', () => {
  assert.throws(
    () => new reg.ConnectionRegistry([entry(), entry()]),
    /duplicate entry/,
  );
});

test('registry: invalid algorithm trong entry → throw', () => {
  assert.throws(
    () =>
      new reg.ConnectionRegistry([
        entry({ algorithm: 'ED25519' }),
      ]),
    /algorithm phải là HMAC_SHA256 \| HMAC_SHA512/,
  );
});

// ─── HMAC verify tests (Auditor F2 — algorithm pinned by registry) ──────────

test('receiver: verifyHmacSignature — Chatwoot HMAC SHA-256 OK với pinned', () => {
  const body = new TextEncoder().encode('{"event":"x"}');
  const sig = createHmac('sha256', SECRET).update(body).digest('hex');
  const headers = { 'x-chatwoot-signature': sig };
  const out = hmac.verifyHmacSignature({
    rawBody: body,
    headers,
    provider: 'CHATWOOT',
    pinnedAlgorithm: 'HMAC_SHA256',
    secret: SECRET,
  });
  assert.equal(out.ok, true);
  if (out.ok) assert.equal(out.algorithm, 'HMAC_SHA256');
});

test('receiver: verifyHmacSignature — Zalo OA HMAC SHA-256 OK', () => {
  const body = new TextEncoder().encode('{"event_name":"x"}');
  const sig = createHmac('sha256', SECRET).update(body).digest('hex');
  const out = hmac.verifyHmacSignature({
    rawBody: body,
    headers: { 'x-zalo-oa-signature': sig },
    provider: 'ZALO_OA',
    pinnedAlgorithm: 'HMAC_SHA256',
    secret: SECRET,
  });
  assert.equal(out.ok, true);
});

test('receiver: verifyHmacSignature — Generic HMAC SHA-512 OK với pinned, không cần header', () => {
  const body = new TextEncoder().encode('{"type":"x"}');
  const sig = createHmac('sha512', SECRET).update(body).digest('hex');
  // Không có header algorithm → registry-pinned algorithm được dùng.
  const out = hmac.verifyHmacSignature({
    rawBody: body,
    headers: { 'x-webhook-signature': sig },
    provider: 'GENERIC',
    pinnedAlgorithm: 'HMAC_SHA512',
    secret: SECRET,
  });
  assert.equal(out.ok, true);
  if (out.ok) assert.equal(out.algorithm, 'HMAC_SHA512');
});

test('receiver: verifyHmacSignature — Generic HMAC SHA-256 OK với pinned', () => {
  const body = new TextEncoder().encode('{"type":"x"}');
  const sig = createHmac('sha256', SECRET).update(body).digest('hex');
  const out = hmac.verifyHmacSignature({
    rawBody: body,
    headers: { 'x-webhook-signature': sig },
    provider: 'GENERIC',
    pinnedAlgorithm: 'HMAC_SHA256',
    secret: SECRET,
  });
  assert.equal(out.ok, true);
});

test('receiver: F2 — connection pinned SHA512 reject request chọn SHA256 qua header', () => {
  // Pin algorithm = SHA512 (registry). Header says SHA256 → reject.
  const body = new TextEncoder().encode('{"type":"x"}');
  const sig256 = createHmac('sha256', SECRET).update(body).digest('hex');
  const out = hmac.verifyHmacSignature({
    rawBody: body,
    headers: {
      'x-webhook-signature': sig256,
      'x-webhook-algorithm': 'HMAC_SHA256',
    },
    provider: 'GENERIC',
    pinnedAlgorithm: 'HMAC_SHA512',
    secret: SECRET,
  });
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.equal(out.reason, 'algorithm_header_mismatch');
    assert.match(out.message, /pinned algorithm/);
  }
});

test('receiver: F2 — GENERIC header algorithm mismatch SHA256 vs pinned SHA512 vẫn fail', () => {
  // Ngay cả khi signature hợp lệ với SHA512, header nói SHA256 → fail
  // trước khi compare.
  const body = new TextEncoder().encode('{"type":"x"}');
  const sig512 = createHmac('sha512', SECRET).update(body).digest('hex');
  const out = hmac.verifyHmacSignature({
    rawBody: body,
    headers: {
      'x-webhook-signature': sig512,
      'x-webhook-algorithm': 'HMAC_SHA256',
    },
    provider: 'GENERIC',
    pinnedAlgorithm: 'HMAC_SHA512',
    secret: SECRET,
  });
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.reason, 'algorithm_header_mismatch');
});

test('receiver: F2 — header algorithm ED25519 (unsupported) → reject', () => {
  const body = new TextEncoder().encode('{"type":"x"}');
  const sig = createHmac('sha256', SECRET).update(body).digest('hex');
  const out = hmac.verifyHmacSignature({
    rawBody: body,
    headers: {
      'x-webhook-signature': sig,
      'x-webhook-algorithm': 'ED25519',
    },
    provider: 'GENERIC',
    pinnedAlgorithm: 'HMAC_SHA256',
    secret: SECRET,
  });
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.reason, 'algorithm_header_mismatch');
});

test('receiver: F2 — GENERIC header absent → dùng pinned algorithm', () => {
  // Cross-check behavior: header absent → pinned wins.
  const body = new TextEncoder().encode('{"type":"x"}');
  const sig = createHmac('sha256', SECRET).update(body).digest('hex');
  const out = hmac.verifyHmacSignature({
    rawBody: body,
    headers: { 'x-webhook-signature': sig },
    provider: 'GENERIC',
    pinnedAlgorithm: 'HMAC_SHA256',
    secret: SECRET,
  });
  assert.equal(out.ok, true);
});

test('receiver: verifyHmacSignature — signature_mismatch', () => {
  const body = new TextEncoder().encode('{"event":"x"}');
  const sig = createHmac('sha256', 'OTHER_SECRET').update(body).digest('hex');
  const out = hmac.verifyHmacSignature({
    rawBody: body,
    headers: { 'x-chatwoot-signature': sig },
    provider: 'CHATWOOT',
    pinnedAlgorithm: 'HMAC_SHA256',
    secret: SECRET,
  });
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.reason, 'signature_mismatch');
});

test('receiver: verifyHmacSignature — missing_signature_header', () => {
  const out = hmac.verifyHmacSignature({
    rawBody: new Uint8Array(),
    headers: {},
    provider: 'CHATWOOT',
    pinnedAlgorithm: 'HMAC_SHA256',
    secret: SECRET,
  });
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.reason, 'missing_signature_header');
});

test('receiver: verifyHmacSignature — malformed_signature (non-hex)', () => {
  const out = hmac.verifyHmacSignature({
    rawBody: new Uint8Array(),
    headers: { 'x-chatwoot-signature': 'NOT-HEX' },
    provider: 'CHATWOOT',
    pinnedAlgorithm: 'HMAC_SHA256',
    secret: SECRET,
  });
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.reason, 'malformed_signature');
});

// ─── Protocol fixture tests (Auditor F3 — stable event identity) ───────────

test('receiver: parseProviderFixture — CHATWOOT primary top-level id', () => {
  // Top-level `id` (event occurrence id, per-event unique) — primary.
  const body = JSON.stringify({
    event: 'message_created',
    id: 12345678,
    message: { id: 999 }, // noise — KHÔNG dùng làm eventId
  });
  const out = protocol.parseProviderFixture('CHATWOOT', new TextEncoder().encode(body));
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.eventType, 'message_created');
    assert.equal(out.eventId, '12345678');
    assert.equal(out.eventIdSource, 'primary');
  }
});

test('receiver: parseProviderFixture — CHATWOOT fallback sang event_id', () => {
  const body = JSON.stringify({
    event: 'message_updated',
    event_id: 'evt-cw-12345678',
    message: { id: 999 },
  });
  const out = protocol.parseProviderFixture('CHATWOOT', new TextEncoder().encode(body));
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.eventId, 'evt-cw-12345678');
    assert.equal(out.eventIdSource, 'fallback');
  }
});

test('receiver: F3 — CHATWOOT KHÔNG dùng message.id làm eventId (không stable)', () => {
  // Trước CORE/1.2 rev: `message.id` được dùng làm fallback. Sau F3: bỏ.
  // Body chỉ có event + message.id → reject vì không có id/event_id.
  const body = JSON.stringify({
    event: 'message_updated',
    message: { id: 999 },
  });
  const out = protocol.parseProviderFixture('CHATWOOT', new TextEncoder().encode(body));
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.equal(out.code, 'missing_event_id');
    assert.match(out.message, /message\.id/);
  }
});

test('receiver: F3 — cùng message khác eventType phải KHÁC eventId (replay guard)', () => {
  // Nếu chỉ message.id dùng làm eventId, 2 events khác type trên cùng
  // message sẽ CÙNG eventId → conflict sai. F3 đảm bảo eventId phải
  // độc lập với eventType.
  const bodyA = JSON.stringify({
    event: 'message_created',
    id: 'evt-A-12345678',
    message: { id: 999 },
  });
  const bodyB = JSON.stringify({
    event: 'message_updated',
    id: 'evt-B-12345678',
    message: { id: 999 },
  });
  const a = protocol.parseProviderFixture('CHATWOOT', new TextEncoder().encode(bodyA));
  const b = protocol.parseProviderFixture('CHATWOOT', new TextEncoder().encode(bodyB));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (a.ok && b.ok) {
    assert.notEqual(a.eventId, b.eventId);
  }
});

test('receiver: F3 — replay cùng occurrence (cùng eventId + payloadDigest) → ok nhưng dedupe sau', () => {
  // F3 chỉ đảm bảo eventId ổn định per occurrence. Replay policy thuộc
  // CORE/1.3 dedupe (đã PASS). Test này verify eventId ổn định qua 2 lần parse.
  const body = JSON.stringify({
    event: 'message_created',
    id: 'evt-stale-12345678',
  });
  const a = protocol.parseProviderFixture('CHATWOOT', new TextEncoder().encode(body));
  const b = protocol.parseProviderFixture('CHATWOOT', new TextEncoder().encode(body));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (a.ok && b.ok) {
    assert.equal(a.eventId, b.eventId);
  }
});

test('receiver: F3 — cùng eventType khác revision phải khác eventId', () => {
  // Cùng eventType (message_updated) nhưng 2 revision khác nhau.
  const a = JSON.stringify({
    event: 'message_updated',
    id: 'evt-rev1-12345678',
  });
  const b = JSON.stringify({
    event: 'message_updated',
    id: 'evt-rev2-12345678',
  });
  const ra = protocol.parseProviderFixture('CHATWOOT', new TextEncoder().encode(a));
  const rb = protocol.parseProviderFixture('CHATWOOT', new TextEncoder().encode(b));
  assert.equal(ra.ok, true);
  assert.equal(rb.ok, true);
  if (ra.ok && rb.ok) {
    assert.equal(ra.eventType, rb.eventType); // cùng type
    assert.notEqual(ra.eventId, rb.eventId); // revision khác → khác id
  }
});

test('receiver: F3 — GENERIC KHÔNG dùng trace_id làm eventId', () => {
  // Trước: trace_id là fallback. Sau F3: bỏ.
  // Body chỉ có type + trace_id → reject.
  const body = JSON.stringify({ type: 'webhook', trace_id: 'trace-12345678-abc' });
  const out = protocol.parseProviderFixture('GENERIC', new TextEncoder().encode(body));
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, 'missing_event_id');
});

test('receiver: F3 — GENERIC dùng id (numeric) làm fallback OK', () => {
  const body = JSON.stringify({ type: 'webhook', id: 12345678 });
  const out = protocol.parseProviderFixture('GENERIC', new TextEncoder().encode(body));
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.eventId, '12345678');
    assert.equal(out.eventIdSource, 'fallback');
  }
});

test('receiver: F3 — eventId ngắn (< 8 chars) KHÔNG đủ uniqueness → reject', () => {
  // String < 8 chars không đủ uniqueness cho event occurrence id.
  const body = JSON.stringify({ event: 'message_created', id: 'short' });
  const out = protocol.parseProviderFixture('CHATWOOT', new TextEncoder().encode(body));
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, 'missing_event_id');
});

test('receiver: Zalo OA primary event_id', () => {
  const body = JSON.stringify({
    event_name: 'user_send_text',
    event_id: 'evt-zalo-12345678',
  });
  const out = protocol.parseProviderFixture('ZALO_OA', new TextEncoder().encode(body));
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.eventType, 'user_send_text');
    assert.equal(out.eventId, 'evt-zalo-12345678');
    assert.equal(out.eventIdSource, 'primary');
  }
});

test('receiver: Zalo OA fallback sang message_id', () => {
  const body = JSON.stringify({
    event_name: 'user_send_text',
    message_id: 'msg-zalo-12345678',
  });
  const out = protocol.parseProviderFixture('ZALO_OA', new TextEncoder().encode(body));
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.eventId, 'msg-zalo-12345678');
    assert.equal(out.eventIdSource, 'fallback');
  }
});

test('receiver: malformed JSON → reject', () => {
  const out = protocol.parseProviderFixture('CHATWOOT', new TextEncoder().encode('not-json'));
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, 'malformed_json');
});

test('receiver: unsupported provider → reject', () => {
  const body = JSON.stringify({ event: 'x', event_id: 'y12345678' });
  const out = protocol.parseProviderFixture('SLACK', new TextEncoder().encode(body));
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, 'unsupported_provider');
});

test('receiver: computePayloadDigest — SHA-256 hex 64 chars stable', () => {
  const a = protocol.computePayloadDigest(new TextEncoder().encode('hello'));
  const b = protocol.computePayloadDigest(new TextEncoder().encode('hello'));
  const c = protocol.computePayloadDigest(new TextEncoder().encode('hello!'));
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[a-f0-9]{64}$/);
});

// ─── Scope verify tests ─────────────────────────────────────────────────────

test('receiver: verifyScopeFromPath — ok path', () => {
  const r = scope.verifyScopeFromPath({
    organizationIdRaw: 'org-synthetic-001',
    providerRaw: 'CHATWOOT',
    connectionIdRaw: 'conn-synth-001',
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.organizationId, 'org-synthetic-001');
    assert.equal(r.provider, 'CHATWOOT');
    assert.equal(r.connectionId, 'conn-synth-001');
  }
});

test('receiver: verifyScopeFromPath — missing path param', () => {
  const r = scope.verifyScopeFromPath({
    organizationIdRaw: 'org-synthetic-001',
    providerRaw: 'CHATWOOT',
    connectionIdRaw: undefined,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'missing_path_param');
});

test('receiver: verifyScopeFromPath — unsupported_provider', () => {
  const r = scope.verifyScopeFromPath({
    organizationIdRaw: 'org-synthetic-001',
    providerRaw: 'SLACK',
    connectionIdRaw: 'conn-synth-001',
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'unsupported_provider');
});

test('receiver: detectBodyScopeSpoof — phát hiện organizationId trong body khác path', () => {
  const r = scope.detectBodyScopeSpoof({
    parsedBody: { event: 'x', event_id: 'y12345678', organizationId: 'org-evil-001' },
    expectedScope: {
      organizationId: 'org-synthetic-001',
      provider: 'CHATWOOT',
      connectionId: 'conn-synth-001',
    },
  });
  assert.equal(r.spoofed, true);
  assert.equal(r.mismatchedField, 'organizationId');
});

test('receiver: detectBodyScopeSpoof — body khớp path → không spoof', () => {
  const r = scope.detectBodyScopeSpoof({
    parsedBody: { event: 'x', event_id: 'y12345678', organizationId: 'org-synthetic-001' },
    expectedScope: {
      organizationId: 'org-synthetic-001',
      provider: 'CHATWOOT',
      connectionId: 'conn-synth-001',
    },
  });
  assert.equal(r.spoofed, false);
});

test('receiver: detectBodyScopeSpoof — body provider khác path', () => {
  const r = scope.detectBodyScopeSpoof({
    parsedBody: { event: 'x', event_id: 'y12345678', provider: 'ZALO_OA' },
    expectedScope: {
      organizationId: 'org-synthetic-001',
      provider: 'CHATWOOT',
      connectionId: 'conn-synth-001',
    },
  });
  assert.equal(r.spoofed, true);
  assert.equal(r.mismatchedField, 'provider');
});

// ─── Dedupe module smoke test ───────────────────────────────────────────────

test('receiver: dedupe.commitWebhookReceipt is function (real DB via int test)', () => {
  assert.equal(typeof dedupe.commitWebhookReceipt, 'function');
});

// B.02-PREP delta tests - Chatwoot POC paths in protocol-fixture parser
// Scope: parse layer only (no DB, no dispatch, no canonical mutation)

test('B.02-PREP: Chatwoot message_updated - two revisions, same message.id, distinct eventId', () => {
  const rev1 = JSON.stringify({ event: 'message_updated', id: 'evt-rev1-cw-00112345678', message: { id: 9001, content: 'v1' } });
  const rev2 = JSON.stringify({ event: 'message_updated', id: 'evt-rev2-cw-00112345678', message: { id: 9001, content: 'v2' } });
  const a = protocol.parseProviderFixture('CHATWOOT', new TextEncoder().encode(rev1));
  const b = protocol.parseProviderFixture('CHATWOOT', new TextEncoder().encode(rev2));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (a.ok && b.ok) {
    assert.equal(a.eventType, 'message_updated');
    assert.equal(b.eventType, 'message_updated');
    assert.notEqual(a.eventId, b.eventId);
  }
});

test('B.02-PREP: Chatwoot private_note - eventId is event occurrence id, not message id', () => {
  const body = JSON.stringify({
    event: 'message_created',
    id: 'evt-pn-cw-00112345678',
    message: { id: 9002, content: 'note', sender: { type: 'PRIVATE_NOTE', name: 'staff-a' } },
  });
  const out = protocol.parseProviderFixture('CHATWOOT', new TextEncoder().encode(body));
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.eventId, 'evt-pn-cw-00112345678');
    assert.equal(out.eventIdSource, 'primary');
  }
});

test('B.02-PREP: Chatwoot echo (outgoing) - distinct from inbound dedupe', () => {
  const ib = JSON.stringify({
    event: 'message_created',
    id: 'evt-in-cw-00112345678',
    message: { id: 9003, sender: { type: 'INCOMING' } },
  });
  const ec = JSON.stringify({
    event: 'message_created',
    id: 'evt-echo-cw-00112345678',
    message: { id: 9003, sender: { type: 'OUTGOING' } },
  });
  const a = protocol.parseProviderFixture('CHATWOOT', new TextEncoder().encode(ib));
  const b = protocol.parseProviderFixture('CHATWOOT', new TextEncoder().encode(ec));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (a.ok && b.ok) {
    assert.notEqual(a.eventId, b.eventId);
    assert.equal(a.eventType, b.eventType);
  }
});

test('B.02-PREP: synthetic event does not auto-mutate canonical (parser is pure, no I/O)', () => {
  const body = JSON.stringify({
    event: 'message_created',
    id: 'evt-pure-cw-00112345678',
    message: { id: 9004 },
  });
  const calls = Array.from({ length: 5 }, () =>
    protocol.parseProviderFixture('CHATWOOT', new TextEncoder().encode(body)),
  );
  for (const c of calls) {
    assert.equal(c.ok, true);
    if (c.ok) {
      assert.equal(c.eventId, 'evt-pure-cw-00112345678');
      assert.equal(c.eventIdSource, 'primary');
    }
  }
  const digest = protocol.computePayloadDigest(new TextEncoder().encode(body));
  assert.match(digest, /^[a-f0-9]{64}$/);
});

test('B.02-PREP: conversation_status_changed - distinct eventId, no message required', () => {
  const body = JSON.stringify({
    event: 'conversation_status_changed',
    id: 'evt-csc-cw-00112345678',
    conversation: { id: 7001 },
  });
  const out = protocol.parseProviderFixture('CHATWOOT', new TextEncoder().encode(body));
  assert.equal(out.ok, true);
  if (out.ok) assert.equal(out.eventId, 'evt-csc-cw-00112345678');
});

test('B.02-PREP: webwidget_triggered - entry-point event, not a message', () => {
  const body = JSON.stringify({
    event: 'webwidget_triggered',
    id: 'evt-ww-cw-00112345678',
    contact: { id: 5001 },
  });
  const out = protocol.parseProviderFixture('CHATWOOT', new TextEncoder().encode(body));
  assert.equal(out.ok, true);
  if (out.ok) assert.equal(out.eventId, 'evt-ww-cw-00112345678');
});
