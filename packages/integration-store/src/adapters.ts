// src/adapters.ts — Convert Prisma row ↔ Contract type.
//
// KHÔNG fill canonical ID từ external attribute value.
// KHÔNG tạo mới ClientContactId từ Chatwoot/Zalo raw handle.
// Enum names match Prisma generator (`LinkState`, `TargetKind`,
// `ConversationKind`, `EventDuplicateKind`, `EventReceiptState`,
// `IntentStatus`).
import type { z } from 'zod';
import type {
  ExternalContactLinkSchema,
  ConversationLinkSchema,
  EventReceiptSchema,
  ExternalContactLinkTarget,
  CanonicalTargetRef,
  ExternalConversationRef,
} from '@hrp-engagement/contracts';
import type { EventDuplicateKind as PrismaEventDuplicateKind } from '@prisma/client';
import { storeError } from './errors.js';

type SchemaVersion = '1';
const SCHEMA_VERSION: SchemaVersion = '1';

// ─── Enum helpers ─────────────────────────────────────────────────
export type LinkState = z.infer<typeof ExternalContactLinkSchema>['state'];
export function linkStateToString(s: LinkState): string {
  return s;
}

// ─── ExternalContactLink row → contract DTO ───────────────────────
export function contactLinkRowToContract(row: {
  linkId: string;
  schemaVersion: string;
  organizationId: string;
  provider: string;
  connectionId: string;
  externalAccountId: string;
  externalContactId: string | null;
  state: 'EXACT_MATCH' | 'POSSIBLE_MATCH' | 'UNRESOLVED';
  matchedTargetKind: 'TALENT' | 'CLIENT' | null;
  matchedLaborProfileId: string | null;
  matchedLaborProfileVersion: number | null;
  matchedClientContactId: string | null;
  matchedClientContactVersion: number | null;
  candidateReviewQueueEntryId: string | null;
  candidateRecordedAt: Date | null;
  aggregateVersion: number;
  lastAttemptedAt: Date | null;
  evidenceRefsJson: unknown;
}): z.infer<typeof ExternalContactLinkSchema> {
  const external: { externalAccountId: string; externalContactId?: string } = {
    externalAccountId: row.externalAccountId,
  };
  if (row.externalContactId) external.externalContactId = row.externalContactId;

  let matchedTarget: ExternalContactLinkTarget | undefined;
  if (row.state === 'EXACT_MATCH') {
    if (row.matchedTargetKind === 'TALENT') {
      if (!row.matchedLaborProfileId || row.matchedLaborProfileVersion === null) {
        throw storeError(
          'VALIDATION_ERROR',
          'EXACT_MATCH/TALENT row thiếu matchedLaborProfileId/Version',
          { target: 'matchedTarget' },
        );
      }
      matchedTarget = {
        kind: 'TALENT',
        matchedLaborProfileId: row.matchedLaborProfileId,
        matchedLaborProfileVersion: row.matchedLaborProfileVersion,
      };
    } else if (row.matchedTargetKind === 'CLIENT') {
      if (!row.matchedClientContactId || row.matchedClientContactVersion === null) {
        throw storeError(
          'VALIDATION_ERROR',
          'EXACT_MATCH/CLIENT row thiếu matchedClientContactId/Version',
          { target: 'matchedTarget' },
        );
      }
      matchedTarget = {
        kind: 'CLIENT',
        matchedClientContactId: row.matchedClientContactId,
        matchedClientContactVersion: row.matchedClientContactVersion,
      };
    } else {
      throw storeError(
        'VALIDATION_ERROR',
        'EXACT_MATCH row thiếu matchedTargetKind',
        { target: 'matchedTarget' },
      );
    }
  }

  let candidateReference: { reviewQueueEntryId: string; recordedAt: string } | undefined;
  if (row.state === 'POSSIBLE_MATCH') {
    if (!row.candidateReviewQueueEntryId || !row.candidateRecordedAt) {
      throw storeError(
        'VALIDATION_ERROR',
        'POSSIBLE_MATCH row thiếu candidateReference',
        { target: 'candidateReference' },
      );
    }
    candidateReference = {
      reviewQueueEntryId: row.candidateReviewQueueEntryId,
      recordedAt: row.candidateRecordedAt.toISOString(),
    };
  }

  const link: z.infer<typeof ExternalContactLinkSchema> = {
    schemaVersion: row.schemaVersion as SchemaVersion,
    organizationId: row.organizationId,
    provider: row.provider,
    connectionId: row.connectionId,
    external,
    state: row.state,
    aggregateVersion: row.aggregateVersion,
  };
  if (matchedTarget) link.matchedTarget = matchedTarget;
  if (candidateReference) link.candidateReference = candidateReference;
  if (row.lastAttemptedAt) link.lastAttemptedAt = row.lastAttemptedAt.toISOString();
  if (row.evidenceRefsJson && Array.isArray(row.evidenceRefsJson)) {
    link.evidenceRefs = row.evidenceRefsJson as unknown as Array<{
      evidenceId: string;
      evidenceSchemaVersion: SchemaVersion;
      kind: string;
    }>;
  }
  return link;
}

