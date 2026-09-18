/**
 * integration-api/src/receiver/dedupe.ts — CORE/1.2
 *
 * Dedupe decision cho inbound webhook. **Sử dụng trực tiếp** CORE/1.3
 * `commitReceiptWithIntents` cho atomic commit.
 *
 * Per Backlog §Task 1.2 AC:
 *  - "Retry webhook cùng ID/hash không sinh job logic mới": CORE/1.3
 *    idempotency: same (org/provider/connection/eventId) + same digest
 *    → return existing receipt, KHÔNG tạo intent mới.
 *  - "Cùng ID khác hash bị reject/quarantine với audit": CORE/1.3 throws
 *    VALIDATION_ERROR / IDEMPOTENCY_CONFLICT khi digest mismatch.
 *    Receiver map → 409 Conflict.
 *
 * Layer này CHỈ orchestrate call; KHÔNG tự persist. Persistence thuộc
 * Integration Store (CORE/1.3).
 */

import type { PrismaClient } from '@prisma/client';
import { commitReceiptWithIntents } from '@hrp-engagement/integration-store';
import type { z } from 'zod';
import type {
  EventReceiptSchema,
  OutboxDeliveryIntentSchema,
} from '@hrp-engagement/contracts';

import type { ParseResult } from './protocol-fixture.js';
import { computePayloadDigest } from './protocol-fixture.js';

export type DedupeResult =
  | {
      ok: true;
      receiptId: string;
      intentIds: string[];
      created: boolean;
      payloadDigest: string;
    }
  | {
      ok: false;
      code:
        | 'parse_failure'
        | 'commit_failure'
        | 'idempotency_conflict'
        | 'scope_mismatch';
      message: string;
      retryable: boolean;
    };

/**
 * Build CORE/1.3 receipt input from ParseResult + scope + rawBody.
 * Caller must supply scope (already verified from URL path).
 */
function buildReceiptAndIntents(args: {
  scope: { organizationId: string; provider: string; connectionId: string };
  parse: Extract<ParseResult, { ok: true }>;
  payloadDigest: string;
  correlationId: string;
}): {
  receipt: z.infer<typeof EventReceiptSchema>;
  intents: z.infer<typeof OutboxDeliveryIntentSchema>[];
} {
  const { scope, parse, payloadDigest, correlationId } = args;

  const receipt: z.infer<typeof EventReceiptSchema> = {
    schemaVersion: '1',
    organizationId: scope.organizationId,
    eventId: parse.eventId,
    payloadDigest,
    duplicateKind: 'DEDUPE',
  };

  // CORE/1.2 minimum: 1 DispatchIntent per receipt.
  // CORE/1.5 sẽ thay bằng normalized intents theo eventType.
  // CORE/1.2 chỉ mark "to-be-processed" placeholder.
  const intentId = `it-recv-${parse.eventId.slice(0, 16)}-${Date.now().toString(36)}`;
  const intent: z.infer<typeof OutboxDeliveryIntentSchema> = {
    schemaVersion: '1',
    organizationId: scope.organizationId,
    intentId,
    intentSchemaVersion: '1',
    sourceCommandId: `recv-${parse.eventId}`,
    destination: {
      provider: scope.provider,
      connectionId: scope.connectionId,
      recipientRef: '', // CORE/1.5 fill; CORE/1.2 chỉ placeholder
    },
    template: {
      engine: 'HRP_INTERNAL',
      contentRef: `recv:${parse.eventType}`,
    },
    correlationId,
    dedupeKey: `${scope.organizationId}:${scope.provider}:${scope.connectionId}:${parse.eventId}`,
    policy: {
      purpose: 'webhook_receive',
      suppressionCheckRequired: true,
      retryPolicyVersion: 'v1-core1.2',
    },
    channel: 'PUSH_WEBHOOK',
    consumerDedupeToken: payloadDigest.slice(0, 32),
  };

  return { receipt, intents: [intent] };
}

/**
 * Atomic commit (idempotent). Returns:
 *  - ok=true, created=true → first time, durable.
 *  - ok=true, created=false → already exists, idempotent replay (no new job).
 *  - ok=false, idempotency_conflict → same eventId, different digest.
 *  - ok=false, scope_mismatch → body field violates scope (defense-in-depth).
 *  - ok=false, commit_failure → DB fail; receiver returns 503 (NOT 202).
 */
export async function commitWebhookReceipt(args: {
  prisma: PrismaClient;
  scope: { organizationId: string; provider: string; connectionId: string };
  parse: Extract<ParseResult, { ok: true }>;
  rawBody: Uint8Array;
  correlationId: string;
}): Promise<DedupeResult> {
  const { prisma, scope, parse, rawBody, correlationId } = args;

  const payloadDigest = computePayloadDigest(rawBody);
  const { receipt, intents } = buildReceiptAndIntents({
    scope,
    parse,
    payloadDigest,
    correlationId,
  });

  try {
    const result = await commitReceiptWithIntents(
      prisma,
      {
        organizationId: scope.organizationId,
        provider: scope.provider,
        connectionId: scope.connectionId,
        eventId: parse.eventId,
      },
      {
        schemaVersion: '1',
        receipt,
        intents,
        ...(correlationId !== '' ? { correlationId } : {}),
      },
    );

    return {
      ok: true,
      receiptId: result.result.receiptId,
      intentIds: result.result.intentIds,
      created: result.created,
      payloadDigest,
    };
  } catch (err) {
    if (!err || typeof err !== 'object') {
      return {
        ok: false,
        code: 'commit_failure',
        message: 'commit failed with non-object error',
        retryable: true,
      };
    }
    const e = err as { code?: string; message?: string };
    if (e.code === 'VALIDATION_ERROR' && /IDEMPOTENCY_CONFLICT/.test(e.message ?? '')) {
      return {
        ok: false,
        code: 'idempotency_conflict',
        message:
          'Cùng eventId với payloadDigest khác; CORE/1.3 không auto-merge. Caller dùng CORRECTION path.',
        retryable: false,
      };
    }
    if (e.code === 'SCOPE_MISMATCH') {
      return {
        ok: false,
        code: 'scope_mismatch',
        message: e.message ?? 'scope mismatch',
        retryable: false,
      };
    }
    return {
      ok: false,
      code: 'commit_failure',
      message: e.message ?? 'commit failed',
      retryable: true,
    };
  }
}
