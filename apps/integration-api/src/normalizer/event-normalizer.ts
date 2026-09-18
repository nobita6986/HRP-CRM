/**
 * normalize/event-normalizer.ts — CORE/1.5
 *
 * Provider event → InboundEvent normalize.
 *
 * Policy:
 *  - Raw Chatwoot/Zalo body → InboundEvent (canonical classification).
 *  - Classification dựa trên event type + content markers + sender attributes.
 *  - KHÔNG tự suy canonical target — chỉ extract hints cho mapping.
 *  - Staff-created (agent outbound) = echo = NON_AUTHORITATIVE.
 *  - Private note (content marker) = NON_AUTHORITATIVE.
 *  - Assignment / label events = metadata only.
 *  - Talent vs Client distinction: dựa trên Chatwoot inbox/conversation
 *    attributes và content markers, KHÔNG tin Chatwoot labels để gán
 *    canonical target.
 *
 * AC coverage:
 *  §AC1: Chỉ event authoritative tạo action.
 *  §AC3: Talent/Client branches tách.
 *  §AC5: Chat-created không tự gọi createOrMatch.
 */
import type { InboundEventType } from './event-types.js';
import type { ParseResult } from '../receiver/protocol-fixture.js';

/* ───────────────────────────────────────────────────────────────────────────
 * InboundEvent — normalized event shape.
 * ─────────────────────────────────────────────────────────────────────────── */
export interface InboundEvent {
  /** Canonical event type. */
  eventType: InboundEventType;
  /** Raw event ID từ provider. */
  eventId: string;
  /** Raw Chatwoot event type (e.g. "message_created"). */
  rawEventType: string;
  /** Provider name. */
  provider: string;
  /** Scope. */
  organizationId: string;
  connectionId: string;
  /**
   * Confidence: cao = authoritative event có thể tạo action;
   *              thấp = non-authoritative hoặc ambiguous.
   */
  confidence: 'high' | 'medium' | 'low';
  /** Contact hints extracted from body — chỉ là GỢI Ý, KHÔNG canonical. */
  contactHints: ContactHints;
  /** Conversation hints extracted from body. */
  conversationHints: ConversationHints;
  /**
   * Content of the event (message body, note, etc.).
   * Truncated to 200 chars for safety.
   */
  contentPreview: string;
  /** Timestamp từ provider body. */
  occurredAt: string | null;
  /** Actor hints — ai hay human. */
  senderKind: 'agent' | 'contact' | 'system' | 'unknown';
  /** Raw sender identifier (provider-specific). */
  senderId: string | null;
  /**
   * Whether this event was created by a staff member (agent/system).
   * HIGH CONFIDENCE = staff outbound (echo/private note) = NON_AUTHORITATIVE.
   */
  isStaffOutbound: boolean;
  /**
   * Whether this is a private/internal note.
   * Triggers NON_AUTHORITATIVE classification.
   */
  isPrivateNote: boolean;
}

export interface ContactHints {
  /** Provider external contact ID hint. */
  externalContactId: string | null;
  /** Provider contact name hint (may be spoofed — not authoritative). */
  contactName: string | null;
  /**
   * Whether the contact appears to be a talent (job seeker) based on
   * conversation context and inbox attributes.
   */
  likelyTalent: boolean;
  /**
   * Whether the contact appears to be a client (business) based on
   * conversation context.
   */
  likelyClient: boolean;
  /**
   * Chatwoot inbox attributes hints.
   * NOT authoritative — Chatwoot attrs can be spoofed.
   */
  chatwootAttrs: Record<string, string | null>;
}

export interface ConversationHints {
  conversationId: string | null;
  inboxId: string | null;
  /** Chatwoot conversation status. */
  status: string | null;
  /** Assigned agent IDs. */
  assigneeIds: string[];
  /** Labels on the conversation. */
  labels: string[];
}

/* ───────────────────────────────────────────────────────────────────────────
 * Normalizer result.
 * ─────────────────────────────────────────────────────────────────────────── */
export type NormalizeResult =
  | { ok: true; event: InboundEvent }
  | { ok: false; reason: string; fallbackEventType: InboundEventType };

/* ───────────────────────────────────────────────────────────────────────────
 * Helpers.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Chatwoot message type discriminator. */
function getChatwootMessageType(body: Record<string, unknown>): string | null {
  const msg = body['message'] as Record<string, unknown> | null;
  if (!msg || typeof msg !== 'object') return null;
  const contentType = msg['content_type'] as string | null;
  return contentType ?? 'text';
}

