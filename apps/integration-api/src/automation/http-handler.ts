/**
 * automation/http-handler.ts - N8N/0.3 HTTP boundary for the AutomationGateway.
 *
 * Routes:
 *   POST /v1/automation/dispatch
 *
 * The handler does NOT duplicate gateway logic. It only:
 *   1. Applies route-level guards (route enabled, mock-mode guard, body-size
 *      pre-check, route allowlist).
 *   2. Parses required credential headers (serviceId / organizationId /
 *      connectionId / signature) BEFORE reading the body. This is a hard
 *      boundary: an attacker cannot force us to buffer a payload by
 *      omitting a header.
 *   3. Reads raw body bytes with a deterministic bounded reader that
 *      drains and discards any remainder rather than destroying the
 *      socket. Oversized bodies return a deterministic 422 envelope.
 *   4. Forwards to AutomationGateway.invoke().
 *   5. Maps the gateway's httpStatus/response to the HTTP envelope.
 *   6. Emits a redacted structured log entry.
 *
 * Trust boundaries:
 *   - body envelope: organizationId is a CLAIM only; gateway compares it
 *     against the registry-resolved value. Mismatch -> 403 FORBIDDEN.
 *   - headers (serviceId / org / conn): trusted ONLY as identifier
 *     lookup keys; the credential's stored org/conn are authoritative.
 *   - signature: verified by the gateway against the registry entry's
 *     secret + scopeKey + payload digest.
 *
 * Failure-closed semantics:
 *   - Missing headers           -> 401 AUTHENTICATION_REQUIRED (no leak,
 *                                 and NO body buffering)
 *   - Unknown service           -> 401 AUTHENTICATION_REQUIRED (no leak)
 *   - Expired credential        -> 401 AUTHENTICATION_REQUIRED (no leak)
 *   - Signature mismatch        -> 401 AUTHENTICATION_REQUIRED (no leak)
 *   - Body org != credential    -> 403 FORBIDDEN
 *   - Operation not allowed     -> 403 FORBIDDEN
 *   - Payload > maxPayloadBytes -> 422 VALIDATION_ERROR (Content-Length
 *                                 pre-check OR bounded reader 422)
 *   - Schema invalid            -> 422 VALIDATION_ERROR
 *   - Idempotency conflict      -> 409 IDEMPOTENCY_CONFLICT
 *   - Rate limit exceeded       -> 429 RATE_LIMITED
 *   - Kill switch active        -> 503 DEPENDENCY_UNAVAILABLE
 *   - Adapter offline           -> 503 DEPENDENCY_UNAVAILABLE
 *   - Adapter timeout           -> 503 DEPENDENCY_UNAVAILABLE
 *
 * Logging:
 *   - Only the RedactedLogEntry is emitted.
 *   - No raw body bytes, no signature, no secret, no actor raw fields.
 *   - Internal n8n_* codes are kept in the audit log only; the wire
 *     envelope carries the FROZEN code only.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AutomationGateway,
  type GatewayInvokeResult,
  type RedactedLogEntry,
  type AutomationGatewayDeps,
} from './gateway.js';
import { redactJson } from './redact.js';
import {
  AutomationServiceRegistry,
  loadAutomationRegistryFromEnv,
} from './connection-registry.js';

export interface AutomationDispatchHeaders {
  serviceId: string;
  organizationId: string;
  connectionId: string;
  signatureHex: string;
}

export interface AutomationHttpHandlerDeps {
  /** Service identity registry. Required for the route to be enabled. */
  registry: AutomationServiceRegistry;
  /** Other gateway deps (kill switch, rate limiter, idempotency, adapter). */
  gatewayDeps: Omit<AutomationGatewayDeps, 'registry'>;
  /** Hook to receive every redacted log entry. */
  logSink?: (entry: RedactedLogEntry) => void;
  /** Hard limit on raw body bytes (defense in depth). Default: 64 KiB. */
  maxBodyBytes?: number;
  /**
   * Mock-mode guard. When 'off' the route is disabled (404). Default:
   * 'deterministic'.
   */
  mockMode?: 'deterministic' | 'off';
}

export const AUTOMATION_HTTP_HANDLER_VERSION = '0.2.0-n8n0.3';

export class AutomationHttpHandler {
  private readonly registry: AutomationServiceRegistry;
  private readonly gatewayDeps: Omit<AutomationGatewayDeps, 'registry'>;
  private readonly logSink: (entry: RedactedLogEntry) => void;
  private readonly maxBodyBytes: number;
  private readonly mockMode: 'deterministic' | 'off';

