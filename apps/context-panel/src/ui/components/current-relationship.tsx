/**
 * context-panel/src/ui/components/current-relationship.tsx — CurrentRelationship badge (CORE/1.9).
 *
 * Read-only badge. CurrentRelationship field is never mutable.
 * Labels from contracts enum.
 */

import * as React from 'react';
import {
  CURRENT_RELATIONSHIPS,
  CURRENT_RELATIONSHIP_LABELS_VI,
} from '@hrp-engagement/contracts';
import type { CurrentRelationship } from '@hrp-engagement/contracts';
import { StatusBadge } from './badge.js';

interface CurrentRelationshipBadgeProps {
  value: CurrentRelationship;
}

/** Map relationship → color variant. */
function getVariant(value: CurrentRelationship): 'success' | 'warning' | 'neutral' {
  switch (value) {
    case 'WORKING_VIA_HRP': return 'success';
    case 'FORMER_HRP_WORKER': return 'warning';
    default: return 'neutral';
  }
}

export function CurrentRelationshipBadge({ value }: CurrentRelationshipBadgeProps) {
  const label = CURRENT_RELATIONSHIP_LABELS_VI[value as keyof typeof CURRENT_RELATIONSHIP_LABELS_VI] ?? value;
  const variant = getVariant(value);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
      }}
      title="Quan hệ với HRP (chỉ đọc)"
    >
      <StatusBadge
        label={label}
        variant={variant}
        title={`Quan hệ: ${label}`}
      />
      <span
        style={{
          fontSize: '0.7rem',
          color: '#999',
          fontStyle: 'italic',
        }}
        aria-hidden="true"
      >
        (chỉ đọc)
      </span>
    </div>
  );
}
