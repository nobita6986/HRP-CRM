/**
 * analytics.ts — Metric definition contracts (Gate 0 / 0.5).
 *
 * Nguồn: Backlog Gate0 §Task 0.5 + Master V2.6 §13.7 + §13.10.4.
 *
 * Trọng tâm AC (Owner chỉ thị):
 *  - MetricDefinition có grain / unit / period / cohort / source /
 *    as-of / version / attribution.
 *  - Profile created/updated/submitted là 3 metric KHÁC NHAU (Q-9).
 *  - Thiếu nguồn KHÔNG đoán (Q-30); attribution state AVAILABLE /
 *    UNAVAILABLE.
 */
import { z } from 'zod';
import { SCHEMA_VERSION } from '../enums.js';
import {
  ExpectedVersionSchema,
  OrganizationIdSchema,
  SchemaVersionSchema,
  CalendarDateSchema,
} from '../primitives.js';

/* ───────────────────────────────────────────────────────────────────────────
 * Metric grain — granularity level.
 *
 * Schema bind shape CONFIRMED:
 *  - ACTOR: per-actor.
 *  - TEAM: per-team/role.
 *  - COHORT: per cohort filter.
 *  - ORGANIZATION: org-wide.
 *  - CONVERSATION: per conversation canonical.
 *  - TARGET: per canonical target (LaborProfile/PlacementCase/etc.).
 * ─────────────────────────────────────────────────────────────────────────── */
export const METRIC_GRAINS = [
  'ACTOR',
  'TEAM',
  'COHORT',
  'ORGANIZATION',
  'CONVERSATION',
  'TARGET',
] as const;
export const MetricGrainSchema = z.enum(METRIC_GRAINS);

/* ───────────────────────────────────────────────────────────────────────────
 * Metric unit — value type (count / rate / duration / currency / etc.).
 *
 * Schema bind shape CONFIRMED (allowlist); runtime gate quyết
 * unit-specific aggregation.
 * ─────────────────────────────────────────────────────────────────────────── */
export const METRIC_UNITS = [
  'COUNT',
  'RATE',
  'DURATION_MS',
  'USD_MICRO',
  'CURRENCY_VND',
  'RATIO',
] as const;
export const MetricUnitSchema = z.enum(METRIC_UNITS);

/* ───────────────────────────────────────────────────────────────────────────
 * Metric period — time granularity.
 *
 * Schema bind shape CONFIRMED: DAILY / WEEKLY / MONTHLY / QUARTERLY.
 * Runtime HRP gate quyết timezone business clock anchor.
 * ─────────────────────────────────────────────────────────────────────────── */
export const METRIC_PERIODS = [
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
] as const;
export const MetricPeriodSchema = z.enum(METRIC_PERIODS);

/* ───────────────────────────────────────────────────────────────────────────
 * Metric attribution state — Owner Q-30 thiếu nguồn KHÔNG đoán.
 *
 * Schema bind shape CONFIRMED: AVAILABLE / UNAVAILABLE.
 *  - AVAILABLE: source attribution rõ; result trả data đầy đủ.
 *  - UNAVAILABLE: source chưa đủ; KHÔNG đoán, result trả giá trị rỗng
 *    + reasonCode.
 * ─────────────────────────────────────────────────────────────────────────── */
export const METRIC_ATTRIBUTION_STATES = [
  'AVAILABLE',
  'UNAVAILABLE',
] as const;
export const MetricAttributionStateSchema = z.enum(
  METRIC_ATTRIBUTION_STATES,
);

/* ───────────────────────────────────────────────────────────────────────────
 * MetricDefinition — top-level DTO định nghĩa metric.
 *
 * Schema bind shape CONFIRMED (Backlog §0.5 AC #2):
 *  - metricId opaque (server-set khi tạo).
 *  - grain / unit / period.
 *  - cohort — filter allowlist.
 *  - source — provider/system attribution.
 *  - asOf — server-set timestamp.
 *  - version — monotonic.
 *  - attributionState — AVAILABLE / UNAVAILABLE.
 *
 * PROFILE_CREATED / PROFILE_UPDATED / PROFILE_SUBMITTED là 3 metricId
 * KHÁC NHAU; schema không tự đồng nghĩa.
 * ─────────────────────────────────────────────────────────────────────────── */
