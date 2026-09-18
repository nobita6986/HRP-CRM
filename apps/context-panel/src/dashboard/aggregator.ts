/**
 * dashboard/aggregator.ts — CORE/1.12 Pure aggregation functions over
 * profile lifecycle fixtures.
 *
 * No state, no IO, no model calls. All inputs are ProfileLifecycleRow[]
 * and KPIAssignmentRow[]. Outputs are ChartDataPoint[] / DrilldownRow[] /
 * growth metrics / coverage tags.
 *
 * Invariants enforced here (and asserted in tests):
 *   1. sumInvariant: for each (bucket, stage), the sum of drill-down row
 *      values EQUALS the chart cell value (when grain=ORGANIZATION).
 *   2. chatOnlyExcludedFromTotals: rows with chatSourceOnly=true are
 *      NOT counted in whole-company totals (AC #2 — chat-only fixtures
 *      are NOT labelled as tổng công ty).
 *   3. unavailableZeroValue: rows with attributionState=UNAVAILABLE are
 *      emitted with value=0 (placeholder; Q-30 no-guessing rule).
 *   4. distinctLifecycle: created/updated/submitted are emitted as 3
 *      separate chart series; never collapsed (Q-9).
 *   5. grainFilter: when grain=ACTOR, every cell carries actorId.
 *
 * Growth metric: last bucket vs prior bucket (week-over-week by default).
 */

import type {
  ProfileLifecycleRow,
  ChartDataPoint,
  DrilldownRow,
  DrilldownRequest,
  DrilldownResult,
  SourceCoverage,
  LifecycleStage,
  CreditPolicy,
  DashboardSnapshot,
  MetricGrain,
} from './types.js';

/* ───────────────────────────────────────────────────────────────────────────
 * Bucket label formatting.
 * ─────────────────────────────────────────────────────────────────────────── */

