/**
 * integration-worker/src/server.ts — CORE/1.4 worker scaffold + durable leasing.
 *
 * CORE/1.4 implements:
 *  - Durable worker: poll PostgreSQL for receipts, claim with fencing, execute,
 *    complete with state transition.
 *  - Lease recovery on restart (reclaimExpiredLeases).
 *  - Graceful shutdown with drain (releaseAllForWorker).
 *  - Retry with bounded backoff + jitter; idempotency key preserved.
 *
 * Boundaries:
 *  - Poll PostgreSQL (no external broker).
 *  - Receipt committed but not yet picked → recoverable via poll.
 *  - Two workers race for same receipt → only one lease wins (FOR UPDATE SKIP LOCKED).
 *  - Stale worker cannot complete (fencing token mismatch).
 *  - CORE/1.1 (CanonicalHrpGateway) NOT integrated (CHANGES_REQUIRED).
 *    Executor fixture simulates dispatch deterministically.
 */
import { createServer, type ServerResponse } from 'node:http';
import {
  loadConfig,
  assertNotProductionMock,
  type WorkerConfig,
} from '@hrp-engagement/config';
import {
  createPrismaClient,
  assertSafeDatabaseUrl,
} from '@hrp-engagement/integration-store/client';
import {
  systemClock,
  DEFAULT_RETRY_POLICY,
} from '@hrp-engagement/integration-store/worker';
import { startDurableWorker } from './durable-worker.js';
import {
  createGatewayClientFromEnv,
  type GatewayClient,
} from './gateway-client.js';
import { createMockMappingService } from './mapping.js';

const VERSION = '1.1.0-core1.4';

interface WorkerState {
  ticks: number;
  startedAt: number;
  stoppedAt: number | null;
  durableStarted: boolean;
  durableDrained: boolean;
  durableIterations: number;
}

export interface StartWorkerOptions {
  /** When provided, the worker will start the durable poll loop against this URL. */
  databaseUrl?: string;
  /** Override executor scenario (default: SUCCESS). */
  defaultScenario?: import('./executor.js').ExecutorScenario;
  /**
   * CORE/1.5: gateway client for real pipeline.
   * When provided, uses normalize→firewall→mapping→gateway.
   * When omitted, falls back to mock executor (CORE/1.4 behavior).
   */
  gatewayClient?: GatewayClient;
}

export async function startWorker(
  config: WorkerConfig,
  opts: StartWorkerOptions = {},
): Promise<{
  state: WorkerState;
  stop: () => Promise<void>;
  healthServer: ReturnType<typeof createServer>;
  healthPort: number;
}> {
  if (config.appKind !== 'worker') {
    throw new Error(`Expected worker config, got ${config.appKind}`);
  }

  const state: WorkerState = {
    ticks: 0,
    startedAt: config.nowEpochMs ?? Date.now(),
    stoppedAt: null,
    durableStarted: false,
    durableDrained: false,
    durableIterations: 0,
  };

  // ─── Durable worker setup (only when explicit options provided) ──────
  let prisma: ReturnType<typeof createPrismaClient> | null = null;
  let durableHandle: Awaited<ReturnType<typeof startDurableWorker>> | null = null;

  // Use explicit option first, then fallback to process.env. This allows
  // unit tests to run without DATABASE_URL leaking from parent env.
  const dbUrl = opts.databaseUrl ?? process.env['DATABASE_URL'];
  if (dbUrl) {
    assertSafeDatabaseUrl(dbUrl);
    prisma = createPrismaClient({ databaseUrl: dbUrl });

    const workerId = `worker-${config.organizationId}-${process.pid}`;
    // CORE/1.5: gateway client from opts or env
    const gatewayClient = opts.gatewayClient ?? (process.env['HRP_GATEWAY_BASE_URL']
      ? createGatewayClientFromEnv(process.env as Record<string, string | undefined>)
      : undefined);

    durableHandle = await startDurableWorker(prisma, {
      workerId,
      organizationId: config.organizationId,
      pollIntervalMs: config.pollIntervalMs,
      leaseDurationMs: config.leaseDurationMs,
      maxConcurrentJobs: config.maxConcurrentJobs,
      retryPolicy: DEFAULT_RETRY_POLICY,
      clock: systemClock(),
      maxIterations: 0,
      ...(opts.defaultScenario ? { defaultScenario: opts.defaultScenario } : {}),
      ...(gatewayClient ? { gatewayClient } : {}),
      mappingService: createMockMappingService(),
    });

    state.durableStarted = true;

    const pollState = setInterval(() => {
      if (durableHandle) {
        state.durableIterations = durableHandle.state.iterations;
        state.ticks = durableHandle.state.iterations;
        if (durableHandle.state.stoppedAt) {
          state.durableDrained = durableHandle.state.drained;
        }
      }
    }, 500);
    if (typeof pollState.unref === 'function') pollState.unref();
  } else if (config.mockMode !== 'off') {
    const interval = setInterval(() => {
      state.ticks += 1;
      console.log(
        JSON.stringify({
          level: 'info',
          msg: 'worker tick (mock)',
          tick: state.ticks,
          contractsVersion: config.contractsVersion,
        }),
      );
    }, config.pollIntervalMs);
    if (typeof interval.unref === 'function') interval.unref();
  }

  // Health server.
  const healthServer = createServer((_req, res) => {
    handleHealth(res, state, config, prisma);
  });
  const healthPort = await new Promise<number>((resolve, reject) => {
    healthServer.once('error', reject);
    healthServer.listen(0, '127.0.0.1', () => {
      const addr = healthServer.address();
      if (addr && typeof addr === 'object') resolve(addr.port);
      else reject(new Error('failed to bind health port'));
    });
  });

  const stop = async (): Promise<void> => {
    if (durableHandle) {
      await durableHandle.stop();
      state.durableDrained = durableHandle.state.drained;
      state.durableIterations = durableHandle.state.iterations;
    }
    if (prisma) {
      await prisma.$disconnect();
    }
    state.stoppedAt = Date.now();
    await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  };

  return { state, stop, healthServer, healthPort };
}

