// src/orchestrator/talent-context-read/route.ts
// M4 gated route mock per CONTRACT-03C.2 r2 (C-04).
//
// The route is INTENTIONALLY gated:
//   - It is NOT registered at startup.
//   - It is registered ONLY when the caller explicitly invokes
//     `registerTalentContextReadRouteMock({...})` AND the
//     `HRP_MOCK_MODE` environment variable equals 'deterministic',
//     OR the caller sets `force: true` (only intended for tests).
//   - In any other mode (production, dev-without-mock, etc.) the
//     factory returns a no-op handler that refuses to call the port.
//
// Authorization and org binding do NOT trust the request body. They use
// only claims asserted by the caller-supplied `assertOrgBinding` hook
// (which itself defaults to reject-all).
//
// No PII (phone, CCCD, raw LaborProfile DTO, internal HRP fields) is
// ever returned.

import { parseTalentContextReadRequest } from './parser-request.js';
import { createDeterministicTalentContextReadPort } from './port-mock.js';
import type { TalentContextReadPort } from './port.js';

export interface TalentContextReadRouteHandle {
  /**
   * Was the route actually registered? Production builds always have
   * this set to false. Local mock builds have it set to true ONLY when
   * the explicit factory is invoked AND mock mode is allowed.
   */
  readonly registered: boolean;
  /**
   * Read endpoint. Always returns a discriminated result; never throws.
   */
  read(
    raw: unknown,
    callContext: TalentContextReadCallContext,
  ): Promise<TalentContextReadRouteReadResult>;
}

export type TalentContextReadRouteReadResult =
  | { ok: true; result: unknown; redactedDisplayName: string }
  | { ok: false; reason: 'mock-disabled' }
  | { ok: false; reason: 'org-binding-rejected' }
  | { ok: false; reason: 'local-validation-failure'; issues: ReadonlyArray<unknown> }
  | { ok: false; reason: 'valid-hrp-error-envelope'; error: unknown }
  | { ok: false; reason: 'transport-runtime-failure'; cause: unknown };

/**
 * The caller-supplied context must include the org id asserted by the
 * upstream auth layer. The route NEVER trusts the request body for org
 * binding; it only uses this field.
 */
export interface TalentContextReadCallContext {
  readonly assertedOrganizationId: string;
}

export interface RegisterTalentContextReadRouteMockOptions {
  readonly seedFullName?: string;
  readonly resolvedAt?: string;
  /**
   * Force registration regardless of HRP_MOCK_MODE. Intended for tests
   * only. Production code MUST leave this unset.
   */
  readonly force?: boolean;
  /**
   * Hook used to verify the caller's org binding. Default: rejects all.
   * Production code MUST supply a hook that asserts the org from the
   * authenticated session.
   */
  readonly assertOrgBinding?: (
    ctx: TalentContextReadCallContext,
  ) => boolean | Promise<boolean>;
}

const DEFAULT_DENY_ALL_ORG_BINDING = () => false;

export function registerTalentContextReadRouteMock(
  options: RegisterTalentContextReadRouteMockOptions = {},
): TalentContextReadRouteHandle {
  const envMode = process.env.HRP_MOCK_MODE;
  const allowedByEnv = envMode === 'deterministic';
  const allowedByExplicit = options.force === true;
  const registered = allowedByEnv || allowedByExplicit;

  if (!registered) {
    return {
      registered: false,
      async read() {
        return { ok: false, reason: 'mock-disabled' };
      },
    };
  }

  const port: TalentContextReadPort = createDeterministicTalentContextReadPort({
    seedFullName: options.seedFullName,
    resolvedAt: options.resolvedAt,
  });

  const assertOrgBinding = options.assertOrgBinding ?? DEFAULT_DENY_ALL_ORG_BINDING;

  return {
    registered: true,
    async read(raw, callContext) {
      try {
        const allowed = await assertOrgBinding(callContext);
        if (!allowed) {
          return { ok: false, reason: 'org-binding-rejected' };
        }

        // Parse the request first to short-circuit on local validation
        // failures before invoking the port.
        const parsed = parseTalentContextReadRequest(raw);
        if (!parsed.ok) {
          return {
            ok: false,
            reason: 'local-validation-failure',
            issues: parsed.issues,
          };
        }

        // Defense in depth: ignore any organizationId from the body and
        // only use callContext.assertedOrganizationId to bind the
        // request.
        const orgBound = {
          ...parsed.value,
          organizationId: callContext.assertedOrganizationId,
        };

        const outcome = await port.read(orgBound);
        if (outcome.ok) {
          // Defense in depth: never leak raw PII; only the redacted
          // display name may be surfaced to the caller.
          const redactedDisplayName =
            outcome.result.identitySummary &&
            outcome.result.identitySummary.fullNameRedacted
              ? outcome.result.identitySummary.fullNameRedacted
              : '';
          return { ok: true, result: outcome.result, redactedDisplayName };
        }
        if (outcome.reason === 'local-validation-failure') {
          return { ok: false, reason: 'local-validation-failure', issues: outcome.issues };
        }
        if (outcome.reason === 'valid-hrp-error-envelope') {
          return { ok: false, reason: 'valid-hrp-error-envelope', error: outcome.error };
        }
        return { ok: false, reason: 'transport-runtime-failure', cause: outcome.cause };
      } catch (err) {
        return { ok: false, reason: 'transport-runtime-failure', cause: err };
      }
    },
  };
}
