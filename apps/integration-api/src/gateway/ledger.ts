/**
 * gateway/ledger.ts — In-memory call log cho mock.
 *
 * CORE/1.1 (Backlog §Task 1.1 AC #4 + Owner instruction):
 *  - Chứng minh no forbidden side effect; không fake merge/Worker/EFFECTIVE
 *    từ chat.
 *  - Limit rõ ràng: KHÔNG durable production; mất khi restart.
 *  - Khi retry/restart: log reset; caller dựa vào cache result (in-memory)
 *    để retry cùng key nhận cùng kết quả.
 *
 * T1 cố tình KHÔNG thêm Promise/queue/persistent layer; production HRP
 * implement runtime gate cùng transaction (Task 1.8 + Master V2.6 §9).
 */
import type { CallLogEntry, ScenarioId, HrpGatewayCallResult } from './types.js';
import type { HrpGatewayMethod, HrpGatewayTier } from '@hrp-engagement/contracts';

const DEFAULT_MAX_ENTRIES = 1024;

/**
 * Ring buffer — bounded để tránh memory leak trong long-running test.
 * Khi đầy, ghi đè entry cũ nhất.
 */
export class CallLedger {
  private readonly maxEntries: number;
  private readonly entries: CallLogEntry[] = [];
  private nextIndex = 0;
  private count = 0;

  constructor(opts?: { maxEntries?: number }) {
    this.maxEntries = opts?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  append(entry: CallLogEntry): void {
    if (this.entries.length < this.maxEntries) {
      this.entries.push(entry);
    } else {
      const idx = this.nextIndex % this.maxEntries;
      this.entries[idx] = entry;
      this.nextIndex = (this.nextIndex + 1) % this.maxEntries;
    }
    this.count += 1;
  }

  snapshot(): ReadonlyArray<CallLogEntry> {
    // Snapshot read-only — không xóa.
    return Object.freeze([...this.entries]);
  }

  /**
   * Cache result cho retry/idempotency.
   * Key: `${organizationId}:${commandName}:${idempotencyKey}`.
   * KHÔNG bao gồm correlationId (correlation là tracking, không dedupe).
   */
  private readonly resultCache = new Map<
    string,
    { payloadDigest: string; result: HrpGatewayCallResult; tier: HrpGatewayTier; method: HrpGatewayMethod }
  >();

  cacheKey(organizationId: string, commandName: string, idempotencyKey: string): string {
    return `${organizationId}:${commandName}:${idempotencyKey}`;
  }

  hasCache(key: string): boolean {
    return this.resultCache.has(key);
  }

  readCache(key: string): {
    payloadDigest: string;
    result: HrpGatewayCallResult;
    tier: HrpGatewayTier;
    method: HrpGatewayMethod;
  } | undefined {
    return this.resultCache.get(key);
  }

  writeCache(
    key: string,
    payloadDigest: string,
    result: HrpGatewayCallResult,
    tier: HrpGatewayTier,
    method: HrpGatewayMethod,
  ): void {
    this.resultCache.set(key, { payloadDigest, result, tier, method });
  }

  /** Test only — xóa toàn bộ log + cache. KHÔNG dùng ở production runtime. */
  reset(): void {
    this.entries.length = 0;
    this.resultCache.clear();
    this.nextIndex = 0;
    this.count = 0;
  }

  size(): { count: number; max: number; cache: number; totalAppends: number } {
    return {
      count: this.entries.length,
      max: this.maxEntries,
      cache: this.resultCache.size,
      totalAppends: this.count,
    };
  }
}

/** Build CallLogEntry từ inputs. */
export function buildLogEntry(input: {
  scenarioId: ScenarioId;
  method: HrpGatewayMethod;
  tier: HrpGatewayTier;
  organizationId: string;
  commandId: string;
  idempotencyKey: string;
  correlationId: string;
  actorKind: string;
  provider: string | undefined;
  payloadDigest: string;
  nowEpochMs: number;
  result: HrpGatewayCallResult;
  cacheHit: boolean;
  idempotencyConflict: boolean;
}): CallLogEntry {
  const outcome: CallLogEntry['outcomeStatus'] =
    input.result.status === 'ACCEPTED'
      ? 'ACCEPTED'
      : input.result.status === 'APPLIED'
        ? 'APPLIED'
        : 'FAILED';

  const entry: CallLogEntry = {
    scenarioId: input.scenarioId,
    method: input.method,
    tier: input.tier,
    organizationId: input.organizationId,
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    actorKind: input.actorKind,
    provider: input.provider,
    payloadDigest: input.payloadDigest,
    nowEpochMs: input.nowEpochMs,
    outcomeStatus: outcome,
    cacheHit: input.cacheHit,
    idempotencyConflict: input.idempotencyConflict,
  };
  if (input.result.status === 'FAILED' && input.result.errors[0]) {
    return { ...entry, outcomeErrorCode: input.result.errors[0].code };
  }
  return entry;
}
