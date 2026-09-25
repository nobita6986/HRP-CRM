import { z } from 'zod';
import { CorrelationIdSchema, ModuleSchemaVersionSchema } from './primitives.js';

// ============================================================================
// Seven-code parser - distinct from frozen ContractErrorSchema.
// Per REC-004B section 3 + S28 TRANSPORT section 5.
// ============================================================================

export const QUERY_RETRY_NEVER = 'NEVER';
export const QUERY_RETRY_REAUTH = 'REAUTHENTICATE';
export const QUERY_RETRY_BOUNDED_NEW = 'BOUNDED_NEW_ASSERTION';

export const QueryRetryClassSchema = z.enum([
  QUERY_RETRY_NEVER,
  QUERY_RETRY_REAUTH,
  QUERY_RETRY_BOUNDED_NEW,
]);

export const QUERY_ERROR_HTTP_STATUS = Object.freeze({
  VALIDATION_ERROR: 422,
  AUTHENTICATION_REQUIRED: 401,
  FORBIDDEN: 403,
  RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
});

export const QUERY_ERROR_MESSAGE_KEY = Object.freeze({
  VALIDATION_ERROR: 'errors.validation',
  AUTHENTICATION_REQUIRED: 'errors.authenticationRequired',
  FORBIDDEN: 'errors.forbidden',
  RATE_LIMITED: 'errors.rateLimited',
  DEPENDENCY_UNAVAILABLE: 'errors.dependencyUnavailable',
  NOT_FOUND: 'errors.talentContext.notFound',
  INTERNAL_ERROR: 'errors.talentContext.internal',
});

export const QUERY_ERROR_RETRY_CLASS = Object.freeze({
  VALIDATION_ERROR: QUERY_RETRY_NEVER,
  AUTHENTICATION_REQUIRED: QUERY_RETRY_REAUTH,
  FORBIDDEN: QUERY_RETRY_NEVER,
  RATE_LIMITED: QUERY_RETRY_BOUNDED_NEW,
  DEPENDENCY_UNAVAILABLE: QUERY_RETRY_BOUNDED_NEW,
  NOT_FOUND: QUERY_RETRY_NEVER,
  INTERNAL_ERROR: QUERY_RETRY_NEVER,
});

export const QueryErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'AUTHENTICATION_REQUIRED',
  'FORBIDDEN',
  'RATE_LIMITED',
  'DEPENDENCY_UNAVAILABLE',
  'NOT_FOUND',
  'INTERNAL_ERROR',
]);

const queryErrorBase = z
  .object({
    code: QueryErrorCodeSchema,
    messageKey: z.string(),
    retryClass: QueryRetryClassSchema,
  })
  .strict();

export const TalentContextReadErrorSchema = queryErrorBase.superRefine((value, ctx) => {
  if (value.messageKey !== QUERY_ERROR_MESSAGE_KEY[value.code]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['messageKey'],
      message: 'messageKey does not match frozen triple for code ' + value.code,
    });
  }
  if (value.retryClass !== QUERY_ERROR_RETRY_CLASS[value.code]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['retryClass'],
      message: 'retryClass does not match frozen triple for code ' + value.code,
    });
  }
});

export const TalentContextReadErrorResponseSchema = z
  .object({
    schemaVersion: ModuleSchemaVersionSchema,
    status: z.literal('FAILED'),
    correlationId: CorrelationIdSchema,
    errors: z.array(TalentContextReadErrorSchema).length(1),
  })
  .strict();