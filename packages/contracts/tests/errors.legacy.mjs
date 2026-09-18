import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ContractErrorSchema,
  ERROR_HTTP_HINT,
  ERROR_POLICIES,
  ERROR_RETRYABLE_DEFAULT,
  ErrorCodeSchema,
  ErrorListSchema,
  errorMessagesVi,
  makeError,
  validateContract,
  SchemaVersionSchema,
} from '../dist/index.js';

const reject = (schema, value) => assert.equal(schema.safeParse(value).success, false);

test('error taxonomy includes required domain/auth/dependency/unknown-outcome classes', () => {
  const required = [
    'VALIDATION_ERROR', 'UNRESOLVED_IDENTITY', 'POLICY_REJECTION',
    'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'AUTHENTICATION_REQUIRED',
    'FORBIDDEN', 'DEPENDENCY_UNAVAILABLE', 'RATE_LIMITED', 'UNKNOWN_COMMAND_OUTCOME',
  ];
  assert.deepEqual(ErrorCodeSchema.options, required);
});

test('retry and translation metadata are fixed by error code', () => {
  for (const [code, policy] of Object.entries(ERROR_POLICIES)) {
    const parsed = ContractErrorSchema.parse({ code, ...policy });
    assert.equal(parsed.retryClass, policy.retryClass);
    assert.equal(typeof errorMessagesVi[policy.messageKey], 'string');
    reject(ContractErrorSchema, { code, ...policy, retryClass: 'ALWAYS' });
    reject(ContractErrorSchema, { code, ...policy, messageKey: 'raw.provider.message' });
  }
  assert.equal(ERROR_RETRYABLE_DEFAULT.DEPENDENCY_UNAVAILABLE, true);
  assert.equal(ERROR_RETRYABLE_DEFAULT.RATE_LIMITED, true);
  assert.equal(ERROR_RETRYABLE_DEFAULT.VERSION_CONFLICT, false);
  assert.equal(ERROR_HTTP_HINT.IDEMPOTENCY_CONFLICT, 409);
});

test('structured errors reject stack, SQL, provider body, secrets and arbitrary details', () => {
  const safe = makeError('VALIDATION_ERROR', 'payload');
  for (const field of ['stack', 'sql', 'providerBody', 'secret', 'message', 'detail', 'details']) {
    reject(ContractErrorSchema, { ...safe, [field]: 'synthetic-sensitive-value' });
  }
});

test('field path is coarse allowlist and cannot echo PII/dynamic values', () => {
  assert.equal(makeError('VALIDATION_ERROR', 'actor').fieldPath, 'actor');
  for (const path of ['/payload/phone/0900000000', 'payload.0900000000', 'unknown']) {
    reject(ContractErrorSchema, { ...ERROR_POLICIES.VALIDATION_ERROR, code: 'VALIDATION_ERROR', fieldPath: path });
  }
});

test('FAILED error list requires at least one safe error', () => {
  assert.throws(() => ErrorListSchema.parse([]));
  assert.equal(ErrorListSchema.parse([makeError('FORBIDDEN')]).length, 1);
});

test('safe boundary validation never returns submitted marker or Zod issue details', () => {
  const marker = 'synthetic-sensitive-marker';
  const result = validateContract(SchemaVersionSchema, marker);
  assert.equal(result.success, false);
  assert.equal(JSON.stringify(result).includes(marker), false);
  assert.equal(JSON.stringify(result).includes('issues'), false);
});
