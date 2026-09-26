/**
 * scripts/build-embed-ui.mjs — B.03-PREP isolated embed-host UI bundle.
 *
 * Builds the React EmbedPanel into dist/embed-ui/bundle.js so the simulator
 * harness can load it as a sibling to the product UI bundle.
 *
 * SYNTHETIC ONLY. No real Chatwoot / HRP runtime.
 */
import * as esbuild from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const outDir = join(rootDir, 'dist/embed-ui');

const isProduction = process.env.NODE_ENV === 'production';

const buildOptions = {
  entryPoints: [join(rootDir, 'src/embed/embed-panel.tsx')],
  bundle: true,
  outfile: join(outDir, 'bundle.js'),
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  jsxImportSource: 'react',
  sourcemap: isProduction ? false : 'linked',
  minify: isProduction,
  logLevel: 'info',
  loader: {
    '.js': 'jsx',
  },
  define: {
    'process.env.NODE_ENV': isProduction ? '"production"' : '"development"',
  },
};

async function build() {
  console.log(`[build-embed-ui] Building embed-host UI (mode: ${isProduction ? 'production' : 'development'})`);
  mkdirSync(outDir, { recursive: true });
  await esbuild.build(buildOptions);

  const indexHtml = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="hrp-embed-panel" content="true">
<meta name="hrp-embed-panel-version" content="1">
<title>HRP Embed Panel — B.03-PREP (synthetic)</title>
<style>
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #fafafa; }
#root { min-height: 100vh; }
</style>
</head>
<body>
<noscript>JavaScript is required.</noscript>
<div id="root"></div>
<script type="module" src="./bundle.js"></script>
</body>
</html>
`;
  writeFileSync(join(outDir, 'index.html'), indexHtml);
  console.log(`[build-embed-ui] Build complete -> ${outDir}`);
}

build().catch((err) => {
  console.error('[build-embed-ui] Build failed:', err);
  process.exit(1);
});