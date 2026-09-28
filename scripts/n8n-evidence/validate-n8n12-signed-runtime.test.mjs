import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSignedRuntime } from './validate-n8n12-signed-runtime.mjs';

function fixture() {
  const digest = 'a'.repeat(64);
  return {
    workflow: {
      active: false, activeVersionId: null,
      nodes: [
        { type: 'n8n-nodes-base.manualTrigger' }, { type: 'n8n-nodes-base.set' },
        { type: 'n8n-nodes-hrp-automation-dispatch.hrpAutomationDispatch', credentials: { hrpAutomationLegacySignature: { id: 'f08ecd1a-2b1c-46cd-8dba-10ab93ddcd6e', name: 'T0 Synthetic Signer Runtime R1' } } },
        { type: 'n8n-nodes-base.set' },
      ],
    },
    execution: { mode: 'manual', status: 'success', finished: true },
    finalOutput: [{ statusCode: 200, body: { status: 'APPLIED', mode: 'SYNTHETIC_SIGNER_RUNTIME_VERIFIER', cached: false, payloadDigest: digest }, commandId: 'cmd-signer-conformance-r1', correlationId: 'corr-signer-conformance-r1', idempotencyKey: 'idem-signer-conformance-r1', payloadDigest: digest, signatureProfile: 'LEGACY_SHA256_INPUT_SECRET' }],
    attestation: { verdict: 'PASS', workflow: { id: 'J02Z2ytL5tNsT64e', versionId: 'e87ac600-f115-43e6-811e-86559fdf1f14', rawSha256: 'b'.repeat(64) }, execution: { id: '12', workflowVersionId: 'e87ac600-f115-43e6-811e-86559fdf1f14', lastNodeExecuted: 'Build Signed Runtime Evidence', rawSha256: 'c'.repeat(64) }, finalOutput: { sha256: 'd'.repeat(64) } },
  };
}

test('accepts the pinned signed runtime evidence', () => assert.equal(validateSignedRuntime(fixture()).verdict, 'PASS'));
test('rejects digest disagreement', () => { const input = fixture(); input.finalOutput[0].body.payloadDigest = 'e'.repeat(64); assert.ok(validateSignedRuntime(input).failures.includes('digestAgreement')); });
test('rejects activation and generic HTTP substitution', () => { const input = fixture(); input.workflow.active = true; input.workflow.activeVersionId = 'published'; input.workflow.nodes[2].type = 'n8n-nodes-base.httpRequest'; assert.equal(validateSignedRuntime(input).verdict, 'FAIL'); });
test('rejects extra output fields', () => { const input = fixture(); input.finalOutput[0].signature = 'f'.repeat(64); assert.ok(validateSignedRuntime(input).failures.includes('exactOutputKeys')); });
