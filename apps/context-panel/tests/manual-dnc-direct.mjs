import { executeDncAction } from '../dist/orchestrator/dnc-handler.js';
import { createMockGateway } from '../dist/gateway/index.js';

const session = { gw: createMockGateway({ now: () => 1700000000000 }) };

const input = {
  organizationId: 'org-001',
  provider: 'CHATWOOT',
  connectionId: 'conn-mock-001',
  externalContactId: 'ext-001',
  canonicalId: 'lp-001',
  reason: 'CANDIDATE_REQUEST',
  note: 'test',
  idempotencyKey: 'dnc-test-1',
  correlationId: 'corr-dnc-1',
  actor: { kind: 'USER', userId: 'staff-intake-001' },
};

// emulate buildGatewayCaller (mock — no serverSession)
const caller = async (args) => {
  return session.gw.call({
    schemaVersion: '1',
    organizationId: args.organizationId,
    commandId: `cmd-${args.method}`,
    idempotencyKey: args.idempotencyKey,
    correlationId: args.correlationId,
    method: args.method,
    context: {
      schemaVersion: '1',
      organizationId: args.organizationId,
      tier: 'INBOUND_DEFAULT',
      correlationId: args.correlationId,
      provider: 'CHATWOOT',
      connectionId: 'conn-mock-001',
    },
    actor: args.actor,
    scenarioId: args.scenarioId,
    payload: args.payload,
  });
};

const result = await executeDncAction(input, caller);
console.log('Result:', result);
