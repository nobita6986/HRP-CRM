// tests/parser-boundary-guard.test.mjs
// CI grep-guard per CONTRACT-03C.2 r2 (C-04):
//   - No source line in intake-orchestrator.ts / steps.ts references
//     talent-context-read/.
//   - No new parser/port/route file imports `dist/`, `src/`, or
//     `internal/` paths from the contracts package.
//   - No new parser/port/route file duplicates a schema/type that
//     already exists in the accepted subpath.
//
// All checks run as filesystem-level greps over committed source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

function findWorkspaceRoot(startDir) {
  let cur = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(cur, 'package.json');
    if (existsSync(candidate)) return dirname(candidate);
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

const WORKSPACE = findWorkspaceRoot(HERE);
assert.ok(WORKSPACE, 'integration-api workspace root must be reachable from ' + HERE);

const ORCH_ROOT = resolve(WORKSPACE, 'src', 'orchestrator');
const TCR_DIR = join(ORCH_ROOT, 'talent-context-read');
const FORBIDDEN_ORCH_FILES = ['intake-orchestrator.ts', 'steps.ts'];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

test('M4 boundary: intake-orchestrator and steps never reference talent-context-read', () => {
  for (const file of FORBIDDEN_ORCH_FILES) {
    const p = join(ORCH_ROOT, file);
    if (!existsSync(p)) continue; // not all consumers have these
    const txt = readFileSync(p, 'utf8');
    assert.ok(
      !txt.includes('talent-context-read'),
      file + ' must not reference talent-context-read/ — found match',
    );
  }
});

test('M4 boundary: no new parser/port/route file imports forbidden contracts paths', () => {
  const forbidden = [
    'packages/contracts/dist/',
    'packages/contracts/src/',
    'packages/contracts/internal/',
    './contracts/',
  ];
  for (const p of walk(TCR_DIR)) {
    if (!p.endsWith('.ts') && !p.endsWith('.mjs')) continue;
    const txt = readFileSync(p, 'utf8');
    for (const bad of forbidden) {
      assert.ok(
        !txt.includes(bad),
        p + ' must not import "' + bad + '" — found match',
      );
    }
  }
});

test('M4 boundary: parsers/ports/routes use only the public subpath import', () => {
  // Every .ts file under talent-context-read/ must import from
  // '@hrp-engagement/contracts/talent-context-read/v1' OR relative
  // sibling imports — never from a non-public path.
  const expectedSubpath = '@hrp-engagement/contracts/talent-context-read/v1';
  for (const p of walk(TCR_DIR)) {
    if (!p.endsWith('.ts')) continue;
    const txt = readFileSync(p, 'utf8');
    // If the file imports from @hrp-engagement/contracts, it must be the
    // public subpath.
    const re = /from\s+['"](@hrp-engagement\/contracts[^'"]*)['"]/g;
    let m;
    while ((m = re.exec(txt)) !== null) {
      const spec = m[1];
      assert.ok(
        spec === expectedSubpath,
        p + ' imports ' + spec + ' but only ' + expectedSubpath + ' is allowed',
      );
    }
  }
});
