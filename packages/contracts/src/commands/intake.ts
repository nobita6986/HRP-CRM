/**
 * intake.ts — Intake submission payload, staff review confirmation,
 * read-only preview resolver, và lifecycle labels.
 *
 * Ràng buộc (Backlog §0.3b, Master §10.3):
 *  - Intake payload đầy đủ: fullName, phone, CCCD, address, 2 mặt CCCD
 *    evidence, business intent (stage + availability).
 *  - Tách identity-signal DTO tối thiểu (identity.ts) với intake DTO
 *    đầy đủ; DNC action tách biệt, không bị buộc intake đủ.
 *  - Confirmation gắn draft revision/digest; thay field/evidence/intent/
 *    target làm confirmation cũ invalid.
 *  - Preview resolver read-only port; KHÔNG gọi createOrMatch mutation.
 *  - Submission lifecycle SUBMITTED/APPLIED/HRP_REVIEWED tách biệt; đánh
 *    dấu proposed/experimental vì workflow HRP review chưa chốt
 *    pre/post-apply. Schema KHÔNG coi "approved" là canonical.
 */
import { z } from 'zod';
import {
  CanonicalIdSchema,
  ExpectedVersionSchema,
  OrganizationIdSchema,
} from '../primitives.js';
import {
  CommandSourceSchema,
  IntegrationCommandSourceSchema,
  HrpUiCommandSourceSchema,
} from '../primitives.js';
import { AvailabilitySchema, PlacementCaseStageSchema } from '../enums.js';
import { CalendarDateSchema } from '../primitives.js';
import { EvidenceRefListSchema } from './evidence.js';
import { NormalizedPhoneSchema, CitizenIdNumberSchema } from './identity.js';

/* ───────────────────────────────────────────────────────────────────────────
 * CCCD fields — phân biệt địa chỉ trên giấy tờ với địa chỉ liên hệ.
 * ─────────────────────────────────────────────────────────────────────────── */
export const CitizenIdentitySchema = z
  .object({
    number: CitizenIdNumberSchema,
    /** Địa chỉ trên CCCD — canonical, phân biệt với contactAddress. */
    address: z.string().min(1).max(500),
  })
  .strict();

export type CitizenIdentity = z.infer<typeof CitizenIdentitySchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * Business intent — stage + availability cho intake đầy đủ.
 * Stage dùng enum đã chốt; availability dùng enum đã chốt;
 * availableFromDate CHỉ yêu cầu khi availability = AVAILABLE_FROM_DATE
 * (runtime HRP enforce "future date" theo business clock; schema chỉ
 * validate format).
 * ─────────────────────────────────────────────────────────────────────────── */
export const BusinessIntentSchema = z
  .object({
    stage: PlacementCaseStageSchema,
    availability: AvailabilitySchema,
    availableFromDate: CalendarDateSchema.optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.availability === 'AVAILABLE_FROM_DATE' && !val.availableFromDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'AVAILABLE_FROM_DATE yêu cầu availableFromDate',
        path: ['availableFromDate'],
      });
    }
    if (val.availability !== 'AVAILABLE_FROM_DATE' && val.availableFromDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'availableFromDate chỉ hợp lệ khi availability = AVAILABLE_FROM_DATE',
        path: ['availableFromDate'],
      });
    }
  });

export type BusinessIntent = z.infer<typeof BusinessIntentSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * Conversation/connection reference — opaque; không PII.
 *
 * F2 (Auditor findings, Owner chỉ thị G0/0.8): source discriminator dùng
 * `CommandSourceSchema` từ primitives (HRP_UI vs INTEGRATION). Đồng bộ
 * với primitives/envelope source shape.
 *  - HRP_UI source KHÔNG có connectionId (CommandSourceSchema enforce
 *    `connectionId: null`).
 *  - INTEGRATION source bắt buộc connectionId (CommandSourceSchema enforce
 *    `ConnectionIdSchema`).
 *  - `externalConversationId` / `externalAccountId` chỉ áp dụng khi source
 *    là INTEGRATION; HRP_UI không cần.
 *  - `canonicalId` optional (EXACT đã xác minh).
 *
 * Lưu ý: KHÔNG tự ý nới rộng validation chung để phục vụ một nhánh; nếu
 * HRP_UI cần field riêng → refactor CommandSourceSchema ở primitives, đừng
 * đặt bypass ở đây.
 * ─────────────────────────────────────────────────────────────────────────── */
