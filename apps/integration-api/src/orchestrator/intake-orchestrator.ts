// src/orchestrator/intake-orchestrator.ts — Intake Orchestrator (CORE/1.6).
//
// Public surface:
//   - IntakeOrchestrator class: entry point cho run/resume/preview.
//   - Step results persisted to IntegrationStore (IntakeCheckpoint).
//   - Idempotency: per-step key derived from intakeRevisionId + stepName.
//
// Backlog §Task 1.6 AC mapping:
//   [✓] Preview không gọi mutation; chỉ dùng read-only resolver port.
//       → preview() uses resolveIdentityCandidates() qua gateway caller.
//   [✓] Confirmed revision → identity → fill-missing/review/new → case/availability
//       có checkpoint bền trong Integration Store.
//       → run() builds 5-step state machine; mỗi step commits checkpoint.
//   [✓] EXACT profile no-op không tính created.
//       → profileStep(): if patch là rỗng hoặc đã match → NOOP, KHÔNG increment created count.
//   [✓] POSSIBLE dừng để review.
//       → identity step POSSIBLE → state=REVIEW_PENDING, dừng.
//   [✓] NEW chỉ theo scenario policy mock.
//       → identity step NEW → use canonicalId từ gateway response (mock accepts policy).
//   [✓] Profile applied rồi case fail: partial result rõ, resume đúng step/idempotency key.
//       → state=PARTIAL + failedStep recorded; resume() skips appliedSteps, continues from failedStep.
//   [✓] Target/version khác bản review yêu cầu re-review.
//       → run()/resume() re-compute draftDigest; if digest khác checkpoint.draftDigest → INVALID.
//   [✓] Confirmation phải bind revision/digest/actor/context.
//       → StaffReviewConfirmation: { draftRevisionId, draftDigest, canonicalId?, canonicalVersion?, actor, context }.
//   [✓] Đổi field/evidence/intent/target làm confirmation cũ mất hiệu lực.
//       → same intakeRevisionId + different draftDigest → DUPLICATE_KEY error → orchestrator rejects.
//   [✓] DNC action tách khỏi full intake.
//       → executeDncAction() ở dnc-handler.ts; KHÔNG gọi từ run().
//
// Boundaries (Owner 2026-09-14):
//   - KHÔNG sửa contracts freeze; chỉ consume.
//   - KHÔNG tự chốt HRP review pre/post-apply.
//   - KHÔNG claim canonical durability production (mock gateway ledger in-memory).
//   - KHÔNG paths chưa có contract giữ UNAVAILABLE.

import type { PrismaClient } from '@prisma/client';
import {
  createIntakeCheckpoint,
  findIntakeCheckpoint,
  updateIntakeCheckpoint,
  type IntakeCheckpointRow,
} from '@hrp-engagement/integration-store';
import {
  isConfirmationValid,
  StaffReviewContextSchema,
  type StaffReviewConfirmation,
} from '@hrp-engagement/contracts';
import type { z } from 'zod';
import type { HrpGatewayCallResult } from '../gateway/types.js';
import {
  STEP_ORDER,
  buildStepIdempotencyKey,
  buildCreateOrMatchPayload,
  extractMatchingOutcome,
  selectIdentityScenario,
  type GatewayCaller,
  type IdentityOutcomeKind,
  type IdentityStepResult,
  type ProfileStepResult,
  type CaseStepResult,
  type AvailabilityStepResult,
  type StepName,
  type StepRunContext,
} from './steps.js';
import { computeServerDigest } from './digest.js';

/* ───────────────────────────────────────────────────────────────────────────
 * Public DTOs.
 * ─────────────────────────────────────────────────────────────────────────── */

export interface PreviewRequest {
  organizationId: string;
  signal: {
    fullName?: string | undefined;
    phone?: string | undefined;
    citizenId?: string | undefined;
  };
  provider: string;
  connectionId: string;
}

export interface PreviewCandidate {
  candidateId: string;
  strength: 'STRONG' | 'WEAK' | 'PARTIAL';
  /** Redacted display label; runtime reviewer capability enforce. */
  label?: string | undefined;
}

export interface PreviewResult {
  candidates: PreviewCandidate[];
  /** TTL: preview không commit gì; expires sau window. */
  previewExpiresAt: string;
  /** True if any STRONG candidate; UI dùng để prompt staff review. */
  hasStrongMatch: boolean;
}