  constructor(deps: AutomationHttpHandlerDeps) {
    this.registry = deps.registry;
    this.gatewayDeps = deps.gatewayDeps;
    this.logSink =
      deps.logSink ??
      ((entry) => {
        // Default: emit a single-line JSON log to stdout. No raw body,
        // no signature, no secret, no PII (the entry is pre-redacted by
        // the gateway).
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ component: 'automation-http', ...entry }));
      });
    this.maxBodyBytes = deps.maxBodyBytes ?? 64 * 1024;
    this.mockMode = deps.mockMode ?? 'deterministic';
  }

  /**
   * Whether the route is enabled. Returns false when the mock-mode guard
   * is off OR when the registry has no entries (fail closed).
   */
  isEnabled(): boolean {
    if (this.mockMode === 'off') return false;
    if (!this.registry.isConfigured()) return false;
    return true;
  }

  /**
   * Build a per-request AutomationGateway. The gateway is stateless
   * beyond its in-memory deps; constructing one per call is cheap and
   * keeps the route free of mutable state.
   */
  private buildGateway(): AutomationGateway {
    return new AutomationGateway({
      registry: this.registry,
      ...this.gatewayDeps,
    });
  }

  /**
   * Main request handler.
   *
   * pathSegments: ['v1', 'automation', 'dispatch'] for the canonical
   * dispatch route; any other shape -> 404.
   *
   * Order of operations (intentional; N8N/0.3 r1):
   *   (a) route enabled, (b) method is POST, (c) path matches,
   *   (d) Content-Length pre-check, (e) HEADER PARSE, (f) body read.
   *   Headers MUST be parsed BEFORE the body is read so that an
   *   attacker cannot force us to buffer a payload by omitting the
   *   auth headers.
   */
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    pathSegments: ReadonlyArray<string>,
  ): Promise<void> {
    if (!this.isEnabled()) {
      return respondJson(res, 404, {
        error: 'route_disabled',
        message:
          '/v1/automation/* chan khi route bi tat (registry khong duoc cau hinh hoac mockMode=off).',
      });
    }

    if (req.method !== 'POST') {
      return respondJson(res, 405, {
        error: 'method_not_allowed',
        method: req.method ?? null,
        allowed: ['POST'],
      });
    }

    if (
      pathSegments.length !== 3 ||
      pathSegments[0] !== 'v1' ||
      pathSegments[1] !== 'automation' ||
      pathSegments[2] !== 'dispatch'
    ) {
      return respondJson(res, 404, {
        error: 'route_not_found',
        path: '/' + Array.from(pathSegments).join('/'),
        allowed: ['/v1/automation/dispatch'],
      });
    }

    // Parse required credential headers BEFORE reading the body.
    // A missing or malformed header returns 401 IMMEDIATELY without
    // having read any body bytes (defense in depth against slowloris
    // and against an attacker forcing a buffer allocation).
    let headers: AutomationDispatchHeaders;
    try {
      headers = parseAndValidateHeaders(req);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Drain any body bytes the client already sent so we can close
      // cleanly without destroying the socket. We do not buffer the
      // body; we just discard what is left.
      discardRemainingBody(req).catch(() => {
        /* best-effort drain; if it errors, we still sent the response */
      });
      return respondJson(res, 401, {
        status: 'FAILED',
        schemaVersion: '1.0.0',
        commandId: 'cmd-unknown',
        correlationId: 'corr-unknown',
        errors: [
          {
            code: 'AUTHENTICATION_REQUIRED',
            fieldPath: 'request',
            messageKey: 'errors.authenticationRequired',
            retryClass: 'REAUTHENTICATE',
          },
        ],
        message: msg,
      });
    }

    // Pre-check Content-Length (defense in depth vs slowloris).
    const contentLength = req.headers['content-length'];
    if (contentLength) {
      const declared = Number.parseInt(contentLength, 10);
      if (Number.isFinite(declared) && declared > this.maxBodyBytes) {
        discardRemainingBody(req).catch(() => {
          /* best-effort drain; sized header told us what to expect */
        });
        return respondJson(res, 422, {
          status: 'FAILED',
          schemaVersion: '1.0.0',
          commandId: 'cmd-unknown',
          correlationId: 'corr-unknown',
          errors: [
            {
              code: 'VALIDATION_ERROR',
              fieldPath: 'request',
              messageKey: 'errors.validation',
              retryClass: 'NEVER',
            },
          ],
          message: 'Content-Length vuot maxBodyBytes',
        });
      }
    }

    // Read raw body, bounded; preserves the connection on oversize so
    // the client can read a deterministic 422 JSON envelope.
    let rawBody: Uint8Array;
    try {
      rawBody = await readBoundedBody(req, this.maxBodyBytes);
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      if (code === 'PAYLOAD_TOO_LARGE') {
        // Caller sent more than maxBodyBytes. We stopped accumulating,
        // drained the remainder, and now return a deterministic
        // envelope. No socket destroy: the connection still works.
        return respondJson(res, 422, {
          status: 'FAILED',
          schemaVersion: '1.0.0',
          commandId: 'cmd-unknown',
          correlationId: 'corr-unknown',
          errors: [
            {
              code: 'VALIDATION_ERROR',
              fieldPath: 'request',
              messageKey: 'errors.validation',
              retryClass: 'NEVER',
            },
          ],
          message: 'Body exceeds maxBodyBytes',
        });
      }
      throw err;
    }
    if (rawBody.byteLength > this.maxBodyBytes) {
      return respondJson(res, 422, {
        status: 'FAILED',
        schemaVersion: '1.0.0',
        commandId: 'cmd-unknown',
        correlationId: 'corr-unknown',
        errors: [
          {
            code: 'VALIDATION_ERROR',
            fieldPath: 'request',
            messageKey: 'errors.validation',
            retryClass: 'NEVER',
          },
        ],
        message: 'Body vuot maxBodyBytes',
      });
    }

    // Parse envelope JSON. Fail closed on malformed JSON.
    let envelope: unknown;
    try {
      envelope = JSON.parse(Buffer.from(rawBody).toString('utf8'));
    } catch {
      return respondJson(res, 422, {
        status: 'FAILED',
        schemaVersion: '1.0.0',
        commandId: 'cmd-unknown',
        correlationId: 'corr-unknown',
        errors: [
          {
            code: 'VALIDATION_ERROR',
            fieldPath: 'request',
            messageKey: 'errors.validation',
            retryClass: 'NEVER',
          },
        ],
        message: 'Request body khong parse duoc JSON',
      });
    }

    let result: GatewayInvokeResult;
    try {
      result = await this.buildGateway().invoke({
        rawBody,
        envelope,
        credential: {
          serviceId: headers.serviceId,
          organizationId: headers.organizationId,
          connectionId: headers.connectionId,
          signatureHex: headers.signatureHex,
        },
      });
    } catch (err) {
      // Defensive: gateway should never throw, but if it does we must
      // still emit a redacted log and return a safe envelope.
      this.logSink(buildFatalLogEntry(rawBody, err));
      return respondJson(res, 503, {
        status: 'FAILED',
        schemaVersion: '1.0.0',
        commandId: 'cmd-unknown',
        correlationId: 'corr-unknown',
        errors: [
          {
            code: 'UNKNOWN_COMMAND_OUTCOME',
            fieldPath: 'request',
            messageKey: 'errors.unknownCommandOutcome',
            retryClass: 'RECONCILE_FIRST',
          },
        ],
        message: 'Internal gateway failure',
      });
    }

    // Emit the redacted log entry. The gateway has already redacted.
    this.logSink(result.logEntry);

    return respondJson(res, result.httpStatus, redactJson(result.response));
  }
}

