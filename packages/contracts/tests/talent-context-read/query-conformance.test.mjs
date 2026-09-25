import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TalentContextReadQueryRequestSchema, TalentContextReadResultSchema,
  IdentitySummarySchema, UnavailableFieldsSchema,
  TalentContextReadFieldAllowlistSchema, parseTalentContextReadResponse,
  QUERY_ERROR_HTTP_STATUS, QUERY_ERROR_MESSAGE_KEY,
  QUERY_ERROR_RETRY_CLASS, QueryErrorCodeSchema,
} from '../../dist/talent-context-read/index.js';

const validBaseRequest = {
  schemaVersion: '1', correlationId: 'q-12345678', organizationId: 'org-abc',
  actor: { kind: 'DELEGATED_USER', serviceId: 'svc-hrp-crm', userId: 'user-12345', delegationRef: 'dg_' + 'A'.repeat(43) },
  target: { kind: 'TALENT', laborProfileId: 'labor-98765' },
  fieldAllowlist: ['identitySummary'],
};

describe('Q positive', () => {
  test('valid base', () => {
    const r = TalentContextReadQueryRequestSchema.safeParse(validBaseRequest);
    assert.equal(r.success, true);
  });
  test('8 unique fields', () => {
    const r = TalentContextReadQueryRequestSchema.safeParse({...validBaseRequest, fieldAllowlist: ['identitySummary','placementCase','availability','currentRelationship','nextAction','recentInteractions','contactability','suppressionSummary']});
    assert.equal(r.success, true);
  });
});

describe('Q negative', () => {
  test('wrong version rejected', () => {
    const r = TalentContextReadQueryRequestSchema.safeParse({...validBaseRequest, schemaVersion: '2'});
    assert.equal(r.success, false);
  });
  test('extra laborProfileVersion rejected', () => {
    const r = TalentContextReadQueryRequestSchema.safeParse({...validBaseRequest, laborProfileVersion: '5'});
    assert.equal(r.success, false);
  });
  test('USER actor rejected', () => {
    const r = TalentContextReadQueryRequestSchema.safeParse({...validBaseRequest, actor: { kind: 'USER', userId: 'u1' }});
    assert.equal(r.success, false);
  });
  test('short correlationId rejected', () => {
    const r = TalentContextReadQueryRequestSchema.safeParse({...validBaseRequest, correlationId: 'abc'});
    assert.equal(r.success, false);
  });
  test('COMPANY target rejected', () => {
    const r = TalentContextReadQueryRequestSchema.safeParse({...validBaseRequest, target: { kind: 'COMPANY', companyId: 'c1' }});
    assert.equal(r.success, false);
  });
  test('fieldAllowlist duplicate rejected', () => {
    const r = TalentContextReadFieldAllowlistSchema.safeParse(['identitySummary','identitySummary']);
    assert.equal(r.success, false);
  });
  test('fieldAllowlist empty rejected', () => {
    const r = TalentContextReadFieldAllowlistSchema.safeParse([]);
    assert.equal(r.success, false);
  });
});

const baseResult = {
  schemaVersion: '1', correlationId: 'q-12345678', organizationId: 'org-abc',
  target: { kind: 'TALENT', laborProfileId: 'labor-98765' },
  identitySummary: { schemaVersion: '1', fullNameRedacted: 'N V', displayOnly: true },
  unavailableFields: [],
  resolvedAt: '2026-09-22T10:00:00.000Z',
};

describe('R projection', () => {
  test('valid parses', () => {
    const r = TalentContextReadResultSchema.safeParse(baseResult);
    assert.equal(r.success, true);
  });
  test('identitySummary in unavailableFields rejected', () => {
    const r = TalentContextReadResultSchema.safeParse({...baseResult, unavailableFields: ['identitySummary']});
    assert.equal(r.success, false);
  });
  test('identitySummary omitted other unavailable valid', () => {
    const r = TalentContextReadResultSchema.safeParse({...baseResult, identitySummary: undefined, unavailableFields: ['placementCase']});
    assert.equal(r.success, true);
  });
  test('unavailableFields duplicate rejected', () => {
    const r = UnavailableFieldsSchema.safeParse(['identitySummary','identitySummary']);
    assert.equal(r.success, false);
  });
  test('displayOnly=false rejected', () => {
    const r = IdentitySummarySchema.safeParse({schemaVersion: '1', fullNameRedacted: 'N', displayOnly: false});
    assert.equal(r.success, false);
  });
  test('snapshotVersion extra rejected', () => {
    const r = TalentContextReadResultSchema.safeParse({...baseResult, snapshotVersion: 42});
    assert.equal(r.success, false);
  });
});

