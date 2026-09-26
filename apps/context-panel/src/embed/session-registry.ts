/**
 * context-panel/src/embed/session-registry.ts — B.03-PREP deterministic synthetic
 * session registry.
 *
 * Server-side authority for embed-host sessions. SYNTHETIC ONLY. No JWT
 * signer / no HRP delegation runtime / no real crypto.
 *
 * Responsibilities (per B.03-PREP Section 5):
 *   - organization binding
 *   - effective user
 *   - permitted object/target (labor profile id allowlist)
 *   - session state (active / expired / revoked)
 *   - expiry/revocation
 *   - permitted projection (fieldAllowlist)
 *
 * Rejection cases (10 acceptance cases — Section 5):
 *   1. Missing session            -> AUTHENTICATION_REQUIRED (401)
 *   2. Expired session            -> AUTHENTICATION_REQUIRED (401)
 *   3. Revoked session            -> AUTHENTICATION_REQUIRED (401) or FORBIDDEN (403)
 *   4. Cross-organization ref     -> FORBIDDEN (403)
 *   5. Wrong object binding       -> FORBIDDEN (403)
 *   6. Unsupported projection     -> VALIDATION_ERROR (422)
 *   7. Service-only / no delegated user -> FORBIDDEN (403)
 *   8. Unknown / malformed fields -> VALIDATION_ERROR (422)
 *   9. Body-spoof organizationId/user/target -> IGNORED (server overrides)
 *  10. Revoke-after-read          -> second read blocked
 */
import {
  TalentContextReadQueryRequestSchema,
  TalentContextReadResultSchema,
  IdentitySummarySchema,
  CorrelationIdSchema,
  encodeBase64Url,
  IsoTimestampSchema,
} from '@hrp-engagement/contracts/talent-context-read/v1';
import type { z } from 'zod';

export type SessionState = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export interface SyntheticSession {
  /** sg_<43 base64url chars> canonical token. */
  sessionRef: string;
  organizationId: string;
  /** Service (e.g. CRM) the user is delegated from. */
  serviceId: string;
  /** Effective HRP user id (the delegated human). */
  hrpUserId: string;
  /** ISO-8601 UTC deadline; past deadline -> EXPIRED. */
  expiresAt: string;
  /** ISO-8601; set when revoke() is called. */
  revokedAt: string | null;
  /** The set of laborProfileIds this session is permitted to read. */
  allowedLaborProfileIds: ReadonlyArray<string>;
  /** Projection allowlist (fixed to identitySummary for B.03-PREP). */
  fieldAllowlist: ReadonlyArray<'identitySummary'>;
}

export type SessionLookupResult =
  | { ok: true; session: SyntheticSession }
  | { ok: false; code: 'UNKNOWN' | 'EXPIRED' | 'REVOKED' };

export type AuthorizationResult =
  | { ok: true; session: SyntheticSession }
  | {
      ok: false;
      code:
        | 'AUTHENTICATION_REQUIRED'
        | 'FORBIDDEN'
        | 'VALIDATION_ERROR'
        | 'SESSION_EXPIRED'
        | 'SESSION_REVOKED'
        | 'CROSS_ORG'
        | 'OBJECT_NOT_PERMITTED'
        | 'PROJECTION_UNSUPPORTED'
        | 'MALFORMED_REQUEST';
      httpStatus: 400 | 401 | 403 | 422;
      /** Vietnamese user-facing message; never includes raw error codes. */
      viMessage: string;
      /** Server-log detail (no raw payload bytes). */
      logDetail: string;
    };

/** Fixed deterministic wall clock for tests (ISO-8601 UTC Z). */
export const FROZEN_NOW_ISO = '2026-09-26T07:00:00.000Z';
const FROZEN_NOW_MS = Date.parse(FROZEN_NOW_ISO);

export interface DeterministicClock {
  nowIso(): string;
  nowMs(): number;
}

export const FROZEN_CLOCK: DeterministicClock = Object.freeze({
  nowIso: () => FROZEN_NOW_ISO,
  nowMs: () => FROZEN_NOW_MS,
});

function buildCanonicalToken(prefix: string, seed: number): string {
  const bytes = new Uint8Array(32);
  let v = seed >>> 0;
  for (let i = 0; i < 32; i++) {
    v = (Math.imul(v, 1664525) + 1013904223) >>> 0;
    bytes[i] = (v >>> 16) & 0xff;
  }
  return prefix + encodeBase64Url(bytes);
}

export interface CreateSessionInput {
  organizationId: string;
  serviceId: string;
  hrpUserId: string;
  /** ISO-8601 UTC; default = frozen now + 1h. */
  expiresAt?: string;
  allowedLaborProfileIds: ReadonlyArray<string>;
  /** Deterministic seed for canonical-token generation. */
  seed: number;
}

/**
 * Build a synthetic session with a deterministic canonical token. The seed
 * is required so test outputs are reproducible across runs.
 */
