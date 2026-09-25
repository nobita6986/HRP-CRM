// scripts/generate-evidence-manifest.mjs
// Generate manifest.sha256 for a CONTRACT-03C.2 evidence bundle.
//
// Manifest rules per the r2 plan / T0:
//  - SHA-256 of raw committed bytes.
//  - Repository-relative forward-slash paths.
//  - UTF-8 no BOM, LF.
//  - No self-hash.
//  - No absolute workstation paths.
//  - No node_modules, dist, or tarball binaries.
//
// Usage: node scripts/generate-evidence-manifest.mjs <bundle-dir>

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const BUNDLE_DIR = process.argv[2];
if (!BUNDLE_DIR) {
  console.error('usage: node generate-evidence-manifest.mjs <bundle-dir>');
  process.exit(2);
}

const EXCLUDE_DIRS = new Set(['node_modules', 'dist', '.git', '.tmp-probes', 'scratch']);
const EXCLUDE_FILES = new Set(['manifest.sha256', 'package-lock.json']);

function walk(dir, acc) {
  for (const name of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (!EXCLUDE_FILES.has(name)) acc.push(p);
  }
  return acc;
}

const files = walk(BUNDLE_DIR, []);
const lines = [];
for (const p of files) {
  const rel = relative(BUNDLE_DIR, p).split(sep).join('/');
  const data = readFileSync(p);
  const hash = createHash('sha256').update(data).digest('hex');
  lines.push(hash + '  ' + rel);
}
lines.sort();

const OUT = join(BUNDLE_DIR, 'manifest.sha256');
const text = lines.join('\n') + '\n';
writeFileSync(OUT, text, 'utf8');
console.log('manifest written:', OUT);
console.log('files hashed:', lines.length);
