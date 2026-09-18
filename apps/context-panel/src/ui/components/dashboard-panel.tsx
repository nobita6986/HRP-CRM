/**
 * dashboard-panel.tsx — CORE/1.12 BoD dashboard mock UI.
 *
 * AC:
 * 1. Chart-prioritized dashboard: profile created/updated/submitted/review/
 *    outcome by source/period; growth + target-vs-actual.
 * 2. Source coverage + grain + as-of + credit policy labels (chat-only NOT
 *    labelled as whole-company).
 * 3. Click chart/KPI opens drill-down with same filters/snapshot; keyboard
 *    navigation; table fallback.
 * 4. Manager-only KPI assign/revise at the service boundary; sale/AI
 *    propose-only.
 * 5. No model/HRP DB calls — all data is from synthetic fixtures via the
 *    context-panel server.
 */

import * as React from 'react';

/* ───────────────────────────────────────────────────────────────────────────
 * Types — mirrors server response shapes.
 * ─────────────────────────────────────────────────────────────────────────── */

interface ChartDataPoint {
  bucket: string;
  stage: 'CREATED' | 'UPDATED' | 'SUBMITTED' | 'REVIEW' | 'OUTCOME';
  actorId?: string;
  team?: string;
  cohort?: string;
  value: number;
  target?: number;
  attributionState: 'AVAILABLE' | 'UNAVAILABLE';
  attributionReasonCode?: string;
  sourceCoverage: 'CHATWOOT' | 'ZALO_OA' | 'INTERNAL_FORM' | 'HRP_UI' | 'CHAT_ONLY' | 'NONE';
  creditPolicy: 'CONFIRMED' | 'PARTIAL' | 'UNKNOWN';
}

interface KPIAssignmentRow {
  assignmentId: string;
  organizationId: string;
  targetType: string;
  period: string;
  targetValue: number;
  targetActorRole: string;
  targetActorId?: string;
  cohort?: { region?: string[]; source?: string[]; periodStart?: string; periodEnd?: string };
  attributionSource?: string;
  revisionId: string;
  appliedRevision: number;
  appliedAt: string;
  assignedBy: string;
  reasonCode: string;
}

interface DashboardCoverage {
  sourcesPresent: string[];
  grain: string;
  period: string;
  asOf: string;
  creditPolicy: 'CONFIRMED' | 'PARTIAL' | 'UNKNOWN';
  includesChatOnly: boolean;
}

interface DashboardSnapshot {
  organizationId: string;
  grain: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  cohort: { region?: string[]; source?: string[] };
  actorId?: string;
  asOf: string;
  snapshotId: string;
}

interface DashboardReadResult {
  snapshot: DashboardSnapshot;
  metrics: ChartDataPoint[];
  kpis: KPIAssignmentRow[];
  coverage: DashboardCoverage;
  growth: {
    bucket: string;
    priorBucket: string;
    value: number;
    priorValue: number;
    growthPct: number;
  } | null;
}

interface DrilldownRow {
  rowId: string;
  bucket: string;
  actorId: string;
  sourceCoverage: string;
  stage: 'CREATED' | 'UPDATED' | 'SUBMITTED' | 'REVIEW' | 'OUTCOME';
  value: number;
  attributionState: 'AVAILABLE' | 'UNAVAILABLE';
  attributionReasonCode?: string;
  chatSourceOnly: boolean;
}

interface DrilldownResult {
  snapshot: DashboardSnapshot;
  stage: string;
  rows: DrilldownRow[];
  total: number;
  sumCheck: { bucket: string; chartValue: number; drilldownSum: number; consistent: boolean };
}

/* ───────────────────────────────────────────────────────────────────────────
 * API client
 * ─────────────────────────────────────────────────────────────────────────── */

