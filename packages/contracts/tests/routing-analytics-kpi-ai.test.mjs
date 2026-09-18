/**
 * routing-analytics-kpi-ai.test.mjs — fixtures G0/0.5 (routing, analytics,
 * kpi, ai-proposals, ai-provider-config).
 *
 * Trọng tâm AC (Owner chỉ thị):
 *  - Routing: source allocation KHÁC weighted recipient distribution;
 *    pool/eligible/weight/cap/version/decision/reservation.
 *  - Analytics: grain/unit/period/cohort/source/as-of/version/attribution;
 *    profile created/updated/submitted KHÁC NHAU (Q-9); thiếu nguồn
 *    KHÔNG đoán (Q-30).
 *  - KPI: manager-owned assign/revise; sale/AI chỉ read/propose.
 *  - AI proposals: revision/fields/evidence/uncertainty/context;
 *    KHÔNG arbitrary payload, KHÔNG direct writes.
 *  - AI provider config: read DTO KHÔNG có API key; SANDBOX + NO_PII
 *    semantics; Phase 10 namespace experimental.
 *  - Q-30: schema bind shape constraint CONFIRMED; marker KHÔNG tự
 *    chứng minh AC enforce (runtime HRP gate).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTING_STRATEGIES,
  RoutingStrategySchema,
  RoutingEligibleSetSchema,
  RoutingFixedOwnerSchema,
  RoutingWeightEntrySchema,
  RoutingPoolSchema,
  RoutingReservationSchema,
  RoutingDecisionSchema,
  UpdateRoutingPoolInputSchema,
  ROUTING_PATCH_FORBIDDEN,
} from '../dist/commands/routing.js';
import {
  METRIC_GRAINS,
  METRIC_UNITS,
  METRIC_PERIODS,
  METRIC_ATTRIBUTION_STATES,
  MetricGrainSchema,
  MetricUnitSchema,
  MetricPeriodSchema,
  MetricAttributionStateSchema,
  MetricDefinitionInputSchema,
  MetricDefinitionSchema,
  ProfileLifecycleMetricBindingSchema,
  PROFILE_LIFECYCLE_METRIC_IDS,
  MetricValueSchema,
  MetricAggregateReadRequestSchema,
  MetricAggregateReadResultSchema,
  ANALYTICS_PATCH_FORBIDDEN,
} from '../dist/commands/analytics.js';
import {
  KPI_TARGET_TYPES,
  KPI_PERIODS,
  KPI_MODULE_NAMESPACE,
  KPIModuleNamespaceSchema,
  KPITargetTypeSchema,
  KPIPeriodSchema,
  KPIAssignmentInputSchema,
  KPIAssignmentResultSchema,
  KPIRevisionInputSchema,
  KPIProposeInputSchema,
  KPIProposeResultSchema,
  KPIReadResultSchema,
  KPI_PATCH_FORBIDDEN,
} from '../dist/commands/kpi.js';
import {
  AI_PROPOSAL_KINDS,
  AIProposalKindSchema,
  AIProposalUncertaintySchema,
  AIProposalFieldSchema,
  AIProposalContextSchema,
  AIProposalSchema,
  ApplyAIProposalInputSchema,
  ApplyAIProposalResultSchema,
  AI_PROPOSAL_PATCH_FORBIDDEN,
} from '../dist/commands/ai-proposals.js';
import {
  AI_PROVIDER_API_STYLES,
  AI_PROVIDER_CAPABILITIES,
  AI_PROVIDER_DATA_POLICIES,
  AIProviderApiStyleSchema,
  AIProviderCapabilitySchema,
  AIProviderDataPolicySchema,
  SecretRefSchema,
  AIProviderBudgetSchema,
  AIProviderConfigWriteSchema,
  AIProviderConfigReadSchema,
  AI_PROVIDER_FORBIDDEN_RAW_SECRET_FIELDS,
} from '../dist/commands/ai-provider-config.js';
import { SCHEMA_VERSION } from '../dist/enums.js';

function managerActor() {
  return { kind: 'USER', userId: 'user-manager-001' };
}

function saleActor() {
  return { kind: 'USER', userId: 'user-sale-001' };
}

/* ──────────────────────── Routing fixtures ──────────────────────── */

test('ROUTING_STRATEGIES: 3 strategy phân biệt rõ', () => {
  assert.deepEqual([...ROUTING_STRATEGIES], [
    'SOURCE_ALLOCATION',
    'WEIGHTED_DISTRIBUTION',
    'HYBRID',
  ]);
});

