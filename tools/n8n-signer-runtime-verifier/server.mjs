import { createHash, timingSafeEqual } from 'node:crypto';
import http from 'node:http';

const MAX_BODY_BYTES = 64 * 1024;
const HEADER_NAMES = Object.freeze({
  serviceId: 'x-hrp-automation-service-id',
  organizationId: 'x-hrp-automation-organization-id',
  connectionId: 'x-hrp-automation-connection-id',
  signature: 'x-hrp-automation-signature',
});

function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new TypeError('unsupported JSON value');
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

function sha256Hex(...parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(Buffer.from(part, 'utf8'));
  return hash.digest('hex');
}

function expectedSignature(envelope, identity, secret) {
  const digest = sha256Hex(canonicalJson(stripNonDigestFields(envelope)));
  const scope = [
    identity.organizationId,
    identity.connectionId,
    identity.serviceId,
    envelope.commandName,
    envelope.idempotencyKey,
  ].join('\0');
  return { digest, signature: sha256Hex(`${scope}\n${digest}`, secret) };
}

function fixedHexEqual(actual, expected) {
  if (!/^[a-f0-9]{64}$/u.test(actual ?? '')) return false;
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function sendJson(response, statusCode, body) {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-length': String(bytes.length),
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(bytes);
}

async function readJson(request) {
  const declared = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new RangeError('body too large');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new RangeError('body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createVerifier({ identity, secret }) {
  if (!secret || secret.length < 32) throw new TypeError('verifier secret must contain at least 32 characters');
  const receipts = new Map();
  return http.createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      return sendJson(response, 200, { status: 'ok', mode: 'SYNTHETIC_SIGNER_RUNTIME_VERIFIER' });
    }
    if (request.method !== 'POST' || request.url !== '/v1/automation/dispatch') {
      return sendJson(response, 404, { status: 'REJECTED', code: 'route_not_found' });
    }
    try {
      const envelope = await readJson(request);
      const presented = {
        serviceId: request.headers[HEADER_NAMES.serviceId],
        organizationId: request.headers[HEADER_NAMES.organizationId],
        connectionId: request.headers[HEADER_NAMES.connectionId],
      };
      if (Object.keys(identity).some((key) => presented[key] !== identity[key])) {
        return sendJson(response, 401, { status: 'REJECTED', code: 'identity_mismatch' });
      }
      if (
        envelope.organizationId !== identity.organizationId ||
        envelope?.source?.connectionId !== identity.connectionId ||
        envelope?.actor?.serviceId !== identity.serviceId
      ) {
        return sendJson(response, 403, { status: 'REJECTED', code: 'envelope_binding_mismatch' });
      }
      if (typeof envelope.commandName !== 'string' || typeof envelope.idempotencyKey !== 'string') {
        return sendJson(response, 422, { status: 'REJECTED', code: 'invalid_envelope' });
      }
      const verified = expectedSignature(envelope, identity, secret);
      if (!fixedHexEqual(request.headers[HEADER_NAMES.signature], verified.signature)) {
        return sendJson(response, 401, { status: 'REJECTED', code: 'signature_mismatch' });
      }
      const prior = receipts.get(envelope.idempotencyKey);
      if (prior && prior !== verified.digest) {
        return sendJson(response, 409, { status: 'REJECTED', code: 'idempotency_conflict' });
      }
      receipts.set(envelope.idempotencyKey, verified.digest);
      return sendJson(response, 200, {
        status: 'APPLIED',
        mode: 'SYNTHETIC_SIGNER_RUNTIME_VERIFIER',
        cached: Boolean(prior),
        payloadDigest: verified.digest,
      });
    } catch (error) {
      const statusCode = error instanceof RangeError ? 413 : 400;
      return sendJson(response, statusCode, { status: 'REJECTED', code: statusCode === 413 ? 'body_too_large' : 'invalid_json' });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) {
  const identity = {
    serviceId: process.env.VERIFIER_SERVICE_ID,
    organizationId: process.env.VERIFIER_ORGANIZATION_ID,
    connectionId: process.env.VERIFIER_CONNECTION_ID,
  };
  const secret = process.env.VERIFIER_SECRET;
  const port = Number(process.env.PORT ?? 8080);
  const server = createVerifier({ identity, secret });
  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(JSON.stringify({ event: 'verifier_ready', port, mode: 'SYNTHETIC_SIGNER_RUNTIME_VERIFIER' }) + '\n');
  });
}

export { canonicalJson, expectedSignature, stripNonDigestFields };