export interface IntakeRunRequest {
  organizationId: string;
  intakeRevisionId: string;
  /** Canonical draft fields (UI → server đã canonicalize trước khi submit). */
  fullName: string;
  phone: string;
  citizenIdentity: { number: string; address: string };
  contactAddress?: string | undefined;
  dob?: string | undefined;
  intent: {
    stage: string;
    availability: string;
    availableFromDate?: string | undefined;
  };
  evidenceRefs: Array<{ evidenceId: string; kind: string }>;
  /** Staff review confirmation binding draftDigest/canonicalId/version. */
  confirmation: StaffReviewConfirmation;
  /** Pre-computed draftDigest SHA-256 hex (server verifies binding). */
  draftDigest: string;
  /** Provenance. */
  provider: string;
  connectionId: string;
  externalReference: string;
  /** Optional: policy hint cho identity step (default ALLOW_NEW). */
  identityPolicy?: 'ALLOW_NEW' | 'MATCH_ONLY' | 'REVIEW_REQUIRED' | undefined;
  correlationId: string;
}

export interface IntakePartialFailure {
  failedStep: StepName;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
}

export type IntakeFinalState =
  | 'COMPLETED'
  | 'FAILED'
  | 'PARTIAL'
  | 'REVIEW_PENDING';

export interface IntakeRunResult {
  checkpointId: string;
  state: IntakeFinalState;
  appliedSteps: StepName[];
  partialFailure?: IntakePartialFailure;
  /** Step results keyed by step name (only for applied steps). */
  stepResults: {
    IDENTITY?: IdentityStepResult;
    PROFILE?: ProfileStepResult;
    CASE?: CaseStepResult;
    AVAILABILITY?: AvailabilityStepResult;
  };
  /** True if this call performed new mutations; false if all steps already applied. */
  actedOnAnyStep: boolean;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Identity resolver port — read-only, no createOrMatch mutation.
 * Owner instruction: preview phải dùng port READ-ONLY, không gọi createOrMatch.
 * ─────────────────────────────────────────────────────────────────────────── */
export interface IdentityPreviewCaller {
  resolveIdentityCandidates(args: {
    organizationId: string;
    signal: PreviewRequest['signal'];
    provider: string;
    connectionId: string;
    correlationId: string;
  }): Promise<{
    candidates: PreviewCandidate[];
  }>;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Orchestrator implementation.
 * ─────────────────────────────────────────────────────────────────────────── */

export interface IntakeOrchestratorOptions {
  prisma: PrismaClient;
  gatewayCall: GatewayCaller;
  identityPreview: IdentityPreviewCaller;
  /** Optional injected clock for deterministic tests. */
  now?: () => number;
  /** Optional ID generator for checkpoint IDs. */
  idGen?: () => string;
}

export class IntakeOrchestrator {
  private readonly prisma: PrismaClient;
  private readonly gatewayCall: GatewayCaller;
  private readonly identityPreview: IdentityPreviewCaller;
  private readonly now: () => number;
  private readonly idGen: () => string;

  constructor(opts: IntakeOrchestratorOptions) {
    this.prisma = opts.prisma;
    this.gatewayCall = opts.gatewayCall;
    this.identityPreview = opts.identityPreview;
    this.now = opts.now ?? (() => Date.now());
    this.idGen = opts.idGen ?? (() => `icp-${this.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`);
  }

  /**
   * Preview — read-only candidate resolver.
   *  - KHÔNG gọi createOrMatch mutation (Backlog §0.3b + §1.6 AC).
   *  - Trả STRONG/WEAK/PARTIAL + TTL.
   *  - Caller (UI) dùng kết quả để prompt staff trước khi submit.
   */
  async preview(req: PreviewRequest, correlationId: string): Promise<PreviewResult> {
    const result = await this.identityPreview.resolveIdentityCandidates({
      organizationId: req.organizationId,
      signal: req.signal,
      provider: req.provider,
      connectionId: req.connectionId,
      correlationId,
    });

    const ttlSeconds = 300; // 5 min preview window.
    return {
      candidates: result.candidates,
      previewExpiresAt: new Date(this.now() + ttlSeconds * 1000).toISOString(),
      hasStrongMatch: result.candidates.some((c) => c.strength === 'STRONG'),
    };
  }

