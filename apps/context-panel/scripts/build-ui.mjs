/**
 * scripts/build-ui.mjs — CORE/1.9 React UI build script using esbuild.
 *
 * Bundles src/ui/app.tsx → dist/ui/bundle.js (ESM, es2022 target)
 * Creates dist/ui/index.html that loads bundle.js as ES module.
 *
 * Features:
 * - React JSX automatic runtime (jsx: 'automatic')
 * - ESM output with source maps in dev mode
 * - Minification in production (NODE_ENV=production)
 * - Bundles React (no external CDN)
 */

import * as esbuild from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const outDir = join(rootDir, 'dist/ui');

const isProduction = process.env.NODE_ENV === 'production';
const sourcemap = isProduction ? false : 'linked';

/**
 * esbuild configuration for bundling React UI.
 *
 * Key settings:
 * - format: 'esm' — ES module output, loadable via <script type="module">
 * - target: 'es2022' — modern browser target
 * - jsx: 'automatic' — React 17+ JSX transform without explicit React import
 * - sourcemap — linked sourcemaps in dev, none in production
 * - minify — enabled in production for smaller bundle size
 */
const buildOptions = {
  entryPoints: [join(rootDir, 'src/ui/app.tsx')],
  bundle: true,
  outfile: join(outDir, 'bundle.js'),
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  jsxImportSource: 'react',
  sourcemap,
  minify: isProduction,
  metafile: true,
  logLevel: 'info',
  loader: {
    // Ensure JSON imports work (esbuild handles JSON by default with esModuleInterop)
  },
  define: {
    // React DevTools support in dev
    'process.env.NODE_ENV': isProduction ? '"production"' : '"development"',
  },
};

/**
 * Build the React UI bundle.
 */
async function build() {
  console.log(`[build-ui] Building React UI (mode: ${isProduction ? 'production' : 'development'})`);

  // Ensure output directory exists
  mkdirSync(outDir, { recursive: true });

  // Bundle with esbuild
  const result = await esbuild.build(buildOptions);

  // Log bundle size
  if (result.metafile) {
    const outputs = result.metafile.outputs;
    for (const [file, info] of Object.entries(outputs)) {
      const sizeKB = (info.bytes / 1024).toFixed(2);
      console.log(`[build-ui] Output: ${file} (${sizeKB} KB)`);
    }
  }

  console.log(`[build-ui] Build complete → ${outDir}`);
}

/**
 * Write dist/ui/index.html that loads the bundled JS as ES module.
 */
function writeIndexHtml() {
  const indexHtml = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="hrp-contracts-version" content="0.0.8-g0.8-fixes">
<meta name="hrp-app-version" content="1.0.0-core1.9">
<meta name="hrp-mock-mode" content="true">
<title>HRP Context Panel — CORE/1.9 (mock UI)</title>
<style>
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #fafafa; }
#root { min-height: 100vh; }
</style>
</head>
<body>
<noscript>JavaScript is required.</noscript>
<div id="root"></div>
<!-- CORE/1.9 mock UI · contracts 0.0.8-g0.8-fixes · not embedded Chatwoot · branding proposal -->
<script type="module" src="./bundle.js"></script>
</body>
</html>
`;

  writeFileSync(join(outDir, 'index.html'), indexHtml);
  console.log('[build-ui] Written index.html');
}

// Run build
build()
  .then(() => {
    writeIndexHtml();
    console.log('[build-ui] Done.');
  })
  .catch((err) => {
    console.error('[build-ui] Build failed:', err);
    process.exit(1);
  });
