/**
 * routing-panel.tsx — CORE/1.11 Routing config + simulator UI.
 *
 * AC:
 * 1. Source assignment (SOURCE_ALLOCATION) vs weighted distribution (WEIGHTED_DISTRIBUTION).
 *    Simulation 10/100 customers with ratio 3:2:1:4.
 * 2. Fallback queue scenarios: offline / capacity / quota / config revision.
 * 3. UI preview 10/100 customers; no real Chatwoot assignment API calls.
 * 4. AI/sale cannot edit weights without manager role — server-side enforcement.
 */

import * as React from 'react';

/* ───────────────────────────────────────────────────────────────────────────
 * Types (mirrors routing/types.ts + server API response)
 * ─────────────────────────────────────────────────────────────────────────── */

interface StaffSummary {
  actorId: string;
  role: string;
  assignedCount: number;
  capacityUsed: number;
  capacityMax: number;
  quotaUsed: number;
  quotaMax: number;
}

interface AssignmentSlot {
  customerIndex: number;
  assigned: boolean;
  staffActorId?: string;
  staffRole?: string;
  reason: string;
  fallbackReason?: string;
}

interface SimulationResult {
  poolId: string;
  poolVersion: number;
  strategy: string;
  mode: string;
  customerCount: number;
  assignments: AssignmentSlot[];
  fallbackQueue: AssignmentSlot[];
  staffSummary: StaffSummary[];
  totalWeight: number;
  seed: number;
}

interface PoolInfo {
  poolId: string;
  displayName: string;
  strategy: string;
  version: number;
  weights?: Array<{ recipientActorId: string; weight: number }>;
}

interface SimulateResponse {
  result: SimulationResult;
  pool: PoolInfo;
}

type FallbackReason =
  | 'ALL_STAFF_OFFLINE'
  | 'ALL_STAFF_AT_CAPACITY'
  | 'ALL_STAFF_QUOTA_EXHAUSTED'
  | 'WEIGHT_ZERO'
  | 'NO_ELIGIBLE_WEIGHT'
  | 'ALL_STAFF_AT_CAPACITY_OR_QUOTA';

const FALLBACK_LABELS: Record<string, string> = {
  ALL_STAFF_OFFLINE: 'Tất cả nhân viên offline',
  ALL_STAFF_AT_CAPACITY: 'Tất cả nhân viên đạt giới hạn capacity',
  ALL_STAFF_QUOTA_EXHAUSTED: 'Tất cả nhân viên hết quota',
  WEIGHT_ZERO: 'Tổng weight = 0',
  NO_ELIGIBLE_WEIGHT: 'Không có staff đủ điều kiện',
  ALL_STAFF_AT_CAPACITY_OR_QUOTA: 'Tất cả nhân viên đạt capacity hoặc quota',
};

const FALLBACK_COLORS: Record<string, string> = {
  ALL_STAFF_OFFLINE: '#fef3c7',
  ALL_STAFF_AT_CAPACITY: '#fee2e2',
  ALL_STAFF_QUOTA_EXHAUSTED: '#fce7f3',
  WEIGHT_ZERO: '#f3e8ff',
  NO_ELIGIBLE_WEIGHT: '#e0e7ff',
  ALL_STAFF_AT_CAPACITY_OR_QUOTA: '#fee2e2',
};

/* ───────────────────────────────────────────────────────────────────────────
 * Scenarios for the simulator
 * ─────────────────────────────────────────────────────────────────────────── */

interface ScenarioDef {
  id: string;
  label: string;
  description: string;
  offlineA?: boolean;
  offlineB?: boolean;
  capacityFull?: boolean;
  quotaFull?: boolean;
  allOffline?: boolean;
  zeroWeight?: boolean;
}