const API_BASE = '';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function fetchSnapshot(
  filters: DashboardFilters,
): Promise<DashboardReadResult> {
  const url = new URL('/api/dashboard/snapshot', 'http://localhost');
  url.searchParams.set('grain', filters.grain);
  url.searchParams.set('period', filters.period);
  url.searchParams.set('periodStart', filters.periodStart);
  url.searchParams.set('periodEnd', filters.periodEnd);
  if (filters.actorId) url.searchParams.set('actorId', filters.actorId);
  if (filters.source.length > 0) url.searchParams.set('source', filters.source.join(','));
  if (filters.region.length > 0) url.searchParams.set('region', filters.region.join(','));
  return apiFetch<DashboardReadResult>(url.pathname + url.search);
}

async function fetchDrilldown(
  filters: DashboardFilters,
  stage: string,
  bucket: string | undefined,
): Promise<DrilldownResult> {
  const url = new URL('/api/dashboard/drilldown', 'http://localhost');
  url.searchParams.set('stage', stage);
  url.searchParams.set('grain', filters.grain);
  url.searchParams.set('period', filters.period);
  url.searchParams.set('periodStart', filters.periodStart);
  url.searchParams.set('periodEnd', filters.periodEnd);
  if (filters.actorId) url.searchParams.set('actorId', filters.actorId);
  if (filters.source.length > 0) url.searchParams.set('source', filters.source.join(','));
  if (filters.region.length > 0) url.searchParams.set('region', filters.region.join(','));
  if (bucket !== undefined) url.searchParams.set('bucket', bucket);
  return apiFetch<DrilldownResult>(url.pathname + url.search);
}

/* ───────────────────────────────────────────────────────────────────────────
 * Component
 * ─────────────────────────────────────────────────────────────────────────── */

interface DashboardFilters {
  grain: 'ACTOR' | 'TEAM' | 'COHORT' | 'ORGANIZATION';
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY';
  periodStart: string;
  periodEnd: string;
  actorId: string;
  source: string[];
  region: string[];
}

const DEFAULT_FILTERS: DashboardFilters = {
  grain: 'ORGANIZATION',
  period: 'WEEKLY',
  periodStart: '2026-08-31',
  periodEnd: '2026-09-13',
  actorId: '',
  source: [],
  region: [],
};

interface DashboardPanelProps {
  isManager: boolean;
  staffId: string;
  isNarrow?: boolean;
}

