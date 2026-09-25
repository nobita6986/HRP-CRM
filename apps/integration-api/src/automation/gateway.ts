/**
 * automation/gateway.ts — N8N/0.2 AutomationGateway class.
 *
 * Pipeline (in order):
 *   1. Pre-flight: payload size limit (byte count).
 *   2. Schema validation (AutomationRequestSchema).
 *   3. Service identity resolve (registry) + HMAC verify + expiry check.
 *   4. Organization binding check (body org == registry org).
 *   5. Operation allowlist (entry.allowedOperations + global allowlist).
 *   6. Rate limit (per workflow).
 *   7. Kill switch check (per workflow/connection/org).
 *   8. Idempotency lookup (digest + bound correlationId match).
 *      - hit + same digest + same bound correlationId -> replay cached result
 *      - hit + diff digest -> IDEMPOTENCY_CONFLICT (409, payload_digest_mismatch)
 *      - hit + same digest + diff correlationId -> IDEMPOTENCY_CONFLICT
 *        (409, correlation_id_mismatch)
 *      - miss -> continue
 *   9. Adapter call (with timeout).
 *  10. Build wire response, record idempotency, return.
 *
 * Every failure path is mapped to a frozen ContractError code; the
 * N8N-specific internal codes are NEVER placed on the wire.
 */

import {
  SCHEMA_VERSION,
  type ContractError,
  makeError,
} from '@hrp-engagement/contracts';
import {
  AutomationRequestSchema,
  AutomationRequest,
  AutomationWireResponse,
  AutomationGatewayErrorCode,
  DEFAULT_AUTOMATION_GATEWAY_CONFIG,
  AutomationGatewayConfig,
  makeAutomationError,
  getAutomationGatewayError,
  AutomationIdempotencyRecord,
  AcknowledgeReminderData,
  GetNextActionData,
  ListDueNextActionsData,
} from './types.js';
import { AutomationServiceRegistry } from './connection-registry.js';
import { KillSwitchStore } from './kill-switch.js';
import { TokenBucketRateLimiter } from './rate-limiter.js';
import { AutomationIdempotencyStore } from './idempotency-store.js';
import { AutomationAdapter } from './mock-adapter.js';
import { DependencyOfflineError, TimeoutError } from './errors.js';
import {
  canonicalJson,
  payloadDigestHex,
  hmacSha256Hex,
  safeEqualHex,
} from './digest.js';
import { redactJson } from './redact.js';

export interface GatewayInvokeArgs {
  rawBody: Uint8Array;
  envelope: unknown;
  credential: {
    serviceId: string;
    organizationId: string;
    connectionId: string;
    signatureHex: string;
  };
  timeoutMs?: number;
}

export interface GatewayInvokeResult {
  readonly httpStatus: number;
  readonly response: AutomationWireResponse;
  readonly logEntry: RedactedLogEntry;
  readonly internalCode?: AutomationGatewayErrorCode;
}

export interface RedactedLogEntry {
  readonly at: number;
  readonly correlationId: string;
  readonly commandId: string;
  readonly commandName: string;
  readonly workflowId: string;
  readonly workflowRevision: number;
  readonly n8nExecutionId: string;
  readonly organizationId: string;
  readonly connectionId: string;
  readonly serviceId: string;
  readonly idempotencyKey: string;
  readonly payloadDigest: string;
  readonly scopeKey: string;
  readonly outcome: AutomationWireResponse['status'];
  readonly wireErrorCodes: ReadonlyArray<ContractError['code']>;
  readonly cacheHit: boolean;
  readonly idempotencyConflict: boolean;
  readonly killSwitchRuleId: string | null;
  readonly bytesIn: number;
  readonly bytesOut: number;
  readonly durationMs: number;
  readonly httpStatus: number;
}

export interface AutomationGatewayDeps {
  registry: AutomationServiceRegistry;
  killSwitch: KillSwitchStore;
  rateLimiter: TokenBucketRateLimiter;
  idempotency: AutomationIdempotencyStore;
  adapter: AutomationAdapter;
  config?: Partial<AutomationGatewayConfig>;
  now?: () => number;
}

function stripNonDigestFields(envelope: AutomationRequest): Record<string, unknown> {
  const { correlationId, occurredAt, commandId, automationSource, ...rest } = envelope;
  void correlationId;
  void occurredAt;
  void commandId;
  if (automationSource && typeof automationSource === 'object') {
    const { n8nExecutionId, ...srcRest } = automationSource as Record<string, unknown>;
    void n8nExecutionId;
    return { ...rest, automationSource: srcRest };
  }
  return rest;
}

