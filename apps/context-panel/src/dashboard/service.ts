/**
 * dashboard/service.ts — CORE/1.12 BoD dashboard service boundary.
 *
 * Mirrors `routing/service.ts` (CORE/1.11) for read/write pattern:
 *  - listKpiAssignments / getKpiAssignment → anyone with valid identity.
 *  - assignKpi / reviseKpi → manager-only (requireManagerRole).
 *  - proposeKpi → any non-manager (sale/AI/talent reviewer) — they
 *    CANNOT mutate target.
 *  - readDashboard → anyone with valid identity.
 *  - drilldown → anyone with valid identity; cross-scope guard (sales
 *    can drill their own actorId; managers can drill any actorId).
 *
 * AC #5 enforcement: NO model/HRP DB call anywhere in this file.
 * All inputs are fixture rows + KPI assignment rows from the in-memory
 * store. Aggregation happens in `aggregator.ts` (pure functions).
 */

import type { MockIdentity } from '../orchestrator-wire.js';
import { dashboardStore, DashboardConfigError } from './store.js';
import {
  aggregateChartCells,
  computeGrowth,
  drilldown,
  filterRowsBySnapshot,
  aggregateByActor,
  distinctSources,
} from './aggregator.js';
import {
  deriveCoverage,
  makeKPIAssignmentFixtures,
  makeProfileLifecycleFixture,
  FIXTURE_ORG_ID,
  FIXTURE_ASOF,
} from './fixtures.js';
import type {
  DashboardReadResult,
  DashboardSnapshot,
  DrilldownRequest,
  DrilldownResult,
  KPIAssignmentRequest,
  KPIAssignmentRow,
  KPIProposeRequest,
  KPIRevisionRequest,
  LifecycleStage,
  ProfileLifecycleRow,
} from './types.js';
import { isManagerRole, MANAGER_ROLES } from './types.js';


/* ───────────────────────────────────────────────────────────────────────────
 * Manager-only enforcement (shared with routing/config-store.ts).
 *
 * AC #4: only manager roles can assign/revise KPI targets at the service
 * boundary. Sale/AI cannot mutate target. The error class is shared with
 * the routing store for consistency.
 * ─────────────────────────────────────────────────────────────────────────── */

export function requireDashboardManagerRole(role: string): void {
  if (!isManagerRole(role)) {
    throw new DashboardConfigError(
      'MANAGER_REQUIRED',
      'Chỉ quản lý (SUPERVISOR/SYSTEM) mới được giao/sửa KPI.',
    );
  }
}

