// src/review/index.ts — Public surface for review service (CORE/1.7).
export { ReviewService, ReviewServiceError } from './review-service.js';
export type {
  // Output DTOs from review-service.ts
  ReviewEntryOutput,
  ReviewDecisionOutput,
  ReviewListOutput,
  ReplayResult,
} from './review-service.js';
export { ReviewHttpHandler } from './http-handler.js';
export type { ReviewHttpHandlerOptions } from './http-handler.js';
export {
  reviewStore,
  createReviewEntry,
  applyDecision,
  addLink,
  removeLink,
  createAuditEntry,
} from './review-store.js';
export type { ReviewStore, ListReviewsOptions, ListReviewsResult } from './review-store.js';
export {
  parseReviewerCapability,
  buildPermissionContext,
  canListReviews,
  canGetReviewDetail,
  canDecide,
  canLink,
  canUnlink,
  canReplay,
} from './permissions.js';
export type { PermissionCheckResult } from './permissions.js';
// Re-export types from types.ts for convenience
export type {
  ReviewEntry,
  ReviewLink,
  ReviewDecision,
  ReviewAuditEntry,
  ReviewEntryStatus,
  ReviewDecisionKind,
  ReviewLinkTargetKind,
  ReviewTier,
  ReviewerCapability,
  ReviewPermissionContext,
} from './types.js';
