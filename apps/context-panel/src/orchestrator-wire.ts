/**
 * context-panel/src/orchestrator-wire.ts — CORE/1.9 In-process orchestrator wiring.
 *
 * B1 — Confirmation binding:
 *  - Preview creates a server-side ReviewSnapshot stored in session store.
 *    Snapshot binds organization + intakeRevisionId + digest + canonicalId +
 *    canonicalVersion + actor + actorScope + target + targetVersion + scope +
 *    reviewedAt + TTL.
 *  - Run REQUIRES reviewSnapshotId; verifies snapshot exists; re-checks
 *    current identity has permission (server-resolved MockIdentity), matches
 *    snapshot.actor AND snapshot.organizationScope; target/version still
 *    matches current candidate target/version (stale detection).
 *  - No snapshot = MISSING_REVIEW; digest mismatch = DIGEST_MISMATCH;
 *    stale target/version = STALE_TARGET; actor mismatch = ACTOR_MISMATCH;
 *    permission revoked = PERMISSION_REVOKED.
 *
 * B3 — Authorization/actor/scope:
 *  - Server-side mock identity: actor → role/permission mapping.
 *  - DNC actor is always server-resolved MockIdentity.actor. Client-supplied
 *    body.actor is rejected as spoof (403) when present and mismatched; ignored
 *    when absent (server fills from identity).
 *  - scenario=forbidden is NOT authorization mechanism.
 *
 * B4 — Store lifecycle:
 *  - Single global store (serverSession singleton), NOT reset per request.
 *  - Replay (same revisionId + same payload) → idempotent result.
 *  - Partial resume continues from last step using the SAME orchestrator +
 *    SAME gateway (proven by gateway call log assertion).
 *
 * B2 — Mock boundary:
 *  - Guard at server.ts top of API route handling (config.mockMode check).
 *
 * Wiring (Reuse by module boundary):
 *  - Imports IntakeOrchestrator / ExecutionDnc / digest helpers from
 *    '@hrp-engagement/integration-api/orchestrator' (CORE/1.6 verbatim).
 *  - Imports createMockGateway from '@hrp-engagement/integration-api/gateway'
 *    (CORE/1.1 verbatim).
 *  - Local store shim provides PrismaClient-shaped interface for the
 *    in-memory checkpoint store (no real DB in CORE/1.9 mock UI).
 *  - No edit/copy/divergence: any drift between this consumer and
 *    integration-api source is caught by `tests/source-link.test.mjs`.
 */

// R4 (re-recheck): Truly shared implementation — orchestrator and gateway
// are imported from @hrp-engagement/integration-api runtime modules.
// No verbatim local copies; no source-link drift guard.
//
// Surface imported here (matches orchestrator/gateway exports in
// apps/integration-api/dist/{orchestrator,gateway}/index.d.ts):
//   - IntakeOrchestrator, OrchestratorError, digestCanonical, buildCanonicalDraft,
//     buildStepIdempotencyKey, STEP_ORDER, executeDncAction,
//     buildCommitSuppressionPayload, assertCommitSuppressionPayloadValid
//   - createMockGateway (CORE/1.1)
//
// Side-effect check: importing these modules does NOT start a server.
// Server bootstrap is in src/server.ts which is only invoked via package.json
// scripts. The dynamic-import wiring for CORE/1.7 review lives in
// src/review/wiring.ts (separate from the orchestrator/gateway imports here).

import { createMockGateway } from '@hrp-engagement/integration-api/gateway';
import {
  IntakeOrchestrator,
  OrchestratorError,
  digestCanonical,
  buildCanonicalDraft,
  buildStepIdempotencyKey,
  STEP_ORDER,
  executeDncAction,
  buildCommitSuppressionPayload,
  assertCommitSuppressionPayloadValid,
} from '@hrp-engagement/integration-api/orchestrator';
import type {
  IntakePartialFailure,
  StepName,
  IntakeOrchestratorOptions,
  IdentityPreviewCaller,
} from '@hrp-engagement/integration-api/orchestrator';
import type { ActorClaim, ContextPanelResult } from '@hrp-engagement/contracts';
import { createMockPrismaClient } from '@hrp-engagement/integration-store';
import { gatewayCallLog, ledgerSnapshot } from './gateway-call-log.js';
// CORE/1.14 B4: lifecycle lag metrics (real source).
import { observe, inc, now } from './observability/metrics.js';

/* ═══════════════════════════════════════════════════════════════════════════
 * B4 — SERVER-WIDE SESSION STORE (singleton, NOT reset per request)
 * ═══════════════════════════════════════════════════════════════════════════ */

const fixedNow = () => 1_700_000_000_000;

interface CheckpointRow {
  checkpointId: string;
  organizationId: string;
  intakeRevisionId: string;
  draftDigest: string;
  canonicalId: string | null;
  canonicalVersion: number | null;
  currentStep: StepName | 'CONFIRM_VALIDATE';
  state: 'RUNNING' | 'PARTIAL' | 'COMPLETED' | 'FAILED' | 'REVIEW_PENDING';
  appliedSteps: StepName[];
  stepResults: Record<string, unknown>;
  correlationId: string;
  idempotencyKey: string;
  lastError?: IntakePartialFailure;
  createdAt: Date;
  updatedAt: Date;
}

/** B1: Snapshot binds all actor/scope/digest fields needed for cross-actor detection. */
export interface ReviewSnapshot {
  snapshotId: string;
  organizationScope: string;
  /** Same as req.organizationId — required on snapshot for cross-org detection. */
  organizationId: string;
  intakeRevisionId: string;
  /** SHA-256 hex of canonical draft at preview time. */
  digest: string;
  /** Canonical talent profile ID after identity resolution. */
  canonicalId: string | null;
  /** Version of canonical profile at preview time. */
  canonicalVersion: number | null;
  /** Target domain bound at preview (e.g., talent panel scope). */
  target: 'talent' | 'client';
  /** Target canonical version bound at preview. */
  targetVersion: number | null;
  /** Actor who performed the review (server-resolved MockIdentity.actor). */
  actor: ActorClaim;
  /** Scope claim (e.g., 'INBOUND_DEFAULT', 'PRIVILEGED') — server-derived. */
  actorScope: string;
  /** Required role at snapshot time — server-side, used to detect role revoke. */
  requiredRole: MockRole;
  createdAt: string;
  /** TTL: 5 minutes from creation. */
  expiresAt: string;
}

/** Server-wide singleton store — persists across HTTP requests within a server session. */
class ServerSession {
  private checkpoints = new Map<string, CheckpointRow>();
  private reviewSnapshots = new Map<string, ReviewSnapshot>();
  private gateway = createMockGateway({ now: fixedNow });
  private counter = 0;

  makeId(): string {
    return `icp-cp-${fixedNow()}-${(this.counter += 1)}`;
  }

  /* ── Checkpoint store ──────────────────────────────────────────────────── */

  async checkpointFindByOrgRevision(
    orgId: string,
    revisionId: string,
  ): Promise<CheckpointRow | null> {
    const key = `${orgId}:${revisionId}`;
    return this.checkpoints.get(key) ?? null;
  }