export const MetricSourceSchema = z
  .object({
    /** Provider/system enum — runtime gate bind enum allowlist. */
    kind: z.enum([
      'CHATWOOT',
      'ZALO_OA',
      'INTERNAL_FORM',
      'HRP_UI',
      'EXPERIMENTAL',
    ]),
    /** Optional: source version (provider config). */
    sourceVersion: ExpectedVersionSchema.optional(),
  })
  .strict();

export const MetricDefinitionInputSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    /** metricId opaque — server-set; bind shape: alphanumeric._:- */
    metricId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, 'metricId không hợp lệ'),
    /** Display name (UI). */
    displayName: z.string().min(1).max(256),
    /** Description optional. */
    description: z.string().max(1024).optional(),
    grain: MetricGrainSchema,
    unit: MetricUnitSchema,
    period: MetricPeriodSchema,
    /** Cohort filter — schema bind shape; runtime gate filter. */
    cohort: z
      .object({
        region: z.array(z.string().min(1).max(64)).max(8).optional(),
        source: z.array(z.string().min(1).max(64)).max(8).optional(),
        grainFilter: z.record(z.string(), z.string()).optional(),
      })
      .strict()
      .optional(),
    source: MetricSourceSchema,
    attributionState: MetricAttributionStateSchema,
    /** Reason nếu UNAVAILABLE — KHÔNG đoán (Q-30). */
    attributionReasonCode: z.string().min(1).max(64).optional(),
    /** Optimistic concurrency. */
    expectedVersion: ExpectedVersionSchema.optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.attributionState === 'UNAVAILABLE' && !val.attributionReasonCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'UNAVAILABLE attribution yêu cầu reasonCode',
        path: ['attributionReasonCode'],
      });
    }
    if (val.attributionState === 'AVAILABLE' && val.attributionReasonCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'AVAILABLE KHÔNG có reasonCode',
        path: ['attributionReasonCode'],
      });
    }
    // EXPERIMENTAL source → chỉ Phase 10 namespace.
    if (
      val.source.kind === 'EXPERIMENTAL' &&
      val.attributionState !== 'UNAVAILABLE'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'EXPERIMENTAL source mặc định UNAVAILABLE (Phase 10 chưa chốt)',
        path: ['attributionState'],
      });
    }
  });

export const MetricDefinitionSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    metricId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, 'metricId không hợp lệ'),
    displayName: z.string().min(1).max(256),
    description: z.string().max(1024).optional(),
    grain: MetricGrainSchema,
    unit: MetricUnitSchema,
    period: MetricPeriodSchema,
    cohort: z
      .object({
        region: z.array(z.string().min(1).max(64)).max(8).optional(),
        source: z.array(z.string().min(1).max(64)).max(8).optional(),
        grainFilter: z.record(z.string(), z.string()).optional(),
      })
      .strict()
      .optional(),
    source: MetricSourceSchema,
    attributionState: MetricAttributionStateSchema,
    attributionReasonCode: z.string().min(1).max(64).optional(),
    /** Server-set version. */
    version: ExpectedVersionSchema,
    /** Server-set asOf timestamp. */
    asOf: z.string().datetime({ offset: true }),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * Profile lifecycle metrics — 3 metricId PHẢI khác nhau (Q-9).
 *
 * Schema bind shape CONFIRMED: 3 metricId allowlist riêng. Schema
 * reject nếu caller cố gán cùng metricId cho 2 lifecycle khác nhau.
 * ─────────────────────────────────────────────────────────────────────────── */
export const PROFILE_LIFECYCLE_METRIC_IDS = [
  'profile.created',
  'profile.updated',
  'profile.submitted',
] as const;
export const ProfileLifecycleMetricIdSchema = z.enum(
  PROFILE_LIFECYCLE_METRIC_IDS,
);

export const ProfileLifecycleMetricBindingSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    /** Map metricId → Profile lifecycle event enum. */
    bindings: z
      .object({
        'profile.created': MetricDefinitionSchema,
        'profile.updated': MetricDefinitionSchema,
        'profile.submitted': MetricDefinitionSchema,
      })
      .strict()
      .superRefine((val, ctx) => {
        // 3 metricId PHẢI khác nhau — schema reject nếu trùng.
        const ids = new Set<string>();
        for (const [key, def] of Object.entries(val)) {
          if (ids.has(def.metricId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `metricId '${def.metricId}' đã dùng ở lifecycle khác — 3 lifecycle PHẢI khác nhau (Q-9)`,
              path: [key, 'metricId'],
            });
          }
          ids.add(def.metricId);
        }
      }),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * MetricValue — kết quả metric.
 *
 * Schema bind shape CONFIRMED:
 *  - metricId reference.
 *  - value (number | rate | duration | currency) theo unit.
 *  - asOf timestamp.
 *  - version metric.
 *  - attributionState.
 * ─────────────────────────────────────────────────────────────────────────── */
export const MetricValueSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    metricId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, 'metricId không hợp lệ'),
    grain: MetricGrainSchema,
    unit: MetricUnitSchema,
    period: MetricPeriodSchema,
    value: z.number(),
    /** Server-set asOf. */
    asOf: z.string().datetime({ offset: true }),
    /** Server-set version. */
    version: ExpectedVersionSchema,
    /** Attribution state — schema bind (Q-30). */
    attributionState: MetricAttributionStateSchema,
    attributionReasonCode: z.string().min(1).max(64).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.attributionState === 'UNAVAILABLE' && !val.attributionReasonCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'UNAVAILABLE yêu cầu reasonCode (KHÔNG đoán)',
        path: ['attributionReasonCode'],
      });
    }
    if (val.attributionState === 'AVAILABLE' && val.attributionReasonCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'AVAILABLE KHÔNG có reasonCode',
        path: ['attributionReasonCode'],
      });
    }
    // UNAVAILABLE → KHÔNG có value (tránh đoán số).
    if (val.attributionState === 'UNAVAILABLE' && val.value !== 0) {
      // Allow 0 với reasonCode; không accept value khác.
      if (val.value !== 0 || !val.attributionReasonCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'UNAVAILABLE value phải = 0 (placeholder); KHÔNG đoán số liệu',
          path: ['value'],
        });
      }
    }
  });

/* ───────────────────────────────────────────────────────────────────────────
 * Metric aggregate read — list value theo filter.
 *
 * Schema bind shape CONFIRMED:
 *  - cursor/pageSize paging.
 *  - filter: metricIds[], periodStart/End, cohort.
 *  - UNAVAILABLE vẫn được trả (placeholders).
 * ─────────────────────────────────────────────────────────────────────────── */
export const MetricAggregateReadRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    metricIds: z.array(z.string().min(1).max(128)).max(64),
    periodStart: CalendarDateSchema.optional(),
    periodEnd: CalendarDateSchema.optional(),
    cursor: z.string().min(1).max(512).optional(),
    pageSize: z.number().int().min(1).max(200).default(20),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.periodStart && val.periodEnd && val.periodStart > val.periodEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'periodStart phải <= periodEnd',
        path: ['periodStart'],
      });
    }
  });

export const MetricAggregateReadResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    values: z.array(MetricValueSchema).max(200),
    nextCursor: z.string().min(1).max(512).optional(),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * Analytics forbid-list (Q-30 marker audit).
 *
 * Schema bind shape marker; runtime HRP gate enforce.
 * ─────────────────────────────────────────────────────────────────────────── */
export const ANALYTICS_PATCH_FORBIDDEN = Object.freeze([
  // Không suy đoán thiếu source.
  'assumeAttribution',
  'assumeReviewer',
  'fillMissingAttribution',
  // Không tự coi created == submitted.
  'mergeCreatedAsSubmitted',
  'collapseLifecycleToSingleMetric',
  // Không drop cohort filter.
  'dropCohort',
  'silentCrossCohort',
  // Không raw PII trong metric.
  'embedRawPII',
  'embedFullName',
  'embedPhoneRaw',
  // Không promote canonical-ready khi experimental.
  'markAsCanonicalReady',
  'promoteExperimental',
] as const);

export { SCHEMA_VERSION };
