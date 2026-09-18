/**
 * integration-api/src/receiver/protocol-fixture.ts — CORE/1.2
 *
 * Protocol fixture cho inbound webhook receiver. **CÔ LẬP** — chỉ phục vụ
 * test/dev; KHÔNG tuyên bố đã xác minh Zalo OA / Chatwoot thật.
 *
 * Per Owner brief + Backlog §Task 1.2 AC:
 *  - "Protocol fixture cô lập, không tuyên bố đã xác minh Zalo/Chatwoot thật."
 *  - "Mock verify không tuyên bố xác thực Zalo thật."
 *  - Response ACK của provider thật cần adapter protocol xác minh ở V7.9b/c.
 *
 * Per Owner brief + Auditor F3 (CORE/1.2 CHANGES_REQUIRED):
 *  - KHÔNG dùng riêng messageId / traceId làm eventId.
 *  - Phân biệt eventType và từng occurrence/revision nếu cùng loại event
 *    có thể lặp trên cùng message.
 *  - eventType + messageId chỉ đủ khi fixture contract bảo đảm uniqueness.
 *    Thiếu thành phần nhận dạng ổn định thì reject rõ, không tự đoán.
 *  - KHÔNG dùng receipt time/random hoặc payload hash làm cách né conflict.
 *
 * Stable identity policy per provider:
 *  - CHATWOOT:
 *      Primary: top-level `id` (synthetic — đại diện cho event occurrence id
 *               provider gán per-event).
 *      Fallback: `event_id`.
 *      BỎ `message.id` (không stable across multiple events trên cùng
 *               message — cùng message có thể fire message_created,
 *               message_updated, message_deleted với các event id khác nhau).
 *  - ZALO_OA:
 *      Primary: `event_id`.
 *      Fallback: `message_id` (Zalo OA mỗi delivery có message_id stable;
 *               cùng message có thể trigger event khác nhau nhưng fixture
 *               contract giả định 1 event_id per delivery).
 *  - GENERIC:
 *      Primary: `event_id` hoặc `eventId`.
 *      Fallback: `id` (numeric hoặc string ≥8 chars).
 *      BỎ `trace_id` (tracing id per-request, không stable per-event).
 *
 * Nếu tất cả stable fields missing → reject `missing_event_id` (KHÔNG đoán).
 */

import { createHash } from 'node:crypto';

/** Provider names supported in CORE/1.2 fixture. */
export const SUPPORTED_PROVIDERS = ['CHATWOOT', 'ZALO_OA', 'GENERIC'] as const;
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

export type ParseResult =
  | {
      ok: true;
      eventType: string;
      /** Canonical eventId (dedupe key input). Stable per occurrence. */
      eventId: string;
      /** When eventId came from fallback (not primary field). Documented. */
      eventIdSource: 'primary' | 'fallback';
      /** Optional correlation id for downstream tracing. */
      correlationId?: string;
      /** Parsed JSON for downstream normalize (CORE/1.5). */
      parsedBody: unknown;
    }
  | {
      ok: false;
      code:
        | 'malformed_json'
        | 'unsupported_provider'
        | 'missing_event_id'
        | 'unsupported_event_type';
      message: string;
    };

/**
 * Documented stable event-id policy per provider.
 * Order matters: thử primary trước, rồi fallback. BỎ qua các field không
 * ổn định giữa các occurrence (message.id, trace_id).
 *
 * CHATWOOT:
 *  - Primary: top-level `id` (synthetic event occurrence id; có thể
 *    string hoặc number do provider gán).
 *  - Fallback: `event_id`.
 *  - BỎ `message.id` (không stable across multiple events trên cùng
 *    message — cùng message có thể fire message_created, message_updated,
 *    message_deleted với các event id khác nhau).
 */
export const STABLE_EVENT_ID_POLICY = Object.freeze({
  CHATWOOT: {
    primary: ['id'],
    fallback: ['event_id'],
  },
  ZALO_OA: {
    primary: ['event_id'],
    fallback: ['message_id'],
  },
  GENERIC: {
    primary: ['event_id', 'eventId'],
    fallback: ['id'],
  },
} as const);

/**
 * Compute payload digest = SHA-256 hex of raw bytes.
 * Used as `payloadDigest` in EventReceipt (CORE/1.3 schema).
 */
export function computePayloadDigest(rawBody: Uint8Array): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

/**
 * Parse raw bytes (after HMAC verify) theo provider fixture.
 * Returns structured envelope hoặc failure code. KHÔNG throw.
 */
