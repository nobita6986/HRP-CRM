/**
 * identity.test.mjs — G0/0.3a: Identity signals, evidence refs, three match outcomes.
 *
 * AC từ Implementation-Backlog.Gate0 §Task 0.3a:
 *  - EXACT/NEW có canonical ID/version; POSSIBLE có review reference,
 *    không có target được phép mutation.
 *  - NEW_PROFILE là command result, không là matching state thứ tư
 *    của ExternalContactLink.
 *  - SĐT normalized là signal, không unique-person proof; thiếu evidence
 *    không ép tạo NEW.
 *  - EvidenceRef opaque ID + kind, không base64/raw URL; scan/ownership
 *    do server xác minh, không tin client flags.
 *  - Tách identity-signal DTO tối thiểu với complete-intake DTO.
 *  - DNC action không bị buộc đủ intake.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IdentitySignalSchema,
  NormalizedPhoneSchema,
  CitizenIdNumberSchema,
  IdentityProvenanceSchema,
  CreateOrMatchLaborProfileInputSchema,
  ExactMatchOutcomeSchema,
  PossibleMatchOutcomeSchema,
  NewProfileOutcomeSchema,
  MatchingOutcomeResultSchema,
  DncActionSchema,
  CommandEvidenceRefSchema,
  EVIDENCE_FORBIDDEN_CLIENT_FLAGS,
  OrganizationIdSchema,
  SCHEMA_VERSION,
} from '../dist/index.js';

const org = 'org_test_hrp';
const conn = 'conn_zalo_oa_1';
const prov = 'ZALO_OA';
const intakeRev = 'intake-rev-001';

const baseEvidenceRef = (kind = 'CCCD_FRONT') => ({
  evidenceId: 'evi-12345678',
  kind,
  organizationId: org,
  connectionId: conn,
});

test('IdentitySignal: phone normalized là signal, không unique proof', () => {
  const r = IdentitySignalSchema.parse({ phone: '+84901234567' });
  assert.equal(r.phone, '+84901234567');
  // Sai format bị reject.
  assert.equal(NormalizedPhoneSchema.safeParse('abc').success, false);
  assert.equal(NormalizedPhoneSchema.safeParse('+84 901 234 567').success, false);
});

test('IdentitySignal: CCCD chỉ chấp nhận 9–12 chữ số, không ép UUID', () => {
  assert.equal(CitizenIdNumberSchema.safeParse('123456789').success, true);
  assert.equal(CitizenIdNumberSchema.safeParse('123456789012').success, true);
  assert.equal(CitizenIdNumberSchema.safeParse('12345').success, false);
  assert.equal(CitizenIdNumberSchema.safeParse('1234567890123').success, false);
  assert.equal(CitizenIdNumberSchema.safeParse('not-a-number').success, false);
});

test('IdentitySignal: ít nhất một field', () => {
  assert.equal(IdentitySignalSchema.safeParse({}).success, false);
  // fullName là đủ.
  assert.equal(IdentitySignalSchema.safeParse({ fullName: 'Nguyen Van A' }).success, true);
});

test('IdentitySignal: strict — field lạ bị reject', () => {
  assert.equal(
    IdentitySignalSchema.safeParse({ fullName: 'A', rawTranscript: 'xxx' }).success,
    false,
  );
});

test('CreateOrMatchLaborProfile input: hợp lệ với phone + 2 evidence', () => {
  const r = CreateOrMatchLaborProfileInputSchema.parse({
    organizationId: org,
    signal: { phone: '+84901234567' },
    provenance: {
      provider: prov,
      connectionId: conn,
      collectedAt: '2026-09-13T02:00:00.000Z',
    },
    evidence: [baseEvidenceRef('CCCD_FRONT'), baseEvidenceRef('CCCD_BACK')],
    intakeRevisionId: intakeRev,
    policyHint: 'ALLOW_NEW',
  });
  assert.equal(r.intakeRevisionId, intakeRev);
});

test('CreateOrMatchLaborProfile input: thiếu evidence KHÔNG ép NEW (signal-only OK)', () => {
  const r = CreateOrMatchLaborProfileInputSchema.parse({
    organizationId: org,
    signal: { fullName: 'Nguyen Van B', phone: '+84901234567' },
    provenance: {
      provider: prov,
      connectionId: conn,
      collectedAt: '2026-09-13T02:00:00.000Z',
    },
    intakeRevisionId: intakeRev,
    policyHint: 'MATCH_ONLY',
  });
  assert.equal(r.evidence, undefined);
});

test('CreateOrMatchLaborProfile input: policyHint MATCH_ONLY thiếu signal bị reject (signal ít nhất 1 field)', () => {
  // Schema enforce: identity signal phải có ≥1 field (fullName/phone/citizenId/dob/citizenAddress).
  // Runtime HRP mới quyết có đủ để match hay không — schema chỉ ràng buộc shape.
  const r = CreateOrMatchLaborProfileInputSchema.safeParse({
    organizationId: org,
    signal: {},
    provenance: {
      provider: prov,
      connectionId: conn,
      collectedAt: '2026-09-13T02:00:00.000Z',
    },
    intakeRevisionId: intakeRev,
    policyHint: 'MATCH_ONLY',
  });
  assert.equal(r.success, false);
});

test('EvidenceRef: opaque ID + kind + org; field cấm bị reject (strict)', () => {
  // Happy path
  const r = CommandEvidenceRefSchema.parse(baseEvidenceRef());
  assert.equal(r.kind, 'CCCD_FRONT');

  // Cố chèn scanPassed → reject do strict.
  const withScan = {
    ...baseEvidenceRef(),
    scanPassed: true,
  };
  assert.equal(CommandEvidenceRefSchema.safeParse(withScan).success, false);

  // Cố chèn base64 → reject.
  const withBase64 = {
    ...baseEvidenceRef(),
    base64: 'data:image/png;base64,...',
  };
  assert.equal(CommandEvidenceRefSchema.safeParse(withBase64).success, false);

  // publicUrl → reject.
  const withUrl = {
    ...baseEvidenceRef(),
    publicUrl: 'https://example.com/ccc.png',
  };
  assert.equal(CommandEvidenceRefSchema.safeParse(withUrl).success, false);
});

test('EVIDENCE_FORBIDDEN_CLIENT_FLAGS liệt kê các flag cấm', () => {
  for (const f of ['scanPassed', 'scanStatus', 'publicUrl', 'rawUrl', 'base64', 'sha256']) {
    assert.ok(EVIDENCE_FORBIDDEN_CLIENT_FLAGS.includes(f), `${f} phải nằm trong danh sách cấm`);
  }
});

test('EXACT_MATCH có canonicalId + version', () => {
  const r = ExactMatchOutcomeSchema.parse({
    outcome: 'EXACT_MATCH',
    canonicalId: 'lp-12345678',
    version: 7,
    matchReference: 'match-ref-001',
  });
  assert.equal(r.canonicalId, 'lp-12345678');
  assert.equal(r.version, 7);
});

test('POSSIBLE_MATCH có reviewReference, KHÔNG có canonicalId mutation được', () => {
  const r = PossibleMatchOutcomeSchema.parse({
    outcome: 'POSSIBLE_MATCH',
    reviewReference: 'review-ref-001',
    candidateIds: ['cand-1', 'cand-2'],
  });
  assert.equal(r.reviewReference, 'review-ref-001');
  assert.equal(r.candidateIds.length, 2);

  // Cố chèn canonicalId → reject do strict.
  const withId = {
    outcome: 'POSSIBLE_MATCH',
    reviewReference: 'review-ref-001',
    canonicalId: 'lp-12345678',
  };
  assert.equal(PossibleMatchOutcomeSchema.safeParse(withId).success, false);
});

test('NEW_PROFILE có canonicalId + version + createdByPolicy', () => {
  const r = NewProfileOutcomeSchema.parse({
    outcome: 'NEW_PROFILE',
    canonicalId: 'lp-12345678',
    version: 1,
    createdByPolicy: 'hrp-policy-intake-v1',
  });
  assert.equal(r.canonicalId, 'lp-12345678');
  assert.equal(r.version, 1);
});

test('MatchingOutcomeResult: 3 outcome phân biệt; NEW_PROFILE KHÔNG là state thứ tư của mapping', () => {
  // NEW_PROFILE là command result, không phải ExternalContactLink state.
  // Schema chỉ là discriminated union; runtime ExternalContactLink state
  // riêng (EXACT_MATCH/POSSIBLE_MATCH/UNRESOLVED) — không lẫn NEW_PROFILE.
  const outcomes = ['EXACT_MATCH', 'POSSIBLE_MATCH', 'NEW_PROFILE'];
  for (const o of outcomes) {
    let parsed;
    if (o === 'EXACT_MATCH') {
      parsed = ExactMatchOutcomeSchema.parse({
        outcome: o,
        canonicalId: 'lp-1',
        version: 1,
        matchReference: 'm',
      });
    } else if (o === 'POSSIBLE_MATCH') {
      parsed = PossibleMatchOutcomeSchema.parse({
        outcome: o,
        reviewReference: 'r',
      });
    } else {
      parsed = NewProfileOutcomeSchema.parse({
        outcome: o,
        canonicalId: 'lp-2',
        version: 1,
        createdByPolicy: 'p',
      });
    }
    assert.equal(parsed.outcome, o);
  }
});

test('MatchingOutcomeResult: union cho phép 3 outcome; reject khác', () => {
  const r = MatchingOutcomeResultSchema.safeParse({
    outcome: 'UNRESOLVED',
    reviewReference: 'r',
  });
  assert.equal(r.success, false);
});

test('DncAction: tách biệt, KHÔNG bị buộc CCCD/evidence đầy đủ', () => {
  const r = DncActionSchema.parse({
    organizationId: org,
    connectionId: conn,
    externalReference: 'msg-conv-001',
    reason: 'CANDIDATE_REQUEST',
  });
  assert.equal(r.reason, 'CANDIDATE_REQUEST');
  // canonicalId optional — DNC có thể fire trước khi có LaborProfile.
  assert.equal(r.canonicalId, undefined);
});

test('DncAction: KHÔNG chứa fullName/phone/CCCD trong payload', () => {
  const withPii = {
    organizationId: org,
    connectionId: conn,
    externalReference: 'msg-conv-001',
    reason: 'CANDIDATE_REQUEST',
    fullName: 'Nguyen Van Z', // không thuộc schema
  };
  assert.equal(DncActionSchema.safeParse(withPii).success, false);
});

test('IdentityProvenance: provider + connectionId + collectedAt required', () => {
  const r = IdentityProvenanceSchema.safeParse({
    provider: prov,
    connectionId: conn,
    collectedAt: '2026-09-13T02:00:00.000Z',
  });
  assert.equal(r.success, true);
  assert.equal(IdentityProvenanceSchema.safeParse({}).success, false);
});

test('OrganizationId bắt buộc trong input', () => {
  const noOrg = {
    signal: { phone: '+84901234567' },
    provenance: {
      provider: prov,
      connectionId: conn,
      collectedAt: '2026-09-13T02:00:00.000Z',
    },
    intakeRevisionId: intakeRev,
  };
  assert.equal(CreateOrMatchLaborProfileInputSchema.safeParse(noOrg).success, false);
});

test('Schema version constant pin', () => {
  assert.equal(SCHEMA_VERSION, '1');
  assert.equal(OrganizationIdSchema.safeParse(org).success, true);
});
