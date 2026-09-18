/**
 * event-normalizer.ts — CORE/1.5 (worker mirror)
 *
 * Worker-side event normalizer. Equivalent to integration-api/src/normalizer/event-normalizer.ts
 * but accepts MinimalParseResult instead of importing from receiver.
 *
 * Why duplicated instead of imported:
 *  - Worker and API are sibling packages (no file: dep).
 *  - Worker reads parsedBody from receipt.commandRefsJson (not from HTTP body).
 *  - Same logic, different scope: worker handles receipt rebuild, API handles raw webhook.
 */

import type { MinimalParseResult, MinimalScope } from '../types-shim.js';

/* ───────────────────────────────────────────────────────────────────────────
 * Inbound event types (worker's local mirror of contract enum).
 * ─────────────────────────────────────────────────────────────────────────── */
export const INBOUND_EVENT_TYPES = [
  'CONVERSATION_CREATED',
  'MESSAGE_CREATED',
  'CLIENT_MESSAGE_CREATED',
  'CONVERSATION_RESOLVED',
  'PARTICIPANT_ADDED',
  'AGENT_MESSAGE_ECHO',
  'PRIVATE_NOTE',
  'CONVERSATION_ASSIGNED',
  'CONVERSATION_STATUS_CHANGED',
  'CONVERSATION_LABELED',
  'MESSAGE_UPDATED',
  'MESSAGE_DELETED',
  'CLIENT_INBOUND_MESSAGE',
  'UNKNOWN_RAW',
  'OUT_OF_ORDER_RAW',
  'MAPPING_REVISION_CHANGED',
] as const;
export type InboundEventType = (typeof INBOUND_EVENT_TYPES)[number];

/* ───────────────────────────────────────────────────────────────────────────
 * InboundEvent — canonical normalized shape.
 * ─────────────────────────────────────────────────────────────────────────── */
