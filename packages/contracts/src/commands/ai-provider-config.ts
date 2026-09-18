/**
 * ai-provider-config.ts — AI provider config contracts (Gate 0 / 0.5).
 *
 * Nguồn: Backlog Gate0 §Task 0.5 + Master V2.6 §13.10.5–6 + connector
 * v1.1 (HEAD 414c54b).
 *
 * Trọng tâm AC (Owner chỉ thị):
 *  - Provider config: base URL / model / apiStyle (RESPONSES hoặc
 *    CHAT_COMPLETIONS) / secretRef / capabilities / budget / data
 *    policy.
 *  - Read DTO KHÔNG chứa API key.
 *  - Phase 10 namespace experimental/version; không gọi model/endpoint
 *    thật ở Gate 0.
 */
import { z } from 'zod';
import { SCHEMA_VERSION } from '../enums.js';
import {
  ExpectedVersionSchema,
  OrganizationIdSchema,
  SchemaVersionSchema,
} from '../primitives.js';

/* ───────────────────────────────────────────────────────────────────────────
 * Provider wire API style — enum allowlist.
 *
 * Schema bind shape CONFIRMED (Backlog §0.5 AC #5):
 *  - RESPONSES: OpenAI Responses API style.
 *  - CHAT_COMPLETIONS: OpenAI Chat Completions style.
 *  - CUSTOM: provider-specific style (PROPOSED; runtime HRP gate bind
 *    schema per provider).
 * ─────────────────────────────────────────────────────────────────────────── */
export const AI_PROVIDER_API_STYLES = [
  'RESPONSES',
  'CHAT_COMPLETIONS',
  'CUSTOM',
] as const;
export const AIProviderApiStyleSchema = z.enum(AI_PROVIDER_API_STYLES);

/* ───────────────────────────────────────────────────────────────────────────
 * Capability allowlist — feature flags cho provider.
 *
 * Schema bind shape CONFIRMED (allowlist); runtime gate quyết runtime
 * capability check.
 * ─────────────────────────────────────────────────────────────────────────── */
export const AI_PROVIDER_CAPABILITIES = [
  'CHAT',
  'EMBEDDINGS',
  'FUNCTION_CALLING',
  'STRUCTURED_OUTPUT',
  'STREAMING',
  'VISION',
  'TOOLS',
  'FILE_REFERENCES',
] as const;
export const AIProviderCapabilitySchema = z.enum(AI_PROVIDER_CAPABILITIES);

/* ───────────────────────────────────────────────────────────────────────────
 * Data policy — schema bind enum chính sách dữ liệu đầu vào/ra.
 *
 * Schema bind shape CONFIRMED:
 *  - NO_PII: provider KHÔNG được nhận PII; dữ liệu đi qua phải redacted.
 *  - PII_REDACTED: provider nhận dữ liệu đã redact.
 *  - INTERNAL_ONLY: provider ở internal network; không outbound public.
 *  - SANDBOX: provider sandbox mode (mock result, không side effect).
 *
 * PROPOSED (Owner/HRP domain): retention window / region / opt-out
 * metadata — runtime HRP-owned PR quyết.
 * ─────────────────────────────────────────────────────────────────────────── */
export const AI_PROVIDER_DATA_POLICIES = [
  'NO_PII',
  'PII_REDACTED',
  'INTERNAL_ONLY',
  'SANDBOX',
] as const;
export const AIProviderDataPolicySchema = z.enum(AI_PROVIDER_DATA_POLICIES);

/* ───────────────────────────────────────────────────────────────────────────
 * Secret reference — opaque, KHÔNG raw API key.
 *
 * Schema bind shape CONFIRMED:
 *  - SecretPort.resolve(secretRef) cấp secret ở runtime; contract chỉ
 *    bind reference opaque.
 *  - BACKLOG §0.3h SecretPort tier + KHÔNG expose rawSecret contract.
 * ─────────────────────────────────────────────────────────────────────────── */
export const SecretRefSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    /** Opaque ID — runtime SecretPort.resolve mới trả raw. */
    secretId: z.string().min(1).max(128),
    /** Version — runtime gate check secret rotation. */
    secretVersion: ExpectedVersionSchema,
    /**
     * TIER allowlist — KHÔNG tier nào cho phép caller đọc raw secret.
     */
    tier: z.enum(['PLATFORM', 'TENANT', 'OPERATOR']),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * Budget cap — giới hạn chi phí/số lượng request cho provider.
 *
 * Schema bind shape CONFIRMED (numerical bounds):
 *  - maxRequestsPerDay: ≥ 0; 0 = disabled.
 *  - maxTokensPerDay: ≥ 0; 0 = disabled.
 *  - maxCostPerDayUsdMicro: ≥ 0; micro USD (1 USD = 1e6). 0 = disabled.
 *
 * Runtime gate quyết policy enforce / reset cycle / burst protection.
 * ─────────────────────────────────────────────────────────────────────────── */