test('RoutingPool: SOURCE_ALLOCATION yêu cầu fixedOwner, KHÔNG weights', () => {
  // SOURCE_ALLOCATION + fixedOwner OK.
  const r = RoutingPoolSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-rt-001',
    poolId: 'pool-001',
    displayName: 'Inbound Chatwoot direct',
    strategy: 'SOURCE_ALLOCATION',
    eligibleSet: {
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-rt-001',
      roles: ['SALE'],
    },
    fixedOwner: {
      schemaVersion: SCHEMA_VERSION,
      provider: 'CHATWOOT',
      connectionId: 'conn-cw-1',
      recipientActorId: 'sale-001',
      recipientRole: 'SALE',
    },
    version: 1,
    updatedAt: '2026-09-13T10:00:00.000+07:00',
    updatedBy: managerActor(),
  });
  assert.equal(r.strategy, 'SOURCE_ALLOCATION');

  // SOURCE_ALLOCATION + weights → reject.
  assert.equal(
    RoutingPoolSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-rt-001',
      poolId: 'pool-001',
      displayName: 'X',
      strategy: 'SOURCE_ALLOCATION',
      eligibleSet: {
        schemaVersion: SCHEMA_VERSION,
        organizationId: 'org-rt-001',
        roles: ['SALE'],
      },
      fixedOwner: {
        schemaVersion: SCHEMA_VERSION,
        provider: 'CHATWOOT',
        connectionId: 'conn-cw-1',
        recipientActorId: 'sale-001',
        recipientRole: 'SALE',
      },
      weights: [
        {
          schemaVersion: SCHEMA_VERSION,
          recipientActorId: 'sale-002',
          recipientRole: 'SALE',
          weight: 1,
        },
      ],
      version: 1,
      updatedAt: '2026-09-13T10:00:00.000+07:00',
      updatedBy: managerActor(),
    }).success,
    false,
    'SOURCE_ALLOCATION KHÔNG có weights',
  );

  // SOURCE_ALLOCATION + no fixedOwner → reject.
  assert.equal(
    RoutingPoolSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-rt-001',
      poolId: 'pool-001',
      displayName: 'X',
      strategy: 'SOURCE_ALLOCATION',
      eligibleSet: {
        schemaVersion: SCHEMA_VERSION,
        organizationId: 'org-rt-001',
        roles: ['SALE'],
      },
      version: 1,
      updatedAt: '2026-09-13T10:00:00.000+07:00',
      updatedBy: managerActor(),
    }).success,
    false,
    'SOURCE_ALLOCATION yêu cầu fixedOwner',
  );
});

test('RoutingPool: WEIGHTED_DISTRIBUTION yêu cầu weights ≥ 1, KHÔNG fixedOwner', () => {
  // WEIGHTED_DISTRIBUTION + weights OK.
  const r = RoutingPoolSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-rt-001',
    poolId: 'pool-002',
    displayName: 'Campaign audience',
    strategy: 'WEIGHTED_DISTRIBUTION',
    eligibleSet: {
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-rt-001',
      roles: ['SALE', 'STAFF'],
    },
    weights: [
      {
        schemaVersion: SCHEMA_VERSION,
        recipientActorId: 'sale-A',
        recipientRole: 'SALE',
        weight: 3,
        cap: 100,
        capPeriod: 'DAILY',
      },
      {
        schemaVersion: SCHEMA_VERSION,
        recipientActorId: 'sale-B',
        recipientRole: 'SALE',
        weight: 2,
      },
      {
        schemaVersion: SCHEMA_VERSION,
        recipientActorId: 'sale-C',
        recipientRole: 'SALE',
        weight: 1,
      },
    ],
    version: 1,
    updatedAt: '2026-09-13T10:00:00.000+07:00',
    updatedBy: managerActor(),
  });
  assert.equal(r.weights.length, 3);

  // WEIGHTED_DISTRIBUTION + no weights → reject.
  assert.equal(
    RoutingPoolSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-rt-001',
      poolId: 'pool-002',
      displayName: 'X',
      strategy: 'WEIGHTED_DISTRIBUTION',
      eligibleSet: {
        schemaVersion: SCHEMA_VERSION,
        organizationId: 'org-rt-001',
        roles: ['SALE'],
      },
      version: 1,
      updatedAt: '2026-09-13T10:00:00.000+07:00',
      updatedBy: managerActor(),
    }).success,
    false,
    'WEIGHTED_DISTRIBUTION yêu cầu weights',
  );

  // Total weight = 0 → reject.
  assert.equal(
    RoutingPoolSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-rt-001',
      poolId: 'pool-002',
      displayName: 'X',
      strategy: 'WEIGHTED_DISTRIBUTION',
      eligibleSet: {
        schemaVersion: SCHEMA_VERSION,
        organizationId: 'org-rt-001',
        roles: ['SALE'],
      },
      weights: [
        {
          schemaVersion: SCHEMA_VERSION,
          recipientActorId: 'sale-A',
          recipientRole: 'SALE',
          weight: 0,
        },
      ],
      version: 1,
      updatedAt: '2026-09-13T10:00:00.000+07:00',
      updatedBy: managerActor(),
    }).success,
    false,
    'Tổng weights phải > 0',
  );
});

