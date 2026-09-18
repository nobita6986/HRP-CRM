/**
 * url-policy.ts — SSRF policy harness for CORE/1.10 (synthetic).
 *
 * This is a deterministic string-based policy check (no DNS lookup,
 * no fetch, no HEAD request). The goal is to reject obvious SSRF
 * attempts at the application boundary:
 *
 *   - scheme must be `https:` (no `http:`, `file:`, `gopher:`, etc.)
 *   - host must NOT be a private/loopback/link-local address:
 *       127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
 *       169.254.0.0/16 (incl. cloud metadata 169.254.169.254),
 *       ::1/128, fc00::/7, fe80::/10
 *   - host must NOT be in the explicit deny list (configured per env)
 *
 * The harness is fixture-based:
 *   - test cases live in `tests/url-policy.test.mjs`
 *   - `evaluateUrl(url)` returns `PolicyDecision` with `allow: boolean`
 *     and reason. NO NETWORK CALLS.
 *
 * Production must:
 *   - also perform DNS resolution checks (this fixture does not)
 *   - block redirect chains to private hosts
 *   - enforce size limits + content-type allowlist at the download port
 *   - replace this fixture with HRP-owned runtime policy
 */

export interface PolicyDecision {
  allow: boolean;
  reason: string;
  /** Set of policy rules that matched (for test introspection). */
  rules: string[];
}

const DENY_REASONS = {
  invalidUrl: 'INVALID_URL',
  badScheme: 'BAD_SCHEME',
  privateHost: 'PRIVATE_HOST',
  denyListed: 'DENY_LISTED_HOST',
} as const;

const ALLOWED_SCHEME = 'https:';

const DENY_LIST: readonly string[] = [
  // example: 'evil.example.com',
];

/**
 * Test helper: extend the deny list (only used in fixture policy).
 * Tests must restore the original deny list after each case.
 */
let denyListOverride: readonly string[] | null = null;

export function installDenyList(hosts: readonly string[]): void {
  denyListOverride = hosts;
}

export function resetDenyList(): void {
  denyListOverride = null;
}

function getDenyList(): readonly string[] {
  return denyListOverride ?? DENY_LIST;
}

/**
 * Evaluate `url` against the SSRF policy. Returns `allow: true` only if
 * the URL parses, scheme is `https:`, host is non-private, and host is
 * not in the deny list.
 */
export function evaluateUrl(rawUrl: string): PolicyDecision {
  const rules: string[] = [];
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
    rules.push('parsed');
  } catch {
    return {
      allow: false,
      reason: DENY_REASONS.invalidUrl,
      rules: ['parse_failed'],
    };
  }

  // Scheme check
  if (parsed.protocol !== ALLOWED_SCHEME) {
    rules.push('scheme_check');
    return {
      allow: false,
      reason: `${DENY_REASONS.badScheme}: scheme=${parsed.protocol}`,
      rules,
    };
  }
  rules.push('scheme_ok');

  // Deny list
  const host = parsed.hostname.toLowerCase();
  const list = getDenyList();
  if (list.includes(host)) {
    rules.push('deny_list_check');
    return {
      allow: false,
      reason: `${DENY_REASONS.denyListed}: host=${host}`,
      rules,
    };
  }
  rules.push('deny_list_ok');

  // Private host check
  if (isPrivateHost(host)) {
    rules.push('private_check');
    return {
      allow: false,
      reason: `${DENY_REASONS.privateHost}: host=${host}`,
      rules,
    };
  }
  rules.push('public');

  return { allow: true, reason: 'public https allowed', rules };
}

/* ───────────────────────────────────────────────────────────────────────────
 * Private host detection (RFC 1918 + loopback + link-local + cloud metadata
 * + IPv6 ULA + IPv6 link-local + IPv6 loopback).
 *
 * No DNS lookup is performed here. This is a string-based test against
 * the hostname as parsed from the URL.
 * ─────────────────────────────────────────────────────────────────────────── */

export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();

  // IPv6 literal in URL is bracketed: [::1], [fe80::1]
  if (h.startsWith('[') && h.endsWith(']')) {
    const inner = h.slice(1, -1);
    return isPrivateIPv6(inner);
  }

  // IPv4 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/u.test(h)) {
    return isPrivateIPv4(h);
  }

  // Hostname patterns: localhost, *.local, *.internal
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;

  return false;
}

export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true; // malformed → treat as private
  }
  const [a, b] = parts as [number, number, number, number];
  // 127.0.0.0/8 loopback
  if (a === 127) return true;
  // 10.0.0.0/8 private
  if (a === 10) return true;
  // 172.16.0.0/12 private
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 private
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 link-local (cloud metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8
  if (a === 0) return true;
  return false;
}

export function isPrivateIPv6(ip: string): boolean {
  // ::1/128 loopback
  if (ip === '::1') return true;
  // fc00::/7 unique local
  const hex = ip.replace(/:/g, '').toLowerCase();
  if (hex.startsWith('fc') || hex.startsWith('fd')) return true;
  // fe80::/10 link-local
  if (hex.startsWith('fe80') || hex.startsWith('fe90') || hex.startsWith('fea0') || hex.startsWith('feb0')) return true;
  return false;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Helper: evaluate many URLs and return aggregate decision.
 * Useful for the harness to assert batch fixtures.
 * ─────────────────────────────────────────────────────────────────────────── */

export function evaluateBatch(urls: readonly string[]): {
  allowed: string[];
  denied: Array<{ url: string; reason: string }>;
} {
  const allowed: string[] = [];
  const denied: Array<{ url: string; reason: string }> = [];
  for (const u of urls) {
    const d = evaluateUrl(u);
    if (d.allow) allowed.push(u);
    else denied.push({ url: u, reason: d.reason });
  }
  return { allowed, denied };
}