function httpStatusFromErrors(
  errors: ReadonlyArray<ContractError>,
  defaultHint: number,
): number {
  if (errors.length === 0) return defaultHint;
  const code = errors[0]?.code;
  switch (code) {
    case 'VALIDATION_ERROR':
      return 422;
    case 'AUTHENTICATION_REQUIRED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'UNRESOLVED_IDENTITY':
      return 422;
    case 'POLICY_REJECTION':
      return 422;
    case 'VERSION_CONFLICT':
      return 409;
    case 'IDEMPOTENCY_CONFLICT':
      return 409;
    case 'DEPENDENCY_UNAVAILABLE':
      return 503;
    case 'RATE_LIMITED':
      return 429;
    case 'UNKNOWN_COMMAND_OUTCOME':
      return 503;
    default:
      return defaultHint;
  }
}

export class AutomationGateway {
  private readonly registry: AutomationServiceRegistry;
  private readonly killSwitch: KillSwitchStore;
  private readonly rateLimiter: TokenBucketRateLimiter;
  private readonly idempotency: AutomationIdempotencyStore;
  private readonly adapter: AutomationAdapter;
  private readonly config: AutomationGatewayConfig;
  private readonly now: () => number;

  constructor(deps: AutomationGatewayDeps) {
    this.registry = deps.registry;
    this.killSwitch = deps.killSwitch;
    this.rateLimiter = deps.rateLimiter;
    this.idempotency = deps.idempotency;
    this.adapter = deps.adapter;
    this.config = { ...DEFAULT_AUTOMATION_GATEWAY_CONFIG, ...(deps.config ?? {}) };
    this.now = deps.now ?? (() => Date.now());
  }

  getConfig(): AutomationGatewayConfig {
    return this.config;
  }

