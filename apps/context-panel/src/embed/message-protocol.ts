/**
 * context-panel/src/embed/message-protocol.ts — B.03-PREP embed-host message envelope.
 *
 * Defines the message envelope the parent embed-host simulator sends to the
 * context panel iframe. SYNTHETIC ONLY. No relation to any real Chatwoot
 * protocol.
 *
 * Trust boundary rules (enforced by parseEnvelope):
 *   - allowlisted parent origin (HOST_ALLOWED_ORIGINS)
 *   - source window === window.opener || expected embed frame
 *   - message type and version must match
 *   - correlation/session reference is opaque and well-formed
 *   - payload size must be <= MAX_PAYLOAD_BYTES
 *   - body schema parsed via Zod; unknown fields rejected (strict)
 *   - no admin token / raw service credential may ride along (FIELD_DENYLIST)
 *
 * Body organizationId / actor / target are NEVER trusted by the panel. They
 * are only used as a request hint; the synthetic session registry (server)
 * is the sole authority for organization binding, effective user, permitted
 * object/target, and permitted projection.
 */
import { z } from 'zod';
import {
  CorrelationIdSchema,
  CanonicalIdSchema,
  IsoTimestampSchema,
} from '@hrp-engagement/contracts/talent-context-read/v1';

/** Wire version of the embed-host envelope. Bump on breaking changes. */
export const MESSAGE_PROTOCOL_VERSION = '1' as const;

export const MessageProtocolVersionSchema = z.literal(MESSAGE_PROTOCOL_VERSION);

export const MessageTypeSchema = z.enum([
  'talent-context-read/request',
  'talent-context-read/cancel',
  'session/revoke',
]);

/**
 * Opaque session reference. The browser panel MUST NOT interpret this; it
 * forwards it server-side where the synthetic registry resolves it.
 */
export const SessionRefSchema = z
  .string()
  .regex(/^sg_[A-Za-z0-9_-]{43}$/u, 'session ref must match canonical token grammar');

/** Synthetic embed-host origin allowlist. */
export const HOST_ALLOWED_ORIGINS: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    'http://localhost:15501', 'http://127.0.0.1:15501', 'http://localhost:15502', 'http://127.0.0.1:15502', 'http://localhost:15503', 'http://127.0.0.1:15503', 'http://localhost:15504', 'http://127.0.0.1:15504',
  ]),
);

/** Hard size limit on the serialized payload (bytes). 8 KiB is enough for 1 target. */
export const MAX_PAYLOAD_BYTES = 8 * 1024;

/**
 * Fields that must NEVER ride in a browser-sent message. The panel rejects
 * the entire envelope if any of these appear anywhere in the payload.
 */
export const FIELD_DENYLIST: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    'adminToken',
    'serviceToken',
    'serviceCredential',
    'rawServiceCredential',
    'crmApiKey',
    'hrpApiKey',
    'secret',
    'password',
  ]),
);

export const RequestBodySchema = z
  .object({
    schemaVersion: MessageProtocolVersionSchema,
    correlationId: CorrelationIdSchema,
    organizationId: CanonicalIdSchema,
    actor: z
      .object({
        kind: z.literal('DELEGATED_USER'),
        serviceId: CanonicalIdSchema,
        userId: CanonicalIdSchema,
        delegationRef: z.string().regex(/^dg_[A-Za-z0-9_-]{43}$/u, 'delegationRef must match canonical token grammar'),
      })
      .strict(),
    target: z
      .object({
        kind: z.literal('TALENT'),
        laborProfileId: CanonicalIdSchema,
      })
      .strict(),
    fieldAllowlist: z
      .array(z.enum(['identitySummary']))
      .min(1)
      .max(1),
  })
  .strict();

export type RequestBody = z.infer<typeof RequestBodySchema>;

export const EnvelopeSchema = z
  .object({
    type: MessageTypeSchema,
    version: MessageProtocolVersionSchema,
    sentAt: IsoTimestampSchema,
    sessionRef: SessionRefSchema,
    correlationId: CorrelationIdSchema,
    body: RequestBodySchema,
  })
  .strict();

