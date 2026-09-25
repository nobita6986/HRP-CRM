/**
 * automation/connection-registry.ts — N8N/0.2 service identity registry.
 *
 * The gateway has its OWN connection registry — separate from
 * receiver/connection-registry.ts (CORE/1.2). Reason: the n8n service
 * identity is a DIFFERENT trust boundary than the webhook receiver
 * identity.
 *
 * Threat model (see THREAT-BOUNDARY.md):
 *  - Body-supplied organizationId / connectionId / serviceId are NEVER
 *    trusted. They are RESOLVED from the credential the caller presents.
 *  - Server-trusted scope is the registry entry that the credential
 *    authenticates against.
 *  - Expiry is enforced; expired credentials fail closed.
 */

import {
  AutomationServiceEntry,
  AutomationServiceEntrySchema,
  AutomationOperationNameSchema,
  AutomationGatewayConfig,
} from './types.js';
import { ValidationError } from './errors.js';

export type ResolveResult =
  | { ok: true; entry: AutomationServiceEntry }
  | {
      ok: false;
      code:
        | 'registry_unconfigured'
        | 'unknown_service'
        | 'credential_expired'
        | 'invalid_entry';
      message: string;
    };

export class AutomationServiceRegistry {
  private readonly entries = new Map<string, AutomationServiceEntry>();
  private readonly configured: boolean;
  private readonly now: () => number;

  constructor(entries: AutomationServiceEntry[], opts: { now?: () => number } = {}) {
    this.now = opts.now ?? (() => Date.now());
    const seen = new Set<string>();
    for (const e of entries) {
      const parsed = AutomationServiceEntrySchema.safeParse(e);
      if (!parsed.success) {
        throw new ValidationError(
          'AutomationServiceRegistry entry invalid: ' +
            (parsed.error.issues[0]?.message ?? 'unknown'),
        );
      }
      if (parsed.data.expiresAt <= this.now()) {
        continue;
      }
      const key = this.keyOf(
        parsed.data.serviceId,
        parsed.data.organizationId,
        parsed.data.connectionId,
      );
      if (seen.has(key)) {
        throw new Error(
          'AutomationServiceRegistry: duplicate entry for (' +
            parsed.data.serviceId +
            ', ' +
            parsed.data.organizationId +
            ', ' +
            parsed.data.connectionId +
            ')',
        );
      }
      seen.add(key);
      this.entries.set(key, parsed.data);
    }
    this.configured = entries.length > 0;
  }

  resolve(args: {
    serviceId: string;
    organizationId: string;
    connectionId: string;
  }): ResolveResult {
    if (!this.configured) {
      return {
        ok: false,
        code: 'registry_unconfigured',
        message:
          'AutomationServiceRegistry: no entries; gateway requires HRP_AUTOMATION_SERVICES (or numbered HRP_AUTOMATION_SERVICE_<N>) env vars.',
      };
    }
    const key = this.keyOf(args.serviceId, args.organizationId, args.connectionId);
    const entry = this.entries.get(key);
    if (!entry) {
      return {
        ok: false,
        code: 'unknown_service',
        message:
          'AutomationServiceRegistry: no entry for (serviceId, organizationId, connectionId); credential not recognized.',
      };
    }
    if (entry.expiresAt <= this.now()) {
      return {
        ok: false,
        code: 'credential_expired',
        message: 'AutomationServiceRegistry: credential expired.',
      };
    }
    return { ok: true, entry };
  }

  isOperationAllowed(entry: AutomationServiceEntry, op: string): boolean {
    const parsed = AutomationOperationNameSchema.safeParse(op);
    if (!parsed.success) return false;
    return entry.allowedOperations.includes(parsed.data);
  }