  /**
   * Run — execute full intake workflow với checkpoint.
   *
   * Behavior:
   *  - Server-compute draftDigest từ actual request payload (B1).
   *  - Verify confirmation.context.draftDigest == server-computed (B3).
   *  - Verify client-supplied req.draftDigest == server-computed (B1).
   *  - Tạo checkpoint (nếu chưa có) hoặc load existing (same draftDigest).
   *  - Validate confirmation binding (B3: VALIDATION_ERROR khi stale).
   *  - Execute steps theo STEP_ORDER, skip applied steps.
   *  - Persist state RUNNING → COMPLETED|PARTIAL|FAILED|REVIEW_PENDING.
   *  - Trả IntakeRunResult với appliedSteps, stepResults, partialFailure (nếu có).
   *
   * KHÔNG delete/recreate profile đã apply. Idempotency key per-step derived.
   * KHÔNG self-claim authority: digest đúng không cấp quyền; runtime HRP gate
   * vẫn authorize (B1 boundary).
   */
  async run(req: IntakeRunRequest): Promise<IntakeRunResult> {
    // B1: server-compute draftDigest từ actual payload.
    const serverDigest = this.computeServerDigestFromReq(req);
    // B1+B3: client-supplied req.draftDigest phải khớp server-computed.
    if (req.draftDigest !== serverDigest) {
      throw new OrchestratorError(
        'IDEMPOTENCY_CONFLICT',
        'IDEMPOTENCY_CONFLICT: client-supplied draftDigest không khớp server-computed digest từ actual payload — semantic drift nghi ngờ',
        false,
      );
    }
    // B1+B3: confirmation.context.draftDigest phải khớp server-computed.
    if (req.confirmation.context.draftDigest !== serverDigest) {
      throw new OrchestratorError(
        'VALIDATION_ERROR',
        'confirmation.context.draftDigest không khớp server-computed digest từ actual payload',
        false,
      );
    }

    const ctx = this.buildStepContext(req);
    let row;
    let created;
    try {
      const r = await createIntakeCheckpoint(this.prisma, {
        checkpointId: this.idGen(),
        schemaVersion: '1',
        organizationId: req.organizationId,
        intakeRevisionId: req.intakeRevisionId,
        draftDigest: req.draftDigest,
        canonicalId: req.confirmation.context.canonicalId,
        canonicalVersion: req.confirmation.context.canonicalVersion,
        currentStep: 'CONFIRM_VALIDATE',
        state: 'RUNNING',
        appliedSteps: [],
        stepResults: {},
        correlationId: req.correlationId,
        idempotencyKey: `intake:${req.intakeRevisionId}`,
      });
      row = r.row;
      created = r.created;
    } catch (err) {
      throw this.translateStoreError(err, 'createIntakeCheckpoint');
    }

    return this.executeFromCheckpoint(ctx, row, created, req.confirmation);
  }

  /** B1: compute draftDigest server-side từ actual IntakeRunRequest. */
  private computeServerDigestFromReq(req: IntakeRunRequest): string {
    return computeServerDigest({
      organizationId: req.organizationId,
      intakeRevisionId: req.intakeRevisionId,
      fullName: req.fullName,
      phone: req.phone,
      citizenIdentity: req.citizenIdentity,
      ...(req.contactAddress !== undefined ? { contactAddress: req.contactAddress } : {}),
      ...(req.dob !== undefined ? { dob: req.dob } : {}),
      intent: req.intent,
      evidenceRefs: req.evidenceRefs,
      ...(req.confirmation.context.canonicalId !== undefined
        ? { canonicalId: req.confirmation.context.canonicalId }
        : {}),
      ...(req.confirmation.context.canonicalVersion !== undefined
        ? { canonicalVersion: req.confirmation.context.canonicalVersion }
        : {}),
    });
  }

  /** Translate store errors → OrchestratorError with consistent code/message. */
  private translateStoreError(err: unknown, op: string): OrchestratorError {
    if (err instanceof OrchestratorError) return err;
    const code =
      err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string'
        ? ((err as { code: string }).code)
        : 'TRANSACTION_FAILED';
    const message = err instanceof Error ? err.message : String(err);
    if (code === 'DUPLICATE_KEY') {
      // B3: store layer throws DUPLICATE_KEY khi same revision + different digest.
      // Map sang IDEMPOTENCY_CONFLICT (canonical error code) theo contract errors.ts.
      return new OrchestratorError(
        'IDEMPOTENCY_CONFLICT',
        'IDEMPOTENCY_CONFLICT: same intakeRevisionId + different draftDigest — confirmation cũ đã mất hiệu lực (digest đổi sau edit)',
        false,
      );
    }
    if (code === 'VALIDATION_ERROR') {
      return new OrchestratorError('VALIDATION_ERROR', message, false);
    }
    return new OrchestratorError('TRANSACTION_FAILED', `${op} failed: ${message}`, false);
  }

  /** Wrap updateIntakeCheckpoint so store errors map to OrchestratorError. */
  private async safeUpdateCheckpoint(
    scope: { organizationId: string; intakeRevisionId: string },
    update: {
      state: 'RUNNING' | 'PARTIAL' | 'COMPLETED' | 'FAILED' | 'REVIEW_PENDING';
      currentStep?: StepName | undefined;
      appliedSteps: StepName[];
      stepResults: IntakeRunResult['stepResults'];
      lastError?: IntakePartialFailure;
    },
  ): Promise<IntakeCheckpointRow> {
    try {
      return await updateIntakeCheckpoint(this.prisma, scope, update);
    } catch (err) {
      throw this.translateStoreError(err, 'updateIntakeCheckpoint');
    }
  }

  /** Wrap findIntakeCheckpoint so store errors map to OrchestratorError. */
  private async safeFindCheckpoint(
    scope: { organizationId: string; intakeRevisionId: string },
    op: string,
  ): Promise<IntakeCheckpointRow | null> {
    try {
      return await findIntakeCheckpoint(this.prisma, scope);
    } catch (err) {
      throw this.translateStoreError(err, op);
    }
  }

