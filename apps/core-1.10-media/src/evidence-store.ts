/**
 * evidence-store.ts — In-memory synthetic evidence lifecycle (CORE/1.10).
 *
 * Lifecycle states:
 *   QUARANTINED → READY         (scan passed)
 *   QUARANTINED → REJECTED      (scan failed)
 *   READY       → REVOKED       (operator delete / retention expiry / DSR)
 *   REJECTED    → REVOKED       (after retention window)
 *
 * Synthetic only:
 *   - No real bytes are scanned. The "scan" is a deterministic fixture:
 *     if `bytes` length > 0 and contentDigest starts with a known
 *     "reject" prefix, status flips to REJECTED; otherwise READY.
 *     In production this MUST be replaced with real antivirus and
 *     content-type validation (see ADR-MEDIA-01-VN §4).
 *   - "REVOKED" is not the same as "deleted"; the audit trail is kept
 *     per HRP retention policy (UNKNOWN — see ADR §6).
 *
 * Policy: cross-org access is blocked; quarantined/rejected/revoked
 * evidence is never exposed as READY.
 */

import {
  OrganizationIdSchema,
  SchemaVersionSchema,
} from '@hrp-engagement/contracts';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';

/* ───────────────────────────────────────────────────────────────────────────
 * Wire types — match ObjectStorageHandle + add lifecycle.
 * Lifecycle status is CORE/1.10 internal (not yet in contracts Gate 0).
 * ─────────────────────────────────────────────────────────────────────────── */

export const EVIDENCE_LIFECYCLE_STATES = [
  'QUARANTINED',
  'READY',
  'REJECTED',
  'REVOKED',
] as const;

export type EvidenceLifecycleState =
  (typeof EVIDENCE_LIFECYCLE_STATES)[number];

export const EvidenceLifecycleStateSchema = z.enum(EVIDENCE_LIFECYCLE_STATES);

