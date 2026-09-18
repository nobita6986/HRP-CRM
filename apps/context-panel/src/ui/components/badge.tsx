/**
 * context-panel/src/ui/components/badge.tsx — Status badge component (CORE/1.9).
 *
 * Tokens cam là đề xuất; ghi rõ PROPOSAL nếu chưa xác minh.
 */

import * as React from 'react';
import type { BadgeVariant } from '../types.js';

interface StatusBadgeProps {
  label: string;
  variant?: BadgeVariant;
  title?: string;
}

/** Color map — PROPOSAL, chưa xác minh bởi design team. */
const VARIANT_STYLES: Record<BadgeVariant, { bg: string; color: string; border: string }> = {
  success: { bg: '#d4edda', color: '#155724', border: '#c3e6cb' },
  warning: { bg: '#fff3cd', color: '#856404', border: '#ffeeba' },
  neutral: { bg: '#e9ecef', color: '#495057', border: '#dee2e6' },
  error: { bg: '#f8d7da', color: '#721c24', border: '#f5c6cb' },
};

export function StatusBadge({ label, variant = 'neutral', title }: StatusBadgeProps) {
  const styles = VARIANT_STYLES[variant];
  return (
    <span
      role="status"
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0.125rem 0.5rem',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 500,
        background: styles.bg,
        color: styles.color,
        border: `1px solid ${styles.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}
