/**
 * integration-api/src/receiver/connection-registry.ts — CORE/1.2
 *
 * Connection registry: server-trusted map từ `(organizationId, provider,
 * connectionId)` đến `{ secret, algorithm }`. Resolved từ env (synthetic),
 * KHÔNG từ URL path / body / header.
 *
 * Per Owner brief + Auditor F1 (CORE/1.2 CHANGES_REQUIRED):
 *  - Resolve connection từ registry/config server-side, bind chính xác
 *    organization + provider + connection + secret.
 *  - Không coi URL path là trusted scope (path shape chỉ là index để tra
 *    registry; registry PHẢI confirm).
 *  - Loại collision do sanitize/uppercase ID; không chỉ thêm org vào
 *    chuỗi env key nhưng vẫn dùng phép biến đổi gây va chạm.
 *  - Unknown connection hoặc scope mismatch phải fail trước persist.
 *
 * Per Owner brief + Auditor F2 (CORE/1.2 CHANGES_REQUIRED):
 *  - Pin algorithm theo connection config tin cậy.
 *  - Header nếu có chỉ được đối chiếu, không chọn/override algorithm.
 *
 * Format env (synthetic; JSON array):
 *   HRP_WEBHOOK_CONNECTIONS = JSON.stringify([
 *     {
 *       organizationId: "org-synthetic-001",
 *       provider: "CHATWOOT",
 *       connectionId: "conn-synth-001",
 *       secret: "synthetic-secret-do-not-use",
 *       algorithm: "HMAC_SHA256"
 *     },
 *     ...
 *   ])
 *
 * Alternative format (synthetic; pipe-delimited for shell escape):
 *   HRP_WEBHOOK_CONNECTION_<N> = "org-synthetic-001|CHATWOOT|conn-synth-001|HMAC_SHA256|<secret>"
 *
 * Production (Phase 9 / HRP-owned): SecretRef + connection registry từ
 * Integration-config service. CORE/1.2 chỉ env (synthetic).
 */

import type { WebhookSignatureAlgorithm } from '@hrp-engagement/contracts';
import { SUPPORTED_PROVIDERS, type SupportedProvider } from './protocol-fixture.js';

export type ConnectionAlgorithm = Extract<
  WebhookSignatureAlgorithm,
  'HMAC_SHA256' | 'HMAC_SHA512'
>;

export interface ConnectionEntry {
  organizationId: string;
  provider: SupportedProvider;
  /** Raw connectionId — KHÔNG sanitize/uppercase để tránh collision. */
  connectionId: string;
  /**
   * Shared secret bytes/string. CORE/1.2 chỉ compare HMAC với secret này
   * 1 lần duy nhất cho (org, provider, conn). Production: SecretRef opaque.
   */
  secret: string;
  /** Pinned algorithm — KHÔNG lấy từ header (Auditor F2). */
  algorithm: ConnectionAlgorithm;
}

export type RegistryResult =
  | { ok: true; entry: ConnectionEntry; algorithm: ConnectionAlgorithm }
  | {
      ok: false;
      code:
        | 'registry_unconfigured'
        | 'unknown_connection'
        | 'scope_mismatch'
        | 'unsupported_algorithm';
      message: string;
    };

export class ConnectionRegistry {
  private readonly map = new Map<string, ConnectionEntry>();
  private readonly configured: boolean;

  constructor(entries: ConnectionEntry[]) {
    const seen = new Set<string>();
    for (const e of entries) {
      validateEntryShape(e);
      const key = this.keyOf(e.organizationId, e.provider, e.connectionId);
      if (seen.has(key)) {
        throw new Error(
          `ConnectionRegistry: duplicate entry cho (${e.organizationId}, ${e.provider}, ${e.connectionId}); registry phải không trùng.`,
        );
      }
      seen.add(key);
      this.map.set(key, e);
    }
    this.configured = entries.length > 0;
  }

  /**
   * Server-trusted lookup. URL path chỉ là INDEX — registry PHẢI confirm.
   * KHÔNG tự chọn/override algorithm; chỉ trả về algorithm đã pin trong
   * registry.
   */
  resolve(args: {
    organizationId: string;
    provider: string;
    connectionId: string;
  }): RegistryResult {
    if (!this.configured) {
      return {
        ok: false,
        code: 'registry_unconfigured',
        message:
          'ConnectionRegistry chưa có entry nào; receiver ở CORE/1.2 cần HRP_WEBHOOK_CONNECTIONS (hoặc HRP_WEBHOOK_CONNECTION_<N>) trong env.',
      };
    }
    if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(args.provider)) {
      return {
        ok: false,
        code: 'unknown_connection',
        message: `Provider không thuộc CORE/1.2 fixture allowlist: ${args.provider}`,
      };
    }
    const key = this.keyOf(args.organizationId, args.provider, args.connectionId);
    const entry = this.map.get(key);
    if (!entry) {
      return {
        ok: false,
        code: 'unknown_connection',
        message: `Connection KHÔNG có trong registry: (org=${args.organizationId}, provider=${args.provider}, connectionId=${args.connectionId}). Không verify với secret từ env heuristic.`,
      };
    }
    return {
      ok: true,
      entry,
      algorithm: entry.algorithm,
    };
  }

  size(): number {
    return this.map.size;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  /**
   * Canonical key (NO sanitize/uppercase). Owner + Auditor F1 rõ:
   * collision-safe; connectionId là RAW literal.
   */
  private keyOf(org: string, provider: string, conn: string): string {
    return `${org}\u0000${provider}\u0000${conn}`;
  }
}

