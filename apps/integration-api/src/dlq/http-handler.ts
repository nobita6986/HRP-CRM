// src/dlq/http-handler.ts — CORE/1.8 AC2: HTTP handler for DLQ endpoints.
//
// Routes:
//  - GET  /mock/dlq/list      — list dead-lettered receipts (safe metadata)
//  - GET  /mock/dlq/stats     — get DLQ statistics
//  - GET  /mock/dlq/preview/:receiptId — preview redrive outcome (dry-run)
//  - POST /mock/dlq/redrive   — redrive a dead-lettered receipt
//
// Boundaries:
//  - DLQ routes are mock-only (not in contracts freeze).
//  - Actor claim comes from request envelope header (trusted boundary).
//  - PII guard enforced at output transform (no raw error, no stack trace).
//  - DNC guard enforced on every redrive operation.

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  DlqService,
  DlqServiceError,
  dlqServiceErrorToHttpStatus,
  type DlqRedriveInput,
  type DlqListInput,
} from './index.js';

// ─── HTTP Handler ─────────────────────────────────────────────────────

export interface DlqHttpHandlerOptions {
  service: DlqService;
  /** Organization ID from config (validated at startup). */
  organizationId: string;
}

export class DlqHttpHandler {
  constructor(private readonly opts: DlqHttpHandlerOptions) {}

  /**
   * Main HTTP request handler.
   * Delegates to specific route handlers based on path and method.
   */
  handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';
    const path = url.split('?')[0] ?? '/';
    const method = req.method ?? 'GET';
    const segments = path.split('/').filter(Boolean);

    // Only handle /mock/dlq/* routes
    if (segments[0] !== 'mock' || segments[1] !== 'dlq') {
      return; // Not a DLQ route
    }

