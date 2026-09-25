// ============================================================================
// Talent-context-read module (CONTRACT-03A r2 - correction batch).
//
// Exports cover:
//   - Primitives (F-03 canonical tokens, F-04 binding UTC-Z + opaque grammar).
//   - Query request/result/error schemas.
//   - Delegation operation schemas (F-02 path/body split, error {status,error:{code}}).
//   - Pure assertion/profile validators (F-01).
//   - Pure redaction function with F-05 corrections.
//   - Conformance helper (F-06).
//   - Query parser (unchanged signature).
// ============================================================================

export * from './primitives.js';
export * from './query-types.js';
export * from './query-errors.js';
export * from './query-parser.js';
export * from './delegation.js';
export * from './assertion.js';
export * from './redaction.js';
export * from './conformance.js';
