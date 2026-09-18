/**
 * integration-api/src/receiver/handler.ts — CORE/1.2
 *
 * Inbound webhook HTTP handler. **202 chỉ sau durable commit**.
 *
 * Pipeline (strictly ordered):
 *  1. Body size limit (`HRP_RECEIVER_MAX_BODY_BYTES`, default 256KB).
 *  2. Scope verify from URL path (path shape only; registry resolves).
 *  3. **Connection registry lookup** — fail-before-persist on unknown
 *     connection (Auditor F1).
 *  4. HMAC signature verify with **registry-pinned algorithm** (Auditor F2).
 *  5. Protocol fixture parse (Auditor F3 — stable event identity).
 *  6. Body scope-spoof detection (audit only; server không tin body).
 *  7. Atomic commitReceiptWithIntents (CORE/1.3).
 *  8. Return 202 ONLY if commit succeeded.
 *
 * Failure modes:
 *  - Size > limit → 413 Payload Too Large.
 *  - Rate limit exceeded → 429 Too Many Requests.
 *  - Bad scope → 400.
 *  - Unknown connection / scope mismatch → 400 (fail-before-persist).
 *  - HMAC fail / algorithm mismatch → 401.
 *  - Parse fail / missing stable eventId → 400.
 *  - Body scope spoof → 400 (defense in depth).
 *  - Idempotency conflict → 409.
 *  - DB unavailable → 503.
 *
 * Recovery (Backlog §Task 1.2):
 *  - Receiver crash sau commit trước khi gửi 202 → provider retry →
 *    commitReceiptWithIntents returns `created: false` (idempotent).
 *    → 202 vẫn OK.
 *  - Receiver crash trước commit → DB không có gì → provider retry from
 *    scratch (acceptable).
 *
 * Rate map (Auditor note):
 *  - Only registry-verified connections get into rateMap.
 *  - Unknown / unverified connections are NEVER inserted → no unbounded
 *    growth from spoofed scopes.
 *  - Max entries + idle TTL to prevent drift.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PrismaClient } from '@prisma/client';

import { WebhookReceiverRequestSchema, type WebhookReceiverVerified } from '@hrp-engagement/contracts';

import { verifyScopeFromPath, detectBodyScopeSpoof } from './scope-verify.js';
import { parseProviderFixture } from './protocol-fixture.js';
import { verifyHmacSignature } from './hmac-verify.js';
import { ConnectionRegistry } from './connection-registry.js';
import { commitWebhookReceipt } from './dedupe.js';
import type { AckResponse } from './ack.js';

/** Receiver-level config (parsed from env). */
export interface ReceiverConfig {
  maxBodyBytes: number;
  rateLimitPerMinute: number;
  /** Whether receiver is enabled at all (false in CORE/1.0 mock mode). */
  enabled: boolean;
  /** Per-connection rate map idle eviction TTL (ms). */
  rateMapIdleEvictionMs: number;
  /** Max entries trong rate map (LRU eviction khi vượt). */
  rateMapMaxEntries: number;
}

/** Per-connection rate-limit state (in-memory sliding window). */
interface RateState {
  windowStartMs: number;
  count: number;
  /** Last hit timestamp — used cho idle TTL eviction. */
  lastHitMs: number;
}

export class Receiver {
  private readonly rateMap = new Map<string, RateState>();
  constructor(
    private readonly prisma: PrismaClient | null,
    private readonly config: ReceiverConfig,
    private readonly registry: ConnectionRegistry,
  ) {}