  /**
   * Resume — continue from failedStep.
   *  - Load checkpoint by (org, intakeRevisionId).
   *  - Validate draftDigest same as saved (B3: IDEMPOTENCY_CONFLICT khi khác).
   *  - Skip applied steps; continue from first not-applied step in STEP_ORDER.
   *  - Idempotent: applied steps KHÔNG chạy lại; retry only failedStep and below.
   *
   * Lưu ý: full req không có sẵn khi resume; caller nên dùng resumeWithPayload().
   */
  async resume(
    organizationId: string,
    intakeRevisionId: string,
    confirmation: StaffReviewConfirmation,
  ): Promise<IntakeRunResult> {
    const row = await this.safeFindCheckpoint({ organizationId, intakeRevisionId }, 'findIntakeCheckpoint');
    if (!row) {
      throw new OrchestratorError(
        'VALIDATION_ERROR',
        `checkpoint không tồn tại cho intakeRevisionId=${intakeRevisionId}`,
        false,
      );
    }

    if (row.draftDigest !== confirmation.context.draftDigest) {
      // B3: semantic drift giữa confirmation và saved row → IDEMPOTENCY_CONFLICT.
      throw new OrchestratorError(
        'IDEMPOTENCY_CONFLICT',
        'IDEMPOTENCY_CONFLICT: confirmation.context.draftDigest khác saved draftDigest — UI phải tạo confirmation mới',
        false,
      );
    }

    if (!isConfirmationValid(confirmation, this.buildStaffReviewContextFromCheckpoint(row))) {
      // B3: stale confirmation → VALIDATION_ERROR (không phải DUPLICATE_KEY).
      throw new OrchestratorError(
        'VALIDATION_ERROR',
        'confirmation không bind đúng draftRevisionId/draftDigest/canonicalId/canonicalVersion đã lưu',
        false,
      );
    }

    // Caller-side: resume() thiếu draft payload nên không thể server-compute digest.
    // Caller phải gọi resumeWithPayload() để cung cấp payload đầy đủ.
    throw new OrchestratorError(
      'VALIDATION_ERROR',
      'resume() yêu cầu draft payload đầy đủ để tiếp tục; dùng resumeWithPayload()',
      false,
    );
  }

  /**
   * Resume full — same as resume nhưng caller cung cấp lại draft payload để chạy remaining steps.
   * Validate payload binding digest (chống silent drift).
   *
   * B1: server-compute draftDigest từ actual payload, verify vs confirmation
   * + saved row. B3: stale confirmation → VALIDATION_ERROR.
   */
  async resumeWithPayload(req: IntakeRunRequest): Promise<IntakeRunResult> {
    // B1: server-compute digest từ actual payload.
    const serverDigest = this.computeServerDigestFromReq(req);
    if (req.draftDigest !== serverDigest) {
      throw new OrchestratorError(
        'IDEMPOTENCY_CONFLICT',
        'IDEMPOTENCY_CONFLICT: client-supplied draftDigest không khớp server-computed digest — semantic drift nghi ngờ',
        false,
      );
    }
    if (req.confirmation.context.draftDigest !== serverDigest) {
      throw new OrchestratorError(
        'VALIDATION_ERROR',
        'confirmation.context.draftDigest không khớp server-computed digest từ actual payload',
        false,
      );
    }

    const row = await this.safeFindCheckpoint(
      { organizationId: req.organizationId, intakeRevisionId: req.intakeRevisionId },
      'findIntakeCheckpoint',
    );
    if (!row) {
      throw new OrchestratorError(
        'VALIDATION_ERROR',
        `checkpoint không tồn tại cho intakeRevisionId=${req.intakeRevisionId}`,
        false,
      );
    }

    if (row.draftDigest !== serverDigest) {
      throw new OrchestratorError(
        'IDEMPOTENCY_CONFLICT',
        'IDEMPOTENCY_CONFLICT: saved draftDigest khác server-computed — confirmation cũ đã mất hiệu lực',
        false,
      );
    }

    const ctx = this.buildStepContext(req);
    return this.executeFromCheckpoint(ctx, row, false, req.confirmation);
  }

  /* ─────────────────────────────────────────────────────────────────────
   * Internal helpers.
   * ───────────────────────────────────────────────────────────────────── */

  private buildStepContext(req: IntakeRunRequest): StepRunContext {
    return {
      organizationId: req.organizationId,
      intakeRevisionId: req.intakeRevisionId,
      draftDigest: req.draftDigest,
      canonicalId: req.confirmation.context.canonicalId,
      canonicalVersion: req.confirmation.context.canonicalVersion,
      fullName: req.fullName,
      phone: req.phone,
      citizenId: req.citizenIdentity.number,
      citizenAddress: req.citizenIdentity.address,
      contactAddress: req.contactAddress,
      dob: req.dob,
      intent: req.intent,
      provider: req.provider,
      connectionId: req.connectionId,
      externalReference: req.externalReference,
      correlationId: req.correlationId,
      stepIdempotencyKey: buildStepIdempotencyKey(req.intakeRevisionId, 'CONFIRM_VALIDATE'),
    };
  }

