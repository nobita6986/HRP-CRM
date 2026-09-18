/**
 * identity.ts — Identity signals + createOrMatchLaborProfile DTO.
 *
 * Ràng buộc (Master §7.2.1, §10.3, Backlog §0.3a):
 *  - EXACT_MATCH / NEW_PROFILE có canonicalId + version;
 *    POSSIBLE_MATCH có review reference, KHÔNG có target mutation hợp lệ.
 *  - NEW_PROFILE là command result, KHÔNG trở thành matching state thứ tư
 *    của ExternalContactLink. Link với canonicalId đã xác nhận dùng
 *    EXACT_MATCH.
 *  - Phone normalized là signal, KHÔNG phải unique-person proof hoặc
 *    idempotency key duy nhất. Thiếu evidence KHÔNG ép tạo NEW.
 *  - Tách identity-signal DTO tối thiểu với complete-intake DTO (CCCD +
 *    intent) — DNC action độc lập không bị buộc đủ intake.
 *  - Candidate details chỉ read theo reviewer capability; schema không
 *    expose candidate ID trong mutation input.
 *  - Không rawTranscript, không attachment bytes, không arbitrary patch.
 */
import { z } from 'zod';
import {
  ConnectionIdSchema,
  ExpectedVersionSchema,
  OrganizationIdSchema,
  ProviderNameSchema,
} from '../primitives.js';
import { CalendarDateSchema } from '../primitives.js';
import { EvidenceClaimSchema, EvidenceRefListSchema } from './evidence.js';
import { DncReasonAcceptAliasSchema, DncReasonSchema } from './dnc.js';

/* ───────────────────────────────────────────────────────────────────────────
 * Identity signals — tối thiểu để tạo tín hiệu.
 * Lưu ý: tất cả field là OPTIONAL; runtime HRP quyết định có đủ để match
 * hay không. Thiếu signal KHÔNG ép tạo NEW_PROFILE.
 * ─────────────────────────────────────────────────────────────────────────── */
const PHONE_REGEX = /^\+?\d{8,15}$/;

export const NormalizedPhoneSchema = z
  .string()
  .regex(PHONE_REGEX, 'phone normalized phải 8–15 chữ số (E.164 đơn giản)');

const CCCD_REGEX = /^\d{9,12}$/;

export const CitizenIdNumberSchema = z
  .string()
  .regex(CCCD_REGEX, 'citizenId phải 9–12 chữ số');

export const IdentitySignalSchema = z
  .object({
    fullName: z.string().min(1).max(200).optional(),
    phone: NormalizedPhoneSchema.optional(),
    citizenId: CitizenIdNumberSchema.optional(),
    dob: CalendarDateSchema.optional(),
    /** Địa chỉ trên CCCD (canonical) — phân biệt với address liên hệ. */
    citizenAddress: z.string().min(1).max(500).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.fullName !== undefined ||
      v.phone !== undefined ||
      v.citizenId !== undefined ||
      v.dob !== undefined ||
      v.citizenAddress !== undefined,
    { message: 'identity signal phải có ít nhất một field' },
  );

export type IdentitySignal = z.infer<typeof IdentitySignalSchema>;

/** Provenance: nguồn cung cấp signal. */
export const IdentityProvenanceSchema = z
  .object({
    provider: ProviderNameSchema,
    connectionId: ConnectionIdSchema,
    /** Channel do adapter cung cấp; không dùng để quyết auth. */
    channel: z.string().min(1).max(64).optional(),
    /** Thời điểm thu thập; server vẫn ghi recordedAt riêng. */
    collectedAt: z.string().datetime({ offset: true }),
    /** Reference cuộc hội thoại / form revision. */
    externalReference: z.string().min(1).max(256).optional(),
  })
  .strict();

export type IdentityProvenance = z.infer<typeof IdentityProvenanceSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * createOrMatchLaborProfile — input payload (command body, không bao gồm
 * envelope chung). Caller ghép với `RequestEnvelopeBase` ở layer trên.
 * ─────────────────────────────────────────────────────────────────────────── */
export const CreateOrMatchLaborProfileInputSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    signal: IdentitySignalSchema,
    provenance: IdentityProvenanceSchema,
    /** Evidence refs cho intake CCCD. Optional — DNC không bị buộc. */
    evidence: EvidenceRefListSchema.optional(),
    /** Idempotency key riêng của intake form (form revision). */
    intakeRevisionId: z.string().min(1).max(128),
    /**
     * Nếu caller muốn match-only (không tạo mới) dù hint:
     *  - 'ALLOW_NEW'   : HRP được phép tạo profile nếu không match.
     *  - 'MATCH_ONLY'  : chỉ match; không tạo. Thiếu signal → UNRESOLVED_IDENTITY.
     *  - 'REVIEW_REQUIRED' : bất kỳ kết quả nào cũng đưa vào review queue.
     */
    policyHint: z.enum(['ALLOW_NEW', 'MATCH_ONLY', 'REVIEW_REQUIRED']).optional(),
  })
  .strict();

