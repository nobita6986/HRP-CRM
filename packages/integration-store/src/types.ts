// src/types.ts — Type contracts cho Integration store (CORE/1.3).
//
// Lưu ý về contracts types (Gate 0 freeze, package `0.0.8-g0.8-fixes`):
//  - Một số Zod schema có chưa export type alias tương ứng.
//    T1 dùng `z.infer<typeof Schema>` locally thay vì import non-existing
//    type name (tránh tự định nghĩa type trùng với contracts → vi phạm
//    "không tự ý thêm field/fill canonical").

import type { z } from 'zod';
import type {
  ExternalContactLinkSchema,
  ConversationLinkSchema,
  ExternalContactRefSchema,
  ExternalConversationRefSchema,
  EventReceiptSchema,
  OutboxDeliveryIntentSchema,
  OutboxDeliveryReceiptSchema,
} from '@hrp-engagement/contracts';

export type SchemaVersion = '1';

export interface ScopeBoundary {
  organizationId: string;
  provider: string;
  connectionId: string;
}

export interface ContactLinkScope extends ScopeBoundary {
  externalAccountId: string;
  externalContactId?: string;
}

export interface ConversationLinkScope {
  organizationId: string;
  conversationId: string;
}

export interface ReceiptScope extends ScopeBoundary {
  eventId: string;
}

export interface IntentScope {
  organizationId: string;
  receiptId: string;
}

// ─── Contract-derived types (không tự định nghĩa, infer từ schema freeze) ───
export type ExternalContactLinkInput = z.infer<typeof ExternalContactLinkSchema>;
export type ExternalContactLinkRow = z.infer<typeof ExternalContactLinkSchema>;
export type ExternalConversationRefInput = z.infer<typeof ExternalConversationRefSchema>;
export type ConversationLinkInput = z.infer<typeof ConversationLinkSchema>;
export type ConversationLinkRow = z.infer<typeof ConversationLinkSchema>;
export type ExternalContactRefInput = z.infer<typeof ExternalContactRefSchema>;
export type EventReceiptInput = z.infer<typeof EventReceiptSchema>;
export type EventReceiptRow = z.infer<typeof EventReceiptSchema>;
export type OutboxDeliveryIntentInput = z.infer<typeof OutboxDeliveryIntentSchema>;
export type OutboxDeliveryReceiptInput = z.infer<typeof OutboxDeliveryReceiptSchema>;

// ─── Repository result types ─────────────────────────────────────
export interface CommitWithIntent {
  receipt: EventReceiptInput;
  intents: OutboxDeliveryIntentInput[];
}

export interface TxnResult {
  receiptId: string;
  intentIds: string[];
  receiptRowVersion: number;
}