  async invoke(args: GatewayInvokeArgs): Promise<GatewayInvokeResult> {
    const t0 = this.now();
    const bytesIn = args.rawBody.length;

    if (bytesIn > this.config.maxPayloadBytes) {
      return this.fail(
        'n8n_payload_too_large',
        args.credential,
        t0,
        bytesIn,
        0,
        'request',
        null,
        false,
        false,
        null,
      );
    }

    const parsed = AutomationRequestSchema.safeParse(args.envelope);
    if (!parsed.success) {
      // Differentiate commandName mismatch (superRefine on the envelope)
      // from genuine malformed body. We re-parse with the operation schema
      // stripped to check.
      const issue = parsed.error.issues[0];
      const isCommandNameMismatch =
        issue?.path && Array.isArray(issue.path) && issue.path[0] === 'commandName';
      const code: AutomationGatewayErrorCode = isCommandNameMismatch
        ? 'n8n_command_name_mismatch'
        : 'n8n_internal_error';
      return this.fail(
        code,
        args.credential,
        t0,
        bytesIn,
        0,
        'request',
        null,
        false,
        false,
        null,
      );
    }
    const envelope = parsed.data;

    const resolved = this.registry.resolve({
      serviceId: args.credential.serviceId,
      organizationId: args.credential.organizationId,
      connectionId: args.credential.connectionId,
    });
    if (!resolved.ok) {
      const code: AutomationGatewayErrorCode =
        resolved.code === 'credential_expired'
          ? 'n8n_credential_expired'
          : 'n8n_signature_mismatch';
      return this.fail(code, args.credential, t0, bytesIn, 0, 'request', envelope, false, false, null);
    }
    const resolvedConnectionId = resolved.entry.connectionId;

    const scopeKey = AutomationIdempotencyStore.scopeKey({
      // Server-trusted scope: use credential-resolved org + connection.
      organizationId: resolved.entry.organizationId,
      connectionId: resolvedConnectionId,
      serviceId: args.credential.serviceId,
      commandName: envelope.commandName,
      idempotencyKey: envelope.idempotencyKey,
    });
    // Per N8N/0.3 r1: correlationId, n8nExecutionId, commandId, and
    // occurredAt are per-execution tracking ids, NOT part of the
    // idempotency payload digest. The digest is over the envelope
    // with these fields stripped so retry flows within the SAME
    // logical command dedupe correctly. The same envelope (same
    // digest) under a DIFFERENT correlationId is treated as a
    // separate logical flow and 409s as IDEMPOTENCY_CONFLICT
    // (correlation_id_mismatch); see AutomationIdempotencyStore.
    const envelopeForDigest = stripNonDigestFields(envelope);
    const payloadDigest = payloadDigestHex(canonicalJson(envelopeForDigest));
    const signingInput = scopeKey + '\n' + payloadDigest;
    const expectedSig = hmacSha256Hex(signingInput, resolved.entry.secret);
    if (!safeEqualHex(expectedSig, args.credential.signatureHex)) {
      return this.fail(
        'n8n_signature_mismatch',
        args.credential,
        t0,
        bytesIn,
        0,
        'request',
        envelope,
        false,
        false,
        null,
      );
    }

    if (envelope.organizationId !== resolved.entry.organizationId) {
      return this.fail(
        'n8n_organization_mismatch',
        args.credential,
        t0,
        bytesIn,
        0,
        'organizationId',
        envelope,
        false,
        false,
        null,
      );
    }
    // connectionId is NOT in the frozen envelope; resolve from credential.
    if (args.credential.connectionId !== resolved.entry.connectionId) {
      return this.fail(
        'n8n_organization_mismatch',
        args.credential,
        t0,
        bytesIn,
        0,
        'request',
        envelope,
        false,
        false,
        null,
      );
    }

    if (!this.registry.isOperationAllowed(resolved.entry, envelope.commandName)) {
      return this.fail(
        'n8n_operation_not_allowed',
        args.credential,
        t0,
        bytesIn,
        0,
        'commandId',
        envelope,
        false,
        false,
        null,
      );
    }

    const rlKey = resolved.entry.serviceId + '|' + envelope.automationSource.workflowId;
    const rl = this.rateLimiter.take(rlKey);
    if (!rl.allowed) {
      return this.fail(
        'n8n_rate_limited',
        args.credential,
        t0,
        bytesIn,
        0,
        'request',
        envelope,
        false,
        false,
        null,
      );
    }

    const ks = this.killSwitch.evaluate({
      workflowId: envelope.automationSource.workflowId,
      organizationId: envelope.organizationId,
      connectionId: resolvedConnectionId,
    });
    if (ks.blocked) {
      const ruleId = ks.matchedRule
        ? 'rule:' + ks.matchedRule.reason + ':' + String(ks.matchedRule.issuedAt)
        : null;
      return this.fail(
        'n8n_kill_switch_active',
        args.credential,
        t0,
        bytesIn,
        0,
        'request',
        envelope,
        false,
        false,
        ruleId,
      );
    }

    const idem = this.idempotency.lookup({
      scopeKey,
      payloadDigest,
      correlationId: envelope.correlationId,
    });
    if (idem.hit && idem.cacheHit && idem.record) {
      const cached = idem.record.result;
      const httpStatus =
        cached.status === 'FAILED'
          ? httpStatusFromErrors(cached.errors ?? [], 500)
          : cached.status === 'ACCEPTED'
            ? 202
            : 200;
      return {
        httpStatus,
        response: cached,
        internalCode: undefined,
        logEntry: this.buildLog(
          t0,
          bytesIn,
          JSON.stringify(redactJson(cached)).length,
          envelope,
          args.credential,
          scopeKey,
          payloadDigest,
          cached,
          true,
          false,
          null,
        ),
      };
    }
    if (idem.hit && !idem.cacheHit && 'idempotencyConflict' in idem) {
      return this.fail(
        'n8n_idempotency_conflict',
        args.credential,
        t0,
        bytesIn,
        0,
        'idempotencyKey',
        envelope,
        false,
        true,
        null,
      );
    }

    const timeoutMs = Math.min(
      args.timeoutMs ?? this.config.defaultTimeoutMs,
      this.config.defaultTimeoutMs,
    );
    let outcome: AdapterOutcome;
    try {
      outcome = await this.runAdapter(envelope, timeoutMs);
    } catch (err) {
      if (err instanceof TimeoutError) {
        return this.fail(
          'n8n_timeout',
          args.credential,
          t0,
          bytesIn,
          0,
          'request',
          envelope,
          false,
          false,
          null,
        );
      }
      if (err instanceof DependencyOfflineError) {
        return this.fail(
          'n8n_dependency_offline',
          args.credential,
          t0,
          bytesIn,
          0,
          'request',
          envelope,
          false,
          false,
          null,
        );
      }
      return this.fail(
        'n8n_internal_error',
        args.credential,
        t0,
        bytesIn,
        0,
        'request',
        envelope,
        false,
        false,
        null,
      );
    }

    const wire = this.toWireResponse(envelope, outcome);
    const record: AutomationIdempotencyRecord = {
      scopeKey,
      idempotencyKey: envelope.idempotencyKey,
      payloadDigest,
      boundCorrelationId: envelope.correlationId,
      commandName: envelope.commandName,
      organizationId: envelope.organizationId,
      connectionId: resolvedConnectionId,
      workflowId: envelope.automationSource.workflowId,
      createdAt: this.now(),
      result: wire,
    };
    this.idempotency.record(record);

    const httpStatus =
      wire.status === 'FAILED'
        ? httpStatusFromErrors(wire.errors ?? [], 500)
        : wire.status === 'ACCEPTED'
          ? 202
          : 200;
    return {
      httpStatus,
      response: wire,
      internalCode:
        outcome.kind === 'TIMEOUT'
          ? 'n8n_timeout'
          : outcome.kind === 'DEPENDENCY_OFFLINE'
            ? 'n8n_dependency_offline'
            : undefined,
      logEntry: this.buildLog(
        t0,
        bytesIn,
        JSON.stringify(redactJson(wire)).length,
        envelope,
        args.credential,
        scopeKey,
        payloadDigest,
        wire,
        false,
        false,
        null,
      ),
    };
  }

