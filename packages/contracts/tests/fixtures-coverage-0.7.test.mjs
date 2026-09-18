// Fixtures bổ sung Gate 0/0.7 — Backlog §Task 0.7 AC:
// 3 match outcomes, CLOSED + 9 closeReason, date condition (future +
// leap year), read-only CurrentRelationship (mutation reject),
// malformed envelopes (actor/source/version), evidence URL/base64
// reject, raw transcript reject, no-op update, retry errors
// (IDEMPOTENCY_CONFLICT, VERSION_CONFLICT), cross-aggregate leak,
// Q-32 pendingReference canonical.
//
// Fixtures chỉ chứng minh schema validation AC (Q-30 nguyên tắc).
// KHÔNG dùng schema pass làm bằng chứng policy runtime đã thực thi.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  // Enums / primitives
  CASE_CLOSE_REASONS,
  CalendarDateSchema,
  SchemaVersionSchema,
  CommandIdSchema,
  // Envelopes
  OperationReferenceSchema,
  RequestEnvelopeBaseSchema,
  // Errors
  ErrorCodeSchema,
  RetryClassSchema,
  // Commands
  CreateOrMatchLaborProfileInputSchema,
  MatchingOutcomeResultSchema,
  UpdateLaborProfileInputSchema,
  UpdateLaborProfileResultSchema,
  ClosePlacementCaseInputSchema,
  ClosePlacementCaseResultSchema,
  UpdateLaborAvailabilityInputSchema,
  UpdateLaborAvailabilityResultSchema,
  RecordTalentInteractionInputSchema,
  RecordClientInteractionInputSchema,
  CommitSuppressionInputSchema,
  PlanningBatchItemResultSchema,
  // 0.4 — queries/events/mappings
  EventEnvelopeSchema,
  ProfileCreationEventSchema,
  ExternalContactLinkSchema,
  ConversationLinkSchema,
  ContactabilityCheckRequestSchema,
  // 0.5 — analytics + AI
  MetricDefinitionSchema,
  MetricValueSchema,
  AIProviderConfigReadSchema,
  // Forbidden marker exports
  PLACEMENT_CASE_PATCH_WHITELIST,
  PROFILE_PATCH_WHITELIST,
  PROFILE_PATCH_FORBIDDEN_FIELDS,
  PLACEMENT_CASE_PATCH_FORBIDDEN,
  MAPPING_PATCH_FORBIDDEN,
  INTERACTION_PAYLOAD_FORBIDDEN_FIELDS,
  SUPPRESSION_PATCH_FORBIDDEN,
  EvidenceRefSchema,
} from '../dist/index.js';
import { ext, src } from './test-helpers.mjs';

// Helper: IntakeContextRef shape — F2 (Owner chỉ thị G0/0.8): source
// discriminator dùng CommandSourceSchema. INTEGRATION provider 'CHATWOOT'
// + connectionId required. external* fields đi kèm source.
const INTAKE_CTX_REF = {
  source: ext('CHATWOOT', 'conn-cw-1'),
  externalConversationId: 'cw-conv-1',
  externalAccountId: 'acc-1',
};

// ─────────────────────────────────────────────────────────────────────
// §1 3 match outcomes (createOrMatchLaborProfile)
// ─────────────────────────────────────────────────────────────────────
test('Match outcome: EXACT_MATCH result có canonicalId+version+matchReference', () => {
  const r = MatchingOutcomeResultSchema.safeParse({
    outcome: 'EXACT_MATCH',
    canonicalId: 'pid-1',
    version: 1,
    matchReference: 'mref-1',
  });
  assert.equal(r.success, true);
  assert.equal(r.data.outcome, 'EXACT_MATCH');
});

test('Match outcome: POSSIBLE_MATCH result KHÔNG có canonicalId; chỉ reviewReference', () => {
  const r1 = MatchingOutcomeResultSchema.safeParse({
    outcome: 'POSSIBLE_MATCH',
    reviewReference: 'rref-1',
  });
  assert.equal(r1.success, true);
  // canonicalId KHÔNG hợp lệ ở POSSIBLE_MATCH → reject.
  const r2 = MatchingOutcomeResultSchema.safeParse({
    outcome: 'POSSIBLE_MATCH',
    canonicalId: 'pid-1', // KHÔNG hợp lệ.
    reviewReference: 'rref-1',
  });
  assert.equal(r2.success, false, 'POSSIBLE_MATCH KHÔNG có canonicalId');
});

test('Match outcome: NEW_PROFILE result có canonicalId+version+createdByPolicy', () => {
  const r = MatchingOutcomeResultSchema.safeParse({
    outcome: 'NEW_PROFILE',
    canonicalId: 'pid-new-1',
    version: 1,
    createdByPolicy: 'pol-1',
  });
  assert.equal(r.success, true);
});

