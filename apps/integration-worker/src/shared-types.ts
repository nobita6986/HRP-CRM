/**
 * shared-types.ts — CORE/1.5
 *
 * Types shared between worker and gateway.
 *
 * Worker calls gateway via HTTP. The gateway mock returns HrpGatewayCallResult.
 * This file defines the shared types used for HTTP request/response.
 *
 * Why not import from gateway?
 *  - integration-worker and integration-api are sibling packages (no file: dep).
 *  - Each has its own @hrp-engagement/contracts dependency.
 *  - Worker uses contracts types + this shared shape for HTTP transport.
 */

import { z } from 'zod';
import {
  HrpGatewayMethodSchema,
  HrpGatewayCallContextSchema,
  AcceptedResponseSchema,
  AppliedResponseBaseSchema,
  FailedResponseSchema,
} from '@hrp-engagement/contracts';

/**
 * Mirror of HrpGatewayCallRequest from integration-api/gateway/types.ts.
 * Kept here to avoid file: dependency between packages.
 */
export const HrpGatewayCallRequestSchema = z.object({
  schemaVersion: z.literal('1'),
  organizationId: z.string().min(1).max(64),
  commandId: z.string().min(1).max(128),
  idempotencyKey: z.string().min(1).max(256),
  correlationId: z.string().min(1).max(128),
  method: HrpGatewayMethodSchema,
  context: HrpGatewayCallContextSchema,
  actor: z.object({
    kind: z.enum(['USER', 'SERVICE', 'DELEGATED_USER']),
    userId: z.string().optional(),
    serviceId: z.string().optional(),
  }).passthrough(),
  scenarioId: z.string(),
  payload: z.unknown(),
}).strict();

export type HrpGatewayCallRequest = z.infer<typeof HrpGatewayCallRequestSchema>;

/**
 * Mirror of HrpGatewayCallResult.
 * Response is one of ACCEPTED/APPLIED/FAILED.
 */
export const HrpGatewayCallResultSchema = z.union([
  AcceptedResponseSchema,
  AppliedResponseBaseSchema,
  FailedResponseSchema,
]);

export type HrpGatewayCallResult = z.infer<typeof HrpGatewayCallResultSchema>;