export const IntakeContextRefSchema = z
  .object({
    source: CommandSourceSchema,
    externalConversationId: z.string().min(1).max(256).optional(),
    externalAccountId: z.string().min(1).max(128).optional(),
    /** Canonical target reference nếu EXACT đã xác minh. */
    canonicalId: CanonicalIdSchema.optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    // externalConversationId/externalAccountId chỉ hợp lệ với INTEGRATION source.
    if (val.source.kind === 'HRP_UI') {
      if (val.externalConversationId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'externalConversationId không hợp lệ với HRP_UI source',
          path: ['externalConversationId'],
        });
      }
      if (val.externalAccountId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'externalAccountId không hợp lệ với HRP_UI source',
          path: ['externalAccountId'],
        });
      }
    }
  });

export type IntakeContextRef = z.infer<typeof IntakeContextRefSchema>;

/**
 * Re-export cho tiện khi test hoặc external code muốn gọi cụ thể shape.
 * KHÔNG dùng để bypass CommandSourceSchema.
 */
export { CommandSourceSchema, IntegrationCommandSourceSchema, HrpUiCommandSourceSchema };

/* ───────────────────────────────────────────────────────────────────────────
 * Intake submission payload — full intake (form Convert hoàn chỉnh).
 * Lưu ý: tất cả field này cùng với evidenceRefs là dữ liệu HRP bảo vệ;
 * KHÔNG đẩy vào Chatwoot custom attributes.
 * ─────────────────────────────────────────────────────────────────────────── */
export const IntakeSubmissionPayloadSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    context: IntakeContextRefSchema,
    fullName: z.string().min(1).max(200),
    phone: NormalizedPhoneSchema,
    citizenIdentity: CitizenIdentitySchema,
    /** Địa chỉ liên hệ (KHÁC citizenIdentity.address). */
    contactAddress: z.string().min(1).max(500).optional(),
    dob: CalendarDateSchema.optional(),
    intent: BusinessIntentSchema,
    /** 2 mặt CCCD tối thiểu: CCCD_FRONT + CCCD_BACK. Schema enforce >= 2;
     *  runtime cross-check ownership/scan. */
    evidenceRefs: EvidenceRefListSchema,
    /** Caller-supplied form revision id; idempotent. */
    intakeRevisionId: z.string().min(1).max(128),
    /** Optional: review draft revision đang được staff xác nhận. */
    reviewDraftId: z.string().min(1).max(128).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    // Schema enforce: full intake phải có ≥ 2 evidence (front + back).
    if (val.evidenceRefs.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'intake đầy đủ cần ≥ 2 evidence (front + back)',
        path: ['evidenceRefs'],
      });
    }
    const kinds = new Set(val.evidenceRefs.map((e) => e.kind));
    if (!(kinds.has('CCCD_FRONT') && kinds.has('CCCD_BACK'))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'intake đầy đủ cần CCCD_FRONT và CCCD_BACK',
        path: ['evidenceRefs'],
      });
    }
  });

export type IntakeSubmissionPayload = z.infer<typeof IntakeSubmissionPayloadSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * Staff review confirmation — gắn với draft revision/digest/actor.
 * Khi thay đổi field/evidence/intent/target, confirmation cũ invalid.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Digest (sha256 hex) của canonical form draft. */
export const DraftDigestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u, 'draftDigest phải SHA-256 hex 64 ký tự');

