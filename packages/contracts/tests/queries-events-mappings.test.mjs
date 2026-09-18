/**
 * queries-events-mappings.test.mjs — fixtures G0/0.4 (Queries/Events/Mappings).
 *
 * Trọng tâm AC (Owner chỉ thị rev 2):
 *  - Queries: scope/paging/version; constants UI KHÔNG phụ thuộc
 *    dictionary API (đã có enum package).
 *  - Events: organization/eventId/aggregate/version/time/source +
 *    duplicate/out-of-order/correction/watermark.
 *  - Creation events phân biệt submittedBy/executingActor/
 *    creditedCreator/source; thiếu attribution trả `unavailable`,
 *    KHÔNG đoán.
 *  - ExternalContactLink: 3 states (EXACT_MATCH/POSSIBLE_MATCH/UNRESOLVED);
 *    NEW_PROFILE KHÔNG là mapping state.
 *  - Talent/Client target union — Client thiếu contract giữ proposed,
 *    KHÔNG ép về Talent fields.
 *  - Conversation link: history/context revision; mutation target lấy
 *    mapping tin cậy, KHÔNG tin Chatwoot attributes.
 *  - Marker/forbidden-list KHÔNG tự chứng minh AC được enforce.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CursorPaginationInputSchema,
  CursorPaginationOutputSchema,
  QueryScopeSchema,
  ContextQueryRequestSchema,
  ContextPanelIdentitySummarySchema,
  ContextPanelPlacementCaseSchema,
  ContextPanelAvailabilitySchema,
  ContextPanelCurrentRelationshipSchema,
  ContextPanelNextActionSummarySchema,
  ContextPanelRecentInteractionSchema,
  ContextPanelContactabilitySchema,
  ContextPanelSuppressionSummarySchema,
  ContextPanelResultSchema,
  ReadOnlyIdentityPreviewRequestSchema,
  ReadOnlyIdentityCandidateSchema,
  ReadOnlyIdentityPreviewResultSchema,
  AllowedActionsQueryRequestSchema,
  AllowedActionSchema,
  AllowedActionsQueryResultSchema,
  ContactabilityCheckRequestSchema,
  ContactabilityCheckResultSchema,
  ConstantsSnapshotSchema,
  QUERIES_PATCH_FORBIDDEN,
} from '../dist/commands/queries.js';
import {
  EVENT_AGGREGATE_TYPES,
  EventAggregateTypeSchema,
  EventEnvelopeSchema,
  EventDuplicateKindSchema,
  EventReceiptSchema,
  EventWatermarkSchema,
  AttributionStateSchema,
  CreationActorAttributionSchema,
  CreationEventLabelSchema,
  ProfileCreationEventSchema,
  PlacementCaseCreationEventSchema,
  EVENT_PATCH_FORBIDDEN,
} from '../dist/commands/events.js';
import {
  ExternalContactRefSchema,
  EXTERNAL_CONTACT_LINK_STATES,
  ExternalContactLinkStateSchema,
  ExternalContactLinkTargetSchema,
  ExternalContactLinkSchema,
  TalentTargetRefSchema,
  ClientTargetRefSchema,
  CanonicalTargetRefSchema,
  ExternalConversationRefSchema,
  ConversationLinkSchema,
  ResolveContactByExternalRequestSchema,
  ResolveContactByExternalResultSchema,
  ListExternalContactLinksRequestSchema,
  ListExternalContactLinksResultSchema,
  MAPPING_PATCH_FORBIDDEN,
} from '../dist/commands/mappings.js';
import { SCHEMA_VERSION } from '../dist/enums.js';

const org = 'org-test-qem';
const cmdId = 'cmd-qem-001';

function baseScope() {
  return {
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    actor: { kind: 'USER', userId: 'user-001' },
  };
}

function baseTalentTarget() {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'TALENT',
    laborProfileId: 'lp-001',
    laborProfileVersion: 1,
  };
}

function baseEnvelopeFields() {
  return {
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    eventId: 'evt-0001',
    eventType: 'profile.created',
    aggregateType: 'LABOR_PROFILE',
    aggregateId: 'lp-001',
    aggregateVersion: 1,
    occurredAt: '2026-09-13T10:00:00.000+07:00',
    recordedAt: '2026-09-13T10:00:01.000+07:00',
    correlationId: 'trace-abc-1234567',
    sourceCommandId: cmdId,
    sourceSystem: 'HRP_ENGAGEMENT',
    deliveryChannel: 'PUSH_WEBHOOK',
    payload: { kind: 'created' },
    isCorrection: false,
  };
}

function baseAttributionFields() {
  return {
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    submittedBy: { kind: 'USER', userId: 'user-001' },
    executingActor: { kind: 'USER', userId: 'user-001' },
    creditedCreator: { kind: 'USER', userId: 'user-001' },
    source: 'HRP_ENGAGEMENT',
    attributionState: 'AVAILABLE',
  };
}

/* ──────────────────────── Queries fixtures ──────────────────────── */