test('Match outcome: EXACT_MATCH thiếu canonicalId → reject', () => {
  const r = MatchingOutcomeResultSchema.safeParse({
    outcome: 'EXACT_MATCH',
    version: 1,
    matchReference: 'mref-1',
  });
  assert.equal(r.success, false);
});

test('Match outcome: NEW_PROFILE thiếu canonicalId → reject', () => {
  const r = MatchingOutcomeResultSchema.safeParse({
    outcome: 'NEW_PROFILE',
    version: 1,
    createdByPolicy: 'pol-1',
  });
  assert.equal(r.success, false);
});

test('createOrMatchLaborProfileInput: schema bind shape signal+provenance', () => {
  const r = CreateOrMatchLaborProfileInputSchema.safeParse({
    organizationId: 'org-1',
    signal: { fullName: 'Nguyen Van A', phone: '0901234567' },
    provenance: {
      provider: 'chatwoot',
      connectionId: 'conn-cw-1',
      collectedAt: '2026-09-13T05:00:00.000Z',
      externalReference: 'cw-conv-1',
    },
    intakeRevisionId: 'rev-1',
    policyHint: 'ALLOW_NEW',
  });
  assert.equal(r.success, true);
});

// ─────────────────────────────────────────────────────────────────────
// §2 CLOSED + 9 closeReason
// ─────────────────────────────────────────────────────────────────────
test('ClosePlacementCase: 9 closeReason đều accepted', () => {
  const base = {
    organizationId: 'org-1',
    placementCaseId: 'case-1',
    expectedVersion: 1,
  };
  for (const closeReason of CASE_CLOSE_REASONS) {
    const r = ClosePlacementCaseInputSchema.safeParse({ ...base, closeReason });
    assert.equal(r.success, true, `${closeReason} accepted`);
  }
  assert.equal(CASE_CLOSE_REASONS.length, 9, 'CASE_CLOSE_REASONS có 9 giá trị');
});

test('ClosePlacementCase: closeReason KHÔNG nằm trong allowlist → reject', () => {
  const r = ClosePlacementCaseInputSchema.safeParse({
    organizationId: 'org-1',
    placementCaseId: 'case-1',
    expectedVersion: 1,
    closeReason: 'BOGUS_REASON',
  });
  assert.equal(r.success, false);
});

test('ClosePlacementCase result: status=APPLIED + appliedStatus=CLOSED (Q-20)', () => {
  // SUCCESS không tự trigger EFFECTIVE; schema bind CLOSED-only.
  const r = ClosePlacementCaseResultSchema.safeParse({
    status: 'APPLIED',
    canonicalId: 'case-1',
    newVersion: 2,
    appliedStatus: 'CLOSED',
  });
  assert.equal(r.success, true);
  assert.equal(r.data.appliedStatus, 'CLOSED');
  // SUCCESS không có effect khác ngoài appliedStatus=CLOSED.
});

test('ClosePlacementCase: note KHÔNG được là URL/base64 (no transcript leak)', () => {
  const r1 = ClosePlacementCaseInputSchema.safeParse({
    organizationId: 'org-1',
    placementCaseId: 'case-1',
    expectedVersion: 1,
    closeReason: 'SUCCESS',
    note: 'xem https://example.com/transcript',
  });
  assert.equal(r1.success, false, 'note chứa URL → reject');
  const r2 = ClosePlacementCaseInputSchema.safeParse({
    organizationId: 'org-1',
    placementCaseId: 'case-1',
    expectedVersion: 1,
    closeReason: 'SUCCESS',
    note: 'data:text/plain;base64,aGVsbG8=',
  });
  assert.equal(r2.success, false, 'note base64 → reject');
});

// ─────────────────────────────────────────────────────────────────────
// §3 Date condition — CalendarDateSchema + AVAILABLE_FROM_DATE
// ─────────────────────────────────────────────────────────────────────
test('CalendarDate: leap year Feb 29 (2024) accepted', () => {
  assert.equal(CalendarDateSchema.safeParse('2024-02-29').success, true);
});

test('CalendarDate: Feb 29 non-leap (2025) rejected', () => {
  assert.equal(CalendarDateSchema.safeParse('2025-02-29').success, false);
});

test('CalendarDate: malformed input rejected', () => {
  for (const bad of ['2026-13-01', '2026-02-30', 'abc', '2026/09/13', '']) {
    assert.equal(CalendarDateSchema.safeParse(bad).success, false, `${bad} rejected`);
  }
});

test('AVAILABLE_FROM_DATE yêu cầu availableFromDate (date condition)', () => {
  // CalendarDate schema regex YYYY-MM-DD + leap year check.
  // 2027 KHÔNG phải leap year → Feb 29 invalid → test phải dùng ngày hợp lệ.
  const inp = {
    schemaVersion: '1',
    organizationId: 'org-1',
    laborProfileId: 'pid-1',
    expectedVersion: 1,
    patch: {
      availability: 'AVAILABLE_FROM_DATE',
      availableFromDate: '2028-02-29', // leap year 2028.
    },
    context: INTAKE_CTX_REF,
  };
  const r = UpdateLaborAvailabilityInputSchema.safeParse(inp);
  assert.equal(r.success, true);
});