export const StaffReviewContextSchema = z
  .object({
    draftRevisionId: z.string().min(1).max(128),
    /** SHA-256 hex của canonical JSON draft. Schema chỉ enforce shape. */
    draftDigest: DraftDigestSchema,
    /** Optional: target reference (canonical) mà confirmation bind. */
    canonicalId: CanonicalIdSchema.optional(),
    /** Optional: phiên bản target lúc review (chống silent version drift). */
    canonicalVersion: ExpectedVersionSchema.optional(),
    /** Caller-side note; redacted, không chứa PII ngoài intake. */
    note: z.string().max(500).optional(),
  })
  .strict();

export const StaffReviewConfirmationSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    context: StaffReviewContextSchema,
    /** Cờ xác nhận: caller tuyên bố đã review draft + diff + evidence. */
    confirmed: z.literal(true),
  })
  .strict();

export type StaffReviewConfirmation = z.infer<
  typeof StaffReviewConfirmationSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * Read-only preview resolver — KHÔNG gọi createOrMatch.
 * Dùng để tra cứu target candidate cho UI trước khi submit; runtime enforce
 * "read-only resolver port" ở HRP-owned.
 * ─────────────────────────────────────────────────────────────────────────── */
export const PreviewResolverRequestSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    context: IntakeContextRefSchema,
    signal: z
      .object({
        fullName: z.string().min(1).max(200).optional(),
        phone: NormalizedPhoneSchema.optional(),
        citizenId: CitizenIdNumberSchema.optional(),
      })
      .strict()
      .refine(
        (v) =>
          v.fullName !== undefined ||
          v.phone !== undefined ||
          v.citizenId !== undefined,
        { message: 'preview signal phải có ít nhất một field' },
      ),
  })
  .strict();

export const PreviewResolverCandidateSchema = z
  .object({
    candidateId: z.string().min(1).max(128),
    /** Cờ match strength; KHÔNG phải canonical match outcome. */
    strength: z.enum(['STRONG', 'WEAK', 'PARTIAL']),
    /** Optional: redacted display label; runtime reviewer capability enforce. */
    label: z.string().max(200).optional(),
  })
  .strict();

export const PreviewResolverResultSchema = z
  .object({
    candidates: z.array(PreviewResolverCandidateSchema).max(16),
    /** TTL preview result; preview không commit gì. */
    previewExpiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type PreviewResolverRequest = z.infer<typeof PreviewResolverRequestSchema>;
export type PreviewResolverResult = z.infer<typeof PreviewResolverResultSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * Submission lifecycle labels — đánh dấu proposed/experimental.
 *  - SUBMITTED     : staff đã submit (qua confirmation).
 *  - APPLIED       : canonical mutation đã apply (EXACT fill-missing hoặc NEW).
 *  - HRP_REVIEWED  : HRP review workflow đã xử lý (post-apply).
 *
 * Lưu ý: workflow HRP review pre/post-apply chưa chốt → enum đánh dấu
 * proposed. Schema KHÔNG tự coi "approved" là canonical; HRP policy quyết.
 * ─────────────────────────────────────────────────────────────────────────── */
export const SUBMISSION_LIFECYCLE = ['SUBMITTED', 'APPLIED', 'HRP_REVIEWED'] as const;
export type SubmissionLifecycle = (typeof SUBMISSION_LIFECYCLE)[number];
export const SubmissionLifecycleSchema = z.enum(SUBMISSION_LIFECYCLE);

/**
 * Marker experimental: lifecycle labels KHÔNG phải canonical status,
 * chỉ phản ánh trạng thái kỹ thuật của intake submission. Owner cần chốt
 * pre/post-apply trước khi dùng production.
 */
export const SUBMISSION_LIFECYCLE_PROPOSED = true as const;

/** Helper: validate confirmation còn hiệu lực so với context hiện tại. */
export function isConfirmationValid(
  confirmation: StaffReviewConfirmation,
  currentContext: z.infer<typeof StaffReviewContextSchema>,
): boolean {
  return (
    confirmation.context.draftRevisionId === currentContext.draftRevisionId &&
    confirmation.context.draftDigest === currentContext.draftDigest &&
    confirmation.context.canonicalId === currentContext.canonicalId &&
    confirmation.context.canonicalVersion === currentContext.canonicalVersion
  );
}
