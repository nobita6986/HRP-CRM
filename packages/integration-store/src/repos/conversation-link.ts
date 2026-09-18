// src/repos/conversation-link.ts — ExternalConversationLink repository.
//
// Append history (audit-friendly); currentRevision tăng đơn điệu.
// externalRefs JSON bounded (≤ 64 entry); schema contracts max 64.

import type { PrismaClient } from '@prisma/client';
import type { ConversationLinkInput } from '../types.js';
import { convLinkRowToContract } from '../adapters.js';
import { storeError } from '../errors.js';
import { runInTxn } from '../client.js';
import type { ConversationLink as ContractConversationLink } from '@hrp-engagement/contracts';

const MAX_EXTERNAL_REFS = 64;
const MAX_HISTORY = 64;
const MAX_REVISION_NOTE_LEN = 512;

function assertHistoryNoteSafe(note: string | undefined): void {
  if (note === undefined) return;
  if (note.length > MAX_REVISION_NOTE_LEN) {
    throw storeError('VALIDATION_ERROR', `note > ${MAX_REVISION_NOTE_LEN} chars`, { target: 'note' });
  }
  if (/https?:\/\//i.test(note) || /data:[^\s]+/i.test(note) || /[A-Za-z0-9+/]{100,}={0,2}/.test(note)) {
    throw storeError('VALIDATION_ERROR', 'note KHÔNG chứa URL/base64/data URI', { target: 'note' });
  }
}

function newOpaqueId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 32);
  }
  return `cv-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * Upsert conversation link.
 *  - 1 row per (organizationId, conversationId) — linkId là opaque id lưu ổn định.
 *  - externalRefs validate bounded.
 *  - historyRevisions append-only khi currentRevision tăng.
 *  - atomic update (single transaction).
 */
export async function upsertConversationLink(
  prisma: PrismaClient,
  scope: { organizationId: string; conversationId: string },
  input: ConversationLinkInput,
  newHistoryEntry?: { revisionId: string; recordedAt: string; note?: string },
): Promise<{ row: ContractConversationLink; rowVersion: number }> {
  if (!scope.organizationId || !scope.conversationId) {
    throw storeError('SCOPE_MISMATCH', 'thiếu organizationId hoặc conversationId', {
      target: 'scope',
    });
  }
  if (input.organizationId !== scope.organizationId || input.conversationId !== scope.conversationId) {
    throw storeError('SCOPE_MISMATCH', 'input.organizationId/conversationId không khớp scope');
  }
  if (input.externalRefs.length === 0 || input.externalRefs.length > MAX_EXTERNAL_REFS) {
    throw storeError('VALIDATION_ERROR', `externalRefs.length ∈ [1, ${MAX_EXTERNAL_REFS}]`, {
      target: 'externalRefs',
    });
  }
  if (newHistoryEntry?.note) {
    assertHistoryNoteSafe(newHistoryEntry.note);
  }
  if (input.historyRevisions && input.historyRevisions.length > MAX_HISTORY) {
    throw storeError('VALIDATION_ERROR', `historyRevisions.length <= ${MAX_HISTORY}`, {
      target: 'historyRevisions',
    });
  }

  return runInTxn(prisma, async (tx) => {
    const existing = await tx.externalConversationLink.findFirst({
      where: {
        organizationId: scope.organizationId,
        conversationId: scope.conversationId,
      },
      orderBy: { currentRevision: 'desc' },
    });

    let primaryTargetKind: 'TALENT' | 'CLIENT' | null = null;
    let primaryLaborProfileId: string | null = null;
    let primaryClientContactId: string | null = null;
    if (input.primaryTarget) {
      if (input.primaryTarget.kind === 'TALENT') {
        primaryTargetKind = 'TALENT';
        primaryLaborProfileId = input.primaryTarget.laborProfileId;
      } else {
        primaryTargetKind = 'CLIENT';
        primaryClientContactId = input.primaryTarget.clientContactId;
      }
    }

    if (existing) {
      if (input.currentRevision < existing.currentRevision) {
        throw storeError('VERSION_CONFLICT', 'currentRevision nhỏ hơn row hiện tại', {
          target: 'currentRevision',
        });
      }
      const nextHistory = (existing.historyRevisionsJson as unknown as Array<unknown> | null) ?? [];
      if (newHistoryEntry) {
        nextHistory.push({
          revisionId: newHistoryEntry.revisionId,
          recordedAt: newHistoryEntry.recordedAt,
          ...(newHistoryEntry.note !== undefined ? { note: newHistoryEntry.note } : {}),
        });
      }
      if (nextHistory.length > MAX_HISTORY) {
        throw storeError('VALIDATION_ERROR', `historyRevisions vượt quá ${MAX_HISTORY}`, {
          target: 'historyRevisions',
        });
      }

      const updated = await tx.externalConversationLink.update({
        where: { linkId: existing.linkId },
        data: {
          schemaVersion: input.schemaVersion,
          conversationVersion: input.conversationVersion,
          conversationKind: input.conversationKind,
          primaryTargetKind,
          primaryLaborProfileId,
          primaryClientContactId,
          externalRefsJson: input.externalRefs as unknown as Parameters<typeof tx.externalConversationLink.update>[0]['data']['externalRefsJson'],
          currentRevision: input.currentRevision,
          historyRevisionsJson: nextHistory as unknown as Parameters<typeof tx.externalConversationLink.update>[0]['data']['historyRevisionsJson'],
        },
      });
      return {
        row: convLinkRowToContract(updated as never),
        rowVersion: updated.currentRevision,
      };
    }

    // Tạo mới.
    const linkId = newOpaqueId();
    const initialHistory: Array<{ revisionId: string; recordedAt: string; note?: string }> = [];
    if (newHistoryEntry) {
      initialHistory.push({
        revisionId: newHistoryEntry.revisionId,
        recordedAt: newHistoryEntry.recordedAt,
        ...(newHistoryEntry.note !== undefined ? { note: newHistoryEntry.note } : {}),
      });
    }
    const created = await tx.externalConversationLink.create({
      data: {
        linkId,
        schemaVersion: input.schemaVersion,
        organizationId: scope.organizationId,
        conversationId: scope.conversationId,
        conversationVersion: input.conversationVersion,
        conversationKind: input.conversationKind,
        primaryTargetKind,
        primaryLaborProfileId,
        primaryClientContactId,
        externalRefsJson: input.externalRefs as unknown as Parameters<typeof tx.externalConversationLink.create>[0]['data']['externalRefsJson'],
        currentRevision: input.currentRevision,
        historyRevisionsJson: initialHistory as unknown as Parameters<typeof tx.externalConversationLink.create>[0]['data']['historyRevisionsJson'],
      },
    });
    return {
      row: convLinkRowToContract(created as never),
      rowVersion: created.currentRevision,
    };
  });
}

/**
 * Read-only fetch by canonical conversation id within org.
 */
export async function findConversationLink(
  prisma: PrismaClient,
  scope: { organizationId: string; conversationId: string },
): Promise<ContractConversationLink | null> {
  if (!scope.organizationId || !scope.conversationId) {
    throw storeError('SCOPE_MISMATCH', 'thiếu organizationId hoặc conversationId');
  }
  const row = await prisma.externalConversationLink.findFirst({
    where: {
      organizationId: scope.organizationId,
      conversationId: scope.conversationId,
    },
    orderBy: { currentRevision: 'desc' },
  });
  return row ? convLinkRowToContract(row as never) : null;
}