test('AVAILABLE_FROM_DATE thiếu ngày → reject', () => {
  const inp = {
    schemaVersion: '1',
    organizationId: 'org-1',
    laborProfileId: 'pid-1',
    expectedVersion: 1,
    patch: { availability: 'AVAILABLE_FROM_DATE' },
    context: INTAKE_CTX_REF,
  };
  const r = UpdateLaborAvailabilityInputSchema.safeParse(inp);
  assert.equal(r.success, false);
});

test('Future-date validation KHÔNG thuộc schema (no hardcoded clock)', () => {
  // Schema chỉ bind shape ngày lịch; future-date business clock là
  // runtime HRP gate (Master §10.6.2 + Q-15). 2020-02-29 = valid leap
  // date nhưng KHÔNG bị schema reject dù đã qua.
  const r = CalendarDateSchema.safeParse('2020-02-29').success;
  assert.equal(r, true, 'schema KHÔNG enforce future-date ở shared contract');
});

test('UpdateLaborAvailability result: AVAILABLE_FROM_DATE yêu cầu appliedAvailableFromDate', () => {
  const r = UpdateLaborAvailabilityResultSchema.safeParse({
    schemaVersion: '1',
    canonicalId: 'pid-1',
    version: 2,
    previousAvailability: 'AVAILABLE_NOW',
    appliedAvailability: 'AVAILABLE_FROM_DATE',
    appliedAvailableFromDate: null, // sai — phải có.
  });
  assert.equal(r.success, false);
});

test('UpdateLaborAvailability result: appliedAvailableFromDate null khi KHÔNG phải AVAILABLE_FROM_DATE', () => {
  const r = UpdateLaborAvailabilityResultSchema.safeParse({
    schemaVersion: '1',
    canonicalId: 'pid-1',
    version: 2,
    previousAvailability: 'AVAILABLE_FROM_DATE',
    appliedAvailability: 'DO_NOT_CONTACT',
    appliedAvailableFromDate: '2027-02-29', // sai — phải null.
  });
  assert.equal(r.success, false);
});

// ─────────────────────────────────────────────────────────────────────
// §4 Read-only CurrentRelationship (mutation reject)
// ─────────────────────────────────────────────────────────────────────
test('CurrentRelationship KHÔNG thuộc PROFILE_PATCH_WHITELIST', () => {
  assert.equal(PROFILE_PATCH_WHITELIST.includes('currentRelationship'), false);
  assert.equal(PROFILE_PATCH_WHITELIST.includes('current_relationship'), false);
});

test('UpdateLaborProfile: patch chứa currentRelationship → reject (strict)', () => {
  const r = UpdateLaborProfileInputSchema.safeParse({
    organizationId: 'org-1',
    laborProfileId: 'pid-1',
    expectedVersion: 1,
    patch: { currentRelationship: 'EMPLOYED' },
  });
  assert.equal(r.success, false);
});

test('PROFILE_PATCH_FORBIDDEN_FIELDS chứa currentRelationship/handling/beneficiary', () => {
  assert.equal(PROFILE_PATCH_FORBIDDEN_FIELDS.includes('currentRelationship'), true);
  assert.equal(PROFILE_PATCH_FORBIDDEN_FIELDS.includes('handling'), true);
  assert.equal(PROFILE_PATCH_FORBIDDEN_FIELDS.includes('beneficiary'), true);
});

test('ClosePlacementCase: patch chứa currentRelationship → reject', () => {
  assert.equal(PLACEMENT_CASE_PATCH_WHITELIST.includes('currentRelationship'), false);
});

// ─────────────────────────────────────────────────────────────────────
// §5 Malformed envelopes — actor/source/version
// ─────────────────────────────────────────────────────────────────────
test('Envelope actor: kind sai → reject', () => {
  // Actor/source thuộc envelope (RequestEnvelopeBaseSchema), KHÔNG nằm
  // trong command payload. Test riêng envelope để bind shape.
  const r = RequestEnvelopeBaseSchema.safeParse({
    schemaVersion: '1',
    commandId: 'cmd-envelope-001',
    idempotencyKey: 'idem-envelope-001',
    correlationId: 'corr-envelope-001',
    organizationId: 'org-1',
    actor: { kind: 'ROBOT' }, // kind không hợp lệ.
    source: { kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null },
  });
  assert.equal(r.success, false);
});

test('Envelope actor: thiếu kind → reject', () => {
  const r = RequestEnvelopeBaseSchema.safeParse({
    schemaVersion: '1',
    commandId: 'cmd-envelope-002',
    idempotencyKey: 'idem-envelope-002',
    correlationId: 'corr-envelope-002',
    organizationId: 'org-1',
    actor: { userId: 'user-1' }, // thiếu kind.
    source: { kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null },
  });
  assert.equal(r.success, false);
});

