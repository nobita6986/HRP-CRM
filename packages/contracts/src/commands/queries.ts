/**
 * queries.ts — Read-only query contracts (Gate 0 / 0.4).
 *
 * Nguồn: Master-Plan.V2.6.md §6 + Backlog Gate0 §0.4 +
 * hrp-connector.md v1.1 (HEAD 414c54b) §6.
 *
 * Trọng tâm AC (Owner chỉ thị rev 2):
 *  - Queries context/result/read-only identity/allowed actions/
 *    contactability có scope/paging/version; constants UI KHÔNG phụ thuộc
 *    dictionary API (đã có enum trong package — dùng enum, không gọi
 *    dictionary).
 *  - Schema bind shape CONFIRMED: scope organization/provider/connection,
 *    paging (cursor + pageSize bound), version (asOfVersion cho read
 *    consistency), actor scope, target scope.
 *  - Runtime policy PROPOSED: dictionary API không tồn tại; enum package
 *    đủ cho UI/dev không cần dictionary.
 *  - Marker/forbidden-list KHÔNG tự chứng minh AC được enforce (Owner
 *    chỉ thị); schema bind shape là CONFIRMED; runtime policy + paging
 *    policy + redaction là HRP-owned gate.
 */
import { z } from 'zod';
import {
  AVAILABILITIES,
  AVAILABILITY_LABELS_VI,
  CASE_CLOSE_REASONS,
  CASE_CLOSE_REASON_LABELS_VI,
  CLOSED_CASE_STATUS,
  ClosedCaseStatusSchema,
  CURRENT_RELATIONSHIPS,
  CURRENT_RELATIONSHIP_LABELS_VI,
  CurrentRelationshipSchema,
  CaseCloseReasonSchema,
  EXTERNAL_CONTACT_MATCH_STATES,
  MATCHING_OUTCOMES,
  NEXT_ACTION_STATUSES,
  PLACEMENT_CASE_STAGES,
  PLACEMENT_CASE_STAGE_LABELS_VI,
  SCHEMA_VERSION,
} from '../enums.js';
import { ExternalContactMatchStateSchema } from '../enums.js';
import { PlacementCaseStageSchema } from '../enums.js';
import { NextActionStatusSchema } from '../enums.js';
import { AvailabilitySchema } from '../enums.js';
import { MatchingOutcomeSchema } from '../enums.js';
import {
  ActorSchema,
  CanonicalIdSchema,
  CommandIdSchema,
  ConnectionIdSchema,
  ExpectedVersionSchema,
  IdempotencyKeySchema,
  IsoTimestampSchema,
  OrganizationIdSchema,
  ProviderNameSchema,
  SchemaVersionSchema,
} from '../primitives.js';
import {
  CanonicalTargetRefSchema,
  ExternalContactRefSchema,
} from './mappings.js';

/* ───────────────────────────────────────────────────────────────────────────
 * Paging + cursor (dùng chung cho mọi list query).
 *
 * Schema bind shape CONFIRMED:
 *  - cursor: opaque string (server-set); KHÔNG phải offset/page number.
 *  - pageSize: 1..200 bound; default 20.
 *  - asOfVersion: optional — server trả snapshot tại version này.
 *
 * Runtime gate PROPOSED: paging strategy, watermark retention, partial
 * load behavior là HRP-owned. Schema KHÔNG quyết dict.
 * ─────────────────────────────────────────────────────────────────────────── */
export const CursorPaginationInputSchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    pageSize: z.number().int().min(1).max(200).default(20),
  })
  .strict();

export const CursorPaginationOutputSchema = z
  .object({
    nextCursor: z.string().min(1).max(512).optional(),
    /** Server-set timestamp cho last entry. */
    lastSeenAt: IsoTimestampSchema.optional(),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * Query scope — chuẩn hoá cho mọi read DTO.
 *
 * Schema bind shape CONFIRMED:
 *  - organizationId required.
 *  - actor required (runtime HRP gate bind principal/scope).
 *  - asOfVersion optional — read consistency at version.
 *  - provider/connectionId optional — filter scope theo channel.
 *
 * Runtime gate PROPOSED: tenant/scope thực sự, principal/delegated
 * actor mapping, organization↔auth RLS — HRP-owned (Q-23 vẫn pending
 * cho full orgId proposal; schema bind literal theo proposal).
 * ─────────────────────────────────────────────────────────────────────────── */
export const QueryScopeSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    actor: ActorSchema,
    asOfVersion: ExpectedVersionSchema.optional(),
    /** Filter theo provider nếu cần (Chatwoot/Zalo). */
    provider: ProviderNameSchema.optional(),
    connectionId: ConnectionIdSchema.optional(),
    /**
     * Command/Operation reference (audit): nếu query nằm trong 1
     * operation context (e.g., resolve operation), set commandId.
     */
    commandId: CommandIdSchema.optional(),
    /**
     * Idempotency key (audit) — query KHÔNG mutate, nhưng vẫn audit
     * bound giống command.
     */
    idempotencyKey: IdempotencyKeySchema.optional(),
  })
  .strict();
