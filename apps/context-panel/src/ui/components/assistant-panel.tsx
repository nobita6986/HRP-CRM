/**
 * assistant-panel.tsx — CORE/1.13 Personal assistant / planning / autofill UI.
 *
 * AC:
 * 1. Today/week deterministic suggestions, no external AI.
 * 2. Autofill per-field with evidence/conflict/staleness; staff review required.
 * 3. Planning batch partial results, reschedule/version, KPI manager-only.
 * 4. Provider config UI skeleton; no real key, no network probe.
 * 5. Reminder port/simulator; no production scheduler claim.
 *
 * Reuses existing UI shell, services, and confirmation boundaries.
 * No real model/provider calls; all data via context-panel server.
 */

import * as React from 'react';

/* ───────────────────────────────────────────────────────────────────────────
 * Types
 * ─────────────────────────────────────────────────────────────────────────── */

interface TodayItem {
  itemId: string;
  kind: 'task' | 'reminder' | 'intake_draft' | 'kpi_progress' | 'follow_up';
  title: string;
  dueAt?: string;
  priority: 'high' | 'medium' | 'low';
  sourceId?: string;
  sourceSnapshotId?: string;
  done: boolean;
  ownerId: string;
}

interface TodaySnapshot {
  snapshotId: string;
  staffId: string;
  asOf: string;
  items: TodayItem[];
  kpiSummary: {
    totalTargets: number;
    onTrack: number;
    atRisk: number;
    behind: number;
  };
}

interface WeekPlanItem {
  planItemId: string;
  dayLabel: string;
  title: string;
  kind: 'meeting' | 'follow_up' | 'intake_review' | 'other';
  estimatedMinutes?: number;
}

interface WeekPlanSnapshot {
  snapshotId: string;
  staffId: string;
  weekStart: string;
  items: WeekPlanItem[];
}

interface FieldSuggestion {
  fieldPath: string;
  proposedValue: unknown;
  currentValue?: unknown;
  confidence: number;
  reasonCode: string;
  hasConflict: boolean;
  conflictNote?: string;
  stale: boolean;
  staleReason?: string;
  evidenceLabel: string;
}

interface AutofillProposal {
  proposalId: string;
  revisionId: string;
  profileId: string;
  organizationId: string;
  status: 'DRAFT' | 'PENDING_REVIEW' | 'ACCEPTED' | 'REJECTED' | 'STALE';
  fields: FieldSuggestion[];
  contextSnapshotId: string;
  contextVersion: string;
  createdAt: string;
  expiresAt?: string;
  createdByActor: string;
}

interface PlanningBatchItemError {
  itemId: string;
  errorCode: string;
  messageKey: string;
  fieldPath?: string;
  retryClass:
    | 'NEVER'
    | 'REVIEW_REQUIRED'
    | 'REFRESH_AND_REVIEW'
    | 'REAUTHENTICATE'
    | 'BOUNDED_SAME_KEY'
    | 'RECONCILE_FIRST';
}

interface OperationReference {
  kind: 'COMMAND_OPERATION';
  operationId: string;
}

/**
 * Wire-aligned PlanningBatchItemResult (frozen contract
 * `PlanningBatchItemResultSchema` in @hrp-engagement/contracts/scheduling.ts).
 * R1/R2 fix: NO flat errorCode/errorMessage; FAILED carries structured
 * `error`; APPLIED carries appliedId; ACCEPTED carries pendingReference.
 */
interface BatchItemResult {
  itemId: string;
  itemKind: 'NEXT_ACTION' | 'AVAILABILITY' | 'SUPPRESSION';
  outcome: 'APPLIED' | 'ACCEPTED' | 'FAILED' | 'SKIPPED';
  appliedId?: string;
  appliedVersion?: string;
  pendingReference?: OperationReference;
  error?: PlanningBatchItemError;
}

interface PlanningBatchSummary {
  totalItems: number;
  appliedCount: number;
  acceptedCount: number;
  failedCount: number;
  skippedCount: number;
}

/**
 * Wire-aligned PlanningBatchResult (R1 fix). NO allSuccess field.
 * Renders per-item outcomes + summary counts.
 */
interface PlanningBatchResult {
  schemaVersion?: string;
  batchId: string;
  items: BatchItemResult[];
  summary: PlanningBatchSummary;
  completedAt: string;
}

