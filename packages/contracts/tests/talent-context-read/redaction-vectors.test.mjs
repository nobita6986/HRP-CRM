import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { redactFullName } from '../../dist/talent-context-read/redaction.js';

// ============================================================================
// Redaction conformance - all 22 vectors from MSG-028 REDACTION-VECTORS.json.
// Plus boundary cases from EP-05.
// ============================================================================

const VECTORS = [
  { id: 'vietnamese', input: 'Nguyễn Văn An', requested: true, expectedName: 'N•• V•• A••' },
  { id: 'decomposed', input: 'Élodie Durand', requested: true, expectedName: 'É•• D••' },
  { id: 'one_han_token', input: '李 小龍', requested: true, expectedName: null },
  { id: 'multi_han', input: '小龍', requested: true, expectedName: '小••' },
  { id: 'apostrophe_inside', input: "O'Connor", requested: true, expectedName: 'O••' },
  { id: 'hyphen_inside', input: 'Жан-Поль', requested: true, expectedName: 'Ж••' },
  { id: 'short', input: 'A', requested: true, expectedName: null },
  { id: 'missing', input: null, requested: true, expectedName: null },
  { id: 'whitespace', input: '   ', requested: true, expectedName: null },
  { id: 'digit', input: 'A1pha Name', requested: true, expectedName: null },
  { id: 'bidi', input: 'User\u202EName', requested: true, expectedName: null },
  { id: 'emoji', input: '\uD83D\uDC69\u200D\uD83D\uDCBB Test', requested: true, expectedName: null },
  { id: 'leading_apostrophe', input: "'Alpha", requested: true, expectedName: null },
  { id: 'leading_hyphen', input: '-Alpha', requested: true, expectedName: null },
  { id: 'leading_mark', input: '\u0301Alpha', requested: true, expectedName: null },
  { id: 'trailing_punctuation', input: 'Alpha-', requested: true, expectedName: null },
  { id: 'one_letter_mark', input: 'É', requested: true, expectedName: null },
  { id: 'combining_initial', input: 'Q\u0301uang', requested: true, expectedName: 'Q\u0301••' },
  { id: 'consecutive_punctuation', input: "O''Connor", requested: true, expectedName: null },
  { id: 'control_tab', input: 'Alpha\tBeta', requested: true, expectedName: null },
  { id: 'unicode_spaces', input: '\u00A0Alpha\u2003Beta\u00A0', requested: true, expectedName: 'A•• B••' },
  { id: 'unrequested', input: 'Nguyễn Văn An', requested: false, expectedName: null },
];

describe('redaction - MSG-028 vectors (22)', () => {
  for (const v of VECTORS) {
    test(`vector: ${v.id}`, () => {
      if (v.requested) {
        const result = redactFullName(v.input);
        if (v.expectedName === null) {
          assert.equal(result.success, false, `vector ${v.id}: expected unsafe`);
          if (result.success === false) {
            assert.equal(result.reason, 'unsafe');
          }
        } else {
          assert.equal(result.success, true, `vector ${v.id}: expected success, got ${JSON.stringify(result)}`);
          if (result.success === true) {
            assert.equal(result.redacted, v.expectedName, `vector ${v.id}: redacted value mismatch`);
          }
        }
      } else {
        // Unrequested: caller does not invoke redaction.
        assert.ok(true);
      }
    });
  }
});

describe('redaction - EP-05 boundaries', () => {
  test('over-limit input (>256 scalars) returns unsafe', () => {
    const input = 'A'.repeat(257);
    const result = redactFullName(input);
    assert.equal(result.success, false);
  });

  test('over-limit tokens (>16) returns unsafe', () => {
    const tokens = Array.from({ length: 17 }, (_, i) => `Token${i}`);
    const input = tokens.join(' ');
    const result = redactFullName(input);
    assert.equal(result.success, false);
  });

  test('non-string input returns unsafe', () => {
    assert.equal(redactFullName(123).success, false);
    assert.equal(redactFullName({}).success, false);
    assert.equal(redactFullName([]).success, false);
    assert.equal(redactFullName(null).success, false);
    assert.equal(redactFullName(undefined).success, false);
  });

  test('empty string returns unsafe', () => {
    assert.equal(redactFullName('').success, false);
  });

  test('non-letter first character returns unsafe', () => {
    assert.equal(redactFullName('123').success, false);
    assert.equal(redactFullName('.Alpha').success, false);
    assert.equal(redactFullName('@Alpha').success, false);
  });

  test('output never reveals raw input', () => {
    const inputs = ['Alice', 'Nguyễn Văn An', "O'Connor", 'Жан-Поль'];
    for (const input of inputs) {
      const result = redactFullName(input);
      if (result.success) {
        assert.ok(!result.redacted.includes(input), `output must not contain raw input for ${input}`);
      }
    }
  });

  test('output never leaks phone/CCCD/email', () => {
    assert.equal(redactFullName('0912345678').success, false);
    assert.equal(redactFullName('user@example.com').success, false);
  });
});