/**
 * index.ts — Public surface for @hrp-engagement/core-1.10-media.
 *
 * Exports only the data-plane + policy functions. No server bootstrap
 * here (this is a library-style mock; tests are the entrypoint).
 *
 * Frozen contracts are re-exported from @hrp-engagement/contracts for
 * downstream convenience; this package does NOT modify contracts.
 */

export {
  EVIDENCE_LIFECYCLE_STATES,
  EVIDENCE_KINDS,
  EvidenceLifecycleStateSchema,
  InMemoryEvidenceStore,
  evidenceStore,
  installScanFixture,
  defaultScanFixture,
} from './evidence-store.js';
export type {
  EvidenceLifecycleState,
  EvidenceKind,
  EvidenceRecord,
  UploadRequest,
  UploadResult,
  ScanFixtureDecision,
} from './evidence-store.js';

export {
  accessSecret,
  redactPayload,
  assertNoSecretLeak,
  registerSecret,
  clearSecretStore as clearSecrets,
  assertSecretValue,
  toBrowserSafePayload,
} from './secret-provider.js';
export type { AccessRequest } from './secret-provider.js';

export {
  evaluateUrl,
  evaluateBatch,
  isPrivateHost,
  isPrivateIPv4,
  isPrivateIPv6,
  installDenyList,
  resetDenyList,
} from './url-policy.js';
export type { PolicyDecision } from './url-policy.js';

export {
  harness,
  runFixture,
  assertUrlDenied,
  assertUrlAllowed,
} from './policy-harness.js';
export type { HarnessInput, HarnessDecision } from './policy-harness.js';

/**
 * Fixture policy label (CORE/1.10 mock).
 *
 * Production MUST replace this label with HRP-owned runtime policy
 * identifiers. The label is exported so production code can grep for it
 * and ensure all references are replaced before any production
 * deployment.
 */
export const FIXTURE_POLICY_Core_1_10_MOCK_VN =
  'FIXTURE_POLICY_Core_1_10_MOCK_VN';

export const FIXTURE_ENGINE_Core_1_10_MOCK =
  'FIXTURE_ENGINE_Core_1_10_MOCK';
