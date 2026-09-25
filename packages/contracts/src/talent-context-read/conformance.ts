import { z } from 'zod';
import {
  TalentContextReadFieldSchema,
  TalentContextReadFieldAllowlistSchema,
} from './query-types.js';
import {
  IdentitySummarySchema,
  UnavailableFieldsSchema,
} from './query-types.js';

// ============================================================================
// F-06 - Request/result conformance helper (pure).
//
// The full conformance helper for the production-intended projection logic.
// Used by tests and any caller that needs to derive `identitySummary` +
// `unavailableFields` from a (validated fieldAllowlist, redactOutcome)
// pair. The unrequested case never invokes redaction, so the helper must
// produce no data and no marker for identitySummary in that case.
//
// Multi-field requested behaviour: when the caller requests identitySummary
// AND one or more known-unsupported fields, the helper preserves
// uniqueness + first-appearance order in unavailableFields.
// ============================================================================

const SUPPORTED_FIELDS = Object.freeze(['identitySummary']);
const KNOWN_UNSUPPORTED = Object.freeze([
  'placementCase',
  'availability',
  'currentRelationship',
  'nextAction',
  'recentInteractions',
  'contactability',
  'suppressionSummary',
]);

export type RedactOutcome =
  | { success: true; redacted: string }
  | { success: false; reason: string };

export type ConformanceResult = {
  identitySummary?: z.infer<typeof IdentitySummarySchema>;
  unavailableFields: z.infer<typeof UnavailableFieldsSchema>;
};

/**
 * Single consumer-facing helper for projection conformance. Tests must
 * call this directly; it is NOT invoked indirectly through the parser.
 */
export function checkResultConformance(
  requested: readonly string[],
  redactOutcome: RedactOutcome,
): ConformanceResult {
  const reqParsed = TalentContextReadFieldAllowlistSchema.parse([...requested]);

  const unavailable: string[] = [];

  // identitySummary data + marker.
  let identitySummary: z.infer<typeof IdentitySummarySchema> | undefined;
  const requestedIdentity = reqParsed.indexOf('identitySummary') !== -1;
  if (requestedIdentity) {
    if (redactOutcome && redactOutcome.success) {
      const ok = IdentitySummarySchema.safeParse({
        schemaVersion: '1',
        fullNameRedacted: redactOutcome.redacted,
        displayOnly: true,
      });
      if (ok.success) {
        identitySummary = ok.data;
      } else {
        // Redaction output violates the schema (e.g. oversize bytes).
        // Treat as requested unsafe.
        unavailable.push('identitySummary');
      }
    } else {
      // Requested unsafe: omit data; single marker, exactly once.
      unavailable.push('identitySummary');
    }
  }

  // Known unsupported: marker ONLY if requested. Preserve first-appearance
  // order so the array is unique AND in the order requested.
  const reqAsTuple = reqParsed as readonly string[];
  for (const f of KNOWN_UNSUPPORTED) {
    if (reqAsTuple.indexOf(f) !== -1) unavailable.push(f);
  }

  const unavailableFields = UnavailableFieldsSchema.parse(unavailable as readonly string[] as never);
  return { identitySummary, unavailableFields };
}

/**
 * Compare two unavailableFields arrays by sorted content (test helper).
 */
export function compareUnavailableFields(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
  if (actual.length !== expected.length) return false;
  const a = [...actual].sort();
  const b = [...expected].sort();
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Compare two unavailableFields arrays by exact content + first-appearance
 * order (unique + ordered). Used by tests that must observe the spec's
 * "multiple known requested fields keep unique/order" semantics.
 */
export function compareUnavailableFieldsInOrder(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
  if (actual.length !== expected.length) return false;
  for (let i = 0; i < actual.length; i++) {
    if ((actual as unknown as string[])[i] !== (expected as unknown as string[])[i]) return false;
  }
  return true;
}

export const CONFORMANCE_KNOWN_UNSUPPORTED = KNOWN_UNSUPPORTED;
export const CONFORMANCE_SUPPORTED = SUPPORTED_FIELDS;