  size(): number {
    return this.entries.size;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  private keyOf(serviceId: string, org: string, conn: string): string {
    return serviceId + '\u0000' + org + '\u0000' + conn;
  }
}

/**
 * Load registry from env (synthetic; parallel to webhook-receiver env
 * loading).
 *
 *   HRP_AUTOMATION_SERVICES             : JSON array of entries
 *   HRP_AUTOMATION_SERVICE_<N>          : pipe-delimited single entry
 *
 * Pipe format:
 *   serviceId|organizationId|connectionId|expiresAt|allowedOpsCsv|secret
 */
export function loadAutomationRegistryFromEnv(
  env: Record<string, string | undefined>,
): AutomationServiceEntry[] {
  const out: AutomationServiceEntry[] = [];

  const jsonRaw = env['HRP_AUTOMATION_SERVICES'];
  if (jsonRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonRaw);
    } catch (e) {
      throw new Error(
        'HRP_AUTOMATION_SERVICES không phải JSON hợp lệ: ' +
          (e as Error).message,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new Error('HRP_AUTOMATION_SERVICES phải là JSON array');
    }
    for (const item of parsed) {
      out.push(parsePipeEntry(item));
    }
  }

  const numberedKeys = Object.keys(env)
    .filter((k) => /^HRP_AUTOMATION_SERVICE_\d+$/u.test(k))
    .sort();
  for (const k of numberedKeys) {
    const raw = env[k];
    if (!raw) continue;
    const parts = raw.split('|');
    if (parts.length !== 6) {
      throw new Error(
        k +
          ' phải có 6 phần pipe-delimited: serviceId|organizationId|connectionId|expiresAt|allowedOpsCsv|secret (got ' +
          parts.length +
          ')',
      );
    }
    const [serviceId, organizationId, connectionId, expiresAtStr, allowedOpsCsv, secret] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const expiresAt = Number.parseInt(expiresAtStr, 10);
    if (!Number.isFinite(expiresAt)) {
      throw new Error(k + ' expiresAt không phải số nguyên hợp lệ');
    }
    out.push(
      parsePipeEntry({
        serviceId,
        organizationId,
        connectionId,
        secret,
        algorithm: 'HMAC_SHA256',
        expiresAt,
        allowedOperations: allowedOpsCsv
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      }),
    );
  }

  return out;
}

function parsePipeEntry(raw: unknown): AutomationServiceEntry {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Automation service entry phải là object');
  }
  const e = raw as Record<string, unknown>;
  const required = [
    'serviceId',
    'organizationId',
    'connectionId',
    'secret',
    'algorithm',
    'expiresAt',
    'allowedOperations',
  ];
  for (const k of required) {
    if (e[k] === undefined || e[k] === null) {
      throw new Error('Automation service entry thiếu field ' + k);
    }
  }
  if (e['algorithm'] !== 'HMAC_SHA256') {
    throw new Error(
      'Automation service entry algorithm hiện chỉ hỗ trợ HMAC_SHA256 (got ' +
        String(e['algorithm']) +
        ')',
    );
  }
  const allowedOperations = e['allowedOperations'];
  if (!Array.isArray(allowedOperations)) {
    throw new Error('Automation service entry allowedOperations phải là array');
  }
  return AutomationServiceEntrySchema.parse({
    serviceId: e['serviceId'],
    organizationId: e['organizationId'],
    connectionId: e['connectionId'],
    secret: e['secret'],
    algorithm: 'HMAC_SHA256',
    expiresAt: e['expiresAt'],
    allowedOperations,
  });
}

export interface AutomationGatewayBounds {
  HARD_MAX_PAYLOAD_BYTES: number;
  HARD_MAX_TIMEOUT_MS: number;
}

export const AUTOMATION_HARD_BOUNDS: AutomationGatewayBounds = Object.freeze({
  HARD_MAX_PAYLOAD_BYTES: 1024 * 1024,
  HARD_MAX_TIMEOUT_MS: 30_000,
});

export function clampAutomationConfig(
  cfg: AutomationGatewayConfig,
  bounds: AutomationGatewayBounds = AUTOMATION_HARD_BOUNDS,
): AutomationGatewayConfig {
  return {
    maxPayloadBytes: Math.min(cfg.maxPayloadBytes, bounds.HARD_MAX_PAYLOAD_BYTES),
    defaultTimeoutMs: Math.min(cfg.defaultTimeoutMs, bounds.HARD_MAX_TIMEOUT_MS),
    rateLimitPerMinute: Math.max(1, Math.min(cfg.rateLimitPerMinute, 10_000)),
    idempotencyRetentionMs: Math.max(1_000, cfg.idempotencyRetentionMs),
    maxIdempotencyRecords: Math.max(1_000, cfg.maxIdempotencyRecords),
  };
}