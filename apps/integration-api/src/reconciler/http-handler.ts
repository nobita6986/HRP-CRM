// src/reconciler/http-handler.ts — HTTP handler for reconciler mock routes (CORE/1.8 AC5).
//
// AC5 HTTP routes:
//   GET  /mock/reconciler/stuck              — list stuck items detected
//   POST /mock/reconciler/recover           — trigger recovery for specific item
//   GET  /mock/reconciler/recovery-actions  — list recovery actions
//
// All routes are mock/synthetic only — they do NOT call real providers or HRP core DB.
// They operate on the integration store ONLY.
//
// Authorization: no auth required for mock routes (synthetic, dev/test only).

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PrismaClient } from '@prisma/client';
import { findStuckReceipts, findStuckIntents, listRecoveryActions } from '@hrp-engagement/integration-store';
import { ReconciliationScheduler } from './reconciliation-scheduler.js';
import { recoverReceipt } from './stuck-receipt-reconciler.js';
import { recoverIntent } from './stuck-intent-reconciler.js';

export interface ReconcilerHttpHandlerDeps {
  /** Prisma client for integration store. */
  prisma: PrismaClient;
  /** Organization ID for scoping queries. */
  organizationId?: string;
  /** Optional pre-configured scheduler. If not provided, a default one is created. */
  scheduler?: ReconciliationScheduler;
}

// Singleton scheduler per handler instance.
function getOrCreateScheduler(handler: ReconciliationHttpHandler): ReconciliationScheduler {
  if (!handler._scheduler) {
    handler._scheduler = new ReconciliationScheduler({
      prisma: handler._prisma,
      schedulerId: `http-${Date.now().toString(36)}`,
    });
  }
  return handler._scheduler;
}

/**
 * ReconciliationHttpHandler — handles /mock/reconciler/* HTTP routes.
 *
 * Routes:
 *   GET  /mock/reconciler/stuck              — list stuck receipts and intents
 *   POST /mock/reconciler/recover           — trigger recovery for a specific item
 *   GET  /mock/reconciler/recovery-actions  — list recovery actions
 *   POST /mock/reconciler/scan              — trigger immediate reconciliation scan
 *   GET  /mock/reconciler/stats             — get scheduler stats
 */
export class ReconciliationHttpHandler {
  public readonly _prisma: PrismaClient;
  public readonly organizationId: string;
  public _scheduler: ReconciliationScheduler | null = null;

  constructor(deps: ReconcilerHttpHandlerDeps) {
    this._prisma = deps.prisma;
    this.organizationId = deps.organizationId ?? 'default-org';
    if (deps.scheduler) {
      this._scheduler = deps.scheduler;
    }
  }

  private get scheduler(): ReconciliationScheduler {
    return getOrCreateScheduler(this);
  }

