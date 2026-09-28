#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const EXPECTED_COUNTS = Object.freeze({
  seen: 7,
  eligible: 4,
  send: 3,
  fallback: 1,
  acknowledged: 4,
  dropped: 3,
  errors: 0,
});

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || !value) throw new Error('arguments must be --name value pairs');
    args[name.slice(2)] = value;
  }
  for (const required of ['workflow', 'final-output', 'attestation', 'out']) {
    if (!args[required]) throw new Error(`missing --${required}`);
  }
  return args;
}

async function readStrictJson(file) {
  const bytes = await readFile(file);
  if (
    (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) ||
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0xfe && bytes[1] === 0xff)
  ) {
    throw new Error(`${file}: BOM is forbidden`);
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function sameSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function validateN8n12Mock({ workflow, finalOutput, attestation }) {
  const result = Array.isArray(finalOutput) && finalOutput.length === 1 ? finalOutput[0] : null;
  const reminders = Array.isArray(result?.reminders) ? result.reminders : [];
  const acknowledgements = Array.isArray(result?.acknowledgements)
    ? result.acknowledgements
    : [];
  const dropped = Array.isArray(result?.dropped) ? result.dropped : [];
  const sentIds = Array.isArray(result?.sentNextActionIds) ? result.sentNextActionIds : [];
  const fallbackIds = Array.isArray(result?.fallbackNextActionIds)
    ? result.fallbackNextActionIds
    : [];
  const reminderIds = reminders.map((item) => item?.nextActionId).filter(Boolean);
  const acknowledgementIds = acknowledgements.map((item) => item?.nextActionId).filter(Boolean);
  const droppedIds = dropped.map((item) => item?.nextActionId).filter(Boolean);
  const handledIds = [...acknowledgementIds, ...droppedIds];
  const httpNodes = (workflow?.nodes || []).filter(
    (node) => node?.type === 'n8n-nodes-base.httpRequest',
  );
  const credentialNodes = (workflow?.nodes || []).filter(
    (node) => node?.credentials && Object.keys(node.credentials).length > 0,
  );

  const checks = {
    oneFinalItem: result !== null,
    workflowIdentity: result?.workflow === 'CRM — SLA Reminder — N8N/1.2 — Signed HTTP Draft',
    mockMode: result?.mode === 'MOCK',
    outputInactive: result?.active === false,
    serverWorkflowInactive: workflow?.active === false,
    executionSuccess: attestation?.execution?.status === 'success',
    executionFinished: attestation?.execution?.finished === true,
    workflowVersionBound:
      Boolean(attestation?.workflow?.versionId) &&
      attestation?.workflow?.versionId === attestation?.execution?.workflowVersionId,
    countsExact: Object.entries(EXPECTED_COUNTS).every(
      ([key, value]) => result?.counts?.[key] === value,
    ),
    arrayLengthsExact:
      reminders.length === 3 &&
      acknowledgements.length === 4 &&
      dropped.length === 3 &&
      sentIds.length === 3 &&
      fallbackIds.length === 1,
    reminderSetMatchesSendSet: sameSet(reminderIds, sentIds),
    acknowledgementSetMatchesEligibleSet: sameSet(
      acknowledgementIds,
      [...sentIds, ...fallbackIds],
    ),
    handledSetIsUnique: new Set(handledIds).size === 7,
    handledSetCoversSeen: new Set(handledIds).size === result?.counts?.seen,
    contractValidation:
      result?.contractValidation?.reminderEnvelopesChecked === 3 &&
      result?.contractValidation?.acknowledgementEnvelopesChecked === 4 &&
      result?.contractValidation?.allValid === true,
    declaredInvariants: Object.values(result?.invariants || {}).length === 6 &&
      Object.values(result?.invariants || {}).every((value) => value === true),
    signerStillBlocked: result?.signatureStatus === 'BLOCKED_BY_N8N_SIGNER_DECISION',
    noHttpRequestNodes: httpNodes.length === 0,
    noCredentialReferences: credentialNodes.length === 0,
    publicApiEnvelopeValidation:
      attestation?.schemaValidation?.checked === 7 &&
      attestation?.schemaValidation?.passed === 7 &&
      attestation?.schemaValidation?.failed === 0,
    sourceAttestationPass: attestation?.verdict === 'PASS',
  };
  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  return {
    schemaVersion: '1',
    profile: 'N8N/1.2-MOCK',
    source: {
      workflowId: attestation?.workflow?.id || null,
      workflowVersionId: attestation?.workflow?.versionId || null,
      executionId: attestation?.execution?.id || null,
      executionVersionId: attestation?.execution?.workflowVersionId || null,
      workflowRawSha256: attestation?.workflow?.rawSha256 || null,
      executionRawSha256: attestation?.execution?.rawSha256 || null,
      finalOutputSha256: attestation?.finalOutput?.sha256 || null,
    },
    observed: {
      counts: result?.counts || null,
      reminderCount: reminders.length,
      acknowledgementCount: acknowledgements.length,
      droppedCount: dropped.length,
      httpRequestNodeCount: httpNodes.length,
      credentialNodeCount: credentialNodes.length,
    },
    checks,
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
    boundary: {
      workflowActive: false,
      transportMode: 'MOCK',
      signedHttp: 'NOT_EXECUTED',
      deployment: 'NOT_EXECUTED',
    },
  };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = validateN8n12Mock({
      workflow: await readStrictJson(args.workflow),
      finalOutput: await readStrictJson(args['final-output']),
      attestation: await readStrictJson(args.attestation),
    });
    await writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(
      `N8N12_MOCK=${report.verdict} checks=${Object.keys(report.checks).length} ` +
        `failures=${report.failures.length}\n`,
    );
    if (report.verdict !== 'PASS') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`N8N12_MOCK=FAIL ${error.message}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();

export { EXPECTED_COUNTS, validateN8n12Mock };