interface ProviderConfigRead {
  configId: string;
  providerId: string;
  baseUrl: string;
  model: string;
  apiStyle: 'RESPONSES' | 'CHAT_COMPLETIONS' | 'CUSTOM';
  capabilities: string[];
  dataPolicy: 'NO_PII' | 'PII_REDACTED' | 'INTERNAL_ONLY' | 'SANDBOX';
  budgetMonthly?: {
    spendLimitVND: number;
    currentSpendVND: number;
    tokenLimit: number;
    currentTokens: number;
  };
  active: boolean;
  version: string;
}

interface ReminderSimResult {
  portHandles: Array<{ handleId: string; ttlSeconds: number; wouldFire: boolean; fireAt?: string }>;
  suppressedCount: number;
  pendingCount: number;
  simulationTimestamp: string;
}

/* ───────────────────────────────────────────────────────────────────────────
 * API client
 * ─────────────────────────────────────────────────────────────────────────── */

const API_BASE = '';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const fetchToday = () => apiFetch<TodaySnapshot>('/api/assistant/today');
const fetchWeek = () => apiFetch<WeekPlanSnapshot>('/api/assistant/week');

function fetchAutofill(profileId: string) {
  return apiFetch<{ proposals: AutofillProposal[] }>(
    `/api/assistant/autofill?profileId=${encodeURIComponent(profileId)}`,
  );
}

function acceptAutofill(
  profileId: string,
  proposalId: string,
  acceptedFieldPaths: string[],
  rejectedFieldPaths: string[],
) {
  return apiFetch<{
    result: {
      acceptedFields: string[];
      rejectedFields: string[];
      canMutate: boolean;
      mutated: boolean;
      draftId?: string;
      draftRevision?: string;
      confirmationDigest?: string;
    };
    proposal: AutofillProposal;
  }>(
    '/api/assistant/autofill/accept',
    {
      method: 'POST',
      body: JSON.stringify({ profileId, proposalId, acceptedFieldPaths, rejectedFieldPaths }),
    },
  );
}

function confirmAutofillDraft(
  draftId: string,
  draftRevision: string,
  confirmationDigest: string,
) {
  return apiFetch<{ draft: { draftId: string; applied: boolean; appliedAt?: string } }>(
    '/api/assistant/autofill/confirm',
    {
      method: 'POST',
      body: JSON.stringify({
        draftId,
        expectedDraftRevision: draftRevision,
        confirmationDigest,
      }),
    },
  );
}

function rejectAutofill(profileId: string, proposalId: string) {
  return apiFetch<{ proposal: AutofillProposal }>(
    '/api/assistant/autofill/reject',
    {
      method: 'POST',
      body: JSON.stringify({ profileId, proposalId }),
    },
  );
}

const fetchProviders = () => apiFetch<{ providers: ProviderConfigRead[] }>('/api/assistant/providers');
const simulateReminders = () =>
  apiFetch<ReminderSimResult>('/api/assistant/reminders/simulate');

function commitBatch(
  batchId: string,
  itemIds: string[],
) {
  return apiFetch<PlanningBatchResult>(
    '/api/assistant/planning/commit',
    {
      method: 'POST',
      body: JSON.stringify({ batchId, itemIds }),
    },
  );
}

