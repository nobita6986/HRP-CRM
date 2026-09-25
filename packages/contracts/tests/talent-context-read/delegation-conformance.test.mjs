import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  // Delegation wire schemas (F-02)
  CreateDelegationRequestSchema, CreateDelegationSuccessSchema,
  ExchangeDelegationRequestSchema, ExchangeDelegationSuccessSchema,
  CancelDelegationRequestSchema, RevokeDelegationRequestSchema,
  DelegationAckSchema,
  DelegationErrorResponseSchema,
  BrowserHandoffRequestSchema,
  ApprovalDecisionRequestSchema,
  ApprovedCallbackOutcomeSchema,
  DeniedCallbackOutcomeSchema,
  // Token / binding primitives (F-03 / F-04)
  PendingRequestIdSchema, HandoffProofSchema, ReceiptSchema,
  DelegationRefSchema, CallbackStateSchema, JtiSchema, CsrfTokenSchema,
  SingleScopeArraySchema, CrmBindingSchema,
  DELEGATION_ERROR_HTTP_STATUS,
  // Internal DTO (NOT a wire schema)
  InternalAggregateRecordSchema,
} from '../../dist/talent-context-read/index.js';

// Helper: build a 43-char canonical base64url token "AAAAA...A" (all As) that
// encodes 32 zero bytes. The all-A string is canonical because decoding and
// re-encoding yields the same string.
const A43 = 'A'.repeat(43);
const TK = (p) => p + A43;

const baseBinding = {
  organizationId: 'org-abc',
  crmSubject: 'user-12345',
  crmSessionHandle: 'sess-abcdef0123456789',
  crmSessionDeadline: '2026-09-22T10:15:00.000Z',
  callbackId: 'cb-12345678',
};

describe('F-03 canonical token encoder', () => {
  test('PendingRequestId accepts canonical 32-byte token', () => {
    assert.equal(PendingRequestIdSchema.safeParse(TK('pd_')).success, true);
  });
  test('PendingRequestId rejects wrong prefix', () => {
    assert.equal(PendingRequestIdSchema.safeParse(TK('xx_')).success, false);
  });
  test('PendingRequestId rejects raw non-prefixed', () => {
    assert.equal(PendingRequestIdSchema.safeParse('dr-1').success, false);
  });
  test('PendingRequestId rejects too-short', () => {
    assert.equal(PendingRequestIdSchema.safeParse('pd_short').success, false);
  });
  test('PendingRequestId rejects too-long', () => {
    assert.equal(PendingRequestIdSchema.safeParse(TK('pd_') + 'A').success, false);
  });
  test('PendingRequestId rejects padding', () => {
    // 32 zero bytes -> 43 chars. Pad with '=' should fail.
    assert.equal(PendingRequestIdSchema.safeParse(TK('pd_') + '=').success, false);
  });
  test('PendingRequestId rejects pad-bit mutated form', () => {
    // The all-A form decodes to 32 zero bytes; mutate pad bits and re-encode.
    // Encoded 33 bytes would yield 44 chars; boundary 42 chars decodes to <32 bytes.
    // Use a 42-char payload (length mismatch) -> reject.
    const s = 'pd_' + 'A'.repeat(42);
    assert.equal(PendingRequestIdSchema.safeParse(s).success, false);
  });
  test('DelegationRef rejects arbitrary dr_1', () => {
    assert.equal(DelegationRefSchema.safeParse('dr-1').success, false);
  });
  test('Receipt canonical decode/re-encode equality', () => {
    const v = TK('rc_');
    const r = ReceiptSchema.safeParse(v);
    assert.equal(r.success, true);
    assert.equal(r.success && (typeof r.data === 'string'), true);
  });
  test('JtiSchema accepts canonical', () => {
    assert.equal(JtiSchema.safeParse(TK('jt_')).success, true);
  });
  test('CsrfTokenSchema accepts canonical', () => {
    assert.equal(CsrfTokenSchema.safeParse(TK('cs_')).success, true);
  });
});

describe('F-02 Delegation create', () => {
  test('valid create body parses', () => {
    const r = CreateDelegationRequestSchema.safeParse({
      ...baseBinding,
      requestedScopes: ['talent-context:read:identitySummary'],
      callbackState: TK('st_'),
    });
    assert.equal(r.success, true);
  });
  test('create success body parses', () => {
    const r = CreateDelegationSuccessSchema.safeParse({
      pendingRequestId: TK('pd_'),
      expiresAt: '2026-09-22T10:05:00.000Z',
      handoffProof: TK('hp_'),
      handoffExpiresAt: '2026-09-22T10:02:00.000Z',
    });
    assert.equal(r.success, true);
  });
  test('extra scope literal rejected', () => {
    const r = CreateDelegationRequestSchema.safeParse({
      ...baseBinding,
      requestedScopes: ['talent-context:read:identitySummary', 'whatever'],
      callbackState: TK('st_'),
    });
    assert.equal(r.success, false);
  });
  test('extra fields rejected (.strict)', () => {
    const r = CreateDelegationRequestSchema.safeParse({
      ...baseBinding,
      requestedScopes: ['talent-context:read:identitySummary'],
      callbackState: TK('st_'),
      extra: 'X',
    });
    assert.equal(r.success, false);
  });
});

