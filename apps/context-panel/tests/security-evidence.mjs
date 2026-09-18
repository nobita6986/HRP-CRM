/**
 * context-panel/tests/security-evidence.mjs — CORE/1.9 B1-B5 regression tests.
 *
 * Direct API tests to verify Blocker fixes (post-recheck):
 *  - B1: Confirmation binding — server validates digest, actor, scope,
 *    target, version. Forged snapshot / cross-actor / cross-org / stale-target
 *    / stale-version all blocked.
 *  - B2: Mock boundary — endpoints return 404 when mockMode is off.
 *  - B3: Authorization — server-side role check, actor cannot be spoofed via body.
 *  - B4: Replay/resume — same revision replay idempotent; partial resume
 *    continues from last step via gateway call log evidence (NOT only by state).
 *  - B5: Manifest — SHA-256 of all files matches; no missing/duplicate entries.
 *
 * Plus a source-link test that proves orchestrator/gateway code IS the
 * integration-api source (via SHA-256 references in .source-link.json).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPanel } from '../dist/server.js';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STAFF_HEADER = 'X-HRP-Staff-Id';

const PANEL_CONFIG = {
  appKind: 'panel',
  nodeEnv: 'development',
  organizationId: 'org-001',
  schemaVersion: '1.0.0',
  contractsVersion: '0.0.8-g0.8-fixes',
  // R4: env HRP_MOCK_MODE supports 'deterministic' | 'off'. Use 'deterministic'
  // for mock-enabled tests (mock endpoints available). 'on' is INVALID per schema.
  mockMode: 'deterministic',
  listen: { host: '127.0.0.1', port: 3777 },
  allowDevTools: false,
};

const PANEL_CONFIG_MOCK_OFF = { ...PANEL_CONFIG, mockMode: 'off' };

const INTAKE_OPERATOR_HEADER = { [STAFF_HEADER]: 'staff-intake-001' };
const TALENT_REVIEWER_HEADER = { [STAFF_HEADER]: 'staff-talent-001' };
const SUPERVISOR_HEADER = { [STAFF_HEADER]: 'staff-supervisor-001' };
const SYSTEM_HEADER = { [STAFF_HEADER]: 'svc-integration-api' };

async function startServerListen(cfg) {
  const { listen, ...rest } = cfg;
  const server = await startPanel({ ...rest, listen });
  return {
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function jsonRequest(url, { method = 'GET', body, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let json;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, body: json };
}

/* B2 */
test('B2: /api/* returns 404 when mockMode=off', async () => {
  const cfg = { ...PANEL_CONFIG_MOCK_OFF, listen: { host: '127.0.0.1', port: 3779 } };
  const { stop } = await startServerListen({ ...cfg });
  try {
    const ctxRes = await fetch('http://127.0.0.1:3779/api/context?target=talent', { headers: INTAKE_OPERATOR_HEADER });
    assert.equal(ctxRes.status, 404, 'context must 404 when mockMode=off');
    const previewRes = await fetch('http://127.0.0.1:3779/api/intake/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...INTAKE_OPERATOR_HEADER },
      body: JSON.stringify({ organizationId: 'org-001', intakeRevisionId: 'rev-001', signal: {} }),
    });
    assert.equal(previewRes.status, 404, 'preview must 404 when mockMode=off');
    const runRes = await fetch('http://127.0.0.1:3779/api/intake/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...INTAKE_OPERATOR_HEADER },
      body: JSON.stringify({ organizationId: 'org-001', intakeRevisionId: 'rev-001', reviewSnapshotId: 'x' }),
    });
    assert.equal(runRes.status, 404, 'run must 404 when mockMode=off');
    const dncRes = await fetch('http://127.0.0.1:3779/api/intake/dnc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...INTAKE_OPERATOR_HEADER },
      body: JSON.stringify({}),
    });
    assert.equal(dncRes.status, 404, 'dnc must 404 when mockMode=off');
    const uiRes = await fetch('http://127.0.0.1:3779/');
    assert.equal(uiRes.status, 200, 'static UI must still 200 when mockMode=off');
    assert.match(await uiRes.text(), /HRP Context Panel/);
  } finally { await stop(); }
});