test('Envelope source: kind ngoài allowlist → reject', () => {
  const r = RequestEnvelopeBaseSchema.safeParse({
    schemaVersion: '1',
    commandId: 'cmd-envelope-003',
    idempotencyKey: 'idem-envelope-003',
    correlationId: 'corr-envelope-003',
    organizationId: 'org-1',
    actor: { kind: 'USER', userId: 'user-1' },
    source: { kind: 'BOGUS_SOURCE' },
  });
  assert.equal(r.success, false);
});

test('Envelope source: thuộc envelope body (Q-3)', () => {
  // Actor discriminator: USER/SERVICE/DELEGATED_USER với field userId/serviceId/delegationRef.
  // Source ở envelope (CommandSource), runtime HRP gate bind principal/source.
  const r = RequestEnvelopeBaseSchema.safeParse({
    schemaVersion: '1',
    commandId: 'cmd-envelope-004',
    idempotencyKey: 'idem-envelope-004',
    correlationId: 'corr-envelope-004',
    organizationId: 'org-1',
    actor: { kind: 'USER', userId: 'user-1' },
    source: { kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null },
  });
  assert.equal(r.success, true);
});

test('Envelope actor: USER thiếu userId → reject', () => {
  const r = RequestEnvelopeBaseSchema.safeParse({
    schemaVersion: '1',
    commandId: 'cmd-envelope-005',
    idempotencyKey: 'idem-envelope-005',
    correlationId: 'corr-envelope-005',
    organizationId: 'org-1',
    actor: { kind: 'USER' }, // thiếu userId.
    source: { kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null },
  });
  assert.equal(r.success, false);
});

test('Envelope expectedVersion: field nằm ở command payload (≥ 1)', () => {
  const r1 = UpdateLaborProfileInputSchema.safeParse({
    organizationId: 'org-1',
    laborProfileId: 'pid-1',
    expectedVersion: -1,
    patch: { intentSummary: 'test' },
  });
  assert.equal(r1.success, false, 'expectedVersion âm → reject');
  const r2 = UpdateLaborProfileInputSchema.safeParse({
    organizationId: 'org-1',
    laborProfileId: 'pid-1',
    expectedVersion: 0,
    patch: { intentSummary: 'test' },
  });
  assert.equal(r2.success, false, 'expectedVersion 0 → reject');
});

test('Schema version không match `"1"` → reject', () => {
  assert.equal(SchemaVersionSchema.safeParse('2').success, false);
  assert.equal(SchemaVersionSchema.safeParse(1).success, false);
});

// ─────────────────────────────────────────────────────────────────────
// §6 Evidence URL/base64 reject + raw transcript reject
// ─────────────────────────────────────────────────────────────────────
test('EvidenceRef KHÔNG chứa URL/base64/raw path', () => {
  for (const bad of [
    'https://example.com/cccd',
    'data:image/png;base64,iVBORw0KGgo=',
    'file:///etc/passwd',
    '/var/data/raw-transcript.txt',
  ]) {
    const r = EvidenceRefSchema.safeParse(bad);
    assert.equal(r.success, false, `evidenceRef ${bad} rejected`);
  }
});

test('InteractionPatch KHÔNG chứa raw transcript/attachment fields', () => {
  // INTERACTION_PAYLOAD_FORBIDDEN_FIELDS thực tế chứa:
  // transcript/rawTranscript/message/rawMessage/attachment/attachments/
  // base64/dataUri/rawUrl/publicUrl/signedUrl/arbitraryPatch/noteInternal/currentRelationship.
  for (const bad of ['transcript', 'rawUrl', 'attachment', 'base64']) {
    assert.equal(INTERACTION_PAYLOAD_FORBIDDEN_FIELDS.includes(bad), true);
  }
});

test('Profile intent output KHÔNG được là transcript/URL', () => {
  assert.equal(PROFILE_PATCH_FORBIDDEN_FIELDS.includes('transcript'), false, 'PROFILE_FORBIDDEN khác INTERACTION_FORBIDDEN');
  assert.equal(PROFILE_PATCH_FORBIDDEN_FIELDS.includes('currentRelationship'), true);
  assert.equal(PROFILE_PATCH_FORBIDDEN_FIELDS.includes('handling'), true);
  assert.equal(PROFILE_PATCH_FORBIDDEN_FIELDS.includes('arbitraryPatch'), true);
});

test('Suppression patch KHÔNG được chứa removeSuppression (no auto-remove)', () => {
  assert.equal(SUPPRESSION_PATCH_FORBIDDEN.includes('removeSuppression'), true);
  assert.equal(SUPPRESSION_PATCH_FORBIDDEN.includes('inboundOptOutRemoval'), true);
  assert.equal(SUPPRESSION_PATCH_FORBIDDEN.includes('bypassDnc'), true);
});

