// src/orchestrator/index.ts — Public surface cho intake orchestrator (CORE/1.6).
export {
  IntakeOrchestrator,
  OrchestratorError,
} from './intake-orchestrator.js';
export type {
  PreviewRequest,
  PreviewCandidate,
  PreviewResult,
  IntakeRunRequest,
  IntakeRunResult,
  IntakePartialFailure,
  IntakeFinalState,
  IdentityPreviewCaller,
  IntakeOrchestratorOptions,
} from './intake-orchestrator.js';
export type {
  StepName,
  StepRunContext,
  IdentityStepResult,
  ProfileStepResult,
  CaseStepResult,
  AvailabilityStepResult,
  IdentityOutcomeKind,
  GatewayCaller,
} from './steps.js';
export {
  STEP_ORDER,
  buildStepIdempotencyKey,
  selectIdentityScenario,
  buildCreateOrMatchPayload,
  extractMatchingOutcome,
} from './steps.js';
export {
  executeDncAction,
  buildCommitSuppressionPayload,
  assertCommitSuppressionPayloadValid,
  isDncActionCallable,
} from './dnc-handler.js';
export type { DncActionInput, DncActionResult } from './dnc-handler.js';
export {
  digestCanonical,
  buildCanonicalDraft,
} from './digest.js';
export type { CanonicalDraftInput } from './digest.js';
