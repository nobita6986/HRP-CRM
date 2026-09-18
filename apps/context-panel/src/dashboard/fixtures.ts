/**
 * dashboard/fixtures.ts — CORE/1.12 Synthetic BoD dashboard fixtures.
 *
 * Deterministic synthetic data. No PII, no real staff IDs, no real profile
 * IDs. All actorIds are synthetic (staff-sale-A through D). All rowIds are
 * synthetic (`row-...`). Days are anchored to a fixed reference period so
 * tests can assert deterministic counts.
 *
 * Coverage tags explicitly applied:
 *   - CHATWOOT (full org): rows tagged CHATWOOT.
 *   - ZALO_OA (full org): rows tagged ZALO_OA.
 *   - INTERNAL_FORM (full org): rows tagged INTERNAL_FORM.
 *   - HRP_UI (full org): rows tagged HRP_UI.
 *   - CHAT_ONLY (chat-only): rows tagged CHAT_ONLY and `chatSourceOnly=true`.
 *
 * Edge cases built into the fixture (for self-check / browser evidence):
 *   - target=0 case (one KPI assignment has targetValue=0).
 *   - missing review source case (some rows have attribution=UNAVAILABLE
 *     with reasonCode='NO_REVIEW_SOURCE').
 *   - partial period (last week of fixtures is intentionally under-reported
 *     to surface the "kỳ chưa đủ" state).
 *   - growth: last week vs prior week.
 *
 * Credit policy tag:
 *   - CONFIRMED when every cell has source attribution AVAILABLE.
 *   - PARTIAL when some cells are UNAVAILABLE but resolvable.
 *   - UNKNOWN when credit attribution rules are not bound yet (a TBD for
 *     Owner decision — see handoff §limitations).
 *
 * IMPORTANT: NO model is called; NO HRP DB is touched.
 */

import type {
  ProfileLifecycleRow,
  KPIAssignmentRow,
  KPIAssignmentRequest,
  DashboardSnapshot,
  SourceCoverage,
  CreditPolicy,
  LifecycleStage,
} from './types.js';

/* ───────────────────────────────────────────────────────────────────────────
 * Anchor — fixed reference period so tests are deterministic.
 *  - 14 days ending 2026-09-13 (Sunday). Day labels: 2026-08-31..2026-09-13.
 * ─────────────────────────────────────────────────────────────────────────── */

export const FIXTURE_ORG_ID = 'org-001';
export const FIXTURE_ASOF = '2026-09-13T23:59:59.999Z';
export const FIXTURE_PERIOD_START = '2026-08-31';
export const FIXTURE_PERIOD_END = '2026-09-13';

/** Synthetic actors. Reuse staff IDs for traceability with CORE/1.11. */
export const FIXTURE_ACTORS = [
  'staff-sale-A',
  'staff-sale-B',
  'staff-sale-C',
  'staff-sale-D',
] as const;

/** Day labels used in the fixture (inclusive). */
export const FIXTURE_DAYS: string[] = [
  '2026-08-31',
  '2026-09-01',
  '2026-09-02',
  '2026-09-03',
  '2026-09-04',
  '2026-09-05',
  '2026-09-06',
  '2026-09-07',
  '2026-09-08',
  '2026-09-09',
  '2026-09-10',
  '2026-09-11',
  '2026-09-12',
  '2026-09-13',
];

/** Last 3 days = "partial period" (kỳ chưa đủ). */
export const PARTIAL_PERIOD_DAYS: string[] = [
  '2026-09-11',
  '2026-09-12',
  '2026-09-13',
];

/* ───────────────────────────────────────────────────────────────────────────
 * Deterministic seeded RNG (mulberry32) — used to keep fixtures reproducible
 * across runs without depending on Math.random().
 * ─────────────────────────────────────────────────────────────────────────── */

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(0xc0de_b01d);

function pick<T>(arr: readonly T[]): T {
  const i = Math.floor(rng() * arr.length);
  return arr[Math.min(i, arr.length - 1)]!;
}

function weightedPick<T>(arr: Array<[T, number]>): T {
  const total = arr.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [v, w] of arr) {
    r -= w;
    if (r <= 0) return v;
  }
  return arr[arr.length - 1]![0];
}

/* ───────────────────────────────────────────────────────────────────────────
 * Profile lifecycle fixture generator.
 *
 * Returns ~280 rows: 14 days × ~20 rows/day, mixed across actors/sources/
 * stages. Designed to surface target-zero, partial-period, and missing-review
 * edge cases.
 * ─────────────────────────────────────────────────────────────────────────── */

const SOURCES: SourceCoverage[] = [
  'CHATWOOT',
  'ZALO_OA',
  'INTERNAL_FORM',
  'HRP_UI',
  'CHAT_ONLY',
];

