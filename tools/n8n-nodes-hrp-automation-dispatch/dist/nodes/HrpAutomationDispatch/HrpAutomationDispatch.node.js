'use strict';

const { buildSignedRequest } = require('../../lib/signer.js');

function parseEnvelope(value) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      throw new TypeError('envelope is not valid JSON');
    }
  }
  return value;
}

class HrpAutomationDispatch {
  constructor() {
    this.description = {
      displayName: 'HRP Automation Dispatch',
      name: 'hrpAutomationDispatch',
      group: ['transform'],
      version: 1,
      description: 'Signs and dispatches one CRM automation envelope without exposing the signature.',
      defaults: { name: 'HRP Automation Dispatch' },
      inputs: ['main'],
      outputs: ['main'],
      credentials: [{ name: 'hrpAutomationLegacySignature', required: true }],
      properties: [
        {
          displayName: 'Envelope',
          name: 'envelope',
          type: 'json',
          required: true,
          default: '={{ $json.envelope ?? $json }}',
          description: 'AutomationRequest envelope. Identity fields must match the selected credential.',
        },
        {
          displayName: 'Timeout (ms)',
          name: 'timeoutMs',
          type: 'number',
          default: 5000,
          typeOptions: { minValue: 1000, maxValue: 15000 },
        },
      ],
    };
  }

  async execute() {
    const items = this.getInputData();
    const output = [];
    for (let index = 0; index < items.length; index += 1) {
      const credential = await this.getCredentials('hrpAutomationLegacySignature', index);
      const envelope = parseEnvelope(this.getNodeParameter('envelope', index));
      const timeout = this.getNodeParameter('timeoutMs', index, 5000);
      let signed;
      try {
        signed = buildSignedRequest(envelope, credential);
      } catch (error) {
        throw new Error(`HRP automation signing rejected item ${index}: ${error.message}`);
      }

      let response;
      try {
        response = await this.helpers.httpRequest({
          method: 'POST',
          url: signed.url,
          headers: signed.headers,
          body: signed.body,
          json: true,
          timeout,
          returnFullResponse: true,
          ignoreHttpStatusErrors: true,
        });
      } catch {
        throw new Error(`HRP automation dispatch failed for item ${index}`);
      }

      output.push({
        json: {
          statusCode: response?.statusCode ?? null,
          body: response?.body ?? null,
          commandId: envelope.commandId ?? null,
          correlationId: envelope.correlationId ?? null,
          idempotencyKey: envelope.idempotencyKey,
          payloadDigest: signed.payloadDigest,
          signatureProfile: 'LEGACY_SHA256_INPUT_SECRET',
        },
        pairedItem: { item: index },
      });
    }
    return [output];
  }
}

module.exports = { HrpAutomationDispatch, parseEnvelope };
