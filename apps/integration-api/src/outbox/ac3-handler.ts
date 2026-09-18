/**
 * outbox/ac3-handler.ts — HTTP handler for outbox AC3 routes (CORE/1.8 AC3).
 *
 * Routes:
 *  - POST /mock/outbox/intent   — submit outbound intent (simulation)
 *  - POST /mock/outbox/receipt  — record durable receipt (ACK from provider)
 *  - POST /mock/outbox/report   — receive delivery report (SENT/DELIVERED/FAILED/etc.)
 *
 * Design:
 *  - Validates request bodies per contracts schemas
 *  - Delegates to DeliveryReceiptHandler / DeliveryReportingHandler
 *  - Returns JSON responses per contract shapes
 *
 * Boundaries:
 *  - Frozen contracts in packages/contracts — do NOT modify
 *  - No HRP/provider/model thật — mock only
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PrismaClient } from '@prisma/client';
import { SCHEMA_VERSION } from '@hrp-engagement/contracts';
import { DeliveryReceiptHandler } from './delivery-receipt.js';
import { DeliveryReportingHandler } from './delivery-reporting.js';

/**
 * HTTP handler configuration.
 */
export interface Ac3HttpHandlerConfig {
  /** Prisma client (optional for testing). */
  prisma: PrismaClient | null;
  /** Organization ID for validation. */
  organizationId: string;
}

/**
 * Intent submission body (for POST /mock/outbox/intent).
 */
interface IntentSubmissionBody {
  intentId: string;
  receiptId: string;
  idempotencyKey?: string;
  correlationId?: string;
  intentSource: string;
  intentTargetJson?: Record<string, unknown>;
  provider?: string;
  connectionId?: string;
}

/**
 * AC3 HTTP handler — processes mock outbox HTTP requests for CORE/1.8 AC3.
 *
 * Routes:
 *  - POST /mock/outbox/intent   — submit outbound intent for dispatch
 *  - POST /mock/outbox/receipt — record durable receipt from provider
 *  - POST /mock/outbox/report  — receive delivery report
 */
export class Ac3HttpHandler {
  private readonly prisma: PrismaClient | null;
  private readonly receiptHandler: DeliveryReceiptHandler | null;
  private readonly reportingHandler: DeliveryReportingHandler | null;
  private readonly organizationId: string;

  constructor(config: Ac3HttpHandlerConfig) {
    this.prisma = config.prisma;
    this.receiptHandler = config.prisma ? new DeliveryReceiptHandler(config.prisma) : null;
    this.reportingHandler = config.prisma ? new DeliveryReportingHandler(config.prisma) : null;
    this.organizationId = config.organizationId;
  }

  /**
   * Handle an outbox HTTP request.
   *
   * Routes:
   *  - /mock/outbox/intent  → handleIntentSubmission
   *  - /mock/outbox/receipt → handleReceiptSubmission
   *  - /mock/outbox/report  → handleReportingSubmission
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const path = url.split('?')[0] ?? '/';

    // Route matching
    if (path === '/mock/outbox/intent' && req.method === 'POST') {
      return this.handleIntentSubmission(req, res);
    }
    if (path === '/mock/outbox/receipt' && req.method === 'POST') {
      return this.handleReceiptSubmission(req, res);
    }
    if (path === '/mock/outbox/report' && req.method === 'POST') {
      return this.handleReportingSubmission(req, res);
    }

    // Route not found - not an AC3 route
    return respondJson(res, 404, {
      error: 'route_not_found',
      path,
      message: 'Not an AC3 route',
    });
  }

  /**
   * POST /mock/outbox/intent — Submit outbound intent for dispatch.
   *
   * This creates a DispatchIntent row in PENDING status for the dispatcher
   * to pick up and process.
   */
  private async handleIntentSubmission(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.prisma) {
      return respondJson(res, 503, {
        error: 'database_not_available',
        message: 'Database not configured',
      });
    }

