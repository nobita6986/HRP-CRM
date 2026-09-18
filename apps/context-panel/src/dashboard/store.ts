/**
 * dashboard/store.ts — CORE/1.12 In-memory KPI assignment store.
 *
 * Mirrors the pattern of `routing/config-store.ts` (CORE/1.11): singleton
 * store with optimistic concurrency. No persistence; lost on restart.
 *
 * Read access: anyone with valid identity (via service boundary).
 * Write access: manager-only (enforced at service boundary, not here).
 *
 * Profile lifecycle fixture rows live in a separate Map keyed by rowId and
 * are seeded once on startup. They are read-only — assignments do not
 * mutate them.
 */

import type {
  KPIAssignmentRow,
  KPIAssignmentRequest,
  KPIRevisionRequest,
  ProfileLifecycleRow,
} from './types.js';

export class DashboardConfigError extends Error {
  constructor(
    public code: DashboardConfigErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DashboardConfigError';
  }
}

export type DashboardConfigErrorCode =
  | 'KPI_NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'VALIDATION_ERROR'
  | 'MANAGER_REQUIRED'
  | 'TARGET_ZERO_NOT_ALLOWED'
  | 'PERIOD_INCOMPLETE';

class KPIStore {
  private readonly assignments = new Map<string, KPIAssignmentRow>();
  private readonly profileRows = new Map<string, ProfileLifecycleRow>();

  list(): KPIAssignmentRow[] {
    return [...this.assignments.values()];
  }

  get(assignmentId: string): KPIAssignmentRow | null {
    return this.assignments.get(assignmentId) ?? null;
  }

  /** Seed initial KPI assignments (called once on startup). */
  seed(rows: KPIAssignmentRow[]): void {
    for (const r of rows) {
      this.assignments.set(r.assignmentId, r);
    }
  }

  /** Seed profile lifecycle fixture rows (called once on startup). */
  seedProfileRows(rows: ReadonlyArray<ProfileLifecycleRow>): void {
    for (const r of rows) {
      this.profileRows.set(r.rowId, r);
    }
  }

  listProfileRows(): ProfileLifecycleRow[] {
    return [...this.profileRows.values()];
  }

  /** Append a single profile row (used by mutation API, if any). */
  appendProfileRow(row: ProfileLifecycleRow): void {
    this.profileRows.set(row.rowId, row);
  }

  /** Create a new KPI assignment (manager-only enforced at service). */
  create(req: KPIAssignmentRequest, assignedBy: string, appliedAt: string, nextId: number): KPIAssignmentRow {
    // Target-zero rule: schema allows it, but our policy for this mock
    // requires explicit cohort annotation when target=0 (so we can
    // audit the cohort). Enforce here at the store boundary.
    if (req.targetValue === 0 && req.cohort === undefined) {
      throw new DashboardConfigError(
        'TARGET_ZERO_NOT_ALLOWED',
        'targetValue=0 phải đi kèm cohort (audit cho target-zero).',
      );
    }
    // Partial period rule: if periodStart/periodEnd mark a partial period,
    // store must flag it (informational).
    if (
      req.cohort?.periodStart !== undefined &&
      req.cohort?.periodEnd !== undefined &&
      req.cohort.periodStart > req.cohort.periodEnd
    ) {
      throw new DashboardConfigError(
        'PERIOD_INCOMPLETE',
        'periodStart phải <= periodEnd',
      );
    }
    const row: KPIAssignmentRow = {
      assignmentId: `kpi-${req.targetType.toLowerCase()}-${req.period.toLowerCase()}-${nextId}`,
      organizationId: req.organizationId,
      targetType: req.targetType,
      period: req.period,
      targetValue: req.targetValue,
      targetActorRole: req.targetActorRole,
      revisionId: `rev-${nextId}`,
      appliedRevision: 1,
      appliedAt,
      assignedBy,
      reasonCode: req.reasonCode,
    };
    if (req.targetActorId !== undefined) {
      (row as { targetActorId: string }).targetActorId = req.targetActorId;
    }
    if (req.cohort !== undefined) {
      (row as { cohort: typeof req.cohort }).cohort = req.cohort;
    }
    if (req.attributionSource !== undefined) {
      (row as { attributionSource: typeof req.attributionSource }).attributionSource =
        req.attributionSource;
    }
    this.assignments.set(row.assignmentId, row);
    return row;
  }

  /**
   * Revise an existing KPI assignment (manager-only).
   *  - Stale revision → VERSION_CONFLICT.
   *  - Missing review source: if assignedBy is not a manager role, this
   *    function MUST be guarded by the service boundary. The store itself
   *    does NOT verify role — separation of concerns.
   */
  revise(
    req: KPIRevisionRequest,
    revisedBy: string,
    appliedAt: string,
    nextId: number,
  ): KPIAssignmentRow {
    const current = this.assignments.get(req.assignmentId);
    if (!current) {
      throw new DashboardConfigError(
        'KPI_NOT_FOUND',
        `Assignment ${req.assignmentId} not found.`,
      );
    }
    if (current.appliedRevision !== req.expectedRevision) {
      throw new DashboardConfigError(
        'VERSION_CONFLICT',
        `Version conflict: expected ${req.expectedRevision}, current ${current.appliedRevision}`,
      );
    }
    if (req.newTargetValue !== undefined && req.newTargetValue < 0) {
      throw new DashboardConfigError(
        'VALIDATION_ERROR',
        'newTargetValue phải >= 0',
      );
    }
    // Target=0 must still carry cohort annotation.
    if (
      req.newTargetValue === 0 &&
      current.cohort === undefined &&
      req.newTargetValue === 0
    ) {
      throw new DashboardConfigError(
        'TARGET_ZERO_NOT_ALLOWED',
        'targetValue=0 phải đi kèm cohort (audit cho target-zero).',
      );
    }
    const next: KPIAssignmentRow = {
      ...current,
      ...(req.newTargetValue !== undefined ? { targetValue: req.newTargetValue } : {}),
      appliedRevision: current.appliedRevision + 1,
      appliedAt,
      reasonCode: req.reasonCode,
      assignedBy: revisedBy,
      revisionId: `rev-${nextId}`,
    };
    this.assignments.set(next.assignmentId, next);
    return next;
  }

  /** Reset (for tests). */
  reset(): void {
    this.assignments.clear();
    this.profileRows.clear();
  }
}

/** Singleton dashboard store. */
export const dashboardStore = new KPIStore();
