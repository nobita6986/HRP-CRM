/**
 * routing.ts — Routing contracts (Gate 0 / 0.5).
 *
 * Nguồn: Backlog Gate0 §Task 0.5 + Master V2.6 §6 + §10.2.
 *
 * Trọng tâm AC (Owner chỉ thị):
 *  - Source allocation KHÁC weighted recipient distribution:
 *    source allocation = one-to-one deterministic (Chatwoot/Zalo OA
 *    → cố định 1 owner/recipient cho conversation/contact); weighted
 *    distribution = many (campaign audience → N recipients theo
 *    weight/cap).
 *  - pool/eligible set/weight/cap/version/decision/reservation có DTO.
 *  - KHÔNG thay HRP Handling/credit policy (Master §10.2); không
 *    integration direct Worker/Beneficiary writes.
 *  - Manager-owned weight/cap revision; AI/sale không tự sửa (Backlog
 *    §1.11 AC #4).
 */
import { z } from 'zod';
import { SCHEMA_VERSION } from '../enums.js';
import {
  ActorSchema,
  CanonicalIdSchema,
  ConnectionIdSchema,
  ExpectedVersionSchema,
  OrganizationIdSchema,
  ProviderNameSchema,
  SchemaVersionSchema,
} from '../primitives.js';

/* ───────────────────────────────────────────────────────────────────────────
 * Routing strategy enum — phân biệt 2 strategy chính.
 *
 * Schema bind shape CONFIRMED (Backlog §0.5 AC #1):
 *  - SOURCE_ALLOCATION: one-to-one deterministic (Chatwoot/Zalo OA →
 *    cố định 1 owner theo source config); KHÔNG weight/cap.
 *  - WEIGHTED_DISTRIBUTION: many recipients theo weight/cap
 *    (campaign audience).
 *  - HYBRID: gộp cả 2 (PROPOSED; runtime gate quyết policy).
 *
 * Schema PHÂN BIỆT: SOURCE_ALLOCATION KHÔNG có weight/cap; WEIGHTED
 * KHÔNG có fixedOwner; HYBRID có cả hai.
 * ─────────────────────────────────────────────────────────────────────────── */
export const ROUTING_STRATEGIES = [
  'SOURCE_ALLOCATION',
  'WEIGHTED_DISTRIBUTION',
  'HYBRID',
] as const;
export const RoutingStrategySchema = z.enum(ROUTING_STRATEGIES);

/* ───────────────────────────────────────────────────────────────────────────
 * Routing eligibility set — schema bind filter (region, source, role,
 * offline status).
 *
 * Schema bind shape CONFIRMED.
 * ─────────────────────────────────────────────────────────────────────────── */
export const RoutingEligibleSetSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    /** Roles được phép (SALE / STAFF / REVIEWER / MANAGER / AI_AGENT). */
    roles: z
      .array(
        z.enum([
          'SALE',
          'STAFF',
          'REVIEWER',
          'MANAGER',
          'AI_AGENT',
        ]),
      )
      .min(1)
      .max(8),
    /** Region/area filter — runtime gate map region code. */
    regions: z.array(z.string().min(1).max(64)).max(16).optional(),
    /** Provider source filter — runtime gate bind provider allowlist. */
    providers: z.array(ProviderNameSchema).max(8).optional(),
    /**
     * Capacity gate — recipient tạm thời không nhận nếu vượt cap.
     */
    capacityGate: z
      .object({
        maxConcurrent: z.number().int().nonnegative().optional(),
        /** Online status required. */
        requireOnline: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * Routing pool — schema bind pool definition.
 *
 * Schema bind shape CONFIRMED:
 *  - poolId opaque (server-set).
 *  - displayName.
 *  - strategy ∈ allowlist.
 *  - eligibleSet: RoutingEligibleSet.
 *  - version: monotonic.
 *  - For SOURCE_ALLOCATION: KHÔNG có weight/cap; chỉ fixedOwner.
 *  - For WEIGHTED_DISTRIBUTION: có weights[] + caps[]; KHÔNG fixedOwner.
 *  - For HYBRID: có cả hai.
 * ─────────────────────────────────────────────────────────────────────────── */
export const RoutingFixedOwnerSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    /** Connection / account scope — runtime gate bind cho provider. */
    provider: ProviderNameSchema,
    connectionId: ConnectionIdSchema,
    /** Recipient (actor) target. */
    recipientActorId: z.string().min(1).max(128),
    recipientRole: z.enum(['SALE', 'STAFF', 'REVIEWER', 'MANAGER']),
  })
  .strict();