/* ---------------------------------------------------------------------- */
/* Public helpers - also exported for tests.                              */
/* ---------------------------------------------------------------------- */

/**
 * Construct a handler from process.env (synthetic). Mirrors the existing
 * receiver/connection-registry env loader.
 *
 * Returns null when the env has no service entries (caller decides what
 * to do; the production server refuses to mount the route in that case).
 */
export interface AutomationHandlerEnvOpts {
  maxBodyBytes?: number;
  mockMode?: 'deterministic' | 'off';
  gatewayDeps: Omit<AutomationGatewayDeps, 'registry'>;
}

export function buildAutomationHttpHandlerFromEnv(
  env: Record<string, string | undefined>,
  opts: AutomationHandlerEnvOpts,
  logSink?: (entry: RedactedLogEntry) => void,
): AutomationHttpHandler | null {
  let entries;
  try {
    entries = loadAutomationRegistryFromEnv(env);
  } catch {
    return null;
  }
  if (entries.length === 0) return null;
  const registry = new AutomationServiceRegistry(entries);
  return new AutomationHttpHandler({
    registry,
    gatewayDeps: opts.gatewayDeps,
    logSink: logSink ?? undefined,
    maxBodyBytes: opts.maxBodyBytes ?? 64 * 1024,
    mockMode: opts.mockMode ?? 'deterministic',
  });
}

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/**
 * Read the request body up to maxBytes, accumulating chunks. Once the
 * running total exceeds maxBytes, this resolves with a Uint8Array
 * containing the capped payload BUT keeps streaming the remainder so
 * the client connection is not destroyed — that way the client can
 * always receive the deterministic 422 envelope.
 *
 * Resolution contract:
 *  - resolves with `raw` when the request ended under/at maxBytes.
 *  - rejects with `Error('PAYLOAD_TOO_LARGE')` once the cap is hit AND
 *    the incoming stream has been fully drained (or finished).
 *  - rejects with any other error if the request errored.
 *
 * Implementation note (C-05): We do NOT call `req.destroy()` on
 * oversize. We just stop buffering and consume-but-discard the
 * remainder so the socket stays in a clean half-close state for the
 * 422 response.
 */
function readBoundedBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let oversize = false;

    const finish = (): void => {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
    };

    const onData = (chunk: Buffer): void => {
      total += chunk.length;
      if (total > maxBytes) {
        if (!oversize) {
          oversize = true;
        }
        // Discard the overage chunk; do NOT call req.destroy(). We keep
        // consuming so the peer can finish its write and we can hand
        // them back a clean 422 instead of a socket reset.
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = (): void => {
      finish();
      if (oversize) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      resolve(new Uint8Array(Buffer.concat(chunks)));
    };

    const onError = (err: Error): void => {
      finish();
      reject(err);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

/**
 * Validate all required credential headers. Throws on the FIRST one
 * that is missing or malformed so the response message gives a useful
 * (non-leaky) hint.
 *
 * Required headers (lowercase canonical names in node:http):
 *   - x-hrp-automation-service-id      : non-empty string
 *   - x-hrp-automation-organization-id : non-empty string
 *   - x-hrp-automation-connection-id   : non-empty string
 *   - x-hrp-automation-signature       : 64 lowercase/uppercase hex chars
 */
function parseAndValidateHeaders(req: IncomingMessage): AutomationDispatchHeaders {
  const get = (name: string): string | undefined => {
    const v = req.headers[name.toLowerCase()];
    if (Array.isArray(v)) return v[0];
    return v;
  };
  const serviceId = get('x-hrp-automation-service-id');
  if (!serviceId) throw new Error('thieu X-Hrp-Automation-Service-Id');
  const organizationId = get('x-hrp-automation-organization-id');
  if (!organizationId) throw new Error('thieu X-Hrp-Automation-Organization-Id');
  const connectionId = get('x-hrp-automation-connection-id');
  if (!connectionId) throw new Error('thieu X-Hrp-Automation-Connection-Id');
  const signatureHex = get('x-hrp-automation-signature');
  if (!signatureHex) throw new Error('thieu X-Hrp-Automation-Signature');
  if (!/^[a-fA-F0-9]{64}$/.test(signatureHex)) {
    throw new Error('X-Hrp-Automation-Signature phai la hex SHA-256 (64 ky tu)');
  }
  return {
    serviceId,
    organizationId,
    connectionId,
    signatureHex: signatureHex.toLowerCase(),
  };
}

/**
 * Consume and discard any body bytes already buffered on the request.
 * Used after a header rejection so the connection can close cleanly
 * without an RST. Never rejects; errors are swallowed.
 */
function discardRemainingBody(req: IncomingMessage): Promise<void> {
  return new Promise((resolve) => {
    if (req.readableEnded || req.destroyed) {
      resolve();
      return;
    }
    const onEnd = (): void => {
      req.removeListener('error', onErr);
      resolve();
    };
    const onErr = (): void => {
      req.removeListener('end', onEnd);
      resolve();
    };
    req.on('end', onEnd);
    req.on('error', onErr);
    // Kick the stream in case data is already pending.
    req.resume();
  });
}

function buildFatalLogEntry(
  rawBody: Uint8Array,
  err: unknown,
): RedactedLogEntry {
  return {
    at: Date.now(),
    correlationId: 'unknown',
    commandId: 'unknown',
    commandName: 'unknown',
    workflowId: 'unknown',
    workflowRevision: -1,
    n8nExecutionId: 'unknown',
    organizationId: 'unknown',
    connectionId: 'unknown',
    serviceId: 'unknown',
    idempotencyKey: 'unknown',
    payloadDigest: 'unknown',
    scopeKey: 'unknown',
    outcome: 'FAILED',
    wireErrorCodes: ['UNKNOWN_COMMAND_OUTCOME'],
    cacheHit: false,
    idempotencyConflict: false,
    killSwitchRuleId: null,
    bytesIn: rawBody.length,
    bytesOut: 0,
    durationMs: 0,
    httpStatus: 503,
    // err.name only (no message); err.name is a class label, not a leak.
    ...(err instanceof Error ? { internalCause: err.name } : {}),
  } as RedactedLogEntry & { internalCause?: string };
}