export type Envelope = z.infer<typeof EnvelopeSchema>;

export interface ParseOk { ok: true; envelope: Envelope }
export interface ParseErr {
  ok: false;
  code:
    | 'EMPTY_MESSAGE'
    | 'PAYLOAD_TOO_LARGE'
    | 'INVALID_JSON'
    | 'SCHEMA_FAILED'
    | 'FORBIDDEN_FIELD'
    | 'NOT_OBJECT'
    | 'MISSING_SESSION_REF'
    | 'MISSING_CORRELATION_ID';
  detail: string;
}

export type ParseResult = ParseOk | ParseErr;

function findDeniedField(value: unknown, path: string[] = []): string | null {
  if (value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findDeniedField(value[i], [...path, `[${i}]`]);
      if (hit !== null) return hit;
    }
    return null;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FIELD_DENYLIST.has(key)) return [...path, key].join('.');
    const hit = findDeniedField((value as Record<string, unknown>)[key], [...path, key]);
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * Parse and guard an inbound postMessage payload.
 *
 * The host window listener MUST call assertOrigin + isWindowLike(source)
 * BEFORE invoking this. This function is browser-free so unit tests can
 * exercise the schema/size/denylist logic without a DOM.
 */
export function parseEnvelope(rawData: unknown, rawSizeBytes?: number): ParseResult {
  if (rawData === undefined || rawData === null) {
    return { ok: false, code: 'EMPTY_MESSAGE', detail: 'no payload received' };
  }
  if (typeof rawSizeBytes === 'number' && rawSizeBytes > MAX_PAYLOAD_BYTES) {
    return {
      ok: false,
      code: 'PAYLOAD_TOO_LARGE',
      detail: `payload ${rawSizeBytes}B exceeds ${MAX_PAYLOAD_BYTES}B`,
    };
  }

  const jsonText = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);
  const textBytes = typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(jsonText).length
    : jsonText.length;
  if (textBytes > MAX_PAYLOAD_BYTES) {
    return {
      ok: false,
      code: 'PAYLOAD_TOO_LARGE',
      detail: `payload ${textBytes}B exceeds ${MAX_PAYLOAD_BYTES}B`,
    };
  }

  let parsed: unknown;
  try {
    parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
  } catch {
    return { ok: false, code: 'INVALID_JSON', detail: 'payload not valid JSON' };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: 'NOT_OBJECT', detail: 'payload must be a JSON object' };
  }

  const denied = findDeniedField(parsed);
  if (denied !== null) {
    return {
      ok: false,
      code: 'FORBIDDEN_FIELD',
      detail: `forbidden field "${denied}" present in payload`,
    };
  }

  const result = EnvelopeSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    return {
      ok: false,
      code: 'SCHEMA_FAILED',
      detail: issue ? `${issue.path.join('.')}: ${issue.message}` : 'schema failed',
    };
  }

  const env = result.data;
  if (!env.sessionRef || typeof env.sessionRef !== 'string') {
    return { ok: false, code: 'MISSING_SESSION_REF', detail: 'sessionRef required' };
  }
  if (!env.correlationId || typeof env.correlationId !== 'string') {
    return { ok: false, code: 'MISSING_CORRELATION_ID', detail: 'correlationId required' };
  }

  return { ok: true, envelope: env };
}

/**
 * Validate event.origin against the synthetic host allowlist. Browser-only.
 */
export function assertOrigin(origin: string | null | undefined): boolean {
  if (typeof origin !== 'string') return false;
  return HOST_ALLOWED_ORIGINS.has(origin);
}

export function isWindowLike(source: unknown): boolean {
  if (source === null || typeof source !== 'object') return false;
  const candidate = source as { postMessage?: unknown };
  return typeof candidate.postMessage === 'function';
}

export interface AcceptedHint {
  correlationId: string;
  sessionRef: string;
  fieldAllowlist: ReadonlyArray<'identitySummary'>;
}

export function extractAcceptedHint(envelope: Envelope): AcceptedHint {
  return {
    correlationId: envelope.correlationId,
    sessionRef: envelope.sessionRef,
    fieldAllowlist: envelope.body.fieldAllowlist,
  };
}