  private async runAdapter(
    envelope: AutomationRequest,
    timeoutMs: number,
  ): Promise<AdapterOutcome> {
    const op = envelope.operation;
    let promise: Promise<unknown>;
    if (op.op === 'listDueNextActions') {
      promise = this.adapter.executeListDue({
        organizationId: envelope.organizationId,
        payload: op.payload,
      });
    } else if (op.op === 'acknowledgeReminder') {
      promise = this.adapter.executeAcknowledge({
        organizationId: envelope.organizationId,
        payload: op.payload,
      });
    } else if (op.op === 'getNextAction') {
      promise = this.adapter.executeGet({
        organizationId: envelope.organizationId,
        payload: op.payload,
      });
    } else {
      throw new Error('unreachable: discriminated union');
    }
    const timed = new Promise<AdapterOutcome>((resolve) =>
      setTimeout(
        () => resolve({ kind: 'TIMEOUT' as const, message: 'adapter timeout' }),
        Math.max(1, timeoutMs),
      ),
    );
    const r = (await Promise.race([promise, timed])) as
      | { kind: 'APPLIED'; data: unknown }
      | { kind: 'DEPENDENCY_OFFLINE'; message: string };
    return r;
  }

  private toWireResponse(
    envelope: AutomationRequest,
    outcome: AdapterOutcome,
  ): AutomationWireResponse {
    if (outcome.kind === 'APPLIED') {
      const op = envelope.operation;
      let data: ListDueNextActionsData | AcknowledgeReminderData | GetNextActionData | null = null;
      if (op.op === 'listDueNextActions' && outcome.data && typeof outcome.data === 'object') {
        const d = outcome.data as { items: unknown[]; nextCursor?: string };
        data = {
          schemaVersion: SCHEMA_VERSION,
          items: d.items as ListDueNextActionsData['items'],
          ...(d.nextCursor ? { nextCursor: d.nextCursor } : {}),
          serverNow: new Date(this.now()).toISOString(),
        };
      } else if (op.op === 'acknowledgeReminder' && outcome.data && typeof outcome.data === 'object') {
        const d = outcome.data as { nextActionId: string; reminderRevisionId: string; recordedAt: string };
        data = {
          schemaVersion: SCHEMA_VERSION,
          nextActionId: d.nextActionId,
          reminderRevisionId: d.reminderRevisionId,
          recordedAt: d.recordedAt,
        };
      } else if (op.op === 'getNextAction' && outcome.data && typeof outcome.data === 'object') {
        const d = outcome.data as { item: unknown };
        data = {
          schemaVersion: SCHEMA_VERSION,
          item: d.item as GetNextActionData['item'],
          serverNow: new Date(this.now()).toISOString(),
        };
      }
      if (!data) {
        return this.makeFailureResponse(envelope, [
          makeError('UNKNOWN_COMMAND_OUTCOME', 'request'),
        ]);
      }
      return {
        status: 'APPLIED',
        schemaVersion: SCHEMA_VERSION,
        commandId: envelope.commandId,
        correlationId: envelope.correlationId,
        data,
      };
    }
    if (outcome.kind === 'TIMEOUT') {
      return this.makeFailureResponse(envelope, [
        makeError('DEPENDENCY_UNAVAILABLE', 'request'),
      ]);
    }
    return this.makeFailureResponse(envelope, [
      makeError('DEPENDENCY_UNAVAILABLE', 'request'),
    ]);
  }

