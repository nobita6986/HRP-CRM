/**
 * config/examples/env.synthetic.example.ts — synthetic env values cho CORE/1.0.
 *
 * KHÔNG có giá trị thật. Chỉ marker synthetic. Copy từng dòng vào .env
 * của mỗi app khi cần test local.
 */

import type { NodeEnv, MockMode } from '../src/types.js';

export const SYNTHETIC_ENV_EXAMPLES = {
  // Common
  NODE_ENV: 'development' satisfies NodeEnv,
  HRP_MOCK_MODE: 'deterministic' satisfies MockMode,
  HRP_ORGANIZATION_ID: 'org-synthetic-001',

  // API app
  HRP_LISTEN_HOST: '127.0.0.1',
  HRP_LISTEN_PORT: '4001',
  HRP_MOCK_ROUTES: '/health,/mock/integration',
  HRP_REQUEST_TIMEOUT_MS: '15000',

  // CORE/1.2 — webhook receiver (synthetic env)
  HRP_RECEIVER_ENABLED: 'true',
  HRP_RECEIVER_MAX_BODY_BYTES: '262144',
  HRP_RECEIVER_RATE_LIMIT_PER_MIN: '600',
  // Synthetic HMAC secrets (per provider+connection). Real keys are Phase 9.
  HRP_WEBHOOK_SECRET_CHATWOOT_CONN_SYNTH_001: 'synthetic-hmac-secret-chatwoot-do-not-use',
  HRP_WEBHOOK_SECRET_ZALO_OA_CONN_SYNTH_001: 'synthetic-hmac-secret-zalo-oa-do-not-use',
  HRP_WEBHOOK_SECRET_GENERIC_CONN_SYNTH_001: 'synthetic-hmac-secret-generic-do-not-use',

  // Worker app
  HRP_POLL_INTERVAL_MS: '5000',
  HRP_LEASE_DURATION_MS: '60000',
  HRP_MAX_CONCURRENT_JOBS: '4',

  // Panel app
  HRP_ALLOW_DEV_TOOLS: 'true',

  // Deterministic clock (tests)
  HRP_NOW_EPOCH_MS: '1700000000000',
} as const;

/**
 * Build synthetic env object từ example.
 */
export function buildSyntheticEnv(): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(SYNTHETIC_ENV_EXAMPLES)) {
    result[k] = v;
  }
  // Forbidden keys phải KHÔNG có mặt.
  return result;
}