  /**
   * Handle an incoming HTTP request.
   *
   * Routes:
   *   GET  /mock/reconciler/stuck              → listStuckItems()
   *   POST /mock/reconciler/recover           → triggerRecovery()
   *   GET  /mock/reconciler/recovery-actions  → listRecoveryActions()
   *   POST /mock/reconciler/scan              → triggerScan()
   *   GET  /mock/reconciler/stats             → getStats()
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const path: string = url.split('?')[0] ?? '/';
    const pathSegments = path.split('/').filter(Boolean);

    // Expected: /mock/reconciler/<action>
    if (pathSegments[0] !== 'mock' || pathSegments[1] !== 'reconciler') {
      return respondJson(res, 404, { error: 'not_found', path });
    }

    const action = pathSegments[2];

    switch (action) {
      case 'stuck':
        if (req.method === 'GET') {
          return this.listStuckItems(req, res);
        }
        break;
      case 'recover':
        if (req.method === 'POST') {
          return this.triggerRecovery(req, res);
        }
        break;
      case 'recovery-actions':
        if (req.method === 'GET') {
          return this.listRecoveryActionsHttp(req, res);
        }
        break;
      case 'scan':
        if (req.method === 'POST') {
          return this.triggerScan(req, res);
        }
        break;
      case 'stats':
        if (req.method === 'GET') {
          return this.getStats(req, res);
        }
        break;
    }

    return respondJson(res, 404, {
      error: 'not_found',
      path,
      hint: 'Known routes: GET /mock/reconciler/stuck, POST /mock/reconciler/recover, GET /mock/reconciler/recovery-actions, POST /mock/reconciler/scan, GET /mock/reconciler/stats',
    });
  }

  // ─── GET /mock/reconciler/stuck ───────────────────────────────

  private async listStuckItems(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const actor = 'http-handler';

    const [stuckReceipts, stuckIntents] = await Promise.all([
      findStuckReceipts(this._prisma, {
        organizationId: this.organizationId,
        limit: 100,
      }),
      findStuckIntents(this._prisma, {
        organizationId: this.organizationId,
        limit: 100,
      }),
    ]);

    return respondJson(res, 200, {
      status: 'ok',
      organizationId: this.organizationId,
      stuckReceipts: stuckReceipts.map((r) => ({
        receiptId: r.receiptId,
        organizationId: r.organizationId,
        provider: r.provider,
        connectionId: r.connectionId,
        eventId: r.eventId,
        state: r.state,
        leaseExpiresAt: r.leaseExpiresAt?.toISOString() ?? null,
        leaseOwner: r.leaseOwner,
        attempts: r.attempts,
      })),
      stuckIntents: stuckIntents.map((i) => ({
        intentId: i.intentId,
        receiptId: i.receiptId,
        organizationId: i.organizationId,
        status: i.status,
        leaseExpiresAt: i.leaseExpiresAt?.toISOString() ?? null,
        leaseOwner: i.leaseOwner,
        attempts: i.attempts,
      })),
      summary: {
        stuckReceiptCount: stuckReceipts.length,
        stuckIntentCount: stuckIntents.length,
      },
      note: 'These items have LEASED state with expired lease — candidates for reconciliation',
    });
  }

  // ─── POST /mock/reconciler/recover ──────────────────────────

  private async triggerRecovery(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return respondJson(res, 400, { error: 'invalid_json', message: 'Request body must be JSON' });
    }

    const input = parsed as Record<string, unknown>;
    const itemType = input['itemType'] as string | undefined;
    const itemId = input['itemId'] as string | undefined;
    const actor = (input['actor'] as string | undefined) ?? `manual:${Date.now().toString(36)}`;

    if (!itemType || !itemId) {
      return respondJson(res, 400, {
        error: 'validation_error',
        message: 'itemType and itemId are required',
        example: { itemType: 'RECEIPT', itemId: 'rcpt-abc123' },
      });
    }

    if (itemType !== 'RECEIPT' && itemType !== 'INTENT') {
      return respondJson(res, 400, {
        error: 'validation_error',
        message: 'itemType must be RECEIPT or INTENT',
      });
    }

    try {
      if (itemType === 'RECEIPT') {
        const result = await recoverReceipt(this._prisma, itemId, actor);
        return respondJson(res, 200, {
          status: 'ok',
          itemType,
          itemId,
          result,
          note: 'Recovery action created; item reset if it was stuck',
        });
      } else {
        const result = await recoverIntent(this._prisma, itemId, actor);
        return respondJson(res, 200, {
          status: 'ok',
          itemType,
          itemId,
          result,
          note: 'Recovery action created; intent reset if it was stuck',
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return respondJson(res, 500, {
        error: 'recovery_failed',
        itemType,
        itemId,
        message: msg,
      });
    }
  }

  // ─── GET /mock/reconciler/recovery-actions ───────────────────

  private async listRecoveryActionsHttp(
    _req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(_req.url ?? '/', 'http://localhost');
    const status = url.searchParams.get('status') as 'PENDING' | 'APPLIED' | 'SKIPPED' | 'FAILED' | null;
    const itemType = url.searchParams.get('itemType') as 'RECEIPT' | 'INTENT' | 'MAPPING' | null;
    const limit = Math.min(Number.parseInt(url.searchParams.get('limit') ?? '50', 10), 200);

    const actions = await listRecoveryActions(this._prisma, {
      status: status ?? undefined,
      itemType: itemType ?? undefined,
      limit,
    });

    return respondJson(res, 200, {
      status: 'ok',
      count: actions.length,
      actions: actions.map((a) => ({
        recoveryId: a.recoveryId,
        itemType: a.itemType,
        itemId: a.itemId,
        action: a.action,
        actor: a.actor,
        status: a.status,
        createdAt: a.createdAt.toISOString(),
        completedAt: a.completedAt?.toISOString() ?? null,
        reason: a.reason,
        snapshotJson: a.snapshotJson,
      })),
    });
  }

  // ─── POST /mock/reconciler/scan ──────────────────────────────

  private async triggerScan(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const result = await this.scheduler.runScan();
      return respondJson(res, 200, {
        status: 'ok',
        schedulerId: this.scheduler.getSchedulerId(),
        scannedAt: result.stats.lastScanAt,
        receiptResults: result.receiptResults,
        intentResults: result.intentResults,
        stats: result.stats,
        note: 'Reconciliation scan completed; stuck items reset to PENDING',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return respondJson(res, 500, {
        error: 'scan_failed',
        message: msg,
      });
    }
  }

  // ─── GET /mock/reconciler/stats ──────────────────────────────

  private getStats(_req: IncomingMessage, res: ServerResponse): void {
    const stats = this.scheduler.getStats();
    return respondJson(res, 200, {
      status: 'ok',
      schedulerId: stats.schedulerId,
      isRunning: this.scheduler.isRunning(),
      stats,
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