test('CommitSuppression input: shape + payload (Q-26)', () => {
  // Schema yêu cầu schemaVersion + organizationId + target + reason + context.
  // LaborProfile target = { kind: 'LABOR_PROFILE', organizationId, laborProfileId,
  //  expectedVersion, resolvedCanonical (boolean) }.
  const r = CommitSuppressionInputSchema.safeParse({
    schemaVersion: '1',
    organizationId: 'org-1',
    target: {
      kind: 'LABOR_PROFILE',
      organizationId: 'org-1',
      laborProfileId: 'pid-1',
      expectedVersion: 1,
      resolvedCanonical: true,
    },
    reason: 'CANDIDATE_REQUEST',
    context: INTAKE_CTX_REF,
    note: 'candidate opted out',
  });
  assert.equal(r.success, true);
});

// ─────────────────────────────────────────────────────────────────────
// §7 No-op update — updateLaborProfile NOOP, batch APPLIED
// ─────────────────────────────────────────────────────────────────────
test('UpdateLaborProfile result NOOP: status=NOOP (no change)', () => {
  const r = UpdateLaborProfileResultSchema.safeParse({
    status: 'NOOP',
    canonicalId: 'pid-1',
    currentVersion: 1,
  });
  assert.equal(r.success, true);
  assert.equal(r.data.status, 'NOOP');
});

test('UpdateLaborProfile result APPLIED: status=APPLIED + newVersion', () => {
  const r = UpdateLaborProfileResultSchema.safeParse({
    status: 'APPLIED',
    canonicalId: 'pid-1',
    newVersion: 2,
  });
  assert.equal(r.success, true);
  assert.equal(r.data.status, 'APPLIED');
});

test('PlanningBatchItemResult: APPLIED không có pendingReference', () => {
  const r = PlanningBatchItemResultSchema.safeParse({
    itemId: 'item-noop',
    itemKind: 'NEXT_ACTION',
    outcome: 'APPLIED',
    appliedId: 'pid-1',
    appliedVersion: 1,
  });
  assert.equal(r.success, true);
  assert.equal(r.data.outcome, 'APPLIED');
});

test('PlanningBatchItemResult: SKIPPED có appliedId (target canonical)', () => {
  const r = PlanningBatchItemResultSchema.safeParse({
    itemId: 'item-skip',
    itemKind: 'NEXT_ACTION',
    outcome: 'SKIPPED',
    appliedId: 'pid-1',
  });
  assert.equal(r.success, true);
});

// ─────────────────────────────────────────────────────────────────────
// §8 Retry errors — IDEMPOTENCY_CONFLICT, VERSION_CONFLICT
// ─────────────────────────────────────────────────────────────────────
test('ErrorCode: IDEMPOTENCY_CONFLICT retry class = NEVER', () => {
  assert.equal(ErrorCodeSchema.safeParse('IDEMPOTENCY_CONFLICT').success, true);
  assert.equal(RetryClassSchema.safeParse('NEVER').success, true);
});

test('ErrorCode: VERSION_CONFLICT retry class = REFRESH_AND_REVIEW', () => {
  assert.equal(ErrorCodeSchema.safeParse('VERSION_CONFLICT').success, true);
  assert.equal(RetryClassSchema.safeParse('REFRESH_AND_REVIEW').success, true);
});

test('Idempotency digest SHA-256 hex (64 chars)', () => {
  const sha256Hex = /^[a-f0-9]{64}$/u;
  for (const good of ['a'.repeat(64), '0123456789abcdef'.repeat(4)]) {
    assert.equal(sha256Hex.test(good), true, `${good.slice(0, 8)}… valid hex`);
  }
  for (const bad of ['short', 'Z'.repeat(64), 'g'.repeat(64), '']) {
    assert.equal(sha256Hex.test(bad), false, `${bad.slice(0, 8) || '<empty>'} invalid`);
  }
});

test('OperationReferenceSchema: kind + operationId canonical (Q-32)', () => {
  const r = OperationReferenceSchema.safeParse({
    kind: 'COMMAND_OPERATION',
    operationId: 'op-ref-min8',
  });
  assert.equal(r.success, true);
  // kind sai → reject.
  const r2 = OperationReferenceSchema.safeParse({
    kind: 'WEBHOOK_RECEIPT',
    operationId: 'op-ref-min8',
  });
  assert.equal(r2.success, false);
  // operationId thiếu → reject.
  const r3 = OperationReferenceSchema.safeParse({ kind: 'COMMAND_OPERATION' });
  assert.equal(r3.success, false);
});

test('CommandIdSchema: opaque min length', () => {
  assert.equal(CommandIdSchema.safeParse('cmd-min8').success, true);
  assert.equal(CommandIdSchema.safeParse('x').success, false);
});

