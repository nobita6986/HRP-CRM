// signer.mjs
// Pure, dependency-free ESM implementation of the legacy
// SHA-256(input || secret) profile used by N8N/0.3. Re-implements
// the same algorithm the gateway uses (apps/integration-api/src/automation/digest.ts),
// so signed envelopes verify exactly at /v1/automation/dispatch.
//
// IMPORTANT: this is NOT cryptographic HMAC. The legacy N8N/0.3
// profile is a single SHA-256 over the byte concatenation of
// (signingInput, secret). See THREAT-BOUNDARY.md.

import { createHash } from 'node:crypto';

/**
 * Replicates digest.ts/canonical(). Throws on non-finite numbers.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'null';
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
    const record = /** @type {Record<string, unknown>} */ (value);
    const keys = Object.keys(record).sort();
    const parts = /** @type {string[]} */ ([]);
    for (const key of keys) {
      parts.push(JSON.stringify(key) + ':' + canonicalJson(record[key]));
    }
    return '{' + parts.join(',') + '}';
  }
  throw new TypeError('value cannot be canonicalised');
}

/**
 * Replicates digest.ts/sha256Hex().
 * @param {string | Uint8Array} input
 * @returns {string} 64-char lowercase hex
 */
export function sha256Hex(input) {
  const h = createHash('sha256');
  h.update(typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input));
  return h.digest('hex');
}

/**
 * Replicates digest.ts/payloadDigestHex().
 * @param {unknown} value
 * @returns {string}
 */
export function payloadDigestHex(value) {
  return sha256Hex(canonicalJson(value));
}

/**
 * Replicates digest.ts/hmacSha256Hex(). NOTE: despite the
 * historical name this is the legacy SHA-256(input || secret)
 * profile, NOT HMAC. See THREAT-BOUNDARY.md section A.2 item 4.
 * @param {string} input
 * @param {string} secret
 * @returns {string} 64-char lowercase hex
 */
export function signLegacy(input, secret) {
  return createHash('sha256')
    .update(Buffer.from(input, 'utf8'))
    .update(Buffer.from(secret, 'utf8'))
    .digest('hex');
}

/**
 * Replicates gateway.ts/stripNonDigestFields() byte-for-byte.
 * Removes the four tracking fields the gateway canonicalises
 * out of the payload digest input.
 * @param {Record<string, unknown>} envelope
 * @returns {Record<string, unknown>}
 */
export function stripNonDigestFields(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    throw new TypeError('envelope must be an object');
  }
  const out = { ...envelope };
  delete out.correlationId;
  delete out.occurredAt;
  delete out.commandId;
  if (out.automationSource && typeof out.automationSource === 'object') {
    const src = { .../** @type {Record<string, unknown>} */ (out.automationSource) };
    delete src.n8nExecutionId;
    out.automationSource = src;
  }
  return out;
}

/**
 * Replicates AutomationIdempotencyStore/scopeKey() using the
 * source-escape '\0' delimiter. The fix in commit 5e02aa8
 * replaced a literal embedded NUL byte with this escape so the
 * file is plain UTF-8 no BOM. The compiled byte sequence is
 * IDENTICAL to '\u0000'.
 * @param {{ organizationId: string; connectionId: string; serviceId: string; commandName: string; idempotencyKey: string; }} args
 * @returns {string}
 */
export function scopeKeyFor(args) {
  return [
    args.organizationId,
    args.connectionId,
    args.serviceId,
    args.commandName,
    args.idempotencyKey,
  ].join('\0');
}

/**
 * Composes the SIGN input. Note: uses literal LF, not CRLF.
 * Matches the gateway's signingInput = scopeKey + '\n' + payloadDigest.
 * @param {string} scopeKey
 * @param {string} payloadDigest
 * @returns {string}
 */
export function composeSigningInput(scopeKey, payloadDigest) {
  return scopeKey + '\n' + payloadDigest;
}

/**
 * Top-level helper: produce the four headers + signature for an envelope.
 * NEVER returns the secret. Returns ONLY the public surface plus a
 * mirror of the envelope (without the secret, without non-digest fields).
 * @param {{ envelope: Record<string, unknown>; credential: { serviceId: string; organizationId: string; connectionId: string; secret: string }; }} args
 * @returns {{ headers: Record<string, string>; envelope: Record<string, unknown>; signerProfile: { kind: string; algorithm: string; version: number } }}
 */
export function buildHeadersAndSignature(args) {
  const env = stripNonDigestFields(args.envelope);
  const digest = payloadDigestHex(env);
  const scopeKey = scopeKeyFor({
    organizationId: args.credential.organizationId,
    connectionId: args.credential.connectionId,
    serviceId: args.credential.serviceId,
    commandName: args.envelope.commandName,
    idempotencyKey: args.envelope.idempotencyKey,
  });
  const signingInput = composeSigningInput(scopeKey, digest);
  const signatureHex = signLegacy(signingInput, args.credential.secret);
  return {
    headers: {
      'X-Hrp-Automation-Service-Id': args.credential.serviceId,
      'X-Hrp-Automation-Organization-Id': args.credential.organizationId,
      'X-Hrp-Automation-Connection-Id': args.credential.connectionId,
      'X-Hrp-Automation-Signature': signatureHex,
    },
    envelope: args.envelope,
    signerProfile: {
      kind: 'LEGACY_SHA256_INPUT_SECRET',
      algorithm: 'sha256(signingInput || secret)',
      version: 1,
    },
  };
}