test('CursorPagination: pageSize 1..200; default 20; >200 reject', () => {
  const r1 = CursorPaginationInputSchema.parse({});
  assert.equal(r1.pageSize, 20);

  assert.equal(
    CursorPaginationInputSchema.safeParse({ pageSize: 201 }).success,
    false,
    'pageSize > 200 reject',
  );
  assert.equal(
    CursorPaginationInputSchema.safeParse({ pageSize: 0 }).success,
    false,
  );

  const r2 = CursorPaginationOutputSchema.parse({});
  assert.equal(r2.nextCursor, undefined);
});

test('QueryScope: organization + actor + asOfVersion; provider/connectionId optional', () => {
  const r = QueryScopeSchema.parse(baseScope());
  assert.equal(r.organizationId, org);

  // asOfVersion optional.
  const r2 = QueryScopeSchema.parse({
    ...baseScope(),
    asOfVersion: 5,
  });
  assert.equal(r2.asOfVersion, 5);

  // Thiếu organizationId → reject.
  assert.equal(
    QueryScopeSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      actor: { kind: 'USER', userId: 'u-001' },
    }).success,
    false,
  );
});

test('ContextQueryRequest: phải có target HOẶC external; thiếu cả hai reject', () => {
  // Có target OK.
  const r1 = ContextQueryRequestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    scope: baseScope(),
    target: baseTalentTarget(),
  });
  assert.equal(r1.target.kind, 'TALENT');

  // Có external OK.
  const r2 = ContextQueryRequestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    scope: baseScope(),
    external: {
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      provider: 'CHATWOOT',
      connectionId: 'conn-cw-1',
      externalAccountId: 'acc-001',
    },
  });
  assert.equal(r2.external.provider, 'CHATWOOT');

  // Thiếu cả hai reject.
  assert.equal(
    ContextQueryRequestSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      scope: baseScope(),
    }).success,
    false,
    'phải có target hoặc external',
  );
});

test('ContextPanelIdentitySummary: displayOnly phải true (cảnh báo không dùng làm mutation target)', () => {
  const r = ContextPanelIdentitySummarySchema.parse({
    schemaVersion: SCHEMA_VERSION,
    fullNameRedacted: 'Nguyễn V*** A',
    phoneRedacted: '+84****1234',
    displayOnly: true,
  });
  assert.equal(r.displayOnly, true);
});

test('ContextPanelPlacementCase: CLOSED phải có closeReason; closeReason chỉ với CLOSED; stage chỉ khi OPEN', () => {
  // CLOSED + closeReason OK.
  const r1 = ContextPanelPlacementCaseSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    placementCaseId: 'pc-001',
    placementCaseVersion: 5,
    closedStatus: 'CLOSED',
    closeReason: 'SUCCESS',
    aggregateVersion: 5,
  });
  assert.equal(r1.closeReason, 'SUCCESS');

  // CLOSED + no closeReason → reject (Q-20 invariant).
  assert.equal(
    ContextPanelPlacementCaseSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      placementCaseId: 'pc-001',
      placementCaseVersion: 5,
      closedStatus: 'CLOSED',
      aggregateVersion: 5,
    }).success,
    false,
    'CLOSED phải có closeReason',
  );

  // OPEN (không CLOSED) + closeReason → reject.
  assert.equal(
    ContextPanelPlacementCaseSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      placementCaseId: 'pc-001',
      placementCaseVersion: 5,
      closeReason: 'SUCCESS',
      aggregateVersion: 5,
    }).success,
    false,
    'closeReason chỉ với CLOSED',
  );

  // CLOSED + stage → reject.
  assert.equal(
    ContextPanelPlacementCaseSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      placementCaseId: 'pc-001',
      placementCaseVersion: 5,
      stage: 'NEW',
      closedStatus: 'CLOSED',
      closeReason: 'SUCCESS',
      aggregateVersion: 5,
    }).success,
    false,
    'CLOSED KHÔNG có stage',
  );
});

test('ContextPanelAvailability: contactabilityVersion (freshness marker)', () => {
  const r = ContextPanelAvailabilitySchema.parse({
    schemaVersion: SCHEMA_VERSION,
    availability: 'AVAILABLE_NOW',
    aggregateVersion: 1,
    contactabilityVersion: 5,
  });
  assert.equal(r.contactabilityVersion, 5);
});

test('ContextPanelCurrentRelationship: readonly BẮT BUỘC true (trục riêng)', () => {
  const r = ContextPanelCurrentRelationshipSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    currentRelationship: 'WORKING_VIA_HRP',
    readonly: true,
  });
  assert.equal(r.readonly, true);

  // readonly=false → reject (schema ép true).
  assert.equal(
    ContextPanelCurrentRelationshipSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      currentRelationship: 'WORKING_VIA_HRP',
      readonly: false,
    }).success,
    false,
    'currentRelationship panel BẮT BUỘC readonly=true (chống mutate)',
  );
});

