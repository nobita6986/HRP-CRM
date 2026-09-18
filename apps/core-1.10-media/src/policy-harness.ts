/**
 * policy-harness.ts — Combined policy enforcement for CORE/1.10.
 *
 * Three policies:
 *   1. URL SSRF policy (string-based, no network)
 *   2. Public-evidence policy: only READY evidence from own org can be
 *      read; signed URL TTL is bounded (≤ 60 sec for CCCD per
 *      `ObjectStorageReadRequestSchema.ttlSec ≤ 60`)
 *   3. Cross-org policy: foreign organization access blocked
 *
 * The harness is fixture-based. It does NOT call any HRP runtime,
 * antivirus, or external service. All decisions are derived from
 * in-process state.
 *
 * Use:
 *   const decision = harness({ url, organizationId, evidenceId, ... });
 *   if (!decision.allow) throw new Error(decision.reason);
 */

import {
  evidenceStore,
  type EvidenceRecord,
} from './evidence-store.js';
import { evaluateUrl, type PolicyDecision } from './url-policy.js';
import {
  ObjectStorageReadRequestSchema,
  type ObjectStorageHandle,
} from '@hrp-engagement/contracts';
import { z } from 'zod';

export type HarnessDecision = PolicyDecision & {
  /** Which policy fired (or 'all_passed'). */
  policy: 'ssrf' | 'public_evidence' | 'cross_org' | 'all_passed';
};

export interface HarnessInput {
  /** Optional URL to evaluate (SSRF). */
  url?: string;
  /** Required organizationId for cross-org check. */
  organizationId: string;
  /** Optional evidenceId for cross-org + READY gate. */
  evidenceId?: string;
  /** Optional accessor principal (for audit logging in production). */
  accessor?: string;
  /** Optional read request (validates TTL bound). */
  read?: {
    organizationId: string;
    storageHandle: string;
    accessor: string;
    ttlSec: number;
  };
  /** Synthetic handle (if no real handle is available). */
  handle?: ObjectStorageHandle;
}

/**
 * Run the harness. Returns a decision with the most-restrictive rule
 * (i.e. if any policy denies, deny).
 */
export function harness(input: HarnessInput): HarnessDecision {
  const rules: string[] = [];

  // 1. URL SSRF
  if (input.url !== undefined) {
    const d = evaluateUrl(input.url);
    rules.push(...d.rules);
    if (!d.allow) {
      return { allow: false, reason: d.reason, rules, policy: 'ssrf' };
    }
  }

  // 2. Read TTL bound (CCCD evidence: ≤ 60 sec per contracts Gate 0.3h)
  if (input.read !== undefined) {
    try {
      ObjectStorageReadRequestSchema.parse({
        schemaVersion: '1',
        ...input.read,
      });
      rules.push('read_ttl_ok');
    } catch (e: unknown) {
      const issues =
        e instanceof z.ZodError
          ? e.issues.map((i: z.ZodIssue) => i.message).join('; ')
          : String(e);
      const reason = `READ_TTL_INVALID: ${issues}`;
      return {
        allow: false,
        reason,
        rules,
        policy: 'public_evidence',
      };
    }
  }

  // 3. Cross-org + READY gate
  if (input.evidenceId !== undefined) {
    const rec = lookupEvidence(input.evidenceId);
    if (rec === null) {
      return {
        allow: false,
        reason: `EVIDENCE_NOT_FOUND: ${input.evidenceId}`,
        rules,
        policy: 'cross_org',
      };
    }
    if (rec.organizationId !== input.organizationId) {
      return {
        allow: false,
        reason: `CROSS_ORG: evidence ${input.evidenceId} belongs to ${rec.organizationId}, requested by ${input.organizationId}`,
        rules,
        policy: 'cross_org',
      };
    }
    if (rec.state !== 'READY') {
      return {
        allow: false,
        reason: `EVIDENCE_NOT_READY: ${input.evidenceId} is in state ${rec.state}`,
        rules,
        policy: 'public_evidence',
      };
    }
    rules.push('evidence_ready');
  }

  return { allow: true, reason: 'all policies passed', rules, policy: 'all_passed' };
}

function lookupEvidence(evidenceId: string): EvidenceRecord | null {
  return evidenceStore.get(evidenceId);
}

/* ───────────────────────────────────────────────────────────────────────────
 * Helpers exported for the harness fixtures.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Convenience: build a fixture harness decision from a list of cases. */
export function runFixture(
  cases: readonly HarnessInput[],
): Array<{ input: HarnessInput; decision: HarnessDecision }> {
  return cases.map((c) => ({ input: c, decision: harness(c) }));
}

/** Assert that a fixture URL is denied by the SSRF policy. */
export function assertUrlDenied(url: string): PolicyDecision {
  const d = evaluateUrl(url);
  if (d.allow) {
    throw new Error(`expected URL to be denied: ${url} (got allow)`);
  }
  return d;
}

/** Assert that a fixture URL is allowed by the SSRF policy. */
export function assertUrlAllowed(url: string): PolicyDecision {
  const d = evaluateUrl(url);
  if (!d.allow) {
    throw new Error(`expected URL to be allowed: ${url} (got deny: ${d.reason})`);
  }
  return d;
}
