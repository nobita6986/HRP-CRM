/**
 * dashboard/types.ts — CORE/1.12 BoD dashboard mock types.
 *
 * Reuses contracts from Gate 0.5 (analytics.ts, kpi.ts):
 *   - METRIC_GRAINS, METRIC_UNITS, METRIC_PERIODS, METRIC_ATTRIBUTION_STATES
 *   - KPI_TARGET_TYPES, KPI_PERIODS, KPI_MODULE_NAMESPACE
 *   - MetricAttributionStateSchema, ProfileLifecycleMetricIdSchema
 *
 * Internal types (not in contracts):
 *   - DashboardSnapshot: filter/scope binding for chart+drill-down consistency.
 *   - ChartDataPoint: a single (period, grain, value, attribution) cell.
 *   - DrilldownRequest/Result: scope-bound detail query/response.
 *   - KPIAssignmentFixture / KPIRevisionFixture / KPIProposeFixture.
 *
 * No raw PII; no secret values; no model IDs.
 *
 * Source coverage tags (AC #2):
 *   - 'CHATWOOT'      → has been counted (CHATWOOT data was sufficient).
 *   - 'ZALO_OA'       → has been counted.
 *   - 'INTERNAL_FORM' → has been counted.
 *   - 'HRP_UI'        → has been counted.
 *   - 'CHAT_ONLY'     → CHAT-source only; NOT a "tổng công ty" (whole-company) figure.
 *
 * Credit policy tag (AC #2):
 *   - 'CONFIRMED'  → handler/credit attribution rules fully bound (schema bind).
 *   - 'PARTIAL'    → partial rules bound; some edge cases UNKNOWN.
 *   - 'UNKNOWN'    → attribution cannot be made; metric value shown only as
 *                    attribution=UNAVAILABLE per Owner Q-30.
 *
 * Fixture-only types — NOT production schemas.
 */

import {
  METRIC_GRAINS,
  METRIC_PERIODS,
  METRIC_UNITS,
  METRIC_ATTRIBUTION_STATES,
  KPI_TARGET_TYPES,
  KPI_PERIODS,
} from '@hrp-engagement/contracts';
import type { z } from 'zod';
import type {
  MetricGrainSchema,
  MetricUnitSchema,
  MetricPeriodSchema,
  MetricAttributionStateSchema,
} from '@hrp-engagement/contracts';

export type MetricGrain = (typeof METRIC_GRAINS)[number];
export type MetricUnit = (typeof METRIC_UNITS)[number];
export type MetricPeriod = (typeof METRIC_PERIODS)[number];
export type MetricAttributionState = (typeof METRIC_ATTRIBUTION_STATES)[number];
export type KPITargetType = (typeof KPI_TARGET_TYPES)[number];
export type KPIPeriod = (typeof KPI_PERIODS)[number];

/* ───────────────────────────────────────────────────────────────────────────
 * Snapshot — filter/scope binding for chart and drill-down consistency.
 *
 * AC #3: clicking chart/KPI opens drill-down with the SAME filters/snapshot.
 * A snapshot is a stable scope descriptor (not a persistence identifier);
 * it identifies the (grain, period, cohort, attribution) cells the dashboard
 * is presenting, and the drill-down reuses it so figures stay consistent.
 * ─────────────────────────────────────────────────────────────────────────── */

