import { z } from 'zod';

// ============================================================================
// F-03 - Canonical base64url decoder/encoder (Node + browser safe).
//
// No browser `atob` shortcut: a base64url input may use `-` and `_` while
// the browser's `atob` (and Node's `atob`/`btoa` aliases) only handle
// standard base64 with `+`/`/`. Therefore base64url must be normalized to
// standard base64 before any standard decoder, and the decoded bytes must
// be re-encoded and compared to the input for canonical-form equality.
//
// Alphabet per RFC 4648 §5:
//   `[A-Za-z0-9_-]`   for the URL-safe variant (no `=` padding in wire form)
//   32 random bytes   => ceil(32 * 8 / 6) = 43 unpadded base64url chars
//
// Format validation does NOT prove randomness / entropy.
// ============================================================================

const ALPHABET = new Set<string>([]);
for (let i = 0x41; i <= 0x5A; i++) ALPHABET.add(String.fromCharCode(i)); // A-Z
for (let i = 0x61; i <= 0x7A; i++) ALPHABET.add(String.fromCharCode(i)); // a-z
for (let i = 0x30; i <= 0x39; i++) ALPHABET.add(String.fromCharCode(i)); // 0-9
ALPHABET.add('-');
ALPHABET.add('_');

const STD_ALPHABET = new Set<string>([]);
for (const ch of ALPHABET) STD_ALPHABET.add(ch);
STD_ALPHABET.delete('-');
STD_ALPHABET.delete('_');
STD_ALPHABET.add('+');
STD_ALPHABET.add('/');

const B64_VALUE: Record<string, number> = (() => {
  const v: Record<string, number> = {};
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < alpha.length; i++) v[alpha[i]] = i;
  return v;
})();

/** Normalize base64url -> standard base64 (no padding). */
function normalizeToStd(input: string): string {
  return input.replace(/-/g, '+').replace(/_/g, '/');
}

/** Encode bytes to canonical base64url (no padding). */
export function encodeBase64Url(bytes: Uint8Array): string {
  // Build binary string for both browser btoa and Node Buffer paths.
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] & 0xff);
  const g = globalThis as {
    btoa?: (s: string) => string;
    Buffer?: {
      from(input: Uint8Array | string, encoding?: string): Uint8Array;
      from(input: Uint8Array | string): Uint8Array;
    };
  };
  let std: string;
  if (typeof g.btoa === 'function') {
    std = g.btoa(s);
  } else if (g.Buffer && typeof g.Buffer.from === 'function') {
    // Node Buffer fallback. `Buffer.from(uint8).toString('base64')` produces
    // standard base64 (with possible +/ and trailing =), which we then
    // normalize to base64url (no padding, - and _ instead of + and /).
    std = (g.Buffer.from(bytes) as unknown as { toString(enc: string): string }).toString('base64');
  } else {
    // Last-resort: manual base64 (only safe for small arrays).
    std = manualEncode(s);
  }
  return std.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** Decode base64url to bytes. Throws if input contains `=` or non-alphabet. */
export function decodeBase64Url(str: string): Uint8Array {
  if (typeof str !== 'string') throw new Error('not a string');
  if (str.includes('=')) throw new Error('contains padding');
  for (let i = 0; i < str.length; i++) {
    if (!ALPHABET.has(str[i])) throw new Error('non-alphabet character');
  }
  // Restore padding for the standard decoder.
  const padLen = (4 - (str.length % 4)) % 4;
  const padded = normalizeToStd(str) + '='.repeat(padLen);
  const g = globalThis as {
    atob?: (s: string) => string;
    Buffer?: {
      from(input: string, encoding: string): Uint8Array;
      from(input: string): Uint8Array;
    };
  };
  let raw: string;
  if (typeof g.atob === 'function') {
    raw = g.atob(padded);
  } else if (g.Buffer && typeof g.Buffer.from === 'function') {
    // Node Buffer fallback. `Buffer.from(base64str, 'base64')` returns the
    // raw decoded bytes; re-encode to a binary string (latin1 preserves
    // every byte 0..0xFF without replacement).
    const buf = (g.Buffer.from(padded, 'base64') as unknown as { toString(enc: string): string });
    raw = buf.toString('binary');
  } else {
    raw = manualDecode(padded);
  }
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xff;
  return bytes;
}