export const RoutingWeightEntrySchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    recipientActorId: z.string().min(1).max(128),
    recipientRole: z.enum(['SALE', 'STAFF', 'REVIEWER', 'MANAGER', 'AI_AGENT']),
    /**
     * Weight — số nguyên ≥ 0; 0 = tạm disabled. Runtime gate quyết
     * distribution ratio.
     */
    weight: z.number().int().nonnegative(),
    /**
     * Cap (giới hạn số lượng phân phối trong period) — ≥ 0; 0 = không
     * cap.
     */
    cap: z.number().int().nonnegative().optional(),
    /**
     * Period của cap — DAILY / WEEKLY / MONTHLY (chỉ cho cap; weight
     * không phụ thuộc period).
     */
    capPeriod: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']).optional(),
  })
  .strict();

export const RoutingPoolSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    poolId: z.string().min(1).max(128),
    displayName: z.string().min(1).max(256),
    description: z.string().max(1024).optional(),
    strategy: RoutingStrategySchema,
    eligibleSet: RoutingEligibleSetSchema,
    /**
     * Source allocation: 1 fixed owner. KHÔNG có weights.
     * Required khi strategy = SOURCE_ALLOCATION.
     */
    fixedOwner: RoutingFixedOwnerSchema.optional(),
    /**
     * Weighted distribution: weight entries. Required khi strategy =
     * WEIGHTED_DISTRIBUTION.
     */
    weights: z.array(RoutingWeightEntrySchema).max(256).optional(),
    /**
     * Server-set version. Revision tăng đơn điệu khi update.
     */
    version: ExpectedVersionSchema,
    /** Server-set updatedAt. */
    updatedAt: z.string().datetime({ offset: true }),
    /**
     * Config revision lock — owner khi update phải cung cấp
     * expectedVersion.
     */
    updatedBy: ActorSchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.strategy === 'SOURCE_ALLOCATION') {
      if (!val.fixedOwner) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SOURCE_ALLOCATION yêu cầu fixedOwner',
          path: ['fixedOwner'],
        });
      }
      if (val.weights && val.weights.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SOURCE_ALLOCATION KHÔNG có weights',
          path: ['weights'],
        });
      }
    }
    if (val.strategy === 'WEIGHTED_DISTRIBUTION') {
      if (!val.weights || val.weights.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'WEIGHTED_DISTRIBUTION yêu cầu weights ≥ 1',
          path: ['weights'],
        });
      }
      if (val.fixedOwner) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'WEIGHTED_DISTRIBUTION KHÔNG có fixedOwner',
          path: ['fixedOwner'],
        });
      }
    }
    if (val.strategy === 'HYBRID') {
      if (!val.fixedOwner) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'HYBRID yêu cầu fixedOwner',
          path: ['fixedOwner'],
        });
      }
      if (!val.weights || val.weights.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'HYBRID yêu cầu weights ≥ 1',
          path: ['weights'],
        });
      }
    }
    // Total weight > 0 nếu có weights.
    if (val.weights && val.weights.length > 0) {
      const total = val.weights.reduce((s, w) => s + w.weight, 0);
      if (total === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Tổng weights phải > 0 (nếu weights có)',
          path: ['weights'],
        });
      }
    }
  });

