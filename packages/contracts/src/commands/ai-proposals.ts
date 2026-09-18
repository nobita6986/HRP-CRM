/**
 * ai-proposals.ts — AI proposal contracts (Gate 0 / 0.5).
 *
 * Nguồn: Backlog Gate0 §Task 0.5 + Master V2.6 §13.10.5–6.
 *
 * Trọng tâm AC (Owner chỉ thị):
 *  - AI proposal gắn revision / fields / evidence / uncertainty / context.
 *  - KHÔNG arbitrary command payload; KHÔNG direct writes.
 *  - Sale/AI chỉ read/propose; manager mới apply (kpi.ts).
 *  - Phase 10 chưa chốt → tách namespace experimental/version; không
 *    gọi model/endpoint thật ở Gate 0.
 */
import { z } from 'zod';
import { SCHEMA_VERSION } from '../enums.js';
import {
  ActorSchema,
  CanonicalIdSchema,
  ExpectedVersionSchema,
  OrganizationIdSchema,
  SchemaVersionSchema,
} from '../primitives.js';
import { CommandEvidenceRefSchema } from './evidence.js';

/* ───────────────────────────────────────────────────────────────────────────
 * AI proposal kind — wire enum (Backlog §0.5 AC #4).
 *
 * Schema bind shape CONFIRMED:
 *  - AUTOFILL: đề xuất điền field cho intake/profile/intent.
 *  - SUGGESTED_ACTION: đề xuất NextAction/availability.
 *  - SUMMARY: tóm tắt hồ sơ/conversation cho UI.
 *  - DRAFT_REPLY: draft tin nhắn trả lời (caller review trước send).
 *  - SCORE: scoring candidate (talent hoặc job match).
 *
 * PROPOSED: thêm kind mới phải HRP-owned PR + audit.
 * ─────────────────────────────────────────────────────────────────────────── */
export const AI_PROPOSAL_KINDS = [
  'AUTOFILL',
  'SUGGESTED_ACTION',
  'SUMMARY',
  'DRAFT_REPLY',
  'SCORE',
] as const;
export const AIProposalKindSchema = z.enum(AI_PROPOSAL_KINDS);

/* ───────────────────────────────────────────────────────────────────────────
 * Uncertainty — schema bind shape; model provider phải trả uncertainty
 * cho mỗi proposal.
 *
 * Schema bind shape CONFIRMED:
 *  - confidence ∈ [0,1].
 *  - reasonCodes[] — opaque reason; HRP-owned taxonomy chưa chốt (PROPOSED).
 * ─────────────────────────────────────────────────────────────────────────── */