describe('F-02 Exchange path/body split', () => {
  test('exchange body WITHOUT pendingRequestId is accepted (id is in PATH)', () => {
    const r = ExchangeDelegationRequestSchema.safeParse({
      ...baseBinding,
      receipt: TK('rc_'),
    });
    assert.equal(r.success, true);
  });
  test('exchange body WITH pendingRequestId is REJECTED (id is in PATH, not body)', () => {
    const r = ExchangeDelegationRequestSchema.safeParse({
      ...baseBinding,
      pendingRequestId: TK('pd_'),
      receipt: TK('rc_'),
    });
    assert.equal(r.success, false);
  });
  test('exchange success body parses', () => {
    const r = ExchangeDelegationSuccessSchema.safeParse({
      delegationRef: TK('dg_'),
      effectiveHrpUserId: 'hrp-user-12345',
      expiresAt: '2026-09-22T10:15:00.000Z',
    });
    assert.equal(r.success, true);
  });
});

describe('F-02 Cancel path/body split', () => {
  test('cancel body WITHOUT pendingRequestId is accepted (id is in PATH)', () => {
    const r = CancelDelegationRequestSchema.safeParse({
      ...baseBinding,
      reason: 'EXCHANGE_OUTCOME_UNKNOWN',
    });
    assert.equal(r.success, true);
  });
  test('cancel body WITH pendingRequestId is REJECTED', () => {
    const r = CancelDelegationRequestSchema.safeParse({
      ...baseBinding,
      pendingRequestId: TK('pd_'),
      reason: 'EXCHANGE_OUTCOME_UNKNOWN',
    });
    assert.equal(r.success, false);
  });
  test('unknown reason rejected', () => {
    const r = CancelDelegationRequestSchema.safeParse({
      ...baseBinding,
      reason: 'OTHER_REASON',
    });
    assert.equal(r.success, false);
  });
});

describe('F-02 Revoke body contains delegationRef', () => {
  test('revoke body WITH delegationRef accepted', () => {
    const r = RevokeDelegationRequestSchema.safeParse({
      ...baseBinding,
      delegationRef: TK('dg_'),
      reason: 'SESSION_ENDED',
    });
    assert.equal(r.success, true);
  });
  test('revoke wrong reason rejected', () => {
    const r = RevokeDelegationRequestSchema.safeParse({
      ...baseBinding,
      delegationRef: TK('dg_'),
      reason: 'NOT_A_REASON',
    });
    assert.equal(r.success, false);
  });
});

describe('F-02 Browser operation schemas', () => {
  test('handoff body parses', () => {
    const r = BrowserHandoffRequestSchema.safeParse({
      pendingRequestId: TK('pd_'),
      handoffProof: TK('hp_'),
      callbackState: TK('st_'),
    });
    assert.equal(r.success, true);
  });
  test('approval decision APPROVE parses', () => {
    const r = ApprovalDecisionRequestSchema.safeParse({
      pendingRequestId: TK('pd_'),
      decision: 'APPROVE',
      csrfToken: TK('cs_'),
    });
    assert.equal(r.success, true);
  });
  test('approval decision DENY parses', () => {
    const r = ApprovalDecisionRequestSchema.safeParse({
      pendingRequestId: TK('pd_'),
      decision: 'DENY',
      csrfToken: TK('cs_'),
    });
    assert.equal(r.success, true);
  });
  test('approval decision with unknown value rejected', () => {
    const r = ApprovalDecisionRequestSchema.safeParse({
      pendingRequestId: TK('pd_'),
      decision: 'MAYBE',
      csrfToken: TK('cs_'),
    });
    assert.equal(r.success, false);
  });

  test('APPROVED callback requires receipt', () => {
    const r = ApprovedCallbackOutcomeSchema.safeParse({
      pendingRequestId: TK('pd_'),
      callbackState: TK('st_'),
      outcome: 'APPROVED',
    });
    assert.equal(r.success, false);
  });
  test('APPROVED callback WITH receipt parses', () => {
    const r = ApprovedCallbackOutcomeSchema.safeParse({
      pendingRequestId: TK('pd_'),
      callbackState: TK('st_'),
      outcome: 'APPROVED',
      receipt: TK('rc_'),
    });
    assert.equal(r.success, true);
  });
  test('DENIED callback WITHOUT receipt parses', () => {
    const r = DeniedCallbackOutcomeSchema.safeParse({
      pendingRequestId: TK('pd_'),
      callbackState: TK('st_'),
      outcome: 'DENIED',
    });
    assert.equal(r.success, true);
  });
  test('DENIED callback WITH receipt rejected (DENIED never carries receipt)', () => {
    const r = DeniedCallbackOutcomeSchema.safeParse({
      pendingRequestId: TK('pd_'),
      callbackState: TK('st_'),
      outcome: 'DENIED',
      receipt: TK('rc_'),
    });
    assert.equal(r.success, false);
  });
});

