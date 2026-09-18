/**
 * suppression.ts — DO_NOT_CONTACT suppression contracts (Gate 0 / 0.3e).
 *
 * Nguồn: Master-Plan.V2.6.md §10.6.5 + §10.7.3 (ngoại lệ bảo vệ liên hệ) +
 * Backlog Gate0 §0.3e.
 *
 * Trọng tâm (Master §10.6.5):
 *  1. HRP commit DO_NOT_CONTACT cùng suppression event trong transaction;
 *     ACL cập nhật suppression projection theo profile/verified external
 *     links, không ghi dữ liệu canonical từ cache.
 *  2. Dispatcher kiểm tra lại quyền liên hệ NGAY TRƯỚC gọi provider,
 *     không chỉ lúc tạo audience/enqueue. Stale cache KHÔNG được cấp
 *     phép gửi.
 *  3. Nếu không xác minh được trạng thái hiện hành (HRP offline / cache
 *     không đủ mới), giữ tin tự động chờ; không suy đoán được gửi.
 *  4. Contact chưa map canonical vẫn cho ghi local safety suppression theo
 *     connection/external contact đã xác thực, rồi resolve qua HRP; không
 *     bắt khách hoàn thiện hồ sơ/CCCD để được dừng tin. Safety suppression
 *     không tự tạo/merge LaborProfile.
 *  5. Có race giữa lần kiểm tra cuối và provider acceptance: dùng
 *     recipient-level dispatch fencing/serialization. Không thể hủy tin
 *     provider đã nhận; ghi rõ cut-off/UNKNOWN, đối soát và không gửi lại.
 *  6. Khách nhắn inbound vẫn được tiếp nhận. Tin inbound mới không tự gỡ
 *     DO_NOT_CONTACT. Reply thủ công theo yêu cầu khách phải qua policy/
 *     quyền riêng HRP chốt; chưa chốt thì không tự tạo ngoại lệ.
 *
 * Backlog §0.3e AC:
 *  - DNC event/dispatch authorization/fencing contracts mô tả actor/version/
 *    cut-off; cache stale không được cấp phép gửi.
 *  - Unresolved contact có local safety suppression reference không tạo
 *    canonical profile, không đòi CCCD.
 *  - Inbound không tự gỡ DNC; automatic delivery fail closed khi không xác
 *    minh contactability.
 */
import { z } from 'zod';
import {
  SCHEMA_VERSION,
} from '../enums.js';
import {
  CanonicalIdSchema,
  ConnectionIdSchema,
  ExpectedVersionSchema,
  OrganizationIdSchema,
  ProviderNameSchema,
  SchemaVersionSchema,
} from '../primitives.js';
import { IntakeContextRefSchema } from './intake.js';
import { DncReasonSchema } from './dnc.js';
export { DncReasonSchema } from './dnc.js';

/* ───────────────────────────────────────────────────────────────────────────
 * Suppression scope — đích của suppression.
 *
 * Phân biệt 3 loại:
 *  - LABOR_PROFILE: canonical profile đã resolve (HRP bound).
 *  - EXTERNAL_CONTACT: contact từ Chatwoot/Zalo chưa map canonical
 *    (dùng cho local safety suppression).
 *  - SUPPRESSED_RECIPIENT_FENCE: recipient-level fencing token để
 *    dispatcher serialize transition/send (Master §10.6.5 #5).
 * ─────────────────────────────────────────────────────────────────────────── */
export const SUPPRESSION_TARGET_KINDS = [
  'LABOR_PROFILE',
  'EXTERNAL_CONTACT',
  'SUPPRESSED_RECIPIENT_FENCE',
] as const;
export type SuppressionTargetKind = (typeof SUPPRESSION_TARGET_KINDS)[number];
export const SuppressionTargetKindSchema = z.enum(SUPPRESSION_TARGET_KINDS);

/**
 * LaborProfileTargetRef — reference canonical LaborProfile.
 * Khi `resolvedCanonical = false`, runtime KHÔNG tạo/merge profile
 * (chỉ ghi suppression projection).
 */
export const LaborProfileTargetRefSchema = z
  .object({
    kind: z.literal('LABOR_PROFILE'),
    organizationId: OrganizationIdSchema,
    laborProfileId: CanonicalIdSchema,
    expectedVersion: ExpectedVersionSchema,
    /**
     * Marker: target đã được HRP resolve canonical hay chưa. Khi false,
     * chỉ ghi suppression projection; KHÔNG tự ý tạo LaborProfile.
     */
    resolvedCanonical: z.boolean(),
  })
  .strict();
