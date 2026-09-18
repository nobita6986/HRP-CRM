/**
 * firewall/semantic-firewall.ts — CORE/1.5
 *
 * Semantic firewall: authoritative event policy gate.
 *
 * Policy (Backlog §Task 1.5 AC):
 *  - Chỉ event AUTHORITATIVE tạo canonical action.
 *  - Echo/private note/assign/resolve không tự tạo PlacementCase,
 *    Handling hoặc outbound loop.
 *  - Out-of-order / mapping revision đổi → không áp dụng sai target.
 *  - Chat-created không tự gọi createOrMatch ngoài creation policy.
 *
 * Triển khai:
 *  - EventClassification enum: AUTHORITATIVE | NON_AUTHORITATIVE | REVIEW_NEEDED | IGNORED
 *  - Classify() function: given InboundEvent → Classification
 *  - ValidateCommand() function: cho command gọi gateway
 *
 * Marker:
 *  - Đây là fixture/dev contract; KHÔNG tuyên bố đã xác minh semantics
 *    provider thật.
 *  - Các Client/merge/review paths còn PROPOSED/UNAVAILABLE giữ nguyên.
 */
import type { InboundEvent } from '../normalizer/event-normalizer.js';
import type { InboundEventType } from '../normalizer/event-types.js';

/* ───────────────────────────────────────────────────────────────────────────
 * Classification result.
 * ─────────────────────────────────────────────────────────────────────────── */
export type EventClassification =
  /** Event tạo canonical action — gọi gateway command. */
  | 'AUTHORITATIVE'
  /** Event metadata, echo, internal — bỏ qua hoặc chỉ log. */
  | 'NON_AUTHORITATIVE'
  /**
   * Event cần mapping review trước khi action.
   * POSSIBLE_MATCH hoặc UNRESOLVED contact.
   */
  | 'REVIEW_NEEDED'
  /**
   * Event bị chặn hoàn toàn (spoof, out-of-order, mapping revision đổi).
   * Không tạo action, không gọi gateway.
   */
  | 'BLOCKED';

/**
 * Why an event was classified a certain way.
 * Audit trail for call log.
 */
export interface ClassificationReason {
  code:
    | 'ECHO_MESSAGE'          // Agent outbound message (echo)
    | 'PRIVATE_NOTE'         // Private/internal note
    | 'ASSIGNMENT_EVENT'     // Conversation assigned (metadata)
    | 'LABEL_EVENT'          // Labels updated (metadata)
    | 'STATUS_CHANGE'        // Status changed (metadata)
    | 'AUTHORITATIVE_INBOUND' // Inbound message → canonical action
    | 'CONVERSATION_CREATED' // New conversation → intake
    | 'PARTICIPANT_ADDED'    // Participant change
    | 'POSSIBLE_MATCH'       // Mapping uncertain → review
    | 'UNRESOLVED_CONTACT'    // No mapping → review
    | 'BLOCKED_SPOOF_ATTRS'  // hrp_* attrs used as canonical (AC3)
    | 'BLOCKED_OUT_OF_ORDER' // Event timestamp < watermark
    | 'BLOCKED_MAPPING_REVISION' // Mapping changed before execution
    | 'BLOCKED_UNKNOWN'      // Unknown event type
    | 'CLIENT_PATH_PROPOSED' // Client branch, not implemented
    | 'MERGE_PATH_PROPOSED'  // Merge/review paths not implemented
    | 'MESSAGE_UPDATED'      // Message mutation (not authoritative)
    | 'MESSAGE_DELETED';     // Message deletion (not authoritative)

  message: string;
  /** Tên trường gây ra classification (nếu có). */
  field?: string;
}

/**
 * Full classification output.
 */
