/**
 * automation/index.ts — N8N/0.2 module barrel.
 *
 * Surface for callers (server.ts integration tests, future /v1/automation
 * HTTP handler in N8N/0.3).
 */

export {
  AUTOMATION_OPERATIONS,
  AutomationOperationNameSchema,
  AutomationRequestSchema,
  AutomationServiceEntrySchema,
  AutomationServiceEntry,
  AutomationServiceAlgorithm,
  AUTOMATION_SERVICE_ALGORITHMS,
  AutomationGatewayConfig,
  DEFAULT_AUTOMATION_GATEWAY_CONFIG,
  AutomationGatewayErrorCode,
  AUTOMATION_GATEWAY_ERROR_CODES,
  AutomationGatewayError,
  AutomationWireResponse,
  AutomationWireStatus,
  AutomationIdempotencyRecord,

  KillSwitchTargetSchema,
  KillSwitchTarget,
  N8nSourceSchema,
  N8nExecutionIdSchema,
  WorkflowIdSchema,
  WorkflowRevisionSchema,
  ListDueNextActionsPayloadSchema,
  AcknowledgeReminderPayloadSchema,
  GetNextActionPayloadSchema,
  DueNextActionItemSchema,
  ListDueNextActionsDataSchema,
  AcknowledgeReminderDataSchema,
  GetNextActionDataSchema,
  getAutomationGatewayError,
  makeAutomationError,
} from './types.js';

export { AutomationServiceRegistry, loadAutomationRegistryFromEnv, clampAutomationConfig, AUTOMATION_HARD_BOUNDS } from './connection-registry.js';
export type { ResolveResult, AutomationGatewayBounds } from './connection-registry.js';

export { KillSwitchStore } from './kill-switch.js';
export type { KillSwitchDecision, KillSwitchReason, KillSwitchRule } from './kill-switch.js';

export { TokenBucketRateLimiter } from './rate-limiter.js';
export type { RateLimiterDecision } from './rate-limiter.js';

export { AutomationIdempotencyStore } from './idempotency-store.js';
export type { IdempotencyLookup } from './idempotency-store.js';

export {
  canonicalJson,
  payloadDigestHex,
  sha256Hex,
  hmacSha256Hex,
  safeEqualHex,
} from './digest.js';

export { MockAutomationAdapter } from './mock-adapter.js';
export type { AutomationAdapter, MockAdapterOptions, AdapterOutcome, ListDueFixture } from './mock-adapter.js';

export { AutomationGateway } from './gateway.js';
export type { AutomationGatewayDeps, GatewayInvokeArgs, GatewayInvokeResult, RedactedLogEntry } from './gateway.js';

export { redactJson, redactString, stripClaims } from './redact.js';

export { ValidationError, DependencyOfflineError, TimeoutError, GatewayInternalError } from './errors.js';