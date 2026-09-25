import { z } from 'zod';
import {
  CrmBindingBaseSchema,
  CrmBindingSchema,
  PendingRequestIdSchema,
  HandoffProofSchema,
  ReceiptSchema,
  DelegationRefSchema,
  CallbackStateSchema,
  CsrfTokenSchema,
  SingleScopeArraySchema,
  OpaqueBindingLikeIdSchema,
} from './primitives.js';

// ============================================================================
// Delegation operation schemas - S28 TRANSPORT sections 1-5.
// Distinct from query envelope; NO shared error parser with query.
//
// F-02 (PASS): pendingRequestId is in the PATH of exchange and cancel;
//   delegation error is { status: 'FAILED', error: { code } } only;
//   handoff/decision/approved/denied callbacks + CSRF token schemas added;
//   InternalAggregateRecordSchema is internal-only.
//
// F-04 (correction batch 2): every consumer-facing schema REUSES the same
//   strict CrmBindingSchema (organizationId/crmSubject/crmSessionHandle/
//   crmSessionDeadline/callbackId) instead of declaring weaker inline fields.
//   Past deadline with correct syntax is still accepted by cleanup
//   (cancel/revoke) without adding session/active requirements; the actor
//   shape from F-01 is what gates cleanup semantics, not the binding.
// ============================================================================

export {
  PendingRequestIdSchema,
  HandoffProofSchema,
  ReceiptSchema,
  DelegationRefSchema,
  CallbackStateSchema,
  SingleScopeArraySchema,
  CrmBindingSchema,
};

// ============================================================================
// Create delegation request (backend POST)
// Body: B + requestedScopes + callbackState.
// ============================================================================

export const CreateDelegationRequestSchema = CrmBindingBaseSchema.extend({
  requestedScopes: SingleScopeArraySchema,
  callbackState: CallbackStateSchema,
}).strict().superRefine((value, ctx) => {
  // Reuse the same strict binding constraints via a fresh check.
  const r = CrmBindingSchema.safeParse({
    organizationId: value.organizationId,
    crmSubject: value.crmSubject,
    crmSessionHandle: value.crmSessionHandle,
    crmSessionDeadline: value.crmSessionDeadline,
    callbackId: value.callbackId,
  });
  if (!r.success) {
    for (const i of r.error.issues) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: i.path, message: i.message });
    }
  }
});

export const CreateDelegationSuccessSchema = z
  .object({
    pendingRequestId: PendingRequestIdSchema,
    expiresAt: z.string().datetime({ offset: true }),
    handoffProof: HandoffProofSchema,
    handoffExpiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

// ============================================================================
// Browser handoff (HRP front-door form POST).
// Body: pendingRequestId + handoffProof + callbackState.
// ============================================================================

export const BrowserHandoffRequestSchema = z
  .object({
    pendingRequestId: PendingRequestIdSchema,
    handoffProof: HandoffProofSchema,
    callbackState: CallbackStateSchema,
  })
  .strict();

// ============================================================================
// Approval decision (browser front-door form POST).
// Body: pendingRequestId + decision + csrfToken.
// ============================================================================

export const ApprovalDecisionSchema = z.enum(['APPROVE', 'DENY']);

export const ApprovalDecisionRequestSchema = z
  .object({
    pendingRequestId: PendingRequestIdSchema,
    decision: ApprovalDecisionSchema,
    csrfToken: CsrfTokenSchema,
  })
  .strict();

// ============================================================================
// Callback outcome (HRP -> CRM browser response).
// Two outcomes with DIFFERENT shapes:
//   APPROVED: { pendingRequestId, callbackState, outcome: 'APPROVED', receipt }
//   DENIED:   { pendingRequestId, callbackState, outcome: 'DENIED' }
// ============================================================================

const CallbackOutcomeHeader = z
  .object({
    pendingRequestId: PendingRequestIdSchema,
    callbackState: CallbackStateSchema,
    outcome: z.enum(['APPROVED', 'DENIED']),
  })
  .strict();

export const ApprovedCallbackOutcomeSchema = CallbackOutcomeHeader.extend({
  outcome: z.literal('APPROVED'),
  receipt: ReceiptSchema,
}).strict();

export const DeniedCallbackOutcomeSchema = CallbackOutcomeHeader.extend({
  outcome: z.literal('DENIED'),
}).strict();

export const CallbackOutcomeSchema = z.union([
  ApprovedCallbackOutcomeSchema,
  DeniedCallbackOutcomeSchema,
]);

// ============================================================================
// Exchange (receipt -> delegation).
// pendingRequestId is in the route PATH:
//   POST /api/.../delegation-requests/{pendingRequestId}/exchange
// Body normative: B + receipt (no pendingRequestId, no delegationRef).
// ============================================================================

export const ExchangeDelegationRequestSchema = CrmBindingBaseSchema.extend({
  receipt: ReceiptSchema,
}).strict().superRefine((value, ctx) => {
  const r = CrmBindingSchema.safeParse({
    organizationId: value.organizationId,
    crmSubject: value.crmSubject,
    crmSessionHandle: value.crmSessionHandle,
    crmSessionDeadline: value.crmSessionDeadline,
    callbackId: value.callbackId,
  });
  if (!r.success) {
    for (const i of r.error.issues) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: i.path, message: i.message });
    }
  }
});

