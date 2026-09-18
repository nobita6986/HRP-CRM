/**
 * profile.ts — updateLaborProfile + fill-missing semantics + patch whitelist.
 *
 * Ràng buộc (Backlog §0.3b):
 *  - Patch KHÔNG chứa CurrentRelationship / Handling / Beneficiary /
 *    arbitrary fields. Whitelist các field đã đối chiếu Master §10.3.1.
 *  - expectedVersion bắt buộc.
 *  - Fill-missing: chỉ điền field rỗng hợp lệ; KHÔNG ghi đè giá trị đã có.
 *    Schema không thể enforce runtime; runtime gate do HRP-owned.
 *  - Review confirmation gắn draft revision/digest; thay đổi field/evidence/
 *    intent/target làm confirmation cũ invalid.
 *  - EXACT_MATCH vẫn phải qua staff review trước submit; profile
 *    target/version khác bản review yêu cầu re-review.
 */
import { z } from 'zod';
import {
  CalendarDateSchema,
  CanonicalIdSchema,
  ExpectedVersionSchema,
  OrganizationIdSchema,
} from '../primitives.js';
import { EvidenceRefListSchema } from './evidence.js';
import { NormalizedPhoneSchema, CitizenIdNumberSchema } from './identity.js';

/* ───────────────────────────────────────────────────────────────────────────
 * Profile field whitelist.
 * CHỈ các field dưới đây được phép patch. Mọi field khác → schema reject.
 * Lưu ý: KHÔNG có CurrentRelationship (read-only), KHÔNG Handling,
 * KHÔNG Beneficiary, KHÔNG Worker.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Địa chỉ liên hệ (KHÁC địa chỉ trên CCCD). */
export const ContactAddressSchema = z
  .object({
    line1: z.string().min(1).max(200),
    ward: z.string().min(1).max(120).optional(),
    district: z.string().min(1).max(120).optional(),
    province: z.string().min(1).max(120).optional(),
    country: z.string().min(2).max(2).optional(),
  })
  .strict();

export const PatchFieldSchema = z.union([
  z.string().min(1).max(500), // free text như fullName, note
  z.boolean(),
  z.number().finite(),
  NormalizedPhoneSchema,
  CitizenIdNumberSchema,
  CalendarDateSchema,
  ContactAddressSchema,
]);

/** Whitelist các key có thể patch. */
export const PROFILE_PATCH_WHITELIST = Object.freeze([
  'fullName',
  'phone',
  'dob',
  'citizenAddress',
  'contactAddress',
  'gender',
  'emergencyContact',
] as const);

export type ProfilePatchKey = (typeof PROFILE_PATCH_WHITELIST)[number];

/**
 * Profile patch: key ∈ whitelist, value theo `PatchFieldSchema`.
 * Schema reject nếu có key ngoài whitelist (catchall).
 */
export const ProfilePatchSchema = z
  .record(z.string(), PatchFieldSchema)
  .superRefine((obj, ctx) => {
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'profilePatch phải có ít nhất một field',
      });
      return;
    }
    for (const k of keys) {
      if (!(PROFILE_PATCH_WHITELIST as readonly string[]).includes(k)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `field '${k}' không thuộc profile patch whitelist`,
          path: [k],
        });
      }
    }
  });

export type ProfilePatch = z.infer<typeof ProfilePatchSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * updateLaborProfile — input payload.
 * ─────────────────────────────────────────────────────────────────────────── */
export const UpdateLaborProfileInputSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    laborProfileId: CanonicalIdSchema,
    expectedVersion: ExpectedVersionSchema,
    patch: ProfilePatchSchema,
    /** Evidence refs bổ sung cho trường patch. */
    evidenceRefs: EvidenceRefListSchema.optional(),
    /**
     * Fill-missing semantics — đã chốt baseline. Schema KHÔNG cho phép
     * caller tắt: literal `true`, không thể override. Runtime HRP gate
     * enforce "không ghi đè giá trị đã có".
     */
    fillMissingOnly: z.literal(true),
    /** Optional: reference tới intake submission / review draft. */
    submissionRevisionId: z.string().min(1).max(128).optional(),
  })
  .strict();

export type UpdateLaborProfileInput = z.infer<
  typeof UpdateLaborProfileInputSchema
>;

/** Cờ marker runtime: patch bị schema reject nếu cố chèn field cấm. */
export const PROFILE_PATCH_FORBIDDEN_FIELDS = Object.freeze([
  'currentRelationship',
  'CurrentRelationship',
  'handling',
  'Handling',
  'handlingAssignmentId',
  'beneficiary',
  'Beneficiary',
  'referralAttribution',
  'worker',
  'Worker',
  'assignment',
  'Assignment',
  'effective',
  'EFFECTIVE',
  'placementCaseId',
  'placementStatus',
  'arbitraryPatch',
  'rawPatch',
  'noteInternal',
] as const);

/** Schema strict reject field cấm trong patch. */
export const ProfilePatchSafeSchema = ProfilePatchSchema.superRefine(
  (obj, ctx) => {
    for (const k of Object.keys(obj)) {
      if ((PROFILE_PATCH_FORBIDDEN_FIELDS as readonly string[]).includes(k)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `field cấm '${k}' không được phép trong profile patch`,
          path: [k],
        });
      }
    }
  },
);

/* ───────────────────────────────────────────────────────────────────────────
 * Result schema cho updateLaborProfile.
 *  - APPLIED: canonicalId + newVersion (after apply).
 *  - NOOP:    patch không thay đổi gì (đã đúng giá trị hiện tại).
 * Schema không phân biệt "đã ghi đè" vs "fill-missing" — runtime HRP gate.
 * ─────────────────────────────────────────────────────────────────────────── */
export const UpdateLaborProfileResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('APPLIED'),
      canonicalId: CanonicalIdSchema,
      newVersion: ExpectedVersionSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('NOOP'),
      canonicalId: CanonicalIdSchema,
      currentVersion: ExpectedVersionSchema,
    })
    .strict(),
]);
