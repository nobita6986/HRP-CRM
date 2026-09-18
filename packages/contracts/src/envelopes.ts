import { z } from 'zod';
import {
  ActorSchema,
  CommandIdSchema,
  CorrelationIdSchema,
  IdempotencyKeySchema,
  IsoTimestampSchema,
  OrganizationIdSchema,
  SCHEMA_VERSION,
  SchemaVersionSchema,
  CommandSourceSchema,
} from './primitives.js';
import { ErrorListSchema } from './errors.js';

export const RequestEnvelopeBaseSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    commandId: CommandIdSchema,
    idempotencyKey: IdempotencyKeySchema,
    correlationId: CorrelationIdSchema,
    organizationId: OrganizationIdSchema,
    source: CommandSourceSchema,
    actor: ActorSchema,
    occurredAt: IsoTimestampSchema.optional(),
  })
  .strict();
export type RequestEnvelopeBase = z.infer<typeof RequestEnvelopeBaseSchema>;

/** Payload is command-specific; command name remains route/factory allowlisted. */
export function commandRequest<T extends z.ZodTypeAny>(payloadSchema: T) {
  return RequestEnvelopeBaseSchema.extend({ payload: payloadSchema }).strict();
}

export const OperationReferenceSchema = z
  .object({
    kind: z.literal('COMMAND_OPERATION'),
    operationId: CommandIdSchema,
  })
  .strict();

/** Poll/query shape; runtime must bind the reference to org/command/actor. */
export const OperationQuerySchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    commandId: CommandIdSchema,
    operationId: CommandIdSchema,
    actor: ActorSchema,
  })
  .strict();
export type OperationQuery = z.infer<typeof OperationQuerySchema>;

const responseBase = {
  schemaVersion: SchemaVersionSchema,
  commandId: CommandIdSchema,
  correlationId: CorrelationIdSchema,
};

export const AcceptedResponseSchema = z
  .object({
    status: z.literal('ACCEPTED'),
    ...responseBase,
    operation: OperationReferenceSchema,
    errors: z.tuple([]),
  })
  .strict();

export const AppliedResponseBaseSchema = z
  .object({
    status: z.literal('APPLIED'),
    ...responseBase,
    data: z.unknown(),
    errors: z.tuple([]),
  })
  .strict();

export function applyApplied<T extends z.ZodTypeAny>(dataSchema: T) {
  return z
    .object({
      status: z.literal('APPLIED'),
      ...responseBase,
      data: dataSchema,
      errors: z.tuple([]),
    })
    .strict();
}

export const FailedResponseSchema = z
  .object({
    status: z.literal('FAILED'),
    ...responseBase,
    errors: ErrorListSchema,
  })
  .strict();

export function commandResponse<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.discriminatedUnion('status', [
    AcceptedResponseSchema,
    applyApplied(dataSchema),
    FailedResponseSchema,
  ]);
}

export const ResponseEnvelopeSchema = z.union([
  AcceptedResponseSchema,
  AppliedResponseBaseSchema,
  FailedResponseSchema,
]);

export type AcceptedResponse = z.infer<typeof AcceptedResponseSchema>;
export type FailedResponse = z.infer<typeof FailedResponseSchema>;

/**
 * Canonicalization is a proposal for equality testing only. It rejects values
 * that JSON cannot represent deterministically instead of silently collapsing
 * them. Production persistence/retention remains HRP-owned.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number không hỗ trợ');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
  }
  throw new TypeError('giá trị không biểu diễn được bằng canonical JSON');
}

export async function idempotencyDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(value));
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto không khả dụng');
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export { SCHEMA_VERSION };