    const action = segments[2];
    try {
      if (action === 'list' && method === 'GET') {
        return void this.handleList(req, res);
      }
      if (action === 'stats' && method === 'GET') {
        return void this.handleStats(req, res);
      }
      if (action === 'preview' && method === 'GET') {
        return void this.handlePreview(req, res, segments[3]);
      }
      if (action === 'redrive' && method === 'POST') {
        return void this.handleRedrive(req, res);
      }
      return respondJson(res, 404, { error: 'route_not_found', path });
    } catch (err) {
      const svcErr = err instanceof DlqServiceError ? err : null;
      const status = svcErr ? dlqServiceErrorToHttpStatus(svcErr.code) : 500;
      return respondJson(res, status, {
        error: svcErr ? `${svcErr.code}: ${svcErr.message}` : String(err),
        code: svcErr ? svcErr.code : 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Extract actor from request envelope header (trusted boundary).
   * Default: HRP_DLQ_SERVICE actor for synthetic testing.
   */
  private extractActor(req: IncomingMessage): { kind: string; [key: string]: unknown } {
    const actorHeader = req.headers['x-dlq-actor'];
    if (!actorHeader) {
      return { kind: 'SERVICE', serviceId: 'svc-dlq-test' };
    }
    try {
      const raw = Array.isArray(actorHeader) ? (actorHeader[0] ?? 'null') : actorHeader;
      return JSON.parse(raw);
    } catch {
      return { kind: 'SERVICE', serviceId: 'svc-dlq-test' };
    }
  }

  /**
   * Parse JSON body from request.
   */
  private parseBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  }

  // ─── Route handlers ────────────────────────────────────────────────

  /**
   * GET /mock/dlq/list — list dead-lettered receipts.
   *
   * Query params:
   *  - reasonCode: filter by error reason
   *  - fromDate: filter by resolved date (ISO string)
   *  - toDate: filter by resolved date (ISO string)
   *  - limit: max items (default 50, max 100)
   *  - cursor: pagination cursor
   *
   * Response: { items: DeadLetterReceipt[], nextCursor: string | null }
   *
   * AC2: Returns only SAFE metadata — no raw error, no PII.
   */
  private handleList(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? 'http://localhost/', 'http://localhost/');

    const listInput: DlqListInput = {
      reasonCode: url.searchParams.get('reasonCode') ?? undefined,
      fromDate: url.searchParams.get('fromDate') ?? undefined,
      toDate: url.searchParams.get('toDate') ?? undefined,
    };

    // Parse limit with bounds
    const rawLimit = url.searchParams.get('limit');
    if (rawLimit !== null && rawLimit !== '') {
      const parsed = Number(rawLimit);
      if (Number.isFinite(parsed) && parsed > 0) {
        listInput.limit = Math.min(parsed, MAX_PAGE_SIZE);
      }
    }

    // Parse cursor
    const cursor = url.searchParams.get('cursor');
    if (cursor !== null) {
      listInput.cursor = cursor;
    }

    try {
      const result = this.opts.service.listDeadLetters(
        this.opts.organizationId,
        listInput,
      );
      respondJson(res, 200, result);
    } catch (err) {
      respondServiceError(res, err);
    }
  }

  /**
   * GET /mock/dlq/stats — get DLQ statistics.
   *
   * Response:
   *  - totalDeadLettered: number
   *  - byReasonCode: Record<string, number>
   *  - avgAttempts: number
   *  - oldestResolvedAt: string | null
   */
  private handleStats(req: IncomingMessage, res: ServerResponse): void {
    try {
      const result = this.opts.service.getStats(this.opts.organizationId);
      respondJson(res, 200, result);
    } catch (err) {
      respondServiceError(res, err);
    }
  }

  /**
   * GET /mock/dlq/preview/:receiptId — preview redrive outcome (dry-run).
   *
   * Response:
   *  - canRedrive: boolean
   *  - reason?: string (if cannot redrive)
   *  - attempts: number
   *  - maxAttempts: number
   *  - dncStatus: 'BLOCKED' | 'ALLOWED' | 'UNKNOWN'
   *  - currentState: string
   */
  private handlePreview(req: IncomingMessage, res: ServerResponse, receiptId?: string): void {
    if (!receiptId) {
      const url = new URL(req.url ?? 'http://localhost/', 'http://localhost/');
      receiptId = url.searchParams.get('receiptId') ?? undefined;
    }

    if (!receiptId) {
      respondJson(res, 400, {
        error: 'VALIDATION_ERROR',
        message: 'receiptId là bắt buộc (path param hoặc ?receiptId= query param)',
      });
      return;
    }

    try {
      const result = this.opts.service.getRedrivePreview(
        this.opts.organizationId,
        receiptId,
      );
      respondJson(res, 200, result);
    } catch (err) {
      respondServiceError(res, err);
    }
  }

  /**
   * POST /mock/dlq/redrive — redrive a dead-lettered receipt.
   *
   * Body (JSON):
   *  - receiptId: string (required)
   *  - reason: string (optional, audit trail)
   *
   * Response (success):
   *  - success: true
   *  - receiptId: string
   *  - newState: 'PENDING'
   *  - attempts: number
   *  - nextAttemptAt: string
   *  - redriveCount: number
   *  - redrivenAt: string
   *  - redriveActor: string
   *
   * Response (error):
   *  - success: false
   *  - code: 'NOT_FOUND' | 'INVALID_STATE' | 'DNC_GUARD_BLOCKED' |
   *          'MAX_ATTEMPTS_EXCEEDED' | 'FORBIDDEN_PATCH_FIELD' | 'SCOPE_MISMATCH'
   *  - message: string
   *
   * AC2: DNC guard MUST be enforced; returns FORBIDDEN if DNC active.
   */
  private async handleRedrive(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const raw = await this.parseBody(req);
      const body = raw as Record<string, unknown>;

      // Validate required fields
      const receiptId = body['receiptId'] as string;
      if (!receiptId) {
        respondJson(res, 400, {
          error: 'VALIDATION_ERROR',
          message: 'receiptId là bắt buộc',
        });
        return;
      }

      const actor = this.extractActor(req);
      const input: DlqRedriveInput = {
        receiptId,
        reason: body['reason'] as string | undefined,
      };

      // Execute redrive
      const result = await this.opts.service.redriveReceipt(
        this.opts.organizationId,
        actor,
        input,
      );

      // Handle result — use type guard to narrow union type
      if ('code' in result && !result.success) {
        const errorResult = result as { success: false; code: string; message: string };
        let status = 500;
        switch (errorResult.code) {
          case 'NOT_FOUND':
            status = 404;
            break;
          case 'DNC_GUARD_BLOCKED':
            status = 403; // FORBIDDEN — DNC active
            break;
          case 'MAX_ATTEMPTS_EXCEEDED':
          case 'INVALID_STATE':
          case 'FORBIDDEN_PATCH_FIELD':
            status = 409;
            break;
          case 'SCOPE_MISMATCH':
            status = 400;
            break;
        }
        respondJson(res, status, errorResult);
        return;
      }

      // Success
      respondJson(res, 200, result);
      } catch (err) {
        respondJson(res, 400, { error: 'invalid_json', message: String(err) });
      }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Maximum pageSize to prevent unbounded memory load. */
const MAX_PAGE_SIZE = 100;

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function respondServiceError(res: ServerResponse, err: unknown): void {
  const svcErr = err instanceof DlqServiceError ? err : null;
  const status = svcErr ? dlqServiceErrorToHttpStatus(svcErr.code) : 500;
  respondJson(res, status, {
    error: svcErr ? `${svcErr.code}: ${svcErr.message}` : String(err),
    code: svcErr ? svcErr.code : 'INTERNAL_ERROR',
  });
}
