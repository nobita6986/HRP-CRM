/**
 * src/observability/correlation.ts — CORE/1.14 correlation-ID middleware.
 *
 * Each HTTP receipt generates or accepts an inbound `x-hrp-correlation-id`
 * header, and the same id propagates through:
 *   HTTP receipt → server route → orchestrator run/preview → mock gateway
 *   call → checkpoint store.
 *
 * Shape: `corr-<route>-<base36(timestamp)>-<rand4>` so:
 *  - operator can read route from id;
 *  - monotonic-ish timestamp;
 *  - 4 hex chars of randomness to avoid same-tick collisions.
 *
 * NEVER use a PII field (fullName, phone, citizenId, etc.) in the id.
 */
import { randomBytes } from 'node:crypto';

const ROUTE_NAME_RE = /[^a-z0-9-]/g;

function safeRouteName(raw: string): string {
  const trimmed = raw.replace(/^\/+/, '').replace(ROUTE_NAME_RE, '');
  return trimmed.slice(0, 32) || 'unknown';
}

export interface CorrelationContext {
  correlationId: string;
  /** Inbound correlation id, if client provided one (validated). */
  inboundCorrelationId?: string;
  /** Route label — non-PII, derived from path. */
  routeName: string;
  /** Server-resolved staffId, NOT propagated to gateway as a label. */
  staffId?: string;
  /** Server-resolved organizationId. */
  organizationId?: string;
}

/** Generate a fresh correlation id (used when inbound is absent or invalid). */
export function generateCorrelationId(routePath: string): string {
  const route = safeRouteName(routePath);
  const ts = Date.now().toString(36);
  const rand = randomBytes(2).toString('hex').slice(0, 4);
  return `corr-${route}-${ts}-${rand}`;
}

/**
 * Validate a client-supplied correlation id.
 * Allow only `corr-<safe>-<ts>-<rand>` shape; if invalid, return null
 * (caller will generate a fresh one).
 *
 * NEVER accept a string that LOOKS like a PII field (citizenId, fullName, etc.).
 */
export function isValidCorrelationId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length > 96) return false;
  // Accept [A-Za-z0-9-] only. No whitespace, no JSON, no Unicode.
  return /^corr-[a-z0-9-]{1,32}-[a-z0-9]{1,16}-[a-f0-9]{4,12}$/.test(value);
}

/** Extract correlation id from HTTP request header. Generate one if absent/invalid. */
export function resolveCorrelation(
  reqHeaders: NodeJS.Dict<string | string[] | undefined>,
  urlPath: string,
): CorrelationContext {
  const inbound = reqHeaders['x-hrp-correlation-id'];
  const inboundStr = Array.isArray(inbound) ? inbound[0] : inbound;
  const route = safeRouteName(urlPath);
  if (inboundStr && isValidCorrelationId(inboundStr)) {
    return {
      correlationId: inboundStr,
      inboundCorrelationId: inboundStr,
      routeName: route,
    };
  }
  return { correlationId: generateCorrelationId(urlPath), routeName: route };
}