function manualEncode(binStr: string): string {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < binStr.length; i += 3) {
    const b0 = binStr.charCodeAt(i) & 0xff;
    const b1 = i + 1 < binStr.length ? binStr.charCodeAt(i + 1) & 0xff : 0;
    const b2 = i + 2 < binStr.length ? binStr.charCodeAt(i + 2) & 0xff : 0;
    out += alpha[b0 >> 2];
    out += alpha[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < binStr.length ? alpha[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < binStr.length ? alpha[b2 & 0x3f] : '=';
  }
  return out;
}

function manualDecode(std: string): string {
  let out = '';
  for (let i = 0; i < std.length; i += 4) {
    const c0 = B64_VALUE[std[i]] || 0;
    const c1 = B64_VALUE[std[i + 1]] || 0;
    const c2 = std[i + 2] === '=' ? 0 : B64_VALUE[std[i + 2]];
    const c3 = std[i + 3] === '=' ? 0 : B64_VALUE[std[i + 3]];
    out += String.fromCharCode((c0 << 2) | (c1 >> 4));
    if (std[i + 2] !== '=') out += String.fromCharCode(((c1 & 0x0f) << 4) | (c2 >> 2));
    if (std[i + 3] !== '=') out += String.fromCharCode(((c2 & 0x03) << 6) | c3);
  }
  return out;
}

// ============================================================================
// F-03 - Canonical token schema (prefix + 43 base64url chars + 32 decoded bytes
//                                + decode/re-encode canonical roundtrip).
// ============================================================================

export function canonicalTokenSchema(prefix: string) {
  const expectedLen = 3 + 43;
  const re = new RegExp(
    '^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[A-Za-z0-9_-]{43}$',
  );
  return z
    .string()
    .min(expectedLen)
    .max(expectedLen)
    .refine((v) => re.test(v), 'must start with ' + prefix + ' and have 43 base64url chars')
    .refine((v) => {
      // Strict alphabet: reject any character outside [A-Za-z0-9_-].
      for (let i = 0; i < v.length; i++) if (!ALPHABET.has(v[i])) return false;
      // Padding is not allowed (length 43 already enforces no padding; double check).
      if (v.indexOf('=') !== -1) return false;
      // Decode + re-encode canonical roundtrip.
      try {
        const bytes = decodeBase64Url(v.slice(3));
        if (bytes.length !== 32) return false;
        return encodeBase64Url(bytes) === v.slice(3);
      } catch {
        return false;
      }
    }, 'must be canonical base64url of exactly 32 bytes');
}

export const PendingRequestIdSchema = canonicalTokenSchema('pd_');
export const HandoffProofSchema = canonicalTokenSchema('hp_');
export const ReceiptSchema = canonicalTokenSchema('rc_');
export const DelegationRefSchema = canonicalTokenSchema('dg_');
export const CallbackStateSchema = canonicalTokenSchema('st_');
export const JtiSchema = canonicalTokenSchema('jt_');
export const CsrfTokenSchema = canonicalTokenSchema('cs_');

// ============================================================================
// Primitives (module-local).
//
// Compatible with packages/contracts/src/primitives.ts at CRM baseline
// 72643356a0d1355f9dccc3921b47c990ea9c31c1 per EP-05.
// ============================================================================

export function byteLengthUtf8(s: string): number {
  return new TextEncoder().encode(s).length;
}

const OPAQUE_GRAMMAR = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

const opaqueId = (name: string, max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(OPAQUE_GRAMMAR, name + ' contains invalid characters');

/** Reusable opaque-binding-id primitive (no whitespace, no leading separator). */
export const OpaqueBindingLikeIdSchema = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(OPAQUE_GRAMMAR, 'opaque id grammar');

export const CorrelationIdSchema = opaqueId('correlationId', 128).min(8);
export const OrganizationIdSchema = opaqueId('organizationId', 64);
export const CanonicalIdSchema = opaqueId('canonical id', 128);

/**
 * Binding UTC timestamp (EP-05): RFC3339 UTC Z, 20..40 characters, valid Gregorian date.
 *
 * Strict UTC-Z literal — no offsets like +07:00. Used only in immutable B
 * (crmSessionDeadline etc). The general IsoTimestampSchema (used for
 * result.resolvedAt) keeps the broader semantic.
 */
const BINDING_RFC3339_Z = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  // month is 1-based (1..12).
  const t = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return t[month - 1] || 0;
}

function isValidGregorianDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;
  if (second < 0 || second > 60) return false; // tolerate leap second.
  return true;
}

export const BindingTimestampSchema = z
  .string()
  .min(20)
  .max(40)
  .refine((v) => {
    if (!BINDING_RFC3339_Z.test(v)) return false;
    if (/[\s\u00A0]/.test(v)) return false;
    return true;
  }, 'binding timestamp must be RFC3339 UTC Z (e.g. 2026-09-22T10:00:00.000Z)')
  .refine((v) => {
    const m = BINDING_RFC3339_Z.exec(v);
    if (!m) return false;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = Number(m[6]);
    return isValidGregorianDate(year, month, day, hour, minute, second);
  }, 'binding timestamp is not a real Gregorian date');

/**
 * General ISO-8601 timestamp (used in result.resolvedAt and unbounded surfaces).
 * NOT used inside immutable B.
 */
export const IsoTimestampSchema = z
  .string()
  .min(20)
  .max(40)
  .datetime({ offset: true });

/** Module-local schemaVersion. Not a shared v1 literal. */
export const MODULE_SCHEMA_VERSION = '1';
export const ModuleSchemaVersionSchema = z.literal(MODULE_SCHEMA_VERSION);

// ============================================================================
// F-04 - Strict CRM binding B. Used by every consumer-facing delegation schema.
// ============================================================================

const BINDING_ID_GRAMMAR = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

/** Reusable strict base binding object (used by delegation schemas that extend it). */
export const CrmBindingBaseSchema = z.object({
  organizationId: OrganizationIdSchema,
  crmSubject: CanonicalIdSchema,
  crmSessionHandle: z
    .string()
    .min(1)
    .max(128)
    .regex(BINDING_ID_GRAMMAR, 'crmSessionHandle must be opaque non-bearer alias'),
  crmSessionDeadline: BindingTimestampSchema,
  callbackId: z.string().min(1).max(64).regex(OPAQUE_GRAMMAR, 'callbackId grammar'),
});

export const CrmBindingSchema = CrmBindingBaseSchema
  .strict()
  .superRefine((value, ctx) => {
    if (/[\s\u00A0]/.test(value.callbackId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['callbackId'],
        message: 'callbackId must not contain whitespace',
      });
    }
    if (/[\s\u00A0]/.test(value.crmSessionHandle)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['crmSessionHandle'],
        message: 'crmSessionHandle must not contain whitespace',
      });
    }
  });

/** Single fixed scope literal - arrays contain exactly this one value. */
export const SINGLE_SCOPE_LITERAL = 'talent-context:read:identitySummary';
export const SingleScopeArraySchema = z
  .array(z.literal(SINGLE_SCOPE_LITERAL))
  .length(1);