const SCENARIOS: ScenarioDef[] = [
  {
    id: 'normal',
    label: 'Bình thường',
    description: 'Tất cả nhân viên online, còn capacity, còn quota. Tỷ trọng 3:2:1:4.',
  },
  {
    id: 'offline-B',
    label: 'Nhân viên B offline',
    description: 'staff-sale-B offline. Phân bổ lại cho A, C, D theo tỷ trọng.',
    offlineB: true,
  },
  {
    id: 'capacity-full-A',
    label: 'Staff A đạt capacity',
    description: 'staff-sale-A đạt maxCapacity=5. Các khách vượt không được nhận.',
    capacityFull: true,
  },
  {
    id: 'quota-full-C',
    label: 'Staff C hết quota',
    description: 'staff-sale-C hết daily cap=10. Không nhận thêm khách.',
    quotaFull: true,
  },
  {
    id: 'all-offline',
    label: 'Tất cả offline',
    description: 'Không nhân viên nào online → tất cả vào fallback queue.',
    allOffline: true,
  },
  {
    id: 'zero-weight',
    label: 'Tất cả weight = 0',
    description: 'Tổng weight = 0 → không phân bổ được → fallback queue.',
    zeroWeight: true,
  },
];

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

async function listPools(): Promise<{ pools: PoolInfo[] }> {
  return apiFetch('/api/routing/pools');
}