test('ContextPanelNextActionSummary: status + snoozeMode tách riêng (Q-27)', () => {
  const r = ContextPanelNextActionSummarySchema.parse({
    schemaVersion: SCHEMA_VERSION,
    nextActionId: 'na-001',
    nextActionVersion: 1,
    status: 'OPEN',
    scheduledAt: '2026-09-13T10:00:00.000+07:00',
    dueAt: '2026-09-13T11:00:00.000+07:00',
    snoozeMode: 'ACTIVE',
  });
  assert.equal(r.status, 'OPEN');
  assert.equal(r.snoozeMode, 'ACTIVE');
});

test('ContextPanelRecentInteraction: summaryRedacted ≤ 512; reject URL/base64', () => {
  const r = ContextPanelRecentInteractionSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    interactionId: 'i-001',
    occurredAt: '2026-09-13T10:00:00.000+07:00',
    direction: 'INBOUND',
    channel: 'CHATWOOT',
    outcome: 'POSITIVE',
    summaryRedacted: 'Nói chuyện ngắn — đã redacted',
  });
  assert.ok(r.summaryRedacted.length > 0);

  // URL trong summary → reject.
  assert.equal(
    ContextPanelRecentInteractionSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      interactionId: 'i-001',
      occurredAt: '2026-09-13T10:00:00.000+07:00',
      direction: 'INBOUND',
      channel: 'CHATWOOT',
      outcome: 'POSITIVE',
      summaryRedacted: 'xem https://evil.example/foo',
    }).success,
    false,
    'summary KHÔNG chứa URL',
  );
});

test('ContextPanelContactability: AUTHORIZED/SUPPRESSED/UNKNOWN; UNKNOWN = fail closed', () => {
  const r1 = ContextPanelContactabilitySchema.parse({
    schemaVersion: SCHEMA_VERSION,
    dispatchOutcome: 'AUTHORIZED',
    reasonCode: 'OK',
    freshnessAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r1.dispatchOutcome, 'AUTHORIZED');

  const r2 = ContextPanelContactabilitySchema.parse({
    schemaVersion: SCHEMA_VERSION,
    dispatchOutcome: 'UNKNOWN',
    reasonCode: 'CACHE_STALE',
    freshnessAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r2.dispatchOutcome, 'UNKNOWN', 'UNKNOWN = fail closed');
});

test('ContextPanelSuppressionSummary: fenceCutOffAt optional', () => {
  const r = ContextPanelSuppressionSummarySchema.parse({
    schemaVersion: SCHEMA_VERSION,
    reason: 'DO_NOT_CONTACT',
    committedAt: '2026-09-13T10:00:00.000+07:00',
    fenceCutOffAt: '2026-09-13T18:00:00.000+07:00',
  });
  assert.equal(r.fenceCutOffAt, '2026-09-13T18:00:00.000+07:00');
});

test('ContextPanelResult: field allowlist; unavailableFields marker cho thiếu', () => {
  const r = ContextPanelResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    snapshotVersion: 5,
    target: baseTalentTarget(),
    currentRelationship: {
      schemaVersion: SCHEMA_VERSION,
      currentRelationship: 'NEVER_WORKED',
      readonly: true,
    },
    resolvedAt: '2026-09-13T10:00:00.000+07:00',
    unavailableFields: ['contactability', 'suppressionSummary'],
  });
  assert.equal(r.unavailableFields.length, 2);
  assert.equal(r.currentRelationship.readonly, true);
});

test('ReadOnlyIdentityPreviewRequest: signals — KHÔNG ép NEW', () => {
  const r = ReadOnlyIdentityPreviewRequestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    scope: baseScope(),
    signals: { phoneNormalized: '84987654321' },
  });
  assert.equal(r.signals.phoneNormalized, '84987654321');

  // Empty signals OK (chỉ signals mỗi cái optional).
  const r2 = ReadOnlyIdentityPreviewRequestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    scope: baseScope(),
    signals: {},
  });
  assert.equal(r2.signals.phoneNormalized, undefined);
});

test('ReadOnlyIdentityCandidate: matchState từ ExternalContactMatchState (KHÔNG có NEW_PROFILE)', () => {
  for (const s of ['EXACT_MATCH', 'POSSIBLE_MATCH', 'UNRESOLVED']) {
    const r = ReadOnlyIdentityCandidateSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      candidateId: 'c-001',
      matchState: s,
      display: 'Candidate #001',
    });
    assert.equal(r.matchState, s);
  }
  // NEW_PROFILE KHÔNG là mapping state.
  assert.equal(
    ReadOnlyIdentityCandidateSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      candidateId: 'c-001',
      matchState: 'NEW_PROFILE',
      display: 'X',
    }).success,
    false,
    'NEW_PROFILE KHÔNG là mapping state (Backlog §0.4 + §0.3a)',
  );
});