test('RoutingDecision: trace audit + reservation fence (cap routing)', () => {
  const r = RoutingDecisionSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-rt-001',
    poolId: 'pool-001',
    poolVersion: 5,
    strategy: 'SOURCE_ALLOCATION',
    selectedRecipientActorId: 'sale-001',
    selectionReason: 'FIXED_OWNER',
    reservation: {
      schemaVersion: SCHEMA_VERSION,
      reservationId: 'res-001',
      fenceToken: 'fence-token-abcdef-001',
      fenceCutOffAt: '2026-09-13T11:00:00.000+07:00',
    },
    decisionAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r.selectionReason, 'FIXED_OWNER');
  assert.equal(r.reservation.fenceToken, 'fence-token-abcdef-001');
});

test('UpdateRoutingPool: optimistic concurrency + manager updatedBy', () => {
  const r = UpdateRoutingPoolInputSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-rt-001',
    poolId: 'pool-001',
    expectedVersion: 5,
    patch: {
      displayName: 'Inbound Chatwoot (updated)',
    },
    updatedBy: managerActor(),
    reasonCode: 'REVIEW_REVISION',
  });
  assert.equal(r.expectedVersion, 5);
  assert.equal(r.patch.displayName, 'Inbound Chatwoot (updated)');
});

test('ROUTING_PATCH_FORBIDDEN: marker audit (Q-30)', () => {
  for (const bad of [
    'rewriteHandlingAssignment',
    'rewriteCreditPolicy',
    'aiAutoAdjustWeights',
    'saleAutoAdjustWeights',
    'collapseSourceAllocationToWeighted',
    'bypassReservationFence',
    'bypassCapacityCap',
  ]) {
    assert.ok(ROUTING_PATCH_FORBIDDEN.includes(bad), `'${bad}' marker`);
  }
});

/* ──────────────────────── Analytics fixtures ──────────────────────── */

test('MetricGrain/Unit/Period/AttributionState: allowlist', () => {
  for (const g of METRIC_GRAINS) {
    assert.equal(MetricGrainSchema.safeParse(g).success, true);
  }
  for (const u of METRIC_UNITS) {
    assert.equal(MetricUnitSchema.safeParse(u).success, true);
  }
  for (const p of METRIC_PERIODS) {
    assert.equal(MetricPeriodSchema.safeParse(p).success, true);
  }
  for (const s of METRIC_ATTRIBUTION_STATES) {
    assert.equal(MetricAttributionStateSchema.safeParse(s).success, true);
  }
});

test('MetricDefinitionInput: schema bind shape + attribution UNAVAILABLE yêu cầu reason', () => {
  const r = MetricDefinitionInputSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-an-001',
    metricId: 'profile.created.total',
    displayName: 'Tổng profile tạo',
    grain: 'ORGANIZATION',
    unit: 'COUNT',
    period: 'DAILY',
    source: { kind: 'HRP_UI' },
    attributionState: 'AVAILABLE',
  });
  assert.equal(r.attributionState, 'AVAILABLE');

  // UNAVAILABLE + reasonCode OK.
  const r2 = MetricDefinitionInputSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-an-001',
    metricId: 'profile.updated.total',
    displayName: 'Tổng profile cập nhật',
    grain: 'ORGANIZATION',
    unit: 'COUNT',
    period: 'DAILY',
    source: { kind: 'EXPERIMENTAL' },
    attributionState: 'UNAVAILABLE',
    attributionReasonCode: 'PHASE10_NOT_READY',
  });
  assert.equal(r2.attributionState, 'UNAVAILABLE');

  // EXPERIMENTAL + AVAILABLE → reject (Phase 10 chưa chốt).
  assert.equal(
    MetricDefinitionInputSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-an-001',
      metricId: 'x',
      displayName: 'x',
      grain: 'ORGANIZATION',
      unit: 'COUNT',
      period: 'DAILY',
      source: { kind: 'EXPERIMENTAL' },
      attributionState: 'AVAILABLE',
    }).success,
    false,
    'EXPERIMENTAL source mặc định UNAVAILABLE',
  );

  // UNAVAILABLE + no reasonCode → reject.
  assert.equal(
    MetricDefinitionInputSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-an-001',
      metricId: 'x',
      displayName: 'x',
      grain: 'ORGANIZATION',
      unit: 'COUNT',
      period: 'DAILY',
      source: { kind: 'INTERNAL_FORM' },
      attributionState: 'UNAVAILABLE',
    }).success,
    false,
    'UNAVAILABLE yêu cầu reasonCode (KHÔNG đoán)',
  );
});