// ─── Contract DTO → Prisma write payload (validated) ──────────────
export function contactLinkContractToWrite(input: z.infer<typeof ExternalContactLinkSchema>): {
  schemaVersion: string;
  organizationId: string;
  provider: string;
  connectionId: string;
  externalAccountId: string;
  externalContactId: string | null;
  state: 'EXACT_MATCH' | 'POSSIBLE_MATCH' | 'UNRESOLVED';
  matchedTargetKind: 'TALENT' | 'CLIENT' | null;
  matchedLaborProfileId: string | null;
  matchedLaborProfileVersion: number | null;
  matchedClientContactId: string | null;
  matchedClientContactVersion: number | null;
  candidateReviewQueueEntryId: string | null;
  candidateRecordedAt: Date | null;
  aggregateVersion: number;
  lastAttemptedAt: Date | null;
  evidenceRefsJson: unknown;
} {
  if (input.state === 'EXACT_MATCH' && !input.matchedTarget) {
    throw storeError('VALIDATION_ERROR', 'EXACT_MATCH cần matchedTarget', { target: 'matchedTarget' });
  }
  if (input.state === 'POSSIBLE_MATCH' && !input.candidateReference) {
    throw storeError('VALIDATION_ERROR', 'POSSIBLE_MATCH cần candidateReference', { target: 'candidateReference' });
  }
  if (input.state === 'POSSIBLE_MATCH' && input.matchedTarget) {
    throw storeError('VALIDATION_ERROR', 'POSSIBLE_MATCH KHÔNG được có matchedTarget', { target: 'matchedTarget' });
  }
  if (input.state === 'UNRESOLVED') {
    if (input.matchedTarget) {
      throw storeError('VALIDATION_ERROR', 'UNRESOLVED KHÔNG được có matchedTarget', { target: 'matchedTarget' });
    }
    if (input.candidateReference) {
      throw storeError('VALIDATION_ERROR', 'UNRESOLVED KHÔNG được có candidateReference', { target: 'candidateReference' });
    }
  }

  let matchedTargetKind: 'TALENT' | 'CLIENT' | null = null;
  let matchedLaborProfileId: string | null = null;
  let matchedLaborProfileVersion: number | null = null;
  let matchedClientContactId: string | null = null;
  let matchedClientContactVersion: number | null = null;
  if (input.matchedTarget) {
    if (input.matchedTarget.kind === 'TALENT') {
      matchedTargetKind = 'TALENT';
      matchedLaborProfileId = input.matchedTarget.matchedLaborProfileId;
      matchedLaborProfileVersion = input.matchedTarget.matchedLaborProfileVersion;
    } else {
      matchedTargetKind = 'CLIENT';
      matchedClientContactId = input.matchedTarget.matchedClientContactId;
      matchedClientContactVersion = input.matchedTarget.matchedClientContactVersion;
    }
  }

  let candidateReviewQueueEntryId: string | null = null;
  let candidateRecordedAt: Date | null = null;
  if (input.candidateReference) {
    candidateReviewQueueEntryId = input.candidateReference.reviewQueueEntryId;
    candidateRecordedAt = new Date(input.candidateReference.recordedAt);
  }

  return {
    schemaVersion: input.schemaVersion,
    organizationId: input.organizationId,
    provider: input.provider,
    connectionId: input.connectionId,
    externalAccountId: input.external.externalAccountId,
    externalContactId: input.external.externalContactId ?? null,
    state: input.state,
    matchedTargetKind,
    matchedLaborProfileId,
    matchedLaborProfileVersion,
    matchedClientContactId,
    matchedClientContactVersion,
    candidateReviewQueueEntryId,
    candidateRecordedAt,
    aggregateVersion: input.aggregateVersion,
    lastAttemptedAt: input.lastAttemptedAt ? new Date(input.lastAttemptedAt) : null,
    evidenceRefsJson: input.evidenceRefs ?? null,
  };
}

