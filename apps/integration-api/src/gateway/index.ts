/**
 * gateway/index.ts — CanonicalHrpGateway mock surface (CORE/1.1).
 *
 * Surface area:
 *  - createMockGateway(opts?)  : tạo gateway instance với ledger tùy chọn.
 *  - payloadDigest(payload)    : tính SHA-256 canonical digest cho payload.
 *  - SCENARIOS                 : fixtures reference (cho test).
 *  - types                     : type exports.
 *
 * Pin contracts 0.0.8-g0.8-fixes. Không import HRP Prisma client, không
 * provider/model thật. Chỉ mock HTTP-API-side deterministic router.
 */
export { createMockGateway, payloadDigest } from './mock-gateway.js';
export { SCENARIOS } from './scenarios.js';
export { CallLedger, buildLogEntry } from './ledger.js';

export {
  SCENARIO_IDS,
  ScenarioIdSchema,
  HrpGatewayCallRequestSchema,
  AcceptedResponseShapeSchema,
  AppliedResponseShapeSchema,
  FailedResponseShapeSchema,
  HrpGatewayCallResultSchema,
  CreateOrMatchResultDataSchema,
  OneActiveCaseDataSchema,
} from './types.js';

export type {
  ScenarioId,
  HrpGatewayCallRequest,
  HrpGatewayCallResult,
  AcceptedResponseShape,
  AppliedResponseShape,
  FailedResponseShape,
  MockGateway,
  MockGatewayOptions,
  ScenarioFixture,
  CallLogEntry,
  CreateOrMatchResultData,
  OneActiveCaseData,
  NowProvider,
} from './types.js';