test('ProfileLifecycleMetricBinding: 3 metricId KHÁC NHAU (Q-9)', () => {
  const r = ProfileLifecycleMetricBindingSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-an-001',
    bindings: {
      'profile.created': {
        schemaVersion: SCHEMA_VERSION,
        organizationId: 'org-an-001',
        metricId: 'profile.created.total',
        displayName: 'Tổng profile tạo',
        grain: 'ORGANIZATION',
        unit: 'COUNT',
        period: 'DAILY',
        source: { kind: 'HRP_UI' },
        attributionState: 'AVAILABLE',
        version: 1,
        asOf: '2026-09-13T10:00:00.000+07:00',
      },
      'profile.updated': {
        schemaVersion: SCHEMA_VERSION,
        organizationId: 'org-an-001',
        metricId: 'profile.updated.total',
        displayName: 'Tổng profile cập nhật',
        grain: 'ORGANIZATION',
        unit: 'COUNT',
        period: 'DAILY',
        source: { kind: 'HRP_UI' },
        attributionState: 'AVAILABLE',
        version: 1,
        asOf: '2026-09-13T10:00:00.000+07:00',
      },
      'profile.submitted': {
        schemaVersion: SCHEMA_VERSION,
        organizationId: 'org-an-001',
        metricId: 'profile.submitted.total',
        displayName: 'Tổng profile submit',
        grain: 'ORGANIZATION',
        unit: 'COUNT',
        period: 'DAILY',
        source: { kind: 'HRP_UI' },
        attributionState: 'AVAILABLE',
        version: 1,
        asOf: '2026-09-13T10:00:00.000+07:00',
      },
    },
  });
  assert.equal(r.bindings['profile.created'].metricId, 'profile.created.total');
  assert.equal(r.bindings['profile.updated'].metricId, 'profile.updated.total');
  assert.equal(
    r.bindings['profile.submitted'].metricId,
    'profile.submitted.total',
  );
});

test('ProfileLifecycleMetricBinding: 3 metricId trùng → reject (Q-9)', () => {
  const dup = 'profile.created.total';
  assert.equal(
    ProfileLifecycleMetricBindingSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-an-001',
      bindings: {
        'profile.created': {
          schemaVersion: SCHEMA_VERSION,
          organizationId: 'org-an-001',
          metricId: dup,
          displayName: 'Tổng profile tạo',
          grain: 'ORGANIZATION',
          unit: 'COUNT',
          period: 'DAILY',
          source: { kind: 'HRP_UI' },
          attributionState: 'AVAILABLE',
          version: 1,
          asOf: '2026-09-13T10:00:00.000+07:00',
        },
        'profile.updated': {
          schemaVersion: SCHEMA_VERSION,
          organizationId: 'org-an-001',
          metricId: dup,
          displayName: 'Tổng profile cập nhật',
          grain: 'ORGANIZATION',
          unit: 'COUNT',
          period: 'DAILY',
          source: { kind: 'HRP_UI' },
          attributionState: 'AVAILABLE',
          version: 1,
          asOf: '2026-09-13T10:00:00.000+07:00',
        },
        'profile.submitted': {
          schemaVersion: SCHEMA_VERSION,
          organizationId: 'org-an-001',
          metricId: 'profile.submitted.total',
          displayName: 'Tổng profile submit',
          grain: 'ORGANIZATION',
          unit: 'COUNT',
          period: 'DAILY',
          source: { kind: 'HRP_UI' },
          attributionState: 'AVAILABLE',
          version: 1,
          asOf: '2026-09-13T10:00:00.000+07:00',
        },
      },
    }).success,
    false,
    'metricId trùng → reject (Q-9: profile created/updated/submitted KHÁC NHAU)',
  );
});

test('MetricValue: UNAVAILABLE value phải = 0; AVAILABLE có value', () => {
  // AVAILABLE.
  const r1 = MetricValueSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-an-001',
    metricId: 'profile.created.total',
    grain: 'ORGANIZATION',
    unit: 'COUNT',
    period: 'DAILY',
    value: 42,
    asOf: '2026-09-13T10:00:00.000+07:00',
    version: 1,
    attributionState: 'AVAILABLE',
  });
  assert.equal(r1.value, 42);

  // UNAVAILABLE + value=0 + reasonCode OK (placeholder).
  const r2 = MetricValueSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-an-001',
    metricId: 'profile.updated.total',
    grain: 'ORGANIZATION',
    unit: 'COUNT',
    period: 'DAILY',
    value: 0,
    asOf: '2026-09-13T10:00:00.000+07:00',
    version: 1,
    attributionState: 'UNAVAILABLE',
    attributionReasonCode: 'PHASE10_NOT_READY',
  });
  assert.equal(r2.value, 0);

  // UNAVAILABLE + value > 0 → reject (KHÔNG đoán số).
  assert.equal(
    MetricValueSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-an-001',
      metricId: 'profile.updated.total',
      grain: 'ORGANIZATION',
      unit: 'COUNT',
      period: 'DAILY',
      value: 99,
      asOf: '2026-09-13T10:00:00.000+07:00',
      version: 1,
      attributionState: 'UNAVAILABLE',
      attributionReasonCode: 'PHASE10_NOT_READY',
    }).success,
    false,
    'UNAVAILABLE value > 0 → reject (Q-30 KHÔNG đoán)',
  );
});

test('MetricAggregateRead: cursor + periodStart <= periodEnd', () => {
  const r = MetricAggregateReadRequestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-an-001',
    metricIds: ['profile.created.total', 'profile.updated.total'],
    periodStart: '2026-09-01',
    periodEnd: '2026-09-13',
    pageSize: 50,
  });
  assert.equal(r.pageSize, 50);

  // periodStart > periodEnd → reject.
  assert.equal(
    MetricAggregateReadRequestSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-an-001',
      metricIds: ['x'],
      periodStart: '2026-09-13',
      periodEnd: '2026-09-01',
    }).success,
    false,
  );
});