export const ExchangeDelegationSuccessSchema = z
  .object({
    delegationRef: DelegationRefSchema,
    effectiveHrpUserId: OpaqueBindingLikeIdSchema(128),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

// ============================================================================
// Cancel pending.
// pendingRequestId is in the route PATH:
//   POST /api/.../delegation-requests/{pendingRequestId}/cancel
// Body normative: B + reason.
// ============================================================================

export const CancelDelegationReasonSchema = z.enum([
  'EXCHANGE_OUTCOME_UNKNOWN',
  'SESSION_ENDED',
  'USER_CANCELLED',
]);

export const CancelDelegationRequestSchema = CrmBindingBaseSchema.extend({
  reason: CancelDelegationReasonSchema,
}).strict().superRefine((value, ctx) => {
  const r = CrmBindingSchema.safeParse({
    organizationId: value.organizationId,
    crmSubject: value.crmSubject,
    crmSessionHandle: value.crmSessionHandle,
    crmSessionDeadline: value.crmSessionDeadline,
    callbackId: value.callbackId,
  });
  if (!r.success) {
    for (const i of r.error.issues) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: i.path, message: i.message });
    }
  }
});

// ============================================================================
// Revoke.
// delegationRef IS in the authenticated POST BODY (NOT URL).
// Body: B + delegationRef + reason.
// ============================================================================

export const RevokeDelegationReasonSchema = z.enum([
  'SESSION_ENDED',
  'ACCOUNT_SWITCH',
  'USER_CANCELLED',
]);

export const RevokeDelegationRequestSchema = CrmBindingBaseSchema.extend({
  delegationRef: DelegationRefSchema,
  reason: RevokeDelegationReasonSchema,
}).strict().superRefine((value, ctx) => {
  const r = CrmBindingSchema.safeParse({
    organizationId: value.organizationId,
    crmSubject: value.crmSubject,
    crmSessionHandle: value.crmSessionHandle,
    crmSessionDeadline: value.crmSessionDeadline,
    callbackId: value.callbackId,
  });
  if (!r.success) {
    for (const i of r.error.issues) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: i.path, message: i.message });
    }
  }
});

// ============================================================================
// Generic delegation ACK (200 for cancel/revoke, known/unknown/expired all same)
// ============================================================================

export const DelegationAckSchema = z
  .object({
    acknowledged: z.literal(true),
  })
  .strict();

// ============================================================================
// Delegation error envelope (F-02 - PASS):
//   { status: 'FAILED', error: { code } } - no messageKey, no detail.
// Backend errors table from S28 TRANSPORT section 5.
// ============================================================================

export const DELEGATION_ERROR_HTTP_STATUS = Object.freeze({
  AUTHENTICATION_REQUIRED: 401,
  FORBIDDEN: 403,
  VALIDATION_ERROR: 422,
  RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
});

export const DelegationErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'FORBIDDEN',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL_ERROR',
]);

export const DelegationErrorSchema = z
  .object({
    code: DelegationErrorCodeSchema,
  })
  .strict();

export const DelegationErrorResponseSchema = z
  .object({
    status: z.literal('FAILED'),
    error: DelegationErrorSchema,
  })
  .strict();

// ============================================================================
// Internal aggregate DTO (NOT a wire schema).
// Internal-only record; never accepted on any HTTP route or browser surface.
// ============================================================================

export const InternalAggregateRecordSchema = z
  .object({
    schemaVersion: z.literal('1-internal'),
    pendingRequestId: PendingRequestIdSchema,
    serviceId: z.string().min(1).max(128),
    binding: CrmBindingSchema,
    scope: z.literal('talent-context:read:identitySummary'),
    audience: z.string().min(1).max(256),
    callbackState: CallbackStateSchema,
    effectiveHrpUserId: z.string().min(1).max(128).optional(),
    receiptDigest: z.string().regex(/^[A-Fa-f0-9]{64}$/).optional(),
    handoffProofDigest: z.string().regex(/^[A-Fa-f0-9]{64}$/).optional(),
    createdAt: z.string().datetime({ offset: true }),
    pendingExpiresAt: z.string().datetime({ offset: true }),
    state: z.enum(['PENDING', 'APPROVED', 'DENIED', 'EXCHANGED', 'CANCELLED', 'REVOKED', 'EXPIRED']),
  })
  .strict();

export type InternalAggregateRecord = z.infer<typeof InternalAggregateRecordSchema>;
