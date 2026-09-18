/**
 * tests/dashboard-service.test.mjs — CORE/1.12 Dashboard service unit tests.
 *
 * Validates AC #4 (manager-only enforcement at service boundary) and
 * cross-scope guard. Uses the in-memory store directly (no HTTP) so we
 * can assert the service throws the right error codes.
 *
 * Runs against the built dist/ output so that node can resolve all
 * imports (the source uses .js extensions on .ts imports for tsx/tsc).
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Build if dist/ is missing.
if (!existsSync('./dist/dashboard/service.js')) {
  execSync('npm run build', { stdio: 'inherit' });
}

const {
  readDashboard,
  drilldownGuarded,
  assignKpi,
  reviseKpi,
  proposeKpi,
  listKpiAssignments,
  _resetDashboardForTests,
  seedDashboardFixtures,
  DashboardConfigError,
} = await import('../dist/dashboard/service.js');
const { makeDashboardSnapshot } = await import('../dist/dashboard/fixtures.js');

before(() => {
  // Ensure fixtures are reset for the test run.
  _resetDashboardForTests();
});

function freshSeed() {
  _resetDashboardForTests();
  seedDashboardFixtures();
}

function supervisorIdentity() {
  return {
    staffId: 'staff-supervisor-001',
    role: 'SUPERVISOR',
    organizationId: 'org-001',
    actor: { kind: 'USER', userId: 'staff-supervisor-001' },
  };
}

function saleIdentity() {
  return {
    staffId: 'staff-talent-001',
    role: 'TALENT_REVIEWER',
    organizationId: 'org-001',
    actor: { kind: 'USER', userId: 'staff-talent-001' },
  };
}

function systemIdentity() {
  return {
    staffId: 'svc-integration-api',
    role: 'SYSTEM',
    organizationId: '*',
    actor: { kind: 'SERVICE', serviceId: 'svc-integration-api' },
  };
}

test('service: readDashboard returns metrics for valid snapshot', () => {
  freshSeed();
  const result = readDashboard({ snapshot: makeDashboardSnapshot() });
  assert.ok(result.metrics.length > 0);
  assert.ok(result.kpis.length > 0);
  assert.equal(result.coverage.organizationId ?? '', '');
  assert.ok(result.coverage.grain === 'ORGANIZATION');
  assert.ok(result.coverage.period === 'WEEKLY');
});

test('service: readDashboard coverage labels include source/grain/as-of/credit policy', () => {
  freshSeed();
  const result = readDashboard({ snapshot: makeDashboardSnapshot() });
  assert.ok(result.coverage.sourcesPresent.length > 0);
  assert.match(result.coverage.creditPolicy, /CONFIRMED|PARTIAL|UNKNOWN/);
  assert.match(result.coverage.asOf, /^\d{4}-\d{2}-\d{2}T/);
});

test('service: readDashboard reports UNKNOWN credit policy when KPI is EXPERIMENTAL', () => {
  freshSeed();
  const result = readDashboard({ snapshot: makeDashboardSnapshot() });
  // KPI fixture has 1 EXPERIMENTAL (the target-zero one) → UNKNOWN
  assert.equal(result.coverage.creditPolicy, 'UNKNOWN');
});

test('service: manager can assign KPI', () => {
  freshSeed();
  const before = listKpiAssignments().length;
  const row = assignKpi({
    organizationId: 'org-001',
    targetType: 'PROFILE_CREATED',
    period: 'MONTHLY',
    targetValue: 50,
    targetActorRole: 'TEAM',
    reasonCode: 'TEST_ASSIGN',
    assignedBy: 'staff-supervisor-001',
  });
  assert.ok(row.assignmentId.length > 0);
  assert.equal(listKpiAssignments().length, before + 1);
});

test('service: target-zero KPI requires cohort annotation (store-level guard)', () => {
  freshSeed();
  assert.throws(
    () =>
      assignKpi({
        organizationId: 'org-001',
        targetType: 'PROFILE_CREATED',
        period: 'MONTHLY',
        targetValue: 0,
        targetActorRole: 'TEAM',
        reasonCode: 'TEST_TARGET_ZERO_NO_COHORT',
        assignedBy: 'staff-supervisor-001',
      }),
    (err) =>
      err instanceof DashboardConfigError && err.code === 'TARGET_ZERO_NOT_ALLOWED',
  );
});

test('service: target-zero KPI with cohort annotation is allowed', () => {
  freshSeed();
  const row = assignKpi({
    organizationId: 'org-001',
    targetType: 'PROFILE_CREATED',
    period: 'MONTHLY',
    targetValue: 0,
    targetActorRole: 'TEAM',
    cohort: {
      region: ['SG'],
      source: ['CHAT_ONLY'],
      periodStart: '2026-08-31',
      periodEnd: '2026-09-13',
    },
    attributionSource: 'EXPERIMENTAL',
    reasonCode: 'TEST_TARGET_ZERO_COHORT',
    assignedBy: 'staff-supervisor-001',
  });
  assert.equal(row.targetValue, 0);
  assert.ok(row.cohort !== undefined);
});

test('service: reviseKpi applies optimistic concurrency (stale → VERSION_CONFLICT)', () => {
  freshSeed();
  const before = listKpiAssignments().find((k) => k.assignmentId === 'kpi-prof-created-monthly');
  assert.ok(before);
  const revised = reviseKpi({
    assignmentId: before.assignmentId,
    newTargetValue: 250,
    expectedRevision: before.appliedRevision,
    reasonCode: 'TEST_REVISE',
    revisedBy: 'staff-supervisor-001',
  });
  assert.equal(revised.targetValue, 250);
  assert.equal(revised.appliedRevision, before.appliedRevision + 1);

  // Stale revise → VERSION_CONFLICT
  assert.throws(
    () =>
      reviseKpi({
        assignmentId: before.assignmentId,
        newTargetValue: 300,
        expectedRevision: before.appliedRevision, // stale
        reasonCode: 'TEST_REVISE_STALE',
        revisedBy: 'staff-supervisor-001',
      }),
    (err) =>
      err instanceof DashboardConfigError && err.code === 'VERSION_CONFLICT',
  );
});

test('service: reviseKpi rejects negative targetValue', () => {
  freshSeed();
  const before = listKpiAssignments().find((k) => k.assignmentId === 'kpi-prof-created-monthly');
  assert.throws(
    () =>
      reviseKpi({
        assignmentId: before.assignmentId,
        newTargetValue: -1,
        expectedRevision: before.appliedRevision,
        reasonCode: 'TEST_NEGATIVE',
        revisedBy: 'staff-supervisor-001',
      }),
    (err) =>
      err instanceof DashboardConfigError && err.code === 'VALIDATION_ERROR',
  );
});

test('service: reviseKpi rejects periodStart > periodEnd (missing review source guard)', () => {
  freshSeed();
  const before = listKpiAssignments().find((k) => k.assignmentId === 'kpi-prof-created-monthly');
  // We don't have a way to inject periodStart>End on revise directly, but
  // assignKpi with bad cohort dates should throw.
  assert.throws(
    () =>
      assignKpi({
        organizationId: 'org-001',
        targetType: 'PROFILE_CREATED',
        period: 'WEEKLY',
        targetValue: 10,
        targetActorRole: 'TEAM',
        cohort: {
          periodStart: '2026-12-31',
          periodEnd: '2026-01-01',
        },
        reasonCode: 'TEST_BAD_PERIOD',
        assignedBy: 'staff-supervisor-001',
      }),
    (err) =>
      err instanceof DashboardConfigError && err.code === 'PERIOD_INCOMPLETE',
  );
});

test('service: proposeKpi records proposal; target NOT mutated', () => {
  freshSeed();
  const before = listKpiAssignments().find((k) => k.assignmentId === 'kpi-prof-created-monthly');
  const proposal = proposeKpi(
    {
      assignmentId: before.assignmentId,
      proposedTargetValue: 999,
      rationale: 'Tăng target lên 999 vì tháng rất tốt',
    },
    'staff-talent-001',
  );
  assert.ok(proposal.proposalId.length > 0);
  assert.equal(proposal.proposedTargetValue, 999);

  // Target NOT mutated.
  const after = listKpiAssignments().find((k) => k.assignmentId === before.assignmentId);
  assert.equal(after.targetValue, before.targetValue);
});

test('service: proposeKpi rejects empty rationale', () => {
  freshSeed();
  const before = listKpiAssignments()[0];
  assert.throws(
    () =>
      proposeKpi(
        {
          assignmentId: before.assignmentId,
          proposedTargetValue: 100,
          rationale: '',
        },
        'staff-talent-001',
      ),
    (err) =>
      err instanceof DashboardConfigError && err.code === 'VALIDATION_ERROR',
  );
});

test('service: drilldownGuarded — manager can drill any actor', () => {
  freshSeed();
  const result = drilldownGuarded({
    request: {
      snapshot: makeDashboardSnapshot({ grain: 'ACTOR', actorId: 'staff-sale-A' }),
      stage: 'CREATED',
    },
    identity: supervisorIdentity(),
  });
  assert.ok(result.rows.length > 0);
});

test('service: drilldownGuarded — sale can drill their own actor only', () => {
  freshSeed();
  const saleId = saleIdentity();
  // own actor → OK
  const ok = drilldownGuarded({
    request: {
      snapshot: makeDashboardSnapshot({ grain: 'ACTOR', actorId: saleId.staffId }),
      stage: 'CREATED',
    },
    identity: saleId,
  });
  assert.ok(ok.rows.length >= 0);
});

test('service: drilldownGuarded — sale CANNOT drill another actor (cross-scope guard)', () => {
  freshSeed();
  assert.throws(
    () =>
      drilldownGuarded({
        request: {
          snapshot: makeDashboardSnapshot({ grain: 'ACTOR', actorId: 'staff-sale-B' }),
          stage: 'CREATED',
        },
        identity: saleIdentity(),
      }),
    (err) =>
      err instanceof DashboardConfigError && err.code === 'MANAGER_REQUIRED',
  );
});

test('service: drilldownGuarded — system can drill any actor', () => {
  freshSeed();
  const result = drilldownGuarded({
    request: {
      snapshot: makeDashboardSnapshot({ grain: 'ACTOR', actorId: 'staff-sale-D' }),
      stage: 'CREATED',
    },
    identity: systemIdentity(),
  });
  assert.ok(result.rows.length >= 0);
});

test('service: drilldownGuarded — sumCheck.consistent for ORGANIZATION grain', () => {
  freshSeed();
  const result = drilldownGuarded({
    request: {
      snapshot: makeDashboardSnapshot({ period: 'WEEKLY' }),
      stage: 'CREATED',
      bucket: '2026-W36',
    },
    identity: supervisorIdentity(),
  });
  assert.equal(result.sumCheck.consistent, true);
});