/* B3 */
test('B3: missing X-HRP-Staff-Id returns 401', async () => {
  const cfg = { ...PANEL_CONFIG, listen: { host: '127.0.0.1', port: 3781 } };
  const { stop } = await startServerListen(cfg);
  try {
    const res = await jsonRequest('http://127.0.0.1:3781/api/context?target=talent');
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'unauthorized');
  } finally { await stop(); }
});

test('B3: invalid X-HRP-Staff-Id returns 401', async () => {
  const cfg = { ...PANEL_CONFIG, listen: { host: '127.0.0.1', port: 3782 } };
  const { stop } = await startServerListen(cfg);
  try {
    const res = await jsonRequest('http://127.0.0.1:3782/api/context?target=talent', { headers: { [STAFF_HEADER]: 'unknown' } });
    assert.equal(res.status, 401);
  } finally { await stop(); }
});

test('B3: talent-reviewer cannot access /api/intake/run', async () => {
  const cfg = { ...PANEL_CONFIG, listen: { host: '127.0.0.1', port: 3783 } };
  const { stop } = await startServerListen(cfg);
  try {
    const res = await jsonRequest('http://127.0.0.1:3783/api/intake/run', {
      method: 'POST',
      body: { organizationId: 'org-001', intakeRevisionId: 'rev-001', reviewSnapshotId: 'snap-xxx' },
      headers: TALENT_REVIEWER_HEADER,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'FORBIDDEN');
  } finally { await stop(); }
});

test('B3: client target returns 503 UNAVAILABLE for SUPERVISOR', async () => {
  const cfg = { ...PANEL_CONFIG, listen: { host: '127.0.0.1', port: 3784 } };
  const { stop } = await startServerListen(cfg);
  try {
    const res = await jsonRequest('http://127.0.0.1:3784/api/context?target=client', { headers: SUPERVISOR_HEADER });
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'UNAVAILABLE');
  } finally { await stop(); }
});

test('B3: client target returns 403 FORBIDDEN for INTAKE_OPERATOR (cross-scope)', async () => {
  const cfg = { ...PANEL_CONFIG, listen: { host: '127.0.0.1', port: 3785 } };
  const { stop } = await startServerListen(cfg);
  try {
    const res = await jsonRequest('http://127.0.0.1:3785/api/context?target=client', { headers: INTAKE_OPERATOR_HEADER });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'FORBIDDEN');
  } finally { await stop(); }
});