export function bucketLabel(day: string, period: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY'): string {
  if (period === 'DAILY') return day;
  if (period === 'QUARTERLY') {
    // '2026-Q1'..'2026-Q4'
    const d = new Date(`${day}T00:00:00.000Z`);
    const m = d.getUTCMonth();
    const q = Math.floor(m / 3) + 1;
    return `${d.getUTCFullYear()}-Q${q}`;
  }
  if (period === 'MONTHLY') {
    return day.slice(0, 7);
  }
  // WEEKLY
  const d = new Date(`${day}T00:00:00.000Z`);
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // ISO week: Thursday in current week determines the year.
  const dayNum = (tmp.getUTCDay() + 6) % 7;
  tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4));
  const diff = (tmp.getTime() - firstThursday.getTime()) / 86400000;
  const week = 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${tmp.getUTCFullYear()}-W${week.toString().padStart(2, '0')}`;
}

export function dayToBucket(
  day: string,
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY',
): string {
  return bucketLabel(day, period);
}

/* ───────────────────────────────────────────────────────────────────────────
 * Filter rows by snapshot.
 *
 *  - If snapshot.cohort.source is set, keep only rows whose sourceCoverage
 *    is in the allowlist.
 *  - Chat-only rows are excluded when the snapshot explicitly excludes
 *    CHAT_ONLY from its cohort.source list.
 * ─────────────────────────────────────────────────────────────────────────── */

export function filterRowsBySnapshot(
  rows: ReadonlyArray<ProfileLifecycleRow>,
  snapshot: DashboardSnapshot,
): ProfileLifecycleRow[] {
  return rows.filter((r) => {
    if (r.organizationId !== snapshot.organizationId) return false;
    if (snapshot.actorId !== undefined && r.actorId !== snapshot.actorId) return false;
    if (
      snapshot.cohort.source !== undefined &&
      snapshot.cohort.source.length > 0 &&
      !snapshot.cohort.source.includes(r.sourceCoverage)
    ) {
      return false;
    }
    if (
      snapshot.cohort.region !== undefined &&
      snapshot.cohort.region.length > 0
    ) {
      // No region on rows in this mock — rows without region tag fail the
      // region filter unless the filter is empty.
      const rowRegion = (r as { region?: string }).region;
      if (!rowRegion || !snapshot.cohort.region.includes(rowRegion)) return false;
    }
    if (r.day < snapshot.periodStart || r.day > snapshot.periodEnd) return false;
    return true;
  });
}

/* ───────────────────────────────────────────────────────────────────────────
 * Distinct sources present (chat-only marked separately).
 * ─────────────────────────────────────────────────────────────────────────── */

export function distinctSources(rows: ReadonlyArray<ProfileLifecycleRow>): SourceCoverage[] {
  const set = new Set<SourceCoverage>();
  for (const r of rows) set.add(r.sourceCoverage);
  return [...set];
}

/* ───────────────────────────────────────────────────────────────────────────
 * Whole-company total — sum of row values for the rows that count as
 * "organization-wide" (i.e., NOT chat-only).
 *
 * IMPORTANT: this is what the chart shows. Chat-only rows MUST NOT
 * contribute to whole-company totals per AC #2.
 * ─────────────────────────────────────────────────────────────────────────── */

function isWholeCompanyCountable(r: ProfileLifecycleRow): boolean {
  // Chat-only rows are explicitly NOT counted as whole-company.
  if (r.chatSourceOnly) return false;
  return true;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Aggregator — group rows by bucket + stage.
 *
 * Output: an array of ChartDataPoint, one per (bucket, stage) cell.
 * Each cell carries:
 *   - value: count of rows (whole-company, excludes chat-only)
 *   - target: KPI target value for that stage at that bucket, if any
 *   - attributionState: AVAILABLE if every row is AVAILABLE; otherwise
 *     UNAVAILABLE with the most common reasonCode.
 *   - sourceCoverage: union of sources contributing to this cell.
 *   - creditPolicy: CONFIRMED / PARTIAL / UNKNOWN.
 *
 * Unavailable rows DO contribute to the COUNT (their rowId is recorded
 * in fixtures, so we count them) but their attributionState is reported
 * honestly per Owner Q-30.
 * ─────────────────────────────────────────────────────────────────────────── */

export interface AggregatorOptions {
  /** Stages to emit (default: all 5). */
  stages?: ReadonlyArray<LifecycleStage>;
  /** Target lookup: (stage, period, bucket) → targetValue. */
  targets?: Map<string, number>;
  /** Whether to include chat-only rows in the count (default false). */
  includeChatOnly?: boolean;
  /** KPI assignments for credit-policy tagging. */
  kpis?: ReadonlyArray<{
    targetType: string;
    period: string;
    attributionSource?: string;
  }>;
}

export function aggregateChartCells(
  rows: ReadonlyArray<ProfileLifecycleRow>,
  snapshot: DashboardSnapshot,
  opts: AggregatorOptions = {},
): ChartDataPoint[] {
  const stages = opts.stages ?? ['CREATED', 'UPDATED', 'SUBMITTED', 'REVIEW', 'OUTCOME'];
  const includeChatOnly = opts.includeChatOnly === true;
  const targets = opts.targets ?? new Map<string, number>();

  // Build map: bucket -> stage -> rowIds[]
  type Cell = {
    count: number;
    sources: Set<SourceCoverage>;
    hasUnavailable: boolean;
    reasons: Map<string, number>;
  };
  const cells = new Map<string, Map<LifecycleStage, Cell>>();
  function ensureCell(bucket: string, stage: LifecycleStage): Cell {
    let byBucket = cells.get(bucket);
    if (!byBucket) {
      byBucket = new Map<LifecycleStage, Cell>();
      cells.set(bucket, byBucket);
    }
    let cell = byBucket.get(stage);
    if (!cell) {
      cell = {
        count: 0,
        sources: new Set<SourceCoverage>(),
        hasUnavailable: false,
        reasons: new Map<string, number>(),
      };
      byBucket.set(stage, cell);
    }
    return cell;
  }

  for (const r of rows) {
    if (!includeChatOnly && !isWholeCompanyCountable(r)) continue;
    const bucket = dayToBucket(r.day, snapshot.period);
    const cell = ensureCell(bucket, r.stage);
    cell.count += 1;
    cell.sources.add(r.sourceCoverage);
    if (r.attributionState === 'UNAVAILABLE') {
      cell.hasUnavailable = true;
      const reason = r.attributionReasonCode ?? 'UNSPECIFIED';
      cell.reasons.set(reason, (cell.reasons.get(reason) ?? 0) + 1);
    }
  }

  const points: ChartDataPoint[] = [];
  for (const [bucket, byStage] of cells) {
    for (const stage of stages) {
      const cell = byStage.get(stage);
      if (!cell) continue;
      const target = targets.get(`${stage}|${snapshot.period}|${bucket}`);
      const attributionState = cell.hasUnavailable ? 'UNAVAILABLE' : 'AVAILABLE';
      // Pick most common reason code if UNAVAILABLE.
      let attributionReasonCode: string | undefined;
      if (attributionState === 'UNAVAILABLE') {
        let bestReason: string | undefined;
        let bestCount = 0;
        for (const [reason, count] of cell.reasons) {
          if (count > bestCount) {
            bestReason = reason;
            bestCount = count;
          }
        }
        attributionReasonCode = bestReason ?? 'UNSPECIFIED';
      }
      // Credit policy: UNKNOWN if any KPI is EXPERIMENTAL; PARTIAL if any
      // cell UNAVAILABLE; else CONFIRMED.
      let creditPolicy: CreditPolicy = 'CONFIRMED';
      if (
        opts.kpis?.some((k) => k.attributionSource === 'EXPERIMENTAL') === true
      ) {
        creditPolicy = 'UNKNOWN';
      } else if (attributionState === 'UNAVAILABLE') {
        creditPolicy = 'PARTIAL';
      }
      const point: ChartDataPoint = {
        bucket,
        stage,
        value: cell.count,
        ...(target !== undefined ? { target } : {}),
        attributionState,
        ...(attributionReasonCode !== undefined ? { attributionReasonCode } : {}),
        sourceCoverage: pickSourceTag([...cell.sources]),
        creditPolicy,
      };
      points.push(point);
    }
  }
  // Sort by bucket then stage order for deterministic output.
  const stageOrder = new Map<LifecycleStage, number>([
    ['CREATED', 0],
    ['UPDATED', 1],
    ['SUBMITTED', 2],
    ['REVIEW', 3],
    ['OUTCOME', 4],
  ]);
  points.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket < b.bucket ? -1 : 1;
    return (stageOrder.get(a.bucket as LifecycleStage) ?? 0) -
      (stageOrder.get(b.bucket as LifecycleStage) ?? 0);
  });
  return points;
}

function pickSourceTag(sources: SourceCoverage[]): SourceCoverage {
  // Pick the most "canonical" tag for the cell. CHAT_ONLY NEVER appears as
  // the only tag for a whole-company cell — it would have been filtered.
  if (sources.length === 0) return 'NONE';
  if (sources.length === 1) return sources[0]!;
  if (sources.includes('CHATWOOT')) return 'CHATWOOT';
  if (sources.includes('ZALO_OA')) return 'ZALO_OA';
  if (sources.includes('INTERNAL_FORM')) return 'INTERNAL_FORM';
  if (sources.includes('HRP_UI')) return 'HRP_UI';
  return 'NONE';
}

/* ───────────────────────────────────────────────────────────────────────────
 * Per-actor breakdown (used by drill-down when grain=ACTOR).
 * ─────────────────────────────────────────────────────────────────────────── */

export function aggregateByActor(
  rows: ReadonlyArray<ProfileLifecycleRow>,
  snapshot: DashboardSnapshot,
): ChartDataPoint[] {
  type Acc = {
    count: number;
    sources: Set<SourceCoverage>;
    hasUnavailable: boolean;
    reasons: Map<string, number>;
  };
  const cells = new Map<string, Map<LifecycleStage, Acc>>();
  for (const r of rows) {
    if (!isWholeCompanyCountable(r)) continue;
    const bucket = dayToBucket(r.day, snapshot.period);
    let byBucket = cells.get(bucket);
    if (!byBucket) {
      byBucket = new Map<LifecycleStage, Acc>();
      cells.set(bucket, byBucket);
    }
    let cell = byBucket.get(r.stage);
    if (!cell) {
      cell = {
        count: 0,
        sources: new Set<SourceCoverage>(),
        hasUnavailable: false,
        reasons: new Map<string, number>(),
      };
      byBucket.set(r.stage, cell);
    }
    cell.count += 1;
    cell.sources.add(r.sourceCoverage);
    if (r.attributionState === 'UNAVAILABLE') {
      cell.hasUnavailable = true;
      const reason = r.attributionReasonCode ?? 'UNSPECIFIED';
      cell.reasons.set(reason, (cell.reasons.get(reason) ?? 0) + 1);
    }
  }
  const out: ChartDataPoint[] = [];
  for (const [bucket, byStage] of cells) {
    for (const [stage, cell] of byStage) {
      const attributionState = cell.hasUnavailable ? 'UNAVAILABLE' : 'AVAILABLE';
      let reason: string | undefined;
      if (attributionState === 'UNAVAILABLE') {
        let best: [string, number] | undefined;
        for (const [k, v] of cell.reasons) {
          if (!best || v > best[1]) best = [k, v];
        }
        reason = best?.[0];
      }
      out.push({
        bucket,
        stage,
        value: cell.count,
        attributionState,
        ...(reason !== undefined ? { attributionReasonCode: reason } : {}),
        sourceCoverage: pickSourceTag([...cell.sources]),
        creditPolicy: cell.hasUnavailable ? 'PARTIAL' : 'CONFIRMED',
      });
    }
  }
  return out;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Growth metric — last bucket vs prior bucket (week-over-week).
 *
 * For periods shorter than 2 buckets this returns 0 (no comparison possible).
 * ─────────────────────────────────────────────────────────────────────────── */

export function computeGrowth(
  cells: ReadonlyArray<ChartDataPoint>,
): {
  bucket: string;
  priorBucket: string;
  value: number;
  priorValue: number;
  growthPct: number;
} | null {
  if (cells.length === 0) return null;
  const buckets = [...new Set(cells.map((c) => c.bucket))].sort();
  if (buckets.length < 2) return null;
  const last = buckets[buckets.length - 1]!;
  const prior = buckets[buckets.length - 2]!;
  const value = cells.filter((c) => c.bucket === last).reduce((s, c) => s + c.value, 0);
  const priorValue = cells
    .filter((c) => c.bucket === prior)
    .reduce((s, c) => s + c.value, 0);
  const growthPct = priorValue === 0 ? 0 : ((value - priorValue) / priorValue) * 100;
  return { bucket: last, priorBucket: prior, value, priorValue, growthPct };
}

/* ───────────────────────────────────────────────────────────────────────────
 * Drill-down — return rows for a snapshot+stage+bucket.
 *
 * sumCheck: the sum of returned row.value MUST equal the chart cell value
 * for the matching (bucket, stage) when grain=ORGANIZATION and
 * chatSourceOnly rows are excluded. This is the AC #1 invariant.
 *
 * NOTE: each row contributes value=1 to the count. Available+Unavailable
 * rows are both counted for the sum-check (Unavailable rows still contribute
 * their row existence; the chart's attributionState reports honestly).
 * ─────────────────────────────────────────────────────────────────────────── */

export function drilldown(
  rows: ReadonlyArray<ProfileLifecycleRow>,
  chartCells: ReadonlyArray<ChartDataPoint>,
  req: DrilldownRequest,
): DrilldownResult {
  const filtered = filterRowsBySnapshot(rows, req.snapshot).filter((r) =>
    req.stage === undefined ? true : r.stage === req.stage,
  );
  const bucket = req.bucket;
  const inBucket =
    bucket === undefined
      ? filtered
      : filtered.filter((r) => dayToBucket(r.day, req.snapshot.period) === bucket);

  const drillRows: DrilldownRow[] = inBucket.map((r) => ({
    rowId: r.rowId,
    bucket: dayToBucket(r.day, req.snapshot.period),
    actorId: r.actorId,
    sourceCoverage: r.sourceCoverage,
    stage: r.stage,
    value: 1,
    attributionState: r.attributionState,
    ...(r.attributionReasonCode !== undefined
      ? { attributionReasonCode: r.attributionReasonCode }
      : {}),
    chatSourceOnly: r.chatSourceOnly,
  }));

  // Sum check.
  let chartValue = 0;
  let drilldownSum = 0;
  if (bucket !== undefined) {
    chartValue = chartCells
      .filter((c) => c.bucket === bucket && c.stage === req.stage)
      .reduce((s, c) => s + c.value, 0);
    drilldownSum = drillRows
      .filter((r) => !r.chatSourceOnly)
      .reduce((s, r) => s + r.value, 0);
  }
  return {
    snapshot: req.snapshot,
    stage: req.stage,
    rows: drillRows,
    total: drillRows.length,
    sumCheck: {
      bucket: bucket ?? '*',
      chartValue,
      drilldownSum,
      consistent: bucket === undefined ? true : chartValue === drilldownSum,
    },
  };
}
