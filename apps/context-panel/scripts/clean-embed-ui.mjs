#!/usr/bin/env node
/**
 * scripts/clean-embed-ui.mjs — clean dist/embed-ui for clean-build proof.
 *
 * Removes the dist/embed-ui directory (and the rollup cache inside it).
 * Used to prove `npm run build` does NOT depend on pre-existing dist.
 *
 * C-B03-03: clean snapshot + npm ci + npm run build must regenerate
 *   dist/embed-ui/index.html and bundle.js from scratch.
 */
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const target = join(rootDir, 'dist/embed-ui');

try {
  rmSync(target, { recursive: true, force: true });
  console.log(`[clean-embed-ui] removed ${target}`);
} catch (err) {
  console.error(`[clean-embed-ui] failed: ${err.message}`);
  process.exit(1);
}