export type CreateOrMatchLaborProfileInput = z.infer<
  typeof CreateOrMatchLaborProfileInputSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * Kết quả createOrMatchLaborProfile — discriminated union.
 *  - EXACT_MATCH: canonical target đã xác minh, có canonicalId + version.
 *  - POSSIBLE_MATCH: có review reference, KHÔNG có target mutation hợp lệ.
 *    Caller không được ghi tương tác ngay; cần reviewer xác nhận.
 *  - NEW_PROFILE: HRP đã tạo profile theo policy; canonicalId + version.
 * ─────────────────────────────────────────────────────────────────────────── */
export const ExactMatchOutcomeSchema = z
  .object({
    outcome: z.literal('EXACT_MATCH'),
    canonicalId: z.string().min(1).max(128),
    version: ExpectedVersionSchema,
    /** Provenance match để audit; KHÔNG chứa PII ngoài reference opaque. */
    matchReference: z.string().min(1).max(128),
  })
  .strict();

export const PossibleMatchOutcomeSchema = z
  .object({
    outcome: z.literal('POSSIBLE_MATCH'),
    /** Review reference opaque; không có canonicalId mutation được. */
    reviewReference: z.string().min(1).max(128),
    /** Optional: danh sách candidate tối thiểu (id opaque) mà reviewer xem.
     *  Schema không kèm PII; runtime enforce reviewer capability. */
    candidateIds: z.array(z.string().min(1).max(128)).max(16).optional(),
    /** TTL trước khi review reference có thể bị reclaim. */
    reviewExpiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const NewProfileOutcomeSchema = z
  .object({
    outcome: z.literal('NEW_PROFILE'),
    canonicalId: z.string().min(1).max(128),
    version: ExpectedVersionSchema,
    /** HRP-side creation policy identifier; opaque. */
    createdByPolicy: z.string().min(1).max(128),
  })
  .strict();

/**
 * Discriminated union: dùng z.union thay vì z.discriminatedUnion vì
 * PossibleMatchOutcomeSchema có thể nhận shape canonicalId không tồn tại
 * ở refine (kiểm tra runtime); refined schema là ZodEffects, không hợp
 * với discriminatedUnion. Caller có thể refine qua tag `outcome` ở layer
 * trên nếu cần.
 */
export const MatchingOutcomeResultSchema = z.union([
  ExactMatchOutcomeSchema,
  PossibleMatchOutcomeSchema,
  NewProfileOutcomeSchema,
]);

export type MatchingOutcomeResult = z.infer<typeof MatchingOutcomeResultSchema>;

/**
 * Apply createOrMatchLaborProfile input kèm envelope chung.
 * Helper tiện ích để caller ghép một lần.
 */
export const CreateOrMatchLaborProfileCommandSchema = z
  .object({
    name: z.literal('createOrMatchLaborProfile'),
    input: CreateOrMatchLaborProfileInputSchema,
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * DNC-only action — tách biệt khỏi full intake. KHÔNG bị buộc đủ CCCD.
 * Dùng để ghi suppression khi staff nhận yêu cầu dừng liên hệ.
 *
 * F4 (Auditor findings, Owner chỉ thị G0/0.8): reuse
 * `DncReasonAcceptAliasSchema` (canonical 4 giá trị + legacy `PRIVACY`)
 * để payload đi xuyên identity DNC action và suppression không lệch
 * enum. Compatibility delta `PRIVACY` → `PRIVACY_REQUEST` không âm thầm
 * đổi nghĩa; caller normalize qua `normalizeDncReason` ở runtime.
 *
 * Authorization là runtime gate (HRP_POLICY không tự cấp cho mọi actor).
 * ─────────────────────────────────────────────────────────────────────────── */
export const DncActionSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    /** Provenance có thể thiếu evidence CCCD; chỉ cần connection + actor. */
    connectionId: ConnectionIdSchema,
    externalReference: z.string().min(1).max(256),
    /** Optional: target reference nếu đã match; runtime vẫn có thể
     *  safety-suppress ở connection/external-contact scope. */
    canonicalId: z.string().min(1).max(128).optional(),
    /** Reason chấp nhận canonical 4 giá trị + legacy 3 giá trị (PRIVACY
     *  alias → PRIVACY_REQUEST). */
    reason: DncReasonAcceptAliasSchema,
    /** Free text redacted; KHÔNG chứa PII. */
    note: z.string().max(500).optional(),
  })
  .strict();

export type DncAction = z.infer<typeof DncActionSchema>;

/** Helper: kiểm tra DNC action không đòi CCCD. */
export function isDncActionValid(action: unknown): action is DncAction {
  return DncActionSchema.safeParse(action).success;
}

/**
 * Re-export `EvidenceRefSchema` từ primitives để caller có thể dùng
 * primitive shape khi envelope không cần organization/connection scope.
 * Command layer dùng `CommandEvidenceRefSchema`.
 */
export { EvidenceRefSchema as PrimitiveEvidenceRefSchema } from '../primitives.js';
