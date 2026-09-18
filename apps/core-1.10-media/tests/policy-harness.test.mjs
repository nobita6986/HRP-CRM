/**
 * tests/policy-harness.test.mjs — Combined policy harness (CORE/1.10).
 *
 * Proves:
 *  - URL SSRF (string-based, no network)
 *  - Public-evidence: only READY + own-org evidence accessible; signed URL
 *    TTL ≤ 60 sec for CCCD
 *  - Cross-org: foreign organization access blocked
 *  - Evidence in QUARANTINED / REJECTED / REVOKED states CANNOT be used
 *    as READY (lifecycle gate).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  harness,
  evidenceStore,
} from '../dist/index.js';

function randomBytes(n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 31 + 7) & 0xff;
  return out;
}

function reset() {
  evidenceStore.reset();
}

test('policy-harness: SSRF URL rejected', () => {
  reset();
  const d = harness({
    url: 'https://127.0.0.1/admin',
    organizationId: 'org-001',
  });
  assert.equal(d.allow, false);
  assert.equal(d.policy, 'ssrf');
  assert.match(d.reason, /PRIVATE_HOST/u);
});

test('policy-harness: SSRF cloud metadata rejected', () => {
  reset();
  const d = harness({
    url: 'https://169.254.169.254/latest/meta-data/',
    organizationId: 'org-001',
  });
  assert.equal(d.allow, false);
  assert.equal(d.policy, 'ssrf');
});

test('policy-harness: SSRF non-https rejected', () => {
  reset();
  const d = harness({
    url: 'http://example.com/',
    organizationId: 'org-001',
  });
  assert.equal(d.allow, false);
  assert.equal(d.policy, 'ssrf');
  assert.match(d.reason, /BAD_SCHEME/u);
});

test('policy-harness: public https allowed', () => {
  reset();
  const d = harness({
    url: 'https://api.zalo.cloud/webhook',
    organizationId: 'org-001',
  });
  assert.equal(d.allow, true);
  assert.equal(d.policy, 'all_passed');
});

test('policy-harness: cross-org evidence rejected', () => {
  reset();
  const up = evidenceStore.upload({
    schemaVersion: '1',
    organizationId: 'org-001',
    kind: 'CCCD_FRONT',
    bytes: randomBytes(64),
    owner: 'staff-intake-001',
  });
  assert.equal(up.initialState, 'READY');
  const d = harness({
    organizationId: 'org-002', // different org
    evidenceId: up.evidenceId,
  });
  assert.equal(d.allow, false);
  assert.equal(d.policy, 'cross_org');
  assert.match(d.reason, /CROSS_ORG/u);
});

test('policy-harness: own-org READY evidence allowed', () => {
  reset();
  const up = evidenceStore.upload({
    schemaVersion: '1',
    organizationId: 'org-001',
    kind: 'CCCD_FRONT',
    bytes: randomBytes(64),
    owner: 'staff-intake-001',
  });
  const d = harness({
    organizationId: 'org-001',
    evidenceId: up.evidenceId,
  });
  assert.equal(d.allow, true);
  assert.equal(d.policy, 'all_passed');
});

test('policy-harness: REJECTED evidence cannot be used as READY', () => {
  reset();
  const up = evidenceStore.upload({
    schemaVersion: '1',
    organizationId: 'org-001',
    kind: 'CCCD_FRONT',
    bytes: new Uint8Array(0), // empty → REJECTED
    owner: 'staff-intake-001',
  });
  assert.equal(up.initialState, 'REJECTED');
  const d = harness({
    organizationId: 'org-001',
    evidenceId: up.evidenceId,
  });
  assert.equal(d.allow, false);
  assert.equal(d.policy, 'public_evidence');
  assert.match(d.reason, /EVIDENCE_NOT_READY: .* REJECTED/u);
});

test('policy-harness: REVOKED evidence cannot be used as READY', () => {
  reset();
  const up = evidenceStore.upload({
    schemaVersion: '1',
    organizationId: 'org-001',
    kind: 'CCCD_FRONT',
    bytes: randomBytes(64),
    owner: 'staff-intake-001',
  });
  evidenceStore.revoke(up.evidenceId, 'retention expiry');
  const d = harness({
    organizationId: 'org-001',
    evidenceId: up.evidenceId,
  });
  assert.equal(d.allow, false);
  assert.equal(d.policy, 'public_evidence');
  assert.match(d.reason, /EVIDENCE_NOT_READY: .* REVOKED/u);
});

test('policy-harness: read TTL > 60 sec rejected for CCCD', () => {
  reset();
  const d = harness({
    organizationId: 'org-001',
    read: {
      organizationId: 'org-001',
      storageHandle: 'opaque-test',
      accessor: 'staff-intake-001',
      ttlSec: 120, // > 60 → contracts Gate 0.3h rejects
    },
  });
  assert.equal(d.allow, false);
  assert.equal(d.policy, 'public_evidence');
  assert.match(d.reason, /READ_TTL_INVALID/u);
});

test('policy-harness: read TTL = 60 sec allowed for CCCD', () => {
  reset();
  const d = harness({
    organizationId: 'org-001',
    read: {
      organizationId: 'org-001',
      storageHandle: 'opaque-test',
      accessor: 'staff-intake-001',
      ttlSec: 60,
    },
  });
  assert.equal(d.allow, true);
  assert.equal(d.policy, 'all_passed');
});

test('policy-harness: missing evidence rejected (CROSS_ORG / EVIDENCE_NOT_FOUND)', () => {
  reset();
  const d = harness({
    organizationId: 'org-001',
    evidenceId: 'ev-nonexistent',
  });
  assert.equal(d.allow, false);
  assert.equal(d.policy, 'cross_org');
  assert.match(d.reason, /EVIDENCE_NOT_FOUND/u);
});

test('policy-harness: combined fixture — SSRF URL + cross-org evidence — SSRF fires first', () => {
  reset();
  const up = evidenceStore.upload({
    schemaVersion: '1',
    organizationId: 'org-001',
    kind: 'CCCD_FRONT',
    bytes: randomBytes(64),
    owner: 'staff-intake-001',
  });
  const d = harness({
    url: 'https://127.0.0.1/evil',
    organizationId: 'org-002',
    evidenceId: up.evidenceId,
  });
  // SSRF is checked first.
  assert.equal(d.allow, false);
  assert.equal(d.policy, 'ssrf');
});

test('policy-harness: combined fixture — public URL + cross-org evidence — cross-org fires', () => {
  reset();
  const up = evidenceStore.upload({
    schemaVersion: '1',
    organizationId: 'org-001',
    kind: 'CCCD_FRONT',
    bytes: randomBytes(64),
    owner: 'staff-intake-001',
  });
  const d = harness({
    url: 'https://example.com/ok',
    organizationId: 'org-002',
    evidenceId: up.evidenceId,
  });
  assert.equal(d.allow, false);
  assert.equal(d.policy, 'cross_org');
});
