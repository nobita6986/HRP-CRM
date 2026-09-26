// credential.mjs
// Credential test + minimal n8n credential description.
//
// IMPORTANT: the literal secret value is never persisted in the
// workflow JSON. Operators store it once in the n8n credential store;
// the workflow JSON holds only { name, id } and the credential loader
// resolves the secret at execution time. This file is a faithful
// description that an n8n runtime would expose via its plugin loader.

/**
 * @typedef {Object} HrpAutomationLegacySignatureCredential
 * @property {string} serviceId
 * @property {string} organizationId
 * @property {string} connectionId
 * @property {string} secret
 */

/**
 * Field-shape test. Returns { ok: true } for a valid credential, or
 * { ok: false, kind, message } for an invalid one.
 * @param {Record<string, unknown>} obj
 * @returns {{ ok: true; } | { ok: false; kind: string; message: string; field?: string; }}
 */
export function assertHrpAutomationLegacyCredentialFields(obj) {
  if (!obj || typeof obj !== 'object') {
    return { ok: false, kind: 'NOT_AN_OBJECT', message: 'credential must be an object' };
  }
  for (const field of ['serviceId', 'organizationId', 'connectionId']) {
    const v = /** @type {Record<string, unknown>} */ (obj)[field];
    if (typeof v !== 'string' || v.length === 0) {
      return { ok: false, kind: 'MISSING_' + field.toUpperCase(), field, message: 'required string missing' };
    }
  }
  const secret = /** @type {Record<string, unknown>} */ (obj).secret;
  if (typeof secret !== 'string') {
    return { ok: false, kind: 'MISSING_SECRET', field: 'secret', message: 'required string missing' };
  }
  if (secret.length < 8) {
    return { ok: false, kind: 'SHORT_SECRET', field: 'secret', message: 'secret must be at least 8 chars' };
  }
  const allowed = new Set(['serviceId', 'organizationId', 'connectionId', 'secret']);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      return { ok: false, kind: 'UNKNOWN_FIELD', field: key, message: 'unknown field in credential' };
    }
  }
  return { ok: true };
}

export const HrpAutomationLegacySignatureCredential = {
  name: 'hrpAutomationLegacySignature',
  displayName: 'HRP Automation Legacy Signature (sha256(input || secret))',
  description:
    'Project-local credential that holds the shared secret for the legacy SHA-256(input || secret) signer used by N8N/0.3. NOT HMAC.',
  properties: [
    {
      displayName: 'Service ID',
      name: 'serviceId',
      type: 'string',
      required: true,
      default: '',
    },
    {
      displayName: 'Organization ID',
      name: 'organizationId',
      type: 'string',
      required: true,
      default: '',
    },
    {
      displayName: 'Connection ID',
      name: 'connectionId',
      type: 'string',
      required: true,
      default: '',
    },
    {
      displayName: 'Shared Secret (legacy SHA-256, NOT HMAC)',
      name: 'secret',
      type: 'string',
      typeOptions: { password: true },
      required: true,
      default: '',
    },
  ],
  /** @this {HrpAutomationLegacySignatureCredential} */
  test: assertHrpAutomationLegacyCredentialFields,
};