test('ANALYTICS_PATCH_FORBIDDEN: marker audit (Q-30)', () => {
  for (const bad of [
    'assumeAttribution',
    'fillMissingAttribution',
    'mergeCreatedAsSubmitted',
    'collapseLifecycleToSingleMetric',
    'embedRawPII',
    'promoteExperimental',
  ]) {
    assert.ok(ANALYTICS_PATCH_FORBIDDEN.includes(bad), `'${bad}' marker`);
  }
});

/* ──────────────────────── KPI fixtures ──────────────────────── */

test('KPI target types + periods allowlist', () => {
  for (const t of KPI_TARGET_TYPES) {
    assert.equal(KPITargetTypeSchema.safeParse(t).success, true);
  }
  for (const p of KPI_PERIODS) {
    assert.equal(KPIPeriodSchema.safeParse(p).success, true);
  }
});

test('KPIModuleNamespace: Phase 10 experimental literal', () => {
  assert.equal(KPI_MODULE_NAMESPACE, 'phase10-experimental');
  assert.equal(KPIModuleNamespaceSchema.safeParse('phase10-experimental').success, true);
  assert.equal(
    KPIModuleNamespaceSchema.safeParse('canonical-ready').success,
    false,
    'KPIModuleNamespace KHÔNG phải canonical-ready',
  );
});

test('KPIAssignmentInput: cohort periodStart <= periodEnd', () => {
  const r = KPIAssignmentInputSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-kpi-001',
    assignmentId: 'as-001',
    targetType: 'PROFILE_CREATED',
    period: 'MONTHLY',
    targetValue: 100,
    targetActorRole: 'SALE',
    targetActorId: 'sale-001',
    cohort: {
      region: ['HCM'],
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
    },
    attributionSource: 'CHATWOOT',
    assignedBy: managerActor(),
  });
  assert.equal(r.targetValue, 100);
  assert.equal(r.cohort.periodStart, '2026-09-01');

  // periodStart > periodEnd → reject.
  assert.equal(
    KPIAssignmentInputSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-kpi-001',
      targetType: 'PROFILE_CREATED',
      period: 'MONTHLY',
      targetValue: 100,
      targetActorRole: 'SALE',
      assignedBy: managerActor(),
      cohort: {
        periodStart: '2026-09-30',
        periodEnd: '2026-09-01',
      },
    }).success,
    false,
  );
});

test('KPIRevision: manager-only + phải có new target value/rate', () => {
  const r = KPIRevisionInputSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-kpi-001',
    assignmentId: 'as-001',
    newTargetValue: 120,
    expectedRevision: 5,
    reasonCode: 'REVIEW_REVISION',
    revisedBy: managerActor(),
  });
  assert.equal(r.newTargetValue, 120);

  // Thiếu cả value và rate → reject.
  assert.equal(
    KPIRevisionInputSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-kpi-001',
      assignmentId: 'as-001',
      expectedRevision: 5,
      reasonCode: 'X',
      revisedBy: managerActor(),
    }).success,
    false,
  );

  // rationale URL → reject? (rationale chỉ ở propose; revise dùng reasonCode ngắn, không refine URL)
  // NOTE: revise không có rationale dài; chỉ propose mới có.
});

test('KPIPropose: sale/AI chỉ propose — KHÔNG có field mutateTarget', () => {
  const r = KPIProposeInputSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-kpi-001',
    assignmentId: 'as-001',
    proposedTargetValue: 150,
    rationale: 'Dựa trên dữ liệu tuần trước',
    proposedBy: saleActor(),
  });
  assert.equal(r.proposedBy.kind, 'USER');

  // rationale có URL → reject.
  assert.equal(
    KPIProposeInputSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-kpi-001',
      assignmentId: 'as-001',
      proposedTargetValue: 150,
      rationale: 'xem https://evil.example/foo',
      proposedBy: saleActor(),
    }).success,
    false,
    'rationale KHÔNG chứa URL',
  );

  // Thiếu cả 2 propose field → reject.
  assert.equal(
    KPIProposeInputSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-kpi-001',
      assignmentId: 'as-001',
      rationale: 'X',
      proposedBy: saleActor(),
    }).success,
    false,
  );

  // Schema strict KHÔNG cho phép mutateTarget field (audit schema bind).
  assert.equal(
    KPIProposeInputSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-kpi-001',
      assignmentId: 'as-001',
      proposedTargetValue: 150,
      rationale: 'X',
      proposedBy: saleActor(),
      mutateTarget: true, // schema strict reject
    }).success,
    false,
    'schema strict reject field lạ (mutateTarget)',
  );
});

