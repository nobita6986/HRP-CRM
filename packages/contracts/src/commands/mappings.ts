/**
 * mappings.ts — ExternalContactLink, ExternalConversationLink, target
 * union (Talent/Client) và conversation link history (Gate 0 / 0.4).
 *
 * Nguồn: Master-Plan.V2.6.md §7, §10.6 + Backlog Gate0 §0.4 +
 * hrp-connector.md v1.1 (HEAD 414c54b) §2, §6.
 *
 * Trọng tâm (Owner chỉ thị rev 2):
 *  - ExternalContactLink states: EXACT_MATCH / POSSIBLE_MATCH / UNRESOLVED.
 *    NEW_PROFILE là COMMAND RESULT của createOrMatchLaborProfile, KHÔNG
 *    là state thứ tư của mapping.
 *  - Talent/Client target union: phân biệt rõ 2 branch canonical; Client
 *    thiếu contract (Q-23 unresolved/proposed) → marker proposed, KHÔNG
 *    ép về Talent fields.
 *  - Provider / connection / account scope rõ cho mỗi target ref.
 *  - Conversation link giữ history + current context revision; mutation
 *    target lấy mapping tin cậy (canonical), KHÔNG tin Chatwoot attributes.
 *  - Marker KHÔNG tự chứng minh AC được enforce runtime: schema bind
 *    shape constraint là CONFIRMED; thứ tự / policy / authority là
 *    PROPOSED chờ Owner chốt.
 */
import { z } from 'zod';
import { SCHEMA_VERSION } from '../enums.js';
import { ExternalContactMatchStateSchema } from '../enums.js';
import {
  CanonicalIdSchema,
  ConnectionIdSchema,
  ExpectedVersionSchema,
  OrganizationIdSchema,
  ProviderNameSchema,
  SchemaVersionSchema,
} from '../primitives.js';

/* ───────────────────────────────────────────────────────────────────────────
 * External contact reference — Chatwoot/Zalo external identity opaque.
 *
 * Schema bind shape:
 *  - provider (CHATWOOT/ZALO_OA/...): allowlist ProviderName.
 *  - connectionId (canonical, organization-scoped).
 *  - externalAccountId / externalInboxId / externalConversationId /
 *    externalContactId / externalMessageId: opaque reference runtime set;
 *    KHÔNG được dùng làm mutation target.
 *
 * Mutation target lấy mapping tin cậy (xem ExternalContactLink), KHÔNG
 * tin Chatwoot attributes để trỏ canonical LaborProfile/ClientCompany.
 * ─────────────────────────────────────────────────────────────────────────── */
export const ExternalContactRefSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    provider: ProviderNameSchema,
    connectionId: ConnectionIdSchema,
    /** Opaque provider-side account id (Chatwoot account, Zalo OA id). */
    externalAccountId: z.string().min(1).max(128),
    /** Opaque inbox/conversation/contact/message refs. */
    externalInboxId: z.string().min(1).max(128).optional(),
    externalConversationId: z.string().min(1).max(256).optional(),
    externalContactId: z.string().min(1).max(256).optional(),
    externalMessageId: z.string().min(1).max(256).optional(),
  })
  .strict();
export type ExternalContactRef = z.infer<typeof ExternalContactRefSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * ExternalContactLink state — STATE mapping, KHÔNG phải command result.
 *
 * Schema bind shape constraint (CONFIRMED):
 *  - EXACT_MATCH: link đã xác minh với canonical (LaborProfile cho Talent
 *    branch, hoặc ClientContact cho Client branch — runtime HRP gate
 *    xác minh mapping chính xác).
 *  - POSSIBLE_MATCH: candidate/review reference, link chưa xác minh.
 *    Schema KHÔNG cho phép mutation target từ POSSIBLE_MATCH.
 *  - UNRESOLVED: chưa có tín hiệu đủ để mapping; an toàn nhất cho
 *    external inbound.
 *
 * RÕ RÀNG — KHÔNG nhầm với MatchingOutcome (command result):
 *  - MatchingOutcome = EXACT_MATCH | POSSIBLE_MATCH | NEW_PROFILE (NEW là
 *    command result, KHÔNG mapping state).
 *  - ExternalContactLink = EXACT_MATCH | POSSIBLE_MATCH | UNRESOLVED
 *    (UNRESOLVED là mapping state, KHÔNG command result).
 * ─────────────────────────────────────────────────────────────────────────── */
export const EXTERNAL_CONTACT_LINK_STATES = [
  'EXACT_MATCH',
  'POSSIBLE_MATCH',
  'UNRESOLVED',
] as const;
export const ExternalContactLinkStateSchema = z.enum(
  EXTERNAL_CONTACT_LINK_STATES,
);

