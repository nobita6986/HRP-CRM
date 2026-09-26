// src/signer.ts -- TypeScript reference for the legacy
// SHA-256(input || secret) profile. The runtime sibling lives
// in dist/signer.mjs; tests import the .mjs version so the suite
// does not require a tsc build. This file is included for
// review and for n8n designers who prefer a typed surface.
//
// IMPORTANT: do NOT import from here in production runtime; the
// n8n engine loads dist/ via package.json#n8n.

import { createHash } from 'node:crypto';

export type HrpAutomationLegacyCredential = {
  serviceId: string;
  organizationId: string;
  connectionId: string;
  secret: string;
};

export type HrpAutomationEnvelope = Record<string, unknown> & {
  commandName: string;
  idempotencyKey: string;
  organizationId: string;
  connectionId: string;
  serviceId: string;
};

export function canonicalJson(value: unknown): string {
  // Same byte-level algorithm as digest.ts/canonical().
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('non-finite number not supported by canonical digest');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const key of keys) {
      parts.push(JSON.stringify(key) + ':' + canonicalJson(record[key]));
    }
    return '{' + parts.join(',') + '}';
  }
  throw new TypeError('value cannot be canonicalised');
}

export function sha256Hex(input: string | Uint8Array): string {
  const h = createHash('sha256');
  h.update(typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input));
  return h.digest('hex');
}

export function payloadDigestHex(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

// Legacy signer. Naming matches digest.ts but the documented
// algorithm below makes clear this is NOT HMAC.
export function signLegacy(input: string, secret: string): string {
  return createHash('sha256')
    .update(Buffer.from(input, 'utf8'))
    .update(Buffer.from(secret, 'utf8'))
    .digest('hex');
}

export function stripNonDigestFields(envelope: HrpAutomationEnvelope): Record<string, unknown> {
  const out: Record<string, unknown> = { ...envelope };
  delete out.correlationId;
  delete out.occurredAt;
  delete out.commandId;
  if (out.automationSource && typeof out.automationSource === 'object') {
    const src = { ...(out.automationSource as Record<string, unknown>) };
    delete src.n8nExecutionId;
    out.automationSource = src;
  }
  return out;
}

export type ScopeKeyArgs = {
  organizationId: string;
  connectionId: string;
  serviceId: string;
  commandName: string;
  idempotencyKey: string;
};

export function scopeKeyFor(args: ScopeKeyArgs): string {
  return [
    args.organizationId,
    args.connectionId,
    args.serviceId,
    args.commandName,
    args.idempotencyKey,
  ].join('\0');
}

export function composeSigningInput(scopeKey: string, payloadDigest: string): string {
  // Literal LF, NOT CRLF. Matches gateway.ts.
  return scopeKey + '\n' + payloadDigest;
}