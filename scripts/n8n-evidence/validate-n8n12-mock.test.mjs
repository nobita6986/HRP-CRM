import assert from 'node:assert/strict';
import test from 'node:test';

import { validateN8n12Mock } from './validate-n8n12-mock.mjs';

function fixture() {
  const sent = ['na-1', 'na-2', 'na-3'];
  const fallback = ['na-4'];
  return {
    workflow: {
      active: false,
      nodes: [{ name: 'Build Final Output', type: 'n8n-nodes-base.code' }],
    },
    finalOutput: [
      {
        workflow: 'CRM — SLA Reminder — N8N/1.2 — Signed HTTP Draft',
        mode: 'MOCK',
        active: false,
        signatureStatus: 'BLOCKED_BY_N8N_SIGNER_DECISION',
        counts: { seen: 7, eligible: 4, send: 3, fallback: 1, acknowledged: 4, dropped: 3, errors: 0 },
        contractValidation: { reminderEnvelopesChecked: 3, acknowledgementEnvelopesChecked: 4, allValid: true },
        sentNextActionIds: sent,
        fallbackNextActionIds: fallback,
        reminders: sent.map((nextActionId) => ({ nextActionId })),
        acknowledgements: [...sent, ...fallback].map((nextActionId) => ({ nextActionId })),
        dropped: ['na-5', 'na-6', 'na-7'].map((nextActionId) => ({ nextActionId })),
        invariants: {
          oneReminderPerNextAction: true,
          uniqueReminderIdempotencyKeys: true,
          uniqueAcknowledgementKeys: true,
          noRealHttpCalls: true,
          noSecretInOutput: true,
          noRawPii: true,
        },
      },
    ],
    attestation: {
      verdict: 'PASS',
      workflow: { id: 'wf', versionId: 'version', rawSha256: 'a'.repeat(64) },
      execution: { id: '10', workflowVersionId: 'version', status: 'success', finished: true, rawSha256: 'b'.repeat(64) },
      finalOutput: { sha256: 'c'.repeat(64) },
      schemaValidation: { checked: 7, passed: 7, failed: 0 },
    },
  };
}

test('accepts the exact N8N/1.2 MOCK matrix', () => {
  const report = validateN8n12Mock(fixture());
  assert.equal(report.verdict, 'PASS');
  assert.deepEqual(report.failures, []);
});

test('rejects a count drift', () => {
  const input = fixture();
  input.finalOutput[0].counts.send = 2;
  const report = validateN8n12Mock(input);
  assert.equal(report.verdict, 'FAIL');
  assert.ok(report.failures.includes('countsExact'));
});

test('rejects activation, HTTP nodes and credential references', () => {
  const input = fixture();
  input.workflow.active = true;
  input.workflow.nodes.push({
    name: 'Unexpected HTTP',
    type: 'n8n-nodes-base.httpRequest',
    credentials: { httpHeaderAuth: { id: 'secret-reference' } },
  });
  const report = validateN8n12Mock(input);
  assert.equal(report.verdict, 'FAIL');
  assert.ok(report.failures.includes('serverWorkflowInactive'));
  assert.ok(report.failures.includes('noHttpRequestNodes'));
  assert.ok(report.failures.includes('noCredentialReferences'));
});

test('rejects workflow/execution version mismatch', () => {
  const input = fixture();
  input.attestation.execution.workflowVersionId = 'older-version';
  const report = validateN8n12Mock(input);
  assert.equal(report.verdict, 'FAIL');
  assert.ok(report.failures.includes('workflowVersionBound'));
});
