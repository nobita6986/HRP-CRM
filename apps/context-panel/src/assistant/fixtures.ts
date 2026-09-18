/**
 * src/assistant/fixtures.ts — Deterministic synthetic fixtures for CORE/1.13.
 *
 * Scope: AC1–AC5 planning/assistant/autofill prototype.
 *
 * All data is deterministic (seeded mulberry32 RNG) for reproducible tests.
 * No real AI / HRP DB calls.
 */
import type {
  TodaySnapshot,
  WeekPlanSnapshot,
  AutofillProposal,
  ProviderConfigRead,
  BatchItemResult,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
export const FIXTURE_ASOF = '2026-09-17T12:00:00.000Z';
export const FIXTURE_ORG_ID = 'org-001';
export const FIXTURE_PERIOD = '2026-09-01/2026-09-17';

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic RNG (Mulberry32)
// ─────────────────────────────────────────────────────────────────────────────
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

const rng = mulberry32(0xcafe_1c13);

function randInt(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC1 — Today / Week Planning Fixtures
// ─────────────────────────────────────────────────────────────────────────────
export function makeTodaySnapshot(staffId: string): TodaySnapshot {
  const kinds = ['task', 'reminder', 'intake_draft', 'kpi_progress', 'follow_up'] as const;
  const priorities = ['high', 'medium', 'low'] as const;

  const itemCount = randInt(3, 6);
  const items = Array.from({ length: itemCount }, (_, i) => {
    const kind = pick(kinds);
    const priority = pick(priorities);
    return {
      itemId: `today-item-${i + 1}`,
      kind,
      title:
        kind === 'task'
          ? pick([
              'Gọi khách hàng A đã nộp hồ sơ',
              'Theo dõi BĐS quận 7',
              'Cập nhật thông tin hồ sơ ứng viên XYZ',
              'Review intake mới từ Zalo OA',
            ])
          : kind === 'reminder'
            ? pick([
                'Nhắc lịch phỏng vấn tuần sau',
                'Nhắc kiểm tra hồ sơ đã đóng',
                'Nhắc gửi báo cáo tuần',
              ])
            : kind === 'intake_draft'
              ? 'Draft intake — khách quan tâm BĐS Quận 2'
              : kind === 'kpi_progress'
                ? 'KPI tuần: 3/5 hồ sơ submitted'
                : pick([
                    'Follow up khách đã từ chối tuần trước',
                    'Follow up khách hẹn gọi lại thứ 5',
                  ]),
      dueAt:
        rng() > 0.3
          ? new Date(
              Date.UTC(2026, 8, 17, randInt(8, 17), randInt(0, 59), 0),
            ).toISOString()
          : undefined,
      priority,
      sourceId:
        rng() > 0.5 ? `source-${randInt(1, 5)}` : undefined,
      sourceSnapshotId: `snap-${FIXTURE_ASOF.slice(0, 10)}`,
      done: rng() < 0.2, // 20% already done
      ownerId: staffId,
    };
  });

  return {
    snapshotId: `today-snap-${staffId}-${FIXTURE_ASOF.slice(0, 10)}`,
    staffId,
    asOf: FIXTURE_ASOF,
    items,
    kpiSummary: {
      totalTargets: randInt(4, 8),
      onTrack: randInt(2, 5),
      atRisk: randInt(0, 2),
      behind: randInt(0, 1),
    },
  };
}

export function makeWeekPlanSnapshot(staffId: string): WeekPlanSnapshot {
  const kinds = ['meeting', 'follow_up', 'intake_review', 'other'] as const;
  const dayLabels = [
    '2026-09-17',
    '2026-09-18',
    '2026-09-19',
    '2026-09-20',
    '2026-09-21',
    '2026-09-22',
    '2026-09-23',
  ];

  const items = Array.from({ length: randInt(5, 12) }, (_, i) => {
    const day = pick(dayLabels);
    const kind = pick(kinds);
    return {
      planItemId: `week-item-${i + 1}`,
      dayLabel: day,
      title:
        kind === 'meeting'
          ? pick([
              'Họp team sáng thứ 2',
              'Phỏng vấn ứng viên Nguyễn Văn A',
              'Training sản phẩm BĐS mới',
            ])
          : kind === 'follow_up'
            ? pick([
                'Follow up khách hàng Quận 7',
                'Call khách quan tâm BĐS Thủ Đức',
              ])
            : kind === 'intake_review'
              ? pick(['Review intake chưa duyệt', 'Kiểm tra hồ sơ pending'])
              : pick(['Báo cáo tuần', 'Cập nhật CRM']),
      kind,
      estimatedMinutes: randInt(15, 90),
      sourceId: rng() > 0.5 ? `source-${randInt(1, 3)}` : undefined,
    };
  });

  return {
    snapshotId: `week-snap-${staffId}-${FIXTURE_ASOF.slice(0, 10)}`,
    staffId,
    weekStart: '2026-09-17',
    items,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AC2 — Autofill Fixtures
// ─────────────────────────────────────────────────────────────────────────────
export function makeAutofillProposals(profileId: string, actorId: string): AutofillProposal[] {
  const now = FIXTURE_ASOF;
  const contextVersion = 'v-2026-09-17-001';

  const proposals: AutofillProposal[] = [];

  // Proposal 1: Clear — high confidence, no conflict
  proposals.push({
    proposalId: `prop-${profileId}-clear-001`,
    revisionId: `rev-001-${profileId}`,
    profileId,
    organizationId: FIXTURE_ORG_ID,
    status: 'PENDING_REVIEW',
    fields: [
      {
        fieldPath: 'intent.availability',
        proposedValue: 'FULL_TIME',
        currentValue: undefined,
        confidence: 0.91,
        reasonCode: 'CHAT_CONTEXT',
        hasConflict: false,
        stale: false,
        evidenceLabel: 'Tin nhắn 2026-09-16 14:30: "...muốn làm full time"',
      },
      {
        fieldPath: 'intent.experienceYears',
        proposedValue: 3,
        currentValue: undefined,
        confidence: 0.85,
        reasonCode: 'HISTORICAL',
        hasConflict: false,
        stale: false,
        evidenceLabel: 'Hồ sơ trước 2025: 3 năm kinh nghiệm',
      },
    ],
    contextSnapshotId: `snap-context-${FIXTURE_ASOF.slice(0, 10)}`,
    contextVersion,
    createdAt: now,
    createdByActor: actorId,
  });

  // Proposal 2: Conflict — two possible values
  proposals.push({
    proposalId: `prop-${profileId}-conflict-001`,
    revisionId: `rev-002-${profileId}`,
    profileId,
    organizationId: FIXTURE_ORG_ID,
    status: 'PENDING_REVIEW',
    fields: [
      {
        fieldPath: 'intent.preferredLocation',
        proposedValue: 'QUAN_7',
        currentValue: 'QUAN_2',
        confidence: 0.55,
        reasonCode: 'INFERRED',
        hasConflict: true,
        conflictNote:
          'Đề cập cả "Quận 7" (tin nhắn 14:30) và "Quận 2" (tin nhắn 09:15)',
        stale: false,
        evidenceLabel: 'Xung đột: Quận 7 vs Quận 2',
      },
    ],
    contextSnapshotId: `snap-context-${FIXTURE_ASOF.slice(0, 10)}`,
    contextVersion,
    createdAt: now,
    createdByActor: actorId,
  });

  // Proposal 3: Stale — context changed after proposal
  proposals.push({
    proposalId: `prop-${profileId}-stale-001`,
    revisionId: `rev-003-${profileId}`,
    profileId,
    organizationId: FIXTURE_ORG_ID,
    status: 'STALE',
    fields: [
      {
        fieldPath: 'intent.availability',
        proposedValue: 'PART_TIME',
        currentValue: undefined,
        confidence: 0.78,
        reasonCode: 'CHAT_CONTEXT',
        hasConflict: false,
        stale: true,
        staleReason:
          'Context version 2026-09-15 khác hiện tại 2026-09-17',
        evidenceLabel: 'Tin nhắn 2026-09-15 10:00 (version cũ)',
      },
    ],
    contextSnapshotId: 'snap-context-old',
    contextVersion: 'v-2026-09-15-001',
    createdAt: '2026-09-15T10:00:00.000Z',
    expiresAt: '2026-09-16T10:00:00.000Z',
    createdByActor: actorId,
  });

  return proposals;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC3 — Planning Batch Fixtures
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Build deterministic BatchItemResult fixtures for a given batchId — wire-aligned
 * with the frozen contract (R2 fix). Item 1 APPLIED, item 2 FAILED with
 * structured error, item 3 SKIPPED, item 4 ACCEPTED with pendingReference.
 */
export function makeBatchResults(batchId: string): BatchItemResult[] {
  return [
    {
      itemId: 'batch-item-1',
      itemKind: 'NEXT_ACTION',
      outcome: 'APPLIED',
      appliedId: `nextaction-applied-${batchId}-1`,
      appliedVersion: 1,
    },
    {
      itemId: 'batch-item-2',
      itemKind: 'NEXT_ACTION',
      outcome: 'FAILED',
      error: {
        itemId: 'batch-item-2',
        errorCode: 'HANDLING_CONFLICT',
        messageKey: 'planning.batch.item.handlingConflict',
        retryClass: 'REVIEW_REQUIRED',
      },
    },
    {
      itemId: 'batch-item-3',
      itemKind: 'NEXT_ACTION',
      outcome: 'SKIPPED',
    },
    {
      itemId: 'batch-item-4',
      itemKind: 'NEXT_ACTION',
      outcome: 'ACCEPTED',
      pendingReference: {
        kind: 'COMMAND_OPERATION',
        operationId: `op-accepted-${batchId}-4`,
      },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// AC4 — Provider Config Fixtures
// ─────────────────────────────────────────────────────────────────────────────
export function makeProviderConfigs(): ProviderConfigRead[] {
  return [
    {
      configId: 'cfg-001',
      providerId: 'provider-openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiStyle: 'CHAT_COMPLETIONS',
      capabilities: ['CHAT', 'FUNCTION_CALLING', 'STRUCTURED_OUTPUT', 'TOOLS'],
      dataPolicy: 'PII_REDACTED',
      budgetMonthly: {
        spendLimitVND: 5_000_000,
        currentSpendVND: 1_234_000,
        tokenLimit: 500_000,
        currentTokens: 123_000,
      },
      active: true,
      version: 'v-001',
    },
    {
      configId: 'cfg-002',
      providerId: 'provider-anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-3-5-haiku',
      apiStyle: 'CHAT_COMPLETIONS',
      capabilities: ['CHAT', 'FUNCTION_CALLING'],
      dataPolicy: 'NO_PII',
      budgetMonthly: {
        spendLimitVND: 3_000_000,
        currentSpendVND: 456_000,
        tokenLimit: 300_000,
        currentTokens: 45_000,
      },
      active: false,
      version: 'v-001',
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// AC5 — Reminder Port Fixtures
// ─────────────────────────────────────────────────────────────────────────────
export function makeReminderSimulation(): {
  wouldFireCount: number;
  suppressedCount: number;
} {
  // Deterministic: 3 would fire, 2 suppressed
  return { wouldFireCount: 3, suppressedCount: 2 };
}