    const rawBody = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return respondJson(res, 400, {
        status: 'rejected',
        code: 'INVALID_JSON',
        message: 'Request body is not valid JSON',
      });
    }

    // Validate body structure
    const body = parsed as IntentSubmissionBody;
    if (!body.intentId || !body.receiptId || !body.intentSource) {
      return respondJson(res, 400, {
        status: 'rejected',
        code: 'VALIDATION_ERROR',
        message: 'Missing required fields: intentId, receiptId, intentSource',
      });
    }

    try {
      // Create DispatchIntent row
      const intent = await this.prisma.dispatchIntent.create({
        data: {
          intentId: body.intentId,
          schemaVersion: SCHEMA_VERSION,
          organizationId: this.organizationId,
          receiptId: body.receiptId,
          idempotencyKey: body.idempotencyKey ?? null,
          correlationId: body.correlationId ?? `corr-${body.intentId}`,
          intentSource: body.intentSource,
          intentTargetJson: body.intentTargetJson ?? {},
          status: 'PENDING',
          attempts: 0,
        },
      });

      console.log(JSON.stringify({
        level: 'info',
        msg: 'Ac3HttpHandler: intent submitted',
        intentId: intent.intentId,
        receiptId: intent.receiptId,
        status: intent.status,
      }));

      return respondJson(res, 201, {
        status: 'accepted',
        intentId: intent.intentId,
        receiptId: intent.receiptId,
        organizationId: intent.organizationId,
        dispatchStatus: intent.status,
        message: 'Outbound intent submitted for dispatch',
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Check for unique constraint violation (duplicate intent)
      if (errorMessage.includes('Unique constraint') || errorMessage.includes('duplicate key')) {
        return respondJson(res, 409, {
          status: 'rejected',
          code: 'DUPLICATE_INTENT',
          message: `Intent ${body.intentId} already exists`,
          intentId: body.intentId,
          note: 'Duplicate intent does NOT produce duplicate delivery logic (idempotent)',
        });
      }

      console.log(JSON.stringify({
        level: 'error',
        msg: 'Ac3HttpHandler: intent submission failed',
        intentId: body.intentId,
        error: errorMessage,
      }));

      return respondJson(res, 500, {
        status: 'rejected',
        code: 'INTERNAL_ERROR',
        message: errorMessage,
      });
    }
  }

  /**
   * POST /mock/outbox/receipt — Record durable receipt from provider.
   *
   * This handles the OutboxDeliveryReceipt callback from the provider,
   * indicating that the provider has durably accepted the outbound intent.
   *
   * Per contracts:
   *  - ACCEPTED = durable acceptance (different from DELIVERED)
   *  - Only ACCEPTED outcome is valid
   */
  private async handleReceiptSubmission(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.receiptHandler) {
      return respondJson(res, 503, {
        error: 'database_not_available',
        message: 'Database not configured',
      });
    }

    const rawBody = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return respondJson(res, 400, {
        status: 'rejected',
        code: 'INVALID_JSON',
        message: 'Request body is not valid JSON',
      });
    }

    const result = await this.receiptHandler.processReceipt(parsed);

    if (result.success) {
      return respondJson(res, 200, {
        status: 'ok',
        intentId: result.intentId,
        outcome: 'ACCEPTED',
        acceptedAt: result.acceptedAt,
        message: 'Durable receipt recorded',
      });
    }

    // Handle error cases
    if (result.status === 'VALIDATION_ERROR') {
      return respondJson(res, 400, {
        status: 'rejected',
        code: result.error?.code ?? 'VALIDATION_ERROR',
        message: result.error?.message ?? 'Invalid receipt',
        intentId: result.intentId,
      });
    }

    if (result.status === 'NOT_FOUND') {
      return respondJson(res, 404, {
        status: 'rejected',
        code: 'INTENT_NOT_FOUND',
        message: result.error?.message ?? 'Intent not found',
        intentId: result.intentId,
      });
    }

    if (result.status === 'ALREADY_PROCESSED') {
      return respondJson(res, 200, {
        status: 'ok',
        intentId: result.intentId,
        outcome: 'ACCEPTED',
        message: 'Intent already processed (idempotent)',
      });
    }

    return respondJson(res, 500, {
      status: 'rejected',
      code: result.error?.code ?? 'INTERNAL_ERROR',
      message: result.error?.message ?? 'Processing failed',
      intentId: result.intentId,
    });
  }

  /**
   * POST /mock/outbox/report — Receive delivery report from provider.
   *
   * This handles the DeliveryReportingEvent callback from the provider,
   * indicating the delivery status of an outbound intent.
   *
   * States:
   *  - SENT: provider accepted, pending delivery confirmation
   *  - DELIVERED: provider confirmed delivered
   *  - FAILED: send failed (reason required)
   *  - UNKNOWN: cannot verify (NOT treated as success)
   *  - SUPPRESSED: dispatch gate suppressed (DNC/fence)
   */
  private async handleReportingSubmission(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.reportingHandler) {
      return respondJson(res, 503, {
        error: 'database_not_available',
        message: 'Database not configured',
      });
    }

    const rawBody = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return respondJson(res, 400, {
        status: 'rejected',
        code: 'INVALID_JSON',
        message: 'Request body is not valid JSON',
      });
    }

    const result = await this.reportingHandler.processEvent(parsed);

    if (result.success) {
      const isSuccess = result.state === 'SENT' || result.state === 'DELIVERED';

      return respondJson(res, 200, {
        status: 'ok',
        intentId: result.intentId,
        previousStatus: result.previousStatus,
        newStatus: result.newStatus,
        state: result.state,
        isSuccess,
        message: isSuccess
          ? `Delivery ${result.state.toLowerCase()}`
          : `Delivery ${result.state.toLowerCase()} (not success)`,
      });
    }

    // Handle error cases
    if (result.error?.code === 'VALIDATION_ERROR') {
      return respondJson(res, 400, {
        status: 'rejected',
        code: result.error.code,
        message: result.error.message,
        intentId: result.intentId,
      });
    }

    if (result.error?.code === 'INTENT_NOT_FOUND') {
      return respondJson(res, 404, {
        status: 'rejected',
        code: 'INTENT_NOT_FOUND',
        message: result.error.message,
        intentId: result.intentId,
      });
    }

    if (result.error?.code === 'INVALID_TRANSITION') {
      return respondJson(res, 409, {
        status: 'rejected',
        code: 'INVALID_TRANSITION',
        message: result.error.message,
        intentId: result.intentId,
      });
    }

    return respondJson(res, 500, {
      status: 'rejected',
      code: result.error?.code ?? 'INTERNAL_ERROR',
      message: result.error?.message ?? 'Processing failed',
      intentId: result.intentId,
    });
  }
}

/**
 * Read request body as string.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Send JSON response.
 */
function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/**
 * Create an AC3 HTTP handler.
 */
export function createAc3HttpHandler(
  prisma: PrismaClient | null,
  config: { organizationId: string },
): Ac3HttpHandler {
  return new Ac3HttpHandler({ prisma, ...config });
}
