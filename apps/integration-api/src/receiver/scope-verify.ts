/**
 * integration-api/src/receiver/scope-verify.ts — CORE/1.2
 *
 * Scope verification cho inbound webhook. **CRITICAL invariant**:
 *  - `organizationId`, `provider`, `connectionId` PHẢI lấy từ URL path
 *    (server-side) — KHÔNG BAO GIỜ từ request body (Backlog §Task 1.2 AC:
 *    "Không tin organization/provider/connection tự khai trong body").
 *  - Body có chứa org/provider/connection nào cũng DROP (chỉ dùng để
 *    log/scope-spoof-detect, KHÔNG dùng để auth).
 *
 * URL convention:
 *   POST /webhooks/:organizationId/:provider/:connectionId
 *
 * Reject cases:
 *  - Path param missing/malformed.
 *  - Path provider không thuộc CORE/1.2 allowlist.
 *  - Path organizationId/connectionId không match pattern regex
 *    (cross-check với primitives.ts của contracts).
 */

import {
  OrganizationIdSchema,
  ConnectionIdSchema,
  ProviderNameSchema,
} from '@hrp-engagement/contracts';
import { SUPPORTED_PROVIDERS, type SupportedProvider } from './protocol-fixture.js';

export type ScopeVerifyResult =
  | {
      ok: true;
      organizationId: string;
      provider: SupportedProvider;
      connectionId: string;
    }
  | {
      ok: false;
      code:
        | 'missing_path_param'
        | 'invalid_organization_id'
        | 'invalid_connection_id'
        | 'invalid_provider'
        | 'unsupported_provider';
      message: string;
    };

export function verifyScopeFromPath(args: {
  organizationIdRaw: string | undefined;
  providerRaw: string | undefined;
  connectionIdRaw: string | undefined;
}): ScopeVerifyResult {
  const { organizationIdRaw, providerRaw, connectionIdRaw } = args;
  if (!organizationIdRaw || !providerRaw || !connectionIdRaw) {
    return {
      ok: false,
      code: 'missing_path_param',
      message:
        'URL path thiếu segment (yêu cầu /webhooks/:organizationId/:provider/:connectionId)',
    };
  }

  const orgParsed = OrganizationIdSchema.safeParse(organizationIdRaw);
  if (!orgParsed.success) {
    return {
      ok: false,
      code: 'invalid_organization_id',
      message: 'organizationId từ path không match primitive schema',
    };
  }
  const connParsed = ConnectionIdSchema.safeParse(connectionIdRaw);
  if (!connParsed.success) {
    return {
      ok: false,
      code: 'invalid_connection_id',
      message: 'connectionId từ path không match primitive schema',
    };
  }
  const provParsed = ProviderNameSchema.safeParse(providerRaw);
  if (!provParsed.success) {
    return {
      ok: false,
      code: 'invalid_provider',
      message: 'provider từ path không match primitive schema',
    };
  }
  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(providerRaw)) {
    return {
      ok: false,
      code: 'unsupported_provider',
      message: `Provider chưa có CORE/1.2 fixture: ${providerRaw}`,
    };
  }

  return {
    ok: true,
    organizationId: organizationIdRaw,
    provider: providerRaw as SupportedProvider,
    connectionId: connectionIdRaw,
  };
}

/**
 * Detect body scope spoof attempt: nếu parsed body chứa field
 * `organizationId` / `provider` / `connectionId` KHÁC path-scope.
 * Đây KHÔNG phải attack chính nó (server không tin body) nhưng audit
 * metadata quan trọng để debug.
 */
export function detectBodyScopeSpoof(args: {
  parsedBody: unknown;
  expectedScope: { organizationId: string; provider: string; connectionId: string };
}): { spoofed: boolean; mismatchedField: string | null; mismatchedValue: unknown } {
  const { parsedBody, expectedScope } = args;
  if (typeof parsedBody !== 'object' || parsedBody === null || Array.isArray(parsedBody)) {
    return { spoofed: false, mismatchedField: null, mismatchedValue: undefined };
  }
  const body = parsedBody as Record<string, unknown>;
  for (const field of ['organizationId', 'organization_id', 'orgId'] as const) {
    if (
      typeof body[field] === 'string' &&
      body[field] !== expectedScope.organizationId
    ) {
      return { spoofed: true, mismatchedField: field, mismatchedValue: body[field] };
    }
  }
  for (const field of ['provider', 'channel', 'source'] as const) {
    if (
      typeof body[field] === 'string' &&
      body[field] !== expectedScope.provider
    ) {
      return { spoofed: true, mismatchedField: field, mismatchedValue: body[field] };
    }
  }
  for (const field of ['connectionId', 'connection_id', 'accountId'] as const) {
    if (
      typeof body[field] === 'string' &&
      body[field] !== expectedScope.connectionId
    ) {
      return { spoofed: true, mismatchedField: field, mismatchedValue: body[field] };
    }
  }
  return { spoofed: false, mismatchedField: null, mismatchedValue: undefined };
}
