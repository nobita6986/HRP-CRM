declare const Buffer: { from(input: string | Uint8Array, encoding?: string): Uint8Array; byteLength(input: string, encoding?: string): number; } | undefined;
function byteLengthUtf8(s: string): number { if (typeof Buffer !== "undefined" && typeof Buffer.byteLength === "function") return Buffer.byteLength(s, "utf8"); return new TextEncoder().encode(s).length; }
import { z } from 'zod';
import {
  CorrelationIdSchema,
  OrganizationIdSchema,
  CanonicalIdSchema,
  DelegationRefSchema,
  IsoTimestampSchema,
  ModuleSchemaVersionSchema,
} from './primitives.js';

// ============================================================================
// TalentContextReadQuery - per REC-004B section 2 (incorporating MSG-027 disposition
// on no-version-counterproposal, S28 query/parser shape and EP-01 actor rule).
// ============================================================================

/** Dedicated query target: read by known canonical LaborProfile ID. */
export const TalentContextReadTargetSchema = z
  .object({
    kind: z.literal('TALENT'),
    laborProfileId: CanonicalIdSchema,
  })
  .strict();

/**
 * Eight query fields. Only `identitySummary` is currently supported for the
 * thin slice; the other seven are recognized as "known but unsupported" so
 * they round-trip to `unavailableFields` when requested.
 */
export const TalentContextReadFieldSchema = z.enum([
  'identitySummary',
  'placementCase',
  'availability',
  'currentRelationship',
  'nextAction',
  'recentInteractions',
  'contactability',
  'suppressionSummary',
]);

/** fieldAllowlist: unique, length 1..8. */
export const TalentContextReadFieldAllowlistSchema = z
  .array(TalentContextReadFieldSchema)
  .min(1)
  .max(8)
  .refine((arr) => new Set(arr).size === arr.length, {
    message: 'fieldAllowlist must contain unique values',
  });

/**
 * F-02 — DELEGATED_USER actor per EP-01 / S25.
 *
 * The actor is an untrusted REQUEST claim. The signed assertion must bind
 * the same serviceId/userId/delegationRef values and HRP server-side must
 * verify the stored delegation still owns the requested (organizationId,
 * laborProfileId) pair before releasing identitySummary.
 *
 * delegationRef reuses the canonical F-03 token schema.
 */
export const QueryDelegatedUserActorSchema = z
  .object({
    kind: z.literal('DELEGATED_USER'),
    serviceId: CanonicalIdSchema,
    userId: CanonicalIdSchema,
    delegationRef: DelegationRefSchema,
  })
  .strict();

export const TalentContextReadQueryRequestSchema = z
  .object({
    schemaVersion: ModuleSchemaVersionSchema,
    correlationId: CorrelationIdSchema,
    organizationId: OrganizationIdSchema,
    actor: QueryDelegatedUserActorSchema,
    target: TalentContextReadTargetSchema,
    fieldAllowlist: TalentContextReadFieldAllowlistSchema,
  })
  .strict();

// ============================================================================
// Direct success result - 200 returns TalentContextReadResultSchema.
// No `data` / success wrapper. resolvedAt is query processing time only.
// ============================================================================

const FULL_NAME_MAX_BYTES = 512;

export const IdentitySummarySchema = z
  .object({
    schemaVersion: ModuleSchemaVersionSchema,
    fullNameRedacted: z
      .string()
      .min(1)
      .refine(
        (s) => byteLengthUtf8(s) <= FULL_NAME_MAX_BYTES,
        'fullNameRedacted exceeds 512 UTF-8 bytes',
      ),
    displayOnly: z.literal(true),
  })
  .strict();

/** unavailableFields: unique, length 0..8. */
export const UnavailableFieldsSchema = z
  .array(TalentContextReadFieldSchema)
  .max(8)
  .refine((arr) => new Set(arr).size === arr.length, {
    message: 'unavailableFields must contain unique values',
  });

export const TalentContextReadResultSchema = z
  .object({
    schemaVersion: ModuleSchemaVersionSchema,
    correlationId: CorrelationIdSchema,
    organizationId: OrganizationIdSchema,
    target: TalentContextReadTargetSchema,
    identitySummary: IdentitySummarySchema.optional(),
    unavailableFields: UnavailableFieldsSchema,
    resolvedAt: IsoTimestampSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.identitySummary && value.unavailableFields.includes('identitySummary')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unavailableFields'],
        message: 'identitySummary present but also marked unavailable',
      });
    }
  });