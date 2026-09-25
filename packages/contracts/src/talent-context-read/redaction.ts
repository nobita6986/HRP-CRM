import { byteLengthUtf8 } from './primitives.js';

// ============================================================================
// Redaction - S28 REDACTION.md "Proposed algorithm" (steps 1-6).
// Pure function; no side effects; no PII in output or logs.
//
// F-05 corrections (batch 2):
//   - Drop the custom Unicode-whitelist script (cp-range tables for L);
//     rely on Unicode property escapes (\p{L}, \p{M}) so the algorithm
//     naturally covers Arabic, Hangul, supplementary plane, etc.
//   - Cc/Cf/FEFF/bidi are rejected BEFORE normalization.
//   - Initial lấy grapheme/code point hợp lệ, không UTF-16 half surrogate.
//   - Output <= 512 UTF-8 bytes (function + schema layer).
//   - Missing / throwing segmenter => safe omission, NO throw, NO raw leak.
//   - Quá giới hạn => omit, không truncate.
//
// Format validation does NOT prove randomness / entropy.
// ============================================================================

const MASK = '\u2022\u2022'; // "••"
const SPACE = ' ';

const INPUT_MAX_CODEPOINTS = 256;
const TOKEN_MAX = 16;
const OUTPUT_MAX_BYTES = 512;

/**
 * Token grammar (Unicode property escapes only).
 * Starts with a letter, may contain letters/marks, optionally contains
 * internal apostrophe/hyphen separators between letter groups.
 */
const TOKEN_GRAMMAR =
  /^[\p{L}][\p{L}\p{M}]*(?:['-][\p{L}][\p{L}\p{M}]*)*$/u;

/**
 * Cc/Cf/FEFF/bidi set per accepted grammar.
 * - FEFF (65279): Cf (ZWNBSP) - rejected even though narrow.
 * - 0..0x1F + 0x7F + 0x80..0x9F: Cc.
 * - 0x202A..0x202E: bidi controls.
 * - 0x2066..0x2069: isolating bidi controls.
 */
const CF_BIDI = /[\u0000-\u001F\u007F\u0080-\u009F\uFEFF\u202A-\u202E\u2066-\u2069]/u;

function codePointsOf(input: string): string[] {
  if (typeof input !== 'string') return [];
  if (typeof input[Symbol.iterator] === 'function') {
    const out: string[] = [];
    for (const ch of input) out.push(ch);
    return out;
  }
  return Array.from(input);
}

function containsControlOrFormat(input: string): boolean {
  if (CF_BIDI.test(input)) return true;
  return false;
}

/**
 * NFC normalize + whitespace trim/collapse.
 * Returns null if the result is empty.
 */
function normalizeAndTrim(input: string): string | null {
  const normalized = input.normalize('NFC');
  const wsRegex = /[\s\u00A0\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/gu;
  const collapsed = normalized.trim().replace(wsRegex, ' ');
  if (collapsed.length === 0) return null;
  return collapsed;
}

/**
 * Try to obtain an Intl.Segmenter at grapheme granularity. Returns null if
 * not available. Never throws.
 */
function obtainSegmenter(): Intl.Segmenter | null {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      return new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Get the first letter-led grapheme cluster of a token.
 * Returns null if the token does not match the grammar or the segmenter
 * is missing or fails. NEVER throws.
 */
function firstLetterGrapheme(token: string): string | null {
  if (!TOKEN_GRAMMAR.test(token)) return null;
  const seg = obtainSegmenter();
  if (seg === null) return null;

  let clusters: string[];
  try {
    clusters = [];
    for (const s of seg.segment(token)) {
      clusters.push(s.segment);
    }
  } catch {
    return null;
  }
  if (clusters.length < 2) return null;

  const firstCluster = clusters[0];
  if (firstCluster === undefined || firstCluster.length === 0) return null;

  // Inspect at the code-point level (not UTF-16 code-unit) so SMP initial
  // letters count.
  const cps = codePointsOf(firstCluster);
  if (cps.length === 0) return null;
  const firstCodePoint = cps[0].codePointAt(0);
  if (firstCodePoint === undefined) return null;

  // \p{L} check via a regex on the code-point string. The character class
  // `[\p{L}]` requires the `u` flag and accepts code-point strings including
  // SMP code points.
  if (!/^\p{L}$/u.test(cps[0])) return null;

  return firstCluster;
}

/**
 * Pure redaction function.
 *  - { success: true,  redacted, fullNameBytes }   on safe input
 *  - { success: false, reason: 'unsafe' }          on unsafe input
 *
 * Algorithm (S28 REDACTION.md + F-05 corrections):
 *  1. Require string. Reject Cc/Cf/FEFF/bidi BEFORE whitespace normalization.
 *  2. Code-point cap (<=256).
 *  3. NFC normalize; trim+collapse whitespace; empty output => unsafe.
 *  4. Split on ASCII space; each token must match the Unicode-property
 *     grammar `^[\p{L}][\p{L}\p{M}]*(?:['-][\p{L}][\p{L}\p{M}]*)*$`.
 *  5. Token cap (<=16).
 *  6. First letter-led grapheme cluster of each token + exactly "••";
 *     join with ASCII space.
 *  7. Output byte cap (<=512 UTF-8 bytes). Over-limit => unsafe (omit,
 *     never truncate).
 *  8. Missing/unavailable/throwing segmenter or malformed input => unsafe
 *     (NEVER throws; NEVER leaks raw input).
 */
export function redactFullName(input: unknown) {
  // Step 1.
  if (typeof input !== 'string') return { success: false as const, reason: 'unsafe' as const };
  if (containsControlOrFormat(input)) return { success: false as const, reason: 'unsafe' as const };

  // Step 2 - code-point bound.
  if (codePointsOf(input).length > INPUT_MAX_CODEPOINTS) {
    return { success: false as const, reason: 'unsafe' as const };
  }

  // Step 3 - NFC + whitespace.
  let normalized: string | null;
  try {
    normalized = normalizeAndTrim(input);
  } catch {
    return { success: false as const, reason: 'unsafe' as const };
  }
  if (normalized === null) return { success: false as const, reason: 'unsafe' as const };

  // Step 4 - split tokens.
  const tokens = normalized.split(' ');
  if (tokens.length === 0) return { success: false as const, reason: 'unsafe' as const };

  // Step 5 - token bound.
  if (tokens.length > TOKEN_MAX) return { success: false as const, reason: 'unsafe' as const };

  // Step 6 - first letter-led grapheme cluster per token.
  const initials: string[] = [];
  for (const token of tokens) {
    if (token.length === 0) return { success: false as const, reason: 'unsafe' as const };
    const initial = firstLetterGrapheme(token);
    if (initial === null) return { success: false as const, reason: 'unsafe' as const };
    initials.push(initial);
  }

  // Step 7 - emit masked initials.
  const redacted = initials.map((i) => i + MASK).join(SPACE);

  // Step 8 - output byte cap. Over-limit means WHOLE-PROJECTION omission.
  let bytes: number;
  try {
    bytes = byteLengthUtf8(redacted);
  } catch {
    return { success: false as const, reason: 'unsafe' as const };
  }
  if (bytes > OUTPUT_MAX_BYTES) return { success: false as const, reason: 'unsafe' as const };

  return { success: true as const, redacted, fullNameBytes: bytes };
}

export const REDACTION_LIMITS = Object.freeze({
  INPUT_MAX_CODEPOINTS,
  TOKEN_MAX,
  OUTPUT_MAX_BYTES,
});
