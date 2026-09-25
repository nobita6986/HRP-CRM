// src/orchestrator/talent-context-read/parser-error.ts
// Parse a TalentContextRead ERROR payload. This parser is intended for use
// ONLY when the caller already has a payload that arrives from a real HRP
// response (i.e., the previous step determined that the response was a
// valid HRP error envelope). It returns a discriminated result and never
// fabricates a synthetic HRP wire error.
//
// Failure modes:
//  - local-validation-failure: payload is NOT an HRP error envelope.
//
// Implements the C-03 corrected adapter boundary per CONTRACT-03C.2 r2.

import { z } from 'zod';
import {
  TalentContextReadErrorResponseSchema,
} from '@hrp-engagement/contracts/talent-context-read/v1';

export type TalentContextReadErrorResponse = z.infer<typeof TalentContextReadErrorResponseSchema>;

export type ParseErrorOk = {
  ok: true;
  value: TalentContextReadErrorResponse;
};

export type ParseErrorFail = {
  ok: false;
  reason: 'local-validation-failure';
  issues: ReadonlyArray<unknown>;
};

export type ParseErrorResult = ParseErrorOk | ParseErrorFail;

export function parseTalentContextReadError(raw: unknown): ParseErrorResult {
  const parsed = TalentContextReadErrorResponseSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return {
    ok: false,
    reason: 'local-validation-failure',
    issues: parsed.error.issues,
  };
}