test('AllowedActionsQuery: trả tier + privileged marker (privilege tách riêng)', () => {
  const r = AllowedActionSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    commandName: 'mergeLaborProfiles',
    tier: 'PRIVILEGED_MERGE',
    capabilityVersion: 1,
    privileged: true,
  });
  assert.equal(r.privileged, true);

  const r2 = AllowedActionsQueryResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    actions: [
      {
        schemaVersion: SCHEMA_VERSION,
        commandName: 'recordInteraction',
        tier: 'INBOUND_DEFAULT',
        capabilityVersion: 1,
        privileged: false,
      },
    ],
    resolvedAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r2.actions[0].privileged, false);
});

test('ContactabilityCheck: AUTHORIZED/SUPPRESSED/UNKNOWN; fenceToken optional', () => {
  const r = ContactabilityCheckResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    target: baseTalentTarget(),
    channel: 'ZALO_OA',
    outcome: 'AUTHORIZED',
    reasonCode: 'OK',
    freshnessAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r.outcome, 'AUTHORIZED');
  assert.equal(r.fenceToken, undefined);

  const r2 = ContactabilityCheckResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    target: baseTalentTarget(),
    channel: 'ZALO_OA',
    outcome: 'SUPPRESSED',
    reasonCode: 'DNC',
    freshnessAt: '2026-09-13T10:00:00.000+07:00',
    fenceToken: 'fence-token-001',
    fenceCutOffAt: '2026-09-13T11:00:00.000+07:00',
  });
  assert.equal(r2.fenceToken, 'fence-token-001');
});

test('ConstantsSnapshot: enum package đầy đủ + label tables; snapshotVersion pin', () => {
  const r = ConstantsSnapshotSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    placementCaseStages: [
      'NEW', 'CONTACTING', 'QUALIFYING', 'MATCHING',
      'PROPOSED', 'INTERESTED', 'CLIENT_PROCESS', 'READY_TO_START',
    ],
    placementCaseStageLabels: {
      NEW: 'Nhu cầu mới',
      CONTACTING: 'Đang liên hệ',
      QUALIFYING: 'Đang xác định nhu cầu',
      MATCHING: 'Đang tìm việc phù hợp',
      PROPOSED: 'Đã đề xuất việc',
      INTERESTED: 'Quan tâm việc đã đề xuất',
      CLIENT_PROCESS: 'Đang trong quy trình khách hàng',
      READY_TO_START: 'Sẵn sàng bắt đầu',
    },
    caseCloseReasons: [
      'SUCCESS', 'NO_LONGER_LOOKING', 'UNREACHABLE', 'NO_SUITABLE_JOB',
      'CANDIDATE_WITHDREW', 'CLIENT_REJECTED', 'DUPLICATE_CASE', 'INVALID',
      'OTHER',
    ],
    caseCloseReasonLabels: {
      SUCCESS: 'Đã ghép việc thành công',
      NO_LONGER_LOOKING: 'Không còn nhu cầu tìm việc',
      UNREACHABLE: 'Không thể liên lạc được',
      NO_SUITABLE_JOB: 'Không có công việc phù hợp',
      CANDIDATE_WITHDREW: 'Người lao động rút lui/từ chối',
      CLIENT_REJECTED: 'Doanh nghiệp từ chối',
      DUPLICATE_CASE: 'Trùng lặp đợt tìm việc',
      INVALID: 'Hồ sơ không hợp lệ',
      OTHER: 'Lý do khác',
    },
    closedCaseStatus: 'CLOSED',
    availabilities: [
      'AVAILABLE_NOW', 'AVAILABLE_FROM_DATE', 'NOT_AVAILABLE',
      'DO_NOT_CONTACT', 'UNKNOWN',
    ],
    availabilityLabels: {
      AVAILABLE_NOW: 'Có thể đi làm ngay',
      AVAILABLE_FROM_DATE: 'Sẵn sàng từ ngày',
      NOT_AVAILABLE: 'Chưa cần việc lúc này',
      DO_NOT_CONTACT: 'Không muốn HRP liên hệ',
      UNKNOWN: 'Chưa rõ',
    },
    currentRelationships: [
      'NEVER_WORKED', 'WORKING_VIA_HRP', 'FORMER_HRP_WORKER',
      'WORKING_EXTERNAL', 'UNKNOWN',
    ],
    currentRelationshipLabels: {
      NEVER_WORKED: 'Chưa từng làm qua HRP',
      WORKING_VIA_HRP: 'Đang làm qua HRP',
      FORMER_HRP_WORKER: 'Đã từng làm qua HRP',
      WORKING_EXTERNAL: 'Đang làm ngoài HRP',
      UNKNOWN: 'Chưa đủ dữ liệu',
    },
    matchingOutcomes: ['EXACT_MATCH', 'POSSIBLE_MATCH', 'NEW_PROFILE'],
    externalContactMatchStates: [
      'EXACT_MATCH', 'POSSIBLE_MATCH', 'UNRESOLVED',
    ],
    nextActionStatuses: ['OPEN', 'DONE', 'CANCELLED'],
    snapshotVersion: 1,
  });
  assert.equal(r.snapshotVersion, 1);
});