export type QueryScope = z.infer<typeof QueryScopeSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * Context panel — read-only query trả canonical context cho Talent/Client
 * conversation.
 *
 * AC: scope + paging + version. KHÔNG dictionary API; UI dùng enum
 * package + label tables (đã có sẵn).
 * ─────────────────────────────────────────────────────────────────────────── */
export const ContextQueryRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    scope: QueryScopeSchema,
    /** Target — Talent hoặc Client canonical id. */
    target: CanonicalTargetRefSchema.optional(),
    /** External contact (Chatwoot/Zalo) để resolve canonical target. */
    external: ExternalContactRefSchema.optional(),
    /**
     * Field allowlist — server chỉ trả field nằm trong allowlist. Nếu
     * không set, server trả default allowlist theo scope.
     */
    fieldAllowlist: z
      .array(
        z.enum([
          'identitySummary',
          'placementCase',
          'availability',
          'currentRelationship',
          'nextAction',
          'recentInteractions',
          'contactability',
          'suppressionSummary',
        ]),
      )
      .max(16)
      .optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    // Phải có target hoặc external (một trong hai).
    if (!val.target && !val.external) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'ContextQuery phải có target (canonical) hoặc external (provider ref)',
        path: ['target'],
      });
    }
  });

export const ContextPanelIdentitySummarySchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    fullNameRedacted: z.string().min(1).max(256).optional(),
    phoneRedacted: z.string().min(1).max(64).optional(),
    /**
     * Display only — KHÔNG phải canonical handle. Cảnh báo cho UI:
     * KHÔNG dùng làm target cho mutation.
     */
    displayOnly: z.boolean(),
  })
  .strict();

export const ContextPanelPlacementCaseSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    placementCaseId: CanonicalIdSchema,
    placementCaseVersion: ExpectedVersionSchema,
    stage: PlacementCaseStageSchema.optional(),
    /** Closed status enum literal (closed wire value). */
    closedStatus: ClosedCaseStatusSchema.optional(),
    closeReason: CaseCloseReasonSchema.optional(),
    /** Aggregate version server-set. */
    aggregateVersion: ExpectedVersionSchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    // closedStatus=CLOSED thì closeReason bắt buộc (theo Master §10.6 + §0.3c).
    if (val.closedStatus === CLOSED_CASE_STATUS && !val.closeReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CLOSED phải có closeReason',
        path: ['closeReason'],
      });
    }
    // closeReason chỉ hợp lệ với CLOSED.
    if (val.closeReason && val.closedStatus !== CLOSED_CASE_STATUS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'closeReason chỉ hợp lệ với CLOSED status',
        path: ['closeReason'],
      });
    }
    // Stage chỉ hợp lệ khi case OPEN (status chưa CLOSED).
    if (val.stage && val.closedStatus === CLOSED_CASE_STATUS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'CLOSED case không có stage (status đã đóng; stage giữ audit không phải state active)',
        path: ['stage'],
      });
    }
  });

export const ContextPanelAvailabilitySchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    availability: AvailabilitySchema,
    /** YYYY-MM-DD nếu AVAILABLE_FROM_DATE. */
    availableFromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
    aggregateVersion: ExpectedVersionSchema,
    /**
     * Contactability gate version — runtime HRP gate check freshness;
     * stale cache KHÔNG được cấp phép gửi (Backlog §0.3e).
     */
    contactabilityVersion: ExpectedVersionSchema.optional(),
  })
  .strict();

export const ContextPanelCurrentRelationshipSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    currentRelationship: CurrentRelationshipSchema,
    /**
     * Bắt buộc đánh dấu read-only ở schema bind; mutation reject nếu cố.
     */
    readonly: z.literal(true),
  })
  .strict();

export const ContextPanelNextActionSummarySchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    nextActionId: CanonicalIdSchema,
    nextActionVersion: ExpectedVersionSchema,
    status: NextActionStatusSchema,
    scheduledAt: IsoTimestampSchema.optional(),
    dueAt: IsoTimestampSchema.optional(),
    /** SnoozeMode tách riêng NextActionStatus (Q-27). */
    snoozeMode: z.enum(['ACTIVE', 'SNOOZED', 'DISMISSED']).optional(),
  })
  .strict();

export const ContextPanelRecentInteractionSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    interactionId: CanonicalIdSchema,
    occurredAt: IsoTimestampSchema,
    direction: z.enum(['INBOUND', 'OUTBOUND']),
    channel: z.string().min(1).max(64),
    outcome: z.string().min(1).max(64),
    /** summary REDACTED — KHÔNG chứa raw transcript/URL/base64. */
    summaryRedacted: z
      .string()
      .min(1)
      .max(512)
      .refine(
        (s) =>
          !/https?:\/\//i.test(s) &&
          !/data:[^\s]+/i.test(s) &&
          !/[A-Za-z0-9+/]{100,}={0,2}/.test(s),
        'summaryRedacted KHÔNG chứa URL/base64/data URI',
      ),
  })
  .strict();

export const ContextPanelContactabilitySchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    /** AUTHORIZED/SUPPRESSED/UNKNOWN — fail closed (Backlog §0.3e). */
    dispatchOutcome: z.enum(['AUTHORIZED', 'SUPPRESSED', 'UNKNOWN']),
    reasonCode: z.string().min(1).max(64),
    /** Server-set freshness timestamp. */
    freshnessAt: IsoTimestampSchema,
  })
  .strict();

export const ContextPanelSuppressionSummarySchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    /** Active suppression version. */
    suppressionEventId: z.string().min(1).max(128).optional(),
    reason: z.string().min(1).max(64),
    /** Server-set timestamp suppression commit. */
    committedAt: IsoTimestampSchema,
    /** Cắt-off fence — runtime HRP gate check fence token. */
    fenceCutOffAt: IsoTimestampSchema.optional(),
  })
  .strict();

export const ContextPanelResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    /** Snapshot version — server trả version đã resolve. */
    snapshotVersion: ExpectedVersionSchema,
    /** Target đã resolve (Talent/Client). */
    target: CanonicalTargetRefSchema.optional(),
    /** Field summaries (chỉ có field nằm trong fieldAllowlist). */
    identitySummary: ContextPanelIdentitySummarySchema.optional(),
    placementCase: ContextPanelPlacementCaseSchema.optional(),
    availability: ContextPanelAvailabilitySchema.optional(),
    currentRelationship: ContextPanelCurrentRelationshipSchema.optional(),
    nextAction: ContextPanelNextActionSummarySchema.optional(),
    recentInteractions: z
      .array(ContextPanelRecentInteractionSchema)
      .max(16)
      .optional(),
    contactability: ContextPanelContactabilitySchema.optional(),
    suppressionSummary: ContextPanelSuppressionSummarySchema.optional(),
    /** Server-set timestamp result. */
    resolvedAt: IsoTimestampSchema,
    /** Pending fields marker — runtime có thể trả `unavailable`. */
    unavailableFields: z
      .array(
        z.enum([
          'identitySummary',
          'placementCase',
          'availability',
          'currentRelationship',
          'nextAction',
          'recentInteractions',
          'contactability',
          'suppressionSummary',
        ]),
      )
      .max(16)
      .optional(),
  })
  .strict();
export type ContextPanelResult = z.infer<typeof ContextPanelResultSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * Read-only identity resolution — preview trước submit.
 *
 * Tách với createOrMatch mutation (Backlog §0.3a + §0.3b): query này
 * KHÔNG cho phép mutation; canonical ids returned chỉ dùng cho preview
 * UI.
 * ─────────────────────────────────────────────────────────────────────────── */
export const ReadOnlyIdentityPreviewRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    scope: QueryScopeSchema,
    /** Signals — KHÔNG đủ để ép tạo NEW_PROFILE. */
    signals: z
      .object({
        phoneNormalized: z.string().min(8).max(15).optional(),
        citizenIdLast4: z.string().regex(/^\d{4}$/u).optional(),
        fullNameNormalized: z.string().min(1).max(128).optional(),
      })
      .strict(),
  })
  .strict();

export const ReadOnlyIdentityCandidateSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    candidateId: z.string().min(1).max(128),
    matchState: ExternalContactMatchStateSchema,
    /** Redacted display. */
    display: z.string().min(1).max(256),
    /** Server-set score nếu có; KHÔNG dùng để mutate. */
    score: z.number().min(0).max(1).optional(),
    /**
     * Mapping match state — schema bind, runtime gate enforce.
     */
    aggregateVersion: ExpectedVersionSchema.optional(),
  })
  .strict();

export const ReadOnlyIdentityPreviewResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    candidates: z.array(ReadOnlyIdentityCandidateSchema).max(16),
    /** Server-set timestamp. */
    resolvedAt: IsoTimestampSchema,
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * Allowed actions query — list các command mà target/actor có quyền gọi.
 *
 * Schema bind shape CONFIRMED: trả về danh sách allowlist command +
 * tier (inbound/reviewer/privileged); runtime policy + capability
 * mapping là HRP-owned.
 * ─────────────────────────────────────────────────────────────────────────── */
export const AllowedActionsQueryRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    scope: QueryScopeSchema,
    /** Target để check allowed actions (permission scope). */
    target: CanonicalTargetRefSchema.optional(),
  })
  .strict();

export const AllowedActionSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    commandName: z.string().min(1).max(128),
    tier: z.enum([
      'INBOUND_DEFAULT',
      'INBOUND_REVIEWER',
      'PRIVILEGED_MERGE',
    ]),
    /** Server-set capability version. */
    capabilityVersion: ExpectedVersionSchema,
    /**
     * Marker privileged — merge/resolve có capability riêng.
     */
    privileged: z.boolean(),
  })
  .strict();

export const AllowedActionsQueryResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    actions: z.array(AllowedActionSchema).max(128),
    resolvedAt: IsoTimestampSchema,
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * Contactability check — query tươi (không stale cache).
 *
 * Schema bind shape CONFIRMED: KHÔNG dùng stale cache làm phép gửi
 * (Master §10.6.5 + Backlog §0.3e + connector §6).
 * ─────────────────────────────────────────────────────────────────────────── */
export const ContactabilityCheckRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    scope: QueryScopeSchema,
    target: CanonicalTargetRefSchema,
    /** Channel cần check (ZALO_OA, CHATWOOT, EMAIL, ...). */
    channel: z.string().min(1).max(64),
  })
  .strict();

export const ContactabilityCheckResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    target: CanonicalTargetRefSchema,
    channel: z.string().min(1).max(64),
    /** AUTHORIZED / SUPPRESSED / UNKNOWN — fail closed. */
    outcome: z.enum(['AUTHORIZED', 'SUPPRESSED', 'UNKNOWN']),
    reasonCode: z.string().min(1).max(64),
    /** Server-set freshness timestamp — runtime gate check freshness. */
    freshnessAt: IsoTimestampSchema,
    /**
     * DNC fence token + cut-off (nếu có). Runtime gate cấp + verify.
     */
    fenceToken: z.string().min(8).max(256).optional(),
    fenceCutOffAt: IsoTimestampSchema.optional(),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * OperationQuery (đã có trong envelopes.ts) — reuse pattern.
 *
 * Schema bind shape đã có OperationQuerySchema ở envelopes.ts; runtime
 * HRP gate bind reference tới org/command/actor trước khi trả result.
 * ─────────────────────────────────────────────────────────────────────────── */

/* ───────────────────────────────────────────────────────────────────────────
 * Constants snapshot — KHÔNG phải query, là static snapshot từ package.
 *
 * Owner chỉ thị rev 2: "constants UI không phụ thuộc dictionary API".
 * Schema này bind shape snapshot cho /admin/constants nếu cần; UI/dev
 * dùng enum + label tables trực tiếp từ package.
 * ─────────────────────────────────────────────────────────────────────────── */
