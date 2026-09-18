/**
 * gateway/mock-gateway.ts — Deterministic CanonicalHrpGateway mock.
 *
 * CORE/1.1 (Backlog §Task 1.1):
 *  - Cùng (idempotencyKey, payloadDigest) → cùng result (cache).
 *  - Khác payload (cùng key) → IDEMPOTENCY_CONFLICT.
 *  - Khác key (cùng payload) → 2 call độc lập, không cache nhầm.
 *  - correlationId KHÔNG tham gia cache/dedupe — chỉ là tracking.
 *  - Inject clock; scenario + clock + idempotencyKey + payloadDigest →
 *    deterministic.
 *  - Privileged merge capability giữ capability check (tier × method):
 *    INBOUND_DEFAULT không chạy merge/resolve methods.
 *
 * Giới hạn (Owner instruction):
 *  - In-memory ledger: KHÔNG durable production; restart mất log.
 *  - One-active-case là SCENARIO SIMULATION; không phải concurrency proof.
 *  - EFFECTIVE/Client domain/managed modes vẫn PROPOSED — không fake.
 *  - Math.random KHÔNG dùng; id deterministic từ scenario + clock + count.
 */
import { createHash } from 'node:crypto';
import {
  type HrpGatewayMethod,
  type HrpGatewayTier,
} from '@hrp-engagement/contracts';
import { makeError } from '@hrp-engagement/contracts';
import { SCENARIOS } from './scenarios.js';
import { CallLedger, buildLogEntry } from './ledger.js';
import {
  type HrpGatewayCallRequest,
  type HrpGatewayCallResult,
  type MockGateway,
  type MockGatewayOptions,
  type ScenarioId,
} from './types.js';

/**
 * Canonical JSON cho payload — same shape với envelopes.canonicalize
 * nhưng chỉ dùng cho digest ở runtime mock.
 *
 * Sort key để digest ổn định dù thứ tự property khác nhau.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number không hỗ trợ');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // Skip undefined values (treat as missing) — matches JSON.stringify behavior.
    const keys = Object.keys(record).filter((k) => record[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
  }
  throw new TypeError('giá trị không biểu diễn được bằng canonical JSON');
}

export function payloadDigest(payload: unknown): string {
  const bytes = Buffer.from(canonicalJson(payload), 'utf8');
  return createHash('sha256').update(bytes).digest('hex');
}

/* ───────────────────────────────────────────────────────────────────────────
 * Capability matrix — chặn tier × method không hợp lệ.
 * ─────────────────────────────────────────────────────────────────────────── */

const PRIVILEGED_METHODS = new Set([
  'mergeLaborProfiles',
  'resolvePossibleMatch',
  'commitReviewDecision',
  'supersedeReviewStatus',
]);

function checkCapability(
  method: HrpGatewayMethod,
  tier: HrpGatewayTier,
): { ok: true } | { ok: false; error: 'FORBIDDEN' | 'POLICY_REJECTION' } {
  if (PRIVILEGED_METHODS.has(method)) {
    if (tier !== 'PRIVILEGED_MERGE') {
      return { ok: false, error: 'FORBIDDEN' };
    }
  }
  return { ok: true };
}

/* ───────────────────────────────────────────────────────────────────────────
 * Apply scenario → result.
 * ─────────────────────────────────────────────────────────────────────────── */

function applyScenario(
  req: HrpGatewayCallRequest,
  scenarioId: ScenarioId,
  idGen: () => string,
  now: () => number,
): HrpGatewayCallResult {
  const fixture = SCENARIOS[scenarioId];

  if (!fixture.allowedTiers.includes(req.context.tier)) {
    return failed(req, 'FORBIDDEN');
  }
  if (!fixture.allowedMethods.includes(req.method)) {
    return failed(req, 'POLICY_REJECTION');
  }

  switch (fixture.outcome) {
    case 'APPLIED': {
      return {
        status: 'APPLIED',
        schemaVersion: req.schemaVersion,
        commandId: req.commandId,
        correlationId: req.correlationId,
        data: fixture.data ?? {},
        errors: [],
      };
    }
    case 'ACCEPTED': {
      const operationId = idGen();
      return {
        status: 'ACCEPTED',
        schemaVersion: req.schemaVersion,
        commandId: req.commandId,
        correlationId: req.correlationId,
        operation: {
          kind: 'COMMAND_OPERATION',
          operationId,
        },
        errors: [],
      };
    }
    case 'FAILED': {
      return failed(req, fixture.errorCode ?? 'UNKNOWN_COMMAND_OUTCOME');
    }
  }
}

function failed(req: HrpGatewayCallRequest, code: Parameters<typeof makeError>[0]): HrpGatewayCallResult {
  const error = makeError(code);
  return {
    status: 'FAILED',
    schemaVersion: req.schemaVersion,
    commandId: req.commandId,
    correlationId: req.correlationId,
    errors: [error],
  };
}

