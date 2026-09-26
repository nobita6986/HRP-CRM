/**
 * context-panel/src/embed/static-resolver.ts — B.03-PREP shared static-path
 * resolver with traversal protection.
 *
 * C-B03-02: anchors path under `rootDir`, rejects:
 *   - `..` dot segments (literal, encoded, or backslashes)
 *   - absolute paths (drive letters and UNC-like leading slashes)
 *   - any resolved path that escapes rootDir (post-normalize check)
 *   - NUL byte injection (literal or %00-encoded)
 *
 * Returns the safe path relative to process.cwd() (so the caller can
 * `join(process.cwd(), safePath)`) OR `null` when the request violates
 * containment.
 */
import { join, normalize, sep, isAbsolute, relative } from 'node:path';

/**
 * Decode percent-encoded characters WITHOUT trusting the platform decoder
 * (we want to catch %2e%2e and %5C inside `..`). Then normalize backslashes
 * to forward slashes so we have one canonical form.
 *
 * Returns the empty string when a literal NUL byte or %00 sequence is
 * detected so the caller can reject.
 */
export function decodeForPathCheck(raw: string): string {
  if (raw.indexOf('\u0000') !== -1) return '';
  const unified = raw.replace(/\\/gu, '/');
  let out = '';
  for (let i = 0; i < unified.length; i++) {
    const c = unified.charCodeAt(i);
    if (c === 0x25 /* '%' */ && i + 2 < unified.length) {
      const hex = unified.slice(i + 1, i + 3);
      if (/^[0-9a-f]{2}$/iu.test(hex)) {
        const code = parseInt(hex, 16);
        if (code === 0x00) {
          return '';
        }
        if (code === 0x2e /* '.' */ || code === 0x2f /* '/' */) {
          out += String.fromCharCode(code);
          i += 2;
          continue;
        }
        if (code === 0x5c /* '\' */) {
          out += '/';
          i += 2;
          continue;
        }
      }
    }
    out += unified[i];
  }
  return out;
}

/**
 * Resolve a request sub-path under `rootDir`, returning the relative-to-cwd
 * path that the caller can join with process.cwd() — OR null when the
 * request violates containment.
 *
 * A URL-path sub-path starting with a leading `/` is treated as a relative
 * fragment (not an absolute filesystem path). We strip the leading slash so
 * path resolution can join it under rootDir. Two or more leading slashes
 * indicate a UNC-like absolute reference and are rejected.
 */
export function resolveSafeStaticPath(rootDir: string, sub: string): string | null {
  if (typeof sub !== 'string' || sub.length === 0) return null;
  // Reject UNC-like two-slash absolute references BEFORE stripping.
  if (sub.startsWith('//')) return null;
  // Drive-letter absolute paths are rejected.
  if (/^[a-zA-Z]:[\\/]/u.test(sub)) return null;
  // Strip a single leading slash; URL-style fragments like "/index.html"
  // represent the root index, not an absolute path.
  const cleaned = sub.charAt(0) === '/' ? sub.slice(1) : sub;
  if (cleaned.length === 0) return null;
  const decoded = decodeForPathCheck(cleaned);
  if (decoded.length === 0) return null;
  const segments = decoded.split('/');
  for (const seg of segments) {
    if (seg === '..') return null;
    if (/^\.+$/u.test(seg) && seg.length > 2) return null;
    if (seg.indexOf('\u0000') !== -1) return null;
  }
  const resolved = join(process.cwd(), rootDir, decoded);
  const normalized = normalize(resolved);
  const rootAbs = join(process.cwd(), rootDir);
  const rel = relative(rootAbs, normalized);
  if (rel === '' || rel === '.') {
    return join(rootDir, decoded);
  }
  if (rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) {
    return null;
  }
  if (normalized.indexOf('\u0000') !== -1) return null;
  return join(rootDir, decoded);
}