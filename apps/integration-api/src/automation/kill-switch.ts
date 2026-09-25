/**
 * automation/kill-switch.ts — N8N/0.2 kill-switch store.
 *
 * Supports three kill-switch granularities (per Plan §N8N/0.2 AC):
 *   - workflow   : a specific workflowId is disabled (and ALL
 *                  workflowIds on its connection if no specific id is
 *                  given)
 *   - connection : all workflows on a (organizationId, connectionId)
 *                  are disabled
 *   - organization: ALL automation for that organization is disabled
 *
 * Match order (most specific wins):
 *   1. workflowId + connectionId + organizationId  (most specific)
 *   2. workflowId + organizationId
 *   3. connectionId + organizationId
 *   4. organizationId only (catch-all)
 *
 * The store is in-memory (N8N/0.2 is local/mock-first). Future
 * production migration must persist this; see NEXT-GATE.md.
 */

import { KillSwitchTarget } from './types.js';

export type KillSwitchReason =
  | 'MANUAL'
  | 'POLICY'
  | 'INCIDENT'
  | 'DEPENDENCY'
  | 'TEST';

export interface KillSwitchRule {
  readonly target: KillSwitchTarget;
  readonly active: boolean;
  readonly reason: KillSwitchReason;
  readonly note: string;
  readonly issuedAt: number;
  readonly issuedBy: string;
}

export interface KillSwitchDecision {
  readonly blocked: boolean;
  readonly matchedRule: KillSwitchRule | null;
}

export class KillSwitchStore {
  private readonly rules: KillSwitchRule[] = [];
  private readonly now: () => number;

  constructor(opts: { now?: () => number; seed?: KillSwitchRule[] } = {}) {
    this.now = opts.now ?? (() => Date.now());
    if (opts.seed) {
      for (const r of opts.seed) {
        this.rules.push({ ...r });
      }
    }
  }

  /**
   * Set or update a rule for a target. Upsert semantics — the FIRST
   * rule whose target equals the provided target (deep equality) is
   * replaced; otherwise a new rule is appended.
   */
  setRule(rule: Omit<KillSwitchRule, 'issuedAt'> & { issuedAt?: number }): KillSwitchRule {
    const fullRule: KillSwitchRule = {
      ...rule,
      issuedAt: rule.issuedAt ?? this.now(),
    };
    const idx = this.rules.findIndex((r) => targetsEqual(r.target, fullRule.target));
    if (idx >= 0) {
      this.rules[idx] = fullRule;
    } else {
      this.rules.push(fullRule);
    }
    return fullRule;
  }

  removeRule(target: KillSwitchTarget): boolean {
    const idx = this.rules.findIndex((r) => targetsEqual(r.target, target));
    if (idx < 0) return false;
    this.rules.splice(idx, 1);
    return true;
  }

  listRules(): ReadonlyArray<KillSwitchRule> {
    return this.rules.slice();
  }

  /**
   * Most-specific matching. Disabled rules do not block.
   */
  evaluate(args: {
    workflowId: string;
    organizationId: string;
    connectionId: string;
  }): KillSwitchDecision {
    const candidates = this.rules.filter(
      (r) =>
        r.active &&
        matchTarget(r.target, {
          workflowId: args.workflowId,
          organizationId: args.organizationId,
          connectionId: args.connectionId,
        }),
    );
    if (candidates.length === 0) {
      return { blocked: false, matchedRule: null };
    }
    candidates.sort((a, b) => specificity(b.target) - specificity(a.target));
    const mostSpecific = candidates[0];
    if (!mostSpecific) {
      return { blocked: false, matchedRule: null };
    }
    return { blocked: true, matchedRule: mostSpecific };
  }

  clear(): void {
    this.rules.length = 0;
  }
}

function targetsEqual(a: KillSwitchTarget, b: KillSwitchTarget): boolean {
  return (
    (a.workflowId ?? null) === (b.workflowId ?? null) &&
    (a.connectionId ?? null) === (b.connectionId ?? null) &&
    (a.organizationId ?? null) === (b.organizationId ?? null)
  );
}

function specificity(t: KillSwitchTarget): number {
  let s = 0;
  if (t.workflowId) s += 100;
  if (t.connectionId) s += 10;
  if (t.organizationId) s += 1;
  return s;
}

function matchTarget(
  t: KillSwitchTarget,
  args: { workflowId: string; organizationId: string; connectionId: string },
): boolean {
  if (t.organizationId && t.organizationId !== args.organizationId) return false;
  if (t.connectionId && t.connectionId !== args.connectionId) return false;
  if (t.workflowId && t.workflowId !== args.workflowId) return false;
  return true;
}