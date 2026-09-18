/**
 * gateway/types.ts — Type contracts cho CanonicalHrpGateway deterministic mock.
 *
 * CORE/1.1 (Backlog §Task 1.1):
 *  - Injectable clock/IDs/scenarios để test deterministic.
 *  - Same (idempotencyKey, payloadDigest) → same result.
 *  - Khác payload (same key) → IDEMPOTENCY_CONFLICT.
 *  - correlationId tracking; KHÔNG nhầm với idempotencyKey.
 *
 * Pin contracts 0.0.8-g0.8-fixes (Gate 0 freeze). KHÔNG sửa contracts.
 *
 * Mock này KHÔNG phải implementation production HRP. Chỉ là scenario
 * simulation cho mock API path. Privileged merge capability, EFFECTIVE,
 * Client domain, managed modes (Q-19/33/34/37/23) vẫn PROPOSED/UNAVAILABLE
 * trong scenarios — không fake success.
 */
import { z } from 'zod';
import {
  SCHEMA_VERSION,
  MatchingOutcomeSchema,
  type MatchingOutcome,
  type AcceptedResponse,
} from '@hrp-engagement/contracts';
import {
  CommandIdSchema,
  IdempotencyKeySchema,
  OrganizationIdSchema,
  SchemaVersionSchema,
  ActorSchema,
} from '@hrp-engagement/contracts';
import {
  HrpGatewayMethodSchema,
  HrpGatewayTierSchema,
  HrpGatewayCallContextSchema,
  type HrpGatewayMethod,
  type HrpGatewayTier,
  type HrpGatewayCallContext,
} from '@hrp-engagement/contracts';
import {
  AcceptedResponseSchema,
  OperationReferenceSchema,
  ErrorCodeSchema,
  type ContractError,
} from '@hrp-engagement/contracts';

/* ───────────────────────────────────────────────────────────────────────────
 * Scenario ID — phân loại deterministic outcome theo fixture/clock.
 * ─────────────────────────────────────────────────────────────────────────── */
export const SCENARIO_IDS = [
  'EXACT_MATCH_SUCCESS',
  'POSSIBLE_MATCH_REVIEW',
  'NEW_PROFILE_CREATED',
  'TIMEOUT_BEFORE_APPLY',
  'TIMEOUT_AFTER_APPLY',
  'PERMISSION_DENIED',
  'POLICY_REJECTION',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'MALFORMED_DEPENDENCY_RESPONSE',
  'ONE_ACTIVE_CASE',
  'CLOSED_CASE_SUCCESS',
  'DNC_REJECTED',
  'SUPPRESSION_REQUIRED',
  'PLACEMENT_PROPOSED',
  'OUTBOX_RECEIPT_DURABLE',
  'DEPENDENCY_UNAVAILABLE',
  'RATE_LIMITED',
] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];
export const ScenarioIdSchema = z.enum(SCENARIO_IDS);

/**
 * HrpGatewayCallRequest — request shape từ mock caller.
 *
 * Trim tối thiểu so với contracts: caller chỉ cần method + payload + context
 * + scenarioId (chọn fixture) + idempotencyKey. Correlation là tracking;
 * idempotencyKey mới dedupe.
 */
export const HrpGatewayCallRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    organizationId: OrganizationIdSchema,
    commandId: CommandIdSchema,
    idempotencyKey: IdempotencyKeySchema,
    correlationId: z.string().min(8).max(128),
    method: HrpGatewayMethodSchema,
    context: HrpGatewayCallContextSchema,
    actor: ActorSchema,
    /**
     * Scenario ID chọn trước — quyết định outcome deterministic.
     * Caller-set; mock KHÔNG tự xây identity/domain policy.
     */
    scenarioId: ScenarioIdSchema,
    /** Payload theo method — chỉ validate shape strict, KHÔNG áp policy thật. */
    payload: z.unknown(),
  })
  .strict();
export type HrpGatewayCallRequest = z.infer<typeof HrpGatewayCallRequestSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * Result shape theo contracts: ACCEPTED/APPLIED/FAILED.
 * ACCEPTED: idempotent retry queue chưa commit; có operation ref.
 * APPLIED: data + version.
 * FAILED: errors (không có data hữu dụng).
 * ─────────────────────────────────────────────────────────────────────────── */
export const AcceptedResponseShapeSchema = AcceptedResponseSchema;
export type AcceptedResponseShape = AcceptedResponse;
/** Re-export OperationReferenceSchema from contracts (frozen). */
export { OperationReferenceSchema };

export const AppliedResponseShapeSchema = z
  .object({
    status: z.literal('APPLIED'),
    schemaVersion: SchemaVersionSchema,
    commandId: CommandIdSchema,
    correlationId: z.string().min(8).max(128),
    data: z.unknown(),
    errors: z.tuple([]),
  })
  .strict();
export type AppliedResponseShape = z.infer<typeof AppliedResponseShapeSchema>;