export type LaborProfileTargetRef = z.infer<
  typeof LaborProfileTargetRefSchema
>;

/**
 * ExternalContactTargetRef — contact từ provider (Chatwoot/Zalo).
 * Connection phải đã xác thực (provider + connectionId); không ghi
 * suppression dựa trên cache stale.
 */
export const ExternalContactTargetRefSchema = z
  .object({
    kind: z.literal('EXTERNAL_CONTACT'),
    organizationId: OrganizationIdSchema,
    provider: ProviderNameSchema,
    connectionId: ConnectionIdSchema,
    externalAccountId: z.string().min(1).max(128).optional(),
    externalInboxId: z.string().min(1).max(128).optional(),
    externalContactId: z.string().min(1).max(256),
    /** Marker: contact chưa map canonical LaborProfile. */
    resolvedCanonical: z.literal(false),
  })
  .strict();
export type ExternalContactTargetRef = z.infer<
  typeof ExternalContactTargetRefSchema
>;

/**
 * RecipientFenceTokenRef — recipient-level fencing token (Master §10.6.5 #5).
 * Runtime gate cấp token khi enqueue; dispatcher đối chiếu token trước khi
 * gửi. Stale token (cut-off) → không có quyền gửi.
 */
export const RecipientFenceTokenRefSchema = z
  .object({
    kind: z.literal('SUPPRESSED_RECIPIENT_FENCE'),
    organizationId: OrganizationIdSchema,
    fenceToken: z
      .string()
      .min(8)
      .max(256)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u, 'fenceToken ký tự không hợp lệ'),
    /** Server-set cut-off timestamp (ISO 8601 with offset). */
    cutOffAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type RecipientFenceTokenRef = z.infer<
  typeof RecipientFenceTokenRefSchema
>;

export const SuppressionTargetRefSchema = z.discriminatedUnion('kind', [
  LaborProfileTargetRefSchema,
  ExternalContactTargetRefSchema,
  RecipientFenceTokenRefSchema,
]);
export type SuppressionTargetRef = z.infer<
  typeof SuppressionTargetRefSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * DNC reasons — lý do ghi DO_NOT_CONTACT.
 *
 * F4 (Auditor findings, Owner chỉ thị G0/0.8): canonical 4 giá trị ở
 * `commands/dnc.ts`. Master §10.6.5: "Không tự tạo ngoại lệ gửi; đổi
 * trạng thái để cho liên hệ lại cần quyết định có thẩm quyền và audit,
 * không do sale tùy ý".
 *
 * BACKLOG-02 của Tập 0.3a (xem dnc.ts): DNC không bị buộc intake/CCCD.
 * Enum membership KHÔNG tự cấp quyền dùng `HRP_POLICY` cho mọi actor;
 * authorization là runtime gate.
 * ─────────────────────────────────────────────────────────────────────────── */
// DNC_REASONS, DncReason, DncReasonSchema đã chuyển sang commands/dnc.ts
// và re-export ở trên.

/* ───────────────────────────────────────────────────────────────────────────
 * CommitSuppressionInput — ghi suppression projection.
 *
 * Schema bind shape; runtime HRP gate enforce:
 *  - transaction với profile mutation (nếu target là LABOR_PROFILE đã
 *    resolved).
 *  - DO_NOT_CONTACT không tự gỡ; opt-in lại qua command riêng.
 *  - Inbound KHÔNG dùng command này để gỡ DNC (Backlog §0.3e).
 *
 * Note: optional. Nếu DNC_REASON = OTHER thì runtime HRP gate có thể
 * audit yêu cầu note (xem Q-18 — proposed, không enforce ở schema).
 * ─────────────────────────────────────────────────────────────────────────── */
export const CommitSuppressionInputSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    target: SuppressionTargetRefSchema,
    reason: DncReasonSchema,
    note: z.string().min(1).max(500).optional(),
    /** Server-set idempotency qua envelope (xem envelopes.ts). */
    context: IntakeContextRefSchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    // Note KHÔNG chứa URL/base64 (đồng nhất với placement/availability).
    if (val.note) {
      const rejectUrlOrBase64 = (re: RegExp, label: string) => {
        if (re.test(val.note!)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `note không được chứa ${label}`,
            path: ['note'],
          });
        }
      };
      rejectUrlOrBase64(/https?:\/\//iu, 'URL thô');
      rejectUrlOrBase64(/data:[a-z]+\/[a-z0-9.+-]+;base64,/iu, 'data URI base64');
    }
    // ExternalContactTargetRef KHÔNG được phép có resolvedCanonical = true
    // (LABOR_PROFILE mới là canonical).
    if (val.target.kind === 'EXTERNAL_CONTACT' && val.target.resolvedCanonical !== false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'EXTERNAL_CONTACT target phải có resolvedCanonical=false (safety suppression không tự tạo LaborProfile)',
        path: ['target', 'resolvedCanonical'],
      });
    }
  });
