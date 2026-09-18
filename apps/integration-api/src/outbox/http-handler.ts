/**
 * outbox/http-handler.ts — HTTP handler for reconciliation endpoints (CORE/1.8 AC4).
 *
 * Wires ReconciliationService and UnknownDeliveryHandler into integration-api HTTP server.
 *
 * Routes:
 *  - GET  /mock/outbox/reconciliation/list       — List reconciliation entries.
 *  - GET  /mock/outbox/reconciliation/detail/:id  — Get single entry.
 *  - POST /mock/outbox/reconciliation/investigate/:id — Mark as investigating.
 *  - POST /mock/outbox/reconciliation/resolve    — Resolve with evidence.
 *  - POST /mock/outbox/unknown/receive           — Handle UNKNOWN delivery event.
 *
 * Boundaries:
 *  - Reconciliation routes are mock-only (not in contracts freeze).
 *  - Actor claim comes from request envelope (trusted boundary).
 *  - UNKNOWN never auto-resolves to DELIVERED — explicit resolution required.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DeliveryReportingEvent, DeliveryFailureReason } from '@hrp-engagement/contracts';
import {
  ReconciliationService,
  ReconciliationError,
  type ReconciliationEntry,
  type ReconciliationStatus,
  type ResolutionKind,
} from './reconciliation.js';
import { UnknownDeliveryHandler, UnknownDeliveryHandlerError } from './unknown-handler.js';

/* ─────────────────────────────────────────────────────────────────────────
 * §1. Options
 * ───────────────────────────────────────────────────────────────────────── */

export interface OutboxHttpHandlerOptions {
  reconciliationService: ReconciliationService;
  unknownDeliveryHandler: UnknownDeliveryHandler;
  /** Organization ID from config (validated at startup). */
  organizationId: string;
}

/* ─────────────────────────────────────────────────────────────────────────
 * §2. OutboxHttpHandler
 * ───────────────────────────────────────────────────────────────────────── */

export class OutboxHttpHandler {
  constructor(private readonly opts: OutboxHttpHandlerOptions) {}

  /**
   * Handle HTTP request — route to appropriate handler.
   */
  handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';
    const path = url.split('?')[0] ?? '/';
    const method = req.method ?? 'GET';
    const segments = path.split('/').filter(Boolean);

    // Route prefix: /mock/outbox/reconciliation or /mock/outbox/unknown
    if (segments[0] !== 'mock' || segments[1] !== 'outbox') {
      return; // Not an outbox route
    }

    const action = segments[2];