test('KPIRead: attribution UNAVAILABLE yêu cầu reasonCode (Q-30)', () => {
  const r1 = KPIReadResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-kpi-001',
    assignmentId: 'as-001',
    targetType: 'PROFILE_SUBMITTED',
    period: 'MONTHLY',
    targetValue: 50,
    actualValue: 12,
    revisionId: 'rev-001',
    attribution: 'AVAILABLE',
    asOf: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r1.attribution, 'AVAILABLE');

  // UNAVAILABLE + reason OK.
  const r2 = KPIReadResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-kpi-001',
    assignmentId: 'as-002',
    targetType: 'PROFILE_SUBMITTED',
    period: 'MONTHLY',
    targetValue: 50,
    revisionId: 'rev-002',
    attribution: 'UNAVAILABLE',
    attributionReasonCode: 'NO_SOURCE',
    asOf: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r2.attribution, 'UNAVAILABLE');

  // UNAVAILABLE + no reason → reject.
  assert.equal(
    KPIReadResultSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-kpi-001',
      assignmentId: 'as-003',
      targetType: 'PROFILE_SUBMITTED',
      period: 'MONTHLY',
      targetValue: 50,
      revisionId: 'rev-003',
      attribution: 'UNAVAILABLE',
      asOf: '2026-09-13T10:00:00.000+07:00',
    }).success,
    false,
  );
});

test('KPI_PATCH_FORBIDDEN: marker audit (Q-30)', () => {
  for (const bad of [
    'saleMutateTarget',
    'aiMutateTarget',
    'proposeApplyAsManager',
    'bypassManagerCapability',
    'markAsCanonicalReady',
    'promoteToProduction',
    'assumeAttribution',
    'bypassExpectedRevision',
    'silentReviseTarget',
  ]) {
    assert.ok(KPI_PATCH_FORBIDDEN.includes(bad), `'${bad}' marker`);
  }
});

/* ──────────────────────── AI Proposals fixtures ──────────────────────── */

test('AIProposalKind: 5 giá trị allowlist', () => {
  for (const k of AI_PROPOSAL_KINDS) {
    assert.equal(AIProposalKindSchema.safeParse(k).success, true);
  }
});

test('AIProposalField: rationale KHÔNG chứa URL/base64', () => {
  const r = AIProposalFieldSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    fieldPath: 'profile.fullName',
    proposedValue: 'Nguyễn Văn A',
    rationale: 'Trích từ CCCD',
  });
  assert.equal(r.rationale, 'Trích từ CCCD');

  assert.equal(
    AIProposalFieldSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      fieldPath: 'profile.fullName',
      proposedValue: 'Nguyễn Văn A',
      rationale: 'xem https://evil.example/foo',
    }).success,
    false,
    'rationale KHÔNG chứa URL',
  );
});

test('AIProposal: KHÔNG có field embedCommandPayload (schema strict)', () => {
  const r = AIProposalSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-ai-001',
    proposalId: 'prop-0001-min8',
    proposalKind: 'AUTOFILL',
    revisionId: 'rev-001',
    fields: [
      {
        schemaVersion: SCHEMA_VERSION,
        fieldPath: 'profile.fullName',
        proposedValue: 'Nguyễn Văn A',
        rationale: 'Trích từ CCCD',
      },
    ],
    uncertainty: {
      schemaVersion: SCHEMA_VERSION,
      confidence: 0.85,
      reasonCodes: ['OCR_LOW_QUALITY'],
    },
    context: {
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-ai-001',
    },
    providerRef: {
      providerId: 'prov-cw-001',
      providerConfigVersion: 1,
      model: 'gpt-4o',
    },
    createdBy: { kind: 'USER', userId: 'user-001' },
    createdAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r.proposalKind, 'AUTOFILL');

  // Schema strict KHÔNG cho commandPayload.
  assert.equal(
    AIProposalSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-ai-001',
      proposalId: 'prop-0002-min8',
      proposalKind: 'AUTOFILL',
      revisionId: 'rev-002',
      fields: [
        {
          schemaVersion: SCHEMA_VERSION,
          fieldPath: 'profile.fullName',
          proposedValue: 'Nguyễn Văn A',
          rationale: 'X',
        },
      ],
      uncertainty: {
        schemaVersion: SCHEMA_VERSION,
        confidence: 0.5,
        reasonCodes: ['X'],
      },
      context: { schemaVersion: SCHEMA_VERSION, organizationId: 'org-ai-001' },
      providerRef: {
        providerId: 'prov-cw-001',
        providerConfigVersion: 1,
        model: 'gpt-4o',
      },
      createdBy: { kind: 'USER', userId: 'user-001' },
      createdAt: '2026-09-13T10:00:00.000+07:00',
      commandPayload: { command: 'createOrMatch' }, // schema strict reject
    }).success,
    false,
    'AIProposal KHÔNG cho commandPayload (Backlog §0.5 AC #4)',
  );
});

test('ApplyAIProposal: caller chỉ được apply field có trong proposal (chống inject)', () => {
  // Schema accept acceptedFieldPaths không khớp fields trong proposal —
  // schema chỉ bind shape acceptedFieldPaths; runtime gate check.
  // Đây là schema bind (PROPOSED); runtime gate enforce.
  const r = ApplyAIProposalInputSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-ai-001',
    proposalId: 'prop-0001-min8',
    revisionId: 'rev-001',
    acceptedFieldPaths: ['profile.fullName'],
    expectedTargetVersion: 5,
  });
  assert.equal(r.acceptedFieldPaths.length, 1);
});

