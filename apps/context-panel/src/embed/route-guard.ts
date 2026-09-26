/**
 * context-panel/src/embed/route-guard.ts — B.03-PREP shared synthetic-route guard.
 *
 * C-B03-02: ALL embed-host surfaces (/embed-panel/*, /embed-host-simulator,
 * /api/embed/talent-context-read, /api/embed/seed, /api/embed/revoke) MUST
 * be unavailable (404) when HRP_MOCK_MODE=off. We use ONE shared guard so
 * we can't drift across routes.
 *
 * The guard accepts a `respondJson` callback so callers can delegate the
 * 404 response to whichever response shaper they use. The guard returns:
 *   - `null` when the route is allowed to proceed (caller continues).
 *   - `{status: number, body: ...}` when the guard blocked (caller MUST
 *     send this reply verbatim and return immediately).
 */
export interface EmbedGuardConfig {
  mockMode: string;
  nodeEnv: string;
}

export interface EmbedGuardBlock {
  status: number;
  body: { error: string; message: string };
}

export type EmbedGuardVerdict = EmbedGuardBlock | null;

/**
 * Strict surface guard. Returns null when the route is allowed to proceed.
 *
 * Block conditions (in priority order):
 *   1. production nodeEnv → 404 (embed surface never ships in prod).
 *   2. mockMode === 'off' → 404 (B2 parity for the embed sub-suite).
 *
 * All other (mockMode === 'deterministic' && nodeEnv !== 'production')
 * states are permitted (test/dev only).
 */
export function guardEmbedSurface(config: EmbedGuardConfig): EmbedGuardVerdict {
  if (config.nodeEnv === 'production') {
    return {
      status: 404,
      body: { error: 'not_found', message: 'Embed surface disabled in production.' },
    };
  }
  if (config.mockMode === 'off') {
    return {
      status: 404,
      body: { error: 'not_found', message: 'Embed surface disabled when mock mode is off.' },
    };
  }
  return null;
}

export const EMBED_SURFACE_ROUTES: ReadonlySet<string> = Object.freeze(new Set<string>([
  '/api/embed/talent-context-read',
  '/api/embed/seed',
  '/api/embed/revoke',
]));

/** True if the request path is one of the embed-host surface routes. */
export function isEmbedSurfacePath(path: string): boolean {
  if (EMBED_SURFACE_ROUTES.has(path)) return true;
  if (path.startsWith('/embed-panel/')) return true;
  if (path === '/embed-panel/') return true;
  if (path === '/embed-panel') return true;
  if (path === '/embed-host-simulator') return true;
  return false;
}
