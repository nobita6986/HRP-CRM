/**
 * context-panel/src/ui/components/close-reason-select.tsx — Close reason dropdown (CORE/1.9).
 *
 * Uses exactly 9 values from CASE_CLOSE_REASONS enum (contracts).
 * No invented values.
 */

import * as React from 'react';
import {
  CASE_CLOSE_REASONS,
  CASE_CLOSE_REASON_LABELS_VI,
} from '@hrp-engagement/contracts';
import type { CaseCloseReason } from '@hrp-engagement/contracts';

interface CloseReasonSelectProps {
  value: CaseCloseReason | '';
  onChange: (value: CaseCloseReason) => void;
  disabled?: boolean;
  label?: string;
  required?: boolean;
}

export function CloseReasonSelect({
  value,
  onChange,
  disabled = false,
  label = 'Lý do đóng',
  required = false,
}: CloseReasonSelectProps) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <span style={{ fontSize: '0.875rem', color: '#666' }}>
        {label}
        {required && <span style={{ color: '#c00' }}> *</span>}
      </span>
      <select
        value={value}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value as CaseCloseReason);
        }}
        disabled={disabled}
        required={required}
        aria-label={label}
        style={{
          padding: '0.5rem',
          border: '1px solid #ccc',
          borderRadius: '4px',
          fontSize: '0.875rem',
          background: disabled ? '#f5f5f5' : '#fff',
          cursor: disabled ? 'not-allowed' : 'pointer',
          maxWidth: '100%',
        }}
      >
        <option value="">— Chọn lý do —</option>
        {CASE_CLOSE_REASONS.map((reason) => (
          <option key={reason} value={reason}>
            {CASE_CLOSE_REASON_LABELS_VI[reason as keyof typeof CASE_CLOSE_REASON_LABELS_VI]}
          </option>
        ))}
      </select>
    </label>
  );
}
