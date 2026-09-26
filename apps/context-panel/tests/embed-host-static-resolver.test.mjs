// B.03-PREP — C-B03-02 — static path containment.
//
// Probes are intentionally explicit about every C-B03-02 vector (dot
// segments, encoded traversal, Windows separators, UNC-like leading
// slashes, out-of-root paths).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { join, normalize, sep } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = 'dist/embed-ui';
const { decodeForPathCheck, resolveSafeStaticPath } = require('../dist/embed/static-resolver.js');

test('C-B03-02 — decodeForPathCheck decodes %2e, %2f, %5c to canonical form', () => {
  assert.equal(decodeForPathCheck('%2e%2e'), '..');
  assert.equal(decodeForPathCheck('%2f'), '/');
  assert.equal(decodeForPathCheck('%5c'), '/');
  assert.equal(decodeForPathCheck('%2E%2E'), '..');
});

test('C-B03-02 — decodeForPathCheck rejects NUL bytes (literal and %00)', () => {
  assert.equal(decodeForPathCheck('index\u0000.html'), '');
  assert.equal(decodeForPathCheck('foo%00bar'), '');
});

test('C-B03-02 — decodeForPathCheck normalizes literal backslashes', () => {
  assert.equal(decodeForPathCheck('a\\b\\c'), 'a/b/c');
});

test('C-B03-02 — resolveSafeStaticPath rejects dot segments', () => {
  assert.equal(resolveSafeStaticPath(ROOT, '../package.json'), null);
  assert.equal(resolveSafeStaticPath(ROOT, 'a/../../package.json'), null);
});

test('C-B03-02 — resolveSafeStaticPath rejects encoded traversal', () => {
  assert.equal(resolveSafeStaticPath(ROOT, '%2e%2e/package.json'), null);
  assert.equal(resolveSafeStaticPath(ROOT, 'a/%2e%2e/%2e%2e/package.json'), null);
  assert.equal(resolveSafeStaticPath(ROOT, '..%2fpackage.json'), null);
});

test('C-B03-02 — resolveSafeStaticPath rejects Windows separators', () => {
  assert.equal(resolveSafeStaticPath(ROOT, '..\\package.json'), null);
  assert.equal(resolveSafeStaticPath(ROOT, '%5c..%5cpackage.json'), null);
});

test('C-B03-02 — resolveSafeStaticPath rejects UNC-style leading slashes', () => {
  assert.equal(resolveSafeStaticPath(ROOT, '//server/share/file'), null);
});

test('C-B03-02 — resolveSafeStaticPath rejects drive-letter absolute paths', () => {
  assert.equal(resolveSafeStaticPath(ROOT, 'C:/Windows/system32'), null);
  assert.equal(resolveSafeStaticPath(ROOT, 'D:\\\\evil'), null);
});

test('C-B03-02 — resolveSafeStaticPath rejects NUL byte injection', () => {
  assert.equal(resolveSafeStaticPath(ROOT, 'index\u0000.html'), null);
  assert.equal(resolveSafeStaticPath(ROOT, 'foo%00bar.html'), null);
});

test('C-B03-02 — resolveSafeStaticPath: canonical regression /embed-panel/../../package.json', () => {
  // Encoded as it would appear on the wire (the leading slash becomes
  // a single URL fragment slash that the resolver strips).
  assert.equal(resolveSafeStaticPath(ROOT, '/../../package.json'), null);
});

test('C-B03-02 — resolveSafeStaticPath: encoded dotdot variant %2e%2e%2fpackage.json', () => {
  assert.equal(resolveSafeStaticPath(ROOT, '%2e%2e%2fpackage.json'), null);
});

test('C-B03-02 — resolveSafeStaticPath: percent-encoded slash + dot segments', () => {
  assert.equal(resolveSafeStaticPath(ROOT, 'a/%2e%2e/b'), null);
});

test('C-B03-02 — resolveSafeStaticPath: out-of-root after normalize is rejected', () => {
  // '/a/b' where joined path is `${cwd}/dist/embed-ui/a/b`. Inside root -> accept.
  const inside = resolveSafeStaticPath(ROOT, 'a/b/index.html');
  assert.notEqual(inside, null);
  assert.ok(normalize(join(process.cwd(), inside)).startsWith(normalize(join(process.cwd(), ROOT)) + sep));
});

test('C-B03-02 — resolveSafeStaticPath: containment after normalize', () => {
  const inside = resolveSafeStaticPath(ROOT, 'index.html');
  assert.notEqual(inside, null);
  const outside = resolveSafeStaticPath(ROOT, 'a/../../outside.txt');
  assert.equal(outside, null);
});

test('C-B03-02 — resolveSafeStaticPath accepts plain nested assets', () => {
  const r1 = resolveSafeStaticPath(ROOT, 'index.html');
  assert.equal(r1, join(ROOT, 'index.html'));
  const r2 = resolveSafeStaticPath(ROOT, 'assets/main.css');
  assert.equal(r2, join(ROOT, 'assets/main.css'));
});

test('C-B03-02 — resolveSafeStaticPath strips a single leading fragment slash', () => {
  const r = resolveSafeStaticPath(ROOT, '/index.html');
  assert.equal(r, join(ROOT, 'index.html'));
});