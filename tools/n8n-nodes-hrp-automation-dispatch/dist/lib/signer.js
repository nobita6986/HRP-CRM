'use strict';

const { createHash } = require('node:crypto');

function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number in envelope');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('unsupported value in envelope');
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stripNonDigestFields(envelope) {
  const output = { ...envelope };
  delete output.correlationId;
  delete output.occurredAt;
  delete output.commandId;
  if (output.automationSource && typeof output.automationSource === 'object') {
    output.automationSource = { ...output.automationSource };
    delete output.automationSource.n8nExecutionId;
  }
  return output;
}

function payloadDigestHex(envelope) {
  return sha256Hex(Buffer.from(canonicalJson(stripNonDigestFields(envelope)), 'utf8'));
}

function scopeKeyFor({ organizationId, connectionId, serviceId, commandName, idempotencyKey }) {
  return [organizationId, connectionId, serviceId, commandName, idempotencyKey].join('\0');
}

function signLegacy(signingInput, secret) {
  return createHash('sha256')
    .update(Buffer.from(signingInput, 'utf8'))
    .update(Buffer.from(secret, 'utf8'))
    .digest('hex');
}

function assertOpaqueId(value, field, maximum = 128) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximum ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
  ) {
    throw new TypeError(`${field} is not a canonical opaque identifier`);
  }
}

function validateCredential(credential) {
  if (!credential || typeof credential !== 'object') throw new TypeError('credential is required');
  assertOpaqueId(credential.serviceId, 'serviceId');
  assertOpaqueId(credential.organizationId, 'organizationId');
  assertOpaqueId(credential.connectionId, 'connectionId');
  if (typeof credential.secret !== 'string' || credential.secret.length < 32) {
    throw new TypeError('secret must contain at least 32 characters');
  }
  const url = new URL(credential.gatewayUrl);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new TypeError('gatewayUrl must be an HTTPS URL without credentials, query or fragment');
  }
  url.pathname = url.pathname.replace(/\/+$/u, '');
  return { ...credential, gatewayUrl: url.toString().replace(/\/$/u, '') };
}

function validateAndBindEnvelope(envelope, credential) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new TypeError('envelope must be an object');
  }
  assertOpaqueId(envelope.commandName, 'commandName');
  assertOpaqueId(envelope.idempotencyKey, 'idempotencyKey', 256);
  if (envelope.organizationId !== credential.organizationId) {
    throw new TypeError('envelope organizationId does not match credential');
  }
  if (envelope?.source?.connectionId !== credential.connectionId) {
    throw new TypeError('envelope source.connectionId does not match credential');
  }
  if (envelope?.actor?.serviceId !== credential.serviceId) {
    throw new TypeError('envelope actor.serviceId does not match credential');
  }
}

function buildSignedRequest(envelope, credentialInput) {
  const credential = validateCredential(credentialInput);
  validateAndBindEnvelope(envelope, credential);
  const payloadDigest = payloadDigestHex(envelope);
  const scopeKey = scopeKeyFor({
    organizationId: credential.organizationId,
    connectionId: credential.connectionId,
    serviceId: credential.serviceId,
    commandName: envelope.commandName,
    idempotencyKey: envelope.idempotencyKey,
  });
  const signature = signLegacy(`${scopeKey}\n${payloadDigest}`, credential.secret);
  return {
    url: `${credential.gatewayUrl}/v1/automation/dispatch`,
    headers: {
      'Content-Type': 'application/json',
      'X-Hrp-Automation-Service-Id': credential.serviceId,
      'X-Hrp-Automation-Organization-Id': credential.organizationId,
      'X-Hrp-Automation-Connection-Id': credential.connectionId,
      'X-Hrp-Automation-Signature': signature,
    },
    body: envelope,
    payloadDigest,
  };
}

module.exports = {
  buildSignedRequest,
  canonicalJson,
  payloadDigestHex,
  scopeKeyFor,
  signLegacy,
  stripNonDigestFields,
  validateAndBindEnvelope,
  validateCredential,
};