export const FailedResponseShapeSchema = z
  .object({
    status: z.literal('FAILED'),
    schemaVersion: SchemaVersionSchema,
    commandId: CommandIdSchema,
    correlationId: z.string().min(8).max(128),
    errors: z
      .array(
        z
          .object({
            code: ErrorCodeSchema,
            messageKey: z.string(),
            retryClass: z.string(),
            fieldPath: z.string().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(64),
  })
  .strict();
export type FailedResponseShape = z.infer<typeof FailedResponseShapeSchema>;

// Tại sao KHÔNG dùng `z.discriminatedUnion('status', [...])` ở đây:
//   Zod 3.24.2 `discriminatedUnion.create()` (xem node_modules/zod/lib/index.mjs:3038)
//   trích literal bằng `getDiscriminator(type.shape[discriminator])`. Với schema
//   đã `.strict()` (vd `AcceptedResponseSchema` từ contracts freeze), `_def.shape`
//   là **function** (lazy getter), KHÔNG phải plain object — nên
//   `function['status']` trả về `undefined`, getDiscriminator rơi về `else { return []; }`,
//   và DU throw `A discriminator value for key 'status' could not be extracted`.
//   Zod 3.24.2 chỉ gọi function `_def.shape()` cho ZodEffects (line 2940),
//   không phải ZodObject. Vì `AcceptedResponseSchema` là ZodObject strict, nó
//   rơi vào nhánh `else { return []; }` (line 2973+) và không được unwrap.
//
// Hệ quả: HrpGatewayCallResultSchema ở đây CHỈ là internal validator của
// mock layer (không nằm trong contracts freeze). Mock không được phép tự ý
// rebuild field-by-field của AcceptedResponseSchema vì sẽ drift khỏi freeze.
// Giải pháp an toàn nhất là `z.union([AcceptedShape, AppliedShape, FailedShape])`
// — vẫn strict, vẫn dùng nguyên schema từ contracts, runtime duyệt từng
// option (không optimize như DU nhưng behavior tương đương về validation).
export const HrpGatewayCallResultSchema = z.union([
  AcceptedResponseShapeSchema,
  AppliedResponseShapeSchema,
  FailedResponseShapeSchema,
]);
export type HrpGatewayCallResult = z.infer<typeof HrpGatewayCallResultSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * Injected infrastructure.
 * ─────────────────────────────────────────────────────────────────────────── */
export type NowProvider = () => number;

/** ScenarioFixture — outcome shape cho 1 scenario. */
export interface ScenarioFixture {
  readonly id: ScenarioId;
  /** Tier nào được phép chạy scenario. */
  readonly allowedTiers: ReadonlyArray<HrpGatewayTier>;
  /** Method nào áp dụng. */
  readonly allowedMethods: ReadonlyArray<HrpGatewayMethod>;
  /** Outcome mode. */
  readonly outcome: 'APPLIED' | 'ACCEPTED' | 'FAILED';
  /** Data payload nếu APPLIED — caller đọc `data.matchingOutcome` để biết EXACT/POSSIBLE/NEW. */
  readonly data?: unknown;
  /** Error code nếu FAILED. */
  readonly errorCode?: ContractError['code'];
  /** Timeout nếu TIMEOUT_BEFORE_APPLY / TIMEOUT_AFTER_APPLY. */
  readonly latencyMs?: number;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Mock config — what tests/CI pass in.
 * ─────────────────────────────────────────────────────────────────────────── */
export interface MockGatewayOptions {
  /** Injectable clock — default `(Date.now)` returns zero for tests. */
  now?: NowProvider;
  /** Optional seed for any random/id-gen (mock không dùng Math.random). */
  seed?: string;
}

export interface MockGateway {
  call(req: HrpGatewayCallRequest, opts?: MockGatewayOptions): Promise<HrpGatewayCallResult>;
  /** Snapshot call log (read-only — không xoá). */
  readLog(): ReadonlyArray<CallLogEntry>;
  /** Reset ledger + cache (test only). */
  reset(): void;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Call log entry — chứng minh no forbidden side effect.
 * ─────────────────────────────────────────────────────────────────────────── */
export interface CallLogEntry {
  readonly scenarioId: ScenarioId;
  readonly method: HrpGatewayMethod;
  readonly tier: HrpGatewayTier;
  readonly organizationId: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly actorKind: string;
  readonly provider: string | undefined;
  readonly payloadDigest: string;
  readonly nowEpochMs: number;
  readonly outcomeStatus: 'ACCEPTED' | 'APPLIED' | 'FAILED';
  readonly outcomeErrorCode?: ContractError['code'];
  /** True nếu cached result trả về (same key+payload). */
  readonly cacheHit: boolean;
  /** True nếu same key + different payload → IDEMPOTENCY_CONFLICT detect. */
  readonly idempotencyConflict: boolean;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Matching outcome data shape — chỉ valid khi method = createOrMatchLaborProfile.
 * ─────────────────────────────────────────────────────────────────────────── */
export const CreateOrMatchResultDataSchema = z
  .object({
    matchingOutcome: MatchingOutcomeSchema,
    /** Canonical profile id — chỉ có khi EXACT_MATCH / NEW_PROFILE. */
    laborProfileId: z.string().min(1).max(128).optional(),
    /** Version — tăng đơn vị mỗi call (deterministic theo call count). */
    version: z.number().int().nonnegative().optional(),
    /** Review reference khi POSSIBLE_MATCH — không có target mutation hợp lệ. */
    reviewRef: z.string().min(1).max(128).optional(),
  })
  .strict();
export type CreateOrMatchResultData = z.infer<
  typeof CreateOrMatchResultDataSchema
>;

/* ───────────────────────────────────────────────────────────────────────────
 * One-active-case data shape — scenario simulation, KHÔNG bằng chứng concurrency.
 * ─────────────────────────────────────────────────────────────────────────── */
export const OneActiveCaseDataSchema = z
  .object({
    matchingOutcome: MatchingOutcomeSchema,
    laborProfileId: z.string().min(1).max(128),
    activeCaseId: z.string().min(1).max(128),
    note: z.literal('SCENARIO_SIMULATION_NOT_CONCURRENCY_PROOF'),
  })
  .strict();
export type OneActiveCaseData = z.infer<typeof OneActiveCaseDataSchema>;

export { SCHEMA_VERSION };