    try {
      // Reconciliation routes.
      if (action === 'reconciliation') {
        const subAction = segments[3];

        // GET /mock/outbox/reconciliation/list
        if (subAction === 'list' && method === 'GET') {
          return void this.handleList(req, res);
        }

        // GET /mock/outbox/reconciliation/detail/:id
        if (subAction === 'detail' && method === 'GET') {
          return void this.handleDetail(req, res, segments[4]);
        }

        // POST /mock/outbox/reconciliation/investigate/:id
        if (subAction === 'investigate' && method === 'POST') {
          return void this.handleInvestigate(req, res, segments[4]);
        }

        // POST /mock/outbox/reconciliation/resolve
        if (subAction === 'resolve' && method === 'POST') {
          return void this.handleResolve(req, res);
        }
      }

      // Unknown delivery routes.
      if (action === 'unknown') {
        // POST /mock/outbox/unknown/receive
        if (segments[3] === 'receive' && method === 'POST') {
          return void this.handleUnknownReceive(req, res);
        }
      }

      return respondJson(res, 404, { error: 'route_not_found', path });
    } catch (err) {
      this.handleError(res, err);
    }
  }

  /* ─── Reconciliation routes ────────────────────────────────────────────── */

  /**
   * GET /mock/outbox/reconciliation/list — list reconciliation entries.
   */
  private async handleList(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? 'http://localhost/', 'http://localhost/');
    const actor = this.extractActor(req);

    const status = url.searchParams.get('status') as ReconciliationStatus | null;
    const intentId = url.searchParams.get('intentId') ?? undefined;
    const reasonCode = url.searchParams.get('reasonCode') ?? undefined;
    const cursor = url.searchParams.get('cursor') ?? undefined;

    const rawPageSize = url.searchParams.get('pageSize');
    let pageSize: number | undefined;
    if (rawPageSize !== null && rawPageSize !== '') {
      const parsed = Number(rawPageSize);
      pageSize = Number.isFinite(parsed) && parsed > 0
        ? Math.min(parsed, MAX_PAGE_SIZE)
        : undefined;
    }

    // Validate status if provided.
    if (status && !VALID_RECONCILIATION_STATUSES.includes(status)) {
      respondJson(res, 400, {
        error: 'VALIDATION_ERROR',
        message: `Invalid status: ${status}. Valid values: ${VALID_RECONCILIATION_STATUSES.join(', ')}`,
      });
      return;
    }

    const result = await this.opts.reconciliationService.listEntries({
      filter: {
        status: status ?? undefined,
        intentId,
        reasonCode,
      },
      cursor,
      pageSize,
    });

    respondJson(res, 200, {
      status: 'ok',
      actor,
      entries: result.entries.map(sanitizeEntry),
      nextCursor: result.nextCursor,
    });
  }

  /**
   * GET /mock/outbox/reconciliation/detail/:id — get single entry.
   */
  private async handleDetail(req: IncomingMessage, res: ServerResponse, id?: string): Promise<void> {
    if (!id) {
      const url = new URL(req.url ?? 'http://localhost/', 'http://localhost/');
      id = url.searchParams.get('id') ?? undefined;
    }

    if (!id) {
      respondJson(res, 400, {
        error: 'VALIDATION_ERROR',
        message: 'Missing entryId (path param or ?id= query param)',
      });
      return;
    }

    const actor = this.extractActor(req);
    const entry = await this.opts.reconciliationService.getEntry(id);

    if (!entry) {
      respondJson(res, 404, { error: 'NOT_FOUND', entryId: id });
      return;
    }

    respondJson(res, 200, {
      status: 'ok',
      actor,
      entry: sanitizeEntry(entry),
    });
  }

  /**
   * POST /mock/outbox/reconciliation/investigate/:id — mark as investigating.
   */
  private handleInvestigate(req: IncomingMessage, res: ServerResponse, id?: string): void {
    if (!id) {
      const url = new URL(req.url ?? 'http://localhost/', 'http://localhost/');
      id = url.searchParams.get('id') ?? undefined;
    }

    if (!id) {
      respondJson(res, 400, {
        error: 'VALIDATION_ERROR',
        message: 'Missing entryId (path param or ?id= query param)',
      });
      return;
    }

    this.parseBody(req).then(async (raw) => {
      const body = raw as Record<string, unknown>;
      const note = body['note'] as string | undefined;
      const actor = this.extractActor(req);

      try {
        const entry = await this.opts.reconciliationService.markInvestigating(id, note);

        respondJson(res, 200, {
          status: 'ok',
          actor,
          entry: sanitizeEntry(entry),
          message: `Entry ${id} marked as investigating`,
        });
      } catch (err) {
        this.handleError(res, err);
      }
    }).catch((err) => {
      respondJson(res, 400, { error: 'invalid_json', message: String(err) });
    });
  }

  /**
   * POST /mock/outbox/reconciliation/resolve — resolve with evidence.
   *
   * AC4: UNKNOWN never auto-resolves to DELIVERED.
   * Resolution must be explicit: CONFIRMED, FAILED, or RETRY.
   */
  private handleResolve(req: IncomingMessage, res: ServerResponse): void {
    this.parseBody(req).then(async (raw) => {
      const body = raw as Record<string, unknown>;
      const entryId = body['entryId'] as string;
      const resolution = body['resolution'] as ResolutionKind;
      const resolutionNote = body['resolutionNote'] as string | undefined;
      const retryIdempotencyKey = body['retryIdempotencyKey'] as string | undefined;
      const expectedVersion = body['expectedVersion'] as number | undefined;
      const actor = this.extractActor(req);

      // Validate required fields.
      if (!entryId || !resolution) {
        respondJson(res, 400, {
          error: 'VALIDATION_ERROR',
          message: 'Missing required fields: entryId, resolution',
        });
        return;
      }

      // Validate resolution.
      if (!VALID_RESOLUTION_KINDS.includes(resolution)) {
        respondJson(res, 400, {
          error: 'VALIDATION_ERROR',
          message: `Invalid resolution: ${resolution}. Valid values: ${VALID_RESOLUTION_KINDS.join(', ')}`,
        });
        return;
      }

      // Validate RETRY requires idempotency key.
      if (resolution === 'RETRY' && !retryIdempotencyKey) {
        respondJson(res, 400, {
          error: 'VALIDATION_ERROR',
          message: 'retryIdempotencyKey required when resolution is RETRY',
        });
        return;
      }

      try {
        const entry = await this.opts.reconciliationService.resolveReconciliation(
          entryId,
          resolution,
          formatActor(actor),
          resolutionNote,
          retryIdempotencyKey,
          expectedVersion,
        );

        respondJson(res, 200, {
          status: 'ok',
          entry: sanitizeEntry(entry),
          message: `Entry ${entryId} resolved as ${resolution}`,
        });
      } catch (err) {
        this.handleError(res, err);
      }
    }).catch((err) => {
      respondJson(res, 400, { error: 'invalid_json', message: String(err) });
    });
  }

  /* ─── Unknown delivery routes ──────────────────────────────────────────── */

  /**
   * POST /mock/outbox/unknown/receive — handle UNKNOWN delivery event.
   *
   * AC4: When UNKNOWN received:
   *  - Transition intent to INVESTIGATION_PENDING.
   *  - Create ReconciliationEntry.
   *  - Return acknowledgment that investigation is required.
   */
  private handleUnknownReceive(req: IncomingMessage, res: ServerResponse): void {
    this.parseBody(req).then(async (raw) => {
      const body = raw as Record<string, unknown>;
      const actor = this.extractActor(req);

      // Validate event structure.
      if (!body['intentId'] || !body['state']) {
        respondJson(res, 400, {
          error: 'VALIDATION_ERROR',
          message: 'Missing required fields: intentId, state',
        });
        return;
      }

      if (body['state'] !== 'UNKNOWN') {
        respondJson(res, 400, {
          error: 'VALIDATION_ERROR',
          message: `Expected state UNKNOWN, got ${body['state']}`,
        });
        return;
      }

      if (!body['reason']) {
        respondJson(res, 400, {
          error: 'VALIDATION_ERROR',
          message: 'UNKNOWN state requires a reason field',
        });
        return;
      }

      // Construct event.
      const event: DeliveryReportingEvent = {
        schemaVersion: '1',
        organizationId: this.opts.organizationId,
        intentId: String(body['intentId']),
        consumerDedupeToken: String(body['consumerDedupeToken'] ?? 'dedupe-unknown-' + Date.now()),
        state: 'UNKNOWN',
        reportedAt: String(body['reportedAt'] ?? new Date().toISOString()),
        reason: body['reason'] as DeliveryFailureReason,
        providerRef: body['providerRef'] as DeliveryReportingEvent['providerRef'],
        fenceContext: body['fenceContext'] as DeliveryReportingEvent['fenceContext'],
      };

      try {
        const result = await this.opts.unknownDeliveryHandler.handleUnknownDelivery(event, actor as { kind: string; [key: string]: unknown });

        respondJson(res, 200, {
          status: 'ok',
          handled: result.handled,
          reconciliationEntryId: result.reconciliationEntryId,
          intentId: result.intentId,
          intentStatus: result.intentStatus,
          message: result.message,
          alreadyReconciling: result.alreadyReconciling,
        });
      } catch (err) {
        this.handleError(res, err);
      }
    }).catch((err) => {
      respondJson(res, 400, { error: 'invalid_json', message: String(err) });
    });
  }

  /* ─── Error handling ──────────────────────────────────────────────────── */

  private handleError(res: ServerResponse, err: unknown): void {
    if (err instanceof ReconciliationError) {
      let status = 500;
      if (err.code === 'NOT_FOUND' || err.code === 'INTENT_NOT_FOUND') status = 404;
      else if (err.code === 'INVALID_STATE_TRANSITION' || err.code === 'VALIDATION_ERROR' || err.code === 'VERSION_CONFLICT') status = 409;
      else if (err.code === 'ALREADY_RECONCILING' || err.code === 'ALREADY_RESOLVED') status = 409;

      respondJson(res, status, {
        error: err.code,
        message: err.message,
      });
      return;
    }

    if (err instanceof UnknownDeliveryHandlerError) {
      let status = 500;
      if (err.code === 'INTENT_NOT_FOUND') status = 404;
      else if (err.code === 'DELIVERY_EVENT_INVALID' || err.code === 'INVALID_STATE_FOR_UNKNOWN') status = 400;

      respondJson(res, status, {
        error: err.code,
        message: err.message,
      });
      return;
    }

    // Generic error.
    respondJson(res, 500, {
      error: 'INTERNAL_ERROR',
      message: String(err),
    });
  }

  /* ─── Helpers ─────────────────────────────────────────────────────────── */

  private extractActor(req: IncomingMessage): unknown {
    const actorHeader = req.headers['x-outbox-actor'];
    if (!actorHeader) {
      // Default: SERVICE actor for synthetic testing.
      return { kind: 'SERVICE', serviceId: 'svc-outbox-test' };
    }
    try {
      const raw = Array.isArray(actorHeader)
        ? (actorHeader[0] ?? 'null')
        : actorHeader;
      return JSON.parse(raw);
    } catch {
      return { kind: 'SERVICE', serviceId: 'svc-outbox-test' };
    }
  }

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
}

