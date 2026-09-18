/**
 * tests/pipeline.test.mjs — CORE/1.5
 *
 * Unit tests for worker pipeline components.
 *
 * Coverage AC:
 *  §AC1: Echo / private note / assign / resolve → NON_AUTHORITATIVE
 *  §AC2: Possible match / unresolved → CREATE_REVIEW
 *  §AC3: Talent vs Client branch hint is metadata only (never canonical)
 *  §AC4: Out-of-order / mapping revision change → BLOCKED
 *  §AC5: Conversation created → authoritative but no auto-createOrMatch
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChatwootEvent } from '../dist/normalizer-shim/event-normalizer.js';
import { classify } from '../dist/firewall.js';
import { createMockMappingService } from '../dist/mapping.js';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const CONN_ID = 'conn-test-1';

function buildChatwootBody(overrides = {}) {
  return {
    event: 'message_created',
    message: {
      id: 100,
      content: 'Hello, I am interested in the job',
      created_at: 1700000000,
      private: false,
    },
    conversation: {
      id: 500,
      status: 'open',
      inbox_id: 1,
      labels: [],
    },
    sender: {
      id: 'ext-001',
      type: 1,
      role: 'user',
      name: 'Nguyen Van A',
      email: 'a@example.com',
      phone_number: '+84909123456',
    },
    ...overrides,
  };
}

describe('normalizeChatwootEvent', () => {
  test('classifies inbound contact message as CLIENT_INBOUND_MESSAGE', () => {
    const body = buildChatwootBody();
    const result = normalizeChatwootEvent(
      {
        ok: true,
        eventType: 'message_created',
        eventId: 'evt-001',
        eventIdSource: 'primary',
        parsedBody: body,
      },
      body,
      { organizationId: ORG_ID, provider: 'CHATWOOT', connectionId: CONN_ID },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.event.eventType, 'CLIENT_INBOUND_MESSAGE');
    assert.equal(result.event.senderKind, 'CONTACT');
    assert.equal(result.event.senderId, 'ext-001');
    assert.equal(result.event.contactHints.phone, '+84909123456');
    assert.equal(result.event.isPrivateNote, false);
    assert.equal(result.event.isOutbound, false);
  });

  test('classifies agent outbound as AGENT_MESSAGE_ECHO', () => {
    const body = buildChatwootBody({
      sender: { id: 'agent-001', type: 0, role: 'agent' },
    });
    const result = normalizeChatwootEvent(
      {
        ok: true,
        eventType: 'message_created',
        eventId: 'evt-002',
        eventIdSource: 'primary',
        parsedBody: body,
      },
      body,
      { organizationId: ORG_ID, provider: 'CHATWOOT', connectionId: CONN_ID },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.event.eventType, 'AGENT_MESSAGE_ECHO');
    assert.equal(result.event.isOutbound, true);
  });

  test('detects private note as PRIVATE_NOTE regardless of sender', () => {
    const body = buildChatwootBody({
      message: { id: 200, content: 'private_note this is internal', private: true },
    });
    const result = normalizeChatwootEvent(
      {
        ok: true,
        eventType: 'message_created',
        eventId: 'evt-003',
        eventIdSource: 'primary',
        parsedBody: body,
      },
      body,
      { organizationId: ORG_ID, provider: 'CHATWOOT', connectionId: CONN_ID },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.event.eventType, 'PRIVATE_NOTE');
    assert.equal(result.event.isPrivateNote, true);
  });

  test('rejects missing body', () => {
    const result = normalizeChatwootEvent(
      {
        ok: true,
        eventType: 'message_created',
        eventId: 'evt-004',
        eventIdSource: 'primary',
        parsedBody: null,
      },
      null,
      { organizationId: ORG_ID, provider: 'CHATWOOT', connectionId: CONN_ID },
    );
    assert.equal(result.ok, false);
  });

  test('rejects missing event type', () => {
    const body = { event: null };
    const result = normalizeChatwootEvent(
      {
        ok: true,
        eventType: '',
        eventId: 'evt-005',
        eventIdSource: 'primary',
        parsedBody: body,
      },
      body,
      { organizationId: ORG_ID, provider: 'CHATWOOT', connectionId: CONN_ID },
    );
    assert.equal(result.ok, false);
  });

  test('treats hrpi_branch attribute as hint, never as canonical (§AC5b)', () => {
    // Note: §AC5b gate: hrpi_branch claim without review_confirmation_token
    // produces REVIEW_NEEDED (not AUTHORITATIVE). This test verifies the
    // firewall correctly demotes such an event.
    const body = buildChatwootBody({
      sender: {
        id: 'ext-200',
        type: 1,
        role: 'user',
        custom_attributes: { hrpi_branch: 'CLIENT', hrp_target_id: 'fake-target' },
      },
    });
    const result = normalizeChatwootEvent(
      {
        ok: true,
        eventType: 'message_created',
        eventId: 'evt-006',
        eventIdSource: 'primary',
        parsedBody: body,
      },
      body,
      { organizationId: ORG_ID, provider: 'CHATWOOT', connectionId: CONN_ID },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.event.flags.hasHrpiAttribute, true);
    assert.equal(result.event.flags.claimedBranchHint, 'CLIENT');
    // Per §AC5b: hrpi_branch claim + NO review_confirmation_token → REVIEW_NEEDED.
    // Tests with valid token are in tests/ac5-staff-assisted.test.mjs.
    const classification = classify(result.event);
    assert.equal(classification.classification, 'REVIEW_NEEDED');
    assert.equal(classification.reason.code, 'REVIEW_HRPI_ATTRIBUTE_SPOOF');
    // CRITICAL: suggestedCommand must be null (no auto gateway call).
    assert.equal(classification.suggestedCommand, null);
  });
});

describe('classify', () => {
  function inboundContact(overrides = {}) {
    return normalizeChatwootEvent(
      {
        ok: true,
        eventType: 'message_created',
        eventId: 'evt-100',
        eventIdSource: 'primary',
        parsedBody: buildChatwootBody(overrides),
      },
      buildChatwootBody(overrides),
      { organizationId: ORG_ID, provider: 'CHATWOOT', connectionId: CONN_ID },
    );
  }

  test('§AC1: inbound contact message → AUTHORITATIVE + recordInteraction', () => {
    const r = inboundContact();
    if (!r.ok) throw new Error('expected ok');
    const c = classify(r.event);
    assert.equal(c.classification, 'AUTHORITATIVE');
    assert.equal(c.suggestedCommand, 'recordInteraction');
    assert.equal(c.targetBranch, 'TALENT');
  });

  test('§AC1: private note → NON_AUTHORITATIVE', () => {
    const r = normalizeChatwootEvent(
      {
        ok: true,
        eventType: 'message_created',
        eventId: 'evt-101',
        eventIdSource: 'primary',
        parsedBody: buildChatwootBody({
          message: { content: 'private_note', private: true },
        }),
      },
      buildChatwootBody({
        message: { content: 'private_note', private: true },
      }),
      { organizationId: ORG_ID, provider: 'CHATWOOT', connectionId: CONN_ID },
    );
    if (!r.ok) throw new Error('expected ok');
    const c = classify(r.event);
    assert.equal(c.classification, 'NON_AUTHORITATIVE');
    assert.equal(c.reason.code, 'NON_AUTHORITATIVE_PRIVATE_NOTE');
  });

  test('§AC1: agent outbound → NON_AUTHORITATIVE (echo)', () => {
    const r = normalizeChatwootEvent(
      {
        ok: true,
        eventType: 'message_created',
        eventId: 'evt-102',
        eventIdSource: 'primary',
        parsedBody: buildChatwootBody({
          sender: { id: 'agent-1', type: 0, role: 'agent' },
        }),
      },
      buildChatwootBody({
        sender: { id: 'agent-1', type: 0, role: 'agent' },
      }),
      { organizationId: ORG_ID, provider: 'CHATWOOT', connectionId: CONN_ID },
    );
    if (!r.ok) throw new Error('expected ok');
    const c = classify(r.event);
    assert.equal(c.classification, 'NON_AUTHORITATIVE');
    assert.equal(c.reason.code, 'NON_AUTHORITATIVE_ECHO');
  });

  test('§AC1: conversation_resolved → NON_AUTHORITATIVE', () => {
    const body = buildChatwootBody({ event: 'conversation_resolved', message: undefined });
    const r = normalizeChatwootEvent(
      {
        ok: true,
        eventType: 'conversation_resolved',
        eventId: 'evt-103',
        eventIdSource: 'primary',
        parsedBody: body,
      },
      body,
      { organizationId: ORG_ID, provider: 'CHATWOOT', connectionId: CONN_ID },
    );
    if (!r.ok) throw new Error('expected ok');
    const c = classify(r.event);
    assert.equal(c.classification, 'NON_AUTHORITATIVE');
    assert.equal(c.reason.code, 'NON_AUTHORITATIVE_RESOLVED');
  });

  test('§AC1: conversation_assigned → NON_AUTHORITATIVE', () => {
    const body = buildChatwootBody({ event: 'conversation_assigned', message: undefined });
    const r = normalizeChatwootEvent(
      {
        ok: true,
        eventType: 'conversation_assigned',
        eventId: 'evt-104',
        eventIdSource: 'primary',
        parsedBody: body,
      },
      body,
      { organizationId: ORG_ID, provider: 'CHATWOOT', connectionId: CONN_ID },
    );
    if (!r.ok) throw new Error('expected ok');
    const c = classify(r.event);
    assert.equal(c.classification, 'NON_AUTHORITATIVE');
    assert.equal(c.reason.code, 'NON_AUTHORITATIVE_ASSIGNMENT');
  });

  test('§AC5: conversation_created → AUTHORITATIVE but no auto createOrMatch', () => {
    const body = buildChatwootBody({ event: 'conversation_created', message: undefined });
    const r = normalizeChatwootEvent(
      {
        ok: true,
        eventType: 'conversation_created',
        eventId: 'evt-105',
        eventIdSource: 'primary',
        parsedBody: body,
      },
      body,
      { organizationId: ORG_ID, provider: 'CHATWOOT', connectionId: CONN_ID },
    );
    if (!r.ok) throw new Error('expected ok');
    const c = classify(r.event);
    assert.equal(c.classification, 'AUTHORITATIVE');
    assert.equal(c.suggestedCommand, null);
  });

  test('§AC4: out-of-order → BLOCKED', () => {
    const r = normalizeChatwootEvent(
      {
        ok: true,
        eventType: 'message_created',
        eventId: 'evt-106',
        eventIdSource: 'primary',
        parsedBody: buildChatwootBody(),
      },
      buildChatwootBody(),
      { organizationId: ORG_ID, provider: 'CHATWOOT', connectionId: CONN_ID },
    );
    if (!r.ok) throw new Error('expected ok');
    const patched = Object.assign({}, r.event, { eventType: 'OUT_OF_ORDER_RAW' });
    const c = classify(patched);
    assert.equal(c.classification, 'BLOCKED');
    assert.equal(c.reason.code, 'BLOCKED_OUT_OF_ORDER');
  });

  test('§AC4: mapping revision changed → BLOCKED', () => {
    const r = normalizeChatwootEvent(
      {
        ok: true,
        eventType: 'message_created',
        eventId: 'evt-107',
        eventIdSource: 'primary',
        parsedBody: buildChatwootBody(),
      },
      buildChatwootBody(),
      { organizationId: ORG_ID, provider: 'CHATWOOT', connectionId: CONN_ID },
    );
    if (!r.ok) throw new Error('expected ok');
    const patched = Object.assign({}, r.event, { eventType: 'MAPPING_REVISION_CHANGED' });
    const c = classify(patched);
    assert.equal(c.classification, 'BLOCKED');
    assert.equal(c.reason.code, 'BLOCKED_MAPPING_REVISION_CHANGE');
  });
});

describe('createMockMappingService', () => {
  function eventBuilder(eventId, senderId) {
    return {
      eventType: 'CLIENT_INBOUND_MESSAGE',
      organizationId: ORG_ID,
      provider: 'CHATWOOT',
      connectionId: CONN_ID,
      eventId,
      eventIdSource: 'primary',
      senderKind: 'CONTACT',
      senderId,
      contentPreview: 'hello',
      isPrivateNote: false,
      isEcho: false,
      isOutbound: false,
      occurredAt: null,
      externalRefs: { conversationId: null, inboxId: null, assigneeId: null },
      contactHints: { phone: null, email: null, fullName: null },
      conversationHints: { conversationId: null, inboxId: null, status: null, labels: [] },
      flags: { hasHrpiAttribute: false, hasCustomAttribute: false, claimedBranchHint: null },
      rawEventType: 'message_created',
      mappingRevision: null,
    };
  }

  function authoritative() {
    return {
      classification: 'AUTHORITATIVE',
      reason: {
        code: 'AUTHORITATIVE_CLIENT_MESSAGE',
        message: 'Inbound contact message',
      },
      suggestedCommand: 'recordInteraction',
      targetBranch: 'TALENT',
    };
  }

  test('§AC1: NON_AUTHORITATIVE → SKIP', () => {
    const ms = createMockMappingService();
    const result = ms.resolve({
      event: eventBuilder('evt-200', 'ext-001'),
      classification: {
        classification: 'NON_AUTHORITATIVE',
        reason: {
          code: 'NON_AUTHORITATIVE_PRIVATE_NOTE',
          message: 'private',
        },
        suggestedCommand: null,
        targetBranch: null,
      },
    });
    assert.equal(result.action.type, 'SKIP');
  });

  test('§AC1: BLOCKED → BLOCKED', () => {
    const ms = createMockMappingService();
    const result = ms.resolve({
      event: eventBuilder('evt-201', 'ext-002'),
      classification: {
        classification: 'BLOCKED',
        reason: { code: 'BLOCKED_OUT_OF_ORDER', message: 'ooo' },
        suggestedCommand: null,
        targetBranch: null,
      },
    });
    assert.equal(result.action.type, 'BLOCKED');
  });

  test('§AC2: AUTHORITATIVE + no senderId → CREATE_REVIEW (UNRESOLVED)', () => {
    const ms = createMockMappingService();
    const result = ms.resolve({
      event: eventBuilder('evt-202', null),
      classification: authoritative(),
    });
    assert.equal(result.action.type, 'CREATE_REVIEW');
    assert.ok(result.resolution.reviewQueueEntryId);
  });

  test('AUTHORITATIVE with senderId → CALL_GATEWAY or CREATE_REVIEW (deterministic by seed)', () => {
    const ms = createMockMappingService();
    let sawGateway = false;
    let sawReview = false;
    for (let i = 0; i < 20; i++) {
      const result = ms.resolve({
        event: eventBuilder(`evt-${300 + i}`, `sender-${i}`),
        classification: authoritative(),
      });
      if (result.action.type === 'CALL_GATEWAY') {
        sawGateway = true;
        assert.equal(result.resolution.state, 'EXACT_MATCH');
      } else if (result.action.type === 'CREATE_REVIEW') {
        sawReview = true;
        assert.match(result.action.reasonCode, /POSSIBLE_MATCH|UNRESOLVED/);
      }
    }
    assert.ok(sawGateway || sawReview, 'mock service must exercise at least one branch');
  });

  test('§AC3: Talent vs Client branch is decided by mapping, not Chatwoot hints', () => {
    const ms = createMockMappingService();
    const event = eventBuilder('evt-400', 'ext-100');
    event.flags = {
      hasHrpiAttribute: true,
      hasCustomAttribute: true,
      claimedBranchHint: 'CLIENT',
    };
    const result = ms.resolve({
      event,
      classification: authoritative(),
    });
    if (result.action.type === 'CALL_GATEWAY') {
      assert.equal(result.resolution.laborProfileId !== null, true);
      assert.equal(result.resolution.clientContactId, null);
    }
  });
});

describe('pipeline integration', () => {
  test('§AC1: private note flows through as SKIPPED outcome (no action)', async () => {
    const body = buildChatwootBody({
      message: { content: 'private_note internal only', private: true },
    });
    const r = normalizeChatwootEvent(
      {
        ok: true,
        eventType: 'message_created',
        eventId: 'evt-500',
        eventIdSource: 'primary',
        parsedBody: body,
      },
      body,
      { organizationId: ORG_ID, provider: 'CHATWOOT', connectionId: CONN_ID },
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const classification = classify(r.event);
    const ms = createMockMappingService();
    const result = await ms.resolve({ event: r.event, classification });
    assert.equal(result.action.type, 'SKIP');
    assert.equal(classification.classification, 'NON_AUTHORITATIVE');
  });

  test('§AC2: AUTHORITATIVE + senderId leading to POSSIBLE_MATCH → CREATE_REVIEW', async () => {
    const body = buildChatwootBody({ sender: { id: 'X', type: 1, role: 'user' } });
    const r = normalizeChatwootEvent(
      {
        ok: true,
        eventType: 'message_created',
        eventId: 'X',
        eventIdSource: 'primary',
        parsedBody: body,
      },
      body,
      { organizationId: ORG_ID, provider: 'CHATWOOT', connectionId: CONN_ID },
    );
    if (!r.ok) throw new Error('expected ok');
    const classification = classify(r.event);
    const ms = createMockMappingService();
    const result = await ms.resolve({ event: r.event, classification });
    assert.equal(classification.classification, 'AUTHORITATIVE');
    assert.equal(result.action.type, 'CREATE_REVIEW');
  });
});
