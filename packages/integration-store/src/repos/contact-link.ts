// src/repos/contact-link.ts — ExternalContactLink repository.
//
// Atomic upsert theo scope (organizationId + provider + connectionId +
// externalAccountId + externalContactId). Một duplicate eventId KHÔNG
// được tạo row mới; aggregateVersion phải tăng đơn điệu (callers check
// monotonic ở application layer; SQL UPDATE set version mới nếu
// lớn hơn).
//
// Cross-scope query: KHÔNG cho phép. Mọi `where` phải có organizationId
// + provider + connectionId. Helper `assertScoped` enforce.

import type { PrismaClient } from '@prisma/client';
import type { ContactLinkScope, ExternalContactLinkRow } from '../types.js';
import { contactLinkRowToContract, contactLinkContractToWrite } from '../adapters.js';
import { storeError, isStoreError, type StoreError } from '../errors.js';
import { runInTxn } from '../client.js';
import type {
  ExternalContactLink as ContractExternalContactLink,
} from '@hrp-engagement/contracts';

/**
 * Assert where-clause đủ scope. Throw SCOPE_MISMATCH nếu thiếu.
 * KHÔNG trust caller — ép enforce ở mọi repo function.
 */
function assertScoped(scope: Partial<ContactLinkScope>): asserts scope is ContactLinkScope {
  if (!scope.organizationId || !scope.provider || !scope.connectionId) {
    throw storeError(
      'SCOPE_MISMATCH',
      'thiếu scope (organizationId/provider/connectionId)',
      { target: 'where.organizationId' },
    );
  }
}