export type CommitSuppressionInput = z.infer<
  typeof CommitSuppressionInputSchema
>;

/**
 * CommitSuppressionResult — server trả về sau khi commit.
 *
 * `suppressionEventId` là opaque ID runtime HRP cấp; dùng để dedupe
 * downstream khi idempotency replay.
 *
 * `fenceToken` được cấp khi target là EXTERNAL_CONTACT hoặc
 * SUPPRESSED_RECIPIENT_FENCE; dispatcher phải đối chiếu token trước khi
 * gửi. Stale token → reject.
 */
export const CommitSuppressionResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    suppressionEventId: z.string().min(1).max(128),
    targetKind: SuppressionTargetKindSchema,
    appliedAt: z.string().datetime({ offset: true }),
    /** Cut-off timestamp cho fencing token; dispatcher gate check. */
    fenceToken: z.string().min(8).max(256).optional(),
    fenceCutOffAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    // fenceToken + fenceCutOffAt phải đi cùng nhau.
    if ((val.fenceToken && !val.fenceCutOffAt) || (!val.fenceToken && val.fenceCutOffAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'fenceToken và fenceCutOffAt phải đi cùng nhau',
        path: ['fenceToken'],
      });
    }
    // LABOR_PROFILE target có thể không có fence (gate projection).
    if (
      val.targetKind === 'SUPPRESSED_RECIPIENT_FENCE' &&
      !val.fenceToken
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'SUPPRESSED_RECIPIENT_FENCE result phải có fenceToken',
        path: ['fenceToken'],
      });
    }
  });
export type CommitSuppressionResult = z.infer<
  typeof CommitSuppressionResultSchema
>;

/**
 * ContactChannelId — id kênh liên hệ (phone/email/external handle).
 * Khác connectionId (provider connection). ChannelId là định danh người
 * nhận; runtime xác minh trước khi gửi.
 */
export const ContactChannelIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._@+-]*$/u, 'contactChannelId ký tự không hợp lệ');

/* ───────────────────────────────────────────────────────────────────────────
 * DispatchAuthorizationCheckInput — runtime dispatcher gate.
 *
 * Schema bind shape; runtime gate trả PASS / SUPPRESSED / UNKNOWN.
 * Stale cache KHÔNG cấp phép gửi (Master §10.6.5 #2 + #3):
 *  - nếu cache freshness vượt maxAgeSec → UNKNOWN (fail closed).
 *  - nếu fence token hết hạn (cutOffAt < now) → SUPPRESSED.
 *  - nếu target có suppression projection active → SUPPRESSED.
 *
 * Schema không tự quyết freshness threshold; runtime HRP gate quyết
 * (maxAgeSec là proposed config, xem Q-15).
 * ─────────────────────────────────────────────────────────────────────────── */
export const DispatchAuthorizationCheckInputSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    target: SuppressionTargetRefSchema,
    /**
     * Recipient-level fence token nếu đã có từ enqueue (Master #5).
     * Runtime đối chiếu token + cut-off.
     */
    fenceToken: z.string().min(8).max(256).optional(),
    /** Caller-set cache age (sec). Runtime dùng để tính freshness. */
    cacheAgeSec: z.number().int().nonnegative().max(86_400).optional(),
    /** Provider + connection cho transport-layer check. */
    provider: ProviderNameSchema,
    connectionId: ConnectionIdSchema,
  })
  .strict();
export type DispatchAuthorizationCheckInput = z.infer<
  typeof DispatchAuthorizationCheckInputSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * DispatchAuthorizationOutcome — runtime gate trả.
 *  - AUTHORIZED: có thể gửi.
 *  - SUPPRESSED: đã bị DNC; không gửi, không retry, không DLQ redrive.
 *  - UNKNOWN: không xác minh được trạng thái (HRP offline / cache stale);
 *    giữ pending, không gửi.
 *
 * Đây là wire enum runtime trả về, không phải Availability.
 * ─────────────────────────────────────────────────────────────────────────── */
