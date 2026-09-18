/**
 * context-panel/src/ui/mock-api.ts — CORE/1.9 Mock API client (B1/B3 fixed).
 *
 * Flow:
 *  1. Preview → server creates ReviewSnapshot, returns { reviewSnapshotId, digest, candidates }.
 *  2. Submit → server validates reviewSnapshotId + digest match + actor match.
 *
 * Authorization:
 *  - X-HRP-Staff-Id header is sent with every request.
 *  - Staff roles determine permissions (see server-side resolveMockIdentity).
 *
 * Boundaries:
 *  - B1: Frontend CANNOT forge confirmation — must call preview first.
 *  - B3: Authorization enforced server-side, not via scenario param.
 *  - B2: When mockMode === 'off', server returns 404 for /api/*.
 */

import type { ContextPanelResult } from '@hrp-engagement/contracts';
import type { IntakeRunResult } from './types.js';

const API_BASE = '';

/** Staff ID used by the React UI (mapped to INTAKE_OPERATOR role in mock identity map). */
export const UI_STAFF_ID = 'staff-intake-001';

export interface QueryContextOptions {
  target: 'talent' | 'client';
  laborProfileId?: string;
}

export interface PreviewOptions {
  organizationId: string;
  intakeRevisionId: string;
  signal: {
    phone?: string;
    fullName?: string;
    citizenId?: string;
  };
  // R1: Pass full draft so preview digest matches run digest (edits after
  // preview invalidate confirmation server-side via DIGEST_MISMATCH).
  contactAddress?: string;
  citizenIdentity?: { number?: string; address?: string };
  intent?: { stage?: string; availability?: string; availableFromDate?: string };
  evidenceRefs?: Array<{ evidenceId: string; kind: string }>;
}

export interface PreviewResult {
  /** B1: Server-created snapshot ID — required for subsequent run. */
  reviewSnapshotId: string;
  /** B1: Digest bound to this snapshot. */
  digest: string;
  candidates: Array<{ id: string; label: string; strength: string }>;
  previewExpiresAt: string;
  hasStrongMatch: boolean;
}

export interface RunOptions {
  organizationId: string;
  intakeRevisionId: string;
  /** B1: REQUIRED — must be from preview result. */
  reviewSnapshotId: string;
  fullName: string;
  phone: string;
  citizenIdentity: { number: string; address: string };
  contactAddress?: string;
  intent: { stage: string; availability: string; availableFromDate?: string };
  evidenceRefs: Array<{ id: string; kind: string }>;
  scenario?: string;
}

export type MockScenario =
  | 'success'
  | 'forbidden'
  | 'unresolved'
  | 'stale'
  | 'timeout'
  | 'partial';

/* ─────────────────────────────────────────────────────────────────────────────
 * Error types
 * ───────────────────────────────────────────────────────────────────────────── */

export type ApiErrorCode =
  | 'MISSING_REVIEW'
  | 'INVALID_SNAPSHOT'
  | 'DIGEST_MISMATCH'
  | 'SNAPSHOT_EXPIRED'
  | 'ACTOR_MISMATCH'
  | 'FORBIDDEN'
  | 'UNAVAILABLE'
  | 'UNAUTHORIZED'
  | 'UNRESOLVED'
  | 'STALE'
  | 'TIMEOUT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'VALIDATION_ERROR'
  | 'CHECKPOINT_NOT_FOUND'
  | 'NOT_PARTIAL'
  | 'PREVIEW_FAILED'
  | 'RUN_FAILED'
  | 'DNC_FAILED'
  | 'NETWORK'
  | 'UNKNOWN';

export class PanelApiError extends Error {
  readonly code: ApiErrorCode;
  readonly httpStatus: number;
  readonly userMessage: string;