/* ───────────────────────────────────────────────────────────────────────────
 * Routing decision — runtime decision trace (audit).
 *
 * Schema bind shape CONFIRMED:
 *  - poolId/version reference.
 *  - strategy — runtime gate chọn.
 *  - selectedRecipientActorId.
 *  - selectionReason (SOURCE_ALLOCATION → 'FIXED_OWNER'; WEIGHTED →
 *    'WEIGHTED_PICK'; HYBRID → 'HYBRID_RULE').
 *  - reservation — fencing token + cut-off (nếu có).
 *  - decisionAt timestamp.
 * ─────────────────────────────────────────────────────────────────────────── */
export const RoutingReservationSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    reservationId: z.string().min(1).max(128),
    /** Fencing token (opaque) — runtime gate cấp. */
    fenceToken: z.string().min(8).max(256),
    /** Reservation TTL — server-set. */
    fenceCutOffAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const RoutingDecisionSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    poolId: z.string().min(1).max(128),
    poolVersion: ExpectedVersionSchema,
    strategy: RoutingStrategySchema,
    /** Selected recipient (resolved by pool). */
    selectedRecipientActorId: z.string().min(1).max(128),
    /**
     * Lý do chọn:
     *  - SOURCE_ALLOCATION → 'FIXED_OWNER'.
     *  - WEIGHTED_DISTRIBUTION → 'WEIGHTED_PICK'.
     *  - HYBRID → 'HYBRID_RULE'.
     * Runtime gate quyết rule chi tiết.
     */
    selectionReason: z.enum(['FIXED_OWNER', 'WEIGHTED_PICK', 'HYBRID_RULE']),
    /** Optional reservation (kèm fence). */
    reservation: RoutingReservationSchema.optional(),
    /** Decision as-of timestamp. */
    decisionAt: z.string().datetime({ offset: true }),
    /** Optional: candidate canonical target. */
    candidateTargetCanonicalId: CanonicalIdSchema.optional(),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * Update routing pool — manager-only write.
 *
 * Schema bind shape CONFIRMED: optimistic concurrency + version bump.
 * AI/sale KHÔNG tự sửa weights (Backlog §1.11 AC #4).
 * ─────────────────────────────────────────────────────────────────────────── */
export const UpdateRoutingPoolInputSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    poolId: z.string().min(1).max(128),
    /** Optimistic concurrency. */
    expectedVersion: ExpectedVersionSchema,
    /** Patch — schema bind shape. */
    patch: z
      .object({
        displayName: z.string().min(1).max(256).optional(),
        description: z.string().max(1024).optional(),
        strategy: RoutingStrategySchema.optional(),
        eligibleSet: RoutingEligibleSetSchema.optional(),
        fixedOwner: RoutingFixedOwnerSchema.optional(),
        weights: z.array(RoutingWeightEntrySchema).max(256).optional(),
      })
      .strict(),
    updatedBy: ActorSchema,
    reasonCode: z.string().min(1).max(64),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * Routing forbid-list (Q-30 marker audit).
 *
 * Owner rev 2: marker KHÔNG tự chứng minh AC enforce. Schema strict đã
 * reject field không khai báo; runtime HRP gate enforce qua code review
 * + lint + integration test.
 * ─────────────────────────────────────────────────────────────────────────── */
export const ROUTING_PATCH_FORBIDDEN = Object.freeze([
  // Không thay HRP Handling/credit policy.
  'rewriteHandlingAssignment',
  'rewriteCreditPolicy',
  'rewriteRecipientAttribution',
  // Không AI/sale tự sửa weights.
  'aiAutoAdjustWeights',
  'saleAutoAdjustWeights',
  // Không merge 2 strategy thành 1 (gây mất semantic).
  'collapseSourceAllocationToWeighted',
  'collapseWeightedToSourceAllocation',
  // Không bypass eligible set.
  'bypassEligibleSet',
  'routeOutsideEligible',
  // Không bypass reservation fence.
  'bypassReservationFence',
  'skipFencingToken',
  // Không bypass capacity cap.
  'bypassCapacityCap',
  'ignoreOfflineStatus',
  // Không drop cohort/history.
  'dropRoutingHistory',
  'silentlyOverwritePool',
] as const);

export { SCHEMA_VERSION };