export const DISPATCH_AUTHORIZATION_OUTCOMES = [
  'AUTHORIZED',
  'SUPPRESSED',
  'UNKNOWN',
] as const;
export type DispatchAuthorizationOutcome =
  (typeof DISPATCH_AUTHORIZATION_OUTCOMES)[number];
export const DispatchAuthorizationOutcomeSchema = z.enum(
  DISPATCH_AUTHORIZATION_OUTCOMES,
);

/**
 * DispatchAuthorizationCheckResult — runtime gate response.
 * Schema bind shape; runtime HRP gate quyết.
 *
 * `reason` mô tả lý do (audit):
 *  - SUPPRESSED + reason=DNC_ACTIVE / DNC_FENCE_EXPIRED.
 *  - UNKNOWN + reason=HRP_OFFLINE / CACHE_STALE.
 *  - AUTHORIZED + reason=OK.
 */
export const DISPATCH_DENY_REASONS = [
  'DNC_ACTIVE',
  'DNC_FENCE_EXPIRED',
  'HRP_OFFLINE',
  'CACHE_STALE',
  'TARGET_UNRESOLVED',
  'OK',
] as const;
export type DispatchDenyReason = (typeof DISPATCH_DENY_REASONS)[number];
export const DispatchDenyReasonSchema = z.enum(DISPATCH_DENY_REASONS);

export const DispatchAuthorizationCheckResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    outcome: DispatchAuthorizationOutcomeSchema,
    reason: DispatchDenyReasonSchema,
    checkedAt: z.string().datetime({ offset: true }),
    /** Fence token re-issued cho lần dispatch kế tiếp (nếu AUTHORIZED). */
    nextFenceToken: z.string().min(8).max(256).optional(),
    nextFenceCutOffAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.outcome === 'AUTHORIZED' && val.reason !== 'OK') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'AUTHORIZED outcome phải có reason=OK',
        path: ['reason'],
      });
    }
    if (val.outcome === 'SUPPRESSED' && val.reason === 'OK') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SUPPRESSED outcome KHÔNG có reason=OK',
        path: ['reason'],
      });
    }
    if (val.outcome === 'UNKNOWN' && val.reason === 'OK') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'UNKNOWN outcome KHÔNG có reason=OK',
        path: ['reason'],
      });
    }
    if (
      val.outcome === 'AUTHORIZED' &&
      Boolean(val.nextFenceToken) !== Boolean(val.nextFenceCutOffAt)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'nextFenceToken và nextFenceCutOffAt phải đi cùng nhau',
        path: ['nextFenceToken'],
      });
    }
  });
export type DispatchAuthorizationCheckResult = z.infer<
  typeof DispatchAuthorizationCheckResultSchema
>;

/**
 * Forbidden fields cho suppression mutation.
 * Patch KHÔNG được phép có những field này (schema reject trước domain).
 *
 * Đặc biệt:
 *  - KHÔNG có `removeSuppression` / `optBackIn` / `forceSend` — opt-in lại
 *    là command riêng với authority/audit, không qua patch.
 *  - KHÔNG có `createLaborProfile` / `mergeLaborProfile` — safety suppression
 *    không tự tạo profile (Master §10.6.5 #4).
 *  - KHÔNG có `bypassDnc` / `ignoreStaleCache` — cache stale không cấp
 *    phép gửi (Master §10.6.5 #2 + #3).
 */
export const SUPPRESSION_PATCH_FORBIDDEN = Object.freeze([
  // Tự ý gỡ DNC — KHÔNG được.
  'removeSuppression',
  'optBackIn',
  'forceSend',
  'ignoreSuppression',
  'bypassDnc',
  'ignoreStaleCache',
  // Auto-create profile — KHÔNG được.
  'createLaborProfile',
  'mergeLaborProfile',
  'autoMapExternalContact',
  // Inbound tự gỡ — KHÔNG được (Master #6).
  'inboundOptOutRemoval',
  'autoClearOnInbound',
  // Retry bypass — KHÔNG được.
  'bypassRetrySuppression',
  'dlqRedriveBypass',
] as const);

/**
 * Re-export SCHEMA_VERSION để package dùng nhất quán.
 */
export { SCHEMA_VERSION };
