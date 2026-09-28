'use strict';

class HrpAutomationLegacySignature {
  constructor() {
    this.name = 'hrpAutomationLegacySignature';
    this.displayName = 'HRP Automation Gateway Signature';
    this.documentationUrl = '';
    this.properties = [
      {
        displayName: 'Gateway Base URL',
        name: 'gatewayUrl',
        type: 'string',
        required: true,
        default: '',
        placeholder: 'https://crm-api.example.vn',
      },
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
        displayName: 'Shared Secret',
        name: 'secret',
        type: 'string',
        typeOptions: { password: true },
        required: true,
        default: '',
        description: 'Legacy SHA-256(signingInput || secret) profile; this is not HMAC.',
      },
    ];
  }
}

module.exports = { HrpAutomationLegacySignature };
