/**
 * integration-api/src/server.ts — CORE/1.0 + CORE/1.1 + CORE/1.2 + CORE/1.7 + CORE/1.8 HTTP API.
 *
 * CORE/1.0 boundaries:
 *  - Mock mode: `HRP_MOCK_MODE=deterministic` ở development; `off` ở production.
 *  - Startup guard: production + mock = STARTUP_BLOCKED.
 *  - Pin exact contracts version 0.0.8-g0.8-fixes.
 *  - Không import HRP Prisma client, không đặt HRP_DATABASE_URL.
 *  - Health tách `/health/live` (process alive) vs `/health/ready`
 *    (config loaded + pinned + mock đúng env).
 *
 * CORE/1.1 gateway mock:
 *  - Deterministic mock theo scenario ID (Backlog §Task 1.1).
 *  - Same (idempotencyKey, payloadDigest) → same result.
 *  - Same key + different payload → IDEMPOTENCY_CONFLICT.
 *  - correlationId KHÔNG tham gia cache (chỉ tracking).
 *  - Inject clock/IDs qua constructor (test injected từ startServer).
 *  - In-memory ledger; KHÔNG durable production.
 *  - Privileged merge capability giữ capability check (tier × method).
 *
 * CORE/1.2 webhook receiver:
 *  - POST /webhooks/:organizationId/:provider/:connectionId
 *  - 202 ONLY after durable receipt + intent commit (CORE/1.3 atomic tx).
 *  - Protocol fixture cô lập (CHATWOOT/ZALO_OA/GENERIC); KHÔNG tuyên bố
 *    đã xác minh provider thật.
 *  - HMAC verify allowlist (HMAC_SHA256 | HMAC_SHA512).
 *  - Scope from URL path ONLY; body scope spoof → 400.
 *  - Receiver crash sau commit trước khi gửi 202 → provider retry →
 *    commitReceiptWithIntents returns created:false → 202 vẫn OK (idempotent).
 *
 * CORE/1.7 review service skeleton:
 *  - Review HTTP routes via ReviewHttpHandler (/mock/review/*).
 *  - Permissions mock, server-side scope check, PII guard.
 *  - Decision with version/audit; stale version conflict.
 *  - Link/unlink/relink — NOT merge.
 *  - Replay revalidates against checkpoint (CORE/1.6).
 *
 * CORE/1.8 AC4 UNKNOWN delivery reconciliation:
 *  - Reconciliation HTTP routes via OutboxHttpHandler (/mock/outbox/*).
 *  - UNKNOWN delivery → INVESTIGATION_PENDING (NOT DELIVERED/FAILED).
 *  - ReconciliationEntry tracks investigation state.
 *  - Explicit resolution: CONFIRMED, FAILED, or RETRY.
 *  - NEVER auto-resolve UNKNOWN to DELIVERED.
 *
 * Boundaries (Owner 2026-09-15):
 *  - Không tự fake merge/Worker/EFFECTIVE từ chat.
 *  - Client domain, managed modes, EFFECTIVE vẫn PROPOSED/UNAVAILABLE.
 *  - Không HRP/provider/model thật; không normalize/domain orchestration
 *    của CORE/1.5.
 *  - Contracts đã FREEZE không sửa.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadConfig, assertNotProductionMock, type ApiConfig } from '@hrp-engagement/config';
import {
  HrpGatewayCallRequestSchema,
  createMockGateway,
  type MockGateway,
  type CallLogEntry,
} from './gateway/index.js';
import { Receiver } from './receiver/handler.js';
import { createPrismaClient, assertSafeDatabaseUrl } from '@hrp-engagement/integration-store';
import {
  ConnectionRegistry,
  loadConnectionRegistryFromEnv,
} from './receiver/connection-registry.js';
import { ReviewHttpHandler } from './review/http-handler.js';
import { ReviewService } from './review/index.js';
import { ReconciliationService } from './outbox/index.js';
import { UnknownDeliveryHandler } from './outbox/unknown-handler.js';
import { OutboxHttpHandler } from './outbox/http-handler.js';
import { ReconciliationHttpHandler } from './reconciler/http-handler.js';
import { DlqHttpHandler } from './dlq/http-handler.js';
import { DlqService } from './dlq/index.js';
import { Ac3HttpHandler } from './outbox/ac3-handler.js';
import {
  AutomationHttpHandler,
  type AutomationHttpHandlerDeps,
  buildAutomationHttpHandlerFromEnv,
  AUTOMATION_HTTP_HANDLER_VERSION,
} from './automation/http-handler.js';
import {
  AutomationServiceRegistry,
  loadAutomationRegistryFromEnv,
} from './automation/connection-registry.js';
import { KillSwitchStore } from './automation/kill-switch.js';
import { TokenBucketRateLimiter } from './automation/rate-limiter.js';
import { AutomationIdempotencyStore } from './automation/idempotency-store.js';
import { MockAutomationAdapter } from './automation/mock-adapter.js';

const VERSION = '1.2.0-core1.8';

/**
 * Singleton gateway instance per process — cho HTTP runtime.
 * Test code có thể inject qua `startServer({ gateway })`.
 */
