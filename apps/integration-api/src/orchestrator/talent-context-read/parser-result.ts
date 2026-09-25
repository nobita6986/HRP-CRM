// src/orchestrator/talent-context-read/parser-result.ts
// Parse a TalentContextRead RESULT payload locally; never fabricate an HRP
// wire error; failure is local-validation-failure.
//
// Implements the C-03 corrected adapter boundary per CONTRACT-03C.2 r2.

import { z } from 'zod';
import {
  TalentContextReadResultSchema,
} from '@hrp-engagement/contracts/talent-context-read/v1';

export type TalentContextReadResult = z.infer<typeof TalentContextReadResultSchema>;

export type ParseResultOk = {
  ok: true;
  value: TalentContextReadResult;
};

export type ParseResultFail = {
  ok: false;
  reason: 'local-validation-failure';
  issues: ReadonlyArray<unknown>;
};

export type ParseResultResult = ParseResultOk | ParseResultFail;

export function parseTalentContextReadResult(raw: unknown): ParseResultResult {
  const parsed = TalentContextReadResultSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return {
    ok: false,
    reason: 'local-validation-failure',
    issues: parsed.error.issues,
  };
}
