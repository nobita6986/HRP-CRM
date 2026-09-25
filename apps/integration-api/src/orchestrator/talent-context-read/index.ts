// src/orchestrator/talent-context-read/index.ts
// M3 + M4 boundary per CONTRACT-03C.2 r2 (C-03, C-04).
//
// Public surface of the isolated talent-context-read adapter:
//   - Three parsers (request, result, error).
//   - The read port interface.
//   - The deterministic mock implementation.
//   - The HTTP route factory (mock-mode only).
//
// FORBIDDEN:
//   - No IntakeOrchestrator imports or wiring.
//   - No HRP HTTP runtime.
//   - No JWT signer/verifier runtime.
//   - No replay/delegation/audit DB stores.
//   - No migrations.
//   - No direct HRP database access.

export {
  parseTalentContextReadRequest,
  type ParseRequestResult,
  type ParseRequestOk,
  type ParseRequestFail,
} from './parser-request.js';
export {
  parseTalentContextReadResult,
  type ParseResultResult,
  type ParseResultOk,
  type ParseResultFail,
} from './parser-result.js';
export {
  parseTalentContextReadError,
  type ParseErrorResult,
  type ParseErrorOk,
  type ParseErrorFail,
} from './parser-error.js';
export {
  type TalentContextReadPort,
  type TalentContextReadPortReadOk,
  type TalentContextReadPortReadFailure,
  type TalentContextReadPortReadResult,
} from './port.js';
export { createDeterministicTalentContextReadPort } from './port-mock.js';
export { type TalentContextReadRouteHandle, registerTalentContextReadRouteMock } from './route.js';
