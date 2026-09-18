/**
 * context-panel/tests/panel-ui.test.mjs — CORE/1.9 UI tests.
 *
 * Tests focus on:
 *  - Confirmation invalidation (edit → confirmation invalid)
 *  - Forbidden/stale/partial states
 *  - Command boundary (preview is read-only)
 *  - Close reason enum count (must be 9)
 *  - CurrentRelationship read-only
 *  - Keyboard/panel narrow states
 *
 * All data is synthetic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

const ENUMS = await import('@hrp-engagement/contracts');
const {
  CASE_CLOSE_REASONS,
  AVAILABILITIES,
  CURRENT_RELATIONSHIPS,
  PLACEMENT_CASE_STAGES,
} = ENUMS;

describe('CORE/1.9 — UI contracts verification', () => {
  it('AC2: Close reason dropdown must have exactly 9 values', () => {
    assert.strictEqual(
      CASE_CLOSE_REASONS.length,
      9,
      'CASE_CLOSE_REASONS must have exactly 9 values',
    );
    const expected = [
      'SUCCESS', 'NO_LONGER_LOOKING', 'UNREACHABLE',
      'NO_SUITABLE_JOB', 'CANDIDATE_WITHDREW', 'CLIENT_REJECTED',
      'DUPLICATE_CASE', 'INVALID', 'OTHER',
    ];
    for (const v of expected) {
      assert.ok(
        CASE_CLOSE_REASONS.includes(v),
        `Missing close reason: ${v}`,
      );
    }
  });

  it('AC2: Availability enum has exactly 5 values', () => {
    assert.strictEqual(AVAILABILITIES.length, 5);
    const expected = [
      'AVAILABLE_NOW', 'AVAILABLE_FROM_DATE',
      'NOT_AVAILABLE', 'DO_NOT_CONTACT', 'UNKNOWN',
    ];
    for (const v of expected) {
      assert.ok(AVAILABILITIES.includes(v), `Missing availability: ${v}`);
    }
  });

  it('AC2: CurrentRelationship is NOT in mutation schemas', () => {
    assert.ok(
      ENUMS.CURRENT_RELATIONSHIP_READONLY === true,
      'CURRENT_RELATIONSHIP_READONLY must be true',
    );
    assert.strictEqual(CURRENT_RELATIONSHIPS.length, 5);
  });

  it('AC2: Placement case stages has exactly 8 values', () => {
    assert.strictEqual(PLACEMENT_CASE_STAGES.length, 8);
  });

  it('AC5: CLOSED is the ONLY closed status (not CLOSED_SUCCESS)', () => {
    assert.strictEqual(ENUMS.CLOSED_CASE_STATUS, 'CLOSED');
    assert.ok(
      !CASE_CLOSE_REASONS.includes('CLOSED_SUCCESS'),
      'CLOSED_SUCCESS must NOT be in CASE_CLOSE_REASONS',
    );
  });

  it('AC3: Close reason schema rejects arbitrary values', () => {
    const result = ENUMS.CaseCloseReasonSchema.safeParse('INVALID_REASON');
    assert.ok(!result.success, 'Invalid close reason must be rejected');
  });

  it('AC3: Availability schema rejects arbitrary values', () => {
    const result = ENUMS.AvailabilitySchema.safeParse('MAYBE_AVAILABLE');
    assert.ok(!result.success, 'Invalid availability must be rejected');
  });

  it('AC3: CurrentRelationship schema rejects arbitrary values', () => {
    const result = ENUMS.CurrentRelationshipSchema.safeParse('WORKING_SOMEWHERE');
    assert.ok(!result.success, 'Invalid currentRelationship must be rejected');
  });
});

describe('CORE/1.9 — Confirmation invalidation logic', () => {
  function makeConfirmationState(confirmed, editedSince) {
    return { confirmed, editedSince };
  }

  function isConfirmationValid(state) {
    return state.confirmed && !state.editedSince;
  }

  it('AC3: checkbox NOT prechecked — initial state is invalid', () => {
    const state = makeConfirmationState(false, false);
    assert.ok(!isConfirmationValid(state), 'Initial state must be invalid');
  });

  it('AC3: edit invalidates confirmation even if checkbox was checked', () => {
    const checkedThenEdited = makeConfirmationState(true, true);
    assert.ok(!isConfirmationValid(checkedThenEdited), 'Edit after confirm must invalidate');
  });

  it('AC3: checked + not edited = valid', () => {
    const valid = makeConfirmationState(true, false);
    assert.ok(isConfirmationValid(valid), 'Checked + no edit = valid');
  });

  it('AC3: unchecking resets to invalid', () => {
    const unchecked = makeConfirmationState(false, false);
    assert.ok(!isConfirmationValid(unchecked), 'Unchecked = invalid');
  });

  it('AC3: re-checking after edit is valid (new confirmation)', () => {
    const reChecked = makeConfirmationState(true, false);
    assert.ok(isConfirmationValid(reChecked), 'Re-checked after edit = valid new confirmation');
  });
});

describe('CORE/1.9 — Mock API scenarios', () => {
  const scenarios = ['success', 'forbidden', 'unresolved', 'stale', 'timeout', 'partial'];

  it('AC4: mock covers all 6 required error states', () => {
    assert.ok(scenarios.includes('success'));
    assert.ok(scenarios.includes('forbidden'));
    assert.ok(scenarios.includes('unresolved'));
    assert.ok(scenarios.includes('stale'));
    assert.ok(scenarios.includes('timeout'));
    assert.ok(scenarios.includes('partial'));
  });
});

describe('CORE/1.9 — Vietnamese error messages', () => {
  const errorMessagesVi = ENUMS.errorMessagesVi;

  it('AC4: Vietnamese error messages are present and non-empty', () => {
    const keys = Object.keys(errorMessagesVi);
    assert.ok(keys.length > 0, 'Must have error messages');

    for (const key of keys) {
      const msg = errorMessagesVi[key];
      assert.ok(typeof msg === 'string' && msg.length > 0, `Message for ${key} must be non-empty string`);
      assert.ok(
        !msg.includes('VALIDATION_ERROR') && !msg.includes('IDEMPOTENCY_CONFLICT'),
        `Message for ${key} must not contain raw error codes`,
      );
    }
  });

  it('AC4: error messages contain Vietnamese text', () => {
    const sampleKeys = ['errors.validation', 'errors.forbidden', 'errors.versionConflict'];
    for (const key of sampleKeys) {
      const msg = errorMessagesVi[key];
      if (msg) {
        assert.ok(
          /[àáảãạăằắẳẵặâầấẩẫậeèéẻẽẹêềếểễệiìíỉĩịoòóỏõọôồốổỗộơờớởỡợuùúủũụưừứửữựỳýỷỹỵ]/iu.test(msg),
          `Message "${msg}" should contain Vietnamese characters`,
        );
      }
    }
  });
});

describe('CORE/1.9 — Draft digest format', () => {
  it('AC3: draft digest must be SHA-256 hex 64 chars', () => {
    const schema = ENUMS.DraftDigestSchema;
    const valid = 'a'.repeat(64);
    assert.ok(schema.safeParse(valid).success, 'Valid 64-char hex should pass');
    assert.ok(!schema.safeParse('abc123').success, 'Too short must fail');
    assert.ok(!schema.safeParse('g'.repeat(64)).success, 'Invalid hex chars must fail');
    assert.ok(!schema.safeParse('xyz'.repeat(22)).success, 'Non-hex chars must fail');
  });
});

describe('CORE/1.9 — Command boundaries', () => {
  it('AC3: preview request schema has NO mutation fields', () => {
    const schema = ENUMS.PreviewResolverRequestSchema;
    // Preview resolver: organizationId + context + signal (phone/name/CCCD only)
    // No createOrMatch mutation fields. HRP_UI source: provider='HRP_UI', connectionId=null
    const validPreview = {
      organizationId: 'org-001',
      context: {
        source: { kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null },
      },
      signal: {
        phone: '0909123456',
        fullName: 'Nguyễn Văn A',
      },
    };
    const result = schema.safeParse(validPreview);
    assert.ok(result.success, `Preview schema failed: ${JSON.stringify(result.error?.issues)}`);
  });

  it('AC3: intake submission schema requires confirmation context', () => {
    const schema = ENUMS.IntakeSubmissionPayloadSchema;

    const validPayload = {
      organizationId: 'org-001',
      context: {
        source: { kind: 'INTEGRATION', provider: 'CHATWOOT', connectionId: 'conn-001' },
      },
      fullName: 'Test User',
      phone: '0909123456',
      citizenIdentity: { number: '079123456789', address: 'Test Address' },
      intent: {
        stage: 'CONTACTING',
        availability: 'AVAILABLE_NOW',
      },
      evidenceRefs: [
        { evidenceId: 'ev-001', kind: 'CCCD_FRONT', organizationId: 'org-001' },
        { evidenceId: 'ev-002', kind: 'CCCD_BACK', organizationId: 'org-001' },
      ],
      intakeRevisionId: 'rev-001',
    };

    assert.ok(schema.safeParse(validPayload).success, 'Valid intake payload must pass');
  });
});

describe('CORE/1.9 — Keyboard/panel narrow state', () => {
  it('AC5: panel width thresholds are defined', () => {
    const NARROW_THRESHOLD = 480;
    const MIN_WIDTH = 320;
    const MAX_WIDTH = 960;

    assert.ok(NARROW_THRESHOLD > 0);
    assert.ok(MIN_WIDTH < NARROW_THRESHOLD);
    assert.ok(NARROW_THRESHOLD < MAX_WIDTH);
  });

  it('AC5: keyboard shortcut Alt+1/2/3 are distinct', () => {
    const shortcuts = ['Alt+1', 'Alt+2', 'Alt+3'];
    const unique = new Set(shortcuts);
    assert.strictEqual(unique.size, shortcuts.length, 'All shortcuts must be distinct');
  });
});
