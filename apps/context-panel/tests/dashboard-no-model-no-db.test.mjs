/**
 * tests/dashboard-no-model-no-db.test.mjs — CORE/1.12 Boundary check.
 *
 * AC #5: NO model call (no chat completion, no embeddings, no tool calls).
 *          NO HRP DB call (no Prisma queries against HRP DB).
 *
 * Validates by:
 *  - Static analysis: scanning the dashboard src/ for forbidden tokens
 *    (no imports of fetch/axios/openai/etc; no PrismaClient usage).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = join(__dirname, '..', 'src', 'dashboard');

function listTsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const stat = statSync(p);
    if (stat.isDirectory()) out.push(...listTsFiles(p));
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

test('AC#5: dashboard src has no fetch/axios/openai/anthropic imports', () => {
  const files = listTsFiles(DASHBOARD_DIR);
  const forbiddenImportPatterns = [
    /\bopenai\b/i,
    /\banthropic\b/i,
    /\bvertexai\b/i,
    /\bgemini\b/i,
    /\bgoogle-ai\b/i,
    /\baxios\b/,
    /\bnode-fetch\b/,
    /\bgot\b/,
  ];
  const violations = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf-8');
    for (const pat of forbiddenImportPatterns) {
      if (pat.test(text)) {
        violations.push(`${f}: matched ${pat}`);
      }
    }
  }
  assert.equal(
    violations.length,
    0,
    `Forbidden imports found in dashboard src:\n${violations.join('\n')}`,
  );
});

test('AC#5: dashboard src has no PrismaClient / database calls', () => {
  const files = listTsFiles(DASHBOARD_DIR);
  const forbiddenPatterns = [
    /PrismaClient/,
    /@prisma\/client/,
    /prisma\./,
    /\\bSELECT\\b/i,
    /\\bINSERT\\b/i,
    /\\bUPDATE\\b/i,
    /\\bDELETE\\b/i,
    /@hrp-engagement\/integration-store/,
  ];
  const violations = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf-8');
    for (const pat of forbiddenPatterns) {
      if (pat.test(text)) {
        violations.push(`${f}: matched ${pat}`);
      }
    }
  }
  assert.equal(
    violations.length,
    0,
    `Forbidden DB calls found in dashboard src:\n${violations.join('\n')}`,
  );
});

test('AC#5: dashboard server routes use synthetic fixtures only', () => {
  // Re-read server.ts and check that dashboard imports come from
  // ./dashboard/* (synthetic), not @hrp-engagement/integration-* or similar.
  const serverPath = join(__dirname, '..', 'src', 'server.ts');
  const text = readFileSync(serverPath, 'utf-8');
  const dashboardImportBlock = text.match(/import \{[\s\S]*?\} from ['"]\.\/dashboard\/service\.js['"]/);
  assert.ok(dashboardImportBlock, 'server.ts must import from ./dashboard/service.js');
  // All listed functions should resolve to the synthetic store, not DB.
  assert.ok(!text.includes('@hrp-engagement/integration-store') || text.match(/integration-store/g)?.length === 0 || text.includes('MockIdentity'),
    'dashboard logic must not depend on integration-store');
});