export function parseProviderFixture(
  provider: string,
  rawBody: Uint8Array,
): ParseResult {
  if (!isSupportedProvider(provider)) {
    return {
      ok: false,
      code: 'unsupported_provider',
      message: `Provider không thuộc CORE/1.2 fixture: ${provider}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(rawBody).toString('utf8'));
  } catch {
    return {
      ok: false,
      code: 'malformed_json',
      message: 'Raw body không parse được JSON',
    };
  }

  if (!isObject(parsed)) {
    return {
      ok: false,
      code: 'malformed_json',
      message: 'Parsed body không phải object',
    };
  }

  // Provider-specific extraction.
  switch (provider) {
    case 'CHATWOOT':
      return extractChatwoot(parsed);
    case 'ZALO_OA':
      return extractZalo(parsed);
    case 'GENERIC':
      return extractGeneric(parsed);
    default:
      // exhaustive guard
      return {
        ok: false,
        code: 'unsupported_provider',
        message: 'unreachable',
      };
  }
}

/**
 * CHATWOOT — eventType lấy từ `event` (`message_created`,
 * `message_updated`, `conversation_created`, etc).
 *
 * Stable eventId: top-level `id` (synthetic — provider gán per-occurrence
 * event id) HOẶC `event_id`. KHÔNG dùng `message.id` (không ổn định giữa
 * các events trên cùng message).
 */
function extractChatwoot(body: Record<string, unknown>): ParseResult {
  const eventType = typeof body['event'] === 'string' ? body['event'] : null;
  if (!eventType) {
    return {
      ok: false,
      code: 'unsupported_event_type',
      message: 'Chatwoot fixture: thiếu field `event` (eventType)',
    };
  }

  const policy = STABLE_EVENT_ID_POLICY.CHATWOOT;
  const { eventId, source } = pickStableId(body, policy.primary, policy.fallback);
  if (!eventId) {
    return {
      ok: false,
      code: 'missing_event_id',
      message:
        'Chatwoot fixture: thiếu stable eventId (top-level `id` hoặc `event_id`). KHÔNG dùng `message.id` vì không ổn định giữa các occurrences.',
    };
  }

  const correlationId =
    typeof body['correlation_id'] === 'string' ? body['correlation_id'] : undefined;

  return {
    ok: true,
    eventType,
    eventId,
    eventIdSource: source,
    ...(correlationId !== undefined ? { correlationId } : {}),
    parsedBody: body,
  };
}

/**
 * ZALO_OA — eventType lấy từ `event_name` hoặc `event`.
 *
 * Stable eventId: `event_id` primary; fallback `message_id` (Zalo OA
 * fixture contract giả định 1 delivery = 1 message_id stable).
 */
function extractZalo(body: Record<string, unknown>): ParseResult {
  const eventType =
    typeof body['event_name'] === 'string'
      ? body['event_name']
      : typeof body['event'] === 'string'
        ? body['event']
        : null;
  if (!eventType) {
    return {
      ok: false,
      code: 'unsupported_event_type',
      message: 'Zalo fixture: thiếu event_name/event (eventType)',
    };
  }

  const policy = STABLE_EVENT_ID_POLICY.ZALO_OA;
  const { eventId, source } = pickStableId(body, policy.primary, policy.fallback);
  if (!eventId) {
    return {
      ok: false,
      code: 'missing_event_id',
      message:
        'Zalo fixture: thiếu stable eventId (`event_id` hoặc `message_id`).',
    };
  }

  const correlationId =
    typeof body['trace_id'] === 'string' ? body['trace_id'] : undefined;

  return {
    ok: true,
    eventType,
    eventId,
    eventIdSource: source,
    ...(correlationId !== undefined ? { correlationId } : {}),
    parsedBody: body,
  };
}

/**
 * GENERIC — best-effort JSON shape.
 *
 * Stable eventId: `event_id` / `eventId` primary; `id` (numeric or string
 * ≥8 chars) fallback. KHÔNG dùng `trace_id` (tracing per-request, không
 * stable per-event). KHÔNG dùng `message_id` (provider-specific; chỉ
 * ZALO_OA contract giả định dùng làm fallback).
 */
function extractGeneric(body: Record<string, unknown>): ParseResult {
  const eventType =
    typeof body['eventType'] === 'string'
      ? body['eventType']
      : typeof body['type'] === 'string'
        ? body['type']
        : typeof body['event'] === 'string'
          ? body['event']
          : null;
  if (!eventType) {
    return {
      ok: false,
      code: 'unsupported_event_type',
      message: 'Generic fixture: thiếu eventType/type/event',
    };
  }

  const policy = STABLE_EVENT_ID_POLICY.GENERIC;
  const { eventId, source } = pickStableId(body, policy.primary, policy.fallback);
  if (!eventId) {
    return {
      ok: false,
      code: 'missing_event_id',
      message: `Generic fixture: đã thử [${[...policy.primary, ...policy.fallback].join(', ')}] nhưng không tìm thấy stable eventId. KHÔNG dùng trace_id/message_id vì không ổn định giữa các occurrences.`,
    };
  }

  const correlationId =
    typeof body['correlationId'] === 'string'
      ? body['correlationId']
      : typeof body['correlation_id'] === 'string'
        ? body['correlation_id']
        : undefined;

  return {
    ok: true,
    eventType,
    eventId,
    eventIdSource: source,
    ...(correlationId !== undefined ? { correlationId } : {}),
    parsedBody: body,
  };
}

/**
 * Pick stable eventId từ body theo priority list (primary trước, fallback sau).
 *
 * Stable policy:
 *  - Primary fields: accept string ≥ 8 chars hoặc number (provider gán
 *    numeric id cho event occurrence).
 *  - Fallback fields: cùng rule.
 *  - KHÔNG tự đoán bằng payload hash / receipt time / random.
 */
function pickStableId(
  body: Record<string, unknown>,
  primary: readonly string[],
  fallback: readonly string[],
): { eventId: string | null; source: 'primary' | 'fallback' } {
  // Primary fields.
  for (const field of primary) {
    const v = body[field];
    if (typeof v === 'string' && v.length >= 8) {
      return { eventId: v, source: 'primary' };
    }
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      return { eventId: String(v), source: 'primary' };
    }
  }
  // Fallback fields.
  for (const field of fallback) {
    const v = body[field];
    if (typeof v === 'string' && v.length >= 8) {
      return { eventId: v, source: 'fallback' };
    }
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      return { eventId: String(v), source: 'fallback' };
    }
  }
  return { eventId: null, source: 'primary' };
}

function isSupportedProvider(s: string): s is SupportedProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(s);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