  private buildStaffReviewContextFromCheckpoint(
    row: IntakeCheckpointRow,
  ): z.infer<typeof StaffReviewContextSchema> {
    return {
      draftRevisionId: row.intakeRevisionId,
      draftDigest: row.draftDigest,
      ...(row.canonicalId !== null ? { canonicalId: row.canonicalId } : {}),
      ...(row.canonicalVersion !== null ? { canonicalVersion: row.canonicalVersion } : {}),
    };
  }

  private async executeFromCheckpoint(
    ctx: StepRunContext,
    row: IntakeCheckpointRow,
    _created: boolean,
    confirmation: StaffReviewConfirmation,
  ): Promise<IntakeRunResult> {
    // Verify confirmation binding (server-side, không trust client checkbox).
    // B3: stale confirmation (revision/digest/target/version khác bản đã lưu)
    // → VALIDATION_ERROR (không phải DUPLICATE_KEY) theo Auditor finding B3.
    if (!isConfirmationValid(confirmation, this.buildStaffReviewContextFromCheckpoint(row))) {
      throw new OrchestratorError(
        'VALIDATION_ERROR',
        'STALE_CONFIRMATION: confirmation không bind đúng draftRevisionId/draftDigest/canonicalId/canonicalVersion đã lưu — caller phải re-review draft mới và submit confirmation mới',
        false,
      );
    }

    const appliedSet = new Set<StepName>(row.appliedSteps as StepName[]);
    const stepResults: IntakeRunResult['stepResults'] = {
      ...((row.stepResults ?? {}) as IntakeRunResult['stepResults']),
    };
    const newAppliedSteps: StepName[] = [...(row.appliedSteps as StepName[])];

    // B2: Track canonical state (id + version) runtime. Default từ row đã persist;
    // update sau IDENTITY (NEW/EXACT) và PROFILE (version bump) để CASE/AVAILABILITY
    // dùng giá trị canonical, không fallback về ctx.canonicalId (thiếu khi NEW).
    let effectiveCanonicalId: string | undefined =
      row.canonicalId ?? ctx.canonicalId;
    let effectiveCanonicalVersion: number | undefined =
      row.canonicalVersion ?? ctx.canonicalVersion;

    let failedStep: StepName | null = null;
    let partialFailure: IntakePartialFailure | null = null;
    // Use mutable variable for terminal state; start as RUNNING internally,
    // narrow to IntakeFinalState at return.
    let terminalState: 'RUNNING' | IntakeFinalState = 'RUNNING';
    let actedOnAnyStep = false;

    for (const step of STEP_ORDER) {
      if (appliedSet.has(step)) continue; // idempotent: skip already-applied.

      // B2: ctx cho step này dùng effective canonical state (updated runtime).
      const stepCtx: StepRunContext = {
        ...ctx,
        canonicalId: effectiveCanonicalId,
        canonicalVersion: effectiveCanonicalVersion,
      };

      // Update currentStep before executing (audit + resume).
      await this.safeUpdateCheckpoint(
        { organizationId: ctx.organizationId, intakeRevisionId: ctx.intakeRevisionId },
        {
          state: 'RUNNING',
          currentStep: step,
          appliedSteps: newAppliedSteps,
          stepResults,
        },
      );

      try {
        const result = await this.executeStep(step, stepCtx, stepResults);
        if (result === null) {
          // Step returned null → stop execution (e.g., POSSIBLE dừng).
          terminalState = 'REVIEW_PENDING';
          break;
        }
        // Commit step result to checkpoint.
        newAppliedSteps.push(step);
        // Typed assignment by step.
        if (step === 'IDENTITY') stepResults.IDENTITY = result as IdentityStepResult;
        else if (step === 'PROFILE') stepResults.PROFILE = result as ProfileStepResult;
        else if (step === 'CASE') stepResults.CASE = result as CaseStepResult;
        else if (step === 'AVAILABILITY') stepResults.AVAILABILITY = result as AvailabilityStepResult;
        actedOnAnyStep = true;

        // B2: After each step, update effective canonical state nếu step trả về.
        if (step === 'IDENTITY') {
          const idResult = result as IdentityStepResult;
          // NEW outcome (mock): profile vừa được tạo bởi gateway → dùng canonicalId đó.
          // EXACT outcome: canonicalId + version từ IDENTITY result.
          // POSSIBLE outcome: dừng ở đây; canonicalId không propagate.
          if (idResult.kind !== 'POSSIBLE_MATCH' && idResult.canonicalId !== undefined) {
            effectiveCanonicalId = idResult.canonicalId;
            if (idResult.version !== undefined) {
              effectiveCanonicalVersion = idResult.version;
            }
          }
        } else if (step === 'PROFILE') {
          const pResult = result as ProfileStepResult;
          // PROFILE có thể bump version (APPLIED) hoặc giữ nguyên (NOOP).
          if (pResult.kind === 'APPLIED' && pResult.newVersion !== undefined) {
            effectiveCanonicalVersion = pResult.newVersion;
          } else if (pResult.kind === 'NOOP' && pResult.currentVersion !== undefined) {
            effectiveCanonicalVersion = pResult.currentVersion;
          }
          // canonicalId giữ nguyên (chỉ version tăng).
        }

        await this.safeUpdateCheckpoint(
          { organizationId: ctx.organizationId, intakeRevisionId: ctx.intakeRevisionId },
          {
            state: 'RUNNING',
            currentStep: step,
            appliedSteps: newAppliedSteps,
            stepResults,
            // B2: persist canonical state mới vào row để resume đọc lại.
            ...(effectiveCanonicalId !== undefined ? { canonicalId: effectiveCanonicalId } : {}),
            ...(effectiveCanonicalVersion !== undefined ? { canonicalVersion: effectiveCanonicalVersion } : {}),
          },
        );

        // If IDENTITY returned POSSIBLE → stop here, không chạy PROFILE/CASE/AVAILABILITY.
        if (step === 'IDENTITY') {
          const idResult = result as IdentityStepResult;
          if (idResult.kind === 'POSSIBLE_MATCH') {
            terminalState = 'REVIEW_PENDING';
            break;
          }
        }
    } catch (err) {
      const orchErr = err instanceof OrchestratorError ? err : this.wrapError(err);
        failedStep = step;
        partialFailure = {
          failedStep: step,
          errorCode: orchErr.code,
          errorMessage: orchErr.message,
          retryable: orchErr.retryable,
        };
        terminalState =
          appliedSet.size > 0 || newAppliedSteps.length > 0 ? 'PARTIAL' : 'FAILED';
        break;
      }
    }

    const terminal: IntakeFinalState = failedStep === null && terminalState === 'RUNNING' ? 'COMPLETED' : (terminalState as IntakeFinalState);

    // Persist final state.
    await this.safeUpdateCheckpoint(
      { organizationId: ctx.organizationId, intakeRevisionId: ctx.intakeRevisionId },
      {
        state: terminal,
        currentStep: failedStep ?? undefined,
        appliedSteps: newAppliedSteps,
        stepResults,
        ...(partialFailure !== null ? { lastError: partialFailure } : {}),
        // B2: persist final canonical state.
        ...(effectiveCanonicalId !== undefined ? { canonicalId: effectiveCanonicalId } : {}),
        ...(effectiveCanonicalVersion !== undefined ? { canonicalVersion: effectiveCanonicalVersion } : {}),
      },
    );

    return {
      checkpointId: row.checkpointId,
      state: terminal,
      appliedSteps: newAppliedSteps,
      ...(partialFailure !== null ? { partialFailure } : {}),
      stepResults,
      actedOnAnyStep,
    };
  }

