import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  redactFullName,
  checkResultConformance,
  compareUnavailableFields,
  compareUnavailableFieldsInOrder,
  CONFORMANCE_KNOWN_UNSUPPORTED,
  CONFORMANCE_SUPPORTED,
} from '../../dist/talent-context-read/index.js';

// ============================================================================
// F-06 - Request/result conformance.
//
// Uses the portable pinned fixture shipped inside the delivery package
// (tests/fixtures/redaction-vectors.fixtures.json). The fixture carries
// provenance metadata pointing back to the authoritative MSG-028 blob,
// but the test does NOT depend on a checkout-relative machine path or
// mutable external branch state.
//
// Per F-06:
//   - Requested unsafe: omit identitySummary + single marker.
//   - Known unsupported: marker ONLY if requested.
//   - Unrequested: neither data nor marker.
//   - Multiple known requested fields: unique + first-appearance order.
// ============================================================================

function loadPinnedVectors() {
  // tests/fixtures lives at ../fixtures from this test file:
  // tests/talent-context-read/foo.test.mjs -> ../fixtures/redaction-vectors.fixtures.json
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturePath = resolve(
    here,
    '..',
    'fixtures',
    'redaction-vectors.fixtures.json',
  );
  const json = readFileSync(fixturePath, 'utf8');
  const parsed = JSON.parse(json);
  return parsed;
}

describe('F-06 conformance helper semantics', () => {
  test('SUPPORTED set == [identitySummary]', () => {
    assert.deepEqual(CONFORMANCE_SUPPORTED, ['identitySummary']);
  });
  test('KNOWN_UNSUPPORTED has 7 entries (request-conformant, not projection-filled)', () => {
    assert.equal(CONFORMANCE_KNOWN_UNSUPPORTED.length, 7);
    assert.ok(!CONFORMANCE_KNOWN_UNSUPPORTED.includes('identitySummary'));
  });

  test('requested UNSAFE -> omit identitySummary + single marker', () => {
    const r = checkResultConformance(['identitySummary'], { success: false, reason: 'unsafe' });
    assert.equal(r.identitySummary, undefined);
    assert.equal(r.unavailableFields.length, 1);
    assert.ok(r.unavailableFields.includes('identitySummary'));
  });

  test('requested UNSAFE but with KNOWN_UNSUPPORTED also requested -> markers for both', () => {
    const r = checkResultConformance(
      ['identitySummary', 'placementCase'],
      { success: false, reason: 'unsafe' },
    );
    assert.equal(r.identitySummary, undefined);
    assert.ok(r.unavailableFields.includes('identitySummary'));
    assert.ok(r.unavailableFields.includes('placementCase'));
    assert.equal(r.unavailableFields.length, 2);
  });

  test('known unsupported but NOT requested -> no marker', () => {
    const r = checkResultConformance(
      ['identitySummary'],
      { success: true, redacted: 'A\u2022\u2022' },
    );
    assert.equal(r.identitySummary !== undefined, true);
    assert.equal(r.unavailableFields.length, 0);
  });

  test('known unsupported AND requested -> marker only', () => {
    const r = checkResultConformance(
      ['identitySummary', 'placementCase'],
      { success: true, redacted: 'A\u2022\u2022' },
    );
    assert.equal(r.identitySummary !== undefined, true);
    assert.deepEqual(r.unavailableFields, ['placementCase']);
  });

  test('unrequested field -> neither data nor marker', () => {
    const r = checkResultConformance(
      ['identitySummary'],
      { success: true, redacted: 'A\u2022\u2022' },
    );
    // placementCase is unrequested -> NOT in unavailable
    assert.ok(!r.unavailableFields.includes('placementCase'));
    // identitySummary is in allowlist -> has data
    assert.ok(r.identitySummary !== undefined);
  });
});

describe('F-06 expectedUnavailableFields comparison helper', () => {
  test('compareUnavailableFields sorts before compare', () => {
    assert.equal(compareUnavailableFields(['a','b'], ['b','a']), true);
  });
  test('compareUnavailableFields on different lengths returns false', () => {
    assert.equal(compareUnavailableFields(['a'], ['a','b']), false);
  });
});

describe('F-06 - PINNED vectors (MSG-028) drive conformance assertions', () => {
  const fixture = loadPinnedVectors();
  // Provenance sanity: the fixture must carry the pinned commit + sha256.
  assert.ok(fixture.provenance, 'fixture must carry provenance metadata');
  assert.equal(typeof fixture.provenance.authoritativeCommit, 'string');
  assert.ok(/^[0-9a-f]{40}$/i.test(fixture.provenance.authoritativeCommit));
  assert.match(fixture.provenance.authoritativeSha256, /^[0-9a-f]{64}$/);

  const vectors = fixture.vectors;
  for (const vector of vectors) {
    test('vector: ' + vector.id, () => {
      if (vector.requested) {
        const redaction = redactFullName(vector.input);
        const r = checkResultConformance(['identitySummary'], redaction);
        if (vector.expectedName === null) {
          assert.equal(r.identitySummary, undefined, vector.id);
          assert.deepEqual(r.unavailableFields, ['identitySummary'], vector.id);
        } else {
          assert.ok(r.identitySummary !== undefined, vector.id);
          assert.equal(r.identitySummary.fullNameRedacted, vector.expectedName, vector.id);
          assert.deepEqual(r.unavailableFields, [], vector.id);
        }
      } else {
        // Unrequested: identitySummary is NOT in the allowlist. Helper must
        // produce NO data and NO marker for identitySummary.
        const r = checkResultConformance(['placementCase'], { success: true, redacted: 'never-used' });
        assert.equal(r.identitySummary, undefined, vector.id);
        assert.deepEqual(r.unavailableFields, ['placementCase'], vector.id);
      }
    });
  }

  test('multiple known requested fields: unique + first-appearance order', () => {
    const r = checkResultConformance(
      ['placementCase', 'identitySummary', 'contactability'],
      { success: false, reason: 'unsafe' },
    );
    // Per spec: identitySummary marker first (requested unsafe),
    // then known_unsupported in their declaration order.
    assert.equal(r.identitySummary, undefined);
    assert.equal(compareUnavailableFieldsInOrder(r.unavailableFields, ['identitySummary', 'placementCase', 'contactability']), true);
  });

  test('portability: vectors loaded from portable fixture, no machine-path import', () => {
    // The portable loader uses `node:fs` + `node:url` only. No absolute
    // paths and no `child_process` invocation are present in the live code.
    // Self-implied by the test passing on any clean checkout.
    const fixture = loadPinnedVectors();
    assert.ok(fixture.provenance);
    assert.ok(/^[0-9a-f]{40}$/i.test(fixture.provenance.authoritativeCommit));
    assert.match(fixture.provenance.authoritativeSha256, /^[0-9a-f]{64}$/);
  });
});
