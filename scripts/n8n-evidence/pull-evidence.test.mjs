import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { pullEvidence } from './pull-evidence.mjs';

const workflow = {
  id: 'wf-test',
  name: 'Test workflow',
  active: false,
  versionId: 'version-test',
  nodes: [{ name: 'Manual Trigger' }, { name: 'Build Final Output' }],
};

const execution = {
  id: '42',
  workflowId: 'wf-test',
  status: 'success',
  finished: true,
  mode: 'manual',
  workflowVersionId: 'version-test',
  startedAt: '2026-09-28T00:00:00.000Z',
  stoppedAt: '2026-09-28T00:00:01.000Z',
  data: {
    resultData: {
      lastNodeExecuted: 'Build Final Output',
      runData: {
        'Build Final Output': [
          {
            data: {
              main: [[{ json: { counts: { seen: 7 }, reminders: [], acknowledgements: [] } }]],
            },
          },
        ],
      },
    },
  },
};

function response(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('pulls workflow and explicit execution without exposing the API key', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers });
    if (url.endsWith('/workflows/wf-test')) return response(workflow);
    if (url.endsWith('/executions/42?includeData=true')) return response(execution);
    return new Response('missing', { status: 404 });
  };
  const outDir = await mkdtemp(path.join(tmpdir(), 'n8n-evidence-'));
  try {
    const result = await pullEvidence(
      {
        instance: 'crm',
        'base-url': 'https://n8n.example.test',
        'workflow-id': 'wf-test',
        'execution-id': '42',
        'out-dir': outDir,
        'expect-version': 'version-test',
        'expect-inactive': true,
        'final-node': 'Build Final Output',
      },
      {
        env: { N8N_API_KEY: 'test-api-key-never-write' },
        fetchImpl,
        cwd: process.cwd(),
      },
    );
    assert.equal(result.attestation.verdict, 'PASS');
    assert.equal(result.attestation.execution.id, '42');
    assert.equal(result.attestation.execution.workflowVersionId, 'version-test');
    assert.equal(result.attestation.finalOutput.itemCount, 1);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.headers['X-N8N-API-KEY'] === 'test-api-key-never-write'));
    const written = await readFile(path.join(outDir, 'attestation.json'), 'utf8');
    assert.ok(!written.includes('test-api-key-never-write'));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('discovers latest successful execution when execution id is omitted', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/workflows/wf-test')) return response(workflow);
    if (url.includes('/executions?workflowId=wf-test')) return response({ data: [{ id: '42' }] });
    if (url.endsWith('/executions/42?includeData=true')) return response(execution);
    return new Response('missing', { status: 404 });
  };
  const outDir = await mkdtemp(path.join(tmpdir(), 'n8n-evidence-'));
  try {
    const result = await pullEvidence(
      {
        instance: 'crm',
        'base-url': 'https://n8n.example.test',
        'workflow-id': 'wf-test',
        'out-dir': outDir,
        'expect-inactive': true,
      },
      { env: { N8N_API_KEY: 'test-key' }, fetchImpl, cwd: process.cwd() },
    );
    assert.equal(result.attestation.execution.id, '42');
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('fails closed on workflow version mismatch', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/workflows/wf-test')) return response(workflow);
    if (url.endsWith('/executions/42?includeData=true')) return response(execution);
    return new Response('missing', { status: 404 });
  };
  const outDir = await mkdtemp(path.join(tmpdir(), 'n8n-evidence-'));
  try {
    await assert.rejects(
      pullEvidence(
        {
          instance: 'crm',
          'base-url': 'https://n8n.example.test',
          'workflow-id': 'wf-test',
          'execution-id': '42',
          'out-dir': outDir,
          'expect-version': 'wrong-version',
        },
        { env: { N8N_API_KEY: 'test-key' }, fetchImpl, cwd: process.cwd() },
      ),
      /expectedVersionMatches/u,
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