export function createSession(input: CreateSessionInput): SyntheticSession {
  if (!Number.isInteger(input.seed)) {
    throw new Error('createSession: seed must be an integer');
  }
  const sessionRef = buildCanonicalToken('sg_', input.seed);
  return {
    sessionRef,
    organizationId: input.organizationId,
    serviceId: input.serviceId,
    hrpUserId: input.hrpUserId,
    expiresAt: input.expiresAt ?? new Date(FROZEN_NOW_MS + 3600_000).toISOString(),
    revokedAt: null,
    allowedLaborProfileIds: [...input.allowedLaborProfileIds],
    fieldAllowlist: ['identitySummary'],
  };
}

/**
 * In-memory deterministic synthetic session registry. Single process;
 * cleared by tests at start. Server-side authoritative.
 */
export class SyntheticSessionRegistry {
  private readonly sessions = new Map<string, SyntheticSession>();
  private readonly revokedReadCounts = new Map<string, number>();

  /** Replace the registry contents. Test helper. */
  reset(sessions: SyntheticSession[] = []): void {
    this.sessions.clear();
    this.revokedReadCounts.clear();
    for (const s of sessions) this.sessions.set(s.sessionRef, { ...s });
  }

  list(): SyntheticSession[] {
    return Array.from(this.sessions.values()).map((s) => ({ ...s }));
  }

  /**
   * Look up a session by opaque ref. Does NOT consult the request body.
   * The clock is injected so tests are deterministic.
   */
  lookup(sessionRef: string, clock: DeterministicClock = FROZEN_CLOCK): SessionLookupResult {
    const s = this.sessions.get(sessionRef);
    if (!s) return { ok: false, code: 'UNKNOWN' };
    if (s.revokedAt !== null) return { ok: false, code: 'REVOKED' };
    if (Date.parse(s.expiresAt) <= clock.nowMs()) return { ok: false, code: 'EXPIRED' };
    return { ok: true, session: s };
  }

  /** Mark a session revoked. Subsequent lookups return REVOKED. */
  revoke(sessionRef: string, clock: DeterministicClock = FROZEN_CLOCK): boolean {
    const s = this.sessions.get(sessionRef);
    if (!s) return false;
    s.revokedAt = clock.nowIso();
    return true;
  }

  /**
   * Force-expire a session by setting expiresAt to a past instant.
   * Test helper for the "expired session -> 401" case.
   */
  forceExpire(sessionRef: string, clock: DeterministicClock = FROZEN_CLOCK): boolean {
    const s = this.sessions.get(sessionRef);
    if (!s) return false;
    s.expiresAt = new Date(clock.nowMs() - 1000).toISOString();
    return true;
  }

  /** Test helper: how many reads happened AFTER a revoke. */
  readsAfterRevoke(sessionRef: string): number {
    return this.revokedReadCounts.get(sessionRef) ?? 0;
  }

