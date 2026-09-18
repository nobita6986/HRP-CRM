/**
 * suppression.test.mjs â€” fixtures G0/0.3e (DNC + dispatch authorization).
 *
 * Trá»ng tÃ¢m AC (Master Â§10.6.5):
 *  - DNC event/dispatch authorization/fencing contracts mÃ´ táº£ actor/
 *    version/cut-off; cache stale khÃ´ng cáº¥p phÃ©p gá»­i.
 *  - Unresolved contact cÃ³ local safety suppression reference khÃ´ng táº¡o
 *    canonical profile, khÃ´ng Ä‘Ã²i CCCD.
 *  - Inbound khÃ´ng tá»± gá»¡ DNC; automatic delivery fail closed khi khÃ´ng
 *    xÃ¡c minh contactability.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CommitSuppressionInputSchema,
  CommitSuppressionResultSchema,
  DispatchAuthorizationCheckInputSchema,
  DispatchAuthorizationCheckResultSchema,
  LaborProfileTargetRefSchema,
  ExternalContactTargetRefSchema,
  RecipientFenceTokenRefSchema,
  SuppressionTargetRefSchema,
  DncReasonSchema,
  SUPPRESSION_PATCH_FORBIDDEN,
} from '../dist/commands/suppression.js';
import { SCHEMA_VERSION } from '../dist/enums.js';
import { src } from './test-helpers.mjs';

const org = 'org-test-sup';

test('SuppressionTargetRef: 3 kind discriminator (LABOR_PROFILE/EXTERNAL_CONTACT/SUPPRESSED_RECIPIENT_FENCE)', () => {
  // LABOR_PROFILE target â€” resolvedCanonical = true (canonical Ä‘Ã£ cÃ³).
  const lp = SuppressionTargetRefSchema.parse({
    kind: 'LABOR_PROFILE',
    organizationId: org,
    laborProfileId: 'lp-canonical-001',
    expectedVersion: 5,
    resolvedCanonical: true,
  });
  assert.equal(lp.kind, 'LABOR_PROFILE');

  // EXTERNAL_CONTACT â€” resolvedCanonical = false (chÆ°a map canonical).
  const ext = SuppressionTargetRefSchema.parse({
    kind: 'EXTERNAL_CONTACT',
    organizationId: org,
    provider: 'CHATWOOT',
    connectionId: 'conn-cw-1',
    externalContactId: 'ext-contact-001',
    resolvedCanonical: false,
  });
  assert.equal(ext.kind, 'EXTERNAL_CONTACT');

  // SUPPRESSED_RECIPIENT_FENCE â€” fence token.
  const fence = SuppressionTargetRefSchema.parse({
    kind: 'SUPPRESSED_RECIPIENT_FENCE',
    organizationId: org,
    fenceToken: 'fence-abc-123',
    cutOffAt: '2026-09-13T11:00:00.000+07:00',
  });
  assert.equal(fence.kind, 'SUPPRESSED_RECIPIENT_FENCE');
});

test('LaborProfileTargetRef: resolvedCanonical marker â€” schema bind, runtime gate enforce', () => {
  // Schema cho phÃ©p resolvedCanonical: boolean; runtime gate quyáº¿t.
  // Test kháº³ng Ä‘á»‹nh schema khÃ´ng tá»± Ã½ require = true.
  const lpResolved = LaborProfileTargetRefSchema.parse({
    kind: 'LABOR_PROFILE',
    organizationId: org,
    laborProfileId: 'lp-canonical-001',
    expectedVersion: 5,
    resolvedCanonical: true,
  });
  assert.equal(lpResolved.resolvedCanonical, true);

  const lpUnresolved = LaborProfileTargetRefSchema.parse({
    kind: 'LABOR_PROFILE',
    organizationId: org,
    laborProfileId: 'lp-pending-001',
    expectedVersion: 1,
    resolvedCanonical: false,
  });
  assert.equal(lpUnresolved.resolvedCanonical, false);
});

test('ExternalContactTargetRef: resolvedCanonical = false báº¯t buá»™c (safety suppression khÃ´ng táº¡o LaborProfile)', () => {
  // Schema Ã©p resolvedCanonical = false cho EXTERNAL_CONTACT.
  assert.equal(
    ExternalContactTargetRefSchema.safeParse({
      kind: 'EXTERNAL_CONTACT',
      organizationId: org,
      provider: 'CHATWOOT',
      connectionId: 'conn-cw-1',
      externalContactId: 'ext-contact-001',
      resolvedCanonical: true, // Sai
    }).success,
    false,
    'EXTERNAL_CONTACT target khÃ´ng Ä‘Æ°á»£c cÃ³ resolvedCanonical=true',
  );

  const ok = ExternalContactTargetRefSchema.parse({
    kind: 'EXTERNAL_CONTACT',
    organizationId: org,
    provider: 'ZALO_OA',
    connectionId: 'conn-zalo-1',
    externalContactId: 'ext-contact-002',
    resolvedCanonical: false,
  });
  assert.equal(ok.resolvedCanonical, false);
});

test('RecipientFenceTokenRef: fenceToken + cutOffAt Ä‘i cÃ¹ng nhau', () => {
  // Schema Ã©p schema strict + min/max fenceToken; runtime gate Ä‘á»‘i chiáº¿u
  // token + cut-off trÆ°á»›c khi cho gá»­i.
  const ok = RecipientFenceTokenRefSchema.parse({
    kind: 'SUPPRESSED_RECIPIENT_FENCE',
    organizationId: org,
    fenceToken: 'fence-abc-123',
    cutOffAt: '2026-09-13T11:00:00.000+07:00',
  });
  assert.equal(ok.fenceToken, 'fence-abc-123');
});

test('DncReason: 4 giÃ¡ trá»‹ chÃ­nh thá»©c', () => {
  for (const r of ['CANDIDATE_REQUEST', 'PRIVACY_REQUEST', 'HRP_POLICY', 'OTHER']) {
    assert.equal(DncReasonSchema.safeParse(r).success, true);
  }
  assert.equal(DncReasonSchema.safeParse('random').success, false);
});

test('CommitSuppressionInput: LABOR_PROFILE target cÃ³ expectedVersion (AC #1 actor/version)', () => {
  const r = CommitSuppressionInputSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    target: {
      kind: 'LABOR_PROFILE',
      organizationId: org,
      laborProfileId: 'lp-canonical-001',
      expectedVersion: 5,
      resolvedCanonical: true,
    },
    reason: 'CANDIDATE_REQUEST',
    context: { source: src() },
  });
  assert.equal(r.reason, 'CANDIDATE_REQUEST');
});

test('CommitSuppressionInput: EXTERNAL_CONTACT cho safety suppression (AC #2 unresolved)', () => {
  // Master Â§10.6.5 #4: contact chÆ°a map canonical váº«n ghi local safety
  // suppression, khÃ´ng táº¡o LaborProfile.
  const r = CommitSuppressionInputSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    target: {
      kind: 'EXTERNAL_CONTACT',
      organizationId: org,
      provider: 'CHATWOOT',
      connectionId: 'conn-cw-1',
      externalContactId: 'ext-contact-001',
      resolvedCanonical: false,
    },
    reason: 'PRIVACY_REQUEST',
    note: 'khÃ¡ch yÃªu cáº§u dá»«ng liÃªn há»‡ qua chat',
    context: { source: src() },
  });
  assert.equal(r.target.kind, 'EXTERNAL_CONTACT');
});

test('CommitSuppressionInput: KHÃ”NG yÃªu cáº§u CCCD/intake Ä‘áº§y Ä‘á»§ (DNC Ä‘á»™c láº­p)', () => {
  // Master Â§10.6.5 #4: "khÃ´ng báº¯t khÃ¡ch hoÃ n thiá»‡n há»“ sÆ¡/CCCD Ä‘á»ƒ Ä‘Æ°á»£c
  // dá»«ng tin". Schema chá»‰ bind target + reason + context.
  const r = CommitSuppressionInputSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    target: {
      kind: 'EXTERNAL_CONTACT',
      organizationId: org,
      provider: 'CHATWOOT',
      connectionId: 'conn-cw-1',
      externalContactId: 'ext-contact-001',
      resolvedCanonical: false,
    },
    reason: 'HRP_POLICY',
    context: { source: src() },
  });
  // KhÃ´ng cÃ³ fullName/CCCD/dob trong payload.
  assert.equal(r.target.kind, 'EXTERNAL_CONTACT');
});

test('CommitSuppressionInput: note KHÃ”NG chá»©a URL/base64 (PII safe)', () => {
  const base = {
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    target: {
      kind: 'EXTERNAL_CONTACT',
      organizationId: org,
      provider: 'CHATWOOT',
      connectionId: 'conn-cw-1',
      externalContactId: 'ext-contact-001',
      resolvedCanonical: false,
    },
    reason: 'OTHER',
    context: { source: src() },
  };
  assert.equal(
    CommitSuppressionInputSchema.safeParse({
      ...base,
      note: 'xem https://example.com',
    }).success,
    false,
  );
  const ok = CommitSuppressionInputSchema.safeParse({
    ...base,
    note: 'khÃ¡ch yÃªu cáº§u riÃªng qua phone',
  });
  assert.equal(ok.success, true);
});

test('CommitSuppressionResult: fenceToken + fenceCutOffAt Ä‘i cÃ¹ng nhau (AC #1 fencing)', () => {
  // CÃ¹ng cÃ³.
  const r1 = CommitSuppressionResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    suppressionEventId: 'sup-evt-001',
    targetKind: 'SUPPRESSED_RECIPIENT_FENCE',
    appliedAt: '2026-09-13T10:00:00.000+07:00',
    fenceToken: 'fence-abc-001',
    fenceCutOffAt: '2026-09-13T11:00:00.000+07:00',
  });
  assert.equal(r1.fenceToken, 'fence-abc-001');

  // Chá»‰ fenceToken â†’ reject.
  assert.equal(
    CommitSuppressionResultSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      suppressionEventId: 'sup-evt-002',
      targetKind: 'LABOR_PROFILE',
      appliedAt: '2026-09-13T10:00:00.000+07:00',
      fenceToken: 'fence-abc-002',
    }).success,
    false,
  );
});

test('CommitSuppressionResult: SUPPRESSED_RECIPIENT_FENCE pháº£i cÃ³ fenceToken', () => {
  assert.equal(
    CommitSuppressionResultSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      suppressionEventId: 'sup-evt-003',
      targetKind: 'SUPPRESSED_RECIPIENT_FENCE',
      appliedAt: '2026-09-13T10:00:00.000+07:00',
    }).success,
    false,
    'SUPPRESSED_RECIPIENT_FENCE result pháº£i cÃ³ fenceToken',
  );
});

test('DispatchAuthorizationCheckInput: target + provider + connectionId (gate check)', () => {
  const r = DispatchAuthorizationCheckInputSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    target: {
      kind: 'LABOR_PROFILE',
      organizationId: org,
      laborProfileId: 'lp-canonical-001',
      expectedVersion: 5,
      resolvedCanonical: true,
    },
    provider: 'CHATWOOT',
    connectionId: 'conn-cw-1',
  });
  assert.equal(r.provider, 'CHATWOOT');
});

test('DispatchAuthorizationCheckResult: AUTHORIZED chá»‰ cÃ³ reason=OK', () => {
  const r = DispatchAuthorizationCheckResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    outcome: 'AUTHORIZED',
    reason: 'OK',
    checkedAt: '2026-09-13T10:00:00.000+07:00',
    nextFenceToken: 'fence-next-001',
    nextFenceCutOffAt: '2026-09-13T11:00:00.000+07:00',
  });
  assert.equal(r.outcome, 'AUTHORIZED');

  // AUTHORIZED + reason=DNC_ACTIVE â†’ reject.
  assert.equal(
    DispatchAuthorizationCheckResultSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      outcome: 'AUTHORIZED',
      reason: 'DNC_ACTIVE',
      checkedAt: '2026-09-13T10:00:00.000+07:00',
    }).success,
    false,
  );
});

test('DispatchAuthorizationCheckResult: SUPPRESSED KHÃ”NG cÃ³ reason=OK', () => {
  const r = DispatchAuthorizationCheckResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    outcome: 'SUPPRESSED',
    reason: 'DNC_ACTIVE',
    checkedAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r.outcome, 'SUPPRESSED');

  // SUPPRESSED + reason=OK â†’ reject.
  assert.equal(
    DispatchAuthorizationCheckResultSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      outcome: 'SUPPRESSED',
      reason: 'OK',
      checkedAt: '2026-09-13T10:00:00.000+07:00',
    }).success,
    false,
  );
});

test('DispatchAuthorizationCheckResult: UNKNOWN = HRP_OFFLINE / CACHE_STALE (fail closed)', () => {
  // Stale cache khÃ´ng cáº¥p phÃ©p gá»­i (Master Â§10.6.5 #3).
  const r1 = DispatchAuthorizationCheckResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    outcome: 'UNKNOWN',
    reason: 'CACHE_STALE',
    checkedAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r1.outcome, 'UNKNOWN');

  const r2 = DispatchAuthorizationCheckResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    outcome: 'UNKNOWN',
    reason: 'HRP_OFFLINE',
    checkedAt: '2026-09-13T10:00:00.000+07:00',
  });
  assert.equal(r2.reason, 'HRP_OFFLINE');
});

test('DispatchAuthorizationCheckResult: nextFenceToken vÃ  nextFenceCutOffAt Ä‘i cÃ¹ng nhau', () => {
  // CÃ¹ng cÃ³.
  const ok = DispatchAuthorizationCheckResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    outcome: 'AUTHORIZED',
    reason: 'OK',
    checkedAt: '2026-09-13T10:00:00.000+07:00',
    nextFenceToken: 'fence-next-002',
    nextFenceCutOffAt: '2026-09-13T11:00:00.000+07:00',
  });
  assert.equal(ok.nextFenceToken, 'fence-next-002');

  // Chá»‰ nextFenceToken â†’ reject.
  assert.equal(
    DispatchAuthorizationCheckResultSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      outcome: 'AUTHORIZED',
      reason: 'OK',
      checkedAt: '2026-09-13T10:00:00.000+07:00',
      nextFenceToken: 'fence-next-003',
    }).success,
    false,
  );
});

test('SUPPRESSION_PATCH_FORBIDDEN: khÃ´ng cho phÃ©p tá»± gá»¡ DNC / bypass cache stale', () => {
  // Master Â§10.6.5 #2 + #3: cache stale khÃ´ng cáº¥p phÃ©p gá»­i.
  assert.ok(SUPPRESSION_PATCH_FORBIDDEN.includes('removeSuppression'));
  assert.ok(SUPPRESSION_PATCH_FORBIDDEN.includes('optBackIn'));
  assert.ok(SUPPRESSION_PATCH_FORBIDDEN.includes('forceSend'));
  assert.ok(SUPPRESSION_PATCH_FORBIDDEN.includes('bypassDnc'));
  assert.ok(SUPPRESSION_PATCH_FORBIDDEN.includes('ignoreStaleCache'));
  // Inbound tá»± gá»¡ â€” KHÃ”NG Ä‘Æ°á»£c (Master #6).
  assert.ok(SUPPRESSION_PATCH_FORBIDDEN.includes('inboundOptOutRemoval'));
  assert.ok(SUPPRESSION_PATCH_FORBIDDEN.includes('autoClearOnInbound'));
  // Auto-create LaborProfile â€” KHÃ”NG Ä‘Æ°á»£c.
  assert.ok(SUPPRESSION_PATCH_FORBIDDEN.includes('createLaborProfile'));
  assert.ok(SUPPRESSION_PATCH_FORBIDDEN.includes('mergeLaborProfile'));
});
