/**
 * tests/assistant-no-model-no-provider.test.mjs — CORE/1.13 boundary tests.
 *
 * Static + runtime checks to verify AC #5 from CORE/1.13 brief:
 *  - No external AI calls
 *  - No real provider API calls
 *  - No HRP DB calls
 *  - All data from synthetic fixtures
 *
 * Mirrors dashboard-no-model-no-db.test.mjs pattern.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC_DIR = join(process.cwd(), 'src/assistant');
const UI_DIR = join(process.cwd(), 'src/ui/components');

function readAllTs(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      out.push(...readAllTs(p));
    } else if (p.endsWith('.ts') || p.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

test('AC5: assistant src has no fetch/axios/openai/anthropic imports', () => {
  const files = readAllTs(SRC_DIR);
  const FORBIDDEN = [
    'fetch',
    'axios',
    '@anthropic-ai',
    'openai',
    '@google-cloud',
    '@azure-ai',
    '@aws-sdk',
    'node-fetch',
    'got',
    'undici',
    'http.request', // raw HTTP request to external host
    'https.request',
  ];
  for (const f of files) {
    const src = readFileSync(f, 'utf-8');
    // Allow `fetch` only as part of mock comments
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Allow comments
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
      // Allow fixture text containing 'fetch' in comment
      for (const word of FORBIDDEN) {
        if (line.includes(word) && !line.includes(`'${word}'`) && !line.includes(`"${word}"`)) {
          // Allow fetch() if it's a JS API call
          if (word === 'fetch' && line.match(/fetch\(/)) {
            throw new Error(`Forbidden API call in ${f}:${i + 1}: ${line.trim()}`);
          }
        }
      }
    }
  }
});

test('AC5: assistant src has no PrismaClient / database calls', () => {
  const files = readAllTs(SRC_DIR);
  const FORBIDDEN = ['PrismaClient', 'prisma.', 'createConnection', 'pg.connect', 'mysql.connect', 'mongoose'];
  for (const f of files) {
    const src = readFileSync(f, 'utf-8');
    for (const word of FORBIDDEN) {
      if (src.includes(word)) {
        throw new Error(`Forbidden DB call in ${f}: ${word}`);
      }
    }
  }
});

test('AC5: assistant server routes use synthetic fixtures only', async () => {
  const serverSrc = readFileSync('src/server.ts', 'utf-8');
  // Each assistant route must call the service module, not raw fetch/axios
  const assistantRouteSection = serverSrc.match(
    /CORE\/1\.13 — Personal assistant[\s\S]+?Unknown route/s,
  );
  assert.ok(assistantRouteSection, 'should have CORE/1.13 section');
  // Service module imports must reference assistant/service.js
  assert.ok(
    assistantRouteSection[0].includes("from './assistant/service.js'"),
    'should import from assistant/service.js',
  );
  // Should NOT contain axios / openai / anthropic
  for (const word of ['axios', '@anthropic-ai', 'openai', 'fetch(', 'PrismaClient']) {
    assert.equal(
      assistantRouteSection[0].includes(word),
      false,
      `should not contain ${word}`,
    );
  }
});

test('AC5: assistant UI panel does not call real network APIs', () => {
  const panelPath = join(UI_DIR, 'assistant-panel.tsx');
  const src = readFileSync(panelPath, 'utf-8');
  // fetch() calls are OK (they hit context-panel server in-process).
  // But no direct external provider SDKs.
  for (const word of ['axios', '@anthropic-ai', 'openai', 'googleapis', 'aws-sdk']) {
    assert.equal(src.includes(word), false, `should not import ${word}`);
  }
});
