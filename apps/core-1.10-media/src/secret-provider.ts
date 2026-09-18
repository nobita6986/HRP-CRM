/**
 * secret-provider.ts — Fake secret provider for CORE/1.10 (synthetic).
 *
 * Contract:
 *   - `accessSecret(req)` returns ONLY an opaque `SecretPortHandle`
 *     (matching `SecretPortHandleSchema` from contracts Gate 0.3h).
 *   - The raw secret value is **never** returned to the caller.
 *   - The raw secret value is **never** logged. A redacting logger
 *     substitutes `[REDACTED]` for any field matching
 *     `SECRET_PORT_FORBIDDEN_FIELDS`.
 *   - A redaction helper (`redactPayload`) is exported so callers
 *     (server, panel, worker) can wrap payloads before logging.
 *
 * Implementation:
 *   - The secret value is stored in-process for verification only
 *     (so a test can assert `handle.secretHandle === 'opaque-X'` after
 *     `accessSecret()`; the secret value is fetched by ID internally
 *     to support an `assertSecretValue()` test helper).
 *   - Browser payload: this module's `accessSecret()` result is
 *     serializable; the handle does NOT contain the value. A test
 *     confirms `JSON.stringify(handle).includes(secretValue) === false`.
 *
 * Real secret providers (Vault, AWS Secrets Manager, etc.) MUST replace
 * this implementation. The handle format and TTL semantics are stable
 * per `SecretPortHandleSchema` so integration can swap without changing
 * callers.
 */

import {
  SecretPortHandleSchema,
  SecretPortGetRequestSchema,
  OrganizationIdSchema,
  type SecretPortHandle,
} from '@hrp-engagement/contracts';
import { SECRET_PORT_FORBIDDEN_FIELDS } from '@hrp-engagement/contracts';
import { randomUUID } from 'node:crypto';

export interface AccessRequest {
  schemaVersion: '1';
  organizationId: string;
  provider?: string;
  connectionId?: string;
  capability: string;
  accessorTier: 'PRIVILEGED_HRP_GATE' | 'INTEGRATION_BOUND' | 'REVIEWER_BOUND';
}

/**
 * Synthetic secret store. Each id maps to a fake value. Tests use
 * `assertSecretValue(id, value)` to confirm the in-process value
 * matches what they pre-registered.
 */
const syntheticSecrets = new Map<string, { value: string; registeredAt: number }>();

export function registerSecret(id: string, value: string): void {
  syntheticSecrets.set(id, { value, registeredAt: Date.now() });
}

export function clearSecretStore(): void {
  syntheticSecrets.clear();
}

export function assertSecretValue(id: string, expected: string): void {
  const entry = syntheticSecrets.get(id);
  if (!entry) {
    throw new Error(`secret id "${id}" not registered`);
  }
  if (entry.value !== expected) {
    throw new Error(
      `secret id "${id}" value mismatch (expected ${expected.length} chars, got ${entry.value.length})`,
    );
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * Re-redaction helper.
 * ─────────────────────────────────────────────────────────────────────────── */

const REDACTED = '[REDACTED]';

/**
 * Deep-clone `payload` and replace any field whose KEY (case-insensitive,
 * at any depth) is in `SECRET_PORT_FORBIDDEN_FIELDS` with `[REDACTED]`.
 *
 * Also redacts VALUES that match a registered synthetic secret value
 * (defense-in-depth: even if a caller accidentally embeds the secret
 * value into a log message, we still redact it).
 */
export function redactPayload(payload: unknown): unknown {
  const registeredValues = [...syntheticSecrets.values()].map((s) => s.value);
  return walk(payload, registeredValues);
}

function walk(value: unknown, registeredValues: readonly string[]): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 0) {
      for (const r of registeredValues) {
        if (value.includes(r)) {
          return value.replaceAll(r, REDACTED);
        }
      }
    }
    return value;
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return '[BYTES]';
  }
  if (Array.isArray(value)) {
    return value.map((v) => walk(v, registeredValues));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const lk = k.toLowerCase();
    const isForbiddenKey = (SECRET_PORT_FORBIDDEN_FIELDS as readonly string[]).some(
      (f) => f.toLowerCase() === lk,
    );
    out[k] = isForbiddenKey ? REDACTED : walk(v, registeredValues);
  }
  return out;
}

/**
 * Test helper: assert that `serializedJson` does NOT contain any of
 * the registered synthetic secret values. Used to prove logs/payloads
 * do not leak.
 */
export function assertNoSecretLeak(serializedJson: string): void {
  for (const { value } of syntheticSecrets.values()) {
    if (serializedJson.includes(value)) {
      throw new Error(
        `secret leak detected: serialized payload contains registered secret value`,
      );
    }
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * accessSecret
 * ─────────────────────────────────────────────────────────────────────────── */

export function accessSecret(req: AccessRequest): SecretPortHandle {
  // Validate request shape via the contract schema.
  SecretPortGetRequestSchema.parse(req);
  OrganizationIdSchema.parse(req.organizationId);

  // Synthesize opaque handle (NEVER include secret value).
  const secretHandle = `opaque-${randomUUID()}`;
  const expiresInSec = 600; // 10 min — runtime HRP gate quyết TTL thực

  const handle: SecretPortHandle = SecretPortHandleSchema.parse({
    schemaVersion: req.schemaVersion,
    secretHandle,
    expiresInSec,
  });

  // Note: secret value is fetched by the *integration runtime* (HRP gate),
  // NOT here. This fake provider only returns the handle.
  return handle;
}

/**
 * Build a synthetic browser-safe payload representation. Used by tests
 * to confirm browser payloads never contain secret values.
 *
 * NOTE: This function is a TEST/REGRESSION helper. Real browser code
 * should never receive `SecretPortHandle` at all (handle is server-side).
 */
export function toBrowserSafePayload(handle: SecretPortHandle): {
  schemaVersion: string;
  expiresInSec: number;
  // secretHandle is opaque, safe to send
  secretHandle: string;
} {
  return {
    schemaVersion: handle.schemaVersion,
    expiresInSec: handle.expiresInSec,
    secretHandle: handle.secretHandle,
  };
}