export interface DashboardSnapshot {
  /** Organization scope. */
  organizationId: string;
  /** Grain (ACTOR / TEAM / COHORT / ORGANIZATION). */
  grain: MetricGrain;
  /** Period anchor (DAILY / WEEKLY / MONTHLY / QUARTERLY). */
  period: MetricPeriod;
  /** Period window (inclusive start, inclusive end). */
  periodStart: string;
  periodEnd: string;
  /** Cohort filter — region and/or source allowlist. Empty = no cohort. */
  cohort: {
    region?: string[];
    source?: string[];
  };
  /** Optional actorId filter (when grain=ACTOR). */
  actorId?: string;
  /** Server-set asOf timestamp. */
  asOf: string;
  /** Snapshot id — server-generated for traceability. */
  snapshotId: string;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Chart data — one (period, grain, value) cell with attribution metadata.
 *
 * AC #2: each cell carries attribution state + source coverage tag + credit
 * policy tag + reason code (when UNAVAILABLE) so the UI can show source
 * coverage + grain + as-of + credit policy without re-querying.
 * ─────────────────────────────────────────────────────────────────────────── */

export interface ChartDataPoint {
  /** Bucket label (e.g., '2026-09-01' for DAILY, '2026-W36' for WEEKLY). */
  bucket: string;
  /** Lifecycle stage this cell represents (CREATED / UPDATED / etc.). */
  stage: LifecycleStage;
  /** Optional actorId when grain=ACTOR. */
  actorId?: string;
  /** Optional team label when grain=TEAM. */
  team?: string;
  /** Optional cohort label when grain=COHORT. */
  cohort?: string;
  /** Numeric value (count / rate / duration_ms / currency). */
  value: number;
  /** Target value (if assigned). 0 when target zero / unassigned. */
  target?: number;
  /** Attribution state. UNAVAILABLE → value MUST be 0 (placeholder). */
  attributionState: MetricAttributionState;
  /** Reason code (required when UNAVAILABLE; absent when AVAILABLE). */
  attributionReasonCode?: string;
  /** Source coverage tag for this cell. */
  sourceCoverage: SourceCoverage;
  /** Credit policy tag. */
  creditPolicy: CreditPolicy;
}

export type SourceCoverage =
  | 'CHATWOOT'
  | 'ZALO_OA'
  | 'INTERNAL_FORM'
  | 'HRP_UI'
  | 'CHAT_ONLY'
  | 'NONE';

export type CreditPolicy = 'CONFIRMED' | 'PARTIAL' | 'UNKNOWN';

/* ───────────────────────────────────────────────────────────────────────────
 * Dashboard read result — used by chart and drill-down interchangeably.
 *
 * The same `metrics[]` shape is returned for chart view (one cell per bucket)
 * and drill-down view (one cell per entity). Sum of drill-down cells for a
 * bucket must equal the chart cell value (when grain = ORGANIZATION).
 * ─────────────────────────────────────────────────────────────────────────── */

export interface DashboardReadResult {
  snapshot: DashboardSnapshot;
  /** Chart series. */
  metrics: ChartDataPoint[];
  /** KPI targets active for this snapshot. */
  kpis: KPIAssignmentRow[];
  /** Coverage summary across all buckets (for header bar). */
  coverage: DashboardCoverage;
}

export interface DashboardCoverage {
  /** Which sources contributed rows to this dashboard. */
  sourcesPresent: SourceCoverage[];
  /** Grain of this dashboard (mirrors snapshot). */
  grain: MetricGrain;
  /** Period of this dashboard (mirrors snapshot). */
  period: MetricPeriod;
  /** asOf timestamp (server-set). */
  asOf: string;
  /** Credit policy tag for the dashboard. */
  creditPolicy: CreditPolicy;
  /** Whether chat-only fixture data is included (UNLABELLED on totals). */
  includesChatOnly: boolean;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Drill-down request/result — same snapshot contract.
 * ─────────────────────────────────────────────────────────────────────────── */

export interface DrilldownRequest {
  snapshot: DashboardSnapshot;
  /** Target lifecycle stage to drill into (created/updated/submitted/review/outcome). */
  stage: LifecycleStage;
  /** Bucket to drill into (e.g. '2026-09-08'). Optional — omit for all. */
  bucket?: string;
  /** Cursor (opaque). */
  cursor?: string;
  /** Page size (default 50, max 200). */
  pageSize?: number;
}

export type LifecycleStage =
  | 'CREATED'
  | 'UPDATED'
  | 'SUBMITTED'
  | 'REVIEW'
  | 'OUTCOME';

export interface DrilldownRow {
  /** Stable row id (synthetic). */
  rowId: string;
  /** Bucket this row contributes to. */
  bucket: string;
  actorId: string;
  /** Source of this row (CHATWOOT/ZALO_OA/INTERNAL_FORM/HRP_UI/CHAT_ONLY). */
  sourceCoverage: SourceCoverage;
  /** Lifecycle stage. */
  stage: LifecycleStage;
  /** Numeric contribution (always 1 per row for count metric). */
  value: number;
  /** Attribution state of the row. */
  attributionState: MetricAttributionState;
  attributionReasonCode?: string;
  /** Whether the row is a chat-source-only row (NOT labelled as whole-company). */
  chatSourceOnly: boolean;
}

export interface DrilldownResult {
  snapshot: DashboardSnapshot;
  stage: LifecycleStage;
  rows: DrilldownRow[];
  total: number;
  /** Sum check — sum of row.value MUST equal the chart cell value (when grain=ORGANIZATION). */
  sumCheck: {
    bucket: string;
    chartValue: number;
    drilldownSum: number;
    consistent: boolean;
  };
  nextCursor?: string;
}

/* ───────────────────────────────────────────────────────────────────────────
 * KPI assignment row — manager-owned; sale/AI cannot mutate.
 * ─────────────────────────────────────────────────────────────────────────── */

export interface KPIAssignmentRow {
  assignmentId: string;
  organizationId: string;
  /** Manager-supplied targetType. */
  targetType: KPITargetType;
  /** Manager-supplied period. */
  period: KPIPeriod;
  /** Manager-assigned target value. */
  targetValue: number;
  /** Owner actorId or team. */
  targetActorRole: 'SALE' | 'AI_AGENT' | 'STAFF' | 'TEAM' | 'UNIT';
  targetActorId?: string;
  /** Cohort filter. */
  cohort?: {
    region?: string[];
    source?: string[];
    periodStart?: string;
    periodEnd?: string;
  };
  /** Attribution source. */
  attributionSource?: 'CHATWOOT' | 'ZALO_OA' | 'INTERNAL_FORM' | 'HRP_UI' | 'EXPERIMENTAL';
  /** Optimistic concurrency. */
  revisionId: string;
  /** Last applied revision number. */
  appliedRevision: number;
  /** Server-set applied timestamp. */
  appliedAt: string;
  /** Manager actor who assigned/revised. */
  assignedBy: string;
  /** Reason code (audit). */
  reasonCode: string;
}

export interface KPIAssignmentRequest {
  organizationId: string;
  targetType: KPITargetType;
  period: KPIPeriod;
  targetValue: number;
  targetActorRole: 'SALE' | 'AI_AGENT' | 'STAFF' | 'TEAM' | 'UNIT';
  targetActorId?: string;
  cohort?: {
    region?: string[];
    source?: string[];
    periodStart?: string;
    periodEnd?: string;
  };
  attributionSource?: 'CHATWOOT' | 'ZALO_OA' | 'INTERNAL_FORM' | 'HRP_UI' | 'EXPERIMENTAL';
  reasonCode: string;
}

export interface KPIRevisionRequest {
  assignmentId: string;
  newTargetValue?: number;
  expectedRevision: number;
  reasonCode: string;
}

export interface KPIProposeRequest {
  assignmentId: string;
  proposedTargetValue?: number;
  rationale: string;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Profile lifecycle fixture row — synthetic, no PII, no real profile IDs.
 * ─────────────────────────────────────────────────────────────────────────── */

export interface ProfileLifecycleRow {
  /** Synthetic opaque id (server-generated). */
  rowId: string;
  organizationId: string;
  /** Day this row is attributed to (YYYY-MM-DD). */
  day: string;
  actorId: string;
  /** Source coverage. */
  sourceCoverage: SourceCoverage;
  /** Which lifecycle stage this row represents. */
  stage: LifecycleStage;
  /** Attribution state of this row (mirrors KPIReadResult). */
  attributionState: MetricAttributionState;
  attributionReasonCode?: string;
  /** Whether chat-only fixture row (NOT counted in whole-company totals). */
  chatSourceOnly: boolean;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Permission helpers — reused at the service boundary.
 *
 * Manager roles (SUPERVISOR / SYSTEM) may assign/revise KPI targets.
 * Sale / talent reviewer / AI may ONLY read or propose.
 * ─────────────────────────────────────────────────────────────────────────── */

export const MANAGER_ROLES = ['SUPERVISOR', 'SYSTEM'] as const;
export type ManagerRole = (typeof MANAGER_ROLES)[number];

export function isManagerRole(role: string): boolean {
  return (MANAGER_ROLES as readonly string[]).includes(role);
}
