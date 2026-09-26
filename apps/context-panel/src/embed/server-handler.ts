/**
 * context-panel/src/embed/server-handler.ts — B.03-PREP server handler.
 *
 * Wires the synthetic TalentContextReadPort into the existing panel HTTP
 * server as a gated local route. SYNTHETIC ONLY.
 *
 * Route:
 *   POST /api/embed/talent-context-read
 *
 * Gate:
 *   - HRP_EMBED_MOCK_MODE=deterministic   (test mode; mock enabled)
 *   - HRP_EMBED_MOCK_MODE=off             (default; production-fail-closed)
 *   - HRP_MOCK_MODE=off                   (existing B2 guard also blocks /api/*)
 *
 * Headers (browser cannot forge admin token; only opaque session ref):
 *   - X-HRP-Embed-Session: sg_<43 base64url chars>
 *   - X-HRP-Embed-Correlation: opaque id
 *
 * Body: TalentContextReadQueryRequest (strict Zod parse)
 *
 * Returns: TalentContextReadResult | Authorization envelope
 *
 * Failure modes (mapped to HTTP):
 *   AUTHENTICATION_REQUIRED / SESSION_EXPIRED / SESSION_REVOKED -> 401
 *   FORBIDDEN / CROSS_ORG / OBJECT_NOT_PERMITTED                -> 403
 *   VALIDATION_ERROR / MALFORMED_REQUEST / PROJECTION_UNSUPPORTED -> 422
 *   mock mode off                                              -> 404
 *   production nodeEnv                                         -> 404
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  SyntheticSessionRegistry,
  SyntheticTalentContextReadPort,
  FROZEN_CLOCK,
  type DeterministicClock,
} from './port.js';
import { SessionRefSchema } from './message-protocol.js';

export interface EmbedRouteDeps {
  registry: SyntheticSessionRegistry;
  port: SyntheticTalentContextReadPort;
  clock: DeterministicClock;
}

export function defaultDeps(): EmbedRouteDeps {
  const registry = new SyntheticSessionRegistry();
  const port = new SyntheticTalentContextReadPort(registry, FROZEN_CLOCK);
  return { registry, port, clock: FROZEN_CLOCK };
}

export interface HandleOptions {
  config: { mockMode: string; nodeEnv: string };
  deps?: EmbedRouteDeps;
  readBody: (req: IncomingMessage) => Promise<string>;
  respondJson: (res: ServerResponse, status: number, body: unknown) => void;
}

export async function handleEmbedTalentContextRead(
  req: IncomingMessage,
  res: ServerResponse,
  opts: HandleOptions,
): Promise<boolean> {
  const { config, deps = defaultDeps(), readBody, respondJson } = opts;

  // Production fail-closed.
  if (config.nodeEnv === 'production') {
    respondJson(res, 404, { error: 'not_found', message: 'Embed route disabled in production.' });
    return true;
  }
  // Mock mode off -> 404 (B2 guard parity).
  if ((config.mockMode as string) === 'off') {
    respondJson(res, 404, { error: 'mock_disabled', message: 'Embed mock disabled.' });
    return true;
  }

  // Session ref must come from header (NOT body). This is the B.03-PREP
  // trust boundary: the browser carries an opaque alias, not an admin token.
  const sessionRefHeader = req.headers['x-hrp-embed-session'];
  const sessionRefRaw = Array.isArray(sessionRefHeader) ? sessionRefHeader[0] : sessionRefHeader;
  const sessionParse = SessionRefSchema.safeParse(sessionRefRaw);
  if (!sessionParse.success) {
    respondJson(res, 401, {
      error: 'AUTHENTICATION_REQUIRED',
      message: 'Vui lòng đăng nhập lại.',
    });
    return true;
  }
  const sessionRef = sessionParse.data;

  const rawBody = await readBody(req);
  let body: unknown;
  if (rawBody.length === 0) {
    body = null;
  } else {
    try {
      body = JSON.parse(rawBody);
    } catch {
      respondJson(res, 422, {
        error: 'VALIDATION_ERROR',
        message: 'Yêu cầu không hợp lệ.',
      });
      return true;
    }
  }

  const verdict = deps.port.read(sessionRef, body);
  if (!verdict.ok) {
    respondJson(res, verdict.httpStatus, {
      error: verdict.code,
      message: verdict.viMessage,
    });
    return true;
  }
  // After ok check, the ProjectionLookupResult carries `result`; the
  // AuthorizationResult carries `session`. Distinguish by structural check.
  if (!('result' in verdict)) {
    respondJson(res, 500, { error: 'INTERNAL_ERROR', message: 'Projection shape mismatch.' });
    return true;
  }
  respondJson(res, 200, verdict.result);
  return true;
}

/**
 * Convenience helper to seed a synthetic session + fixtures. Used by the
 * browser evidence harness.
 */
export function seedSynthetic(
  deps: EmbedRouteDeps,
  opts: {
    organizationId: string;
    serviceId: string;
    hrpUserId: string;
    allowedLaborProfileIds: ReadonlyArray<string>;
    fixtures: ReadonlyArray<{ laborProfileId: string; fullName: string }>;
    seed: number;
    expiresAt?: string;
  },
): string {
  const sessionRef = `sg_${canonicalSuffix(opts.seed)}`;
  deps.registry.reset([{
    sessionRef,
    organizationId: opts.organizationId,
    serviceId: opts.serviceId,
    hrpUserId: opts.hrpUserId,
    expiresAt: opts.expiresAt ?? new Date(Date.parse('2026-09-26T07:00:00.000Z') + 3600_000).toISOString(),
    revokedAt: null,
    allowedLaborProfileIds: opts.allowedLaborProfileIds,
    fieldAllowlist: ['identitySummary'],
  }]);
  for (const f of opts.fixtures) deps.port.registerFixture(f.laborProfileId, f.fullName);
  return sessionRef;
}

import { encodeBase64Url } from '@hrp-engagement/contracts/talent-context-read/v1';
function canonicalSuffix(seed: number): string {
  const bytes = new Uint8Array(32);
  let v = seed >>> 0;
  for (let i = 0; i < 32; i++) {
    v = (Math.imul(v, 1664525) + 1013904223) >>> 0;
    bytes[i] = (v >>> 16) & 0xff;
  }
  return encodeBase64Url(bytes);
}