  /**
   * Handle a POST /webhooks/:organizationId/:provider/:connectionId.
   * Returns true if handled; false if route mismatch (caller continues).
   */
  async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    pathSegments: string[],
    bodyBytes: Uint8Array,
  ): Promise<boolean> {
    if (pathSegments[0] !== 'webhooks') return false;
    if (req.method !== 'POST') {
      this.respond(res, 405, {
        status: 'rejected',
        code: 'method_not_allowed',
        message: 'POST only',
        retryable: false,
      });
      return true;
    }
    if (!this.config.enabled) {
      this.respond(res, 503, {
        status: 'rejected',
        code: 'receiver_disabled',
        message: 'Receiver chưa được enable ở CORE/1.2 runtime config',
        retryable: false,
      });
      return true;
    }

    const [, organizationIdRaw, providerRaw, connectionIdRaw] = pathSegments;
    const scopeResult = verifyScopeFromPath({
      organizationIdRaw,
      providerRaw,
      connectionIdRaw,
    });
    if (!scopeResult.ok) {
      this.respond(res, 400, {
        status: 'rejected',
        code: scopeResult.code,
        message: scopeResult.message,
        retryable: false,
      });
      return true;
    }
    const scope = {
      organizationId: scopeResult.organizationId,
      provider: scopeResult.provider,
      connectionId: scopeResult.connectionId,
    };

    // 1. Size limit
    if (bodyBytes.byteLength > this.config.maxBodyBytes) {
      this.respond(res, 413, {
        status: 'rejected',
        code: 'payload_too_large',
        message: `Body ${bodyBytes.byteLength}B vượt maxBodyBytes=${this.config.maxBodyBytes}`,
        retryable: false,
      });
      return true;
    }

    // 2. Registry lookup (Auditor F1 — fail-before-persist on unknown connection).
    const resolved = this.registry.resolve(scope);
    if (!resolved.ok) {
      // Unknown connection → no rate map insert (Auditor: không đưa connection
      // chưa xác minh vào map không giới hạn).
      this.respond(res, 400, {
        status: 'rejected',
        code: resolved.code,
        message: resolved.message,
        retryable: false,
      });
      return true;
    }
    const connection = resolved.entry;

    // 3. Rate limit (in-memory sliding window per connection).
    // Registry-verified → safe to insert.
    const rateKey = `${scope.organizationId}:${scope.provider}:${scope.connectionId}`;
    const rateResult = this.checkRateLimit(rateKey, this.config.rateLimitPerMinute);
    if (!rateResult.allowed) {
      this.respond(res, 429, {
        status: 'rejected',
        code: 'rate_limit_exceeded',
        message: `Connection vượt ${this.config.rateLimitPerMinute} req/min (window reset ${Math.ceil(rateResult.retryAfterMs / 1000)}s)`,
        retryable: true,
      });
      return true;
    }

    // 4. HMAC verify với registry-pinned algorithm (Auditor F2).
    const headers = readHeadersLowerCase(req);
    const hmacResult = verifyHmacSignature({
      rawBody: bodyBytes,
      headers,
      provider: scope.provider,
      pinnedAlgorithm: connection.algorithm,
      secret: connection.secret,
    });
    if (!hmacResult.ok) {
      this.respond(res, 401, {
        status: 'rejected',
        code: hmacResult.reason,
        message: hmacResult.message,
        retryable: false,
      });
      return true;
    }

    // 5. Parse provider fixture (Auditor F3 — stable event identity).
    const parseResult = parseProviderFixture(scope.provider, bodyBytes);
    if (!parseResult.ok) {
      this.respond(res, 400, {
        status: 'rejected',
        code: parseResult.code,
        message: parseResult.message,
        retryable: false,
      });
      return true;
    }

    // 6. Body scope spoof detection (defense in depth).
    const spoof = detectBodyScopeSpoof({
      parsedBody: parseResult.parsedBody,
      expectedScope: scope,
    });
    if (spoof.spoofed) {
      this.respond(res, 400, {
        status: 'rejected',
        code: 'body_scope_spoof',
        message: `Body chứa scope khác path: field=${spoof.mismatchedField}. Server chỉ tin URL path.`,
        retryable: false,
      });
      return true;
    }

    if (!this.prisma) {
      this.respond(res, 503, {
        status: 'rejected',
        code: 'store_unavailable',
        message: 'Prisma client not configured; CORE/1.2 receiver cần DATABASE_URL để ACK sau durable commit.',
        retryable: true,
      });
      return true;
    }

    // 7. Atomic commit. 202 chỉ trên success.
    const correlationId =
      parseResult.correlationId ??
      `recv-${parseResult.eventId}-${Date.now().toString(36)}`;

    const commitResult = await commitWebhookReceipt({
      prisma: this.prisma,
      scope,
      parse: parseResult,
      rawBody: bodyBytes,
      correlationId,
    });

    if (!commitResult.ok) {
      if (commitResult.code === 'idempotency_conflict') {
        this.respond(res, 409, {
          status: 'rejected',
          code: 'idempotency_conflict',
          message: commitResult.message,
          retryable: false,
        });
        return true;
      }
      if (commitResult.code === 'scope_mismatch') {
        this.respond(res, 400, {
          status: 'rejected',
          code: 'scope_mismatch',
          message: commitResult.message,
          retryable: false,
        });
        return true;
      }
      this.respond(res, 503, {
        status: 'rejected',
        code: 'store_unavailable',
        message: commitResult.message,
        retryable: true,
      });
      return true;
    }

    // 8. Durable commit OK → 202.
    this.respond(res, 202, {
      status: 'accepted',
      receiptId: commitResult.receiptId,
      intentIds: commitResult.intentIds,
      created: commitResult.created,
      payloadDigest: commitResult.payloadDigest,
      eventIdSource: parseResult.eventIdSource,
    });
    return true;
  }

  /**
   * Build a `WebhookReceiverVerified` object từ internal state.
   * Hữu ích cho tests / introspection.
   */
  static buildVerified(
    scope: { organizationId: string; provider: string; connectionId: string },
    algorithm: 'HMAC_SHA256' | 'HMAC_SHA512',
    parsedBody: unknown,
    verifiedAt: string,
  ): WebhookReceiverVerified {
    const request: WebhookReceiverVerified = {
      schemaVersion: '1',
      organizationId: scope.organizationId,
      provider: scope.provider,
      connectionId: scope.connectionId,
      algorithm,
      verifiedAt,
      parsedBody,
    };
    WebhookReceiverRequestSchema;
    return request;
  }

  /**
   * Token bucket rate limiter (in-memory). Idle TTL eviction + max entries
   * to prevent unbounded growth. Only registry-verified connections reach
   * here, so unverified scopes don't grow the map.
   */
  private checkRateLimit(
    key: string,
    limitPerMinute: number,
  ): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    const windowMs = 60_000;

    // Idle TTL eviction sweep (cheap; only over keys in map).
    this.evictIdle(now);

    const state = this.rateMap.get(key);
    if (!state || now - state.windowStartMs >= windowMs) {
      // Insert (after cap check).
      this.insertWithCap(key, { windowStartMs: now, count: 1, lastHitMs: now });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (state.count >= limitPerMinute) {
      const retryAfterMs = windowMs - (now - state.windowStartMs);
      return { allowed: false, retryAfterMs };
    }
    state.count += 1;
    state.lastHitMs = now;
    return { allowed: true, retryAfterMs: 0 };
  }

  private insertWithCap(key: string, value: RateState): void {
    if (!this.rateMap.has(key) && this.rateMap.size >= this.config.rateMapMaxEntries) {
      // LRU eviction: drop the entry with smallest lastHitMs.
      let oldestKey: string | null = null;
      let oldestHit = Number.POSITIVE_INFINITY;
      for (const [k, v] of this.rateMap) {
        if (v.lastHitMs < oldestHit) {
          oldestHit = v.lastHitMs;
          oldestKey = k;
        }
      }
      if (oldestKey !== null) this.rateMap.delete(oldestKey);
    }
    this.rateMap.set(key, value);
  }

  private evictIdle(now: number): void {
    const ttl = this.config.rateMapIdleEvictionMs;
    if (ttl <= 0) return;
    for (const [k, v] of this.rateMap) {
      if (now - v.lastHitMs >= ttl) this.rateMap.delete(k);
    }
  }

  /**
   * Test/inspection helper: current rate map size.
   */
  rateMapSize(): number {
    return this.rateMap.size;
  }

  private respond(
    res: ServerResponse,
    status: number,
    body: AckResponse | { status: string; code: string; message: string; retryable: boolean } | Record<string, unknown>,
  ): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  }
}

function readHeadersLowerCase(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') {
      out[k.toLowerCase()] = v;
    } else if (Array.isArray(v)) {
      out[k.toLowerCase()] = v.join(',');
    }
  }
  return out;
}
