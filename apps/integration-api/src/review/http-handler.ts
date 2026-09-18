// src/review/http-handler.ts — HTTP handler for review endpoints (CORE/1.7).
//
// Wires ReviewService into integration-api HTTP server.
// Routes: GET /mock/review/list, GET /mock/review/detail,
//         POST /mock/review/decide, POST /mock/review/link,
//         POST /mock/review/unlink, POST /mock/review/replay.
//
// Boundaries:
//  - Review routes are mock-only (not in contracts freeze).
//  - Actor claim comes from request envelope (trusted boundary).
//  - PII guard enforced at output transform (no fullName/phone).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ReviewService, ReviewServiceError } from './review-service.js';

export interface ReviewHttpHandlerOptions {
  service: ReviewService;
  /** Organization ID from config (validated at startup). */
  organizationId: string;
}

export class ReviewHttpHandler {
  constructor(private readonly opts: ReviewHttpHandlerOptions) {}

  handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';
    const path = url.split('?')[0] ?? '/';
    const method = req.method ?? 'GET';
    const segments = path.split('/').filter(Boolean);

    if (segments[0] !== 'mock' || segments[1] !== 'review') {
      return; // Not a review route
    }

    const action = segments[2];
    try {
      if (action === 'list' && method === 'GET') {
        return void this.handleList(req, res);
      }
      if (action === 'detail' && method === 'GET') {
        return void this.handleDetail(req, res, segments[3]);
      }
      if (action === 'decide' && method === 'POST') {
        return void this.handleDecide(req, res);
      }
      if (action === 'link' && method === 'POST') {
        return void this.handleLink(req, res);
      }
      if (action === 'unlink' && method === 'POST') {
        return void this.handleUnlink(req, res);
      }
      if (action === 'replay' && method === 'POST') {
        return void this.handleReplay(req, res);
      }
      return respondJson(res, 404, { error: 'route_not_found', path });
    } catch (err) {
      const isReviewError = err instanceof Error && err.name === 'ReviewServiceError';
      const svcErr = isReviewError ? (err as ReviewServiceError) : null;
      // Map error codes to HTTP status codes.
      let status = 500;
      if (isReviewError) {
        if (svcErr!.code === 'NOT_FOUND') status = 404;
        else if (svcErr!.code === 'FORBIDDEN' || svcErr!.code === 'VALIDATION_ERROR' || svcErr!.code === 'VERSION_CONFLICT') status = 403;
        else if (svcErr!.code === 'UNAUTHORIZED') status = 401;
      }
      return respondJson(res, status, {
        error: isReviewError ? svcErr!.message : String(err),
        code: isReviewError ? svcErr!.code : 'INTERNAL_ERROR',
      });
    }
  }

  /** Extract actor from request envelope header (trusted boundary). */
  private extractActor(req: IncomingMessage): unknown {
    const actorHeader = req.headers['x-review-actor'];
    if (!actorHeader) {
      // Default: HRP_UI reviewer actor for synthetic testing.
      return { kind: 'SERVICE', serviceId: 'svc-review-test' };
    }
    try {
      const raw = Array.isArray(actorHeader)
        ? (actorHeader[0] ?? 'null')
        : actorHeader;
      return JSON.parse(raw);
    } catch {
      return { kind: 'SERVICE', serviceId: 'svc-review-test' };
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

  private handleList(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? 'http://localhost/', 'http://localhost/');
    const actor = this.extractActor(req);
    const status = url.searchParams.get('status') ?? undefined;
    const cursor = url.searchParams.get('cursor') ?? undefined;
    // Clamp pageSize to prevent unbounded memory load (CORE/1.7 audit M1).
    const rawPageSize = url.searchParams.get('pageSize');
    let pageSize: number | undefined;
    if (rawPageSize !== null && rawPageSize !== '') {
      const parsed = Number(rawPageSize);
      pageSize = Number.isFinite(parsed) && parsed > 0
        ? Math.min(parsed, MAX_PAGE_SIZE)
        : undefined;
    }

    try {
      const result = this.opts.service.listReviews(actor, this.opts.organizationId, {
        status,
        cursor,
        pageSize,
      });
      respondJson(res, 200, result);
    } catch (err) {
      respondServiceError(res, err);
    }
  }

  private handleDetail(req: IncomingMessage, res: ServerResponse, _idFromPath?: string): void {
    // Support both path param (GET /mock/review/detail/rev-0001) and query param (GET /mock/review/detail?id=rev-0001).
    const url = new URL(req.url ?? 'http://localhost/', 'http://localhost/');
    const id = _idFromPath ?? url.searchParams.get('id');
    if (!id) {
      respondJson(res, 400, { error: 'missing reviewEntryId (path param or ?id= query param)' });
      return;
    }
    const actor = this.extractActor(req);
    try {
      const result = this.opts.service.getReviewDetail(actor, this.opts.organizationId, id);
      respondJson(res, 200, result);
    } catch (err) {
      respondServiceError(res, err);
    }
  }

  private handleDecide(req: IncomingMessage, res: ServerResponse): void {
    this.parseBody(req).then((raw) => {
      const body = raw as Record<string, unknown>;
      const actor = this.extractActor(req);
      const reviewEntryId = body['reviewEntryId'] as string;
      const kind = body['kind'] as string;
      const reason = body['reason'] as string;
      const expectedEntryVersion = body['expectedEntryVersion'] as number;

      if (!reviewEntryId || !kind || !reason || expectedEntryVersion === undefined) {
        respondJson(res, 400, {
          error: 'VALIDATION_ERROR',
          message: 'Missing required fields: reviewEntryId, kind, reason, expectedEntryVersion',
        });
        return;
      }

      try {
        const result = this.opts.service.submitDecision(actor, this.opts.organizationId, reviewEntryId, {
          kind,
          reason,
          expectedEntryVersion,
        });
        respondJson(res, 200, result);
      } catch (err) {
        respondServiceError(res, err);
      }
    }).catch((err) => {
      respondJson(res, 400, { error: 'invalid_json', message: String(err) });
    });
  }

  private handleLink(req: IncomingMessage, res: ServerResponse): void {
    this.parseBody(req).then((raw) => {
      const body = raw as Record<string, unknown>;
      const actor = this.extractActor(req);
      const reviewEntryId = body['reviewEntryId'] as string;
      const targetKind = body['targetKind'] as string;
      const targetRef = body['targetRef'] as string;
      const label = body['label'] as string;

      if (!reviewEntryId || !targetKind || !targetRef || !label) {
        respondJson(res, 400, {
          error: 'VALIDATION_ERROR',
          message: 'Missing required fields: reviewEntryId, targetKind, targetRef, label',
        });
        return;
      }

      try {
        const result = this.opts.service.linkTarget(actor, this.opts.organizationId, reviewEntryId, {
          targetKind,
          targetRef,
          label,
        });
        respondJson(res, 200, result);
      } catch (err) {
        respondServiceError(res, err);
      }
    }).catch((err) => {
      respondJson(res, 400, { error: 'invalid_json', message: String(err) });
    });
  }

  private handleUnlink(req: IncomingMessage, res: ServerResponse): void {
    this.parseBody(req).then((raw) => {
      const body = raw as Record<string, unknown>;
      const actor = this.extractActor(req);
      const reviewEntryId = body['reviewEntryId'] as string;
      const linkId = body['linkId'] as string;

      if (!reviewEntryId || !linkId) {
        respondJson(res, 400, {
          error: 'VALIDATION_ERROR',
          message: 'Missing required fields: reviewEntryId, linkId',
        });
        return;
      }

      try {
        const result = this.opts.service.unlinkTarget(actor, this.opts.organizationId, reviewEntryId, linkId);
        respondJson(res, 200, result);
      } catch (err) {
        respondServiceError(res, err);
      }
    }).catch((err) => {
      respondJson(res, 400, { error: 'invalid_json', message: String(err) });
    });
  }

  private handleReplay(req: IncomingMessage, res: ServerResponse): void {
    this.parseBody(req).then((raw) => {
      const body = raw as Record<string, unknown>;
      const actor = this.extractActor(req);
      const reviewEntryId: string = (body['reviewEntryId'] as string) ?? '';
      const checkpointState = (body['checkpointState'] as string | undefined) ?? '';
      const checkpointDigest = (body['checkpointDigest'] as string | undefined) ?? '';
      const checkpointCanonicalId = body['checkpointCanonicalId'] as string | undefined;
      const checkpointCanonicalVersion = body['checkpointCanonicalVersion'] as number | undefined;
      const appliedSteps = (body['appliedSteps'] as string[]) ?? [];

      if (!reviewEntryId || !checkpointState || !checkpointDigest) {
        respondJson(res, 400, {
          error: 'VALIDATION_ERROR',
          message: 'Missing required fields: reviewEntryId, checkpointState, checkpointDigest',
        });
        return;
      }

      try {
        const result = this.opts.service.replayReview(actor, this.opts.organizationId, reviewEntryId, {
          state: checkpointState ?? '',
          draftDigest: checkpointDigest ?? '',
          ...(checkpointCanonicalId !== undefined ? { canonicalId: checkpointCanonicalId } : {}),
          ...(checkpointCanonicalVersion !== undefined ? { canonicalVersion: checkpointCanonicalVersion } : {}),
          appliedSteps,
        });
        respondJson(res, 200, result);
      } catch (err) {
        respondServiceError(res, err);
      }
    }).catch((err) => {
      respondJson(res, 400, { error: 'invalid_json', message: String(err) });
    });
  }
}

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** Maximum pageSize to prevent unbounded memory load (CORE/1.7 audit M1). */
const MAX_PAGE_SIZE = 100;

/**
 * Map ReviewServiceError to HTTP status and respond.
 * Used inside .then() callbacks to catch synchronous service throws
 * and inside sync GET handlers (CORE/1.7 audit C2/H5 — DRY + boundary).
 */
function respondServiceError(res: ServerResponse, err: unknown): void {
  const isReviewError = err instanceof Error && err.name === 'ReviewServiceError';
  const svcErr = isReviewError ? (err as ReviewServiceError) : null;
  let status = 500;
  if (isReviewError) {
    if (svcErr!.code === 'NOT_FOUND') status = 404;
    else if (
      svcErr!.code === 'FORBIDDEN' ||
      svcErr!.code === 'VALIDATION_ERROR' ||
      svcErr!.code === 'VERSION_CONFLICT'
    )
      status = 403;
    else if (svcErr!.code === 'UNAUTHORIZED') status = 401;
  }
  respondJson(res, status, {
    error: isReviewError ? `${svcErr!.code}: ${svcErr!.message}` : String(err),
    code: isReviewError ? svcErr!.code : 'INTERNAL_ERROR',
  });
}