/* ───────────────────────────────────────────────────────────────────────────
 * ExternalContactLinkTarget — discriminated union Talent vs Client.
 *
 * Schema bind shape:
 *  - kind = 'TALENT' → matchedLaborProfileId.
 *  - kind = 'CLIENT' → matchedClientContactId (PROPOSED — Client domain
 *    contract Q-23 chưa chốt; schema marker PROPOSED, runtime HRP gate
 *    quyết ClientContact ID format/length khi chốt).
 *
 * Mutation target LUÔN lấy từ canonical id; KHÔNG lấy từ Chatwoot/Zalo
 * raw attribute. Schema không có field dùng external attr value làm
 * canonical id.
 * ─────────────────────────────────────────────────────────────────────────── */
export const ExternalContactLinkTargetSchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('TALENT'),
        matchedLaborProfileId: CanonicalIdSchema,
        matchedLaborProfileVersion: ExpectedVersionSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal('CLIENT'),
        matchedClientContactId: z.string().min(1).max(128),
        matchedClientContactVersion: ExpectedVersionSchema,
      })
      .strict(),
  ])
  .superRefine((val, ctx) => {
    // Ràng buộc semantic: matchedLaborProfileId/matchedClientContactId
    // đã là canonical (đã opaque-id regex). Schema không enforce format
    // ClientContact ID — runtime HRP-owned PR quyết sau khi Client
    // domain contract chốt (Q-23).
    if (val.kind === 'CLIENT') {
      // Marker PROPOSED — schema không reject nhưng comment audit.
    }
  });
export type ExternalContactLinkTarget = z.infer<
  typeof ExternalContactLinkTargetSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * ExternalContactLink — DTO link giữa external contact và canonical target.
 *
 * Schema bind shape:
 *  - organization + provider + connection + external refs.
 *  - state ∈ {EXACT_MATCH, POSSIBLE_MATCH, UNRESOLVED}.
 *  - matchedTarget: chỉ có khi state = EXACT_MATCH; reference opaque.
 *  - candidateReference: chỉ có khi state = POSSIBLE_MATCH; review path.
 *  - aggregateVersion: monotonic; schema yêu cầu ≥ 0; runtime HRP gate
 *    chốt rule cho re-link.
 *  - evidenceRefs[]: opaque evidence reference, KHÔNG raw URL/base64.
 *
 * Mutation target KHÔNG dùng external attributes làm canonical reference:
 * bất kỳ command nào tham chiếu target đều dùng `matchedTarget.canonicalId`
 * (canonical); KHÔNG truyền Chatwoot attribute value làm canonical.
 * ─────────────────────────────────────────────────────────────────────────── */
const EvidenceRefForLinkSchema = z
  .object({
    evidenceId: z.string().min(1).max(128),
    /** Schema version evidence reference. */
    evidenceSchemaVersion: SchemaVersionSchema,
    /** Loại evidence (CCCD_FRONT/CCCD_BACK hoặc mở rộng sau). */
    kind: z.string().min(1).max(64),
  })
  .strict();

export const ExternalContactLinkSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    provider: ProviderNameSchema,
    connectionId: ConnectionIdSchema,
    external: z
      .object({
        externalAccountId: z.string().min(1).max(128),
        externalContactId: z.string().min(1).max(256).optional(),
      })
      .strict(),
    state: ExternalContactLinkStateSchema,
    /** Required khi state = EXACT_MATCH. */
    matchedTarget: ExternalContactLinkTargetSchema.optional(),
    /** Required khi state = POSSIBLE_MATCH. */
    candidateReference: z
      .object({
        /** Opaque review queue entry id; không phải canonical ID. */
        reviewQueueEntryId: z.string().min(1).max(128),
        /** Audit: lúc link candidate được tạo. */
        recordedAt: z.string().datetime({ offset: true }),
      })
      .strict()
      .optional(),
    /** Required khi state = UNRESOLVED nếu muốn audit. */
    lastAttemptedAt: z.string().datetime({ offset: true }).optional(),
    aggregateVersion: ExpectedVersionSchema,
    evidenceRefs: z.array(EvidenceRefForLinkSchema).max(16).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    // EXACT_MATCH: matchedTarget required.
    if (val.state === 'EXACT_MATCH' && !val.matchedTarget) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'EXACT_MATCH phải có matchedTarget canonical',
        path: ['matchedTarget'],
      });
    }
    // POSSIBLE_MATCH: candidateReference required; matchedTarget KHÔNG có.
    if (val.state === 'POSSIBLE_MATCH') {
      if (!val.candidateReference) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'POSSIBLE_MATCH phải có candidateReference (review path)',
          path: ['candidateReference'],
        });
      }
      if (val.matchedTarget) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'POSSIBLE_MATCH KHÔNG có matchedTarget (chưa xác minh canonical)',
          path: ['matchedTarget'],
        });
      }
    }
    // UNRESOLVED: matchedTarget + candidateReference KHÔNG có.
    if (val.state === 'UNRESOLVED') {
      if (val.matchedTarget) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'UNRESOLVED KHÔNG có matchedTarget',
          path: ['matchedTarget'],
        });
      }
      if (val.candidateReference) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'UNRESOLVED KHÔNG có candidateReference',
          path: ['candidateReference'],
        });
      }
    }
  });