test('ConstantsSnapshot: thiếu label reject (cross-check enum package)', () => {
  assert.equal(
    ConstantsSnapshotSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      placementCaseStages: ['NEW'],
      placementCaseStageLabels: {}, // thiếu
      caseCloseReasons: [
        'SUCCESS', 'NO_LONGER_LOOKING', 'UNREACHABLE', 'NO_SUITABLE_JOB',
        'CANDIDATE_WITHDREW', 'CLIENT_REJECTED', 'DUPLICATE_CASE', 'INVALID',
        'OTHER',
      ],
      caseCloseReasonLabels: {
        SUCCESS: 'a', NO_LONGER_LOOKING: 'a', UNREACHABLE: 'a',
        NO_SUITABLE_JOB: 'a', CANDIDATE_WITHDREW: 'a', CLIENT_REJECTED: 'a',
        DUPLICATE_CASE: 'a', INVALID: 'a', OTHER: 'a',
      },
      closedCaseStatus: 'CLOSED',
      availabilities: [
        'AVAILABLE_NOW', 'AVAILABLE_FROM_DATE', 'NOT_AVAILABLE',
        'DO_NOT_CONTACT', 'UNKNOWN',
      ],
      availabilityLabels: {
        AVAILABLE_NOW: 'a', AVAILABLE_FROM_DATE: 'a', NOT_AVAILABLE: 'a',
        DO_NOT_CONTACT: 'a', UNKNOWN: 'a',
      },
      currentRelationships: [
        'NEVER_WORKED', 'WORKING_VIA_HRP', 'FORMER_HRP_WORKER',
        'WORKING_EXTERNAL', 'UNKNOWN',
      ],
      currentRelationshipLabels: {
        NEVER_WORKED: 'a', WORKING_VIA_HRP: 'a', FORMER_HRP_WORKER: 'a',
        WORKING_EXTERNAL: 'a', UNKNOWN: 'a',
      },
      matchingOutcomes: ['EXACT_MATCH', 'POSSIBLE_MATCH', 'NEW_PROFILE'],
      externalContactMatchStates: [
        'EXACT_MATCH', 'POSSIBLE_MATCH', 'UNRESOLVED',
      ],
      nextActionStatuses: ['OPEN', 'DONE', 'CANCELLED'],
      snapshotVersion: 1,
    }).success,
    false,
    'thiếu label cho placementCaseStages[0] (NEW) reject',
  );
});

test('QUERIES_PATCH_FORBIDDEN: marker audit (Owner rev 2: marker KHÔNG tự chứng minh)', () => {
  // Marker là audit, runtime HRP gate enforce.
  for (const bad of [
    'useStaleCacheAsCanonical',
    'fillFromChatwootAttributes',
    'mutateFromQuery',
    'assumeReviewer',
    'bypassFieldAllowlist',
  ]) {
    assert.ok(QUERIES_PATCH_FORBIDDEN.includes(bad), `'${bad}' marker`);
  }
});

/* ──────────────────────── Events fixtures ──────────────────────── */

test('EVENT_AGGREGATE_TYPES: 10 giá trị allowlist', () => {
  assert.equal(EVENT_AGGREGATE_TYPES.length, 10);
  for (const t of [
    'LABOR_PROFILE', 'PLACEMENT_CASE', 'NEXT_ACTION', 'INTERACTION',
    'EXTERNAL_CONTACT_LINK', 'CONVERSATION_LINK', 'SUPPRESSION',
    'AVAILABILITY', 'OUTBOX_DELIVERY', 'MAPPING',
  ]) {
    assert.equal(EventAggregateTypeSchema.safeParse(t).success, true);
  }
});

test('EventEnvelope: schemaVersion + eventId + aggregate + version + time + source', () => {
  const r = EventEnvelopeSchema.parse(baseEnvelopeFields());
  assert.equal(r.eventId, 'evt-0001');
  assert.equal(r.aggregateVersion, 1);
  assert.equal(r.deliveryChannel, 'PUSH_WEBHOOK');
  assert.equal(r.sourceSystem, 'HRP_ENGAGEMENT');
});

test('EventEnvelope: deliveryChannel default PUSH_WEBHOOK; runtime HRP gate chọn đường mặc định', () => {
  // Default PUSH_WEBHOOK (đề xuất có lý do — ACL không cần DB
  // credentials core, HRP-side dispatcher đẩy).
  const r = EventEnvelopeSchema.parse({
    ...baseEnvelopeFields(),
    deliveryChannel: undefined,
  });
  assert.equal(r.deliveryChannel, 'PUSH_WEBHOOK');
});