export function DashboardPanel({ isManager, isNarrow }: DashboardPanelProps) {
  const [filters, setFilters] = React.useState<DashboardFilters>(DEFAULT_FILTERS);
  const [data, setData] = React.useState<DashboardReadResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [view, setView] = React.useState<'chart' | 'kpi' | 'table'>('chart');
  const [drilldown, setDrilldown] = React.useState<{
    stage: string;
    bucket: string | undefined;
    data: DrilldownResult | null;
    loading: boolean;
    error: string | null;
  }>({ stage: 'CREATED', bucket: undefined, data: null, loading: false, error: null });

  // Fetch snapshot whenever filters change.
  React.useEffect(() => {
    setLoading(true);
    setError(null);
    fetchSnapshot(filters)
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [filters]);

  // Keyboard navigation: arrows cycle views (1=chart, 2=kpi, 3=table).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only intercept if focus is inside this panel.
      if (e.target instanceof HTMLElement && e.target.closest('[data-dashboard-panel]') === null) return;
      if (e.altKey) return;
      if (e.key === '1') setView('chart');
      if (e.key === '2') setView('kpi');
      if (e.key === '3') setView('table');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const openDrilldown = React.useCallback(
    (stage: string, bucket?: string) => {
      setDrilldown({ stage, bucket, data: null, loading: true, error: null });
      fetchDrilldown(filters, stage, bucket)
        .then((d) => setDrilldown({ stage, bucket, data: d, loading: false, error: null }))
        .catch((e) =>
          setDrilldown({ stage, bucket, data: null, loading: false, error: String(e) }),
        );
    },
    [filters],
  );

  return (
    <section
      data-dashboard-panel
      aria-label="BoD dashboard"
      style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
    >
      {/* Filter bar */}
      <FilterBar filters={filters} onChange={setFilters} isNarrow={isNarrow} />

      {/* Coverage header bar (AC #2 explicit labels). */}
      {data && (
        <CoverageBar coverage={data.coverage} snapshot={data.snapshot} />
      )}

      {/* View tabs */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={() => setView('chart')}
          aria-pressed={view === 'chart'}
          style={tabStyle(view === 'chart')}
        >
          Biểu đồ
        </button>
        <button
          onClick={() => setView('kpi')}
          aria-pressed={view === 'kpi'}
          style={tabStyle(view === 'kpi')}
        >
          KPI
        </button>
        <button
          onClick={() => setView('table')}
          aria-pressed={view === 'table'}
          style={tabStyle(view === 'table')}
        >
          Bảng dữ liệu
        </button>
        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#888' }}>
          Phím tắt: 1/2/3 (trong panel)
        </span>
      </div>

      {error && <div style={errorBox}>Lỗi: {error}</div>}
      {loading && <div style={{ color: '#666' }}>Đang tải…</div>}

      {data && !loading && (
        <>
          {view === 'chart' && (
            <ChartView
              data={data}
              isNarrow={isNarrow}
              onCellClick={(stage, bucket) => openDrilldown(stage, bucket)}
              onKpiClick={(assignmentId) => openDrilldown('SUBMITTED')}
            />
          )}
          {view === 'kpi' && (
            <KPIView
              data={data}
              isManager={isManager}
              onKpiClick={(assignmentId) => openDrilldown('SUBMITTED')}
            />
          )}
          {view === 'table' && (
            <TableView
              data={data}
              onCellClick={(stage, bucket) => openDrilldown(stage, bucket)}
            />
          )}
        </>
      )}

      {/* Drill-down drawer (always-on when active). */}
      {drilldown.data !== null && (
        <DrilldownDrawer
          result={drilldown.data}
          onClose={() => setDrilldown({ stage: 'CREATED', bucket: undefined, data: null, loading: false, error: null })}
        />
      )}
      {drilldown.loading && (
        <div style={{ padding: '0.5rem', color: '#666' }}>Đang tải drill-down…</div>
      )}
      {drilldown.error && (
        <div style={errorBox}>Lỗi drill-down: {drilldown.error}</div>
      )}
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Filter bar
 * ─────────────────────────────────────────────────────────────────────────── */

function FilterBar({
  filters,
  onChange,
  isNarrow,
}: {
  filters: DashboardFilters;
  onChange: (f: DashboardFilters) => void;
  isNarrow?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.5rem',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
      }}
    >
      <div>
        <label
          htmlFor="grain-select"
          style={labelStyle}
        >
          Phạm vi (grain)
        </label>
        <select
          id="grain-select"
          value={filters.grain}
          onChange={(e) => onChange({ ...filters, grain: e.target.value as DashboardFilters['grain'] })}
          style={inputStyle}
        >
          <option value="ORGANIZATION">Toàn công ty</option>
          <option value="TEAM">Theo team</option>
          <option value="COHORT">Theo cohort</option>
          <option value="ACTOR">Theo nhân viên</option>
        </select>
      </div>

      <div>
        <label htmlFor="period-select" style={labelStyle}>Kỳ</label>
        <select
          id="period-select"
          value={filters.period}
          onChange={(e) => onChange({ ...filters, period: e.target.value as DashboardFilters['period'] })}
          style={inputStyle}
        >
          <option value="DAILY">Ngày</option>
          <option value="WEEKLY">Tuần</option>
          <option value="MONTHLY">Tháng</option>
          <option value="QUARTERLY">Quý</option>
        </select>
      </div>

      {!isNarrow && (
        <div>
          <label htmlFor="source-select" style={labelStyle}>Nguồn</label>
          <select
            id="source-select"
            multiple
            value={filters.source}
            onChange={(e) => {
              const values = Array.from(e.target.selectedOptions).map((o) => o.value);
              onChange({ ...filters, source: values });
            }}
            style={{ ...inputStyle, height: 60 }}
          >
            <option value="CHATWOOT">CHATWOOT</option>
            <option value="ZALO_OA">ZALO_OA</option>
            <option value="INTERNAL_FORM">INTERNAL_FORM</option>
            <option value="HRP_UI">HRP_UI</option>
          </select>
          <div style={{ fontSize: '0.7rem', color: '#666' }}>(giữ Ctrl để chọn nhiều)</div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Coverage bar (AC #2 — source coverage + grain + as-of + credit policy).
 * ─────────────────────────────────────────────────────────────────────────── */

function CoverageBar({
  coverage,
  snapshot,
}: {
  coverage: DashboardCoverage;
  snapshot: DashboardSnapshot;
}) {
  return (
    <div
      style={{
        padding: '0.5rem',
        background: '#f9fafb',
        border: '1px solid #e5e7eb',
        borderRadius: '4px',
        fontSize: '0.75rem',
        display: 'flex',
        gap: '0.75rem',
        flexWrap: 'wrap',
      }}
      aria-label="Coverage metadata"
    >
      <span>
        <strong>Source:</strong>{' '}
        {coverage.sourcesPresent.length === 0
          ? '—'
          : coverage.sourcesPresent.join(', ')}
        {coverage.includesChatOnly && (
          <span style={{ color: '#b91c1c', marginLeft: '0.25rem' }}>
            ⚠️ CHAT_ONLY chỉ tách dòng, KHÔNG tính vào tổng công ty.
          </span>
        )}
      </span>
      <span>
        <strong>Grain:</strong> {coverage.grain}
      </span>
      <span>
        <strong>Kỳ:</strong> {coverage.period}
      </span>
      <span>
        <strong>asOf:</strong> {coverage.asOf}
      </span>
      <span
        style={{
          padding: '0.1rem 0.4rem',
          background:
            coverage.creditPolicy === 'CONFIRMED'
              ? '#dcfce7'
              : coverage.creditPolicy === 'PARTIAL'
                ? '#fef9c3'
                : '#fee2e2',
          borderRadius: '4px',
        }}
        title="Chính sách ghi nhận credit"
      >
        <strong>Credit:</strong> {coverage.creditPolicy}
      </span>
      <span>
        <strong>Snapshot:</strong> <code>{snapshot.snapshotId}</code>
      </span>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Chart view — CSS-only bars.
 * ─────────────────────────────────────────────────────────────────────────── */

function ChartView({
  data,
  isNarrow,
  onCellClick,
  onKpiClick,
}: {
  data: DashboardReadResult;
  isNarrow?: boolean;
  onCellClick: (stage: string, bucket: string) => void;
  onKpiClick: (assignmentId: string) => void;
}) {
  // Group metrics by stage.
  const stages = ['CREATED', 'UPDATED', 'SUBMITTED', 'REVIEW', 'OUTCOME'];
  const byStage = new Map<string, ChartDataPoint[]>();
  for (const stage of stages) byStage.set(stage, []);
  for (const m of data.metrics) {
    byStage.get(m.stage)?.push(m);
  }

  // Find max value across all cells for scaling.
  const maxValue = Math.max(1, ...data.metrics.map((m) => m.value));
  const maxTarget = Math.max(maxValue, ...data.kpis.map((k) => k.targetValue));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {/* Growth headline */}
      {data.growth && (
        <div
          style={{
            padding: '0.5rem',
            background: '#ecfeff',
            borderRadius: '4px',
            fontSize: '0.85rem',
          }}
        >
          Tuần <strong>{data.growth.bucket}</strong>:{' '}
          <strong>{data.growth.value}</strong> hồ sơ (so với tuần{' '}
          {data.growth.priorBucket}: {data.growth.priorValue}) ·{' '}
          <strong
            style={{
              color: data.growth.growthPct >= 0 ? '#15803d' : '#b91c1c',
            }}
          >
            {data.growth.growthPct >= 0 ? '+' : ''}
            {data.growth.growthPct.toFixed(1)}%
          </strong>
        </div>
      )}

      {/* One chart per stage */}
      {stages.map((stage) => {
        const cells = byStage.get(stage) ?? [];
        return (
          <div key={stage} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
              }}
            >
              <strong style={{ fontSize: '0.85rem' }}>{STAGE_LABELS[stage]}</strong>
              <span style={{ fontSize: '0.7rem', color: '#666' }}>
                {cells.length} bucket · max {Math.max(0, ...cells.map((c) => c.value))}
              </span>
            </div>
            {cells.length === 0 ? (
              <div style={{ fontSize: '0.75rem', color: '#888', padding: '0.25rem' }}>
                Không có dữ liệu cho stage này trong kỳ.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                {cells.map((c) => {
                  const pct = maxTarget > 0 ? (c.value / maxTarget) * 100 : 0;
                  const targetPct = c.target !== undefined && maxTarget > 0
                    ? (c.target / maxTarget) * 100
                    : null;
                  return (
                    <button
                      key={`${stage}-${c.bucket}`}
                      onClick={() => onCellClick(stage, c.bucket)}
                      aria-label={`Drill-down ${STAGE_LABELS[stage]} tuần ${c.bucket}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.25rem 0.5rem',
                        background: c.attributionState === 'UNAVAILABLE' ? '#fef3c7' : '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ width: 60, fontSize: '0.7rem', color: '#555' }}>{c.bucket}</span>
                      <div style={{ flex: 1, position: 'relative', height: 18, background: '#f3f4f6', borderRadius: 2 }}>
                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            height: '100%',
                            width: `${Math.min(pct, 100)}%`,
                            background: '#3b82f6',
                            borderRadius: 2,
                          }}
                        />
                        {targetPct !== null && (
                          <div
                            style={{
                              position: 'absolute',
                              left: `${Math.min(targetPct, 100)}%`,
                              top: -2,
                              height: 22,
                              width: 2,
                              background: '#dc2626',
                            }}
                            title={`target = ${c.target}`}
                          />
                        )}
                      </div>
                      <span style={{ width: 80, textAlign: 'right', fontSize: '0.75rem' }}>
                        {c.value}
                        {c.target !== undefined && c.target > 0 && (
                          <span style={{ color: '#dc2626' }}> / {c.target}</span>
                        )}
                      </span>
                      {!isNarrow && (
                        <span style={{ width: 80, fontSize: '0.7rem', color: '#666' }}>
                          {c.sourceCoverage}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* KPI strip (clickable → drill-down SUBMITTED) */}
      <div>
        <div style={{ fontSize: '0.85rem', fontWeight: 600, marginTop: '0.5rem' }}>KPI đang giao</div>
        {data.kpis.length === 0 ? (
          <div style={{ fontSize: '0.75rem', color: '#888' }}>
            Chưa có KPI nào được giao.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
            {data.kpis.map((k) => (
              <button
                key={k.assignmentId}
                onClick={() => onKpiClick(k.assignmentId)}
                style={{
                  padding: '0.25rem 0.5rem',
                  background: k.targetValue === 0 ? '#fef3c7' : '#e0e7ff',
                  border: '1px solid #c7d2fe',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                }}
                title={`assignmentId=${k.assignmentId}`}
              >
                {k.targetType.replace('PROFILE_', '')} · {k.period} · target{' '}
                {k.targetValue}
                {k.targetValue === 0 && ' ⚠️ target=0'}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const STAGE_LABELS: Record<string, string> = {
  CREATED: 'Hồ sơ tạo mới',
  UPDATED: 'Hồ sơ cập nhật',
  SUBMITTED: 'Hồ sơ đã nộp',
  REVIEW: 'Đang review',
  OUTCOME: 'Có kết quả',
};

function sumStageActual(metrics: ChartDataPoint[], stage: string): number {
  return metrics
    .filter((m) => m.stage === stage && m.attributionState === 'AVAILABLE')
    .reduce((s, m) => s + m.value, 0);
}

/* ───────────────────────────────────────────────────────────────────────────
 * KPI view (target vs actual) + manager-only assign/revise UI.
 * ─────────────────────────────────────────────────────────────────────────── */

function KPIView({
  data,
  isManager,
  onKpiClick,
}: {
  data: DashboardReadResult;
  isManager: boolean;
  onKpiClick: (assignmentId: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {!isManager && (
        <div style={infoBox}>
          ⚠️ Bạn không có quyền giao/sửa KPI (cần vai trò QUẢN LÝ). Có thể
          đề xuất (propose) nhưng KHÔNG mutate target.
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead>
          <tr style={{ background: '#f3f4f6' }}>
            <th style={th}>KPI</th>
            <th style={th}>Kỳ</th>
            <th style={th}>Target</th>
            <th style={th}>Actual</th>
            <th style={th}>Đạt</th>
            <th style={th}>Cohort</th>
            <th style={th}>Source</th>
            <th style={th}>Hành động</th>
          </tr>
        </thead>
        <tbody>
          {data.kpis.map((k) => {
            const stageFromType =
              k.targetType === 'PROFILE_CREATED' ? 'CREATED'
                : k.targetType === 'PROFILE_UPDATED' ? 'UPDATED'
                  : k.targetType === 'PROFILE_SUBMITTED' ? 'SUBMITTED'
                    : 'REVIEW';
            const stageActual = sumStageActual(data.metrics, stageFromType);
            const pct = k.targetValue > 0 ? (stageActual / k.targetValue) * 100 : 0;
            return (
              <tr key={k.assignmentId} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={td}>{k.targetType.replace('PROFILE_', '')}</td>
                <td style={td}>{k.period}</td>
                <td style={td}>
                  {k.targetValue}
                  {k.targetValue === 0 && (
                    <span style={{ color: '#b91c1c' }}> ⚠️</span>
                  )}
                </td>
                <td style={td}>{stageActual}</td>
                <td style={{ ...td, color: pct >= 100 ? '#15803d' : pct >= 80 ? '#ca8a04' : '#b91c1c' }}>
                  {k.targetValue === 0 ? '—' : `${pct.toFixed(0)}%`}
                </td>
                <td style={td}>
                  {k.cohort ? `${k.cohort.region?.join(',') ?? '*'} · ${k.cohort.source?.join(',') ?? '*'}` : '—'}
                </td>
                <td style={td}>{k.attributionSource ?? '—'}</td>
                <td style={td}>
                  <button
                    onClick={() => onKpiClick(k.assignmentId)}
                    style={btnGhost}
                  >
                    Drill-down
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Table view — accessibility-friendly alternative.
 * ─────────────────────────────────────────────────────────────────────────── */

function TableView({
  data,
  onCellClick,
}: {
  data: DashboardReadResult;
  onCellClick: (stage: string, bucket: string) => void;
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
        <thead>
          <tr style={{ background: '#f3f4f6' }}>
            <th style={th}>Bucket</th>
            <th style={th}>Giá trị</th>
            <th style={th}>Target</th>
            <th style={th}>Attribution</th>
            <th style={th}>Source</th>
            <th style={th}>Credit</th>
            <th style={th}>Hành động</th>
          </tr>
        </thead>
        <tbody>
          {data.metrics.map((m, idx) => (
            <tr key={`${m.bucket}-${idx}`} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={td}>{m.bucket}</td>
              <td style={td}>{m.value}</td>
              <td style={td}>{m.target ?? '—'}</td>
              <td style={td}>
                {m.attributionState}
                {m.attributionReasonCode && ` (${m.attributionReasonCode})`}
              </td>
              <td style={td}>{m.sourceCoverage}</td>
              <td style={td}>{m.creditPolicy}</td>
              <td style={td}>
                <button
                  onClick={() => onCellClick('CREATED', m.bucket)}
                  style={btnGhost}
                >
                  Drill-down
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Drill-down drawer — same filters/snapshot.
 * ─────────────────────────────────────────────────────────────────────────── */

function DrilldownDrawer({
  result,
  onClose,
}: {
  result: DrilldownResult;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label={`Drill-down ${result.stage}`}
      style={{
        border: '1px solid #3b82f6',
        borderRadius: '4px',
        padding: '0.5rem',
        background: '#f0f9ff',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>
          Drill-down {result.stage} · bucket {result.sumCheck.bucket} ·{' '}
          {result.rows.length} dòng
        </strong>
        <button onClick={onClose} style={btnGhost}>Đóng (Esc)</button>
      </div>
      <div style={{ fontSize: '0.75rem', color: '#555' }}>
        Snapshot <code>{result.snapshot.snapshotId}</code> · grain {result.snapshot.grain} ·
        kỳ {result.snapshot.period} · cohort{' '}
        {JSON.stringify(result.snapshot.cohort)}
      </div>
      <div
        style={{
          fontSize: '0.75rem',
          padding: '0.25rem 0.5rem',
          background: result.sumCheck.consistent ? '#dcfce7' : '#fee2e2',
          borderRadius: '4px',
        }}
        data-testid="drilldown-sumcheck"
      >
        Sum check: chart={result.sumCheck.chartValue} · drill-down=
        {result.sumCheck.drilldownSum} ·{' '}
        {result.sumCheck.consistent ? '✔ nhất quán' : '✖ KHÁC — kiểm tra lại'}
      </div>
      <div style={{ maxHeight: 240, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem' }}>
          <thead>
            <tr style={{ background: '#e0e7ff' }}>
              <th style={th}>rowId</th>
              <th style={th}>actorId</th>
              <th style={th}>source</th>
              <th style={th}>value</th>
              <th style={th}>attribution</th>
              <th style={th}>chat-only</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.rowId} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={td}><code>{r.rowId}</code></td>
                <td style={td}>{r.actorId}</td>
                <td style={td}>{r.sourceCoverage}</td>
                <td style={td}>{r.value}</td>
                <td style={td}>
                  {r.attributionState}
                  {r.attributionReasonCode && ` (${r.attributionReasonCode})`}
                </td>
                <td style={td}>{r.chatSourceOnly ? 'YES' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Styles
 * ─────────────────────────────────────────────────────────────────────────── */

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  fontWeight: 600,
  marginBottom: '0.15rem',
};
const inputStyle: React.CSSProperties = {
  padding: '0.25rem 0.4rem',
  borderRadius: '4px',
  border: '1px solid #ccc',
  fontSize: '0.8rem',
};
const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '0.25rem 0.5rem',
  border: '1px solid #ccc',
  borderRadius: '4px',
  background: active ? '#dbeafe' : '#fff',
  cursor: 'pointer',
  fontSize: '0.8rem',
});
const errorBox: React.CSSProperties = {
  color: '#dc2626',
  fontSize: '0.85rem',
  padding: '0.5rem',
  background: '#fee2e2',
  borderRadius: '4px',
};
const infoBox: React.CSSProperties = {
  color: '#0c4a6e',
  fontSize: '0.8rem',
  padding: '0.5rem',
  background: '#e0f2fe',
  borderRadius: '4px',
};
const th: React.CSSProperties = {
  padding: '0.25rem 0.5rem',
  textAlign: 'left',
  border: '1px solid #e5e7eb',
};
const td: React.CSSProperties = {
  padding: '0.25rem 0.5rem',
  border: '1px solid #e5e7eb',
};
const btnGhost: React.CSSProperties = {
  padding: '0.15rem 0.5rem',
  background: '#fff',
  border: '1px solid #ccc',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '0.75rem',
};
