// src/orchestrator/talent-context-read/port-mock.ts
// M4 deterministic mock port per CONTRACT-03C.2 r2 (C-04).
//
// Deterministic mock: same input -> same output. Every name goes through
// `redactFullName` from the accepted subpath BEFORE being placed in any
// result envelope. Result envelope never contains a raw PII string.
//
// The mock does NOT fabricate HRP-error envelopes by default. The
// `forceErrorCode` configuration lets tests assert the
// `valid-hrp-error-envelope` failure mode.

import {
  redactFullName,
} from '@hrp-engagement/contracts/talent-context-read/v1';

import {
  parseTalentContextReadRequest,
} from './parser-request.js';
import { parseTalentContextReadResult } from './parser-result.js';
import type {
  TalentContextReadPort,
  TalentContextReadPortReadResult,
  TalentContextReadQueryRequest,
  TalentContextReadResult,
  TalentContextReadErrorResponse,
} from './port.js';

export interface DeterministicMockConfig {
  readonly seedFullName?: string;
  readonly resolvedAt?: string;
  readonly forceErrorCode?:
    | 'VALIDATION_ERROR'
    | 'AUTHENTICATION_REQUIRED'
    | 'FORBIDDEN'
    | 'RATE_LIMITED'
    | 'DEPENDENCY_UNAVAILABLE'
    | 'NOT_FOUND'
    | 'INTERNAL_ERROR';
}

const DEFAULT_SEED_FULL_NAME = 'Nguyễn Văn An';
const DEFAULT_RESOLVED_AT = '1970-01-01T00:00:00.000Z';

const QUERY_ERROR_MESSAGE_KEY = Object.freeze({
  VALIDATION_ERROR: 'errors.validation',
  AUTHENTICATION_REQUIRED: 'errors.authenticationRequired',
  FORBIDDEN: 'errors.forbidden',
  RATE_LIMITED: 'errors.rateLimited',
  DEPENDENCY_UNAVAILABLE: 'errors.dependencyUnavailable',
  NOT_FOUND: 'errors.talentContext.notFound',
  INTERNAL_ERROR: 'errors.talentContext.internal',
} as const);

const QUERY_ERROR_RETRY_CLASS = Object.freeze({
  VALIDATION_ERROR: 'NEVER',
  AUTHENTICATION_REQUIRED: 'REAUTHENTICATE',
  FORBIDDEN: 'NEVER',
  RATE_LIMITED: 'BOUNDED_NEW_ASSERTION',
  DEPENDENCY_UNAVAILABLE: 'BOUNDED_NEW_ASSERTION',
  NOT_FOUND: 'NEVER',
  INTERNAL_ERROR: 'NEVER',
} as const);

export function createDeterministicTalentContextReadPort(
  config: DeterministicMockConfig = {},
): TalentContextReadPort {
  const seedFullName = config.seedFullName ?? DEFAULT_SEED_FULL_NAME;
  const resolvedAt = config.resolvedAt ?? DEFAULT_RESOLVED_AT;
  const forceErrorCode = config.forceErrorCode;

  return {
    async read(raw: unknown): Promise<TalentContextReadPortReadResult> {
      const parsed = parseTalentContextReadRequest(raw);
      if (!parsed.ok) {
        return { ok: false, reason: 'local-validation-failure', issues: parsed.issues };
      }

      if (forceErrorCode) {
        const error: TalentContextReadErrorResponse = {
          schemaVersion: '1',
          status: 'FAILED',
          correlationId: parsed.value.correlationId,
          errors: [
            {
              code: forceErrorCode,
              messageKey: QUERY_ERROR_MESSAGE_KEY[forceErrorCode],
              retryClass: QUERY_ERROR_RETRY_CLASS[forceErrorCode],
            },
          ],
        };
        return { ok: false, reason: 'valid-hrp-error-envelope', error };
      }

      const request: TalentContextReadQueryRequest = parsed.value;

      const redaction = redactFullName(seedFullName);
      let candidateResult: TalentContextReadResult;
      if (!redaction.success) {
        candidateResult = {
          schemaVersion: '1',
          correlationId: request.correlationId,
          organizationId: request.organizationId,
          target: request.target,
          identitySummary: undefined,
          unavailableFields: ['identitySummary'],
          resolvedAt,
        };
      } else {
        candidateResult = {
          schemaVersion: '1',
          correlationId: request.correlationId,
          organizationId: request.organizationId,
          target: request.target,
          identitySummary: {
            schemaVersion: '1',
            fullNameRedacted: redaction.redacted,
            displayOnly: true,
          },
          unavailableFields: [],
          resolvedAt,
        };
      }

      const reparse = parseTalentContextReadResult(candidateResult);
      if (!reparse.ok) {
        return { ok: false, reason: 'local-validation-failure', issues: reparse.issues };
      }
      return { ok: true, result: reparse.value };
    },
  };
}