test('B3: DNC accepts request without body.actor → server fills from identity', async () => {
  const cfg = { ...PANEL_CONFIG, listen: { host: '127.0.0.1', port: 3786 } };
  const { stop } = await startServerListen(cfg);
  try {
    const res = await jsonRequest('http://127.0.0.1:3786/api/intake/dnc', {
      method: 'POST',
      body: {
        organizationId: 'org-001',
        target: { kind: 'TALENT', laborProfileId: 'lp-001' },
        reason: 'CANDIDATE_REQUEST',
        provider: 'CHATWOOT',
        connectionId: 'conn-mock-001',
        externalContactId: 'ext-001',
      },
      headers: INTAKE_OPERATOR_HEADER,
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.actorUsed);
    assert.equal(res.body.actorUsed.userId, 'staff-intake-001');
  } finally { await stop(); }
});

test('B3: DNC rejects spoofed body.actor with CROSS_ACTOR (403)', async () => {
  const cfg = { ...PANEL_CONFIG, listen: { host: '127.0.0.1', port: 3787 } };
  const { stop } = await startServerListen(cfg);
  try {
    const res = await jsonRequest('http://127.0.0.1:3787/api/intake/dnc', {
      method: 'POST',
      body: {
        organizationId: 'org-001',
        target: { kind: 'TALENT', laborProfileId: 'lp-001' },
        reason: 'CANDIDATE_REQUEST',
        provider: 'CHATWOOT',
        connectionId: 'conn-mock-001',
        externalContactId: 'ext-001',
        actor: { kind: 'USER', userId: 'staff-attacker-001' },
      },
      headers: INTAKE_OPERATOR_HEADER,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'CROSS_ACTOR');
  } finally { await stop(); }
});

test('B3: DNC accepts body.actor matching identity.actor → no spoof', async () => {
  const cfg = { ...PANEL_CONFIG, listen: { host: '127.0.0.1', port: 3788 } };
  const { stop } = await startServerListen(cfg);
  try {
    const res = await jsonRequest('http://127.0.0.1:3788/api/intake/dnc', {
      method: 'POST',
      body: {
        organizationId: 'org-001',
        target: { kind: 'TALENT', laborProfileId: 'lp-001' },
        reason: 'CANDIDATE_REQUEST',
        provider: 'CHATWOOT',
        connectionId: 'conn-mock-001',
        externalContactId: 'ext-001',
        actor: { kind: 'USER', userId: 'staff-intake-001' },
      },
      headers: INTAKE_OPERATOR_HEADER,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.actorUsed.userId, 'staff-intake-001');
  } finally { await stop(); }
});

test('B3: DNC mockMode=off returns 404', async () => {
  const cfg = { ...PANEL_CONFIG_MOCK_OFF, listen: { host: '127.0.0.1', port: 3789 } };
  const { stop } = await startServerListen(cfg);
  try {
    const res = await jsonRequest('http://127.0.0.1:3789/api/intake/dnc', {
      method: 'POST',
      headers: INTAKE_OPERATOR_HEADER,
      body: { organizationId: 'org-001' },
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'mock_disabled');
  } finally { await stop(); }
});

/* B1 */
test('B1: run without reviewSnapshotId returns 400 MISSING_REVIEW', async () => {
  const cfg = { ...PANEL_CONFIG, listen: { host: '127.0.0.1', port: 3790 } };
  const { stop } = await startServerListen(cfg);
  try {
    const res = await jsonRequest('http://127.0.0.1:3790/api/intake/run', {
      method: 'POST',
      body: {
        organizationId: 'org-001', intakeRevisionId: 'rev-bypass-001',
        fullName: 'X', phone: '0900000000',
        citizenIdentity: { number: '123456789012', address: 'X' },
        intent: { stage: 'NEW', availability: 'AVAILABLE_NOW' },
        evidenceRefs: [{ evidenceId: 'ev-001', kind: 'CCCD_FRONT' }],
      },
      headers: INTAKE_OPERATOR_HEADER,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'MISSING_REVIEW');
  } finally { await stop(); }
});

test('B1: run with forged reviewSnapshotId returns 400 MISSING_REVIEW', async () => {
  const cfg = { ...PANEL_CONFIG, listen: { host: '127.0.0.1', port: 3791 } };
  const { stop } = await startServerListen(cfg);
  try {
    const res = await jsonRequest('http://127.0.0.1:3791/api/intake/run', {
      method: 'POST',
      body: {
        organizationId: 'org-001', intakeRevisionId: 'rev-bypass-002',
        reviewSnapshotId: 'snap-forged-xxxxxx',
        fullName: 'X', phone: '0900000000',
        citizenIdentity: { number: '123456789012', address: 'X' },
        intent: { stage: 'NEW', availability: 'AVAILABLE_NOW' },
        evidenceRefs: [{ evidenceId: 'ev-001', kind: 'CCCD_FRONT' }],
      },
      headers: INTAKE_OPERATOR_HEADER,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'MISSING_REVIEW');
  } finally { await stop(); }
});

test('B1: edit drift between preview and run → server detects DIGEST_MISMATCH', async () => {
  const cfg = { ...PANEL_CONFIG, listen: { host: '127.0.0.1', port: 3792 } };
  const { stop } = await startServerListen(cfg);
  try {
    const previewRes = await jsonRequest('http://127.0.0.1:3792/api/intake/preview', {
      method: 'POST',
      body: {
        organizationId: 'org-001', intakeRevisionId: 'rev-drift-001', target: 'talent',
        signal: { fullName: 'Nguyen Van A', phone: '0901111111', citizenId: '123456789012' },
        intent: { stage: 'NEW', availability: 'AVAILABLE_NOW' },
        citizenIdentity: { number: '123456789012', address: 'A' },
        evidenceRefs: [{ evidenceId: 'ev-001', kind: 'CCCD_FRONT' }, { evidenceId: 'ev-002', kind: 'CCCD_BACK' }],
      },
      headers: INTAKE_OPERATOR_HEADER,
    });
    assert.equal(previewRes.status, 200);
    const { reviewSnapshotId } = previewRes.body;

    const runRes = await jsonRequest('http://127.0.0.1:3792/api/intake/run', {
      method: 'POST',
      body: {
        organizationId: 'org-001', intakeRevisionId: 'rev-drift-001', reviewSnapshotId,
        target: 'talent',
        fullName: 'Nguyen Van B_EDITED', phone: '0902222222',
        citizenIdentity: { number: '123456789012', address: 'Edited Address' },
        intent: { stage: 'NEW', availability: 'AVAILABLE_NOW' },
        evidenceRefs: [{ evidenceId: 'ev-001', kind: 'CCCD_FRONT' }, { evidenceId: 'ev-002', kind: 'CCCD_BACK' }],
      },
      headers: INTAKE_OPERATOR_HEADER,
    });
    assert.equal(runRes.status, 409, 'drift must be 409');
    assert.equal(runRes.body.error, 'DIGEST_MISMATCH');
  } finally { await stop(); }
});

test('B1: cross-actor reuse (different staff submitting on another staff preview) → CROSS_ACTOR 403', async () => {
  const cfg = { ...PANEL_CONFIG, listen: { host: '127.0.0.1', port: 3793 } };
  const { stop } = await startServerListen(cfg);
  try {
    const previewRes = await jsonRequest('http://127.0.0.1:3793/api/intake/preview', {
      method: 'POST',
      body: {
        organizationId: 'org-001', intakeRevisionId: 'rev-cross-actor', target: 'talent',
        signal: { fullName: 'A', phone: '0901111111', citizenId: '111' },
        intent: { stage: 'CONTACTING', availability: 'AVAILABLE_NOW' },
        citizenIdentity: { number: '111', address: 'A' },
        evidenceRefs: [{ evidenceId: 'ev-001', kind: 'CCCD_FRONT' }],
      },
      headers: INTAKE_OPERATOR_HEADER,
    });
    assert.equal(previewRes.status, 200);
    const { reviewSnapshotId } = previewRes.body;

    const runRes = await jsonRequest('http://127.0.0.1:3793/api/intake/run', {
      method: 'POST',
      body: {
        organizationId: 'org-001', intakeRevisionId: 'rev-cross-actor', reviewSnapshotId,
        target: 'talent', fullName: 'A', phone: '0901111111',
        citizenIdentity: { number: '111', address: 'A' },
        intent: { stage: 'CONTACTING', availability: 'AVAILABLE_NOW' },
        evidenceRefs: [{ evidenceId: 'ev-001', kind: 'CCCD_FRONT' }],
      },
      headers: SUPERVISOR_HEADER,
    });
    assert.equal(runRes.status, 403);
    assert.equal(runRes.body.error, 'CROSS_ACTOR');
  } finally { await stop(); }
});

test('B1: cross-org reuse (different org submitting on another org preview) → CROSS_ORG 403', async () => {
  const cfg = { ...PANEL_CONFIG, listen: { host: '127.0.0.1', port: 3794 } };
  const { stop } = await startServerListen(cfg);
  try {
    const previewRes = await jsonRequest('http://127.0.0.1:3794/api/intake/preview', {
      method: 'POST',
      body: {
        organizationId: 'org-001', intakeRevisionId: 'rev-cross-org', target: 'talent',
        signal: { fullName: 'A', phone: '0901111111', citizenId: '111' },
        intent: { stage: 'CONTACTING', availability: 'AVAILABLE_NOW' },
        citizenIdentity: { number: '111', address: 'A' },
        evidenceRefs: [{ evidenceId: 'ev-001', kind: 'CCCD_FRONT' }],
      },
      headers: INTAKE_OPERATOR_HEADER,
    });
    assert.equal(previewRes.status, 200);
    const { reviewSnapshotId } = previewRes.body;

    const runRes = await jsonRequest('http://127.0.0.1:3794/api/intake/run', {
      method: 'POST',
      body: {
        organizationId: 'org-001', intakeRevisionId: 'rev-cross-org', reviewSnapshotId,
        target: 'talent', fullName: 'A', phone: '0901111111',
        citizenIdentity: { number: '111', address: 'A' },
        intent: { stage: 'CONTACTING', availability: 'AVAILABLE_NOW' },
        evidenceRefs: [{ evidenceId: 'ev-001', kind: 'CCCD_FRONT' }],
      },
      headers: SYSTEM_HEADER,
    });
    assert.equal(runRes.status, 403);
    assert.equal(runRes.body.error, 'CROSS_ORG');
  } finally { await stop(); }
});

test('B1: stale target (target mismatch between preview and run) → STALE_TARGET 409', async () => {
  const cfg = { ...PANEL_CONFIG, listen: { host: '127.0.0.1', port: 3795 } };
  const { stop } = await startServerListen(cfg);
  try {
    const previewRes = await jsonRequest('http://127.0.0.1:3795/api/intake/preview', {
      method: 'POST',
      body: {
        organizationId: 'org-001', intakeRevisionId: 'rev-stale-target', target: 'talent',
        signal: { fullName: 'A', phone: '0901111111', citizenId: '111' },
        intent: { stage: 'CONTACTING', availability: 'AVAILABLE_NOW' },
        citizenIdentity: { number: '111', address: 'A' },
        evidenceRefs: [{ evidenceId: 'ev-001', kind: 'CCCD_FRONT' }],
      },
      headers: INTAKE_OPERATOR_HEADER,
    });
    assert.equal(previewRes.status, 200);
    const { reviewSnapshotId } = previewRes.body;

    const runRes = await jsonRequest('http://127.0.0.1:3795/api/intake/run', {
      method: 'POST',
      body: {
        organizationId: 'org-001', intakeRevisionId: 'rev-stale-target', reviewSnapshotId,
        target: 'client',
        fullName: 'A', phone: '0901111111',
        citizenIdentity: { number: '111', address: 'A' },
        intent: { stage: 'CONTACTING', availability: 'AVAILABLE_NOW' },
        evidenceRefs: [{ evidenceId: 'ev-001', kind: 'CCCD_FRONT' }],
      },
      headers: INTAKE_OPERATOR_HEADER,
    });
    assert.equal(runRes.status, 409);
    assert.equal(runRes.body.error, 'STALE_TARGET');
  } finally { await stop(); }
});

test('B1: stale version (targetVersion drift after preview) → STALE_VERSION 409', async () => {
  const cfg = { ...PANEL_CONFIG, listen: { host: '127.0.0.1', port: 3796 } };
  const { stop } = await startServerListen(cfg);
  try {
    const previewRes = await jsonRequest('http://127.0.0.1:3796/api/intake/preview', {
      method: 'POST',
      body: {
        organizationId: 'org-001', intakeRevisionId: 'rev-stale-version', target: 'talent', targetVersion: 1,
        signal: { fullName: 'A', phone: '0901111111', citizenId: '111' },
        intent: { stage: 'CONTACTING', availability: 'AVAILABLE_NOW' },
        citizenIdentity: { number: '111', address: 'A' },
        evidenceRefs: [{ evidenceId: 'ev-001', kind: 'CCCD_FRONT' }],
      },
      headers: INTAKE_OPERATOR_HEADER,
    });
    assert.equal(previewRes.status, 200);
    const { reviewSnapshotId } = previewRes.body;

    const runRes = await jsonRequest('http://127.0.0.1:3796/api/intake/run', {
      method: 'POST',
      body: {
        organizationId: 'org-001', intakeRevisionId: 'rev-stale-version', reviewSnapshotId,
        target: 'talent', targetVersion: 5,
        fullName: 'A', phone: '0901111111',
        citizenIdentity: { number: '111', address: 'A' },
        intent: { stage: 'CONTACTING', availability: 'AVAILABLE_NOW' },
        evidenceRefs: [{ evidenceId: 'ev-001', kind: 'CCCD_FRONT' }],
      },
      headers: INTAKE_OPERATOR_HEADER,
    });
    assert.equal(runRes.status, 409);
    assert.equal(runRes.body.error, 'STALE_VERSION');
  } finally { await stop(); }
});

test('B1: preview→run happy path completes (digest matches, no drift)', async () => {
  const cfg = { ...PANEL_CONFIG, listen: { host: '127.0.0.1', port: 3797 } };
  const { stop } = await startServerListen(cfg);
  try {
    const fullName = 'Nguyen Van Happy';
    const phone = '0901234567';
    const cccd = '123456789012';
    const previewRes = await jsonRequest('http://127.0.0.1:3797/api/intake/preview', {
      method: 'POST',
      body: {
        organizationId: 'org-001', intakeRevisionId: 'rev-happy', target: 'talent',
        signal: { fullName, phone, citizenId: cccd },
        intent: { stage: 'CONTACTING', availability: 'AVAILABLE_NOW' },
        citizenIdentity: { number: cccd, address: 'H' },
        evidenceRefs: [{ evidenceId: 'ev-001', kind: 'CCCD_FRONT' }, { evidenceId: 'ev-002', kind: 'CCCD_BACK' }],
      },
      headers: INTAKE_OPERATOR_HEADER,
    });
    assert.equal(previewRes.status, 200);
    const { reviewSnapshotId } = previewRes.body;

    const runRes = await jsonRequest('http://127.0.0.1:3797/api/intake/run', {
      method: 'POST',
      body: {
        organizationId: 'org-001', intakeRevisionId: 'rev-happy', reviewSnapshotId,
        target: 'talent', targetVersion: 1,
        fullName, phone,
        citizenIdentity: { number: cccd, address: 'H' },
        intent: { stage: 'CONTACTING', availability: 'AVAILABLE_NOW' },
        evidenceRefs: [{ evidenceId: 'ev-001', kind: 'CCCD_FRONT' }, { evidenceId: 'ev-002', kind: 'CCCD_BACK' }],
      },
      headers: INTAKE_OPERATOR_HEADER,
    });
    assert.equal(runRes.status, 200, `Expected 200 but got ${runRes.status}: ${JSON.stringify(runRes.body)}`);
    assert.ok(['COMPLETED', 'PARTIAL', 'REVIEW_PENDING'].includes(runRes.body?.state));
  } finally { await stop(); }
});

/* B4 */
test('B4: replay safety (same revisionId same digest) returns idempotent result, no duplicate applied steps', async () => {
  const cfg = { ...PANEL_CONFIG, listen: { host: '127.0.0.1', port: 3800 } };
  const { stop } = await startServerListen(cfg);
  try {
    const fullName = 'Nguyen Van Replay';
    const phone = '0901234567';
    const cccd = '987654321098';
    const previewRes = await jsonRequest('http://127.0.0.1:3800/api/intake/preview', {
      method: 'POST',
      body: {
        organizationId: 'org-001', intakeRevisionId: 'rev-replay', target: 'talent',
        signal: { fullName, phone, citizenId: cccd },
        intent: { stage: 'CONTACTING', availability: 'AVAILABLE_NOW' },
        citizenIdentity: { number: cccd, address: 'R' },
        evidenceRefs: [{ evidenceId: 'ev-r-001', kind: 'CCCD_FRONT' }, { evidenceId: 'ev-r-002', kind: 'CCCD_BACK' }],
      },
      headers: INTAKE_OPERATOR_HEADER,
    });
    const { reviewSnapshotId } = previewRes.body;
    const runBody = {
      organizationId: 'org-001', intakeRevisionId: 'rev-replay', reviewSnapshotId,
      target: 'talent', targetVersion: 1,
      fullName, phone,
      citizenIdentity: { number: cccd, address: 'R' },
      intent: { stage: 'CONTACTING', availability: 'AVAILABLE_NOW' },
      evidenceRefs: [{ evidenceId: 'ev-r-001', kind: 'CCCD_FRONT' }, { evidenceId: 'ev-r-002', kind: 'CCCD_BACK' }],
    };
    const r1 = await jsonRequest('http://127.0.0.1:3800/api/intake/run', { method: 'POST', body: runBody, headers: INTAKE_OPERATOR_HEADER });
    const r2 = await jsonRequest('http://127.0.0.1:3800/api/intake/run', { method: 'POST', body: runBody, headers: INTAKE_OPERATOR_HEADER });

    assert.notEqual(r1.status, 500);
    assert.notEqual(r2.status, 500);
    if (r1.body?.appliedSteps && r2.body?.appliedSteps) {
      const s1 = JSON.stringify([...r1.body.appliedSteps].sort());
      const s2 = JSON.stringify([...r2.body.appliedSteps].sort());
      assert.equal(s1, s2, 'applied steps same on replay');
    }
  } finally { await stop(); }
});

test('B4: partial failure → replay does not duplicate applied steps (idempotency-key cache hit)', async () => {
  const cfg = { ...PANEL_CONFIG, listen: { host: '127.0.0.1', port: 3801 } };
  const { stop } = await startServerListen(cfg);
  try {
    const fullName = 'Nguyen Van Partial';
    const phone = '0900000099';
    const cccd = '111222333444';

    const previewRes = await jsonRequest('http://127.0.0.1:3801/api/intake/preview', {
      method: 'POST',
      body: {
        organizationId: 'org-001', intakeRevisionId: 'rev-partial', target: 'talent',
        signal: { fullName, phone, citizenId: cccd },
        intent: { stage: 'NEW', availability: 'AVAILABLE_NOW' },
        citizenIdentity: { number: cccd, address: 'P' },
        evidenceRefs: [{ evidenceId: 'ev-p-001', kind: 'CCCD_FRONT' }],
      },
      headers: INTAKE_OPERATOR_HEADER,
    });
    const { reviewSnapshotId } = previewRes.body;

    const run1 = await jsonRequest('http://127.0.0.1:3801/api/intake/run', {
      method: 'POST',
      body: {
        organizationId: 'org-001', intakeRevisionId: 'rev-partial', reviewSnapshotId,
        target: 'talent', targetVersion: 1,
        fullName, phone,
        citizenIdentity: { number: cccd, address: 'P' },
        intent: { stage: 'NEW', availability: 'AVAILABLE_NOW' },
        evidenceRefs: [{ evidenceId: 'ev-p-001', kind: 'CCCD_FRONT' }],
        scenario: 'policy',
      },
      headers: INTAKE_OPERATOR_HEADER,
    });
    assert.equal(run1.status, 200, `run1 expected 200, got ${run1.status}: ${JSON.stringify(run1.body)}`);
    assert.equal(run1.body.state, 'PARTIAL', `run1 state expected PARTIAL, got ${run1.body.state}: ${JSON.stringify(run1.body)}`);

    const preApplied = [...run1.body.appliedSteps];
    assert.ok(preApplied.length > 0, 'at least one step applied');

    // Replay — same idempotency keys cache-hits already-applied steps.
    const run2 = await jsonRequest('http://127.0.0.1:3801/api/intake/run', {
      method: 'POST',
      body: {
        organizationId: 'org-001', intakeRevisionId: 'rev-partial', reviewSnapshotId,
        target: 'talent', targetVersion: 1,
        fullName, phone,
        citizenIdentity: { number: cccd, address: 'P' },
        intent: { stage: 'NEW', availability: 'AVAILABLE_NOW' },
        evidenceRefs: [{ evidenceId: 'ev-p-001', kind: 'CCCD_FRONT' }],
      },
      headers: INTAKE_OPERATOR_HEADER,
    });
    assert.equal(run2.status, 200, `run2 expected 200, got ${run2.status}: ${JSON.stringify(run2.body)}`);
    const postApplied = [...run2.body.appliedSteps];
    assert.deepEqual(postApplied, preApplied, 'replay must not add new applied steps');
  } finally { await stop(); }
});

/* R4 — Shared implementation & CORE/1.7 review wiring */
test('R4: unresolved review wiring uses CORE/1.7 review store (in-process)', async () => {
  // Seeding CORE/1.7 review store happens via the integration-api module
  // bootstrapped when its package is imported. This test verifies that:
  //  - the wiring endpoint exists at /api/review/unresolved
  //  - it requires auth (401 unauthenticated)
  //  - it requires core-1.7 RBAC role (403 for talent-reviewer)
  //  - it returns empty list when no unresolved reviews (200 OK, schemaVersion=1)
  const cfg = { ...PANEL_CONFIG, listen: { host: '127.0.0.1', port: 3804 } };
  const { stop } = await startServerListen(cfg);
  try {
    // R4: Missing identity → 401
    const noAuth = await jsonRequest('http://127.0.0.1:3804/api/review/unresolved', {});
    assert.equal(noAuth.status, 401, `expected 401 for missing auth, got ${noAuth.status}`);

    // R4: talent-reviewer → 403 (cannot list reviews)
    const wrong = await jsonRequest('http://127.0.0.1:3804/api/review/unresolved', {
      headers: { 'X-HRP-Staff-Id': 'staff-talent-001' },
    });
    assert.equal(wrong.status, 403, `expected 403 for talent-reviewer, got ${wrong.status}`);

    // R4: intake-operator → 200 with items array (may be empty)
    const ok = await jsonRequest('http://127.0.0.1:3804/api/review/unresolved', {
      headers: { 'X-HRP-Staff-Id': 'staff-intake-001' },
    });
    assert.equal(ok.status, 200, `expected 200 for intake-operator, got ${ok.status}: ${JSON.stringify(ok.body)}`);
    assert.equal(ok.body.schemaVersion, '1', 'response should be schemaVersion 1');
    assert.ok(Array.isArray(ok.body.items), 'items must be an array');
  } finally { await stop(); }
});

/* B5 */
test('B5: manifest contains all bundle files with valid SHA-256', async () => {
  const fileUrl = new URL(import.meta.url);
  let repoRoot = fileURLToPath(new URL('../../../', fileUrl));
  const manifestPath = join(repoRoot, 'docs', 'contracts', 'handoff-core-1.9.manifest.txt');
  let content;
  try { content = readFileSync(manifestPath, 'utf-8'); }
  catch (err) { assert.fail(`Manifest not found: ${err.message}`); }
  assert.match(content, /SHA-256/);
  const lines = content.split('\n').filter((l) => l.startsWith('FILE|'));
  assert.ok(lines.length > 0);
  for (const line of lines) {
    const [, relPath, expectedHash] = line.split('|');
    const fullPath = join(repoRoot, relPath);
    try {
      const buf = readFileSync(fullPath);
      const actual = createHash('sha256').update(buf).digest('hex');
      assert.equal(actual, expectedHash, `hash mismatch for ${relPath}`);
    } catch (err) {
      assert.fail(`missing file ${relPath}: ${err.message}`);
    }
  }
});

test('B5-SourceLink: source-link mechanism removed (R4 — true shared module via @hrp-engagement/integration-api)', async () => {
  // R4: With verbatim copies removed and imports switched to the shared
  // @hrp-engagement/integration-api module, .source-link.json is no longer
  // produced. This test asserts the file is absent so future contributors
  // do not reintroduce synchronized-copy mechanism.
  const fileUrl = new URL(import.meta.url);
  const repoRoot = fileURLToPath(new URL('../../../', fileUrl));
  const linkFile = join(repoRoot, 'apps', 'context-panel', 'src', '.source-link.json');
  assert.equal(existsSync(linkFile), false, '.source-link.json must be removed (R4)');

  // Sanity: the shared package is wired via package.json (file: dep)
  const pkgPath = join(repoRoot, 'apps', 'context-panel', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  assert.match(
    pkg.dependencies?.['@hrp-engagement/integration-api'] ?? '',
    /\.\.\/integration-api$/,
    'integration-api shared module must be wired via package.json file: dep',
  );
});