  constructor(code: ApiErrorCode, httpStatus: number, userMessage: string, original?: unknown) {
    super(userMessage);
    this.code = code;
    this.httpStatus = httpStatus;
    this.userMessage = userMessage;
    this.name = 'PanelApiError';
    if (original !== undefined) {
      (this as { cause?: unknown }).cause = original;
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * HTTP helpers
 * ───────────────────────────────────────────────────────────────────────────── */

const DEFAULT_TIMEOUT_MS = 10_000;

async function fetchJson<T>(
  url: string,
  init?: RequestInit & { timeoutMs?: number; staffId?: string },
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const staffId = init?.staffId ?? UI_STAFF_ID;

  try {
    const res = await fetch(`${API_BASE}${url}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-HRP-Staff-Id': staffId,
        ...(init?.headers ?? {}),
      },
    });
    const body = (await res.json()) as unknown;

    if (!res.ok) {
      const errorBody = body as { error?: string; message?: string };
      const code = (errorBody?.error ?? 'UNKNOWN') as ApiErrorCode;
      const message = errorBody?.message ?? 'Lỗi không xác định';
      throw new PanelApiError(code, res.status, message, body);
    }

    return body as T;
  } catch (err) {
    if (err instanceof PanelApiError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new PanelApiError('NETWORK', 408, 'Hết thời gian phản hồi. Vui lòng thử lại.', err);
    }
    throw new PanelApiError('NETWORK', 0, 'Lỗi mạng. Vui lòng thử lại.', err);
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * API client
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * B1: Preview — creates server-side review snapshot.
 * Returns reviewSnapshotId which is REQUIRED for subsequent run().
 */
export async function previewIntake(opts: PreviewOptions): Promise<PreviewResult> {
  const result = await fetchJson<{
    reviewSnapshotId: string;
    digest: string;
    candidates: Array<{ candidateId: string; strength: 'STRONG' | 'WEAK' | 'PARTIAL'; label?: string }>;
    previewExpiresAt: string;
    hasStrongMatch: boolean;
  }>('/api/intake/preview', {
    method: 'POST',
    body: JSON.stringify(opts),
  });

  return {
    reviewSnapshotId: result.reviewSnapshotId,
    digest: result.digest,
    candidates: result.candidates.map((c) => ({
      id: c.candidateId,
      label: c.label ?? `Ứng viên ${c.candidateId.slice(-4)}`,
      strength: c.strength,
    })),
    previewExpiresAt: result.previewExpiresAt,
    hasStrongMatch: result.hasStrongMatch,
  };
}

/**
 * B1: Run — REQUIRES reviewSnapshotId from preview().
 * Server validates: snapshotId + digest match + actor match.
 */
export async function runIntake(opts: RunOptions): Promise<IntakeRunResult> {
  const result = await fetchJson<{
    checkpointId: string;
    state: 'COMPLETED' | 'FAILED' | 'PARTIAL' | 'REVIEW_PENDING';
    appliedSteps: string[];
    partialFailure?: {
      failedStep: string;
      errorCode: string;
      errorMessage: string;
      retryable: boolean;
    };
    actedOnAnyStep: boolean;
    digest: string;
  }>('/api/intake/run', {
    method: 'POST',
    body: JSON.stringify({
      ...opts,
      evidenceRefs: opts.evidenceRefs.map((e) => ({ evidenceId: e.id, kind: e.kind })),
    }),
  });

  return {
    checkpointId: result.checkpointId,
    state: result.state,
    appliedSteps: result.appliedSteps,
    ...(result.partialFailure !== undefined ? { partialFailure: result.partialFailure } : {}),
    actedOnAnyStep: result.actedOnAnyStep,
  };
}

/**
 * B3: Query context — authorized via X-HRP-Staff-Id header.
 */
export async function queryContext(opts: QueryContextOptions): Promise<ContextPanelResult> {
  const params = new URLSearchParams();
  params.set('target', opts.target);
  if (opts.laborProfileId) params.set('laborProfileId', opts.laborProfileId);

  return fetchJson<ContextPanelResult>(`/api/context?${params.toString()}`, {
    method: 'GET',
  });
}

/**
 * DNC action — actor passed through request body (B3: validated, not hardcoded).
 */
export async function dncAction(opts: {
  organizationId: string;
  target: { kind: 'TALENT' | 'CLIENT'; laborProfileId?: string };
  reason: 'REQUESTED_BY_CANDIDATE' | 'DO_NOT_CONTACT_POLICY' | 'COMPLIANCE_HOLD' | 'DATA_RETENTION';
  note?: string;
  provider: string;
  connectionId: string;
  externalContactId: string;
  externalAccountId?: string;
}): Promise<{ applied: boolean; suppressionEventId?: string }> {
  return fetchJson<{ applied: boolean; suppressionEventId?: string }>('/api/intake/dnc', {
    method: 'POST',
    body: JSON.stringify({
      ...opts,
      actor: { kind: 'USER', userId: UI_STAFF_ID },
    }),
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
 * B2: Check if mock is enabled (useful for dev tools)
 * ───────────────────────────────────────────────────────────────────────────── */

export async function checkMockStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health/ready`);
    const body = (await res.json()) as { mockMode?: string };
    return body.mockMode !== 'off';
  } catch {
    return false;
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ───────────────────────────────────────────────────────────────────────────── */

export function describeError(err: unknown): { code: string; message: string } {
  if (err instanceof PanelApiError) return { code: err.code, message: err.userMessage };
  if (err instanceof Error) return { code: 'UNKNOWN', message: err.message };
  return { code: 'UNKNOWN', message: 'Lỗi không xác định' };
}