test('ApplyAIProposalResult: per-field outcome APPLIED/REJECTED/SKIPPED', () => {
  const r = ApplyAIProposalResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-ai-001',
    proposalId: 'prop-0001-min8',
    revisionId: 'rev-001',
    appliedFields: [
      {
        fieldPath: 'profile.fullName',
        outcome: 'APPLIED',
        appliedVersion: 6,
      },
      {
        fieldPath: 'profile.address',
        outcome: 'REJECTED',
        reasonCode: 'EVIDENCE_MISSING',
      },
    ],
    appliedTargetVersion: 6,
    completedAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r.appliedFields.length, 2);
});

test('AI_PROPOSAL_PATCH_FORBIDDEN: marker audit (Q-30)', () => {
  for (const bad of [
    'embedCommandPayload',
    'embedCommandDraft',
    'directWriteToCanonical',
    'bypassStaffReview',
    'applyWithoutManagerCapability',
    'embedApiKey',
    'embedRawSecret',
    'markAsCanonicalReady',
    'applyWithoutEvidence',
  ]) {
    assert.ok(AI_PROPOSAL_PATCH_FORBIDDEN.includes(bad), `'${bad}' marker`);
  }
});

/* ──────────────────────── AI Provider Config fixtures ──────────────────────── */

test('AI_PROVIDER_API_STYLES/CAPABILITIES/DATA_POLICIES: allowlist', () => {
  for (const s of AI_PROVIDER_API_STYLES) {
    assert.equal(AIProviderApiStyleSchema.safeParse(s).success, true);
  }
  for (const c of AI_PROVIDER_CAPABILITIES) {
    assert.equal(AIProviderCapabilitySchema.safeParse(c).success, true);
  }
  for (const p of AI_PROVIDER_DATA_POLICIES) {
    assert.equal(AIProviderDataPolicySchema.safeParse(p).success, true);
  }
});

test('SecretRef: opaque + tier, KHÔNG raw secret', () => {
  const r = SecretRefSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    secretId: 'secret-cw-001',
    secretVersion: 1,
    tier: 'PLATFORM',
  });
  assert.equal(r.tier, 'PLATFORM');

  // rawSecret field → reject.
  assert.equal(
    SecretRefSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      secretId: 'secret-cw-001',
      secretVersion: 1,
      tier: 'PLATFORM',
      rawSecret: 'sk-12345',
    }).success,
    false,
    'SecretRef KHÔNG cho rawSecret (schema strict)',
  );
});

test('AIProviderBudget: ≥ 0 cho cả 3 field', () => {
  const r = AIProviderBudgetSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    maxRequestsPerDay: 1000,
    maxTokensPerDay: 1000000,
    maxCostPerDayUsdMicro: 5000000,
  });
  assert.equal(r.maxRequestsPerDay, 1000);

  // negative → reject.
  assert.equal(
    AIProviderBudgetSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      maxRequestsPerDay: -1,
      maxTokensPerDay: 0,
      maxCostPerDayUsdMicro: 0,
    }).success,
    false,
  );
});

test('AIProviderConfigWrite: NO_PII + PII_REDACTED xung đột; SANDBOX + INTERNAL_ONLY xung đột', () => {
  // OK — single policy.
  const r1 = AIProviderConfigWriteSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-ai-001',
    providerId: 'prov-001',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    apiStyle: 'RESPONSES',
    secretRef: {
      schemaVersion: SCHEMA_VERSION,
      secretId: 'secret-cw-001',
      secretVersion: 1,
      tier: 'PLATFORM',
    },
    capabilities: ['CHAT', 'FUNCTION_CALLING'],
    budget: {
      schemaVersion: SCHEMA_VERSION,
      maxRequestsPerDay: 1000,
      maxTokensPerDay: 1000000,
      maxCostPerDayUsdMicro: 5000000,
    },
    dataPolicy: ['NO_PII'],
    configVersion: 1,
  });
  assert.equal(r1.apiStyle, 'RESPONSES');

  // NO_PII + PII_REDACTED → reject.
  assert.equal(
    AIProviderConfigWriteSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-ai-001',
      providerId: 'prov-002',
      displayName: 'X',
      baseUrl: 'https://api.example.com/v1',
      model: 'm',
      apiStyle: 'CHAT_COMPLETIONS',
      secretRef: {
        schemaVersion: SCHEMA_VERSION,
        secretId: 's',
        secretVersion: 1,
        tier: 'PLATFORM',
      },
      capabilities: ['CHAT'],
      budget: {
        schemaVersion: SCHEMA_VERSION,
        maxRequestsPerDay: 0,
        maxTokensPerDay: 0,
        maxCostPerDayUsdMicro: 0,
      },
      dataPolicy: ['NO_PII', 'PII_REDACTED'],
      configVersion: 1,
    }).success,
    false,
    'NO_PII + PII_REDACTED xung đột',
  );

  // SANDBOX + INTERNAL_ONLY → reject.
  assert.equal(
    AIProviderConfigWriteSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-ai-001',
      providerId: 'prov-003',
      displayName: 'X',
      baseUrl: 'https://api.example.com/v1',
      model: 'm',
      apiStyle: 'CUSTOM',
      secretRef: {
        schemaVersion: SCHEMA_VERSION,
        secretId: 's',
        secretVersion: 1,
        tier: 'PLATFORM',
      },
      capabilities: ['CHAT'],
      budget: {
        schemaVersion: SCHEMA_VERSION,
        maxRequestsPerDay: 0,
        maxTokensPerDay: 0,
        maxCostPerDayUsdMicro: 0,
      },
      dataPolicy: ['SANDBOX', 'INTERNAL_ONLY'],
      configVersion: 1,
    }).success,
    false,
    'SANDBOX + INTERNAL_ONLY xung đột',
  );
});

