// src/index.ts — Public surface cho @hrp-engagement/integration-store (CORE/1.3).
//
// Pin contracts 0.0.8-g0.8-fixes. Schema riêng PostgreSQL (không share
// với HRP core). Cross-DB FK: KHÔNG có. Canonical HRP IDs chỉ scalar.

export {
  createPrismaClient,
  createMockPrismaClient,
  assertSafeDatabaseUrl,
  runInTxn,
} from './client.js';
export type {
  CreatePrismaOptions,
  MockCheckpointStore,
  MockPrismaClient,
  PrismaTransactionClient,
} from './client.js';

export {
  contactLinkContractToWrite,
  contactLinkRowToContract,
  convLinkRowToContract,
  eventReceiptRowToContract,
  acceptedResponseFromReceipt,
} from './adapters.js';

export {
  upsertContactLink,
  findContactLinkByScope,
  listContactLinksByOrg,
  asStoreError,
} from './repos/contact-link.js';
export {
  upsertConversationLink,
  findConversationLink,
} from './repos/conversation-link.js';
export {
  commitReceiptWithIntents,
  findReceipt,
  listReceiptsByOrg,
  listDeadLetteredReceipts,
  redriveReceipt,
  getDlqStats,
  type DeadLetterReceipt,
  type ListDeadLetterOpts,
  type RedriveReceiptResult,
  type RedriveReceiptError,
} from './repos/event-receipt.js';
export {
  createIntakeCheckpoint,
  findIntakeCheckpoint,
  updateIntakeCheckpoint,
} from './repos/intake-checkpoint.js';
export type {
  IntakeCheckpointInput,
  IntakeCheckpointRow,
  IntakeCheckpointStateWire,
  IntakeCheckpointUpdate,
} from './repos/intake-checkpoint.js';

// CORE/1.8 — RecoveryAction repository (reconciler for stuck receipts/intents).
export {
  createRecoveryAction,
  findRecoveryAction,
  completeRecoveryAction,
  findStuckReceipts,
  findStuckIntents,
  resetStuckReceipt,
  resetStuckIntent,
  listRecoveryActions,
} from './repos/reconciliation.js';
export type {
  RecoveryActionRow,
  CreateRecoveryActionArgs,
  CreateRecoveryResult,
  RecoveryStatusWire,
  RecoveryItemTypeWire,
  RecoveryActionKindWire,
} from './repos/reconciliation.js';

export { storeError, isStoreError } from './errors.js';
export type { StoreError } from './errors.js';

export * as worker from './worker/index.js';

export type {
  SchemaVersion,
  ScopeBoundary,
  ContactLinkScope,
  ConversationLinkScope,
  ReceiptScope,
  IntentScope,
  ExternalContactLinkInput,
  ExternalContactLinkRow,
  ExternalConversationRefInput,
  ConversationLinkInput,
  ConversationLinkRow,
  ExternalContactRefInput,
  EventReceiptInput,
  EventReceiptRow,
  OutboxDeliveryIntentInput,
  OutboxDeliveryReceiptInput,
  CommitWithIntent,
  TxnResult,
} from './types.js';

/** Schema name mặc định cho Prisma datasource (Task 1.3 isolation). */
export const INTEGRATION_SCHEMA_NAME = 'integration' as const;