  private makeFailureResponse(
    envelope: AutomationRequest,
    errors: ReadonlyArray<ContractError>,
  ): AutomationWireResponse {
    return {
      status: 'FAILED',
      schemaVersion: SCHEMA_VERSION,
      commandId: envelope.commandId,
      correlationId: envelope.correlationId,
      errors,
    };
  }

  private fail(
    code: AutomationGatewayErrorCode,
    credential: GatewayInvokeArgs['credential'],
    t0: number,
    bytesIn: number,
    bytesOut: number,
    fieldPath: ContractError['fieldPath'] | undefined,
    envelope: AutomationRequest | null,
    cacheHit: boolean,
    idempotencyConflict: boolean,
    killSwitchRuleId: string | null,
    resolvedConnectionId: string | null = null,
  ): GatewayInvokeResult {
    const def = getAutomationGatewayError(code);
    const err = makeAutomationError(code, fieldPath ?? def.fieldPath);
    const response: AutomationWireResponse = {
      status: 'FAILED',
      schemaVersion: SCHEMA_VERSION,
      commandId: envelope?.commandId ?? 'cmd-unknown',
      correlationId: envelope?.correlationId ?? 'corr-unknown',
      errors: [err],
    };
    return {
      httpStatus: def.httpHint,
      response,
      internalCode: code,
      logEntry: this.buildLog(
        t0,
        bytesIn,
        bytesOut,
        envelope,
        credential,
        envelope
          ? AutomationIdempotencyStore.scopeKey({
              organizationId: envelope.organizationId,
              connectionId: resolvedConnectionId ?? credential.connectionId,
              serviceId: credential.serviceId,
              commandName: envelope.commandName,
              idempotencyKey: envelope.idempotencyKey,
            })
          : 'unknown',
        envelope ? payloadDigestHex(canonicalJson(envelope)) : 'unknown',
        response,
        cacheHit,
        idempotencyConflict,
        killSwitchRuleId,
      ),
    };
  }

  private buildLog(
    t0: number,
    bytesIn: number,
    bytesOut: number,
    envelope: AutomationRequest | null,
    credential: GatewayInvokeArgs['credential'],
    scopeKey: string,
    payloadDigest: string,
    response: AutomationWireResponse,
    cacheHit: boolean,
    idempotencyConflict: boolean,
    killSwitchRuleId: string | null,
    resolvedConnectionId: string | null = null,
  ): RedactedLogEntry {
    return {
      at: this.now(),
      correlationId: response.correlationId,
      commandId: response.commandId,
      commandName: envelope?.commandName ?? 'unknown',
      workflowId: envelope?.automationSource.workflowId ?? 'unknown',
      workflowRevision: envelope?.automationSource.workflowRevision ?? -1,
      n8nExecutionId: envelope?.automationSource.n8nExecutionId ?? 'unknown',
      organizationId: credential.organizationId,
      connectionId: resolvedConnectionId ?? credential.connectionId,
      serviceId: credential.serviceId,
      idempotencyKey: envelope?.idempotencyKey ?? 'unknown',
      payloadDigest,
      scopeKey,
      outcome: response.status,
      wireErrorCodes: response.errors ? response.errors.map((e) => e.code) : [],
      cacheHit,
      idempotencyConflict,
      killSwitchRuleId,
      bytesIn,
      bytesOut,
      durationMs: this.now() - t0,
      httpStatus:
        response.status === 'FAILED'
          ? httpStatusFromErrors(response.errors ?? [], 500)
          : response.status === 'ACCEPTED'
            ? 202
            : 200,
    };
  }
}

export type AdapterOutcome =
  | { kind: 'APPLIED'; data: unknown }
  | { kind: 'DEPENDENCY_OFFLINE'; message: string }
  | { kind: 'TIMEOUT'; message: string };