const SOURCES_WEIGHTED: Array<[SourceCoverage, number]> = [
  ['CHATWOOT', 5],
  ['ZALO_OA', 4],
  ['INTERNAL_FORM', 3],
  ['HRP_UI', 2],
  ['CHAT_ONLY', 1],
];

const STAGES: Array<['CREATED' | 'UPDATED' | 'SUBMITTED' | 'REVIEW' | 'OUTCOME', number]> = [
  ['CREATED', 5],
  ['UPDATED', 3],
  ['SUBMITTED', 2],
  ['REVIEW', 1],
  ['OUTCOME', 1],
];

const ACTOR_WEIGHTED: Array<[string, number]> = [
  ['staff-sale-A', 4],
  ['staff-sale-B', 3],
  ['staff-sale-C', 2],
  ['staff-sale-D', 1],
];

const ROWS_PER_DAY_FULL = 22;
const ROWS_PER_DAY_PARTIAL = 8;

export function makeProfileLifecycleFixture(): ProfileLifecycleRow[] {
  const rows: ProfileLifecycleRow[] = [];
  let id = 0;
  for (const day of FIXTURE_DAYS) {
    const isPartial = PARTIAL_PERIOD_DAYS.includes(day);
    const rowsForDay = isPartial ? ROWS_PER_DAY_PARTIAL : ROWS_PER_DAY_FULL;
    for (let i = 0; i < rowsForDay; i++) {
      const actorId = weightedPick(ACTOR_WEIGHTED);
      const sourceCoverage = weightedPick(SOURCES_WEIGHTED);
      const stageEntry = weightedPick(STAGES);
      const stage: LifecycleStage = stageEntry;
      id += 1;

      // Missing-review-source edge: 8% of OUTCOME rows in the last week
      // are deliberately marked UNAVAILABLE with reasonCode NO_REVIEW_SOURCE.
      const isOutcome = stage === 'OUTCOME';
      const isLastWeek = isPartial;
      const isMissingReview =
        isOutcome && isLastWeek && rng() < 0.4;
      const attributionState: 'AVAILABLE' | 'UNAVAILABLE' = isMissingReview
        ? 'UNAVAILABLE'
        : 'AVAILABLE';
      const attributionReasonCode = isMissingReview
        ? 'NO_REVIEW_SOURCE'
        : undefined;

      rows.push({
        rowId: `row-${day}-${id.toString(36).padStart(4, '0')}`,
        organizationId: FIXTURE_ORG_ID,
        day,
        actorId,
        sourceCoverage,
        stage,
        attributionState,
        ...(attributionReasonCode !== undefined ? { attributionReasonCode } : {}),
        chatSourceOnly: sourceCoverage === 'CHAT_ONLY',
      });
    }
  }
  return rows;
}

/* ───────────────────────────────────────────────────────────────────────────
 * KPI assignment fixtures — synthetic manager-assigned targets.
 *
 * Built to cover the required edge cases:
 *   - 4 active assignments, one per stage type (PROFILE_CREATED,
 *     PROFILE_UPDATED, PROFILE_SUBMITTED, REVIEW).
 *   - 1 target=0 case (PROFILE_SUBMITTED MONTHLY).
 *   - 1 EXPERIMENTAL source assignment (UNAVAILABLE per contract Q-35).
 *   - 1 partial period (PROFILE_CREATED WEEKLY = partial).
 * ─────────────────────────────────────────────────────────────────────────── */