// ─── ConversationLink mapping ─────────────────────────────────────
export function convLinkRowToContract(row: {
  linkId: string;
  schemaVersion: string;
  organizationId: string;
  conversationId: string;
  conversationVersion: number;
  conversationKind: 'TALENT' | 'CLIENT' | 'INTERNAL' | 'UNKNOWN';
  primaryTargetKind: 'TALENT' | 'CLIENT' | null;
  primaryLaborProfileId: string | null;
  primaryClientContactId: string | null;
  externalRefsJson: unknown;
  currentRevision: number;
  historyRevisionsJson: unknown;
  updatedAt: Date;
}): z.infer<typeof ConversationLinkSchema> {
  let primaryTarget: CanonicalTargetRef | undefined;
  if (row.primaryTargetKind === 'TALENT' && row.primaryLaborProfileId) {
    primaryTarget = {
      schemaVersion: row.schemaVersion as SchemaVersion,
      kind: 'TALENT',
      laborProfileId: row.primaryLaborProfileId,
      laborProfileVersion: row.conversationVersion,
    };
  } else if (row.primaryTargetKind === 'CLIENT' && row.primaryClientContactId) {
    primaryTarget = {
      schemaVersion: row.schemaVersion as SchemaVersion,
      kind: 'CLIENT',
      clientContactId: row.primaryClientContactId,
      clientContactVersion: row.conversationVersion,
    };
  }

  const externalRefsParsed = parseExternalRefs(row.externalRefsJson, row.schemaVersion as SchemaVersion);
  const link: z.infer<typeof ConversationLinkSchema> = {
    schemaVersion: row.schemaVersion as SchemaVersion,
    organizationId: row.organizationId,
    conversationId: row.conversationId,
    conversationVersion: row.conversationVersion,
    conversationKind: row.conversationKind,
    externalRefs: externalRefsParsed,
    currentRevision: row.currentRevision,
    updatedAt: row.updatedAt.toISOString(),
  };
  if (primaryTarget) link.primaryTarget = primaryTarget;
  if (row.historyRevisionsJson && Array.isArray(row.historyRevisionsJson)) {
    link.historyRevisions = row.historyRevisionsJson as unknown as NonNullable<z.infer<typeof ConversationLinkSchema>['historyRevisions']>;
  }
  return link;
}

function parseExternalRefs(json: unknown, schemaVersion: SchemaVersion): ExternalConversationRef[] {
  if (!Array.isArray(json)) {
    throw storeError('VALIDATION_ERROR', 'externalRefsJson không phải array');
  }
  return json.map((r) => {
    const obj = r as Record<string, unknown>;
    return {
      schemaVersion,
      organizationId: String(obj.organizationId),
      provider: String(obj.provider),
      connectionId: String(obj.connectionId),
      externalAccountId: String(obj.externalAccountId),
      externalInboxId: (obj.externalInboxId as string | undefined) ?? undefined,
      externalConversationId: String(obj.externalConversationId),
      aggregateVersion: Number(obj.aggregateVersion),
      lastSeenAt: (obj.lastSeenAt as string | undefined),
    } as unknown as ExternalConversationRef;
  });
}

// ─── EventReceipt mapping ─────────────────────────────────────────
export function eventReceiptRowToContract(row: {
  schemaVersion: string;
  organizationId: string;
  payloadDigest: string;
  duplicateKind: PrismaEventDuplicateKind;
  resolvedAt: Date | null;
  reasonCode: string | null;
}): z.infer<typeof EventReceiptSchema> {
  const out: z.infer<typeof EventReceiptSchema> = {
    schemaVersion: row.schemaVersion as SchemaVersion,
    organizationId: row.organizationId,
    eventId: 'evt-unknown-00000000',
    payloadDigest: row.payloadDigest,
    duplicateKind: row.duplicateKind as unknown as z.infer<typeof EventReceiptSchema>['duplicateKind'],
  };
  if (row.resolvedAt) out.resolvedAt = row.resolvedAt.toISOString();
  if (row.reasonCode) out.reasonCode = row.reasonCode;
  return out;
}

// ─── DispatchIntent receipt-result envelope helpers ───────────────
export function acceptedResponseFromReceipt(args: {
  receiptId: string;
  commandId: string;
  correlationId?: string;
  schemaVersion?: SchemaVersion;
}): {
  status: 'ACCEPTED';
  schemaVersion: SchemaVersion;
  commandId: string;
  correlationId: string;
  operation: { kind: 'COMMAND_OPERATION'; operationId: string };
  errors: [];
} {
  return {
    status: 'ACCEPTED',
    schemaVersion: (args.schemaVersion ?? SCHEMA_VERSION),
    commandId: args.commandId,
    correlationId: args.correlationId ?? 'corr-unknown-0001',
    operation: { kind: 'COMMAND_OPERATION', operationId: args.receiptId },
    errors: [],
  };
}
