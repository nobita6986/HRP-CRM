/**
 * automation/mock-adapter.ts — deterministic in-memory CRM adapter.
 *
 * The gateway delegates the actual CRM-side query/mutation to an
 * ADAPTER. For N8N/0.2 we ship a MOCK adapter so the contract tests can
 * run without any DB, Docker, or live provider.
 *
 * Adapter contract (AutomationAdapter interface):
 *  - `execute(args)` returns either:
 *      - APPLIED data shape (per operation)
 *      - DEPENDENCY_OFFLINE  (provider unavailable)
 *      - TIMEOUT              (exceeded the per-call budget)
 *  - All adapters MUST redact PII before returning data. The mock
 *    adapter only ever returns REDACTED shapes.
 *  - Adapters MUST NOT log secrets, auth headers, raw transcripts, CCCD,
 *    or sensitive PII.
 *
 * The mock adapter uses fixed fixtures injected via constructor. Tests
 * can override the time, fixtures, or simulate offline/timeout through
 * `simulateOfflineUntil` / `simulateTimeoutOnce`.
 */

import { SCHEMA_VERSION, type ContractError } from '@hrp-engagement/contracts';
import {
  DueNextActionItem,
  AcknowledgeReminderPayload,
  GetNextActionPayload,
  ListDueNextActionsPayload,
} from './types.js';
import { DependencyOfflineError, TimeoutError } from './errors.js';

export type AdapterOutcome<TData> =
  | { kind: 'APPLIED'; data: TData }
  | { kind: 'DEPENDENCY_OFFLINE'; message: string }
  | { kind: 'TIMEOUT'; message: string };

export interface ListDueFixture {
  items: ReadonlyArray<DueNextActionItem>;
  nextCursor?: string;
}

export interface MockAdapterOptions {
  /**
   * Server-trusted organization id the adapter is configured for. Any
   * call with a different organizationId returns DEPENDENCY_OFFLINE.
   */
  organizationId: string;
  connectionId: string;
  /**
   * Initial fixture for listDueNextActions. Tests may mutate the
   * internal fixture via `seedListDue`.
   */
  initialListDue?: ListDueFixture;
  /**
   * Initial single-item fixtures keyed by nextActionId.
   */
  initialGetById?: ReadonlyMap<string, DueNextActionItem>;
  now?: () => number;
}

export interface AutomationAdapter {
  executeListDue(
    args: { organizationId: string; payload: ListDueNextActionsPayload },
  ): Promise<AdapterOutcome<{ items: DueNextActionItem[]; nextCursor?: string }>>;
  executeAcknowledge(
    args: {
      organizationId: string;
      payload: AcknowledgeReminderPayload;
    },
  ): Promise<AdapterOutcome<{ nextActionId: string; reminderRevisionId: string; recordedAt: string }>>;
  executeGet(
    args: {
      organizationId: string;
      payload: GetNextActionPayload;
    },
  ): Promise<AdapterOutcome<{ item: DueNextActionItem }>>;
}

export class MockAutomationAdapter implements AutomationAdapter {
  private readonly orgId: string;
  private readonly connectionId: string;
  private readonly now: () => number;
  private readonly listDueItems: DueNextActionItem[];
  private readonly getById: Map<string, DueNextActionItem>;
  private simulateOfflineUntil = 0;
  private nextCallTimesOut = false;

  constructor(opts: MockAdapterOptions) {
    this.orgId = opts.organizationId;
    this.connectionId = opts.connectionId;
    this.now = opts.now ?? (() => Date.now());
    this.listDueItems = opts.initialListDue
      ? opts.initialListDue.items.slice()
      : [];
    this.getById = new Map();
    if (opts.initialGetById) {
      for (const [k, v] of opts.initialGetById) {
        this.getById.set(k, v);
      }
    }
  }

  /**
   * Mutate the in-memory fixtures from tests.
   */
  seedListDue(args: ListDueFixture): void {
    this.listDueItems.length = 0;
    for (const it of args.items) {
      this.listDueItems.push(it);
    }
  }

  seedItem(item: DueNextActionItem): void {
    this.getById.set(item.nextActionId, item);
  }

  /**
   * Make the adapter report offline for all calls until `untilMs`.
   */
  simulateOffline(untilMs: number): void {
    this.simulateOfflineUntil = Math.max(this.simulateOfflineUntil, untilMs);
  }

  /**
   * Make the adapter time out exactly once.
   */
  simulateTimeoutOnce(): void {
    this.nextCallTimesOut = true;
  }

  private gate(organizationId: string): void {
    if (organizationId !== this.orgId) {
      throw new DependencyOfflineError(
        'adapter not configured for organizationId=' + organizationId,
      );
    }
    if (this.simulateOfflineUntil > this.now()) {
      throw new DependencyOfflineError(
        'adapter simulated offline until ' + this.simulateOfflineUntil,
      );
    }
    if (this.nextCallTimesOut) {
      this.nextCallTimesOut = false;
      throw new TimeoutError('adapter simulated timeout');
    }
  }

  async executeListDue(args: {
    organizationId: string;
    payload: ListDueNextActionsPayload;
  }): Promise<AdapterOutcome<{ items: DueNextActionItem[]; nextCursor?: string }>> {
    this.gate(args.organizationId);
    let items = this.listDueItems.slice();
    const filter = args.payload.statusFilter ?? 'OPEN_OR_DUE';
    if (filter === 'OPEN') {
      items = items.filter((i) => i.status === 'OPEN');
    } else if (filter === 'OVERDUE_ONLY') {
      items = items.filter((i) => i.status === 'OPEN' && Date.parse(i.dueAt) <= this.now());
    } else {
      items = items.filter((i) => i.status === 'OPEN' || i.status === 'DONE');
    }
    const limit = args.payload.pageSize ?? items.length;
    const page = items.slice(0, limit);
    return {
      kind: 'APPLIED',
      data: {
        items: page,
        ...(args.payload.cursor ? { nextCursor: 'next-' + args.payload.cursor } : {}),
      },
    };
  }

  async executeAcknowledge(args: {
    organizationId: string;
    payload: AcknowledgeReminderPayload;
  }): Promise<
    AdapterOutcome<{ nextActionId: string; reminderRevisionId: string; recordedAt: string }>
  > {
    this.gate(args.organizationId);
    const item = this.getById.get(args.payload.nextActionId);
    if (!item) {
      return {
        kind: 'DEPENDENCY_OFFLINE',
        message: 'nextActionId not found',
      };
    }
    return {
      kind: 'APPLIED',
      data: {
        nextActionId: args.payload.nextActionId,
        reminderRevisionId: args.payload.reminderRevisionId,
        recordedAt: new Date(this.now()).toISOString(),
      },
    };
  }

  async executeGet(args: {
    organizationId: string;
    payload: GetNextActionPayload;
  }): Promise<AdapterOutcome<{ item: DueNextActionItem }>> {
    this.gate(args.organizationId);
    const item = this.getById.get(args.payload.nextActionId);
    if (!item) {
      return {
        kind: 'DEPENDENCY_OFFLINE',
        message: 'nextActionId not found',
      };
    }
    return {
      kind: 'APPLIED',
      data: { item },
    };
  }
}

// Export the SCHEMA_VERSION constant for callers using strict module shape.
export { SCHEMA_VERSION };
export type { ContractError };