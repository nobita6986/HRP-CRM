#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

function usage() {
  return [
    'Usage:',
    '  node scripts/n8n-evidence/pull-evidence.mjs \\',
    '    --instance crm|hrp --base-url https://n8n.example.vn \\',
    '    --workflow-id <id> [--execution-id <id>] --out-dir <path> \\',
    '    [--expect-version <uuid>] [--expect-inactive] \\',
    '    [--final-node "Build Final Output"] [--validate-crm-automation] \\',
    '    [--schema-root <CRM checkout containing built integration-api>]',
    '',
    'Authentication:',
    '  Set N8N_API_KEY or N8N_API_KEY_FILE. The key is never accepted on argv.',
  ].join('\n');
}

function parseArgs(argv) {
  const result = {};
  const flags = new Set(['expect-inactive', 'validate-crm-automation']);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const name = token.slice(2);
    if (flags.has(name)) {
      result[name] = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${name}`);
    result[name] = value;
    i += 1;
  }
  for (const required of ['instance', 'base-url', 'workflow-id', 'out-dir']) {
    if (!result[required]) throw new Error(`missing --${required}`);
  }
  if (!['crm', 'hrp'].includes(result.instance)) {
    throw new Error('--instance must be crm or hrp');
  }
  return result;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonical(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number in canonical JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  throw new TypeError(`unsupported canonical JSON type: ${typeof value}`);
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('n8n base URL must use HTTPS unless it is localhost');
  }
  url.pathname = url.pathname.replace(/\/+$/u, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/u, '');
}

async function loadApiKey(env) {
  if (env.N8N_API_KEY) return env.N8N_API_KEY.trim();
  if (env.N8N_API_KEY_FILE) {
    return (await readFile(env.N8N_API_KEY_FILE, 'utf8')).trim();
  }
  throw new Error('N8N_API_KEY or N8N_API_KEY_FILE is required');
}

async function apiGet({ baseUrl, apiKey, endpoint, fetchImpl = fetch }) {
  const response = await fetchImpl(`${baseUrl}/api/v1${endpoint}`, {
    headers: {
      Accept: 'application/json',
      'X-N8N-API-KEY': apiKey,
    },
    redirect: 'error',
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`n8n API ${endpoint} returned HTTP ${response.status}`);
  }
  let json;
  try {
    json = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`n8n API ${endpoint} returned non-JSON data`);
  }
  return { bytes, json };
}

function executionListItems(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.data)) return value.data;
  return [];
}

function extractFinalItems(execution, requestedNode) {
  const resultData = execution?.data?.resultData;
  const runData = resultData?.runData;
  if (!runData || typeof runData !== 'object') return { node: null, items: [] };
  const node = requestedNode || resultData.lastNodeExecuted || execution.lastNodeExecuted;
  if (!node || !Array.isArray(runData[node]) || runData[node].length === 0) {
    return { node: node || null, items: [] };
  }
  const lastRun = runData[node][runData[node].length - 1];
  const items = lastRun?.data?.main?.[0];
  return {
    node,
    items: Array.isArray(items) ? items.map((item) => item?.json).filter(Boolean) : [],
  };
}

function collectAutomationEnvelopes(items) {
  const envelopes = [];
  for (const item of items) {
    const roots = Array.isArray(item) ? item : [item];
    for (const root of roots) {
      for (const reminder of root?.reminders || []) {
        if (reminder?.envelope) envelopes.push({ kind: 'reminder', envelope: reminder.envelope });
      }
      for (const acknowledgement of root?.acknowledgements || []) {
        if (acknowledgement?.envelope) {
          envelopes.push({ kind: 'acknowledgement', envelope: acknowledgement.envelope });
        }
      }
    }
  }
  return envelopes;
}

async function validateCrmAutomation(envelopes, schemaRoot = process.cwd()) {
  const modulePath = path.resolve(schemaRoot, 'apps/integration-api/dist/automation/index.js');
  const module = await import(pathToFileURL(modulePath).href);
  if (!module.AutomationRequestSchema) {
    throw new Error('AutomationRequestSchema is unavailable; build apps/integration-api first');
  }
  const details = envelopes.map(({ kind, envelope }, index) => {
    const parsed = module.AutomationRequestSchema.safeParse(envelope);
    return {
      index,
      kind,
      commandId: envelope?.commandId || null,
      valid: parsed.success,
      issues: parsed.success
        ? []
        : parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            code: issue.code,
            message: issue.message,
          })),
    };
  });
  return {
    checked: details.length,
    passed: details.filter((item) => item.valid).length,
    failed: details.filter((item) => !item.valid).length,
    details,
  };
}

async function pullEvidence(options, dependencies = {}) {
  const env = dependencies.env || process.env;
  const fetchImpl = dependencies.fetchImpl || fetch;
  const cwd = dependencies.cwd || process.cwd();
  const apiKey = await loadApiKey(env);
  if (!apiKey) throw new Error('n8n API key is empty');
  const baseUrl = normalizeBaseUrl(options['base-url']);
  const workflowId = options['workflow-id'];

  const workflow = await apiGet({
    baseUrl,
    apiKey,
    endpoint: `/workflows/${encodeURIComponent(workflowId)}`,
    fetchImpl,
  });

  let executionId = options['execution-id'];
  if (!executionId) {
    const list = await apiGet({
      baseUrl,
      apiKey,
      endpoint:
        `/executions?workflowId=${encodeURIComponent(workflowId)}` +
        '&status=success&limit=1&includeData=false',
      fetchImpl,
    });
    const latest = executionListItems(list.json)[0];
    if (!latest?.id) throw new Error('no successful execution found for workflow');
    executionId = String(latest.id);
  }

  const execution = await apiGet({
    baseUrl,
    apiKey,
    endpoint: `/executions/${encodeURIComponent(executionId)}?includeData=true`,
    fetchImpl,
  });

  if (String(execution.json.workflowId) !== String(workflowId)) {
    throw new Error('execution workflowId does not match requested workflow');
  }
  const executionVersionId =
    execution.json?.workflowVersionId ||
    execution.json?.workflowData?.versionId ||
    execution.json?.data?.workflowData?.versionId ||
    null;
  const final = extractFinalItems(execution.json, options['final-node']);
  const envelopes = collectAutomationEnvelopes(final.items);
  const schemaValidation = options['validate-crm-automation']
    ? await validateCrmAutomation(envelopes, options['schema-root'] || cwd)
    : null;

  const checks = {
    workflowIdMatches: String(workflow.json.id) === String(workflowId),
    executionWorkflowIdMatches: String(execution.json.workflowId) === String(workflowId),
    expectedVersionMatches: options['expect-version']
      ? workflow.json.versionId === options['expect-version']
      : null,
    executedVersionMatches: options['expect-version']
      ? executionVersionId === options['expect-version']
      : null,
    inactive: options['expect-inactive'] ? workflow.json.active === false : null,
    executionFinished: execution.json.finished === true || execution.json.status === 'success',
    finalNodeFound: final.node !== null,
    finalOutputFound: final.items.length > 0,
    schemaValid:
      schemaValidation === null
        ? null
        : schemaValidation.checked > 0 && schemaValidation.failed === 0,
  };
  const failures = Object.entries(checks)
    .filter(([, value]) => value === false)
    .map(([name]) => name);

  const outDir = path.resolve(options['out-dir']);
  await mkdir(outDir, { recursive: true });
  const workflowFile = path.join(outDir, 'workflow.raw.json');
  const executionFile = path.join(outDir, 'execution.raw.json');
  const finalFile = path.join(outDir, 'final-output.json');
  const attestationFile = path.join(outDir, 'attestation.json');
  await writeFile(workflowFile, workflow.bytes);
  await writeFile(executionFile, execution.bytes);
  await writeFile(finalFile, `${JSON.stringify(final.items, null, 2)}\n`, 'utf8');

  const attestation = {
    schemaVersion: '1',
    fetchedAt: new Date().toISOString(),
    source: {
      instance: options.instance,
      baseUrl,
      api: 'n8n-public-api-v1',
    },
    workflow: {
      id: workflow.json.id,
      name: workflow.json.name,
      active: workflow.json.active,
      versionId: workflow.json.versionId || null,
      nodeCount: Array.isArray(workflow.json.nodes) ? workflow.json.nodes.length : null,
      rawSha256: sha256(workflow.bytes),
      canonicalSha256: sha256(Buffer.from(canonical(workflow.json), 'utf8')),
    },
    execution: {
      id: String(execution.json.id),
      workflowId: String(execution.json.workflowId),
      workflowVersionId: executionVersionId,
      status: execution.json.status || null,
      finished: execution.json.finished ?? null,
      mode: execution.json.mode || null,
      startedAt: execution.json.startedAt || null,
      stoppedAt: execution.json.stoppedAt || null,
      lastNodeExecuted: execution.json?.data?.resultData?.lastNodeExecuted || null,
      rawSha256: sha256(execution.bytes),
    },
    finalOutput: {
      node: final.node,
      itemCount: final.items.length,
      sha256: sha256(Buffer.from(canonical(final.items), 'utf8')),
      envelopeCount: envelopes.length,
    },
    schemaValidation,
    checks,
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
  };
  await writeFile(attestationFile, `${JSON.stringify(attestation, null, 2)}\n`, 'utf8');

  if (failures.length > 0) {
    throw new Error(`evidence verification failed: ${failures.join(', ')}`);
  }
  return { attestation, outDir };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  try {
    const result = await pullEvidence(options);
    process.stdout.write(
      `N8N_EVIDENCE=${result.attestation.verdict} ` +
        `workflow=${result.attestation.workflow.id} ` +
        `execution=${result.attestation.execution.id} ` +
        `envelopes=${result.attestation.finalOutput.envelopeCount} ` +
        `out=${result.outDir}\n`,
    );
  } catch (error) {
    process.stderr.write(`N8N_EVIDENCE=FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) await main();

export {
  collectAutomationEnvelopes,
  extractFinalItems,
  normalizeBaseUrl,
  parseArgs,
  pullEvidence,
  sha256,
};
