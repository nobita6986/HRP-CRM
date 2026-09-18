/**
 * semantic-firewall.ts — CORE/1.5 (worker mirror)
 *
 * Minimal classification for pipeline execution.
 * Classification: AUTHORITATIVE | NON_AUTHORITATIVE | REVIEW_NEEDED | BLOCKED.
 */

import type { InboundEvent } from './normalizer-shim/event-normalizer.js';

export type EventClassification =
  | 'AUTHORITATIVE'
  | 'NON_AUTHORITATIVE'
  | 'REVIEW_NEEDED'
  | 'BLOCKED';

export interface ClassificationReason {
  code:
    | 'AUTHORITATIVE_CLIENT_MESSAGE'
    | 'AUTHORITATIVE_CONVERSATION_CREATED'
    | 'NON_AUTHORITATIVE_PRIVATE_NOTE'
    | 'NON_AUTHORITATIVE_ECHO'
    | 'NON_AUTHORITATIVE_ASSIGNMENT'
    | 'NON_AUTHORITATIVE_RESOLVED'
    | 'NON_AUTHORITATIVE_LABEL'
    | 'NON_AUTHORITATIVE_UPDATED_DELETED'
    | 'REVIEW_POSSIBLE_MATCH'
    | 'REVIEW_UNRESOLVED'
    | 'REVIEW_HRPI_ATTRIBUTE_SPOOF'
    | 'BLOCKED_OUT_OF_ORDER'
    | 'BLOCKED_MAPPING_REVISION_CHANGE'
    | 'BLOCKED_UNKNOWN';
  message: string;
}

export interface ClassificationResult {
  classification: EventClassification;
  reason: ClassificationReason;
  suggestedCommand: string | null;
  targetBranch: 'TALENT' | 'CLIENT' | null;
}

const HrpGatewayMethod = [
  'createOrMatchLaborProfile',
  'updateLaborProfile',
  'mergeLaborProfiles',
  'openPlacementCase',
  'updatePlacementCase',
  'closePlacementCase',
  'recordInteraction',
  'recordClientInteraction',
  'updateLaborAvailability',
  'commitSuppression',
  'dispatchAuthorizationCheck',
  'createNextAction',
  'updateNextAction',
  'queryOutboxDelivery',
  'commitReviewDecision',
  'resolvePossibleMatch',
  'supersedeReviewStatus',
] as const;

export type HrpGatewayMethodName = (typeof HrpGatewayMethod)[number];