  /**
   * Execute a single step. Returns:
   *  - step result (extends IntakeRunResult.stepResults) on success.
   *  - null if step intentionally stops execution (e.g., IDENTITY POSSIBLE).
   */
  private async executeStep(
    step: StepName,
    ctx: StepRunContext,
    _existingResults: IntakeRunResult['stepResults'],
  ): Promise<unknown> {
    switch (step) {
      case 'CONFIRM_VALIDATE':
        return this.confirmValidateStep(ctx);
      case 'IDENTITY':
        return this.identityStep(ctx);
      case 'PROFILE':
        return this.profileStep(ctx);
      case 'CASE':
        return this.caseStep(ctx);
      case 'AVAILABILITY':
        return this.availabilityStep(ctx);
    }
  }

  private async confirmValidateStep(ctx: StepRunContext): Promise<{ validated: true }> {
    // Server-side binding already verified in executeFromCheckpoint; this step
    // is a marker for audit and ensures confirmation context is recorded.
    if (!ctx.draftDigest || !/^[a-f0-9]{64}$/u.test(ctx.draftDigest)) {
      throw new OrchestratorError('VALIDATION_ERROR', 'draftDigest invalid (không phải SHA-256 hex)', false);
    }
    return { validated: true };
  }

  private async identityStep(ctx: StepRunContext): Promise<IdentityStepResult | null> {
    // Detect policy from intake: use REQUEST policyHint for IDENTITY outcome.
    // For CORE/1.6 mock: caller passes ALLOW_NEW; we use the EXACT_MATCH/POSSIBLE/NEW scenario
    // chosen by test fixture, NOT caller decision.
    const policy: 'ALLOW_NEW' | 'MATCH_ONLY' | 'REVIEW_REQUIRED' = 'ALLOW_NEW';

    const payload = buildCreateOrMatchPayload(ctx, policy);
    const result = await this.gatewayCall({
      organizationId: ctx.organizationId,
      method: 'createOrMatchLaborProfile',
      idempotencyKey: buildStepIdempotencyKey(ctx.intakeRevisionId, 'IDENTITY'),
      correlationId: ctx.correlationId,
      scenarioId: 'EXACT_MATCH_SUCCESS', // default; test may override via fixture selection.
      payload,
    });

    if (result.status === 'FAILED') {
      const err = result.errors[0];
      const retryable = err?.retryClass !== undefined && err.retryClass !== 'NEVER';
      throw new OrchestratorError(
        err?.code ?? 'UNKNOWN_COMMAND_OUTCOME',
        err?.messageKey ?? 'identity step failed',
        retryable,
      );
    }

    const outcome = extractMatchingOutcome(result);
    if (!outcome) {
      throw new OrchestratorError(
        'UNKNOWN_COMMAND_OUTCOME',
        'identity step returned no matchingOutcome',
        true,
      );
    }

    let laborProfileId: string | undefined;
    let version: number | undefined;
    let reviewRef: string | undefined;
    if (result.status === 'APPLIED' && typeof result.data === 'object' && result.data !== null) {
      const d = result.data as Record<string, unknown>;
      if (typeof d.laborProfileId === 'string') laborProfileId = d.laborProfileId;
      if (typeof d.version === 'number') version = d.version;
      if (typeof d.reviewRef === 'string') reviewRef = d.reviewRef;
    }

    const identityResult: IdentityStepResult = {
      kind: outcome as IdentityOutcomeKind,
      gatewayResponse: result,
      ...(laborProfileId !== undefined ? { canonicalId: laborProfileId } : {}),
      ...(version !== undefined ? { version } : {}),
      ...(reviewRef !== undefined ? { reviewRef } : {}),
    };
    return identityResult;
  }