export const AIProviderBudgetSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    maxRequestsPerDay: z.number().int().nonnegative(),
    maxTokensPerDay: z.number().int().nonnegative(),
    maxCostPerDayUsdMicro: z.number().int().nonnegative(),
    /**
     * Burst protection window (giây). PROPOSED — runtime gate quyết
     * rolling/fixed window policy.
     */
    burstWindowSec: z.number().int().nonnegative().optional(),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * Write DTO — payload để tạo/cập nhật provider config.
 *
 * Schema bind shape CONFIRMED (Backlog §0.5 AC #5):
 *  - baseUrl, model, apiStyle required.
 *  - secretRef opaque (KHÔNG raw API key).
 *  - capabilities: subset của allowlist.
 *  - budget: AIProviderBudget required (có thể 0 = disabled).
 *  - dataPolicy: subset các policy enum.
 * ─────────────────────────────────────────────────────────────────────────── */
export const AIProviderConfigWriteSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    providerId: z.string().min(1).max(128),
    /** Display name — UI hiển thị. */
    displayName: z.string().min(1).max(256),
    baseUrl: z.string().url().max(2048),
    model: z.string().min(1).max(256),
    apiStyle: AIProviderApiStyleSchema,
    secretRef: SecretRefSchema,
    capabilities: z.array(AIProviderCapabilitySchema).max(16),
    budget: AIProviderBudgetSchema,
    dataPolicy: z.array(AIProviderDataPolicySchema).min(1).max(8),
    /**
     * Provider config version — server-set, monotonic tăng khi update.
     */
    configVersion: ExpectedVersionSchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    // SANDBOX thì KHÔNG cho phép INTERNAL_ONLY (chống nhầm).
    const hasSandbox = val.dataPolicy.includes('SANDBOX');
    const hasInternal = val.dataPolicy.includes('INTERNAL_ONLY');
    const hasNoPii = val.dataPolicy.includes('NO_PII');
    if (hasSandbox && hasInternal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SANDBOX + INTERNAL_ONLY là xung đột policy',
        path: ['dataPolicy'],
      });
    }
    // SANDBOX mode ở Gate 0: budget phải 0 (chỉ mock).
    if (hasSandbox && !val.budget.maxRequestsPerDay === false) {
      // Allow 0 (disabled) hoặc giá trị rất nhỏ (sandbox dev).
      if (val.budget.maxRequestsPerDay > 1000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'SANDBOX policy ở Gate 0 — budget request > 1000 chỉ runtime HRP chốt',
          path: ['budget', 'maxRequestsPerDay'],
        });
      }
    }
    // NO_PII thì KHÔNG kèm raw payload type — schema marker audit.
    if (hasNoPii && val.dataPolicy.includes('PII_REDACTED')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'NO_PII + PII_REDACTED xung đột (chọn 1)',
        path: ['dataPolicy'],
      });
    }
  });

/* ───────────────────────────────────────────────────────────────────────────
 * Read DTO — CHỈ dùng để hiển thị / audit.
 *
 * Owner chỉ thị (Backlog §0.5 AC #5): "Read DTO không chứa API key".
 * Schema bind shape CONFIRMED:
 *  - KHÔNG có field rawSecret / apiKey / accessKey / token.
 *  - SecretRef opaque — caller muốn gọi phải qua SecretPort.
 *  - Schema strict reject nếu caller cố chèn raw secret field.
 * ─────────────────────────────────────────────────────────────────────────── */
export const AIProviderConfigReadSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    providerId: z.string().min(1).max(128),
    displayName: z.string().min(1).max(256),
    baseUrl: z.string().url().max(2048),
    model: z.string().min(1).max(256),
    apiStyle: AIProviderApiStyleSchema,
    /** Opaque ref only — KHÔNG rawSecret ở read DTO. */
    secretRef: SecretRefSchema,
    capabilities: z.array(AIProviderCapabilitySchema).max(16),
    budget: AIProviderBudgetSchema,
    dataPolicy: z.array(AIProviderDataPolicySchema).min(1).max(8),
    configVersion: ExpectedVersionSchema,
    /** Audit timestamps. */
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

/* ───────────────────────────────────────────────────────────────────────────
 * AI provider config — forbid-list cho field raw secret / API key.
 *
 * Schema bind shape marker (Owner rev 2 — Q-30): marker KHÔNG tự chứng
 * minh AC enforce; runtime HRP gate enforce qua code review + lint +
 * integration test. Schema strict đã reject các field này nếu cố chèn
 * ở write/read DTO; list này audit cho runtime gate.
 * ─────────────────────────────────────────────────────────────────────────── */
export const AI_PROVIDER_FORBIDDEN_RAW_SECRET_FIELDS = Object.freeze([
  'apiKey',
  'accessKey',
  'secretKey',
  'bearerToken',
  'authorization',
  'x-api-key',
  'anthropicApiKey',
  'openaiApiKey',
  'rawSecret',
  'token',
  'password',
] as const);

export { SCHEMA_VERSION };
