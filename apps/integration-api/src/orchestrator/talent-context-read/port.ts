// src/orchestrator/talent-context-read/port.ts
// M4 isolated read port interface per CONTRACT-03C.2 r2 (C-04).
//
// The port returns a discriminated result that maps onto the three failure
// modes defined for the parser boundary:
//
//   - local-validation-failure     (parser rejected the request locally)
//   - valid-hrp-error-envelope     (response parsed as a real HRP error)
//   - transport-runtime-failure    (raised exception; cause propagated)
//
// The port itself is intentionally minimal: it does NOT perform canonical
// mutation, does NOT touch intake-orchestrator, does NOT open HRP HTTP,
// does NOT verify JWT, does NOT touch replay/delegation/audit stores.

import type { z } from 'zod';
import type {
  TalentContextReadQueryRequestSchema,
  TalentContextReadResultSchema,
  TalentContextReadErrorResponseSchema,
} from '@hrp-engagement/contracts/talent-context-read/v1';

export type TalentContextReadQueryRequest = z.infer<typeof TalentContextReadQueryRequestSchema>;
export type TalentContextReadResult = z.infer<typeof TalentContextReadResultSchema>;
export type TalentContextReadErrorResponse = z.infer<typeof TalentContextReadErrorResponseSchema>;

export type TalentContextReadPortReadOk = {
  ok: true;
  result: TalentContextReadResult;
};

export type TalentContextReadPortReadFailure =
  | { ok: false; reason: 'local-validation-failure'; issues: ReadonlyArray<unknown> }
  | { ok: false; reason: 'valid-hrp-error-envelope'; error: TalentContextReadErrorResponse }
  | { ok: false; reason: 'transport-runtime-failure'; cause: unknown };

export type TalentContextReadPortReadResult =
  | TalentContextReadPortReadOk
  | TalentContextReadPortReadFailure;

export interface TalentContextReadPort {
  /**
   * Read a talent-context result for the given request.
   *
   * `raw` is the unvalidated request shape. Implementations MUST run the
   * local request parser first and return `local-validation-failure`
   * rather than forwarding malformed input to a transport.
   */
  read(raw: unknown): Promise<TalentContextReadPortReadResult>;
}
