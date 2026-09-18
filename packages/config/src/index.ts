/**
 * config/src/index.ts — CORE/1.0 public surface.
 */
export type { RuntimeConfig, ApiConfig, WorkerConfig, PanelConfig, AppKind } from './types.js';
export { loadConfig, assertNotProductionMock, ConfigSchema, FORBIDDEN_ENV_KEYS } from './loader.js';
export { RuntimeConfigSchema } from './types.js';
export type { LoadConfigOptions, LoadConfigResult } from './loader.js';
export { isMockAllowed, isProductionEnv, parseMockMode, parseNodeEnv } from './mock.js';