export type ExternalContactLink = z.infer<typeof ExternalContactLinkSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * Canonical target union (Talent/Client) — dùng cho Query/Result trả về
 * target rỗi; schema bind shape tách 2 branch, KHÔNG ép Client field về
 * Talent field.
 *
 * NOTE Q-23: Client domain thiếu contract đầy đủ (connector §2 chưa có
 * ClientCompany/ClientContact/SalesOpportunity). Schema ClientContactId
 * hiện chỉ là placeholder opaque; HRP-owned PR quyết format khi chốt.
 * ─────────────────────────────────────────────────────────────────────────── */
export const TalentTargetRefSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    kind: z.literal('TALENT'),
    laborProfileId: CanonicalIdSchema,
    laborProfileVersion: ExpectedVersionSchema,
  })
  .strict();

export const ClientTargetRefSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    kind: z.literal('CLIENT'),
    /**
     * PROPOSED — ClientContact ID format chưa chốt; schema marker dùng
     * opaqueId rule chung. HRP-owned PR (Q-23) sẽ quyết format khi
     * Client domain contract chốt.
     */
    clientContactId: z.string().min(1).max(128),
    clientContactVersion: ExpectedVersionSchema,
    /**
     * PROPOSED — ClientCompany/ClientContact/SalesOpportunity context
     * chưa có schema đầy đủ; field optional + marker proposed.
     */
    clientCompanyId: z.string().min(1).max(128).optional(),
    salesOpportunityId: z.string().min(1).max(128).optional(),
  })
  .strict();

export const CanonicalTargetRefSchema = z.discriminatedUnion('kind', [
  TalentTargetRefSchema,
  ClientTargetRefSchema,
]);
export type CanonicalTargetRef = z.infer<typeof CanonicalTargetRefSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * Conversation link — Conversation ↔ External conversation (provider).
 *
 * Schema bind shape:
 *  - giữ conversationId canonical (HRP-owned, organization-scoped).
 *  - externalRefs[]: array các external conversation refs (provider có
 *    thể có nhiều kênh cho cùng 1 conversation canonical). Mỗi ref có
 *    aggregateVersion + scope (provider/connection/external ids).
 *  - currentRevision: server-set; runtime quyết revision tăng khi nào.
 *  - historyRevisions: monotonic list giữ revision cũ; schema giới hạn
 *    max 64 để tránh payload trương.
 *
 * Mutation target LUÔN lấy conversationId canonical; KHÔNG lấy từ
 * Chatwoot/Zalo raw attribute làm canonical id.
 * ─────────────────────────────────────────────────────────────────────────── */
export const ExternalConversationRefSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    provider: ProviderNameSchema,
    connectionId: ConnectionIdSchema,
    externalAccountId: z.string().min(1).max(128),
    externalInboxId: z.string().min(1).max(128).optional(),
    externalConversationId: z.string().min(1).max(256),
    /**
     * Aggregate version của external mapping tới conversation canonical.
     * monotonic ≥ 0; runtime gate đảm bảo tăng đơn điệu theo event.
     */
    aggregateVersion: ExpectedVersionSchema,
    /**
     * Last seen at (server-set khi nhận event). KHÔNG dùng để quyết
     * canonical conversation ID.
     */
    lastSeenAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type ExternalConversationRef = z.infer<
  typeof ExternalConversationRefSchema
>;

