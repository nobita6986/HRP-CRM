/**
 * fixtures-fix-f2-gateway-hrpui.test.mjs — F2 follow-up recheck:
 * HrpGatewayCallContextSchema phải parse được HRP_UI source path
 * qua INBOUND_DEFAULT tier (HRP_UI internal — provider='HRP_UI'
 * connectionId=null), giữ regression cho tier privileged/reviewer
 * và integration external yêu cầu connectionId hợp lệ.
 *
 * T1 ghi nhận F2 follow-up sau khi Auditor recheck đợt F1–F5:
 * - HRP_UI source path phải parse được qua INBOUND_DEFAULT.
 * - External provider (CHATWOOT/ZALO_OA) vẫn cần connectionId hợp lệ.
 * - Provider không hợp lệ / context mâu thuẫn bị reject.
 * - INBOUND_REVIEWER / PRIVILEGED_MERGE KHÔNG được có
 *   provider/connectionId (regression tier/privileged).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION } from '../dist/enums.js';
import { HrpGatewayCallContextSchema } from '../dist/commands/gateway.js';

const org = 'org-test-hrpui-001';
const correlationId = 'trace-hrpui-f2-001';

test('F2-followup: HRP_UI source qua INBOUND_DEFAULT pass (provider=HRP_UI, connectionId=null)', () => {
  // HRP_UI internal source: provider='HRP_UI', connectionId=null.
  const r = HrpGatewayCallContextSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    tier: 'INBOUND_DEFAULT',
    correlationId,
    provider: 'HRP_UI',
    connectionId: null,
  });
  assert.equal(r.success, true, `HRP_UI INBOUND_DEFAULT phải pass, error=${JSON.stringify(r.error?.issues)}`);
  assert.equal(r.data.provider, 'HRP_UI');
  assert.equal(r.data.connectionId, null);
  assert.equal(r.data.tier, 'INBOUND_DEFAULT');
});

test('F2-followup: HRP_UI source KHÔNG truyền connectionId cũng pass (optional+nullable)', () => {
  // HRP_UI internal source: không truyền connectionId (undefined).
  const r = HrpGatewayCallContextSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    tier: 'INBOUND_DEFAULT',
    correlationId,
    provider: 'HRP_UI',
  });
  assert.equal(
    r.success,
    true,
    `HRP_UI INBOUND_DEFAULT thiếu connectionId vẫn pass, error=${JSON.stringify(r.error?.issues)}`,
  );
  assert.equal(r.data.provider, 'HRP_UI');
});

test('F2-followup: HRP_UI provider KHÔNG hợp lệ với connectionId string — reject', () => {
  // HRP_UI là internal source; truyền connectionId string bị reject.
  const r = HrpGatewayCallContextSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    tier: 'INBOUND_DEFAULT',
    correlationId,
    provider: 'HRP_UI',
    connectionId: 'conn-fake-123',
  });
  assert.equal(
    r.success,
    false,
    'HRP_UI provider với connectionId string phải bị reject',
  );
  assert.ok(
    r.error.issues.some((i) => i.path.includes('connectionId')),
    'phải có issue ở path connectionId',
  );
});

test('F2-followup: External provider CHATWOOT thiếu connectionId — reject', () => {
  const r = HrpGatewayCallContextSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    tier: 'INBOUND_DEFAULT',
    correlationId,
    provider: 'CHATWOOT',
  });
  assert.equal(
    r.success,
    false,
    'CHATWOOT thiếu connectionId phải bị reject',
  );
  assert.ok(
    r.error.issues.some((i) => i.path.includes('connectionId')),
    'phải có issue ở path connectionId',
  );
});

test('F2-followup: External provider ZALO_OA thiếu connectionId — reject', () => {
  const r = HrpGatewayCallContextSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    tier: 'INBOUND_DEFAULT',
    correlationId,
    provider: 'ZALO_OA',
  });
  assert.equal(r.success, false);
  assert.ok(r.error.issues.some((i) => i.path.includes('connectionId')));
});

test('F2-followup: Provider không hợp lệ (khoảng trắng) — reject bởi ProviderNameSchema', () => {
  const r = HrpGatewayCallContextSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    tier: 'INBOUND_DEFAULT',
    correlationId,
    provider: 'INVALID PROVIDER',
    connectionId: 'conn-1',
  });
  assert.equal(
    r.success,
    false,
    'provider có khoảng trắng phải bị reject bởi ProviderNameSchema regex',
  );
});

test('F2-followup: Context mâu thuẫn — INBOUND_REVIEWER có provider — reject', () => {
  const r = HrpGatewayCallContextSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    tier: 'INBOUND_REVIEWER',
    correlationId,
    provider: 'HRP_UI',
  });
  assert.equal(
    r.success,
    false,
    'INBOUND_REVIEWER có provider phải bị reject',
  );
  assert.ok(r.error.issues.some((i) => i.path.includes('provider')));
});

test('F2-followup: Context mâu thuẫn — PRIVILEGED_MERGE có provider external — reject', () => {
  const r = HrpGatewayCallContextSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    tier: 'PRIVILEGED_MERGE',
    correlationId,
    provider: 'CHATWOOT',
    connectionId: 'conn-cw-1',
  });
  assert.equal(
    r.success,
    false,
    'PRIVILEGED_MERGE có provider external phải bị reject',
  );
  assert.ok(r.error.issues.some((i) => i.path.includes('provider')));
});

test('F2-followup: Regression — INBOUND_REVIEWER tier không provider/connectionId pass', () => {
  const r = HrpGatewayCallContextSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    tier: 'INBOUND_REVIEWER',
    correlationId,
  });
  assert.equal(
    r.success,
    true,
    'INBOUND_REVIEWER không provider/connectionId phải pass',
  );
  assert.equal(r.data.tier, 'INBOUND_REVIEWER');
});

test('F2-followup: Regression — PRIVILEGED_MERGE tier không provider/connectionId pass', () => {
  const r = HrpGatewayCallContextSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    tier: 'PRIVILEGED_MERGE',
    correlationId,
  });
  assert.equal(
    r.success,
    true,
    'PRIVILEGED_MERGE không provider/connectionId phải pass',
  );
  assert.equal(r.data.tier, 'PRIVILEGED_MERGE');
});

test('F2-followup: Regression — INBOUND_DEFAULT với CHATWOOT + connectionId hợp lệ pass', () => {
  const r = HrpGatewayCallContextSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    tier: 'INBOUND_DEFAULT',
    correlationId,
    provider: 'CHATWOOT',
    connectionId: 'conn-cw-f2-followup',
  });
  assert.equal(
    r.success,
    true,
    'INBOUND_DEFAULT integration đầy đủ pass',
  );
  assert.equal(r.data.provider, 'CHATWOOT');
  assert.equal(r.data.connectionId, 'conn-cw-f2-followup');
});

test('F2-followup: Regression — INBOUND_DEFAULT thiếu provider bị reject', () => {
  const r = HrpGatewayCallContextSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    tier: 'INBOUND_DEFAULT',
    correlationId,
  });
  assert.equal(
    r.success,
    false,
    'INBOUND_DEFAULT thiếu provider phải bị reject',
  );
  assert.ok(r.error.issues.some((i) => i.path.includes('provider')));
});

test('F2-followup: connectionId với null literal vẫn pass cho integration null', () => {
  // Edge case: provider hợp lệ external nhưng connectionId null
  // (rõ ràng sai) — phải reject vì external yêu cầu connectionId.
  const r = HrpGatewayCallContextSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    organizationId: org,
    tier: 'INBOUND_DEFAULT',
    correlationId,
    provider: 'ZALO_OA',
    connectionId: null,
  });
  assert.equal(
    r.success,
    false,
    'provider external với connectionId null phải bị reject',
  );
});
