/**
 * tests/redaction-mask.test.mjs — B.03-PREP UI-side projection guard tests.
 *
 * Covers src/embed/redaction.ts:
 *   - assertAllowed accepts a valid TalentContextReadResult
 *   - rejects payloads containing forbidden fields (phone, cccd, etc.)
 *   - rejects identitySummary.fullNameRedacted that does not match the
 *     shared contracts redaction algorithm (defense-in-depth)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { assertAllowed, displayLabel, unavailableFieldsOf } from '../dist/embed/redaction.js';
import { redactFullName } from '../dist/embed/session-registry.js';

function buildValidResult() {
  // Use the shared redaction algorithm to produce a valid fullNameRedacted
  // so the defense-in-depth check passes.
  const redacted = redactFullName('Nguyễn Văn An');
  if (!redacted.success) throw new Error('redact failed');
  return {
    schemaVersion: '1',
    correlationId: 'corr-12345678',
    organizationId: 'org-001',
    target: { kind: 'TALENT', laborProfileId: 'lp-001' },
    identitySummary: {
      schemaVersion: '1',
      fullNameRedacted: redacted.redacted,
      displayOnly: true,
    },
    unavailableFields: [],
    resolvedAt: '2026-09-26T07:00:00.000Z',
  };
}

describe('B.03-PREP — assertAllowed (UI-side projection guard)', () => {
  it('accepts a valid TalentContextReadResult with redacted identitySummary', () => {
    const r = assertAllowed(buildValidResult());
    assert.strictEqual(r.ok, true);
    if (r.ok) {
      assert.ok(r.redacted.identitySummary?.fullNameRedacted.length > 0);
    }
  });

  it('accepts a result without identitySummary (unavailableFields lists it)', () => {
    const result = buildValidResult();
    delete (result).identitySummary;
    result.unavailableFields = ['identitySummary'];
    const r = assertAllowed(result);
    assert.strictEqual(r.ok, true);
  });

  for (const forbidden of ['phone', 'cccd', 'phoneRedacted', 'citizenIdentity', 'rawLaborProfile', 'laborProfile', 'adminToken', 'serviceToken', 'hrpApiKey', 'crmApiKey']) {
    it(`rejects projection that smuggles top-level "${forbidden}"`, () => {
      const result = { ...buildValidResult(), [forbidden]: 'leak' };
      const r = assertAllowed(result);
      assert.strictEqual(r.ok, false);
      if (!r.ok) {
        // Either strict Zod rejects unknown top-level keys (INVALID_RESULT)
        // or the denylist walker catches the named pattern (FORBIDDEN_FIELD_PRESENT).
        assert.ok(['FORBIDDEN_FIELD_PRESENT', 'INVALID_RESULT'].includes(r.code));
      }
    });

    it(`rejects projection that smuggles nested "${forbidden}" inside identitySummary`, () => {
      const result = buildValidResult();
      result.identitySummary = { ...result.identitySummary, [forbidden]: 'leak' };
      const r = assertAllowed(result);
      assert.strictEqual(r.ok, false);
      if (!r.ok) {
        assert.ok(['FORBIDDEN_FIELD_PRESENT', 'INVALID_RESULT'].includes(r.code));
      }
    });
  }

  it('rejects identitySummary that fails the shared redaction algorithm', () => {
    const result = buildValidResult();
    // Strip the bullet chars -> not a redaction algorithm output.
    result.identitySummary.fullNameRedacted = 'Nguyen Van An';
    const r = assertAllowed(result);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, 'REDACTION_UNSAFE');
  });

  it('rejects identitySummary with displayOnly=false', () => {
    const result = buildValidResult();
    result.identitySummary.displayOnly = false;
    const r = assertAllowed(result);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, 'INVALID_RESULT');
  });

  it('rejects unknown top-level field (strict Zod)', () => {
    const result = { ...buildValidResult(), internalHrpFields: {} };
    const r = assertAllowed(result);
    assert.strictEqual(r.ok, false);
    if (!r.ok) {
      // Strict Zod rejects unknown top-level keys -> INVALID_RESULT.
      assert.ok(['FORBIDDEN_FIELD_PRESENT', 'INVALID_RESULT'].includes(r.code));
    }
  });

  it('rejects non-object input', () => {
    const r = assertAllowed('a string');
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, 'INVALID_RESULT');
  });

  it('rejects null input', () => {
    const r = assertAllowed(null);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, 'INVALID_RESULT');
  });
});

describe('B.03-PREP — displayLabel helper', () => {
  it('returns fullNameRedacted when identitySummary present', () => {
    const result = buildValidResult();
    const r = displayLabel(result);
    assert.ok(r.length > 0);
    assert.notStrictEqual(r, 'Nguyễn Văn An');
  });

  it('returns a hidden target marker when identitySummary absent', () => {
    const r = buildValidResult();
    delete r.identitySummary;
    r.unavailableFields = ['identitySummary'];
    assert.match(displayLabel(r), /<hidden target=lp-001>/);
  });
});

describe('B.03-PREP — unavailableFieldsOf helper', () => {
  it('returns the unavailableFields array as-is', () => {
    assert.deepStrictEqual([...unavailableFieldsOf(buildValidResult())], []);
    const r = buildValidResult();
    r.unavailableFields = ['identitySummary'];
    assert.deepStrictEqual([...unavailableFieldsOf(r)], ['identitySummary']);
  });
});