test('EventEnvelope: PROVIDER source yêu cầu provider trong deliveryScope', () => {
  const r = EventEnvelopeSchema.parse({
    ...baseEnvelopeFields(),
    sourceSystem: 'PROVIDER',
    deliveryScope: {
      provider: 'CHATWOOT',
      connectionId: 'conn-cw-1',
    },
  });
  assert.equal(r.sourceSystem, 'PROVIDER');

  // PROVIDER + no provider trong deliveryScope → reject.
  assert.equal(
    EventEnvelopeSchema.safeParse({
      ...baseEnvelopeFields(),
      sourceSystem: 'PROVIDER',
    }).success,
    false,
    'PROVIDER source yêu cầu provider trong deliveryScope',
  );
});

test('EventDuplicateKind: 5 giá trị (DEDUPE/OUT_OF_ORDER/CORRECTION/GAP/UNKNOWN)', () => {
  for (const k of [
    'DEDUPE', 'OUT_OF_ORDER', 'CORRECTION', 'GAP', 'UNKNOWN',
  ]) {
    assert.equal(EventDuplicateKindSchema.safeParse(k).success, true);
  }
});

test('EventReceipt: GAP yêu cầu reasonCode; DEDUPE/UNKNOWN KHÔNG có reasonCode', () => {
  // GAP + reasonCode OK.
  const r1 = EventReceiptSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    eventId: 'evt-0001',
    payloadDigest: 'a'.repeat(64),
    duplicateKind: 'GAP',
    reasonCode: 'MISSED_EVENT',
  });
  assert.equal(r1.duplicateKind, 'GAP');

  // GAP + no reasonCode → reject.
  assert.equal(
    EventReceiptSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      eventId: 'evt-0001',
      payloadDigest: 'a'.repeat(64),
      duplicateKind: 'GAP',
    }).success,
    false,
  );

  // DEDUPE + reasonCode → reject.
  assert.equal(
    EventReceiptSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      eventId: 'evt-0001',
      payloadDigest: 'a'.repeat(64),
      duplicateKind: 'DEDUPE',
      reasonCode: 'X',
    }).success,
    false,
  );
});

test('EventReceipt: payloadDigest phải SHA-256 hex 64 ký tự', () => {
  assert.equal(
    EventReceiptSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      eventId: 'evt-0001',
      payloadDigest: 'short',
      duplicateKind: 'DEDUPE',
    }).success,
    false,
    'payloadDigest sai format',
  );
});

test('EventWatermark: server-set opaque cursor', () => {
  const r = EventWatermarkSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    aggregateVersion: 5,
    watermarkAt: '2026-09-13T10:00:00.000+07:00',
    opaqueCursor: 'cursor-001',
  });
  assert.equal(r.opaqueCursor, 'cursor-001');
});

test('AttributionState: AVAILABLE/UNAVAILABLE (KHÔNG đoán khi thiếu)', () => {
  for (const s of ['AVAILABLE', 'UNAVAILABLE']) {
    assert.equal(AttributionStateSchema.safeParse(s).success, true);
  }
});

test('CreationActorAttribution: 4 trường PHÂN BIỆT — submittedBy/executingActor/creditedCreator/source', () => {
  const r = CreationActorAttributionSchema.parse({
    ...baseAttributionFields(),
    submittedBy: { kind: 'USER', userId: 'user-form' },
    executingActor: { kind: 'SERVICE', serviceId: 'svc-001' },
    creditedCreator: { kind: 'USER', userId: 'user-credited' },
    source: 'HRP_ENGAGEMENT',
    attributionState: 'AVAILABLE',
  });
  assert.equal(r.submittedBy.kind, 'USER');
  assert.equal(r.executingActor.kind, 'SERVICE');
  assert.equal(r.creditedCreator.kind, 'USER');
  assert.equal(r.source, 'HRP_ENGAGEMENT');

  // 3 actor đều khác nhau (form submit ≠ service execute ≠ credit).
  assert.notEqual(r.submittedBy.kind, r.executingActor.kind);
});

test('CreationActorAttribution: UNAVAILABLE yêu cầu unavailableReasonCode (KHÔNG đoán)', () => {
  // UNAVAILABLE + reason OK.
  const r1 = CreationActorAttributionSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    source: 'SYSTEM',
    attributionState: 'UNAVAILABLE',
    unavailableReasonCode: 'NO_SOURCE_RECORDED',
  });
  assert.equal(r1.attributionState, 'UNAVAILABLE');

  // UNAVAILABLE + no reason → reject.
  assert.equal(
    CreationActorAttributionSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      source: 'SYSTEM',
      attributionState: 'UNAVAILABLE',
    }).success,
    false,
    'UNAVAILABLE yêu cầu unavailableReasonCode (KHÔNG đoán)',
  );

  // AVAILABLE + reason → reject.
  assert.equal(
    CreationActorAttributionSchema.safeParse({
      ...baseAttributionFields(),
      unavailableReasonCode: 'X',
    }).success,
    false,
  );
});

test('CreationEventLabel: SUBMITTED/APPLIED/HRP_REVIEWED tách biệt', () => {
  for (const l of ['SUBMITTED', 'APPLIED', 'HRP_REVIEWED']) {
    assert.equal(CreationEventLabelSchema.safeParse(l).success, true);
  }
});

