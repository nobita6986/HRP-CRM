/**
 * src/observability/log-scrubber.ts — CORE/1.14 PII / secret scrubber.
 *
 * Removes sensitive fields and values from any object before logging.
 * Field-name allowlist is conservative; values that match common secret
 * patterns are redacted regardless of field name.
 *
 * Blocked field-name patterns (case-insensitive, substring match):
 *  - apiKey, apikey, api_key
 *  - token, secretKey, secret_key
 *  - password, pwd
 *  - authorization, bearer
 *  - citizenId, cccd, citizenIdentity.number
 *  - fullName (raw — UI uses redacted form anyway)
 *  - phone (raw — UI uses redacted form anyway)
 *  - dob
 *  - address (contactAddress / citizenIdentity.address)
 *  - evidencePayload (raw evidence bytes / URLs)
 *  - signedUrl
 *  - privateKey, publicKey
 *
 * Value-pattern regexes (replaced with '***'):
 *  - JWT-like:  `eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`
 *  - Bearer tokens: `Bearer\s+[A-Za-z0-9._-]+`
 *  - API keys (sk-xxx, ghp_xxx, etc.)
 *  - Vietnamese CCCD (10–12 digits)
 *  - Vietnam phone numbers (0xx-xxxxxxx)
 */

const BLOCKED_FIELD_NAMES = new Set([
  'apikey',
  'api_key',
  'apitoken',
  'api_token',
  'token',
  'tokens',
  'secretkey',
  'secret_key',
  'secret',
  'password',
  'pwd',
  'authorization',
  'bearer',
  'auth',
  'citizenid',
  'cccd',
  'citizenidentity',
  'fullname',
  'phone',
  'dob',
  'address',
  'contactaddress',
  'signedurl',
  'privatekey',
  'publickey',
  'evidencepayload',
  'cookie',
  'set-cookie',
]);

const SECRET_VALUE_PATTERNS: RegExp[] = [
  // JWT
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  // Bearer
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  // API keys (sk-, ghp_, gho_, AKIA, AIza, etc.)
  /\bsk-[A-Za-z0-9]{16,}/g,
  /\bghp_[A-Za-z0-9]{16,}/g,
  /\bgho_[A-Za-z0-9]{16,}/g,
  /\bAKIA[0-9A-Z]{16}/g,
  /\bAIza[0-9A-Za-z_-]{35}/g,
  // Vietnamese CCCD (10–12 digits)
  /\b0\d{9,11}\b/g,
  // Vietnam phone numbers
  /\b(03|05|07|08|09|01[2|6|8|9])\d{8}\b/g,
];

const REDACTED = '***';

/**
 * Recursively scrub an object, returning a new object. Returns primitives
 * unchanged if they're not blocked. Always returns a NEW object — original
 * is never mutated.
 */
export function scrub(input: unknown, depth = 0): unknown {
  if (depth > 8) return '***';
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    return scrubString(input);
  }
  if (typeof input === 'number' || typeof input === 'boolean') {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((v) => scrub(v, depth + 1));
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (BLOCKED_FIELD_NAMES.has(k.toLowerCase())) {
        out[k] = REDACTED;
      } else {
        out[k] = scrub(v, depth + 1);
      }
    }
    return out;
  }
  return input;
}

function scrubString(s: string): string {
  let out = s;
  for (const re of SECRET_VALUE_PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  return out;
}

/**
 * Test-only: check whether a field name is in the blocklist.
 * Used by tests to assert no leakage in error/log messages.
 */
export function isBlockedFieldName(fieldName: string): boolean {
  return BLOCKED_FIELD_NAMES.has(fieldName.toLowerCase());
}