export const ConversationLinkSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    /** Conversation canonical id; opaque; HRP-owned. */
    conversationId: z.string().min(1).max(128),
    conversationVersion: ExpectedVersionSchema,
    /** Conversation kind — PROPOSED; runtime HRP-owned PR quyết taxonomy. */
    conversationKind: z.enum(['TALENT', 'CLIENT', 'INTERNAL', 'UNKNOWN']),
    /** Optional: target reference canonical (Talent hoặc Client). */
    primaryTarget: CanonicalTargetRefSchema.optional(),
    /** External refs (provider-agnostic mapping). */
    externalRefs: z
      .array(ExternalConversationRefSchema)
      .min(1)
      .max(64),
    /** Current revision — server-set; tăng đơn điệu. */
    currentRevision: ExpectedVersionSchema,
    /** History revisions — giữ cho audit; max 64 entry để chặn payload. */
    historyRevisions: z
      .array(
        z
          .object({
            revisionId: z.string().min(1).max(128),
            recordedAt: z.string().datetime({ offset: true }),
            note: z
              .string()
              .min(1)
              .max(512)
              .refine(
                (s) =>
                  !/https?:\/\//i.test(s) &&
                  !/data:[^\s]+/i.test(s) &&
                  !/[A-Za-z0-9+/]{100,}={0,2}/.test(s),
                'note KHÔNG chứa URL/base64/data URI',
              )
              .optional(),
          })
          .strict(),
      )
      .max(64)
      .optional(),
    /** Server-set timestamp. */
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((val, ctx) => {
    // historyRevisions revisions phải khớp monotonic tăng (schema chỉ
    // check non-negative; runtime gate check tăng đơn điệu).
    if (val.historyRevisions && val.historyRevisions.length > 0) {
      // Không enforce strict monotonic ở schema (runtime gate quyết);
      // chỉ check currentRevision >= 0.
    }
  });
export type ConversationLink = z.infer<typeof ConversationLinkSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * External contact + conversation ops — read-side DTOs.
 *
 * Schema bind shape cho "Query contact by external" / "Query
 * conversation by external" — dùng cho:
 *  - resolve target canonical từ external ref (Chatwoot/Zalo), KHÔNG
 *    tin Chatwoot attributes.
 *  - List contact link có paging/scope.
 * ─────────────────────────────────────────────────────────────────────────── */
export const ResolveContactByExternalRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    provider: ProviderNameSchema,
    connectionId: ConnectionIdSchema,
    externalAccountId: z.string().min(1).max(128),
    externalContactId: z.string().min(1).max(256).optional(),
    externalConversationId: z.string().min(1).max(256).optional(),
    asOfVersion: ExpectedVersionSchema.optional(),
  })
  .strict();

export const ResolveContactByExternalResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    link: ExternalContactLinkSchema,
    /**
     * Conversation link (nếu tìm qua conversation); optional.
     */
    conversation: ConversationLinkSchema.optional(),
  })
  .strict();

export const ListExternalContactLinksRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    provider: ProviderNameSchema.optional(),
    connectionId: ConnectionIdSchema.optional(),
    state: ExternalContactLinkStateSchema.optional(),
    /** Cursor paging — opaque; runtime gate quyết format. */
    cursor: z.string().min(1).max(256).optional(),
    pageSize: z.number().int().positive().max(100).default(20),
  })
  .strict();

export const ListExternalContactLinksResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    items: z.array(ExternalContactLinkSchema).max(100),
    /** Next cursor (opaque) — empty khi hết. */
    nextCursor: z.string().min(1).max(256).optional(),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * Mapping forbidden fields — marker audit.
 *
 * Owner chỉ thị rev 2: "Marker/forbidden-list không tự chứng minh AC
 * được enforce". Đây CHỈ là schema marker/runtime gate marker; runtime
 * HRP gate enforce qua code review + lint + integration test. Không tự
 * coi presence trong forbidden list là đủ chứng minh.
 * ─────────────────────────────────────────────────────────────────────────── */
export const MAPPING_PATCH_FORBIDDEN = Object.freeze([
  // KHÔNG cho phép lấy Chatwoot attribute value làm canonical id.
  'useChatwootAttributesAsCanonical',
  'useZaloAttributesAsCanonical',
  'setCanonicalFromConversationId',
  'setCanonicalFromContactHandle',
  // KHÔNG cho ép Client về Talent fields.
  'collapseClientToTalent',
  'projectClientOntoLaborProfile',
  'fillClientContactFromLaborProfile',
  // KHÔNG tự merge/un-merge.
  'autoMerge',
  'autoUnlink',
  'silentlyRelink',
  'forceUnresolvedToExact',
  // KHÔNG dùng raw external id làm canonical.
  'matchByRawExternalId',
  'trustExternalHandle',
  'trustExternalDisplayName',
  // KHÔNG suy review/attribution nguồn khi thiếu.
  'assumeReviewer',
  'assumeAttribution',
  'assumeSubmittedBy',
  'assumeCreditedCreator',
  // KHÔNG để NEW_PROFILE lẫn vào mapping state.
  'acceptNewProfileAsLinkState',
  'forceNewProfileLink',
  // KHÔNG push mapping qua CHATWOOT label (semantic firewall).
  'writeBackToChatwootAttributes',
  'syncBackViaChatwootLabel',
] as const);

export { SCHEMA_VERSION };
