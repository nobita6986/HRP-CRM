/**
 * context-panel/src/server.ts — CORE/1.9 UI server + API endpoints.
 *
 * BLOCKER FIXES:
 *  B2: Mock boundary guard — /api/* returns 404 when mockMode !== 'on'.
 *  B3: Authorization — extracts X-HRP-Staff-Id header, maps to MockIdentity with role/scope.
 *
 * Routes:
 *  GET  /               → dist/ui/index.html (React bundle)
 *  GET  /health/live    → { status: 'live' }
 *  GET  /health/ready   → { status: 'ready', mockMode, dependenciesConnected }
 *  GET  /api/context           → authorized context panel result
 *  POST /api/intake/preview     → B1: creates server-side review snapshot
 *  POST /api/intake/run        → B1: requires reviewSnapshotId, validates digest
 *  POST /api/intake/dnc        → B3: actor from request, not hardcoded
 *  GET  /api/session/reset     → [dev only] reset server session store
 *
 * Authorization headers:
 *  X-HRP-Staff-Id: maps to MockIdentity.role → permissions checked per endpoint.
 *
 * Frozen contracts: 0.0.8-g0.8-fixes (pinned).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, assertNotProductionMock, type PanelConfig } from '@hrp-engagement/config';
import {
  handlePreview,
  handleRun,
  handleDnc,
  handleContextQuery,
  resolveMockIdentity,
  canQueryContext,
  canSubmitIntake,
  canExecuteDnc,
  type MockIdentity,
} from './orchestrator-wire.js';

// CORE/1.B.03-PREP — Embed-host synthetic seam (NOT real Chatwoot / NOT HRP runtime).
import { handleEmbedTalentContextRead, defaultDeps as defaultEmbedDeps, seedSynthetic } from './embed/server-handler.js';
import type { EmbedRouteDeps } from './embed/server-handler.js';

// CORE/1.14 — Observability layer (correlation / metrics / scrub / kill-switch)
import {
  resolveCorrelation,
  inc,
  scrub,
  killSwitch,
  recoveryLedger,
  aggregateRecoveryState,
  type CorrelationContext,
} from './observability/index.js';

// CORE/1.11 — Routing service
import {
  listPools,
  getPool,
  simulate,
  updatePool,
  createPool,
  seedFixtures,
} from './routing/service.js';
import { RoutingConfigError, requireManagerRole, routingPoolStore } from './routing/config-store.js';

// CORE/1.12 — Dashboard (BoD mock) service
import {
  readDashboard as readDashboardService,
  drilldownGuarded,
  assignKpi,
  reviseKpi,
  proposeKpi,
  listKpiAssignments,
  getKpiAssignment,
  listKpiProposals,
  seedDashboardFixtures,
  DashboardConfigError,
  managerAllowedForStaff,
} from './dashboard/service.js';
import {
  makeDashboardSnapshot,
} from './dashboard/fixtures.js';
import type {
  DashboardSnapshot,
  LifecycleStage,
} from './dashboard/types.js';

// CORE/1.13 — Personal assistant / planning / autofill
import type { BatchItemResult, PlanningBatchItemInput } from './assistant/types.js';
import {
  readToday as readTodayService,
  readWeek as readWeekService,
  listAutofillProposals as listAutofillProposalsService,
  acceptAutofillFields as acceptAutofillFieldsService,
  confirmAutofillDraft as confirmAutofillDraftService,
  rejectAutofillProposal as rejectAutofillProposalService,
  commitPlanningBatch as commitPlanningBatchService,
  rescheduleNextAction as rescheduleNextActionService,
  listProviderConfigs as listProviderConfigsService,
  updateProviderConfig as updateProviderConfigService,
  simulateReminders as simulateRemindersService,
  AssistantConfigError,
} from './assistant/service.js';

/** Idempotent seeding — only seeds if store is empty. */
let seeded = false;
function seedFixturesOnce(): void {
  if (seeded) return;
  if (routingPoolStore.list().length === 0) {
    seedFixtures();
  }
  // CORE/1.12 — always seed dashboard fixtures (separate store).
  seedDashboardFixtures();
  seeded = true;
}

// B.03-PREP: lazily-created embed-host deps (in-process registry).
let embedDepsSingleton: EmbedRouteDeps | null = null;
function getEmbedDeps(): EmbedRouteDeps {
  if (embedDepsSingleton === null) {
    embedDepsSingleton = defaultEmbedDeps();
  }
  return embedDepsSingleton;
}

// B.03-PREP: read raw body as a string (size-limited) for embed-host routes.
async function readRawBodyLimited(req: IncomingMessage, maxBytes = 64 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > maxBytes) return '';
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

const VERSION = '1.0.0-core1.9';

/** Staff ID header name. */
const STAFF_ID_HEADER = 'x-hrp-staff-id';

/** B2: Return 404 for mock endpoints when mockMode is off. */
function guardMockMode(
  config: PanelConfig,
  res: ServerResponse,
  ctx: CorrelationContext,
): boolean {
  // mockMode is 'off' | 'deterministic' (no 'on'). Mock endpoints only available when not 'off'.
  if ((config.mockMode as string) === 'off') {
    inc('mock_endpoint.disabled', { routeName: ctx.routeName });
    respondJson(res, 404, {
      error: 'mock_disabled',
      message: 'Mock endpoints are disabled. Set HRP_MOCK_MODE=deterministic (development) to enable.',
    }, ctx);
    return true;
  }
  return false;
}

/** B3: Extract and validate staff identity from request headers. Returns null if unauthorized. */
function extractIdentity(req: IncomingMessage): MockIdentity | null {
  const staffId = req.headers[STAFF_ID_HEADER] as string | undefined;
  return resolveMockIdentity(staffId);
}

/** B3: Return 401 if no valid identity. */
function guardUnauthorized(
  identity: MockIdentity | null,
  res: ServerResponse,
  ctx: CorrelationContext,
): boolean {
  if (!identity) {
    inc('http.request.unauthorized', { routeName: ctx.routeName });
    respondJson(res, 401, {
      error: 'unauthorized',
      message: 'Missing or unrecognized X-HRP-Staff-Id header.',
    }, ctx);
    return true;
  }
  // Attach identity to context for downstream metric labeling.
  ctx.staffId = identity.staffId;
  ctx.organizationId = identity.organizationId;
  return false;
}