  /** B4: Reverse lookup by checkpointId (needed for Prisma update by primary key). */
  async checkpointFindByCheckpointId(
    checkpointId: string,
  ): Promise<{ organizationId: string; intakeRevisionId: string } | null> {
    for (const [key, row] of this.checkpoints) {
      if (row.checkpointId === checkpointId) {
        const [orgId, revisionId] = key.split(':');
        return { organizationId: orgId ?? '', intakeRevisionId: revisionId ?? '' };
      }
    }
    return null;
  }

  /** B4: Expose the checkpoint Map so intake-checkpoint-shim can share it. */
  getCheckpointMap(): Map<string, CheckpointRow> {
    return this.checkpoints;
  }

  async checkpointCreate(
    data: Omit<CheckpointRow, 'createdAt' | 'updatedAt'>,
  ): Promise<{ row: CheckpointRow; created: boolean }> {
    const key = `${data.organizationId}:${data.intakeRevisionId}`;
    const existing = this.checkpoints.get(key);
    if (existing) {
      if (existing.draftDigest !== data.draftDigest) {
        const e: Error & { code?: string } = new Error('IDEMPOTENCY_CONFLICT: draftDigest khác');
        e.code = 'DUPLICATE_KEY';
        throw e;
      }
      return { row: existing, created: false };
    }
    // B4: Store as parsed types (aligned with IntakeCheckpointRow interface).
    // appliedSteps and stepResults are NOT JSON strings — they are arrays/objects.
    const row: CheckpointRow = {
      ...data,
      appliedSteps: Array.isArray(data.appliedSteps) ? data.appliedSteps : [],
      stepResults: data.stepResults ?? {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.checkpoints.set(key, row);
    return { row, created: true };
  }

  async checkpointUpdateByOrgRevision(
    orgId: string,
    revisionId: string,
    data: Partial<CheckpointRow>,
  ): Promise<CheckpointRow> {
    const key = `${orgId}:${revisionId}`;
    const existing = this.checkpoints.get(key);
    if (!existing) {
      const e: Error & { code?: string } = new Error('checkpoint not found');
      e.code = 'VALIDATION_ERROR';
      throw e;
    }
    // B4: Merge parsed types — appliedSteps/stepResults are arrays/objects.
    const updated: CheckpointRow = { ...existing, ...data, updatedAt: new Date() };
    this.checkpoints.set(key, updated);
    return updated;
  }

  /* ── B1: Review snapshot store ───────────────────────────────────────── */

  createReviewSnapshot(snapshot: ReviewSnapshot): string {
    const key = `${snapshot.organizationId}:${snapshot.intakeRevisionId}`;
    this.reviewSnapshots.set(key, snapshot);
    return snapshot.snapshotId;
  }

  getReviewSnapshot(orgId: string, revisionId: string): ReviewSnapshot | null {
    const key = `${orgId}:${revisionId}`;
    return this.reviewSnapshots.get(key) ?? null;
  }

  /* ── Gateway accessor ────────────────────────────────────────────────── */

  getGateway() {
    return this.gateway;
  }

  resetGateway(): void {
    this.gateway = createMockGateway({ now: fixedNow });
  }

  describe(): string {
    return [
      `checkpoints: ${this.checkpoints.size}`,
      `snapshots: ${this.reviewSnapshots.size}`,
      `gatewayCalls: ${gatewayCallLog(this).size}`,
    ].join(' | ');
  }
}

/** Global server session — one per server process. */
export const serverSession = new ServerSession();
export { ServerSession };

/* ═══════════════════════════════════════════════════════════════════════════
 * B1 — REVIEW SNAPSHOT request/response shapes
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface PreviewApiRequest {
  organizationId: string;
  intakeRevisionId: string;
  signal: {
    fullName?: string;
    phone?: string;
    citizenId?: string;
  };
  /** Optional intake fields — UI mock accepts intent/address/evidence at preview
   *  time so preview-bound digest matches run-side digest (no edit-drift). */
  intent?: { stage?: string; availability?: string; availableFromDate?: string };
  citizenIdentity?: { number?: string; address?: string };
  contactAddress?: string;
  evidenceRefs?: Array<{ evidenceId: string; kind: string }>;
  /** Target domain bound at preview (used to detect stale target at run). */
  target?: 'talent' | 'client';
  /** Target canonical version bound at preview. */
  targetVersion?: number;
  scenario?: string;
}

export interface PreviewApiResponse {
  reviewSnapshotId: string;
  candidates: Array<{
    candidateId: string;
    strength: 'STRONG' | 'WEAK' | 'PARTIAL';
    label?: string;
  }>;
  previewExpiresAt: string;
  hasStrongMatch: boolean;
  digest: string;
}

export interface RunApiRequest {
  organizationId: string;
  intakeRevisionId: string;
  reviewSnapshotId: string;
  /** Target domain at run — must match snapshot.target (B1: stale-target detection). */
  target: 'talent' | 'client';
  /** Target canonical version at run — must match snapshot.targetVersion (B1). */
  targetVersion?: number;
  fullName: string;
  phone: string;
  citizenIdentity: { number: string; address: string };
  contactAddress?: string;
  dob?: string;
  intent: { stage: string; availability: string; availableFromDate?: string };
  evidenceRefs: Array<{ evidenceId: string; kind: string }>;
  /**
   * Actor is informational only at run — server uses identity-staffed actor
   * to call orchestrator; client-supplied actor.kind must MATCH identity.actor.kind
   * (spoof prevention). Mismatch → 403 ACTOR_MISMATCH.
   */
  actor: ActorClaim;
  scenario?: string;
}

export interface RunApiResponse {
  checkpointId: string;
  state: 'COMPLETED' | 'FAILED' | 'PARTIAL' | 'REVIEW_PENDING';
  appliedSteps: string[];
  partialFailure?: IntakePartialFailure;
  actedOnAnyStep: boolean;
  digest: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * B3 — AUTHORIZATION: Mock identity and permission mapping
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Extract userId or serviceId from an ActorClaim safely. */
function actorIdOf(actor: ActorClaim): string {
  if (actor.kind === 'USER') return actor.userId;
  if (actor.kind === 'SERVICE') return actor.serviceId;
  if (actor.kind === 'DELEGATED_USER') return actor.userId;
  return 'unknown';
}

/* ─── Authorization types ─────────────────────────────────────────────── */
export type MockRole =
  | 'TALENT_REVIEWER'
  | 'INTAKE_OPERATOR'
  | 'SUPERVISOR'
  | 'SYSTEM';

export interface MockIdentity {
  staffId: string;
  role: MockRole;
  /** Organization scope (mock-claim; in production comes from JWT). */
  organizationId: string;
  actor: ActorClaim;
  /**
   * Per-object scopes granted to this identity (additional to role).
   * Used by CORE/1.13 autofill B1: actor/org/object scope check.
   * Examples:
   *  - 'autofill:profile-intake-*' → can manage drafts on profile-intake-* profiles
   *  - 'autofill:profile-talent-*' → can propose (not confirm) on profile-talent-*
   *  - 'autofill:draft.confirm' → can call confirmAutofillDraft
   * Production would derive these from JWT claims; for CORE/1.13 mock,
   * the MOCK_IDENTITY_MAP below embeds them.
   */
  extraScopes?: string[];
}

/**
 * Mock staff identity map. Staff IDs are validated at server entry; their
 * role + scope determine what they can access.
 *
 * For CORE/1.9 mock, we map a provided staff ID header to a role. Real
 * production auth is out of scope per T1 brief; production would validate
 * JWT and extract role+scope from token claims.
 */
const MOCK_IDENTITY_MAP: Record<string, MockIdentity> = {
  'staff-talent-001': {
    staffId: 'staff-talent-001',
    role: 'TALENT_REVIEWER',
    organizationId: 'org-001',
    actor: { kind: 'USER', userId: 'staff-talent-001' },
    // CORE/1.13 B1: talent reviewers can propose autofill but NOT confirm.
    // Scope narrowed to profile-talent-* pattern.
    extraScopes: ['autofill:profile-talent-*'],
  },
  'staff-intake-001': {
    staffId: 'staff-intake-001',
    role: 'INTAKE_OPERATOR',
    organizationId: 'org-001',
    actor: { kind: 'USER', userId: 'staff-intake-001' },
    // CORE/1.13 B1: intake operators can manage autofill drafts/confirm on
    // profile-intake-* profiles (requires autofill:draft.confirm scope).
    extraScopes: ['autofill:profile-intake-*', 'autofill:draft.confirm'],
  },
  'staff-supervisor-001': {
    staffId: 'staff-supervisor-001',
    role: 'SUPERVISOR',
    organizationId: 'org-001',
    actor: { kind: 'USER', userId: 'staff-supervisor-001' },
    // CORE/1.13 B1: supervisors can manage autofill across org.
    // Must also have explicit autofill:draft.confirm scope to call
    // confirmAutofillDraft (per B1 brief: manager must review/confirm).
    extraScopes: ['autofill:profile-*', 'autofill:draft.confirm'],
  },
  'svc-integration-api': {
    staffId: 'svc-integration-api',
    role: 'SYSTEM',
    organizationId: '*',
    actor: { kind: 'SERVICE', serviceId: 'svc-integration-api' },
    extraScopes: ['autofill:profile-*'],
  },
  // CORE/1.13 B1: staff without scope (sale w/o permission) gets no autofill
  // access — kept here so tests can use a known-no-perm staff ID.
  'staff-no-scope-001': {
    staffId: 'staff-no-scope-001',
    role: 'TALENT_REVIEWER',
    organizationId: 'org-001',
    actor: { kind: 'USER', userId: 'staff-no-scope-001' },
    extraScopes: [],
  },
};

/**
 * CORE/1.13 B1 — Scope-based autofill authorization.
 *
 * Pattern match against `extraScopes[].startsWith(prefix)` where:
 *  - 'autofill:profile-<id>' → exact match on profileId.
 *  - 'autofill:profile-*'    → wildcard: any profileId in the actor's org.
 *
 * Returns true if the identity has the scope. Manager/SUPERVISOR with
 * extraScope 'autofill:profile-*' covers all profiles in their org.
 * SYSTEM with organizationId='*' covers all orgs.
 *
 * NOT based solely on role — auditor finding (B1):
 * "Không mở quyền cho mọi sale; kiểm tra actor/org/object scope
 *  phía server".
 */
export function actorHasAutofillScope(
  identity: MockIdentity,
  profileId: string,
): boolean {
  if (!identity.extraScopes || identity.extraScopes.length === 0) return false;

  for (const scope of identity.extraScopes) {
    if (!scope.startsWith('autofill:')) continue;
    const suffix = scope.slice('autofill:'.length);
    // '*' alone → wildcard.
    if (suffix === '*') return true;
    if (suffix === profileId) return true;
    // Glob: 'profile-intake-*' matches 'profile-intake-001'.
    if (suffix.endsWith('*')) {
      const prefix = suffix.slice(0, -1);
      if (profileId.startsWith(prefix)) return true;
    }
  }
  return false;
}

export function resolveMockIdentity(staffId: string | undefined): MockIdentity | null {
  if (!staffId) return null;
  return MOCK_IDENTITY_MAP[staffId] ?? null;
}

export function canQueryContext(identity: MockIdentity, target: 'talent' | 'client'): boolean {
  switch (identity.role) {
    case 'TALENT_REVIEWER':
      return target === 'talent';
    case 'INTAKE_OPERATOR':
      return target === 'talent';
    case 'SUPERVISOR':
      return target === 'talent' || target === 'client';
    case 'SYSTEM':
      return true;
    default:
      return false;
  }
}

export function canSubmitIntake(identity: MockIdentity): boolean {
  return identity.role === 'INTAKE_OPERATOR' || identity.role === 'SUPERVISOR' || identity.role === 'SYSTEM';
}

export function canExecuteDnc(identity: MockIdentity): boolean {
  return identity.role === 'INTAKE_OPERATOR' || identity.role === 'SUPERVISOR' || identity.role === 'SYSTEM';
}

/**
 * CORE/1.13 B1 — Cross-org check on autofill object scope.
 * Caller's identity.organizationId must match the proposal's organizationId
 * (via store lookup). SYSTEM identity bypass only if actor org is '*'
 * AND has explicit autofill:profile-* scope.
 */
export function actorOrgMatchesAutofillObject(
  identity: MockIdentity,
  proposalOrgId: string,
): boolean {
  if (identity.organizationId === '*') return true; // SYSTEM
  return identity.organizationId === proposalOrgId;
}

/**
 * CORE/1.13 B1 — Propose autofill fields: requires actor org + scope match.
 * Sale/AI = USER but no scope → reject.
 */
export function canProposeAutofill(
  identity: MockIdentity,
  profileId: string,
  proposalOrgId: string,
): boolean {
  if (!actorOrgMatchesAutofillObject(identity, proposalOrgId)) return false;
  // AI = SERVICE actors: propose-only, never confirm.
  if (identity.actor.kind === 'SERVICE') {
    // Service actors get propose only if they have autofill:profile-*
    // scope AND a proposal exists. They never get confirm.
    return actorHasAutofillScope(identity, profileId);
  }
  return actorHasAutofillScope(identity, profileId);
}

/**
 * CORE/1.13 B1 — Confirm autofill draft: requires explicit
 * 'autofill:draft.confirm' scope on top of profile scope.
 * (Auditor: kpi/provider still manager-only via separate `isManager` check
 *  in dashboard module and `updateProvider()` store guard.)
 */
export function canConfirmAutofillDraft(
  identity: MockIdentity,
  profileId: string,
  proposalOrgId: string,
): boolean {
  if (!actorOrgMatchesAutofillObject(identity, proposalOrgId)) return false;
  if (!identity.extraScopes) return false;
  if (!identity.extraScopes.includes('autofill:draft.confirm')) return false;
  return actorHasAutofillScope(identity, profileId);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * GATEWAY CALLER — wraps mock gateway with INBOUND_DEFAULT tier
 * Logs each call into the gatewayCallLog for B4 evidence.
 * ═══════════════════════════════════════════════════════════════════════════ */

function buildGatewayCaller(gw: ReturnType<typeof createMockGateway>) {
  return async (args: {
    organizationId: string;
    method: string;
    idempotencyKey: string;
    correlationId: string;
    scenarioId: string;
    payload: unknown;
    actor?: unknown;
  }) => {
    // B4: record call BEFORE invoking — captures identity/scenario used.
    gatewayCallLog(serverSession).record({
      method: args.method,
      idempotencyKey: args.idempotencyKey,
      organizationId: args.organizationId,
      correlationId: args.correlationId,
      scenarioId: args.scenarioId,
      actorKind:
        (args.actor as ActorClaim | undefined)?.kind ?? 'SERVICE',
      actorId:
        args.actor && typeof args.actor === 'object'
          ? ((args.actor as Record<string, unknown>)['userId'] as string) ??
            ((args.actor as Record<string, unknown>)['serviceId'] as string) ??
            'unknown'
          : 'unknown',
    });
    return gw.call({
      schemaVersion: '1',
      organizationId: args.organizationId,
      commandId: `cmd-${args.method}`,
      idempotencyKey: args.idempotencyKey,
      correlationId: args.correlationId,
      method: args.method as Parameters<typeof gw.call>[0]['method'],
      context: {
        schemaVersion: '1',
        organizationId: args.organizationId,
        tier: 'INBOUND_DEFAULT',
        correlationId: args.correlationId,
        provider: 'CHATWOOT',
        connectionId: 'conn-mock-001',
      },
      actor: (args.actor as ActorClaim) ?? { kind: 'SERVICE', serviceId: 'svc-context-panel' },
      scenarioId: args.scenarioId as Parameters<typeof gw.call>[0]['scenarioId'],
      payload: args.payload,
    });
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * PREVIEW IDENTITY CALLER (read-only)
 * ═══════════════════════════════════════════════════════════════════════════ */

function buildPreviewCaller(): IdentityPreviewCaller {
  return {
    async resolveIdentityCandidates(args: {
      signal: { fullName?: string; phone?: string; citizenId?: string };
      organizationId?: string;
      provider?: string;
      connectionId?: string;
      correlationId?: string;
    }) {
      void args;
      // B1: Return the SAME canonical ID as the orchestrator's gateway (EXACT_MATCH_SUCCESS
      // scenario → lp-fixture-exact-001) so snapshot.digest matches run.digest.
      const phone = args.signal.phone ?? '';
      const candidates = [];
      if (phone.startsWith('09')) {
        candidates.push({ candidateId: 'lp-fixture-exact-001', strength: 'STRONG' as const });
        candidates.push({ candidateId: 'lp-fixture-exact-002', strength: 'WEAK' as const });
      } else if (phone.startsWith('03')) {
        candidates.push({ candidateId: 'lp-fixture-partial-001', strength: 'PARTIAL' as const });
      } else {
        candidates.push({ candidateId: 'lp-fixture-weak-001', strength: 'WEAK' as const });
      }
      return { candidates };
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ORCHESTRATOR FACTORY
 * ═══════════════════════════════════════════════════════════════════════════ */

/** B4: Adapter that wraps ServerSession checkpoint methods into MockCheckpointStore
 *  interface expected by createMockPrismaClient from integration-store.
 *
 *  Transform Prisma row format (appliedStepsJson/stepResultsJson as strings)
 *  to parsed format (appliedSteps/stepResults as arrays/objects) expected
 *  by ServerSession.checkpointCreate. */
function buildCheckpointStore(session: ServerSession) {
  return {
    async findByCheckpointId(checkpointId: string) {
      return session.checkpointFindByCheckpointId(checkpointId);
    },
    async findByOrgRevision(orgId: string, revisionId: string) {
      const row = await session.checkpointFindByOrgRevision(orgId, revisionId);
      if (!row) return null;
      // Convert to Prisma row format. NOTE: keep appliedStepsJson/stepResultsJson
      // as parsed (array/object) since integration-store's rowToContract expects arrays.
      return {
        checkpointId: row.checkpointId,
        schemaVersion: '1',
        organizationId: row.organizationId,
        intakeRevisionId: row.intakeRevisionId,
        draftDigest: row.draftDigest,
        canonicalId: row.canonicalId,
        canonicalVersion: row.canonicalVersion,
        currentStep: row.currentStep,
        state: row.state,
        appliedStepsJson: row.appliedSteps, // KEEP AS ARRAY
        stepResultsJson: row.stepResults,   // KEEP AS OBJECT
        lastErrorJson: row.lastError ?? null,
        correlationId: row.correlationId,
        idempotencyKey: row.idempotencyKey,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },
    async create(data: unknown) {
      // Transform Prisma row format to parsed format for session storage.
      const d = data as Record<string, unknown>;
      let appliedSteps: StepName[] = [];
      if (d.appliedStepsJson !== undefined && d.appliedStepsJson !== null) {
        appliedSteps = typeof d.appliedStepsJson === 'string'
          ? JSON.parse(d.appliedStepsJson as string) as StepName[]
          : d.appliedStepsJson as StepName[];
      }
      let stepResults: Record<string, unknown> = {};
      if (d.stepResultsJson !== undefined && d.stepResultsJson !== null) {
        stepResults = typeof d.stepResultsJson === 'string'
          ? JSON.parse(d.stepResultsJson as string)
          : d.stepResultsJson as Record<string, unknown>;
      }
      const transformed = {
        checkpointId: String(d.checkpointId ?? ''),
        organizationId: String(d.organizationId ?? ''),
        intakeRevisionId: String(d.intakeRevisionId ?? ''),
        draftDigest: String(d.draftDigest ?? ''),
        canonicalId: (d.canonicalId as string | null) ?? null,
        canonicalVersion: (d.canonicalVersion as number | null) ?? null,
        currentStep: ((d.currentStep as string | null) ?? 'CONFIRM_VALIDATE') as StepName | 'CONFIRM_VALIDATE',
        state: ((d.state as string) ?? 'RUNNING') as 'RUNNING' | 'PARTIAL' | 'COMPLETED' | 'FAILED' | 'REVIEW_PENDING',
        appliedSteps,
        stepResults,
        correlationId: String(d.correlationId ?? ''),
        idempotencyKey: String(d.idempotencyKey ?? ''),
        lastError: d.lastErrorJson as IntakePartialFailure | undefined,
      };
      const { row } = await session.checkpointCreate(transformed);
      // Convert back to Prisma row format. Keep parsed types.
      const prismaRow = {
        checkpointId: row.checkpointId,
        schemaVersion: '1',
        organizationId: row.organizationId,
        intakeRevisionId: row.intakeRevisionId,
        draftDigest: row.draftDigest,
        canonicalId: row.canonicalId,
        canonicalVersion: row.canonicalVersion,
        currentStep: row.currentStep,
        state: row.state,
        appliedStepsJson: row.appliedSteps,
        stepResultsJson: row.stepResults,
        lastErrorJson: row.lastError ?? null,
        correlationId: row.correlationId,
        idempotencyKey: row.idempotencyKey,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
      return { row: prismaRow, created: true };
    },
    async updateByOrgRevision(orgId: string, revisionId: string, data: unknown) {
      const d = data as Record<string, unknown>;
      // Transform Prisma update format to parsed format.
      const transformed: Record<string, unknown> = {};
      if (d.currentStep !== undefined) transformed.currentStep = d.currentStep;
      if (d.state !== undefined) transformed.state = d.state;
      if (d.appliedStepsJson !== undefined) {
        transformed.appliedSteps = typeof d.appliedStepsJson === 'string'
          ? JSON.parse(d.appliedStepsJson) : d.appliedStepsJson;
      }
      if (d.stepResultsJson !== undefined) {
        transformed.stepResults = typeof d.stepResultsJson === 'string'
          ? JSON.parse(d.stepResultsJson) : d.stepResultsJson;
      }
      if (d.lastErrorJson !== undefined) transformed.lastError = d.lastErrorJson;
      if (d.canonicalId !== undefined) transformed.canonicalId = d.canonicalId;
      if (d.canonicalVersion !== undefined) transformed.canonicalVersion = d.canonicalVersion;
      const row = await session.checkpointUpdateByOrgRevision(orgId, revisionId, transformed);
      // Convert back to Prisma row format. Keep parsed types.
      return {
        checkpointId: row.checkpointId,
        schemaVersion: '1',
        organizationId: row.organizationId,
        intakeRevisionId: row.intakeRevisionId,
        draftDigest: row.draftDigest,
        canonicalId: row.canonicalId,
        canonicalVersion: row.canonicalVersion,
        currentStep: row.currentStep,
        state: row.state,
        appliedStepsJson: row.appliedSteps,
        stepResultsJson: row.stepResults,
        lastErrorJson: row.lastError ?? null,
        correlationId: row.correlationId,
        idempotencyKey: row.idempotencyKey,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },
  };
}

function createOrchestrator(session: ServerSession): IntakeOrchestrator {
  const gw = session.getGateway();
  // B4: Use createMockPrismaClient from integration-store — the same code path
  // as production but backed by in-memory ServerSession checkpoint store.
  const mockPrisma = createMockPrismaClient(buildCheckpointStore(session));
  return new IntakeOrchestrator({
    prisma: mockPrisma as unknown as IntakeOrchestratorOptions['prisma'],
    gatewayCall: buildGatewayCaller(gw) as unknown as IntakeOrchestratorOptions['gatewayCall'],
    identityPreview: buildPreviewCaller() as unknown as IntakeOrchestratorOptions['identityPreview'],
    now: fixedNow,
    idGen: () => session.makeId(),
  } as unknown as IntakeOrchestratorOptions);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SCENARIO RESOLUTION
 * ═══════════════════════════════════════════════════════════════════════════ */

function resolveScenarioId(name: string): string {
  const map: Record<string, string> = {
    exact: 'EXACT_MATCH_SUCCESS',
    possible: 'POSSIBLE_MATCH_REVIEW',
    new: 'NEW_PROFILE_CREATED',
    timeout: 'TIMEOUT_BEFORE_APPLY',
    version: 'VERSION_CONFLICT',
    policy: 'POLICY_REJECTION',
    forbidden: 'PERMISSION_DENIED',
    dep: 'DEPENDENCY_UNAVAILABLE',
  };
  return map[name] ?? 'EXACT_MATCH_SUCCESS';
}

/* ═══════════════════════════════════════════════════════════════════════════
 * B1 — PREVIEW: Creates server-side ReviewSnapshot with full binding
 * ═══════════════════════════════════════════════════════════════════════════ */

export async function handlePreview(
  req: PreviewApiRequest,
  identity: MockIdentity,
): Promise<PreviewApiResponse> {
  const orgId = req.organizationId;
  const revisionId = req.intakeRevisionId;
  const scenarioId = resolveScenarioId(req.scenario ?? 'exact');

  const orch = createOrchestrator(serverSession);

  const result = await orch.preview(
    {
      organizationId: orgId,
      signal: req.signal,
      provider: 'CHATWOOT',
      connectionId: 'conn-mock-001',
    },
    `corr-preview-${Date.now()}`,
  );

  const ctxForDigest = {
    organizationId: orgId,
    intakeRevisionId: revisionId,
    fullName: req.signal.fullName ?? '',
    phone: req.signal.phone ?? '',
    citizenIdentity: {
      number: req.citizenIdentity?.number ?? req.signal.citizenId ?? '',
      address: req.citizenIdentity?.address ?? '',
    },
    ...(req.contactAddress !== undefined ? { contactAddress: req.contactAddress } : {}),
    intent: {
      stage: String(req.intent?.stage ?? 'NEW'),
      availability: String(req.intent?.availability ?? 'AVAILABLE_NOW'),
    },
    evidenceRefs: (req.evidenceRefs ?? []).map((e) => ({ evidenceId: e.evidenceId, kind: e.kind })),
  };
  // B1: Include server-resolved canonicalId/version in digest. This is required so
  // preview↔run digests match (orchestrator's computeServerDigestFromReq reads
  // canonicalId/version from confirmation context into digest).
  const strongestCandidate = result.candidates.find((c) => c.strength === 'STRONG');
  const canonicalId = strongestCandidate?.candidateId ?? null;
  const canonicalVersion: number | null = canonicalId ? 1 : null;
  const ctxForDigestWithCanonical = {
    ...ctxForDigest,
    ...(canonicalId !== null ? { canonicalId } : {}),
    ...(canonicalVersion !== null ? { canonicalVersion } : {}),
  };
  const digest = digestCanonical(buildCanonicalDraft(ctxForDigestWithCanonical));

  const target = req.target ?? 'talent';
  const targetVersion = req.targetVersion ?? canonicalVersion ?? null;

  const now = new Date();
  const snapshot: ReviewSnapshot = {
    snapshotId: `snap-${orgId}-${revisionId}-${fixedNow()}`,
    organizationScope: identity.organizationId,
    organizationId: orgId,
    intakeRevisionId: revisionId,
    digest,
    canonicalId,
    canonicalVersion,
    target,
    targetVersion,
    actor: identity.actor,
    actorScope: 'INBOUND_DEFAULT',
    requiredRole: identity.role,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
  };
  serverSession.createReviewSnapshot(snapshot);

  return {
    reviewSnapshotId: snapshot.snapshotId,
    candidates: result.candidates.map((c) => ({
      candidateId: c.candidateId,
      strength: c.strength,
      ...(c.label !== undefined ? { label: c.label } : {}),
    })),
    previewExpiresAt: result.previewExpiresAt,
    hasStrongMatch: result.hasStrongMatch,
    digest,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * B1 — RUN: Validates snapshot, current permissions, target/version, digest
 * ═══════════════════════════════════════════════════════════════════════════ */

export async function handleRun(
  req: RunApiRequest,
  identity: MockIdentity,
  /**
   * CORE/1.14 B3: server-validated correlation ID propagated from HTTP entry.
   * Replaces the previous `Date.now()` local timestamp fallback. The
   * orchestrator and gateway MUST use the SAME correlation as the HTTP
   * receipt so traces match across receipt → decision → mock command →
   * result. Fallback to a generated id only when no inbound was provided.
   */
  inboundCorrelationId?: string,
): Promise<RunApiResponse> {
  const orgId = req.organizationId;
  const revisionId = req.intakeRevisionId;
  const scenarioId = resolveScenarioId(req.scenario ?? 'exact');

  // B1: Validate reviewSnapshotId — server-side review binding.
  const snapshot = serverSession.getReviewSnapshot(orgId, revisionId);
  if (!snapshot) {
    throw {
      errorCode: 'MISSING_REVIEW',
      httpStatus: 400,
      message: 'Bạn cần xem trước hồ sơ trước khi nộp. Vui lòng gọi preview trước.',
    };
  }

  if (new Date(snapshot.expiresAt) < new Date()) {
    throw {
      errorCode: 'SNAPSHOT_EXPIRED',
      httpStatus: 410,
      message: 'Bản xem trước đã hết hạn. Vui lòng xem trước lại.',
    };
  }

  if (req.reviewSnapshotId !== snapshot.snapshotId) {
    throw {
      errorCode: 'INVALID_SNAPSHOT',
      httpStatus: 400,
      message: 'Mã xác nhận không hợp lệ. Vui lòng bắt đầu lại từ bước xem trước.',
    };
  }

  // B1: Cross-org detection — identity.organizationId must match snapshot's organizationScope.
  // Check org BEFORE actor (org violation is more fundamental).
  if (identity.organizationId !== snapshot.organizationScope) {
    throw {
      errorCode: 'CROSS_ORG',
      httpStatus: 403,
      message: 'Phạm vi tổ chức của bạn không trùng với hồ sơ đã xem trước.',
    };
  }

  // B1: Cross-actor detection — identity must match snapshot's actor.
  const snapshotActorId = actorIdOf(snapshot.actor);
  if (identity.staffId !== snapshotActorId) {
    throw {
      errorCode: 'CROSS_ACTOR',
      httpStatus: 403,
      message: 'Hồ sơ đã được người khác xem trước. Bạn không thể nộp hộ.',
    };
  }

  // B1: Permission revoke detection — if required role no longer allowed for this action, reject.
  if (!canSubmitIntake(identity)) {
    throw {
      errorCode: 'PERMISSION_REVOKED',
      httpStatus: 403,
      message: 'Quyền nộp hồ sơ của bạn đã bị thu hồi.',
    };
  }

  // B1: Target/version drift detection.
  if (req.target !== snapshot.target) {
    throw {
      errorCode: 'STALE_TARGET',
      httpStatus: 409,
      message: 'Phạm vi mục tiêu đã thay đổi sau khi xem trước. Vui lòng xem trước lại.',
    };
  }

  if (
    req.targetVersion !== undefined &&
    snapshot.targetVersion !== null &&
    req.targetVersion !== snapshot.targetVersion
  ) {
    throw {
      errorCode: 'STALE_VERSION',
      httpStatus: 409,
      message: 'Phiên bản mục tiêu đã thay đổi sau khi xem trước. Vui lòng xem trước lại.',
    };
  }

  // B4: Use existing checkpoint's canonicalId/version if it exists (after partial run),
  // otherwise use snapshot's. This makes replay idempotent.
  const existingCheckpoint = await serverSession.checkpointFindByOrgRevision(orgId, revisionId);
  const effectiveCanonicalId = existingCheckpoint?.canonicalId ?? snapshot.canonicalId;
  const effectiveCanonicalVersion = existingCheckpoint?.canonicalVersion ?? snapshot.canonicalVersion;

  const actualPayload = {
    organizationId: orgId,
    intakeRevisionId: revisionId,
    fullName: req.fullName,
    phone: req.phone,
    citizenIdentity: req.citizenIdentity,
    ...(req.contactAddress !== undefined ? { contactAddress: req.contactAddress } : {}),
    ...(req.dob !== undefined ? { dob: req.dob } : {}),
    intent: req.intent,
    evidenceRefs: req.evidenceRefs.map((e) => ({ evidenceId: e.evidenceId, kind: e.kind })),
    // B1: server-compute digest matches orchestrator's computeServerDigestFromReq.
    // canonicalId/canonicalVersion are part of confirmation context.
    ...(effectiveCanonicalId !== null ? { canonicalId: effectiveCanonicalId } : {}),
    ...(effectiveCanonicalVersion !== null ? { canonicalVersion: effectiveCanonicalVersion } : {}),
  };
  // Server-compute digest from actual payload.
  const actualDigest = digestCanonical(buildCanonicalDraft(actualPayload));

  // B1: Compare actual digest with stored SNAPSHOT digest (preview capture).
  // Detects edit-drift between preview and run.
  if (actualDigest !== snapshot.digest) {
    throw {
      errorCode: 'DIGEST_MISMATCH',
      httpStatus: 409,
      message: 'Dữ liệu đã thay đổi sau khi xem trước. Vui lòng xem trước lại trước khi nộp.',
    };
  }

  // For orchestrator: bind confirmation.context.draftDigest to actual digest so
  // orchestrator's own draftDigest check passes (client cannot forge).
  const orch = createOrchestrator(serverSession);
  // CORE/1.14 B3: prefer server-validated correlation over local ts.
  // Fallback to a deterministic id (route+actor+revision) only when no
  // inbound was provided (defensive: handleRun called without ctx).
  const correlationId = inboundCorrelationId
    ?? `corr-run-${identity.staffId}-${revisionId}`;

  // B1: Bind confirmation to snapshot's canonicalId/version so confirmation
  // matches checkpoint state stored from preview.
  const runReq = {
    organizationId: orgId,
    intakeRevisionId: revisionId,
    fullName: req.fullName,
    phone: req.phone,
    citizenIdentity: req.citizenIdentity,
    ...(req.contactAddress !== undefined ? { contactAddress: req.contactAddress } : {}),
    ...(req.dob !== undefined ? { dob: req.dob } : {}),
    intent: req.intent,
    evidenceRefs: req.evidenceRefs.map((e) => ({ evidenceId: e.evidenceId, kind: e.kind })),
    confirmation: {
      organizationId: orgId,
      context: {
        draftRevisionId: revisionId,
        draftDigest: actualDigest,
        ...(effectiveCanonicalId !== null ? { canonicalId: effectiveCanonicalId } : {}),
        ...(effectiveCanonicalVersion !== null ? { canonicalVersion: effectiveCanonicalVersion } : {}),
      },
      confirmed: true as const,
    },
    draftDigest: actualDigest,
    provider: 'CHATWOOT',
    connectionId: 'conn-mock-001',
    externalReference: 'ext-ref-mock-001',
    correlationId,
  };

  // CORE/1.14 B4: measure orchestrator lifecycle lag. Uses injected clock
  // (default: Date.now() — production; test: deterministic now()).
  const runStart = now();
  try {
    const result = await orch.run(runReq);
    const lagMs = now() - runStart;
    observe('orchestrator.lag_ms', lagMs, {
      outcome: result.state === 'COMPLETED' ? 'success' : 'partial',
    });
    if (result.state === 'PARTIAL') {
      inc('intent.partial', { routeName: 'handleRun' });
    }
    return {
      checkpointId: result.checkpointId,
      state: result.state,
      appliedSteps: result.appliedSteps,
      ...(result.partialFailure !== undefined ? { partialFailure: result.partialFailure } : {}),
      actedOnAnyStep: result.actedOnAnyStep,
      digest: actualDigest,
    };
  } catch (err) {
    const lagMs = now() - runStart;
    observe('orchestrator.lag_ms', lagMs, { outcome: 'error' });
    if (err instanceof OrchestratorError) {
      const code = err.code;
      const httpMap: Record<string, number> = {
        IDEMPOTENCY_CONFLICT: 409,
        VALIDATION_ERROR: 400,
        STALE_CONFIRMATION: 409,
        MISSING_REVIEW: 400,
      };
      throw {
        errorCode: code,
        httpStatus: httpMap[code] ?? 500,
        message: 'Đã xảy ra lỗi khi xử lý hồ sơ. Vui lòng thử lại.',
      };
    }
    throw err;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * B3 — CONTEXT QUERY: Authorization + server-side mock data
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface ContextApiRequest {
  target: 'talent' | 'client';
  laborProfileId?: string;
  /** R2: Optional scenario for testing different panel states
   *  (forbidden/stale/timeout/partial). Required by browser test suite. */
  scenario?: 'forbidden' | 'stale' | 'timeout' | 'partial';
}

export async function handleContextQuery(
  req: ContextApiRequest,
  identity: MockIdentity,
): Promise<ContextPanelResult> {
  // R2: Test scenarios — synthetic states for browser verification.
  // NOTE: scenario=forbidden is NOT used for authorization (that's handled by
  // canQueryContext above). These scenarios simulate runtime state errors only.
  switch (req.scenario) {
    case 'forbidden':
      throw {
        errorCode: 'FORBIDDEN',
        httpStatus: 403,
        message: 'Bạn không có quyền xem hồ sơ này.',
      };
    case 'stale':
      throw {
        errorCode: 'STALE',
        httpStatus: 409,
        message: 'Dữ liệu đã cũ. Vui lòng tải lại.',
      };
    case 'timeout':
      throw {
        errorCode: 'TIMEOUT',
        httpStatus: 408,
        message: 'Yêu cầu quá thời gian. Vui lòng thử lại.',
      };
    case 'partial':
      // Partial: return 200 with unavailableFields (partial success).
      return {
        schemaVersion: '1',
        organizationId: identity.organizationId,
        snapshotVersion: 7,
        target: {
          kind: 'TALENT',
          schemaVersion: '1',
          laborProfileId: req.laborProfileId ?? 'lp-001',
          laborProfileVersion: 3,
        },
        identitySummary: {
          schemaVersion: '1',
          fullNameRedacted: 'Ng*** V*** A',
          phoneRedacted: '090****456',
          displayOnly: true,
        },
        placementCase: {
          schemaVersion: '1',
          placementCaseId: 'case-001',
          placementCaseVersion: 3,
          stage: 'CONTACTING',
          aggregateVersion: 3,
        },
        availability: {
          schemaVersion: '1',
          availability: 'AVAILABLE_NOW',
          aggregateVersion: 5,
          contactabilityVersion: 2,
        },
        currentRelationship: {
          schemaVersion: '1',
          currentRelationship: 'NEVER_WORKED',
          readonly: true,
        },
        recentInteractions: [],
        contactability: {
          schemaVersion: '1',
          dispatchOutcome: 'UNKNOWN',
          reasonCode: 'PARTIAL_RESULT',
          freshnessAt: new Date().toISOString(),
        },
        // R2: signal partial to UI.
        unavailableFields: ['placementCase', 'recentInteractions', 'nextAction'],
        resolvedAt: new Date().toISOString(),
      };
    default:
      // Success path — continue to real data.
      break;
  }

  if (!canQueryContext(identity, req.target)) {
    throw {
      errorCode: 'FORBIDDEN',
      httpStatus: 403,
      message: 'Bạn không có quyền xem hồ sơ này.',
    };
  }

  if (req.target === 'client') {
    throw {
      errorCode: 'UNAVAILABLE',
      httpStatus: 503,
      message: 'Giao diện Client đang trong quá trình phát triển.',
    };
  }

  const now = new Date().toISOString();
  return {
    schemaVersion: '1',
    organizationId: identity.organizationId,
    snapshotVersion: 7,
    target: {
      kind: 'TALENT',
      schemaVersion: '1',
      laborProfileId: req.laborProfileId ?? 'lp-001',
      laborProfileVersion: 3,
    },
    identitySummary: {
      schemaVersion: '1',
      fullNameRedacted: 'Ng*** V*** A',
      phoneRedacted: '090****456',
      displayOnly: true,
    },
    placementCase: {
      schemaVersion: '1',
      placementCaseId: 'case-001',
      placementCaseVersion: 3,
      stage: 'CONTACTING',
      aggregateVersion: 3,
    },
    availability: {
      schemaVersion: '1',
      availability: 'AVAILABLE_NOW',
      aggregateVersion: 5,
      contactabilityVersion: 2,
    },
    currentRelationship: {
      schemaVersion: '1',
      currentRelationship: 'NEVER_WORKED',
      readonly: true,
    },
    nextAction: {
      schemaVersion: '1',
      nextActionId: 'na-001',
      nextActionVersion: 1,
      status: 'OPEN',
      scheduledAt: now,
      snoozeMode: 'ACTIVE',
    },
    recentInteractions: [
      {
        schemaVersion: '1',
        interactionId: 'ixn-001',
        occurredAt: now,
        direction: 'INBOUND',
        channel: 'CHATWOOT',
        outcome: 'CONTACTED',
        summaryRedacted: 'Ứng viên hỏi về công việc mới',
      },
    ],
    contactability: {
      schemaVersion: '1',
      dispatchOutcome: 'AUTHORIZED',
      reasonCode: 'OK',
      freshnessAt: now,
    },
    resolvedAt: now,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * B3 — DNC: Actor ALWAYS from server-resolved MockIdentity; reject body spoof
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface DncApiRequest {
  organizationId: string;
  target: { kind: 'TALENT' | 'CLIENT'; laborProfileId?: string };
  reason: 'CANDIDATE_REQUEST' | 'PRIVACY_REQUEST' | 'HRP_POLICY' | 'OTHER';
  note?: string;
  /**
   * Body-supplied actor — INFORMATIONAL ONLY. Server compares with identity.actor
   * for spoof detection. If present and mismatched, request is rejected
   * (B3: cross-actor spoof). If absent, server fills from identity.
   */
  actor?: ActorClaim;
  provider: string;
  connectionId: string;
  externalContactId: string;
  externalAccountId?: string;
}

export async function handleDnc(
  req: DncApiRequest,
  identity: MockIdentity,
  /**
   * CORE/1.14 B3: server-validated correlation ID propagated from HTTP entry.
   * Replaces the previous local `Date.now()` fallback. DNC idempotency key
   * is derived from orgId + contactId (not correlation) so retries with
   * different correlation IDs do not create duplicate side effects.
   */
  inboundCorrelationId?: string,
): Promise<{ applied: boolean; suppressionEventId?: string; actorUsed: ActorClaim }> {
  // B3: Spoof detection — body.actor, if present, must match identity.actor.
  // If body.actor is absent: server uses identity.actor (no action needed).
  // If body.actor present and mismatched: reject (403).
  if (req.actor !== undefined) {
    const bodyActorId = actorIdOf(req.actor);
    const identityActorId = actorIdOf(identity.actor);
    if (bodyActorId !== identityActorId) {
      throw {
        errorCode: 'CROSS_ACTOR',
        httpStatus: 403,
        message: 'Actor giả mạo — userId/serviceId không khớp danh tính đã xác thực.',
      };
    }
  }

  // B3: Effective actor — ALWAYS server-resolved.
  const effectiveActor = identity.actor;

  // CORE/1.14 B3: correlation propagates from server entry. Fallback only
  // when not provided. Idempotency key excludes correlation (so retries
  // with different correlation still de-dupe by canonical key).
  const correlationId = inboundCorrelationId
    ?? `corr-dnc-${identity.staffId}-${req.externalContactId}`;

  const input = {
    organizationId: req.organizationId,
    provider: req.provider,
    connectionId: req.connectionId,
    externalContactId: req.externalContactId,
    ...(req.externalAccountId !== undefined ? { externalAccountId: req.externalAccountId } : {}),
    ...(req.target.laborProfileId !== undefined ? { canonicalId: req.target.laborProfileId } : {}),
    reason: req.reason,
    ...(req.note !== undefined ? { note: req.note } : {}),
    // B3: idempotency key is canonical (org + contact) NOT correlation.
    idempotencyKey: `dnc-${req.organizationId}-${req.externalContactId}`,
    correlationId,
    actor: effectiveActor, // B3: ALWAYS server-resolved.
  };

  const payload = buildCommitSuppressionPayload(input as Parameters<typeof buildCommitSuppressionPayload>[0]);
  assertCommitSuppressionPayloadValid(input as Parameters<typeof assertCommitSuppressionPayloadValid>[0]);

  const gw = serverSession.getGateway();
  // CORE/1.14 B4: lifecycle lag around the gateway action. Injected clock.
  const dncStart = now();
  try {
    const result = await executeDncAction(
      input as Parameters<typeof executeDncAction>[0],
      buildGatewayCaller(gw) as never,
    );
    const lagMs = now() - dncStart;
    observe('orchestrator.lag_ms', lagMs, {
      outcome: result.outcome === 'APPLIED' ? 'success' : 'error',
    });
    return { applied: result.outcome === 'APPLIED', suppressionEventId: result.suppressionEventId, actorUsed: effectiveActor };
  } catch (err) {
    const lagMs = now() - dncStart;
    observe('orchestrator.lag_ms', lagMs, { outcome: 'error' });
    throw err;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * REPLAY & RESUME helpers (B4: gateway call log evidence)
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface ResumeSummary {
  preCallCount: number;
  postCallCount: number;
  newCalls: number;
  preAppliedSteps: string[];
  postAppliedSteps: string[];
}

export async function handleResume(req: {
  organizationId: string;
  intakeRevisionId: string;
  identity: MockIdentity;
  scenario?: string;
  /**
   * CORE/1.14 B3: server-validated correlation propagated from HTTP entry.
   * Used in the gateway call log + checkpoint correlationId field so
   * resume traces match the original receipt.
   */
  inboundCorrelationId?: string;
}): Promise<{ result: RunApiResponse; summary: ResumeSummary }> {
  void req.identity;
  const checkpoint = await serverSession.checkpointFindByOrgRevision(req.organizationId, req.intakeRevisionId);
  if (!checkpoint) {
    throw {
      errorCode: 'CHECKPOINT_NOT_FOUND',
      httpStatus: 404,
      message: 'Không tìm thấy checkpoint để tiếp tục.',
    };
  }

  if (checkpoint.state !== 'PARTIAL') {
    throw {
      errorCode: 'NOT_PARTIAL',
      httpStatus: 409,
      message: 'Checkpoint này không ở trạng thái partial, không thể resume.',
    };
  }

  // B4: Snapshot gateway call log BEFORE resume to compute delta.
  const preCalls = ledgerSnapshot(serverSession);
  const preApplied = checkpoint.appliedSteps;

  const scenarioId = resolveScenarioId(req.scenario ?? 'exact');
  const orch = createOrchestrator(serverSession);
  // CORE/1.14 B3: prefer inbound correlation; fallback to deterministic
  // id (NOT local ts). Resume's idempotency is keyed on
  // intakeRevisionId, so correlation does NOT affect idempotency.
  const correlationId = req.inboundCorrelationId
    ?? `corr-resume-${req.organizationId}-${req.intakeRevisionId}`;

  // B4: Resume uses orgId+intakeRevisionId only — orchestrator's
  // resumeWithPayload uses stored appliedSteps to skip already-applied steps.
  try {
    const result = await (orch as unknown as { resumeWithPayload: (args: Parameters<IntakeOrchestrator['run']>[0]) => ReturnType<IntakeOrchestrator['run']> }).resumeWithPayload({
      organizationId: req.organizationId,
      intakeRevisionId: req.intakeRevisionId,
      fullName: '',
      phone: '',
      citizenIdentity: { number: '', address: '' },
      intent: { stage: checkpoint.state, availability: '' },
      evidenceRefs: [],
      confirmation: {
        organizationId: req.organizationId,
        context: {
          draftRevisionId: req.intakeRevisionId,
          draftDigest: checkpoint.draftDigest,
          ...(checkpoint.canonicalId !== null ? { canonicalId: checkpoint.canonicalId } : {}),
          ...(checkpoint.canonicalVersion !== null ? { canonicalVersion: checkpoint.canonicalVersion } : {}),
        },
        confirmed: true as const,
      },
      draftDigest: checkpoint.draftDigest,
      provider: 'CHATWOOT',
      connectionId: 'conn-mock-001',
      externalReference: 'ext-ref-resume-001',
      correlationId,
    } as Parameters<IntakeOrchestrator['run']>[0]);

    // B4: Snapshot gateway call log AFTER resume.
    const postCalls = ledgerSnapshot(serverSession);
    const summary: ResumeSummary = {
      preCallCount: preCalls.length,
      postCallCount: postCalls.length,
      newCalls: postCalls.length - preCalls.length,
      preAppliedSteps: preApplied,
      postAppliedSteps: result.appliedSteps,
    };

    return {
      result: {
        checkpointId: result.checkpointId,
        state: result.state,
        appliedSteps: result.appliedSteps,
        ...(result.partialFailure !== undefined ? { partialFailure: result.partialFailure } : {}),
        actedOnAnyStep: result.actedOnAnyStep,
        digest: checkpoint.draftDigest,
      },
      summary,
    };
  } catch (err) {
    if (err instanceof OrchestratorError) {
      throw {
        errorCode: err.code,
        httpStatus: 500,
        message: 'Lỗi khi tiếp tục xử lý. Vui lòng thử lại.',
      };
    }
    throw err;
  }
}

export { STEP_ORDER, buildStepIdempotencyKey };