/**
 * Decode registry từ env (synthetic).
 *
 * Hỗ trợ 2 format:
 *  1. JSON: `HRP_WEBHOOK_CONNECTIONS = JSON.stringify([...])`
 *  2. Pipe-delimited numbered: `HRP_WEBHOOK_CONNECTION_0`,
 *     `HRP_WEBHOOK_CONNECTION_1`, ... với mỗi entry là
 *     `org|provider|connectionId|algorithm|secret`.
 *
 * Trả về `[]` nếu env không có entry nào — caller phải reject registry
 * lookups với `registry_unconfigured`.
 */
export function loadConnectionRegistryFromEnv(
  env: Record<string, string | undefined>,
): ConnectionEntry[] {
  const out: ConnectionEntry[] = [];

  // Format 1: JSON array.
  const jsonRaw = env['HRP_WEBHOOK_CONNECTIONS'];
  if (jsonRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonRaw);
    } catch (e) {
      throw new Error(
        `HRP_WEBHOOK_CONNECTIONS không phải JSON hợp lệ: ${(e as Error).message}`,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new Error('HRP_WEBHOOK_CONNECTIONS phải là JSON array');
    }
    for (const item of parsed) {
      out.push(parseEntry(item));
    }
  }

  // Format 2: pipe-delimited numbered (synthetic; shell-friendly).
  const numberedKeys = Object.keys(env)
    .filter((k) => /^HRP_WEBHOOK_CONNECTION_\d+$/u.test(k))
    .sort((a, b) => {
      const na = Number.parseInt(a.split('_').pop() ?? '0', 10);
      const nb = Number.parseInt(b.split('_').pop() ?? '0', 10);
      return na - nb;
    });
  for (const k of numberedKeys) {
    const raw = env[k];
    if (!raw) continue;
    const parts = raw.split('|');
    if (parts.length !== 5) {
      throw new Error(
        `${k} phải có 5 phần pipe-delimited: org|provider|connectionId|algorithm|secret (got ${parts.length})`,
      );
    }
    const [organizationId, provider, connectionId, algorithm, secret] = parts as [
      string,
      string,
      string,
      string,
      string,
    ];
    out.push(parseEntry({ organizationId, provider, connectionId, algorithm, secret }));
  }

  return out;
}

function parseEntry(raw: unknown): ConnectionEntry {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Connection entry phải là object');
  }
  const e = raw as Record<string, unknown>;
  const organizationId = requireString(e['organizationId'], 'organizationId');
  const provider = requireString(e['provider'], 'provider');
  const connectionId = requireString(e['connectionId'], 'connectionId');
  const secret = requireString(e['secret'], 'secret');
  const algorithm = requireString(e['algorithm'], 'algorithm');
  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(
      `Connection entry provider không thuộc CORE/1.2 allowlist: ${provider}`,
    );
  }
  if (algorithm !== 'HMAC_SHA256' && algorithm !== 'HMAC_SHA512') {
    throw new Error(
      `Connection entry algorithm phải là HMAC_SHA256 | HMAC_SHA512 (got ${algorithm})`,
    );
  }
  return {
    organizationId,
    provider: provider as SupportedProvider,
    connectionId,
    secret,
    algorithm,
  };
}

function requireString(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`Connection entry thiếu/không hợp lệ field ${name}`);
  }
  return v;
}

/**
 * Validate entry shape on direct construction (not just env-decode path).
 * Cùng rule với parseEntry nhưng cho object đã typed.
 */
function validateEntryShape(e: ConnectionEntry): void {
  if (!e.organizationId || !e.provider || !e.connectionId) {
    throw new Error('Connection entry thiếu organizationId/provider/connectionId');
  }
  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(e.provider)) {
    throw new Error(
      `Connection entry provider không thuộc CORE/1.2 allowlist: ${e.provider}`,
    );
  }
  if (e.algorithm !== 'HMAC_SHA256' && e.algorithm !== 'HMAC_SHA512') {
    throw new Error(
      `Connection entry algorithm phải là HMAC_SHA256 | HMAC_SHA512 (got ${e.algorithm})`,
    );
  }
  if (!e.secret || e.secret.length === 0) {
    throw new Error('Connection entry thiếu secret');
  }
}