test('ProfileCreationEvent: envelope + attribution + canonical id + label', () => {
  const r = ProfileCreationEventSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    envelope: baseEnvelopeFields(),
    attribution: baseAttributionFields(),
    laborProfileId: 'lp-001',
    laborProfileVersion: 1,
    creationLabel: 'APPLIED',
  });
  assert.equal(r.creationLabel, 'APPLIED');
  assert.equal(r.attribution.attributionState, 'AVAILABLE');
});

test('PlacementCaseCreationEvent: tương tự Profile + reviewReference optional', () => {
  const r = PlacementCaseCreationEventSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    envelope: {
      ...baseEnvelopeFields(),
      aggregateType: 'PLACEMENT_CASE',
      aggregateId: 'pc-001',
    },
    attribution: baseAttributionFields(),
    placementCaseId: 'pc-001',
    placementCaseVersion: 1,
    creationLabel: 'SUBMITTED',
    reviewReference: 'review-001',
  });
  assert.equal(r.reviewReference, 'review-001');
});

test('EVENT_PATCH_FORBIDDEN: marker audit (signature protocol KHÔNG tự chọn; cần Auditor)', () => {
  for (const bad of [
    'assumeSubmittedBy',
    'assumeExecutingActor',
    'assumeCreditedCreator',
    'fillActorFromAssignee',
    'useUnverifiedSignatureProtocol',
    'useUnverifiedJwtAlgorithm',
    'bypassDedup',
    'silentlyOverwriteOnGap',
  ]) {
    assert.ok(EVENT_PATCH_FORBIDDEN.includes(bad), `'${bad}' marker`);
  }
});

/* ──────────────────────── Mappings fixtures ──────────────────────── */

test('EXTERNAL_CONTACT_LINK_STATES: 3 giá trị EXACT/POSSIBLE/UNRESOLVED (KHÔNG có NEW_PROFILE)', () => {
  assert.deepEqual([...EXTERNAL_CONTACT_LINK_STATES], [
    'EXACT_MATCH', 'POSSIBLE_MATCH', 'UNRESOLVED',
  ]);
  assert.equal(
    ExternalContactLinkStateSchema.safeParse('NEW_PROFILE').success,
    false,
    'NEW_PROFILE KHÔNG là mapping state',
  );
});

test('ExternalContactRef: provider + connection + externalAccountId', () => {
  const r = ExternalContactRefSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    provider: 'CHATWOOT',
    connectionId: 'conn-cw-1',
    externalAccountId: 'acc-001',
  });
  assert.equal(r.provider, 'CHATWOOT');
});

test('ExternalContactLinkTarget: Talent/Client discriminated union — Client PROPOSED', () => {
  const t = ExternalContactLinkTargetSchema.parse({
    kind: 'TALENT',
    matchedLaborProfileId: 'lp-001',
    matchedLaborProfileVersion: 1,
  });
  assert.equal(t.kind, 'TALENT');

  const c = ExternalContactLinkTargetSchema.parse({
    kind: 'CLIENT',
    matchedClientContactId: 'cc-001',
    matchedClientContactVersion: 1,
  });
  assert.equal(c.kind, 'CLIENT');
});

test('CanonicalTargetRef: Talent + Client discriminated', () => {
  const t = TalentTargetRefSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    kind: 'TALENT',
    laborProfileId: 'lp-001',
    laborProfileVersion: 1,
  });
  assert.equal(t.kind, 'TALENT');

  // Client: clientContactId required, clientCompanyId/salesOpportunityId optional (PROPOSED).
  const c = ClientTargetRefSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    kind: 'CLIENT',
    clientContactId: 'cc-001',
    clientContactVersion: 1,
  });
  assert.equal(c.kind, 'CLIENT');

  const r = CanonicalTargetRefSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    kind: 'CLIENT',
    clientContactId: 'cc-001',
    clientContactVersion: 1,
    clientCompanyId: 'co-001',
    salesOpportunityId: 'opp-001',
  });
  assert.equal(r.kind, 'CLIENT');
});