describe('7-code errors', () => {
  const eb = { schemaVersion: '1', status: 'FAILED', correlationId: 'q-12345678' };
  const codes = ['VALIDATION_ERROR','AUTHENTICATION_REQUIRED','FORBIDDEN','RATE_LIMITED','DEPENDENCY_UNAVAILABLE','NOT_FOUND','INTERNAL_ERROR'];
  for (const c of codes) {
    test('valid ' + c, () => {
      const body = {...eb, errors: [{ code: c, messageKey: QUERY_ERROR_MESSAGE_KEY[c], retryClass: QUERY_ERROR_RETRY_CLASS[c] }]};
      const hs = QUERY_ERROR_HTTP_STATUS[c];
      const p = parseTalentContextReadResponse(hs, body);
      assert.equal(p.success, false);
      assert.equal(p.status, 'QUERY_ERROR');
      assert.equal(p.httpStatus, hs);
      assert.equal(p.error.code, c);
    });
  }
  test('enum size 7', () => {
    assert.equal(QueryErrorCodeSchema.options.length, 7);
  });
  test('empty errors rejected', () => {
    const p = parseTalentContextReadResponse(422, {...eb, errors: []});
    assert.equal(p.success, false);
    assert.equal(p.status, 'PROTOCOL_ERROR');
  });
  test('multiple errors rejected', () => {
    const p = parseTalentContextReadResponse(422, {...eb, errors: [{code:'VALIDATION_ERROR',messageKey:'errors.validation',retryClass:'NEVER'},{code:'FORBIDDEN',messageKey:'errors.forbidden',retryClass:'NEVER'}]});
    assert.equal(p.success, false);
    assert.equal(p.status, 'PROTOCOL_ERROR');
  });
  test('VERSION_CONFLICT rejected', () => {
    const p = parseTalentContextReadResponse(409, {...eb, errors: [{code:'VERSION_CONFLICT',messageKey:'errors.versionConflict',retryClass:'REFRESH_AND_REVIEW'}]});
    assert.equal(p.success, false);
    assert.equal(p.status, 'PROTOCOL_ERROR');
  });
  test('UNKNOWN_COMMAND_OUTCOME rejected', () => {
    const p = parseTalentContextReadResponse(503, {...eb, errors: [{code:'UNKNOWN_COMMAND_OUTCOME',messageKey:'errors.unknownCommandOutcome',retryClass:'RECONCILE_FIRST'}]});
    assert.equal(p.success, false);
    assert.equal(p.status, 'PROTOCOL_ERROR');
  });
  test('BOUNDED_SAME_KEY rejected', () => {
    const p = parseTalentContextReadResponse(422, {...eb, errors: [{code:'VALIDATION_ERROR',messageKey:'errors.validation',retryClass:'BOUNDED_SAME_KEY'}]});
    assert.equal(p.success, false);
    assert.equal(p.status, 'PROTOCOL_ERROR');
  });
  test('wrong messageKey rejected', () => {
    const p = parseTalentContextReadResponse(422, {...eb, errors: [{code:'VALIDATION_ERROR',messageKey:'errors.forbidden',retryClass:'NEVER'}]});
    assert.equal(p.success, false);
    assert.equal(p.status, 'PROTOCOL_ERROR');
  });
  test('wrong HTTP rejected', () => {
    const p = parseTalentContextReadResponse(500, {...eb, errors: [{code:'NOT_FOUND',messageKey:'errors.talentContext.notFound',retryClass:'NEVER'}]});
    assert.equal(p.success, false);
    assert.equal(p.status, 'PROTOCOL_ERROR');
  });
  test('extra fields rejected', () => {
    const p = parseTalentContextReadResponse(422, {...eb, errors: [{code:'VALIDATION_ERROR',messageKey:'errors.validation',retryClass:'NEVER',details:'X'}]});
    assert.equal(p.success, false);
    assert.equal(p.status, 'PROTOCOL_ERROR');
  });
  test('404 null body not NOT_FOUND', () => {
    const p = parseTalentContextReadResponse(404, null);
    assert.equal(p.success, false);
    assert.equal(p.status, 'PROTOCOL_ERROR');
  });
  test('404 HTML not NOT_FOUND', () => {
    const p = parseTalentContextReadResponse(404, '<html></html>');
    assert.equal(p.success, false);
    assert.equal(p.status, 'PROTOCOL_ERROR');
  });
  test('no raw body leak', () => {
    const s = 'SENSITIVE' + Date.now();
    const p = parseTalentContextReadResponse(500, s);
    assert.equal(p.success, false);
    assert.equal(p.body, undefined);
    assert.equal(JSON.stringify(p).includes(s), false);
  });
});