export const EVIDENCE_KINDS = ['CCCD_FRONT', 'CCCD_BACK'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface EvidenceRecord {
  schemaVersion: '1';
  evidenceId: string;
  organizationId: string;
  kind: EvidenceKind;
  contentDigest: string;
  sizeBytes: number;
  storedAt: string; // ISO datetime
  state: EvidenceLifecycleState;
  /** Reason when state is REJECTED or REVOKED (free-form policy label). */
  stateReason?: string;
  /** VN residency marker (always true for CORE/1.10 synthetic). */
  vnResidency: true;
}

/** Synthetic scan decision (deterministic fixture). */
export interface ScanFixtureDecision {
  /** If true, evidence transitions to READY. If false, REJECTED. */
  pass: boolean;
  /** Free-form fixture reason (logged for audit). */
  reason: string;
  /** Mock antivirus engine label. */
  engine: 'FIXTURE_ENGINE_Core_1_10_MOCK';
}

/**
 * Default scan fixture:
 *   - bytes length 0 → REJECTED (empty input)
 *   - bytes length > MAX_BYTES (32 MiB) → REJECTED (size limit)
 *   - else → READY (deterministic pass)
 *
 * Tests can override with `installScanFixture()` to inject custom
 * decisions (e.g. simulate malware detection).
 */
const MAX_EVIDENCE_BYTES = 32 * 1024 * 1024;

let installedScanFixture: ((bytes: Uint8Array) => ScanFixtureDecision) | null =
  null;

export function installScanFixture(
  fn: ((bytes: Uint8Array) => ScanFixtureDecision) | null,
): void {
  installedScanFixture = fn;
}

export function defaultScanFixture(bytes: Uint8Array): ScanFixtureDecision {
  if (bytes.length === 0) {
    return {
      pass: false,
      reason: 'empty input',
      engine: 'FIXTURE_ENGINE_Core_1_10_MOCK',
    };
  }
  if (bytes.length > MAX_EVIDENCE_BYTES) {
    return {
      pass: false,
      reason: `exceeds MAX_EVIDENCE_BYTES (${MAX_EVIDENCE_BYTES})`,
      engine: 'FIXTURE_ENGINE_Core_1_10_MOCK',
    };
  }
  return {
    pass: true,
    reason: 'fixture pass',
    engine: 'FIXTURE_ENGINE_Core_1_10_MOCK',
  };
}

/* ───────────────────────────────────────────────────────────────────────────
 * InMemoryEvidenceStore
 *
 * Process-local singleton per import (mirrors CORE/1.7 review store).
 * Tests reset via `resetStore()`.
 * ─────────────────────────────────────────────────────────────────────────── */

export interface UploadRequest {
  schemaVersion: '1';
  organizationId: string;
  kind: EvidenceKind;
  bytes: Uint8Array;
  owner: string;
  /** Synthetic content hint for fixture scan (e.g. for malware sim). */
  simulateMalware?: boolean;
}

export interface UploadResult {
  evidenceId: string;
  contentDigest: string;
  storedAt: string;
  initialState: EvidenceLifecycleState;
  scan: ScanFixtureDecision;
}

export class InMemoryEvidenceStore {
  private readonly records = new Map<string, EvidenceRecord>();
  private readonly orgIndex = new Map<string, Set<string>>();

  reset(): void {
    this.records.clear();
    this.orgIndex.clear();
  }

  /** All evidence records (for test introspection). */
  list(): readonly EvidenceRecord[] {
    return [...this.records.values()];
  }

  get(evidenceId: string): EvidenceRecord | null {
    return this.records.get(evidenceId) ?? null;
  }

  /**
   * Upload evidence. New evidence is always created in QUARANTINED state
   * and immediately scanned by the fixture; state transitions to READY or
   * REJECTED based on scan result.
   */
  upload(req: UploadRequest): UploadResult {
    OrganizationIdSchema.parse(req.organizationId);
    SchemaVersionSchema.parse(req.schemaVersion);

    const evidenceId = `ev-${randomUUID()}`;
    const contentDigest = sha256Hex(req.bytes);
    const storedAt = new Date().toISOString();

    const scan = installedScanFixture
      ? installedScanFixture(req.bytes)
      : req.simulateMalware === true
        ? {
            pass: false,
            reason: 'simulated malware (test fixture)',
            engine: 'FIXTURE_ENGINE_Core_1_10_MOCK' as const,
          }
        : defaultScanFixture(req.bytes);

    const state: EvidenceLifecycleState =
      scan.pass === true ? 'READY' : 'REJECTED';

    const record: EvidenceRecord = {
      schemaVersion: req.schemaVersion,
      evidenceId,
      organizationId: req.organizationId,
      kind: req.kind,
      contentDigest,
      sizeBytes: req.bytes.length,
      storedAt,
      state,
      stateReason: scan.reason,
      vnResidency: true,
    };
    this.records.set(evidenceId, record);
    let set = this.orgIndex.get(req.organizationId);
    if (!set) {
      set = new Set();
      this.orgIndex.set(req.organizationId, set);
    }
    set.add(evidenceId);

    return { evidenceId, contentDigest, storedAt, initialState: state, scan };
  }

  /**
   * Operator-initiated revoke (retention expiry / DSR / policy decision).
   * Only READY evidence can transition to REVOKED via this path.
   * REJECTED evidence auto-revokes via `revokeRejected()` after retention.
   */
  revoke(evidenceId: string, reason: string): EvidenceRecord | null {
    const rec = this.records.get(evidenceId);
    if (!rec) return null;
    if (rec.state !== 'READY') {
      throw new Error(
        `cannot revoke evidence in state ${rec.state} (only READY → REVOKED via revoke())`,
      );
    }
    const next: EvidenceRecord = {
      ...rec,
      state: 'REVOKED',
      stateReason: reason,
    };
    this.records.set(evidenceId, next);
    return next;
  }

  /**
   * Cross-org access guard. Throws if `evidenceId` does not belong to
   * `organizationId` or does not exist.
   */
  requireOrgScope(evidenceId: string, organizationId: string): EvidenceRecord {
    const rec = this.records.get(evidenceId);
    if (!rec) {
      throw new Error(`EVIDENCE_NOT_FOUND: ${evidenceId}`);
    }
    if (rec.organizationId !== organizationId) {
      throw new Error(
        `CROSS_ORG: evidence ${evidenceId} belongs to ${rec.organizationId}, requested by ${organizationId}`,
      );
    }
    return rec;
  }

  /**
   * Returns evidence in READY state only. Throws if evidence is in any
   * other state. This is the gate for using evidence as part of a
   * command submission.
   */
  requireReady(evidenceId: string, organizationId: string): EvidenceRecord {
    const rec = this.requireOrgScope(evidenceId, organizationId);
    if (rec.state !== 'READY') {
      throw new Error(
        `EVIDENCE_NOT_READY: ${evidenceId} is in state ${rec.state}`,
      );
    }
    return rec;
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Singleton accessor (mirrors CORE/1.7 reviewStore pattern). */
export const evidenceStore = new InMemoryEvidenceStore();
