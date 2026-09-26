/**
 * context-panel/src/embed/port.ts — B.03-PREP TalentContextReadPort.
 *
 * Consumer-adoption seam: the synthetic mock implementation consumed by the
 * embed-host panel. The contract surface is derived from
 * @hrp-engagement/contracts/talent-context-read/v1 (delegation + query).
 *
 * The port is what the panel calls; it does NOT contain any DOM-aware
 * browser code. Real implementations (HRP runtime / canonical gateway) are
 * NOT wired here — B.03-PREP is synthetic-only and B.02/B.03 production
 * adapters will be added later under BLOCKED_BY_HRP_RUNTIME.
 */
import type { z } from 'zod';
import {
  TalentContextReadQueryRequestSchema,
  TalentContextReadResultSchema,
  IsoTimestampSchema,
  CorrelationIdSchema,
} from '@hrp-engagement/contracts/talent-context-read/v1';
import {
  SyntheticSessionRegistry,
  FROZEN_CLOCK,
  type ProjectionFixture,
  projectTalentContext,
  type AuthorizationResult,
  type ProjectionLookupResult,
} from './session-registry.js';

export type TalentContextReadRequest = z.infer<typeof TalentContextReadQueryRequestSchema>;
export type TalentContextReadResponse = z.infer<typeof TalentContextReadResultSchema>;

export interface TalentContextReadPort {
  /**
   * Read the talent context for the given session + body.
   *
   * `sessionRef` is opaque to the panel; only the registry interprets it.
   * The body is parsed strictly; the registry's authority overrides any
   * body-spoof attempt and rejects cross-org / wrong-object / unsupported-
   * projection attempts with the appropriate authorization code.
   *
   * The implementation MUST be deterministic for synthetic fixtures and
   * MUST NOT perform any I/O outside the in-process registry.
   */
  read(
    sessionRef: string,
    body: unknown,
  ): ProjectionLookupResult;
}

/**
 * Deterministic synthetic implementation of the port. Used by:
 *   - the embed-host local panel route (gated by mockMode)
 *   - the browser evidence harness
 *   - focused authorization tests
 *
 * Mocked scenarios are toggled per sessionRef via a small map so a single
 * fixture file can drive every acceptance case.
 */
export class SyntheticTalentContextReadPort implements TalentContextReadPort {
  private readonly fixtures = new Map<string, ProjectionFixture>();

  constructor(
    public readonly registry: SyntheticSessionRegistry,
    private readonly clock = FROZEN_CLOCK,
  ) {}

  /** Register a fixture keyed by laborProfileId. */
  registerFixture(laborProfileId: string, fullName: string): void {
    this.fixtures.set(laborProfileId, { laborProfileId, fullName });
  }

  /** Replace the fixture set; test helper. */
  resetFixtures(): void {
    this.fixtures.clear();
  }

  read(sessionRef: string, body: unknown): ProjectionLookupResult {
    const authz = this.registry.authorize(sessionRef, body, this.clock);
    if (!authz.ok) return authz;

    // Strict body parse.
    const parsed = TalentContextReadQueryRequestSchema.safeParse(body);
    if (!parsed.success) {
      const fallback: AuthorizationResult = {
        ok: false,
        code: 'MALFORMED_REQUEST',
        httpStatus: 422,
        viMessage: 'Yêu cầu không hợp lệ.',
        logDetail: parsed.error.issues[0]?.message ?? 'schema failed',
      };
      return fallback;
    }

    const req = parsed.data;
    const result = projectTalentContext(authz.session, req, this.fixtures, this.clock);
    // Schema-validate the projection so an accidental field leak fails the test.
    const final = TalentContextReadResultSchema.safeParse(result);
    if (!final.success) {
      const fallback: AuthorizationResult = {
        ok: false,
        code: 'MALFORMED_REQUEST',
        httpStatus: 422,
        viMessage: 'Yêu cầu không hợp lệ.',
        logDetail: final.error.issues[0]?.message ?? 'projection schema failed',
      };
      return fallback;
    }
    return { ok: true, result: final.data };
  }
}

/** Singleton port used by the panel server. Tests reset via the registry. */
export const syntheticTalentContextReadPort = new SyntheticTalentContextReadPort(
  new SyntheticSessionRegistry(),
);

/**
 * Convenience builder for tests / harness: assemble a deterministic session
 * and port in one call.
 */
export interface BuildPortOptions {
  organizationId: string;
  serviceId: string;
  hrpUserId: string;
  allowedLaborProfileIds: ReadonlyArray<string>;
  /** Fixtures: laborProfileId -> fullName. */
  fixtures: ReadonlyArray<{ laborProfileId: string; fullName: string }>;
  /** Deterministic seed for the session canonical token. */
  seed: number;
  /** Optional explicit expiresAt (defaults to frozen now + 1h). */
  expiresAt?: string;
}

export function buildSyntheticPort(opts: BuildPortOptions): {
  port: SyntheticTalentContextReadPort;
  sessionRef: string;
} {
  const port = new SyntheticTalentContextReadPort(new SyntheticSessionRegistry());
  // Build a session with the deterministic token and inject it.
  // We avoid using createSession (separate helper) to keep coupling local.
  const sessionRef = `sg_${canonicalSuffix(opts.seed)}`;
  port.registry.reset([{
    sessionRef,
    organizationId: opts.organizationId,
    serviceId: opts.serviceId,
    hrpUserId: opts.hrpUserId,
    expiresAt: opts.expiresAt ?? new Date(Date.parse('2026-09-26T07:00:00.000Z') + 3600_000).toISOString(),
    revokedAt: null,
    allowedLaborProfileIds: opts.allowedLaborProfileIds,
    fieldAllowlist: ['identitySummary'],
  }]);
  for (const f of opts.fixtures) port.registerFixture(f.laborProfileId, f.fullName);
  return { port, sessionRef };
}

import { encodeBase64Url } from '@hrp-engagement/contracts/talent-context-read/v1';
function canonicalSuffix(seed: number): string {
  const bytes = new Uint8Array(32);
  let v = seed >>> 0;
  for (let i = 0; i < 32; i++) {
    v = (Math.imul(v, 1664525) + 1013904223) >>> 0;
    bytes[i] = (v >>> 16) & 0xff;
  }
  return encodeBase64Url(bytes);
}

export {
  IsoTimestampSchema,
  CorrelationIdSchema,
  SyntheticSessionRegistry,
  FROZEN_CLOCK,
  FROZEN_NOW_ISO,
  encodeBase64Url,
  redactFullName,
  type DeterministicClock,
  type AuthorizationResult,
  type ProjectionLookupResult,
  type SyntheticSession,
  type CreateSessionInput,
  createSession,
} from './session-registry.js';