export function makeKPIAssignmentFixtures(): KPIAssignmentRow[] {
  const now = FIXTURE_ASOF;
  return [
    {
      assignmentId: 'kpi-prof-created-monthly',
      organizationId: FIXTURE_ORG_ID,
      targetType: 'PROFILE_CREATED',
      period: 'MONTHLY',
      targetValue: 200,
      targetActorRole: 'TEAM',
      revisionId: 'rev-001',
      appliedRevision: 1,
      appliedAt: now,
      assignedBy: 'staff-supervisor-001',
      reasonCode: 'INITIAL_ASSIGN',
    },
    {
      assignmentId: 'kpi-prof-created-weekly-partial',
      organizationId: FIXTURE_ORG_ID,
      targetType: 'PROFILE_CREATED',
      period: 'WEEKLY',
      targetValue: 30,
      targetActorRole: 'TEAM',
      revisionId: 'rev-002',
      appliedRevision: 1,
      appliedAt: now,
      assignedBy: 'staff-supervisor-001',
      reasonCode: 'INITIAL_ASSIGN',
    },
    {
      assignmentId: 'kpi-prof-updated-monthly',
      organizationId: FIXTURE_ORG_ID,
      targetType: 'PROFILE_UPDATED',
      period: 'MONTHLY',
      targetValue: 100,
      targetActorRole: 'TEAM',
      revisionId: 'rev-003',
      appliedRevision: 1,
      appliedAt: now,
      assignedBy: 'staff-supervisor-001',
      reasonCode: 'INITIAL_ASSIGN',
    },
    {
      // Target=0 edge case (still schema-valid; schema allowlist allows
      // target=0 when cohort is provided).
      assignmentId: 'kpi-prof-submitted-monthly-target-zero',
      organizationId: FIXTURE_ORG_ID,
      targetType: 'PROFILE_SUBMITTED',
      period: 'MONTHLY',
      targetValue: 0,
      targetActorRole: 'TEAM',
      cohort: {
        region: ['SG'],
        source: ['CHAT_ONLY'],
        periodStart: FIXTURE_PERIOD_START,
        periodEnd: FIXTURE_PERIOD_END,
      },
      attributionSource: 'EXPERIMENTAL',
      revisionId: 'rev-004',
      appliedRevision: 1,
      appliedAt: now,
      assignedBy: 'staff-supervisor-001',
      reasonCode: 'INITIAL_ASSIGN',
    },
    {
      assignmentId: 'kpi-prof-submitted-monthly',
      organizationId: FIXTURE_ORG_ID,
      targetType: 'PROFILE_SUBMITTED',
      period: 'MONTHLY',
      targetValue: 80,
      targetActorRole: 'TEAM',
      revisionId: 'rev-005',
      appliedRevision: 1,
      appliedAt: now,
      assignedBy: 'staff-supervisor-001',
      reasonCode: 'INITIAL_ASSIGN',
    },
    {
      assignmentId: 'kpi-prof-submitted-quarterly',
      organizationId: FIXTURE_ORG_ID,
      targetType: 'PROFILE_SUBMITTED',
      period: 'QUARTERLY',
      targetValue: 240,
      targetActorRole: 'TEAM',
      revisionId: 'rev-006',
      appliedRevision: 1,
      appliedAt: now,
      assignedBy: 'staff-supervisor-001',
      reasonCode: 'INITIAL_ASSIGN',
    },
  ];
}

/** Convert assignment request (manager-only write) into a row. */
export function makeKPIAssignmentRow(
  req: KPIAssignmentRequest,
  assignedBy: string,
  appliedAt: string,
  nextId: number,
): KPIAssignmentRow {
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
  return row;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Coverage + credit policy tag derivation.
 *
 * These are the policy markers the UI must display explicitly (AC #2).
 *  - sourcesPresent: union of fixture sources.
 *  - includesChatOnly: whether chat-only rows are present (they are
 *    NOT labelled as whole-company totals).
 *  - creditPolicy:
 *      CONFIRMED if every row has attribution=AVAILABLE,
 *      PARTIAL if some are UNAVAILABLE but explainable,
 *      UNKNOWN if any KPI is EXPERIMENTAL (Owner Q-35 unresolved).
 * ─────────────────────────────────────────────────────────────────────────── */

export function deriveCoverage(
  rows: ReadonlyArray<ProfileLifecycleRow>,
  kpis: ReadonlyArray<KPIAssignmentRow>,
): {
  sourcesPresent: SourceCoverage[];
  creditPolicy: CreditPolicy;
  includesChatOnly: boolean;
} {
  const sources = new Set<SourceCoverage>();
  let hasUnavailable = false;
  let includesChatOnly = false;
  for (const r of rows) {
    sources.add(r.sourceCoverage);
    if (r.attributionState === 'UNAVAILABLE') hasUnavailable = true;
    if (r.chatSourceOnly) includesChatOnly = true;
  }
  const hasExperimental = kpis.some(
    (k) => k.attributionSource === 'EXPERIMENTAL',
  );
  let creditPolicy: CreditPolicy;
  if (hasExperimental) {
    creditPolicy = 'UNKNOWN';
  } else if (hasUnavailable) {
    creditPolicy = 'PARTIAL';
  } else {
    creditPolicy = 'CONFIRMED';
  }
  return {
    sourcesPresent: [...sources],
    creditPolicy,
    includesChatOnly,
  };
}

/* ───────────────────────────────────────────────────────────────────────────
 * Helper — make a fresh snapshot for tests / initial server seed.
 * ─────────────────────────────────────────────────────────────────────────── */

export function makeDashboardSnapshot(
  overrides?: Partial<DashboardSnapshot>,
): DashboardSnapshot {
  return {
    organizationId: FIXTURE_ORG_ID,
    grain: 'ORGANIZATION',
    period: 'WEEKLY',
    periodStart: FIXTURE_PERIOD_START,
    periodEnd: FIXTURE_PERIOD_END,
    cohort: {},
    asOf: FIXTURE_ASOF,
    snapshotId: `snap-${FIXTURE_PERIOD_START}-${FIXTURE_PERIOD_END}`,
    ...overrides,
  };
}