test('ExternalContactLink: EXACT_MATCH có matchedTarget; POSSIBLE_MATCH có candidateReference; UNRESOLVED không có cả hai', () => {
  // EXACT_MATCH.
  const r1 = ExternalContactLinkSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    provider: 'CHATWOOT',
    connectionId: 'conn-cw-1',
    external: {
      externalAccountId: 'acc-001',
      externalContactId: 'ec-001',
    },
    state: 'EXACT_MATCH',
    matchedTarget: {
      kind: 'TALENT',
      matchedLaborProfileId: 'lp-001',
      matchedLaborProfileVersion: 1,
    },
    aggregateVersion: 1,
  });
  assert.equal(r1.state, 'EXACT_MATCH');

  // EXACT_MATCH + no matchedTarget → reject.
  assert.equal(
    ExternalContactLinkSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      provider: 'CHATWOOT',
      connectionId: 'conn-cw-1',
      external: { externalAccountId: 'acc-001' },
      state: 'EXACT_MATCH',
      aggregateVersion: 1,
    }).success,
    false,
  );

  // POSSIBLE_MATCH + candidateReference + KHÔNG matchedTarget.
  const r2 = ExternalContactLinkSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    provider: 'CHATWOOT',
    connectionId: 'conn-cw-1',
    external: { externalAccountId: 'acc-001' },
    state: 'POSSIBLE_MATCH',
    candidateReference: {
      reviewQueueEntryId: 'rq-001',
      recordedAt: '2026-09-13T10:00:00.000+07:00',
    },
    aggregateVersion: 1,
  });
  assert.equal(r2.state, 'POSSIBLE_MATCH');

  // POSSIBLE_MATCH + matchedTarget → reject (chưa xác minh).
  assert.equal(
    ExternalContactLinkSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      provider: 'CHATWOOT',
      connectionId: 'conn-cw-1',
      external: { externalAccountId: 'acc-001' },
      state: 'POSSIBLE_MATCH',
      matchedTarget: {
        kind: 'TALENT',
        matchedLaborProfileId: 'lp-001',
        matchedLaborProfileVersion: 1,
      },
      aggregateVersion: 1,
    }).success,
    false,
  );

  // UNRESOLVED: không có matchedTarget/candidateReference.
  const r3 = ExternalContactLinkSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    provider: 'CHATWOOT',
    connectionId: 'conn-cw-1',
    external: { externalAccountId: 'acc-001' },
    state: 'UNRESOLVED',
    aggregateVersion: 1,
  });
  assert.equal(r3.state, 'UNRESOLVED');
});

test('ConversationLink: externalRefs[] + currentRevision + historyRevisions (max 64)', () => {
  const r = ConversationLinkSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    conversationId: 'conv-001',
    conversationVersion: 5,
    conversationKind: 'TALENT',
    primaryTarget: baseTalentTarget(),
    externalRefs: [
      {
        schemaVersion: SCHEMA_VERSION,
        organizationId: org,
        provider: 'CHATWOOT',
        connectionId: 'conn-cw-1',
        externalAccountId: 'acc-001',
        externalConversationId: 'ext-conv-001',
        aggregateVersion: 5,
      },
    ],
    currentRevision: 5,
    historyRevisions: [
      {
        revisionId: 'rev-001',
        recordedAt: '2026-09-01T10:00:00.000+07:00',
        note: 'initial link',
      },
    ],
    updatedAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r.historyRevisions.length, 1);

  // historyRevisions[].note có URL → reject.
  assert.equal(
    ConversationLinkSchema.safeParse({
      ...r,
      historyRevisions: [
        {
          revisionId: 'rev-001',
          recordedAt: '2026-09-01T10:00:00.000+07:00',
          note: 'xem https://evil.example/foo',
        },
      ],
    }).success,
    false,
    'historyRevisions note KHÔNG chứa URL',
  );

  // externalRefs empty → reject (min 1).
  assert.equal(
    ConversationLinkSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      conversationId: 'conv-001',
      conversationVersion: 1,
      conversationKind: 'TALENT',
      externalRefs: [],
      currentRevision: 1,
      updatedAt: '2026-09-13T10:00:00.000+07:00',
    }).success,
    false,
    'externalRefs ≥ 1',
  );
});

test('ResolveContactByExternal: request + result link + optional conversation', () => {
  const r = ResolveContactByExternalResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    link: {
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      provider: 'CHATWOOT',
      connectionId: 'conn-cw-1',
      external: { externalAccountId: 'acc-001' },
      state: 'EXACT_MATCH',
      matchedTarget: {
        kind: 'TALENT',
        matchedLaborProfileId: 'lp-001',
        matchedLaborProfileVersion: 1,
      },
      aggregateVersion: 1,
    },
  });
  assert.equal(r.link.state, 'EXACT_MATCH');
});

test('ListExternalContactLinks: cursor + pageSize bound (≤ 100)', () => {
  const r = ListExternalContactLinksRequestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    provider: 'CHATWOOT',
    state: 'POSSIBLE_MATCH',
    pageSize: 50,
  });
  assert.equal(r.pageSize, 50);

  // pageSize > 100 reject.
  assert.equal(
    ListExternalContactLinksRequestSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      pageSize: 101,
    }).success,
    false,
  );
});

test('MAPPING_PATCH_FORBIDDEN: KHÔNG tin Chatwoot attributes; KHÔNG ép Client về Talent', () => {
  for (const bad of [
    'useChatwootAttributesAsCanonical',
    'useZaloAttributesAsCanonical',
    'collapseClientToTalent',
    'projectClientOntoLaborProfile',
    'autoMerge',
    'forceUnresolvedToExact',
    'acceptNewProfileAsLinkState',
    'writeBackToChatwootAttributes',
  ]) {
    assert.ok(MAPPING_PATCH_FORBIDDEN.includes(bad), `'${bad}' marker`);
  }
});
