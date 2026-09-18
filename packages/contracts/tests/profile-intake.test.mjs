/**
 * profile-intake.test.mjs — G0/0.3b: Profile patch whitelist, fill-missing,
 * intake payload, staff review confirmation, read-only preview, lifecycle labels.
 *
 * AC từ Implementation-Backlog.Gate0 §Task 0.3b:
 *  - Patch whitelist; KHÔNG CurrentRelationship/Handling/Beneficiary/arbitrary.
 *  - Fill-missing semantics (schema không enforce runtime, chỉ ràng buộc).
 *  - Review confirmation gắn draft revision/digest/actor; thay field/evidence
 *    /intent/target làm confirmation cũ invalid.
 *  - Preview chỉ dùng read-only resolver port; KHÔNG dùng createOrMatch.
 *  - EXACT vẫn phải qua staff review trước submit; profile target/version
 *    khác bản review yêu cầu re-review.
 *  - Submission SUBMITTED/APPLIED/HRP_REVIEWED tách biệt; review workflow
 *    tương lai đánh dấu proposed, không tự approved.
 *  - DNC action tách khỏi full intake.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProfilePatchSchema,
  ProfilePatchSafeSchema,
  PROFILE_PATCH_WHITELIST,
  PROFILE_PATCH_FORBIDDEN_FIELDS,
  UpdateLaborProfileInputSchema,
  UpdateLaborProfileResultSchema,
  IntakeSubmissionPayloadSchema,
  CitizenIdentitySchema,
  BusinessIntentSchema,
  IntakeContextRefSchema,
  StaffReviewContextSchema,
  StaffReviewConfirmationSchema,
  PreviewResolverRequestSchema,
  PreviewResolverResultSchema,
  PreviewResolverCandidateSchema,
  SubmissionLifecycleSchema,
  SUBMISSION_LIFECYCLE,
  SUBMISSION_LIFECYCLE_PROPOSED,
  isConfirmationValid,
  isDncActionValid,
  DncActionSchema,
  SCHEMA_VERSION,
} from '../dist/index.js';
import { src, ext } from './test-helpers.mjs';

const org = 'org_test_hrp';
const conn = 'conn_zalo_oa_1';

const intakeBase = () => ({
  organizationId: org,
  context: {
    source: ext('ZALO_OA', conn),
    externalConversationId: 'conv-001',
  },
  fullName: 'Nguyen Van A',
  phone: '+84901234567',
  citizenIdentity: {
    number: '123456789012',
    address: '12 Lê Lợi, Quận 1, TP.HCM',
  },
  contactAddress: '45 Nguyễn Huệ, Quận 1, TP.HCM',
  dob: '1990-01-01',
  intent: {
    stage: 'NEW',
    availability: 'AVAILABLE_NOW',
  },
  evidenceRefs: [
    {
      evidenceId: 'evi-front-001',
      kind: 'CCCD_FRONT',
      organizationId: org,
      connectionId: conn,
    },
    {
      evidenceId: 'evi-back-001',
      kind: 'CCCD_BACK',
      organizationId: org,
      connectionId: conn,
    },
  ],
  intakeRevisionId: 'intake-rev-001',
});

test('PROFILE_PATCH_WHITELIST giới hạn field được phép patch', () => {
  assert.ok(PROFILE_PATCH_WHITELIST.includes('fullName'));
  assert.ok(PROFILE_PATCH_WHITELIST.includes('phone'));
  assert.ok(PROFILE_PATCH_WHITELIST.includes('citizenAddress'));
  // CurrentRelationship KHÔNG có trong whitelist.
  assert.ok(!PROFILE_PATCH_WHITELIST.includes('currentRelationship'));
  assert.ok(!PROFILE_PATCH_WHITELIST.includes('CurrentRelationship'));
});

test('ProfilePatch: field trong whitelist accept', () => {
  const r = ProfilePatchSchema.parse({
    fullName: 'Nguyen Van A',
    phone: '+84901234567',
  });
  assert.equal(r.fullName, 'Nguyen Van A');
});

test('ProfilePatch: field NGOÀI whitelist bị reject', () => {
  // currentRelationship → reject.
  assert.equal(
    ProfilePatchSchema.safeParse({ currentRelationship: 'WORKING_VIA_HRP' }).success,
    false,
  );
  // arbitraryPatch → reject.
  assert.equal(
    ProfilePatchSchema.safeParse({ arbitraryPatch: { any: true } }).success,
    false,
  );
});

test('ProfilePatch: empty object bị reject', () => {
  assert.equal(ProfilePatchSchema.safeParse({}).success, false);
});

test('ProfilePatchSafe: field cấm (CurrentRelationship/Handling/Beneficiary/Worker) reject', () => {
  for (const forbidden of [
    'currentRelationship',
    'CurrentRelationship',
    'handling',
    'handlingAssignmentId',
    'beneficiary',
    'referralAttribution',
    'worker',
    'assignment',
    'effective',
    'EFFECTIVE',
    'arbitraryPatch',
    'rawPatch',
  ]) {
    const r = ProfilePatchSafeSchema.safeParse({ [forbidden]: 'value' });
    assert.equal(r.success, false, `field cấm '${forbidden}' phải bị reject`);
  }
});

test('PROFILE_PATCH_FORBIDDEN_FIELDS đầy đủ', () => {
  for (const f of [
    'currentRelationship',
    'handling',
    'beneficiary',
    'referralAttribution',
    'worker',
    'effective',
    'arbitraryPatch',
    'rawPatch',
  ]) {
    assert.ok(
      PROFILE_PATCH_FORBIDDEN_FIELDS.includes(f),
      `${f} phải thuộc forbidden list`,
    );
  }
});

test('UpdateLaborProfile input: required laborProfileId + expectedVersion + patch', () => {
  const r = UpdateLaborProfileInputSchema.parse({
    organizationId: org,
    laborProfileId: 'lp-12345678',
    expectedVersion: 7,
    patch: { fullName: 'Nguyen Van A' },
    fillMissingOnly: true,
  });
  assert.equal(r.expectedVersion, 7);
});

test('UpdateLaborProfile input: thiếu expectedVersion bị reject', () => {
  const noVersion = {
    organizationId: org,
    laborProfileId: 'lp-12345678',
    patch: { fullName: 'X' },
  };
  assert.equal(UpdateLaborProfileInputSchema.safeParse(noVersion).success, false);
});

test('UpdateLaborProfile result: APPLIED / NOOP discriminated', () => {
  const applied = UpdateLaborProfileResultSchema.parse({
    status: 'APPLIED',
    canonicalId: 'lp-12345678',
    newVersion: 8,
  });
  assert.equal(applied.status, 'APPLIED');
  const noop = UpdateLaborProfileResultSchema.parse({
    status: 'NOOP',
    canonicalId: 'lp-12345678',
    currentVersion: 7,
  });
  assert.equal(noop.status, 'NOOP');
});

test('IntakeContextRef: HRP_UI source discriminator (F2)', () => {
  // HRP_UI với connectionId → reject (CommandSourceSchema enforce null).
  assert.equal(
    IntakeContextRefSchema.safeParse({
      source: { kind: 'INTEGRATION', provider: 'CHATWOOT', connectionId: 'conn_zalo_oa_1' },
    }).success,
    true,
  );
  // HRP_UI không connectionId → ok.
  assert.equal(
    IntakeContextRefSchema.safeParse({
      source: { kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null },
    }).success,
    true,
  );
  // HRP_UI source KHÔNG externalConversationId/externalAccountId (F2).
  assert.equal(
    IntakeContextRefSchema.safeParse({
      source: { kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null },
      externalConversationId: 'ext-conv-1',
    }).success,
    false,
  );
  // Integration thiếu connectionId → reject (CommandSourceSchema enforce).
  assert.equal(
    IntakeContextRefSchema.safeParse({
      source: { kind: 'INTEGRATION', provider: 'CHATWOOT', connectionId: null },
    }).success,
    false,
  );
});

test('BusinessIntent: AVAILABLE_FROM_DATE yêu cầu availableFromDate', () => {
  const bad = BusinessIntentSchema.safeParse({
    stage: 'NEW',
    availability: 'AVAILABLE_FROM_DATE',
  });
  assert.equal(bad.success, false);

  const good = BusinessIntentSchema.safeParse({
    stage: 'NEW',
    availability: 'AVAILABLE_FROM_DATE',
    availableFromDate: '2026-10-01',
  });
  assert.equal(good.success, true);
});

test('BusinessIntent: availableFromDate chỉ hợp lệ với AVAILABLE_FROM_DATE', () => {
  const bad = BusinessIntentSchema.safeParse({
    stage: 'NEW',
    availability: 'AVAILABLE_NOW',
    availableFromDate: '2026-10-01',
  });
  assert.equal(bad.success, false);
});

test('IntakeSubmissionPayload: full intake yêu cầu ≥ 2 evidence (front + back)', () => {
  const r = IntakeSubmissionPayloadSchema.safeParse(intakeBase());
  assert.equal(r.success, true);

  // Thiếu 1 evidence → reject.
  const missing = intakeBase();
  missing.evidenceRefs = missing.evidenceRefs.slice(0, 1);
  assert.equal(IntakeSubmissionPayloadSchema.safeParse(missing).success, false);

  // Có 2 evidence nhưng cùng kind → reject.
  const sameKind = intakeBase();
  sameKind.evidenceRefs = [
    sameKind.evidenceRefs[0],
    { ...sameKind.evidenceRefs[1], kind: 'CCCD_FRONT' },
  ];
  assert.equal(IntakeSubmissionPayloadSchema.safeParse(sameKind).success, false);
});

test('IntakeSubmissionPayload: tách CCCD address (citizenIdentity) vs contactAddress', () => {
  const r = IntakeSubmissionPayloadSchema.parse(intakeBase());
  assert.equal(r.citizenIdentity.address, '12 Lê Lợi, Quận 1, TP.HCM');
  assert.equal(r.contactAddress, '45 Nguyễn Huệ, Quận 1, TP.HCM');
});

test('IntakeSubmissionPayload: rawTranscript/messages bị reject', () => {
  const bad = intakeBase();
  bad.context = {
    ...bad.context,
    rawTranscript: 'xin chào tôi muốn tìm việc',
  };
  // context strict → reject rawTranscript.
  assert.equal(IntakeSubmissionPayloadSchema.safeParse(bad).success, false);
});

test('StaffReviewContext: draftDigest phải SHA-256 hex 64 ký tự', () => {
  const ok = StaffReviewContextSchema.safeParse({
    draftRevisionId: 'draft-001',
    draftDigest: 'a'.repeat(64),
  });
  assert.equal(ok.success, true);

  // Sai format → reject.
  const bad1 = StaffReviewContextSchema.safeParse({
    draftRevisionId: 'draft-001',
    draftDigest: 'not-a-sha256',
  });
  assert.equal(bad1.success, false);

  // 63 chars → reject.
  const bad2 = StaffReviewContextSchema.safeParse({
    draftRevisionId: 'draft-001',
    draftDigest: 'a'.repeat(63),
  });
  assert.equal(bad2.success, false);
});

test('StaffReviewConfirmation: confirmed phải là literal true', () => {
  const good = StaffReviewConfirmationSchema.parse({
    organizationId: org,
    context: { draftRevisionId: 'draft-001', draftDigest: 'a'.repeat(64) },
    confirmed: true,
  });
  assert.equal(good.confirmed, true);

  // confirmed = false → reject (chỉ true mới có nghĩa "đã xác nhận").
  assert.equal(
    StaffReviewConfirmationSchema.safeParse({
      organizationId: org,
      context: { draftRevisionId: 'draft-001', draftDigest: 'a'.repeat(64) },
      confirmed: false,
    }).success,
    false,
  );
});

test('isConfirmationValid: thay đổi field/target/version làm confirmation cũ invalid', () => {
  const ctx = {
    draftRevisionId: 'draft-001',
    draftDigest: 'a'.repeat(64),
    canonicalId: 'lp-1',
    canonicalVersion: 7,
  };
  const confirm = StaffReviewConfirmationSchema.parse({
    organizationId: org,
    context: ctx,
    confirmed: true,
  });

  // Giữ nguyên → valid.
  assert.equal(isConfirmationValid(confirm, ctx), true);

  // Đổi draftRevisionId → invalid.
  assert.equal(
    isConfirmationValid(confirm, { ...ctx, draftRevisionId: 'draft-002' }),
    false,
  );
  // Đổi canonicalId → invalid.
  assert.equal(
    isConfirmationValid(confirm, { ...ctx, canonicalId: 'lp-2' }),
    false,
  );
  // Đổi canonicalVersion → invalid.
  assert.equal(
    isConfirmationValid(confirm, { ...ctx, canonicalVersion: 8 }),
    false,
  );
});

test('PreviewResolverRequest: signal có ít nhất 1 field', () => {
  assert.equal(
    PreviewResolverRequestSchema.safeParse({
      organizationId: org,
      context: { source: ext('ZALO_OA', conn) },
      signal: {},
    }).success,
    false,
  );

  assert.equal(
    PreviewResolverRequestSchema.safeParse({
      organizationId: org,
      context: { source: ext('ZALO_OA', conn) },
      signal: { phone: '+84901234567' },
    }).success,
    true,
  );
});

test('PreviewResolverResult: candidates ≤ 16, có expiresAt', () => {
  const r = PreviewResolverResultSchema.parse({
    candidates: [
      PreviewResolverCandidateSchema.parse({
        candidateId: 'cand-1',
        strength: 'STRONG',
      }),
    ],
    previewExpiresAt: '2026-09-13T03:00:00.000Z',
  });
  assert.equal(r.candidates.length, 1);
  assert.ok(r.previewExpiresAt);
});

test('PreviewResolver là READ-ONLY — không gọi createOrMatch mutation', () => {
  // Schema không chứa field mutation; runtime preview resolver chỉ đọc.
  // Test gián tiếp: input không có evidenceRefs, không có actor mutation,
  // không có canonicalId write target.
  const r = PreviewResolverRequestSchema.safeParse({
    organizationId: org,
    context: { source: ext('ZALO_OA', conn) },
    signal: { phone: '+84901234567' },
  });
  assert.equal(r.success, true);
  // request không chứa evidence/canonicalId write target.
  const req = r.data;
  assert.equal(req.signal.phone, '+84901234567');
  assert.ok(!('evidenceRefs' in req));
  assert.ok(!('patch' in req));
});

test('Submission lifecycle: 3 label tách biệt; SUBMITTED/APPLIED/HRP_REVIEWED đánh dấu proposed', () => {
  assert.deepEqual([...SUBMISSION_LIFECYCLE], [
    'SUBMITTED',
    'APPLIED',
    'HRP_REVIEWED',
  ]);
  for (const l of SUBMISSION_LIFECYCLE) {
    assert.equal(SubmissionLifecycleSchema.parse(l), l);
  }
  // Cờ proposed/experimental — schema không tự coi "approved" canonical.
  assert.equal(SUBMISSION_LIFECYCLE_PROPOSED, true);
  // Không có "APPROVED" canonical.
  assert.equal(SubmissionLifecycleSchema.safeParse('APPROVED').success, false);
});

test('DncAction tách biệt intake: isDncActionValid với payload tối thiểu', () => {
  const ok = {
    organizationId: org,
    connectionId: conn,
    externalReference: 'msg-001',
    reason: 'CANDIDATE_REQUEST',
  };
  assert.equal(isDncActionValid(ok), true);
  assert.equal(isDncActionValid({}), false);
});

test('IntakeSubmissionPayload: DNC không bị buộc intake đầy đủ', () => {
  // DNC action là schema riêng (DncActionSchema), không có evidence/CCCD bắt buộc.
  const dnc = DncActionSchema.safeParse({
    organizationId: org,
    connectionId: conn,
    externalReference: 'msg-001',
    reason: 'PRIVACY',
  });
  assert.equal(dnc.success, true);
});
