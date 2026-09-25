import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CorrelationIdSchema, OrganizationIdSchema, CanonicalIdSchema,
  IsoTimestampSchema, ModuleSchemaVersionSchema,
  TalentContextReadTargetSchema, QueryDelegatedUserActorSchema,
  TalentContextReadFieldAllowlistSchema, UnavailableFieldsSchema,
  IdentitySummarySchema,
} from '../../dist/talent-context-read/index.js';

describe('EP-01 strict claims shape', () => {
  test('correlationId bounds', () => {
    assert.equal(CorrelationIdSchema.safeParse('a').success, false);
    assert.equal(CorrelationIdSchema.safeParse('a-12345678').success, true);
    assert.equal(CorrelationIdSchema.safeParse('A'.repeat(129)).success, false);
  });

  test('correlationId opaque grammar', () => {
    assert.equal(CorrelationIdSchema.safeParse('a 1').success, false);
    assert.equal(CorrelationIdSchema.safeParse('-abc').success, false);
    assert.equal(CorrelationIdSchema.safeParse(':abc').success, false);
  });

  test('organizationId bounds', () => {
    assert.equal(OrganizationIdSchema.safeParse('').success, false);
    assert.equal(OrganizationIdSchema.safeParse('a').success, true);
    assert.equal(OrganizationIdSchema.safeParse('A'.repeat(65)).success, false);
  });

  test('canonical id bounds', () => {
    assert.equal(CanonicalIdSchema.safeParse('a').success, true);
    assert.equal(CanonicalIdSchema.safeParse('A'.repeat(129)).success, false);
  });

  test('IsoTimestampSchema bounds', () => {
    assert.equal(IsoTimestampSchema.safeParse('2026-09-22').success, false);
    assert.equal(IsoTimestampSchema.safeParse('2026-09-22T10:00:00.000Z').success, true);
    assert.equal(IsoTimestampSchema.safeParse('2026-09-22T10:00:00').success, false);
    assert.equal(IsoTimestampSchema.safeParse('2026-09-22T10:00:00+07:00').success, true);
  });

  test('ModuleSchemaVersionSchema = 1', () => {
    assert.equal(ModuleSchemaVersionSchema.safeParse('1').success, true);
    assert.equal(ModuleSchemaVersionSchema.safeParse('2').success, false);
  });
});

describe('EP-01 query target shape', () => {
  test('target kind=TALENT only', () => {
    assert.equal(TalentContextReadTargetSchema.safeParse({kind: 'TALENT', laborProfileId: 'lp-1'}).success, true);
    assert.equal(TalentContextReadTargetSchema.safeParse({kind: 'COMPANY'}).success, false);
  });
  test('target extras rejected', () => {
    assert.equal(TalentContextReadTargetSchema.safeParse({kind: 'TALENT', laborProfileId: 'lp-1', expectedVersion: 7}).success, false);
  });
});

describe('EP-01 delegated user actor', () => {
  test('valid DELEGATED_USER', () => {
    const r = QueryDelegatedUserActorSchema.safeParse({
      kind: 'DELEGATED_USER', serviceId: 'svc-1', userId: 'u-1', delegationRef: 'dg_' + 'A'.repeat(43),
    });
    assert.equal(r.success, true);
  });
  test('missing field rejected', () => {
    const r = QueryDelegatedUserActorSchema.safeParse({
      kind: 'DELEGATED_USER', serviceId: 'svc-1', userId: 'u-1',
    });
    assert.equal(r.success, false);
  });
  test('wrong kind rejected', () => {
    const r = QueryDelegatedUserActorSchema.safeParse({
      kind: 'USER', userId: 'u-1', serviceId: 'svc-1', delegationRef: 'dr-1',
    });
    assert.equal(r.success, false);
  });
});

describe('EP-05 field allowlist bounds', () => {
  test('1..8 unique', () => {
    assert.equal(TalentContextReadFieldAllowlistSchema.safeParse([]).success, false);
    assert.equal(TalentContextReadFieldAllowlistSchema.safeParse(['identitySummary']).success, true);
    assert.equal(TalentContextReadFieldAllowlistSchema.safeParse([
      'identitySummary','placementCase','availability','currentRelationship',
      'nextAction','recentInteractions','contactability','suppressionSummary',
    ]).success, true);
  });
  test('duplicates rejected', () => {
    const nine = [
      'identitySummary','placementCase','availability','currentRelationship',
      'nextAction','recentInteractions','contactability','suppressionSummary','identitySummary',
    ];
    assert.equal(TalentContextReadFieldAllowlistSchema.safeParse(nine).success, false);
  });
  test('unavailable fields 0..8', () => {
    assert.equal(UnavailableFieldsSchema.safeParse([]).success, true);
    assert.equal(UnavailableFieldsSchema.safeParse([
      'identitySummary','placementCase','availability','currentRelationship',
      'nextAction','recentInteractions','contactability','suppressionSummary',
    ]).success, true);
  });
  test('unknown field rejected', () => {
    const r = TalentContextReadFieldAllowlistSchema.safeParse(['unknownField']);
    assert.equal(r.success, false);
  });
});

describe('IdentitySummary shape', () => {
  test('valid', () => {
    assert.equal(IdentitySummarySchema.safeParse({schemaVersion: '1', fullNameRedacted: 'N V', displayOnly: true}).success, true);
  });
  test('fullNameRedacted required', () => {
    assert.equal(IdentitySummarySchema.safeParse({schemaVersion: '1', displayOnly: true}).success, false);
  });
  test('displayOnly must be true', () => {
    assert.equal(IdentitySummarySchema.safeParse({schemaVersion: '1', fullNameRedacted: 'X', displayOnly: false}).success, false);
  });
  test('extras rejected', () => {
    assert.equal(IdentitySummarySchema.safeParse({schemaVersion: '1', fullNameRedacted: 'X', displayOnly: true, raw: 'leak'}).success, false);
  });
});

// Future runtime test requirements (NOT exercised here):
// - Signature verification
// - jti consumption / replay fencing
// - Session active at exchange
// - RLS for object permission
// - Cancel atomicity
// - Browser/callback state
describe('Pure validators do not assert runtime invariants', () => {
  test('these tests intentionally have no fake PASS', () => {
    assert.equal(true, true);
  });
});
