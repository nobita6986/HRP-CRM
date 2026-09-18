import { startPanel } from '../dist/server.js';

const PANEL_CONFIG = {
  appKind: 'panel',
  nodeEnv: 'development',
  organizationId: 'org-001',
  schemaVersion: '1.0.0',
  contractsVersion: '0.0.8-g0.8-fixes',
  mockMode: 'deterministic',
  listen: { host: '127.0.0.1', port: 3786 },
  allowDevTools: false,
};

const server = await startPanel(PANEL_CONFIG);

try {
  const res = await fetch('http://127.0.0.1:3786/api/intake/dnc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-HRP-Staff-Id': 'staff-intake-001' },
    body: JSON.stringify({
      organizationId: 'org-001',
      target: { kind: 'TALENT', laborProfileId: 'lp-001' },
      reason: 'CANDIDATE_REQUEST',
      provider: 'CHATWOOT',
      connectionId: 'conn-mock-001',
      externalContactId: 'ext-001',
    }),
  });
  console.log('Status:', res.status);
  console.log('Body:', await res.text());
} finally {
  server.close();
}
