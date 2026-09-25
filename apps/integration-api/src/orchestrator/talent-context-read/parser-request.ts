// src/orchestrator/talent-context-read/parser-request.ts
// Parse a TalentContextReadQuery request payload locally; never fabricate an
// HRP wire error; failure is local-validation-failure.
//
// Implements the C-03 corrected adapter boundary per CONTRACT-03C.2 r2.

import { z } from 'zod';
import {
  TalentContextReadQueryRequestSchema,
} from '@hrp-engagement/contracts/talent-context-read/v1';

export type TalentContextReadQueryRequest = z.infer<typeof TalentContextReadQueryRequestSchema>;

// ============================================================================
// Discriminated result shape (no HRP wire error fabrication).
// ============================================================================

export type ParseRequestOk = {
  ok: true;
  value: TalentContextReadQueryRequest;
};

export type ParseRequestFail = {
  ok: false;
  reason: 'local-validation-failure';
  issues: ReadonlyArray<unknown>;
};

export type ParseRequestResult = ParseRequestOk | ParseRequestFail;

// ============================================================================
// parseTalentContextReadRequest — safe-parse wrapper.
// ============================================================================

export function parseTalentContextReadRequest(raw: unknown): ParseRequestResult {
  const parsed = TalentContextReadQueryRequestSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return {
    ok: false,
    reason: 'local-validation-failure',
    issues: parsed.error.issues,
  };
}