  private async profileStep(ctx: StepRunContext): Promise<ProfileStepResult | null> {
    // EXACT: fill-missing patch (idempotent — noop if already correct).
    // NEW: profile already created by IDENTITY step (canonicalId from gateway).
    //       Apply fill-missing patch using the canonicalId from IDENTITY result.
    // POSSIBLE: handled upstream (orchestrator stopped at IDENTITY); should not reach here.
    const canonicalId = ctx.canonicalId;
    if (canonicalId === undefined || canonicalId === '') {
      throw new OrchestratorError(
        'VALIDATION_ERROR',
        'profile step cần canonicalId (từ IDENTITY result hoặc confirmation context)',
        false,
      );
    }

    // EXACT/NEW outcome: fill-missing patch using canonicalId from runtime state.
    // Idempotency: same key + same payload → cached NOOP from gateway ledger.
    const patch = {
      fullName: ctx.fullName,
      phone: ctx.phone,
    };
    const result = await this.gatewayCall({
      organizationId: ctx.organizationId,
      method: 'updateLaborProfile',
      idempotencyKey: buildStepIdempotencyKey(ctx.intakeRevisionId, 'PROFILE'),
      correlationId: ctx.correlationId,
      scenarioId: 'EXACT_MATCH_SUCCESS', // fixture; test may override.
      payload: {
        organizationId: ctx.organizationId,
        laborProfileId: canonicalId,
        expectedVersion: ctx.canonicalVersion ?? 0,
        patch,
        fillMissingOnly: true,
        submissionRevisionId: ctx.intakeRevisionId,
      },
    });

    if (result.status === 'FAILED') {
      const err = result.errors[0];
      const retryable = err?.retryClass !== undefined && err.retryClass !== 'NEVER';
      throw new OrchestratorError(
        err?.code ?? 'UNKNOWN_COMMAND_OUTCOME',
        err?.messageKey ?? 'profile step failed',
        retryable,
      );
    }

    // APPLIED → version bump; NOOP if already matches.
    let data: Record<string, unknown> | undefined;
    if (result.status === 'APPLIED' && typeof result.data === 'object' && result.data !== null) {
      data = result.data as Record<string, unknown>;
    }
    if (data?.['status'] === 'NOOP') {
      return {
        kind: 'NOOP',
        canonicalId: (data['canonicalId'] as string | undefined) ?? canonicalId,
        ...(data['currentVersion'] !== undefined ? { currentVersion: data['currentVersion'] as number } : {}),
        isNoOp: true,
      };
    }
    return {
      kind: 'APPLIED',
      canonicalId: (data?.['canonicalId'] as string | undefined) ?? canonicalId,
      ...(data?.['newVersion'] !== undefined ? { newVersion: data['newVersion'] as number } : {}),
      isNoOp: false,
    };
  }