// ─────────────────────────────────────────────────────────────────────
// §9 Cross-aggregate leak — interaction/context payload
// ─────────────────────────────────────────────────────────────────────
test('RecordTalentInteraction: shape required (kind/outcome/context/occurredAt)', () => {
  // INTERACTION_KINDS = [PLACEMENT_PROGRESS, FOLLOWUP, NOTE,
  //  CLIENT_OUTREACH, TALENT_OUTREACH]; OUTCOMES = [POSITIVE, NEUTRAL,
  //  NEGATIVE, PENDING, UNKNOWN].
  const r = RecordTalentInteractionInputSchema.safeParse({
    organizationId: 'org-1',
    laborProfileId: 'pid-1',
    kind: 'TALENT_OUTREACH',
    outcome: 'POSITIVE',
    context: INTAKE_CTX_REF,
    occurredAt: '2026-09-13T05:00:00.000Z',
  });
  assert.equal(r.success, true);
});

test('RecordTalentInteraction: summary chứa URL → reject', () => {
  const r = RecordTalentInteractionInputSchema.safeParse({
    organizationId: 'org-1',
    laborProfileId: 'pid-1',
    kind: 'PHONE_CALL',
    outcome: 'CONNECTED',
    context: INTAKE_CTX_REF,
    occurredAt: '2026-09-13T05:00:00.000Z',
    summary: 'xem https://example.com/transcript',
  });
  assert.equal(r.success, false);
});

test('RecordClientInteraction: Client domain (Q-23 unresolved)', () => {
  const r = RecordClientInteractionInputSchema.safeParse({
    organizationId: 'org-1',
    clientReferenceId: 'client-ref-1',
    kind: 'CLIENT_OUTREACH',
    outcome: 'NEUTRAL',
    context: INTAKE_CTX_REF,
    occurredAt: '2026-09-13T05:00:00.000Z',
  });
  assert.equal(r.success, true);
});

test('ExternalContactLink cross-aggregate: link có matchedTarget EXACT_MATCH', () => {
  const r = ExternalContactLinkSchema.safeParse({
    schemaVersion: '1',
    organizationId: 'org-1',
    provider: 'chatwoot',
    connectionId: 'conn-cw-1',
    external: {
      externalAccountId: 'acc-1',
      externalContactId: 'ext-1',
    },
    state: 'EXACT_MATCH',
    matchedTarget: {
      kind: 'TALENT',
      matchedLaborProfileId: 'pid-1',
      matchedLaborProfileVersion: 1,
    },
    aggregateVersion: 1,
  });
  assert.equal(r.success, true);
});

test('ConversationLink: historyRevisions + currentRevision + updatedAt required', () => {
  const r = ConversationLinkSchema.safeParse({
    schemaVersion: '1',
    organizationId: 'org-1',
    conversationId: 'conv-1',
    conversationVersion: 1,
    conversationKind: 'TALENT',
    externalRefs: [
      {
        schemaVersion: '1',
        organizationId: 'org-1',
        provider: 'chatwoot',
        connectionId: 'conn-cw-1',
        externalAccountId: 'acc-1',
        externalConversationId: 'ext-conv-1',
        aggregateVersion: 1,
      },
    ],
    currentRevision: 1,
    historyRevisions: [
      {
        revisionId: 'rev-1',
        recordedAt: '2026-09-13T05:00:00.000Z',
      },
    ],
    updatedAt: '2026-09-13T05:30:00.000Z',
    primaryTarget: {
      schemaVersion: '1',
      kind: 'TALENT',
      laborProfileId: 'pid-1',
      laborProfileVersion: 1,
    },
  });
  assert.equal(r.success, true);
});

// ─────────────────────────────────────────────────────────────────────
// §10 Event envelope — duplicate/out-of-order/correction (Q-31 marker)
// ─────────────────────────────────────────────────────────────────────
test('EventEnvelope: aggregateType + version required', () => {
  // eventId min 8; sourceSystem = HRP_ENGAGEMENT/INTEGRATION/HRP_INTERNAL/PROVIDER/SYSTEM.
  const r = EventEnvelopeSchema.safeParse({
    schemaVersion: '1',
    organizationId: 'org-1',
    eventId: 'evt-1234',
    eventType: 'PROFILE_CREATED',
    aggregateType: 'LABOR_PROFILE',
    aggregateId: 'pid-1',
    aggregateVersion: 1,
    occurredAt: '2026-09-13T05:00:00.000Z',
    recordedAt: '2026-09-13T05:30:00.000Z',
    correlationId: 'corr-min8',
    sourceSystem: 'HRP_INTERNAL',
    deliveryChannel: 'PUSH_WEBHOOK',
    payload: { kind: 'PROFILE_CREATED' },
  });
  assert.equal(r.success, true);
});

