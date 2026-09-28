#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const HEX_64 = /^[a-f0-9]{64}$/u;
const EXPECTED_KEYS = Object.freeze([
  'body', 'commandId', 'correlationId', 'idempotencyKey', 'payloadDigest',
  'signatureProfile', 'statusCode',
]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || !value) throw new Error('arguments must be --name value pairs');
    args[name.slice(2)] = value;
  }
  for (const required of ['workflow', 'execution', 'final-output', 'attestation', 'out']) {
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
  ) throw new Error(`${file}: BOM is forbidden`);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function collectStrings(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, output));
  return output;
}

function validateSignedRuntime({ workflow, execution, finalOutput, attestation }) {
  const item = Array.isArray(finalOutput) && finalOutput.length === 1 ? finalOutput[0] : null;
  const dispatchNodes = (workflow?.nodes || []).filter(
    (node) => node?.type === 'n8n-nodes-hrp-automation-dispatch.hrpAutomationDispatch',
  );
  const httpNodes = (workflow?.nodes || []).filter((node) => node?.type === 'n8n-nodes-base.httpRequest');
  const credential = dispatchNodes[0]?.credentials?.hrpAutomationLegacySignature;
  const itemStrings = collectStrings(item);
  const checks = {
    sourceAttestationPass: attestation?.verdict === 'PASS',
    exactWorkflow: attestation?.workflow?.id === 'J02Z2ytL5tNsT64e',
    exactVersion: attestation?.workflow?.versionId === 'e87ac600-f115-43e6-811e-86559fdf1f14',
    exactExecution: attestation?.execution?.id === '12',
    workflowVersionBound: attestation?.workflow?.versionId === attestation?.execution?.workflowVersionId,
    inactive: workflow?.active === false && workflow?.activeVersionId == null,
    manualSuccess: execution?.mode === 'manual' && execution?.status === 'success' && execution?.finished === true,
    finalNodeBound: attestation?.execution?.lastNodeExecuted === 'Build Signed Runtime Evidence',
    fourNodes: workflow?.nodes?.length === 4,
    oneCustomDispatchNode: dispatchNodes.length === 1,
    noHttpRequestNode: httpNodes.length === 0,
    expectedCredential: credential?.id === 'f08ecd1a-2b1c-46cd-8dba-10ab93ddcd6e' && credential?.name === 'T0 Synthetic Signer Runtime R1',
    oneFinalItem: item !== null,
    exactOutputKeys: item !== null && JSON.stringify(Object.keys(item).sort()) === JSON.stringify([...EXPECTED_KEYS].sort()),
    exactBodyKeys: item !== null && JSON.stringify(Object.keys(item.body || {}).sort()) === JSON.stringify(['cached', 'mode', 'payloadDigest', 'status'].sort()),
    applied: item?.statusCode === 200 && item?.body?.status === 'APPLIED',
    syntheticVerifier: item?.body?.mode === 'SYNTHETIC_SIGNER_RUNTIME_VERIFIER',
    correctSignatureProfile: item?.signatureProfile === 'LEGACY_SHA256_INPUT_SECRET',
    digestFormat: HEX_64.test(item?.payloadDigest || '') && HEX_64.test(item?.body?.payloadDigest || ''),
    digestAgreement: item?.payloadDigest === item?.body?.payloadDigest,
    expectedIds: item?.commandId === 'cmd-signer-conformance-r1' && item?.correlationId === 'corr-signer-conformance-r1' && item?.idempotencyKey === 'idem-signer-conformance-r1',
    noSensitiveOutputValues: !itemStrings.some(
      (value) => /authorization\s*:|bearer\s+[a-z0-9._-]+|credential\s*:|secret\s*=|signature\s*=/iu.test(value),
    ),
  };
  const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return {
    schemaVersion: '1',
    profile: 'N8N/1.2-SIGNED-RUNTIME-CONFORMANCE',
    source: {
      workflowId: attestation?.workflow?.id || null,
      workflowVersionId: attestation?.workflow?.versionId || null,
      executionId: attestation?.execution?.id || null,
      workflowRawSha256: attestation?.workflow?.rawSha256 || null,
      executionRawSha256: attestation?.execution?.rawSha256 || null,
      finalOutputSha256: attestation?.finalOutput?.sha256 || null,
    },
    observed: {
      statusCode: item?.statusCode ?? null,
      bodyStatus: item?.body?.status ?? null,
      bodyMode: item?.body?.mode ?? null,
      payloadDigest: item?.payloadDigest ?? null,
      signatureProfile: item?.signatureProfile ?? null,
    },
    checks,
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
    boundary: {
      signedRuntimeConformance: failures.length === 0 ? 'PASS' : 'FAIL',
      realCrmGateway: 'NOT_EXECUTED',
      workflowActivation: 'NOT_AUTHORIZED',
      productionEnablement: 'NOT_AUTHORIZED',
    },
  };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = validateSignedRuntime({
      workflow: await readStrictJson(args.workflow),
      execution: await readStrictJson(args.execution),
      finalOutput: await readStrictJson(args['final-output']),
      attestation: await readStrictJson(args.attestation),
    });
    await writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`N8N12_SIGNED_RUNTIME=${report.verdict} checks=${Object.keys(report.checks).length} failures=${report.failures.length}\n`);
    if (report.verdict !== 'PASS') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`N8N12_SIGNED_RUNTIME=FAIL ${error.message}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();

export { validateSignedRuntime };
