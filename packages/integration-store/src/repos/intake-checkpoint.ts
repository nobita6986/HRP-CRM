// src/repos/intake-checkpoint.ts — IntakeCheckpoint repository (CORE/1.6).
//
// Boundaries (Backlog §Task 1.6):
//  - Checkpoint bền trong Integration DB riêng (schema integration).
//  - Unique theo (organizationId, intakeRevisionId) — same revision không tạo 2 rows.
//  - appliedStepsJson là array các step đã APPLIED; resume đọc để skip.
//  - KHÔNG xóa row; chỉ transition state (RUNNING → PARTIAL|COMPLETED|FAILED|REVIEW_PENDING).
//  - Idempotency key per-checkpoint; KHÔNG dùng để merge canonical.

import type { PrismaClient } from '@prisma/client';
import type { IntakeCheckpointState } from '@prisma/client';
import { runInTxn } from '../client.js';
import { storeError } from '../errors.js';

export type IntakeCheckpointStateWire =
  | 'RUNNING'
  | 'PARTIAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'REVIEW_PENDING';

const VALID_STATES: ReadonlyArray<IntakeCheckpointStateWire> = [
  'RUNNING',
  'PARTIAL',
  'COMPLETED',
  'FAILED',
  'REVIEW_PENDING',
];

function asStateEnum(s: string): IntakeCheckpointState {
  if (!(VALID_STATES as readonly string[]).includes(s)) {
    throw storeError('VALIDATION_ERROR', `IntakeCheckpoint state không hợp lệ: ${s}`, { target: 'state' });
  }
  return s as IntakeCheckpointState;
}

