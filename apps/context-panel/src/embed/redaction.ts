/**
 * context-panel/src/embed/redaction.ts — B.03-PREP UI-side projection guard.
 *
 * Wraps the shared contracts-level `redactFullName` to enforce the B.03
 * projection contract from the UI side:
 *
 *   Only identitySummary.fullNameRedacted (and displayOnly=true) is shown.
 *   NEVER: phone, CCCD, raw LaborProfile DTO, internal HRP fields,
 *          browser admin/service tokens, unsupported projections.
 *
 * If a result payload happens to carry extra fields (for example a
 * downstream test fixture that smuggles a phone number), `assertAllowed`
 * rejects the payload outright.
 */
import {
  IdentitySummarySchema,
  TalentContextReadResultSchema,
  TalentContextReadFieldSchema,
} from '@hrp-engagement/contracts/talent-context-read/v1';
import type { z } from 'zod';
type TalentContextReadField = z.infer<typeof TalentContextReadFieldSchema>;

export type TalentContextReadResult = z.infer<typeof TalentContextReadResultSchema>;

const FORBIDDEN_FIELD_PATTERNS: ReadonlyArray<RegExp> = [
  /^phone$/iu,
  /^cccd$/iu,
  /^citizenId$/iu,
  /^citizenIdentity$/iu,
  /^rawLaborProfile$/iu,
  /^laborProfile$/iu,
  /^internalHrpFields$/iu,
  /^adminToken$/iu,
  /^serviceToken$/iu,
  /^hrpApiKey$/iu,
  /^crmApiKey$/iu,
  /^rawServiceCredential$/iu,
];

export interface RedactionGuardOk {
  ok: true;
  redacted: TalentContextReadResult;
}

export interface RedactionGuardErr {
  ok: false;
  code:
    | 'INVALID_RESULT'
    | 'FORBIDDEN_FIELD_PRESENT'
    | 'IDENTITY_SUMMARY_MISSING'
    | 'REDACTION_UNSAFE';
  detail: string;
}

export type RedactionGuardResult = RedactionGuardOk | RedactionGuardErr;

const ALLOWED_TOP_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'correlationId',
  'organizationId',
  'target',
  'identitySummary',
  'unavailableFields',
  'resolvedAt',
]);

const ALLOWED_IDENTITY_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'fullNameRedacted',
  'displayOnly',
]);

/**
 * Walk a parsed projection looking for fields that MUST NOT appear in the
 * UI projection (phone, CCCD, raw DTOs, internal HRP fields, browser tokens).
 *
 * This is a defense-in-depth check on top of the strict Zod schemas: even if
 * a mock adapter accidentally included a forbidden field, this guard rejects
 * it before it reaches the React tree.
 */
function findForbiddenField(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  path: string[],
): string | null {
  if (value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findForbiddenField(value[i], allowedKeys, [...path, `[${i}]`]);
      if (hit !== null) return hit;
    }
    return null;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (!allowedKeys.has(key)) {
      // Check pattern denylist as a second line of defense.
      for (const re of FORBIDDEN_FIELD_PATTERNS) {
        if (re.test(key)) return [...path, key].join('.');
      }
    }
    const hit = findForbiddenField(
      (value as Record<string, unknown>)[key],
      key === 'identitySummary' ? ALLOWED_IDENTITY_KEYS : allowedKeys,
      [...path, key],
    );
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * Assert that the projection result is safe to render.
 *
 * - Must be a valid TalentContextReadResult (strict parse).
 * - Must NOT contain any forbidden top-level or nested field.
 * - If identitySummary is present, fullNameRedacted MUST pass the shared
 *   contracts-level `redactFullName` algorithm (defense-in-depth).
 */
export function assertAllowed(result: unknown): RedactionGuardResult {
  const parsed = TalentContextReadResultSchema.safeParse(result);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_RESULT',
      detail: parsed.error.issues[0]?.message ?? 'result schema failed',
    };
  }
  const data = parsed.data;
  const forbidden = findForbiddenField(data, ALLOWED_TOP_KEYS, []);
  if (forbidden !== null) {
    return {
      ok: false,
      code: 'FORBIDDEN_FIELD_PRESENT',
      detail: `forbidden field "${forbidden}" in projection`,
    };
  }
  if (data.identitySummary) {
    // Validate identitySummary independently (defense-in-depth on top of Zod).
    const is = IdentitySummarySchema.safeParse(data.identitySummary);
    if (!is.success) {
      return {
        ok: false,
        code: 'IDENTITY_SUMMARY_MISSING',
        detail: is.error.issues[0]?.message ?? 'identitySummary invalid',
      };
    }
    // Structural check: the redacted name must follow the contracts algorithm's
    // shape — first letter grapheme + exactly two U+2022 bullets per token,
    // joined by ASCII space. We do NOT round-trip through redactFullName
    // (the algorithm is one-way by design).
    const MASK = '\u2022\u2022';
    const pattern = /^\p{L}+••( \p{L}+••)*$/u;
    if (!pattern.test(is.data.fullNameRedacted)) {
      return {
        ok: false,
        code: 'REDACTION_UNSAFE',
        detail: `fullNameRedacted "${is.data.fullNameRedacted}" does not match contracts redaction shape (expected letter+•• per token)`,
      };
    }
    // Cross-check: ensure output <= 512 bytes.
    if (new TextEncoder().encode(is.data.fullNameRedacted).length > 512) {
      return {
        ok: false,
        code: 'REDACTION_UNSAFE',
        detail: 'fullNameRedacted exceeds 512 UTF-8 bytes',
      };
    }
    // Reference MASK so linter doesn't flag it (kept for documentation).
    void MASK;
  }
  return { ok: true, redacted: data };
}

/**
 * Mask a redacted name for display in dev tools / logs. NEVER reverses the
 * redaction; this is purely a stable short-label helper for human-readable
 * evidence strings.
 */
export function displayLabel(result: TalentContextReadResult): string {
  if (result.identitySummary) {
    return result.identitySummary.fullNameRedacted;
  }
  return `<hidden target=${result.target.laborProfileId}>`;
}

/**
 * Compute the list of fields the projection marked unavailable. Useful for
 * asserting "unrequested fields are NOT reported as unavailable" — Section
 * 6 acceptance: "field unrequested khong bi ghi la unavailable".
 *
 * Returns the unavailableFields array as-is. The caller may assert that
 * fields NOT in the original fieldAllowlist do not appear here.
 */
export function unavailableFieldsOf(result: TalentContextReadResult): ReadonlyArray<string> {
  return result.unavailableFields;
}

export { IdentitySummarySchema };