/* ───────────────────────────────────────────────────────────────────────────
 * Mock implementation.
 * ─────────────────────────────────────────────────────────────────────────── */

export function createMockGateway(opts?: {
  ledger?: CallLedger;
  now?: () => number;
  idGen?: () => string;
}): MockGateway {
  const ledger = opts?.ledger ?? new CallLedger();
  // Deterministic ID generator — counter + clock + scenario.
  let counter = 0;
  const now = opts?.now ?? (() => Date.now());
  const idGen = opts?.idGen ?? (() => {
    counter += 1;
    const n = now();
    return `op-${n.toString(36)}-${counter.toString(36)}`;
  });

  return {
    async call(req: HrpGatewayCallRequest, callOpts?: MockGatewayOptions): Promise<HrpGatewayCallResult> {
      // 1. Validate request shape (strict).
      const digest = payloadDigest(req.payload);
      const cacheKey = ledger.cacheKey(
        req.organizationId,
        req.method,
        req.idempotencyKey,
      );

      // 2. Check capability (tier × method).
      const cap = checkCapability(req.method, req.context.tier);
      if (!cap.ok) {
        const result = failed(req, cap.error);
        ledger.append(buildLogEntry({
          scenarioId: req.scenarioId,
          method: req.method,
          tier: req.context.tier,
          organizationId: req.organizationId,
          commandId: req.commandId,
          idempotencyKey: req.idempotencyKey,
          correlationId: req.correlationId,
          actorKind: req.actor.kind,
          provider: req.context.provider,
          payloadDigest: digest,
          nowEpochMs: (callOpts?.now ?? now)(),
          result,
          cacheHit: false,
          idempotencyConflict: false,
        }));
        return result;
      }

      // 3. Cache hit?
      const cached = ledger.readCache(cacheKey);
      if (cached) {
        if (cached.payloadDigest === digest && cached.method === req.method && cached.tier === req.context.tier) {
          // Same key + same payload + same method + same tier → same result.
          const result = cached.result;
          ledger.append(buildLogEntry({
            scenarioId: req.scenarioId,
            method: req.method,
            tier: req.context.tier,
            organizationId: req.organizationId,
            commandId: req.commandId,
            idempotencyKey: req.idempotencyKey,
            correlationId: req.correlationId,
            actorKind: req.actor.kind,
            provider: req.context.provider,
            payloadDigest: digest,
            nowEpochMs: (callOpts?.now ?? now)(),
            result,
            cacheHit: true,
            idempotencyConflict: false,
          }));
          return result;
        }
        // Same key + different payload → IDEMPOTENCY_CONFLICT.
        const result = failed(req, 'IDEMPOTENCY_CONFLICT');
        ledger.append(buildLogEntry({
          scenarioId: req.scenarioId,
          method: req.method,
          tier: req.context.tier,
          organizationId: req.organizationId,
          commandId: req.commandId,
          idempotencyKey: req.idempotencyKey,
          correlationId: req.correlationId,
          actorKind: req.actor.kind,
          provider: req.context.provider,
          payloadDigest: digest,
          nowEpochMs: (callOpts?.now ?? now)(),
          result,
          cacheHit: false,
          idempotencyConflict: true,
        }));
        return result;
      }

      // 4. Apply scenario.
      const result = applyScenario(req, req.scenarioId, idGen, callOpts?.now ?? now);

      // 5. Cache (chỉ cache APPLIED/ACCEPTED — FAILED có thể retry với payload khác).
      if (result.status === 'APPLIED' || result.status === 'ACCEPTED') {
        ledger.writeCache(cacheKey, digest, result, req.context.tier, req.method);
      }

      // 6. Latency simulation (setTimeout, không block). Đảm bảo Promise resolve
      // sau latencyMs để test TIMEOUT_BEFORE_APPLY có thể observe.
      const fixture = SCENARIOS[req.scenarioId];
      if (fixture.latencyMs && fixture.latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, fixture.latencyMs));
      }

      // 7. Append log.
      ledger.append(buildLogEntry({
        scenarioId: req.scenarioId,
        method: req.method,
        tier: req.context.tier,
        organizationId: req.organizationId,
        commandId: req.commandId,
        idempotencyKey: req.idempotencyKey,
        correlationId: req.correlationId,
        actorKind: req.actor.kind,
        provider: req.context.provider,
        payloadDigest: digest,
        nowEpochMs: (callOpts?.now ?? now)(),
        result,
        cacheHit: false,
        idempotencyConflict: false,
      }));

      return result;
    },

    readLog() {
      return ledger.snapshot();
    },

    reset() {
      ledger.reset();
      counter = 0;
    },
  };
}