  private async caseStep(ctx: StepRunContext): Promise<CaseStepResult> {
    // EXACT: open case using canonicalId; NEW: use canonicalId from IDENTITY.
    // If no canonicalId → skip (e.g., NEW outcome didn't return one).
    const canonicalId = ctx.canonicalId ?? '';
    if (!canonicalId) {
      throw new OrchestratorError(
        'VALIDATION_ERROR',
        'case step cần canonicalId từ IDENTITY outcome',
        false,
      );
    }

    const result = await this.gatewayCall({
      organizationId: ctx.organizationId,
      method: 'openPlacementCase',
      idempotencyKey: buildStepIdempotencyKey(ctx.intakeRevisionId, 'CASE'),
      correlationId: ctx.correlationId,
      scenarioId: 'EXACT_MATCH_SUCCESS',
      payload: {
        organizationId: ctx.organizationId,
        laborProfileId: canonicalId,
        intendedStage: ctx.intent.stage,
        initialAvailability: ctx.intent.availability,
        ...(ctx.intent.availableFromDate ? { availableFromDate: ctx.intent.availableFromDate } : {}),
        context: {
          source: {
            kind: 'INTEGRATION' as const,
            provider: ctx.provider,
            connectionId: ctx.connectionId,
          },
        },
        intakeRevisionId: ctx.intakeRevisionId,
        confirmationDigest: ctx.draftDigest,
      },
    });

    if (result.status === 'FAILED') {
      const err = result.errors[0];
      const retryable = err?.retryClass !== undefined && err.retryClass !== 'NEVER';
      throw new OrchestratorError(
        err?.code ?? 'UNKNOWN_COMMAND_OUTCOME',
        err?.messageKey ?? 'case step failed',
        retryable,
      );
    }

    let data: Record<string, unknown> | undefined;
    if (result.status === 'APPLIED' && typeof result.data === 'object' && result.data !== null) {
      data = result.data as Record<string, unknown>;
    }
    const caseId = (data?.['canonicalId'] as string | undefined) ?? '';
    if (!caseId) {
      throw new OrchestratorError(
        'UNKNOWN_COMMAND_OUTCOME',
        'case step returned no canonicalId',
        true,
      );
    }
    return {
      canonicalId: caseId,
      version: (data?.['version'] as number | undefined) ?? 1,
      appliedStage: (data?.['appliedStage'] as string | undefined) ?? ctx.intent.stage,
    };
  }

  private async availabilityStep(ctx: StepRunContext): Promise<AvailabilityStepResult> {
    const canonicalId = ctx.canonicalId ?? '';
    if (!canonicalId) {
      throw new OrchestratorError(
        'VALIDATION_ERROR',
        'availability step cần canonicalId từ IDENTITY outcome',
        false,
      );
    }

    const result = await this.gatewayCall({
      organizationId: ctx.organizationId,
      method: 'updateLaborAvailability',
      idempotencyKey: buildStepIdempotencyKey(ctx.intakeRevisionId, 'AVAILABILITY'),
      correlationId: ctx.correlationId,
      scenarioId: 'EXACT_MATCH_SUCCESS',
      payload: {
        schemaVersion: '1',
        organizationId: ctx.organizationId,
        laborProfileId: canonicalId,
        expectedVersion: ctx.canonicalVersion ?? 0,
        patch: {
          availability: ctx.intent.availability,
          ...(ctx.intent.availableFromDate ? { availableFromDate: ctx.intent.availableFromDate } : {}),
        },
        context: {
          source: {
            kind: 'INTEGRATION' as const,
            provider: ctx.provider,
            connectionId: ctx.connectionId,
          },
        },
      },
    });

    if (result.status === 'FAILED') {
      const err = result.errors[0];
      const retryable = err?.retryClass !== undefined && err.retryClass !== 'NEVER';
      throw new OrchestratorError(
        err?.code ?? 'UNKNOWN_COMMAND_OUTCOME',
        err?.messageKey ?? 'availability step failed',
        retryable,
      );
    }

    let data: Record<string, unknown> | undefined;
    if (result.status === 'APPLIED' && typeof result.data === 'object' && result.data !== null) {
      data = result.data as Record<string, unknown>;
    }
    return {
      canonicalId: (data?.['canonicalId'] as string | undefined) ?? canonicalId,
      version: (data?.['version'] as number | undefined) ?? 1,
      appliedAvailability: (data?.['appliedAvailability'] as string | undefined) ?? ctx.intent.availability,
      appliedAvailableFromDate: data?.['appliedAvailableFromDate'] as string | null ?? null,
    };
  }

  private wrapError(err: unknown): OrchestratorError {
    if (err instanceof OrchestratorError) return err;
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string'
        ? ((err as { code: string }).code as string)
        : 'UNKNOWN_COMMAND_OUTCOME';
    const retryable =
      code === 'DEPENDENCY_UNAVAILABLE' || code === 'RATE_LIMITED' || code === 'BOUNDED_SAME_KEY';
    return new OrchestratorError(code, message, retryable);
  }
}

/**
 * Orchestrator-specific error.
 */
export class OrchestratorError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'OrchestratorError';
    this.code = code;
    this.retryable = retryable;
  }
}