async function simulatePool(
  poolId: string,
  count: 10 | 100,
  scenarioId: string,
  mode: 'batch' | 'realtime',
): Promise<SimulateResponse> {
  return apiFetch(`/api/routing/pools/${encodeURIComponent(poolId)}/simulate?count=${count}&scenario=${scenarioId}&mode=${mode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

/* ───────────────────────────────────────────────────────────────────────────
 * Component
 * ─────────────────────────────────────────────────────────────────────────── */

interface RoutingPanelProps {
  /** Whether the current user is a manager (SUPERVISOR or SYSTEM role). */
  isManager: boolean;
  /** Staff ID for header display. */
  staffId: string;
  isNarrow?: boolean;
}

export function RoutingPanel({ isManager, staffId, isNarrow }: RoutingPanelProps) {
  const [pools, setPools] = React.useState<PoolInfo[]>([]);
  const [selectedPoolId, setSelectedPoolId] = React.useState<string>('');
  const [count, setCount] = React.useState<10 | 100>(10);
  const [mode, setMode] = React.useState<'batch' | 'realtime'>('realtime');
  const [scenarioId, setScenarioId] = React.useState('normal');
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<SimulationResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Load pools on mount
  React.useEffect(() => {
    listPools()
      .then(({ pools }) => {
        setPools(pools);
        if (pools.length > 0 && !selectedPoolId) setSelectedPoolId(pools[0]!.poolId);
      })
      .catch(() => {
        setError('Không tải được danh sách pool.');
      });
  }, []);

  const handleSimulate = React.useCallback(() => {
    if (!selectedPoolId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    simulatePool(selectedPoolId, count, scenarioId, mode)
      .then((res) => {
        setResult(res.result);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [selectedPoolId, count, scenarioId, mode]);

  const selectedPool = pools.find((p) => p.poolId === selectedPoolId);
  const scenario = SCENARIOS.find((s) => s.id === scenarioId);

  return (
    <section aria-label="Routing config và simulator" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* ── Pool selector ── */}
      <div>
        <label
          htmlFor="pool-select"
          style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}
        >
          Pool cấu hình
        </label>
        <select
          id="pool-select"
          value={selectedPoolId}
          onChange={(e) => { setSelectedPoolId(e.target.value); setResult(null); }}
          style={{ width: '100%', padding: '0.375rem', borderRadius: '4px', border: '1px solid #ccc' }}
        >
          {pools.map((p) => (
            <option key={p.poolId} value={p.poolId}>
              {p.displayName} ({p.strategy} v{p.version})
            </option>
          ))}
        </select>
        {!isManager && (
          <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>
            ⚠️ Bạn không có quyền chỉnh sửa cấu hình (cần vai trò QUẢN LÝ).
          </div>
        )}
      </div>

      {/* ── Weights display ── */}
      {selectedPool?.weights && selectedPool.weights.length > 0 && (
        <div
          style={{
            padding: '0.5rem',
            background: '#f5f5f5',
            borderRadius: '4px',
            fontSize: '0.8rem',
          }}
        >
          <strong>Tỷ trọng hiện tại:</strong>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
            {selectedPool.weights.map((w) => (
              <span
                key={w.recipientActorId}
                style={{
                  background: '#e0e7ff',
                  padding: '0.125rem 0.5rem',
                  borderRadius: '999px',
                }}
              >
                {w.recipientActorId}: {w.weight}
              </span>
            ))}
          </div>
          <div style={{ marginTop: '0.25rem', color: '#666' }}>
            Tổng: {selectedPool.weights.reduce((s, w) => s + w.weight, 0)} · Tỷ lệ (3:2:1:4)
          </div>
        </div>
      )}

      {/* ── Count + scenario ── */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label
            htmlFor="count-select"
            style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}
          >
            Số khách
          </label>
          <select
            id="count-select"
            value={count}
            onChange={(e) => setCount(Number(e.target.value) as 10 | 100)}
            style={{ padding: '0.375rem', borderRadius: '4px', border: '1px solid #ccc' }}
          >
            <option value={10}>10 khách</option>
            <option value={100}>100 khách</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="mode-select"
            style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}
          >
            Chế độ
          </label>
          <select
            id="mode-select"
            value={mode}
            onChange={(e) => { setMode(e.target.value as 'batch' | 'realtime'); setResult(null); }}
            style={{ padding: '0.375rem', borderRadius: '4px', border: '1px solid #ccc' }}
            title={mode === 'batch' ? 'Largest remainder (Hamilton)' : 'Smooth weighted round-robin (Nginx)'}
          >
            <option value="batch">Batch — largest remainder</option>
            <option value="realtime">Realtime — smooth WRR</option>
          </select>
        </div>

        <div style={{ flex: 1 }}>
          <label
            htmlFor="scenario-select"
            style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}
          >
            Tình huống
          </label>
          <select
            id="scenario-select"
            value={scenarioId}
            onChange={(e) => { setScenarioId(e.target.value); setResult(null); }}
            style={{ width: '100%', padding: '0.375rem', borderRadius: '4px', border: '1px solid #ccc' }}
          >
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleSimulate}
          disabled={loading || !selectedPoolId}
          style={{
            padding: '0.375rem 1rem',
            borderRadius: '4px',
            background: loading ? '#ccc' : '#2563eb',
            color: '#fff',
            border: 'none',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          {loading ? 'Đang mô phỏng…' : 'Mô phỏng'}
        </button>
      </div>

      {/* ── Scenario description ── */}
      {scenario && (
        <div
          style={{
            fontSize: '0.8rem',
            color: '#555',
            padding: '0.375rem 0.5rem',
            background: '#fef9c3',
            borderRadius: '4px',
            borderLeft: '3px solid #eab308',
          }}
        >
          {scenario.description}
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div style={{ color: '#dc2626', fontSize: '0.875rem', padding: '0.5rem', background: '#fee2e2', borderRadius: '4px' }}>
          Lỗi: {error}
        </div>
      )}

      {/* ── Results ── */}
      {result && (
        <ResultsSection result={result} isNarrow={isNarrow} />
      )}
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Results section
 * ─────────────────────────────────────────────────────────────────────────── */

function ResultsSection({
  result,
  isNarrow,
}: {
  result: SimulationResult;
  isNarrow?: boolean;
}) {
  const assigned = result.assignments.length;
  const fallback = result.fallbackQueue.length;
  const total = result.customerCount;

  // Group fallback reasons
  const fallbackByReason = new Map<string, number>();
  for (const f of result.fallbackQueue) {
    if (f.fallbackReason) {
      fallbackByReason.set(f.fallbackReason, (fallbackByReason.get(f.fallbackReason) ?? 0) + 1);
    }
  }

  // Per-staff assignment counts
  const staffCounts = new Map<string, number>();
  for (const a of result.assignments) {
    if (a.staffActorId) {
      staffCounts.set(a.staffActorId, (staffCounts.get(a.staffActorId) ?? 0) + 1);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {/* Algorithm info */}
      <div
        style={{
          fontSize: '0.75rem',
          color: '#555',
          padding: '0.375rem 0.5rem',
          background: '#f0f9ff',
          borderRadius: '4px',
          borderLeft: '3px solid #0284c7',
        }}
      >
        Chế độ <strong>{result.mode === 'batch' ? 'batch (largest remainder — Hamilton)' : 'realtime (smooth WRR — Nginx)'}</strong>.
        Kết quả deterministic với cùng (mode, weights, eligibility).
      </div>

      {/* ── Summary bar ── */}
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          padding: '0.5rem',
          background: '#f0fdf4',
          borderRadius: '4px',
          fontSize: '0.875rem',
          flexWrap: 'wrap',
        }}
      >
        <span>
          <strong>{assigned}</strong> / {total} khách được phân
        </span>
        {fallback > 0 && (
          <span style={{ color: '#dc2626' }}>
            <strong>{fallback}</strong> vào fallback
          </span>
        )}
        <span style={{ color: '#666' }}>
          Tổng weight: {result.totalWeight} · v{result.poolVersion}
        </span>
      </div>

      {/* Staff distribution */}
      {!isNarrow && (
        <div>
          <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
            Phân bổ theo nhân viên
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {result.staffSummary.map((s) => {
              const count = staffCounts.get(s.actorId) ?? 0;
              const pct = total > 0 ? (count / total) * 100 : 0;
              const capPct = s.capacityMax > 0 ? (s.capacityUsed / s.capacityMax) * 100 : 0;
              const quotaPct = s.quotaMax > 0 ? (s.quotaUsed / s.quotaMax) * 100 : 0;
              return (
                <div key={s.actorId} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span style={{ width: 140, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.actorId}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 16, background: '#e5e7eb', borderRadius: 2, position: 'relative' }}>
                      <div
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          height: '100%',
                          width: `${Math.min(pct, 100)}%`,
                          background: '#3b82f6',
                          borderRadius: 2,
                          transition: 'width 0.3s',
                        }}
                      />
                    </div>
                  </div>
                  <span style={{ width: 80, textAlign: 'right', fontSize: '0.8rem' }}>
                    {count}/{total} ({pct.toFixed(1)}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Fallback queue */}
      {result.fallbackQueue.length > 0 && (
        <div>
          <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
            Fallback queue ({fallback} khách)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {[...fallbackByReason.entries()].map(([reason, count]) => (
              <div
                key={reason}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.25rem 0.5rem',
                  background: FALLBACK_COLORS[reason] ?? '#f5f5f5',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                }}
              >
                <span>
                  {FALLBACK_LABELS[reason] ?? reason}
                </span>
                <span style={{ fontWeight: 600 }}>{count} khách</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>
            Khách trong fallback queue KHÔNG được phân cho nhân viên nào.
            Đây là trạng thái tạm thời — chờ nhân viên online hoặc giải phóng capacity.
          </div>
        </div>
      )}

      {/* Assignment list (compact) */}
      {!isNarrow && (
        <details>
          <summary style={{ fontSize: '0.875rem', cursor: 'pointer', userSelect: 'none' }}>
            Chi tiết phân bổ từng khách ({total} khách)
          </summary>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '0.25rem',
              marginTop: '0.5rem',
              fontSize: '0.75rem',
              maxHeight: 200,
              overflowY: 'auto',
            }}
          >
            {result.assignments.map((a) => (
              <div key={a.customerIndex} style={{ padding: '0.125rem 0.25rem', background: '#f9fafb', borderRadius: '2px' }}>
                #{a.customerIndex + 1} → {a.staffActorId ?? '?'}
              </div>
            ))}
            {result.fallbackQueue.map((a) => (
              <div key={a.customerIndex} style={{ padding: '0.125rem 0.25rem', background: '#fee2e2', borderRadius: '2px' }}>
                #{a.customerIndex + 1} → FALLBACK ({a.fallbackReason})
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Keyboard hint */}
      <div style={{ fontSize: '0.75rem', color: '#888' }}>
        Mô phỏng có thể tái hiện kết quả bằng deterministic seed={result.seed}.
      </div>
    </div>
  );
}
