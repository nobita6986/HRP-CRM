/**
 * normalize/event-types.ts — CORE/1.5
 *
 * Canonical InboundEventType enumeration.
 *
 * Mỗi type là một semantic "đơn vị hành động" mà Integration có thể
 * hiểu từ provider event. Không phải toàn bộ Chatwoot/Zalo event catalog —
 * chỉ tập con mà Integration cần để quyết định create/match/update.
 *
 * Ràng buộc:
 *  - AUTHORITATIVE events là các event tạo canonical state (case open,
 *    profile creation intent, interaction record).
 *  - NON_AUTHORITATIVE events (echo, private note, assignment, resolution)
 *    KHÔNG tự tạo canonical action — chỉ log hoặc bỏ qua.
 *  - RAW events chưa được map; chúng đi qua semantic firewall và bị
 *    classify.
 *
 * Triển khai:
 *  - Core/1.5: Chatwoot event types map.
 *  - Mở rộng sau: Zalo OA event types.
 */
export const INBOUND_EVENT_TYPES = [
  // ── Authoritative: tạo/điều phối canonical state ───────────────────
  /** Chatwoot: conversation_created → cơ hội tiếp nhận contact */
  'CONVERSATION_CREATED',
  /** Chatwoot: message_created (talent inbound message) */
  'MESSAGE_CREATED',
  /** Chatwoot: message_created (client inbound message) */
  'CLIENT_MESSAGE_CREATED',
  /** Chatwoot: conversation_resolved → implicit close? (semantic firewall quyết) */
  'CONVERSATION_RESOLVED',
  /** Chatwoot: conversation_participant_added */
  'PARTICIPANT_ADDED',

  // ── Non-authoritative: echo / metadata / internal action ─────────────
  /** Chatwoot: message_created nhưng chính agent/system gửi (echo) */
  'AGENT_MESSAGE_ECHO',
  /** Chatwoot: message_created là private note (content chứa private tag) */
  'PRIVATE_NOTE',
  /** Chatwoot: conversation_assigned → KHÔNG tạo HandlingAssignment */
  'CONVERSATION_ASSIGNED',
  /** Chatwoot: conversation_status_changed → KHÔNG tự close PlacementCase */
  'CONVERSATION_STATUS_CHANGED',
  /** Chatwoot: conversation_labels_updated → metadata thuần túy */
  'CONVERSATION_LABELED',
  /** Chatwoot: message_updated / message_deleted → raw mutation */
  'MESSAGE_UPDATED',
  'MESSAGE_DELETED',

  // ── Client-side authoritative (distinguish from Talent) ──────────────
  /** Chatwoot: message_created từ contact có tag/client-type marker */
  'CLIENT_INBOUND_MESSAGE',

  // ── Out-of-order / unknown ──────────────────────────────────────────
  /** Event không map được → chờ semantic firewall classify */
  'UNKNOWN_RAW',
  /** Event có timestamp cũ hơn watermark → out-of-order */
  'OUT_OF_ORDER_RAW',
  /** Mapping revision changed before execution → reconcile needed */
  'MAPPING_REVISION_CHANGED',
] as const;

export type InboundEventType = (typeof INBOUND_EVENT_TYPES)[number];

export const InboundEventTypeSchema = Object.freeze({
  CONVERSATION_CREATED: 'CONVERSATION_CREATED',
  MESSAGE_CREATED: 'MESSAGE_CREATED',
  CLIENT_MESSAGE_CREATED: 'CLIENT_MESSAGE_CREATED',
  CONVERSATION_RESOLVED: 'CONVERSATION_RESOLVED',
  PARTICIPANT_ADDED: 'PARTICIPANT_ADDED',
  AGENT_MESSAGE_ECHO: 'AGENT_MESSAGE_ECHO',
  PRIVATE_NOTE: 'PRIVATE_NOTE',
  CONVERSATION_ASSIGNED: 'CONVERSATION_ASSIGNED',
  CONVERSATION_STATUS_CHANGED: 'CONVERSATION_STATUS_CHANGED',
  CONVERSATION_LABELED: 'CONVERSATION_LABELED',
  MESSAGE_UPDATED: 'MESSAGE_UPDATED',
  MESSAGE_DELETED: 'MESSAGE_DELETED',
  CLIENT_INBOUND_MESSAGE: 'CLIENT_INBOUND_MESSAGE',
  UNKNOWN_RAW: 'UNKNOWN_RAW',
  OUT_OF_ORDER_RAW: 'OUT_OF_ORDER_RAW',
  MAPPING_REVISION_CHANGED: 'MAPPING_REVISION_CHANGED',
});
