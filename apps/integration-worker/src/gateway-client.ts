/**
 * gateway-client.ts — CORE/1.5
 *
 * HTTP client for CanonicalHrpGateway.
 *
 * Worker calls gateway via HTTP POST /mock/gateway/call.
 * In mock mode (HRP_MOCK_MODE=deterministic), this endpoint is available.
 *
 * In production, the gateway would be a real HRP service. For CORE/1.5 mock,
 * we call the integration-api endpoint.
 *
 * Design:
 *  - Base URL configurable via env (HRP_GATEWAY_BASE_URL).
 *  - Timeout: 30 seconds.
 *  - Retries: none (idempotency handled at worker level).
 *  - Errors: propagate as is for retry policy.
 */
import type { HrpGatewayCallRequest, HrpGatewayCallResult } from './shared-types.js';

export interface GatewayClientOptions {
  /** Base URL of the gateway. Default: http://localhost:3000 */
  baseUrl?: string;
  /** Request timeout in ms. Default: 30000 */
  timeoutMs?: number;
}

/**
 * Gateway call options.
 */
export interface GatewayCallOptions {
  /**
   * Override request timeout for this call.
   */
  timeoutMs?: number;
  /**
   * Abort signal for cancellation.
   */
  signal?: AbortSignal;
}

export class GatewayClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'GatewayClientError';
  }
}

/**
 * HTTP client for CanonicalHrpGateway.
 *
 * Wraps the HrpGatewayCallRequest → HrpGatewayCallResult roundtrip.
 */
export class GatewayClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: GatewayClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? 'http://localhost:3000';
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /**
   * Call the gateway.
   *
   * @param request HrpGatewayCallRequest validated by the caller
   * @param options timeout + abort signal
   */
  async call(
    request: HrpGatewayCallRequest,
    options: GatewayCallOptions = {},
  ): Promise<HrpGatewayCallResult> {
    const url = `${this.baseUrl}/mock/gateway/call`;
    const timeout = options.timeoutMs ?? this.timeoutMs;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const signal = options.signal
      ? (() => {
          const original = options.signal!;
          // Chain aborts
          original.addEventListener('abort', () => controller.abort());
          return controller.signal;
        })()
      : controller.signal;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(request),
        signal,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new GatewayClientError(
          `Gateway returned ${response.status}: ${JSON.stringify(body)}`,
          response.status,
          body,
        );
      }

      const result = await response.json() as HrpGatewayCallResult;
      return result;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new GatewayClientError(
          `Gateway call timeout after ${timeout}ms`,
          504,
          { timeout: true, url },
        );
      }
      if (err instanceof GatewayClientError) throw err;
      throw new GatewayClientError(
        `Gateway call failed: ${err instanceof Error ? err.message : String(err)}`,
        0,
        err,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Create a GatewayClient from environment variables.
 *
 * Reads:
 *  - HRP_GATEWAY_BASE_URL (default: http://localhost:3000)
 *  - HRP_GATEWAY_TIMEOUT_MS (default: 30000)
 */
export function createGatewayClientFromEnv(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): GatewayClient {
  const baseUrl = env['HRP_GATEWAY_BASE_URL'] ?? 'http://localhost:3000';
  const timeoutMs = env['HRP_GATEWAY_TIMEOUT_MS']
    ? Number.parseInt(env['HRP_GATEWAY_TIMEOUT_MS'], 10)
    : undefined;
  return new GatewayClient({ baseUrl, timeoutMs });
}