function reschedule(
  actionId: string,
  expectedVersion: string,
  newSchedule: { scheduledAt: string; dueAt?: string },
) {
  return apiFetch<{ result: { success: true; newVersion: string; appliedRevision: { revisionId: string; occurrenceKey: string } } | { success: false; error: 'VERSION_CONFLICT'; message: string; currentVersion: string; expectedVersion: string } }>(
    '/api/assistant/planning/reschedule',
    {
      method: 'POST',
      body: JSON.stringify({ actionId, expectedVersion, newSchedule }),
    },
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Component
 * ─────────────────────────────────────────────────────────────────────────── */

type AssistantTab = 'today' | 'week' | 'autofill' | 'planning' | 'provider' | 'reminder';

interface AssistantPanelProps {
  isManager: boolean;
  staffId: string;
  isNarrow?: boolean;
}

export function AssistantPanel({ isManager, isNarrow }: AssistantPanelProps) {
  const [tab, setTab] = React.useState<AssistantTab>('today');
  const [error, setError] = React.useState<string | null>(null);

  return (
    <div data-assistant-panel style={{ padding: '1rem', fontFamily: 'sans-serif' }}>
      <h2 style={{ margin: '0 0 0.5rem 0' }}>Trợ lý cá nhân & kế hoạch</h2>
      <p style={{ color: '#666', margin: '0 0 1rem 0', fontSize: '0.9rem' }}>
        Mock prototype CORE/1.13. Không gọi model thật. Suggestions tái hiện được từ fixtures.
      </p>

      <nav
        role="tablist"
        aria-label="Assistant tabs"
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '1rem',
          flexWrap: isNarrow ? 'wrap' : 'nowrap',
        }}
      >
        {(
          [
            ['today', 'Hôm nay'],
            ['week', 'Tuần này'],
            ['autofill', 'Autofill'],
            ['planning', 'Planning'],
            ['provider', 'Provider'],
            ['reminder', 'Reminder'],
          ] as Array<[AssistantTab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-pressed={tab === key}
            aria-controls={`assistant-tabpanel-${key}`}
            onClick={() => setTab(key)}
            style={{
              padding: '0.4rem 0.8rem',
              border: '1px solid #ccc',
              borderRadius: '4px',
              background: tab === key ? '#e6f0ff' : '#fff',
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {error && (
        <div
          role="alert"
          style={{
            padding: '0.5rem',
            marginBottom: '1rem',
            background: '#fee',
            border: '1px solid #fcc',
            borderRadius: '4px',
          }}
        >
          Lỗi: {error}
        </div>
      )}

      {tab === 'today' && <TodayView isNarrow={isNarrow} setError={setError} />}
      {tab === 'week' && <WeekView isNarrow={isNarrow} setError={setError} />}
      {tab === 'autofill' && (
        <AutofillView isManager={isManager} setError={setError} />
      )}
      {tab === 'planning' && (
        <PlanningView isManager={isManager} setError={setError} />
      )}
      {tab === 'provider' && (
        <ProviderView isManager={isManager} setError={setError} />
      )}
      {tab === 'reminder' && <ReminderView setError={setError} />}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Today View
 * ─────────────────────────────────────────────────────────────────────────── */

function TodayView({
  isNarrow,
  setError,
}: {
  isNarrow?: boolean;
  setError: (s: string | null) => void;
}) {
  const [data, setData] = React.useState<TodaySnapshot | null>(null);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchToday();
      setData(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [setError]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div>Đang tải...</div>;
  if (!data) return <div>Không có dữ liệu</div>;

  return (
    <section aria-labelledby="today-heading" data-assistant-tab="today">
      <h3 id="today-heading">Hôm nay của tôi</h3>
      <p style={{ fontSize: '0.85rem', color: '#666' }}>
        Snapshot: <code>{data.snapshotId}</code> · As-of: {data.asOf.slice(0, 10)}
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isNarrow ? '1fr' : 'repeat(4, 1fr)',
          gap: '0.5rem',
          marginBottom: '1rem',
        }}
      >
        <KpiBox label="Tổng KPI" value={data.kpiSummary.totalTargets} />
        <KpiBox label="On track" value={data.kpiSummary.onTrack} color="#0a0" />
        <KpiBox label="Có rủi ro" value={data.kpiSummary.atRisk} color="#a80" />
        <KpiBox label="Trễ" value={data.kpiSummary.behind} color="#a00" />
      </div>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {data.items.map((item) => (
          <li
            key={item.itemId}
            data-today-item={item.itemId}
            style={{
              padding: '0.5rem',
              border: '1px solid #eee',
              borderRadius: '4px',
              marginBottom: '0.4rem',
              background: item.done ? '#f0fff0' : '#fff',
              opacity: item.done ? 0.7 : 1,
            }}
          >
            <strong>{item.title}</strong>{' '}
            <span style={{ fontSize: '0.8rem', color: '#888' }}>
              ({item.kind} · ưu tiên {item.priority}
              {item.dueAt && ` · hạn ${item.dueAt.slice(0, 10)}`})
            </span>
          </li>
        ))}
      </ul>
      <button onClick={load} style={{ marginTop: '0.5rem' }}>
        Làm mới
      </button>
    </section>
  );
}

function KpiBox({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div
      style={{
        padding: '0.5rem',
        border: '1px solid #ddd',
        borderRadius: '4px',
        background: '#fafafa',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '0.8rem', color: '#666' }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: color ?? '#000' }}>
        {value}
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Week View
 * ─────────────────────────────────────────────────────────────────────────── */

function WeekView({
  isNarrow,
  setError,
}: {
  isNarrow?: boolean;
  setError: (s: string | null) => void;
}) {
  const [data, setData] = React.useState<WeekPlanSnapshot | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    fetchWeek()
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [setError]);

  if (loading) return <div>Đang tải...</div>;
  if (!data) return <div>Không có dữ liệu</div>;

  // Group by day
  const byDay = new Map<string, WeekPlanItem[]>();
  for (const item of data.items) {
    if (!byDay.has(item.dayLabel)) byDay.set(item.dayLabel, []);
    byDay.get(item.dayLabel)!.push(item);
  }

  return (
    <section aria-labelledby="week-heading" data-assistant-tab="week">
      <h3 id="week-heading">Kế hoạch tuần</h3>
      <p style={{ fontSize: '0.85rem', color: '#666' }}>
        Snapshot: <code>{data.snapshotId}</code> · Tuần từ {data.weekStart}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {Array.from(byDay.entries()).map(([day, items]) => (
          <div
            key={day}
            style={{
              padding: '0.5rem',
              border: '1px solid #eee',
              borderRadius: '4px',
              display: isNarrow ? 'block' : 'flex',
              gap: '0.5rem',
            }}
          >
            <strong style={{ minWidth: '6rem' }}>{day}</strong>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, flex: 1 }}>
              {items.map((item) => (
                <li
                  key={item.planItemId}
                  data-week-item={item.planItemId}
                  style={{ marginBottom: '0.25rem' }}
                >
                  {item.title}{' '}
                  <span style={{ fontSize: '0.8rem', color: '#888' }}>
                    ({item.kind}
                    {item.estimatedMinutes && ` · ${item.estimatedMinutes} phút`})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Autofill View
 * ─────────────────────────────────────────────────────────────────────────── */

function AutofillView({
  isManager,
  setError,
}: {
  isManager: boolean;
  setError: (s: string | null) => void;
}) {
  const [profileId, setProfileId] = React.useState('profile-demo-001');
  const [proposals, setProposals] = React.useState<AutofillProposal[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [selected, setSelected] = React.useState<Record<string, Set<string>>>({});
  // Pending draft awaiting confirm (manager accept returns draftId).
  const [pendingDraft, setPendingDraft] = React.useState<{
    draftId: string;
    draftRevision: string;
    confirmationDigest: string;
    proposalId: string;
    acceptedFields: string[];
  } | null>(null);
  const [confirmationMsg, setConfirmationMsg] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAutofill(profileId);
      setProposals(result.proposals);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [profileId, setError]);

  React.useEffect(() => {
    load();
  }, [load]);

  const toggleField = (proposalId: string, fieldPath: string) => {
    setSelected((prev) => {
      const cur = prev[proposalId] ?? new Set<string>();
      const next = new Set(cur);
      if (next.has(fieldPath)) next.delete(fieldPath);
      else next.add(fieldPath);
      return { ...prev, [proposalId]: next };
    });
  };

  const handleAccept = async (proposal: AutofillProposal) => {
    const accepted: string[] = Array.from(selected[proposal.proposalId] ?? new Set<string>());
    const rejected: string[] = proposal.fields
      .map((f: { fieldPath: string }) => f.fieldPath)
      .filter((p: string) => !accepted.includes(p));
    setConfirmationMsg(null);
    try {
      const result = await acceptAutofill(profileId, proposal.proposalId, accepted, rejected);
      // Refresh proposal list
      await load();
      if (!result.result.canMutate) {
        setError(
          'Sale/AI chỉ được propose; mutation cần manager review. Proposal chuyển sang PENDING_REVIEW.',
        );
        return;
      }
      // Manager: accept creates a DRAFT. Stash for confirm step.
      if (result.result.draftId) {
        setPendingDraft({
          draftId: result.result.draftId,
          draftRevision: result.result.draftRevision ?? 'rev-1',
          confirmationDigest: result.result.confirmationDigest ?? '',
          proposalId: proposal.proposalId,
          acceptedFields: accepted,
        });
        setConfirmationMsg(
          'Đã tạo DRAFT. Vui lòng review & confirm để apply mutation. ' +
            'Hoặc bỏ qua để giữ nguyên proposal.',
        );
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleConfirmDraft = async () => {
    if (!pendingDraft) return;
    try {
      const r = await confirmAutofillDraft(
        pendingDraft.draftId,
        pendingDraft.draftRevision,
        pendingDraft.confirmationDigest,
      );
      setConfirmationMsg(
        `Mutation đã được apply lúc ${r.draft.appliedAt ?? 'vừa xong'}. ` +
          'Proposal đã chuyển sang ACCEPTED.',
      );
      setPendingDraft(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleReject = async (proposal: AutofillProposal) => {
    try {
      await rejectAutofill(profileId, proposal.proposalId);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section aria-labelledby="autofill-heading" data-assistant-tab="autofill">
      <h3 id="autofill-heading">Autofill đề xuất</h3>
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ marginRight: '0.5rem' }}>Profile ID:</label>
        <input
          value={profileId}
          onChange={(e) => setProfileId(e.target.value)}
          style={{ padding: '0.25rem', border: '1px solid #ccc', borderRadius: '4px' }}
          aria-label="Profile ID"
        />
        <button onClick={load} style={{ marginLeft: '0.5rem' }}>
          Tải lại
        </button>
      </div>
      {!isManager && (
        <div
          role="status"
          style={{
            padding: '0.5rem',
            background: '#fffbe6',
            border: '1px solid #ffe58f',
            borderRadius: '4px',
            marginBottom: '1rem',
          }}
        >
          ⚠ Bạn không phải manager. Accept chỉ chuyển proposal sang PENDING_REVIEW; không
          mutate canonical field.
        </div>
      )}
      {pendingDraft && (
        <div
          data-autofill-pending-draft={pendingDraft.draftId}
          role="status"
          style={{
            padding: '0.5rem',
            background: '#e6f7ff',
            border: '1px solid #91d5ff',
            borderRadius: '4px',
            marginBottom: '1rem',
          }}
        >
          📝 <strong>Draft chờ confirm:</strong> {pendingDraft.draftId} ·{' '}
          {pendingDraft.acceptedFields.length} field(s) · revision:{' '}
          <code>{pendingDraft.draftRevision}</code>.{' '}
          <button
            data-autofill-confirm-button
            onClick={handleConfirmDraft}
            style={{
              padding: '0.3rem 0.6rem',
              background: '#1890ff',
              color: '#fff',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              marginLeft: '0.5rem',
            }}
          >
            Confirm & apply mutation
          </button>
        </div>
      )}
      {confirmationMsg && (
        <div
          role="status"
          style={{
            padding: '0.5rem',
            background: '#f6ffed',
            border: '1px solid #b7eb8f',
            borderRadius: '4px',
            marginBottom: '1rem',
          }}
        >
          ✅ {confirmationMsg}
        </div>
      )}
      {loading && <div>Đang tải...</div>}
      {proposals.map((proposal) => (
        <article
          key={proposal.proposalId}
          data-autofill-proposal={proposal.proposalId}
          style={{
            padding: '0.75rem',
            border: '1px solid #ddd',
            borderRadius: '4px',
            marginBottom: '0.75rem',
            background: proposal.status === 'STALE' ? '#fff0f0' : '#fff',
          }}
        >
          <header style={{ marginBottom: '0.5rem' }}>
            <strong>{proposal.proposalId}</strong>{' '}
            <span style={{ fontSize: '0.85rem', color: '#666' }}>
              · trạng thái: <code>{proposal.status}</code> · context v:
              <code>{proposal.contextVersion}</code>
            </span>
            {proposal.status === 'STALE' && (
              <div
                role="alert"
                style={{
                  marginTop: '0.5rem',
                  color: '#a00',
                  fontSize: '0.85rem',
                }}
              >
                ⚠ Context đã stale; không thể accept/reject.
              </div>
            )}
          </header>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {proposal.fields.map((field) => {
              const isSelected =
                selected[proposal.proposalId]?.has(field.fieldPath) ?? false;
              return (
                <li
                  key={field.fieldPath}
                  data-autofill-field={field.fieldPath}
                  style={{
                    padding: '0.5rem',
                    border: '1px solid #eee',
                    borderRadius: '4px',
                    marginBottom: '0.4rem',
                    background: field.stale
                      ? '#fee'
                      : field.hasConflict
                        ? '#fffbe6'
                        : isSelected
                          ? '#e6f7ff'
                          : '#fff',
                  }}
                >
                  <label style={{ display: 'flex', gap: '0.5rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleField(proposal.proposalId, field.fieldPath)}
                      disabled={proposal.status === 'STALE'}
                      aria-label={`Accept ${field.fieldPath}`}
                    />
                    <div style={{ flex: 1 }}>
                      <div>
                        <code>{field.fieldPath}</code> →{' '}
                        <strong>{String(field.proposedValue)}</strong>{' '}
                        <span style={{ fontSize: '0.8rem', color: '#666' }}>
                          (tin cậy: {Math.round(field.confidence * 100)}%)
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: '0.85rem',
                          color: '#555',
                          marginTop: '0.25rem',
                        }}
                      >
                        📎 {field.evidenceLabel}
                      </div>
                      {field.hasConflict && field.conflictNote && (
                        <div
                          role="alert"
                          style={{
                            fontSize: '0.85rem',
                            color: '#a80',
                            marginTop: '0.25rem',
                          }}
                        >
                          ⚠ Xung đột: {field.conflictNote}
                        </div>
                      )}
                      {field.stale && field.staleReason && (
                        <div
                          role="alert"
                          style={{
                            fontSize: '0.85rem',
                            color: '#a00',
                            marginTop: '0.25rem',
                          }}
                        >
                          ⚠ Stale: {field.staleReason}
                        </div>
                      )}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
          <div style={{ marginTop: '0.5rem' }}>
            <button
              onClick={() => handleAccept(proposal)}
              disabled={
                proposal.status === 'STALE' ||
                (selected[proposal.proposalId]?.size ?? 0) === 0
              }
              aria-label={`Accept fields in ${proposal.proposalId}`}
              style={{
                padding: '0.4rem 0.8rem',
                marginRight: '0.5rem',
                background: '#0a0',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Accept đã chọn
            </button>
            <button
              onClick={() => handleReject(proposal)}
              disabled={proposal.status === 'STALE' || proposal.status === 'REJECTED'}
              aria-label={`Reject ${proposal.proposalId}`}
              style={{
                padding: '0.4rem 0.8rem',
                background: '#a00',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Reject toàn bộ
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Planning View
 * ─────────────────────────────────────────────────────────────────────────── */

function PlanningView({
  isManager,
  setError,
}: {
  isManager: boolean;
  setError: (s: string | null) => void;
}) {
  const [batchId] = React.useState('batch-demo-001');
  const [itemIds] = React.useState([
    'batch-item-1',
    'batch-item-2',
    'batch-item-3',
    'batch-item-4',
  ]);
  const [result, setResult] = React.useState<PlanningBatchResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [rescheduleMsg, setRescheduleMsg] = React.useState<string | null>(null);

  const handleCommit = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await commitBatch(batchId, itemIds);
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleReschedule = async (actionId: string, expectedVersion: string) => {
    setRescheduleMsg(null);
    try {
      const r = await reschedule(actionId, expectedVersion, {
        scheduledAt: '2026-09-18T09:00:00+07:00',
      });
      setRescheduleMsg(JSON.stringify(r.result, null, 2));
    } catch (e) {
      setRescheduleMsg(`Lỗi: ${(e as Error).message}`);
    }
  };

  return (
    <section aria-labelledby="planning-heading" data-assistant-tab="planning">
      <h3 id="planning-heading">Planning batch (kết quả partial)</h3>
      {!isManager && (
        <div
          role="status"
          style={{
            padding: '0.5rem',
            background: '#fffbe6',
            border: '1px solid #ffe58f',
            borderRadius: '4px',
            marginBottom: '1rem',
          }}
        >
          ⚠ Sale/AI không được sửa KPI. Reschedule lịch OK; assign KPI thuộc dashboard
          (manager-only).
        </div>
      )}
      <div style={{ marginBottom: '1rem' }}>
        <strong>Batch:</strong> <code>{batchId}</code> với {itemIds.length} items
        <button
          onClick={handleCommit}
          disabled={loading}
          style={{
            marginLeft: '0.5rem',
            padding: '0.4rem 0.8rem',
            background: '#06c',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Commit batch
        </button>
      </div>
      {result && (
        <div data-batch-result style={{ marginBottom: '1rem' }}>
          <div
            role="status"
            style={{
              padding: '0.5rem',
              background:
                result.summary.failedCount === 0
                  ? '#e6ffe6'
                  : result.summary.appliedCount + result.summary.acceptedCount === 0
                    ? '#fee'
                    : '#fffbe6',
              border: `1px solid ${
                result.summary.failedCount === 0
                  ? '#0a0'
                  : result.summary.appliedCount + result.summary.acceptedCount === 0
                    ? '#a00'
                    : '#aa0'
              }`,
              borderRadius: '4px',
              marginBottom: '0.5rem',
            }}
          >
            {result.summary.failedCount === 0
              ? '✅ Tất cả items thành công'
              : result.summary.appliedCount + result.summary.acceptedCount === 0
                ? `❌ All items failed: ${result.summary.failedCount} failed`
                : `⚠ Partial: ${result.summary.appliedCount} applied, ${result.summary.acceptedCount} accepted, ${result.summary.failedCount} failed, ${result.summary.skippedCount} skipped`}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={{ padding: '0.5rem', textAlign: 'left' }}>Item</th>
                <th style={{ padding: '0.5rem', textAlign: 'left' }}>Kind</th>
                <th style={{ padding: '0.5rem', textAlign: 'left' }}>Outcome</th>
                <th style={{ padding: '0.5rem', textAlign: 'left' }}>Applied/Pending</th>
                <th style={{ padding: '0.5rem', textAlign: 'left' }}>Error</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((r) => (
                <tr
                  key={r.itemId}
                  data-batch-item={r.itemId}
                  data-batch-outcome={r.outcome}
                  style={{
                    background:
                      r.outcome === 'FAILED'
                        ? '#fee'
                        : r.outcome === 'SKIPPED'
                          ? '#f5f5f5'
                          : '#fff',
                  }}
                >
                  <td style={{ padding: '0.5rem' }}>{r.itemId}</td>
                  <td style={{ padding: '0.5rem', fontSize: '0.8rem', color: '#666' }}>
                    {r.itemKind}
                  </td>
                  <td style={{ padding: '0.5rem' }}>
                    <strong>{r.outcome}</strong>
                  </td>
                  <td style={{ padding: '0.5rem', fontSize: '0.85rem' }}>
                    {r.outcome === 'APPLIED' && (
                      <span>
                        appliedId: <code>{r.appliedId ?? '—'}</code>
                        {r.appliedVersion && (
                          <>
                            {' '}
                            v: <code>{r.appliedVersion}</code>
                          </>
                        )}
                      </span>
                    )}
                    {r.outcome === 'ACCEPTED' && (
                      <span>
                        pendingOperationId:{' '}
                        <code>{r.pendingReference?.operationId ?? '—'}</code>
                      </span>
                    )}
                    {r.outcome === 'SKIPPED' && r.appliedId && (
                      <span>
                        target: <code>{r.appliedId}</code>
                      </span>
                    )}
                    {(r.outcome === 'FAILED' || r.outcome === 'SKIPPED') &&
                      !(
                        r.outcome === 'SKIPPED' &&
                        !r.appliedId
                      ) && <span>—</span>}
                    {r.outcome === 'SKIPPED' && !r.appliedId && <span>—</span>}
                  </td>
                  <td style={{ padding: '0.5rem', fontSize: '0.85rem' }}>
                    {r.error && (
                      <span>
                        <code>{r.error.errorCode}</code> · {r.error.messageKey}
                        {r.error.retryClass !== 'NEVER' && (
                          <span style={{ color: '#a80', marginLeft: '0.25rem' }}>
                            (retry: {r.error.retryClass})
                          </span>
                        )}
                      </span>
                    )}
                    {!r.error && <span>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div
            data-batch-summary
            style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.5rem' }}
          >
            Summary (schemaVersion={result.schemaVersion ?? '—'}):
            total={result.summary.totalItems},
            applied={result.summary.appliedCount},
            accepted={result.summary.acceptedCount},
            failed={result.summary.failedCount},
            skipped={result.summary.skippedCount}
          </div>
        </div>
      )}
      <div>
        <h4>Reschedule test (stale version)</h4>
        <button
          onClick={() => handleReschedule('act-stale', 'v-old')}
          style={{
            marginRight: '0.5rem',
            padding: '0.4rem 0.8rem',
            border: '1px solid #ccc',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Reschedule với stale version (expected fail)
        </button>
        <button
          onClick={() => handleReschedule('act-fresh', 'v-current')}
          style={{
            padding: '0.4rem 0.8rem',
            border: '1px solid #ccc',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Reschedule với fresh version (expected OK)
        </button>
        {rescheduleMsg && (
          <pre
            style={{
              marginTop: '0.5rem',
              padding: '0.5rem',
              background: '#f5f5f5',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '0.85rem',
            }}
          >
            {rescheduleMsg}
          </pre>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Provider View
 * ─────────────────────────────────────────────────────────────────────────── */

function ProviderView({
  isManager,
  setError,
}: {
  isManager: boolean;
  setError: (s: string | null) => void;
}) {
  const [providers, setProviders] = React.useState<ProviderConfigRead[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    fetchProviders()
      .then((r) => setProviders(r.providers))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [setError]);

  return (
    <section aria-labelledby="provider-heading" data-assistant-tab="provider">
      <h3 id="provider-heading">AI Provider Config (UI skeleton)</h3>
      <div
        role="status"
        style={{
          padding: '0.5rem',
          background: '#e6f0ff',
          border: '1px solid #06c',
          borderRadius: '4px',
          marginBottom: '1rem',
        }}
      >
        ℹ CORE/1.13 chỉ là UI skeleton. Không nhập API key thật; không gọi network probe
        production. Secret chỉ qua reference opaque.
      </div>
      {!isManager && (
        <div
          role="status"
          style={{
            padding: '0.5rem',
            background: '#fffbe6',
            border: '1px solid #ffe58f',
            borderRadius: '4px',
            marginBottom: '1rem',
          }}
        >
          ⚠ Sale/AI không được sửa provider config (manager-only).
        </div>
      )}
      {loading && <div>Đang tải...</div>}
      {providers.map((p) => (
        <article
          key={p.configId}
          data-provider-config={p.configId}
          style={{
            padding: '0.75rem',
            border: '1px solid #ddd',
            borderRadius: '4px',
            marginBottom: '0.75rem',
            background: p.active ? '#fff' : '#f5f5f5',
          }}
        >
          <header style={{ marginBottom: '0.5rem' }}>
            <strong>{p.providerId}</strong>{' '}
            <span style={{ fontSize: '0.85rem', color: '#666' }}>
              · model: <code>{p.model}</code> · style: <code>{p.apiStyle}</code> ·
              policy: <code>{p.dataPolicy}</code> · active: {p.active ? '✓' : '✗'} ·
              version: <code>{p.version}</code>
            </span>
          </header>
          <dl style={{ fontSize: '0.85rem', margin: 0 }}>
            <dt>Base URL</dt>
            <dd>
              <code>{p.baseUrl}</code>
            </dd>
            <dt>Capabilities</dt>
            <dd>{p.capabilities.join(', ')}</dd>
            {p.budgetMonthly && (
              <>
                <dt>Budget tháng</dt>
                <dd>
                  {p.budgetMonthly.currentSpendVND.toLocaleString('vi-VN')}/
                  {p.budgetMonthly.spendLimitVND.toLocaleString('vi-VN')} VND · tokens{' '}
                  {p.budgetMonthly.currentTokens.toLocaleString('vi-VN')}/
                  {p.budgetMonthly.tokenLimit.toLocaleString('vi-VN')}
                </dd>
              </>
            )}
          </dl>
        </article>
      ))}
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Reminder View
 * ─────────────────────────────────────────────────────────────────────────── */

function ReminderView({
  setError,
}: {
  setError: (s: string | null) => void;
}) {
  const [data, setData] = React.useState<ReminderSimResult | null>(null);
  const [loading, setLoading] = React.useState(false);

  const run = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await simulateReminders();
      setData(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [setError]);

  React.useEffect(() => {
    run();
  }, [run]);

  return (
    <section aria-labelledby="reminder-heading" data-assistant-tab="reminder">
      <h3 id="reminder-heading">Reminder Port / Simulator</h3>
      <div
        role="status"
        style={{
          padding: '0.5rem',
          background: '#e6f0ff',
          border: '1px solid #06c',
          borderRadius: '4px',
          marginBottom: '1rem',
        }}
      >
        ℹ CORE/1.13 chỉ là port/simulator. KHÔNG claim scheduler production. Không thực sự
        gửi notification ra ngoài. Production cần durable queue + provider.
      </div>
      <button onClick={run} style={{ marginBottom: '0.5rem' }}>
        Chạy mô phỏng
      </button>
      {loading && <div>Đang tải...</div>}
      {data && (
        <div>
          <p>
            <strong>Sẽ kích hoạt:</strong> {data.pendingCount} ·{' '}
            <strong>Bị chặn:</strong> {data.suppressedCount} ·{' '}
            <span style={{ fontSize: '0.85rem', color: '#666' }}>
              Mô phỏng lúc {data.simulationTimestamp.slice(0, 19)}
            </span>
          </p>
        </div>
      )}
    </section>
  );
}