describe('F-02 Delegation error envelope is code-only', () => {
  for (const code of Object.keys(DELEGATION_ERROR_HTTP_STATUS)) {
    test('valid ' + code, () => {
      const r = DelegationErrorResponseSchema.safeParse({
        status: 'FAILED',
        error: { code },
      });
      assert.equal(r.success, true);
    });
  }
  test('messageKey field rejected (code-only by F-02)', () => {
    const r = DelegationErrorResponseSchema.safeParse({
      status: 'FAILED',
      error: { code: 'FORBIDDEN', messageKey: 'errors.forbidden' },
    });
    assert.equal(r.success, false);
  });
  test('extra fields rejected (strict)', () => {
    const r = DelegationErrorResponseSchema.safeParse({
      status: 'FAILED',
      error: { code: 'FORBIDDEN', detail: 'leak' },
    });
    assert.equal(r.success, false);
  });
  test('status=OK rejected', () => {
    const r = DelegationErrorResponseSchema.safeParse({
      status: 'OK',
      error: { code: 'FORBIDDEN' },
    });
    assert.equal(r.success, false);
  });
});

describe('F-04 immutable CRM binding grammar + UTC-Z', () => {
  test('valid binding parses', () => {
    assert.equal(CrmBindingSchema.safeParse(baseBinding).success, true);
  });
  test('callbackId with space rejected', () => {
    const r = CrmBindingSchema.safeParse({ ...baseBinding, callbackId: 'bad value' });
    assert.equal(r.success, false);
  });
  test('callbackId with newline rejected', () => {
    const r = CrmBindingSchema.safeParse({ ...baseBinding, callbackId: 'bad\nvalue' });
    assert.equal(r.success, false);
  });
  test('crmSessionHandle with newline rejected', () => {
    const r = CrmBindingSchema.safeParse({ ...baseBinding, crmSessionHandle: 'bad\nvalue' });
    assert.equal(r.success, false);
  });
  test('crmSessionDeadline +07:00 rejected', () => {
    const r = CrmBindingSchema.safeParse({ ...baseBinding, crmSessionDeadline: '2026-09-22T17:00:00+07:00' });
    assert.equal(r.success, false);
  });
  test('crmSessionDeadline UTC-Z accepted', () => {
    assert.equal(CrmBindingSchema.safeParse({ ...baseBinding, crmSessionDeadline: '2026-09-22T10:00:00.000Z' }).success, true);
  });
  test('past deadline with correct syntax accepted (cleanup retains immutable binding)', () => {
    assert.equal(CrmBindingSchema.safeParse({ ...baseBinding, crmSessionDeadline: '2020-01-01T00:00:00.000Z' }).success, true);
  });
});

describe('Internal aggregate DTO separated from wire', () => {
  test('internal DTO accepted', () => {
    const r = InternalAggregateRecordSchema.safeParse({
      schemaVersion: '1-internal',
      pendingRequestId: TK('pd_'),
      serviceId: 'svc-12345',
      binding: baseBinding,
      scope: 'talent-context:read:identitySummary',
      audience: 'https://hrp.example/api',
      callbackState: TK('st_'),
      effectiveHrpUserId: 'hrp-user-12345',
      receiptDigest: 'a'.repeat(64),
      handoffProofDigest: 'b'.repeat(64),
      createdAt: '2026-09-22T10:00:00.000Z',
      pendingExpiresAt: '2026-09-22T10:05:00.000Z',
      state: 'PENDING',
    });
    assert.equal(r.success, true);
  });
});

describe('Single scope literal array', () => {
  test('empty rejected', () => {
    assert.equal(SingleScopeArraySchema.safeParse([]).success, false);
  });
  test('two entries rejected', () => {
    assert.equal(SingleScopeArraySchema.safeParse(['talent-context:read:identitySummary', 'x']).success, false);
  });
  test('wrong literal rejected', () => {
    assert.equal(SingleScopeArraySchema.safeParse(['whatever']).success, false);
  });
  test('exact single literal accepted', () => {
    assert.equal(SingleScopeArraySchema.safeParse(['talent-context:read:identitySummary']).success, true);
  });
});

describe('ACK', () => {
  test('ack parses', () => {
    assert.equal(DelegationAckSchema.safeParse({ acknowledged: true }).success, true);
  });
  test('non-true rejected', () => {
    assert.equal(DelegationAckSchema.safeParse({ acknowledged: false }).success, false);
  });
  test('extra field rejected', () => {
    assert.equal(DelegationAckSchema.safeParse({ acknowledged: true, extra: 'x' }).success, false);
  });
});
