/**
 * context-panel/src/ui/types.ts — Shared types for React UI (CORE/1.9).
 *
 * Task: CORE/1.9 — Context Panel + Intake review mock UI.
 * Dependencies: CORE/1.1 (mock gateway), CORE/1.6 (orchestrator), frozen contracts.
 *
 * Types derived from contracts + orchestrator types.
 */

import type {
  ContextPanelResult,
} from '@hrp-engagement/contracts';

/* ─────────────────────────────────────────────────────────────────────────────
 * Re-export from contracts for UI consumption.
 * ───────────────────────────────────────────────────────────────────────────── */

export type { ContextPanelResult } from '@hrp-engagement/contracts';

/* ─────────────────────────────────────────────────────────────────────────────
 * IntakeRunResult — re-exported from orchestrator (CORE/1.6).
 * ───────────────────────────────────────────────────────────────────────────── */

/** Minimal IntakeRunResult shape for UI consumption. */
export interface IntakeRunResult {
  checkpointId: string;
  state: 'COMPLETED' | 'FAILED' | 'PARTIAL' | 'REVIEW_PENDING';
  appliedSteps: string[];
  partialFailure?: {
    failedStep: string;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
  };
  actedOnAnyStep: boolean;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * UI-specific types (not from contracts — synthetic/mock only).
 * ───────────────────────────────────────────────────────────────────────────── */

/** Props passed to most UI components for layout adaptation. */
export interface LayoutProps {
  isNarrow?: boolean;
}

/** State machine for Talent/Client context panel query. */
export type PanelState =
  | { kind: 'loading' }
  | { kind: 'empty'; message?: string }
  | { kind: 'forbidden' }
  | { kind: 'unresolved' }
  | { kind: 'stale' }
  | { kind: 'timeout' }
  | { kind: 'error'; message: string }
  | { kind: 'partial'; data: ContextPanelResult }
  | { kind: 'success'; data: ContextPanelResult };

/** Intake review state machine. */
export type IntakeState =
  | { kind: 'idle' }
  | { kind: 'previewing' }
  | { kind: 'preview-success'; candidates: IntakeCandidate[] }
  | { kind: 'preview-error'; message: string }
  | { kind: 'confirming' }
  | { kind: 'submitting' }
  | { kind: 'success'; result: IntakeRunResult }
  | { kind: 'partial'; result: IntakeRunResult }
  | { kind: 'error'; message: string };

/** Mock intake candidate from preview. */
export interface IntakeCandidate {
  id: string;
  label: string;
  strength: 'STRONG' | 'WEAK' | 'PARTIAL';
}

/** Mock evidence item for intake review. */
export interface MockEvidenceItem {
  id: string;
  kind: 'CCCD_FRONT' | 'CCCD_BACK';
  status: 'ready' | 'pending' | 'quarantined' | 'rejected';
}

/** Variant for status badges. */
export type BadgeVariant = 'success' | 'warning' | 'neutral' | 'error';

/** Branding tokens — PROPOSAL, not finalized. */
export interface BrandingTokens {
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  error: string;
  neutral: string;
  text: string;
  muted: string;
  border: string;
  background: string;
  panelBackground: string;
}

/** Default branding tokens (PROPOSAL — not verified). */
export const DEFAULT_BRANDING: BrandingTokens = {
  primary: '#0066cc',
  secondary: '#5856d6',
  success: '#28a745',
  warning: '#ffc107',
  error: '#dc3545',
  neutral: '#6c757d',
  text: '#212529',
  muted: '#6c757d',
  border: '#dee2e6',
  background: '#f8f9fa',
  panelBackground: '#ffffff',
};