function newOpaqueId(): string {
  // Deterministic test: dùng crypto.randomUUID nếu có; fallback time + counter.
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 32);
  }
  return `lk-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * Upsert contact link trong transaction.
 *  - Generate `linkId` nếu row mới.
 *  - Yêu cầu aggregateVersion new > existing (monotonic).
 *  - Duplicate (same scope + different version / idempotent retry same version) →
 *    return existing row, không fail (idempotent store).
 *  - Duplicate (same scope + lower version / different target) → VERSION_CONFLICT.
 */
export async function upsertContactLink(
  prisma: PrismaClient,
  scope: ContactLinkScope,
  input: ContractExternalContactLink,
): Promise<{ row: ContractExternalContactLink; created: boolean; rowVersion: number }> {
  assertScoped(scope);

  const write = contactLinkContractToWrite(input);

  // Cross-scope guard: caller-supplied organizationId/provider/connectionId
  // phải khớp với scope tham số (chặn "scope" chỉ là place-holder).
  if (
    write.organizationId !== scope.organizationId ||
    write.provider !== scope.provider ||
    write.connectionId !== scope.connectionId
  ) {
    throw storeError('SCOPE_MISMATCH', 'input.organization/provider/connection không khớp scope', {
      target: 'input.organizationId',
    });
  }

  return runInTxn(prisma, async (tx) => {
    const existing = await tx.externalContactLink.findUnique({
      where: { uq_contact_link_scope: {
        organizationId: scope.organizationId,
        provider: scope.provider,
        connectionId: scope.connectionId,
        externalAccountId: scope.externalAccountId,
        externalContactId: scope.externalContactId ?? '',
      } },
    });

    if (existing) {
      // Monotonic version check.
      if (write.aggregateVersion < existing.aggregateVersion) {
        throw storeError('VERSION_CONFLICT', 'aggregateVersion nhỏ hơn row hiện tại', {
          target: 'aggregateVersion',
        });
      }
      // Same version → idempotent (return existing).
      if (write.aggregateVersion === existing.aggregateVersion) {
        return {
          row: contactLinkRowToContract(existing as never),
          created: false,
          rowVersion: existing.aggregateVersion,
        };
      }
      const updated = await tx.externalContactLink.update({
        where: { linkId: existing.linkId },
        data: {
          state: write.state,
          matchedTargetKind: write.matchedTargetKind,
          matchedLaborProfileId: write.matchedLaborProfileId,
          matchedLaborProfileVersion: write.matchedLaborProfileVersion,
          matchedClientContactId: write.matchedClientContactId,
          matchedClientContactVersion: write.matchedClientContactVersion,
          candidateReviewQueueEntryId: write.candidateReviewQueueEntryId,
          candidateRecordedAt: write.candidateRecordedAt,
          aggregateVersion: write.aggregateVersion,
          lastAttemptedAt: write.lastAttemptedAt,
          evidenceRefsJson: write.evidenceRefsJson ?? undefined,
          schemaVersion: write.schemaVersion,
        },
      });
      return {
        row: contactLinkRowToContract(updated as never),
        created: false,
        rowVersion: updated.aggregateVersion,
      };
    }

    // Tạo mới — generate opaque linkId.
    const linkId = newOpaqueId();
    const created = await tx.externalContactLink.create({
      data: {
        linkId,
        schemaVersion: write.schemaVersion,
        organizationId: write.organizationId,
        provider: write.provider,
        connectionId: write.connectionId,
        externalAccountId: write.externalAccountId,
        externalContactId: write.externalContactId,
        state: write.state,
        matchedTargetKind: write.matchedTargetKind,
        matchedLaborProfileId: write.matchedLaborProfileId,
        matchedLaborProfileVersion: write.matchedLaborProfileVersion,
        matchedClientContactId: write.matchedClientContactId,
        matchedClientContactVersion: write.matchedClientContactVersion,
        candidateReviewQueueEntryId: write.candidateReviewQueueEntryId,
        candidateRecordedAt: write.candidateRecordedAt,
        aggregateVersion: write.aggregateVersion,
        lastAttemptedAt: write.lastAttemptedAt,
        evidenceRefsJson: write.evidenceRefsJson ?? undefined,
      },
    });
    return {
      row: contactLinkRowToContract(created as never),
      created: true,
      rowVersion: created.aggregateVersion,
    };
  });
}

/**
 * Find contact link by scope (read-only, no txn cần cho SELECT).
 */
export async function findContactLinkByScope(
  prisma: PrismaClient,
  scope: ContactLinkScope,
): Promise<ContractExternalContactLink | null> {
  assertScoped(scope);
  const row = await prisma.externalContactLink.findUnique({
    where: { uq_contact_link_scope: {
      organizationId: scope.organizationId,
      provider: scope.provider,
      connectionId: scope.connectionId,
      externalAccountId: scope.externalAccountId,
      externalContactId: scope.externalContactId ?? '',
    } },
  });
  return row ? contactLinkRowToContract(row as never) : null;
}

/**
 * List contact links by scope subset.
 * Always filtered by organizationId at minimum.
 */
export async function listContactLinksByOrg(
  prisma: PrismaClient,
  query: {
    organizationId: string;
    provider?: string;
    connectionId?: string;
    state?: 'EXACT_MATCH' | 'POSSIBLE_MATCH' | 'UNRESOLVED';
    cursor?: string;
    pageSize?: number;
  },
): Promise<{ items: ContractExternalContactLink[]; nextCursor: string | undefined }> {
  if (!query.organizationId) {
    throw storeError('TENANT_SCOPE_REQUIRED', 'listContactLinksByOrg yêu cầu organizationId', {
      target: 'organizationId',
    });
  }
  const pageSize = Math.min(query.pageSize ?? 20, 100);
  const where: {
    organizationId: string;
    provider?: string;
    connectionId?: string;
    state?: 'EXACT_MATCH' | 'POSSIBLE_MATCH' | 'UNRESOLVED';
  } = { organizationId: query.organizationId };
  if (query.provider) where.provider = query.provider;
  if (query.connectionId) where.connectionId = query.connectionId;
  if (query.state) where.state = query.state;

  // cursor: opaque — tạm thời dùng linkId (deterministic monotonic).
  type ListArgs = Parameters<typeof prisma.externalContactLink.findMany>[0];
  const cursorArg: ListArgs | undefined = query.cursor
    ? ({ cursor: { linkId: query.cursor }, skip: 1 } as unknown as ListArgs)
    : undefined;

  const rows = await prisma.externalContactLink.findMany({
    where,
    orderBy: { linkId: 'asc' },
    take: pageSize,
    ...(cursorArg ?? {}),
  });
  const items = rows.map((r) => contactLinkRowToContract(r as never));
  const nextLinkId = rows.length === pageSize ? (rows[rows.length - 1]?.linkId) : undefined;
  const nextCursor = nextLinkId ? nextLinkId : undefined;
  return { items, nextCursor };
}

/**
 * Helper: bọc StoreError để caller Zod-parse / map canonical error.
 */
export function asStoreError<T>(thunk: () => Promise<T>): Promise<T | StoreError> {
  return thunk().catch((e: unknown) => {
    if (isStoreError(e)) return e;
    return storeError('TRANSACTION_FAILED', e instanceof Error ? e.message : String(e));
  });
}
