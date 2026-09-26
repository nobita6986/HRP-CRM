/**
 * tests/embed-host-route-guard.test.mjs — B.03-PREP C-B03-02 route guard tests.
 *
 * Covers the full mock-off route matrix:
 *   /embed-panel/, /embed-panel/*, /embed-host-simulator,
 *   /api/embed/talent-context-read, /api/embed/seed, /api/embed/revoke
 *
 * When mockMode === 'off' OR nodeEnv === 'production', guardEmbedSurface
 * returns a 404 verdict. isEmbedSurfacePath recognizes the full surface.
 *
 * When mockMode === 'deterministic' AND nodeEnv !== 'production' the guard
 * returns null (caller proceeds).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  guardEmbedSurface,
  isEmbedSurfacePath,
} from '../dist/embed/route-guard.js';

describe('C-B03-02 — isEmbedSurfacePath recognizes the full surface', () => {
  const positive = [
    '/embed-panel',
    '/embed-panel/',
    '/embed-panel/index.html',
    '/embed-panel/bundle.js',
    '/embed-host-simulator',
    '/api/embed/talent-context-read',
    '/api/embed/seed',
    '/api/embed/revoke',
  ];
  for (const p of positive) {
    it(`recognizes ${p}`, () => {
      assert.strictEqual(isEmbedSurfacePath(p), true);
    });
  }
  const negative = [
    '/',
    '/api/context',
    '/api/intake/preview',
    '/api/routing/pools',
    '/api/dashboard/snapshot',
    '/api/assistant/today',
  ];
  for (const p of negative) {
    it(`does NOT recognize ${p} as embed surface`, () => {
      assert.strictEqual(isEmbedSurfacePath(p), false);
    });
  }
});

describe('C-B03-02 — guardEmbedSurface fail-closed matrix', () => {
  it('returns 404 when mockMode === "off" (development)', () => {
    const out = guardEmbedSurface({ mockMode: 'off', nodeEnv: 'development' });
    assert.notStrictEqual(out, null);
    if (out !== null) {
      assert.strictEqual(out.status, 404);
      assert.ok(out.body.error.length > 0);
    }
  });
  it('returns 404 when nodeEnv === "production" (regardless of mock mode)', () => {
    const out = guardEmbedSurface({ mockMode: 'deterministic', nodeEnv: 'production' });
    assert.notStrictEqual(out, null);
    if (out !== null) assert.strictEqual(out.status, 404);
  });
  it('returns 404 when production AND mock off', () => {
    const out = guardEmbedSurface({ mockMode: 'off', nodeEnv: 'production' });
    assert.notStrictEqual(out, null);
  });
  it('returns null when development + mockMode = deterministic', () => {
    const out = guardEmbedSurface({ mockMode: 'deterministic', nodeEnv: 'development' });
    assert.strictEqual(out, null);
  });
  it('returns null when development + mockMode = "on" (legacy alias)', () => {
    const out = guardEmbedSurface({ mockMode: 'on', nodeEnv: 'development' });
    assert.strictEqual(out, null);
  });
  it('production override beats mock mode "deterministic"', () => {
    const out = guardEmbedSurface({ mockMode: 'deterministic', nodeEnv: 'production' });
    assert.notStrictEqual(out, null);
    if (out !== null) assert.strictEqual(out.status, 404);
  });
});
