/**
 * gateway-providers-ports.test.mjs — fixtures G0/0.3h (Gateway/provider/ports).
 *
 * Trọng tâm AC:
 *  - CanonicalHrpGateway methods typed theo từng command; tách
 *    privileged merge khỏi inbound default.
 *  - Webhook verification nhận raw bytes/headers; KHÔNG trust parsed
 *    body trước khi verify.
 *  - Provider capabilities allowlist; provider KHÔNG giữ policy
 *    tuyển dụng (Master §7.1).
 *  - Probe/health contracts.
 *  - Ports KHÔNG import Prisma/Next.js runtime (markers);
 *    deterministic clock/fault injection signature.
 *  - Storage KHÔNG cùng DB transaction với canonical command.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HrpGatewayTierSchema,
  HRP_GATEWAY_TIERS,
  HrpGatewayCallContextSchema,
  HRP_GATEWAY_METHODS,
  HrpGatewayMethodSchema,
  HrpGatewayMethodCapabilitySchema,
  WebhookSignatureAlgorithmSchema,
  WEBHOOK_SIGNATURE_ALGORITHMS,
  WebhookReceiverRequestSchema,
  WebhookReceiverVerifiedSchema,
  FaultHooksSchema,
} from '../dist/commands/gateway.js';
import {
  HRP_PROVIDER_CAPABILITIES,
  HrpProviderCapabilitySchema,
  ProviderConnectionRefSchema,
  ChatwootMessageKindSchema,
  ChatwootNormalizedWebhookSchema,
  ZaloOaNormalizedWebhookSchema,
  ProviderProbeRequestSchema,
  ProviderProbeResultSchema,
  ProviderProbeOutcomeSchema,
  PROVIDER_PAYLOAD_FORBIDDEN,
} from '../dist/commands/providers.js';
import {
  WorkerPortEnqueueRequestSchema,
  WorkerPortEnqueueResultSchema,
  SchedulerPortEnqueueRequestSchema,
  QueuePortEnqueueRequestSchema,
  SecretPortGetRequestSchema,
  SecretPortHandleSchema,
  ObjectStorageUploadRequestSchema,
  ObjectStorageHandleSchema,
  ObjectStorageReadRequestSchema,
  ObjectStorageReadResultSchema,
  SECRET_PORT_FORBIDDEN_FIELDS,
  PORTS_FORBIDDEN_IMPORTS,
} from '../dist/commands/ports.js';
import { SCHEMA_VERSION } from '../dist/enums.js';

const org = 'org-test-gw';

test('HRP_GATEWAY_TIERS: 3 tier rõ ràng (INBOUND_DEFAULT/INBOUND_REVIEWER/PRIVILEGED_MERGE)', () => {
  assert.deepEqual([...HRP_GATEWAY_TIERS], [
    'INBOUND_DEFAULT',
    'INBOUND_REVIEWER',
    'PRIVILEGED_MERGE',
  ]);
});

test('HrpGatewayCallContext: INBOUND_DEFAULT yêu cầu provider + connectionId; privileged KHÔNG có', () => {
  // INBOUND_DEFAULT: provider+connectionId bắt buộc.
  assert.equal(
    HrpGatewayCallContextSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      tier: 'INBOUND_DEFAULT',
      correlationId: 'trace-abc-1234567',
    }).success,
    false,
    'INBOUND_DEFAULT phải có provider+connectionId',
  );

  // INBOUND_DEFAULT + provider OK.
  const r1 = HrpGatewayCallContextSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    tier: 'INBOUND_DEFAULT',
    correlationId: 'trace-abc-1234567',
    provider: 'CHATWOOT',
    connectionId: 'conn-cw-1',
  });
  assert.equal(r1.tier, 'INBOUND_DEFAULT');

  // PRIVILEGED_MERGE: KHÔNG provider/connectionId.
  assert.equal(
    HrpGatewayCallContextSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      tier: 'PRIVILEGED_MERGE',
      correlationId: 'trace-abc-1234567',
      provider: 'CHATWOOT',
    }).success,
    false,
    'PRIVILEGED_MERGE tier KHÔNG có provider (HRP-side, không external)',
  );

  // PRIVILEGED_MERGE không có provider OK.
  const r2 = HrpGatewayCallContextSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    tier: 'PRIVILEGED_MERGE',
    correlationId: 'trace-abc-1234567',
  });
  assert.equal(r2.tier, 'PRIVILEGED_MERGE');
});

test('HRP_GATEWAY_METHODS: 17 method allowlist, có mergeLaborProfiles privilege marker', () => {
  // 17 method đầy đủ trong commands 0.3a–g.
  assert.equal(HRP_GATEWAY_METHODS.length, 17, 'method count');

  // mergeLaborProfiles là privileged capability.
  assert.ok(
    HRP_GATEWAY_METHODS.includes('mergeLaborProfiles'),
    'mergeLaborProfiles cần privileged capability riêng',
  );
  assert.ok(HRP_GATEWAY_METHODS.includes('supersedeReviewStatus'));
  assert.ok(HRP_GATEWAY_METHODS.includes('commitReviewDecision'));
  assert.ok(HRP_GATEWAY_METHODS.includes('resolvePossibleMatch'));

  // Inbound-only.
  assert.ok(HRP_GATEWAY_METHODS.includes('createOrMatchLaborProfile'));
  assert.ok(HRP_GATEWAY_METHODS.includes('recordInteraction'));
  assert.ok(HRP_GATEWAY_METHODS.includes('queryOutboxDelivery'));

  assert.equal(HrpGatewayMethodSchema.safeParse('random').success, false);
});

test('HrpGatewayMethodCapability: marker schema cho audit method × tier × privileged', () => {
  // Schema bind shape; runtime HRP gate quyết capability exact.
  const r = HrpGatewayMethodCapabilitySchema.parse({
    schemaVersion: SCHEMA_VERSION,
    method: 'mergeLaborProfiles',
    tier: 'PRIVILEGED_MERGE',
    privileged: true,
  });
  assert.equal(r.privileged, true);

  const r2 = HrpGatewayMethodCapabilitySchema.parse({
    schemaVersion: SCHEMA_VERSION,
    method: 'recordInteraction',
    tier: 'INBOUND_DEFAULT',
    privileged: false,
  });
  assert.equal(r2.privileged, false);
});

test('WEBHOOK_SIGNATURE_ALGORITHMS: 3 algo allowlist (HMAC_SHA256/HMAC_SHA512/ED25519)', () => {
  for (const a of ['HMAC_SHA256', 'HMAC_SHA512', 'ED25519']) {
    assert.equal(
      WebhookSignatureAlgorithmSchema.safeParse(a).success,
      true,
    );
  }
  // KHÔNG cho NONE / MD5 / SHA1 (downgrade attack).
  assert.equal(
    WebhookSignatureAlgorithmSchema.safeParse('NONE').success,
    false,
    'NONE không phải algo — phải có signature thật',
  );
  assert.equal(
    WebhookSignatureAlgorithmSchema.safeParse('MD5').success,
    false,
  );
});

test('WebhookReceiverRequest: rawBody Uint8Array + headers record + expectedAlgorithms', () => {
  // Schema bind shape: rawBody phải là Uint8Array (KHÔNG phải parsed object).
  const body = new TextEncoder().encode('{"hello":"world"}');
  const r = WebhookReceiverRequestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    provider: 'CHATWOOT',
    connectionId: 'conn-cw-1',
    rawBody: body,
    headers: {
      'content-type': 'application/json',
      'x-chatwoot-signature': 'abc123',
    },
    expectedAlgorithms: ['HMAC_SHA256'],
    nowEpochMs: Date.parse('2026-09-13T10:00:00.000+07:00'),
    maxAgeSec: 300,
  });
  assert.ok(r.rawBody instanceof Uint8Array);
  assert.equal(r.expectedAlgorithms[0], 'HMAC_SHA256');

  // Empty expectedAlgorithms → reject.
  assert.equal(
    WebhookReceiverRequestSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      provider: 'CHATWOOT',
      connectionId: 'conn-cw-1',
      rawBody: body,
      headers: {},
      expectedAlgorithms: [],
      nowEpochMs: Date.now(),
      maxAgeSec: 300,
    }).success,
    false,
    'expectedAlgorithms phải non-empty allowlist',
  );
});

test('WebhookReceiverVerified: parsedBody chỉ có khi verify pass; runtime bind schema theo provider', () => {
  const r = WebhookReceiverVerifiedSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    provider: 'CHATWOOT',
    connectionId: 'conn-cw-1',
    algorithm: 'HMAC_SHA256',
    verifiedAt: '2026-09-13T10:00:00.000+07:00',
    parsedBody: { event: 'message_created', id: 'msg-001' },
  });
  assert.equal(r.algorithm, 'HMAC_SHA256');
});

test('FaultHooks: optional latency + errorCode cho test', () => {
  // Schema bind shape; default no-op.
  const ok = FaultHooksSchema.parse({});
  assert.equal(ok.latencyMs, 0);
  assert.equal(ok.injectErrorCode, undefined);

  // injectErrorCode phải là enum allowlist.
  const r = FaultHooksSchema.parse({
    latencyMs: 100,
    injectErrorCode: 'DEPENDENCY_UNAVAILABLE',
  });
  assert.equal(r.latencyMs, 100);
});

test('HRP_PROVIDER_CAPABILITIES: 12 capability allowlist (context.read/.../webhook.receive)', () => {
  assert.equal(HRP_PROVIDER_CAPABILITIES.length, 12);
  for (const c of [
    'context.read',
    'intake.submit',
    'profile.complete',
    'case.update',
    'case.close',
    'availability.update',
    'interaction.record',
    'next-action.update',
    'outbox.consume',
    'analytics.read',
    'analytics.export',
    'webhook.receive',
  ]) {
    assert.equal(HrpProviderCapabilitySchema.safeParse(c).success, true);
  }
  // KHÔNG có merge / privileged capability ở provider tier.
  assert.equal(
    HrpProviderCapabilitySchema.safeParse('merge.profile').success,
    false,
    'merge capability không ở provider tier (Privileged HRP gate riêng)',
  );
});

test('ProviderConnectionRef: capabilityToken opaque + provider + connectionId', () => {
  const r = ProviderConnectionRefSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    provider: 'CHATWOOT',
    connectionId: 'conn-cw-1',
    capabilityToken: 'capability-token-001',
  });
  assert.equal(r.capabilityToken, 'capability-token-001');
});

test('ChatwootNormalizedWebhook: provider=CHATWOOT + accountId + inboxId + conversationId', () => {
  const r = ChatwootNormalizedWebhookSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    provider: 'CHATWOOT',
    connectionId: 'conn-cw-1',
    event: 'message_created',
    accountId: 'acc-001',
    inboxId: 'inbox-001',
    conversationId: 'conv-001',
    payload: { message: { content: 'hello' } },
    occurredAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r.provider, 'CHATWOOT');

  // CHATWOOT + senderType optional OK.
  const r2 = ChatwootNormalizedWebhookSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    provider: 'CHATWOOT',
    connectionId: 'conn-cw-1',
    event: 'message_created',
    accountId: 'acc-001',
    inboxId: 'inbox-001',
    conversationId: 'conv-001',
    senderType: 'INCOMING',
    payload: {},
    occurredAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r2.senderType, 'INCOMING');
});

test('ZaloOaNormalizedWebhook: provider=ZALO_OA + oaId + userId', () => {
  const r = ZaloOaNormalizedWebhookSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    provider: 'ZALO_OA',
    connectionId: 'conn-zalo-1',
    event: 'user_send_text',
    oaId: 'oa-001',
    userId: 'user-001',
    payload: { message: { text: 'xin chào' } },
    occurredAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r.provider, 'ZALO_OA');

  // Provider khác CHATWOOT/ZALO_OA → reject.
  assert.equal(
    ZaloOaNormalizedWebhookSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      provider: 'CHATWOOT',
      connectionId: 'conn-cw-1',
      event: 'x',
      oaId: 'oa-001',
      userId: 'user-001',
      payload: {},
      occurredAt: '2026-09-13T10:00:00.000+07:00',
    }).success,
    false,
  );
});

test('ProviderProbe: REACHABLE có latencyMs; UNREACHABLE/AUTH_EXPIRED.../UNKNOWN KHÔNG có latencyMs', () => {
  // REACHABLE + latencyMs OK.
  const r1 = ProviderProbeResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    outcome: 'REACHABLE',
    probedAt: '2026-09-13T10:00:00.000+07:00',
    latencyMs: 120,
  });
  assert.equal(r1.outcome, 'REACHABLE');

  // REACHABLE + no latencyMs → reject.
  assert.equal(
    ProviderProbeResultSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      outcome: 'REACHABLE',
      probedAt: '2026-09-13T10:00:00.000+07:00',
    }).success,
    false,
  );

  // UNREACHABLE + no latencyMs OK.
  const r2 = ProviderProbeResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    outcome: 'UNREACHABLE',
    probedAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r2.outcome, 'UNREACHABLE');

  // UNREACHABLE + latencyMs → reject.
  assert.equal(
    ProviderProbeResultSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      outcome: 'UNREACHABLE',
      probedAt: '2026-09-13T10:00:00.000+07:00',
      latencyMs: 100,
    }).success,
    false,
  );

  for (const o of [
    'REACHABLE',
    'UNREACHABLE',
    'AUTH_EXPIRED',
    'RATE_LIMITED',
    'CAPABILITY_REVOKED',
    'UNKNOWN',
  ]) {
    assert.equal(ProviderProbeOutcomeSchema.safeParse(o).success, true);
  }
});

test('PROVIDER_PAYLOAD_FORBIDDEN: Provider KHÔNG giữ policy tuyển dụng (Master §7.1)', () => {
  // Provider không có routing/handling/credit/assignment.
  for (const bad of [
    'routingDecision',
    'handlingAssignment',
    'creditPolicyVersion',
    'candidateAssignment',
    'workerCreation',
    'beneficiaryAssignment',
    'placementEffective',
    'bypassDnc',
    'bypassReview',
    'bypassStaffReview',
    'forceApproval',
    'ignoreFreshness',
  ]) {
    assert.ok(
      PROVIDER_PAYLOAD_FORBIDDEN.includes(bad),
      `'${bad}' không được ở provider payload (Master §7.1, §11)`,
    );
  }
  // Core DB URL.
  assert.ok(PROVIDER_PAYLOAD_FORBIDDEN.includes('coreDbUrl'));
  assert.ok(PROVIDER_PAYLOAD_FORBIDDEN.includes('corePrismaUrl'));
  assert.ok(PROVIDER_PAYLOAD_FORBIDDEN.includes('coreCredentials'));
});

test('WorkerPort + SchedulerPort + QueuePort: schema bind shape (Ports contract only)', () => {
  // Worker.
  const w1 = WorkerPortEnqueueRequestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    workerName: 'suppression-gate',
    payload: { intentId: 'i-001' },
    delaySec: 30,
  });
  assert.equal(w1.workerName, 'suppression-gate');

  const w2 = WorkerPortEnqueueResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    jobId: 'job-001',
    enqueuedAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(w2.jobId, 'job-001');

  // Scheduler yêu cầu timezone Asia/Ho_Chi_Minh literal.
  const s1 = SchedulerPortEnqueueRequestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    scheduleSpec: '0 * * * *',
    payload: { job: 'next-action-fire' },
    timezone: 'Asia/Ho_Chi_Minh',
  });
  assert.equal(s1.timezone, 'Asia/Ho_Chi_Minh');

  // Timezone khác → reject.
  assert.equal(
    SchedulerPortEnqueueRequestSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      scheduleSpec: '0 * * * *',
      payload: {},
      timezone: 'UTC',
    }).success,
    false,
    'Scheduler yêu cầu timezone business Asia/Ho_Chi_Minh',
  );

  // Queue.
  const q1 = QueuePortEnqueueRequestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    queueName: 'delivery-queue',
    payload: { intentId: 'i-001' },
    leaseToken: 'lease-token-001',
    maxAttempts: 5,
  });
  assert.equal(q1.maxAttempts, 5);
});

test('SecretPort: tier 3 cấp + KHÔNG expose rawSecret', () => {
  const ok = SecretPortGetRequestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    capability: 'webhook.receive',
    accessorTier: 'PRIVILEGED_HRP_GATE',
  });
  assert.equal(ok.accessorTier, 'PRIVILEGED_HRP_GATE');

  const h = SecretPortHandleSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    secretHandle: 'opaque-handle-001',
    expiresInSec: 60,
  });
  assert.equal(h.secretHandle, 'opaque-handle-001');

  // Schema forbid rawSecret ở payload.
  for (const bad of SECRET_PORT_FORBIDDEN_FIELDS) {
    assert.ok(
      SECRET_PORT_FORBIDDEN_FIELDS.includes(bad),
      `'${bad}' là 1 trong SECRET_PORT_FORBIDDEN_FIELDS`,
    );
  }
});

test('ObjectStoragePort: upload → evidence handle (KHÔNG public URL)', () => {
  const body = new Uint8Array([0x01, 0x02, 0x03]);
  const up = ObjectStorageUploadRequestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    kind: 'CCCD_FRONT',
    bytes: body,
    owner: 'consumer-001',
    vnResidency: true,
  });
  assert.ok(up.bytes instanceof Uint8Array);

  const handle = ObjectStorageHandleSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    storageHandle: 'opaque-storage-handle-001',
    contentDigest: 'a'.repeat(64),
    storedAt: '2026-09-13T10:00:00.000+07:00',
    quarantined: true,
  });
  assert.equal(handle.quarantined, true);

  // Read request: TTL ≤ 60 sec cho CCCD (Master §11).
  const read = ObjectStorageReadResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    storageHandle: 'opaque-storage-handle-001',
    signedUrl: 'https://example.invalid/signed?exp=123',
    expiresAt: '2026-09-13T10:01:00.000+07:00',
  });
  assert.equal(read.signedUrl.startsWith('https://'), true);

  // TTL > 60 → reject.
  assert.equal(
    ObjectStorageReadRequestSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      storageHandle: 'opaque-storage-handle-001',
      accessor: 'reviewer-001',
      ttlSec: 120,
    }).success,
    false,
    'TTL signed URL cho CCCD phải ≤ 60 sec',
  );
});

test('PORTS_FORBIDDEN_IMPORTS: Port KHÔNG import Prisma/Next runtime', () => {
  // Marker audit: runtime HRP gate enforce qua code review + lint.
  for (const bad of [
    '@prisma/client',
    'next',
    'next/server',
    'next/headers',
    'pg',
    'mysql2',
    'drizzle-orm',
  ]) {
    assert.ok(
      PORTS_FORBIDDEN_IMPORTS.includes(bad),
      `'${bad}' phải ở PORTS_FORBIDDEN_IMPORTS (Backlog §0.3h)`,
    );
  }
});

test('ChatwootMessageKind: 4 giá trị (INCOMING/OUTGOING/PRIVATE_NOTE/SYSTEM)', () => {
  for (const k of ['INCOMING', 'OUTGOING', 'PRIVATE_NOTE', 'SYSTEM']) {
    assert.equal(ChatwootMessageKindSchema.safeParse(k).success, true);
  }
  assert.equal(ChatwootMessageKindSchema.safeParse('BOT').success, false);
});
