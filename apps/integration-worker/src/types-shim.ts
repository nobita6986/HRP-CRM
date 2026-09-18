/**
 * types-shim.ts — CORE/1.5
 *
 * Minimal types for worker-side pipeline execution.
 *
 * Worker does NOT have a file: dependency on integration-api. So we extract
 * only the minimal types needed:
 *  - ParseResult (from protocol-fixture)
 *  - Scope (from scope-verify)
 *
 * Worker reads these as opaque shapes from receipt.commandRefsJson.
 * The actual ParseResult is stored by integration-api at commit time.
 */

/**
 * Stable eventId resolution result from provider body.
 * Worker treats this as opaque JSON (parsed from receipt.commandRefsJson).
 */
export interface MinimalParseResult {
  ok: boolean;
  eventType: string;
  eventId: string;
  eventIdSource: 'primary' | 'fallback' | 'unknown';
  parsedBody: unknown;
}

/**
 * Minimal scope (organizationId, provider, connectionId, externalAccountId).
 */
export interface MinimalScope {
  organizationId: string;
  provider: 'CHATWOOT' | 'ZALO_OA' | 'GENERIC' | 'HRP_UI' | string;
  connectionId: string;
  externalAccountId?: string;
}