export async function startPanel(config: PanelConfig): Promise<ReturnType<typeof createServer>> {
  if (config.appKind !== 'panel') {
    throw new Error(`Expected panel config, got ${config.appKind}`);
  }

  const server = createServer((req, res) => {
    void handleRequest(req, res, config);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.listen.port, config.listen.host, () => resolve());
  });

  return server;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: PanelConfig,
): Promise<void> {
  const url = req.url ?? '/';
  const path = url.split('?')[0] ?? '/';

  // CORE/1.14 — Correlation: extract or generate; stash so any respondJson
  // call (current and future) can attach the header without explicit ctx arg.
  const ctx = resolveCorrelation(req.headers, path);
  stashCorrelation(res, ctx);

  // CORE/1.14 — Per-request metric: count request entry.
  inc('http.request.entry', { routeName: ctx.routeName });

  // Health: always accessible (no mock guard)
  if (path === '/health/live') {
    return respondJson(res, 200, { status: 'live', version: VERSION, pid: process.pid });
  }
  if (path === '/health/ready') {
    return respondJson(res, 200, {
      status: 'ready',
      version: VERSION,
      configLoaded: true,
      contractsVersion: config.contractsVersion,
      mockMode: config.mockMode,
      production: config.nodeEnv === 'production',
      dependenciesConnected: false,
      uiRealBackend: false,
    });
  }

  // Serve static UI from dist/ui/
  if (path === '/' || path === '/index.html') {
    const indexPath = join(process.cwd(), 'dist/ui/index.html');
    if (existsSync(indexPath)) {
      const html = readFileSync(indexPath, 'utf-8');
      // Inject staff ID for routing panel permission display.
      const staffId = req.headers[STAFF_ID_HEADER] as string | undefined ?? '';
      const staffInject = `<script>window.__HRP_STAFF_ID=${JSON.stringify(staffId)};</script>`;
      const injected = html.replace('</body>', `${staffInject}</body>`);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(injected);
    } else {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<title>HRP Context Panel — Not Built</title>
</head>
<body>
<p>UI chưa được build. Chạy <code>npm run build</code> trước.</p>
</body>
</html>`);
    }
    return;
  }

  // Serve bundle.js / bundle.js.map
  if (path === '/bundle.js' || path === '/bundle.js.map') {
    const bundlePath = join(process.cwd(), `dist/ui${path}`);
    if (existsSync(bundlePath)) {
      const content = readFileSync(bundlePath);
      res.statusCode = 200;
      res.setHeader('Content-Type', path.endsWith('.map') ? 'application/json' : 'application/javascript; charset=utf-8');
      res.end(content);
    } else {
      res.statusCode = 404;
      res.end('Not found');
    }
    return;
  }

  // ── B2: Mock boundary guard for all /api/* routes ───────────────────────
  if (path.startsWith('/api/')) {
    if (guardMockMode(config, res, ctx)) return;
  }

  // ── GET /api/context → authorized context panel ────────────────────────────
  if (path === '/api/context' && req.method === 'GET') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;

    const urlObj = new URL(req.url ?? '/', 'http://localhost');
    const target = (urlObj.searchParams.get('target') ?? 'talent') as 'talent' | 'client';
    const laborProfileId = urlObj.searchParams.get('laborProfileId') ?? undefined;

    // B3: Permission check — NOT via scenario param.
    if (!canQueryContext(identity!, target)) {
      return respondJson(res, 403, {
        error: 'FORBIDDEN',
        message: 'Bạn không có quyền xem hồ sơ này.',
      });
    }

    try {
      const scenario = urlObj.searchParams.get('scenario') as 'forbidden' | 'stale' | 'timeout' | 'partial' | null;
      const data = await handleContextQuery({
        target,
        ...(laborProfileId !== undefined ? { laborProfileId } : {}),
        ...(scenario !== null ? { scenario } : {}),
      }, identity!);
      return respondJson(res, 200, data);
    } catch (err) {
      const httpStatus = (err as { httpStatus?: number }).httpStatus ?? 500;
      const errorCode = (err as { errorCode?: string }).errorCode ?? 'UNKNOWN';
      const message = (err as { message?: string }).message ?? 'Lỗi không xác định';
      return respondJson(res, httpStatus, { error: errorCode, message });
    }
  }

  // ── POST /api/intake/preview → creates server-side review snapshot ─────────
  if (path === '/api/intake/preview' && req.method === 'POST') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;

    // B3: Preview requires TALENT_REVIEWER, INTAKE_OPERATOR, SUPERVISOR, or SYSTEM.
    if (!canQueryContext(identity!, 'talent')) {
      return respondJson(res, 403, {
        error: 'FORBIDDEN',
        message: 'Bạn không có quyền xem trước hồ sơ.',
      });
    }

    const body = await readBody(req) as Record<string, unknown>;
    try {
      // B1: Pass actor from server-validated identity; require intakeRevisionId for B1.
      const data = await handlePreview({
        organizationId: body.organizationId as string,
        intakeRevisionId: body.intakeRevisionId as string,
        signal: body.signal as Parameters<typeof handlePreview>[0]['signal'],
        target: (body.target ?? 'talent') as 'talent' | 'client',
        targetVersion: typeof body.targetVersion === 'number' ? (body.targetVersion as number) : undefined,
        scenario: body.scenario as string | undefined,
        // R1: Pass through draft fields so preview-bound digest matches run-side digest.
        intent: body.intent as Parameters<typeof handlePreview>[0]['intent'],
        citizenIdentity: body.citizenIdentity as Parameters<typeof handlePreview>[0]['citizenIdentity'],
        ...(typeof body.contactAddress === 'string' ? { contactAddress: body.contactAddress as string } : {}),
        evidenceRefs: body.evidenceRefs as Parameters<typeof handlePreview>[0]['evidenceRefs'],
      }, identity!);
      return respondJson(res, 200, data);
    } catch (err) {
      const httpStatus = (err as { httpStatus?: number }).httpStatus ?? 500;
      const errorCode = (err as { errorCode?: string }).errorCode ?? 'PREVIEW_FAILED';
      const message = (err as { message?: string }).message ?? 'Lỗi khi xem trước.';
      return respondJson(res, httpStatus, { error: errorCode, message });
    }
  }

  // ── POST /api/intake/run → B1: requires reviewSnapshotId, validates digest ─
  if (path === '/api/intake/run' && req.method === 'POST') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;

    // B3: Submit requires INTAKE_OPERATOR, SUPERVISOR, or SYSTEM.
    if (!canSubmitIntake(identity!)) {
      return respondJson(res, 403, {
        error: 'FORBIDDEN',
        message: 'Bạn không có quyền nộp hồ sơ.',
      });
    }

    const body = await readBody(req) as Record<string, unknown>;

    // B1: Require reviewSnapshotId in body.
    if (!body.reviewSnapshotId || typeof body.reviewSnapshotId !== 'string') {
      return respondJson(res, 400, {
        error: 'MISSING_REVIEW',
        message: 'Bạn cần xem trước hồ sơ trước khi nộp. Vui lòng gọi preview trước.',
      });
    }

    try {
      // B1: Server uses identity.actor; client-supplied actor is informational
      // and must match identity.actor (spoof check inside handleRun).
      // CORE/1.14 B3: pass inbound correlation so run-side trace matches
      // the receipt/decision/result chain.
      const data = await handleRun({
        organizationId: body.organizationId as string,
        intakeRevisionId: body.intakeRevisionId as string,
        reviewSnapshotId: body.reviewSnapshotId as string,
        target: (body.target ?? 'talent') as 'talent' | 'client',
        targetVersion: typeof body.targetVersion === 'number' ? (body.targetVersion as number) : undefined,
        fullName: body.fullName as string,
        phone: body.phone as string,
        citizenIdentity: body.citizenIdentity as { number: string; address: string },
        contactAddress: body.contactAddress as string | undefined,
        dob: body.dob as string | undefined,
        intent: body.intent as { stage: string; availability: string; availableFromDate?: string },
        evidenceRefs: body.evidenceRefs as Array<{ evidenceId: string; kind: string }>,
        actor: identity!.actor,
        scenario: body.scenario as string | undefined,
      }, identity!, ctx.correlationId);
      return respondJson(res, 200, data);
    } catch (err) {
      const httpStatus = (err as { httpStatus?: number }).httpStatus ?? 500;
      const errorCode = (err as { errorCode?: string }).errorCode ?? 'RUN_FAILED';
      const message = (err as { message?: string }).message ?? 'Lỗi khi xử lý hồ sơ.';
      return respondJson(res, httpStatus, { error: errorCode, message });
    }
  }

  // ── POST /api/intake/dnc → B3: actor ALWAYS from server-resolved MockIdentity
  if (path === '/api/intake/dnc' && req.method === 'POST') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;

    // B3: DNC requires INTAKE_OPERATOR, SUPERVISOR, or SYSTEM.
    if (!canExecuteDnc(identity!)) {
      return respondJson(res, 403, {
        error: 'FORBIDDEN',
        message: 'Bạn không có quyền thực hiện DNC.',
      });
    }

    const body = await readBody(req);

    try {
      // B3: body.actor may be omitted; if present it must match identity.actor.
      // Server ALWAYS uses identity.actor as effective actor for the operation.
      // CORE/1.14 B3: pass inbound correlation so DNC trace matches the
      // receipt/decision/result chain.
      const data = await handleDnc({
        organizationId: body.organizationId as string,
        target: body.target as Parameters<typeof handleDnc>[0]['target'],
        reason: body.reason as Parameters<typeof handleDnc>[0]['reason'],
        actor: body.actor as Parameters<typeof handleDnc>[0]['actor'],
        note: body.note as string | undefined,
        provider: body.provider as string,
        connectionId: body.connectionId as string,
        externalContactId: body.externalContactId as string,
        externalAccountId: body.externalAccountId as string | undefined,
      }, identity!, ctx.correlationId);
      return respondJson(res, 200, data);
    } catch (err) {
      const httpStatus = (err as { httpStatus?: number }).httpStatus ?? 500;
      const errorCode = (err as { errorCode?: string }).errorCode ?? 'DNC_FAILED';
      const message = (err as { message?: string }).message ?? 'Lỗi khi thực hiện DNC.';
      return respondJson(res, httpStatus, { error: errorCode, message });
    }
  }

  // ── B.03-PREP: GET /embed-panel/* → synthetic embed-host React bundle ──
  if (path.startsWith('/embed-panel/') && req.method === 'GET') {
    if (config.nodeEnv === 'production') {
      return respondJson(res, 403, { error: 'forbidden', message: 'Not available in production.' }, ctx);
    }
    const sub = path === '/embed-panel/' ? '/index.html' : path.slice('/embed-panel'.length);
    const filePath = join(process.cwd(), 'dist/embed-ui' + sub);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath);
      res.statusCode = 200;
      const lower = sub.toLowerCase();
      res.setHeader('Content-Type',
        lower.endsWith('.html') ? 'text/html; charset=utf-8' :
        lower.endsWith('.js') ? 'application/javascript; charset=utf-8' :
        lower.endsWith('.map') ? 'application/json' :
        'application/octet-stream');
      res.end(content);
    } else {
      res.statusCode = 404;
      res.end('Not found');
    }
    return;
  }

  // ── B.03-PREP: GET /embed-host-simulator → synthetic test harness ─────
  if (path === '/embed-host-simulator' && req.method === 'GET') {
    if (config.nodeEnv === 'production') {
      return respondJson(res, 403, { error: 'forbidden', message: 'Not available in production.' }, ctx);
    }
    const simPath = join(process.cwd(), 'tests/embed-host-simulator.html');
    if (existsSync(simPath)) {
      const content = readFileSync(simPath, 'utf-8');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(content);
    } else {
      res.statusCode = 404;
      res.end('Embed-host simulator not found');
    }
    return;
  }

  // ── GET /api/session/reset → [dev only] reset session store ─────────────
  if (path === '/api/session/reset' && req.method === 'GET') {
    if (config.nodeEnv === 'production') {
      return respondJson(res, 403, { error: 'forbidden', message: 'Not available in production.' });
    }
    // Reset gateway ledger and counters but keep checkpoints for replay testing.
    const { serverSession } = await import('./orchestrator-wire.js');
    serverSession.resetGateway();
    return respondJson(res, 200, { reset: 'gateway_ledger', storeState: serverSession.describe() });
  }

  // ── B.03-PREP: POST /api/embed/talent-context-read → synthetic port ────
  if (path === '/api/embed/talent-context-read' && req.method === 'POST') {
    const raw = await readRawBodyLimited(req);
    await handleEmbedTalentContextRead(req, res, {
      config: { mockMode: config.mockMode, nodeEnv: config.nodeEnv },
      deps: getEmbedDeps(),
      readBody: async () => raw,
      respondJson: (r, status, body) => respondJson(r, status, body, ctx),
    });
    return;
  }

  // ── B.03-PREP: POST /api/embed/seed → [dev only] seed synthetic session ─
  if (path === '/api/embed/seed' && req.method === 'POST') {
    if (config.nodeEnv === 'production') {
      return respondJson(res, 403, { error: 'forbidden', message: 'Not available in production.' }, ctx);
    }
    const raw = await readRawBodyLimited(req);
    let payload: unknown;
    try {
      payload = raw.length === 0 ? {} : JSON.parse(raw);
    } catch {
      return respondJson(res, 422, { error: 'VALIDATION_ERROR', message: 'Yêu cầu không hợp lệ.' }, ctx);
    }
    const p = payload as {
      organizationId?: unknown;
      serviceId?: unknown;
      hrpUserId?: unknown;
      allowedLaborProfileIds?: unknown;
      fixtures?: unknown;
      seed?: unknown;
    };
    if (
      typeof p.organizationId !== 'string' ||
      typeof p.serviceId !== 'string' ||
      typeof p.hrpUserId !== 'string' ||
      !Array.isArray(p.allowedLaborProfileIds) ||
      !Array.isArray(p.fixtures) ||
      typeof p.seed !== 'number'
    ) {
      return respondJson(res, 422, { error: 'VALIDATION_ERROR', message: 'Yêu cầu không hợp lệ.' }, ctx);
    }
    const sessionRef = seedSynthetic(getEmbedDeps(), {
      organizationId: p.organizationId,
      serviceId: p.serviceId,
      hrpUserId: p.hrpUserId,
      allowedLaborProfileIds: p.allowedLaborProfileIds as string[],
      fixtures: (p.fixtures as Array<{ laborProfileId?: string; fullName?: string }>).map((f) => ({
        laborProfileId: typeof f.laborProfileId === 'string' ? f.laborProfileId : '',
        fullName: typeof f.fullName === 'string' ? f.fullName : '',
      })),
      seed: p.seed,
    });
    return respondJson(res, 200, { sessionRef }, ctx);
  }

  // ── B.03-PREP: POST /api/embed/revoke → [dev only] revoke a session ────
  if (path === '/api/embed/revoke' && req.method === 'POST') {
    if (config.nodeEnv === 'production') {
      return respondJson(res, 403, { error: 'forbidden', message: 'Not available in production.' }, ctx);
    }
    const raw = await readRawBodyLimited(req);
    let payload: unknown;
    try {
      payload = raw.length === 0 ? {} : JSON.parse(raw);
    } catch {
      return respondJson(res, 422, { error: 'VALIDATION_ERROR', message: 'Yêu cầu không hợp lệ.' }, ctx);
    }
    const sessionRef = (payload as { sessionRef?: unknown }).sessionRef;
    if (typeof sessionRef !== 'string') {
      return respondJson(res, 422, { error: 'VALIDATION_ERROR', message: 'Yêu cầu không hợp lệ.' }, ctx);
    }
    const ok = getEmbedDeps().registry.revoke(sessionRef);
    return respondJson(res, 200, { revoked: ok }, ctx);
  }

  // ── R4: GET /api/review/unresolved → queries CORE/1.7 review service ────

  // ── R4: GET /api/review/unresolved → queries CORE/1.7 review service ────
  // In-process wiring uses dynamic import of @hrp-engagement/integration-api/review.
  // Reviews flow from upstream's ReviewService → reviewStore (shared module),
  // not from local ReviewSnapshot (which is for preview/confirmation only).
  // Permissions/versioning/audit are preserved by CORE/1.7's canListReviews gate.
  if (path === '/api/review/unresolved' && req.method === 'GET') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;

    const { listUnresolvedReviews, canIdentityListUnresolved } = await import(
      './review/wiring.js'
    );
    if (!canIdentityListUnresolved(identity!)) {
      return respondJson(res, 403, {
        error: 'FORBIDDEN',
        message: 'Bạn không có quyền liệt kê hồ sơ chưa xử lý.',
      });
    }

    try {
      const limitRaw = new URL(req.url ?? '/', 'http://localhost').searchParams.get('limit');
      const limit = limitRaw ? Math.max(1, Math.min(200, parseInt(limitRaw, 10) || 50)) : 50;
      const entries = await listUnresolvedReviews(identity!, limit);
      return respondJson(res, 200, {
        schemaVersion: '1',
        organizationId: identity!.organizationId,
        items: entries,
        resolvedAt: new Date().toISOString(),
      });
    } catch (err) {
      const message = (err as { message?: string }).message ?? 'Lỗi truy vấn review.';
      return respondJson(res, 503, { error: 'REVIEW_UNAVAILABLE', message });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CORE/1.11 — Routing config + simulator
  // ═══════════════════════════════════════════════════════════════════════

  // Seed fixtures once per server lifecycle (idempotent — only seeds if empty).
  seedFixturesOnce();

  // ── GET /api/routing/pools → list all pools ───────────────────────────
  if (path === '/api/routing/pools' && req.method === 'GET') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    try {
      const { pools } = listPools();
      return respondJson(res, 200, { pools });
    } catch (err) {
      const message = (err as { message?: string }).message ?? 'Lỗi truy vấn pool.';
      return respondJson(res, 500, { error: 'POOL_LIST_ERROR', message });
    }
  }

  // ── POST /api/routing/pools → create pool (MANAGER ONLY) ───────────────
  if (path === '/api/routing/pools' && req.method === 'POST') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    try {
      requireManagerRole(identity!.role);
      const body = await readBody(req);
      const pool = createPool(
        body as Parameters<typeof createPool>[0],
        identity!,
      );
      return respondJson(res, 201, { pool });
    } catch (err) {
      if (err instanceof RoutingConfigError) {
        const httpStatus = err.code === 'MANAGER_REQUIRED' ? 403 : 400;
        return respondJson(res, httpStatus, { error: err.code, message: err.message });
      }
      const message = (err as { message?: string }).message ?? 'Lỗi tạo pool.';
      return respondJson(res, 500, { error: 'CREATE_POOL_ERROR', message });
    }
  }

  // ── POST /api/routing/pools/:poolId/simulate → routing simulation ────────
  {
    const simulateMatch = path.match(/^\/api\/routing\/pools\/([^/]+)\/simulate$/u);
    if (simulateMatch && req.method === 'POST') {
      const poolId = simulateMatch[1]!;
      const identity = extractIdentity(req);
      if (guardUnauthorized(identity, res, ctx)) return;
      try {
        const urlObj = new URL(req.url ?? '/', 'http://localhost');
        const count = (urlObj.searchParams.get('count') ?? '10') === '100' ? 100 : 10;
        const modeRaw = urlObj.searchParams.get('mode') ?? 'realtime';
        const mode = modeRaw === 'batch' ? 'batch' : 'realtime';
        const result = simulate({
          poolId,
          customerCount: count as 10 | 100,
          mode,
          seed: 0,
        });
        return respondJson(res, 200, result);
      } catch (err) {
        const errObj = err as { errorCode?: string; message?: string; httpStatus?: number };
        if (errObj.errorCode === 'POOL_NOT_FOUND') {
          return respondJson(res, 404, { error: 'POOL_NOT_FOUND', message: errObj.message ?? '' });
        }
        const message = errObj.message ?? 'Lỗi mô phỏng.';
        return respondJson(res, 500, { error: 'SIMULATE_ERROR', message });
      }
    }
  }

  // ── PUT /api/routing/pools/:poolId → update pool (MANAGER ONLY) ──────────
  {
    const updateMatch = path.match(/^\/api\/routing\/pools\/([^/]+)$/u);
    if (updateMatch && req.method === 'PUT') {
      const poolId = updateMatch[1]!;
      const identity = extractIdentity(req);
      if (guardUnauthorized(identity, res, ctx)) return;
      try {
        const body = await readBody(req);
        const updated = updatePool(
          body as unknown as Parameters<typeof updatePool>[0],
          identity!,
        );
        return respondJson(res, 200, { pool: updated });
      } catch (err) {
        if (err instanceof RoutingConfigError) {
          const httpStatus =
            err.code === 'MANAGER_REQUIRED'
              ? 403
              : err.code === 'VERSION_CONFLICT'
                ? 409
                : err.code === 'POOL_NOT_FOUND'
                  ? 404
                  : 400;
          return respondJson(res, httpStatus, { error: err.code, message: err.message });
        }
        const message = (err as { message?: string }).message ?? 'Lỗi cập nhật pool.';
        return respondJson(res, 500, { error: 'UPDATE_POOL_ERROR', message });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CORE/1.12 — BoD dashboard mock (read + KPI assign/revise/propose)
  // ═══════════════════════════════════════════════════════════════════════

  // ── GET /api/dashboard/snapshot → read chart cells ──────────────────────
  if (path === '/api/dashboard/snapshot' && req.method === 'GET') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    try {
      const urlObj = new URL(req.url ?? '/', 'http://localhost');
      const grain = (urlObj.searchParams.get('grain') ?? 'ORGANIZATION') as
        'ACTOR' | 'TEAM' | 'COHORT' | 'ORGANIZATION';
      const period = (urlObj.searchParams.get('period') ?? 'WEEKLY') as
        'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY';
      const actorId = urlObj.searchParams.get('actorId') ?? undefined;
      const stage = urlObj.searchParams.get('stage') as LifecycleStage | null;
      const sourceParam = urlObj.searchParams.get('source');
      const cohortSource = sourceParam
        ? sourceParam.split(',').filter(Boolean)
        : undefined;
      const regionParam = urlObj.searchParams.get('region');
      const cohortRegion = regionParam
        ? regionParam.split(',').filter(Boolean)
        : undefined;
      const periodStart =
        urlObj.searchParams.get('periodStart') ?? '2026-08-31';
      const periodEnd =
        urlObj.searchParams.get('periodEnd') ?? '2026-09-13';
      const snapshot: DashboardSnapshot = {
        ...makeDashboardSnapshot(),
        grain,
        period,
        periodStart,
        periodEnd,
        cohort: {
          ...(cohortSource !== undefined && cohortSource.length > 0
            ? { source: cohortSource }
            : {}),
          ...(cohortRegion !== undefined && cohortRegion.length > 0
            ? { region: cohortRegion }
            : {}),
        },
        ...(actorId !== undefined ? { actorId } : {}),
      };
      const result = readDashboardService({
        snapshot,
        ...(stage !== null ? { stage } : {}),
      });
      // Growth: last week vs prior week (only when period is non-DAILY).
      const { computeGrowth } = await import('./dashboard/aggregator.js');
      const growth = computeGrowth(result.metrics);
      return respondJson(res, 200, {
        ...result,
        growth: growth ?? null,
      });
    } catch (err) {
      const message = (err as { message?: string }).message ?? 'Lỗi đọc dashboard.';
      return respondJson(res, 500, { error: 'DASHBOARD_READ_ERROR', message });
    }
  }

  // ── GET /api/dashboard/drilldown → drill-down rows ──────────────────────
  if (path === '/api/dashboard/drilldown' && req.method === 'GET') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    try {
      const urlObj = new URL(req.url ?? '/', 'http://localhost');
      const stage = urlObj.searchParams.get('stage') as LifecycleStage | null;
      if (stage === null) {
        return respondJson(res, 400, {
          error: 'MISSING_STAGE',
          message: 'Thiếu tham số stage (CREATED|UPDATED|SUBMITTED|REVIEW|OUTCOME).',
        });
      }
      const grain = (urlObj.searchParams.get('grain') ?? 'ORGANIZATION') as
        'ACTOR' | 'TEAM' | 'COHORT' | 'ORGANIZATION';
      const period = (urlObj.searchParams.get('period') ?? 'WEEKLY') as
        'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY';
      const actorId = urlObj.searchParams.get('actorId') ?? undefined;
      const bucket = urlObj.searchParams.get('bucket') ?? undefined;
      const sourceParam = urlObj.searchParams.get('source');
      const cohortSource = sourceParam
        ? sourceParam.split(',').filter(Boolean)
        : undefined;
      const regionParam = urlObj.searchParams.get('region');
      const cohortRegion = regionParam
        ? regionParam.split(',').filter(Boolean)
        : undefined;
      const snapshot: DashboardSnapshot = {
        ...makeDashboardSnapshot(),
        grain,
        period,
        periodStart: urlObj.searchParams.get('periodStart') ?? '2026-08-31',
        periodEnd: urlObj.searchParams.get('periodEnd') ?? '2026-09-13',
        cohort: {
          ...(cohortSource !== undefined && cohortSource.length > 0
            ? { source: cohortSource }
            : {}),
          ...(cohortRegion !== undefined && cohortRegion.length > 0
            ? { region: cohortRegion }
            : {}),
        },
        ...(actorId !== undefined ? { actorId } : {}),
      };
      const result = drilldownGuarded({
        request: {
          snapshot,
          stage,
          ...(bucket !== undefined ? { bucket } : {}),
        },
        identity: identity!,
      });
      return respondJson(res, 200, result);
    } catch (err) {
      if (err instanceof DashboardConfigError) {
        const httpStatus = err.code === 'MANAGER_REQUIRED' ? 403 : 400;
        return respondJson(res, httpStatus, { error: err.code, message: err.message });
      }
      const message = (err as { message?: string }).message ?? 'Lỗi drill-down.';
      return respondJson(res, 500, { error: 'DRILLDOWN_ERROR', message });
    }
  }

  // ── GET /api/dashboard/kpis → list KPI assignments ──────────────────────
  if (path === '/api/dashboard/kpis' && req.method === 'GET') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    return respondJson(res, 200, { assignments: listKpiAssignments() });
  }

  // ── GET /api/dashboard/kpis/proposals → list KPI proposals ──────────────
  if (path === '/api/dashboard/kpis/proposals' && req.method === 'GET') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    return respondJson(res, 200, { proposals: listKpiProposals() });
  }

  // ── POST /api/dashboard/kpis/assign → manager-only KPI assignment ──────
  if (path === '/api/dashboard/kpis/assign' && req.method === 'POST') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    if (!managerAllowedForStaff(identity!.staffId)) {
      return respondJson(res, 403, {
        error: 'MANAGER_REQUIRED',
        message: 'Chỉ quản lý (SUPERVISOR/SYSTEM) mới được giao KPI.',
      });
    }
    const body = await readBody(req);
    try {
      const row = assignKpi({
        organizationId: body.organizationId as string,
        targetType: body.targetType as Parameters<typeof assignKpi>[0]['targetType'],
        period: body.period as Parameters<typeof assignKpi>[0]['period'],
        targetValue: body.targetValue as number,
        targetActorRole: body.targetActorRole as Parameters<typeof assignKpi>[0]['targetActorRole'],
        ...(body.targetActorId !== undefined ? { targetActorId: body.targetActorId as string } : {}),
        ...(body.cohort !== undefined
          ? {
              cohort: body.cohort as Parameters<typeof assignKpi>[0]['cohort'],
            }
          : {}),
        ...(body.attributionSource !== undefined
          ? { attributionSource: body.attributionSource as Parameters<typeof assignKpi>[0]['attributionSource'] }
          : {}),
        reasonCode: body.reasonCode as string,
        assignedBy: identity!.staffId,
      });
      return respondJson(res, 201, { assignment: row });
    } catch (err) {
      if (err instanceof DashboardConfigError) {
        const httpStatus =
          err.code === 'MANAGER_REQUIRED'
            ? 403
            : err.code === 'TARGET_ZERO_NOT_ALLOWED'
              ? 400
              : err.code === 'PERIOD_INCOMPLETE'
                ? 400
                : 400;
        return respondJson(res, httpStatus, { error: err.code, message: err.message });
      }
      const message = (err as { message?: string }).message ?? 'Lỗi giao KPI.';
      return respondJson(res, 500, { error: 'KPI_ASSIGN_ERROR', message });
    }
  }

  // ── PUT /api/dashboard/kpis/revise → manager-only KPI revise ───────────
  if (path === '/api/dashboard/kpis/revise' && req.method === 'PUT') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    if (!managerAllowedForStaff(identity!.staffId)) {
      return respondJson(res, 403, {
        error: 'MANAGER_REQUIRED',
        message: 'Chỉ quản lý (SUPERVISOR/SYSTEM) mới được sửa KPI.',
      });
    }
    const body = await readBody(req);
    try {
      const row = reviseKpi({
        assignmentId: body.assignmentId as string,
        ...(body.newTargetValue !== undefined ? { newTargetValue: body.newTargetValue as number } : {}),
        expectedRevision: body.expectedRevision as number,
        reasonCode: body.reasonCode as string,
        revisedBy: identity!.staffId,
      });
      return respondJson(res, 200, { assignment: row });
    } catch (err) {
      if (err instanceof DashboardConfigError) {
        const httpStatus =
          err.code === 'MANAGER_REQUIRED'
            ? 403
            : err.code === 'KPI_NOT_FOUND'
              ? 404
              : err.code === 'VERSION_CONFLICT'
                ? 409
                : 400;
        return respondJson(res, httpStatus, { error: err.code, message: err.message });
      }
      const message = (err as { message?: string }).message ?? 'Lỗi revise KPI.';
      return respondJson(res, 500, { error: 'KPI_REVISE_ERROR', message });
    }
  }

  // ── POST /api/dashboard/kpis/propose → sale/AI propose (audit only) ────
  if (path === '/api/dashboard/kpis/propose' && req.method === 'POST') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    const body = await readBody(req);
    try {
      // Cross-scope guard: sale/AI/talent reviewer can propose for any
      // assignment (audit). Their proposed value is NEVER applied to target.
      // Manager can also propose (audit).
      const row = proposeKpi(
        {
          assignmentId: body.assignmentId as string,
          ...(body.proposedTargetValue !== undefined
            ? { proposedTargetValue: body.proposedTargetValue as number }
            : {}),
          rationale: body.rationale as string,
        },
        identity!.staffId,
      );
      return respondJson(res, 201, { proposal: row });
    } catch (err) {
      if (err instanceof DashboardConfigError) {
        return respondJson(res, 400, { error: err.code, message: err.message });
      }
      const message = (err as { message?: string }).message ?? 'Lỗi propose KPI.';
      return respondJson(res, 500, { error: 'KPI_PROPOSE_ERROR', message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CORE/1.13 — Personal assistant / planning / autofill / reminder
  // ─────────────────────────────────────────────────────────────────────────────
  // ── GET /api/assistant/today → today's deterministic items + KPI summary ─
  if (path === '/api/assistant/today' && req.method === 'GET') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    try {
      const snap = readTodayService(identity!);
      return respondJson(res, 200, snap, ctx);
    } catch (err) {
      const message = (err as { message?: string }).message ?? 'Lỗi đọc today.';
      return respondJson(res, 500, { error: 'TODAY_ERROR', message });
    }
  }

  // ── GET /api/assistant/week → week plan snapshot ──────────────────────────
  if (path === '/api/assistant/week' && req.method === 'GET') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    try {
      const snap = readWeekService(identity!);
      return respondJson(res, 200, snap, ctx);
    } catch (err) {
      const message = (err as { message?: string }).message ?? 'Lỗi đọc week.';
      return respondJson(res, 500, { error: 'WEEK_ERROR', message });
    }
  }

  // ── GET /api/assistant/autofill → list autofill proposals for a profile ──
  if (path === '/api/assistant/autofill' && req.method === 'GET') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    const url = new URL(req.url ?? '/', 'http://localhost');
    const profileId = url.searchParams.get('profileId');
    if (!profileId) {
      return respondJson(res, 400, {
        error: 'MISSING_PROFILE_ID',
        message: 'Thiếu query ?profileId=',
      });
    }
    try {
      const proposals = listAutofillProposalsService(identity!, profileId);
      return respondJson(res, 200, { proposals });
    } catch (err) {
      const message = (err as { message?: string }).message ?? 'Lỗi đọc autofill.';
      return respondJson(res, 500, { error: 'AUTOFILL_ERROR', message });
    }
  }

  // ── POST /api/assistant/autofill/accept → accept some fields ───────────────
  if (path === '/api/assistant/autofill/accept' && req.method === 'POST') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    // CORE/1.14: kill-switch guard (mutating route).
    if (guardKillSwitch(res, ctx)) return;
    const body = await readBody(req);
    try {
      const result = acceptAutofillFieldsService(
        identity!,
        body.profileId as string,
        body.proposalId as string,
        (body.acceptedFieldPaths as string[]) ?? [],
        (body.rejectedFieldPaths as string[]) ?? [],
      );
      const proposals = listAutofillProposalsService(
        identity!,
        body.profileId as string,
      );
      const updatedProposal = proposals.find(
        (p) => p.proposalId === body.proposalId,
      );
      // Register receipt for recovery (mutating route).
      const idempotencyKey = `${identity!.staffId}:${body.profileId}:${body.proposalId}`;
      const receiptId = recoveryLedger.register({
        correlationId: ctx.correlationId,
        routeName: ctx.routeName,
        effectKind: 'confirm_draft',
        idempotencyKey,
      });
      recoveryLedger.markApplied(receiptId);
      inc('intent.accept', { routeName: ctx.routeName, outcome: 'success' });
      return respondJson(res, 200, { result, proposal: updatedProposal, receiptId }, ctx);
    } catch (err) {
      inc('intent.accept', { routeName: ctx.routeName, outcome: 'error' });
      const status = (err as { httpStatus?: number }).httpStatus ?? 500;
      const code = (err as { errorCode?: string }).errorCode ?? 'ACCEPT_ERROR';
      const message = (err as { message?: string }).message ?? 'Lỗi accept autofill.';
      return respondError(res, status, code, message, ctx);
    }
  }

  // ── POST /api/assistant/autofill/confirm → confirm draft, apply mutation ──
  if (path === '/api/assistant/autofill/confirm' && req.method === 'POST') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    // CORE/1.14: kill-switch guard (mutating route).
    if (guardKillSwitch(res, ctx)) return;
    const body = await readBody(req);
    try {
      const out = confirmAutofillDraftService(
        identity!,
        body.draftId as string,
        body.expectedDraftRevision as string,
        body.confirmationDigest as string,
      );
      const idempotencyKey = `confirm:${body.draftId}:${body.confirmationDigest ?? ''}`;
      const receiptId = recoveryLedger.register({
        correlationId: ctx.correlationId,
        routeName: ctx.routeName,
        effectKind: 'confirm_draft',
        idempotencyKey,
      });
      recoveryLedger.markApplied(receiptId);
      inc('intent.confirm', { routeName: ctx.routeName, outcome: 'success' });
      return respondJson(res, 200, { ...out, receiptId }, ctx);
    } catch (err) {
      inc('intent.confirm', { routeName: ctx.routeName, outcome: 'error' });
      const status = (err as { httpStatus?: number }).httpStatus ?? 500;
      const code = (err as { errorCode?: string }).errorCode ?? 'CONFIRM_ERROR';
      const message = (err as { message?: string }).message ?? 'Lỗi confirm autofill.';
      return respondError(res, status, code, message, ctx);
    }
  }

  // ── POST /api/assistant/autofill/reject → reject whole proposal ───────────
  if (path === '/api/assistant/autofill/reject' && req.method === 'POST') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    const body = await readBody(req);
    try {
      const proposal = rejectAutofillProposalService(
        identity!,
        body.profileId as string,
        body.proposalId as string,
      );
      inc('intent.reject', { routeName: ctx.routeName, outcome: 'success' });
      return respondJson(res, 200, { proposal }, ctx);
    } catch (err) {
      const status = (err as { httpStatus?: number }).httpStatus ?? 500;
      const code = (err as { errorCode?: string }).errorCode ?? 'REJECT_ERROR';
      const message = (err as { message?: string }).message ?? 'Lỗi reject autofill.';
      return respondError(res, status, code, message, ctx);
    }
  }

  // ── POST /api/assistant/planning/commit → commit batch with partial results
  if (path === '/api/assistant/planning/commit' && req.method === 'POST') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    // CORE/1.14: kill-switch guard (mutating route).
    if (guardKillSwitch(res, ctx)) return;
    const body = await readBody(req);
    try {
      const result = commitPlanningBatchService(
        identity!,
        body.batchId as string,
        (body.itemIds as string[]) ?? [],
        (body.itemInputs as PlanningBatchItemInput[] | undefined) ?? [],
        (body.simulatedOutcomes as BatchItemResult[] | undefined) ?? [],
      );
      const idempotencyKey = `batch:${body.batchId}`;
      const receiptId = recoveryLedger.register({
        correlationId: ctx.correlationId,
        routeName: ctx.routeName,
        effectKind: 'commit_batch',
        idempotencyKey,
      });
      recoveryLedger.markApplied(receiptId);
      inc('intent.commit', { routeName: ctx.routeName, outcome: 'success' });
      return respondJson(res, 200, { ...result, receiptId }, ctx);
    } catch (err) {
      inc('intent.commit', { routeName: ctx.routeName, outcome: 'error' });
      const status = (err as { httpStatus?: number }).httpStatus ?? 500;
      const code = (err as { errorCode?: string }).errorCode ?? 'BATCH_COMMIT_ERROR';
      const message = (err as { message?: string }).message ?? 'Lỗi commit batch.';
      return respondError(res, status, code, message, ctx);
    }
  }

  // ── POST /api/assistant/planning/reschedule → reschedule NextAction ──────
  if (path === '/api/assistant/planning/reschedule' && req.method === 'POST') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    const body = await readBody(req);
    try {
      const result = rescheduleNextActionService(
        identity!,
        body.actionId as string,
        body.expectedVersion as string,
        body.newSchedule as { scheduledAt: string; dueAt?: string },
      );
      inc('intent.reschedule', { routeName: ctx.routeName, outcome: 'success' });
      return respondJson(res, 200, { result }, ctx);
    } catch (err) {
      inc('intent.reschedule', { routeName: ctx.routeName, outcome: 'error' });
      const message = (err as { message?: string }).message ?? 'Lỗi reschedule.';
      return respondError(res, 500, 'RESCHEDULE_ERROR', message, ctx);
    }
  }

  // ── GET /api/assistant/providers → list provider configs ──────────────────
  if (path === '/api/assistant/providers' && req.method === 'GET') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    try {
      const providers = listProviderConfigsService(identity!);
      return respondJson(res, 200, { providers }, ctx);
    } catch (err) {
      const message = (err as { message?: string }).message ?? 'Lỗi đọc providers.';
      respondError(res, 500, 'PROVIDERS_ERROR', message, ctx);
    }
  }

  // ── PUT /api/assistant/providers/:configId → update provider (manager-only)
  {
    const match = path.match(/^\/api\/assistant\/providers\/([^/]+)$/u);
    if (match && req.method === 'PUT') {
      const configId = match[1]!;
      const identity = extractIdentity(req);
      if (guardUnauthorized(identity, res, ctx)) return;
      // CORE/1.14: kill-switch guard (mutating route).
      if (guardKillSwitch(res, ctx)) return;
      const body = await readBody(req);
      try {
        const result = updateProviderConfigService(
          identity!,
          configId,
          body as unknown as Parameters<typeof updateProviderConfigService>[2],
        );
        const idempotencyKey = `provider:${configId}:${identity!.staffId}`;
        const receiptId = recoveryLedger.register({
          correlationId: ctx.correlationId,
          routeName: ctx.routeName,
          effectKind: 'provider_put',
          idempotencyKey,
        });
        recoveryLedger.markApplied(receiptId);
        inc('intent.provider_update', { routeName: ctx.routeName, outcome: 'success' });
        return respondJson(res, 200, { ...result, receiptId }, ctx);
      } catch (err) {
        inc('intent.provider_update', { routeName: ctx.routeName, outcome: 'error' });
        const status = (err as { httpStatus?: number }).httpStatus ?? 500;
        const code = (err as { errorCode?: string }).errorCode ?? 'PROVIDER_UPDATE_ERROR';
        const message = (err as { message?: string }).message ?? 'Lỗi update provider.';
        return respondError(res, status, code, message, ctx);
      }
    }
  }

  // ── GET /api/assistant/reminders/simulate → reminder simulator ────────────
  if (path === '/api/assistant/reminders/simulate' && req.method === 'GET') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    try {
      const result = simulateRemindersService(identity!);
      return respondJson(res, 200, { ...result }, ctx);
    } catch (err) {
      const message = (err as { message?: string }).message ?? 'Lỗi simulate reminders.';
      return respondError(res, 500, 'REMINDER_ERROR', message, ctx);
    }
  }

// ─────────────────────────────────────────────────────────────────────────────
// CORE/1.14 — Admin endpoints (manager-only) for kill-switch + recovery
// ─────────────────────────────────────────────────────────────────────────────

  // ── GET /api/admin/killswitch → current kill-switch state ────────────────
  if (path === '/api/admin/killswitch' && req.method === 'GET') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    if (identity!.role !== 'SUPERVISOR' && identity!.role !== 'SYSTEM') {
      return respondError(res, 403, 'FORBIDDEN', 'Chỉ manager mới xem kill-switch.', ctx);
    }
    return respondJson(res, 200, {
      state: killSwitch.getState(),
      isArmed: killSwitch.isArmed(),
    }, ctx);
  }

  // ── POST /api/admin/killswitch → arm/disarm ────────────────────────────────
  if (path === '/api/admin/killswitch' && req.method === 'POST') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    if (identity!.role !== 'SUPERVISOR' && identity!.role !== 'SYSTEM') {
      return respondError(res, 403, 'FORBIDDEN', 'Chỉ manager mới điều khiển kill-switch.', ctx);
    }
    const body = await readBody(req);
    const next = body.state;
    if (next !== 'armed' && next !== 'disarmed') {
      return respondError(res, 400, 'INVALID_STATE', 'state phải là "armed" hoặc "disarmed".', ctx);
    }
    const prev = killSwitch.setState(next);
    return respondJson(res, 200, {
      previous: prev,
      current: killSwitch.getState(),
    }, ctx);
  }

  // ── GET /api/admin/recovery/status → recovery ledger snapshot ─────────────
  if (path === '/api/admin/recovery/status' && req.method === 'GET') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    if (identity!.role !== 'SUPERVISOR' && identity!.role !== 'SYSTEM') {
      return respondError(res, 403, 'FORBIDDEN', 'Chỉ manager mới xem recovery.', ctx);
    }
    return respondJson(res, 200, {
      state: aggregateRecoveryState(),
      killSwitch: killSwitch.getState(),
      depth: recoveryLedger.depth(),
      lastAction: recoveryLedger.getLastAction(),
    }, ctx);
  }

  // ── GET /api/admin/recovery/receipts → list pending receipts ──────────────
  if (path === '/api/admin/recovery/receipts' && req.method === 'GET') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    if (identity!.role !== 'SUPERVISOR' && identity!.role !== 'SYSTEM') {
      return respondError(res, 403, 'FORBIDDEN', 'Chỉ manager mới xem receipts.', ctx);
    }
    return respondJson(res, 200, {
      pending: recoveryLedger.listPending(),
      depth: recoveryLedger.depth(),
    }, ctx);
  }

  // ── POST /api/admin/recovery/run → idempotent replay of pending receipts ──
  if (path === '/api/admin/recovery/run' && req.method === 'POST') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    if (identity!.role !== 'SUPERVISOR' && identity!.role !== 'SYSTEM') {
      return respondError(res, 403, 'FORBIDDEN', 'Chỉ manager mới chạy recovery.', ctx);
    }
    const body = await readBody(req).catch(() => ({} as Record<string, unknown>));
    const onlyReceiptId = typeof body.receiptId === 'string' ? body.receiptId : null;
    // CORE/1.14 invariant: replay MUST be idempotent. Receipts already
    // applied are NOT re-applied (recoveryLedger.markApplied is idempotent).
    // Receipts FAILED are reported (not silently converted to success).
    const pending = onlyReceiptId
      ? recoveryLedger.listPending().filter((r) => r.receiptId === onlyReceiptId)
      : recoveryLedger.listPending();
    const results: Array<{ receiptId: string; outcome: 'replay_safe' | 'no_action' | 'failed'; reason?: string }> = [];
    for (const r of pending) {
      // Idempotent: receipt already in applied state? skip.
      const cur = recoveryLedger.get(r.receiptId);
      if (cur && cur.state === 'applied') {
        results.push({ receiptId: r.receiptId, outcome: 'no_action' });
        continue;
      }
      // Mark replayed: record action + leave state pending (the actual
      // side effect is the manager's manual re-run of the original route).
      recoveryLedger.recordReplay(r.receiptId);
      inc('intent.replay', { outcome: 'replay_safe' });
      results.push({ receiptId: r.receiptId, outcome: 'replay_safe' });
    }
    return respondJson(res, 200, {
      ran: results.length,
      results,
    }, ctx);
  }

  // ── POST /api/admin/recovery/resolve → manually mark receipt resolved ────
  if (path === '/api/admin/recovery/resolve' && req.method === 'POST') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    if (identity!.role !== 'SUPERVISOR' && identity!.role !== 'SYSTEM') {
      return respondError(res, 403, 'FORBIDDEN', 'Chỉ manager mới giải quyết receipt.', ctx);
    }
    const body = await readBody(req).catch(() => ({} as Record<string, unknown>));
    const receiptId = typeof body.receiptId === 'string' ? body.receiptId : '';
    if (!receiptId) {
      return respondError(res, 400, 'MISSING_RECEIPT_ID', 'Thiếu receiptId.', ctx);
    }
    const ok = recoveryLedger.resolve(receiptId);
    if (!ok) {
      return respondError(res, 404, 'RECEIPT_NOT_FOUND', `Không tìm thấy receipt ${receiptId}.`, ctx);
    }
    return respondJson(res, 200, {
      receiptId,
      outcome: 'resolved',
      depth: recoveryLedger.depth(),
    }, ctx);
  }

  // ── GET /api/admin/metrics → snapshot counters (manager-only) ──────────────
  if (path === '/api/admin/metrics' && req.method === 'GET') {
    const identity = extractIdentity(req);
    if (guardUnauthorized(identity, res, ctx)) return;
    if (identity!.role !== 'SUPERVISOR' && identity!.role !== 'SYSTEM') {
      return respondError(res, 403, 'FORBIDDEN', 'Chỉ manager mới xem metrics.', ctx);
    }
    // Lazy import to avoid circular.
    const { snapshot, observationsSnapshot } = await import('./observability/metrics.js');
    return respondJson(res, 200, {
      counters: snapshot(),
      gauges: observationsSnapshot(),
    }, ctx);
  }

  // Unknown route
  return respondJson(res, 404, { error: 'route_not_found', path }, ctx);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf-8');
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Attach x-hrp-correlation-id to every response so callers can correlate. */
/**
 * CORE/1.14 — Correlation stash. Each request writes its context here once,
 * and respondJson reads it. This lets existing route handlers that don't
 * pass ctx continue to attach the correlation header.
 */
const CORRELATION_STASH = new WeakMap<ServerResponse, CorrelationContext>();
function stashCorrelation(res: ServerResponse, ctx: CorrelationContext): void {
  CORRELATION_STASH.set(res, ctx);
}

function respondJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  ctx?: CorrelationContext,
): void {
  // CORE/1.14: avoid keep-alive in observability test flows.
  // keep-alive can hang the test runner — close connection after each
  // response to ensure no async activity leaks after a test ends.
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Connection', 'close');
  // CORE/1.14 B2: tracing metadata travels via HEADER ONLY.
  // respondJson MUST NOT mutate the body — endpoints backed by frozen
  // schemas (ContextPanelResult, PlanningBatchResult, TodaySnapshot, …)
  // reject unknown top-level fields. Tracing metadata is available to
  // callers via `x-hrp-correlation-id` and (when explicitly added by
  // the route handler) via `x-hrp-receipt-id`.
  const corrCtx = ctx ?? CORRELATION_STASH.get(res);
  if (corrCtx) {
    res.setHeader('x-hrp-correlation-id', corrCtx.correlationId);
  }
  res.end(JSON.stringify(body));
}

/**
 * CORE/1.14 — Kill-switch guard. Mutating routes MUST call this before
 * applying side effects. Returns true if blocked (and 423 already sent).
 */
function guardKillSwitch(res: ServerResponse, ctx: CorrelationContext): boolean {
  if (!killSwitch.isArmed()) return false;
  // Register receipt so recovery runbook can replay later.
  const receiptId = recoveryLedger.register({
    correlationId: ctx.correlationId,
    routeName: ctx.routeName,
    effectKind: inferEffectKind(ctx.routeName),
    idempotencyKey: `${ctx.routeName}:${ctx.correlationId}`,
  });
  inc('kill_switch.blocked', { routeName: ctx.routeName });
  // CORE/1.14 B2: tracing metadata travels via headers. body is
  // { error, message, receiptId } — receiptId is part of the kill-switch
  // DTO, NOT tracing metadata. correlationId is in x-hrp-correlation-id.
  res.setHeader('x-hrp-receipt-id', receiptId);
  respondJson(res, 423, {
    error: 'KILL_SWITCH_ARMED',
    message: 'Hệ thống đang tạm dừng thao tác ghi. Vui lòng thử lại sau khi manager disarm.',
    receiptId,
  }, ctx);
  return true;
}

function inferEffectKind(routeName: string): 'commit_batch' | 'confirm_draft' | 'provider_put' | 'intake_run' | 'intake_dnc' {
  if (routeName.includes('planning-commit')) return 'commit_batch';
  if (routeName.includes('autofill-confirm')) return 'confirm_draft';
  if (routeName.includes('providers')) return 'provider_put';
  if (routeName.includes('intake-run')) return 'intake_run';
  return 'intake_dnc';
}

/**
 * CORE/1.14 — Sanitize error response before sending. Scrubs PII/secret
 * patterns from message and ensures no `error.stack` or internal fields
 * leak to client. Tracks `error_leakage` counter if a raw stack is sent.
 */
function respondError(
  res: ServerResponse,
  status: number,
  errorCode: string,
  message: string,
  ctx: CorrelationContext,
  extra?: Record<string, unknown>,
): void {
  const scrubbedMessage = typeof message === 'string' ? scrub(message) as string : 'Lỗi không xác định';
  // Detect potential leakage: long raw stack or stack fragment.
  if (typeof message === 'string' && /at\s+\w+\s+\(/.test(message)) {
    inc('error_leakage.detected', { routeName: ctx.routeName });
  }
  // CORE/1.14 B2: error body shape is { error, message, ...extra }.
  // Tracing metadata travels via x-hrp-correlation-id header.
  respondJson(res, status, {
    error: errorCode,
    message: scrubbedMessage,
    ...(extra ?? {}),
  }, ctx);
}

async function main(): Promise<void> {
  const env = process.env as Record<string, string | undefined>;
  assertNotProductionMock(env);

  const { config, mockAllowed, production, forbiddenFound } = loadConfig({ env, kind: 'panel' });
  if (forbiddenFound.length > 0) {
    throw new Error(`Forbidden env keys: ${forbiddenFound.join(', ')}`);
  }
  if (config.contractsVersion !== '0.0.8-g0.8-fixes') {
    throw new Error(`contractsVersion mismatch: ${config.contractsVersion}`);
  }
  if (config.appKind !== 'panel') {
    throw new Error(`expected panel, got ${config.appKind}`);
  }

  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'context-panel starting',
      version: VERSION,
      appKind: config.appKind,
      nodeEnv: config.nodeEnv,
      production,
      mockAllowed,
      contractsVersion: config.contractsVersion,
      allowDevTools: config.allowDevTools,
      listen: config.listen,
    }),
  );

  await startPanel(config);
  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'context-panel listening',
      url: `http://${config.listen.host}:${config.listen.port}`,
    }),
  );
}

const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('server.js') ||
    process.argv[1].endsWith('server.ts') ||
    process.argv[1].endsWith('server.mjs'));
if (isDirectRun) {
  main().catch((err) => {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'context-panel startup failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    process.exit(1);
  });
}

export { VERSION };
