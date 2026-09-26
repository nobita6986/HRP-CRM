// node.mjs
// Description of the HrpAutomationSigner custom n8n node. n8n loads
// this from package.json#n8n.nodes at runtime. This file also provides
// a vanilla execute() helper that local tests can import; the helper
// requires no n8n engine.

import { buildHeadersAndSignature } from './signer.mjs';
import { assertHrpAutomationLegacyCredentialFields } from './credential.mjs';

/**
 * Find the credential by name in a small in-memory store. n8n
 * supplies its own credential lookup at runtime; this is a stand-in
 * for local tests.
 * @param {string} name
 * @param {Record<string, { serviceId: string; organizationId: string; connectionId: string; secret: string }>} store
 * @returns {{ serviceId: string; organizationId: string; connectionId: string; secret: string } | null}
 */
export function findCredential(name, store) {
  if (!store || typeof store !== 'object') return null;
  const cred = store[name];
  if (!cred || typeof cred !== 'object') return null;
  return cred;
}

/**
 * Execute the signer node against a single envelope item. Returns
 * either { ok: true, output } or { ok: false, error }.
 *
 * @param {{
 *   params: { envelope?: unknown; credentialName?: string };
 *   credentials: Record<string, { serviceId: string; organizationId: string; connectionId: string; secret: string }>;
 *   executionData?: { log?: unknown; trace?: unknown };
 * }} args
 */
export function execute(args) {
  const params = (args && args.params) || {};
  const credentials = (args && args.credentials) || {};
  const envelope = params.envelope;
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { ok: false, error: { kind: 'MALFORMED_ENVELOPE' } };
  }
  const env = envelope;
  const required = ['commandName', 'idempotencyKey', 'organizationId', 'connectionId', 'serviceId'];
  for (const f of required) {
    if (typeof env[f] !== 'string' || env[f].length === 0) {
      return { ok: false, error: { kind: 'INCOMPLETE_IDENTITY', missing: f } };
    }
  }
  const credName = params.credentialName;
  if (typeof credName !== 'string' || credName.length === 0) {
    return { ok: false, error: { kind: 'MISSING_CREDENTIAL' } };
  }
  const cred = findCredential(credName, credentials);
  if (!cred) {
    return { ok: false, error: { kind: 'MISSING_CREDENTIAL' } };
  }
  const validated = assertHrpAutomationLegacyCredentialFields(cred);
  if (!validated.ok) {
    return { ok: false, error: { kind: 'BAD_CREDENTIAL', detail: validated } };
  }
  let output;
  try {
    output = buildHeadersAndSignature({ envelope: env, credential: cred });
  } catch (err) {
    return { ok: false, error: { kind: 'CANONICAL_FAILED', message: err.message } };
  }
  return { ok: true, output };
}

export const HrpAutomationSigner = {
  displayName: 'HRP Automation Signer (legacy SHA-256(input || secret))',
  name: 'hrpAutomationSigner',
  group: ['transform'],
  version: 1,
  description: 'Custom n8n node. Emits the four X-Hrp-Automation-* headers over an envelope using the legacy SHA-256(input || secret) profile. NOT HMAC.',
  defaults: { name: 'HRP Automation Signer' },
  inputs: ['main'],
  outputs: ['main'],
  credentials: [
    {
      name: 'hrpAutomationLegacySignature',
      required: true,
    },
  ],
  properties: [
    {
      displayName: 'Envelope',
      name: 'envelope',
      type: 'json',
      required: true,
      default: '={{ JSON.stringify($json) }}',
      description: 'The AutomationRequest envelope to sign. Tracking fields (correlationId, occurredAt, commandId, n8nExecutionId) are stripped before hashing.',
    },
    {
      displayName: 'Credential Name',
      name: 'credentialName',
      type: 'string',
      required: true,
      default: 'hrpAutomationLegacySignature',
      description: 'Name of the hrpAutomationLegacySignature credential to resolve at execution time.',
    },
  ],
  execute,
};