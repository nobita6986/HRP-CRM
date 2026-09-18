/**
 * apps/integration-api/tests/orchestrator.pg-e2e.test.mjs — CORE/1.6
 *
 * PG-E2E intake orchestrator tests using real PostgreSQL (embedded-postgres)
 * + mock gateway. Exercises:
 *   - Checkpoint persistence (RUNNING → COMPLETED/PARTIAL/REVIEW_PENDING)
 *   - Resume idempotency (skip applied steps, retry failed only)
 *   - Confirmation binding (stale confirmation → DUPLICATE_KEY)
 *   - EXACT/no-op, POSSIBLE/review, NEW/accept scenarios
 *   - DNC decoupled path (independent of intake)
 *
 * Note: PG state is durable across runs in this test file. Each test cleans up
 * via direct prisma intakeCheckpoint.deleteMany() to avoid interference.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import http from 'node:http';
import { start } from './pg-orchestrator-harness.mjs';
import {
  IntakeOrchestrator,
  OrchestratorError,
  executeDncAction,
  digestCanonical,
  buildCanonicalDraft,
} from '../dist/orchestrator/index.js';

const ORG_ID = '00000000-0000-0000-0000-00000000001a';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers: build canonical draft + confirmation.
// ──────────────────────────────────────────────────────────────────────────────

function makeDraft(overrides = {}) {
  return {
    fullName: 'Tran Thi E2E',
    phone: '0909999000',
    citizenIdentity: { number: '999888777666', address: 'PG Lane' },
    intent: { stage: 'NEW', availability: 'AVAILABLE_NOW' },
    evidenceRefs: [
      { evidenceId: 'ev-pg-001', kind: 'CCCD_FRONT' },
      { evidenceId: 'ev-pg-002', kind: 'CCCD_BACK' },
    ],
    ...overrides,
  };
}

function makeContextForDigest(orgId, revId, draft) {
  return {
    organizationId: orgId,
    intakeRevisionId: revId,
    ...draft,
  };
}

function makeRunRequest(orgId, revId, overrides = {}) {
  const draft = makeDraft(overrides.draftOverrides);
  // B1+B3: server-compute digest phải bao gồm canonicalId/version từ confirmation context.
  const ctx = {
    ...makeContextForDigest(orgId, revId, draft),
    canonicalId: 'lp-pg-e2e-001',
    canonicalVersion: 1,
  };
  const digest = digestCanonical(buildCanonicalDraft(ctx));
  return {
    organizationId: orgId,
    intakeRevisionId: revId,
    fullName: draft.fullName,
    phone: draft.phone,
    citizenIdentity: draft.citizenIdentity,
    contactAddress: undefined,
    dob: undefined,
    intent: draft.intent,
    evidenceRefs: draft.evidenceRefs,
    confirmation: {
      organizationId: orgId,
      context: {
        draftRevisionId: revId,
        draftDigest: digest,
        canonicalId: 'lp-pg-e2e-001',
        canonicalVersion: 1,
      },
      confirmed: true,
    },
    draftDigest: digest,
    provider: 'CHATWOOT',
    connectionId: 'conn-pg-orch',
    externalReference: 'ext-pg-orch-001',
    correlationId: `corr-pg-orch-${revId}`,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Mock gateway (HTTP server, in-memory ledger).
// ──────────────────────────────────────────────────────────────────────────────

function createMockGateway(port, scenarioMode = 'EXACT_MATCH_SUCCESS', failureMode = null) {
  const calls = [];
  const ledger = new Map(); // idempotencyKey → cached response

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const request = JSON.parse(body);
      calls.push({ method: request.method, idempotencyKey: request.idempotencyKey });

      // Idempotency cache: same key → same response.
      if (ledger.has(request.idempotencyKey)) {
        const cached = ledger.get(request.idempotencyKey);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(cached));
        return;
      }

      // Scenario-specific failure injection (for CASE step failure test).
      if (failureMode && request.method === 'openPlacementCase') {
        const errResp = {
          status: 'FAILED',
          schemaVersion: '1',
          commandId: request.commandId,
          correlationId: request.correlationId,
          errors: [{ code: failureMode.code, messageKey: failureMode.messageKey, retryClass: failureMode.retryClass }],
        };
        ledger.set(request.idempotencyKey, errResp);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(errResp));
        return;
      }

      // Default responses by method.
      let resp;
      switch (request.method) {
        case 'createOrMatchLaborProfile':
          resp = {
            status: 'APPLIED',
            schemaVersion: '1',
            commandId: request.commandId,
            correlationId: request.correlationId,
            data: {
              matchingOutcome: scenarioMode,
              laborProfileId: 'lp-pg-e2e-001',
              version: 1,
              ...(scenarioMode === 'POSSIBLE_MATCH' ? { reviewRef: 'review-pg-e2e-001' } : {}),
            },
            errors: [],
          };
          break;
        case 'updateLaborProfile':
          // B2: NOOP giữ version = 1 để confirmation binding ổn định qua resume.
          resp = {
            status: 'APPLIED',
            schemaVersion: '1',
            commandId: request.commandId,
            correlationId: request.correlationId,
            data: { status: 'NOOP', canonicalId: 'lp-pg-e2e-001', currentVersion: 1 },
            errors: [],
          };
          break;
        case 'openPlacementCase':
          resp = {
            status: 'APPLIED',
            schemaVersion: '1',
            commandId: request.commandId,
            correlationId: request.correlationId,
            data: { canonicalId: 'case-pg-e2e-001', version: 1, appliedStage: 'NEW' },
            errors: [],
          };
          break;
        case 'updateLaborAvailability':
          resp = {
            status: 'APPLIED',
            schemaVersion: '1',
            commandId: request.commandId,
            correlationId: request.correlationId,
            data: {
              canonicalId: 'lp-pg-e2e-001',
              version: 2,
              appliedAvailability: 'AVAILABLE_NOW',
              appliedAvailableFromDate: null,
            },
            errors: [],
          };
          break;
        case 'commitSuppression':
          resp = {
            status: 'APPLIED',
            schemaVersion: '1',
            commandId: request.commandId,
            correlationId: request.correlationId,
            data: { suppressionId: 'sup-pg-e2e-001', version: 1 },
            errors: [],
          };
          break;
        default:
          resp = { status: 'FAILED', schemaVersion: '1', commandId: request.commandId, correlationId: request.correlationId, errors: [] };
      }
      ledger.set(request.idempotencyKey, resp);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resp));
    });
  });
  server.listen(port, '127.0.0.1');
  return {
    server,
    calls,
    ledger,
    close() { server.close(); },
  };
}

function buildGatewayCaller(gw) {
  return async (args) => {
    return new Promise((resolve, reject) => {
      const reqBody = JSON.stringify({
        schemaVersion: '1',
        organizationId: args.organizationId,
        commandId: `cmd-${args.method}-test`,
        idempotencyKey: args.idempotencyKey,
        correlationId: args.correlationId,
        method: args.method,
        context: {
          schemaVersion: '1',
          organizationId: args.organizationId,
          tier: 'INBOUND_DEFAULT',
          correlationId: args.correlationId,
          provider: 'CHATWOOT',
          connectionId: 'conn-pg-orch',
        },
        // B4: actor từ trusted caller context truyền qua gateway call envelope.
        actor: args.actor ?? { kind: 'SERVICE', serviceId: 'svc-pg-orch-test' },
        scenarioId: args.scenarioId,
        payload: args.payload,
      });
      const data = Buffer.from(reqBody);
      const request = http.request({
        hostname: '127.0.0.1',
        port: gw.server.address().port,
        method: 'POST',
        path: '/',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
        },
      }, (response) => {
        let body = '';
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      });
      request.on('error', reject);
      request.write(data);
      request.end();
    });
  };
}

function buildPreviewCaller() {
  return {
    async resolveIdentityCandidates() {
      return { candidates: [{ candidateId: 'cand-pg-001', strength: 'STRONG' }] };
    },
  };
}

function createOrch(prisma, gw) {
  return new IntakeOrchestrator({
    prisma,
    gatewayCall: buildGatewayCaller(gw),
    identityPreview: buildPreviewCaller(),
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Test suite.
// ──────────────────────────────────────────────────────────────────────────────

describe('pg-e2e: orchestrator checkpoint persistence', { timeout: 180_000 }, () => {
  let harness;
  let mockGw;
  const GW_PORT = 35999;

  before(async () => {
    harness = await start();
    mockGw = createMockGateway(GW_PORT);
  });

  after(async () => {
    if (mockGw) mockGw.close();
    if (harness) await harness.stop();
  });

  test('checkpoint persists RUNNING then COMPLETED in PG', async () => {
    const prisma = harness.prisma;
    const revisionId = `rev-pg-complete-${Date.now()}`;
    const orch = createOrch(prisma, mockGw);
    const req = makeRunRequest(ORG_ID, revisionId);

    const result = await orch.run(req);

    assert.equal(result.state, 'COMPLETED');
    assert.ok(result.checkpointId);
    assert.ok(result.appliedSteps.includes('IDENTITY'));

    // Verify PG row directly.
    const row = await prisma.intakeCheckpoint.findUnique({
      where: {
        uq_intake_checkpoint_org_revision: {
          organizationId: ORG_ID,
          intakeRevisionId: revisionId,
        },
      },
    });
    assert.ok(row, 'checkpoint row in PG');
    assert.equal(row.state, 'COMPLETED');
    assert.equal(row.draftDigest.length, 64);
    assert.ok(row.appliedStepsJson.includes('IDENTITY'));
    assert.ok(row.appliedStepsJson.includes('PROFILE'));
    assert.ok(row.appliedStepsJson.includes('CASE'));
    assert.ok(row.appliedStepsJson.includes('AVAILABILITY'));
    assert.equal(row.canonicalId, 'lp-pg-e2e-001');
    assert.equal(row.canonicalVersion, 1);

    // Step results persisted.
    const stepResults = row.stepResultsJson;
    assert.ok(stepResults.IDENTITY, 'IDENTITY step result persisted');
    assert.ok(stepResults.PROFILE, 'PROFILE step result persisted');
    assert.ok(stepResults.CASE, 'CASE step result persisted');
    assert.ok(stepResults.AVAILABILITY, 'AVAILABILITY step result persisted');
  });

  test('POSSIBLE_MATCH scenario → REVIEW_PENDING in PG, no PROFILE/CASE/AVAILABILITY applied', async () => {
    const prisma = harness.prisma;
    const revisionId = `rev-pg-possible-${Date.now()}`;
    const possibleGw = createMockGateway(GW_PORT + 1, 'POSSIBLE_MATCH');
    try {
      const orch = createOrch(prisma, possibleGw);
      const req = makeRunRequest(ORG_ID, revisionId);

      const result = await orch.run(req);
      assert.equal(result.state, 'REVIEW_PENDING');
      assert.ok(result.appliedSteps.includes('IDENTITY'));
      assert.ok(!result.appliedSteps.includes('PROFILE'));
      assert.ok(!result.appliedSteps.includes('CASE'));
      assert.ok(!result.appliedSteps.includes('AVAILABILITY'));

      const row = await prisma.intakeCheckpoint.findUnique({
        where: {
          uq_intake_checkpoint_org_revision: {
            organizationId: ORG_ID,
            intakeRevisionId: revisionId,
          },
        },
      });
      assert.equal(row.state, 'REVIEW_PENDING');
      assert.ok(row.stepResultsJson.IDENTITY, 'IDENTITY step result saved');
      assert.equal(row.stepResultsJson.IDENTITY.reviewRef, 'review-pg-e2e-001');
    } finally {
      possibleGw.close();
    }
  });

  test('stale confirmation (different draftRevisionId) → VALIDATION_ERROR (B3)', async () => {
    const prisma = harness.prisma;
    const revisionId = `rev-pg-stale-${Date.now()}`;
    const orch = createOrch(prisma, mockGw);
    const req1 = makeRunRequest(ORG_ID, revisionId);
    await orch.run(req1);

    // Try to "re-run" with same revisionId but different draftRevisionId in confirmation context.
    // B3: stale confirmation binding → VALIDATION_ERROR (không phải DUPLICATE_KEY).
    const req2 = makeRunRequest(ORG_ID, revisionId);
    req2.confirmation.context.draftRevisionId = 'rev-pg-DIFFERENT';

    await assert.rejects(
      orch.run(req2),
      (err) => err instanceof OrchestratorError && err.code === 'VALIDATION_ERROR',
      'stale confirmation → VALIDATION_ERROR (B3)',
    );
  });

  test('CASE step fail → PARTIAL persisted in PG; resumeWithPayload completes', async () => {
    const prisma = harness.prisma;
    const revisionId = `rev-pg-partial-${Date.now()}`;
    let caseCalls = 0;
    // Custom gateway: first CASE call fails, subsequent calls succeed.
    const failGw = createMockGateway(GW_PORT + 2, 'EXACT_MATCH_SUCCESS', {
      code: 'POLICY_REJECTION',
      messageKey: 'errors.policyRejection',
      retryClass: 'NEVER',
    });
    // Override openPlacementCase to fail first call only.
    const origGw = failGw;
    failGw.server.removeAllListeners('request');
    failGw.server.on('request', (req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const request = JSON.parse(body);
        if (request.method === 'openPlacementCase') {
          caseCalls++;
          if (caseCalls === 1) {
            const errResp = {
              status: 'FAILED',
              schemaVersion: '1',
              commandId: request.commandId,
              correlationId: request.correlationId,
              errors: [{ code: 'POLICY_REJECTION', messageKey: 'errors.policyRejection', retryClass: 'NEVER' }],
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(errResp));
            return;
          }
        }
        // Delegate to default handler.
        const data = Buffer.from(body);
        const innerReq = http.request({
          hostname: '127.0.0.1',
          port: GW_PORT,
          method: 'POST',
          path: '/',
          headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
        }, (response) => {
          let rbody = '';
          response.on('data', (chunk) => (rbody += chunk));
          response.on('end', () => {
            res.writeHead(response.statusCode, { 'Content-Type': 'application/json' });
            res.end(rbody);
          });
        });
        innerReq.on('error', (e) => { res.writeHead(500); res.end(String(e)); });
        innerReq.write(data);
        innerReq.end();
      });
    });

    try {
      const orch = createOrch(prisma, failGw);
      const req = makeRunRequest(ORG_ID, revisionId);

      const first = await orch.run(req);
      assert.equal(first.state, 'PARTIAL');
      assert.equal(first.partialFailure?.failedStep, 'CASE');
      assert.equal(first.partialFailure?.errorCode, 'POLICY_REJECTION');

      // Verify PG has PARTIAL.
      const rowBefore = await prisma.intakeCheckpoint.findUnique({
        where: {
          uq_intake_checkpoint_org_revision: {
            organizationId: ORG_ID,
            intakeRevisionId: revisionId,
          },
        },
      });
      assert.equal(rowBefore.state, 'PARTIAL');
      assert.ok(rowBefore.appliedStepsJson.includes('IDENTITY'));
      assert.ok(rowBefore.appliedStepsJson.includes('PROFILE'));
      assert.ok(!rowBefore.appliedStepsJson.includes('CASE'));

      // Resume — should re-run CASE only (skip IDENTITY/PROFILE), then AVAILABILITY.
      const second = await orch.resumeWithPayload(req);
      assert.equal(second.state, 'COMPLETED');
      assert.equal(caseCalls, 2, 'CASE called twice (fail + retry success)');

      // Verify PG has COMPLETED.
      const rowAfter = await prisma.intakeCheckpoint.findUnique({
        where: {
          uq_intake_checkpoint_org_revision: {
            organizationId: ORG_ID,
            intakeRevisionId: revisionId,
          },
        },
      });
      assert.equal(rowAfter.state, 'COMPLETED');
      assert.ok(rowAfter.appliedStepsJson.includes('CASE'));
      assert.ok(rowAfter.appliedStepsJson.includes('AVAILABILITY'));
    } finally {
      failGw.close();
    }
  });

  test('idempotency: same draftDigest retry → không tạo row mới', async () => {
    const prisma = harness.prisma;
    const revisionId = `rev-pg-idem-${Date.now()}`;
    const orch = createOrch(prisma, mockGw);
    const req = makeRunRequest(ORG_ID, revisionId);

    await orch.run(req);
    const countAfterFirst = await prisma.intakeCheckpoint.count({
      where: { organizationId: ORG_ID, intakeRevisionId: revisionId },
    });

    await orch.run(req); // Same digest, same revision.
    const countAfterSecond = await prisma.intakeCheckpoint.count({
      where: { organizationId: ORG_ID, intakeRevisionId: revisionId },
    });
    assert.equal(countAfterFirst, 1);
    assert.equal(countAfterSecond, 1, 'idempotent: same digest không tạo row mới');
  });

  test('DNC handler chạy độc lập, không cần intake context', async () => {
    const prisma = harness.prisma;
    const orch = createOrch(prisma, mockGw);
    // Note: dnc-handler dùng gatewayCall riêng, không đụng checkpoint table.
    // B4: externalAccountId ở context (parse được), KHÔNG cần CCCD/full intake.
    // B4 (recheck): actor ở envelope, KHÔNG trong payload.context.
    const result = await executeDncAction(
      {
        organizationId: ORG_ID,
        provider: 'CHATWOOT',
        connectionId: 'conn-pg-orch',
        externalContactId: 'ext-pg-dnc-001',
        externalAccountId: 'ext-acct-pg-dnc-001',
        reason: 'CANDIDATE_REQUEST',
        note: 'pg-e2e test',
        idempotencyKey: 'dnc-pg-idem-001',
        correlationId: 'corr-pg-dnc-001',
        actor: { kind: 'SERVICE', serviceId: 'svc-pg-dnc' },
      },
      buildGatewayCaller(mockGw),
    );
    assert.equal(result.outcome, 'APPLIED');
    assert.ok(result.suppressionEventId, 'suppressionEventId được trả về');
    // Verify NO checkpoint was created (DNC path độc lập).
    const checkpoints = await prisma.intakeCheckpoint.count({
      where: { organizationId: ORG_ID, intakeRevisionId: { contains: 'dnc' } },
    });
    assert.equal(checkpoints, 0, 'DNC không tạo intake checkpoint');
  });
});