export const AIProposalUncertaintySchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    confidence: z.number().min(0).max(1),
    reasonCodes: z.array(z.string().min(1).max(64)).max(16),
    /**
     * Field-level uncertainty breakdown (optional) — runtime gate
     * compute nếu provider trả; schema bind shape.
     */
    fieldBreakdown: z
      .array(
        z
          .object({
            fieldPath: z.string().min(1).max(256),
            confidence: z.number().min(0).max(1),
            reasonCode: z.string().min(1).max(64).optional(),
          })
          .strict(),
      )
      .max(64)
      .optional(),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * AI proposal field — schema bind shape cho một field đề xuất.
 *
 * Schema bind shape CONFIRMED (Backlog §0.5 AC #4):
 *  - fieldPath dotted.
 *  - proposedValue: typed theo target (default z.unknown; UI/runtime
 *    validate khi apply).
 *  - currentValue: server cung cấp để diff.
 *  - evidenceRefs[] — opaque, KHÔNG raw URL/base64.
 *  - rationale — short text giải thích (≤ 512, reject URL/base64).
 * ─────────────────────────────────────────────────────────────────────────── */
const ProposedFieldRefValueSchema = z.unknown();

export const AIProposalFieldSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    fieldPath: z.string().min(1).max(256),
    proposedValue: ProposedFieldRefValueSchema,
    currentValue: ProposedFieldRefValueSchema.optional(),
    /**
     * F5 (Auditor findings, Owner chỉ thị G0/0.8): reuse
     * `CommandEvidenceRefSchema` từ evidence.ts để đồng bộ shape.
     * Reference KHÔNG là quyền đọc; KHÔNG cấp phép gửi CCCD/PII tới
     * model — runtime HRP gate đọc evidence content qua evidence
     * service.
     */
    evidenceRefs: z.array(CommandEvidenceRefSchema).max(16).optional(),
    rationale: z
      .string()
      .min(1)
      .max(512)
      .refine(
        (s) =>
          !/https?:\/\//i.test(s) &&
          !/data:[^\s]+/i.test(s) &&
          !/[A-Za-z0-9+/]{100,}={0,2}/.test(s),
        'rationale KHÔNG chứa URL/base64/data URI',
      ),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * AI proposal context — runtime gate bind scope + target reference.
 *
 * Schema bind shape CONFIRMED:
 *  - organizationId required.
 *  - target: Talent/Client canonical (optional).
 *  - conversationId: optional reference external/internal.
 *  - operationReference: optional OperationReference để biết apply
 *    operation đang chờ (gate).
 * ─────────────────────────────────────────────────────────────────────────── */
export const AIProposalContextSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    /** Optional: target canonical (Talent/Client). */
    targetCanonicalId: CanonicalIdSchema.optional(),
    targetAggregateVersion: ExpectedVersionSchema.optional(),
    /** Optional: conversation canonical id. */
    conversationId: z.string().min(1).max(128).optional(),
    /** Optional: operation đang pending (gate reference). */
    operationId: z.string().min(8).max(64).optional(),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * AI proposal — top-level DTO.
 *
 * Schema bind shape CONFIRMED (Backlog §0.5 AC #4):
 *  - proposalId opaque (server-set).
 *  - proposalKind ∈ allowlist.
 *  - revisionId opaque (server-set, cho dedupe apply).
 *  - fields[] — proposed fields.
 *  - evidenceRefs[] — opaque evidence.
 *  - uncertainty — confidence + reasonCodes.
 *  - context — scope (org/target/conversation/operation).
 *  - providerRef — opaque ref tới provider config (KHÔNG raw API key).
 *  - createdBy: actor đề xuất (USER/SERVICE/DELEGATED_USER).
 *  - createdAt: server-set.
 *
 * KHÔNG có field `commandPayload` / `commandDraft` / `arbitraryCommand`
 * — schema strict reject. Apply phải qua envelope CommandRequest
 * (Outbox hoặc canonical mutation) với actor binding đúng.
 * ─────────────────────────────────────────────────────────────────────────── */
export const AIProposalSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    proposalId: z.string().min(8).max(128),
    proposalKind: AIProposalKindSchema,
    /** Server-set revision; runtime gate cấp khi re-propose. */
    revisionId: z.string().min(1).max(128),
    fields: z.array(AIProposalFieldSchema).max(64),
    /**
     * F5 (Auditor findings, Owner chỉ thị G0/0.8): reuse
     * `CommandEvidenceRefSchema` từ evidence.ts để đồng bộ shape.
     * Reference KHÔNG là quyền đọc; KHÔNG cấp phép gửi CCCD/PII tới
     * model — runtime HRP gate đọc evidence content qua evidence
     * service. Provider chỉ thấy metadata, không phải CCCD/PII raw.
     */
    evidenceRefs: z.array(CommandEvidenceRefSchema).max(16).optional(),
    uncertainty: AIProposalUncertaintySchema,
    context: AIProposalContextSchema,
    /** Opaque provider reference — KHÔNG raw API key. */
    providerRef: z.object({
      providerId: z.string().min(1).max(128),
      providerConfigVersion: ExpectedVersionSchema,
      model: z.string().min(1).max(256),
    }).strict(),
    createdBy: ActorSchema,
    createdAt: z.string().datetime({ offset: true }),
    /**
     * Expiry — runtime HRP gate quyết retention. Schema bind shape.
     */
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * Apply AI proposal — command để apply proposal (manager capability).
 *
 * Schema bind shape CONFIRMED:
 *  - proposalId + revisionId (dedupe/optimistic concurrency).
 *  - acceptedFields[] — subset các fieldPath caller chấp nhận apply.
 *    Caller KHÔNG được apply field không có trong proposal (chống
 *    inject).
 *  - expectedVersion target — caller phải xác nhận target version.
 *
 * PROPOSED: runtime gate quyết policy manager-only / dual-control.
 * ─────────────────────────────────────────────────────────────────────────── */
export const ApplyAIProposalInputSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    proposalId: z.string().min(8).max(128),
    revisionId: z.string().min(1).max(128),
    /** Subset các fieldPath caller chấp nhận. */
    acceptedFieldPaths: z.array(z.string().min(1).max(256)).max(64),
    /** Expected target version (optimistic concurrency). */
    expectedTargetVersion: ExpectedVersionSchema.optional(),
    /** Optional: context for target canonical id. */
    targetCanonicalId: CanonicalIdSchema.optional(),
  })
  .strict();

export const ApplyAIProposalResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    proposalId: z.string().min(8).max(128),
    revisionId: z.string().min(1).max(128),
    /** Per-field apply result. */
    appliedFields: z
      .array(
        z
          .object({
            fieldPath: z.string().min(1).max(256),
            outcome: z.enum(['APPLIED', 'REJECTED', 'SKIPPED']),
            appliedVersion: ExpectedVersionSchema.optional(),
            reasonCode: z.string().min(1).max(64).optional(),
          })
          .strict(),
      )
      .max(64),
    /** Optional aggregate version sau apply. */
    appliedTargetVersion: ExpectedVersionSchema.optional(),
    completedAt: z.string().datetime({ offset: true }),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * AI proposal forbid-list (Q-30 marker audit).
 *
 * Owner rev 2: marker KHÔNG tự chứng minh AC enforce. Schema strict đã
 * reject field không khai báo; runtime HRP gate enforce qua code review
 * + lint + integration test.
 * ─────────────────────────────────────────────────────────────────────────── */
export const AI_PROPOSAL_PATCH_FORBIDDEN = Object.freeze([
  // KHÔNG arbitrary command payload.
  'embedCommandPayload',
  'embedCommandDraft',
  'embedArbitraryCommand',
  // KHÔNG direct write.
  'directWriteToCanonical',
  'bypassStaffReview',
  'applyWithoutManagerCapability',
  'bypassVersionCheck',
  // KHÔNG suy đoán thiếu source.
  'assumeAttribution',
  'assumeReviewer',
  'assumeCreator',
  // KHÔNG raw secret / API key.
  'embedApiKey',
  'embedRawSecret',
  'embedAccessToken',
  // KHÔNG PII không kiểm soát.
  'embedRawPII',
  'embedFullName',
  'embedPhoneRaw',
  'embedCitizenIdRaw',
  // KHÔNG trộn experimental canonical-ready.
  'markAsCanonicalReady',
  'promoteWithoutReview',
  // KHÔNG drop evidence.
  'applyWithoutEvidence',
  'silentlyOverwriteField',
] as const);

export { SCHEMA_VERSION };