function handleHealth(
  res: ServerResponse,
  state: WorkerState,
  config: WorkerConfig,
  prisma: ReturnType<typeof createPrismaClient> | null,
): void {
  const url = res.req?.url ?? '/health/live';
  const path = url.split('?')[0] ?? '/health/live';

  if (path === '/health/live') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        status: 'live',
        version: VERSION,
        pid: process.pid,
        ticks: state.ticks,
      }),
    );
    return;
  }

  if (path === '/health/ready') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        status: 'ready',
        version: VERSION,
        configLoaded: true,
        contractsVersion: config.contractsVersion,
        mockMode: config.mockMode,
        production: config.nodeEnv === 'production',
        // CORE/1.4: DB available if prisma connected.
        dependenciesConnected: prisma !== null,
        queueReady: prisma !== null,
        leaseReady: prisma !== null,
        durableStarted: state.durableStarted,
        durableDrained: state.durableDrained,
        durableIterations: state.durableIterations,
      }),
    );
    return;
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: 'route_not_found', path }));
}

async function main(): Promise<void> {
  const env = process.env as Record<string, string | undefined>;
  assertNotProductionMock(env);

  const { config, mockAllowed, production, forbiddenFound } = loadConfig({
    env,
    kind: 'worker',
  });
  if (forbiddenFound.length > 0) {
    throw new Error(`Forbidden env keys: ${forbiddenFound.join(', ')}`);
  }
  if (config.contractsVersion !== '0.0.8-g0.8-fixes') {
    throw new Error(`contractsVersion mismatch: ${config.contractsVersion}`);
  }
  if (config.appKind !== 'worker') {
    throw new Error(`expected worker, got ${config.appKind}`);
  }

  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'integration-worker starting',
      version: VERSION,
      appKind: config.appKind,
      nodeEnv: config.nodeEnv,
      production,
      mockAllowed,
      contractsVersion: config.contractsVersion,
      pollIntervalMs: config.pollIntervalMs,
      leaseDurationMs: config.leaseDurationMs,
      maxConcurrentJobs: config.maxConcurrentJobs,
      hasDatabaseUrl: !!process.env['DATABASE_URL'],
    }),
  );

  const w = await startWorker(config);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(JSON.stringify({ level: 'info', msg: 'shutdown', signal }));
    await w.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
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
        msg: 'integration-worker startup failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    process.exit(1);
  });
}

export { VERSION };