let defaultGateway: MockGateway | null = null;
function getDefaultGateway(): MockGateway {
  if (!defaultGateway) {
    defaultGateway = createMockGateway();
  }
  return defaultGateway;
}

async function main(): Promise<void> {
  const env = process.env as Record<string, string | undefined>;

  // Startup guard: chặn mock ở production.
  assertNotProductionMock(env);

  // Load config.
  const { config, mockAllowed, production, forbiddenFound } = loadConfig({
    env,
    kind: 'api',
  });
  if (forbiddenFound.length > 0) {
    throw new Error(`Forbidden env keys: ${forbiddenFound.join(', ')}`);
  }

  // Validate pinned contracts version.
  if (config.contractsVersion !== '0.0.8-g0.8-fixes') {
    throw new Error(
      `contractsVersion mismatch: expected 0.0.8-g0.8-fixes, got ${config.contractsVersion}`,
    );
  }

  if (config.appKind !== 'api') {
    throw new Error(`Expected api config, got ${config.appKind}`);
  }

  console.log(JSON.stringify({
    level: 'info',
    msg: 'integration-api starting',
    version: VERSION,
    appKind: config.appKind,
    nodeEnv: config.nodeEnv,
    production,
    mockAllowed,
    contractsVersion: config.contractsVersion,
    listen: config.listen,
  }));

  const server = await startServer(config);
  console.log(JSON.stringify({
    level: 'info',
    msg: 'integration-api listening',
    url: `http://${config.listen.host}:${config.listen.port}`,
  }));
}

/**
 * Start HTTP server với mock routes theo allowlist.
 *
 * @param config      API config (mockRoutes là allowlist).
 * @param opts.gateway  Inject gateway mock — test dùng gateway riêng; runtime dùng singleton.
 * @param opts.prisma   Inject Prisma client (cho CORE/1.2 receiver) — test inject.
 *                       Runtime: nếu không truyền, sẽ tạo từ process.env['DATABASE_URL']
 *                       (plain name, NOT HRP_DATABASE_URL = cấm).
 * @param opts.env      Inject env snapshot — test inject.
 * @param opts.reviewService   Inject review service (CORE/1.7).
 * @param opts.reconciliationService   Inject reconciliation service (CORE/1.8 AC4).
 * @param opts.unknownDeliveryHandler  Inject unknown delivery handler (CORE/1.8 AC4).
 * @param opts.outboxHandler   Inject outbox HTTP handler (CORE/1.8 AC4).
 * @param opts.dlqService   Inject DLQ service (CORE/1.8 AC2).
 */