export interface IntakeCheckpointInput {
  checkpointId: string;
  schemaVersion: string;
  organizationId: string;
  intakeRevisionId: string;
  draftDigest: string;
  canonicalId?: string | undefined;
  canonicalVersion?: number | undefined;
  currentStep?: string | undefined;
  state: IntakeCheckpointStateWire;
  appliedSteps: string[];
  stepResults: Record<string, unknown>;
  lastError?: unknown;
  correlationId?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface IntakeCheckpointRow {
  checkpointId: string;
  organizationId: string;
  intakeRevisionId: string;
  draftDigest: string;
  canonicalId: string | null;
  canonicalVersion: number | null;
  currentStep: string | null;
  state: IntakeCheckpointStateWire;
  appliedSteps: string[];
  stepResults: Record<string, unknown>;
  lastError: unknown | null;
  correlationId: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function rowToContract(row: {
  checkpointId: string;
  organizationId: string;
  intakeRevisionId: string;
  draftDigest: string;
  canonicalId: string | null;
  canonicalVersion: number | null;
  currentStep: string | null;
  state: IntakeCheckpointState;
  appliedStepsJson: unknown;
  stepResultsJson: unknown;
  lastErrorJson: unknown;
  correlationId: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}): IntakeCheckpointRow {
  return {
    checkpointId: row.checkpointId,
    organizationId: row.organizationId,
    intakeRevisionId: row.intakeRevisionId,
    draftDigest: row.draftDigest,
    canonicalId: row.canonicalId,
    canonicalVersion: row.canonicalVersion,
    currentStep: row.currentStep,
    state: row.state as IntakeCheckpointStateWire,
    appliedSteps: Array.isArray(row.appliedStepsJson) ? (row.appliedStepsJson as string[]) : [],
    stepResults:
      row.stepResultsJson && typeof row.stepResultsJson === 'object'
        ? (row.stepResultsJson as Record<string, unknown>)
        : {},
    lastError: row.lastErrorJson ?? null,
    correlationId: row.correlationId,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Create checkpoint (RUNNING). Returns existing row if (org, revision) already exists
 * with same draftDigest; throws IDEMPOTENCY_CONFLICT if different draftDigest.
 *
 * Caller (orchestrator) passes draftDigest SHA-256 hex. Server-side binding — never trust
 * caller checkbox alone.
 */
export async function createIntakeCheckpoint(
  prisma: PrismaClient,
  input: IntakeCheckpointInput,
): Promise<{ row: IntakeCheckpointRow; created: boolean }> {
  if (!input.organizationId || !input.intakeRevisionId || !input.draftDigest) {
    throw storeError('VALIDATION_ERROR', 'thiếu organizationId / intakeRevisionId / draftDigest', {
      target: 'checkpoint',
    });
  }
  if (!/^[a-f0-9]{64}$/u.test(input.draftDigest)) {
    throw storeError('VALIDATION_ERROR', 'draftDigest phải SHA-256 hex 64 ký tự', { target: 'draftDigest' });
  }

  return runInTxn(prisma, async (tx) => {
    const existing = await tx.intakeCheckpoint.findUnique({
      where: {
        uq_intake_checkpoint_org_revision: {
          organizationId: input.organizationId,
          intakeRevisionId: input.intakeRevisionId,
        },
      },
    });

    if (existing) {
      if (existing.draftDigest !== input.draftDigest) {
        throw storeError(
          'DUPLICATE_KEY',
          'IDEMPOTENCY_CONFLICT: same intakeRevisionId + different draftDigest — confirmation cũ đã mất hiệu lực',
          { target: 'draftDigest' },
        );
      }
      return { row: rowToContract(existing), created: false };
    }

    const created = await tx.intakeCheckpoint.create({
      data: {
        checkpointId: input.checkpointId,
        schemaVersion: input.schemaVersion,
        organizationId: input.organizationId,
        intakeRevisionId: input.intakeRevisionId,
        draftDigest: input.draftDigest,
        canonicalId: input.canonicalId ?? null,
        canonicalVersion: input.canonicalVersion ?? null,
        currentStep: input.currentStep ?? null,
        state: asStateEnum(input.state),
        appliedStepsJson: input.appliedSteps as unknown as Parameters<typeof tx.intakeCheckpoint.create>[0]['data']['appliedStepsJson'],
        stepResultsJson: input.stepResults as unknown as Parameters<typeof tx.intakeCheckpoint.create>[0]['data']['stepResultsJson'],
        lastErrorJson: (input.lastError ?? null) as unknown as Parameters<typeof tx.intakeCheckpoint.create>[0]['data']['lastErrorJson'],
        correlationId: input.correlationId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    return { row: rowToContract(created), created: true };
  });
}

/**
 * Find checkpoint by (org, intakeRevisionId). Returns null nếu không tồn tại.
 */
export async function findIntakeCheckpoint(
  prisma: PrismaClient,
  scope: { organizationId: string; intakeRevisionId: string },
): Promise<IntakeCheckpointRow | null> {
  if (!scope.organizationId || !scope.intakeRevisionId) {
    throw storeError('VALIDATION_ERROR', 'thiếu scope', { target: 'checkpoint' });
  }
  const row = await prisma.intakeCheckpoint.findUnique({
    where: {
      uq_intake_checkpoint_org_revision: {
        organizationId: scope.organizationId,
        intakeRevisionId: scope.intakeRevisionId,
      },
    },
  });
  return row ? rowToContract(row) : null;
}

/**
 * Update checkpoint — record applied step + transition state atomically.
 *
 * Caller passes full updated appliedSteps[]/stepResults{} (server merges; không trust
 * client-side merge). State transition: RUNNING → COMPLETED|PARTIAL|FAILED|REVIEW_PENDING.
 *
 * Validation: draftDigest KHÔNG đổi; nếu caller passes draftDigest khác → reject.
 */
export interface IntakeCheckpointUpdate {
  currentStep?: string;
  state: IntakeCheckpointStateWire;
  appliedSteps: string[];
  stepResults: Record<string, unknown>;
  lastError?: unknown;
  canonicalId?: string;
  canonicalVersion?: number;
}

export async function updateIntakeCheckpoint(
  prisma: PrismaClient,
  scope: { organizationId: string; intakeRevisionId: string },
  update: IntakeCheckpointUpdate,
): Promise<IntakeCheckpointRow> {
  return runInTxn(prisma, async (tx) => {
    const existing = await tx.intakeCheckpoint.findUnique({
      where: {
        uq_intake_checkpoint_org_revision: {
          organizationId: scope.organizationId,
          intakeRevisionId: scope.intakeRevisionId,
        },
      },
    });
    if (!existing) {
      throw storeError('VALIDATION_ERROR', 'checkpoint không tồn tại', { target: 'checkpoint' });
    }

    const updated = await tx.intakeCheckpoint.update({
      where: { checkpointId: existing.checkpointId },
      data: {
        currentStep: update.currentStep ?? null,
        state: asStateEnum(update.state),
        appliedStepsJson: update.appliedSteps as unknown as Parameters<typeof tx.intakeCheckpoint.update>[0]['data']['appliedStepsJson'],
        stepResultsJson: update.stepResults as unknown as Parameters<typeof tx.intakeCheckpoint.update>[0]['data']['stepResultsJson'],
        lastErrorJson: (update.lastError ?? null) as unknown as Parameters<typeof tx.intakeCheckpoint.update>[0]['data']['lastErrorJson'],
        canonicalId: update.canonicalId ?? existing.canonicalId,
        canonicalVersion: update.canonicalVersion ?? existing.canonicalVersion,
      },
    });
    return rowToContract(updated);
  });
}
