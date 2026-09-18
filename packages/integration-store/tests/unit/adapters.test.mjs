/**
 * packages/integration-store/tests/unit/adapters.test.mjs
 *
 * Unit tests cho adapters (Contract DTO ↔ Prisma row) — KHÔNG cần DB.
 * Pin contracts 0.0.8-g0.8-fixes. CORE/1.3.
 *
 * Lưu ý: file `.mjs` chạy bằng Node, KHÔNG TypeScript. Dùng JSDoc
 * cho type hint runtime (tsc không check file này).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('./dist/index.js')) {
  execSync('npm run build', { stdio: 'inherit' });
}

const {
  contactLinkRowToContract,
  contactLinkContractToWrite,
  convLinkRowToContract,
  storeError,
} = await import('../../dist/index.js');

// ─── Helpers ────────────────────────────────────────────────────────

function isStoreCode(err, code) {
  return Boolean(err && typeof err === 'object' && err.code === code);
}

// ─── contactLinkContractToWrite ─────────────────────────────────────

test('adapters: EXACT_MATCH/TALENT contract → matchedLaborProfileId + version', () => {
  const write = contactLinkContractToWrite({
    schemaVersion: '1',
    organizationId: 'org-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-001',
    external: { externalAccountId: 'acct-1', externalContactId: 'c-1' },
    state: 'EXACT_MATCH',
    matchedTarget: {
      kind: 'TALENT',
      matchedLaborProfileId: 'lp-001',
      matchedLaborProfileVersion: 7,
    },
    aggregateVersion: 1,
  });
  assert.equal(write.matchedTargetKind, 'TALENT');
  assert.equal(write.matchedLaborProfileId, 'lp-001');
  assert.equal(write.matchedLaborProfileVersion, 7);
  assert.equal(write.matchedClientContactId, null);
});

test('adapters: EXACT_MATCH/CLIENT contract → matchedClientContactId + version', () => {
  const write = contactLinkContractToWrite({
    schemaVersion: '1',
    organizationId: 'org-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-001',
    external: { externalAccountId: 'acct-1', externalContactId: 'c-1' },
    state: 'EXACT_MATCH',
    matchedTarget: {
      kind: 'CLIENT',
      matchedClientContactId: 'cc-001',
      matchedClientContactVersion: 3,
    },
    aggregateVersion: 1,
  });
  assert.equal(write.matchedTargetKind, 'CLIENT');
  assert.equal(write.matchedClientContactId, 'cc-001');
  assert.equal(write.matchedClientContactVersion, 3);
});

test('adapters: POSSIBLE_MATCH contract requires candidateReference, KHÔNG có matchedTarget', () => {
  const write = contactLinkContractToWrite({
    schemaVersion: '1',
    organizationId: 'org-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-001',
    external: { externalAccountId: 'acct-1', externalContactId: 'c-1' },
    state: 'POSSIBLE_MATCH',
    candidateReference: {
      reviewQueueEntryId: 'rev-1',
      recordedAt: '2026-09-14T01:00:00.000Z',
    },
    aggregateVersion: 1,
  });
  assert.equal(write.candidateReviewQueueEntryId, 'rev-1');
  assert.ok(write.candidateRecordedAt instanceof Date);
  assert.equal(write.matchedTargetKind, null);
});

test('adapters: POSSIBLE_MATCH + matchedTarget → reject VALIDATION_ERROR', () => {
  assert.throws(
    () =>
      contactLinkContractToWrite({
        schemaVersion: '1',
        organizationId: 'org-001',
        provider: 'CHATWOOT',
        connectionId: 'conn-001',
        external: { externalAccountId: 'acct-1', externalContactId: 'c-1' },
        state: 'POSSIBLE_MATCH',
        matchedTarget: { kind: 'TALENT', matchedLaborProfileId: 'lp-1', matchedLaborProfileVersion: 1 },
        candidateReference: { reviewQueueEntryId: 'rev-1', recordedAt: '2026-09-14T01:00:00.000Z' },
        aggregateVersion: 1,
      }),
    (err) => isStoreCode(err, 'VALIDATION_ERROR'),
  );
});

test('adapters: UNRESOLVED KHÔNG có matchedTarget/candidateReference', () => {
  const write = contactLinkContractToWrite({
    schemaVersion: '1',
    organizationId: 'org-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-001',
    external: { externalAccountId: 'acct-1', externalContactId: 'c-1' },
    state: 'UNRESOLVED',
    aggregateVersion: 0,
  });
  assert.equal(write.matchedTargetKind, null);
  assert.equal(write.candidateReviewQueueEntryId, null);
});

test('adapters: UNRESOLVED + matchedTarget → reject', () => {
  assert.throws(
    () =>
      contactLinkContractToWrite({
        schemaVersion: '1',
        organizationId: 'org-001',
        provider: 'CHATWOOT',
        connectionId: 'conn-001',
        external: { externalAccountId: 'acct-1', externalContactId: 'c-1' },
        state: 'UNRESOLVED',
        matchedTarget: { kind: 'TALENT', matchedLaborProfileId: 'lp-1', matchedLaborProfileVersion: 1 },
        aggregateVersion: 0,
      }),
    (err) => isStoreCode(err, 'VALIDATION_ERROR'),
  );
});

// ─── contactLinkRowToContract ───────────────────────────────────────

test('adapters: row → contract EXACT_MATCH/TALENT includes matchedTarget + aggregateVersion', () => {
  const out = contactLinkRowToContract({
    linkId: 'lk-1',
    schemaVersion: '1',
    organizationId: 'org-1',
    provider: 'CHATWOOT',
    connectionId: 'conn-1',
    externalAccountId: 'acct-1',
    externalContactId: 'c-1',
    state: 'EXACT_MATCH',
    matchedTargetKind: 'TALENT',
    matchedLaborProfileId: 'lp-1',
    matchedLaborProfileVersion: 5,
    matchedClientContactId: null,
    matchedClientContactVersion: null,
    candidateReviewQueueEntryId: null,
    candidateRecordedAt: null,
    aggregateVersion: 5,
    lastAttemptedAt: new Date('2026-09-14T01:00:00.000Z'),
    evidenceRefsJson: null,
  });
  assert.equal(out.state, 'EXACT_MATCH');
  assert.equal(out.matchedTarget?.kind, 'TALENT');
  assert.equal(out.matchedTarget?.matchedLaborProfileId, 'lp-1');
  assert.equal(out.aggregateVersion, 5);
  assert.ok(out.lastAttemptedAt);
});

test('adapters: row EXACT_MATCH/TALENT thiếu matchedLaborProfileId → throw VALIDATION_ERROR', () => {
  assert.throws(
    () =>
      contactLinkRowToContract({
        linkId: 'lk-1',
        schemaVersion: '1',
        organizationId: 'org-1',
        provider: 'CHATWOOT',
        connectionId: 'conn-1',
        externalAccountId: 'acct-1',
        externalContactId: 'c-1',
        state: 'EXACT_MATCH',
        matchedTargetKind: 'TALENT',
        matchedLaborProfileId: null,
        matchedLaborProfileVersion: null,
        matchedClientContactId: null,
        matchedClientContactVersion: null,
        candidateReviewQueueEntryId: null,
        candidateRecordedAt: null,
        aggregateVersion: 0,
        lastAttemptedAt: null,
        evidenceRefsJson: null,
      }),
    (err) => isStoreCode(err, 'VALIDATION_ERROR'),
  );
});

// ─── ConversationLink row → contract ────────────────────────────────

test('adapters: convLinkRowToContract giữ externalRefs + currentRevision', () => {
  const out = convLinkRowToContract({
    linkId: 'cv-1',
    schemaVersion: '1',
    organizationId: 'org-1',
    conversationId: 'conv-1',
    conversationVersion: 1,
    conversationKind: 'TALENT',
    primaryTargetKind: null,
    primaryLaborProfileId: null,
    primaryClientContactId: null,
    externalRefsJson: [
      {
        organizationId: 'org-1',
        provider: 'CHATWOOT',
        connectionId: 'conn-1',
        externalAccountId: 'acct-1',
        externalInboxId: 'inb-1',
        externalConversationId: 'ext-conv-1',
        aggregateVersion: 1,
        lastSeenAt: '2026-09-14T01:00:00.000Z',
      },
    ],
    currentRevision: 1,
    historyRevisionsJson: null,
    updatedAt: new Date('2026-09-14T02:00:00.000Z'),
  });
  assert.equal(out.conversationKind, 'TALENT');
  assert.equal(out.currentRevision, 1);
  assert.equal(Array.isArray(out.externalRefs), true);
  assert.equal(out.externalRefs.length, 1);
});

// ─── storeError ─────────────────────────────────────────────────────

test('errors: storeError trả object có code + retryable + optional target', () => {
  const e = storeError('VERSION_CONFLICT', 'test', { target: 'aggregateVersion' });
  assert.equal(e.code, 'VERSION_CONFLICT');
  assert.equal(e.retryable, false);
  assert.equal(e.target, 'aggregateVersion');
});
