/**
 * fixtures-fix-f1-f5.test.mjs — F1–F5 fix coverage (Owner chỉ thị G0/0.8).
 *
 * Phạm vi:
 *  - F1: MergeLaborProfiles / CommitReviewDecision / ResolvePossibleMatch /
 *    SupersedeReviewStatus placeholder schemas PROPOSED/UNAVAILABLE; marker
 *    + audit ref check.
 *  - F2: HRP_UI source hợp lệ; integration thiếu connectionId reject;
 *    source/context mâu thuẫn reject.
 *  - F3: CalendarDate reuse cho dob, availableFromDate, periodStart/End.
 *  - F4: DncReason canonical 4 giá trị + legacy PRIVACY alias accepted +
 *    normalizeDncReason() + DNC reason AUTHORIZATION note.
 *  - F5: AI evidence refs reject inline shape; chỉ CommandEvidenceRefSchema
 *    chấp nhận.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  // F1
  MergeLaborProfilesInputSchema,
  MergeLaborProfilesResultSchema,
  CommitReviewDecisionInputSchema,
  ResolvePossibleMatchInputSchema,
  SupersedeReviewStatusInputSchema,
  ProposedUnavailableMarkerSchema,
  buildProposedUnavailableMarker,
  isProposedUnavailable,
  // F2
  IntakeContextRefSchema,
  InteractionContextRefSchema,
  // F3
  CalendarDateSchema,
  // F4
  DncReasonSchema,
  LegacyDncReasonSchema,
  DncReasonAcceptAliasSchema,
  normalizeDncReason,
  DNC_REASONS,
  LEGACY_DNC_REASONS,
  // F5
  AIProposalSchema,
  AIProposalFieldSchema,
} from '../dist/index.js';
import { SCHEMA_VERSION } from '../dist/enums.js';
import { src, ext } from './test-helpers.mjs';

const org = 'org-fix-f1-f5';
const conn = 'conn-zalo-fix-1';
const canonicalId = 'lp-can-test-12345678';

// ─────────────────────────────────────────────────────────────────────
// F1 — Merge/review contracts PROPOSED/UNAVAILABLE
// ─────────────────────────────────────────────────────────────────────

test('F1: MergeLaborProfilesInput yêu cầu marker PROPOSED/UNAVAILABLE với auditRef ∈ {Q-19,Q-23,Q-37}', () => {
  // thiếu marker → reject.
  assert.equal(
    MergeLaborProfilesInputSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
    }).success,
    false,
  );

  // marker đầy đủ với auditRef Q-19 → ok.
  const ok = MergeLaborProfilesInputSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    marker: buildProposedUnavailableMarker({
      reason: 'merge workflow HRP-owned PR đang chờ Q-19',
      auditRefs: ['Q-19'],
    }),
  });
  assert.equal(ok.marker.proposedUnavailable, true);

  // marker auditRef ngoài allowlist → reject.
  assert.equal(
    MergeLaborProfilesInputSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
      marker: {
        proposedUnavailable: true,
        proposedUnavailableReason: 'reason',
        proposedAuditRef: ['Q-99'], // ngoài {Q-19,Q-23,Q-37}
      },
    }).success,
    false,
  );
});

test('F1: MergeLaborProfilesResult chỉ outcome=PROPOSED_UNAVAILABLE', () => {
  const r = MergeLaborProfilesResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    outcome: 'PROPOSED_UNAVAILABLE',
    marker: buildProposedUnavailableMarker({
      reason: 'placeholder',
      auditRefs: ['Q-23'],
    }),
  });
  assert.equal(r.outcome, 'PROPOSED_UNAVAILABLE');

  // outcome khác → reject.
  assert.equal(
    MergeLaborProfilesResultSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      outcome: 'APPLIED',
      marker: buildProposedUnavailableMarker({
        reason: 'x',
        auditRefs: ['Q-19'],
      }),
    }).success,
    false,
  );
});

test('F1: CommitReviewDecision/ResolvePossibleMatch/SupersedeReviewStatus yêu cầu marker tương tự', () => {
  const marker = buildProposedUnavailableMarker({
    reason: 'review workflow chưa chốt Q-23',
    auditRefs: ['Q-23', 'Q-37'],
  });

  assert.equal(CommitReviewDecisionInputSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    marker,
  }).success, true);

  assert.equal(ResolvePossibleMatchInputSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    marker,
  }).success, true);

  assert.equal(SupersedeReviewStatusInputSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    marker,
  }).success, true);

  // thiếu marker → reject.
  assert.equal(CommitReviewDecisionInputSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
  }).success, false);
});

test('F1: ProposedUnavailableMarkerSchema không chấp nhận URL/base64 trong reason', () => {
  assert.equal(
    ProposedUnavailableMarkerSchema.safeParse({
      proposedUnavailable: true,
      proposedUnavailableReason: 'xem https://example.com để biết',
      proposedAuditRef: ['Q-19'],
    }).success,
    false,
  );
  assert.equal(
    ProposedUnavailableMarkerSchema.safeParse({
      proposedUnavailable: true,
      proposedUnavailableReason: 'data:image/png;base64,iVBOR...',
      proposedAuditRef: ['Q-19'],
    }).success,
    false,
  );
  assert.equal(
    ProposedUnavailableMarkerSchema.safeParse({
      proposedUnavailable: false, // literal true only
      proposedUnavailableReason: 'placeholder',
      proposedAuditRef: ['Q-19'],
    }).success,
    false,
  );
});

test('F1: isProposedUnavailable helper nhận diện marker placeholder', () => {
  const m = buildProposedUnavailableMarker({
    reason: 'test',
    auditRefs: ['Q-19'],
  });
  assert.equal(isProposedUnavailable(m), true);
  assert.equal(isProposedUnavailable({ proposedUnavailable: false }), false);
  assert.equal(isProposedUnavailable(null), false);
});

// ─────────────────────────────────────────────────────────────────────
// F2 — HRP_UI source discriminator
// ─────────────────────────────────────────────────────────────────────

test('F2: IntakeContextRef — HRP_UI source hợp lệ không có connectionId', () => {
  const r = IntakeContextRefSchema.parse({
    source: src(),
  });
  assert.equal(r.source.kind, 'HRP_UI');
});

test('F2: IntakeContextRef — INTEGRATION thiếu connectionId → reject', () => {
  assert.equal(
    IntakeContextRefSchema.safeParse({
      source: { kind: 'INTEGRATION', provider: 'ZALO_OA' },
    }).success,
    false,
  );
  assert.equal(
    IntakeContextRefSchema.safeParse({
      source: { kind: 'INTEGRATION', provider: 'CHATWOOT', connectionId: null },
    }).success,
    false,
  );
});

test('F2: IntakeContextRef — INTEGRATION đầy đủ provider + connectionId → ok', () => {
  const r = IntakeContextRefSchema.parse({
    source: ext('ZALO_OA', conn),
    externalConversationId: 'conv-1',
    externalAccountId: 'acc-1',
  });
  assert.equal(r.source.provider, 'ZALO_OA');
  assert.equal(r.source.connectionId, conn);
});

test('F2: IntakeContextRef — HRP_UI với externalConversationId/Account → reject (source/context mâu thuẫn)', () => {
  assert.equal(
    IntakeContextRefSchema.safeParse({
      source: src(),
      externalConversationId: 'conv-x',
    }).success,
    false,
  );
  assert.equal(
    IntakeContextRefSchema.safeParse({
      source: src(),
      externalAccountId: 'acc-x',
    }).success,
    false,
  );
});

test('F2: InteractionContextRef — HRP_UI external* field reject tương tự', () => {
  // HRP_UI không external*
  assert.equal(
    InteractionContextRefSchema.safeParse({
      source: src(),
      externalMessageId: 'msg-1',
    }).success,
    false,
  );
  // HRP_UI ok
  const ok = InteractionContextRefSchema.parse({
    source: src(),
  });
  assert.equal(ok.source.kind, 'HRP_UI');

  // Integration ok
  assert.equal(
    InteractionContextRefSchema.safeParse({
      source: ext('CHATWOOT', conn),
      externalMessageId: 'msg-1',
    }).success,
    true,
  );
});

// ─────────────────────────────────────────────────────────────────────
// F3 — CalendarDate reuse
// ─────────────────────────────────────────────────────────────────────

test('F3: CalendarDate reject ngày không tồn tại (Feb 30 / Apr 31)', () => {
  assert.equal(CalendarDateSchema.safeParse('2026-02-30').success, false);
  assert.equal(CalendarDateSchema.safeParse('2026-04-31').success, false);
  assert.equal(CalendarDateSchema.safeParse('2026-13-01').success, false);
  assert.equal(CalendarDateSchema.safeParse('abc').success, false);
});

test('F3: CalendarDate leap year boundary — 2024-02-29 OK, 2026-02-29 reject', () => {
  assert.equal(CalendarDateSchema.safeParse('2024-02-29').success, true);
  assert.equal(CalendarDateSchema.safeParse('2026-02-29').success, false);
  assert.equal(CalendarDateSchema.safeParse('2028-02-29').success, true);
});

// ─────────────────────────────────────────────────────────────────────
// F4 — DNC reasons canonical 4 + legacy PRIVACY alias
// ─────────────────────────────────────────────────────────────────────

test('F4: DncReasonSchema (canonical) đầy đủ 4 giá trị', () => {
  assert.deepEqual(
    [...DNC_REASONS].sort(),
    ['CANDIDATE_REQUEST', 'HRP_POLICY', 'OTHER', 'PRIVACY_REQUEST'].sort(),
  );
  for (const r of DNC_REASONS) {
    assert.equal(DncReasonSchema.safeParse(r).success, true);
  }
  // reject legacy PRIVACY ở canonical
  assert.equal(DncReasonSchema.safeParse('PRIVACY').success, false);
});

test('F4: LegacyDncReasonSchema chấp nhận PRIVACY legacy, reject PRIVACY_REQUEST canonical', () => {
  assert.deepEqual(
    [...LEGACY_DNC_REASONS].sort(),
    ['CANDIDATE_REQUEST', 'OTHER', 'PRIVACY'].sort(),
  );
  for (const r of LEGACY_DNC_REASONS) {
    assert.equal(LegacyDncReasonSchema.safeParse(r).success, true);
  }
  assert.equal(LegacyDncReasonSchema.safeParse('PRIVACY_REQUEST').success, false);
  assert.equal(LegacyDncReasonSchema.safeParse('HRP_POLICY').success, false);
});

test('F4: DncReasonAcceptAliasSchema chấp nhận cả canonical + legacy', () => {
  assert.equal(DncReasonAcceptAliasSchema.safeParse('PRIVACY').success, true);
  assert.equal(DncReasonAcceptAliasSchema.safeParse('PRIVACY_REQUEST').success, true);
  assert.equal(DncReasonAcceptAliasSchema.safeParse('CANDIDATE_REQUEST').success, true);
  assert.equal(DncReasonAcceptAliasSchema.safeParse('HRP_POLICY').success, true);
  assert.equal(DncReasonAcceptAliasSchema.safeParse('OTHER').success, true);
  assert.equal(DncReasonAcceptAliasSchema.safeParse('RANDOM').success, false);
});

test('F4: normalizeDncReason map PRIVACY → PRIVACY_REQUEST và đánh dấu wasLegacy', () => {
  // canonical không flag legacy.
  const c = normalizeDncReason('PRIVACY_REQUEST');
  assert.equal(c.reason, 'PRIVACY_REQUEST');
  assert.equal(c.wasLegacy, false);

  // legacy PRIVACY → mapped.
  const l = normalizeDncReason('PRIVACY');
  assert.equal(l.reason, 'PRIVACY_REQUEST');
  assert.equal(l.wasLegacy, true);

  // canonical khác.
  const o = normalizeDncReason('HRP_POLICY');
  assert.equal(o.reason, 'HRP_POLICY');
  assert.equal(o.wasLegacy, false);

  // invalid → throw.
  assert.throws(() => normalizeDncReason('RANDOM'), /không hợp lệ/);
  assert.throws(() => normalizeDncReason(123), /phải là string/);
});

// ─────────────────────────────────────────────────────────────────────
// F5 — AI evidence refs: chỉ CommandEvidenceRefSchema hợp lệ
// ─────────────────────────────────────────────────────────────────────

test('F5: AIProposalSchema.evidenceRefs từ chối inline shape (F5)', () => {
  // standard evidence ref hợp lệ (qua CommandEvidenceRefSchema).
  const good = {
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    proposalId: 'proposal-id-12345678',
    proposalKind: 'AUTOFILL',
    revisionId: 'rev-1',
    fields: [],
    evidenceRefs: [
      {
        evidenceId: 'evidence-canonical-001',
        kind: 'CCCD_FRONT',
        organizationId: org,
        connectionId: conn,
      },
    ],
    uncertainty: {
      schemaVersion: SCHEMA_VERSION,
      confidence: 0.5,
      reasonCodes: ['LOW_DOC_QUALITY'],
    },
    context: {
      schemaVersion: SCHEMA_VERSION,
      organizationId: org,
    },
    providerRef: {
      providerId: 'provider-zalo-1',
      providerConfigVersion: 1,
      model: 'gpt-x',
    },
    createdBy: { kind: 'USER', userId: 'user-staff-1' },
    createdAt: '2026-09-13T02:00:00.000Z',
  };
  assert.equal(AIProposalSchema.safeParse(good).success, true);

  // malformed inline shape (legacy fields evidenceId + evidenceSchemaVersion + kind
  // không có organizationId + connectionId) → reject.
  const malformed = JSON.parse(JSON.stringify(good));
  malformed.evidenceRefs = [
    {
      evidenceId: 'evidence-canonical-001',
      evidenceSchemaVersion: SCHEMA_VERSION,
      kind: 'CCCD_FRONT',
    },
  ];
  assert.equal(AIProposalSchema.safeParse(malformed).success, false);
});

test('F5: AIProposalFieldSchema.evidenceRefs dùng CommandEvidenceRefSchema (F5)', () => {
  const good = {
    schemaVersion: SCHEMA_VERSION,
    fieldPath: 'fullName',
    proposedValue: 'Nguyen Van A',
    evidenceRefs: [
      {
        evidenceId: 'evidence-canonical-001',
        kind: 'CCCD_FRONT',
        organizationId: org,
        connectionId: conn,
      },
    ],
    rationale: 'trích CCCD mặt trước',
  };
  assert.equal(AIProposalFieldSchema.safeParse(good).success, true);

  const malformed = JSON.parse(JSON.stringify(good));
  malformed.evidenceRefs = [
    {
      evidenceId: 'e1',
      evidenceSchemaVersion: SCHEMA_VERSION, // legacy inline shape
      kind: 'CCCD_FRONT',
    },
  ];
  assert.equal(AIProposalFieldSchema.safeParse(malformed).success, false);
});

// ─────────────────────────────────────────────────────────────────────
// Sanity: PRIVACY_REQUEST không trở thành HRP_POLICY capability đặc quyền
// ─────────────────────────────────────────────────────────────────────

test('F4: HRP_POLICY enum membership không cấp authority; chỉ là tag', () => {
  // Đây là semantic test dựa trên doc-marker, không phải AC enforce.
  // Đảm bảo: DncReasonSchema chỉ validate enum, KHÔNG tự cấp capability.
  const r = DncReasonSchema.parse('HRP_POLICY');
  assert.equal(r, 'HRP_POLICY');
  // runtime gate (Q-37 dual-control) sẽ enforce capability; schema không.
});
