import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNRESOLVED_IDENTITY',
  'POLICY_REJECTION',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'AUTHENTICATION_REQUIRED',
  'FORBIDDEN',
  'DEPENDENCY_UNAVAILABLE',
  'RATE_LIMITED',
  'UNKNOWN_COMMAND_OUTCOME',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const RetryClassSchema = z.enum([
  'NEVER',
  'REAUTHENTICATE',
  'REVIEW_REQUIRED',
  'REFRESH_AND_REVIEW',
  'BOUNDED_SAME_KEY',
  'RECONCILE_FIRST',
]);
export type RetryClass = z.infer<typeof RetryClassSchema>;

/**
 * Retry behavior is fixed by code. Callers cannot turn a policy/auth/conflict
 * failure into an unrestricted retry by overriding response metadata.
 */
export const ERROR_POLICIES = Object.freeze({
  VALIDATION_ERROR: { messageKey: 'errors.validation', retryClass: 'NEVER' },
  AUTHENTICATION_REQUIRED: {
    messageKey: 'errors.authenticationRequired',
    retryClass: 'REAUTHENTICATE',
  },
  FORBIDDEN: { messageKey: 'errors.forbidden', retryClass: 'NEVER' },
  UNRESOLVED_IDENTITY: {
    messageKey: 'errors.unresolvedIdentity',
    retryClass: 'REVIEW_REQUIRED',
  },
  POLICY_REJECTION: {
    messageKey: 'errors.policyRejection',
    retryClass: 'REVIEW_REQUIRED',
  },
  VERSION_CONFLICT: {
    messageKey: 'errors.versionConflict',
    retryClass: 'REFRESH_AND_REVIEW',
  },
  IDEMPOTENCY_CONFLICT: {
    messageKey: 'errors.idempotencyConflict',
    retryClass: 'NEVER',
  },
  DEPENDENCY_UNAVAILABLE: {
    messageKey: 'errors.dependencyUnavailable',
    retryClass: 'BOUNDED_SAME_KEY',
  },
  RATE_LIMITED: { messageKey: 'errors.rateLimited', retryClass: 'BOUNDED_SAME_KEY' },
  UNKNOWN_COMMAND_OUTCOME: {
    messageKey: 'errors.unknownCommandOutcome',
    retryClass: 'RECONCILE_FIRST',
  },
} as const satisfies Record<ErrorCode, { messageKey: string; retryClass: RetryClass }>);

export const errorMessagesVi: Readonly<Record<string, string>> = Object.freeze({
  'errors.validation': 'Dữ liệu gửi lên không hợp lệ.',
  'errors.authenticationRequired': 'Phiên xác thực không hợp lệ hoặc đã hết hạn.',
  'errors.forbidden': 'Bạn không có quyền thực hiện thao tác này.',
  'errors.unresolvedIdentity': 'Chưa xác định được hồ sơ phù hợp; cần kiểm tra lại.',
  'errors.policyRejection': 'Thao tác chưa đáp ứng chính sách nghiệp vụ.',
  'errors.versionConflict': 'Dữ liệu đã thay đổi; vui lòng tải lại và kiểm tra.',
  'errors.idempotencyConflict': 'Yêu cầu trùng khóa nhưng nội dung không khớp.',
  'errors.dependencyUnavailable': 'Dịch vụ phụ thuộc đang tạm thời không khả dụng.',
  'errors.rateLimited': 'Có quá nhiều yêu cầu; vui lòng thử lại sau.',
  'errors.unknownCommandOutcome': 'Chưa xác định được kết quả; cần đối soát trước khi thử lại.',
});

/** Allowlisted coarse paths only; never include a submitted value in a path. */
export const ErrorFieldPathSchema = z.enum([
  'request',
  'schemaVersion',
  'commandId',
  'idempotencyKey',
  'correlationId',
  'organizationId',
  'source',
  'actor',
  'payload',
]);

const contractErrorBase = z
  .object({
    code: ErrorCodeSchema,
    messageKey: z.string(),
    retryClass: RetryClassSchema,
    fieldPath: ErrorFieldPathSchema.optional(),
  })
  .strict();

export const ContractErrorSchema = contractErrorBase.superRefine((value, context) => {
  const policy = ERROR_POLICIES[value.code];
  if (value.messageKey !== policy.messageKey) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['messageKey'], message: 'messageKey không khớp error code' });
  }
  if (value.retryClass !== policy.retryClass) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['retryClass'], message: 'retryClass không khớp error code' });
  }
});
export const StructuredErrorSchema = ContractErrorSchema;
export type ContractError = z.infer<typeof ContractErrorSchema>;
export type StructuredError = ContractError;

export const ErrorListSchema = z.array(ContractErrorSchema).min(1).max(64);

export function makeError(
  code: ErrorCode,
  fieldPath?: z.infer<typeof ErrorFieldPathSchema>,
): ContractError {
  const policy = ERROR_POLICIES[code];
  return ContractErrorSchema.parse({ code, ...policy, fieldPath });
}

export const ERROR_RETRYABLE_DEFAULT: Readonly<Record<ErrorCode, boolean>> = Object.freeze(
  Object.fromEntries(
    (Object.entries(ERROR_POLICIES) as Array<
      [ErrorCode, { messageKey: string; retryClass: RetryClass }]
    >).map(([code, policy]) => [code, policy.retryClass === 'BOUNDED_SAME_KEY']),
  ) as Record<ErrorCode, boolean>,
);

export const ERROR_HTTP_HINT: Readonly<Record<ErrorCode, number>> = Object.freeze({
  VALIDATION_ERROR: 422,
  AUTHENTICATION_REQUIRED: 401,
  FORBIDDEN: 403,
  UNRESOLVED_IDENTITY: 422,
  POLICY_REJECTION: 422,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  DEPENDENCY_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  UNKNOWN_COMMAND_OUTCOME: 503,
});

export type ContractValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: ContractError };

/**
 * Safe public-boundary validation: deliberately does not serialize Zod issues,
 * raw input, stack traces, SQL/provider bodies, or secrets.
 */
export function validateContract<T>(
  schema: z.ZodType<T>,
  input: unknown,
): ContractValidationResult<T> {
  const parsed = schema.safeParse(input);
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, error: makeError('VALIDATION_ERROR', 'request') };
}
