/**
 * placement-case-interactions.test.mjs ΓÇö G0/0.3cΓÇô0.3d: PlacementCase
 * open/update/close + Interactions Talent/Client.
 *
 * AC tß╗½ Backlog ┬ºTask 0.3c:
 *  - Open kh├┤ng ─æ├▓i ID case (ch╞░a tß║ío); update/close c├│ target/version.
 *  - closeReason ri├¬ng, CLOSED server-owned; SUCCESS kh├┤ng EFFECTIVE.
 *  - Kh├┤ng tß╗▒ ─æß╗ïnh open-status/active set/transitions (ghi proposed).
 *
 * AC tß╗½ Backlog ┬ºTask 0.3d:
 *  - Talent/Client context ri├¬ng; thiß║┐u Client domain input ghi unknown.
 *  - Strict payload, summary giß╗¢i hß║ín, kh├┤ng transcript/attachment dump.
 *  - Actor phß║úi runtime auth/delegation x├íc minh; kh├┤ng lß║Ñy assignee
 *    l├ám actor. Ph├ón biß╗çt occurredAt vß╗¢i effectiveAt/recordedAt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLACEMENT_CASE_PATCH_WHITELIST,
  PLACEMENT_CASE_PATCH_FORBIDDEN,
  PlacementCasePatchSchema,
  OpenPlacementCaseInputSchema,
  UpdatePlacementCaseInputSchema,
  ClosePlacementCaseInputSchema,
  OpenPlacementCaseResultSchema,
  UpdatePlacementCaseResultSchema,
  ClosePlacementCaseResultSchema,
  PLACEMENT_CASE_INTENDED_STAGE_ALLOWED,
  isIntendedStageAllowed,
  INTERACTION_KINDS,
  INTERACTION_OUTCOMES,
  InteractionKindSchema,
  InteractionOutcomeSchema,
  InteractionContextRefSchema,
  InteractionAssigneeRefSchema,
  RecordTalentInteractionInputSchema,
  RecordClientInteractionInputSchema,
  InteractionTimestampsSchema,
  RecordInteractionResultSchema,
  INTERACTION_PAYLOAD_FORBIDDEN_FIELDS,
  SCHEMA_VERSION,
} from '../dist/index.js';
import { src, ext } from './test-helpers.mjs';

const org = 'org-test-pc';
const conn = 'conn-zalo-1';
const caseId = 'lp-case-001';
const profileId = 'lp-profile-001';

test('PLACEMENT_CASE_PATCH_WHITELIST giß╗¢i hß║ín field ─æ╞░ß╗úc ph├⌐p patch', () => {
  // 6 field cho ph├⌐p: intendedStage, availability, availableFromDate,
  // contactNotes, intentSummary, scheduledActionAt.
  assert.equal(PLACEMENT_CASE_PATCH_WHITELIST.length, 6);
  assert.ok(PLACEMENT_CASE_PATCH_WHITELIST.includes('intendedStage'));
  assert.ok(PLACEMENT_CASE_PATCH_WHITELIST.includes('availability'));
  assert.ok(PLACEMENT_CASE_PATCH_WHITELIST.includes('availableFromDate'));
});

test('PlacementCasePatch: field NGO├ÇI whitelist bß╗ï reject', () => {
  assert.equal(
    PlacementCasePatchSchema.safeParse({ currentRelationship: 'WORKING_VIA_HRP' }).success,
    false,
  );
  assert.equal(
    PlacementCasePatchSchema.safeParse({ status: 'CLOSED' }).success,
    false,
  );
  assert.equal(
    PlacementCasePatchSchema.safeParse({ closeReason: 'SUCCESS' }).success,
    false,
  );
  assert.equal(
    PlacementCasePatchSchema.safeParse({ isEffective: true }).success,
    false,
  );
});

test('PlacementCasePatch: field cß║Ñm (currentRelationship/status/closeReason/effective/transcript) reject', () => {
  for (const forbidden of PLACEMENT_CASE_PATCH_FORBIDDEN) {
    const r = PlacementCasePatchSchema.safeParse({ [forbidden]: 'value' });
    assert.equal(r.success, false, `field cß║Ñm '${forbidden}' phß║úi bß╗ï reject`);
  }
});

test('PlacementCasePatch: empty object bß╗ï reject', () => {
  assert.equal(PlacementCasePatchSchema.safeParse({}).success, false);
});

test('OpenPlacementCase: KH├öNG ─æ├▓i caseId (ch╞░a tß║ío)', () => {
  const r = OpenPlacementCaseInputSchema.parse({
    organizationId: org,
    intendedStage: 'NEW',
    context: { source: src() },
  });
  assert.equal(r.intendedStage, 'NEW');
  assert.equal(r.organizationId, org);
});

test('OpenPlacementCase: AVAILABLE_FROM_DATE y├¬u cß║ºu availableFromDate', () => {
  const bad = OpenPlacementCaseInputSchema.safeParse({
    organizationId: org,
    intendedStage: 'NEW',
    initialAvailability: 'AVAILABLE_FROM_DATE',
    context: { source: src() },
  });
  assert.equal(bad.success, false);

  const good = OpenPlacementCaseInputSchema.parse({
    organizationId: org,
    intendedStage: 'NEW',
    initialAvailability: 'AVAILABLE_FROM_DATE',
    availableFromDate: '2026-10-01',
    context: { source: src() },
  });
  assert.equal(good.availableFromDate, '2026-10-01');
});

test('OpenPlacementCase: confirmationDigest SHA-256 hex', () => {
  const ok = OpenPlacementCaseInputSchema.safeParse({
    organizationId: org,
    intendedStage: 'NEW',
    context: { source: src() },
    confirmationDigest: 'a'.repeat(64),
  });
  assert.equal(ok.success, true);

  const bad = OpenPlacementCaseInputSchema.safeParse({
    organizationId: org,
    intendedStage: 'NEW',
    context: { source: src() },
    confirmationDigest: 'not-sha256',
  });
  assert.equal(bad.success, false);
});

test('OpenPlacementCase result: server trß║ú canonicalId + version + appliedStage', () => {
  const r = OpenPlacementCaseResultSchema.parse({
    canonicalId: caseId,
    version: 1,
    appliedStage: 'NEW',
  });
  assert.equal(r.appliedStage, 'NEW');
});

test('UpdatePlacementCase: y├¬u cß║ºu caseId + expectedVersion', () => {
  const r = UpdatePlacementCaseInputSchema.parse({
    organizationId: org,
    placementCaseId: caseId,
    expectedVersion: 3,
    patch: { intendedStage: 'CONTACTING' },
  });
  assert.equal(r.expectedVersion, 3);
});

test('UpdatePlacementCase: thiß║┐u expectedVersion bß╗ï reject', () => {
  const r = UpdatePlacementCaseInputSchema.safeParse({
    organizationId: org,
    placementCaseId: caseId,
    patch: { intendedStage: 'CONTACTING' },
  });
  assert.equal(r.success, false);
});

test('UpdatePlacementCase result: APPLIED / NOOP discriminated', () => {
  const applied = UpdatePlacementCaseResultSchema.parse({
    status: 'APPLIED',
    canonicalId: caseId,
    newVersion: 4,
  });
  assert.equal(applied.status, 'APPLIED');

  const noop = UpdatePlacementCaseResultSchema.parse({
    status: 'NOOP',
    canonicalId: caseId,
    currentVersion: 3,
  });
  assert.equal(noop.status, 'NOOP');
});

test('ClosePlacementCase: y├¬u cß║ºu caseId + expectedVersion + closeReason', () => {
  const r = ClosePlacementCaseInputSchema.parse({
    organizationId: org,
    placementCaseId: caseId,
    expectedVersion: 5,
    closeReason: 'SUCCESS',
  });
  assert.equal(r.closeReason, 'SUCCESS');
});

test('ClosePlacementCase: SUCCESS KH├öNG phß║úi EFFECTIVE (chß╗ë l├á closeReason)', () => {
  // SUCCESS l├á closeReason (case ─æ├ú ─æ├│ng th├ánh c├┤ng). EFFECTIVE l├á
  // workflow managed mode ri├¬ng; schema KH├öNG c├│ field effective ß╗ƒ
  // placement case patch.
  const r = ClosePlacementCaseInputSchema.parse({
    organizationId: org,
    placementCaseId: caseId,
    expectedVersion: 5,
    closeReason: 'SUCCESS',
  });
  // Schema confirm closeReason OK; runtime HRP set status = CLOSED.
  assert.equal(r.closeReason, 'SUCCESS');
});

test('ClosePlacementCase result: server trß║ú appliedStatus = CLOSED (server-owned)', () => {
  const r = ClosePlacementCaseResultSchema.parse({
    status: 'APPLIED',
    canonicalId: caseId,
    newVersion: 6,
    appliedStatus: 'CLOSED',
  });
  assert.equal(r.appliedStatus, 'CLOSED');
});

test('ClosePlacementCase result: appliedStatus chß╗ë chß║Ñp nhß║¡n CLOSED, kh├┤ng ACTIVE', () => {
  // Client kh├┤ng ─æ╞░ß╗úc set status; server mß╗¢i set CLOSED.
  assert.equal(
    ClosePlacementCaseResultSchema.safeParse({
      status: 'APPLIED',
      canonicalId: caseId,
      newVersion: 6,
      appliedStatus: 'ACTIVE',
    }).success,
    false,
  );
});

test('ClosePlacementCase: note kh├┤ng ─æ╞░ß╗úc chß╗⌐a URL/base64/data URI', () => {
  const r = ClosePlacementCaseInputSchema.safeParse({
    organizationId: org,
    placementCaseId: caseId,
    expectedVersion: 5,
    closeReason: 'OTHER',
    note: '─æ├ú thanh to├ín xong https://example.com/invoice',
  });
  assert.equal(r.success, false);

  const good = ClosePlacementCaseInputSchema.safeParse({
    organizationId: org,
    placementCaseId: caseId,
    expectedVersion: 5,
    closeReason: 'OTHER',
    note: '─æ├ú thanh to├ín xong, kh├┤ng c├│ g├¼ ─æß║╖c biß╗çt',
  });
  assert.equal(good.success, true);
});

test('PLACEMENT_CASE_INTENDED_STAGE_ALLOWED gß╗úi ├╜ runtime (NEW, CONTACTING, QUALIFYING)', () => {
  // Schema KH├öNG enum h├│a intendedStage (G-06 ch╞░a chß╗æt open-status set);
  // helper runtime suggestion: NEW/CONTACTING/QUALIFYING.
  assert.deepEqual([...PLACEMENT_CASE_INTENDED_STAGE_ALLOWED], [
    'NEW',
    'CONTACTING',
    'QUALIFYING',
  ]);
  assert.equal(isIntendedStageAllowed('NEW'), true);
  assert.equal(isIntendedStageAllowed('MATCHING'), false);
});

test('InteractionKind ─æß╗º 5 loß║íi', () => {
  assert.deepEqual([...INTERACTION_KINDS], [
    'PLACEMENT_PROGRESS',
    'FOLLOWUP',
    'NOTE',
    'CLIENT_OUTREACH',
    'TALENT_OUTREACH',
  ]);
  for (const k of INTERACTION_KINDS) {
    assert.equal(InteractionKindSchema.parse(k), k);
  }
});

test('InteractionOutcome ─æß╗º 5 loß║íi (POSITIVE/NEUTRAL/NEGATIVE/PENDING/UNKNOWN)', () => {
  assert.deepEqual([...INTERACTION_OUTCOMES], [
    'POSITIVE',
    'NEUTRAL',
    'NEGATIVE',
    'PENDING',
    'UNKNOWN',
  ]);
  assert.equal(InteractionOutcomeSchema.parse('UNKNOWN'), 'UNKNOWN');
});

// F2 fix (Owner chỉ thị G0/0.8): source discriminator CommandSourceSchema.
test('InteractionContextRef: F2 source discriminator (HRP_UI vs INTEGRATION)', () => {
  // HRP_UI source → ok (CommandSourceSchema enforce null connectionId).
  assert.equal(
    InteractionContextRefSchema.safeParse({
      source: { kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null },
    }).success,
    true,
  );
  // HRP_UI với connectionId chuỗi → reject (CommandSourceSchema enforce null).
  assert.equal(
    InteractionContextRefSchema.safeParse({
      source: { kind: 'HRP_UI', provider: 'HRP_UI', connectionId: 'c1' },
    }).success,
    false,
  );
  // INTEGRATION provider ZALO_OA + connectionId → ok.
  assert.equal(
    InteractionContextRefSchema.safeParse({
      source: { kind: 'INTEGRATION', provider: 'ZALO_OA', connectionId: conn },
    }).success,
    true,
  );
  // INTEGRATION thiếu connectionId → reject (CommandSourceSchema enforce).
  assert.equal(
    InteractionContextRefSchema.safeParse({
      source: { kind: 'INTEGRATION', provider: 'ZALO_OA' },
    }).success,
    false,
  );
  // HRP_UI không được phép có externalMessageId/externalConversationId/externalAccountId (F2).
  assert.equal(
    InteractionContextRefSchema.safeParse({
      source: { kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null },
      externalMessageId: 'msg-1',
    }).success,
    false,
  );
});

test('InteractionAssigneeRef: assignee ri├¬ng vß╗¢i actor', () => {
  const r = InteractionAssigneeRefSchema.parse({
    userId: 'user-staff-1',
    scopeId: 'team-hanoi-1',
  });
  assert.equal(r.userId, 'user-staff-1');
  // Schema kh├┤ng c├│ field actor ΓÇö runtime x├íc minh actor tß╗½ envelope.
});

test('RecordTalentInteraction: gß║»n LaborProfile canonical + occurredAt client-set', () => {
  const r = RecordTalentInteractionInputSchema.parse({
    organizationId: org,
    laborProfileId: profileId,
    kind: 'FOLLOWUP',
    outcome: 'POSITIVE',
    context: { source: src() },
    occurredAt: '2026-09-13T02:00:00.000Z',
    summary: '─æ├ú followup qua ─æiß╗çn thoß║íi',
  });
  assert.equal(r.laborProfileId, profileId);
  assert.equal(r.occurredAt, '2026-09-13T02:00:00.000Z');
});

test('RecordTalentInteraction: summary kh├┤ng chß╗⌐a URL/base64/data URI', () => {
  const bad = RecordTalentInteractionInputSchema.safeParse({
    organizationId: org,
    laborProfileId: profileId,
    kind: 'NOTE',
    outcome: 'NEUTRAL',
    context: { source: src() },
    occurredAt: '2026-09-13T02:00:00.000Z',
    summary: 'xem chi tiß║┐t tß║íi https://example.com/transcript',
  });
  assert.equal(bad.success, false);
});

test('RecordTalentInteraction: thiß║┐u occurredAt bß╗ï reject', () => {
  assert.equal(
    RecordTalentInteractionInputSchema.safeParse({
      organizationId: org,
      laborProfileId: profileId,
      kind: 'NOTE',
      outcome: 'NEUTRAL',
      context: { source: src() },
    }).success,
    false,
  );
});

test('RecordClientInteraction: clientReferenceId opaque (thiß║┐u Client domain ghi unknown)', () => {
  // Client domain chi tiß║┐t ch╞░a chß╗æt (Backlog ┬º0.3d); schema chß╗ë y├¬u cß║ºu
  // opaque clientReferenceId; runtime HRP gate resolve canonical Client ID.
  const r = RecordClientInteractionInputSchema.parse({
    organizationId: org,
    clientReferenceId: 'client-ref-opaque-001',
    kind: 'CLIENT_OUTREACH',
    outcome: 'PENDING',
    context: { source: ext('ZALO_OA', conn) },
    occurredAt: '2026-09-13T02:00:00.000Z',
  });
  assert.equal(r.clientReferenceId, 'client-ref-opaque-001');
});

test('RecordClientInteraction: thiß║┐u Client domain input ΓÇö schema cho ph├⌐p UNKNOWN outcome', () => {
  // Khi thiß║┐u input tß╗½ Client, outcome = UNKNOWN l├á semantic ─æ├║ng.
  const r = RecordClientInteractionInputSchema.parse({
    organizationId: org,
    clientReferenceId: 'client-ref-001',
    kind: 'CLIENT_OUTREACH',
    outcome: 'UNKNOWN',
    context: { source: src() },
    occurredAt: '2026-09-13T02:00:00.000Z',
  });
  assert.equal(r.outcome, 'UNKNOWN');
});

test('RecordClientInteraction: assignee kh├íc actor ΓÇö schema KH├öNG suy actor tß╗½ assignee', () => {
  // Assignee l├á user-staff-2; actor sß║╜ ─æ╞░ß╗úc runtime x├íc minh tß╗½ envelope.
  const r = RecordClientInteractionInputSchema.parse({
    organizationId: org,
    clientReferenceId: 'client-ref-001',
    kind: 'CLIENT_OUTREACH',
    outcome: 'PENDING',
    context: { source: src() },
    occurredAt: '2026-09-13T02:00:00.000Z',
    assignee: { userId: 'user-staff-2', dueAt: '2026-09-20T02:00:00.000Z' },
  });
  assert.equal(r.assignee.userId, 'user-staff-2');
  // Schema KH├öNG c├│ field actor tr├¬n input ΓÇö actor ─æß║┐n tß╗½ envelope.
});

test('InteractionTimestamps: schema bind shape CONFIRMED; runtime gate PROPOSED (Q-22)', () => {
  // F0/G0/0.3d: schema KHONG tu enforce thu tu occurredAt <= effectiveAt <= recordedAt
  // (Q-22 PROPOSED); runtime HRP gate quyet policy khi domain decision xong.
  const r = InteractionTimestampsSchema.parse({
    occurredAt: '2026-09-13T01:00:00.000Z',
    effectiveAt: '2026-09-13T01:30:00.000Z',
    recordedAt: '2026-09-13T02:00:00.000Z',
  });
  assert.equal(r.recordedAt, '2026-09-13T02:00:00.000Z');

  // Schema chi parse ISO 8601; KHONG reject khi effectiveAt < occurredAt (Q-22 PROPOSED).
  const noOrderYet = InteractionTimestampsSchema.safeParse({
    occurredAt: '2026-09-13T02:00:00.000Z',
    effectiveAt: '2026-09-13T01:00:00.000Z',
    recordedAt: '2026-09-13T02:30:00.000Z',
  });
  assert.equal(noOrderYet.success, true, 'Schema KHONG tu enforce thu tu (Q-22 PROPOSED)');

  // Schema reject neu khong phai ISO 8601 datetime.
  const badFormat = InteractionTimestampsSchema.safeParse({
    occurredAt: 'abc',
    effectiveAt: '2026-09-13T02:00:00.000Z',
    recordedAt: '2026-09-13T02:30:00.000Z',
  });
  assert.equal(badFormat.success, false);
});test('InteractionTimestamps: bß║▒ng nhau OK (occurredAt = effectiveAt = recordedAt)', () => {
  // Schema cho ph├⌐p c├╣ng thß╗¥i ─æiß╗âm (test/e2e).
  const ts = '2026-09-13T02:00:00.000Z';
  const r = InteractionTimestampsSchema.parse({
    occurredAt: ts,
    effectiveAt: ts,
    recordedAt: ts,
  });
  assert.equal(r.recordedAt, ts);
});

test('RecordInteractionResult: server trß║ú interactionId + timestamps', () => {
  const r = RecordInteractionResultSchema.parse({
    interactionId: 'ix-001',
    timestamps: {
      occurredAt: '2026-09-13T01:00:00.000Z',
      effectiveAt: '2026-09-13T01:30:00.000Z',
      recordedAt: '2026-09-13T02:00:00.000Z',
    },
  });
  assert.equal(r.interactionId, 'ix-001');
});

test('INTERACTION_PAYLOAD_FORBIDDEN_FIELDS cß║Ñm transcript/attachment/base64/rawUrl', () => {
  for (const f of [
    'transcript',
    'rawTranscript',
    'attachment',
    'base64',
    'dataUri',
    'rawUrl',
    'publicUrl',
    'currentRelationship',
  ]) {
    assert.ok(
      INTERACTION_PAYLOAD_FORBIDDEN_FIELDS.includes(f),
      `${f} phß║úi thuß╗Öc forbidden list`,
    );
  }
});

test('OpenPlacementCase: laborProfileId optional (open c├│ thß╗â ch╞░a c├│ LaborProfile)', () => {
  // Open c├│ thß╗â tß╗½ conversation thuß║ºn; laborProfileId optional.
  const r = OpenPlacementCaseInputSchema.parse({
    organizationId: org,
    intendedStage: 'NEW',
    context: { source: ext('ZALO_OA', conn) },
  });
  assert.equal(r.laborProfileId, undefined);
});