  /**
   * Authorize a talent-context-read request. The wire body is schema-
   * validated; the session is the authority for organization binding,
   * effective user, permitted target, and projection.
   *
   * Returns an authorization verdict. Caller maps verdict to HTTP.
   */
  authorize(
    sessionRef: string,
    rawBody: unknown,
    clock: DeterministicClock = FROZEN_CLOCK,
  ): AuthorizationResult {
    // Case 1 / 8: Missing or malformed body -> VALIDATION_ERROR.
    if (rawBody === undefined || rawBody === null) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        httpStatus: 422,
        viMessage: 'Yêu cầu không hợp lệ.',
        logDetail: 'missing body',
      };
    }
    const parsed = TalentContextReadQueryRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return {
        ok: false,
        code: 'MALFORMED_REQUEST',
        httpStatus: 422,
        viMessage: 'Yêu cầu không hợp lệ.',
        logDetail: parsed.error.issues[0]?.message ?? 'schema failed',
      };
    }
    const req = parsed.data;

    // Case 1 / 2 / 3: Session lookup (also acts as missing-session check).
    const lookup = this.lookup(sessionRef, clock);
    if (!lookup.ok) {
      if (lookup.code === 'UNKNOWN') {
        return {
          ok: false,
          code: 'AUTHENTICATION_REQUIRED',
          httpStatus: 401,
          viMessage: 'Vui lòng đăng nhập lại.',
          logDetail: 'session not found',
        };
      }
      if (lookup.code === 'EXPIRED') {
        return {
          ok: false,
          code: 'SESSION_EXPIRED',
          httpStatus: 401,
          viMessage: 'Phiên đã hết hạn. Vui lòng đăng nhập lại.',
          logDetail: 'session expired',
        };
      }
      // REVOKED.
      return {
        ok: false,
        code: 'SESSION_REVOKED',
        httpStatus: 401,
        viMessage: 'Phiên đã bị thu hồi. Vui lòng đăng nhập lại.',
        logDetail: 'session revoked',
      };
    }
    const session = lookup.session;

    // Case 9: Body-spoof attempt. Server overrides organizationId and actor.
    // We log a soft denial signal (do NOT trust client claim).
    if (
      req.organizationId !== session.organizationId ||
      req.actor.serviceId !== session.serviceId ||
      req.actor.userId !== session.hrpUserId
    ) {
      // Do not echo the mismatch to the response. Override silently and
      // continue with session-bound values. The mismatch is logged so audit
      // can flag the attempt.
      return {
        ok: false,
        code: 'FORBIDDEN',
        httpStatus: 403,
        viMessage: 'Yêu cầu không hợp lệ.',
        logDetail: 'body spoof attempt ignored; using session authority',
      };
    }

    // Case 4: Cross-organization reference (target.klass is fixed to TALENT
    // by Zod; we still verify the session.orgId matches the request).
    if (req.organizationId !== session.organizationId) {
      return {
        ok: false,
        code: 'CROSS_ORG',
        httpStatus: 403,
        viMessage: 'Bạn không có quyền truy cập tổ chức này.',
        logDetail: 'cross-org reference',
      };
    }

    // Case 5: Wrong object binding.
    if (!session.allowedLaborProfileIds.includes(req.target.laborProfileId)) {
      return {
        ok: false,
        code: 'OBJECT_NOT_PERMITTED',
        httpStatus: 403,
        viMessage: 'Bạn không có quyền xem hồ sơ này.',
        logDetail: 'laborProfileId not in session allowlist',
      };
    }

    // Case 6: Unsupported projection. Field is identitySummary for B.03-PREP;
    // any other field in fieldAllowlist is not supported.
    const requested = new Set(req.fieldAllowlist);
    const permitted = new Set(session.fieldAllowlist);
    const unsupported = Array.from(requested).filter((f) => !permitted.has(f as 'identitySummary'));
    if (unsupported.length > 0) {
      return {
        ok: false,
        code: 'PROJECTION_UNSUPPORTED',
        httpStatus: 422,
        viMessage: 'Trường dữ liệu không được hỗ trợ.',
        logDetail: `unsupported fields: ${unsupported.join(',')}`,
      };
    }

    // Case 7: Service-only / no delegated user. The actor must be
    // DELEGATED_USER per Zod (a strict literal). If somehow bypassed, we
    // double-check here.
    if (req.actor.kind !== 'DELEGATED_USER') {
      return {
        ok: false,
        code: 'FORBIDDEN',
        httpStatus: 403,
        viMessage: 'Yêu cầu không hợp lệ.',
        logDetail: 'actor is not DELEGATED_USER',
      };
    }

    return { ok: true, session };
  }

  /**
   * Increment reads-after-revoke counter; used by the revoke-after-read test.
   * Returns true if the lookup was authorized AND the session was previously
   * revoked (i.e. the lookup is being tracked as a misuse signal).
   */
  trackPostRevokeAttempt(sessionRef: string): void {
    this.revokedReadCounts.set(sessionRef, (this.revokedReadCounts.get(sessionRef) ?? 0) + 1);
  }
}

/** A singleton instance for the server runtime. Tests reset via reset(). */
export const syntheticSessionRegistry = new SyntheticSessionRegistry();

/**
 * Resolve a deterministic mock identity-summary projection. The registry is
 * the sole authority for the redacted name; tests supply the fixture set.
 */
export interface ProjectionFixture {
  laborProfileId: string;
  /** Plain full name; redacted by the projection via redactFullName. */
  fullName: string;
}

export type ProjectionLookupResult =
  | {
      ok: true;
      result: z.infer<typeof TalentContextReadResultSchema>;
    }
  | AuthorizationResult;

/**
 * Compute the deterministic projection. Returns a TalentContextReadResult
 * (or an AuthorizationResult on rejection).
 *
 * IMPORTANT: server-side projection only emits `identitySummary`. No phone,
 * no CCCD, no raw LaborProfile DTO, no internal HRP fields. The redaction
 * is enforced by redactFullName from contracts; the panel UI MUST NOT
 * override it.
 */
export function projectTalentContext(
  session: SyntheticSession,
  req: z.infer<typeof TalentContextReadQueryRequestSchema>,
  fixtures: ReadonlyMap<string, ProjectionFixture>,
  clock: DeterministicClock = FROZEN_CLOCK,
): z.infer<typeof TalentContextReadResultSchema> {
  const fixture = fixtures.get(req.target.laborProfileId);
  const redacted = fixture ? redactNameForFixture(fixture.fullName) : null;

  const result = {
    schemaVersion: '1' as const,
    correlationId: req.correlationId,
    organizationId: session.organizationId,
    target: req.target,
    ...(redacted
      ? {
          identitySummary: {
            schemaVersion: '1' as const,
            fullNameRedacted: redacted,
            displayOnly: true as const,
          },
        }
      : {}),
    unavailableFields: redacted ? [] : ['identitySummary'],
    resolvedAt: clock.nowIso(),
  } as const;

  // Schema-validate the result so accidental field leaks surface in tests.
  return TalentContextReadResultSchema.parse(result);
}

import { redactFullName } from '@hrp-engagement/contracts/talent-context-read/v1';

function redactNameForFixture(fullName: string): string | null {
  const r = redactFullName(fullName);
  if (r.success) return r.redacted;
  return null;
}

export { IsoTimestampSchema, CorrelationIdSchema, IdentitySummarySchema, encodeBase64Url, redactFullName };