export async function startServer(
  config: ApiConfig,
  opts?: {
    gateway?: MockGateway;
    prisma?: ReturnType<typeof createPrismaClient>;
    env?: Record<string, string | undefined>;
    reviewService?: ReviewService;
    reconciliationService?: ReconciliationService;
    unknownDeliveryHandler?: UnknownDeliveryHandler;
    outboxHandler?: OutboxHttpHandler;
    dlqService?: DlqService;
    automationHandler?: AutomationHttpHandler;
  },
): Promise<ReturnType<typeof createServer>> {
  const { listen, mockRoutes, receiver } = config;
  const routeAllowlist = new Set(['/health/live', '/health/ready', ...mockRoutes]);
  const gateway = opts?.gateway ?? getDefaultGateway();
  const env = opts?.env ?? (process.env as Record<string, string | undefined>);

  // CORE/1.2 — connection registry (Auditor F1 + F2).
  // Resolved server-side từ env (synthetic); URL path KHÔNG đáng tin.
  const registry = new ConnectionRegistry(loadConnectionRegistryFromEnv(env));

  // CORE/1.2 — construct receiver with optional Prisma.
  let prisma: ReturnType<typeof createPrismaClient> | null = opts?.prisma ?? null;
  if (!prisma && receiver.enabled) {
    const dbUrl = env['DATABASE_URL'];
    if (dbUrl) {
      assertSafeDatabaseUrl(dbUrl);
      prisma = createPrismaClient({ databaseUrl: dbUrl });
    }
  }

  const receiverInstance = new Receiver(prisma, receiver, registry);

  // CORE/1.7 — review service and HTTP handler.
  const reviewService = opts?.reviewService ?? new ReviewService();
  const reviewHandler = new ReviewHttpHandler({
    service: reviewService,
    organizationId: config.organizationId,
  });

  // CORE/1.8 AC4 — outbox reconciliation service and handler.
  // Requires Prisma client — skip if not available.
  let reconciliationService: ReconciliationService | null = null;
  let unknownDeliveryHandler: UnknownDeliveryHandler | null = null;
  let outboxHandler: OutboxHttpHandler | null = null;
  let ac3Handler: Ac3HttpHandler | null = null;

  if (prisma) {
    reconciliationService = opts?.reconciliationService ?? new ReconciliationService(prisma, {
      organizationId: config.organizationId,
    });
    unknownDeliveryHandler = opts?.unknownDeliveryHandler ?? new UnknownDeliveryHandler(
      prisma,
      reconciliationService,
      config.organizationId,
    );
    outboxHandler = opts?.outboxHandler ?? new OutboxHttpHandler({
      reconciliationService,
      unknownDeliveryHandler,
      organizationId: config.organizationId,
    });
    // CORE/1.8 AC3 — outbox AC3 HTTP handler (intent/receipt/report routes)
    ac3Handler = new Ac3HttpHandler({
      prisma,
      organizationId: config.organizationId,
    });
  }

  // CORE/1.8 AC5 — reconciliation HTTP handler for stuck receipts/intents.
  // Works without Prisma if receiver is disabled (reads integration store only).
  const reconcilerHandler = prisma
    ? new ReconciliationHttpHandler({
        prisma,
        organizationId: config.organizationId,
      })
    : null;

  // CORE/1.8 AC2 — DLQ service and HTTP handler.
  // Requires Prisma client for DLQ operations.
  const dlqService = opts?.dlqService ?? null;
  const dlqHandler = dlqService
    ? new DlqHttpHandler({
        service: dlqService,
        organizationId: config.organizationId,
      })
    : null;

  // N8N/0.3 — automation gateway HTTP route.
  //
  // Local runtime assembly (C-02): when the caller has NOT injected a
  // pre-built handler (test path), AND nodeEnv != 'production' AND
  // HRP_MOCK_MODE is 'deterministic' AND HRP_AUTOMATION_SERVICES (or
  // any HRP_AUTOMATION_SERVICE_<N>) is configured with at least one
  // NON-EXPIRED entry, server-side automatically assembles a handler
  // from env. Production / off mode / empty / malformed / expired
  // env keeps the route unmounted (fail closed). Pre-built handler
  // injection continues to work for tests.
  const automationHandler =
    opts?.automationHandler ?? assembleAutomationHandlerFromEnv(env, config);

  const server = createServer((req, res) => {
    void handleRequest(
      req,
      res,
      routeAllowlist,
      config,
      gateway,
      receiverInstance,
      reviewHandler,
      outboxHandler,
      reconcilerHandler,
      dlqHandler,
      ac3Handler,
      automationHandler,
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(listen.port, listen.host, () => resolve());
  });

  return server;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  routeAllowlist: Set<string>,
  config: ApiConfig,
  gateway: MockGateway,
  receiver: Receiver,
  reviewHandler: ReviewHttpHandler,
  outboxHandler: OutboxHttpHandler | null,
  reconcilerHandler: ReconciliationHttpHandler | null,
  dlqHandler: DlqHttpHandler | null,
  ac3Handler: Ac3HttpHandler | null,
  automationHandler: AutomationHttpHandler | null,
): Promise<void> {
  const url = req.url ?? '/';
  const path: string = url.split('?')[0] ?? '/';
  const pathSegments = path.split('/').filter(Boolean);

  // Health: tách live vs ready.
  if (path === '/health/live') {
    return respondJson(res, 200, {
      status: 'live',
      version: VERSION,
      pid: process.pid,
    });
  }

  if (path === '/health/ready') {
    const ready = {
      status: 'ready',
      version: VERSION,
      configLoaded: true,
      contractsVersion: config.contractsVersion,
      mockMode: config.mockMode,
      production: config.nodeEnv === 'production',
      dependenciesConnected: false,
      receiverEnabled: config.receiver.enabled,
    };
    return respondJson(res, 200, ready);
  }

  // CORE/1.2 — webhook receiver route.
  if (pathSegments[0] === 'webhooks' && req.method === 'POST') {
    // Pre-check body size from Content-Length header (fast reject before read).
    const contentLength = req.headers['content-length'];
    if (contentLength) {
      const declared = Number.parseInt(contentLength, 10);
      if (
        Number.isFinite(declared) &&
        declared > config.receiver.maxBodyBytes
      ) {
        return respondJson(res, 413, {
          status: 'rejected',
          code: 'payload_too_large',
          message: `Content-Length ${declared} vượt maxBodyBytes=${config.receiver.maxBodyBytes}`,
          retryable: false,
        });
      }
    }
    const rawBody = await readBodyBytes(req, config.receiver.maxBodyBytes);
    if (rawBody.byteLength > config.receiver.maxBodyBytes) {
      return respondJson(res, 413, {
        status: 'rejected',
        code: 'payload_too_large',
        message: `Body ${rawBody.byteLength}B vượt maxBodyBytes=${config.receiver.maxBodyBytes}`,
        retryable: false,
      });
    }
    await receiver.handleRequest(req, res, pathSegments, rawBody);
    return;
  }

  // CORE/1.1 + Owner guard — /mock/gateway/* phải chặn khi mockMode='off'.
  // Áp dụng cho cả /mock/gateway/call (POST) và /mock/gateway/log (GET).
  // Auditor CHANGES_REQUIRED cho CORE/1.2 — guard là delta boundary
  // đã chỉ rõ; KHÔNG tự đóng toàn CORE/1.1 vì sửa một guard.
  const isMockGatewayRoute =
    path === '/mock/gateway/call' || path === '/mock/gateway/log';
  if (isMockGatewayRoute && config.mockMode === 'off') {
    return respondJson(res, 404, {
      error: 'mock_disabled',
      path,
      message:
        '/mock/gateway/* chặn khi HRP_MOCK_MODE=off (CORE/1.2 guard). ' +
        'Các route mock chỉ có hiệu lực ở HRP_MOCK_MODE=deterministic.',
    });
  }

  // Gateway mock routes (CORE/1.1).
  if (path === '/mock/gateway/call' && req.method === 'POST') {
    return handleGatewayCall(req, res, gateway);
  }
  if (path === '/mock/gateway/log' && req.method === 'GET') {
    return handleGatewayLog(res, gateway);
  }

  // CORE/1.7 review routes — block when mockMode='off'.
  // F1 fix: guard before calling reviewHandler; consistent with CORE/1.2 gateway guard.
  // - audit: /mock/review/* chỉ mock (CORE/1.7 boundary hardening).
  // - Guard must be server-side (not inside handler) because:
  //   (a) actor header trust is out-of-scope for boundary fix;
  //   (b) handler/service should never be reachable in production mock=off.
  //   (c) consistent behavior with /mock/gateway/* guard pattern.
  const segments = path.split('/').filter(Boolean);
  if (segments[0] === 'mock' && segments[1] === 'review') {
    if (config.mockMode === 'off') {
      return respondJson(res, 404, {
        error: 'mock_disabled',
        path,
        message:
          '/mock/review/* chặn khi HRP_MOCK_MODE=off. ' +
          'Review routes chỉ có hiệu lực ở HRP_MOCK_MODE=deterministic.',
      });
    }
    // Mock mode enabled: delegate to review handler.
    return reviewHandler.handle(req, res);
  }

  // CORE/1.8 AC4 — outbox/reconciliation routes — block when mockMode='off'.
  // - audit: /mock/outbox/* chỉ mock (CORE/1.8 AC4 boundary).
  // - Guard must be server-side (consistent with /mock/gateway/* and /mock/review/*).
  if (segments[0] === 'mock' && segments[1] === 'outbox') {
    // AC3 routes: /mock/outbox/intent, /mock/outbox/receipt, /mock/outbox/report
    const ac3Path = segments[2];
    if (ac3Path === 'intent' || ac3Path === 'receipt' || ac3Path === 'report') {
      if (config.mockMode === 'off') {
        return respondJson(res, 404, {
          error: 'mock_disabled',
          path,
          message:
            '/mock/outbox/intent|receipt|report chỉ có hiệu lực ở HRP_MOCK_MODE=deterministic.',
        });
      }
      if (!ac3Handler) {
        return respondJson(res, 503, {
          error: 'outbox_not_configured',
          message: 'Outbox AC3 handler chưa được cấu hình. Cần DATABASE_URL.',
        });
      }
      return ac3Handler.handle(req, res);
    }

    // AC4 routes: /mock/outbox/reconciliation/* or /mock/outbox/unknown/*
    if (config.mockMode === 'off') {
      return respondJson(res, 404, {
        error: 'mock_disabled',
        path,
        message:
          '/mock/outbox/* chỉ có hiệu lực ở HRP_MOCK_MODE=deterministic.',
      });
    }
    // Mock mode enabled: delegate to outbox handler (requires Prisma).
    if (!outboxHandler) {
      return respondJson(res, 503, {
        error: 'outbox_not_configured',
        message:
          'Outbox handler chưa được cấu hình. Cần DATABASE_URL để khởi tạo reconciliation service.',
      });
    }
    return outboxHandler.handle(req, res);
  }

  // Mock route prefix allowlist (e.g. /mock/integration match /mock/integration/*).
  const mockRoute = config.mockRoutes.find((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  if (mockRoute) {
    return respondJson(res, 200, {
      status: 'mock',
      path,
      method: req.method,
      note: 'mock integration endpoint (CORE/1.0); không gọi HRP core thật.',
    });
  }

  // Health-only routes (live/ready) are always allowed.
  if (routeAllowlist.has(path)) {
    return respondJson(res, 200, { status: 'mock', path });
  }

  // CORE/1.8 AC2 — DLQ routes — block when mockMode='off'.
  // - audit: /mock/dlq/* chỉ mock (CORE/1.8 AC2 boundary).
  // - Guard must be server-side (consistent with /mock/gateway/* and /mock/review/*).
  if (segments[0] === 'mock' && segments[1] === 'dlq') {
    if (config.mockMode === 'off') {
      return respondJson(res, 404, {
        error: 'mock_disabled',
        path,
        message:
          '/mock/dlq/* chặn khi HRP_MOCK_MODE=off. ' +
          'DLQ routes chỉ có hiệu lực ở HRP_MOCK_MODE=deterministic.',
      });
    }
    if (!dlqHandler) {
      return respondJson(res, 503, {
        error: 'dlq_not_configured',
        message:
          'DLQ service chưa được inject. Cần truyền dlqService khi startServer.',
      });
    }
    return dlqHandler.handle(req, res);
  }

  // CORE/1.8 AC5 — Reconciler routes for stuck receipts/intents.
  // - audit: /mock/reconciler/* chỉ mock (CORE/1.8 AC5 boundary).
  // - Guard must be server-side (consistent with /mock/gateway/* and /mock/review/*).
  if (segments[0] === 'mock' && segments[1] === 'reconciler') {
    if (config.mockMode === 'off') {
      return respondJson(res, 404, {
        error: 'mock_disabled',
        path,
        message:
          '/mock/reconciler/* chặn khi HRP_MOCK_MODE=off. ' +
          'Reconciler routes chỉ có hiệu lực ở HRP_MOCK_MODE=deterministic.',
      });
    }
    if (!reconcilerHandler) {
      return respondJson(res, 503, {
        error: 'reconciler_not_configured',
        message:
          'Reconciler handler chưa được cấu hình. Cần DATABASE_URL để khởi tạo Prisma client.',
      });
    }
    return reconcilerHandler.handle(req, res);
  }

  // N8N/0.3 — /v1/automation/* automation gateway HTTP route.
  // The handler itself enforces: route enabled, registry configured,
  // mockMode not off. It returns 404 when disabled so the route is
  // never observable in production unless explicitly mounted.
  if (segments[0] === 'v1' && segments[1] === 'automation') {
    if (!automationHandler) {
      return respondJson(res, 404, {
        error: 'route_not_mounted',
        path,
        message:
          '/v1/automation/* chưa được mount. N8N/0.3 boundary chỉ enable khi automationHandler được inject.',
      });
    }
    return automationHandler.handle(req, res, segments);
  }

  return respondJson(res, 404, {
    error: 'route_not_found',
    path,
    allowedRoutes: Array.from(routeAllowlist),
  });
}

/**
 * POST /mock/gateway/call — gateway mock entry.
 *
 * Body: HrpGatewayCallRequest (strict). Validate qua Zod schema; reject
 * malformed request với VALIDATION_ERROR (đóng gói trong FAILED response).
 */
async function handleGatewayCall(
  req: IncomingMessage,
  res: ServerResponse,
  gateway: MockGateway,
): Promise<void> {
  const rawBody = await readBody(req);
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return respondJson(res, 400, {
      status: 'FAILED',
      error: 'invalid_json',
      message: 'Request body không parse được JSON',
    });
  }

  const validation = HrpGatewayCallRequestSchema.safeParse(parsed);
  if (!validation.success) {
    return respondJson(res, 400, {
      status: 'FAILED',
      error: 'validation_error',
      issues: validation.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }

  const result = await gateway.call(validation.data);
  return respondJson(res, 200, result);
}

/**
 * GET /mock/gateway/log — read call log (snapshot, read-only).
 */
function handleGatewayLog(res: ServerResponse, gateway: MockGateway): void {
  const log: ReadonlyArray<CallLogEntry> = gateway.readLog();
  return respondJson(res, 200, {
    status: 'ok',
    count: log.length,
    entries: log,
    note: 'In-memory call log; KHÔNG durable production. Restart process sẽ mất log.',
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * CORE/1.2 — Read raw body as Uint8Array, reject if exceeds maxBytes
 * (defense in depth vs Content-Length spoofing).
 */
function readBodyBytes(req: IncomingMessage, maxBytes: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

// Auto-start chỉ khi run trực tiếp (không khi import cho test).
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('server.js') ||
    process.argv[1].endsWith('server.ts') ||
    process.argv[1].endsWith('server.mjs'));
if (isDirectRun) {
  main().catch((err) => {
    console.error(JSON.stringify({
      level: 'error',
      msg: 'integration-api startup failed',
      error: err instanceof Error ? err.message : String(err),
    }));
    process.exit(1);
  });
}

export { VERSION };

/* -------------------------------------------------------------------------- */
/* N8N/0.3 — runtime automation handler assembly                               */
/* -------------------------------------------------------------------------- */

/**
 * Try to assemble an AutomationHttpHandler from env. Returns null when
 * the local-runtime guard is not satisfied, when the env is malformed,
 * when the registry is empty, or when every entry is already expired.
 *
 * Local-runtime guard (C-02):
 *   - nodeEnv != 'production'
 *   - HRP_MOCK_MODE === 'deterministic'
 *   - registry has at least one non-expired entry after the env load
 *
 * Test injection path (startServer({ automationHandler })) is
 * unchanged: when present, the caller-supplied handler is used
 * verbatim.
 */
function assembleAutomationHandlerFromEnv(
  env: Record<string, string | undefined>,
  config: ApiConfig,
): AutomationHttpHandler | null {
  if (config.nodeEnv === 'production') return null;
  if (config.mockMode !== 'deterministic') return null;

  try {
    const entries = loadAutomationRegistryFromEnv(env);
    if (entries.length === 0) return null;
    // Trim entries that are already expired; only mount if at least
    // one is still valid.
    const now = Date.now();
    const valid = entries.filter((e) => e.expiresAt > now);
    if (valid.length === 0) return null;
    const registry = new AutomationServiceRegistry(valid);
    if (!registry.isConfigured()) return null;
    const deps = buildDefaultGatewayDeps();
    // Surface AUTOMATION_HTTP_HANDLER_VERSION for log/evidence of N8N/0.3.
    // The N8N boundary has its own version separate from the integration-api
    // VERSION; the latter is frozen to '1.2.0-core1.8' until CORE bumps.
    // Logged once at mount so operators can see what wire contract is live
    // without the value bleeding into /health/live or the public VERSION.
    console.log(
      `[integration-api] automation handler mounted: ${AUTOMATION_HTTP_HANDLER_VERSION}`,
    );
    return new AutomationHttpHandler({
      registry,
      gatewayDeps: deps,
      maxBodyBytes: 64 * 1024,
      mockMode: 'deterministic',
    });
  } catch {
    return null;
  }
}

/**
 * Build the default in-memory deps the local runtime uses for the
 * automation gateway. These are the same defaults tests use
 * (deterministic, in-memory; no DB; no Docker). Production NEVER
 * reaches this builder (see the production guard above).
 */
function buildDefaultGatewayDeps(): Omit<
  import('./automation/gateway.js').AutomationGatewayDeps,
  'registry'
> {
  // The runtime mock adapter seeds default fixtures keyed off a
  // synthetic org/conn. Real org/conn comes from the credential
  // registry on every invoke(); the adapter just needs *some*
  // baseline at construction.
  const baseOrg = 'org-runtime-default';
  const baseConn = 'conn-runtime-default';
  return {
    killSwitch: new KillSwitchStore(),
    rateLimiter: new TokenBucketRateLimiter({ capacity: 60, perMinute: 60 }),
    idempotency: new AutomationIdempotencyStore(),
    adapter: new MockAutomationAdapter({
      organizationId: baseOrg,
      connectionId: baseConn,
      now: () => Date.now(),
      initialGetById: new Map(),
      initialListDue: { items: [] },
      // Runtime defaults accept ANY credential-resolved org/conn; the
      // credential registry remains the authoritative source, and the
      // adapter's per-org gating is for tests that intentionally
      // scope fixtures.
      skipOrgGate: true,
    }),
  };
}