export function classify(event: InboundEvent): ClassificationResult {
  // §AC1: Only authoritative events create actions.
  // Private note + echo + assignment + resolve → NON_AUTHORITATIVE.
  if (event.isPrivateNote) {
    return {
      classification: 'NON_AUTHORITATIVE',
      reason: {
        code: 'NON_AUTHORITATIVE_PRIVATE_NOTE',
        message: 'Private note never creates canonical action',
      },
      suggestedCommand: null,
      targetBranch: null,
    };
  }

  if (event.isEcho || event.isOutbound) {
    return {
      classification: 'NON_AUTHORITATIVE',
      reason: {
        code: 'NON_AUTHORITATIVE_ECHO',
        message: 'Agent outbound / echo must not create canonical action',
      },
      suggestedCommand: null,
      targetBranch: null,
    };
  }

  // Out-of-order / mapping revision → BLOCKED
  if (event.eventType === 'OUT_OF_ORDER_RAW') {
    return {
      classification: 'BLOCKED',
      reason: {
        code: 'BLOCKED_OUT_OF_ORDER',
        message: 'Event out-of-order, requires reconciliation',
      },
      suggestedCommand: null,
      targetBranch: null,
    };
  }
  if (event.eventType === 'MAPPING_REVISION_CHANGED') {
    return {
      classification: 'BLOCKED',
      reason: {
        code: 'BLOCKED_MAPPING_REVISION_CHANGE',
        message: 'Mapping revision changed, requires reconciliation',
      },
      suggestedCommand: null,
      targetBranch: null,
    };
  }

  switch (event.eventType) {
    case 'CONVERSATION_CREATED':
      // §AC5: Chat-created must NOT auto-call createOrMatch.
      // We mark as AUTHORITATIVE but suggestedCommand = null,
      // because creation policy is owned by CORE/1.6.
      return {
        classification: 'AUTHORITATIVE',
        reason: {
          code: 'AUTHORITATIVE_CONVERSATION_CREATED',
          message: 'Conversation creation observed; creation policy defers to CORE/1.6',
        },
        suggestedCommand: null,
        targetBranch: null,
      };
    case 'MESSAGE_CREATED':
    case 'CLIENT_MESSAGE_CREATED':
    case 'CLIENT_INBOUND_MESSAGE': {
      // §AC5b: staff-assisted conversion gate.
      // If the inbound message carries a Chatwoot hrpi_branch hint (claimed
      // conversion target) AND no review_confirmation_token → REVIEW_NEEDED.
      // This blocks: staff typing "convert to candidate" in a private note
      // with a hrpi_branch attribute from triggering canonical mutation.
      if (event.flags.claimedBranchHint !== null && event.reviewConfirmationToken === null) {
        return {
          classification: 'REVIEW_NEEDED',
          reason: {
            code: 'REVIEW_HRPI_ATTRIBUTE_SPOOF',
            message:
              'Staff-assisted conversion requires review_confirmation_token. ' +
              'Event has hrpi_branch=CLIENT/TALENT but no review token → REVIEW_NEEDED.',
          },
          suggestedCommand: null, // No auto-call to createOrMatch/resolvePossibleMatch.
          targetBranch: null,
        };
      }
      return {
        classification: 'AUTHORITATIVE',
        reason: {
          code: 'AUTHORITATIVE_CLIENT_MESSAGE',
          message: 'Inbound contact message is authoritative for placement progress',
        },
        suggestedCommand: 'recordInteraction',
        targetBranch: 'TALENT',
      };
    }
    case 'CONVERSATION_RESOLVED':
      return {
        classification: 'NON_AUTHORITATIVE',
        reason: {
          code: 'NON_AUTHORITATIVE_RESOLVED',
          message: 'Conversation resolution is metadata, not an action trigger',
        },
        suggestedCommand: null,
        targetBranch: null,
      };
    case 'CONVERSATION_ASSIGNED':
      return {
        classification: 'NON_AUTHORITATIVE',
        reason: {
          code: 'NON_AUTHORITATIVE_ASSIGNMENT',
          message: 'Assignment is metadata, not an action trigger',
        },
        suggestedCommand: null,
        targetBranch: null,
      };
    case 'CONVERSATION_LABELED':
    case 'CONVERSATION_STATUS_CHANGED':
      return {
        classification: 'NON_AUTHORITATIVE',
        reason: {
          code: 'NON_AUTHORITATIVE_LABEL',
          message: 'Label/status change is metadata, not an action trigger',
        },
        suggestedCommand: null,
        targetBranch: null,
      };
    case 'MESSAGE_UPDATED':
    case 'MESSAGE_DELETED':
      return {
        classification: 'NON_AUTHORITATIVE',
        reason: {
          code: 'NON_AUTHORITATIVE_UPDATED_DELETED',
          message: 'Update/delete is metadata, not an action trigger',
        },
        suggestedCommand: null,
        targetBranch: null,
      };
    case 'PARTICIPANT_ADDED':
      // Could be AUTHORITATIVE if meaningful, but conservatively: REVIEW_NEEDED
      // until CORE/1.6 orchestration defines this.
      return {
        classification: 'REVIEW_NEEDED',
        reason: {
          code: 'REVIEW_POSSIBLE_MATCH',
          message: 'New participant requires mapping review',
        },
        suggestedCommand: null,
        targetBranch: null,
      };
    case 'UNKNOWN_RAW':
    default:
      return {
        classification: 'BLOCKED',
        reason: {
          code: 'BLOCKED_UNKNOWN',
          message: 'Unknown event type — requires reconciliation',
        },
        suggestedCommand: null,
        targetBranch: null,
      };
  }
}

/**
 * Validate that a command is allowed for the given classification.
 * Used before dispatching.
 */
export function validateCommand(
  classification: EventClassification,
  command: string | null,
): { ok: true } | { ok: false; reason: string } {
  if (classification === 'NON_AUTHORITATIVE') {
    return { ok: false, reason: 'Non-authoritative events cannot dispatch commands' };
  }
  if (classification === 'BLOCKED') {
    return { ok: false, reason: 'Blocked events cannot dispatch commands' };
  }
  if (!command) {
    return { ok: false, reason: 'No command suggested for this event' };
  }
  return { ok: true };
}