export const ConstantsSnapshotSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    placementCaseStages: z.array(PlacementCaseStageSchema),
    placementCaseStageLabels: z.record(z.string(), z.string()),
    caseCloseReasons: z.array(CaseCloseReasonSchema),
    caseCloseReasonLabels: z.record(z.string(), z.string()),
    closedCaseStatus: z.literal(CLOSED_CASE_STATUS),
    availabilities: z.array(AvailabilitySchema),
    availabilityLabels: z.record(z.string(), z.string()),
    currentRelationships: z.array(CurrentRelationshipSchema),
    currentRelationshipLabels: z.record(z.string(), z.string()),
    matchingOutcomes: z.array(MatchingOutcomeSchema),
    externalContactMatchStates: z.array(ExternalContactMatchStateSchema),
    nextActionStatuses: z.array(NextActionStatusSchema),
    /** Snapshot version — runtime HRP gate bump khi enum constants đổi. */
    snapshotVersion: ExpectedVersionSchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    // Cross-check keys khớp enum (không dùng cho runtime, chỉ audit).
    const stagesCheck = PLACEMENT_CASE_STAGES.slice();
    const availCheck = AVAILABILITIES.slice();
    const closeReasonCheck = CASE_CLOSE_REASONS.slice();
    const crCheck = CURRENT_RELATIONSHIPS.slice();
    const matchingCheck = MATCHING_OUTCOMES.slice();
    const ecsCheck = EXTERNAL_CONTACT_MATCH_STATES.slice();
    const naCheck = NEXT_ACTION_STATUSES.slice();
    if (
      stagesCheck.length !== val.placementCaseStages.length ||
      availCheck.length !== val.availabilities.length ||
      closeReasonCheck.length !== val.caseCloseReasons.length ||
      crCheck.length !== val.currentRelationships.length ||
      matchingCheck.length !== val.matchingOutcomes.length ||
      ecsCheck.length !== val.externalContactMatchStates.length ||
      naCheck.length !== val.nextActionStatuses.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Constants snapshot không khớp enum package — drift!',
        path: ['snapshotVersion'],
      });
    }
    // Label tables đầy đủ.
    for (const s of PLACEMENT_CASE_STAGES) {
      if (!PLACEMENT_CASE_STAGE_LABELS_VI[s]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `thiếu label cho stage ${s}`,
          path: ['placementCaseStageLabels'],
        });
      }
    }
    for (const s of AVAILABILITIES) {
      if (!AVAILABILITY_LABELS_VI[s]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `thiếu label cho availability ${s}`,
          path: ['availabilityLabels'],
        });
      }
    }
    for (const s of CASE_CLOSE_REASONS) {
      if (!CASE_CLOSE_REASON_LABELS_VI[s]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `thiếu label cho closeReason ${s}`,
          path: ['caseCloseReasonLabels'],
        });
      }
    }
    for (const s of CURRENT_RELATIONSHIPS) {
      if (!CURRENT_RELATIONSHIP_LABELS_VI[s]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `thiếu label cho currentRelationship ${s}`,
          path: ['currentRelationshipLabels'],
        });
      }
    }
  });

/* ───────────────────────────────────────────────────────────────────────────
 * Queries forbidden fields — marker audit.
 *
 * Owner chỉ thị rev 2: "Marker/forbidden-list không tự chứng minh AC
 * được enforce". Đây CHỈ là schema marker/runtime gate marker;
 * runtime HRP gate enforce qua code review + lint + integration test.
 * ─────────────────────────────────────────────────────────────────────────── */
export const QUERIES_PATCH_FORBIDDEN = Object.freeze([
  // Query không cho phép dùng stale cache như canonical.
  'useStaleCacheAsCanonical',
  'useStaleContactabilityAsAuthorized',
  // KHÔNG suy giá trị từ PII / raw attribute.
  'fillFromChatwootAttributes',
  'fillFromZaloAttributes',
  'projectRawHandleAsCanonical',
  // KHÔNG cho phép query mutate.
  'mutateFromQuery',
  'performCreateOrMatchInQuery',
  // KHÔNG tự quyết attribution/reviewer.
  'assumeReviewer',
  'assumeAttribution',
  'assumeCreditedCreator',
  // KHÔNG cho phép dictionary-API dependency trong UI.
  'bindToDictionaryEndpoint',
  'useRemoteConstantEndpoint',
  // KHÔNG cho phép redact bypass.
  'skipRedaction',
  'bypassFieldAllowlist',
] as const);

export { SCHEMA_VERSION };
