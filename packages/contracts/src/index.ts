/**
 * index.ts — Public surface cho @hrp-engagement/contracts.
 *
 * Đợt Gate 0 đã có: enums, primitives, errors, envelopes (G0/0.0–0.2).
 * Đợt 0B hiện có: commands/identity, evidence (G0/0.3a),
 *                     commands/profile, intake (G0/0.3b).
 *
 * Các task G0/0.3c–0.7 sẽ thêm tiếp: placement-case, interactions,
 * availability/suppression, next-action/scheduling, outbox/delivery,
 * gateway/providers/ports, queries/events/mappings, routing/analytics/
 * ai-proposals, permission matrix, fixtures/versioning.
 */
export * from './enums.js';
export * from './primitives.js';
export * from './errors.js';
export * from './envelopes.js';
export * from './commands/evidence.js';
export * from './commands/identity.js';
export * from './commands/profile.js';
export * from './commands/intake.js';
export * from './commands/placement-case.js';
export * from './commands/interactions.js';
export * from './commands/availability.js';
export * from './commands/suppression.js';
export * from './commands/next-action.js';
export * from './commands/scheduling.js';
export * from './commands/outbox.js';
export * from './commands/gateway.js';
export * from './commands/providers.js';
export * from './commands/ports.js';
export * from './commands/queries.js';
export * from './commands/events.js';
export * from './commands/mappings.js';
export * from './commands/routing.js';
export * from './commands/analytics.js';
export * from './commands/kpi.js';
export * from './commands/ai-proposals.js';
export * from './commands/ai-provider-config.js';
export * from './commands/dnc.js';
export * from './commands/merge-review.js';

/**
 * Re-export alias cho rõ ngữ nghĩa theo Backlog §0.3a:
 * - `MatchingOutcome` = command result tag (3 giá trị). Còn tên
 *   `IdentityMatchOutcome` được dùng trong một số tài liệu/UI — đây là
 *   cùng một schema, không tách schema mới.
 * - ExternalContactLink match state tách riêng (xem enums.ts).
 */
export { MatchingOutcomeSchema as IdentityMatchOutcomeSchema } from './enums.js';

/** Phiên bản package — pin cho consumer; bump khi breaking change. */
export const PACKAGE_VERSION = '0.0.8-g0.8-fixes' as const;