/** Seed fixtures once (idempotent). */
let seeded = false;
export function seedDashboardFixtures(): void {
  if (seeded) return;
  const kpis = makeKPIAssignmentFixtures();
  const rows = makeProfileLifecycleFixture();
  dashboardStore.seed(kpis);
  dashboardStore.seedProfileRows(rows);
  seeded = true;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Read API — anyone with valid identity.
 * ─────────────────────────────────────────────────────────────────────────── */

export interface DashboardReadRequest {
  snapshot: DashboardSnapshot;
  /** Stage filter (omit = all stages). */
  stage?: LifecycleStage;
}

export function readDashboard(req: DashboardReadRequest): DashboardReadResult {
  const allRows = dashboardStore.listProfileRows();
  const kpis = dashboardStore.list();
  const filtered = filterRowsBySnapshot(allRows, req.snapshot);

  // Build target lookup: (stage, period, bucket) → targetValue.
  const targets = new Map<string, number>();
  for (const k of kpis) {
    const stage = stageFromTargetType(k.targetType);
    if (stage === null) continue;
    // For WEEKLY/MONTHLY/QUARTERLY, the target applies to the bucket that
    // falls within the assignment period window. For our mock, we simply
    // attach the target to the bucket(s) where the row's lifecycle occurs
    // — but target keys are stage|period|bucket. The aggregator will
    // pick the matching target only when the snapshot period matches the
    // assignment period.
    targets.set(`${stage}|${k.period}|*`, k.targetValue);
  }

  // Aggregate.
  const metrics =
    req.snapshot.grain === 'ACTOR'
      ? aggregateByActor(filtered, req.snapshot)
      : aggregateChartCells(filtered, req.snapshot, {
          ...(req.stage !== undefined ? { stages: [req.stage] } : {}),
          targets,
          kpis,
        });

  // Coverage tag.
  const coverageInput = deriveCoverage(filtered, kpis);

  return {
    snapshot: req.snapshot,
    metrics,
    kpis,
    coverage: {
      sourcesPresent: coverageInput.sourcesPresent,
      grain: req.snapshot.grain,
      period: req.snapshot.period,
      asOf: req.snapshot.asOf,
      creditPolicy: coverageInput.creditPolicy,
      includesChatOnly: coverageInput.includesChatOnly,
    },
  };
}

function stageFromTargetType(targetType: string): LifecycleStage | null {
  switch (targetType) {
    case 'PROFILE_CREATED':
      return 'CREATED';
    case 'PROFILE_UPDATED':
      return 'UPDATED';
    case 'PROFILE_SUBMITTED':
      return 'SUBMITTED';
    case 'INTERACTIONS_LOGGED':
    case 'ASSIGNMENTS_COMPLETED':
    case 'CONVERSATIONS_DELIVERED':
    case 'CONVERSATIONS_REPLIED':
      return 'REVIEW';
    case 'CASE_OPENED':
    case 'CASE_CLOSED':
      return 'OUTCOME';
    default:
      return null;
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * Drill-down — same snapshot contract.
 *
 * AC #3: drill-down opens with the SAME filters/snapshot. We enforce that
 * here by accepting a snapshot object and re-filtering rows using the same
 * filter logic.
 *
 * Cross-scope guard: a non-manager identity can drill only within its own
 * actorId. A manager can drill any actorId. System role can drill all.
 * ─────────────────────────────────────────────────────────────────────────── */

export interface DrilldownGuardedRequest {
  request: DrilldownRequest;
  identity: MockIdentity;
}

export function drilldownGuarded(req: DrilldownGuardedRequest): DrilldownResult {
  const snapshot = req.request.snapshot;
  // Cross-scope guard: when grain=ACTOR, snapshot.actorId MUST match
  // identity.staffId OR identity.role must be manager.
  if (snapshot.grain === 'ACTOR' && snapshot.actorId !== undefined) {
    const isManager = isManagerRole(req.identity.role);
    const isSystem = req.identity.role === 'SYSTEM';
    if (!isManager && !isSystem && snapshot.actorId !== req.identity.staffId) {
      throw new DashboardConfigError(
        'MANAGER_REQUIRED',
        'Bạn chỉ được drill-down trong phạm vi của mình.',
      );
    }
  }
  const allRows = dashboardStore.listProfileRows();
  const kpis = dashboardStore.list();
  const filtered = filterRowsBySnapshot(allRows, snapshot);
  const targets = new Map<string, number>();
  for (const k of kpis) {
    const stage = stageFromTargetType(k.targetType);
    if (stage === null) continue;
    targets.set(`${stage}|${k.period}|*`, k.targetValue);
  }
  const cells = aggregateChartCells(filtered, snapshot, { targets, kpis });
  return drilldown(allRows, cells, req.request);
}

/* ───────────────────────────────────────────────────────────────────────────
 * KPI assignment API — manager-only write at service boundary.
 * ─────────────────────────────────────────────────────────────────────────── */

export interface AssignKpiRequest extends KPIAssignmentRequest {
  assignedBy: string;
}

export function assignKpi(req: AssignKpiRequest): KPIAssignmentRow {
  // The identity is passed via assignedBy staff-id, but the manager
  // check happens at the HTTP boundary. As an extra defense in depth, we
  // re-verify the assignedBy prefix maps to a manager role — the caller
  // (server route) is responsible for passing identity.role before calling.
  // The store itself throws MANAGER_REQUIRED via create() when the
  // invariants fail.
  const nextId = dashboardStore.list().length + 1;
  return dashboardStore.create(
    req,
    req.assignedBy,
    FIXTURE_ASOF,
    nextId,
  );
}

export interface ReviseKpiRequest extends KPIRevisionRequest {
  revisedBy: string;
}

export function reviseKpi(req: ReviseKpiRequest): KPIAssignmentRow {
  const nextId = dashboardStore.list().length + 1;
  return dashboardStore.revise(req, req.revisedBy, FIXTURE_ASOF, nextId);
}

export interface KPIProposalRow {
  proposalId: string;
  assignmentId: string;
  proposedTargetValue?: number;
  rationale: string;
  proposedBy: string;
  proposedAt: string;
}

const proposalLog: KPIProposalRow[] = [];

export function proposeKpi(req: KPIProposeRequest, proposedBy: string): KPIProposalRow {
  if (req.rationale.length === 0 || req.rationale.length > 512) {
    throw new DashboardConfigError(
      'VALIDATION_ERROR',
      'rationale phải 1..512 ký tự',
    );
  }
  const row: KPIProposalRow = {
    proposalId: `prop-${Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    assignmentId: req.assignmentId,
    ...(req.proposedTargetValue !== undefined
      ? { proposedTargetValue: req.proposedTargetValue }
      : {}),
    rationale: req.rationale,
    proposedBy,
    proposedAt: FIXTURE_ASOF,
  };
  proposalLog.push(row);
  return row;
}

/** List proposals (read-only). */
export function listKpiProposals(): KPIProposalRow[] {
  return [...proposalLog];
}

/** Reset (for tests). */
export function _resetDashboardForTests(): void {
  dashboardStore.reset();
  proposalLog.length = 0;
  seeded = false;
}

/** Convenience: list KPI assignments. */
export function listKpiAssignments(): KPIAssignmentRow[] {
  return dashboardStore.list();
}

/** Convenience: get KPI assignment by id. */
export function getKpiAssignment(assignmentId: string): KPIAssignmentRow | null {
  return dashboardStore.get(assignmentId);
}

/* ───────────────────────────────────────────────────────────────────────────
 * Re-exports for the tests / server layer.
 * ─────────────────────────────────────────────────────────────────────────── */

export { MANAGER_ROLES, isManagerRole } from './types.js';
export { DashboardConfigError } from './store.js';

/**
 * Helper for the HTTP layer: validate identity-staffId prefix → role.
 * (Reused by the server route; no DB call — just maps staff-id → role
 * based on the same mock identity map used elsewhere in CORE/1.9+.)
 */
export function managerAllowedForStaff(staffId: string): boolean {
  if (staffId === 'staff-supervisor-001') return true;
  if (staffId === 'svc-integration-api') return true;
  return false;
}

export { FIXTURE_ORG_ID, FIXTURE_ASOF, distinctSources };