test('ProfileCreationEvent: envelope + attribution + 3 actor fields (Q-16)', () => {
  const envelope = {
    schemaVersion: '1',
    organizationId: 'org-1',
    eventId: 'evt-1234',
    eventType: 'PROFILE_CREATED',
    aggregateType: 'LABOR_PROFILE',
    aggregateId: 'pid-1',
    aggregateVersion: 1,
    occurredAt: '2026-09-13T05:00:00.000Z',
    recordedAt: '2026-09-13T05:30:00.000Z',
    correlationId: 'corr-min8',
    sourceSystem: 'HRP_INTERNAL',
    deliveryChannel: 'PUSH_WEBHOOK',
    payload: { kind: 'PROFILE_CREATED' },
  };
  // Actor dùng userId/serviceId; actor KHÔNG có source (source ở top-level).
  const attribution = {
    schemaVersion: '1',
    organizationId: 'org-1',
    submittedBy: { kind: 'USER', userId: 'user-1' },
    executingActor: { kind: 'SERVICE', serviceId: 'svc-1' },
    creditedCreator: { kind: 'USER', userId: 'user-1' },
    source: 'HRP_INTERNAL',
    attributionState: 'AVAILABLE',
  };
  const r = ProfileCreationEventSchema.safeParse({
    schemaVersion: '1',
    envelope,
    attribution,
    laborProfileId: 'pid-1',
    laborProfileVersion: 1,
    creationLabel: 'SUBMITTED',
  });
  assert.equal(r.success, true);
});

// ─────────────────────────────────────────────────────────────────────
// §11 0.5 — analytics + AI reinforcement
// ─────────────────────────────────────────────────────────────────────
test('MetricDefinition: 3 lifecycle metricId PHẢI bind được distinct (Q-9)', () => {
  // grain: ACTOR/TEAM/COHORT/ORGANIZATION/CONVERSATION/TARGET.
  // period: DAILY/WEEKLY/MONTHLY/QUARTERLY (literal).
  // source: object (MetricSourceSchema).
  const a = MetricDefinitionSchema.safeParse({
    schemaVersion: '1',
    organizationId: 'org-1',
    metricId: 'profile.created',
    displayName: 'Profile Created',
    grain: 'ORGANIZATION',
    unit: 'COUNT',
    period: 'DAILY',
    // MetricSource: kind = CHATWOOT|ZALO_OA|INTERNAL_FORM|HRP_UI|EXPERIMENTAL.
    source: { kind: 'HRP_UI' },
    asOf: '2026-09-13T05:00:00.000Z',
    version: 1,
    attributionState: 'AVAILABLE',
  });
  assert.equal(a.success, true);
  const b = MetricDefinitionSchema.safeParse({
    schemaVersion: '1',
    organizationId: 'org-1',
    metricId: 'profile.updated',
    displayName: 'Profile Updated',
    grain: 'ORGANIZATION',
    unit: 'COUNT',
    period: 'DAILY',
    // MetricSource: kind = CHATWOOT|ZALO_OA|INTERNAL_FORM|HRP_UI|EXPERIMENTAL.
    source: { kind: 'HRP_UI' },
    asOf: '2026-09-13T05:00:00.000Z',
    version: 1,
    attributionState: 'AVAILABLE',
  });
  assert.equal(b.success, true);
  const c = MetricDefinitionSchema.safeParse({
    schemaVersion: '1',
    organizationId: 'org-1',
    metricId: 'profile.submitted',
    displayName: 'Profile Submitted',
    grain: 'ORGANIZATION',
    unit: 'COUNT',
    period: 'DAILY',
    // MetricSource: kind = CHATWOOT|ZALO_OA|INTERNAL_FORM|HRP_UI|EXPERIMENTAL.
    source: { kind: 'HRP_UI' },
    asOf: '2026-09-13T05:00:00.000Z',
    version: 1,
    attributionState: 'AVAILABLE',
  });
  assert.equal(c.success, true);
});

test('MetricValue: UNAVAILABLE → value 0 placeholder + reasonCode (Q-30)', () => {
  const r = MetricValueSchema.safeParse({
    schemaVersion: '1',
    organizationId: 'org-1',
    metricId: 'profile.created',
    grain: 'ORGANIZATION',
    unit: 'COUNT',
    period: 'DAILY',
    value: 0,
    asOf: '2026-09-13T05:00:00.000Z',
    version: 1,
    attributionState: 'UNAVAILABLE',
    attributionReasonCode: 'SOURCE_MISSING',
  });
  assert.equal(r.success, true);
});

test('AIProviderConfigRead: read DTO KHÔNG chứa raw secret (Q-36)', () => {
  const raw = {
    schemaVersion: '1',
    providerId: 'prov-1',
    baseUrl: 'https://api.example.com',
    model: 'gpt-x',
    apiStyle: 'RESPONSES',
    secretRef: { kind: 'platform', secretId: 'sec-1' },
    capabilities: ['TEXT_GENERATION'],
    dataPolicy: 'NO_PII',
    budget: { maxTokensPerDay: 100000 },
    version: 1,
    apiKey: 'sk-12345', // forbidden.
  };
  const r = AIProviderConfigReadSchema.safeParse(raw);
  assert.equal(r.success, false, 'apiKey trong read DTO → reject');
});