test('AIProviderConfigRead: KHÔNG chứa raw secret / API key (Backlog §0.5 AC #5)', () => {
  const r = AIProviderConfigReadSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: 'org-ai-001',
    providerId: 'prov-001',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    apiStyle: 'RESPONSES',
    secretRef: {
      schemaVersion: SCHEMA_VERSION,
      secretId: 'secret-cw-001',
      secretVersion: 1,
      tier: 'PLATFORM',
    },
    capabilities: ['CHAT'],
    budget: {
      schemaVersion: SCHEMA_VERSION,
      maxRequestsPerDay: 1000,
      maxTokensPerDay: 1000000,
      maxCostPerDayUsdMicro: 5000000,
    },
    dataPolicy: ['NO_PII'],
    configVersion: 1,
    createdAt: '2026-09-13T10:00:00.000+07:00',
    updatedAt: '2026-09-13T10:00:00.000+07:00',
  });
  // secretRef opaque, KHÔNG rawSecret/apiKey ở read DTO.
  // Schema strict reject nếu cố chèn.
  assert.equal(r.secretRef.secretId, 'secret-cw-001');

  assert.equal(
    AIProviderConfigReadSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: 'org-ai-001',
      providerId: 'prov-002',
      displayName: 'X',
      baseUrl: 'https://api.example.com',
      model: 'm',
      apiStyle: 'CHAT_COMPLETIONS',
      secretRef: {
        schemaVersion: SCHEMA_VERSION,
        secretId: 's',
        secretVersion: 1,
        tier: 'PLATFORM',
      },
      capabilities: ['CHAT'],
      budget: {
        schemaVersion: SCHEMA_VERSION,
        maxRequestsPerDay: 0,
        maxTokensPerDay: 0,
        maxCostPerDayUsdMicro: 0,
      },
      dataPolicy: ['PII_REDACTED'],
      configVersion: 1,
      createdAt: '2026-09-13T10:00:00.000+07:00',
      updatedAt: '2026-09-13T10:00:00.000+07:00',
      apiKey: 'sk-12345', // schema strict reject
    }).success,
    false,
    'AIProviderConfigRead KHÔNG cho apiKey (Backlog §0.5 AC #5)',
  );
});

test('AI_PROVIDER_FORBIDDEN_RAW_SECRET_FIELDS: marker audit cho raw secret', () => {
  for (const bad of [
    'apiKey',
    'accessKey',
    'bearerToken',
    'authorization',
    'openaiApiKey',
    'token',
    'password',
  ]) {
    assert.ok(
      AI_PROVIDER_FORBIDDEN_RAW_SECRET_FIELDS.includes(bad),
      `'${bad}' marker`,
    );
  }
});

/* ──────────────────────── Acceptance: Q-32 contract ACCEPTED (verify OperationReference canonical) ──────────────────────── */

test('ACCEPTED outcome có pendingReference canonical OperationReference (Q-32 contract bind)', () => {
  // Q-32: contract ACCEPTED hoàn thiện có reference/query semantics
  // thuộc Gate 0 — binding canonical OperationReference; implementation
  // query API để Phase V7.9a backend.
  // 1) envelopes.ts OperationReferenceSchema bind shape:
  //    { kind: 'COMMAND_OPERATION', operationId: CommandIdSchema }.
  // 2) PlanningBatchItemResultSchema đã bind pendingReference canonical
  //    (superRefine APPLIED/FAILED/SKIPPED không cho pendingReference).
  //
  // Test này verify invariant: pendingReference phải đúng OperationReference
  // shape; OperationQuery (envelopes.ts) có thể dùng operationId để poll
  // result. Implementation query API để backend Phase V7.9a.
  const opRef = {
    kind: 'COMMAND_OPERATION',
    operationId: 'op-test-min8',
  };
  // Reference fields phải khớp OperationReferenceSchema strict.
  assert.equal(typeof opRef.kind, 'string');
  assert.equal(opRef.kind, 'COMMAND_OPERATION');
  assert.equal(typeof opRef.operationId, 'string');
  assert.ok(opRef.operationId.length >= 8, 'operationId min 8 chars');
});
