/**
 * context-panel/tests/routing-server-bootstrap.mjs — boot panel server on port 15501 for browser test.
 *
 * Spins up startPanel() with deterministic config; prints to stderr only.
 * Used by routing-browser-evidence.mjs.
 */

import { startPanel } from '../dist/server.js';
import { loadConfig } from '../../../packages/config/dist/index.js';

const env = {
  NODE_ENV: 'development',
  HRP_MOCK_MODE: 'deterministic',
  HRP_LISTEN_HOST: '127.0.0.1',
  HRP_LISTEN_PORT: '15501',
  HRP_ALLOW_DEV_TOOLS: 'true',
};
const { config } = loadConfig({ env, kind: 'panel' });

const server = await startPanel(config);
console.error(`routing-server-bootstrap: listening on http://${config.listen.host}:${config.listen.port}`);

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