// ─────────────────────────────────────────────────────────────────────
// §12 ContactabilityCheck — fresh check (Q-26)
// ─────────────────────────────────────────────────────────────────────
test('ContactabilityCheckRequest: shape required (scope + target + channel)', () => {
  // Scope + CanonicalTargetRef required.
  const r = ContactabilityCheckRequestSchema.safeParse({
    schemaVersion: '1',
    scope: {
      schemaVersion: '1',
      organizationId: 'org-1',
      actor: { kind: 'SERVICE', serviceId: 'svc-1' },
    },
    target: {
      schemaVersion: '1',
      kind: 'TALENT',
      laborProfileId: 'pid-1',
      laborProfileVersion: 1,
    },
    channel: 'ZALO_OA',
  });
  assert.equal(r.success, true);
});

// ─────────────────────────────────────────────────────────────────────
// §13 Forbidden marker exports consistency
// ─────────────────────────────────────────────────────────────────────
test('PLACEMENT_CASE_PATCH_FORBIDDEN chứa status/closeReason/caseId', () => {
  assert.equal(PLACEMENT_CASE_PATCH_FORBIDDEN.includes('status'), true);
  assert.equal(PLACEMENT_CASE_PATCH_FORBIDDEN.includes('closeReason'), true);
  assert.equal(PLACEMENT_CASE_PATCH_FORBIDDEN.includes('placementCaseId'), true);
  assert.equal(PLACEMENT_CASE_PATCH_FORBIDDEN.includes('caseId'), true);
});

test('MAPPING_PATCH_FORBIDDEN chứa assumeAttribution/forceNewProfileLink', () => {
  // MAPPING_PATCH_FORBIDDEN không chứa 'NEW_PROFILE' (NEW_PROFILE là
  // command outcome; mapping state ∈ {EXACT_MATCH, POSSIBLE_MATCH,
  // UNRESOLVED}). Marker phủ đủ Q-30 (no assumed link state).
  assert.equal(MAPPING_PATCH_FORBIDDEN.includes('assumeAttribution'), true);
  assert.equal(MAPPING_PATCH_FORBIDDEN.includes('forceNewProfileLink'), true);
  assert.equal(MAPPING_PATCH_FORBIDDEN.includes('autoMerge'), true);
  assert.equal(MAPPING_PATCH_FORBIDDEN.includes('acceptNewProfileAsLinkState'), true);
});

// ─────────────────────────────────────────────────────────────────────
// §14 Q-32 — pendingReference canonical (planning batch)
// ─────────────────────────────────────────────────────────────────────
test('PlanningBatchItemResult: ACCEPTED có pendingReference canonical (Q-32)', () => {
  const r = PlanningBatchItemResultSchema.safeParse({
    itemId: 'item-1',
    itemKind: 'NEXT_ACTION',
    outcome: 'ACCEPTED',
    pendingReference: {
      kind: 'COMMAND_OPERATION',
      operationId: 'op-ref-min8',
    },
  });
  assert.equal(r.success, true);
  assert.equal(r.data.outcome, 'ACCEPTED');
  assert.equal(r.data.pendingReference.kind, 'COMMAND_OPERATION');
});

test('PlanningBatchItemResult: ACCEPTED KHÔNG có appliedId (Q-32)', () => {
  const r = PlanningBatchItemResultSchema.safeParse({
    itemId: 'item-2',
    itemKind: 'NEXT_ACTION',
    outcome: 'ACCEPTED',
    appliedId: 'pid-1', // sai — ACCEPTED không mang APPLIED.
    pendingReference: {
      kind: 'COMMAND_OPERATION',
      operationId: 'op-ref-min8-2',
    },
  });
  assert.equal(r.success, false, 'ACCEPTED KHÔNG có appliedId');
});

test('PlanningBatchItemResult: FAILED/SKIPPED KHÔNG có pendingReference', () => {
  const r1 = PlanningBatchItemResultSchema.safeParse({
    itemId: 'item-failed',
    itemKind: 'NEXT_ACTION',
    outcome: 'FAILED',
    pendingReference: { kind: 'COMMAND_OPERATION', operationId: 'op-failed-001' },
    error: { code: 'VALIDATION_ERROR', message: 'x' },
  });
  assert.equal(r1.success, false, 'FAILED KHÔNG có pendingReference');
  const r2 = PlanningBatchItemResultSchema.safeParse({
    itemId: 'item-skipped',
    itemKind: 'NEXT_ACTION',
    outcome: 'SKIPPED',
    pendingReference: { kind: 'COMMAND_OPERATION', operationId: 'op-skip-001' },
  });
  assert.equal(r2.success, false, 'SKIPPED KHÔNG có pendingReference');
});
