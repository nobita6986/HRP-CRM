/**
 * context-panel/src/embed/channel-binding.ts — B.03-PREP strict postMessage channel binding.
 *
 * Trust model (C-B03-01):
 *   A postMessage is ACCEPTED iff BOTH conditions hold simultaneously:
 *     1. event.origin is in HOST_ALLOWED_ORIGINS (exported by message-protocol).
 *     2. event.source is the bound parent window (=== expectedParent).
 *   isWindowLike(source) is a sanity check, NOT authorization.
 *   source === window.parent alone is NOT authorization.
 *   All outbound postMessage uses verifiedParentOrigin as targetOrigin.
 * SYNTHETIC ONLY.
 */
import { HOST_ALLOWED_ORIGINS } from './message-protocol.js';

function isWindowLike(source: unknown): boolean {
  if (source === null || typeof source !== 'object') return false;
  const candidate = source as { postMessage?: unknown };
  return typeof candidate.postMessage === 'function';
}

export type ChannelBinding = {
  expectedParent: { postMessage: (msg: unknown, target: string) => void };
  expectedParentOrigin: string;
  accept(ev: { origin: string; source: unknown }): { ok: true; parentOrigin: string; parentWindow: unknown } | { ok: false; code: string; detail?: string };
  verifyParentOrigin(): string;
  isBound(): boolean;
};

export function bindChannel(expectedParent: { postMessage: (msg: unknown, target: string) => void }, expectedOrigin: string): ChannelBinding {
  if (!isWindowLike(expectedParent)) {
    throw new Error('bindChannel: expectedParent must be a Window-like object');
  }
  if (typeof expectedOrigin !== 'string' || !HOST_ALLOWED_ORIGINS.has(expectedOrigin)) {
    throw new Error('bindChannel: expectedOrigin must be in HOST_ALLOWED_ORIGINS');
  }
  const parent = expectedParent;
  const origin = expectedOrigin;

  return {
    expectedParent: parent,
    expectedParentOrigin: origin,
    accept(ev: { origin: string; source: unknown }) {
      if (typeof ev.origin !== 'string' || !HOST_ALLOWED_ORIGINS.has(ev.origin)) {
        return { ok: false, code: 'ORIGIN_NOT_ALLOWED' as const, detail: 'origin not in HOST_ALLOWED_ORIGINS' };
      }
      if (!isWindowLike(ev.source)) {
        return { ok: false, code: 'NOT_WINDOW' as const, detail: 'event.source is not a window-like object' };
      }
      if (ev.source !== parent) {
        return { ok: false, code: 'SOURCE_MISMATCH' as const, detail: 'event.source is not the bound parent window' };
      }
      if (ev.origin !== origin) {
        return { ok: false, code: 'ORIGIN_NOT_ALLOWED' as const, detail: 'origin mismatch' };
      }
      return { ok: true, parentOrigin: origin, parentWindow: parent };
    },
    verifyParentOrigin() { return origin; },
    isBound() { return true; },
  };
}

export function postToParent(binding: ChannelBinding | null, payload: unknown): boolean {
  if (!binding || !binding.isBound()) return false;
  const targetOrigin = binding.verifyParentOrigin();
  if (targetOrigin === null) return false;
  try {
    binding.expectedParent.postMessage(payload, targetOrigin);
    return true;
  } catch {
    return false;
  }
}