export interface ClassificationResult {
  classification: EventClassification;
  reason: ClassificationReason;
  /**
   * Suggested action — command name nếu AUTHORITATIVE.
   * Không bắt buộc; caller có thể override theo mapping.
   */
  suggestedCommand: string | null;
  /**
   * Nếu AUTHORITATIVE: đây là Talent hay Client branch.
   * null nếu classification != AUTHORITATIVE.
   */
  targetBranch: 'TALENT' | 'CLIENT' | null;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Classification table.
 *
 * Policy:
 *  - NON_AUTHORITATIVE events không tạo action.
 *  - AUTHORITATIVE events tạo action theo target branch.
 *  - REVIEW_NEEDED events cần mapping review trước.
 *  - BLOCKED events bị chặn hoàn toàn.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Deterministic classify() function.
 *
 * Input: InboundEvent (from normalizer)
 * Output: ClassificationResult
 *
 * Rules (from AC):
 *  AC1: Chỉ event AUTHORITATIVE tạo action.
 *  AC3: Chatwoot hrp_* attributes không được dùng làm nguồn đáng tin.
 *  AC4: Out-of-order / mapping revision đổi không áp dụng sai target.
 */
export function classify(event: InboundEvent): ClassificationResult {
  const et = event.eventType;

  switch (et) {
    // ── NON_AUTHORITATIVE ──────────────────────────────────────────────
    case 'AGENT_MESSAGE_ECHO':
      return {
        classification: 'NON_AUTHORITATIVE',
        reason: {
          code: 'ECHO_MESSAGE',
          message: 'Agent outbound message — echo, không tạo canonical action.',
        },
        suggestedCommand: null,
        targetBranch: null,
      };

    case 'PRIVATE_NOTE':
      return {
        classification: 'NON_AUTHORITATIVE',
        reason: {
          code: 'PRIVATE_NOTE',
          message: 'Private note — internal metadata, không tạo canonical action.',
        },
        suggestedCommand: null,
        targetBranch: null,
      };

    case 'CONVERSATION_ASSIGNED':
      return {
        classification: 'NON_AUTHORITATIVE',
        reason: {
          code: 'ASSIGNMENT_EVENT',
          message:
            'Conversation assigned — metadata, không tạo HandlingAssignment hoặc PlacementCase.',
        },
        suggestedCommand: null,
        targetBranch: null,
      };

    case 'CONVERSATION_LABELED':
      return {
        classification: 'NON_AUTHORITATIVE',
        reason: {
          code: 'LABEL_EVENT',
          message:
            'Labels updated — conversation metadata, không tạo canonical action.',
        },
        suggestedCommand: null,
        targetBranch: null,
      };

    case 'CONVERSATION_STATUS_CHANGED': {
      // AC1: Status change metadata — NOT authoritative for case close/open.
      // Semantic firewall CHẶN tự động close/open case từ conversation status.
      // HRP runtime gate quyết nếu conversation_status → case action.
      return {
        classification: 'NON_AUTHORITATIVE',
        reason: {
          code: 'STATUS_CHANGE',
          message:
            'Conversation status changed — metadata, không tự động close/open PlacementCase. HRP runtime gate quyết.',
        },
        suggestedCommand: null,
        targetBranch: null,
      };
    }

    case 'MESSAGE_UPDATED':
      return {
        classification: 'NON_AUTHORITATIVE',
        reason: {
          code: 'MESSAGE_UPDATED',
          message: 'Message updated — mutation, không tạo canonical action.',
        },
        suggestedCommand: null,
        targetBranch: null,
      };

    case 'MESSAGE_DELETED':
      return {
        classification: 'NON_AUTHORITATIVE',
        reason: {
          code: 'MESSAGE_DELETED',
          message: 'Message deleted — mutation, không tạo canonical action.',
        },
        suggestedCommand: null,
        targetBranch: null,
      };

    // ── AUTHORITATIVE ─────────────────────────────────────────────────
    case 'CONVERSATION_CREATED': {
      // New conversation — canonical intake action.
      // Target branch depends on mapping.
      if (event.contactHints.likelyClient) {
        return {
          classification: 'AUTHORITATIVE',
          reason: {
            code: 'CONVERSATION_CREATED',
            message: 'New conversation (client marker) → canonical action.',
          },
          suggestedCommand: 'createOrMatchLaborProfile',
          targetBranch: 'CLIENT', // PROPOSED: Client branch
        };
      }
      return {
        classification: 'AUTHORITATIVE',
        reason: {
          code: 'CONVERSATION_CREATED',
          message: 'New conversation (talent) → canonical action.',
        },
        suggestedCommand: 'createOrMatchLaborProfile',
        targetBranch: 'TALENT',
      };
    }

    case 'MESSAGE_CREATED': {
      // Inbound message from talent contact → canonical action.
      // But: check for POSSIBLE_MATCH or UNRESOLVED.
      if (event.contactHints.likelyTalent || !event.contactHints.likelyClient) {
        // Talent branch: call createOrMatch
        // But mapping may be UNRESOLVED → REVIEW_NEEDED
        if (event.confidence === 'low') {
          return {
            classification: 'REVIEW_NEEDED',
            reason: {
              code: 'UNRESOLVED_CONTACT',
              message:
                'Inbound message nhưng contact mapping UNRESOLVED → cần review trước khi action.',
            },
            suggestedCommand: null,
            targetBranch: 'TALENT',
          };
        }
        return {
          classification: 'AUTHORITATIVE',
          reason: {
            code: 'AUTHORITATIVE_INBOUND',
            message: 'Inbound message (talent) → canonical action.',
          },
          suggestedCommand: 'createOrMatchLaborProfile',
          targetBranch: 'TALENT',
        };
      }
      // Client branch — PROPOSED, not implemented
      return {
        classification: 'AUTHORITATIVE',
        reason: {
          code: 'AUTHORITATIVE_INBOUND',
          message:
            'Inbound message (client) → canonical action. Client branch PROPOSED (Q-23).',
        },
        suggestedCommand: 'createOrMatchLaborProfile',
        targetBranch: 'CLIENT', // PROPOSED
      };
    }

    case 'CLIENT_INBOUND_MESSAGE': {
      // Client inbound message.
      // PROPOSED: Client domain not implemented
      return {
        classification: 'AUTHORITATIVE',
        reason: {
          code: 'AUTHORITATIVE_INBOUND',
          message:
            'Client inbound message → canonical action. Client branch PROPOSED (Q-23).',
        },
        suggestedCommand: 'createOrMatchLaborProfile',
        targetBranch: 'CLIENT', // PROPOSED
      };
    }

    case 'PARTICIPANT_ADDED': {
      // Participant change — needs mapping review
      return {
        classification: 'REVIEW_NEEDED',
        reason: {
          code: 'POSSIBLE_MATCH',
          message:
            'Participant added → mapping review trước khi action.',
        },
        suggestedCommand: null,
        targetBranch: 'TALENT',
      };
    }

    // ── BLOCKED ──────────────────────────────────────────────────────
    case 'OUT_OF_ORDER_RAW': {
      return {
        classification: 'BLOCKED',
        reason: {
          code: 'BLOCKED_OUT_OF_ORDER',
          message:
            'Event out-of-order (timestamp < watermark) → không apply sai target. Dùng reconciliation.',
        },
        suggestedCommand: null,
        targetBranch: null,
      };
    }

    case 'MAPPING_REVISION_CHANGED': {
      return {
        classification: 'BLOCKED',
        reason: {
          code: 'BLOCKED_MAPPING_REVISION',
          message:
            'Mapping revision changed trước execution → không apply sai target. Dùng reconciliation.',
        },
        suggestedCommand: null,
        targetBranch: null,
      };
    }

    case 'UNKNOWN_RAW':
    default: {
      // Check if hrp_* attrs were used as hints
      const hrpAttrs = event.contactHints.chatwootAttrs;
      if (hrpAttrs && Object.keys(hrpAttrs).length > 0) {
        // AC3: hrp_* attributes were present — BLOCKED per AC3 policy
        return {
          classification: 'BLOCKED',
          reason: {
            code: 'BLOCKED_SPOOF_ATTRS',
            message:
              'Chatwoot hrp_* attributes present — không được dùng làm nguồn đáng tin để thay canonical target (AC3).',
            field: 'chatwootAttrs',
          },
          suggestedCommand: null,
          targetBranch: null,
        };
      }

      return {
        classification: 'BLOCKED',
        reason: {
          code: 'BLOCKED_UNKNOWN',
          message: `Unknown event type: ${et}. Không tạo action.`,
        },
        suggestedCommand: null,
        targetBranch: null,
      };
    }
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * Command validation: chỉ cho phép command theo policy.
 *
 * Given a command name, verify it complies with the authoritative event policy.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Commands allowed for AUTHORITATIVE Talent events. */
const TALENT_AUTHORITATIVE_COMMANDS = new Set([
  'createOrMatchLaborProfile',
  'recordInteraction',
  'updateLaborAvailability',
  'createNextAction',
  'updateNextAction',
] as const);

/** Commands allowed for AUTHORITATIVE Client events. */
const CLIENT_AUTHORITATIVE_COMMANDS = new Set([
  'recordClientInteraction', // PROPOSED
] as const);

/**
 * ValidateCommand — kiểm tra command được phép gọi cho event classification.
 *
 * Returns true nếu command được phép, false nếu vi phạm policy.
 *
 * Policy: command chỉ được gọi nếu event là AUTHORITATIVE hoặc REVIEW_NEEDED
 * (với review confirmation).
 */
export function validateCommand(args: {
  command: string;
  classification: EventClassification;
  targetBranch: 'TALENT' | 'CLIENT' | null;
  suggestedCommand: string | null;
}): { ok: boolean; reason?: string } {
  const { command, classification, targetBranch } = args;

  // NON_AUTHORITATIVE → KHÔNG bao giờ được gọi command
  if (classification === 'NON_AUTHORITATIVE') {
    return {
      ok: false,
      reason: `NON_AUTHORITATIVE event không được gọi command. Command=${command} bị chặn.`,
    };
  }

  // BLOCKED → KHÔNG bao giờ được gọi command
  if (classification === 'BLOCKED') {
    return {
      ok: false,
      reason: `BLOCKED event không được gọi command. Command=${command} bị chặn.`,
    };
  }

  // REVIEW_NEEDED → chỉ gọi được command nếu có review confirmation
  if (classification === 'REVIEW_NEEDED') {
    return {
      ok: false,
      reason:
        'REVIEW_NEEDED event cần review confirmation trước khi gọi command (staff-assisted conversion policy).',
    };
  }

  // AUTHORITATIVE → kiểm tra target branch
  if (classification === 'AUTHORITATIVE') {
    if (targetBranch === 'TALENT') {
      if (TALENT_AUTHORITATIVE_COMMANDS.has(command as typeof TALENT_AUTHORITATIVE_COMMANDS extends Set<infer T> ? T : never)) {
        return { ok: true };
      }
      return {
        ok: false,
        reason: `Command ${command} không được phép cho Talent branch AUTHORITATIVE event.`,
      };
    }
    if (targetBranch === 'CLIENT') {
      // Client branch PROPOSED (Q-23) — accept recordClientInteraction only
      if (CLIENT_AUTHORITATIVE_COMMANDS.has(command as typeof CLIENT_AUTHORITATIVE_COMMANDS extends Set<infer T> ? T : never)) {
        return { ok: true };
      }
      return {
        ok: false,
        reason: `Command ${command} không được phép cho Client branch AUTHORITATIVE event. Client domain PROPOSED (Q-23).`,
      };
    }
  }

  return { ok: true };
}
