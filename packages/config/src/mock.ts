/**
 * config/src/mock.ts — mock mode helpers.
 *
 * CORE/1.0:
 *  - Mock chỉ chạy khi nodeEnv !== production.
 *  - Production + mock = startup fail (security guard).
 *  - `isProductionEnv` đọc NODE_ENV.
 *  - `isMockAllowed` kiểm tra mock mode có cho phép ở env hiện tại.
 */

import { MOCK_MODES, type MockMode, type NodeEnv, NODE_ENVS } from './types.js';

/**
 * Parse NodeEnv từ env string. Không throw — fallback 'development'.
 */
export function parseNodeEnv(raw: string | undefined): NodeEnv {
  if (raw && (NODE_ENVS as readonly string[]).includes(raw)) {
    return raw as NodeEnv;
  }
  return 'development';
}

/**
 * Check env có phải production hay không.
 */
export function isProductionEnv(env: Record<string, string | undefined>): boolean {
  return parseNodeEnv(env['NODE_ENV']) === 'production';
}

/**
 * Check mockMode có cho phép ở env hiện tại không.
 * - Production: KHÔNG (false).
 * - Development/test: CÓ (true).
 */
export function isMockAllowed(
  env: Record<string, string | undefined>,
  mockMode: MockMode,
): boolean {
  if (mockMode === 'off') return false;
  return !isProductionEnv(env);
}

/**
 * Validate mockMode literal.
 */
export function parseMockMode(raw: string | undefined): MockMode {
  if (raw && (MOCK_MODES as readonly string[]).includes(raw)) {
    return raw as MockMode;
  }
  return 'off';
}