export interface InboundEvent {
  eventType: InboundEventType;
  organizationId: string;
  provider: string;
  connectionId: string;
  eventId: string;
  /** Original eventId source per provider policy. */
  eventIdSource: 'primary' | 'fallback' | 'unknown';
  /** Provider-specific attributes that worker should NEVER trust as canonical. */
  senderKind: 'CONTACT' | 'AGENT' | 'BOT' | 'UNKNOWN';
  /** External account id — for resolve/link lookup. */
  senderId: string | null;
  /** Content preview for matching; never the content itself (privacy). */
  contentPreview: string | null;
  /** Meta flags. */
  isPrivateNote: boolean;
  isEcho: boolean;
  isOutbound: boolean;
  occurredAt: string | null;
  externalRefs: {
    conversationId: string | null;
    inboxId: string | null;
    assigneeId: string | null;
  };
  contactHints: {
    phone: string | null;
    email: string | null;
    fullName: string | null;
  };
  conversationHints: {
    conversationId: string | null;
    inboxId: string | null;
    status: string | null;
    labels: string[];
  };
  /** Producer flags — spoofing must not influence canonical. */
  flags: {
    hasHrpiAttribute: boolean;
    hasCustomAttribute: boolean;
    claimedBranchHint: 'TALENT' | 'CLIENT' | null;
  };
  /**
   * §AC5b: review confirmation token from reviewer/staff.
   * When present, it confirms staff-assisted conversion.
   * When missing AND claim would convert → BLOCKED / REVIEW_NEEDED.
   * Token is opaque; only schema-valid UUIDs are accepted.
   */
  reviewConfirmationToken: string | null;
  rawEventType: string;
  /** Mapping revision at the time of event receipt (for out-of-order detect). */
  mappingRevision: number | null;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Normalize result.
 * ─────────────────────────────────────────────────────────────────────────── */
export type NormalizeResult =
  | { ok: true; event: InboundEvent }
  | {
      ok: false;
      code:
        | 'MISSING_BODY'
        | 'INVALID_PAYLOAD'
        | 'MISSING_EVENT_TYPE'
        | 'MISSING_EVENT_ID'
        | 'PROVIDER_MISMATCH';
      message: string;
    };

/* ───────────────────────────────────────────────────────────────────────────
 * Helper: cast to minimal conversation attrs.
 * ─────────────────────────────────────────────────────────────────────────── */
function asAttr(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function classifyEventType(
  eventType: string,
  content: string | null,
  isPrivateNote: boolean,
  isOutbound: boolean,
): InboundEventType {
  // Note: order matters — private note overrides everything.
  if (isPrivateNote) return 'PRIVATE_NOTE';
  if (isOutbound) return 'AGENT_MESSAGE_ECHO';

  switch (eventType) {
    case 'conversation_created':
      return 'CONVERSATION_CREATED';
    case 'conversation_resolved':
      return 'CONVERSATION_RESOLVED';
    case 'conversation_status_changed':
      return 'CONVERSATION_STATUS_CHANGED';
    case 'conversation_assigned':
      return 'CONVERSATION_ASSIGNED';
    case 'conversation_labeled':
      return 'CONVERSATION_LABELED';
    case 'participant_added':
      return 'PARTICIPANT_ADDED';
    case 'message_updated':
      return 'MESSAGE_UPDATED';
    case 'message_deleted':
      return 'MESSAGE_DELETED';
    case 'message_created':
    case 'message':
      // Detect client inbound vs agent outbound already handled above.
      return 'CLIENT_INBOUND_MESSAGE';
    default:
      return 'UNKNOWN_RAW';
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * Main normalize entry.
 * ─────────────────────────────────────────────────────────────────────────── */
export function normalizeChatwootEvent(
  parse: MinimalParseResult,
  parsedBody: unknown,
  scope: MinimalScope,
): NormalizeResult {
  if (!parsedBody || typeof parsedBody !== 'object') {
    return {
      ok: false,
      code: 'MISSING_BODY',
      message: 'Parsed body is null or not an object',
    };
  }

  const body = parsedBody as Record<string, unknown>;
  const eventType = asString(body['event']) ?? '';
  if (!eventType) {
    return {
      ok: false,
      code: 'MISSING_EVENT_TYPE',
      message: 'Event body has no event type',
    };
  }

  // Chatwoot sends an `event` field with the type.
  // Plus message, conversation, sender payload.
  const messageAttr = asAttr(body['message']);
  const conversationAttr = asAttr(body['conversation']);
  const senderAttr = asAttr(body['sender']);

  // ─── classify sender ───
  let senderKind: InboundEvent['senderKind'] = 'UNKNOWN';
  const senderType = asNumber(senderAttr?.['type']);
  if (senderType === 0 || senderType === 1) {
    // Chatwoot user types
    const senderRole = asString(senderAttr?.['role']);
    if (senderRole === 'agent' || senderRole === 'administrator') {
      senderKind = 'AGENT';
    } else if (senderRole === 'bot') {
      senderKind = 'BOT';
    } else {
      senderKind = 'CONTACT';
    }
  }

  // ─── content / privacy ───
  const contentRaw =
    asString(messageAttr?.['content']) ??
    asString((messageAttr?.['processed_params'] as Record<string, unknown> | null)?.['content']);
  const isPrivateNote = contentRaw !== null
    && /(^|\s)private[_ -]?note(\s|$)|(^|\s)note(\s|$)/i.test(contentRaw.trim());

  // ─── outbound detection (agent send) ───
  // Chatwoot: outbound = sender is AGENT. `message.private=true` is for private notes,
  // not outbound. Treat agent sender as outbound (echo) only if not a private note.
  const isOutbound = !isPrivateNote && senderKind === 'AGENT';

  // ─── branch hint from custom attributes (UNTRUSTED — never used as canonical target) ───
  const customAttrs = asAttr(senderAttr?.['custom_attributes'])
    ?? asAttr(messageAttr?.['custom_attributes']);
  const hasHrpiAttribute = !!(
    customAttrs && (customAttrs['hrpi_branch'] || customAttrs['hrp_target_id'])
  );
  const claimedBranchHint: 'TALENT' | 'CLIENT' | null =
    customAttrs?.['hrpi_branch'] === 'TALENT' ? 'TALENT'
      : customAttrs?.['hrpi_branch'] === 'CLIENT' ? 'CLIENT'
        : null;

  // ─── contact hints from sender/messenger ───
  const phone =
    asString((senderAttr as Record<string, unknown>)['phone_number'])
    ?? asString(((senderAttr?.['messenger_details'] as Record<string, unknown> | null) ?? null)?.['phone']);
  const email = asString((senderAttr as Record<string, unknown>)['email']);
  const fullName = asString((senderAttr as Record<string, unknown>)['name']);

  // ─── conversation hints ───
  const conversationId = asString(conversationAttr?.['id']);
  const inboxId = asString((conversationAttr?.['inbox_id'] !== undefined
    ? String(conversationAttr['inbox_id'])
    : null))
    ?? (typeof conversationAttr?.['inbox_id'] === 'number'
      ? String(conversationAttr['inbox_id'])
      : null);
  const status = asString(conversationAttr?.['status']);
  const labels = asArray(conversationAttr?.['labels']);

  const resolvedEventType = classifyEventType(
    eventType,
    contentRaw,
    isPrivateNote,
    isOutbound,
  );

  // ─── assembly ───
  const event: InboundEvent = {
    eventType: resolvedEventType,
    organizationId: scope.organizationId,
    provider: scope.provider,
    connectionId: scope.connectionId,
    eventId: parse.eventId,
    eventIdSource: parse.eventIdSource,
    senderKind,
    senderId: asString(senderAttr?.['id']) ?? null,
    contentPreview: contentRaw !== null
      ? contentRaw.slice(0, 80).trim()
      : null,
    isPrivateNote,
    isEcho: isOutbound && senderKind === 'AGENT',
    isOutbound,
    occurredAt: asString((messageAttr?.['created_at']) ?? (body['timestamp'] as string | null)) ?? null,
    externalRefs: {
      conversationId,
      inboxId,
      assigneeId: asString(conversationAttr?.['assignee_id']) ?? null,
    },
    contactHints: {
      phone,
      email,
      fullName,
    },
    conversationHints: {
      conversationId,
      inboxId,
      status,
      labels,
    },
    flags: {
      hasHrpiAttribute,
      hasCustomAttribute: !!customAttrs,
      claimedBranchHint,
    },
    // §AC5b: review confirmation token is opaque, single-use, scope-bound.
    // Future CORE/1.6 will validate against `review_confirmation` table.
    reviewConfirmationToken: asString((customAttrs ?? null)?.['review_confirmation_token'] ?? null)
      ?? asString((body as Record<string, unknown>)['review_confirmation_token'] ?? null),
    rawEventType: eventType,
    // Aggregate version the provider claims (from external ref). When null,
    // worker treats as first observation. See pipeline-executor for §AC4.
    mappingRevision: asNumber(body['aggregate_version'])
      ?? asNumber((body as Record<string, unknown>)['aggregateVersion'])
      ?? null,
  };

  return { ok: true, event };
}
