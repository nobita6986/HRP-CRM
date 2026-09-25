/**
 * automation/redact.ts — internal redaction helpers.
 *
 * Used by the gateway to ensure that no secrets, raw authorization
 * headers, raw transcripts, PII or unredacted credentials leak into
 * logs or wire responses.
 *
 * Wire responses are ALWAYS redacted by construction (frozen envelope
 * only allows `code`, `messageKey`, `retryClass`, `fieldPath` for
 * errors). This file focuses on log-side redaction for operator and
 * test visibility.
 */

const SECRET_PATTERNS: ReadonlyArray<RegExp> = Object.freeze([
  /secret/gi,
  /password/gi,
  /token/gi,
  /apikey/gi,
  /api[_-]?key/gi,
  /authorization/gi,
  /bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /hmac[^,;\s]+/gi,
]);

const PII_PATTERNS: ReadonlyArray<RegExp> = Object.freeze([
  // Vietnamese CCCD (12 digits) and similar 9-12 digit ids.
  /\b\d{9,12}\b/g,
  // Phone numbers (very rough).
  /\+?\d{1,3}[ \-]?\d{3,4}[ \-]?\d{3,4}[ \-]?\d{3,4}/g,
  // Emails.
  /[\w.+-]+@[\w-]+(\.[\w-]+)+/g,
]);

const REDACTED = '[REDACTED]';

/**
 * Best-effort redaction of a string for log output. Replaces known
 * secret/PII patterns with `[REDACTED]`. Caller is responsible for
 * ensuring the input is NOT itself a raw secret (raw secrets should
 * NEVER reach this function — the gateway only ever logs safe shapes).
 */
export function redactString(input: string): string {
  let out = input;
  for (const p of SECRET_PATTERNS) {
    out = out.replace(p, REDACTED);
  }
  for (const p of PII_PATTERNS) {
    out = out.replace(p, REDACTED);
  }
  return out;
}

export function redactJson(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[REDACTED:DEPTH]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactJson(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/secret|password|token|apikey|api[_-]?key|authorization/i.test(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redactJson(v, depth + 1);
      }
    }
    return out;
  }
  return REDACTED;
}

/**
 * Strip the entire `actor` and `source` fields from a log record; both
 * are claims, not authentication proof. For audit retention they MUST
 * go through the proper HRP gate.
 */
export function stripClaims(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const obj = { ...(value as Record<string, unknown>) };
  delete obj['actor'];
  delete obj['source'];
  delete obj['automationSource'];
  delete obj['payload'];
  return obj;
}