/* ─────────────────────────────────────────────────────────────────────────
 * §3. Helpers
 * ───────────────────────────────────────────────────────────────────────── */

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** Maximum pageSize to prevent unbounded memory load. */
const MAX_PAGE_SIZE = 100;

/** Valid reconciliation statuses. */
const VALID_RECONCILIATION_STATUSES = [
  'PENDING_INVESTIGATION',
  'INVESTIGATING',
  'RESOLVED_CONFIRMED',
  'RESOLVED_FAILED',
  'RESOLVED_RETRY',
] as const;

/** Valid resolution kinds. */
const VALID_RESOLUTION_KINDS = ['CONFIRMED', 'FAILED', 'RETRY'] as const;

/**
 * Sanitize entry for API response — remove internal fields.
 */
function sanitizeEntry(entry: ReconciliationEntry): Record<string, unknown> {
  return {
    entryId: entry.entryId,
    organizationId: entry.organizationId,
    intentId: entry.intentId,
    receiptId: entry.receiptId,
    status: entry.status,
    reasonCode: entry.reasonCode,
    investigationNote: entry.investigationNote,
    investigatorActor: entry.investigatorActor,
    investigatedAt: entry.investigatedAt,
    resolvedByActor: entry.resolvedByActor,
    resolvedAt: entry.resolvedAt,
    resolution: entry.resolution,
    resolutionNote: entry.resolutionNote,
    retryIdempotencyKey: entry.retryIdempotencyKey,
    aggregateVersion: entry.aggregateVersion,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

/**
 * Format actor as string for audit trail.
 */
function formatActor(actor: unknown): string {
  if (typeof actor === 'string') return actor;
  if (typeof actor === 'object' && actor !== null) {
    const obj = actor as Record<string, unknown>;
    const parts: string[] = [String(obj['kind'] ?? 'UNKNOWN')];
    if ('serviceId' in obj && obj['serviceId']) parts.push(String(obj['serviceId']));
    else if ('userId' in obj && obj['userId']) parts.push(String(obj['userId']));
    return parts.join(':');
  }
  return 'UNKNOWN';
}