/** Chatwoot sender from message. */
function getChatwootSender(
  body: Record<string, unknown>,
): { id: string | null; type: 'agent' | 'contact' | 'unknown'; name: string | null } {
  const msg = body['message'] as Record<string, unknown> | null;
  if (!msg || typeof msg !== 'object') {
    return { id: null, type: 'unknown', name: null };
  }

  const sender = msg['sender'] as Record<string, unknown> | null;
  if (!sender || typeof sender !== 'object') {
    return { id: null, type: 'unknown', name: null };
  }

  const type = sender['type'] as string | null;
  const id = (sender['id'] as string | number | null) ?? null;
  const name = (sender['name'] as string | null) ?? null;

  if (type === 'Agent' || type === 'User') {
    return { id: String(id), type: 'agent', name };
  }
  if (type === 'Contact') {
    return { id: String(id), type: 'contact', name };
  }
  return { id: String(id), type: 'unknown', name };
}

/**
 * Detect private note from message content.
 * Chatwoot private notes have content_type='notes' or private=true.
 */
function isChatwootPrivateNote(
  body: Record<string, unknown>,
): boolean {
  const msg = body['message'] as Record<string, unknown> | null;
  if (!msg || typeof msg !== 'object') return false;
  const contentType = msg['content_type'] as string | null;
  if (contentType === 'notes') return true;
  // Also check private attribute
  const contentAttr = msg['private'] as boolean | null;
  if (contentAttr === true) return true;
  // Check content body for private note marker
  const content = (msg['content'] as string | null) ?? '';
  if (/^\[Private\]/.test(content) || /#private\b/i.test(content)) return true;
  return false;
}

/**
 * Detect staff outbound message.
 * Chatwoot agent message: sender.type === 'Agent' || sender.type === 'User'
 */
function isChatwootStaffOutbound(
  body: Record<string, unknown>,
): boolean {
  const sender = getChatwootSender(body);
  return sender.type === 'agent';
}

/**
 * Detect if contact is likely talent vs client.
 * Uses conversation inbox attributes and message content hints.
 *
 * IMPORTANT: This is a HINT only. The actual mapping decision belongs
 * to the mapping service, not this normalizer. Chatwoot attributes
 * can be spoofed (AC3: Chatwoot hrp_* attributes not authoritative).
 *
 * Strategy:
 *  - If conversation has explicit client-type inbox attribute → medium confidence
 *  - If message content contains talent keywords → medium confidence talent
 *  - If conversation is in "client" inbox → medium confidence client
 *  - Otherwise → low confidence, leave undecided (UNRESOLVED)
 */
function classifyContactBranch(
  body: Record<string, unknown>,
  sender: { type: string },
): { likelyTalent: boolean; likelyClient: boolean } {
  // Check Chatwoot inbox attributes (meta)
  const meta = body['meta'] as Record<string, unknown> | null;
  const inboxAttrs = (meta?.['inbox'] ?? meta) as Record<string, unknown> | null;

  // Check if there's a custom attribute indicating talent vs client
  const hrpAttrs = extractHrpAttributes(inboxAttrs ?? {});

  // If hrp_* attrs present, they're HINTS only (not authoritative per AC3)
  // We use them for medium confidence classification
  if (hrpAttrs.type === 'talent') {
    return { likelyTalent: true, likelyClient: false };
  }
  if (hrpAttrs.type === 'client') {
    return { likelyTalent: false, likelyClient: true };
  }

  // Check conversation labels for type hints
  const labels = extractLabels(body);
  if (labels.includes('client') || labels.includes('business')) {
    return { likelyTalent: false, likelyClient: true };
  }
  if (labels.includes('candidate') || labels.includes('talent')) {
    return { likelyTalent: true, likelyClient: false };
  }

  // Sender type can be a hint
  if (sender.type === 'contact') {
    // Check message content for talent vs client keywords
    const msg = body['message'] as Record<string, unknown> | null;
    const content = (msg?.['content'] as string | null) ?? '';

    // Simple keyword heuristic — CONTENT-BASED only, not definitive
    const talentKeywords = /\b(job|cv|resume|interview|skill|experience|position|salary|work)\b/i;
    const clientKeywords = /\b(client|customer|company|business|sale|contract|invoice)\b/i;

    if (talentKeywords.test(content) && !clientKeywords.test(content)) {
      return { likelyTalent: true, likelyClient: false };
    }
    if (clientKeywords.test(content) && !talentKeywords.test(content)) {
      return { likelyTalent: false, likelyClient: true };
    }
  }

  return { likelyTalent: false, likelyClient: false };
}

/**
 * Extract Chatwoot hrp_* custom attributes.
 * AC3: These are HINTS only, NOT authoritative for canonical target.
 * Schema contract forbids using them as canonical source.
 */
function extractHrpAttributes(
  attrs: Record<string, unknown>,
): { type: 'talent' | 'client' | null } {
  // Chatwoot stores custom attributes under 'custom_attributes' or flat
  const customAttrs = (attrs['custom_attributes'] ?? attrs) as Record<string, unknown>;

  for (const [key, val] of Object.entries(customAttrs)) {
    if (typeof key !== 'string') continue;
    if (!key.startsWith('hrp_')) continue;

    const strVal = String(val ?? '').toLowerCase();
    if (key.includes('type') || key.includes('contact_type')) {
      if (strVal.includes('talent') || strVal.includes('candidate')) {
        return { type: 'talent' };
      }
      if (strVal.includes('client') || strVal.includes('customer')) {
        return { type: 'client' };
      }
    }
  }
  return { type: null };
}

/** Extract conversation labels from Chatwoot body. */
function extractLabels(body: Record<string, unknown>): string[] {
  // Chatwoot labels in conversation meta
  const meta = body['meta'] as Record<string, unknown> | null;
  if (!meta) return [];

  const labels = meta['labels'] as string[] | null;
  if (Array.isArray(labels)) return labels.map(String);

  const conversation = meta['conversation'] as Record<string, unknown> | null;
  if (!conversation) return [];

  const convLabels = conversation['labels'] as string[] | null;
  if (Array.isArray(convLabels)) return convLabels.map(String);

  return [];
}

/** Extract assignee IDs from Chatwoot body. */
function extractAssigneeIds(body: Record<string, unknown>): string[] {
  const meta = body['meta'] as Record<string, unknown> | null;
  if (!meta) return [];

  // assignee in meta
  const assignee = meta['assignee'] as Record<string, unknown> | null;
  if (assignee && typeof assignee === 'object') {
    const id = assignee['id'];
    if (id !== undefined && id !== null) return [String(id)];
  }

  // conversation meta
  const conversation = meta['conversation'] as Record<string, unknown> | null;
  if (conversation) {
    const assigneeInConv = conversation['assignee_id'];
    if (assigneeInConv !== undefined) return [String(assigneeInConv)];
  }

  return [];
}

/** Truncate content for safety. */
function truncateContent(content: string | null | undefined, maxLen = 200): string {
  if (!content) return '';
  const s = String(content).trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '…';
}

/* ───────────────────────────────────────────────────────────────────────────
 * Main normalize function.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Normalize a Chatwoot provider event into an InboundEvent.
 *
 * Input:
 *  - parseResult: from parseProviderFixture (eventId, eventType, etc.)
 *  - parsedBody: the actual JSON body from the provider
 *  - scope: organizationId + connectionId from the receiver path
 *
 * Output:
 *  - InboundEvent with canonical classification
 *
 * Policy:
 *  - Staff outbound (agent message) → NON_AUTHORITATIVE
 *  - Private note → NON_AUTHORITATIVE
 *  - Assignment / label update → NON_AUTHORITATIVE
 *  - Inbound message from contact → AUTHORITATIVE (but target UNRESOLVED)
 *  - Conversation created → AUTHORITATIVE
 */
export function normalizeChatwootEvent(
  parseResult: Extract<ParseResult, { ok: true }>,
  parsedBody: unknown,
  scope: { organizationId: string; connectionId: string; provider?: string },
): NormalizeResult {
  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return {
      ok: false,
      reason: 'parsedBody must be a plain object',
      fallbackEventType: 'UNKNOWN_RAW',
    };
  }

  const body = parsedBody as Record<string, unknown>;
  const rawEventType = parseResult.eventType;
  const sender = getChatwootSender(body);
  const isPrivateNote = isChatwootPrivateNote(body);
  const isStaffOutbound = isChatwootStaffOutbound(body);
  const labels = extractLabels(body);
  const assigneeIds = extractAssigneeIds(body);

  // Extract conversation hints
  const meta = body['meta'] as Record<string, unknown> | null;
  const conversation = meta?.['conversation'] as Record<string, unknown> | null;
  const conversationHints: ConversationHints = {
    conversationId: conversation
      ? String(conversation['id'] ?? '')
      : String(body['conversation'] ?? ''),
    inboxId: String(meta?.['inbox'] ? (meta['inbox'] as Record<string, unknown>)['id'] ?? '' : body['inbox_id'] ?? ''),
    status: conversation
      ? String(conversation['status'] ?? '')
      : String(body['conversation_status'] ?? ''),
    assigneeIds,
    labels,
  };

  // Extract contact hints
  const contactHints: ContactHints = {
    externalContactId: sender.id,
    contactName: sender.name,
    likelyTalent: false,
    likelyClient: false,
    chatwootAttrs: extractHrpAttributes(body),
  };

  // Classify event type
  let eventType: InboundEventType;
  let confidence: 'high' | 'medium' | 'low';
  let isStaffOutboundFlag = isStaffOutbound;
  let isPrivateNoteFlag = isPrivateNote;

  switch (rawEventType) {
    case 'message_created': {
      // Sub-classify: echo vs inbound
      if (isPrivateNote) {
        eventType = 'PRIVATE_NOTE';
        confidence = 'high';
        isPrivateNoteFlag = true;
      } else if (sender.type === 'agent') {
        // Agent outbound → echo (non-authoritative)
        eventType = 'AGENT_MESSAGE_ECHO';
        confidence = 'high';
        isStaffOutboundFlag = true;
      } else {
        // Inbound from contact
        // Distinguish Talent vs Client branch
        const branch = classifyContactBranch(body, sender);
        contactHints.likelyTalent = branch.likelyTalent;
        contactHints.likelyClient = branch.likelyClient;

        // Check if there's a client-type inbox marker
        const isClientInbox = ((conversationHints.inboxId ?? '').includes('client') ||
          conversationHints.labels.includes('client'));
        if (isClientInbox || contactHints.likelyClient) {
          eventType = 'CLIENT_INBOUND_MESSAGE';
          confidence = 'medium'; // Client attribution is hint-based
        } else {
          eventType = 'MESSAGE_CREATED';
          confidence = 'medium'; // Talent but branch may need review
        }
      }
      break;
    }

    case 'conversation_created': {
      eventType = 'CONVERSATION_CREATED';
      confidence = 'high';

      // Also classify the contact branch for conversation_created
      const branch = classifyContactBranch(body, sender);
      contactHints.likelyTalent = branch.likelyTalent;
      contactHints.likelyClient = branch.likelyClient;
      break;
    }

    case 'conversation_resolved': {
      eventType = 'CONVERSATION_RESOLVED';
      confidence = 'medium'; // Needs semantic firewall decision
      break;
    }

    case 'conversation_participant_added': {
      eventType = 'PARTICIPANT_ADDED';
      confidence = 'medium';
      break;
    }

    case 'conversation_assigned': {
      eventType = 'CONVERSATION_ASSIGNED';
      confidence = 'low'; // Non-authoritative metadata
      isStaffOutboundFlag = false;
      break;
    }

    case 'conversation_status_changed': {
      eventType = 'CONVERSATION_STATUS_CHANGED';
      confidence = 'low';
      break;
    }

    case 'conversation_labels_updated': {
      eventType = 'CONVERSATION_LABELED';
      confidence = 'low';
      break;
    }

    case 'message_updated': {
      eventType = 'MESSAGE_UPDATED';
      confidence = 'low';
      break;
    }

    case 'message_deleted': {
      eventType = 'MESSAGE_DELETED';
      confidence = 'low';
      break;
    }

    default: {
      eventType = 'UNKNOWN_RAW';
      confidence = 'low';
    }
  }

  // Extract occurredAt from body
  const msg = body['message'] as Record<string, unknown> | null;
  const occurredAt: string | null =
    (msg?.['created_at'] as string | null) ??
    (body['created_at'] as string | null) ??
    (body['timestamp'] as string | null) ??
    null;

  // Content preview
  const contentPreview = truncateContent(
    (msg?.['content'] as string | null) ?? '',
  );

  const event: InboundEvent = {
    eventType,
    eventId: parseResult.eventId,
    rawEventType,
    provider: scope.provider ?? 'CHATWOOT',
    organizationId: scope.organizationId,
    connectionId: scope.connectionId,
    confidence,
    contactHints,
    conversationHints,
    contentPreview,
    occurredAt,
    senderKind: sender.type,
    senderId: sender.id,
    isStaffOutbound: isStaffOutboundFlag,
    isPrivateNote: isPrivateNoteFlag,
  };

  return { ok: true, event };
}
