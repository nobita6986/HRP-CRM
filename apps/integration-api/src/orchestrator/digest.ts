// src/orchestrator/digest.ts — Canonical draft digest (CORE/1.6).
//
// Backlog §0.3b + §Task 1.6:
//  - Confirmation phải bind draftDigest (SHA-256 hex 64 chars) của canonical JSON draft.
//  - Thay field/evidence/intent/target → digest đổi → confirmation cũ invalid.
//
// Canonical JSON: sort keys recursively để digest ổn định dù thứ tự property khác.
// Chỉ dùng cho digest; không dùng để so sánh equality (deep-equal mới chuẩn).

import { createHash } from 'node:crypto';

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('canonicalJson: non-finite number không hỗ trợ');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
  }
  throw new TypeError('canonicalJson: giá trị không serialize được');
}

/** Compute SHA-256 hex digest (64 chars lowercase) của canonical JSON. */
export function digestCanonical(value: unknown): string {
  const bytes = Buffer.from(canonicalJson(value), 'utf8');
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Build canonical draft từ intake submission cho digest binding.
 *  - Chỉ pick các field bind theo contract intake.ts + profile.ts.
 *  - KHÔNG bind evidenceRefs content (chỉ id+kind); runtime server cross-check ownership.
 *  - KHÔNG bind internal note (redacted, không audit-relevant).
 *  - canonicalId/version: optional; nếu có → bind để chống silent version drift.
 */
export interface CanonicalDraftInput {
  organizationId: string;
  intakeRevisionId: string;
  fullName: string;
  phone: string;
  citizenIdentity: { number: string; address: string };
  contactAddress?: string | undefined;
  dob?: string | undefined;
  intent: {
    stage: string;
    availability: string;
    availableFromDate?: string | undefined;
  };
  evidenceRefs: Array<{ evidenceId: string; kind: string }>;
  canonicalId?: string | undefined;
  canonicalVersion?: number | undefined;
}

export function buildCanonicalDraft(input: CanonicalDraftInput): unknown {
  // Sort evidenceRefs by evidenceId for stable digest.
  const sortedEvidence = [...input.evidenceRefs].sort((a, b) =>
    a.evidenceId.localeCompare(b.evidenceId),
  );
  const base: Record<string, unknown> = {
    organizationId: input.organizationId,
    intakeRevisionId: input.intakeRevisionId,
    fullName: input.fullName,
    phone: input.phone,
    citizenIdentity: input.citizenIdentity,
    intent: input.intent,
    evidenceRefs: sortedEvidence,
  };
  if (input.contactAddress !== undefined) base.contactAddress = input.contactAddress;
  if (input.dob !== undefined) base.dob = input.dob;
  if (input.canonicalId !== undefined) base.canonicalId = input.canonicalId;
  if (input.canonicalVersion !== undefined) base.canonicalVersion = input.canonicalVersion;
  return base;
}

/**
 * Server-computed draft digest (B1 — Auditor finding).
 *
 * Recompute canonical draft digest từ actual request payload (KHÔNG tin
 * client-side draftDigest). Bao phủ:
 *  - fields (fullName, phone, citizenIdentity, contactAddress, dob)
 *  - intent (stage, availability, availableFromDate)
 *  - evidenceRefs (id+kind, sorted)
 *  - target reference (canonicalId + canonicalVersion) nếu confirmation bind
 *
 * Caller (orchestrator) dùng để verify trước khi gọi gateway mutation.
 * Authority boundary tách biệt: digest đúng KHÔNG tự chứng minh actor đã
 * được cấp quyền; runtime HRP gate vẫn phải authorize.
 */
export interface ServerDraftInput {
  organizationId: string;
  intakeRevisionId: string;
  fullName: string;
  phone: string;
  citizenIdentity: { number: string; address: string };
  contactAddress?: string | undefined;
  dob?: string | undefined;
  intent: {
    stage: string;
    availability: string;
    availableFromDate?: string | undefined;
  };
  evidenceRefs: Array<{ evidenceId: string; kind: string }>;
  /** Target reference từ confirmation (chống silent version drift). */
  canonicalId?: string | undefined;
  canonicalVersion?: number | undefined;
}

export function computeServerDigest(input: ServerDraftInput): string {
  return digestCanonical(buildCanonicalDraft(input));
}
